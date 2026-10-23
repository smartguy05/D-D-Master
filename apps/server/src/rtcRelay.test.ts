import { describe, expect, it } from "vitest";
import { MAX_REMOTE_PEERS, type ServerEvent } from "@dm/shared";
import type { Access } from "./auth/access.js";
import { RTC_JOIN_MAX, RTC_RATE_MAX, RTC_RATE_WINDOW_MS, RtcRelay, type RtcJoinContext } from "./rtcRelay.js";

type Sock = { name: string; got: ServerEvent[] };
const sock = (name: string): Sock => ({ name, got: [] });
const PREFS = { camera: true, showCharacter: false, micOn: true };

const TABLE: RtcJoinContext = { role: "table", access: { level: "table", anySeat: true }, inRoom: true };
const remote = (playerId: string): RtcJoinContext => ({ role: "player", access: { level: "player", anySeat: false, playerId } as Access, inRoom: false });

function setup(seats: string[] = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"]) {
  let now = 1000;
  const relay = new RtcRelay<Sock>({ send: (ws, ev) => ws.got.push(ev), seatOk: (id) => seats.includes(id), now: () => now });
  return { relay, tick: (ms: number) => (now += ms) };
}
const lastPeers = (s: Sock) => [...s.got].reverse().find((e): e is Extract<ServerEvent, { type: "peers" }> => e.type === "peers");
const rtcs = (s: Sock) => s.got.filter((e) => e.type === "rtc");
const offer = { description: { type: "offer" as const, sdp: "v=0" } };

