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

export interface NpcClip {
  npcName: string;
  line: string;
  url: string;
  durationMs: number;
}

interface Entry {
  clip: NpcClip;
  resolve: () => void;
  playing: boolean;
  waitExpired: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

export class NpcClipQueue {
  private queue: Entry[] = [];
  private dmSpeaking = false;

  constructor(private deps: { broadcast(ev: ServerEvent): void }) {}

  /** Queue a clip; resolves when it finished (table report or timeout) or the queue was cleared. */
  enqueue(clip: NpcClip): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push({ clip, resolve, playing: false, waitExpired: false });
      this.pump();
    });
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
    if (!head?.playing || head.clip.url !== url) return false;
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
    if (!head || head.playing) return;
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
    this.deps.broadcast({ type: "npc_speech", npcName, line, url });
    head.timer = setTimeout(() => this.finish(head), Math.max(0, durationMs) + CLIP_END_GRACE_MS);
  }

  private finish(entry: Entry) {
    if (this.queue[0] !== entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.queue.shift();
    entry.resolve();
    this.pump();
  }
}
