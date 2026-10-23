import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FLOOR_MAX_HOLD_MS, FLOOR_TAIL_MS, type FloorHolder, type FloorView } from "@dm/shared";
import { floorLabel, HOLD_WARN_MS, holdSecondsLeft, isTalkKey, isTypingTarget, roomHoldsFloor, tableMicEnabled, tailAfter, TALK_RETRY_MS, TalkPress } from "./floor";

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

describe("a phone mic's hold (holder.phone)", () => {
  const samPhone: FloorView = { pushToTalk: true, holder: { playerId: "p_sam", inRoom: true, phone: true } };
  const samPhoneOpen: FloorView = { pushToTalk: false, holder: { playerId: "p_sam", inRoom: true, phone: true } };
  it("closes the room mic, with push-to-talk on or off; it reopens once the hold ends (open mic)", () => {
    expect(roomHoldsFloor(samPhone)).toBe(false);
    expect(roomHoldsFloor(samPhoneOpen)).toBe(false);
    expect(tableMicEnabled({ muted: false, floor: samPhoneOpen, tailUntil: 0, now: 1000 })).toBe(false);
    expect(tableMicEnabled({ muted: false, floor: off, tailUntil: 0, now: 1000 })).toBe(true);
  });
  it("a recording on the phone keeps the room mic shut; one on /host or the table opens it", () => {
    expect(tableMicEnabled({ muted: false, floor: { ...idle, enrolling: true, enrollingPhone: "p_sam" }, tailUntil: 0, now: 1000 })).toBe(false);
    expect(tableMicEnabled({ muted: false, floor: { ...idle, enrolling: true }, tailUntil: 0, now: 1000 })).toBe(true);
  });
  it("is named and counted down with push-to-talk off too", () => {
    expect(floorLabel(samPhoneOpen, [{ id: "p_sam", name: "Sam" }], "p_ana")).toBe("Sam is talking to the DM");
    expect(floorLabel({ pushToTalk: false, holder: { playerId: "p_sam", inRoom: true } }, [], undefined)).toBeUndefined();
    expect(holdSecondsLeft({ ...samPhoneOpen, holdLeftMs: 3000 }, 0, 0)).toBe(3);
  });
  it("a phone mic's TalkPress keeps working with push-to-talk off; a plain one lets go", () => {
    const sent: boolean[] = [];
    const phone = new TalkPress((down) => (sent.push(down), true), { anyMode: true });
    phone.press();
    phone.update(off);
    phone.sync(false);
    expect(phone.pressed).toBe(true);
    expect(sent).toEqual([true]);
    const plain = new TalkPress(() => true);
    plain.press();
    plain.update(off);
    expect(plain.pressed).toBe(false);
  });
});

describe("tableMicEnabled with the TV's own key (localPress)", () => {
  const base = { muted: false, tailUntil: 0, now: 1000 };
  it("opens as soon as Space goes down on a free floor, before the server's floor comes back", () => {
    expect(tableMicEnabled({ ...base, floor: idle, localPress: true })).toBe(true);
    expect(tableMicEnabled({ ...base, floor: idle, localPress: false })).toBe(false);
  });
  it("not while someone else holds the floor (the press will be refused), and mute still wins", () => {
    expect(tableMicEnabled({ ...base, floor: anaAway, localPress: true })).toBe(false);
    expect(tableMicEnabled({ ...base, muted: true, floor: idle, localPress: true })).toBe(false);
  });
});

