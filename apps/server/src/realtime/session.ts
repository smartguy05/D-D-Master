import OpenAI from "openai";
import WebSocket from "ws";
import { realtimeToolDefs, type DmMode, type DmStatus } from "@dm/shared";
import { config } from "../config.js";

/** What the DM session needs from the game (implemented by GameService). */
export interface DmHost {
  instructions(): string;
  opening(): string;
  runTool(name: string, args: unknown): Promise<unknown>;
  /** Speaker note for a finished voice turn, e.g. "[speaker: Sam as Thorin, confidence 0.82]". */
  identifySpeaker(fromTs: number, toTs: number): { note: string; label?: string };
  onPlayerText(text: string, label?: string): void;
  onDmText(text: string): void;
  onStatus(status: DmStatus, mode: DmMode): void;
  onError(message: string): void;
}

/** Audio before the VAD "speech started" event that belongs to the turn (prefix padding + latency). */
const SPEECH_LEAD_MS = 450;

function sessionConfig(host: DmHost, mode: "voice" | "text") {
  return {
    type: "realtime" as const,
    instructions: host.instructions(),
    output_modalities: mode === "voice" ? (["audio"] as ["audio"]) : (["text"] as ["text"]),
    tools: realtimeToolDefs(),
    tool_choice: "auto" as const,
    audio: {
      input: {
        transcription: { model: config.transcribeModel },
        noise_reduction: { type: "far_field" as const },
        // We create responses ourselves so the speaker note can be inserted first.
        turn_detection: { type: "semantic_vad" as const, eagerness: "auto" as const, create_response: false, interrupt_response: true },
      },
      output: { voice: config.realtimeVoice },
    },
  };
}

/**
 * Start a WebRTC call on behalf of the browser: we POST its SDP offer (with our API key and
 * the session config) and return the SDP answer. The call id lets the server attach a
 * sideband WebSocket to the very same session to run tools.
 */
export async function createVoiceCall(host: DmHost, offerSdp: string): Promise<{ answerSdp: string; callId: string }> {
  if (!config.openaiKey) throw new Error("OPENAI_API_KEY is not set.");
  const client = new OpenAI({ apiKey: config.openaiKey });
  const res = await client.realtime.calls.create({
    sdp: offerSdp,
    session: { ...sessionConfig(host, "voice"), model: config.realtimeModel },
  });
  const location = res.headers.get("location") ?? "";
  const callId = location.split("/").filter(Boolean).pop();
  if (!callId) throw new Error("Realtime call created without a call id (Location header missing).");
  return { answerSdp: await res.text(), callId };
}

interface FunctionCallItem {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
}

export class DmSession {
  private ws?: WebSocket;
  private responseActive = false;
  private wantResponse = false;
  private speechStart = 0;
  private speechEnd = 0;
  private itemLabels = new Map<string, string | undefined>();
  private closed = false;

  constructor(
    private host: DmHost,
    readonly mode: "voice" | "text",
    private callId?: string,
  ) {}

