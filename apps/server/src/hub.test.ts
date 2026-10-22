import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { GameState, Monster, type ServerEvent } from "@dm/shared";
import { Hub, HUB_MESSAGE_MAX_CHARS, type HubSocket } from "./hub.js";

class FakeWs extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  sent: unknown[] = [];
  send(msg: string) {
    this.sent.push(JSON.parse(msg));
  }
  say(ev: unknown) {
    this.emit("message", Buffer.from(JSON.stringify(ev)));
  }
  close() {
    this.readyState = 3;
    this.emit("close");
  }
}

const sock = () => new FakeWs() as FakeWs & HubSocket;

describe("Hub", () => {
  it("records roles from hello, passes client events on, and lists open sockets by role", () => {
    const hub = new Hub();
    const seen = vi.fn();
    hub.onClientEvent(seen);
    const host = sock();
    const t1 = sock();
    const t2 = sock();
    hub.add(host);
    hub.add(t1);
    hub.add(t2);
    host.say({ type: "hello", role: "host" });
    t1.say({ type: "hello", role: "table" });
    t2.say({ type: "hello", role: "table" });
    expect(hub.roleOf(host)).toBe("host");
    expect(hub.withRole("table")).toEqual([t1, t2]);
    t1.say({ type: "voice_link", state: "connected" });
    expect(seen).toHaveBeenLastCalledWith({ type: "voice_link", state: "connected" }, t1);
    // Garbage is ignored.
    t1.emit("message", Buffer.from("not json"));
    expect(seen).toHaveBeenCalledTimes(4);
  });

  it("send reaches one socket; close drops it and tells listeners its role", () => {
    const hub = new Hub();
    const closed = vi.fn();
    hub.onClose(closed);
    const a = sock();
    const b = sock();
    hub.add(a);
    hub.add(b);
    a.say({ type: "hello", role: "table" });
    hub.send(a, { type: "voice_command", action: "start" });
    expect(a.sent).toEqual([{ type: "voice_command", action: "start" }]);
    expect(b.sent).toEqual([]);
    a.close();
    expect(closed).toHaveBeenCalledWith(a, "table");
    expect(hub.withRole("table")).toEqual([]);
    hub.send(a, { type: "voice_command", action: "stop" });
    expect(a.sent).toHaveLength(1);
  });

  it("clamps the hello role to the socket's access (a player can't claim host or table)", () => {
    const hub = new Hub();
    const seen = vi.fn();
    hub.onClientEvent(seen);
    const p = sock();
    const lan = sock();
    hub.add(p, { level: "player", anySeat: false, playerId: "pl_1", sid: "s1" });
    hub.add(lan, { level: "table", anySeat: true });
    p.say({ type: "hello", role: "host" });
    lan.say({ type: "hello", role: "host" });
    expect(hub.roleOf(p)).toBe("player");
    expect(hub.roleOf(lan)).toBe("table");
    // Listeners see the clamped hello too, and a player's seat is its bound one.
    expect(seen).toHaveBeenCalledWith({ type: "hello", role: "player", playerId: "pl_1" }, p);
    p.say({ type: "hello", role: "player", playerId: "pl_2" });
    expect(seen).toHaveBeenLastCalledWith({ type: "hello", role: "player", playerId: "pl_1" }, p);
    expect(hub.withRole("host")).toEqual([]);
  });

  it("accessOf tells listeners what a socket may do (push-to-talk seat checks); nothing once closed", () => {
    const hub = new Hub();
    const p = sock();
    const access = { level: "player" as const, anySeat: false, playerId: "pl_1", sid: "s1" };
    hub.add(p, access);
    expect(hub.accessOf(p)).toEqual(access);
    p.close();
    expect(hub.accessOf(p)).toBeUndefined();
  });

  it("inRoom comes from the upgrade's origin, not the access level; without one a player cookie is remote", () => {
    const hub = new Hub();
    const player = { level: "player" as const, anySeat: false, playerId: "pl_1", sid: "s1" };
    const [lan, local, remote, unknown, table] = [sock(), sock(), sock(), sock(), sock()];
    hub.add(lan, player, "lan");
    hub.add(local, player, "local");
    hub.add(remote, player, "remote");
    hub.add(unknown, player);
    hub.add(table, { level: "table", anySeat: true });
    expect([lan, local, remote, unknown, table].map((ws) => hub.inRoom(ws))).toEqual([true, true, false, false, true]);
    lan.close();
    expect(hub.inRoom(lan)).toBe(false);
  });

  it("a socket added without access is a host socket (in-process callers and tests)", () => {
    const hub = new Hub();
    const h = sock();
    hub.add(h);
    h.say({ type: "hello", role: "host" });
    expect(hub.roleOf(h)).toBe("host");
    expect(hub.withRole("host")).toEqual([h]);
  });

  it("closeWhere closes matching sockets (kick, code rotation) and lists player sockets", () => {
    const hub = new Hub();
    const a = sock();
    const b = sock();
    const t = sock();
    hub.add(a, { level: "player", anySeat: false, playerId: "pl_1", sid: "s1" });
    hub.add(b, { level: "player", anySeat: false, playerId: "pl_2", sid: "s2" });
    hub.add(t, { level: "table", anySeat: true });
    expect(hub.connectedPlayers()).toEqual({ pl_1: 1, pl_2: 1 });
    expect(hub.closeWhere((acc) => acc.playerId === "pl_1")).toBe(1);
    expect(a.readyState).toBe(3);
    expect(hub.connectedPlayers()).toEqual({ pl_2: 1 });
    expect(hub.closeWhere((acc) => acc.level === "player")).toBe(1);
    expect(t.readyState).toBe(1);
  });

  // A kicked client that never answers the close frame stays CLOSING for up to 30 s (ws closeTimeout):
  // its seat must leave the call and its messages must stop at once, not when the socket finally closes.
  it("closeWhere tells close listeners at once (once) and drops the socket's later messages", () => {
    const hub = new Hub();
    const closed = vi.fn();
    const seen = vi.fn();
    hub.onClose(closed);
    hub.onClientEvent(seen);
    const a = sock();
    a.close = () => void (a.readyState = 2); // CLOSING: no 'close' event yet
    hub.add(a, { level: "player", anySeat: false, playerId: "pl_1", sid: "s1" });
    a.say({ type: "hello", role: "player" });
    seen.mockClear();
    expect(hub.closeWhere((acc) => acc.playerId === "pl_1")).toBe(1);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledWith(a, "player");
    a.say({ type: "rtc", to: "r1", signal: { candidate: null } });
    a.say({ type: "rtc_join", prefs: {} });
    expect(seen).not.toHaveBeenCalled();
    a.emit("close");
    expect(closed).toHaveBeenCalledTimes(1);
  });

  // routes/auth.ts lets a new sign-in take over a seat nobody has used for a while.
  it("seatLastSeen: now while a player socket is open, else when its last one closed", () => {
    let t = 100;
    const hub = new Hub(() => t);
    expect(hub.seatLastSeen("pl_1")).toBeUndefined();
    const a = sock();
    hub.add(a, { level: "player", anySeat: false, playerId: "pl_1", sid: "s1" });
    t = 500;
    expect(hub.seatLastSeen("pl_1")).toBe(500);
    a.close();
    t = 900;
    expect(hub.seatLastSeen("pl_1")).toBe(500);
    const lan = sock();
    hub.add(lan, { level: "table", anySeat: true });
    lan.close();
    expect(hub.seatLastSeen("pl_1")).toBe(500);
  });

  describe("viewer tiers (server-side filtering, docs/server/state-projection.md)", () => {
    const st = () =>
      GameState.parse({
        campaignId: "c",
        locationId: "crypt",
        monsters: [Monster.parse({ id: "m_vis", name: "Goblin", maxHp: 7, hp: 7, ac: 15 }), Monster.parse({ id: "m_hid", name: "Assassin", maxHp: 30, hp: 30, hidden: true })],
      });
    const types = (ws: FakeWs) => (ws.sent as ServerEvent[]).map((e) => e.type);
    const monsters = (ws: FakeWs) => (ws.sent as ServerEvent[]).filter((e) => e.type === "state").map((e) => (e as { state: GameState }).state.monsters.map((m) => m.id));
    const player = { level: "player" as const, anySeat: false, playerId: "pl_1", sid: "s1" };
    const lan = { level: "table" as const, anySeat: true };

    function setup() {
      const hub = new Hub();
      hub.setSnapshot(() => [{ type: "dm_status", status: "listening", mode: "voice" }, { type: "state", state: st() }]);
      return hub;
    }

    it("a player socket and a host socket get different state payloads", () => {
      const hub = setup();
      const host = sock();
      const phone = sock();
      hub.add(host);
      hub.add(phone, player);
      host.say({ type: "hello", role: "host" });
      phone.say({ type: "hello", role: "player" });
      hub.broadcast({ type: "state", state: st() });
      expect(monsters(host).at(-1)).toEqual(["m_vis", "m_hid"]);
      expect(monsters(phone).at(-1)).toEqual(["m_vis"]);
      expect(JSON.stringify(phone.sent)).not.toContain("Assassin");
    });

    it("snapshot: a player cookie gets the public one at once; host/table sockets get theirs after the hello", () => {
      const hub = setup();
      const phone = sock();
      hub.add(phone, player);
      expect(types(phone)).toEqual(["dm_status", "state"]);
      expect(monsters(phone)).toEqual([["m_vis"]]);
      phone.say({ type: "hello", role: "player" });
      expect(types(phone)).toHaveLength(2);

      const tv = sock();
      hub.add(tv, lan);
      expect(tv.sent).toEqual([]);
      tv.say({ type: "hello", role: "table" });
      expect(types(tv)).toEqual(["dm_status", "state"]);
      expect(monsters(tv)).toEqual([["m_vis", "m_hid"]]);

      // A phone on the trusted LAN (table access) runs /player: hello "player" gets the public view.
      const lanPhone = sock();
      hub.add(lanPhone, lan);
      lanPhone.say({ type: "hello", role: "player" });
      expect(monsters(lanPhone)).toEqual([["m_vis"]]);
    });

    it("the snapshot goes out before hello listeners run (the TV's voice_owner follows its state)", () => {
      const hub = setup();
      const tv = sock();
      hub.onClientEvent((ev, ws) => {
        if (ev.type === "hello") hub.broadcast({ type: "voice_owner", owner: { table: true, link: "idle", micStream: false } });
        expect(hub.roleOf(ws)).toBe("table");
      });
      hub.add(tv, lan);
      tv.say({ type: "hello", role: "table" });
      expect(types(tv)).toEqual(["dm_status", "state", "voice_owner"]);
    });

    it("before its hello a socket gets only public events; jobs and errors never reach players", () => {
      const hub = setup();
      const early = sock();
      const phone = sock();
      const host = sock();
      hub.add(early, lan);
      hub.add(phone, player);
      hub.add(host);
      host.say({ type: "hello", role: "host" });
      phone.sent.length = 0;
      host.sent.length = 0;
      hub.broadcast({ type: "state", state: st() });
      hub.broadcast({ type: "job", id: "j", label: "Painting", status: "running", startedAt: 0 });
      hub.broadcast({ type: "error", message: "boom" });
      hub.broadcast({ type: "effect", effect: { id: "e", kind: "hit", targetId: "m_hid", ts: 0 } });
      expect(monsters(early)).toEqual([["m_vis"]]);
      expect(types(phone)).toEqual(["state"]);
      expect(types(host)).toEqual(["state", "job", "error", "effect"]);
    });
  });

  it("drops an oversized client message before parsing it", () => {
    const hub = new Hub();
    const seen = vi.fn();
    hub.onClientEvent(seen);
    const a = sock();
    hub.add(a);
    a.say({ type: "rtc", to: "p1", signal: { description: { type: "offer", sdp: "x".repeat(HUB_MESSAGE_MAX_CHARS) } } });
    expect(seen).not.toHaveBeenCalled();
    a.say({ type: "rtc", to: "p1", signal: { candidate: null } });
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
