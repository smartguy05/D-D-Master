import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { config } from "../config.js";
import type { Store } from "../db/index.js";
import { AudioRing, SAMPLE_RATE, trimSilence } from "./audio.js";
import { matchSpeaker, mergeEmbedding, type SpeakerMatch } from "./voiceprint.js";

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
export class SpeakerService {
  readonly ring = new AudioRing(90);
  private extractor?: Extractor;
  readonly status: string;
  private enrollStart?: { playerId: string; ts: number };

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

  startEnrollment(playerId: string) {
    this.enrollStart = { playerId, ts: Date.now() };
  }

  /** Finish enrollment: embed the audio captured since startEnrollment and merge it into the voiceprint. */
  finishEnrollment(campaignId: string, playerId: string): { ok: boolean; samples: number; message: string } {
    if (!this.enrollStart || this.enrollStart.playerId !== playerId) {
      return { ok: false, samples: 0, message: "Enrollment was not started for this player." };
    }
    const audio = trimSilence(this.ring.slice(this.enrollStart.ts, Date.now()));
    this.enrollStart = undefined;
    if (audio.length < SAMPLE_RATE * MIN_ENROLL_SECONDS) {
      return { ok: false, samples: 0, message: "Didn't hear enough speech. Say your name and a full sentence." };
    }
    const samples = this.addSample(campaignId, playerId, this.embed(audio));
    return { ok: true, samples, message: "Voice saved." };
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
