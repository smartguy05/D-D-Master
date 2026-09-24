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
  /** Short plain-text summary of recent play, re-sent after a text-mode reconnect (context is lost). */
  recentContext?(): string;
  /** Enable the optional speak_as_npc tool (NPC_TTS). */
  npcTts?: boolean;
}

/** The subset of a `ws` WebSocket that DmSession uses (lets tests inject a fake socket). */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  on(event: "open", cb: () => void): unknown;
  on(event: "message", cb: (data: { toString(): string }) => void): unknown;
  on(event: "error", cb: (err: Error) => void): unknown;
  on(event: "close", cb: () => void): unknown;
}

export type SocketFactory = (url: string, headers: Record<string, string>) => SocketLike;

export interface DmSessionOptions {
  createSocket?: SocketFactory;
  /** Delays before each reconnect attempt; its length is the max number of attempts. */
  retryDelaysMs?: number[];
  /** Warn when nothing arrives on the sideband for this long while live (0 = off). */
  idleWarnMs?: number;
  warn?: (message: string) => void;
}

const SOCKET_OPEN = 1;
export const DEFAULT_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];
export const DEFAULT_IDLE_WARN_MS = 5 * 60_000;

const defaultSocketFactory: SocketFactory = (url, headers) => new WebSocket(url, { headers });

/** Tool definitions for the session; speak_as_npc only when NPC TTS is enabled. */
export function dmToolDefs(npcTts = false) {
  return realtimeToolDefs().filter((t) => npcTts || t.name !== "speak_as_npc");
}

/** Audio before the VAD "speech started" event that belongs to the turn (prefix padding + latency). */
const SPEECH_LEAD_MS = 450;

