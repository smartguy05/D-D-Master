import { FLOOR_TAIL_MS, type FloorHolder, type FloorView } from "@dm/shared";

/**
 * What the voice DM hears from /table (docs/web/online-call.md#audio-into-the-dm): the room mic and
 * every remote player's voice from the call, mixed in WebAudio into one track that VoiceLink sends.
 *
 * - The room mic goes in at full level; push-to-talk and the mute already gate its track
 *   (useTableVoice, lib/floor.ts tableMicEnabled), exactly as before the mix.
 * - A remote player's voice goes through its own gain node: 1 only while that player holds the floor
 *   from outside the room (plus FLOOR_TAIL_MS after), 0 otherwise (gainPlan). Push-to-talk off is an
 *   open mic for everyone; the table mute silences everyone. Before the server's first floor event
 *   every remote voice is closed.
 * - An in-room player's phone mic (a micOnly member) is mixed the same way, but opens only on that
 *   player's own phone hold (`holder.phone`) plus the tail, with push-to-talk on or off: it is never an
 *   open mic (the TV is next to it), and the room mic closes meanwhile (lib/floor.ts roomHoldsFloor).
 * - The output stream is made once and kept for the page's life, so VoiceLink's reconnect, resume
 *   and handover (which re-add or replaceTrack this stream's track) keep working as before.
 * - The call sends the mix only while a remote player is in the call and the mixer's context runs
 *   (sendMixed; VoiceLink.replaceStream switches). Otherwise it sends the room mic itself, exactly as
 *   before: an in-room game never depends on WebAudio, and a TV nobody clicked yet (a suspended
 *   context) still hears the room.
 * Voice ID (MicStreamer) still gets the raw room mic only: remote players are known by the floor.
 */

/** A remote holder's voice stays audible this long after it lets go (same tail as the room mic). */
export interface RemoteTail {
  playerId: string;
  until: number;
}

/** Each remote member's gain toward the DM (by peer id). */
export function gainPlan(o: { floor: FloorView | null; muted: boolean; peers: { peerId: string; playerId?: string; micOnly?: boolean }[]; tail: RemoteTail | null; now: number }): Record<string, number> {
  const out: Record<string, number> = {};
  const h = o.floor?.holder ?? undefined;
  // No floor yet (page load, /ws reconnect) is closed: push-to-talk may be on, and the floor arrives at once.
  const open = !!o.floor && !o.floor.pushToTalk;
  for (const p of o.peers) {
    let on = open && !p.micOnly;
    if (!on && p.playerId) {
      const holds = !!h && "playerId" in h && h.playerId === p.playerId;
      // A remote page by its remote hold (push-to-talk on); a phone mic by its phone hold (either mode).
      if (holds && (p.micOnly ? !!h.phone : !h.inRoom && !!o.floor?.pushToTalk)) on = true;
      else if (o.tail && o.tail.playerId === p.playerId && o.now < o.tail.until) on = true;
    }
    out[p.peerId] = o.muted ? 0 : on ? 1 : 0;
  }
  return out;
}

/** The voice call sends the mix (else the room mic alone). */
/** `remotePlayers`: remote pages and phone mics in the call. */
export function sendMixed(o: { remotePlayers: number; mixerRunning: boolean }): boolean {
  return o.remotePlayers > 0 && o.mixerRunning;
}

/** A new tail when a remote or phone-mic holder stopped holding (released, or someone else has the floor now); else the old one. */
export function remoteTail(prev: FloorHolder | null, holder: FloorHolder | null, now: number, tail: RemoteTail | null): RemoteTail | null {
  if (!prev || !("playerId" in prev) || (prev.inRoom && !prev.phone)) return tail;
  if (holder && "playerId" in holder && holder.playerId === prev.playerId) return tail;
  return { playerId: prev.playerId, until: now + FLOOR_TAIL_MS };
}

/** The browser pieces the mixer uses (tests inject a fake graph). */
export interface MixerAudio {
  createContext(): AudioContext;
  /**
   * Play a remote stream through a muted media element: Chrome only feeds a remote WebRTC track to
   * WebAudio while an element plays it. Returns the function that detaches it.
   */
  attachSink(stream: MediaStream): () => void;
}

function browserAudio(): MixerAudio {
  return {
    createContext: () => new AudioContext(),
    attachSink: (stream) => {
      const el = document.createElement("audio");
      el.muted = true;
      el.srcObject = stream;
      void el.play().catch(() => undefined);
      return () => {
        el.pause();
        el.srcObject = null;
      };
    },
  };
}

interface PeerSource {
  playerId?: string;
  micOnly?: boolean;
  stream: MediaStream;
  src: AudioNode;
  gain: GainNode;
  detach: () => void;
}

/** Gain changes ramp over ~15 ms, so opening a voice doesn't click. */
const RAMP_S = 0.015;

