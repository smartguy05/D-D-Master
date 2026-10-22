import { useEffect, useMemo, useRef, useState } from "react";
import { type FloorView, type PeerInfo, type PeerPrefs } from "@dm/shared";
import { api } from "../lib/api";
import { tailAfter } from "../lib/floor";
import { getTableMic } from "../lib/voice";
import { onPeers, onRtc, sendToServer } from "../lib/useServer";
import { holdsOwnFloor } from "../lib/rtc/mesh";
import { PeerMesh, type RemoteMedia } from "../lib/rtc/peerMesh";
import { callPrefsKey, DEFAULT_PLAY_PREFS, DEFAULT_TABLE_PREFS, loadCallPrefs, saveCallPrefs } from "./tiles";

/**
 * The page's side of the WebRTC call (docs/web/online-call.md): joins over /ws (rtc_join), keeps a
 * PeerMesh in step with the server's member list, opens the mic and camera, and hands the page what to
 * draw. /play joins as its seat; /table as the room, sending the DM's voice too (`dmTrack`).
 */
export interface CallOptions {
  page: "play" | "table";
  connected: boolean;
  floor: FloorView | null;
  /** /play: this page's seat. */
  playerId?: string;
  /** /table: the voice DM's audio, forwarded to every remote player. */
  dmTrack?: MediaStreamTrack | null;
}

export interface CallModel {
  self: string | null;
  peers: PeerInfo[];
  refused?: string;
  prefs: PeerPrefs;
  setPrefs(p: PeerPrefs): void;
  localMic: MediaStream | null;
  localCam: MediaStream | null;
  media(peerId: string): RemoteMedia | undefined;
  /** Bumped on every change (remote tracks, connection states). */
  version: number;
  error?: string;
}

const storage = (): Storage | undefined => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

export function useCall(o: CallOptions): CallModel {
  const key = callPrefsKey(o.page);
  const [prefs, setPrefsState] = useState<PeerPrefs>(() => loadCallPrefs(storage(), key, o.page === "play" ? DEFAULT_PLAY_PREFS : DEFAULT_TABLE_PREFS));
  const [mesh, setMesh] = useState<PeerMesh | null>(null);
  const [members, setMembers] = useState<{ self: string | null; peers: PeerInfo[]; refused?: string }>({ self: null, peers: [] });
  const [version, setVersion] = useState(0);
  const [localMic, setLocalMic] = useState<MediaStream | null>(null);
  const [localCam, setLocalCam] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string>();
  const tailUntil = useRef(0);
  const wasHolding = useRef(false);

  // The mesh is made once the ICE servers are known (GET /api/rtc/config).
  useEffect(() => {
    let alive = true;
    let made: PeerMesh | undefined;
    let latest: { self: string | null; peers: PeerInfo[] } | undefined;
    const pending: Parameters<Parameters<typeof onRtc>[0]>[0][] = [];
    const offRtc = onRtc((ev) => (made ? made.signal(ev.from, ev.signal) : pending.push(ev)));
    const offPeers = onPeers((ev) => {
      latest = ev;
      setMembers({ self: ev.self, peers: ev.peers, refused: ev.refused });
      made?.update(ev.self, ev.peers);
    });
    api<{ iceServers: RTCIceServer[] }>("/rtc/config")
      .catch(() => ({ iceServers: [] as RTCIceServer[] }))
      .then(({ iceServers }) => {
        if (!alive) return;
        made = new PeerMesh({ iceServers, send: (to, signal) => sendToServer({ type: "rtc", to, signal }), onChange: () => setVersion((v) => v + 1) });
        if (latest) made.update(latest.self, latest.peers);
        for (const ev of pending.splice(0)) made.signal(ev.from, ev.signal);
        setMesh(made);
      });
    return () => {
      alive = false;
      offRtc();
      offPeers();
      sendToServer({ type: "rtc_leave" });
      made?.close();
    };
  }, []);

  // Join (and re-join after a /ws reconnect); a prefs change updates what the others see.
  useEffect(() => {
    if (!mesh || !o.connected) return;
    mesh.setPrefs(prefs);
    sendToServer({ type: "rtc_join", prefs: { ...prefs, camera: prefs.camera && !!localCam }, ...(o.playerId && { playerId: o.playerId }) });
  }, [mesh, o.connected, prefs, localCam, o.playerId]);

  const joined = members.self !== null;
  const others = members.peers.filter((p) => p.peerId !== members.self).length;
  // The mic opens once there is someone to talk to (/play: as soon as it joined, so the prompt comes early).
  const wantMic = joined && (o.page === "play" || others > 0);
  useEffect(() => {
    if (!wantMic || localMic) return;
    let alive = true;
    getTableMic()
      .then((s) => (alive ? setLocalMic(s) : s.getTracks().forEach((t) => t.stop())))
      .catch((err: Error) => setError(`Microphone: ${err.message}`));
    return () => {
      alive = false;
    };
  }, [wantMic, localMic]);
  useEffect(() => () => localMic?.getTracks().forEach((t) => t.stop()), [localMic]);

  const wantCam = joined && prefs.camera;
  useEffect(() => {
    if (!wantCam) {
      setLocalCam(null);
      return;
    }
    let alive = true;
    let got: MediaStream | undefined;
    navigator.mediaDevices
      .getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { max: 24 } } })
      .then((s) => {
        got = s;
        if (alive) setLocalCam(s);
        else s.getTracks().forEach((t) => t.stop());
      })
      .catch((err: Error) => setError(`Camera: ${err.message}`));
    return () => {
      alive = false;
      got?.getTracks().forEach((t) => t.stop());
    };
  }, [wantCam]);

  useEffect(() => mesh?.setLocal("mic", localMic?.getAudioTracks()[0] ?? null), [mesh, localMic]);
  useEffect(() => mesh?.setLocal("cam", localCam?.getVideoTracks()[0] ?? null), [mesh, localCam]);
  useEffect(() => mesh?.setLocal("dm", o.dmTrack ?? null), [mesh, o.dmTrack]);

  // /play: holding the floor (plus the tail) keeps the mic going to the room even when muted toward the players.
  useEffect(() => {
    if (!mesh || o.page !== "play") return;
    const now = Date.now();
    const holding = holdsOwnFloor(o.floor, o.playerId, 0, now);
    tailUntil.current = tailAfter(wasHolding.current, holding, now, tailUntil.current);
    wasHolding.current = holding;
    mesh.setHoldingFloor(holdsOwnFloor(o.floor, o.playerId, tailUntil.current, now));
    const left = tailUntil.current - now;
    if (left <= 0) return;
    const t = setTimeout(() => mesh.setHoldingFloor(holdsOwnFloor(o.floor, o.playerId, tailUntil.current, Date.now())), left + 5);
    return () => clearTimeout(t);
  }, [mesh, o.floor, o.playerId, o.page]);

  const setPrefs = (p: PeerPrefs) => {
    saveCallPrefs(storage(), key, p);
    setPrefsState(p);
  };

  return useMemo(
    () => ({ self: members.self, peers: members.peers, refused: members.refused, prefs, setPrefs, localMic, localCam, media: (id: string) => mesh?.media(id), version, error }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [members, prefs, localMic, localCam, mesh, version, error],
  );
}
