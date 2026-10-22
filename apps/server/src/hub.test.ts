import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { Hub, type HubSocket } from "./hub.js";

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
});
