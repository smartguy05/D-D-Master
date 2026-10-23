import { useEffect, useRef, useState, type ReactNode } from "react";
import { checkConstraints, type Character, type Player } from "@dm/shared";
import { api, del, patch } from "../lib/api";
import type { ServerView } from "../lib/useServer";
import type { Capabilities, MicControl } from "./HostPage";
import { PhoneCreationCard } from "./PhoneCreation";
import { CharacterRulesCard } from "./CharacterRules";
import { CharacterEditor, CharacterForm, type Draft } from "./CharacterEditor";
import { BuilderPanel } from "./BuilderPanel";
import { PlayerLinks } from "./PlayerLinks";
import { OnlineCard, useOnlineSessions } from "./OnlineCard";
import { seatStatus, type OnlineSessions } from "./online";
import { buildSeats, NEW_SEAT, pickSelected, type Seat } from "./seats";
import { QuickActions, RestControls } from "./RulesPanel";
import { rulesLine } from "../player/sheet";
import { RosterPanel } from "./RosterPanel";
import { CharacterDetails } from "./CharacterDetails";
import { PortraitView } from "../lib/PortraitView";

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

/** Flags a character that breaks the campaign's character rules (they changed after it was made, or the host made it). */
function RulesBadge({ c, constraints }: { c: Character; constraints: Parameters<typeof checkConstraints>[1] }) {
  const issues = checkConstraints(c, constraints);
  if (!issues.length) return null;
  return (
    <span className="pill bad" title={issues.map((i) => i.message).join("\n")}>
      ⚠ breaks character rules
    </span>
  );
}


type Constraints = Parameters<typeof checkConstraints>[1];
type OnlineSeat = OnlineSessions["seats"][number];

/** A seat's online dot: green while a phone or browser is connected, hollow when joined but offline. */
function OnlineDot({ seat }: { seat?: OnlineSeat }) {
  if (!seat) return null;
  const st = seatStatus(seat);
  if (!st.kickable) return null;
  return (
    <span className={`online-dot ${st.tone}`} title={st.label} aria-label={st.label}>
      {seat.connected > 0 ? "●" : "○"}
    </span>
  );
}

/** One row of the seat list (left pane): who sits there, their hero, and a few status flags. */
function SeatRow({ seat, selected, online, constraints, onSelect }: { seat: Seat; selected: boolean; online?: OnlineSeat; constraints: Constraints; onSelect: () => void }) {
  const { player: p, character: c } = seat;
  const broken = c && checkConstraints(c, constraints).length > 0;
  return (
    <button className={`seat-row ${selected ? "selected" : ""}`} style={{ borderLeftColor: c?.color ?? "transparent" }} aria-pressed={selected} onClick={onSelect}>
      {c?.spriteUrl ? <img src={c.spriteUrl} alt="" /> : <span className="pc-dot" style={{ background: c?.color ?? "#3a2e24" }} />}
      <span className="seat-text">
        <span className="seat-top">
          <b>{p?.name ?? c?.name}</b>
          <OnlineDot seat={online} />
        </span>
        <span className="muted small">{p ? (c ? c.name : "no character yet") : "no player"}</span>
        {c && (
          <span className="muted small">
            {c.className} {c.level} · HP {c.hp}/{c.maxHp} · AC {c.ac}
          </span>
        )}
      </span>
      <span className="seat-flags">
        {p?.ai && <span title="AI player">🤖</span>}
        {p && !p.ai && (
          <span className={p.voiceSamples ? "ok" : "muted"} title={p.voiceSamples ? `Voice known (${p.voiceSamples})` : "Voice not recorded"}>
            🎙{p.voiceSamples ? "✓" : "✗"}
          </span>
        )}
        {broken && (
          <span className="bad" title="Breaks the campaign's character rules">
            ⚠
          </span>
        )}
      </span>
    </button>
  );
}

