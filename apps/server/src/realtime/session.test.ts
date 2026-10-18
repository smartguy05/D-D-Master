import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DmSession, dmToolDefs, type DmHost, type DmSessionOptions, type SpeakerTurn } from "./session.js";

function setup(mode: "voice" | "text" = "voice", opts: DmSessionOptions = { turnGate: false }) {
  const sent: Record<string, any>[] = [];
  const host: DmHost = {
    instructions: () => "instr",
    opening: () => "open",
    runTool: vi.fn(async (name: string) => ({ ok: name })),
    identifySpeaker: vi.fn(() => ({ note: "[speaker: Sam as Thorin, confidence 0.90]", label: "Sam as Thorin" })),
    onPlayerText: vi.fn(),
    onDmText: vi.fn(),
    onStatus: vi.fn(),
    onError: vi.fn(),
  };
  const s = new DmSession(host, mode, "rtc_123", { log: () => undefined, ...opts });
  // Inject a fake open socket (readyState 1 = OPEN).
  (s as any).ws = { readyState: 1, send: (msg: string) => sent.push(JSON.parse(msg)), close: () => undefined };
  const emit = (ev: Record<string, unknown>) => (s as any).onEvent(ev);
  return { s, sent, host, emit };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("DmSession", () => {
  it("gate off: injects the speaker note before asking for a response", () => {
    const { sent, host, emit } = setup();
    emit({ type: "input_audio_buffer.speech_started" });
    emit({ type: "input_audio_buffer.speech_stopped" });
    emit({ type: "input_audio_buffer.committed", item_id: "item_1" });
    expect(host.identifySpeaker).toHaveBeenCalledOnce();
    expect(sent.map((e) => e.type)).toEqual(["conversation.item.create", "response.create"]);
    expect(sent[0].item).toMatchObject({ role: "system", content: [{ text: "[speaker: Sam as Thorin, confidence 0.90]" }] });
    emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_1", transcript: "I attack!" });
    expect(host.onPlayerText).toHaveBeenCalledWith("I attack!", "Sam as Thorin");
  });

  it("runs all function calls, returns outputs, then continues the response", async () => {
    const { sent, host, emit, s } = setup();
    s.begin();
    sent.length = 0;
    emit({
      type: "response.done",
      response: {
        status: "completed",
        output: [
          { type: "function_call", call_id: "c1", name: "roll_dice", arguments: '{"notation":"1d20","label":"x"}' },
          { type: "function_call", call_id: "c2", name: "apply_damage", arguments: '{"target_id":"a","amount":3}' },
        ],
      },
    });
    await flush();
    expect(host.runTool).toHaveBeenCalledWith("roll_dice", { notation: "1d20", label: "x" });
    expect(sent.map((e) => e.type)).toEqual(["conversation.item.create", "conversation.item.create", "response.create"]);
    expect(sent[0].item).toMatchObject({ type: "function_call_output", call_id: "c1", output: '{"ok":"roll_dice"}' });
  });

  it("reports tool errors to the model instead of throwing", async () => {
    const { sent, host, emit, s } = setup();
    (host.runTool as any).mockRejectedValueOnce(new Error("No such goblin"));
    s.begin();
    sent.length = 0;
    emit({ type: "response.done", response: { status: "completed", output: [{ type: "function_call", call_id: "c1", name: "apply_damage", arguments: "{}" }] } });
    await flush();
    expect(JSON.parse(sent[0].item.output)).toEqual({ error: "No such goblin" });
  });

  it("queues a response request while one is active", () => {
    const { sent, emit, s } = setup("text");
    s.begin(); // response active
    s.sendPlayerText("hello", "[speaker: Sam]");
    expect(sent.filter((e) => e.type === "response.create")).toHaveLength(1);
    emit({ type: "response.done", response: { status: "completed", output: [{ type: "message" }] } });
    expect(sent.filter((e) => e.type === "response.create")).toHaveLength(2);
  });

  it("logs DM speech from audio transcripts and text output", () => {
    const { host, emit } = setup();
    emit({ type: "response.output_audio_transcript.done", transcript: "Roll for initiative!" });
    emit({ type: "response.output_text.done", text: "The door creaks." });
    expect(host.onDmText).toHaveBeenNthCalledWith(1, "Roll for initiative!");
    expect(host.onDmText).toHaveBeenNthCalledWith(2, "The door creaks.");
  });
});

// ---------- reconnect / resilience ----------

class FakeSocket extends EventEmitter {
  readyState = 0; // CONNECTING
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
  /** Server-side drop. */
  drop() {
    this.readyState = 3;
    this.emit("close");
  }
  fail(message = "ECONNREFUSED") {
    this.emit("error", new Error(message));
    this.readyState = 3;
    this.emit("close");
  }
}

function resilient(mode: "voice" | "text", opts: { retryDelaysMs?: number[]; idleWarnMs?: number; retryFirstConnect?: boolean } = {}) {
  const sockets: FakeSocket[] = [];
  const warn = vi.fn();
  const host: DmHost = {
    instructions: () => "instr",
    opening: () => "open",
    runTool: vi.fn(async () => ({})),
    identifySpeaker: vi.fn(() => ({ note: "[speaker: unknown]" })),
    onPlayerText: vi.fn(),
    onDmText: vi.fn(),
    onStatus: vi.fn(),
    onError: vi.fn(),
    recentContext: () => "Sam as Thorin: I kick the door.\nDM: It splinters.",
  };
  const s = new DmSession(host, mode, "rtc_abc", {
    createSocket: (url) => {
      const ws = new FakeSocket(url);
      sockets.push(ws);
      return ws;
    },
    retryDelaysMs: opts.retryDelaysMs ?? [1000, 2000, 4000],
    idleWarnMs: opts.idleWarnMs ?? 0,
    retryFirstConnect: opts.retryFirstConnect,
    warn,
  });
  const statuses = () => (host.onStatus as any).mock.calls.map((c: unknown[]) => c[0]);
  return { s, host, sockets, warn, statuses };
}

describe("DmSession reconnect", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("voice: reconnects to the same call_id with backoff after an unexpected drop", async () => {
    const { s, sockets, statuses, host } = resilient("voice");
    const p = s.connect();
    sockets[0].open();
    await p;
    expect(sockets[0].url).toContain("call_id=rtc_abc");
    expect(s.isOpen).toBe(true);

    sockets[0].drop();
    expect(statuses().at(-1)).toBe("connecting");
    expect(s.isReconnecting).toBe(true);
    expect(host.onError).toHaveBeenCalledWith(expect.stringContaining("reconnecting"));
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    // First retry fails; the next waits 2 s.
    sockets[1].fail();
    vi.advanceTimersByTime(1999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
    expect(sockets[2].url).toContain("call_id=rtc_abc");
    sockets[2].open();
    expect(statuses().at(-1)).toBe("listening");
    expect(s.isOpen).toBe(true);
    // Voice keeps the server-side conversation: no session.update or recap note.
    expect(sockets[2].sent).toEqual([]);
  });

  it("gives up after the last attempt with a clear error and offline status", async () => {
    const { s, sockets, statuses, host } = resilient("voice", { retryDelaysMs: [1000, 2000] });
    const p = s.connect();
    sockets[0].open();
    await p;
    sockets[0].drop();
    vi.advanceTimersByTime(1000);
    sockets[1].fail();
    vi.advanceTimersByTime(2000);
    sockets[2].fail();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(3);
    expect(host.onError).toHaveBeenLastCalledWith(expect.stringContaining("gave up after 2 reconnect attempts"));
    expect(statuses().at(-1)).toBe("offline");
    expect(s.isOpen).toBe(false);
    expect(s.isReconnecting).toBe(false);
  });

  it("players talking never cut the DM off mid-narration", async () => {
    const { s, sockets, statuses } = resilient("text");
    const p = s.connect();
    sockets[0].open();
    await p;
    const td = sockets[0].sent[0].session.audio.input.turn_detection;
    expect(td).toMatchObject({ create_response: false, interrupt_response: false });
    // Speech during playback keeps the "speaking" status; it is answered after the DM finishes.
    sockets[0].emit("message", JSON.stringify({ type: "output_audio_buffer.started" }));
    sockets[0].emit("message", JSON.stringify({ type: "input_audio_buffer.speech_started" }));
    expect(statuses().at(-1)).toBe("speaking");
    sockets[0].emit("message", JSON.stringify({ type: "output_audio_buffer.stopped" }));
    expect(statuses().at(-1)).toBe("listening");
  });

  it("stopTalking (voice): cancels the response, clears playing audio and drops the queued reply", async () => {
    const { s, sockets, statuses } = resilient("voice");
    const p = s.connect();
    sockets[0].open();
    await p;
    s.begin();
    const msg = (ev: object) => sockets[0].emit("message", JSON.stringify(ev));
    msg({ type: "response.created" });
    msg({ type: "output_audio_buffer.started" });
    s.prompt("a player spoke"); // queued behind the active response
    sockets[0].sent.length = 0;

    expect(s.stopTalking()).toBe(true);
    const types = sockets[0].sent.map((e) => e.type);
    expect(types).toEqual(["response.cancel", "output_audio_buffer.clear", "conversation.item.create"]);
    expect(sockets[0].sent[2].item.content[0].text).toMatch(/stopped you/i);

    msg({ type: "output_audio_buffer.cleared" });
    msg({ type: "response.done", response: { status: "cancelled", output: [] } });
    expect(sockets[0].sent.filter((e) => e.type === "response.create")).toHaveLength(0);
    expect(statuses().at(-1)).toBe("listening");
    // Nothing to stop now; the next turn works normally.
    expect(s.stopTalking()).toBe(false);
    s.prompt("next");
    expect(sockets[0].sent.filter((e) => e.type === "response.create")).toHaveLength(1);
  });

  it("stopTalking (text): cancels without touching the audio buffer", async () => {
    const { s, sockets } = resilient("text");
    const p = s.connect();
    sockets[0].open();
    await p;
    s.begin();
    sockets[0].sent.length = 0;
    expect(s.stopTalking()).toBe(true);
    expect(sockets[0].sent.map((e) => e.type)).toEqual(["response.cancel", "conversation.item.create"]);
  });

  it("text: re-sends session.update and a recap note after reconnecting", async () => {
    const { s, sockets } = resilient("text");
    const p = s.connect();
    sockets[0].open();
    await p;
    expect(sockets[0].url).toContain("model=");
    expect(sockets[0].sent.map((e) => e.type)).toEqual(["session.update"]);
    s.begin(); // a response is in flight when the socket drops
    sockets[0].drop();
    vi.advanceTimersByTime(1000);
    sockets[1].open();
    expect(sockets[1].sent.map((e) => e.type)).toEqual(["session.update", "conversation.item.create"]);
    expect(sockets[1].sent[0].session.output_modalities).toEqual(["text"]);
    expect(sockets[1].sent[1].item.content[0].text).toContain("I kick the door.");
    // The lost in-flight response doesn't block new ones.
    s.prompt("Host note");
    expect(sockets[1].sent.filter((e) => e.type === "response.create")).toHaveLength(1);
  });

  it("does not reconnect after close(), and cancels a pending retry", async () => {
    const { s, sockets, statuses } = resilient("voice");
    const p = s.connect();
    sockets[0].open();
    await p;
    sockets[0].drop();
    const before = statuses().length;
    s.close();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    expect(statuses().length).toBe(before);
  });

  it("close() does not emit a stale offline status or error (stopDm already reported it)", async () => {
    const { s, sockets, statuses, host } = resilient("voice");
    const p = s.connect();
    sockets[0].open();
    await p;
    const n = statuses().length;
    s.close();
    expect(statuses().length).toBe(n);
    expect(host.onError).not.toHaveBeenCalled();
  });

  it("rejects the first connect if it never opens (no retry loop)", async () => {
    const { s, sockets, statuses } = resilient("voice");
    const p = s.connect();
    sockets[0].fail("401 Unauthorized");
    await expect(p).rejects.toThrow("401");
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    expect(statuses().at(-1)).toBe("offline");
  });

  it("retryFirstConnect (re-attach after a restart): retries the first connect with backoff", async () => {
    const { s, sockets, statuses, host } = resilient("voice", { retryDelaysMs: [1000, 2000], retryFirstConnect: true });
    const p = s.connect();
    let settled = false;
    p.then(() => (settled = true)).catch(() => (settled = true));
    sockets[0].fail("502 Bad Gateway");
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(statuses().at(-1)).toBe("connecting");
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);
    expect(sockets[1].url).toContain("call_id=rtc_abc");
    sockets[1].open();
    await p;
    expect(s.isOpen).toBe(true);
    expect(statuses().at(-1)).toBe("listening");
    // Failed attempts are warnings, not table-facing errors.
    expect(host.onError).not.toHaveBeenCalled();
  });

  it("retryFirstConnect: rejects and reports offline once every attempt failed", async () => {
    const { s, sockets, statuses } = resilient("voice", { retryDelaysMs: [1000, 2000], retryFirstConnect: true });
    const p = s.connect();
    const caught = p.catch((e: Error) => e);
    sockets[0].fail("404 call not found");
    vi.advanceTimersByTime(1000);
    sockets[1].fail("404 call not found");
    vi.advanceTimersByTime(2000);
    sockets[2].fail("404 call not found");
    const err = await caught;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("404");
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(3);
    expect(statuses().at(-1)).toBe("offline");
    expect(s.isOpen).toBe(false);
    expect(s.isReconnecting).toBe(false);
  });

  it("retryFirstConnect: close() during the retry wait stops it without a stale offline", async () => {
    const { s, sockets, statuses } = resilient("voice", { retryDelaysMs: [1000], retryFirstConnect: true });
    const p = s.connect();
    const caught = p.catch((e: Error) => e);
    sockets[0].fail();
    const n = statuses().length;
    s.close();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    expect(statuses().length).toBe(n);
    expect(await caught).toBeInstanceOf(Error);
  });

  it("warns once when the sideband is idle for too long while live", async () => {
    const { s, sockets, warn } = resilient("voice", { idleWarnMs: 60_000 });
    const p = s.connect();
    sockets[0].open();
    await p;
    vi.advanceTimersByTime(45_000);
    sockets[0].emit("message", Buffer.from(JSON.stringify({ type: "response.created" })));
    vi.advanceTimersByTime(45_000);
    expect(warn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("idle");
    vi.advanceTimersByTime(300_000);
    expect(warn).toHaveBeenCalledTimes(1);
    s.close();
  });
});

// ---------- noise-turn gate ----------

describe("DmSession turn gate", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function gated(identify: Partial<SpeakerTurn> = {}) {
    const accept = vi.fn();
    const log = vi.fn();
    const t = setup("voice", { turnGate: true, turnGateTimeoutMs: 1200, log });
    (t.host.identifySpeaker as any).mockImplementation(() => ({
      note: "[speaker: Sam as Thorin, confidence 0.90]",
      label: "Sam as Thorin",
      matched: true,
      accept,
      ...identify,
    }));
    const turn = (item: string) => {
      t.emit({ type: "input_audio_buffer.speech_started", audio_start_ms: 1000 });
      t.emit({ type: "input_audio_buffer.speech_stopped", audio_end_ms: 1900 });
      t.emit({ type: "input_audio_buffer.committed", item_id: item });
    };
    const transcript = (item: string, text: string) => t.emit({ type: "conversation.item.input_audio_transcription.completed", item_id: item, transcript: text });
    const responses = () => t.sent.filter((e) => e.type === "response.create").length;
    const statuses = () => (t.host.onStatus as any).mock.calls.map((c: unknown[]) => c[0]);
    return { ...t, accept, log, turn, transcript, responses, statuses };
  }

  it("holds the response until the transcript arrives, then answers a real turn", () => {
    const g = gated();
    g.turn("item_1");
    expect(g.sent.map((e) => e.type)).toEqual(["conversation.item.create"]);
    expect(g.sent[0].item).toMatchObject({ role: "system", content: [{ text: "[speaker: Sam as Thorin, confidence 0.90]" }] });
    expect(g.sent[0].item.id).toEqual(expect.any(String));
    expect(g.accept).not.toHaveBeenCalled();
    g.transcript("item_1", "I attack!");
    expect(g.host.onPlayerText).toHaveBeenCalledWith("I attack!", "Sam as Thorin");
    expect(g.accept).toHaveBeenCalledOnce();
    expect(g.responses()).toBe(1);
    // The timeout no longer fires a second response.
    vi.advanceTimersByTime(5000);
    expect(g.responses()).toBe(1);
  });

  it("skips a noise turn: deletes the audio item and its speaker note, no reply, back to listening", () => {
    const g = gated();
    g.turn("item_1");
    const noteId = g.sent[0].item.id;
    g.transcript("item_1", "*cough* uh");
    const deletes = g.sent.filter((e) => e.type === "conversation.item.delete").map((e) => e.item_id);
    expect(deletes).toEqual(["item_1", noteId]);
    expect(g.responses()).toBe(0);
    expect(g.host.onPlayerText).not.toHaveBeenCalled();
    // Speaker-ID side effects (announce, low-confidence sample for confirm_speaker) are not applied.
    expect(g.accept).not.toHaveBeenCalled();
    expect(g.statuses().at(-1)).toBe("listening");
    vi.advanceTimersByTime(5000);
    expect(g.responses()).toBe(0);
  });

  it("skips an empty transcript", () => {
    const g = gated();
    g.turn("item_1");
    g.transcript("item_1", "  ");
    expect(g.sent.filter((e) => e.type === "conversation.item.delete")).toHaveLength(2);
    expect(g.responses()).toBe(0);
  });

  it("skips very short audio with no voice match", () => {
    const g = gated({ matched: false });
    g.emit({ type: "input_audio_buffer.speech_started", audio_start_ms: 1000 });
    g.emit({ type: "input_audio_buffer.speech_stopped", audio_end_ms: 1200 });
    g.emit({ type: "input_audio_buffer.committed", item_id: "item_1" });
    g.transcript("item_1", "No.");
    expect(g.responses()).toBe(0);
    expect(g.sent.some((e) => e.type === "conversation.item.delete")).toBe(true);
  });

  it("answers when transcription fails (a turn is never lost)", () => {
    const g = gated();
    g.turn("item_1");
    g.emit({ type: "conversation.item.input_audio_transcription.failed", item_id: "item_1", content_index: 0, error: { message: "boom" } });
    expect(g.responses()).toBe(1);
    expect(g.accept).toHaveBeenCalledOnce();
    expect(g.host.onPlayerText).not.toHaveBeenCalled();
  });

  it("answers after the timeout when the transcript stalls; a late transcript is still logged once", () => {
    const g = gated();
    g.turn("item_1");
    vi.advanceTimersByTime(1199);
    expect(g.responses()).toBe(0);
    vi.advanceTimersByTime(1);
    expect(g.responses()).toBe(1);
    expect(g.accept).toHaveBeenCalledOnce();
    g.transcript("item_1", "I open the door.");
    expect(g.host.onPlayerText).toHaveBeenCalledWith("I open the door.", "Sam as Thorin");
    expect(g.responses()).toBe(1);
    expect(g.sent.some((e) => e.type === "conversation.item.delete")).toBe(false);
  });

  it("tracks back-to-back turns by item id", () => {
    const g = gated();
    g.turn("item_a");
    const noteA = g.sent[0].item.id;
    g.turn("item_b");
    const noteB = g.sent[1].item.id;
    expect(noteA).not.toBe(noteB);
    g.transcript("item_b", "I cast shield");
    expect(g.responses()).toBe(1);
    g.transcript("item_a", "hmm");
    expect(g.sent.filter((e) => e.type === "conversation.item.delete").map((e) => e.item_id)).toEqual(["item_a", noteA]);
    expect(g.responses()).toBe(1);
    expect(g.host.onPlayerText).toHaveBeenCalledTimes(1);
    // Status stays "thinking" while a response is in flight.
    expect(g.statuses().at(-1)).toBe("thinking");
  });

  it("logs greppable turn timing: transcript latency, gate decision and audio start", () => {
    const g = gated();
    g.turn("item_1");
    vi.advanceTimersByTime(640);
    g.transcript("item_1", "I attack!");
    vi.advanceTimersByTime(800);
    g.emit({ type: "output_audio_buffer.started" });
    const lines = g.log.mock.calls.map((c) => String(c[0]));
    expect(lines.every((l) => l.startsWith("[turn-timing]"))).toBe(true);
    expect(lines[0]).toMatch(/item=item_1 .*speech=900ms .*transcript=640ms .*gate=respond/);
    expect(lines[1]).toMatch(/item=item_1 .*audio_start=1440ms/);
    // Logged once per turn.
    g.emit({ type: "output_audio_buffer.stopped" });
    g.emit({ type: "output_audio_buffer.started" });
    expect(g.log).toHaveBeenCalledTimes(2);
  });

  it("gate off still logs the timing and answers on commit", () => {
    const log = vi.fn();
    const t = setup("voice", { turnGate: false, log });
    t.emit({ type: "input_audio_buffer.committed", item_id: "item_1" });
    expect(t.sent.filter((e) => e.type === "response.create")).toHaveLength(1);
    t.emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_1", transcript: "uh" });
    expect(log.mock.calls[0][0]).toMatch(/^\[turn-timing\] item=item_1 .*gate=off/);
    expect(t.sent.some((e) => e.type === "conversation.item.delete")).toBe(false);
  });

  it("typed text is not gated", () => {
    const g = gated();
    g.s.sendPlayerText("hello", "[speaker: Sam (typed)]");
    expect(g.responses()).toBe(1);
  });

  it("close() cancels pending gate timers", () => {
    const g = gated();
    g.turn("item_1");
    g.s.close();
    vi.advanceTimersByTime(5000);
    expect(g.responses()).toBe(0);
  });
});