function sessionConfig(host: DmHost, mode: "voice" | "text") {
  return {
    type: "realtime" as const,
    instructions: host.instructions(),
    output_modalities: mode === "voice" ? (["audio"] as ["audio"]) : (["text"] as ["text"]),
    tools: dmToolDefs(host.npcTts),
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
  private ws?: SocketLike;
  private responseActive = false;
  private wantResponse = false;
  private speechStart = 0;
  private speechEnd = 0;
  private itemLabels = new Map<string, string | undefined>();
  private closed = false;
  private everOpened = false;
  private attempt = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private idleTimer?: ReturnType<typeof setInterval>;
  private lastEventTs = 0;
  private idleWarned = false;
  private readonly createSocket: SocketFactory;
  private readonly retryDelays: number[];
  private readonly idleWarnMs: number;
  private readonly warn: (message: string) => void;

  constructor(
    private host: DmHost,
    readonly mode: "voice" | "text",
    private callId?: string,
    opts: DmSessionOptions = {},
  ) {
    this.createSocket = opts.createSocket ?? defaultSocketFactory;
    this.retryDelays = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    this.idleWarnMs = opts.idleWarnMs ?? DEFAULT_IDLE_WARN_MS;
    this.warn = opts.warn ?? ((m) => console.warn(m));
  }

  private get url() {
    return this.mode === "voice"
      ? `wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(this.callId!)}`
      : `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(config.realtimeModel)}`;
  }

  /** First connection. Rejects if it never opens; later drops are retried automatically. */
  connect(): Promise<void> {
    this.host.onStatus("connecting", this.mode);
    return new Promise((resolve, reject) => this.openSocket(resolve, reject));
  }

  private openSocket(onOpen?: () => void, onFail?: (err: Error) => void) {
    const ws = this.createSocket(this.url, { Authorization: `Bearer ${config.openaiKey}` });
    this.ws = ws;
    let opened = false;
    ws.on("open", () => {
      if (this.ws !== ws || this.closed) return;
      opened = true;
      const reconnected = this.everOpened;
      this.everOpened = true;
      this.attempt = 0;
      this.lastEventTs = Date.now();
      this.startIdleWatch();
      if (this.mode === "text") this.send({ type: "session.update", session: sessionConfig(this.host, "text") });
      if (reconnected) this.onReconnected();
      this.host.onStatus("listening", this.mode);
      onOpen?.();
    });
    ws.on("message", (data) => {
      if (this.ws !== ws) return;
      this.lastEventTs = Date.now();
      this.idleWarned = false;
      try {
        this.onEvent(JSON.parse(data.toString()));
      } catch (err) {
        this.host.onError(`Realtime event error: ${(err as Error).message}`);
      }
    });
    ws.on("error", (err) => {
      if (this.ws !== ws) return;
      if (opened || !this.everOpened) this.host.onError(`Realtime connection error: ${err.message}`);
      else this.warn(`Realtime reconnect attempt failed: ${err.message}`);
      if (!this.everOpened) onFail?.(err);
    });
    ws.on("close", () => {
      if (this.ws !== ws) return;
      this.stopIdleWatch();
      // Closed by us (stop / new session): the service already reported "offline".
      if (this.closed) return;
      if (!this.everOpened) {
        // The first connection never opened: give up, the caller reports the failure.
        this.closed = true;
        this.host.onStatus("offline", "none");
        onFail?.(new Error("Realtime connection closed before it opened."));
        return;
      }
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect() {
    if (this.attempt >= this.retryDelays.length) {
      this.closed = true;
      this.host.onError(`Realtime connection lost; gave up after ${this.retryDelays.length} reconnect attempts. Restart the DM.`);
      this.host.onStatus("offline", "none");
      return;
    }
    const delay = this.retryDelays[this.attempt++];
    if (this.attempt === 1) this.host.onError("Realtime connection dropped; reconnecting…");
    this.warn(`Realtime reconnect ${this.attempt}/${this.retryDelays.length} in ${delay} ms`);
    this.host.onStatus("connecting", this.mode);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.closed) this.openSocket();
    }, delay);
  }

  /** After a reconnect: in-flight responses are gone; text mode also lost the conversation. */
  private onReconnected() {
    this.responseActive = false;
    this.wantResponse = false;
    this.itemLabels.clear();
    if (this.mode === "text") this.addSystemNote(this.restoreNote());
  }

  private restoreNote() {
    const recent = this.host.recentContext?.().trim();
    return `[The connection was restored after a drop and earlier conversation was lost.${recent ? ` Recent play:\n${recent}\n` : " "}Continue naturally from where things stand; do not restart the adventure.]`;
  }

  private startIdleWatch() {
    this.stopIdleWatch();
    if (!this.idleWarnMs) return;
    this.idleWarned = false;
    this.idleTimer = setInterval(() => {
      if (this.closed || this.idleWarned) return;
      const idle = Date.now() - this.lastEventTs;
      if (idle >= this.idleWarnMs) {
        this.idleWarned = true;
        this.warn(`Realtime sideband idle: nothing received for ${Math.round(idle / 1000)} s while the DM is live.`);
      }
    }, Math.max(1000, Math.floor(this.idleWarnMs / 4)));
    (this.idleTimer as { unref?: () => void }).unref?.();
  }

  private stopIdleWatch() {
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.idleTimer = undefined;
  }

  close() {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.stopIdleWatch();
    this.ws?.close();
  }

  get isOpen() {
    return !this.closed && this.ws?.readyState === SOCKET_OPEN;
  }

  /** True while waiting between reconnect attempts or re-opening the socket. */
  get isReconnecting() {
    return !this.closed && this.everOpened && this.ws?.readyState !== SOCKET_OPEN;
  }

  private send(ev: Record<string, unknown>) {
    if (this.ws?.readyState === SOCKET_OPEN) this.ws.send(JSON.stringify(ev));
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

  /** A replacement voice call after the browser's WebRTC link dropped: continue, don't re-greet. */
  resume() {
    this.prompt(`${this.restoreNote()} Say in one short in-character sentence that you are back, then carry on.`);
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
