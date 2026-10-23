/**
 * Browser audio:
 *  - MicStreamer: sends the table mic to the server as 16 kHz PCM16 for voice ID (/table during
 *    play, role "table"; /host while enrolling a voice, role "host"; a phone recording its own
 *    player's voice, role "player" with the seat).
 *  - VoiceLink: WebRTC call to OpenAI Realtime, run by /table (the server creates the call with its
 *    API key and attaches a sideband socket that runs all tools).
 */
import type { VoiceLinkState } from "@dm/shared";
import { isAutoplayBlocked } from "./audioUnlock";
import { redirectIfUnauthorized } from "./auth";

export type { VoiceLinkState };

const WORKLET = `
class Pcm16Downsampler extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.acc = 0; this.sum = 0; this.n = 0;
    this.out = new Int16Array(1600); this.len = 0; // 100 ms chunks
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.sum += ch[i]; this.n++; this.acc += 1;
      if (this.acc >= this.ratio) {
        this.acc -= this.ratio;
        const v = Math.max(-1, Math.min(1, this.sum / this.n));
        this.sum = 0; this.n = 0;
        this.out[this.len++] = v < 0 ? v * 0x8000 : v * 0x7fff;
        if (this.len === this.out.length) {
          this.port.postMessage(this.out.buffer.slice(0));
          this.len = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("pcm16-downsampler", Pcm16Downsampler);
`;

export async function getTableMic(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
}

/** The WebSocket surface MicStreamer uses (lets tests inject a fake). */
export interface SocketLike {
  binaryType: string;
  readonly readyState: number;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  send(data: ArrayBuffer): void;
  close(): void;
}

export interface MicStreamerDeps {
  createSocket(): SocketLike;
}

/** Waits before each /ws/audio reconnect attempt; the last one repeats. */
export const MIC_RECONNECT_DELAYS_MS = [1000, 2000, 4000, 5000];
const SOCKET_OPEN = 1;

/**
 * Which page streams: the server takes /table's mic in play, /host's only while enrolling, and a
 * phone's ("player", with its seat) only while that player's voice is recorded on it.
 */
export type MicRole = "host" | "table" | "player";

export function audioSocketUrl(role: MicRole, loc: { protocol: string; host: string } = location, playerId?: string): string {
  const proto = loc.protocol === "https:" ? "wss" : "ws";
  const seat = role === "player" && playerId ? `&player=${encodeURIComponent(playerId)}` : "";
  return `${proto}://${loc.host}/ws/audio?role=${role}${seat}`;
}

const browserSocket = (role: MicRole, playerId?: string) => () => new WebSocket(audioSocketUrl(role, location, playerId)) as unknown as SocketLike;

/**
 * Streams the table mic to /ws/audio for voice ID. The socket reconnects by itself (backoff
 * MIC_RECONNECT_DELAYS_MS) until stop(); `connected` and onChange drive the host's
 * "Voice ID offline" pill.
 */
export class MicStreamer {
  private ctx?: AudioContext;
  private ws?: SocketLike;
  private node?: AudioWorkletNode;
  private stopped = false;
  private attempt = 0;
  private retry?: ReturnType<typeof setTimeout>;
  private listeners = new Set<(connected: boolean) => void>();
  private deps: MicStreamerDeps;
  level = 0;
  connected = false;

  /** `playerId`: the seat a "player" stream records. */
  constructor(role: MicRole, deps: Partial<MicStreamerDeps> = {}, playerId?: string) {
    this.deps = { createSocket: browserSocket(role, playerId), ...deps };
  }

