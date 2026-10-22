import { describe, expect, it } from "vitest";
import { FLOOR_TAIL_MS, type FloorView } from "@dm/shared";
import { floorLabel, isTalkKey, roomHoldsFloor, tableMicEnabled, tailAfter, TalkPress } from "./floor";

const off: FloorView = { pushToTalk: false, holder: null };
const idle: FloorView = { pushToTalk: true, holder: null };
const room: FloorView = { pushToTalk: true, holder: { room: true } };
const samHere: FloorView = { pushToTalk: true, holder: { playerId: "p_sam", inRoom: true } };
const anaAway: FloorView = { pushToTalk: true, holder: { playerId: "p_ana", inRoom: false } };

describe("roomHoldsFloor", () => {
  it("open mic when push-to-talk is off or not known yet", () => {
    expect(roomHoldsFloor(off)).toBe(true);
    expect(roomHoldsFloor(null)).toBe(true);
  });
  it("with push-to-talk, only while the room or a player in the room holds the floor", () => {
    expect(roomHoldsFloor(idle)).toBe(false);
    expect(roomHoldsFloor(room)).toBe(true);
    expect(roomHoldsFloor(samHere)).toBe(true);
    expect(roomHoldsFloor(anaAway)).toBe(false);
  });
});

describe("tableMicEnabled", () => {
  it("mute always wins", () => {
    expect(tableMicEnabled({ muted: true, floor: off, tailUntil: 0, now: 0 })).toBe(false);
    expect(tableMicEnabled({ muted: true, floor: room, tailUntil: 0, now: 0 })).toBe(false);
  });
  it("open while the room holds the floor or within the tail after", () => {
    expect(tableMicEnabled({ muted: false, floor: room, tailUntil: 0, now: 1000 })).toBe(true);
    expect(tableMicEnabled({ muted: false, floor: idle, tailUntil: 1500, now: 1000 })).toBe(true);
    expect(tableMicEnabled({ muted: false, floor: idle, tailUntil: 1000, now: 1000 })).toBe(false);
    expect(tableMicEnabled({ muted: false, floor: anaAway, tailUntil: 0, now: 1000 })).toBe(false);
  });
  it("open while a voice is being enrolled (the recording may come from the table mic), mute still wins", () => {
    const enrolling: FloorView = { ...idle, enrolling: true };
    expect(tableMicEnabled({ muted: false, floor: enrolling, tailUntil: 0, now: 1000 })).toBe(true);
    expect(tableMicEnabled({ muted: false, floor: { ...anaAway, enrolling: true }, tailUntil: 0, now: 1000 })).toBe(true);
    expect(tableMicEnabled({ muted: true, floor: enrolling, tailUntil: 0, now: 1000 })).toBe(false);
  });
});

describe("tailAfter", () => {
  it("starts a tail when the room lets go, keeps it otherwise", () => {
    expect(tailAfter(true, false, 1000, 0)).toBe(1000 + FLOOR_TAIL_MS);
    expect(tailAfter(false, false, 1000, 1200)).toBe(1200);
    expect(tailAfter(false, true, 1000, 1200)).toBe(0);
    expect(tailAfter(true, true, 1000, 0)).toBe(0);
  });
});

describe("floorLabel", () => {
  const players = [
    { id: "p_sam", name: "Sam" },
    { id: "p_ana", name: "Ana" },
  ];
  it("names who is talking to the DM", () => {
    expect(floorLabel(off, players)).toBeUndefined();
    expect(floorLabel(idle, players)).toBeUndefined();
    expect(floorLabel(room, players)).toBe("The table is talking to the DM");
    expect(floorLabel(anaAway, players)).toBe("Ana is talking to the DM");
    expect(floorLabel(anaAway, players, "p_ana")).toBe("You are talking to the DM");
    expect(floorLabel({ pushToTalk: true, holder: { playerId: "p_x", inRoom: false } }, players)).toBe("Someone is talking to the DM");
  });
});

describe("isTalkKey", () => {
  const ev = (over: Partial<Parameters<typeof isTalkKey>[0]> = {}) => ({ key: " ", code: "Space", target: { tagName: "DIV" }, ...over });
  it("Space outside text fields, without modifiers", () => {
    expect(isTalkKey(ev())).toBe(true);
    expect(isTalkKey(ev({ key: "p", code: "KeyP" }))).toBe(false);
    expect(isTalkKey(ev({ ctrlKey: true }))).toBe(false);
    expect(isTalkKey(ev({ target: { tagName: "INPUT" } }))).toBe(false);
    expect(isTalkKey(ev({ target: { tagName: "BUTTON" } }))).toBe(true);
    expect(isTalkKey(ev({ target: { isContentEditable: true } }))).toBe(false);
  });
});

describe("TalkPress (the phone's hold button)", () => {
  const make = (ok = true) => {
    const sent: boolean[] = [];
    const p = new TalkPress((down) => (sent.push(down), ok));
    return { p, sent };
  };
  it("sends one press and one release; repeats are ignored", () => {
    const { p, sent } = make();
    expect(p.press()).toBe(true);
    expect(p.press()).toBe(false);
    expect(p.pressed).toBe(true);
    p.release();
    p.release();
    expect(p.pressed).toBe(false);
    expect(sent).toEqual([true, false]);
  });
  it("a press the socket couldn't send isn't held", () => {
    const { p, sent } = make(false);
    expect(p.press()).toBe(false);
    expect(p.pressed).toBe(false);
    p.release();
    expect(sent).toEqual([true]);
  });
  it("push-to-talk turned off mid-press lets go, so the button works again once it's back on", () => {
    const { p, sent } = make();
    p.press();
    p.sync(false);
    expect(p.pressed).toBe(false);
    p.sync(true);
    expect(p.press()).toBe(true);
    expect(sent).toEqual([true, false, true]);
  });
});
