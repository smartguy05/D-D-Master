import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DmSession, dmToolDefs, type DmHost } from "./session.js";

function setup(mode: "voice" | "text" = "voice") {
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
  const s = new DmSession(host, mode, "rtc_123");
  // Inject a fake open socket (readyState 1 = OPEN).
  (s as any).ws = { readyState: 1, send: (msg: string) => sent.push(JSON.parse(msg)), close: () => undefined };
  const emit = (ev: Record<string, unknown>) => (s as any).onEvent(ev);
  return { s, sent, host, emit };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("DmSession", () => {
  it("injects the speaker note before asking for a response", () => {
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

function resilient(mode: "voice" | "text", opts: { retryDelaysMs?: number[]; idleWarnMs?: number } = {}) {
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