  /** Listen for socket up/down; returns an unsubscribe function. */
  onChange(fn: (connected: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private setConnected(connected: boolean) {
    this.connected = connected;
    this.listeners.forEach((fn) => fn(connected));
  }

  async start(stream: MediaStream) {
    this.ctx = new AudioContext();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    await this.ctx.audioWorklet.addModule(url);
    const src = this.ctx.createMediaStreamSource(stream);
    this.node = new AudioWorkletNode(this.ctx, "pcm16-downsampler");
    this.node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      const pcm = new Int16Array(e.data);
      let peak = 0;
      for (let i = 0; i < pcm.length; i += 8) peak = Math.max(peak, Math.abs(pcm[i]));
      this.level = peak / 32768;
      this.send(e.data);
    };
    src.connect(this.node);
    this.resume();
    if (this.stopped) return; // stopped while the worklet loaded
    this.openSocket();
  }

  /**
   * Resume the audio context: one made before any user gesture (a /table that reloaded or was
   * told to start) stays suspended and streams nothing until a click or key unlocks sound.
   */
  resume() {
    if (this.ctx?.state === "suspended") void this.ctx.resume().catch(() => undefined);
  }

  /** Send one PCM chunk if the socket is open (chunks while it is down are dropped). */
  send(chunk: ArrayBuffer) {
    if (this.ws?.readyState === SOCKET_OPEN) this.ws.send(chunk);
  }

  /** Open /ws/audio; on close, try again after the next backoff delay unless stopped. */
  openSocket() {
    if (this.stopped) return;
    clearTimeout(this.retry);
    const ws = this.deps.createSocket();
    this.ws = ws;
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      this.setConnected(true);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = undefined;
      this.setConnected(false);
      if (this.stopped) return;
      const delay = MIC_RECONNECT_DELAYS_MS[Math.min(this.attempt, MIC_RECONNECT_DELAYS_MS.length - 1)];
      this.attempt++;
      this.retry = setTimeout(() => this.openSocket(), delay);
    };
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retry);
    const ws = this.ws;
    this.ws = undefined;
    if (ws) {
      ws.onopen = null;
      ws.onclose = null;
      ws.close();
    }
    this.node?.disconnect();
    void this.ctx?.close().catch(() => undefined);
    if (this.connected) this.setConnected(false);
  }
}

/** The RTCRtpSender surface used for the handover (mute the standby call, then unmute it). */
export interface SenderLike {
  replaceTrack(track: MediaStreamTrack | null): Promise<void>;
}

/** The RTCPeerConnection surface VoiceLink uses (lets tests inject a fake). */
export interface PeerLike {
  readonly connectionState: string;
  ontrack: ((e: { streams: readonly MediaStream[] }) => void) | null;
  onconnectionstatechange: (() => void) | null;
  addTrack(track: MediaStreamTrack, stream: MediaStream): SenderLike;
  createDataChannel(label: string): unknown;
  createOffer(): Promise<{ sdp?: string }>;
  setLocalDescription(desc: { type: "offer"; sdp?: string }): Promise<void>;
  setRemoteDescription(desc: { type: "answer"; sdp: string }): Promise<void>;
  close(): void;
}

/**
 * How a call is built: "start" (fresh), "resume" (after a dropped call, the DM continues) or
 * "handover" (a standby call next to the live one, swapped in silently by the server).
 */
export type OfferMode = "start" | "resume" | "handover";

export interface VoiceLinkDeps {
  createPeer(): PeerLike;
  /** POST the SDP offer to the server; resolves with the SDP answer or throws the server error. */
  postOffer(sdp: string, mode: OfferMode): Promise<string>;
  playRemote(stream: MediaStream | null): void;
}

/** A "disconnected" peer gets this long to recover by itself before we build a new call. */
export const DISCONNECT_GRACE_MS = 5000;
/** Waits between automatic reconnect attempts (the first attempt is immediate). */
export const RECONNECT_DELAYS_MS = [1000, 2000, 4000];

async function postOfferToServer(sdp: string, mode: OfferMode): Promise<string> {
  const query = mode === "resume" ? "?resume=1" : mode === "handover" ? "?handover=1" : "";
  const res = await fetch(`/api/dm/voice${query}`, { method: "POST", headers: { "content-type": "application/sdp" }, body: sdp });
  redirectIfUnauthorized(res, "/api/dm/voice");
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      msg = JSON.parse(text).error ?? text;
    } catch {
      /* plain-text error */
    }
    throw new Error(msg);
  }
  return text;
}

/** The DM's audio elements (one per VoiceLink), so a sound unlock can retry a refused play(). */
const remoteAudio = new Set<HTMLAudioElement>();
let onRemoteBlocked: (() => void) | undefined;