/** Ways to add a character: build by hand, import a sheet, AI pregens or a roster hero. Pregens and the pasted sheet live in PartyTab so they survive switching seats. */
interface AddCharacterState {
  mode: "form" | "import" | "pregen" | "roster";
  setMode: (m: AddCharacterState["mode"]) => void;
  sheet: string;
  setSheet: (s: string) => void;
  sheetPlayer: string;
  setSheetPlayer: (s: string) => void;
  pregens: Draft[];
  setPregens: (f: (list: Draft[]) => Draft[]) => void;
  pregenCount: number;
  setPregenCount: (n: number) => void;
  wishes: string;
  setWishes: (s: string) => void;
  busy: boolean;
  generate: () => void;
  importSheet: (playerId: string) => void;
}

function AddCharacter({ a, forPlayer, view, run, rosterVersion, onRosterChange }: { a: AddCharacterState; forPlayer?: Player; view: ServerView; run: Run; rosterVersion: number; onRosterChange: () => void }) {
  const state = view.state!;
  const importFor = a.sheetPlayer || forPlayer?.id || "";
  const take = (d: Draft, i: number, playerId: string) =>
    run(async () => {
      await api("/characters", { character: d, playerId: playerId || undefined });
      a.setPregens((list) => list.filter((_, j) => j !== i));
    });
  return (
    <div className="add-character">
      <h3>{forPlayer ? `Give ${forPlayer.name} a character` : "Add a character"}</h3>
      <nav className="subtabs">
        <button className={a.mode === "form" ? "active" : ""} onClick={() => a.setMode("form")}>
          Build one
        </button>
        <button className={a.mode === "import" ? "active" : ""} onClick={() => a.setMode("import")}>
          Import a sheet
        </button>
        <button className={a.mode === "pregen" ? "active" : ""} onClick={() => a.setMode("pregen")}>
          AI pregens
        </button>
        <button className={a.mode === "roster" ? "active" : ""} onClick={() => a.setMode("roster")}>
          Bring an existing hero
        </button>
      </nav>

      {a.mode === "form" && <CharacterForm key={forPlayer?.id ?? ""} players={state.players} playerId={forPlayer?.id} constraints={view.campaign?.constraints} run={run} />}

      {a.mode === "roster" && <RosterPanel state={state} run={run} version={rosterVersion} onChange={onRosterChange} />}

      {a.mode === "import" && (
        <div className="form">
          <p className="muted">Paste a character sheet (D&D Beyond text, PDF text, notes). The AI converts it.</p>
          <select value={importFor} onChange={(e) => a.setSheetPlayer(e.target.value)}>
            <option value="">Player…</option>
            {state.players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <textarea rows={10} value={a.sheet} onChange={(e) => a.setSheet(e.target.value)} placeholder="Paste the sheet here" />
          <button className="primary" disabled={a.busy || !a.sheet} onClick={() => a.importSheet(importFor)}>
            {a.busy ? "Reading…" : "Import"}
          </button>
        </div>
      )}

      {a.mode === "pregen" && (
        <div className="form">
          <div className="row">
            <label>
              How many <input type="number" min={1} max={8} value={a.pregenCount} onChange={(e) => a.setPregenCount(+e.target.value)} />
            </label>
            <input className="grow" placeholder="Wishes, e.g. 'a healer, a sneaky one, something with a big axe'" value={a.wishes} onChange={(e) => a.setWishes(e.target.value)} />
            <button className="primary" disabled={a.busy} onClick={a.generate}>
              {a.busy ? "Creating…" : "Generate"}
            </button>
          </div>
          <div className="pregens">
            {a.pregens.map((d, i) => (
              <div key={i} className="pregen">
                <b>{d.name}</b>
                <div className="muted">
                  {d.species} {d.className} {d.level} · HP {d.maxHp} · AC {d.ac}
                </div>
                <p>{d.appearance}</p>
                {forPlayer ? (
                  <button className="primary small" onClick={() => take(d, i, forPlayer.id)}>
                    Take for {forPlayer.name}
                  </button>
                ) : (
                  <select defaultValue="" onChange={(e) => take(d, i, e.target.value)}>
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
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** The selected seat (right pane): the player's controls, the hero's actions and full sheet, or ways to add one. */
function SeatPane(props: {
  seat: Seat;
  view: ServerView;
  run: Run;
  mic: MicControl;
  online?: OnlineSeat;
  reloadOnline: () => Promise<void>;
  editing: boolean;
  setEditing: (on: boolean) => void;
  onPortrait: (c: Character) => void;
  onRosterChange: () => void;
  add: ReactNode;
}) {
  const { seat, view, run, mic, online, editing, setEditing, onRosterChange } = props;
  const state = view.state!;
  const { player: p, character: c } = seat;
  const constraints = view.campaign?.constraints;
  const st = online && seatStatus(online);
  // Players without a character, for handing over a hero nobody holds.
  const free = state.players.filter((x) => !x.characterId || !state.characters.some((ch) => ch.id === x.characterId));
  return (
    <section className="card seat-pane" style={{ borderLeftColor: c?.color }}>
      <div className="seat-head">
        {c?.spriteUrl ? (
          <button className="char-portrait" title="View portrait" aria-label={`View ${c.name}'s portrait`} onClick={() => props.onPortrait(c)}>
            <img src={c.spriteUrl} alt="" />
          </button>
        ) : (
          <span className="pc-dot" style={{ background: c?.color ?? "#3a2e24" }} />
        )}
        <div className="grow">
          <div className="row wrap">
            <h2>{c?.name ?? p?.name}</h2>
            {c?.rosterId && (
              <span className="pill ok" title="Linked to the global roster: ending the campaign saves it back">
                linked
              </span>
            )}
            {c && <RulesBadge c={c} constraints={constraints} />}
          </div>
          <div className="muted">
            {c ? `${c.species} ${c.className} ${c.level} · HP ${c.hp}/${c.maxHp} · AC ${c.ac} · ${c.diceMode === "physical" ? "🎲 physical dice" : "💻 virtual dice"} · ` : ""}
            {p ? (c ? `played by ${p.name}${p.ai ? " (AI)" : ""}` : `no character yet${p.ai ? " · AI player" : ""}`) : "no player"}
            {st && <span className={st.tone}> · {st.label}</span>}
          </div>
          {c && rulesLine(c) && <div className="rules-line small">{rulesLine(c)}</div>}
        </div>
      </div>

      {p && (
        <div className="seat-controls row wrap">
          <select value={p.characterId ?? ""} title="Which hero this player runs" onChange={(e) => run(() => patch(`/players/${p.id}`, { characterId: e.target.value || null }))}>
            <option value="">— no character —</option>
            {state.characters.map((ch) => (
              <option key={ch.id} value={ch.id}>
                {ch.name}
              </option>
            ))}
          </select>
          <label className="row" title="An AI plays this seat: it speaks in its own voice on the TV and the DM rolls for it">
            <input type="checkbox" checked={p.ai} onChange={(e) => run(() => patch(`/players/${p.id}`, { ai: e.target.checked }))} /> 🤖 AI
          </label>
          {p.ai ? <AiPersona playerId={p.id} persona={p.aiPersona} run={run} /> : <Enrollment playerId={p.id} name={p.name} samples={p.voiceSamples} mic={mic} run={run} view={view} />}
          <button
            className="small"
            disabled={state.builder?.playerId === p.id}
            title={`The DM interviews ${p.name} and builds a character with them (${view.dm.status === "offline" ? "start the DM on the Play tab first, or fill the draft by hand" : "DM is running"})`}
            onClick={() => run(() => api("/builder/start", { playerId: p.id }))}
          >
            🗣 Build by voice
          </button>
          {st?.kickable && (
            <button
              className="small danger"
              title="Sign this device out and free the seat (rotate the code too if they shouldn't come back)"
              onClick={() => run(async () => (await api("/auth/kick", { playerId: p.id }), await props.reloadOnline()))}
            >
              Kick
            </button>
          )}
          <button className="danger small" title={`Remove ${p.name} from the table`} onClick={() => confirm(`Remove ${p.name}?`) && run(() => del(`/players/${p.id}`))}>
            ✕ Remove player
          </button>
        </div>
      )}

      {c && (
        <div className="row wrap">
          {!p && (
            <select value="" onChange={(e) => e.target.value && run(() => patch(`/players/${e.target.value}`, { characterId: c.id }))}>
              <option value="">Give to…</option>
              {free.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          )}
          <QuickActions c={c} run={run} />
          <button className="small" title={c.rosterId ? "Update this hero's roster entry with the current level, items and gold" : "Keep this hero in the global roster for later campaigns"} onClick={() => run(async () => (await api(`/roster/save/${c.id}`, {}), onRosterChange()))}>
            {c.rosterId ? "Update roster" : "Save to roster"}
          </button>
          <button className="small" onClick={() => setEditing(!editing)}>
            {editing ? "Close editor" : "✎ Edit"}
          </button>
        </div>
      )}

      {c && editing && <CharacterEditor key={c.id} character={c} constraints={constraints} run={run} onDone={() => setEditing(false)} />}
      {c && !editing && <CharacterDetails c={c} />}
      {!c && props.add}
    </section>
  );
}

export function PartyTab({ view, run, mic, caps, rosterVersion, onRosterChange }: { view: ServerView; run: Run; mic: MicControl; caps: Capabilities | null; rosterVersion: number; onRosterChange: () => void }) {
  const { state } = view;
  const [playerName, setPlayerName] = useState("");
  const [mode, setMode] = useState<AddCharacterState["mode"]>("form");
  const [sheet, setSheet] = useState("");
  const [sheetPlayer, setSheetPlayer] = useState("");
  const [pregens, setPregens] = useState<Draft[]>([]);
  const [pregenCount, setPregenCount] = useState(4);
  const [wishes, setWishes] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [portrait, setPortrait] = useState<Character | null>(null);
  const { sessions, reload: reloadOnline } = useOnlineSessions();
  // The tab stays mounted across tab switches; another campaign's drafts and pregens don't belong here.
  const campaignId = view.campaign?.id;
  const campaignRef = useRef(campaignId);
  campaignRef.current = campaignId;
  useEffect(() => {
    setPregens([]);
    setSheet("");
    setSheetPlayer("");
    setSelected(null);
    setEditing(false);
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

  const seats = buildSeats(state.players, state.characters);
  const sel = pickSelected(seats, selected);
  const seat = seats.find((s) => s.key === sel);
  const onlineOf = (s: Seat) => (s.player ? sessions?.seats.find((o) => o.playerId === s.player!.id) : undefined);
  const select = (key: string) => (setSelected(key), setEditing(false));
  const addPlayer = (ai: boolean) => run(async () => (await api("/players", { name: playerName, ...(ai ? { ai: true } : {}) }), setPlayerName("")));
  const constraints = view.campaign?.constraints;
  const ruleCount = (constraints?.customSpecies.length ?? 0) + (constraints?.allowedSpecies.length ?? 0) + (constraints?.allowedClasses.length ?? 0);

  const addState: AddCharacterState = {
    mode,
    setMode,
    sheet,
    setSheet,
    sheetPlayer,
    setSheetPlayer,
    pregens,
    setPregens,
    pregenCount,
    setPregenCount,
    wishes,
    setWishes,
    busy,
    generate: () =>
      busyRun(async () => {
        const forCampaign = campaignId;
        const drafts = await api<Draft[]>("/characters/pregens", { count: pregenCount, wishes });
        if (campaignRef.current === forCampaign) setPregens(() => drafts); // the host may have loaded another campaign meanwhile
      }),
    importSheet: (playerId) => busyRun(async () => (await api("/characters/import", { sheet, playerId: playerId || undefined }), setSheet(""))),
  };
  const add = (forPlayer?: Player) => <AddCharacter a={addState} forPlayer={forPlayer} view={view} run={run} rosterVersion={rosterVersion} onRosterChange={onRosterChange} />;

  return (
    <div className="party-tab">
      {state.builder && <BuilderPanel builder={state.builder} run={run} dmOffline={view.dm.status === "offline"} />}

      {(!mic.stream || !caps?.voiceId) && (
        <div className="mic-strip">
          <span className="grow">
            🎙 Each player records their voice once (name + a sentence); after that the DM knows who is talking.
            {!caps?.voiceId && <b className="bad"> {caps?.voiceIdStatus}</b>}
          </span>
          {!mic.stream && (
            <button className="small primary" onClick={() => run(() => mic.enable())}>
              Enable microphone
            </button>
          )}
        </div>
      )}

      <div className="party-toolbar row wrap">
        <RestControls characters={state.characters} run={run} />
        {state.characters.length > 0 && (
          <button title="Keep every character in the global roster (level, items, gold, voice) for later campaigns" onClick={() => run(async () => (await api("/roster/save-all", {}), onRosterChange()))}>
            💾 Save all to roster
          </button>
        )}
        {caps?.voiceId && state.players.some((p) => !p.ai && p.voiceSamples > 0) && <VoiceTest players={state.players} mic={mic} run={run} view={view} />}
      </div>

      <div className="party-split">
        <aside className="card seat-list">
          <h2>Seats</h2>
          <PlayerLinks players={state.players} characters={state.characters} />
          <div className="seats">
            {seats.map((s) => (
              <SeatRow key={s.key} seat={s} selected={s.key === sel} online={onlineOf(s)} constraints={constraints} onSelect={() => select(s.key)} />
            ))}
            {seats.length === 0 && <p className="muted">No players yet. Add the people at the table below.</p>}
          </div>
          <div className="row">
            <input className="grow" placeholder="Player name" value={playerName} onChange={(e) => setPlayerName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && playerName && addPlayer(false)} />
          </div>
          <div className="row wrap">
            <button disabled={!playerName} onClick={() => addPlayer(false)}>
              + Add player
            </button>
            <button disabled={!playerName} title="An AI plays this seat (give it a character, then a persona)" onClick={() => addPlayer(true)}>
              🤖 Add AI player
            </button>
          </div>
          <button className={`add-seat ${sel === NEW_SEAT ? "selected" : ""}`} onClick={() => select(NEW_SEAT)}>
            + Add a character
          </button>
        </aside>

        {sel === NEW_SEAT ? (
          <section className="card seat-pane">{add()}</section>
        ) : seat ? (
          <SeatPane
            seat={seat}
            view={view}
            run={run}
            mic={mic}
            online={onlineOf(seat)}
            reloadOnline={reloadOnline}
            editing={editing}
            setEditing={setEditing}
            onPortrait={setPortrait}
            onRosterChange={onRosterChange}
            add={add(seat.player)}
          />
        ) : (
          <section className="card seat-pane muted">Add a player to get started.</section>
        )}
      </div>

      {portrait?.spriteUrl && <PortraitView name={portrait.name} src={portrait.spriteUrl} appearance={portrait.appearance} onClose={() => setPortrait(null)} />}

      {view.campaign && (
        <details className="card party-section">
          <summary>
            <h2>Setup</h2>
            <span className="muted small">
              Phones: {view.campaign.creation.phoneCreation ? `on · level ${view.campaign.partyLevel}` : "off"} · Character rules: {ruleCount ? `${constraints!.customSpecies.length} custom species, ${constraints!.allowedSpecies.length || "any"} species, ${constraints!.allowedClasses.length || "all"} classes` : "anything goes"}
            </span>
          </summary>
          <PhoneCreationCard campaign={view.campaign} run={run} onRosterChange={onRosterChange} />
          <CharacterRulesCard campaign={view.campaign} run={run} />
        </details>
      )}

      <details className="card party-section">
        <summary>
          <h2>Online</h2>
          <span className="muted small">{sessions ? `Table code ${sessions.code} · ${sessions.seats.filter((x) => x.connected > 0).length} online` : "loading…"}</span>
        </summary>
        <OnlineCard s={sessions} reload={reloadOnline} run={run} />
      </details>
    </div>
  );
}
