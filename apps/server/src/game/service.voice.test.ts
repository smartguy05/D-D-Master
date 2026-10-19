import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerEvent } from "@dm/shared";
import { Store } from "../db/index.js";
import { GameService, type GameServiceOptions } from "./service.js";

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

function restartedServer(store: Store, retryDelaysMs = [1000, 2000], extra: Partial<GameServiceOptions> = {}) {
  const sockets: FakeSocket[] = [];
  const game = new GameService(store, {
    ...extra,
    dmSession: {
      createSocket: (url) => {
        const ws = new FakeSocket(url);
        sockets.push(ws);
        return ws;
      },
      retryDelaysMs,
      idleWarnMs: 0,
      turnGate: false,
      log: () => undefined,
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
    const { game, sockets, events } = restartedServer(store);
    await game.init();
    // Host clicks Stop DM while the re-attach is still trying.
    game.stopDm();
    expect(store.getActiveCall()).toBeUndefined();
    sockets[0].fail();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);
    expect(game.dmState.status).toBe("offline");
    // The superseded re-attach stays silent: no "could not re-attach" error for the host.
    expect(events.some((e) => e.type === "error" && /re-attach/i.test(e.message))).toBe(false);

    store.setActiveCall({ callId: "rtc_live", campaignId: game.campaign!.id, startedAt: Date.now() });
    const other = game.createCampaign({ name: "Other" });
    expect(game.campaign?.id).toBe(other.id);
    expect(store.getActiveCall()).toBeUndefined();
  });
});

describe("GameService live sideband gives up", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] }));
  afterEach(() => vi.useRealTimers());

  it("clears the record when a live sideband drops and every reconnect fails (the call is dead)", async () => {
    const store = new Store(":memory:");
    const c = new GameService(store).createCampaign({ name: "Crypt" });
    store.setActiveCall({ callId: "rtc_live", campaignId: c.id, startedAt: Date.now() });
    const { game, sockets } = restartedServer(store, [1000]);
    await game.init();
    sockets[0].open();
    await vi.advanceTimersByTimeAsync(0);
    expect(game.dmState.status).toBe("listening");
    sockets[0].fail();
    await vi.advanceTimersByTimeAsync(1000);
    sockets[1].fail();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(game.dmState.status).toBe("offline");
    expect(store.getActiveCall()).toBeUndefined();
    // The dead session is dropped, so whisper says "not running" instead of trying it.
    expect(() => game.whisper("x")).toThrow(/not running/);
  });

  it("giving up also drops queued NPC clips (they never play over a dead call)", async () => {
    const store = new Store(":memory:");
    const c = new GameService(store).createCampaign({ name: "Crypt" });
    store.setActiveCall({ callId: "rtc_live", campaignId: c.id, startedAt: Date.now() });
    const { game, sockets, events } = restartedServer(store, [1000]);
    await game.init();
    sockets[0].open();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].emit("message", JSON.stringify({ type: "output_audio_buffer.started" }));
    void game.npcClips.enqueue({ npcName: "Bram", line: "Halt!", url: "/media/x/npc_1.mp3", durationMs: 1000 });
    sockets[0].fail();
    await vi.advanceTimersByTimeAsync(1000);
    sockets[1].fail();
    await vi.advanceTimersByTimeAsync(0);
    expect(game.npcClips.size).toBe(0);
    expect(events.some((e) => e.type === "npc_speech")).toBe(false);
  });

  it("ignores statuses from a session that is no longer current", async () => {
    const store = new Store(":memory:");
    const c = new GameService(store).createCampaign({ name: "Crypt" });
    store.setActiveCall({ callId: "rtc_live", campaignId: c.id, startedAt: Date.now() });
    const { game } = restartedServer(store);
    await game.init();
    const staleHost = (game as any).dm.host;
    game.stopDm();
    staleHost.onStatus("listening", "voice");
    expect(game.dmState).toEqual({ status: "offline", mode: "none" });
  });

  it("a call replaced before its 250 ms attach delay never opens a sideband", async () => {
    const store = new Store(":memory:");
    let n = 0;
    const { game, sockets, events } = restartedServer(store, [1000], {
      createVoiceCall: async () => ({ answerSdp: "answer", callId: `rtc_${++n}` }),
    });
    game.createCampaign({ name: "Crypt" });
    await game.startVoice("offer-1");
    await vi.advanceTimersByTimeAsync(100);
    await game.startVoice("offer-2", true);
    await vi.advanceTimersByTimeAsync(500);
    expect(sockets.map((w) => w.url)).toEqual([expect.stringContaining("call_id=rtc_2")]);
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(store.getActiveCall()?.callId).toBe("rtc_2");
  });

  it("a Reconnect during the connect window doesn't clear the new call's record or raise an error", async () => {
    const store = new Store(":memory:");
    let n = 0;
    const { game, sockets, events } = restartedServer(store, [1000], {
      createVoiceCall: async () => ({ answerSdp: "answer", callId: `rtc_${++n}` }),
    });
    game.createCampaign({ name: "Crypt" });
    await game.startVoice("offer-1");
    await vi.advanceTimersByTimeAsync(250); // first sideband connect starts
    expect(sockets).toHaveLength(1);
    await game.startVoice("offer-2", true); // host Reconnect: replaces the first session
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getActiveCall()?.callId).toBe("rtc_2");
    expect(events.some((e) => e.type === "error")).toBe(false);
    await vi.advanceTimersByTimeAsync(250);
    sockets[1].open();
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets[1].url).toContain("call_id=rtc_2");
    expect(game.dmState.status).toBe("listening");
    expect(store.getActiveCall()?.callId).toBe("rtc_2");
  });
});

