import { useEffect, useRef, useState } from "react";
import type { Character } from "@dm/shared";
import { api, del, patch } from "../lib/api";
import type { ServerView } from "../lib/useServer";
import type { Capabilities, MicControl } from "./HostPage";
import { PhoneCreationCard } from "./PhoneCreation";
import { CharacterEditor, CharacterForm, type Draft } from "./CharacterEditor";
import { BuilderPanel } from "./BuilderPanel";
import { PlayerLinks } from "./PlayerLinks";
import { OnlineCard } from "./OnlineCard";
import { QuickActions, RestControls } from "./RulesPanel";
import { rulesLine } from "../player/sheet";
import { RosterPanel } from "./RosterPanel";

type Run = (fn: () => Promise<unknown>) => Promise<void>;

function Enrollment({ playerId, name, samples, mic, run, view }: { playerId: string; name: string; samples: number; mic: MicControl; run: Run; view: ServerView }) {
  const [recording, setRecording] = useState(false);
  const last = view.lastEnroll?.playerId === playerId ? view.lastEnroll : undefined;
  return (
    <span className="row">
      {recording ? (
        <button
          className="primary pulse"
          onClick={() =>
            run(async () => {
              setRecording(false);
              await api(`/players/${playerId}/enroll/stop`, {});
            })
          }
        >
          ⏹ Done
        </button>
      ) : (
        <button
          disabled={view.micMuted}
          title={view.micMuted ? "The table mic is muted: unmute it to record" : `Record ${name}'s voice once so the DM knows who is talking`}
          onClick={() =>
            run(async () => {
              await mic.enable();
              await api(`/players/${playerId}/enroll/start`, {});
              setRecording(true);
            })
          }
        >
          🎙 {samples ? "Re-record voice" : "Record voice"}
        </button>
      )}
      {recording && <span className="hint">“Hi, I'm {name}, and I'm playing …” (speak ~5 seconds)</span>}
      {!recording && last && <span className={last.ok ? "ok" : "bad"}>{last.message}</span>}
      {!recording && !last && <span className={samples ? "ok" : "muted"}>{samples ? `voice known (${samples})` : "voice not recorded"}</span>}
    </span>
  );
}

