import type { ServerEvent } from "@dm/shared";

/**
 * Sequencing for speak_as_npc clips, so an NPC line and the Realtime DM never talk over each
 * other: a clip is broadcast to /table only while the DM's own audio is silent, clips play one at
 * a time in order, and each enqueue() resolves when the clip ended. The DM session holds its next
 * response until then (DmSession.holdResponses). Every wait has a timeout, so a turn is never lost.
 */

/** Extra time after the clip's length before we stop waiting for the table's "ended" report. */
export const CLIP_END_GRACE_MS = 1500;
/** Play anyway if the DM is still "speaking" after this long (e.g. a lost stopped event). */
export const DM_SPEAKING_MAX_WAIT_MS = 30_000;
/** A reserved slot whose clip never arrives (synthesis hung) is dropped after this long. */
export const RESERVE_MAX_MS = 30_000;

export interface NpcClip {
  npcName: string;
  line: string;
  url: string;
  durationMs: number;
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
}

interface Entry {
  clip?: NpcClip;
  resolve: () => void;
  playing: boolean;
  waitExpired: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

export class NpcClipQueue {
  private queue: Entry[] = [];
  private dmSpeaking = false;

  constructor(private deps: { broadcast(ev: ServerEvent): void }) {}

  /** Queue a ready clip; resolves when it finished (table report or timeout) or the queue was cleared. */
  enqueue(clip: NpcClip): Promise<void> {
    const slot = this.reserve();
    slot.play(clip);
    return slot.done;
  }

  /** Take the next place in line now; fill it with play() once the clip is synthesized. */
  reserve(): NpcSlot {
    let entry!: Entry;
    const done = new Promise<void>((resolve) => {
      entry = { resolve, playing: false, waitExpired: false };
    });
    this.queue.push(entry);
    entry.timer = setTimeout(() => this.drop(entry), RESERVE_MAX_MS);
    return {
      done,
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
      e.resolve();
    }
    this.dmSpeaking = false;
  }

  get size() {
    return this.queue.length;
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
    if (head.timer) clearTimeout(head.timer);
    head.playing = true;
    const { npcName, line, url, durationMs } = head.clip;
    head.timer = undefined;
    this.deps.broadcast({ type: "npc_speech", npcName, line, url });
    head.timer = setTimeout(() => this.finish(head), Math.max(0, durationMs) + CLIP_END_GRACE_MS);
  }

  /** Remove a slot that never got (or will never get) its clip. */
  private drop(entry: Entry) {
    const i = this.queue.indexOf(entry);
    if (i < 0 || entry.playing) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.queue.splice(i, 1);
    entry.resolve();
    if (i === 0) this.pump();
  }

  private finish(entry: Entry) {
    if (this.queue[0] !== entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.queue.shift();
    entry.resolve();
    this.pump();
  }
}
