/**
 * Whether this page may play sound yet. Browsers block audio until a user gesture: the dice
 * AudioContext starts suspended and HTMLAudioElement.play() (NPC clips) rejects with
 * NotAllowedError. `unlock()` runs inside a click/key handler, resumes the context and plays a
 * tiny silent clip; the page counts as unlocked once both worked. A clip that is blocked later
 * calls `markLocked()` so the TV shows its "Click to enable sound" overlay again.
 */

export interface AudioUnlockDeps {
  /** Resume the WebAudio context; resolves true when it is running (or there is none). */
  resumeContext(): Promise<boolean>;
  /** Play a silent clip through an HTMLAudioElement; rejects when autoplay is blocked. */
  primeElement(): Promise<void>;
}

/** Give up on a step that never settles (resume() can stay pending without a gesture). */
export const UNLOCK_STEP_TIMEOUT_MS = 1500;

/** 10 ms of silence (8 kHz mono PCM16 WAV): enough for play() to succeed or be refused. */
export const SILENT_WAV =
  "data:audio/wav;base64,UklGRsQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export class AudioUnlock {
  private unlocked = false;
  private attempt = 0;
  private listeners = new Set<(unlocked: boolean) => void>();

  constructor(private deps: AudioUnlockDeps) {}

  isUnlocked() {
    return this.unlocked;
  }

  /** Listen for lock changes; returns an unsubscribe function. */
  onChange(fn: (unlocked: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private set(unlocked: boolean) {
    if (this.unlocked === unlocked) return;
    this.unlocked = unlocked;
    this.listeners.forEach((fn) => fn(unlocked));
  }

  /**
   * Try to unlock (call it synchronously from a user gesture: both steps start before the first
   * await). Any success unlocks; a failure only re-locks when no newer attempt started since.
   */
  async unlock(): Promise<boolean> {
    const run = ++this.attempt;
    const ctx = withTimeout(this.deps.resumeContext(), UNLOCK_STEP_TIMEOUT_MS, false).catch(() => false);
    // Only a refusal counts against the element: a decode hiccup on the silent clip says nothing
    // about the autoplay policy.
    const el = withTimeout(
      this.deps.primeElement().then(() => true),
      UNLOCK_STEP_TIMEOUT_MS,
      false,
    ).catch((err: unknown) => !isAutoplayBlocked(err));
    const ok = (await ctx) && (await el);
    if (ok) this.set(true);
    else if (run === this.attempt) this.set(false);
    return ok;
  }

  /** A clip was refused (NotAllowedError): show the enable-sound prompt again. */
  markLocked() {
    this.set(false);
  }
}

/** True for the error play() rejects with when the browser blocks autoplay. */
export function isAutoplayBlocked(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { name?: string }).name === "NotAllowedError";
}
