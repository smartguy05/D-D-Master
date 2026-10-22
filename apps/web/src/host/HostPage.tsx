import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useServer, type Job } from "../lib/useServer";
import { applyMicMute, isMicHotkey } from "../lib/mic";
import { formatElapsed } from "../lib/elapsed";
import { getTableMic, MicStreamer } from "../lib/voice";
import { AdventureTab } from "./AdventureTab";
import { BoardTab } from "./board/BoardTab";
import { PartyTab } from "./PartyTab";
import { PlayTab } from "./PlayTab";
import { rosterPrompt, rosterRefreshKey } from "./roster";

export interface Capabilities {
  openai: boolean;
  brain: string | null;
  images: boolean;
  voiceId: boolean;
  voiceIdStatus: string;
  rulesChunks: number;
  srdMonsters: number;
}

/**
 * The host laptop's mic, for enrolling voices only (the server takes it while a voice is being
 * recorded). The voice call and the play-time mic run on /table (table/useTableVoice).
 */
export interface MicControl {
  stream: MediaStream | null;
  level: number;
  enable: () => Promise<MediaStream>;
}

type Tab = "adventure" | "party" | "play" | "board";

export function HostPage() {
  const view = useServer("host");
  const [tab, setTab] = useState<Tab>("adventure");
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [level, setLevel] = useState(0);
  const streamer = useRef<MicStreamer | null>(null);
  // Voice-ID mic socket (/ws/audio): null until the mic is on, false while it reconnects.
  const [micSocketUp, setMicSocketUp] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Bumped after any roster save/join/delete so the Roster panel refetches GET /api/roster.
  const [rosterVersion, setRosterVersion] = useState(0);
  const bumpRoster = () => setRosterVersion((v) => v + 1);
  // end_campaign saves linked PCs back to the roster on the server: refetch when the campaign ends.
  const rosterKey = rosterRefreshKey(view.campaign);
  useEffect(() => bumpRoster(), [rosterKey]);
  // End-of-campaign prompt: dismissed per campaign id.
  const [promptDismissed, setPromptDismissed] = useState<string | null>(null);
  const unsaved = rosterPrompt(view.campaign, view.state);
  const showRosterPrompt = unsaved.length > 0 && promptDismissed !== view.campaign?.id;

  useEffect(() => {
    api<Capabilities>("/status").then(setCaps).catch(() => undefined);
  }, [view.connected]);

  useEffect(() => {
    const t = setInterval(() => setLevel(streamer.current?.level ?? 0), 120);
    return () => {
      clearInterval(t);
      streamer.current?.stop();
      streamer.current = null;
    };
  }, []);

  // Table mic mute: the server holds the flag (the TV and phones toggle it too); /table applies it
  // to the call's mic, this to the enrollment mic.
  const micMuted = view.micMuted;
  useEffect(() => applyMicMute(stream, micMuted), [stream, micMuted]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isMicHotkey(e)) api("/mic", { muted: !micMuted, source: "host-key" }).catch(() => undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [micMuted]);

  const mic: MicControl = {
    stream,
    level,
    enable: async () => {
      if (stream) return stream;
      const s = await getTableMic();
      applyMicMute(s, micMuted);
      const st = new MicStreamer("host");
      st.onChange(setMicSocketUp);
      await st.start(s);
      streamer.current = st;
      setStream(s);
      return s;
    },
  };

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      setNotice((err as Error).message);
      setTimeout(() => setNotice(null), 8000);
    }
  };

  return (
    <div className="host">
      <header className="host-header">
        <h1>AI Dungeon Master</h1>
        <nav>
          {(["adventure", "party", "play", "board"] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
              {t === "adventure" ? "📜 Adventure" : t === "party" ? "🛡 Party" : t === "play" ? "🎲 Play" : "🗺 Board"}
            </button>
          ))}
        </nav>
        <div className="host-status">
          <span className={`pill ${view.connected ? "ok" : "bad"}`}>{view.connected ? "server" : "offline"}</span>
          <span className={`pill ${caps?.openai ? "ok" : "bad"}`} title="OpenAI key (voice, text DM, images)">
            OpenAI
          </span>
          <span className={`pill ${caps?.brain ? "ok" : "bad"}`} title={caps?.brain ?? "No brain configured"}>
            brain
          </span>
          <span className={`pill ${caps?.voiceId ? "ok" : "bad"}`} title={caps?.voiceIdStatus}>
            voice ID
          </span>
          {micSocketUp === false && (
            <span className="pill bad" title="This laptop's enrollment mic stream (/ws/audio) dropped; it reconnects by itself">
              Enrollment mic offline — reconnecting
            </span>
          )}
          {view.dm.mode === "voice" && view.dm.status !== "offline" && view.voiceOwner && !view.voiceOwner.micStream && (
            <span className="pill bad" title="The table screen's mic stream (/ws/audio) is down: voice ID can't hear who talks">
              Voice ID offline
            </span>
          )}
          <span className={`pill dm-${view.dm.status}`}>DM: {view.dm.status}</span>
          <span className={`mic-meter ${micMuted ? "off" : ""}`} title={micMuted ? "Table mic muted (P)" : "Table microphone level"}>
            {micMuted ? "🔇" : "🎙"} <i style={{ width: `${Math.min(100, level * 250)}%` }} />
          </span>
          <a className={`pill link ${view.voiceOwner && !view.voiceOwner.table ? "bad" : ""}`} href="/table" target="_blank" rel="noreferrer" title="The table screen runs the mic and the DM's voice">
            {view.voiceOwner && !view.voiceOwner.table ? "table screen closed: open it ↗" : "open table screen ↗"}
          </a>
        </div>
      </header>

      {(notice || view.errors.length > 0) && (
        <div className="notices">
          {notice && <div className="notice">{notice}</div>}
          {view.errors.map((e) => (
            <div key={e.id} className="notice">
              {e.message}
            </div>
          ))}
        </div>
      )}
      {view.jobs.length > 0 && (
        <div className="jobs">
          {view.jobs.map((j) => (
            <JobChip key={j.id} job={j} />
          ))}
        </div>
      )}

      {showRosterPrompt && (
        <div className="roster-prompt">
          <span className="grow">
            The campaign has ended. Save {unsaved.map((c) => c.name).join(", ")} to the roster to bring them into a later campaign?
          </span>
          <button className="primary small" onClick={() => run(async () => (await api("/roster/save-all", {}), bumpRoster()))}>
            💾 Save all to roster
          </button>
          <button className="small" onClick={() => setPromptDismissed(view.campaign?.id ?? null)}>
            Dismiss
          </button>
        </div>
      )}

      <main className="host-main">
        {tab === "adventure" && <AdventureTab view={view} run={run} />}
        {/* Kept mounted (hidden) so an AI pregen job, a pasted sheet or a half-built form survive a tab switch. */}
        <div hidden={tab !== "party"}>
          <PartyTab view={view} run={run} mic={mic} caps={caps} rosterVersion={rosterVersion} onRosterChange={bumpRoster} />
        </div>
        {tab === "play" && <PlayTab view={view} run={run} />}
        {tab === "board" && <BoardTab view={view} run={run} />}
      </main>
    </div>
  );
}

/** One job chip; a running one ticks its elapsed time itself, so the page (and the hidden Party tab) doesn't re-render. */
function JobChip({ job: j }: { job: Job }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (j.status !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [j.status]);
  return (
    <div className={`job ${j.status}`} title={j.detail}>
      {j.status === "running" ? "⏳" : j.status === "done" ? "✅" : "⚠️"} {j.label}
      {j.status === "running" && j.startedAt ? ` · ${formatElapsed(now - j.startedAt)}` : ""}
      {j.detail ? `: ${j.detail}` : ""}
    </div>
  );
}
