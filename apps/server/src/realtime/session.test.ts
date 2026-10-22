import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DmSession, dmToolDefs, OUTBOX_MAX, type DmHost, type DmSessionOptions, type SpeakerTurn } from "./session.js";

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

  it("logs refused or failed tool calls with the entity they act on", async () => {
    const log = vi.fn();
    const { host, emit } = setup("voice", { turnGate: false, log });
    vi.mocked(host.runTool).mockImplementation(async (name: string) => (name === "move_token" ? { error: "a wall is in the way" } : { ok: true }));
    emit({ type: "response.created" });
    emit({
      type: "response.done",
      response: {
        status: "completed",
        output: [
          { type: "function_call", call_id: "c1", name: "move_token", arguments: JSON.stringify({ entity_id: "pc_1", x: 3, y: 4 }) },
          { type: "function_call", call_id: "c2", name: "get_party_status", arguments: "{}" },
        ],
      },
    });
    await flush();
    expect(log.mock.calls.map((c) => String(c[0]))).toEqual(["[tool] move_token(pc_1) -> a wall is in the way"]);
  });

  it("tells the host when someone starts and stops talking (live who's-talking)", () => {
    const { host, emit } = setup();
    host.onUserSpeech = vi.fn();
    emit({ type: "input_audio_buffer.speech_started" });
    expect(host.onUserSpeech).toHaveBeenLastCalledWith(true);
    emit({ type: "input_audio_buffer.speech_stopped" });
    expect(host.onUserSpeech).toHaveBeenLastCalledWith(false);
  });

  describe("table mic mute", () => {
    const turn = (emit: (ev: Record<string, unknown>) => void, id: string) => {
      emit({ type: "input_audio_buffer.speech_started" });
      emit({ type: "input_audio_buffer.speech_stopped" });
      emit({ type: "input_audio_buffer.committed", item_id: id });
    };

    it("drops a turn committed while muted: the audio item is deleted, no note, no reply, no log", () => {
      const { s, sent, host, emit } = setup();
      host.onUserSpeech = vi.fn();
      s.setMicMuted(true);
      turn(emit, "item_m");
      expect(sent).toEqual([{ type: "conversation.item.delete", item_id: "item_m" }]);
      expect(host.identifySpeaker).not.toHaveBeenCalled();
      expect(host.onUserSpeech).not.toHaveBeenCalledWith(true);
      emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_m", transcript: "let's rob him" });
      expect(host.onPlayerText).not.toHaveBeenCalled();
    });

    it("drops it with the turn gate on too", () => {
      const { s, sent, emit } = setup("voice", { turnGate: true, turnGateTimeoutMs: 10 });
      s.setMicMuted(true);
      turn(emit, "item_m");
      expect(sent.map((e) => e.type)).toEqual(["conversation.item.delete"]);
    });

    it("a turn committed before the mute is still answered (and its reply plays out)", () => {
      const { s, sent, emit } = setup("voice", { turnGate: true, turnGateTimeoutMs: 10_000 });
      turn(emit, "item_1");
      s.setMicMuted(true);
      emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_1", transcript: "I open the door" });
      expect(sent.map((e) => e.type)).toEqual(["conversation.item.create", "response.create"]);
      s.close();
    });

    it("unmute adds a note but asks for no response (the DM waits for the next player)", () => {
      const { s, sent } = setup();
      s.setMicMuted(true);
      s.setMicMuted(true);
      expect(sent).toEqual([]);
      s.setMicMuted(false);
      expect(sent.map((e) => e.type)).toEqual(["conversation.item.create"]);
      expect(sent[0].item.content[0].text).toMatch(/mic was muted/);
      s.setMicMuted(false);
      expect(sent).toHaveLength(1);
    });

    it("after unmuting, turns are answered again", () => {
      const { s, sent, emit } = setup();
      s.setMicMuted(true);
      s.setMicMuted(false);
      sent.length = 0;
      turn(emit, "item_2");
      expect(sent.map((e) => e.type)).toEqual(["conversation.item.create", "response.create"]);
    });
  });

  it("streams the DM's audio transcript to the host (NPC captions)", () => {
    const { host, emit } = setup();
    host.onDmCaption = vi.fn();
    emit({ type: "response.output_audio_transcript.delta", response_id: "resp_1", item_id: "it_1", delta: "Hail, " });
    emit({ type: "response.output_audio_transcript.done", response_id: "resp_1", item_id: "it_1", transcript: "Hail, friends." });
    expect(host.onDmCaption).toHaveBeenNthCalledWith(1, "it_1", "Hail, ", false);
    expect(host.onDmCaption).toHaveBeenNthCalledWith(2, "it_1", "Hail, friends.", true);
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

  describe("move cap per reply", () => {
    const move = (i: number, entity = "pc_a", name = "move_token") => ({
      type: "response.done",
      response: { status: "completed", output: [{ type: "function_call", call_id: `m${i}`, name, arguments: JSON.stringify({ entity_id: entity, x: i, y: 0 }) }] },
    });
    const moveRuns = (host: DmHost) => (host.runTool as any).mock.calls.filter((c: unknown[]) => c[0] === "move_token").length;

    it("refuses a third move of the same token in one reply (no hunting loop); other tokens still move", async () => {
      const { sent, host, emit, s } = setup();
      s.begin();
      for (let i = 0; i < 5; i++) {
        emit(move(i));
        await flush();
      }
      expect(moveRuns(host)).toBe(2);
      const last = sent.filter((e) => e.item?.type === "function_call_output").at(-1)!;
      expect(JSON.parse(last.item.output).error).toMatch(/already moved twice/);
      emit(move(9, "mon_b"));
      await flush();
      expect(moveRuns(host)).toBe(3);
    });

    it("the count resets when the reply ends and after next_turn", async () => {
      const { host, emit, s } = setup();
      s.begin();
      emit(move(1));
      emit(move(2));
      await flush();
      emit({ type: "response.done", response: { status: "completed", output: [{ type: "message" }] } });
      emit(move(3));
      emit(move(4));
      await flush();
      emit(move(0, "x", "next_turn"));
      await flush();
      emit(move(5));
      await flush();
      expect(moveRuns(host)).toBe(5);
    });
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

describe("DmSession stalled combat turns", () => {
  const speechOnly = (emit: (ev: Record<string, unknown>) => void, text: string) => {
    emit({ type: "response.created" });
    emit({ type: "response.output_audio_transcript.done", transcript: text });
    emit({ type: "response.done", response: { status: "completed", output: [{ type: "message" }] } });
  };
  const creates = (sent: Record<string, any>[]) => sent.filter((e) => e.type === "response.create").length;

  it("nudges once when a speech-only reply leaves a DM-played turn open", () => {
    const { s, sent, host, emit } = setup();
    host.stalledTurn = vi.fn(() => ({ key: "1:1:m2", prompt: "[still Shrub 2's turn]" }));
    s.begin();
    sent.length = 0;
    speechOnly(emit, "Next up: Awakened Shrub 2. Let's see where it moves.");
    expect(sent.map((e) => e.type)).toEqual(["conversation.item.create", "response.create"]);
    expect(sent[0].item.content[0].text).toBe("[still Shrub 2's turn]");
    // Another speech-only reply on the same turn: no second nudge in a row (no loop).
    speechOnly(emit, "The shrub rustles.");
    expect(creates(sent)).toBe(1);
  });

  it("nudges again after the DM acted with a tool, up to the per-turn cap", async () => {
    const { s, sent, host, emit } = setup();
    host.stalledTurn = vi.fn(() => ({ key: "1:1:m2", prompt: "[nudge]" }));
    s.begin();
    sent.length = 0;
    for (let i = 0; i < 5; i++) {
      speechOnly(emit, "Hmm.");
      emit({ type: "response.done", response: { status: "completed", output: [{ type: "function_call", call_id: `c${i}`, name: "roll_dice", arguments: "{}" }] } });
      await flush();
    }
    const nudges = sent.filter((e) => e.item?.content?.[0]?.text === "[nudge]").length;
    expect(nudges).toBe(3);
  });

  it("leaves a reply ending in a question alone (the DM waits for a player's reaction)", () => {
    const { s, sent, host, emit } = setup();
    host.stalledTurn = vi.fn(() => ({ key: "1:1:m2", prompt: "[nudge]" }));
    s.begin();
    sent.length = 0;
    speechOnly(emit, "The shrub lunges at you, Sylvaine. Do you use your reaction?");
    expect(sent).toHaveLength(0);
  });

  it("does nothing on a player's turn, or when a player turn is already queued", () => {
    const { s, sent, host, emit } = setup("text");
    host.stalledTurn = vi.fn(() => undefined);
    s.begin();
    sent.length = 0;
    speechOnly(emit, "Bram, you're up.");
    expect(sent).toHaveLength(0);
    host.stalledTurn = vi.fn(() => ({ key: "k", prompt: "[nudge]" }));
    s.begin();
    s.sendPlayerText("I attack", "[speaker: Sam]"); // queued behind the active response
    sent.length = 0;
    speechOnly(emit, "And then…");
    expect(host.stalledTurn).not.toHaveBeenCalled();
    expect(creates(sent)).toBe(1);
  });
});

describe("DmSession status after a silent reply (voice)", () => {
  const toolCall = (emit: (ev: Record<string, unknown>) => void) => {
    emit({ type: "response.created" });
    emit({ type: "response.done", response: { status: "completed", output: [{ type: "function_call", call_id: "c1", name: "end_campaign", arguments: "{}" }] } });
  };
  const last = (host: DmHost) => (host.onStatus as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
  const nudges = (sent: Record<string, any>[]) => sent.filter((e) => /Finish resolving/.test(e.item?.content?.[0]?.text ?? ""));

  it("goes back to listening when the follow-up to tool outputs has no speech", async () => {
    const { s, host, emit } = setup("voice");
    s.begin();
    toolCall(emit);
    await flush();
    emit({ type: "response.created" });
    expect(last(host)).toBe("thinking");
    emit({ type: "response.done", response: { status: "completed", output: [] } });
    expect(last(host)).toBe("listening");
  });

  it("goes back to listening after a cancelled response with no audio", () => {
    const { s, host, emit } = setup("voice");
    s.begin();
    emit({ type: "response.created" });
    emit({ type: "response.done", response: { status: "cancelled", output: [] } });
    expect(last(host)).toBe("listening");
  });

  it("stays speaking until the audio stops when the reply spoke", () => {
    const { s, host, emit } = setup("voice");
    s.begin();
    emit({ type: "response.created" });
    emit({ type: "output_audio_buffer.started" });
    emit({ type: "response.output_audio_transcript.done", transcript: "And so the tale ends." });
    emit({ type: "response.done", response: { status: "completed", output: [{ type: "message" }] } });
    expect(last(host)).toBe("speaking");
    emit({ type: "output_audio_buffer.stopped" });
    expect(last(host)).toBe("listening");
  });

  it("does not nudge an empty follow-up once the campaign is over", async () => {
    const { s, sent, host, emit } = setup("voice");
    host.campaignOver = () => true;
    s.begin();
    toolCall(emit);
    await flush();
    sent.length = 0;
    emit({ type: "response.created" });
    emit({ type: "response.done", response: { status: "completed", output: [] } });
    expect(nudges(sent)).toHaveLength(0);
    expect(sent.filter((e) => e.type === "response.create")).toHaveLength(0);
  });

  it("Stop talking resets a stale thinking status when nothing is in flight", () => {
    const { s, host } = setup("voice");
    expect(s.stopTalking()).toBe(false);
    expect(last(host)).toBe("listening");
  });
});

describe("DmSession empty reply after tool outputs", () => {
  const empty = (emit: (ev: Record<string, unknown>) => void) => {
    emit({ type: "response.created" });
    emit({ type: "response.done", response: { status: "completed", output: [] } });
  };
  const toolCall = (emit: (ev: Record<string, unknown>) => void, id: string) => {
    emit({ type: "response.created" });
    emit({ type: "response.done", response: { status: "completed", output: [{ type: "function_call", call_id: id, name: "apply_damage", arguments: "{}" }] } });
  };
  const nudges = (sent: Record<string, any>[]) => sent.filter((e) => /Finish resolving/.test(e.item?.content?.[0]?.text ?? ""));

  it("prompts once to finish resolving when the follow-up to tool outputs comes back empty (a PC's turn)", async () => {
    const { s, sent, host, emit } = setup("text");
    host.stalledTurn = vi.fn(() => undefined); // a player character's turn: the monster-turn nudge has nothing
    s.begin();
    toolCall(emit, "c1");
    await flush();
    sent.length = 0;
    empty(emit);
    expect(nudges(sent)).toHaveLength(1);
    expect(nudges(sent)[0].item.role).toBe("system");
    expect(sent.at(-1)!.type).toBe("response.create");
    // The reply to the nudge is empty too: no second nudge in a row.
    sent.length = 0;
    empty(emit);
    expect(nudges(sent)).toHaveLength(0);
    expect(sent.filter((e) => e.type === "response.create")).toHaveLength(0);
  });

  it("stops nudging after MAX_EMPTY_NUDGES until the DM speaks", async () => {
    const { s, sent, emit } = setup("text");
    s.begin();
    for (const id of ["c1", "c2", "c3"]) {
      toolCall(emit, id);
      await flush();
      empty(emit);
    }
    expect(nudges(sent)).toHaveLength(2);
  });

  it("nudges again after a later tool chain stalls", async () => {
    const { s, sent, emit } = setup("text");
    s.begin();
    toolCall(emit, "c1");
    await flush();
    empty(emit);
    empty(emit);
    toolCall(emit, "c2");
    await flush();
    sent.length = 0;
    empty(emit);
    expect(nudges(sent)).toHaveLength(1);
  });

  it("does not nudge when the follow-up spoke", async () => {
    const { s, sent, emit } = setup("text");
    s.begin();
    toolCall(emit, "c1");
    await flush();
    sent.length = 0;
    emit({ type: "response.created" });
    emit({ type: "response.output_audio_transcript.done", transcript: "Two darts strike the kobold." });
    emit({ type: "response.done", response: { status: "completed", output: [{ type: "message" }] } });
    expect(nudges(sent)).toHaveLength(0);
  });

  it("does not nudge an empty reply that was not a tool follow-up", () => {
    const { s, sent, host, emit } = setup("text");
    host.stalledTurn = vi.fn(() => undefined);
    s.begin();
    sent.length = 0;
    empty(emit);
    expect(nudges(sent)).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });
});

describe("DmSession board watcher", () => {
  const scene = { inCombat: false, otherLocations: [{ id: "loc_graves", name: "The Giggling Graveyard" }] };
  const say = (emit: (ev: Record<string, unknown>) => void, text: string, output: unknown[] = [{ type: "message" }]) => {
    emit({ type: "response.created" });
    emit({ type: "response.output_audio_transcript.done", transcript: text });
    emit({ type: "response.done", response: { status: "completed", output } });
  };
  const checks = (sent: Record<string, any>[]) => sent.filter((e) => /Board check/.test(e.item?.content?.[0]?.text ?? ""));

  it("asks once to move the tokens when a reply narrated a move without a move tool", () => {
    const log = vi.fn();
    const { s, sent, host, emit } = setup("text", { turnGate: false, log });
    host.watchScene = () => scene;
    s.sendPlayerText("I head over to the pie stall.", "[speaker: Sam]");
    sent.length = 0;
    say(emit, "Pippa reaches the side of the pie stall. What do you do?");
    expect(checks(sent)).toHaveLength(1);
    expect(sent.at(-1)!.type).toBe("response.create");
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\[watch\] move:/));
    // The fix comes back silent (it only moved tokens): no second check, no empty-reply nudge.
    sent.length = 0;
    say(emit, "Pippa walks to the stall again.");
    emit({ type: "response.created" });
    emit({ type: "response.done", response: { status: "completed", output: [] } });
    expect(checks(sent)).toHaveLength(0);
    expect(sent.filter((e) => /Finish resolving/.test(e.item?.content?.[0]?.text ?? ""))).toHaveLength(0);
  });

  it("names change_scene when the party heads for another location, and stays quiet once a move tool ran", async () => {
    const { s, sent, host, emit } = setup("text");
    host.watchScene = () => scene;
    s.sendPlayerText("We enter the hatch and go down into the cellar.", "[speaker: Sam]");
    sent.length = 0;
    say(emit, "You all descend toward the graveyard beyond.");
    expect(checks(sent)[0].item.content[0].text).toMatch(/change_scene loc_graves/);

    s.sendPlayerText("I walk to the gate.", "[speaker: Sam]");
    emit({ type: "response.created" });
    emit({ type: "response.done", response: { status: "completed", output: [{ type: "function_call", call_id: "m1", name: "move_party", arguments: "{}" }] } });
    await flush();
    sent.length = 0;
    say(emit, "The party walks to the gate.");
    expect(checks(sent)).toHaveLength(0);
  });

  it("counts move_party against the per-reply move cap", async () => {
    const { host, emit } = setup("text");
    const call = (id: string) => ({ type: "function_call", call_id: id, name: "move_party", arguments: JSON.stringify({ to: "gate" }) });
    emit({ type: "response.created" });
    emit({ type: "response.done", response: { status: "completed", output: [call("a"), call("b"), call("c")] } });
    await flush();
    expect(vi.mocked(host.runTool).mock.calls.filter((c) => c[0] === "move_party")).toHaveLength(2);
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

function resilient(
  mode: "voice" | "text",
  opts: { retryDelaysMs?: number[]; idleWarnMs?: number; retryFirstConnect?: boolean; turnGate?: boolean; turnGateTimeoutMs?: number } = {},
) {
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
    turnGate: opts.turnGate ?? false,
    turnGateTimeoutMs: opts.turnGateTimeoutMs,
    log: () => undefined,
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
    expect(td).toMatchObject({ type: "semantic_vad", eagerness: "low", create_response: false, interrupt_response: false });
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

  it("a turn whose gate times out while the sideband is reconnecting is answered after the reconnect", async () => {
    const { s, sockets } = resilient("voice", { retryDelaysMs: [2000], turnGate: true, turnGateTimeoutMs: 1200 });
    const p = s.connect();
    sockets[0].open();
    await p;
    const msg = (ev: object) => sockets[0].emit("message", JSON.stringify(ev));
    msg({ type: "input_audio_buffer.speech_started", audio_start_ms: 0 });
    msg({ type: "input_audio_buffer.speech_stopped", audio_end_ms: 900 });
    msg({ type: "input_audio_buffer.committed", item_id: "item_1" });
    // The sideband drops before the transcript arrives (it never will on this socket).
    sockets[0].drop();
    vi.advanceTimersByTime(1200); // the gate times out while disconnected
    vi.advanceTimersByTime(800); // reconnect attempt
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    vi.advanceTimersByTime(10_000);
    const created = [...sockets[0].sent, ...sockets[1].sent].filter((e) => e.type === "response.create");
    expect(created).toHaveLength(1);
    expect(sockets[1].sent.filter((e) => e.type === "response.create")).toHaveLength(1);
  });

  it("a response requested while disconnected (host whisper) is sent once the socket is back", async () => {
    const { s, sockets } = resilient("text", { retryDelaysMs: [1000] });
    const p = s.connect();
    sockets[0].open();
    await p;
    s.begin(); // in flight when the socket drops: lost
    sockets[0].drop();
    s.prompt("Host note");
    vi.advanceTimersByTime(1000);
    sockets[1].open();
    expect(sockets[1].sent.filter((e) => e.type === "response.create")).toHaveLength(1);
  });

  it("a function_call_output produced while disconnected is delivered before the follow-up response", async () => {
    const { s, sockets, host } = resilient("voice", { retryDelaysMs: [1000] });
    let finish!: (v: unknown) => void;
    (host.runTool as any).mockImplementation(() => new Promise((r) => (finish = r)));
    const p = s.connect();
    sockets[0].open();
    await p;
    s.begin();
    sockets[0].emit(
      "message",
      JSON.stringify({
        type: "response.done",
        response: { status: "completed", output: [{ type: "function_call", call_id: "c1", name: "apply_damage", arguments: '{"target_id":"g1","amount":5}' }] },
      }),
    );
    // e.g. a slow consult_brain: the sideband drops while the tool runs.
    sockets[0].drop();
    finish({ ok: true, hp: 2 });
    await vi.advanceTimersByTimeAsync(0);
    s.addSystemNote("[note while down]");
    await vi.advanceTimersByTimeAsync(1000);
    sockets[1].open();
    const types = sockets[1].sent.map((e) => (e.type === "conversation.item.create" ? `item:${e.item.type}` : e.type));
    expect(types).toEqual(["item:function_call_output", "item:message", "response.create"]);
    expect(sockets[1].sent[0].item.call_id).toBe("c1");
    expect(host.runTool).toHaveBeenCalledTimes(1);
  });

  it("text mode drops buffered function outputs (the new session has no such call) but keeps notes", async () => {
    const { s, sockets } = resilient("text", { retryDelaysMs: [1000] });
    const p = s.connect();
    sockets[0].open();
    await p;
    sockets[0].drop();
    (s as any).send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: "c1", output: "{}" } });
    s.addSystemNote("[note while down]");
    vi.advanceTimersByTime(1000);
    sockets[1].open();
    const items = sockets[1].sent.filter((e) => e.type === "conversation.item.create").map((e) => e.item.type);
    expect(items).toEqual(["message", "message"]); // recap note + the buffered note
  });

  it("caps the outbox while disconnected", async () => {
    const { s, sockets, warn } = resilient("voice", { retryDelaysMs: [1000] });
    const p = s.connect();
    sockets[0].open();
    await p;
    sockets[0].drop();
    for (let i = 0; i < OUTBOX_MAX + 10; i++) s.addSystemNote(`n${i}`);
    vi.advanceTimersByTime(1000);
    sockets[1].open();
    const notes = sockets[1].sent.filter((e) => e.type === "conversation.item.create");
    expect(notes).toHaveLength(OUTBOX_MAX);
    expect(notes[0].item.content[0].text).toBe("n10"); // oldest dropped
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("outbox"));
  });

  it("a reconnect clears a stuck 'speaking' (the stopped event was lost)", async () => {
    const { s, sockets } = resilient("voice", { retryDelaysMs: [1000] });
    const p = s.connect();
    sockets[0].open();
    await p;
    sockets[0].emit("message", JSON.stringify({ type: "output_audio_buffer.started" }));
    sockets[0].drop();
    vi.advanceTimersByTime(1000);
    sockets[1].open();
    expect(s.stopTalking()).toBe(false);
  });

  it("ignores frames that arrive after close() (no tools run)", async () => {
    const { s, sockets, host } = resilient("voice");
    const p = s.connect();
    sockets[0].open();
    await p;
    // Real ws: close() starts the handshake; frames already in flight still arrive.
    sockets[0].close = () => {
      sockets[0].readyState = 2;
    };
    s.close();
    sockets[0].emit(
      "message",
      JSON.stringify({ type: "response.done", response: { status: "completed", output: [{ type: "function_call", call_id: "c1", name: "apply_damage", arguments: "{}" }] } }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(host.runTool).not.toHaveBeenCalled();
  });

  it("voice: instructions refreshed while the sideband is down are sent after the reconnect", async () => {
    const { s, sockets, host } = resilient("voice", { retryDelaysMs: [1000] });
    let instr = "old scene";
    host.instructions = () => instr;
    const p = s.connect();
    sockets[0].open();
    await p;
    sockets[0].drop();
    // The host changes the scene during the drop (the service calls refreshInstructions).
    instr = "NEW scene: the party is in the crypt";
    s.refreshInstructions();
    vi.advanceTimersByTime(1000);
    sockets[1].open();
    const updates = sockets[1].sent.filter((e) => e.type === "session.update");
    expect(updates).toHaveLength(1);
    expect(updates[0].session.instructions).toBe("NEW scene: the party is in the crypt");
    // Sent first, before buffered items; a later clean reconnect sends nothing again.
    expect(sockets[1].sent[0].type).toBe("session.update");
    sockets[1].drop();
    vi.advanceTimersByTime(1000);
    sockets[2].open();
    expect(sockets[2].sent).toEqual([]);
  });

  it("closes a socket that opens after the session was closed (no leak)", async () => {
    const { s, sockets } = resilient("voice");
    void s.connect().catch(() => undefined);
    let closes = 0;
    sockets[0].close = () => void closes++; // a CONNECTING ws may still emit "open" later
    s.close();
    expect(closes).toBe(1);
    sockets[0].open();
    expect(closes).toBe(2);
    expect(sockets[0].sent).toEqual([]);
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

  it("answers a short one-word turn (no short-audio rule)", () => {
    const g = gated();
    g.emit({ type: "input_audio_buffer.speech_started", audio_start_ms: 1000 });
    g.emit({ type: "input_audio_buffer.speech_stopped", audio_end_ms: 1200 });
    g.emit({ type: "input_audio_buffer.committed", item_id: "item_1" });
    g.transcript("item_1", "No.");
    expect(g.responses()).toBe(1);
    expect(g.sent.some((e) => e.type === "conversation.item.delete")).toBe(false);
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
  it("never offers host-only board tools to the DM", () => {
    for (const npc of [false, true]) {
      const names = dmToolDefs(npc).map((t) => t.name);
      expect(names).not.toContain("edit_fog");
      expect(names).not.toContain("edit_map_feature");
      expect(names).toContain("set_monster_hidden");
    }
  });
});

describe("dmToolDefs: adjust_attitude (Phase 4)", () => {
  it("offers adjust_attitude to the DM with NPC TTS on or off", () => {
    for (const npc of [false, true]) expect(dmToolDefs(npc).map((t) => t.name)).toContain("adjust_attitude");
  });
});

describe("DmSession: table clip echo and reply-done hook", () => {
  const turn = (emit: (ev: Record<string, unknown>) => void, id: string) => {
    emit({ type: "input_audio_buffer.speech_started" });
    emit({ type: "input_audio_buffer.speech_stopped" });
    emit({ type: "input_audio_buffer.committed", item_id: id });
  };

  it("drops a voice turn that started while a table clip played: no speaker ID, no reply, no log", () => {
    const { sent, host, emit } = setup();
    host.isEcho = vi.fn(() => true);
    turn(emit, "item_e");
    expect(sent).toEqual([{ type: "conversation.item.delete", item_id: "item_e" }]);
    expect(host.identifySpeaker).not.toHaveBeenCalled();
    emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_e", transcript: "I swing my axe" });
    expect(host.onPlayerText).not.toHaveBeenCalled();
  });

  it("answers a turn that is not an echo", () => {
    const { sent, host, emit } = setup();
    host.isEcho = vi.fn(() => false);
    turn(emit, "item_1");
    expect(sent.map((e) => e.type)).toEqual(["conversation.item.create", "response.create"]);
  });

  it("calls onReplyDone with the reply text after a finished reply, not after tool rounds", async () => {
    const { host, emit } = setup();
    host.onReplyDone = vi.fn();
    emit({ type: "response.created" });
    emit({ type: "response.done", response: { status: "completed", output: [{ type: "function_call", name: "roll_dice", call_id: "c1", arguments: "{}" }] } });
    await flush();
    expect(host.onReplyDone).not.toHaveBeenCalled();
    emit({ type: "response.created" });
    emit({ type: "response.output_text.done", text: "Thorin, what do you do?" });
    emit({ type: "response.done", response: { status: "completed", output: [] } });
    await flush();
    expect(host.onReplyDone).toHaveBeenCalledWith("Thorin, what do you do?");
  });
});

describe("DmSession planned handover support", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("isQuiet: true only when nothing is in flight", async () => {
    const quietAfter = (fn: (t: ReturnType<typeof setup>) => void, opts?: DmSessionOptions) => {
      const t = setup("voice", opts);
      fn(t);
      return t.s.isQuiet();
    };
    expect(quietAfter(() => undefined)).toBe(true);
    // A response running, DM audio playing, or a reply queued behind a hold.
    expect(quietAfter((t) => t.emit({ type: "response.created" }))).toBe(false);
    expect(quietAfter((t) => t.emit({ type: "output_audio_buffer.started" }))).toBe(false);
    expect(
      quietAfter((t) => {
        t.s.holdResponses(new Promise(() => undefined));
        t.s.prompt("x");
      }),
    ).toBe(false);
    // An NPC clip holds responses even with nothing queued.
    expect(quietAfter((t) => t.s.holdResponses(new Promise(() => undefined)))).toBe(false);
    // A voice turn waiting on the gate.
    expect(
      quietAfter(
        (t) => {
          t.emit({ type: "input_audio_buffer.speech_started" });
          t.emit({ type: "input_audio_buffer.speech_stopped" });
          t.emit({ type: "input_audio_buffer.committed", item_id: "it_1" });
        },
        { turnGate: true, turnGateTimeoutMs: 10_000 },
      ),
    ).toBe(false);
    // Closed, or the socket is down (reconnecting / items buffered).
    expect(quietAfter((t) => t.s.close())).toBe(false);
    const t = setup();
    (t.s as any).everOpened = true;
    (t.s as any).ws.readyState = 3;
    expect(t.s.isReconnecting).toBe(true);
    expect(t.s.isQuiet()).toBe(false);
    // Back to quiet once a reply finished and its audio stopped.
    const r = setup();
    r.emit({ type: "response.created" });
    r.emit({ type: "output_audio_buffer.started" });
    r.emit({ type: "response.done", response: { status: "completed", output: [] } });
    expect(r.s.isQuiet()).toBe(false);
    r.emit({ type: "output_audio_buffer.stopped" });
    expect(r.s.isQuiet()).toBe(true);
  });

  it("tracks table speech for the quiet check", () => {
    const { s, emit } = setup();
    expect(s.lastUserSpeechAt).toBe(0);
    vi.setSystemTime(10_000);
    emit({ type: "input_audio_buffer.speech_started" });
    expect(s.userSpeaking).toBe(true);
    vi.setSystemTime(12_000);
    emit({ type: "input_audio_buffer.speech_stopped" });
    expect(s.userSpeaking).toBe(false);
    expect(s.lastUserSpeechAt).toBe(12_000);
  });

  it("seedHandover adds a system note and asks for no response", () => {
    const { s, sent } = setup();
    s.seedHandover("[Same session continuing]");
    expect(sent.map((e) => e.type)).toEqual(["conversation.item.create"]);
    expect(sent[0].item).toMatchObject({ role: "system", content: [{ text: "[Same session continuing]" }] });
  });

  it("close({ quiet: true }) emits no offline status and marks the line handed over", () => {
    const { s, host } = setup();
    s.close({ quiet: true });
    expect(host.onStatus).not.toHaveBeenCalled();
    expect(s.handedOver).toBe(true);
    expect(s.closedByCaller).toBe(true);
  });

  it("onTurnAccepted fires when a mic turn is answered, even on the gate timeout before its transcript", () => {
    const t = setup("voice", { turnGate: true, turnGateTimeoutMs: 1200 });
    t.host.onTurnAccepted = vi.fn();
    t.emit({ type: "input_audio_buffer.speech_started" });
    t.emit({ type: "input_audio_buffer.speech_stopped" });
    t.emit({ type: "input_audio_buffer.committed", item_id: "it_1" });
    expect(t.host.onTurnAccepted).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1200);
    expect(t.host.onTurnAccepted).toHaveBeenCalledOnce();
    // The late transcript is logged but not counted again.
    t.emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "it_1", transcript: "Yes" });
    expect(t.host.onTurnAccepted).toHaveBeenCalledOnce();
    expect(t.host.onPlayerText).toHaveBeenCalledWith("Yes", "Sam as Thorin");
  });

  it("onTurnAccepted is not called for a skipped noise turn", () => {
    const t = setup("voice", { turnGate: true, turnGateTimeoutMs: 1200 });
    t.host.onTurnAccepted = vi.fn();
    t.emit({ type: "input_audio_buffer.speech_started" });
    t.emit({ type: "input_audio_buffer.speech_stopped" });
    t.emit({ type: "input_audio_buffer.committed", item_id: "it_1" });
    t.emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "it_1", transcript: "uh" });
    expect(t.host.onTurnAccepted).not.toHaveBeenCalled();
  });
});

describe("DmSession.busy and onResponseStart (AI player lines wait on them)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("busy: a response running or queued, someone talking, a turn on the gate; not the tail of a finished reply", () => {
    const busyAfter = (fn: (t: ReturnType<typeof setup>) => void, opts?: DmSessionOptions) => {
      const t = setup("voice", opts);
      fn(t);
      return t.s.busy;
    };
    expect(busyAfter(() => undefined)).toBe(false);
    expect(busyAfter((t) => t.emit({ type: "response.created" }))).toBe(true);
    expect(busyAfter((t) => t.emit({ type: "input_audio_buffer.speech_started" }))).toBe(true);
    expect(
      busyAfter((t) => {
        t.s.holdResponses(new Promise(() => undefined));
        t.s.prompt("x");
      }),
    ).toBe(true);
    expect(
      busyAfter(
        (t) => {
          t.emit({ type: "input_audio_buffer.speech_started" });
          t.emit({ type: "input_audio_buffer.speech_stopped" });
          t.emit({ type: "input_audio_buffer.committed", item_id: "it_1" });
        },
        { turnGate: true, turnGateTimeoutMs: 10_000 },
      ),
    ).toBe(true);
    // The reply is done but its audio still plays: not busy (onReplyDone fires here).
    expect(
      busyAfter((t) => {
        t.emit({ type: "response.created" });
        t.emit({ type: "output_audio_buffer.started" });
        t.emit({ type: "response.done", response: { status: "completed", output: [] } });
      }),
    ).toBe(false);
  });

  it("onResponseStart fires on every response.created, also while the DM's audio plays", () => {
    const t = setup();
    t.host.onResponseStart = vi.fn();
    t.emit({ type: "response.created" });
    expect(t.host.onResponseStart).toHaveBeenCalledOnce();
    t.emit({ type: "output_audio_buffer.started" });
    t.emit({ type: "response.created" });
    expect(t.host.onResponseStart).toHaveBeenCalledTimes(2);
  });
});