describe("GameService.identifySpeaker side effects wait for accept()", () => {
  function twoPlayers() {
    const game = new GameService(new Store(":memory:"));
    const events: ServerEvent[] = [];
    game.hub.broadcast = (ev) => void events.push(ev);
    game.createCampaign({ name: "Crypt" });
    const sam = game.addPlayer("Sam");
    const kim = game.addPlayer("Kim");
    const thorin = game.addCharacter({ name: "Thorin", maxHp: 12 }, sam.id);
    game.addCharacter({ name: "Lia", maxHp: 9 }, kim.id);
    return { game, events, sam, thorin };
  }

  it("a low-confidence match only keeps its sample for confirm_speaker once accepted", () => {
    const { game, sam } = twoPlayers();
    const embedding = new Float32Array([0.1, 0.2]);
    game.speaker.identify = () => ({ match: { playerId: sam.id, score: 0.3, confident: false }, embedding }) as any;
    const turn = game.identifySpeaker(0, 1000);
    expect(turn.label).toBe("Sam as Thorin?");
    expect((game as any).lastUnconfirmed).toBeUndefined();
    turn.accept?.();
    expect((game as any).lastUnconfirmed).toBe(embedding);
  });

  it("a skipped turn neither announces the speaker nor clears a pending low-confidence sample", () => {
    const { game, events, sam } = twoPlayers();
    const pending = new Float32Array([9]);
    (game as any).lastUnconfirmed = pending;
    game.speaker.identify = () => ({ match: { playerId: sam.id, score: 0.9, confident: true }, embedding: new Float32Array([1]) }) as any;
    events.length = 0;
    game.identifySpeaker(0, 1000); // never accepted (noise)
    expect(events.some((e) => e.type === "speaker")).toBe(false);
    expect((game as any).lastUnconfirmed).toBe(pending);
    const turn = game.identifySpeaker(0, 1000);
    turn.accept?.();
    expect(events.some((e) => e.type === "speaker")).toBe(true);
    expect((game as any).lastUnconfirmed).toBeUndefined();
  });

  it("the host's speaker tap survives a skipped turn and is consumed by the answered one", () => {
    const { game, sam } = twoPlayers();
    game.setManualSpeaker(sam.id);
    const noise = game.identifySpeaker(0, 1000);
    expect(noise.note).toContain("selected by host");
    const real = game.identifySpeaker(0, 1000);
    expect(real.note).toContain("selected by host");
    real.accept?.();
    expect(game.identifySpeaker(0, 1000).note).not.toContain("selected by host");
  });
});

