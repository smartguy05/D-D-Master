import { useState } from "react";
import type { Character } from "@dm/shared";
import { api, del, patch } from "../lib/api";
import type { ServerView } from "../lib/useServer";
import type { Capabilities, MicControl } from "./HostPage";
import { CharacterEditor, CharacterForm, type Draft } from "./CharacterEditor";

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
          title={`Record ${name}'s voice once so the DM knows who is talking`}
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

export function PartyTab({ view, run, mic, caps }: { view: ServerView; run: Run; mic: MicControl; caps: Capabilities | null }) {
  const { state } = view;
  const [playerName, setPlayerName] = useState("");
  const [mode, setMode] = useState<"form" | "import" | "pregen">("form");
  const [sheet, setSheet] = useState("");
  const [sheetPlayer, setSheetPlayer] = useState("");
  const [pregens, setPregens] = useState<Draft[]>([]);
  const [pregenCount, setPregenCount] = useState(4);
  const [wishes, setWishes] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

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
      <section className="card">
        <h2>Players at the table</h2>
        <p className="muted">
          Each player records their voice once (name + a sentence). After that the DM recognizes who is talking.
          {!caps?.voiceId && <b className="bad"> {caps?.voiceIdStatus}</b>}
        </p>
        {!mic.stream && (
          <button onClick={() => run(() => mic.enable())} className="primary">
            🎙 Enable table microphone
          </button>
        )}
        <ul className="list players">
          {state.players.map((p) => (
            <li key={p.id}>
              <b>{p.name}</b>
              <select value={p.characterId ?? ""} onChange={(e) => run(() => patch(`/players/${p.id}`, { characterId: e.target.value || undefined }))}>
                <option value="">— no character —</option>
                {state.characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <Enrollment playerId={p.id} name={p.name} samples={p.voiceSamples} mic={mic} run={run} view={view} />
              <button className="danger small" onClick={() => confirm(`Remove ${p.name}?`) && run(() => del(`/players/${p.id}`))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
        <div className="row">
          <input placeholder="Player name" value={playerName} onChange={(e) => setPlayerName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && playerName && run(async () => (await api("/players", { name: playerName }), setPlayerName("")))} />
          <button disabled={!playerName} onClick={() => run(async () => (await api("/players", { name: playerName }), setPlayerName("")))}>
            Add player
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Characters</h2>
        <div className="characters">
          {state.characters.map((c: Character) => (
            <div key={c.id} className="char-row" style={{ borderColor: c.color }}>
              {c.spriteUrl ? <img src={c.spriteUrl} alt="" /> : <div className="pc-dot" style={{ background: c.color }} />}
              <div className="grow">
                <b>{c.name}</b> <span className="muted">({c.playerName || "unassigned"})</span>
                <div className="muted">
                  {c.species} {c.className} {c.level} · HP {c.hp}/{c.maxHp} · AC {c.ac} · {c.diceMode === "physical" ? "🎲 physical dice" : "💻 virtual dice"}
                </div>
              </div>
              <button className="small" onClick={() => setEditing(editing === c.id ? null : c.id)}>
                {editing === c.id ? "Close" : "Edit"}
              </button>
            </div>
          ))}
          {state.characters.length === 0 && <p className="muted">No characters yet.</p>}
        </div>
        {editing && state.characters.find((c) => c.id === editing) && (
          <CharacterEditor character={state.characters.find((c) => c.id === editing)!} run={run} onDone={() => setEditing(null)} />
        )}
      </section>

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
        </nav>

        {mode === "form" && <CharacterForm players={state.players} run={run} />}

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
              <button className="primary" disabled={busy} onClick={() => busyRun(async () => setPregens(await api<Draft[]>("/characters/pregens", { count: pregenCount, wishes })))}>
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
