import type { PeerInfo, PeerPrefs, RtcIceCandidate, RtcSignal } from "@dm/shared";
import { isPolite, meshDiff, SLOTS, slotOf, slotTrack, videoEncoding, type Slot } from "./mesh";

/**
 * The call's RTCPeerConnection glue (docs/web/online-call.md): one connection per other member, the
 * rules in mesh.ts. Perfect negotiation per pair; the impolite side adds the three slot transceivers
 * (mic, DM voice, camera) and the polite side answers with the same three, so tracks only ever change
 * with replaceTrack. Signaling goes over /ws (the server relays it, rtcRelay.ts).
 */

export interface RemoteMedia {
  mic?: MediaStream;
  dm?: MediaStream;
  cam?: MediaStream;
  state: RTCPeerConnectionState;
}

interface Link {
  peer: PeerInfo;
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  remote: Partial<Record<Slot, MediaStream>>;
  /** What each slot's sender carries now (undefined: never set). */
  sent: Partial<Record<Slot, MediaStreamTrack | null>>;
  /** Signals are handled one at a time (a candidate must wait for the offer before it). */
  queue: Promise<void>;
}

export interface PeerMeshOptions {
  iceServers: RTCIceServer[];
  /** Send a signal to another member over /ws; false while the socket is down. */
  send(to: string, signal: RtcSignal): boolean;
  /** A connection, a remote track or the member list changed (the page re-renders). */
  onChange(): void;
}

const warn = (what: string) => (err: unknown) => console.warn(`[call] ${what}:`, (err as Error)?.message ?? err);

export class PeerMesh {
  self: string | null = null;
  peers: PeerInfo[] = [];
  private links = new Map<string, Link>();
  private local: Record<Slot, MediaStreamTrack | null> = { mic: null, dm: null, cam: null };
  private prefs: PeerPrefs = { camera: false, showCharacter: false, micOn: true };
  private holdingFloor = false;

  constructor(private readonly opts: PeerMeshOptions) {}

  /** The server's member list (a `peers` event): open and close connections to match it. */
  update(self: string | null, peers: PeerInfo[]) {
    if (self !== this.self) for (const id of [...this.links.keys()]) this.closeLink(id);
    this.self = self;
    this.peers = self ? peers : [];
    const { open, close } = meshDiff(this.links.keys(), self, this.peers);
    for (const id of close) this.closeLink(id);
    for (const p of open) this.openLink(p);
    for (const p of this.peers) {
      const link = this.links.get(p.peerId);
      if (link) link.peer = p;
    }
    this.links.forEach((l) => this.applyTracks(l));
    this.opts.onChange();
  }

  /** A local track for one slot (null: none); every connection's sender follows. */
  setLocal(slot: Slot, track: MediaStreamTrack | null) {
    if (this.local[slot] === track) return;
    this.local[slot] = track;
    this.links.forEach((l) => this.applyTracks(l));
  }

  /** This page's prefs (camera on air, character instead, mic toward the players). */
  setPrefs(prefs: PeerPrefs) {
    this.prefs = prefs;
    this.links.forEach((l) => this.applyTracks(l));
  }

  /** This player talks to the DM (holds the floor, or its tail): the mic reaches the room even when muted toward the players. */
  setHoldingFloor(holding: boolean) {
    if (this.holdingFloor === holding) return;
    this.holdingFloor = holding;
    this.links.forEach((l) => this.applyTracks(l));
  }

  /** A signal relayed from another member. */
  signal(from: string, signal: RtcSignal) {
    const link = this.links.get(from);
    if (!link) return;
    link.queue = link.queue.then(() => this.handle(link, signal)).catch(warn(`signal from ${from}`));
  }

  /** What one member sends this page. */
  media(peerId: string): RemoteMedia | undefined {
    const l = this.links.get(peerId);
    return l && { ...l.remote, state: l.pc.connectionState };
  }

  close() {
    for (const id of [...this.links.keys()]) this.closeLink(id);
    this.self = null;
    this.peers = [];
  }