describe("GameService NPC clip queue", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] }));
  afterEach(() => vi.useRealTimers());

  async function withNpcVoice() {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { NpcVoice } = await import("../realtime/npc-voice.js");
    const game = new GameService(new Store(":memory:"));
    const events: ServerEvent[] = [];
    game.hub.broadcast = (ev) => void events.push(ev);
    game.createCampaign({ name: "Crypt" });
    const client = { audio: { speech: { create: async () => ({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }) } } };
    (game as any).npcVoice = new NpcVoice(client, { model: "m", dmVoice: "cedar", dataDir: mkdtempSync(join(tmpdir(), "npcq-")), urlPrefix: "/media" });
    const setStatus = (status: string) => (game as any).dmHost().onStatus(status, "voice");
    const speeches = () => events.filter((e) => e.type === "npc_speech") as Extract<ServerEvent, { type: "npc_speech" }>[];
    return { game, events, setStatus, speeches };
  }

  it("holds speak_as_npc until the DM's audio stops, then the table's clip-ended report frees the queue", async () => {
    const { game, setStatus, speeches } = await withNpcVoice();
    setStatus("speaking");
    const out = (await game.runTool("speak_as_npc", { npc_name: "Bram", line: "Who goes there?" }, "dm")) as { ok: boolean };
    expect(out.ok).toBe(true);
    expect(speeches()).toHaveLength(0);
    // The line is logged right away (transcript order), only the audio waits.
    expect(game.state?.log.at(-1)).toMatchObject({ speaker: "Bram", text: "Who goes there?" });
    setStatus("listening");
    expect(speeches()).toHaveLength(1);
    const url = speeches()[0].url;
    expect(game.npcClipEnded(url)).toEqual({ ok: true });
    expect(game.npcClipEnded(url)).toEqual({ ok: false });
  });

  it("stopDm drops queued clips", async () => {
    const { game, setStatus, speeches } = await withNpcVoice();
    setStatus("speaking");
    await game.runTool("speak_as_npc", { npc_name: "Bram", line: "Halt!" }, "dm");
    game.stopDm();
    setStatus("listening");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(speeches()).toHaveLength(0);
  });
});

describe("GameService speak_as_npc holds the DM", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] }));
  afterEach(() => vi.useRealTimers());

  it("the DM's follow-up response.create waits until /table reports the clip ended", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { NpcVoice } = await import("../realtime/npc-voice.js");
    const store = new Store(":memory:");
    const c = new GameService(store).createCampaign({ name: "Crypt" });
    store.setActiveCall({ callId: "rtc_live", campaignId: c.id, startedAt: Date.now() });
    const { game, sockets, events } = restartedServer(store);
    const client = { audio: { speech: { create: async () => ({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }) } } };
    (game as any).npcVoice = new NpcVoice(client, { model: "m", dmVoice: "cedar", dataDir: mkdtempSync(join(tmpdir(), "npch-")), urlPrefix: "/media" });
    await game.init();
    sockets[0].open();
    await vi.advanceTimersByTimeAsync(0);
    const ws = sockets[0];
    ws.sent.length = 0;
    ws.emit(
      "message",
      JSON.stringify({
        type: "response.done",
        response: { status: "completed", output: [{ type: "function_call", call_id: "c1", name: "speak_as_npc", arguments: JSON.stringify({ npc_name: "Bram", line: "Who goes there?" }) }] },
      }),
    );
    // Real file I/O inside synthesize: let it settle.
    await vi.waitFor(() => expect(ws.sent.some((e) => e.type === "conversation.item.create" && e.item?.type === "function_call_output")).toBe(true));
    const speech = events.find((e) => e.type === "npc_speech") as Extract<ServerEvent, { type: "npc_speech" }>;
    expect(speech).toBeDefined();
    await vi.advanceTimersByTimeAsync(500);
    expect(ws.sent.filter((e) => e.type === "response.create")).toHaveLength(0);
    expect(game.npcClipEnded(speech.url)).toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(ws.sent.filter((e) => e.type === "response.create")).toHaveLength(1);
  });
});

