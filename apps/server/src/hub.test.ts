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
});
