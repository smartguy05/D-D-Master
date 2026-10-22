import { levelOf } from "./tiles";

/**
 * Local voice levels for the tiles' talking ring: one AnalyserNode per stream on one AudioContext.
 * A remote WebRTC track feeds WebAudio only while a media element plays it (Chrome): the strip plays
 * every remote voice through an <audio> element, so the meter reads them. Silent until the context runs
 * (the page's "Click to enable sound").
 */
export class LevelMeter {
  private ctx?: AudioContext;
  private nodes = new Map<string, { stream: MediaStream; src: MediaStreamAudioSourceNode; analyser: AnalyserNode; buf: Float32Array }>();

  /** Measure this stream under `key` (null stops). */
  watch(key: string, stream: MediaStream | null | undefined) {
    const old = this.nodes.get(key);
    if (old?.stream === stream) return;
    if (old) {
      old.src.disconnect();
      this.nodes.delete(key);
    }
    if (!stream || !stream.getAudioTracks().length) return;
    try {
      this.ctx ??= new AudioContext();
      const src = this.ctx.createMediaStreamSource(stream);
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      this.nodes.set(key, { stream, src, analyser, buf: new Float32Array(analyser.fftSize) });
    } catch (err) {
      console.warn("[call] level meter:", (err as Error)?.message ?? err);
    }
  }

  /** The current level 0..1 (0 for an unknown key). */
  level(key: string): number {
    const n = this.nodes.get(key);
    if (!n) return 0;
    n.analyser.getFloatTimeDomainData(n.buf as Float32Array<ArrayBuffer>);
    return levelOf(n.buf);
  }

  resume() {
    if (this.ctx?.state === "suspended") void this.ctx.resume().catch(() => undefined);
  }

  close() {
    for (const k of [...this.nodes.keys()]) this.watch(k, null);
    void this.ctx?.close().catch(() => undefined);
    this.ctx = undefined;
  }
}
