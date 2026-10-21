import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerEvent } from "@dm/shared";
import { config } from "../config.js";
import { Store } from "../db/index.js";
import type { HubSocket } from "../hub.js";
import { GameService } from "./service.js";

class FakeWs extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  sent: ServerEvent[] = [];
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
  commands() {
    return this.sent.filter((e) => e.type === "voice_command").map((e) => (e as { action: string }).action);
  }
  owner() {
    return this.sent.filter((e) => e.type === "voice_owner").at(-1) as Extract<ServerEvent, { type: "voice_owner" }> | undefined;
  }
}

function table() {
  const game = new GameService(new Store(":memory:"));
  game.createCampaign({ name: "Crypt" });
  const connect = (role: "host" | "table") => {
    const ws = new FakeWs();
    game.hub.add(ws as FakeWs & HubSocket);
    ws.say({ type: "hello", role });
    return ws;
  };
  return { game, connect };
}

describe("GameService: /table carries the voice call", () => {
  const key = config.openaiKey;
  afterEach(() => void ((config as { openaiKey: string }).openaiKey = key));

  it("Start voice needs an open table screen and goes only to it", () => {
    (config as { openaiKey: string }).openaiKey = "sk-test";
    const { game, connect } = table();
    const host = connect("host");
    expect(() => game.requestVoice("start")).toThrow(/Open the table screen/);
    const tv = connect("table");
    game.requestVoice("start");
    expect(tv.commands()).toEqual(["start"]);
    expect(host.commands()).toEqual([]);
  });

  it("the table that carries the call keeps it; a newer table tab gets no commands", () => {
    const { game, connect } = table();
    const host = connect("host");
    const first = connect("table");
    first.say({ type: "voice_link", state: "connected" });
    const second = connect("table");
    // The second tab's idle report doesn't take the call away.
    second.say({ type: "voice_link", state: "idle" });
    game.requestVoice("reconnect");
    expect(first.commands()).toEqual(["reconnect"]);
    expect(second.commands()).toEqual([]);
    expect(host.owner()?.owner).toEqual({ table: true, link: "connected", micStream: false });
  });

  it("/host sees the call's state and loses it when the table closes", () => {
    const { connect } = table();
    const host = connect("host");
    const tv = connect("table");
    tv.say({ type: "voice_link", state: "failed", error: "Mic blocked" });
    expect(host.owner()?.owner).toEqual({ table: true, link: "failed", error: "Mic blocked", micStream: false });
    tv.close();
    expect(host.owner()?.owner).toEqual({ table: false, link: "idle", micStream: false });
  });

  it("a host's voice_link report is ignored", () => {
    const { connect } = table();
    const host = connect("host");
    host.say({ type: "voice_link", state: "connected" });
    expect(host.owner()?.owner.link ?? "idle").toBe("idle");
  });

  it("Stop DM hangs up the table's call; a replacing call (startVoice) does not", () => {
    const { game, connect } = table();
    const tv = connect("table");
    tv.say({ type: "voice_link", state: "connected" });
    game.stopDm({ keepCall: true });
    expect(tv.commands()).toEqual([]);
    game.stopDm();
    expect(tv.commands()).toEqual(["stop"]);
  });

  it("voice ID hears one mic: the table's in play, the host's while enrolling", () => {
    const { game } = table();
    const push = vi.spyOn(game.speaker.ring, "pushPcm16");
    const chunk = Buffer.alloc(320);
    game.audioSocket("host", 1);
    game.pushAudio(chunk, "host");
    expect(push).toHaveBeenCalledTimes(1); // no table stream: the host's is used
    game.audioSocket("table", 1);
    game.pushAudio(chunk, "host");
    game.pushAudio(chunk, "table");
    expect(push).toHaveBeenCalledTimes(2);
    vi.spyOn(game.speaker, "enrolling", "get").mockReturnValue(true);
    game.pushAudio(chunk, "table");
    game.pushAudio(chunk, "host");
    expect(push).toHaveBeenCalledTimes(3);
    game.audioSocket("host", -1);
    game.pushAudio(chunk, "table");
    expect(push).toHaveBeenCalledTimes(4);
  });
});
