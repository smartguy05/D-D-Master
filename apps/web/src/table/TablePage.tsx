import { useEffect, useMemo, useRef, useState } from "react";
import { sendToServer } from "../lib/useServer";
import { floorLabel, isTalkKey, roomIsMine, TalkPress } from "../lib/floor";
import { useHoldCountdown } from "../lib/useHoldCountdown";
import { api } from "../lib/api";
import { isMicHotkey } from "../lib/mic";
import { useTableVoice } from "./useTableVoice";
import { isMuted, setMuted, unlockAudio } from "../dice/sound";
import { Qr } from "../lib/Qr";
import { useJoinBase } from "../lib/join";
import { TableScene, useTableScene } from "./TableScene";
import { useCall } from "../call/useCall";
import { VideoStrip } from "../call/VideoStrip";

/**
 * /table: the TV. The scene itself (board, dice, moments, party, and every hold behind the dice) is
 * TableScene, shared with the remote /play page; this page adds what only the room's screen does: the
 * voice call (useTableVoice), the hotkeys, the join QR, the room's push-to-talk and mic-muted banners,
 * and the call with remote players (useCall as the room: their tiles in a side strip, their voices out
 * of the TV and into the DM mix, the DM's voice forwarded to them; docs/web/online-call.md).
 */
export function TablePage() {
  const [showInv, setShowInv] = useState(true);
  const [showJoin, setShowJoin] = useState(false);
  const joinUrl = `${useJoinBase()}/player`;
  /**
   * Space held for push-to-talk: the room's press. A refused one asks again once the floor is free (a
   * floor it was given is never re-taken after the 30 s cap); while it waits on a free floor the room
   * mic is already open (useTableVoice `localPress`), so the first syllable isn't lost to the round trip.
   */
  const [, talkChanged] = useState(0);
  const talk = useMemo(() => new TalkPress((down) => sendToServer({ type: "ptt", down }), { mine: roomIsMine, onChange: () => talkChanged((n) => n + 1) }), []);
  const scene = useTableScene("table");
  const { view, state, muted, soundLocked } = scene;
  const { dm, micMuted } = view;
  const micMutedRef = useRef(micMuted);
  micMutedRef.current = micMuted;
  const pttOn = !!view.floor?.pushToTalk;
  const pttOnRef = useRef(pttOn);
  pttOnRef.current = pttOn;
  useEffect(() => talk.update(view.floor), [talk, view.floor]);
  const secondsLeft = useHoldCountdown(view.floor);
  const talkExpired = talk.expiredFor(view.floor);
  // This screen carries the voice call (mic + the DM's audio); /host only sends commands.
  const voice = useTableVoice(view, talk.waiting);
  const voiceDm = dm.mode === "voice" && dm.status !== "offline";
  const call = useCall({ page: "table", connected: view.connected, floor: view.floor, dmTrack: voice.dmTrack });
  const remotes = call.self ? call.peers.filter((p) => !p.room) : [];
  const { mixVoices } = voice;
  useEffect(() => {
    mixVoices(remotes.map((p) => ({ peerId: p.peerId, playerId: p.playerId, stream: call.media(p.peerId)?.mic ?? null })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.version, call.peers, call.self, mixVoices]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      unlockAudio();
      if (e.key === "i") setShowInv((s) => !s);
      if (e.key === "q" || e.key === "Q") setShowJoin((s) => !s);
      if (e.key === "f") void document.documentElement.requestFullscreen?.();
      if (e.key === "m" || e.key === "M") setMuted(!isMuted());
      if (isMicHotkey(e)) api("/mic", { muted: !micMutedRef.current, source: "table-key" }).catch(() => undefined);
      // Push-to-talk for the room: hold Space (key repeats are not new presses).
      if (pttOnRef.current && isTalkKey(e)) {
        e.preventDefault();
        if (!e.repeat) talk.press("key");
      }
    };
    const talkUp = () => talk.release("key");
    const onKeyUp = (e: KeyboardEvent) => {
      if (isTalkKey(e)) talkUp();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    // A key released while the tab was in the background never sends keyup.
    window.addEventListener("blur", talkUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", talkUp);
      talkUp();
    };
  }, [talk]);

  return (
    <TableScene
      scene={scene}
      showInv={showInv}
      empty={
        <div className="table-empty">
          <h1>AI Dungeon Master</h1>
          <p>{view.connected ? "Waiting for the host to load a campaign…" : "Connecting to server…"}</p>
          <div className="table-join">
            <Qr url={joinUrl} size={260} />
            <div>📱 Scan to join, or open</div>
            <div className="join-url">{joinUrl}</div>
          </div>
        </div>
      }
      banners={
        <>
          {pttOn && !micMuted && voiceDm && state && (
            <div className={`ptt-banner ${view.floor?.holder ? "live" : ""} ${talkExpired ? "expired" : ""}`} role="status">
              {talkExpired ? (
                <>
                  ⏱ <b>Time's up</b> <span className="muted">let go of Space and press again</span>
                </>
              ) : (
                <>
                  🎙{" "}
                  {floorLabel(view.floor, state.players) ?? (
                    <>
                      <b>Hold Space</b> <span className="muted">(or the button on your phone) to talk to the DM</span>
                    </>
                  )}
                  {secondsLeft !== undefined && <span className="ptt-left"> {secondsLeft} s left</span>}
                </>
              )}
            </div>
          )}

          {micMuted && (
            <div className="mic-muted-banner" role="status">
              🔇 <b>The DM isn't listening</b> <span className="muted">press P or tap 🔇 on a phone to resume</span>
            </div>
          )}
        </>
      }
      controls={
        <>
          {voice.state !== "idle" && voice.state !== "connected" && (
            <span className={`voice-pill ${voice.state === "failed" ? "bad" : ""}`} title={voice.error ?? "This screen's voice call to the DM"}>
              🎙 voice: {voice.state === "failed" ? `failed${voice.error ? ` (${voice.error})` : ""}` : `${voice.state}…`}
            </span>
          )}
          {soundLocked && (!muted || voiceDm) && (
            <button type="button" className="sound-unlock" onClick={unlockAudio}>
              🔊 <b>{voiceDm ? "Click to enable sound and the DM's voice" : "Click to enable sound"}</b>
              <span className="muted">the browser blocks the DM, NPC voices and dice until someone clicks or presses a key</span>
            </button>
          )}
        </>
      }
      corner={
        <>
          {remotes.length > 0 && <VideoStrip call={call} state={state} floor={view.floor} variant="table" />}
          {showJoin && (
          <div className="join-corner">
            <Qr url={joinUrl} size={150} />
            <div className="txt">
              📱 <b>Join the game</b>
              <br />
              scan, or open
              <br />
              <b>{joinUrl}</b>
              <br />
              <span className="muted">Q hides this</span>
            </div>
          </div>
          )}
        </>
      }
    />
  );
}
