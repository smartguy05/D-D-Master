/**
 * Host-side audio:
 *  - MicStreamer: sends the shared table mic to the server as 16 kHz PCM16 (voice ID + enrollment).
 *  - VoiceLink: WebRTC call to OpenAI Realtime (the server creates the call with its API key
 *    and attaches a sideband socket that runs all tools).
 */

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

export class MicStreamer {
  private ctx?: AudioContext;
  private ws?: WebSocket;
  private node?: AudioWorkletNode;
  level = 0;

  async start(stream: MediaStream) {
    this.ctx = new AudioContext();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    await this.ctx.audioWorklet.addModule(url);
    const src = this.ctx.createMediaStreamSource(stream);
    this.node = new AudioWorkletNode(this.ctx, "pcm16-downsampler");
    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(`${proto}://${location.host}/ws/audio`);
    this.ws.binaryType = "arraybuffer";
    this.node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      const pcm = new Int16Array(e.data);
      let peak = 0;
      for (let i = 0; i < pcm.length; i += 8) peak = Math.max(peak, Math.abs(pcm[i]));
      this.level = peak / 32768;
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(e.data);
    };
    src.connect(this.node);
  }

  stop() {
    this.node?.disconnect();
    this.ws?.close();
    void this.ctx?.close();
  }
}

export type VoiceLinkState = "idle" | "connecting" | "connected" | "reconnecting" | "failed";

/** The RTCPeerConnection surface VoiceLink uses (lets tests inject a fake). */
export interface PeerLike {
  readonly connectionState: string;
  ontrack: ((e: { streams: readonly MediaStream[] }) => void) | null;
  onconnectionstatechange: (() => void) | null;
  addTrack(track: MediaStreamTrack, stream: MediaStream): unknown;
  createDataChannel(label: string): unknown;
  createOffer(): Promise<{ sdp?: string }>;
  setLocalDescription(desc: { type: "offer"; sdp?: string }): Promise<void>;
  setRemoteDescription(desc: { type: "answer"; sdp: string }): Promise<void>;
  close(): void;
}

export interface VoiceLinkDeps {
  createPeer(): PeerLike;
  /** POST the SDP offer to the server; resolves with the SDP answer or throws the server error. */
  postOffer(sdp: string, resume: boolean): Promise<string>;
  playRemote(stream: MediaStream | null): void;
}

/** A "disconnected" peer gets this long to recover by itself before we build a new call. */
export const DISCONNECT_GRACE_MS = 5000;
/** Waits between automatic reconnect attempts (the first attempt is immediate). */
export const RECONNECT_DELAYS_MS = [1000, 2000, 4000];

async function postOfferToServer(sdp: string, resume: boolean): Promise<string> {
  const res = await fetch(`/api/dm/voice${resume ? "?resume=1" : ""}`, { method: "POST", headers: { "content-type": "application/sdp" }, body: sdp });
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
      }
      audioEl.srcObject = stream;
    },
  };
}

/**
 * WebRTC call to OpenAI Realtime. The server creates the call with its API key and attaches a
 * sideband socket that runs all tools. If the peer connection fails (or stays "disconnected" for
 * DISCONNECT_GRACE_MS) it builds a new call with `?resume=1`, so the DM continues where it was.
 */
export class VoiceLink {
  state: VoiceLinkState = "idle";
  error?: string;
  private pc?: PeerLike;
  private stream?: MediaStream;
  private gen = 0;
  private disconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectRun = 0;
  private listeners = new Set<(state: VoiceLinkState) => void>();
  private deps: VoiceLinkDeps;

  constructor(deps: Partial<VoiceLinkDeps> = {}) {
    this.deps = { ...browserDeps(), ...deps };
  }

  /** Listen for state changes; returns an unsubscribe function. */
  subscribe(fn: (state: VoiceLinkState) => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
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
      await this.connectOnce(false);
    } catch (err) {
      this.stop();
      throw err;
    }
  }

  /** Build a new call (automatic on failure, or the host's manual Reconnect button). */
  async reconnect(): Promise<void> {
    if (!this.stream) return;
    const run = ++this.reconnectRun;
    this.clearDisconnectTimer();
    this.setState("reconnecting");
    let lastErr: unknown;
    for (let i = 0; i <= RECONNECT_DELAYS_MS.length; i++) {
      if (run !== this.reconnectRun || !this.stream) return;
      try {
        await this.connectOnce(true);
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

  private async connectOnce(resume: boolean) {
    this.teardown();
    const gen = ++this.gen;
    const stream = this.stream!;
    const pc = this.deps.createPeer();
    this.pc = pc;
    pc.ontrack = (e) => this.deps.playRemote(e.streams[0]);
    pc.onconnectionstatechange = () => {
      if (gen === this.gen) this.onPeerState(pc.connectionState);
    };
    for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);
    pc.createDataChannel("oai-events");
    const offer = await pc.createOffer();
    await pc.setLocalDescription({ type: "offer", sdp: offer.sdp });
    const answer = await this.deps.postOffer(offer.sdp ?? "", resume);
    if (gen !== this.gen) return; // stopped or replaced meanwhile
    await pc.setRemoteDescription({ type: "answer", sdp: answer });
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
    this.clearDisconnectTimer();
    if (this.pc) {
      this.pc.onconnectionstatechange = null;
      this.pc.ontrack = null;
      this.pc.close();
    }
    this.pc = undefined;
    this.deps.playRemote(null);
  }

  stop() {
    this.gen++;
    this.reconnectRun++;
    this.stream = undefined;
    this.teardown();
    if (this.state !== "idle") this.setState("idle");
  }
}
