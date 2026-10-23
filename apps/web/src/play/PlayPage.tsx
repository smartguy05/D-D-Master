import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { SAY_MAX, sayText, type RollResult } from "@dm/shared";
import { api } from "../lib/api";
import { floorLabel, isTalkKey, isTypingTarget } from "../lib/floor";
import { isMuted, setMuted, unlockAudio } from "../dice/sound";
import { TableScene, useTableScene } from "../table/TableScene";
import { CreationSlot, DraftCard, Sheet } from "../player/PlayerPage";
import { useCreation } from "../player/creation/useCreation";
import { panelMode } from "../player/creation/view";
import { seatTalkPress, TalkButton } from "../player/TalkButton";
import { sheetAttention } from "./playView";
import { transcriptLines } from "./transcript";
import { useCall } from "../call/useCall";
import { VideoStrip } from "../call/VideoStrip";
import "../player/player.css";
import "./play.css";

/** Transcript lines shown in the dock. */
const TRANSCRIPT_LINES = 3;

/**
 * /play/:playerId: a remote player's page (docs/web/remote-play.md). The table scene the TV shows
 * (TableScene: board, dice, moments, party; same holds behind the dice), the player's sheet in a
 * drawer, push-to-talk (button and Space), typed input to the DM for this seat, a transcript of what
 * the DM and players said, NPC clips and dice sounds, and the call (useCall, VideoStrip): the other
 * players' and the room's video and voices, and the DM's voice forwarded from the room's TV (NPC clips
 * play here from their own URLs, never through the call). The socket is a player's, so the state is
 * the server's public projection.
 */