  connect(): Promise<void> {
    const url =
      this.mode === "voice"
        ? `wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(this.callId!)}`
        : `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(config.realtimeModel)}`;
    this.host.onStatus("connecting", this.mode);
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${config.openaiKey}` } });
      this.ws = ws;
      ws.on("open", () => {
        if (this.mode === "text") this.send({ type: "session.update", session: sessionConfig(this.host, "text") });
        this.host.onStatus("listening", this.mode);
        resolve();
      });
      ws.on("message", (data) => {
        try {
          this.onEvent(JSON.parse(data.toString()));
        } catch (err) {
          this.host.onError(`Realtime event error: ${(err as Error).message}`);
        }
      });
      ws.on("error", (err) => {
        this.host.onError(`Realtime connection error: ${err.message}`);
        reject(err);
      });
      ws.on("close", () => {
        if (!this.closed) this.host.onError("Realtime connection closed.");
        this.closed = true;
        this.host.onStatus("offline", "none");
      });
    });
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }

  get isOpen() {
    return !this.closed && this.ws?.readyState === WebSocket.OPEN;
  }

  private send(ev: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(ev));
  }

  /** Push fresh instructions (after scene/party changes). */
  refreshInstructions() {
    this.send({ type: "session.update", session: { type: "realtime", instructions: this.host.instructions() } });
  }

  addSystemNote(text: string) {
    this.send({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text }] } });
  }

  /** Kick off the session: the DM greets/recaps and sets the scene. */
  begin() {
    this.addSystemNote(this.host.opening());
    this.requestResponse();
  }

  /** Text-mode (or host-typed) player message. */
  sendPlayerText(text: string, speakerNote: string) {
    this.addSystemNote(speakerNote);
    this.send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
    this.requestResponse();
  }

  /** Ask the DM to react to something (host "nudge" / event). */
  prompt(text: string) {
    this.addSystemNote(text);
    this.requestResponse();
  }

  private requestResponse() {
    if (this.responseActive) {
      this.wantResponse = true;
      return;
    }
    this.responseActive = true;
    this.send({ type: "response.create" });
  }

  private onEvent(ev: Record<string, any>) {
    switch (ev.type) {
      case "input_audio_buffer.speech_started":
        this.speechStart = Date.now() - SPEECH_LEAD_MS;
        this.host.onStatus("listening", this.mode);
        break;
      case "input_audio_buffer.speech_stopped":
        this.speechEnd = Date.now();
        break;
      case "input_audio_buffer.committed": {
        const end = this.speechEnd || Date.now();
        const { note, label } = this.host.identifySpeaker(this.speechStart || end - 3000, end);
        this.itemLabels.set(ev.item_id, label);
        this.addSystemNote(note);
        this.host.onStatus("thinking", this.mode);
        this.requestResponse();
        break;
      }
      case "conversation.item.input_audio_transcription.completed":
        if (ev.transcript?.trim()) this.host.onPlayerText(ev.transcript.trim(), this.itemLabels.get(ev.item_id));
        this.itemLabels.delete(ev.item_id);
        break;
      case "response.created":
        this.responseActive = true;
        this.host.onStatus("thinking", this.mode);
        break;
      case "output_audio_buffer.started":
        this.host.onStatus("speaking", this.mode);
        break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        this.host.onStatus("listening", this.mode);
        break;
      case "response.output_audio_transcript.done":
      case "response.output_text.done":
        if (ev.transcript?.trim() || ev.text?.trim()) this.host.onDmText((ev.transcript ?? ev.text).trim());
        break;
      case "response.done":
        void this.onResponseDone(ev.response);
        break;
      case "error":
        // Benign race: we asked for a response while one was starting.
        if (ev.error?.code === "conversation_already_has_active_response") {
          this.wantResponse = true;
          break;
        }
        this.host.onError(`Realtime: ${ev.error?.message ?? "unknown error"}`);
        break;
    }
  }

  private async onResponseDone(response: { status?: string; output?: Array<{ type: string }> }) {
    const calls = (response?.output ?? []).filter((o): o is FunctionCallItem => o.type === "function_call");
    if (response?.status === "completed" && calls.length) {
      const results = await Promise.all(
        calls.map(async (c) => {
          let output: unknown;
          try {
            output = await this.host.runTool(c.name, c.arguments ? JSON.parse(c.arguments) : {});
          } catch (err) {
            output = { error: (err as Error).message };
          }
          return { call_id: c.call_id, output: typeof output === "string" ? output : JSON.stringify(output) };
        }),
      );
      for (const r of results) this.send({ type: "conversation.item.create", item: { type: "function_call_output", ...r } });
      this.responseActive = false;
      this.wantResponse = false;
      this.requestResponse();
      return;
    }
    this.responseActive = false;
    if (this.mode === "text") this.host.onStatus("listening", this.mode);
    if (this.wantResponse) {
      this.wantResponse = false;
      this.requestResponse();
    }
  }
}