/** Called when autoplay refuses the DM's audio (/table shows its "Click to enable sound" prompt). */
export function onRemoteAudioBlocked(fn: (() => void) | undefined) {
  onRemoteBlocked = fn;
}

/** After a user gesture unlocked sound: start the DM's audio if autoplay refused it before. */
export function retryRemoteAudio() {
  for (const el of remoteAudio) if (el.srcObject && el.paused) void el.play().catch(() => undefined);
}

/** Browser implementations; nothing touches browser globals until it is called. */
function browserDeps(): VoiceLinkDeps {
  let audioEl: HTMLAudioElement | undefined;
  return {
    createPeer: () => new RTCPeerConnection() as unknown as PeerLike,
    postOffer: postOfferToServer,
    playRemote: (stream) => {
      if (!audioEl) {
        if (!stream) return;
        audioEl = document.createElement("audio");
        audioEl.autoplay = true;
        remoteAudio.add(audioEl);
      }
      audioEl.srcObject = stream;
      if (stream) void audioEl.play().catch((err: unknown) => isAutoplayBlocked(err) && onRemoteBlocked?.());
    },
  };
}

/**
 * WebRTC call to OpenAI Realtime. The server creates the call with its API key and attaches a
 * sideband socket that runs all tools. If the peer connection fails (or stays "disconnected" for
 * DISCONNECT_GRACE_MS) it builds a new call with `?resume=1`, so the DM continues where it was.
 *
 * Planned handover (server `voice_handover` events, before the 60-minute call cap):
 * prepareHandover() builds a standby call with the mic sender muted and its audio held, POSTed
 * with `?handover=1`; commitHandover() unmutes it, plays it and closes the old call, so the new
 * peer becomes the current one; abortHandover() drops the standby. Status never changes. A
 * reconnect or stop() while a handover is pending drops the standby too.
 */
interface Standby {
  pc: PeerLike;
  /** Each mic track with its (muted) sender on the standby peer. */
  senders: { sender: SenderLike; track: MediaStreamTrack }[];
  /** The standby call's audio, held until the swap. */
  remote: MediaStream | null;
  /** Settles true once the answer is applied, false if the standby was dropped or failed. */
  ready: Promise<boolean>;
}

export class VoiceLink {
  state: VoiceLinkState = "idle";
  error?: string;
  private pc?: PeerLike;
  private stream?: MediaStream;
  /** The live call's mic senders (replaceStream swaps their track). */
  private senders: SenderLike[] = [];
  private gen = 0;
  private disconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectRun = 0;
  private standby?: Standby;
  private listeners = new Set<(state: VoiceLinkState) => void>();
  private remoteListeners = new Set<(stream: MediaStream | null) => void>();
  private deps: VoiceLinkDeps;
  /** The DM's audio from the current call (null without one): /table forwards it to remote players. */
  remoteStream: MediaStream | null = null;

  constructor(deps: Partial<VoiceLinkDeps> = {}) {
    this.deps = { ...browserDeps(), ...deps };
  }