/** Voice ID test: someone talks, and the server says whose voiceprint it matches (nothing is saved). */
function VoiceTest({ players, mic, run, view }: { players: { id: string; name: string }[]; mic: MicControl; run: Run; view: ServerView }) {
  const [recording, setRecording] = useState(false);
  const last = view.lastVoiceTest;
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name;
  // Voiceprints of removed players can still be scored: show only the people at the table.
  const scores = last?.scores.filter((s) => nameOf(s.playerId)) ?? [];
  const best = last?.playerId && nameOf(last.playerId);
  return (
    <div className="voice-test">
      <div className="row">
        {recording ? (
          <button
            className="primary pulse"
            onClick={() =>
              run(async () => {
                setRecording(false);
                await api("/voice-test/stop", {});
              })
            }
          >
            ⏹ Done
          </button>
        ) : (
          <button
            disabled={view.micMuted}
            title={view.micMuted ? "The table mic is muted: unmute it to test" : "Check the voiceprints: one person talks, and this shows who it sounds like"}
            onClick={() =>
              run(async () => {
                await mic.enable();
                await api("/voice-test/start", {});
                setRecording(true);
              })
            }
          >
            🧪 Test voice ID
          </button>
        )}
        {recording && <span className="hint">Have one person say a sentence (~3 seconds), then press Done.</span>}
        {!recording && last && !last.ok && <span className="bad">{last.message}</span>}
        {!recording && last?.ok && best && (
          <span className={last.confident ? "ok" : "bad"}>{last.confident ? `Heard: ${best} ✓` : `Best guess: ${best}, not sure`}</span>
        )}
      </div>
      {!recording && last?.ok && scores.length > 0 && (
        <ul className="voice-test-scores">
          {scores.map((s) => (
            <li key={s.playerId} className={s.playerId === last.playerId ? "best" : undefined}>
              <span className="name">{nameOf(s.playerId)}</span>
              <span className="bar">
                <span style={{ width: `${Math.max(0, Math.min(1, s.score)) * 100}%` }} />
              </span>
              <span className="score">{Math.round(s.score * 100)}%</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** An AI player's personality and playstyle notes, saved on blur or Enter. */
function AiPersona({ playerId, persona, run }: { playerId: string; persona: string; run: Run }) {
  const [text, setText] = useState(persona);
  useEffect(() => setText(persona), [persona]);
  const save = () => text !== persona && run(() => patch(`/players/${playerId}`, { aiPersona: text }));
  return (
    <input
      className="grow"
      placeholder="Persona: bold dwarf who loves a fight, cracks jokes, protects the wizard"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === "Enter" && save()}
    />
  );
}

export function PartyTab({ view, run, mic, caps, rosterVersion, onRosterChange }: { view: ServerView; run: Run; mic: MicControl; caps: Capabilities | null; rosterVersion: number; onRosterChange: () => void }) {
  const { state } = view;
  const [playerName, setPlayerName] = useState("");
  const [mode, setMode] = useState<"form" | "import" | "pregen" | "roster">("form");
  const [sheet, setSheet] = useState("");
  const [sheetPlayer, setSheetPlayer] = useState("");
  const [pregens, setPregens] = useState<Draft[]>([]);
  const [pregenCount, setPregenCount] = useState(4);
  const [wishes, setWishes] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  // The tab stays mounted across tab switches; another campaign's drafts and pregens don't belong here.
  const campaignId = view.campaign?.id;
  const campaignRef = useRef(campaignId);
  campaignRef.current = campaignId;
  useEffect(() => {
    setPregens([]);
    setSheet("");
    setSheetPlayer("");
    setEditing(null);
    setBusy(false);
  }, [campaignId]);

  if (!state) return <p className="muted">Create or load a campaign first.</p>;

  const busyRun = (fn: () => Promise<unknown>) =>
    run(async () => {
      setBusy(true);
      try {
        await fn();
      } finally {
        setBusy(false);
      }
    });

  return (
    <div className="grid2">
      {state.builder && <BuilderPanel builder={state.builder} run={run} dmOffline={view.dm.status === "offline"} />}
      <section className="card">
        <h2>Players at the table</h2>
        <PlayerLinks players={state.players} characters={state.characters} />
        <p className="muted">
          Each player records their voice once (name + a sentence). After that the DM recognizes who is talking.
          {!caps?.voiceId && <b className="bad"> {caps?.voiceIdStatus}</b>}
        </p>
        {!mic.stream && (
          <button onClick={() => run(() => mic.enable())} className="primary">
            🎙 Enable microphone for voice enrollment
          </button>
        )}
        <ul className="list players">
          {state.players.map((p) => (
            <li key={p.id}>
              <b>{p.name}</b>
              <select value={p.characterId ?? ""} onChange={(e) => run(() => patch(`/players/${p.id}`, { characterId: e.target.value || null }))}>
                <option value="">— no character —</option>
                {state.characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <label className="row" title="An AI plays this seat: it speaks in its own voice on the TV and the DM rolls for it">
                <input type="checkbox" checked={p.ai} onChange={(e) => run(() => patch(`/players/${p.id}`, { ai: e.target.checked }))} /> 🤖 AI
              </label>
              {p.ai ? (
                <AiPersona playerId={p.id} persona={p.aiPersona} run={run} />
              ) : (
                <Enrollment playerId={p.id} name={p.name} samples={p.voiceSamples} mic={mic} run={run} view={view} />
              )}
              <button
                className="small"
                disabled={state.builder?.playerId === p.id}
                title={`The DM interviews ${p.name} and builds a character with them (${view.dm.status === "offline" ? "start the DM on the Play tab first, or fill the draft by hand" : "DM is running"})`}
                onClick={() => run(() => api("/builder/start", { playerId: p.id }))}
              >
                🗣 Build by voice
              </button>
              <button className="danger small" onClick={() => confirm(`Remove ${p.name}?`) && run(() => del(`/players/${p.id}`))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
        {caps?.voiceId && state.players.some((p) => !p.ai && p.voiceSamples > 0) && <VoiceTest players={state.players} mic={mic} run={run} view={view} />}
        <div className="row">
          <input placeholder="Player name" value={playerName} onChange={(e) => setPlayerName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && playerName && run(async () => (await api("/players", { name: playerName }), setPlayerName("")))} />
          <button disabled={!playerName} onClick={() => run(async () => (await api("/players", { name: playerName }), setPlayerName("")))}>
            Add player
          </button>
          <button disabled={!playerName} title="An AI plays this seat (give it a character, then a persona)" onClick={() => run(async () => (await api("/players", { name: playerName, ai: true }), setPlayerName("")))}>
            🤖 Add AI player
          </button>
        </div>
      </section>

      <section className="card">
        <div className="row">
          <h2 className="grow">Characters</h2>
          {state.characters.length > 0 && (
            <button className="small" title="Keep every character in the global roster (level, items, gold, voice) for later campaigns" onClick={() => run(async () => (await api("/roster/save-all", {}), onRosterChange()))}>
              💾 Save all to roster
            </button>
          )}
        </div>
        <RestControls characters={state.characters} run={run} />
        <div className="characters">
          {state.characters.map((c: Character) => (
            <div key={c.id} className="char-row" style={{ borderColor: c.color }}>
              {c.spriteUrl ? <img src={c.spriteUrl} alt="" /> : <div className="pc-dot" style={{ background: c.color }} />}
              <div className="grow">
                <b>{c.name}</b> <span className="muted">({c.playerName || "unassigned"})</span>
                {c.rosterId && (
                  <span className="pill ok" title="Linked to the global roster: ending the campaign saves it back">
                    linked
                  </span>
                )}
                <div className="muted">
                  {c.species} {c.className} {c.level} · HP {c.hp}/{c.maxHp} · AC {c.ac} · {c.diceMode === "physical" ? "🎲 physical dice" : "💻 virtual dice"}
                </div>
                {rulesLine(c) && <div className="rules-line small">{rulesLine(c)}</div>}
              </div>
              <QuickActions c={c} run={run} />
              <button className="small" title={c.rosterId ? "Update this hero's roster entry with the current level, items and gold" : "Keep this hero in the global roster for later campaigns"} onClick={() => run(async () => (await api(`/roster/save/${c.id}`, {}), onRosterChange()))}>
                {c.rosterId ? "Update roster" : "Save to roster"}
              </button>
              <button className="small" onClick={() => setEditing(editing === c.id ? null : c.id)}>
                {editing === c.id ? "Close" : "Edit"}
              </button>
            </div>
          ))}
          {state.characters.length === 0 && <p className="muted">No characters yet.</p>}
        </div>
        {editing && state.characters.find((c) => c.id === editing) && (
          <CharacterEditor key={editing} character={state.characters.find((c) => c.id === editing)!} run={run} onDone={() => setEditing(null)} />
        )}
      </section>

      {view.campaign && <PhoneCreationCard campaign={view.campaign} run={run} onRosterChange={onRosterChange} />}

      <OnlineCard run={run} />

      <section className="card span2">
        <h2>Add a character</h2>
        <nav className="subtabs">
          <button className={mode === "form" ? "active" : ""} onClick={() => setMode("form")}>
            Build one
          </button>
          <button className={mode === "import" ? "active" : ""} onClick={() => setMode("import")}>
            Import a sheet
          </button>
          <button className={mode === "pregen" ? "active" : ""} onClick={() => setMode("pregen")}>
            AI pregens
          </button>
          <button className={mode === "roster" ? "active" : ""} onClick={() => setMode("roster")}>
            Bring an existing hero
          </button>
        </nav>

        {mode === "form" && <CharacterForm players={state.players} run={run} />}

        {mode === "roster" && <RosterPanel state={state} run={run} version={rosterVersion} onChange={onRosterChange} />}

        {mode === "import" && (
          <div className="form">
            <p className="muted">Paste a character sheet (D&D Beyond text, PDF text, notes). The AI converts it.</p>
            <select value={sheetPlayer} onChange={(e) => setSheetPlayer(e.target.value)}>
              <option value="">Player…</option>
              {state.players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <textarea rows={10} value={sheet} onChange={(e) => setSheet(e.target.value)} placeholder="Paste the sheet here" />
            <button className="primary" disabled={busy || !sheet} onClick={() => busyRun(async () => (await api("/characters/import", { sheet, playerId: sheetPlayer || undefined }), setSheet("")))}>
              {busy ? "Reading…" : "Import"}
            </button>
          </div>
        )}

        {mode === "pregen" && (
          <div className="form">
            <div className="row">
              <label>
                How many <input type="number" min={1} max={8} value={pregenCount} onChange={(e) => setPregenCount(+e.target.value)} />
              </label>
              <input className="grow" placeholder="Wishes, e.g. 'a healer, a sneaky one, something with a big axe'" value={wishes} onChange={(e) => setWishes(e.target.value)} />
              <button className="primary" disabled={busy} onClick={() =>
                  busyRun(async () => {
                    const forCampaign = campaignId;
                    const drafts = await api<Draft[]>("/characters/pregens", { count: pregenCount, wishes });
                    if (campaignRef.current === forCampaign) setPregens(drafts); // the host may have loaded another campaign meanwhile
                  })
                }
              >
                {busy ? "Creating…" : "Generate"}
              </button>
            </div>
            <div className="pregens">
              {pregens.map((d, i) => (
                <div key={i} className="pregen">
                  <b>{d.name}</b>
                  <div className="muted">
                    {d.species} {d.className} {d.level} · HP {d.maxHp} · AC {d.ac}
                  </div>
                  <p>{d.appearance}</p>
                  <select
                    defaultValue=""
                    onChange={(e) =>
                      run(async () => {
                        await api("/characters", { character: d, playerId: e.target.value || undefined });
                        setPregens((list) => list.filter((_, j) => j !== i));
                      })
                    }
                  >
                    <option value="" disabled>
                      Take for…
                    </option>
                    {state.players.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                    <option value="">(nobody yet)</option>
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
