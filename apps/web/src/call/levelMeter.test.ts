import { describe, expect, it } from "vitest";
import { LevelMeter, onUserGesture } from "./levelMeter";

function fakeContext() {
  const calls = { resume: 0, made: 0, disconnected: [] as string[] };
  const create = () => {
    calls.made++;
    return {
      state: "suspended",
      resume: async () => void calls.resume++,
      close: async () => undefined,
      createMediaStreamSource: (s: { id: string }) => ({ connect: () => undefined, disconnect: () => void calls.disconnected.push(s.id) }),
      createAnalyser: () => ({ fftSize: 0, getFloatTimeDomainData: () => undefined }),
    } as unknown as AudioContext;
  };
  return { create, calls };
}
const stream = (id: string) => ({ id, getAudioTracks: () => [{}] }) as unknown as MediaStream;

describe("LevelMeter", () => {
  it("resumes its context as soon as it makes it (iOS Safari starts it suspended)", () => {
    const { create, calls } = fakeContext();
    const m = new LevelMeter(create);
    m.watch("p1", stream("a"));
    expect(calls.made).toBe(1);
    expect(calls.resume).toBe(1);
  });

  it("prunes the members who left the call", () => {
    const { create, calls } = fakeContext();
    const m = new LevelMeter(create);
    m.watch("p1", stream("a"));
    m.watch("p2", stream("b"));
    expect([...m.keys()].sort()).toEqual(["p1", "p2"]);
    m.prune(new Set(["p2"]));
    expect([...m.keys()]).toEqual(["p2"]);
    expect(calls.disconnected).toEqual(["a"]);
    expect(m.level("p1")).toBe(0);
  });
});

describe("onUserGesture (what may resume the meter's context)", () => {
  it("listens, in the capture phase, to the events that count as a user activation on touch too", () => {
    const added: [string, boolean][] = [];
    const removed: string[] = [];
    const target = {
      addEventListener: (t: string, _f: unknown, capture: boolean) => void added.push([t, capture]),
      removeEventListener: (t: string) => void removed.push(t),
    } as unknown as EventTarget;
    const off = onUserGesture(target, () => undefined);
    const types = added.map(([t]) => t);
    // A touch pointerdown is not an activation (HTML: only a mouse one is); pointerup / touchend / click are.
    for (const t of ["pointerup", "touchend", "click", "keydown"]) expect(types).toContain(t);
    expect(types).not.toContain("pointerdown");
    expect(added.every(([, c]) => c === true)).toBe(true);
    off();
    expect(removed.sort()).toEqual([...types].sort());
  });
});
