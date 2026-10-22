import { describe, expect, it } from "vitest";
import { Character, GameState, type FloorView, type PeerInfo } from "@dm/shared";
import { callPrefsKey, DEFAULT_PLAY_PREFS, levelOf, loadCallPrefs, nextTalking, saveCallPrefs, stripTiles, tileView } from "./tiles";

const state = GameState.parse({
  campaignId: "c",
  players: [
    { id: "ana", name: "Ana", characterId: "c_ana" },
    { id: "bo", name: "Bo" },
  ],
  characters: [Character.parse({ id: "c_ana", playerName: "Ana", name: "Lyra", species: "Elf", className: "Wizard", level: 3, maxHp: 18, hp: 7, tempHp: 2, conditions: ["poisoned"], spriteUrl: "/media/lyra.png", color: "#55aaff" })],
});
const peer = (over: Partial<PeerInfo>): PeerInfo => ({ peerId: "p2", room: false, playerId: "ana", camera: true, showCharacter: false, micOn: true, ...over });
const floor = (holder: FloorView["holder"]): FloorView => ({ pushToTalk: true, holder });

describe("tileView", () => {
  it("a remote player: the character card (sprite, name, HP, conditions) and the video when it is on air", () => {
    const t = tileView({ peer: peer({}), state, floor: null, talking: false, self: false, hasVideo: true });
    expect(t).toMatchObject({ key: "p2", title: "Lyra", subtitle: "Ana", spriteUrl: "/media/lyra.png", color: "#55aaff", hp: { hp: 7, max: 18, temp: 2 }, conditions: ["poisoned"], video: true, talking: false, floor: false, micOff: false, room: false });
  });

  it("camera off, the character instead, or no video yet: the card", () => {
    expect(tileView({ peer: peer({ camera: false }), state, floor: null, talking: false, self: false, hasVideo: true }).video).toBe(false);
    expect(tileView({ peer: peer({ showCharacter: true }), state, floor: null, talking: false, self: false, hasVideo: true }).video).toBe(false);
    expect(tileView({ peer: peer({}), state, floor: null, talking: false, self: false, hasVideo: false }).video).toBe(false);
  });

  it("a seat without a character shows the player's name and the default color dot", () => {
    const t = tileView({ peer: peer({ playerId: "bo", camera: false }), state, floor: null, talking: true, self: false, hasVideo: false });
    expect(t).toMatchObject({ title: "Bo", talking: true });
    expect([t.subtitle, t.spriteUrl, t.hp]).toEqual([undefined, undefined, undefined]);
    expect(t.color).toMatch(/^#/);
  });

  it("the room is 'The table'; the gold ring goes to whoever holds the floor (the room for in-room players)", () => {
    const room = peer({ peerId: "r1", room: true, playerId: undefined, camera: false });
    expect(tileView({ peer: room, state, floor: null, talking: false, self: false, hasVideo: false }).title).toBe("The table");
    expect(tileView({ peer: room, state, floor: floor({ room: true }), talking: false, self: false, hasVideo: false }).floor).toBe(true);
    expect(tileView({ peer: room, state, floor: floor({ playerId: "bo", inRoom: true }), talking: false, self: false, hasVideo: false }).floor).toBe(true);
    expect(tileView({ peer: room, state, floor: floor({ playerId: "ana", inRoom: false }), talking: false, self: false, hasVideo: false }).floor).toBe(false);
    expect(tileView({ peer: peer({}), state, floor: floor({ playerId: "ana", inRoom: false }), talking: false, self: false, hasVideo: false }).floor).toBe(true);
    expect(tileView({ peer: peer({ micOn: false }), state, floor: null, talking: false, self: false, hasVideo: false }).micOff).toBe(true);
  });
});

describe("stripTiles", () => {
  it("own tile first, then the room, then the other players in join order", () => {
    const peers = [peer({ peerId: "p4", playerId: "bo" }), peer({ peerId: "r1", room: true, playerId: undefined }), peer({ peerId: "p2" })];
    expect(stripTiles(peers, "p2").map((p) => p.peerId)).toEqual(["p2", "r1", "p4"]);
    expect(stripTiles(peers, null).map((p) => p.peerId)).toEqual(["r1", "p4", "p2"]);
  });
});

describe("talking ring (local level meter)", () => {
  it("levelOf is the scaled RMS of the samples, 0..1", () => {
    expect(levelOf(new Float32Array(128))).toBe(0);
    expect(levelOf(Float32Array.from({ length: 128 }, (_, i) => (i % 2 ? 0.5 : -0.5)))).toBe(1);
    const quiet = levelOf(Float32Array.from({ length: 128 }, (_, i) => (i % 2 ? 0.02 : -0.02)));
    expect(quiet).toBeGreaterThan(0);
    expect(quiet).toBeLessThan(0.2);
  });

  it("nextTalking turns on above a threshold and off only below a lower one", () => {
    expect(nextTalking(false, 0.05)).toBe(false);
    expect(nextTalking(false, 0.3)).toBe(true);
    expect(nextTalking(true, 0.1)).toBe(true);
    expect(nextTalking(true, 0.02)).toBe(false);
  });
});

describe("call prefs (per device, localStorage)", () => {
  it("round-trips, falls back to the defaults, and survives a storage that throws", () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const key = callPrefsKey("play");
    expect(loadCallPrefs(storage, key, DEFAULT_PLAY_PREFS)).toEqual(DEFAULT_PLAY_PREFS);
    saveCallPrefs(storage, key, { camera: false, showCharacter: true, micOn: false });
    expect(loadCallPrefs(storage, key, DEFAULT_PLAY_PREFS)).toEqual({ camera: false, showCharacter: true, micOn: false });
    mem.set(key, "{not json");
    expect(loadCallPrefs(storage, key, DEFAULT_PLAY_PREFS)).toEqual(DEFAULT_PLAY_PREFS);
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadCallPrefs(broken, key, DEFAULT_PLAY_PREFS)).toEqual(DEFAULT_PLAY_PREFS);
    expect(() => saveCallPrefs(broken, key, DEFAULT_PLAY_PREFS)).not.toThrow();
    expect(loadCallPrefs(undefined, key, DEFAULT_PLAY_PREFS)).toEqual(DEFAULT_PLAY_PREFS);
  });

  it("a /play page starts with the camera off: no prompt (or red error) for a player without a webcam", () => {
    expect(DEFAULT_PLAY_PREFS).toEqual({ camera: false, showCharacter: false, micOn: true });
  });
});
