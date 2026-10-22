import { describe, expect, it } from "vitest";
import { displacedAfter, micStep, ownPrefsStale, shouldJoin } from "./callSteps";

describe("micStep (the call's own mic)", () => {
  it("opens when wanted, releases when no longer wanted (the last remote left /table)", () => {
    expect(micStep(true, false)).toBe("open");
    expect(micStep(true, true)).toBe("keep");
    expect(micStep(false, true)).toBe("release");
    expect(micStep(false, false)).toBe("keep");
  });
});

describe("displacedAfter / shouldJoin (one seat on two devices)", () => {
  const ev = (self: string | null, refusedCode?: string) => ({ self, peers: [], ...(refusedCode && { refused: "x", refusedCode }) }) as never;

  it("the seat taken from another page stops this page rejoining until the user takes it back", () => {
    const displaced = displacedAfter(false, ev(null, "displaced"));
    expect(displaced).toBe(true);
    expect(shouldJoin({ ready: true, connected: true, displaced })).toBe(false);
    // A later peers update while out of the call (others joining) keeps it out.
    expect(displacedAfter(displaced, ev(null))).toBe(true);
    // Back in the call (the user pressed "Use this device"): rejoins as usual again.
    expect(displacedAfter(displaced, ev("p9"))).toBe(false);
  });

  it("other refusals don't stop the rejoin (a reconnect or a prefs change retries)", () => {
    expect(displacedAfter(false, ev(null, "full"))).toBe(false);
    expect(shouldJoin({ ready: true, connected: true, displaced: false })).toBe(true);
    expect(shouldJoin({ ready: false, connected: true, displaced: false })).toBe(false);
    expect(shouldJoin({ ready: true, connected: false, displaced: false })).toBe(false);
  });
});

describe("ownPrefsStale (a throttled rtc_join answered with the call as it stands)", () => {
  const sent = { camera: true, showCharacter: false, micOn: true };
  const me = (prefs: Partial<typeof sent>) => ({ peerId: "p1", room: false, ...sent, ...prefs });
  const ev = (self: string | null, peers: unknown[]) => ({ self, peers }) as never;

  it("the server still has older prefs for this page: stale (the page re-sends its join)", () => {
    expect(ownPrefsStale(sent, ev("p1", [me({ camera: false })]))).toBe(true);
    expect(ownPrefsStale(sent, ev("p1", [me({ micOn: false })]))).toBe(true);
    expect(ownPrefsStale(sent, ev("p1", [me({ showCharacter: true })]))).toBe(true);
  });

  it("the server's copy matches what the page last sent: not stale", () => {
    expect(ownPrefsStale(sent, ev("p1", [{ peerId: "room", room: true, camera: false, showCharacter: false, micOn: true }, me({})]))).toBe(false);
  });

  it("out of the call, own entry missing, or nothing sent yet: not stale", () => {
    expect(ownPrefsStale(sent, ev(null, []))).toBe(false);
    expect(ownPrefsStale(sent, ev("p1", []))).toBe(false);
    expect(ownPrefsStale(null, ev("p1", [me({ camera: false })]))).toBe(false);
  });
});
