import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioUnlock, UNLOCK_STEP_TIMEOUT_MS, isAutoplayBlocked } from "./audioUnlock";

const blocked = () => Object.assign(new Error("blocked"), { name: "NotAllowedError" });

function setup(opts: { ctx?: () => Promise<boolean>; el?: () => Promise<void> } = {}) {
  const resumeContext = vi.fn(opts.ctx ?? (async () => true));
  const primeElement = vi.fn(opts.el ?? (async () => undefined));
  const u = new AudioUnlock({ resumeContext, primeElement });
  const changes: boolean[] = [];
  u.onChange((v) => changes.push(v));
  return { u, changes, resumeContext, primeElement };
}

describe("AudioUnlock", () => {
  afterEach(() => vi.useRealTimers());

  it("starts locked and unlocks once both the context and the element play", async () => {
    const { u, changes, resumeContext, primeElement } = setup();
    expect(u.isUnlocked()).toBe(false);
    const p = u.unlock();
    // both steps start synchronously, inside the gesture
    expect(resumeContext).toHaveBeenCalledTimes(1);
    expect(primeElement).toHaveBeenCalledTimes(1);
    expect(await p).toBe(true);
    expect(u.isUnlocked()).toBe(true);
    expect(changes).toEqual([true]);
  });

  it("stays locked when the element is refused or the context won't run", async () => {
    expect(await setup({ el: async () => Promise.reject(blocked()) }).u.unlock()).toBe(false);
    const ctxOff = setup({ ctx: async () => false });
    expect(await ctxOff.u.unlock()).toBe(false);
    expect(ctxOff.u.isUnlocked()).toBe(false);
    expect(ctxOff.changes).toEqual([]);
  });

  it("a non-autoplay error on the silent clip doesn't keep the page locked", async () => {
    const { u } = setup({ el: async () => Promise.reject(Object.assign(new Error("decode"), { name: "NotSupportedError" })) });
    expect(await u.unlock()).toBe(true);
  });

  it("gives up on a step that never settles", async () => {
    vi.useFakeTimers();
    const { u } = setup({ ctx: () => new Promise<boolean>(() => undefined) });
    const p = u.unlock();
    await vi.advanceTimersByTimeAsync(UNLOCK_STEP_TIMEOUT_MS);
    expect(await p).toBe(false);
    expect(u.isUnlocked()).toBe(false);
  });

  it("markLocked re-locks after a blocked clip, and a later click unlocks again", async () => {
    const { u, changes } = setup();
    await u.unlock();
    u.markLocked();
    expect(u.isUnlocked()).toBe(false);
    await u.unlock();
    expect(changes).toEqual([true, false, true]);
  });

  it("an older failed attempt can't re-lock after a newer one started", async () => {
    let failFirst!: (e: unknown) => void;
    let n = 0;
    const { u } = setup({ el: () => (n++ === 0 ? new Promise<void>((_, rej) => (failFirst = rej)) : Promise.resolve()) });
    const first = u.unlock();
    await u.unlock();
    failFirst(blocked());
    expect(await first).toBe(false);
    expect(u.isUnlocked()).toBe(true);
  });

  it("recognises the autoplay error", () => {
    expect(isAutoplayBlocked(blocked())).toBe(true);
    expect(isAutoplayBlocked(new Error("x"))).toBe(false);
    expect(isAutoplayBlocked(undefined)).toBe(false);
  });
});