describe("live who's talking", () => {
  afterEach(() => vi.useRealTimers());

  function talking() {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const game = new GameService(new Store(":memory:"));
    game.createCampaign({ name: "Test", partyLevel: 1 });
    const sam = game.addPlayer("Sam");
    const alex = game.addPlayer("Alex");
    game.addCharacter({ name: "Thorin", maxHp: 10 }, sam.id);
    game.addCharacter({ name: "Lyra", maxHp: 8 }, alex.id);
    const events: ServerEvent[] = [];
    vi.spyOn(game.hub, "broadcast").mockImplementation((ev) => void events.push(ev));
    Object.defineProperty(game.speaker, "available", { get: () => true });
    const spy = vi.spyOn(game.speaker, "identify");
    const chunk = Buffer.alloc(3200, 0x10);
    return { game, events, spy, sam, alex, chunk };
  }

  it("shows a confident voice match while the player is still talking, without announcing the speaker", () => {
    const { game, events, spy, sam, chunk } = talking();
    spy.mockImplementation(() => ({ match: { playerId: sam.id, score: 0.8, margin: 0.3, confident: true } }));
    game.liveTalk.speechStarted();
    vi.setSystemTime(11_500);
    game.pushAudio(chunk);
    expect(spy).toHaveBeenCalledOnce();
    expect(events.at(-1)).toMatchObject({ type: "talk", talk: { active: true, playerId: sam.id, provisional: true } });
    expect(events.some((e) => e.type === "speaker")).toBe(false);
    expect(game.state!.activeSpeaker).toBeUndefined();
  });

  it("an unsure match shows no one", () => {
    const { game, events, spy, alex, chunk } = talking();
    spy.mockImplementation(() => ({ match: { playerId: alex.id, score: 0.4, margin: 0.01, confident: false } }));
    game.liveTalk.speechStarted();
    vi.setSystemTime(11_500);
    game.pushAudio(chunk);
    expect(events.some((e) => e.type === "talk" && !!e.talk.playerId)).toBe(false);
  });
});

describe("GameService table mic mute", () => {
  afterEach(() => vi.useRealTimers());

  function muted() {
    const { game, sockets, events } = restartedServer(new Store(":memory:"), [1000], {
      createVoiceCall: async () => ({ answerSdp: "answer", callId: "rtc_1" }),
    });
    game.createCampaign({ name: "Test", partyLevel: 1 });
    const sam = game.addPlayer("Sam");
    return { game, sockets, events, sam };
  }

  it("broadcasts, logs who muted it, and is in the snapshot for a reloaded page", () => {
    const { game, events, sam } = muted();
    game.setMicMuted(true, sam.id);
    expect(events.filter((e) => e.type === "mic")).toEqual([{ type: "mic", muted: true, by: "Sam" }]);
    expect(game.state!.log.at(-1)?.text).toBe("Sam muted the table mic.");
    expect((game.hub as any).snapshot()).toContainEqual({ type: "mic", muted: true });
    // Same value again: nothing new.
    game.setMicMuted(true);
    expect(events.filter((e) => e.type === "mic")).toHaveLength(1);
    game.setMicMuted(false);
    expect(game.isMicMuted).toBe(false);
    expect(game.state!.log.at(-1)?.text).toBe("The table unmuted the table mic.");
  });

  it("ignores mic audio and refuses voice enrollment while muted", () => {
    const { game } = muted();
    const ring = vi.spyOn(game.speaker.ring, "pushPcm16");
    Object.defineProperty(game.speaker, "available", { get: () => true });
    game.setMicMuted(true);
    game.pushAudio(Buffer.alloc(3200));
    expect(ring).not.toHaveBeenCalled();
    expect(() => game.startEnrollment("p1")).toThrow(/Unmute the table mic/);
    game.setMicMuted(false);
    game.pushAudio(Buffer.alloc(3200));
    expect(ring).toHaveBeenCalledOnce();
  });

  it("muting clears the live who's-talking display", () => {
    const { game, events } = muted();
    game.liveTalk.speechStarted();
    game.setMicMuted(true);
    expect(events.filter((e) => e.type === "talk").at(-1)).toMatchObject({ talk: { active: false } });
  });

  it("a DM started while muted drops voice turns; unmuting tells it without a reply", async () => {
    vi.useFakeTimers();
    const { game, sockets } = muted();
    game.setMicMuted(true);
    await game.startVoice("offer");
    await vi.advanceTimersByTimeAsync(300);
    sockets[0].open();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].sent.length = 0;
    sockets[0].emit("message", JSON.stringify({ type: "input_audio_buffer.committed", item_id: "it_1" }));
    expect(sockets[0].sent).toEqual([{ type: "conversation.item.delete", item_id: "it_1" }]);
    game.setMicMuted(false);
    expect(sockets[0].sent.map((e) => e.type)).toEqual(["conversation.item.delete", "conversation.item.create"]);
  });
});