  private async handle(link: Link, signal: RtcSignal) {
    if (this.links.get(link.peer.peerId) !== link) return;
    const pc = link.pc;
    if ("description" in signal) {
      const d = signal.description;
      const collision = d.type === "offer" && (link.makingOffer || pc.signalingState !== "stable");
      link.ignoreOffer = !link.polite && collision;
      if (link.ignoreOffer) return;
      await pc.setRemoteDescription(d as RTCSessionDescriptionInit);
      if (d.type === "offer") {
        // The polite side's transceivers come from the offer: send on them too.
        for (const t of pc.getTransceivers()) if (t.direction !== "sendrecv" && t.direction !== "stopped") t.direction = "sendrecv";
        link.sent = {};
        this.applyTracks(link);
        await pc.setLocalDescription();
        this.sendDescription(link);
      }
      return;
    }
    try {
      await pc.addIceCandidate(signal.candidate ?? undefined);
    } catch (err) {
      if (!link.ignoreOffer) throw err;
    }
  }

  private sendDescription(link: Link) {
    const d = link.pc.localDescription;
    if (!d || (d.type !== "offer" && d.type !== "answer")) return;
    this.opts.send(link.peer.peerId, { description: { type: d.type, sdp: d.sdp } });
  }

  private openLink(peer: PeerInfo) {
    const pc = new RTCPeerConnection({ iceServers: this.opts.iceServers });
    const polite = isPolite(this.self ?? "", peer.peerId);
    const link: Link = { peer, pc, polite, makingOffer: false, ignoreOffer: false, remote: {}, sent: {}, queue: Promise.resolve() };
    this.links.set(peer.peerId, link);
    pc.onicecandidate = (e) => {
      this.opts.send(peer.peerId, { candidate: e.candidate ? (e.candidate.toJSON() as RtcIceCandidate) : null });
    };
    pc.onnegotiationneeded = async () => {
      try {
        link.makingOffer = true;
        await pc.setLocalDescription();
        this.sendDescription(link);
      } catch (err) {
        warn(`offer to ${peer.peerId}`)(err);
      } finally {
        link.makingOffer = false;
      }
    };
    pc.ontrack = (e) => {
      const slot = slotOf(pc.getTransceivers().indexOf(e.transceiver));
      if (!slot) return;
      link.remote[slot] = new MediaStream([e.track]);
      e.track.onunmute = () => this.opts.onChange();
      e.track.onmute = () => this.opts.onChange();
      this.opts.onChange();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" && !polite) pc.restartIce();
      if (pc.connectionState === "connected") this.encodeVideo(link);
      this.opts.onChange();
    };
    if (!polite) {
      // The impolite side builds the connection: one transceiver per slot, in SLOTS order.
      for (const slot of SLOTS) pc.addTransceiver(slot === "cam" ? "video" : "audio", { direction: "sendrecv" });
      this.applyTracks(link);
    }
  }

  private closeLink(id: string) {
    const link = this.links.get(id);
    if (!link) return;
    this.links.delete(id);
    link.pc.onicecandidate = null;
    link.pc.onnegotiationneeded = null;
    link.pc.ontrack = null;
    link.pc.onconnectionstatechange = null;
    link.pc.close();
  }

  /** Point each slot's sender at the track it should carry toward this member. */
  private applyTracks(link: Link) {
    const ts = link.pc.getTransceivers();
    SLOTS.forEach((slot, i) => {
      const t = ts[i];
      if (!t || t.direction === "stopped") return;
      const track = slotTrack(slot, { local: this.local, prefs: this.prefs, towardRoom: link.peer.room, holdingFloor: this.holdingFloor, towardMicOnly: !!link.peer.micOnly });
      if (link.sent[slot] === track) return;
      link.sent[slot] = track;
      void t.sender
        .replaceTrack(track)
        .then(() => slot === "cam" && this.encodeVideo(link))
        .catch(warn(`${slot} to ${link.peer.peerId}`));
    });
  }

  /** 360p at ~300 kbps (videoEncoding), once the sender has its encodings. */
  private encodeVideo(link: Link) {
    const t = link.pc.getTransceivers()[SLOTS.indexOf("cam")];
    const track = t?.sender.track;
    if (!t || !track) return;
    const params = t.sender.getParameters();
    if (!params.encodings?.length) return;
    const want = videoEncoding(track.getSettings().height);
    const enc = params.encodings[0];
    if (enc.maxBitrate === want.maxBitrate && enc.scaleResolutionDownBy === want.scaleResolutionDownBy) return;
    Object.assign(enc, want);
    void t.sender.setParameters(params).catch(warn("video encoding"));
  }
}
