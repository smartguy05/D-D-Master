import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { config } from "../config.js";
import type { Store } from "../db/index.js";
import { AudioRing, SAMPLE_RATE, trimSilence } from "./audio.js";
import { matchSpeaker, mergeEmbedding, scoreSpeakers, type SpeakerMatch } from "./voiceprint.js";

const require = createRequire(import.meta.url);

interface Extractor {
  dim: number;
  createStream(): { acceptWaveform(o: { samples: Float32Array; sampleRate: number }): void; inputFinished(): void };
  compute(stream: unknown, enableExternalBuffer?: boolean): Float32Array;
}

/** Minimum voiced audio for a usable embedding. */
const MIN_ENROLL_SECONDS = 1.5;
const MIN_IDENTIFY_SECONDS = 0.6;

/**
 * Speaker identification with sherpa-onnx speaker embeddings.
 * If the native module or the model file is missing, `available` is false and
 * the DM falls back to asking / host buttons.
 */
/** Longest an enrollment recording counts as running (its audio source wins meanwhile). */
export const ENROLL_MAX_MS = 120_000;

/** A voice being recorded on purpose: an enrollment, or a voice ID test (which saves nothing). */
/** `from`: the mic it is recorded on (/host's, or the player's own phone); the table's stream fills in when it is missing. */
type Recording = { kind: "enroll"; playerId: string; ts: number; from: RecordFrom } | { kind: "test"; ts: number; from: "host" };

/** Where a voice is recorded: /host's mic (or the table's), or the player's own phone. */
export type RecordFrom = "host" | "player";

export interface VoiceTestResult {
  ok: boolean;
  message: string;
  /** Best match, confident or not (see matchSpeaker). */
  match?: SpeakerMatch;
  /** Every voiceprint's score, best first. */
  scores: { playerId: string; score: number }[];
}

export class SpeakerService {
  readonly ring = new AudioRing(90);
  private extractor?: Extractor;
  readonly status: string;
  private recording?: Recording;
  /** The last finished recording, so a DM turn committed just after Done still counts as part of it. */
  private lastRecording?: { from: number; to: number };

  constructor(private store: Store) {
    if (!existsSync(config.speakerModel)) {
      this.status = `Speaker model not found at ${config.speakerModel}. Run "pnpm models:download".`;
      return;
    }
    try {
      const sherpa = require("sherpa-onnx-node") as { SpeakerEmbeddingExtractor: new (c: object) => Extractor };
      this.extractor = new sherpa.SpeakerEmbeddingExtractor({ model: config.speakerModel, numThreads: 2, debug: false });
      this.status = `Voice ID ready (${this.extractor.dim}-dim embeddings).`;
    } catch (err) {
      this.status = `Voice ID unavailable: ${(err as Error).message}`;
    }
  }

  get available() {
    return !!this.extractor;
  }

  embed(samples: Float32Array): Float32Array {
    if (!this.extractor) throw new Error(this.status);
    const stream = this.extractor.createStream();
    stream.acceptWaveform({ samples, sampleRate: SAMPLE_RATE });
    stream.inputFinished();
    return Float32Array.from(this.extractor.compute(stream, false));
  }

  /**
   * A voice is being recorded, for enrollment or a voice ID test (started, not finished; a forgotten
   * one stops counting after ENROLL_MAX_MS).
   */
  get enrolling(): boolean {
    return !!this.recording && Date.now() - this.recording.ts < ENROLL_MAX_MS;
  }

  startEnrollment(playerId: string, from: RecordFrom = "host") {
    this.recording = { kind: "enroll", playerId, ts: Date.now(), from };
  }

  /** Start a voice ID test: someone talks, finishTest says who it sounds like. */
  startTest() {
    this.recording = { kind: "test", ts: Date.now(), from: "host" };
  }

  /** The running recording's mic, and the seat a phone enrollment records (undefined when none runs). */
  get recordingOn(): { from: RecordFrom; playerId?: string } | undefined {
    const r = this.recording;
    if (!r || !this.enrolling) return undefined;
    return r.kind === "enroll" ? { from: r.from, playerId: r.playerId } : { from: r.from };
  }

  /** The recorded audio since the start (silence trimmed); ends the recording. */
  private takeRecording(): Float32Array {
    const now = Date.now();
    const from = this.recording!.ts;
    this.recording = undefined;
    this.lastRecording = { from, to: now };
    return trimSilence(this.ring.slice(from, now));
  }

  /**
   * The span overlaps a recording (running, or the last finished one): those words were said for
   * voice ID, not to the DM.
   */
  inRecording(fromTs: number, toTs: number): boolean {
    if (this.enrolling && toTs > this.recording!.ts) return true;
    const last = this.lastRecording;
    return !!last && fromTs < last.to && toTs > last.from;
  }

  /** Finish enrollment: embed the audio captured since startEnrollment and merge it into the voiceprint. */
  finishEnrollment(campaignId: string, playerId: string): { ok: boolean; samples: number; message: string } {
    if (this.recording?.kind !== "enroll" || this.recording.playerId !== playerId) {
      return { ok: false, samples: 0, message: "Enrollment was not started for this player." };
    }
    const audio = this.takeRecording();
    if (audio.length < SAMPLE_RATE * MIN_ENROLL_SECONDS) {
      return { ok: false, samples: 0, message: "Didn't hear enough speech. Say your name and a full sentence." };
    }
    const samples = this.addSample(campaignId, playerId, this.embed(audio));
    return { ok: true, samples, message: "Voice saved." };
  }

  /** Finish a voice ID test: score the audio since startTest against every voiceprint. Saves nothing. */
  finishTest(campaignId: string): VoiceTestResult {
    if (this.recording?.kind !== "test") return { ok: false, message: "No voice test is running.", scores: [] };
    const audio = this.takeRecording();
    const prints = this.store.getVoiceprints(campaignId);
    if (!prints.length) return { ok: false, message: "No voices are recorded yet.", scores: [] };
    if (audio.length < SAMPLE_RATE * MIN_IDENTIFY_SECONDS) {
      return { ok: false, message: "Didn't hear enough speech. Say a full sentence.", scores: [] };
    }
    const embedding = this.embed(audio);
    return {
      ok: true,
      message: "Voice checked.",
      match: matchSpeaker(embedding, prints, config.speakerThreshold),
      scores: scoreSpeakers(embedding, prints),
    };
  }

  addSample(campaignId: string, playerId: string, embedding: Float32Array): number {
    const prev = this.store.getVoiceprints(campaignId).find((p) => p.playerId === playerId);
    const merged = mergeEmbedding(prev?.embedding, prev?.samples ?? 0, embedding);
    const samples = Math.min((prev?.samples ?? 0) + 1, 50);
    this.store.saveVoiceprint(campaignId, playerId, merged, samples);
    return samples;
  }

  /** Identify who spoke between two server timestamps. Returns the match and the embedding (for later correction). */
  identify(campaignId: string, fromTs: number, toTs: number): { match?: SpeakerMatch; embedding?: Float32Array } {
    if (!this.extractor) return {};
    const prints = this.store.getVoiceprints(campaignId);
    if (!prints.length) return {};
    const audio = trimSilence(this.ring.slice(fromTs, toTs));
    if (audio.length < SAMPLE_RATE * MIN_IDENTIFY_SECONDS) return {};
    const embedding = this.embed(audio);
    return { match: matchSpeaker(embedding, prints, config.speakerThreshold), embedding };
  }
}
