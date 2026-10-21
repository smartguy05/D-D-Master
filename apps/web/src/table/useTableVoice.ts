import { useEffect, useRef, useState } from "react";
import { markAudioLocked, onAudioLockChange } from "../dice/sound";
import { applyMicMute } from "../lib/mic";
import { onVoiceCommand, onVoiceHandover, sendToServer, type ServerView } from "../lib/useServer";
import { getTableMic, MicStreamer, onRemoteAudioBlocked, retryRemoteAudio, VoiceLink, type VoiceLinkState } from "../lib/voice";
import { shouldAutoResume } from "./voicePlan";

/**
 * /table carries the voice call: the table mic, the DM's audio and the WebRTC call to OpenAI, plus
 * the mic stream for voice ID. /host only sends commands (voice_command) and sees the call's
 * state (this page reports it as voice_link), so the host tab can be closed mid-game. A reloaded
 * table rejoins a running DM by itself (voicePlan.shouldAutoResume).
 */
export function useTableVoice(view: ServerView): { state: VoiceLinkState; error?: string } {
  const link = useRef<VoiceLink>();
  link.current ??= new VoiceLink();
  const stream = useRef<MediaStream | null>(null);
  const streamer = useRef<MicStreamer | null>(null);
  const [status, setStatus] = useState<{ state: VoiceLinkState; error?: string }>({ state: "idle" });
  const micMuted = useRef(view.micMuted);
  micMuted.current = view.micMuted;
  const resumeTried = useRef(false);

  const report = (state: VoiceLinkState, error?: string) => {
    setStatus({ state, error });
    sendToServer({ type: "voice_link", state, ...(error && { error }) });
  };

  // One mic stream feeds the call and voice ID; it is opened on the first call and released on stop.
  const mic = async (): Promise<MediaStream> => {
    if (stream.current) return stream.current;
    const s = await getTableMic();
    applyMicMute(s, micMuted.current);
    const st = new MicStreamer("table");
    await st.start(s);
    streamer.current = st;
    stream.current = s;
    return s;
  };
  const releaseMic = () => {
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
    const offState = l.subscribe((state) => report(state, l.error));
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
    });
    return () => {
      offState();
      offCommand();
      offHandover();
      offLock();
      onRemoteAudioBlocked(undefined);
      l.stop();
      releaseMic();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Table mic mute: the server holds the flag (host, TV and phones toggle it); apply it here.
  useEffect(() => applyMicMute(stream.current, view.micMuted), [view.micMuted]);

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

  return status;
}
