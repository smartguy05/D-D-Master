import OpenAI from "openai";
import WebSocket from "ws";
import { isHostOnlyTool, realtimeToolDefs, type DmMode, type DmStatus } from "@dm/shared";
import { config } from "../config.js";
import { isNoiseTranscript } from "./noise.js";

/** Result of speaker ID for one committed voice turn. */
export interface SpeakerTurn {
  /** System note for the model, e.g. "[speaker: Sam as Thorin, confidence 0.82]". */
  note: string;
  /** Log label for the player's line. */
  label?: string;
  /**
   * Apply speaker-ID side effects (announce the speaker, remember a low-confidence sample for
   * confirm_speaker). Called only when the turn is answered, so a skipped noise turn leaves no trace.
   */
  accept?(): void;
}

/** What the DM session needs from the game (implemented by GameService). */
export interface DmHost {
  instructions(): string;
  opening(): string;
  runTool(name: string, args: unknown): Promise<unknown>;
  /** Speaker ID for a finished voice turn (see SpeakerTurn). */
  identifySpeaker(fromTs: number, toTs: number): SpeakerTurn;
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
  /**
   * Retry the *first* connection too (with retryDelaysMs) instead of giving up at once. Used to
   * re-attach to a live call after a server restart, where OpenAI may need a moment.
   */
  retryFirstConnect?: boolean;
  /** Hold the response to a voice turn until its transcript shows it isn't noise (default: TURN_GATE). */
  turnGate?: boolean;
  /** Answer anyway when no transcript arrives within this many ms (default: TURN_GATE_TIMEOUT_MS). */
  turnGateTimeoutMs?: number;
  warn?: (message: string) => void;
  /** Turn-timing log lines ("[turn-timing] …"); default console.log. */
  log?: (line: string) => void;
}

/** One committed voice turn, tracked by its conversation item id. */
interface Turn {
  itemId: string;
  noteId: string;
  label?: string;
  accept?: () => void;
  speechMs?: number;
  committedAt: number;
  /** waiting = gate holds the response; answered = response requested (transcript may still come). */
  state: "waiting" | "answered";
  /** How it was answered: off (gate disabled), respond, failed, timeout. */
  gate?: string;
  timer?: ReturnType<typeof setTimeout>;
}

/** Keep at most this many turns whose transcript never arrived. */
const MAX_TRACKED_TURNS = 50;

const SOCKET_OPEN = 1;
export const DEFAULT_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];
export const DEFAULT_IDLE_WARN_MS = 5 * 60_000;
/** Most conversation items kept while the socket is down (oldest dropped beyond this). */
export const OUTBOX_MAX = 100;
/** Client events that are buffered while disconnected and flushed in order on the next open. */
const BUFFERED_EVENTS = new Set(["conversation.item.create", "conversation.item.delete"]);

/** Safety cap for holdResponses (each NPC clip hold also times out on its own). */
export const DEFAULT_HOLD_MAX_MS = 60_000;

const defaultSocketFactory: SocketFactory = (url, headers) => new WebSocket(url, { headers });