describe("holdSecondsLeft (the countdown before the 30 s cap)", () => {
  const held: FloorView = { ...samHere, holdLeftMs: FLOOR_MAX_HOLD_MS };
  it("nothing while nobody holds it, push-to-talk is off, or the server sent no expiry", () => {
    expect(holdSecondsLeft(idle, 0, 0)).toBeUndefined();
    expect(holdSecondsLeft({ ...off, holder: { room: true }, holdLeftMs: 1000 }, 0, 0)).toBeUndefined();
    expect(holdSecondsLeft(samHere, 0, 29_000)).toBeUndefined();
  });
  it("only in the last HOLD_WARN_MS, counted from when the floor arrived, rounded up, never negative", () => {
    const got = 5_000;
    expect(holdSecondsLeft(held, got, got)).toBeUndefined();
    expect(holdSecondsLeft(held, got, got + FLOOR_MAX_HOLD_MS - HOLD_WARN_MS - 1)).toBeUndefined();
    expect(holdSecondsLeft(held, got, got + FLOOR_MAX_HOLD_MS - HOLD_WARN_MS)).toBe(10);
    expect(holdSecondsLeft(held, got, got + FLOOR_MAX_HOLD_MS - 2_500)).toBe(3);
    expect(holdSecondsLeft(held, got, got + FLOOR_MAX_HOLD_MS + 400)).toBe(0);
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
  it("two inputs share one press: the button and Space don't release each other", () => {
    const { p, sent } = make();
    expect(p.press("pointer")).toBe(true);
    expect(p.press("key")).toBe(true);
    p.release("key");
    expect(p.pressed).toBe(true);
    expect(p.holds("pointer")).toBe(true);
    expect(p.holds("key")).toBe(false);
    p.release("pointer");
    expect(p.pressed).toBe(false);
    expect(sent).toEqual([true, false]);
    // And the other way round: Space held, the button clicked and released.
    p.press("key");
    p.press("pointer");
    p.release("pointer");
    expect(p.pressed).toBe(true);
    p.release("key");
    expect(sent).toEqual([true, false, true, false]);
  });
  it("releaseAll lets go of every input at once (blur, unmount)", () => {
    const { p, sent } = make();
    p.press("pointer");
    p.press("key");
    p.releaseAll();
    expect(p.pressed).toBe(false);
    expect(sent).toEqual([true, false]);
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

describe("TalkPress retry (a press the server refused or throttled)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const samHolds: FloorView = { pushToTalk: true, holder: { playerId: "p_sam", inRoom: true } };
  const mine = (h: FloorHolder) => "playerId" in h && h.playerId === "p_ana";
  const anaHolds: FloorView = { pushToTalk: true, holder: { playerId: "p_ana", inRoom: false } };
  const make = () => {
    const sent: boolean[] = [];
    const changes = vi.fn();
    const p = new TalkPress((down) => (sent.push(down), true), { mine, onChange: changes });
    return { p, sent, changes, downs: () => sent.filter(Boolean).length };
  };

  it("a press refused while someone else held the floor is sent again once it is free", () => {
    const { p, downs } = make();
    p.update(samHolds);
    p.press();
    vi.advanceTimersByTime(5_000);
    expect(downs()).toBe(1);
    expect(p.waiting).toBe(true);
    p.update(idle);
    expect(downs()).toBe(2);
    p.update(anaHolds);
    expect(p.waiting).toBe(false);
    vi.advanceTimersByTime(5_000);
    expect(downs()).toBe(2);
  });

  it("a press the server dropped silently (its throttle) is sent again every TALK_RETRY_MS until it is given", () => {
    const { p, downs } = make();
    p.update(idle);
    p.press();
    vi.advanceTimersByTime(TALK_RETRY_MS);
    expect(downs()).toBe(2);
    vi.advanceTimersByTime(TALK_RETRY_MS);
    expect(downs()).toBe(3);
    p.update(anaHolds);
    vi.advanceTimersByTime(5_000);
    expect(downs()).toBe(3);
  });

  it("never re-takes a floor it was given (the 30 s cap ended it): the hold is expired until let go", () => {
    const { p, sent, downs } = make();
    p.update(idle);
    p.press();
    p.update(anaHolds);
    expect(p.expiredFor(anaHolds)).toBe(false);
    p.update(idle);
    vi.advanceTimersByTime(5_000);
    expect(downs()).toBe(1);
    expect(p.expiredFor(idle)).toBe(true);
    p.release();
    expect(p.expiredFor(idle)).toBe(false);
    // A fresh press asks again.
    p.press();
    expect(p.expiredFor(idle)).toBe(false);
    expect(p.waiting).toBe(true);
    expect(sent).toEqual([true, false, true]);
  });

  it("a press made while its own holder already has the floor counts as given: it never re-takes it after the cap", () => {
    const { p, downs } = make();
    p.update(anaHolds);
    p.press();
    expect(p.waiting).toBe(false);
    vi.advanceTimersByTime(20_000);
    p.update(idle);
    vi.advanceTimersByTime(5_000);
    expect(downs()).toBe(1);
    expect(p.expiredFor(idle)).toBe(true);
  });

  it("no retries after letting go, or for a press with no idea whose floor is its own", () => {
    const { p, downs } = make();
    p.update(samHolds);
    p.press();
    p.release();
    p.update(idle);
    vi.advanceTimersByTime(5_000);
    expect(downs()).toBe(1);
    const sent: boolean[] = [];
    const plain = new TalkPress((d) => (sent.push(d), true));
    plain.update(idle);
    plain.press();
    vi.advanceTimersByTime(5_000);
    expect(sent).toEqual([true]);
  });

  it("push-to-talk turned off (update) lets go; onChange hears presses, grants and releases", () => {
    const { p, sent, changes } = make();
    p.update(idle);
    p.press();
    expect(changes).toHaveBeenCalledTimes(1);
    p.update(anaHolds);
    expect(changes).toHaveBeenCalledTimes(2);
    p.update(off);
    expect(p.pressed).toBe(false);
    expect(sent).toEqual([true, false]);
    expect(changes).toHaveBeenCalledTimes(3);
  });
});

describe("isTypingTarget (page hotkeys stay out of text fields)", () => {
  it("inputs, text areas, selects and editable elements are typing", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) expect(isTypingTarget({ tagName })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("anything else is not", () => {
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget({})).toBe(false);
  });
});
