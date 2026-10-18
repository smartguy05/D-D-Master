/**
 * /table playback of speak_as_npc clips. The server already sends one clip at a time (after the
 * DM's own audio stopped); this keeps the TV in order anyway, respects the table mute, and tells
 * the server when each clip is over (POST /api/npc/clip-ended) so the DM can continue. Errors and
 * blocked autoplay count as "ended". A muted table skips clips and reports nothing, so the first
 * report always comes from a table that really played the clip; the server's own timeout (clip
 * length + 1.5 s) releases the DM when every table is muted.
 */

/** The HTMLAudioElement surface used here (tests inject a fake). */
export interface ClipAudio {
  onended: (() => void) | null;
  onerror: (() => void) | null;
  play(): Promise<void>;
  pause(): void;
}

export interface NpcClipPlayerDeps {
  createAudio(url: string): ClipAudio;
  isMuted(): boolean;
  reportEnded(url: string): void;
}

export class NpcClipPlayer {
  private queue: string[] = [];
  private current?: { url: string; audio: ClipAudio };

  constructor(private deps: NpcClipPlayerDeps) {}

  enqueue(url: string) {
    if (this.current?.url === url || this.queue.includes(url)) return;
    this.queue.push(url);
    if (!this.current) this.next();
  }

  /** The table was muted: stop the clip that is playing and drop the rest, without reporting. */
  onMute() {
    if (!this.deps.isMuted()) return;
    this.stop();
  }

  /** Page teardown (or mute): drop everything without reporting. */
  stop() {
    if (this.current) {
      this.current.audio.onended = null;
      this.current.audio.onerror = null;
      this.current.audio.pause();
    }
    this.current = undefined;
    this.queue = [];
  }

  private next() {
    while (!this.current && this.queue.length) {
      const url = this.queue.shift()!;
      if (this.deps.isMuted()) continue;
      const audio = this.deps.createAudio(url);
      this.current = { url, audio };
      audio.onended = () => this.done(audio);
      audio.onerror = () => this.done(audio);
      audio.play().catch(() => this.done(audio));
    }
  }

  private done(audio: ClipAudio) {
    if (this.current?.audio !== audio) return;
    const { url } = this.current;
    audio.onended = null;
    audio.onerror = null;
    this.current = undefined;
    this.deps.reportEnded(url);
    this.next();
  }
}
