import { useEffect, useMemo, useRef, useState } from "react";
import type { FloorView, GameState, PeerInfo } from "@dm/shared";
import { markAudioLocked, onAudioLockChange } from "../dice/sound";
import { isAutoplayBlocked } from "../lib/audioUnlock";
import { LevelMeter, onUserGesture } from "./levelMeter";
import { nextTalking, stripTiles, tileView, type TileView } from "./tiles";
import type { CallModel } from "./useCall";
import "./call.css";

/**
 * The call's tiles (docs/web/online-call.md): on /play along the bottom of the map, on the TV as a side
 * strip. Each member is a tile with its video, or its character card (sprite or color dot, name, HP,
 * conditions) when the camera is off or "character instead" is on; a ring while it talks (a local level
 * meter) and a gold ring for the push-to-talk holder. The own tile has the toggles. Every remote voice
 * (and on /play the DM's voice from the room) plays here through an <audio> element.
 */
export function VideoStrip({ call, state, floor, variant }: { call: CallModel; state: GameState | null; floor: FloorView | null; variant: "play" | "table" }) {
  const meter = useRef<LevelMeter>();
  meter.current ??= new LevelMeter();
  const [talking, setTalking] = useState<Record<string, boolean>>({});
  // Phone mics (in-room players talking through their phone) have no tile and are never played here.
  const peers = useMemo(() => call.peers.filter((p) => !p.micOnly), [call.peers]);
  const tiles = stripTiles(peers, call.self);

  // Feed the level meter: the own mic under the own peer id, every remote mic under its peer id; drop
  // the members who left (their nodes would pile up over a long session).
  useEffect(() => {
    const m = meter.current!;
    for (const p of peers) m.watch(p.peerId, p.peerId === call.self ? call.localMic : call.media(p.peerId)?.mic);
    m.prune(new Set(peers.map((p) => p.peerId)));
  });
  // Resume the meter's context on the page's sound unlock and on any gesture (iOS Safari keeps it suspended).
  useEffect(() => {
    const m = meter.current!;
    const offGesture = onUserGesture(window, () => m.resume());
    const off = onAudioLockChange((unlocked) => unlocked && m.resume());
    return () => {
      off();
      offGesture();
    };
  }, []);
  useEffect(() => {
    const m = meter.current!;
    const t = setInterval(() => {
      setTalking((prev) => {
        let changed = false;
        const next: Record<string, boolean> = {};
        for (const p of peers) {
          next[p.peerId] = nextTalking(!!prev[p.peerId], m.level(p.peerId));
          if (next[p.peerId] !== !!prev[p.peerId]) changed = true;
        }
        return changed || Object.keys(prev).length !== Object.keys(next).length ? next : prev;
      });
    }, 120);
    return () => clearInterval(t);
  }, [peers]);
  useEffect(() => () => meter.current?.close(), []);

  if (!call.self) {
    // The seat went to another page: stay out until this device takes it back.
    if (call.displaced)
      return (
        <div className={`call-strip ${variant === "table" ? "call-side" : "call-row"}`}>
          <div className="call-note muted">
            📵 {call.refused ?? "In the call on another device."}{" "}
            <button type="button" onClick={call.takeSeat}>
              Use this device
            </button>
          </div>
        </div>
      );
    return call.refused && variant === "play" ? (
      <div className="call-strip call-row">
        <div className="call-note muted">📵 {call.refused}</div>
      </div>
    ) : null;
  }
  return (
    <div className={`call-strip ${variant === "table" ? "call-side" : "call-row"}`} data-version={call.version}>
      {tiles.map((p) => {
        const self = p.peerId === call.self;
        const media = self ? undefined : call.media(p.peerId);
        const video = self ? call.localCam : media?.cam;
        const live = !!video && (self || !video.getVideoTracks().every((t) => t.muted));
        const view = tileView({ peer: p, state, floor, talking: !!talking[p.peerId], self, hasVideo: live });
        return (
          <Tile key={p.peerId} view={view} video={video ?? null} state={media?.state}>
            {!self && media?.mic && <PeerAudio stream={media.mic} />}
            {!self && media?.dm && <PeerAudio stream={media.dm} />}
            {self && <OwnToggles call={call} peer={p} variant={variant} />}
          </Tile>
        );
      })}
      {call.error && <div className="call-note bad">{call.error}</div>}
    </div>
  );
}

