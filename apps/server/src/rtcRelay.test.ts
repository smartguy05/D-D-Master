import { describe, expect, it } from "vitest";
import { MAX_REMOTE_PEERS, type ServerEvent } from "@dm/shared";
import type { Access } from "./auth/access.js";
import { RTC_JOIN_MAX, RTC_RATE_MAX, RTC_RATE_WINDOW_MS, RtcRelay, type RtcJoinContext } from "./rtcRelay.js";

type Sock = { name: string; got: ServerEvent[] };
const sock = (name: string): Sock => ({ name, got: [] });
const PREFS = { camera: true, showCharacter: false, micOn: true };

const TABLE: RtcJoinContext = { role: "table", access: { level: "table", anySeat: true }, inRoom: true };
const remote = (playerId: string): RtcJoinContext => ({ role: "player", access: { level: "player", anySeat: false, playerId } as Access, inRoom: false });

function setup(seats = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"]) {
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
  });
});
