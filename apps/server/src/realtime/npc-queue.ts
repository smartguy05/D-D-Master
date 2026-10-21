import type { ServerEvent } from "@dm/shared";

/**
 * Sequencing for speak_as_npc clips, so an NPC line and the Realtime DM never talk over each
 * other: a clip is broadcast to /table only while the DM's own audio is silent, clips play one at
 * a time in order, and each enqueue() resolves when the clip ended. The DM session holds its next
 * response until then (DmSession.holdResponses). Every wait has a timeout, so a turn is never lost.
 * An AI player's clip (pc) also waits while the DM is busy without audio yet (a turn being
 * answered, a response in flight): it is dropped, never played over the DM, if that lasts too long.
 */

/** Extra time after the clip's length before we stop waiting for the table's "ended" report. */
export const CLIP_END_GRACE_MS = 1500;
/** Play anyway if the DM is still "speaking" after this long (e.g. a lost stopped event). */
export const DM_SPEAKING_MAX_WAIT_MS = 30_000;
/** Voice turns starting this soon after a clip ended still count as its echo (room reverb, VAD lag). */
export const ECHO_TAIL_MS = 400;
/** A reserved slot whose clip never arrives (synthesis hung) is dropped after this long. */
export const RESERVE_MAX_MS = 30_000;
/** How often a pc clip waiting on a busy DM looks again. */
export const BUSY_POLL_MS = 250;
/** A pc clip still waiting on a busy DM after this long is dropped (the moment has passed). */
export const DM_BUSY_MAX_WAIT_MS = 15_000;

export interface NpcClip {
  npcName: string;
  line: string;
  url: string;
  durationMs: number;
  /** The speaker's portrait for the TV close-up (an AI player's sprite; NPCs use npc_focus). */
  portraitUrl?: string;
  /** Spoken by a player character (an AI player), not an NPC. */
  pc?: boolean;
}

/** A place in the queue, taken before the clip is synthesized so clips play in call order. */
export interface NpcSlot {
  /**
   * Fill the slot; it plays when it reaches the front and the DM is silent. False if the slot is
   * gone (expired after RESERVE_MAX_MS, cancelled, or the queue was cleared): the clip won't play.
   */
  play(clip: NpcClip): boolean;
  /** Synthesis failed: give the place up. */
  cancel(): void;
  /** Resolves when the clip finished, was cancelled or expired, or the queue was cleared. */
  done: Promise<void>;
  /** Resolves true when the clip starts playing, false if it never will. */
  started: Promise<boolean>;
}

interface Entry {
  clip?: NpcClip;
  resolve: () => void;
  onStart: (ok: boolean) => void;
  playing: boolean;
  waitExpired: boolean;
  timer?: ReturnType<typeof setTimeout>;
  /** Re-check timer and start time while a pc clip waits on a busy DM. */
  poll?: ReturnType<typeof setTimeout>;
  busySince?: number;
}

export class NpcClipQueue {
  private queue: Entry[] = [];
  private dmSpeaking = false;
  /** When the table speaker last played a clip: start, and end (estimated while it plays). */
  private window?: { start: number; end: number };

  constructor(
    private deps: {
      broadcast(ev: ServerEvent): void;
      /** The DM is answering or about to (DmSession.busy): AI player clips wait. */
      dmBusy?(): boolean;
    },
  ) {}

  /** Queue a ready clip; resolves when it finished (table report or timeout) or the queue was cleared. */
  enqueue(clip: NpcClip): Promise<void> {
    const slot = this.reserve();
    slot.play(clip);
    return slot.done;
  }

  /** Take the next place in line now; fill it with play() once the clip is synthesized. */
  reserve(): NpcSlot {
    let onStart!: (ok: boolean) => void;
    const started = new Promise<boolean>((r) => (onStart = r));
    let entry!: Entry;
    const done = new Promise<void>((resolve) => {
      entry = { resolve, onStart, playing: false, waitExpired: false };
    });
    this.queue.push(entry);
    entry.timer = setTimeout(() => this.drop(entry), RESERVE_MAX_MS);
    return {
      done,
      started,
      play: (clip) => {
        if (entry.clip || !this.queue.includes(entry)) return false;
        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = undefined;
        entry.clip = clip;
        this.pump();
        return true;
      },
      cancel: () => this.drop(entry),
    };
  }

  /** DM audio started/stopped (from the sideband's output_audio_buffer events). */
  setDmSpeaking(speaking: boolean) {
    if (this.dmSpeaking === speaking) return;
    this.dmSpeaking = speaking;
    this.pump();
  }

  /** /table reported the clip ended (or failed, or is muted). True if it was the playing clip. */
  clipEnded(url: string): boolean {
    const head = this.queue[0];
    if (!head?.playing || head.clip?.url !== url) return false;
    this.finish(head);
    return true;
  }

  /** Drop everything (DM stopped): waiting promises resolve, nothing more plays. */
  clear() {
    const all = this.queue.splice(0);
    for (const e of all) {
      if (e.timer) clearTimeout(e.timer);
      if (e.poll) clearTimeout(e.poll);
      e.onStart(false);
      e.resolve();
    }
    this.dmSpeaking = false;
  }

  get size() {
    return this.queue.length;
  }

  /**
   * True if `ts` falls while a clip played on the table speaker (plus `tailMs` after it ended):
   * the shared mic hears the clip, so a voice turn starting then is an echo (DmSession drops it).
   */
  echoAt(ts: number, tailMs = ECHO_TAIL_MS): boolean {
    const w = this.window;
    if (!w) return false;
    const playing = !!this.queue[0]?.playing;
    return ts >= w.start && (playing || ts <= w.end + tailMs);
  }

  private pump() {
    const head = this.queue[0];
    if (!head || head.playing || !head.clip) return;
    if (this.dmSpeaking && !head.waitExpired) {
      head.timer ??= setTimeout(() => {
        head.timer = undefined;
        head.waitExpired = true;
        this.pump();
      }, DM_SPEAKING_MAX_WAIT_MS);
      return;
    }
    if (head.clip.pc && this.deps.dmBusy?.()) {
      const now = Date.now();
      head.busySince ??= now;
      if (now - head.busySince >= DM_BUSY_MAX_WAIT_MS) return this.drop(head);
      head.poll ??= setTimeout(() => {
        head.poll = undefined;
        this.pump();
      }, BUSY_POLL_MS);
      return;
    }
    if (head.timer) clearTimeout(head.timer);
    if (head.poll) clearTimeout(head.poll);
    head.poll = undefined;
    head.playing = true;
    const { npcName, line, url, durationMs, portraitUrl, pc } = head.clip;
    head.timer = undefined;
    const now = Date.now();
    this.window = { start: now, end: now + Math.max(0, durationMs) };
    this.deps.broadcast({ type: "npc_speech", npcName, line, url, ...(portraitUrl && { portraitUrl }), ...(pc && { pc }) });
    head.onStart(true);
    head.timer = setTimeout(() => this.finish(head), Math.max(0, durationMs) + CLIP_END_GRACE_MS);
  }

  /** Remove a slot that never got (or will never get) its clip. */
  private drop(entry: Entry) {
    const i = this.queue.indexOf(entry);
    if (i < 0 || entry.playing) return;
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.poll) clearTimeout(entry.poll);
    this.queue.splice(i, 1);
    entry.onStart(false);
    entry.resolve();
    if (i === 0) this.pump();
  }

  private finish(entry: Entry) {
    if (this.queue[0] !== entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.queue.shift();
    if (entry.playing && this.window) this.window.end = Date.now();
    entry.resolve();
    this.pump();
  }
}
