import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FloorView } from "@dm/shared";
import { ROOM_TALK_RETRY_MS, RoomTalk, roomTalkPointer, roomTalkView } from "./hostTalk";

const players = [{ id: "p_sam", name: "Sam" }];
const off: FloorView = { pushToTalk: false, holder: null };
const idle: FloorView = { pushToTalk: true, holder: null };
const room: FloorView = { pushToTalk: true, holder: { room: true } };
const sam: FloorView = { pushToTalk: true, holder: { playerId: "p_sam", inRoom: true } };

describe("roomTalkView", () => {
  it("hidden while push-to-talk is off or not known yet", () => {
    expect(roomTalkView(null, players, false)).toBeNull();
    expect(roomTalkView(off, players, false)).toBeNull();
  });
  it("idle: hold to talk for the room", () => {
    expect(roomTalkView(idle, players, false)).toMatchObject({ state: "idle", text: "Hold to talk (room)" });
  });
  it("live while the room holds the floor", () => {
    expect(roomTalkView(room, players, true)).toMatchObject({ state: "live" });
    // The TV's Space holds it too: the room mic is open either way.
    expect(roomTalkView(room, players, false)).toMatchObject({ state: "live" });
  });
  it("busy with the holder's name while a player holds it", () => {
    expect(roomTalkView(sam, players, false)).toEqual({ state: "busy", text: "Sam is talking to the DM" });
    expect(roomTalkView(sam, players, true)).toMatchObject({ state: "busy" });
  });
  it("pending: pressed but the server hasn't said the room holds it yet", () => {
    expect(roomTalkView(idle, players, true)).toMatchObject({ state: "pending" });
  });
});

type Sent = { type: "ptt"; down: boolean };
function setup() {
  const sent: Sent[] = [];
  const shown: boolean[] = [];
  const t = new RoomTalk((ev) => (sent.push(ev), true), (p) => shown.push(p));
  return { t, sent, shown, downs: () => sent.filter((e) => e.down).length, ups: () => sent.filter((e) => !e.down).length };
}

describe("RoomTalk", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends one ptt down and one up for the room (no playerId)", () => {
    const { t, sent } = setup();
    t.update(idle);
    t.down();
    t.down();
    t.update(room);
    t.up();
    t.up();
    expect(sent).toEqual([
      { type: "ptt", down: true },
      { type: "ptt", down: false },
    ]);
  });

  it("lets go when push-to-talk turns off mid-press", () => {
    const { t, sent, shown } = setup();
    t.update(idle);
    t.down();
    t.update(off);
    expect(t.pressed).toBe(false);
    expect(sent.at(-1)).toEqual({ type: "ptt", down: false });
    expect(shown.at(-1)).toBe(false);
  });

  // The server drops a press while someone else holds the floor (first press wins); it doesn't queue it.
  it("a press refused because a player held the floor is sent again when the floor comes free", () => {
    const { t, sent, downs } = setup();
    t.update(sam);
    t.down();
    vi.advanceTimersByTime(5_000);
    expect(downs()).toBe(1); // nothing to retry while Sam holds it
    t.update(idle);
    expect(sent.at(-1)).toEqual({ type: "ptt", down: true });
    expect(downs()).toBe(2);
    t.update(room);
    vi.advanceTimersByTime(5_000);
    expect(downs()).toBe(2); // granted: no more
  });

  it("a re-press inside the server's throttle (dropped silently) is sent again once it has passed", () => {
    const { t, downs } = setup();
    t.update(idle);
    t.down();
    t.update(room);
    t.up();
    t.update(idle);
    t.down(); // within PTT_MIN_GAP_MS of the up: the server ignores it, and no floor update comes
    expect(downs()).toBe(2);
    vi.advanceTimersByTime(ROOM_TALK_RETRY_MS);
    expect(downs()).toBe(3);
    t.update(room);
    vi.advanceTimersByTime(5_000);
    expect(downs()).toBe(3);
  });

  it("never re-takes a floor the room was given (the 30 s cap ended it) or after letting go", () => {
    const { t, downs } = setup();
    t.update(idle);
    t.down();
    t.update(room);
    t.update(idle); // the cap released it while the button is still held
    vi.advanceTimersByTime(5_000);
    expect(downs()).toBe(1);
    t.up();
    const b = setup();
    b.t.update(sam);
    b.t.down();
    b.t.up();
    b.t.update(idle);
    vi.advanceTimersByTime(5_000);
    expect(b.downs()).toBe(1);
  });

  it("attach: the page hiding lets go, and so does detaching (unmount)", () => {
    const { t, ups } = setup();
    const doc = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState });
    const detach = t.attach(doc);
    t.update(idle);
    t.down();
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(ups()).toBe(0); // still visible
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(ups()).toBe(1);
    expect(t.pressed).toBe(false);
    doc.visibilityState = "visible";
    t.down();
    detach();
    expect(ups()).toBe(2);
    // Detached: no more listening.
    t.down();
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(ups()).toBe(2);
  });
});

describe("roomTalkPointer (the button's pointer handlers)", () => {
  const ev = (over: Partial<{ button: number; pointerId: number }> = {}) => {
    const capture = vi.fn();
    return { e: { button: 0, pointerId: 1, preventDefault: vi.fn(), currentTarget: { setPointerCapture: capture }, ...over }, capture };
  };

  it("a primary press holds and captures the pointer; other buttons don't", () => {
    const { t, downs } = setup();
    t.update(idle);
    const h = roomTalkPointer(t);
    h.onPointerDown(ev({ button: 2 }).e);
    expect(downs()).toBe(0);
    const { e, capture } = ev();
    h.onPointerDown(e);
    expect(downs()).toBe(1);
    expect(capture).toHaveBeenCalledWith(1);
  });

  it.each(["onPointerUp", "onPointerCancel", "onPointerLeave", "onLostPointerCapture"] as const)("%s lets go once", (name) => {
    const { t, sent, ups } = setup();
    t.update(idle);
    const h = roomTalkPointer(t);
    h.onPointerDown(ev().e);
    h[name]();
    h.onPointerUp();
    expect(ups()).toBe(1);
    expect(sent.at(-1)).toEqual({ type: "ptt", down: false });
  });
});
