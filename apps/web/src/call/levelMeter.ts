import { levelOf } from "./tiles";

/**
 * Local voice levels for the tiles' talking ring: one AnalyserNode per stream on one AudioContext.
 * A remote WebRTC track feeds WebAudio only while a media element plays it (Chrome): the strip plays
 * every remote voice through an <audio> element, so the meter reads them. Silent until the context runs
 * (the page's "Click to enable sound"); made inside or outside a gesture, it is resumed at once and
 * again on every unlock (iOS Safari starts it suspended). Members who left are pruned (`prune`).
 */
export class LevelMeter {
  private ctx?: AudioContext;
  private nodes = new Map<string, { stream: MediaStream; src: MediaStreamAudioSourceNode; analyser: AnalyserNode; buf: Float32Array }>();

  /** `createContext`: tests inject a fake. */
  constructor(private readonly createContext: () => AudioContext = () => new AudioContext()) {}

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
      if (!this.ctx) {
        this.ctx = this.createContext();
        this.resume();
      }
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

  /** The keys measured now. */
  keys(): IterableIterator<string> {
    return this.nodes.keys();
  }

  /** Stop measuring every key not in `keep` (members who left the call). */
  prune(keep: Set<string>) {
    for (const k of [...this.nodes.keys()]) if (!keep.has(k)) this.watch(k, null);
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

/**
 * The events that count as a user activation, so `AudioContext.resume()` inside them works: a touch
 * `pointerdown` does not (HTML: only a mouse one does), so a tap on iOS/Android is caught by `pointerup`
 * / `touchend` / `click`. Capture phase, so a handler's stopPropagation can't hide the gesture.
 */
const GESTURE_EVENTS = ["pointerup", "touchend", "click", "keydown"] as const;

/** Call `fn` on every user gesture on `target`; returns the unsubscribe. */
export function onUserGesture(target: EventTarget, fn: () => void): () => void {
  for (const t of GESTURE_EVENTS) target.addEventListener(t, fn, true);
  return () => {
    for (const t of GESTURE_EVENTS) target.removeEventListener(t, fn, true);
  };
}
