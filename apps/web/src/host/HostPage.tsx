import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useServer } from "../lib/useServer";
import { getTableMic, MicStreamer, VoiceLink } from "../lib/voice";
import { AdventureTab } from "./AdventureTab";
import { PartyTab } from "./PartyTab";
import { PlayTab } from "./PlayTab";

export interface Capabilities {
  openai: boolean;
  brain: string | null;
  images: boolean;
  voiceId: boolean;
  voiceIdStatus: string;
  rulesChunks: number;
  srdMonsters: number;
}

/** Shared microphone: one getUserMedia stream feeds both voice ID streaming and the WebRTC DM. */
export interface MicControl {
  stream: MediaStream | null;
  level: number;
  enable: () => Promise<MediaStream>;
  voice: VoiceLink;
}

type Tab = "adventure" | "party" | "play";

export function HostPage() {
  const view = useServer("host");
  const [tab, setTab] = useState<Tab>("adventure");
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [level, setLevel] = useState(0);
  const streamer = useRef<MicStreamer | null>(null);
  const voice = useRef(new VoiceLink());
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api<Capabilities>("/status").then(setCaps).catch(() => undefined);
  }, [view.connected]);

  useEffect(() => {
    const t = setInterval(() => setLevel(streamer.current?.level ?? 0), 120);
    return () => clearInterval(t);
  }, []);

  const mic: MicControl = {
    stream,
    level,
    voice: voice.current,
    enable: async () => {
      if (stream) return stream;
      const s = await getTableMic();
      const st = new MicStreamer();
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
          {(["adventure", "party", "play"] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
              {t === "adventure" ? "📜 Adventure" : t === "party" ? "🛡 Party" : "🎲 Play"}
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
          <span className={`pill dm-${view.dm.status}`}>DM: {view.dm.status}</span>
          <span className="mic-meter" title="Table microphone level">
            🎙 <i style={{ width: `${Math.min(100, level * 250)}%` }} />
          </span>
          <a className="pill link" href="/table" target="_blank" rel="noreferrer">
            open table screen ↗
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
            <div key={j.id} className={`job ${j.status}`} title={j.detail}>
              {j.status === "running" ? "⏳" : j.status === "done" ? "✅" : "⚠️"} {j.label}
              {j.detail ? `: ${j.detail}` : ""}
            </div>
          ))}
        </div>
      )}

      <main className="host-main">
        {tab === "adventure" && <AdventureTab view={view} run={run} />}
        {tab === "party" && <PartyTab view={view} run={run} mic={mic} caps={caps} />}
        {tab === "play" && <PlayTab view={view} run={run} mic={mic} />}
      </main>
    </div>
  );
}
