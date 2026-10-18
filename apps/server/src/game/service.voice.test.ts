import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerEvent } from "@dm/shared";
import { Store } from "../db/index.js";
import { GameService } from "./service.js";

class FakeSocket extends EventEmitter {
  readyState = 0;
  sent: Record<string, any>[] = [];
  constructor(readonly url: string) {
    super();
  }
  send(msg: string) {
    this.sent.push(JSON.parse(msg));
  }
  close() {
    this.readyState = 3;
    this.emit("close");
  }
  open() {
    this.readyState = 1;
    this.emit("open");
  }
  fail(message = "404 call not found") {
    this.emit("error", new Error(message));
    this.readyState = 3;
    this.emit("close");
  }
}

function restartedServer(store: Store) {
  const sockets: FakeSocket[] = [];
  const game = new GameService(store, {
    dmSession: {
      createSocket: (url) => {
        const ws = new FakeSocket(url);
        sockets.push(ws);
        return ws;
      },
      retryDelaysMs: [1000, 2000],
      idleWarnMs: 0,
      warn: () => undefined,
    },
  });
  const events: ServerEvent[] = [];
  const broadcast = game.hub.broadcast.bind(game.hub);
  game.hub.broadcast = (ev) => {
    events.push(ev);
    broadcast(ev);
  };
  const statuses = () => events.filter((e) => e.type === "dm_status").map((e) => (e as { status: string }).status);
  return { game, sockets, events, statuses };
}

const tick = () => vi.advanceTimersByTimeAsync(0);

describe("Store active voice call", () => {
  it("saves, reads and clears the active call record", () => {
    const store = new Store(":memory:");
    expect(store.getActiveCall()).toBeUndefined();
    store.setActiveCall({ callId: "rtc_1", campaignId: "cmp_1", startedAt: 123 });
    expect(store.getActiveCall()).toEqual({ callId: "rtc_1", campaignId: "cmp_1", startedAt: 123 });
    store.setActiveCall({ callId: "rtc_2", campaignId: "cmp_1", startedAt: 456 });
    expect(store.getActiveCall()?.callId).toBe("rtc_2");
    store.clearActiveCall();
    expect(store.getActiveCall()).toBeUndefined();
  });
});

describe("GameService voice call re-attach after a restart", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] }));
  afterEach(() => vi.useRealTimers());

  function campaignWithCall(startedAt = Date.now()) {
    const store = new Store(":memory:");
    const first = new GameService(store);
    const c = first.createCampaign({ name: "Crypt" });
    first.addCharacter({ name: "Thorin", maxHp: 12 });
    store.setActiveCall({ callId: "rtc_live", campaignId: c.id, startedAt });
    return { store, campaignId: c.id };
  }

  it("re-opens the sideband to the saved call_id, refreshes instructions and adds a restart note", async () => {
    const { store, campaignId } = campaignWithCall();
    const { game, sockets, statuses } = restartedServer(store);
    await game.init();
    expect(game.campaign?.id).toBe(campaignId);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toContain("call_id=rtc_live");
    expect(statuses().at(-1)).toBe("connecting");
    sockets[0].open();
    await tick();
    expect(game.dmState).toEqual({ status: "listening", mode: "voice" });
    const types = sockets[0].sent.map((e) => e.type);
    expect(types).toEqual(["session.update", "conversation.item.create"]);
    expect(sockets[0].sent[0].session.instructions).toContain("Thorin");
    expect(sockets[0].sent[1].item.content[0].text).toMatch(/server restarted/i);
    // No greeting, no response: the DM waits for the players.
    expect(types).not.toContain("response.create");
    // The record stays so a second restart can re-attach again.
    expect(store.getActiveCall()?.callId).toBe("rtc_live");
    expect(game.state?.log.at(-1)?.text).toMatch(/re-attached/i);
  });

  it("retries with backoff, then clears the record and stays offline if the call is gone", async () => {
    const { store } = campaignWithCall();
    const { game, sockets, statuses, events } = restartedServer(store);
    await game.init();
    sockets[0].fail();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets).toHaveLength(2);
    sockets[1].fail();
    await vi.advanceTimersByTimeAsync(2000);
    sockets[2].fail();
    await tick();
    expect(statuses().at(-1)).toBe("offline");
    expect(game.dmState).toEqual({ status: "offline", mode: "none" });
    expect(store.getActiveCall()).toBeUndefined();
    expect(events.some((e) => e.type === "error" && /re-attach/i.test(e.message))).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(3);
  });

  it("ignores (and clears) a record for another campaign or an expired call", async () => {
    const a = campaignWithCall();
    a.store.setActiveCall({ callId: "rtc_x", campaignId: "cmp_other", startedAt: Date.now() });
    const r1 = restartedServer(a.store);
    await r1.game.init();
    expect(r1.sockets).toHaveLength(0);
    expect(a.store.getActiveCall()).toBeUndefined();

    const b = campaignWithCall(Date.now() - 2 * 60 * 60_000);
    const r2 = restartedServer(b.store);
    await r2.game.init();
    expect(r2.sockets).toHaveLength(0);
    expect(b.store.getActiveCall()).toBeUndefined();
    expect(r2.game.dmState.status).toBe("offline");
  });

  it("stopDm and loading another campaign clear the record; a host Reconnect supersedes a re-attach", async () => {
    const { store } = campaignWithCall();
    const { game, sockets } = restartedServer(store);
    await game.init();
    // Host clicks Stop DM while the re-attach is still trying.
    game.stopDm();
    expect(store.getActiveCall()).toBeUndefined();
    sockets[0].fail();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);
    expect(game.dmState.status).toBe("offline");

    store.setActiveCall({ callId: "rtc_live", campaignId: game.campaign!.id, startedAt: Date.now() });
    const other = game.createCampaign({ name: "Other" });
    expect(game.campaign?.id).toBe(other.id);
    expect(store.getActiveCall()).toBeUndefined();
  });
});