  /** Listen for state changes; returns an unsubscribe function. */
  subscribe(fn: (state: VoiceLinkState) => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  /** Listen for the DM's audio stream changing (a new call, the handover swap, hang-up); returns an unsubscribe function. */
  onRemoteStream(fn: (stream: MediaStream | null) => void): () => void {
    this.remoteListeners.add(fn);
    return () => void this.remoteListeners.delete(fn);
  }

  /** Play the DM's audio and tell the listeners. */
  private setRemote(stream: MediaStream | null) {
    this.deps.playRemote(stream);
    if (stream === this.remoteStream) return;
    this.remoteStream = stream;
    for (const fn of this.remoteListeners) fn(stream);
  }

  private setState(state: VoiceLinkState, error?: string) {
    this.state = state;
    this.error = error;
    for (const fn of this.listeners) fn(state);
  }

  async start(stream: MediaStream) {
    this.stop();
    this.stream = stream;
    this.setState("connecting");
    try {
      await this.connectOnce("start");
    } catch (err) {
      this.stop();
      throw err;
    }
  }

  /**
   * Join a voice DM that is still running after this page reloaded: a new call with `?resume=1`,
   * so the DM continues instead of greeting again.
   */
  async resume(stream: MediaStream) {
    this.stop();
    this.stream = stream;
    this.setState("reconnecting");
    try {
      await this.connectOnce("resume");
    } catch (err) {
      this.stop();
      throw err;
    }
  }

  /** Has a mic stream (a call is up or being rebuilt). */
  get active(): boolean {
    return !!this.stream;
  }

  /** Build a new call (automatic on failure, or the host's manual Reconnect button). */
  async reconnect(): Promise<void> {
    if (!this.stream) return;
    const run = ++this.reconnectRun;
    this.abortHandover();
    this.clearDisconnectTimer();
    this.setState("reconnecting");
    let lastErr: unknown;
    for (let i = 0; i <= RECONNECT_DELAYS_MS.length; i++) {
      if (run !== this.reconnectRun || !this.stream) return;
      try {
        await this.connectOnce("resume");
        return;
      } catch (err) {
        lastErr = err;
        if (i < RECONNECT_DELAYS_MS.length) await new Promise((r) => setTimeout(r, RECONNECT_DELAYS_MS[i]));
      }
    }
    if (run !== this.reconnectRun || !this.stream) return;
    this.teardown();
    this.setState("failed", `Voice reconnect failed: ${(lastErr as Error)?.message ?? "unknown error"}`);
  }

  private async connectOnce(mode: OfferMode) {
    this.teardown();
    const gen = ++this.gen;
    const stream = this.stream!;
    const pc = this.deps.createPeer();
    this.pc = pc;
    pc.ontrack = (e) => this.setRemote(e.streams[0] ?? null);
    pc.onconnectionstatechange = () => {
      if (gen === this.gen) this.onPeerState(pc.connectionState);
    };
    this.senders = stream.getAudioTracks().map((track) => pc.addTrack(track, stream));
    pc.createDataChannel("oai-events");
    const offer = await pc.createOffer();
    await pc.setLocalDescription({ type: "offer", sdp: offer.sdp });
    const answer = await this.deps.postOffer(offer.sdp ?? "", mode);
    if (gen !== this.gen) return; // stopped or replaced meanwhile
    await pc.setRemoteDescription({ type: "answer", sdp: answer });
  }

  /**
   * Send another stream's audio to the DM without renegotiating (/table: the room mic alone, or the DM
   * mixer with remote players' voices, table/dmMixer.ts). The live call's senders switch now; a
   * reconnect builds with it; a pending standby keeps its senders muted and unmutes with it at the
   * swap. No call (`active` false): nothing to do, the next start gets its own stream.
   */
  replaceStream(stream: MediaStream) {
    if (!this.stream || this.stream === stream) return;
    this.stream = stream;
    const track = stream.getAudioTracks()[0] ?? null;
    for (const s of this.senders) void s.replaceTrack(track).catch((err: unknown) => console.warn("[voice] track swap failed:", (err as Error)?.message ?? err));
    if (track) for (const s of this.standby?.senders ?? []) s.track = track;
  }

  /** A standby call is being built or waits for the swap. */
  get handoverPending(): boolean {
    return !!this.standby;
  }

  /**
   * Build the standby call for a planned handover (server phase "prepare"). The new call hears
   * nothing (its senders are muted) and plays nothing until commitHandover(). Resolves true once
   * it is ready; false if there is no live call, or it was dropped or failed meanwhile.
   */
  prepareHandover(): Promise<boolean> {
    const stream = this.stream;
    if (!stream || !this.pc || this.state !== "connected") return Promise.resolve(false);
    this.abortHandover();
    const pc = this.deps.createPeer();
    const sb: Standby = { pc, senders: [], remote: null, ready: Promise.resolve(false) };
    this.standby = sb;
    pc.ontrack = (e) => {
      sb.remote = e.streams[0] ?? null;
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" && this.standby === sb) this.abortHandover();
    };
    for (const track of stream.getAudioTracks()) sb.senders.push({ sender: pc.addTrack(track, stream), track });
    sb.ready = (async () => {
      try {
        await Promise.all(sb.senders.map((s) => s.sender.replaceTrack(null)));
        pc.createDataChannel("oai-events");
        const offer = await pc.createOffer();
        await pc.setLocalDescription({ type: "offer", sdp: offer.sdp });
        const answer = await this.deps.postOffer(offer.sdp ?? "", "handover");
        if (this.standby !== sb) return false; // aborted, reconnected or stopped meanwhile
        await pc.setRemoteDescription({ type: "answer", sdp: answer });
        return this.standby === sb;
      } catch (err) {
        console.warn("[voice] handover standby failed:", (err as Error)?.message ?? err);
        if (this.standby === sb) this.abortHandover();
        return false;
      }
    })();
    return sb.ready;
  }

  /**
   * Swap to the standby call (server phase "swap"): unmute its senders, play its audio, close the
   * old peer and make the standby the current peer (the grace/reconnect handlers now watch it).
   * Resolves false when there was no ready standby; the old call is left as it was.
   */
  async commitHandover(): Promise<boolean> {
    const sb = this.standby;
    if (!sb || !(await sb.ready) || this.standby !== sb || !this.stream) return false;
    this.standby = undefined;
    const before = { gen: this.gen, run: this.reconnectRun };
    try {
      await Promise.all(sb.senders.map((s) => s.sender.replaceTrack(s.track)));
    } catch (err) {
      console.warn("[voice] handover unmute failed:", (err as Error)?.message ?? err);
    }
    if (!this.stream || this.gen !== before.gen || this.reconnectRun !== before.run) {
      sb.pc.close(); // stopped or reconnected while unmuting
      return false;
    }
    // Retire the old peer without the reconnect handlers firing for it.
    this.clearDisconnectTimer();
    const old = this.pc;
    if (old) {
      old.onconnectionstatechange = null;
      old.ontrack = null;
    }
    const gen = ++this.gen;
    const pc = sb.pc;
    this.pc = pc;
    this.senders = sb.senders.map((s) => s.sender);
    // A replaceStream while unmuting missed these senders (no longer standby, not yet live): catch up.
    const current = this.stream.getAudioTracks()[0] ?? null;
    for (const s of sb.senders) {
      if (current && s.track !== current) void s.sender.replaceTrack(current).catch((err: unknown) => console.warn("[voice] track swap failed:", (err as Error)?.message ?? err));
    }
    pc.ontrack = (e) => this.setRemote(e.streams[0] ?? null);
    pc.onconnectionstatechange = () => {
      if (gen === this.gen) this.onPeerState(pc.connectionState);
    };
    this.setRemote(sb.remote);
    old?.close();
    if (pc.connectionState === "failed" || pc.connectionState === "disconnected") this.onPeerState(pc.connectionState);
    console.info("[voice] voice line renewed");
    return true;
  }

  /** Drop the standby call (server phase "abort", or any reconnect/stop). The live call stays. */
  abortHandover() {
    const sb = this.standby;
    if (!sb) return;
    this.standby = undefined;
    sb.pc.onconnectionstatechange = null;
    sb.pc.ontrack = null;
    sb.pc.close();
  }

  private onPeerState(cs: string) {
    if (cs === "connected") {
      this.clearDisconnectTimer();
      this.setState("connected");
    } else if (cs === "disconnected") {
      if (this.disconnectTimer) return;
      this.disconnectTimer = setTimeout(() => {
        this.disconnectTimer = undefined;
        const now = this.pc?.connectionState;
        if (now === "disconnected" || now === "failed") void this.reconnect();
      }, DISCONNECT_GRACE_MS);
    } else if (cs === "failed") {
      void this.reconnect();
    }
  }

  private clearDisconnectTimer() {
    if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
    this.disconnectTimer = undefined;
  }

  private teardown() {
    this.abortHandover();
    this.clearDisconnectTimer();
    if (this.pc) {
      this.pc.onconnectionstatechange = null;
      this.pc.ontrack = null;
      this.pc.close();
    }
    this.pc = undefined;
    this.senders = [];
    this.setRemote(null);
  }

  stop() {
    this.gen++;
    this.reconnectRun++;
    this.stream = undefined;
    this.teardown();
    if (this.state !== "idle") this.setState("idle");
  }
}