export function PlayPage() {
  const { playerId = "" } = useParams();
  const [lastRoll, setLastRoll] = useState<RollResult | null>(null);
  const myCharId = useRef<string | undefined>();
  const scene = useTableScene("player", {
    playClips: true,
    onRoll: (roll) => {
      if (roll.rollerId && roll.rollerId === myCharId.current && !roll.secret) setLastRoll(roll);
    },
  });
  const { view, live, muted, soundLocked } = scene;
  const call = useCall({ page: "play", connected: view.connected, floor: view.floor, playerId });
  const callAudio = call.peers.filter((p) => !p.micOnly).length > 1;
  const player = live?.players.find((p) => p.id === playerId);
  const ch = live?.characters.find((c) => c.id === player?.characterId);
  myCharId.current = ch?.id;
  const creation = useCreation(playerId, view.connected, live?.campaignId, ch?.id);
  const [editing, setEditing] = useState(false);
  const mode = panelMode(creation.view, !!ch);
  const pttOn = !!view.floor?.pushToTalk;
  const pttOnRef = useRef(pttOn);
  pttOnRef.current = pttOn;
  // One press for the button ("pointer") and Space ("key"): one down when the first presses, one up when both let go.
  const press = useMemo(() => seatTalkPress(playerId), [playerId]);
  // The floor reaches the press even with the button not shown: Space's refused press asks again once it's free.
  useEffect(() => press.update(view.floor), [press, view.floor]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const attention = live ? sheetAttention(live, ch?.id) : undefined;
  // The DM waits for this player's physical roll: the number pad is in the sheet, so open it.
  useEffect(() => {
    if (attention === "roll") setSheetOpen(true);
  }, [attention]);
  // No character yet: the drawer holds character creation, so open it.
  const needsCharacter = !!player && !ch;
  useEffect(() => {
    if (needsCharacter) setSheetOpen(true);
  }, [needsCharacter]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      unlockAudio();
      if (pttOnRef.current && isTalkKey(e)) {
        e.preventDefault();
        if (!e.repeat) press.press("key");
        return;
      }
      if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "m" || e.key === "M") setMuted(!isMuted());
      if (e.key === "c" || e.key === "C") setSheetOpen((o) => !o);
      if (e.key === "Escape") setSheetOpen(false);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (isTalkKey(e)) press.release("key");
    };
    // A key released while the tab was in the background never sends keyup.
    const onBlur = () => press.release("key");
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      press.releaseAll();
    };
  }, [press]);

  const waiting = (
    <div className="table-empty">
      <h1>Hearthmaster</h1>
      <p>{view.connected ? "Waiting for the host to load a campaign…" : "Connecting to the table…"}</p>
    </div>
  );
  if (live && !player) {
    return (
      <div className="table-empty">
        <h1>Hearthmaster</h1>
        <p>That seat isn't in this campaign.</p>
        <Link className="button primary" to="/join">
          Pick your seat
        </Link>
      </div>
    );
  }

  const builder = live?.builder?.playerId === playerId ? live.builder : undefined;
  const dmOnline = view.dm.status !== "offline";
  return (
    <div className="play-root">
      <TableScene
        scene={scene}
        showInv={false}
        className="play-scene"
        empty={waiting}
        banners={
          <>
            {pttOn && dmOnline && live && (
              <div className={`ptt-banner ${view.floor?.holder ? "live" : ""}`} role="status">
                🎙 {floorLabel(view.floor, live.players, playerId) ?? (
                  <>
                    <b>Hold Space</b> <span className="muted">(or the talk button) to talk to the DM</span>
                  </>
                )}
              </div>
            )}
            {view.micMuted && (
              <div className="mic-muted-banner" role="status">
                🔇 <b>The DM isn't listening</b> <span className="muted">the table muted the mic</span>
              </div>
            )}
          </>
        }
        controls={
          soundLocked &&
          (!muted || callAudio) && (
            <button type="button" className="sound-unlock" onClick={unlockAudio}>
              🔊 <b>{callAudio ? "Click to hear the table and the DM" : "Click to enable sound"}</b>
              <span className="muted">the browser blocks voices, dice and NPC clips until you click or press a key</span>
            </button>
          )
        }
        corner={live && player && <VideoStrip call={call} state={live} floor={view.floor} variant="play" />}
      />

      {live && (
        <aside className={`play-drawer ${sheetOpen ? "open" : ""}`} aria-hidden={!sheetOpen}>
          <header className="pl-header">
            <div className="grow">
              <h1>{ch?.name ?? player?.name}</h1>
              <div className="muted small">
                {ch ? `${ch.species} ${ch.className} ${ch.level} · ` : ""}
                {player?.name}
              </div>
            </div>
            <button type="button" className="play-close" onClick={() => setSheetOpen(false)} title="Close (C or Esc)">
              ✕
            </button>
          </header>
          {builder && <DraftCard builder={builder} />}
          <CreationSlot playerId={playerId} creation={creation} mode={mode} hasCharacter={!!ch} builder={!!builder} editing={editing} setEditing={setEditing} name={ch?.name} />
          {ch && !(editing && mode === "can-edit") && <Sheet ch={ch} state={live} view={view} playerId={playerId} lastRoll={lastRoll} />}
        </aside>
      )}

      {live && player && (
        <footer className="play-dock">
          <Transcript lines={transcriptLines(live.log, TRANSCRIPT_LINES)} dmSpeaking={view.dm.status === "speaking"} />
          <div className="play-actions">
            <button type="button" className={`play-sheet-btn ${attention ?? ""}`} onClick={() => setSheetOpen((o) => !o)} title="Character sheet (C)">
              📜 {attention === "roll" ? "Your roll!" : attention === "turn" ? "Your turn" : needsCharacter ? "Create" : "Sheet"}
            </button>
            <TalkButton floor={view.floor} playerId={playerId} players={live.players} press={press} />
            <SayBox playerId={playerId} disabled={!dmOnline} />
            <span className={`dot ${view.connected ? "on" : ""}`} title={view.connected ? "connected" : "reconnecting"} />
          </div>
        </footer>
      )}
    </div>
  );
}

/** What the DM and the players said lately (the log; the DM's voice itself comes through the call). */
function Transcript({ lines, dmSpeaking }: { lines: ReturnType<typeof transcriptLines>; dmSpeaking: boolean }) {
  return (
    <div className="play-transcript" aria-live="polite">
      {lines.length === 0 && <div className="muted">What the DM says shows here.</div>}
      {lines.map((l) => (
        <div key={l.id} className={`tl ${l.dm ? "dm" : ""}`}>
          <b>{l.who}:</b> {l.text}
        </div>
      ))}
      {dmSpeaking && <div className="tl dm speaking muted">The DM is speaking…</div>}
    </div>
  );
}

/** Typed input to the DM as this seat (POST /api/dm/say; the server allows only the bound seat). */
function SayBox({ playerId, disabled }: { playerId: string; disabled: boolean }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const send = async () => {
    const t = sayText(text);
    if (!t) return;
    setBusy(true);
    setError("");
    try {
      await api("/dm/say", { text: t, playerId });
      setText("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="play-say"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <input value={text} onChange={(e) => setText(e.target.value)} maxLength={SAY_MAX} placeholder={disabled ? "The DM is offline" : "Type to the DM…"} disabled={disabled || busy} aria-label="Message to the DM" />
      <button className="primary" disabled={disabled || busy || !sayText(text)}>
        Send
      </button>
      {error && (
        <span className="play-say-error" onClick={() => setError("")}>
          {error}
        </span>
      )}
    </form>
  );
}
