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

export class VoiceLink {
  private pc?: RTCPeerConnection;
  private audioEl?: HTMLAudioElement;

  async start(stream: MediaStream) {
    const pc = new RTCPeerConnection();
    this.pc = pc;
    this.audioEl = document.createElement("audio");
    this.audioEl.autoplay = true;
    pc.ontrack = (e) => {
      this.audioEl!.srcObject = e.streams[0];
    };
    for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);
    pc.createDataChannel("oai-events");
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const res = await fetch("/api/dm/voice", { method: "POST", headers: { "content-type": "application/sdp" }, body: offer.sdp });
    const text = await res.text();
    if (!res.ok) {
      this.stop();
      throw new Error((() => {
        try {
          return JSON.parse(text).error;
        } catch {
          return text;
        }
      })());
    }
    await pc.setRemoteDescription({ type: "answer", sdp: text });
  }

  stop() {
    this.pc?.getSenders().forEach((s) => this.pc?.removeTrack(s));
    this.pc?.close();
    this.pc = undefined;
    if (this.audioEl) this.audioEl.srcObject = null;
  }
}
