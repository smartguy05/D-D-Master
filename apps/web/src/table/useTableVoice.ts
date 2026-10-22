import { useCallback, useEffect, useRef, useState } from "react";
import { markAudioLocked, onAudioLockChange } from "../dice/sound";
import { roomHoldsFloor, tableMicEnabled, tailAfter } from "../lib/floor";
import { applyMicMute } from "../lib/mic";
import { onVoiceCommand, onVoiceHandover, sendToServer, type ServerView } from "../lib/useServer";
import { getTableMic, MicStreamer, onRemoteAudioBlocked, retryRemoteAudio, VoiceLink, type VoiceLinkState } from "../lib/voice";
import { shouldAutoResume } from "./voicePlan";
import { DmMixer, sendMixed } from "./dmMixer";

/** A remote player's voice from the call, for the DM mix (table/dmMixer.ts). */
export interface RemoteVoice {
  peerId: string;
  playerId?: string;
  stream: MediaStream | null;
}

export interface TableVoice {
  state: VoiceLinkState;
  error?: string;
  /** The voice DM's audio (forwarded to remote players by the call). */
  dmTrack: MediaStreamTrack | null;
  /** The remote players' voices in the call now; the floor decides which one the DM hears. */
  mixVoices(voices: RemoteVoice[]): void;
}

/**
 * /table carries the voice call: the table mic, the DM's audio and the WebRTC call to OpenAI, plus
 * the mic stream for voice ID. /host only sends commands (voice_command) and sees the call's
 * state (this page reports it as voice_link), so the host tab can be closed mid-game. A reloaded
 * table rejoins a running DM by itself (voicePlan.shouldAutoResume).
 *
 * With remote players in the call (call/useCall.ts) the call sends the DM mix instead of the bare room
 * mic (table/dmMixer.ts: the room mic plus the voice of a remote player who holds the floor), switched
 * with VoiceLink.replaceStream; the DM's audio goes out to the remote players as `dmTrack`.
 *
 * `localPress`: this TV's own Space is down and hasn't been given the floor yet (TalkPress.waiting).
 * On a free floor the room mic opens at once instead of on the server's floor broadcast, so the
 * first syllable reaches the DM (lib/floor.ts tableMicEnabled). Phones keep the round trip.
 */
