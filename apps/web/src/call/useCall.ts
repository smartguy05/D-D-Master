import { useEffect, useMemo, useRef, useState } from "react";
import { type FloorView, type PeerInfo, type PeerPrefs } from "@dm/shared";
import { api } from "../lib/api";
import { tailAfter } from "../lib/floor";
import { getTableMic } from "../lib/voice";
import { onPeers, onRtc, sendToServer } from "../lib/useServer";
import { holdsOwnFloor } from "../lib/rtc/mesh";
import { PeerMesh, type RemoteMedia } from "../lib/rtc/peerMesh";
import { callPrefsKey, DEFAULT_PLAY_PREFS, DEFAULT_TABLE_PREFS, loadCallPrefs, saveCallPrefs } from "./tiles";
import { displacedAfter, micStep, ownPrefsStale, RESYNC_RETRY_MS, shouldJoin } from "./callSteps";
import { cameraFailure, micFailure, nextCameraError, shownCallError, type CallErrors, type CameraEvent } from "./mediaErrors";

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
  /** This seat joined from another page: no rejoin until `takeSeat` ("Use this device"). */
  displaced: boolean;
  takeSeat(): void;
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
  const [errors, setErrors] = useState<CallErrors>({});
  const [displaced, setDisplaced] = useState(false);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const setPrefs = (p: PeerPrefs) => {
    saveCallPrefs(storage(), key, p);
    prefsRef.current = p;
    setPrefsState(p);
  };
  const tailUntil = useRef(0);
  const wasHolding = useRef(false);
  /** The last rtc_join sent (prefs and seat), re-sent once when the server answered with older prefs. */
  const lastJoin = useRef<{ prefs: PeerPrefs; playerId?: string } | null>(null);
  const resyncTimer = useRef<ReturnType<typeof setTimeout>>();

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
      setDisplaced((d) => displacedAfter(d, ev));
      made?.update(ev.self, ev.peers);
      // A throttled join (callSteps.ts ownPrefsStale): send the page's prefs again once the window passed.
      if (!ownPrefsStale(lastJoin.current?.prefs ?? null, ev)) {
        clearTimeout(resyncTimer.current);
        resyncTimer.current = undefined;
      } else
        resyncTimer.current ??= setTimeout(() => {
          resyncTimer.current = undefined;
          const j = lastJoin.current;
          if (j) sendToServer({ type: "rtc_join", prefs: j.prefs, ...(j.playerId && { playerId: j.playerId }) });
        }, RESYNC_RETRY_MS);
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
      clearTimeout(resyncTimer.current);
      sendToServer({ type: "rtc_leave" });
      made?.close();
    };
  }, []);

  // Join (and re-join after a /ws reconnect); a prefs change updates what the others see. Not while
  // displaced: the other device keeps the seat until this one's "Use this device".
  useEffect(() => {
    if (!mesh || !shouldJoin({ ready: true, connected: o.connected, displaced })) return;
    mesh.setPrefs(prefs);
    lastJoin.current = { prefs: { ...prefs, camera: prefs.camera && !!localCam }, playerId: o.playerId };
    sendToServer({ type: "rtc_join", prefs: lastJoin.current.prefs, ...(o.playerId && { playerId: o.playerId }) });
  }, [mesh, o.connected, prefs, localCam, o.playerId, displaced]);

  const joined = members.self !== null;
  const others = members.peers.filter((p) => p.peerId !== members.self).length;
  // The mic opens once there is someone to talk to (/play: as soon as it joined, so the prompt comes early),
  // and is released when there no longer is (/table: the last remote left; the cleanup below stops it).
  const wantMic = joined && (o.page === "play" || others > 0);
  useEffect(() => {
    const step = micStep(wantMic, !!localMic);
    if (step === "release") return void setLocalMic(null);
    if (step !== "open") return;
    let alive = true;
    getTableMic()
      .then((s) => {
        if (!alive) return s.getTracks().forEach((t) => t.stop());
        setLocalMic(s);
        setErrors((e) => ({ ...e, mic: undefined }));
      })
      .catch((err: unknown) => setErrors((e) => ({ ...e, mic: micFailure(err) })));
    return () => {
      alive = false;
    };
  }, [wantMic, localMic]);
  useEffect(() => () => localMic?.getTracks().forEach((t) => t.stop()), [localMic]);

  // The camera note (mediaErrors.ts): a new try or a working capture clears it, and so does turning it
  // off, unless the failure turned it off; no webcam / denied / no match turns the pref off.
  const camEvent = (ev: CameraEvent) => setErrors((e) => ({ ...e, camera: nextCameraError(e.camera, ev) }));
  const wantCam = joined && prefs.camera;
  useEffect(() => {
    if (!wantCam) {
      setLocalCam(null);
      camEvent({ kind: "off" });
      return;
    }
    let alive = true;
    let got: MediaStream | undefined;
    camEvent({ kind: "start" });
    navigator.mediaDevices
      .getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { max: 24 } } })
      .then((s) => {
        got = s;
        if (!alive) return s.getTracks().forEach((t) => t.stop());
        setLocalCam(s);
        camEvent({ kind: "ok" });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        camEvent({ kind: "failed", err });
        if (cameraFailure(err).turnOff) setPrefs({ ...prefsRef.current, camera: false });
      });
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

  const error = shownCallError(errors);
  return useMemo(
    () => ({
      self: members.self,
      peers: members.peers,
      refused: members.refused,
      displaced,
      takeSeat: () => setDisplaced(false),
      prefs,
      setPrefs,
      localMic,
      localCam,
      media: (id: string) => mesh?.media(id),
      version,
      error,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [members, displaced, prefs, localMic, localCam, mesh, version, error],
  );
}