describe("DmSession.holdResponses", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("defers the tool follow-up response until the hold (an NPC clip) is released", async () => {
    const { s, sent, emit, host } = setup();
    let release!: () => void;
    (host.runTool as any).mockImplementation(async () => {
      s.holdResponses(new Promise<void>((r) => (release = r)));
      return { ok: true, playing: "queued" };
    });
    s.begin();
    sent.length = 0;
    emit({ type: "response.done", response: { status: "completed", output: [{ type: "function_call", call_id: "c1", name: "speak_as_npc", arguments: "{}" }] } });
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.map((e) => e.type)).toEqual(["conversation.item.create"]);
    // A player turn meanwhile is queued too, not answered over the clip.
    s.prompt("player spoke");
    expect(sent.filter((e) => e.type === "response.create")).toHaveLength(0);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.filter((e) => e.type === "response.create")).toHaveLength(1);
  });

  it("releases by itself after maxMs", async () => {
    const { s, sent } = setup();
    s.holdResponses(new Promise(() => undefined), 5000);
    s.prompt("x");
    await vi.advanceTimersByTimeAsync(4999);
    expect(sent.filter((e) => e.type === "response.create")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent.filter((e) => e.type === "response.create")).toHaveLength(1);
  });

  it("waits for every hold, and sends nothing when nothing was requested", async () => {
    const { s, sent } = setup();
    let r1!: () => void;
    let r2!: () => void;
    s.holdResponses(new Promise<void>((r) => (r1 = r)));
    s.holdResponses(new Promise<void>((r) => (r2 = r)));
    r1();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(0);
    s.prompt("x");
    r2();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.filter((e) => e.type === "response.create")).toHaveLength(1);
    // No hold left: the next request goes straight out.
    s.holdResponses(Promise.resolve());
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.filter((e) => e.type === "response.create")).toHaveLength(1);
  });
});

describe("DmSession.resume", () => {
  it("continues with a recap note instead of the opening greeting", () => {
    const { s, sent, host } = setup();
    host.recentContext = () => "DM: The goblin snarls.";
    s.resume();
    expect(sent.map((e) => e.type)).toEqual(["conversation.item.create", "response.create"]);
    expect(sent[0].item.content[0].text).toContain("The goblin snarls.");
    expect(sent[0].item.content[0].text).not.toContain("open");
  });
});

describe("dmToolDefs", () => {
  it("only offers speak_as_npc when NPC TTS is enabled", () => {
    expect(dmToolDefs(false).some((t) => t.name === "speak_as_npc")).toBe(false);
    expect(dmToolDefs(true).some((t) => t.name === "speak_as_npc")).toBe(true);
  });
});