export class DmMixer {
  private ctx?: AudioContext;
  private dest?: MediaStreamAudioDestinationNode;
  private room?: { stream: MediaStream; src?: AudioNode };
  private stateListeners = new Set<() => void>();
  private peers = new Map<string, PeerSource>();
  private floor: FloorView | null = null;
  private muted = false;
  private holder: FloorHolder | null = null;
  private tail: RemoteTail | null = null;
  private now = 0;
  private readonly audio: MixerAudio;

  constructor(audio: Partial<MixerAudio> = {}) {
    this.audio = { ...browserAudio(), ...audio };
  }

  private graph(): { ctx: AudioContext; dest: MediaStreamAudioDestinationNode } {
    if (!this.ctx || !this.dest) {
      const ctx = this.audio.createContext();
      this.ctx = ctx;
      this.dest = ctx.createMediaStreamDestination();
      ctx.onstatechange = () => this.stateListeners.forEach((fn) => fn());
      if (this.room) {
        this.room.src = ctx.createMediaStreamSource(this.room.stream);
        this.room.src.connect(this.dest);
      }
      this.resume();
    }
    return { ctx: this.ctx, dest: this.dest };
  }

  /** The graph exists and its context runs (a click unlocked audio): the mix can go to the DM. */
  get running(): boolean {
    return this.ctx?.state === "running";
  }

  /** The context started or stopped; returns an unsubscribe function. */
  onStateChange(fn: () => void): () => void {
    this.stateListeners.add(fn);
    return () => void this.stateListeners.delete(fn);
  }

  /** The mixed stream: what VoiceLink sends to the DM. The same object for the mixer's life. */
  get stream(): MediaStream {
    return this.graph().dest.stream;
  }

  /** Start the context (made before a gesture, it waits suspended). */
  resume() {
    if (this.ctx?.state === "suspended") void this.ctx.resume().catch(() => undefined);
  }

  /** The room mic (null: released). It joins the graph once a remote voice made one. */
  setRoom(stream: MediaStream | null) {
    if (this.room?.stream === stream) return;
    this.room?.src?.disconnect();
    this.room = stream ? { stream } : undefined;
    if (!stream || !this.ctx || !this.dest) return;
    this.room!.src = this.ctx.createMediaStreamSource(stream);
    this.room!.src.connect(this.dest);
  }

  /** A remote member's (or a phone mic's, `micOnly`) incoming voice (null: gone, or no audio yet). */
  setPeer(peerId: string, playerId: string | undefined, stream: MediaStream | null, micOnly = false) {
    const old = this.peers.get(peerId);
    if (old && old.stream === stream && old.playerId === playerId && !!old.micOnly === micOnly) return;
    if (old) {
      old.src.disconnect();
      old.gain.disconnect();
      old.detach();
      this.peers.delete(peerId);
    }
    if (!stream) return;
    const { ctx, dest } = this.graph();
    const detach = this.audio.attachSink(stream);
    const src = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    src.connect(gain);
    gain.connect(dest);
    const p: PeerSource = { playerId, ...(micOnly && { micOnly }), stream, src, gain, detach };
    this.peers.set(peerId, p);
    this.setGain(p, this.plan()[peerId] ?? 0, true);
  }

  /** Drop every remote voice not in this list (members who left the call). */
  retain(peerIds: string[]) {
    const keep = new Set(peerIds);
    for (const id of [...this.peers.keys()]) if (!keep.has(id)) this.setPeer(id, undefined, null);
  }

  /**
   * The push-to-talk floor and the table mute changed (or a tail ran out): set every remote gain.
   * Returns how many ms until a tail ends (call again then), or 0.
   */
  applyFloor(floor: FloorView | null, muted: boolean, now: number): number {
    // With push-to-talk off only a phone mic holds the floor (and gets a tail).
    const holder = floor?.holder ?? null;
    this.tail = remoteTail(this.holder, holder, now, this.tail);
    this.holder = holder;
    this.floor = floor;
    this.muted = muted;
    this.now = now;
    const plan = this.plan();
    for (const [id, p] of this.peers) this.setGain(p, plan[id] ?? 0);
    return this.tail && now < this.tail.until ? this.tail.until - now : 0;
  }

  private plan() {
    const peers = [...this.peers].map(([peerId, p]) => ({ peerId, playerId: p.playerId, micOnly: p.micOnly }));
    return gainPlan({ floor: this.floor, muted: this.muted, peers, tail: this.tail, now: this.now });
  }

  private setGain(p: PeerSource, v: number, initial = false) {
    if (initial) p.gain.gain.value = v;
    p.gain.gain.setTargetAtTime(v, this.ctx?.currentTime ?? 0, RAMP_S);
  }

  /** Release everything (the page unmounts). */
  close() {
    for (const id of [...this.peers.keys()]) this.setPeer(id, undefined, null);
    this.setRoom(null);
    void this.ctx?.close().catch(() => undefined);
    this.ctx = undefined;
    this.dest = undefined;
  }
}
