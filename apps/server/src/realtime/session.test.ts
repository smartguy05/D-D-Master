import { describe, expect, it, vi } from "vitest";
import { DmSession, type DmHost } from "./session.js";

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