export function useTableVoice(view: ServerView, localPress = false): TableVoice {
  const link = useRef<VoiceLink>();
  link.current ??= new VoiceLink();
  const stream = useRef<MediaStream | null>(null);
  const streamer = useRef<MicStreamer | null>(null);
  const [status, setStatus] = useState<{ state: VoiceLinkState; error?: string }>({ state: "idle" });
  const mixer = useRef<DmMixer>();
  mixer.current ??= new DmMixer();
  const [dmStream, setDmStream] = useState<MediaStream | null>(null);
  const [remoteVoices, setRemoteVoices] = useState(0);
  const [mixRunning, setMixRunning] = useState(false);
  const mixWanted = useRef(false);
  mixWanted.current = sendMixed({ remotePlayers: remoteVoices, mixerRunning: mixRunning });
  const resumeTried = useRef(false);
  // Push-to-talk: the room mic reaches the DM only while the room (or a player in the room) holds the
  // floor, plus FLOOR_TAIL_MS after, or while a voice is being enrolled; mute is a hard override on top (lib/floor.ts).
  const floorHeld = roomHoldsFloor(view.floor);
  const enrolling = !!view.floor?.enrolling;
  const tailUntil = useRef(0);
  const wasHeld = useRef(floorHeld);
  const micOpen = useRef<() => boolean>(() => false);
  micOpen.current = () => tableMicEnabled({ muted: view.micMuted, floor: view.floor, tailUntil: tailUntil.current, now: Date.now(), localPress });

  const report = (state: VoiceLinkState, error?: string) => {
    setStatus({ state, error });
    sendToServer({ type: "voice_link", state, ...(error && { error }) });
  };

  // What the call sends: the DM mix while a remote player is in the call (and WebAudio runs), else the room mic.
  const callStream = (s: MediaStream) => (mixWanted.current ? mixer.current!.stream : s);
  // One mic stream feeds the call and voice ID; it is opened on the first call and released on stop.
  const mic = async (): Promise<MediaStream> => {
    if (stream.current) return callStream(stream.current);
    const s = await getTableMic();
    applyMicMute(s, !micOpen.current());
    const st = new MicStreamer("table");
    await st.start(s);
    streamer.current = st;
    stream.current = s;
    mixer.current!.setRoom(s);
    return callStream(s);
  };
  const releaseMic = () => {
    mixer.current!.setRoom(null);
    streamer.current?.stop();
    streamer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      report("failed", (err as Error).message);
    }
  };

  useEffect(() => {
    const l = link.current!;
    const m = mixer.current!;
    const offState = l.subscribe((state) => report(state, l.error));
    const offRemote = l.onRemoteStream(setDmStream);
    const offMix = m.onStateChange(() => setMixRunning(m.running));
    const offCommand = onVoiceCommand((action) => {
      if (action === "start") void run(async () => l.start(await mic()));
      else if (action === "reconnect") void run(async () => (l.active ? l.reconnect() : l.resume(await mic())));
      else {
        l.stop();
        releaseMic();
      }
    });
    // Planned call renewal (server voice_handover): build the standby, swap, or drop it. Silent:
    // the DM status doesn't change; a failed swap falls back to a resume reconnect.
    const offHandover = onVoiceHandover((phase) => {
      if (phase === "prepare") void l.prepareHandover();
      else if (phase === "swap")
        void l.commitHandover().then((ok) => {
          if (!ok && l.state === "connected") void l.reconnect();
        });
      else l.abortHandover();
    });
    // Autoplay refused the DM's audio: show "Click to enable sound"; the click plays it.
    onRemoteAudioBlocked(markAudioLocked);
    const offLock = onAudioLockChange((unlocked) => {
      if (!unlocked) return;
      retryRemoteAudio();
      streamer.current?.resume();
      m.resume();
    });
    return () => {
      offState();
      offCommand();
      offHandover();
      offLock();
      offRemote();
      offMix();
      onRemoteAudioBlocked(undefined);
      l.stop();
      releaseMic();
      m.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Table mic mute and the push-to-talk floor: the server holds both (host, TV and phones change them); apply them here.
  useEffect(() => {
    const now = Date.now();
    tailUntil.current = tailAfter(wasHeld.current, floorHeld, now, tailUntil.current);
    wasHeld.current = floorHeld;
    applyMicMute(stream.current, !micOpen.current());
    // Remote voices into the DM: the floor holder's (plus its tail), muted with the table.
    const mixLeft = mixer.current!.applyFloor(view.floor, view.micMuted, now);
    const left = tailUntil.current - now;
    const timers: ReturnType<typeof setTimeout>[] = [];
    // Close the mic when the tail runs out (unless the floor came back meanwhile: the effect re-runs).
    if (left > 0) timers.push(setTimeout(() => applyMicMute(stream.current, !micOpen.current()), left + 5));
    if (mixLeft > 0) timers.push(setTimeout(() => mixer.current!.applyFloor(view.floor, view.micMuted, Date.now()), mixLeft + 5));
    return () => timers.forEach(clearTimeout);
  }, [view.micMuted, floorHeld, enrolling, view.floor, localPress]);

  // Switch what the call sends (room mic or the mix) when a remote player joins or leaves, or WebAudio starts.
  useEffect(() => {
    const l = link.current!;
    if (stream.current && l.active) l.replaceStream(callStream(stream.current));
    // Remote players are in the call but WebAudio waits for a click: the room still reaches the DM; ask for the click.
    if (remoteVoices > 0 && !mixRunning) {
      const t = setTimeout(() => !mixer.current!.running && markAudioLocked(), 1000);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteVoices, mixRunning]);

  // After a /ws reconnect the server forgot this page's call: tell it again.
  useEffect(() => {
    const l = link.current!;
    if (view.connected && l.state !== "idle") sendToServer({ type: "voice_link", state: l.state, ...(l.error && { error: l.error }) });
  }, [view.connected]);

  const ownerLink = view.voiceOwner?.link ?? null;
  useEffect(() => {
    const l = link.current!;
    if (!shouldAutoResume({ wsConnected: view.connected, dmMode: view.dm.mode, dmStatus: view.dm.status, link: l.state, ownerLink, tried: resumeTried.current })) return;
    resumeTried.current = true;
    void run(async () => l.resume(await mic()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.connected, view.dm.mode, view.dm.status, ownerLink]);

  const mixVoices = useCallback((voices: RemoteVoice[]) => {
    const m = mixer.current!;
    for (const v of voices) m.setPeer(v.peerId, v.playerId, v.stream);
    m.retain(voices.map((v) => v.peerId));
    setMixRunning(m.running);
    setRemoteVoices(voices.filter((v) => v.stream).length);
  }, []);

  return { ...status, dmTrack: dmStream?.getAudioTracks()[0] ?? null, mixVoices };
}