function Tile({ view, video, state, children }: { view: TileView; video: MediaStream | null; state?: RTCPeerConnectionState; children?: React.ReactNode }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || el.srcObject === video) return;
    el.srcObject = video;
    if (video) void el.play().catch(() => undefined);
  }, [video, view.video]);
  const hpFrac = view.hp ? Math.max(0, Math.min(1, view.hp.hp / view.hp.max)) : 0;
  const waiting = !view.self && state && state !== "connected";
  return (
    <div className={`call-tile ${view.talking ? "talking" : ""} ${view.floor ? "floor" : ""} ${view.self ? "self" : ""}`} style={{ borderColor: view.color }}>
      <video ref={ref} className={view.video ? "" : "hidden"} autoPlay muted playsInline />
      {!view.video && (
        <div className="call-card">
          {view.spriteUrl ? <img src={view.spriteUrl} alt="" /> : <span className="call-dot" style={{ background: view.color }}>{view.room ? "🎲" : ""}</span>}
        </div>
      )}
      <div className="call-label">
        <b>{view.title}</b>
        {view.subtitle && <span className="muted"> {view.subtitle}</span>}
        {view.micOff && <span title="Muted toward the players"> 🔇</span>}
        {view.hp && (
          <div className="call-hp" title={`${view.hp.hp}/${view.hp.max} HP`}>
            <i className={hpFrac > 0.5 ? "ok" : hpFrac > 0.25 ? "warn" : "bad"} style={{ width: `${hpFrac * 100}%` }} />
          </div>
        )}
        {view.conditions.length > 0 && <div className="call-conds">{view.conditions.join(", ")}</div>}
      </div>
      {waiting && <span className="call-state">{state === "failed" ? "can't connect" : "connecting…"}</span>}
      {children}
    </div>
  );
}

/** Own-tile toggles, saved per device: camera, the character card instead, mute toward the players. */
function OwnToggles({ call, peer, variant }: { call: CallModel; peer: PeerInfo; variant: "play" | "table" }) {
  const { prefs, setPrefs } = call;
  return (
    <div className="call-toggles">
      <button type="button" className={prefs.camera ? "active" : ""} title={prefs.camera ? "Turn the camera off" : "Turn the camera on"} onClick={() => setPrefs({ ...prefs, camera: !prefs.camera })}>
        {prefs.camera ? "📷" : "🚫"}
      </button>
      {variant === "play" && !peer.room && (
        <button type="button" className={prefs.showCharacter ? "active" : ""} title="Show your character instead of the camera" onClick={() => setPrefs({ ...prefs, showCharacter: !prefs.showCharacter })}>
          🧙
        </button>
      )}
      <button type="button" className={prefs.micOn ? "" : "active"} title={prefs.micOn ? "Mute toward the other players. While you hold talk-to-the-DM, the DM and the room still hear you." : "Unmute toward the players"} onClick={() => setPrefs({ ...prefs, micOn: !prefs.micOn })}>
        {prefs.micOn ? "🎙" : "🔇"}
      </button>
    </div>
  );
}

/** Plays one remote voice; a refused autoplay asks for the page's sound click, which retries it. */
function PeerAudio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    const play = () => void el.play().catch((err: unknown) => isAutoplayBlocked(err) && markAudioLocked());
    play();
    const off = onAudioLockChange((unlocked) => unlocked && el.paused && play());
    return () => {
      off();
      el.srcObject = null;
    };
  }, [stream]);
  return <audio ref={ref} autoPlay />;
}