describe("RtcRelay (WebRTC call members and signaling)", () => {
  it("the table joins as the room and a remote page as its seat; every member hears of the others", () => {
    const { relay } = setup();
    const tv = sock("tv");
    const sam = sock("sam");
    relay.join(tv, { prefs: { camera: false, showCharacter: false, micOn: true } }, TABLE);
    const roomId = lastPeers(tv)!.self!;
    expect(roomId).toMatch(/^r/);
    expect(lastPeers(tv)).toMatchObject({ peers: [{ peerId: roomId, room: true, camera: false }] });
    relay.join(sam, { prefs: PREFS }, remote("p1"));
    const samId = lastPeers(sam)!.self!;
    expect(samId).toMatch(/^p/);
    expect(lastPeers(tv)!.peers).toEqual([
      { peerId: roomId, room: true, camera: false, showCharacter: false, micOn: true },
      { peerId: samId, room: false, playerId: "p1", ...PREFS },
    ]);
    expect(lastPeers(sam)!.peers).toEqual(lastPeers(tv)!.peers);
  });

  it("a player cookie joins only as its own seat; a trusted caller names one", () => {
    const { relay } = setup();
    const a = sock("a");
    relay.join(a, { prefs: PREFS, playerId: "p2" }, remote("p1"));
    expect(lastPeers(a)!.peers[0].playerId).toBe("p1");
    const host = sock("host");
    relay.join(host, { prefs: PREFS, playerId: "p3" }, { role: "player", access: { level: "host", anySeat: true }, inRoom: false });
    expect(lastPeers(host)!.peers.map((p) => p.playerId)).toEqual(["p1", "p3"]);
  });

  it("refuses in-room pages, host pages, unknown seats and seatless callers", () => {
    const { relay } = setup();
    const lan = sock("lan");
    relay.join(lan, { prefs: PREFS }, { ...remote("p1"), inRoom: true });
    expect(lastPeers(lan)).toMatchObject({ self: null, peers: [], refused: expect.stringMatching(/room/) });
    const host = sock("host");
    relay.join(host, { prefs: PREFS }, { role: "host", access: { level: "host", anySeat: true }, inRoom: false });
    expect(lastPeers(host)!.self).toBeNull();
    const ghost = sock("ghost");
    relay.join(ghost, { prefs: PREFS }, remote("nobody"));
    expect(lastPeers(ghost)!.self).toBeNull();
    const seatless = sock("seatless");
    relay.join(seatless, { prefs: PREFS }, { role: "player", access: { level: "player", anySeat: false }, inRoom: false });
    expect(lastPeers(seatless)!.self).toBeNull();
    // A player cookie can't join as the room even if it says table.
    const fake = sock("fake");
    relay.join(fake, { prefs: PREFS }, { role: "table", access: { level: "player", anySeat: false, playerId: "p1" } as Access, inRoom: false });
    expect(lastPeers(fake)!.peers.some((p) => p.room)).toBe(false);
    expect(relay.members().some((m) => m.room)).toBe(false);
  });

  it("relays a signal only between two members, from the sender's own peer id", () => {
    const { relay } = setup();
    const tv = sock("tv");
    const sam = sock("sam");
    const outsider = sock("out");
    relay.join(tv, { prefs: PREFS }, TABLE);
    relay.join(sam, { prefs: PREFS }, remote("p1"));
    const samId = lastPeers(sam)!.self!;
    const roomId = lastPeers(tv)!.self!;
    relay.signal(tv, { to: samId, signal: offer });
    expect(rtcs(sam)).toEqual([{ type: "rtc", from: roomId, signal: offer }]);
    relay.signal(sam, { to: roomId, signal: { candidate: null } });
    expect(rtcs(tv)).toEqual([{ type: "rtc", from: samId, signal: { candidate: null } }]);
    // Not a member, unknown target, to itself, malformed: dropped.
    relay.signal(outsider, { to: roomId, signal: offer });
    relay.signal(sam, { to: "nobody", signal: offer });
    relay.signal(sam, { to: samId, signal: offer });
    relay.signal(sam, { to: roomId, signal: { description: { type: "offer", sdp: 42 } } as never });
    relay.signal(sam, { to: roomId, signal: { description: { type: "offer", sdp: "x".repeat(40_000) } } });
    expect(rtcs(tv)).toHaveLength(1);
    expect(rtcs(sam)).toHaveLength(1);
  });

  it("rate-limits each link's signals", () => {
    const { relay, tick } = setup();
    const tv = sock("tv");
    const sam = sock("sam");
    relay.join(tv, { prefs: PREFS }, TABLE);
    relay.join(sam, { prefs: PREFS }, remote("p1"));
    for (let i = 0; i < RTC_RATE_MAX + 5; i++) relay.signal(tv, { to: lastPeers(sam)!.self!, signal: { candidate: null } });
    expect(rtcs(sam)).toHaveLength(RTC_RATE_MAX);
    tick(RTC_RATE_WINDOW_MS);
    relay.signal(tv, { to: lastPeers(sam)!.self!, signal: { candidate: null } });
    expect(rtcs(sam)).toHaveLength(RTC_RATE_MAX + 1);
  });

  // A full call: the room is the impolite side to every remote player and starts all links at once,
  // each with an SDP and ~25 ICE candidates (audio + video transports, host/srflx/relay). The budget
  // is per link, so the room's relay candidates (gathered last) still get through.
  it("the signal budget is per link: a full call's ICE burst gets through", () => {
    const { relay } = setup();
    const tv = sock("tv");
    relay.join(tv, { prefs: PREFS }, TABLE);
    const players = ["p1", "p2", "p3", "p4", "p5"].map((id) => {
      const s = sock(id);
      relay.join(s, { prefs: PREFS }, remote(id));
      return s;
    });
    for (const p of players) {
      const to = lastPeers(p)!.self!;
      relay.signal(tv, { to, signal: offer });
      for (let i = 0; i < 25; i++) relay.signal(tv, { to, signal: { candidate: { candidate: `candidate:${i} 1 udp 1 10.0.0.1 ${5000 + i} typ relay` } } });
      relay.signal(tv, { to, signal: { candidate: null } });
    }
    for (const p of players) expect(rtcs(p)).toHaveLength(27);
  });

  // Prefs toggles re-send rtc_join, and each one fans a peers list out to every page (the TV too).
  it("rate-limits joins per socket and skips the fan-out when nothing changed", () => {
    const { relay, tick } = setup();
    const tv = sock("tv");
    const others = ["p2", "p3", "p4", "p5"].map((id) => sock(id));
    const sam = sock("sam");
    relay.join(tv, { prefs: PREFS }, TABLE);
    others.forEach((s, i) => relay.join(s, { prefs: PREFS }, remote(["p2", "p3", "p4", "p5"][i])));
    relay.join(sam, { prefs: PREFS }, remote("p1"));
    const before = tv.got.length;
    relay.join(sam, { prefs: PREFS }, remote("p1"));
    relay.join(tv, { prefs: PREFS }, TABLE);
    expect(tv.got.length).toBe(before);
    for (let i = 0; i < 10_000; i++) relay.join(sam, { prefs: { ...PREFS, camera: i % 2 === 0 } }, remote("p1"));
    expect(tv.got.length - before).toBeLessThanOrEqual(RTC_JOIN_MAX);
    tick(RTC_RATE_WINDOW_MS);
    relay.join(sam, { prefs: { ...PREFS, micOn: false } }, remote("p1"));
    expect(lastPeers(tv)!.peers.find((p) => p.playerId === "p1")).toMatchObject({ micOn: false });
  });

  it(`takes at most ${MAX_REMOTE_PEERS} remote players; the same seat again replaces its older page`, () => {
    const { relay } = setup();
    const socks = ["p1", "p2", "p3", "p4", "p5", "p6"].map((id) => {
      const s = sock(id);
      relay.join(s, { prefs: PREFS }, remote(id));
      return s;
    });
    expect(lastPeers(socks[5])).toMatchObject({ self: null, refused: expect.stringMatching(/full/) });
    expect(relay.members()).toHaveLength(MAX_REMOTE_PEERS);
    const again = sock("p1b");
    relay.join(again, { prefs: PREFS }, remote("p1"));
    expect(lastPeers(socks[0])).toMatchObject({ self: null, refused: expect.stringMatching(/another/) });
    expect(relay.members().filter((m) => m.playerId === "p1")).toHaveLength(1);
    expect(lastPeers(again)!.peers.find((p) => p.peerId === lastPeers(again)!.self)?.playerId).toBe("p1");
    // The replaced page's signals no longer count.
    relay.signal(socks[0], { to: lastPeers(again)!.self!, signal: offer });
    expect(rtcs(again)).toHaveLength(0);
  });

  it("re-joining updates the prefs; leaving tells the others", () => {
    const { relay } = setup();
    const tv = sock("tv");
    const sam = sock("sam");
    relay.join(tv, { prefs: PREFS }, TABLE);
    relay.join(sam, { prefs: PREFS }, remote("p1"));
    const id = lastPeers(sam)!.self;
    relay.join(sam, { prefs: { camera: false, showCharacter: true, micOn: false } }, remote("p1"));
    expect(lastPeers(sam)!.self).toBe(id);
    expect(lastPeers(tv)!.peers[1]).toMatchObject({ camera: false, showCharacter: true, micOn: false });
    relay.leave(sam);
    expect(lastPeers(tv)!.peers.map((p) => p.room)).toEqual([true]);
    expect(lastPeers(sam)!.self).toBeNull();
  });

  it("one table is the room: the one carrying the voice call, else the first to join", () => {
    const { relay } = setup();
    const tv1 = sock("tv1");
    const tv2 = sock("tv2");
    const sam = sock("sam");
    relay.join(tv1, { prefs: PREFS }, TABLE);
    relay.join(tv2, { prefs: PREFS }, TABLE);
    relay.join(sam, { prefs: PREFS }, remote("p1"));
    const first = lastPeers(tv1)!.self;
    expect(first).toMatch(/^r/);
    expect(lastPeers(tv2)).toMatchObject({ self: null, refused: expect.stringMatching(/table/) });
    relay.setRoomOwner(tv2);
    const second = lastPeers(tv2)!.self;
    // A new peer id, so remote pages build a new connection to the other screen.
    expect(second).toMatch(/^r/);
    expect(second).not.toBe(first);
    expect(lastPeers(tv1)!.self).toBeNull();
    expect(lastPeers(sam)!.peers.filter((p) => p.room).map((p) => p.peerId)).toEqual([second]);
    relay.leave(tv2);
    expect(lastPeers(tv1)!.self).toMatch(/^r/);
    expect(lastPeers(tv1)!.self).not.toBe(first);
    // The last table leaving: remote pages hear the room is gone.
    relay.leave(tv1);
    expect(lastPeers(sam)!.peers.some((p) => p.room)).toBe(false);
  });

  it("a member whose seat is gone (seat removed, campaign switched) leaves the call when seats are rechecked", () => {
    const seats = ["p1", "p2"];
    const { relay } = setup(seats);
    const tv = sock("tv");
    const sam = sock("sam");
    const alex = sock("alex");
    relay.join(tv, { prefs: PREFS }, TABLE);
    relay.join(sam, { prefs: PREFS }, remote("p1"));
    relay.join(alex, { prefs: PREFS }, remote("p2"));
    const before = tv.got.length;
    relay.recheckSeats();
    expect(tv.got.length).toBe(before); // nothing changed: no fan-out
    seats.splice(seats.indexOf("p2"), 1);
    relay.recheckSeats();
    expect(lastPeers(tv)!.peers.map((p) => p.playerId ?? "room")).toEqual(["room", "p1"]);
    expect(lastPeers(alex)).toMatchObject({ self: null, peers: [] });
  });

  it("every refusal carries a machine-readable code next to its text", () => {
    const seats = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"];
    const { relay } = setup(seats);
    const code = (s: Sock) => lastPeers(s)?.refusedCode;
    const host = sock("host");
    relay.join(host, { prefs: PREFS }, { role: "host", access: { level: "host", anySeat: true }, inRoom: false });
    expect(code(host)).toBe("not_member");
    const lan = sock("lan");
    relay.join(lan, { prefs: PREFS }, { ...remote("p1"), inRoom: true });
    expect(code(lan)).toBe("in_room");
    const ghost = sock("ghost");
    relay.join(ghost, { prefs: PREFS }, remote("nobody"));
    expect(code(ghost)).toBe("no_seat");
    const socks = ["p1", "p2", "p3", "p4", "p5", "p6"].map((id) => {
      const s = sock(id);
      relay.join(s, { prefs: PREFS }, remote(id));
      return s;
    });
    expect(code(socks[5])).toBe("full");
    const again = sock("p1b");
    relay.join(again, { prefs: PREFS }, remote("p1"));
    expect(lastPeers(socks[0])).toMatchObject({ refused: expect.stringMatching(/another page/), refusedCode: "displaced" });
    const tv1 = sock("tv1");
    const tv2 = sock("tv2");
    relay.join(tv1, { prefs: PREFS }, TABLE);
    relay.join(tv2, { prefs: PREFS }, TABLE);
    expect(lastPeers(tv2)).toMatchObject({ refused: expect.stringMatching(/table/), refusedCode: "other_table" });
    seats.splice(seats.indexOf("p2"), 1);
    relay.recheckSeats();
    expect(code(socks[1])).toBe("no_seat");
    // Members' lists carry no code.
    expect(lastPeers(tv1)!.refusedCode).toBeUndefined();
  });

  it("tells a waiting table once, not on every prefs join or voice-owner change", () => {
    const { relay } = setup();
    const tv1 = sock("tv1");
    const tv2 = sock("tv2");
    const refusals = (s: Sock) => s.got.filter((e) => e.type === "peers" && e.refused).length;
    relay.join(tv1, { prefs: PREFS }, TABLE);
    relay.join(tv2, { prefs: PREFS }, TABLE);
    expect(refusals(tv2)).toBe(1);
    relay.join(tv1, { prefs: { ...PREFS, camera: false } }, TABLE);
    relay.join(tv2, { prefs: { ...PREFS, micOn: false } }, TABLE);
    relay.setRoomOwner(tv1);
    relay.setRoomOwner(undefined);
    relay.setRoomOwner(sock("elsewhere"));
    expect(refusals(tv2)).toBe(1);
    // A waiting table's own prefs change no one's view: no fan-out to the room either.
    const before = tv1.got.length;
    relay.join(tv2, { prefs: { ...PREFS, showCharacter: true } }, TABLE);
    expect(tv1.got.length).toBe(before);
    // tv2 becomes the room, then waits again: told again (its status changed).
    relay.setRoomOwner(tv2);
    expect(lastPeers(tv2)!.self).toMatch(/^r/);
    expect(refusals(tv1)).toBe(1);
    relay.setRoomOwner(tv1);
    expect(refusals(tv2)).toBe(2);
    // Leaving and joining again starts over.
    relay.leave(tv2);
    relay.join(tv2, { prefs: PREFS }, TABLE);
    expect(refusals(tv2)).toBe(3);
  });

  it("a throttled join resyncs the page with the call as it stands, changing nothing", () => {
    const { relay } = setup();
    const tv = sock("tv");
    const sam = sock("sam");
    relay.join(tv, { prefs: PREFS }, TABLE);
    relay.join(sam, { prefs: PREFS }, remote("p1"));
    const samId = lastPeers(sam)!.self;
    for (let i = 1; i < RTC_JOIN_MAX; i++) relay.join(sam, { prefs: { ...PREFS, camera: i % 2 === 0 } }, remote("p1"));
    const shown = relay.members().find((m) => m.playerId === "p1")!;
    const tvBefore = tv.got.length;
    const samBefore = sam.got.length;
    relay.join(sam, { prefs: { ...PREFS, camera: !shown.camera, micOn: false } }, remote("p1"));
    expect(tv.got.length).toBe(tvBefore);
    expect(sam.got.length).toBe(samBefore + 1);
    expect(lastPeers(sam)).toEqual({ type: "peers", self: samId, peers: relay.members() });
    expect(relay.members().find((m) => m.playerId === "p1")).toEqual(shown);
    // A throttled waiting table hears it is still waiting; a throttled outsider that it is not in the call.
    const tv2 = sock("tv2");
    for (let i = 0; i <= RTC_JOIN_MAX; i++) relay.join(tv2, { prefs: { ...PREFS, camera: i % 2 === 0 } }, TABLE);
    expect(lastPeers(tv2)).toMatchObject({ self: null, peers: [], refusedCode: "other_table" });
    const out = sock("out");
    for (let i = 0; i <= RTC_JOIN_MAX; i++) relay.join(out, { prefs: PREFS }, { role: "host", access: { level: "host", anySeat: true }, inRoom: false });
    expect(out.got.length).toBe(RTC_JOIN_MAX + 1);
    expect(lastPeers(out)).toMatchObject({ self: null, peers: [] });
  });

  it("an in-room phone joins as its player's mic: linked to the room only, outside the cap", () => {
    const { relay } = setup();
    const tv = sock("tv");
    relay.join(tv, { prefs: PREFS }, TABLE);
    const roomId = lastPeers(tv)!.self!;
    const lanCtx: RtcJoinContext = { role: "player", access: { level: "table", anySeat: true }, inRoom: true };
    const phone = sock("phone");
    relay.join(phone, { prefs: PREFS, playerId: "p1", micOnly: true }, lanCtx);
    const phoneId = lastPeers(phone)!.self!;
    expect(phoneId).toMatch(/^m/);
    expect(relay.members().find((m) => m.peerId === phoneId)).toEqual({ peerId: phoneId, room: false, playerId: "p1", micOnly: true, camera: false, showCharacter: false, micOn: false });
    expect(relay.isMicOnly(phone)).toBe(true);
    // Remote players fill the cap without counting the phone mic.
    const socks = ["p2", "p3", "p4", "p5", "p6"].map((id) => {
      const s = sock(id);
      relay.join(s, { prefs: PREFS }, remote(id));
      return s;
    });
    expect(socks.every((s) => lastPeers(s)!.self)).toBe(true);
    // Signals: phone ↔ room only.
    const remoteId = lastPeers(socks[0])!.self!;
    relay.signal(phone, { to: remoteId, signal: offer });
    relay.signal(socks[0], { to: phoneId, signal: offer });
    expect(rtcs(socks[0])).toHaveLength(0);
    expect(rtcs(phone)).toHaveLength(0);
    relay.signal(phone, { to: roomId, signal: offer });
    relay.signal(tv, { to: phoneId, signal: offer });
    expect(rtcs(tv)).toHaveLength(1);
    expect(rtcs(phone)).toHaveLength(1);
  });

  it("micOnly asks nothing of a remote page, and an in-room page without it is still refused", () => {
    const { relay } = setup();
    const lan = sock("lan");
    relay.join(lan, { prefs: PREFS }, { ...remote("p1"), inRoom: true });
    expect(lastPeers(lan)!.refusedCode).toBe("in_room");
    const far = sock("far");
    relay.join(far, { prefs: PREFS, micOnly: true }, remote("p2"));
    expect(relay.isMicOnly(far)).toBe(false);
    expect(lastPeers(far)!.peers[0]).toMatchObject({ playerId: "p2", camera: true });
  });

  it("the seat's phone mic and a page for the same seat displace each other", () => {
    const { relay } = setup();
    const lanCtx: RtcJoinContext = { role: "player", access: { level: "table", anySeat: true }, inRoom: true };
    const a = sock("a");
    const b = sock("b");
    relay.join(a, { prefs: PREFS, playerId: "p1", micOnly: true }, lanCtx);
    relay.join(b, { prefs: PREFS, playerId: "p1", micOnly: true }, lanCtx);
    expect(lastPeers(a)!.refusedCode).toBe("displaced");
    expect(relay.isMicOnly(b)).toBe(true);
  });
});
