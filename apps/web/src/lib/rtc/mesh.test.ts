import { describe, expect, it } from "vitest";
import { FLOOR_TAIL_MS, type PeerInfo } from "@dm/shared";
import { holdsOwnFloor, isPolite, meshDiff, slotOf, SLOTS, slotTrack, VIDEO_MAX_BITRATE, videoEncoding } from "./mesh";

const peer = (peerId: string, over: Partial<PeerInfo> = {}): PeerInfo => ({ peerId, room: false, camera: true, showCharacter: false, micOn: true, ...over });

describe("isPolite (perfect negotiation roles)", () => {
  it("exactly one side of every pair is polite, the same answer on both pages", () => {
    for (const [a, b] of [["r1", "p2"], ["p2", "p10"], ["p3", "p4"]]) {
      expect(isPolite(a, b)).not.toBe(isPolite(b, a));
    }
    // Remote players are polite toward the room: the room builds the connection (it offers first).
    expect(isPolite("p7", "r1")).toBe(true);
  });
});

describe("meshDiff (which connections to open and close)", () => {
  it("opens one connection to every other member: a full mesh", () => {
    const peers = [peer("r1", { room: true }), peer("p2", { playerId: "a" }), peer("p3", { playerId: "b" })];
    expect(meshDiff([], "p2", peers)).toEqual({ open: [peers[0], peers[2]], close: [] });
    expect(meshDiff(["r1", "p3"], "p2", peers)).toEqual({ open: [], close: [] });
  });

  it("closes connections to members who left, or every one when this page left the call", () => {
    const peers = [peer("r5", { room: true }), peer("p2")];
    expect(meshDiff(["r1", "p3"], "p2", peers)).toEqual({ open: [peers[0]], close: ["r1", "p3"] });
    expect(meshDiff(["r1", "p3"], null, [])).toEqual({ open: [], close: ["r1", "p3"] });
  });
});

describe("slots: one transceiver per kind, in the same order on both sides", () => {
  it("mic, the DM's voice (only the room sends it), the camera", () => {
    expect(SLOTS).toEqual(["mic", "dm", "cam"]);
    expect(slotOf(0)).toBe("mic");
    expect(slotOf(2)).toBe("cam");
    expect(slotOf(3)).toBeUndefined();
    expect(slotOf(-1)).toBeUndefined();
  });

  it("the camera goes out only when it is on and the character card isn't shown instead", () => {
    const local = { mic: "mic", dm: null, cam: "cam" };
    const prefs = { camera: true, showCharacter: false, micOn: true };
    expect(slotTrack("cam", { local, prefs, towardRoom: false, holdingFloor: false })).toBe("cam");
    expect(slotTrack("cam", { local, prefs: { ...prefs, showCharacter: true }, towardRoom: false, holdingFloor: false })).toBeNull();
    expect(slotTrack("cam", { local, prefs: { ...prefs, camera: false }, towardRoom: false, holdingFloor: false })).toBeNull();
  });

  it("muted toward the players, the mic still reaches the room while this player talks to the DM", () => {
    const local = { mic: "mic", dm: "dm", cam: null };
    const prefs = { camera: false, showCharacter: false, micOn: false };
    expect(slotTrack("mic", { local, prefs, towardRoom: false, holdingFloor: true })).toBeNull();
    expect(slotTrack("mic", { local, prefs, towardRoom: true, holdingFloor: false })).toBeNull();
    expect(slotTrack("mic", { local, prefs, towardRoom: true, holdingFloor: true })).toBe("mic");
    expect(slotTrack("mic", { local, prefs: { ...prefs, micOn: true }, towardRoom: false, holdingFloor: false })).toBe("mic");
    expect(slotTrack("dm", { local, prefs, towardRoom: false, holdingFloor: false })).toBe("dm");
  });
});

describe("holdsOwnFloor (with the tail after a release)", () => {
  const floor = (holder: unknown) => ({ pushToTalk: true, holder }) as never;
  it("is true while this seat holds the floor and for the tail after it lets go", () => {
    expect(holdsOwnFloor(floor({ playerId: "a", inRoom: false }), "a", 0, 1000)).toBe(true);
    expect(holdsOwnFloor(floor({ playerId: "b", inRoom: false }), "a", 0, 1000)).toBe(false);
    expect(holdsOwnFloor(floor(null), "a", 1000 + FLOOR_TAIL_MS, 1000)).toBe(true);
    expect(holdsOwnFloor(floor(null), "a", 1000, 1000)).toBe(false);
    expect(holdsOwnFloor(null, "a", 0, 1000)).toBe(false);
  });
});

describe("videoEncoding (default 360p, ~300 kbps)", () => {
  it("scales a bigger camera down to 360 lines and caps the bitrate", () => {
    expect(videoEncoding(720)).toEqual({ maxBitrate: VIDEO_MAX_BITRATE, scaleResolutionDownBy: 2 });
    expect(videoEncoding(360)).toEqual({ maxBitrate: VIDEO_MAX_BITRATE, scaleResolutionDownBy: 1 });
    expect(videoEncoding(240)).toEqual({ maxBitrate: VIDEO_MAX_BITRATE, scaleResolutionDownBy: 1 });
    expect(videoEncoding(undefined)).toEqual({ maxBitrate: VIDEO_MAX_BITRATE, scaleResolutionDownBy: 1 });
    expect(VIDEO_MAX_BITRATE).toBe(300_000);
  });
});