/** Tool definitions for the session; speak_as_npc only when NPC TTS is enabled; never host-only tools. */
export function dmToolDefs(npcTts = false) {
  return realtimeToolDefs().filter((t) => (npcTts || t.name !== "speak_as_npc") && !isHostOnlyTool(t.name));
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
        // We create responses ourselves so the speaker note can be inserted first. Table chatter
        // must not cut the DM off mid-sentence: speech during narration is committed as usual and
        // answered (queued via requestResponse) once the current response is done.
        turn_detection: { type: "semantic_vad" as const, eagerness: "auto" as const, create_response: false, interrupt_response: false },
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
  /** DM audio is playing (output_audio_buffer.started .. stopped/cleared). */
  private speaking = false;
  private wantResponse = false;
  private speechStart = 0;
  private speechEnd = 0;
  /** VAD audio offsets of the current speech (ms into the input stream). */
  private audioStartMs?: number;
  private audioEndMs?: number;
  private turns = new Map<string, Turn>();
  /** The last answered turn whose "audio started" latency is not logged yet. */
  private timingTurn?: Turn;
  private noteSeq = 0;
  /** Pending holds (NPC clips playing): response.create waits until all are released. */
  private holds = new Set<object>();
  /** Conversation items sent while the socket was down (function outputs, notes, deletes). */
  private outbox: Record<string, unknown>[] = [];
  /** refreshInstructions() was called while the socket was down. */
  private instructionsDirty = false;
  private closed = false;
  private stoppedByCaller = false;
  private everOpened = false;
  private attempt = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private idleTimer?: ReturnType<typeof setInterval>;
  private lastEventTs = 0;
  private idleWarned = false;
  private readonly createSocket: SocketFactory;
  private readonly retryDelays: number[];
  private readonly idleWarnMs: number;
  private readonly retryFirstConnect: boolean;
  private readonly turnGate: boolean;
  private readonly turnGateTimeoutMs: number;
  private readonly warn: (message: string) => void;
  private readonly log: (line: string) => void;
  /** Settles the pending connect() promise (kept across first-connect retries). */
  private firstConnect?: { resolve: () => void; reject: (err: Error) => void };

  constructor(
    private host: DmHost,
    readonly mode: "voice" | "text",
    private callId?: string,
    opts: DmSessionOptions = {},
  ) {
    this.createSocket = opts.createSocket ?? defaultSocketFactory;
    this.retryDelays = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    this.idleWarnMs = opts.idleWarnMs ?? DEFAULT_IDLE_WARN_MS;
    this.retryFirstConnect = opts.retryFirstConnect ?? false;
    this.turnGate = opts.turnGate ?? config.turnGate;
    this.turnGateTimeoutMs = opts.turnGateTimeoutMs ?? config.turnGateTimeoutMs;
    this.log = opts.log ?? ((m) => console.log(m));
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
    return new Promise((resolve, reject) => {
      this.firstConnect = { resolve, reject };
      this.openSocket();
    });
  }

  private settleFirst(err?: Error) {
    const fc = this.firstConnect;
    this.firstConnect = undefined;
    if (err) fc?.reject(err);
    else fc?.resolve();
  }

  private openSocket() {
    const ws = this.createSocket(this.url, { Authorization: `Bearer ${config.openaiKey}` });
    this.ws = ws;
    let opened = false;
    let lastError: Error | undefined;
    ws.on("open", () => {
      if (this.ws !== ws) return;
      if (this.closed) {
        ws.close(); // opened after close(): don't leak the connection
        return;
      }
      opened = true;
      const reconnected = this.everOpened;
      this.everOpened = true;
      this.attempt = 0;
      this.lastEventTs = Date.now();
      this.startIdleWatch();
      if (this.mode === "text") this.send({ type: "session.update", session: sessionConfig(this.host, "text") });
      else if (this.instructionsDirty) this.refreshInstructions();
      this.instructionsDirty = false;
      if (reconnected) this.onReconnected();
      this.flushOutbox();
      this.host.onStatus("listening", this.mode);
      if (this.wantResponse) {
        this.wantResponse = false;
        this.requestResponse();
      }
      this.settleFirst();
    });
    ws.on("message", (data) => {
      // A closed session ignores frames still in flight (real ws emits them before "close").
      if (this.ws !== ws || this.closed) return;
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
      lastError = err;
      if (opened || (!this.everOpened && !this.retryFirstConnect)) this.host.onError(`Realtime connection error: ${err.message}`);
      else this.warn(`Realtime ${this.everOpened ? "reconnect" : "connect"} attempt failed: ${err.message}`);
      if (!this.everOpened && !this.retryFirstConnect) this.settleFirst(err);
    });
    ws.on("close", () => {
      if (this.ws !== ws) return;
      this.stopIdleWatch();
      // Closed by us (stop / new session): the service already reported "offline".
      if (this.closed) {
        this.settleFirst(new Error("Realtime session closed before it opened."));
        return;
      }
      if (!this.everOpened) {
        if (this.retryFirstConnect && this.attempt < this.retryDelays.length) {
          const delay = this.retryDelays[this.attempt++];
          this.warn(`Realtime connect retry ${this.attempt}/${this.retryDelays.length} in ${delay} ms`);
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            if (!this.closed) this.openSocket();
          }, delay);
          return;
        }
        // The first connection never opened: give up, the caller reports the failure.
        this.closed = true;
        this.host.onStatus("offline", "none");
        this.settleFirst(lastError ?? new Error("Realtime connection closed before it opened."));
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
    // The in-flight response is gone; a request made while disconnected (wantResponse) is kept.
    this.responseActive = false;
    // A lost output_audio_buffer.stopped must not leave us "speaking" forever.
    this.speaking = false;
    // A text reconnect is a new conversation: outputs for the old session's calls would be rejected.
    if (this.mode === "text") this.outbox = this.outbox.filter((ev) => (ev.item as { type?: string } | undefined)?.type !== "function_call_output");
    // Turns still waiting on the gate keep their timeout, which answers them.
    for (const [id, t] of this.turns) if (t.state === "answered") this.turns.delete(id);
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

  /** close() was called (host Stop, or a new session replaced this one), as opposed to giving up. */
  get closedByCaller() {
    return this.stoppedByCaller;
  }

  close() {
    this.stoppedByCaller = true;
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.stopIdleWatch();
    for (const t of this.turns.values()) if (t.timer) clearTimeout(t.timer);
    this.turns.clear();
    this.outbox = [];
    this.ws?.close();
    this.settleFirst(new Error("Realtime session closed before it opened."));
  }

  get isOpen() {
    return !this.closed && this.ws?.readyState === SOCKET_OPEN;
  }

  /** True while waiting between reconnect attempts or re-opening the socket. */
  get isReconnecting() {
    return !this.closed && this.everOpened && this.ws?.readyState !== SOCKET_OPEN;
  }

  /**
   * Send a client event. While the socket is down, conversation items are buffered (so a tool's
   * function_call_output or a note isn't lost and is delivered before the next response.create);
   * other events are dropped (response.create is tracked by wantResponse instead).
   */
  private send(ev: Record<string, unknown>) {
    if (this.ws?.readyState === SOCKET_OPEN) {
      this.ws.send(JSON.stringify(ev));
      return;
    }
    if (this.closed || !BUFFERED_EVENTS.has(String(ev.type))) return;
    this.outbox.push(ev);
    if (this.outbox.length > OUTBOX_MAX) {
      this.outbox.shift();
      this.warn(`Realtime outbox full while disconnected; dropped the oldest item (max ${OUTBOX_MAX}).`);
    }
  }

  private flushOutbox() {
    const items = this.outbox.splice(0);
    for (const ev of items) this.send(ev);
  }

  /** Push fresh instructions (after scene/party changes). */
  refreshInstructions() {
    // While down, remember it; the next open sends the then-current instructions (voice keeps the
    // call's session, so nothing else would update them).
    if (this.ws?.readyState !== SOCKET_OPEN) {
      this.instructionsDirty = true;
      return;
    }
    this.send({ type: "session.update", session: { type: "realtime", instructions: this.host.instructions() } });
  }

  addSystemNote(text: string, id?: string) {
    this.send({ type: "conversation.item.create", item: { ...(id ? { id } : {}), type: "message", role: "system", content: [{ type: "input_text", text }] } });
  }

  /** Kick off the session: the DM greets/recaps and sets the scene. */
  begin() {
    this.addSystemNote(this.host.opening());
    this.requestResponse();
  }

  /**
   * Host "Stop talking": cancel the response in flight, cut the audio already playing (WebRTC
   * only) and drop a reply queued behind it. Players can't interrupt by voice
   * (`interrupt_response: false`), so this is the manual way. Returns false if the DM was idle.
   */
  stopTalking(): boolean {
    if (!this.responseActive && !this.speaking) return false;
    this.wantResponse = false;
    if (this.responseActive) this.send({ type: "response.cancel" });
    if (this.mode === "voice") this.send({ type: "output_audio_buffer.clear" });
    this.addSystemNote("[The host stopped you mid-sentence. Don't repeat or finish what was cut off; wait for the players.]");
    return true;
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

  /**
   * Defer every response.create (tool follow-ups, player turns) until `until` settles or `maxMs`
   * passes, e.g. while an NPC clip plays on the table speaker. Requests made meanwhile are merged
   * into one response sent on release.
   */
  holdResponses(until: Promise<unknown>, maxMs = DEFAULT_HOLD_MAX_MS) {
    const hold = {};
    this.holds.add(hold);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const release = () => {
      if (!this.holds.delete(hold)) return;
      if (timer) clearTimeout(timer);
      if (this.holds.size || this.closed || this.responseActive || !this.wantResponse) return;
      this.wantResponse = false;
      this.requestResponse();
    };
    timer = setTimeout(release, maxMs);
    until.then(release, release);
  }

  private requestResponse() {
    // Not connected (between reconnect attempts): remember it; the next open sends it.
    if (this.ws?.readyState !== SOCKET_OPEN) {
      this.wantResponse = true;
      return;
    }
    if (this.responseActive || this.holds.size) {
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
        this.audioStartMs = typeof ev.audio_start_ms === "number" ? ev.audio_start_ms : undefined;
        this.audioEndMs = undefined;
        if (!this.speaking) this.host.onStatus("listening", this.mode);
        break;
      case "input_audio_buffer.speech_stopped":
        this.speechEnd = Date.now();
        this.audioEndMs = typeof ev.audio_end_ms === "number" ? ev.audio_end_ms : undefined;
        break;
      case "input_audio_buffer.committed":
        this.onCommitted(String(ev.item_id));
        break;
      case "conversation.item.input_audio_transcription.completed":
        this.onTranscript(String(ev.item_id), String(ev.transcript ?? "").trim());
        break;
      case "conversation.item.input_audio_transcription.failed":
        this.onTranscriptFailed(String(ev.item_id));
        break;
      case "response.created":
        this.responseActive = true;
        if (!this.speaking) this.host.onStatus("thinking", this.mode);
        break;
      case "output_audio_buffer.started":
        if (this.timingTurn) {
          this.timing(this.timingTurn, `audio_start=${Date.now() - this.timingTurn.committedAt}ms`);
          this.timingTurn = undefined;
        }
        this.speaking = true;
        this.host.onStatus("speaking", this.mode);
        break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        this.speaking = false;
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

  // ---------- voice turns and the noise gate ----------

  private onCommitted(itemId: string) {
    const end = this.speechEnd || Date.now();
    const spk = this.host.identifySpeaker(this.speechStart || end - 3000, end);
    const speechMs = this.audioStartMs !== undefined && this.audioEndMs !== undefined ? this.audioEndMs - this.audioStartMs : undefined;
    const turn: Turn = {
      itemId,
      noteId: `spk_${(++this.noteSeq).toString(36)}_${Date.now().toString(36)}`,
      label: spk.label,
      accept: spk.accept,
      speechMs,
      committedAt: Date.now(),
      state: "waiting",
    };
    this.turns.set(itemId, turn);
    if (this.turns.size > MAX_TRACKED_TURNS) {
      const oldest = this.turns.keys().next().value as string;
      const t = this.turns.get(oldest);
      if (t?.timer) clearTimeout(t.timer);
      this.turns.delete(oldest);
    }
    this.addSystemNote(spk.note, turn.noteId);
    if (!this.speaking) this.host.onStatus("thinking", this.mode);
    if (!this.turnGate) {
      this.answerTurn(turn, "off");
      return;
    }
    turn.timer = setTimeout(() => {
      turn.timer = undefined;
      if (turn.state !== "waiting" || this.closed) return;
      this.timing(turn, "transcript=pending gate=timeout");
      this.answerTurn(turn, "timeout");
    }, this.turnGateTimeoutMs);
  }

  private onTranscript(itemId: string, text: string) {
    const turn = this.turns.get(itemId);
    if (!turn) {
      if (text) this.host.onPlayerText(text);
      return;
    }
    const ms = Date.now() - turn.committedAt;
    this.turns.delete(itemId);
    if (turn.state === "waiting") {
      const noise = isNoiseTranscript(text);
      this.timing(turn, `transcript=${ms}ms gate=${noise ? "skip" : "respond"}`);
      if (noise) return this.skipTurn(turn);
      this.answerTurn(turn, "respond");
    } else {
      this.timing(turn, `transcript=${ms}ms gate=${turn.gate === "off" ? "off" : `${turn.gate} (late transcript)`}`);
    }
    if (text) this.host.onPlayerText(text, turn.label);
  }

  /** Transcription failed: we can't tell, so answer (a turn is never lost). */
  private onTranscriptFailed(itemId: string) {
    const turn = this.turns.get(itemId);
    if (!turn) return;
    this.turns.delete(itemId);
    if (turn.state !== "waiting") return;
    this.timing(turn, `transcript=failed gate=failed`);
    this.answerTurn(turn, "failed");
  }

  private answerTurn(turn: Turn, gate: string) {
    if (turn.timer) clearTimeout(turn.timer);
    turn.timer = undefined;
    turn.state = "answered";
    turn.gate = gate;
    turn.accept?.();
    this.timingTurn = turn;
    this.requestResponse();
  }

  /** A noise turn: remove its audio item and speaker note from the conversation; no reply. */
  private skipTurn(turn: Turn) {
    if (turn.timer) clearTimeout(turn.timer);
    this.send({ type: "conversation.item.delete", item_id: turn.itemId });
    this.send({ type: "conversation.item.delete", item_id: turn.noteId });
    const waiting = [...this.turns.values()].some((t) => t.state === "waiting");
    if (!this.speaking && !this.responseActive && !waiting) this.host.onStatus("listening", this.mode);
  }

  private timing(turn: Turn, detail: string) {
    this.log(`[turn-timing] item=${turn.itemId} speech=${turn.speechMs === undefined ? "?" : `${turn.speechMs}ms`} ${detail}`);
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
