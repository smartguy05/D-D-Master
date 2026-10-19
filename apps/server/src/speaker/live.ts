import type { ServerEvent, TalkState } from "@dm/shared";

/** Level updates while someone speaks (~8 per second). */
export const LEVEL_EVERY_MS = 125;
/** Start voice ID mid-sentence once this much speech is in. */
export const LIVE_ID_AFTER_MS = 1200;
/** Retry voice ID this often until it is sure, then this much less often. */
export const LIVE_ID_EVERY_MS = 1000;
export const LIVE_ID_SURE_EVERY_MS = 2500;
/** Voice ID looks at the most recent audio only (bounded CPU per call). */
export const LIVE_ID_WINDOW_MS = 3000;

/** RMS of a PCM16 chunk scaled to 0–1 (normal speech ~0.3–0.8). */
export function pcmLevel(chunk: Buffer): number {
  const n = Math.floor(chunk.length / 2);
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = chunk.readInt16LE(i * 2) / 32768;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(Math.sqrt(sum / n)) * 1.6);
}

export interface LiveTalkDeps {
  now(): number;
  broadcast(ev: ServerEvent): void;
  /** Voice ID over [from, to] (server ms); undefined = can't tell (or not worth asking). */
  identify(fromTs: number, toTs: number): { playerId: string; confident: boolean } | undefined;
}

/**
 * Live "who's talking" for the TV: from Realtime's speech_started until speech_stopped it sends
 * the mic level (throttled) and, once enough audio is in, a provisional voice-ID match. Fed with
 * the host mic chunks (GameService.pushAudio) and the DM session's speech events.
 */
export class LiveTalk {
  private active = false;
  private startedAt = 0;
  private lastLevelAt = -Infinity;
  private lastIdAt = -Infinity;
  private playerId?: string;

  constructor(private deps: LiveTalkDeps) {}

  speechStarted() {
    this.active = true;
    this.startedAt = this.deps.now();
    this.lastLevelAt = -Infinity;
    this.lastIdAt = -Infinity;
    this.playerId = undefined;
    this.send({ who: "player", active: true, level: 0 });
  }

  speechStopped() {
    if (!this.active) return;
    this.active = false;
    this.send({ who: "player", active: false });
  }

  onAudio(chunk: Buffer) {
    if (!this.active) return;
    const now = this.deps.now();
    if (now - this.startedAt >= LIVE_ID_AFTER_MS && now - this.lastIdAt >= (this.playerId ? LIVE_ID_SURE_EVERY_MS : LIVE_ID_EVERY_MS)) {
      this.lastIdAt = now;
      let match: ReturnType<LiveTalkDeps["identify"]>;
      try {
        match = this.deps.identify(Math.max(this.startedAt, now - LIVE_ID_WINDOW_MS), now);
      } catch {
        match = undefined;
      }
      if (match?.confident && match.playerId !== this.playerId) {
        this.playerId = match.playerId;
        this.lastLevelAt = now;
        this.send(this.talk(pcmLevel(chunk)));
        return;
      }
    }
    if (now - this.lastLevelAt < LEVEL_EVERY_MS) return;
    this.lastLevelAt = now;
    this.send(this.talk(pcmLevel(chunk)));
  }

  private talk(level: number): TalkState {
    return this.playerId ? { who: "player", active: true, level, playerId: this.playerId, provisional: true } : { who: "player", active: true, level };
  }

  private send(talk: TalkState) {
    this.deps.broadcast({ type: "talk", talk });
  }
}
