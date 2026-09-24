import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { abilityMod, formatMod, type Character, type CharacterBuilder, type GameState, type RollResult } from "@dm/shared";
import { api } from "../lib/api";
import { useServer, type ServerView } from "../lib/useServer";
import { ABILITY_KEYS, ABILITY_NAMES, d20, damageNotation, isSaveProficient, isSkillProficient, saveMod, SKILLS, skillMod, type Edge } from "./sheet";
import "./player.css";

const LAST_KEY = "dm.player";

function remember(id: string) {
  try {
    localStorage.setItem(LAST_KEY, id);
  } catch {
    /* storage unavailable */
  }
}

function lastPlayer(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

/** /player: pick who you are. */
export function PlayerPicker() {
  const view = useServer("player");
  const s = view.state;
  const last = lastPlayer();
  return (
    <div className="player-root">
      <header className="pl-header">
        <h1>Who are you?</h1>
        <span className={`dot ${view.connected ? "on" : ""}`} />
      </header>
      {!s && <p className="muted">{view.connected ? "No campaign loaded yet. Ask the host." : "Connecting…"}</p>}
      <div className="pl-pick">
        {s?.players.map((p) => {
          const ch = s.characters.find((c) => c.id === p.characterId);
          return (
            <Link key={p.id} to={`/player/${p.id}`} className={`pl-pick-btn ${p.id === last ? "last" : ""}`} onClick={() => remember(p.id)} style={{ borderColor: ch?.color }}>
              {ch?.spriteUrl ? <img src={ch.spriteUrl} alt="" /> : <span className="pc-dot" style={{ background: ch?.color ?? "#555" }} />}
              <span>
                <b>{p.name}</b>
                <span className="muted">{ch ? `${ch.name} · ${ch.species} ${ch.className} ${ch.level}` : "no character yet"}</span>
              </span>
            </Link>
          );
        })}
        {s && s.players.length === 0 && <p className="muted">The host hasn't added any players yet.</p>}
      </div>
    </div>
  );
}

/** /player/:playerId: one player's sheet on their phone. Read-mostly; the host keeps authority. */
export function PlayerPage() {
  const { playerId = "" } = useParams();
  const [lastRoll, setLastRoll] = useState<RollResult | null>(null);
  const [myCharId, setMyCharId] = useState<string | undefined>();
  const view = useServer("player", (roll) => {
    if (roll.rollerId && roll.rollerId === myCharId && !roll.secret) setLastRoll(roll);
  });
  const s = view.state;
  const player = s?.players.find((p) => p.id === playerId);
  const ch = s?.characters.find((c) => c.id === player?.characterId);

  useEffect(() => {
    setMyCharId(ch?.id);
    if (player) remember(player.id);
  }, [ch?.id, player]);

  if (!s) return <div className="player-root"><p className="muted">{view.connected ? "No campaign loaded." : "Connecting…"}</p></div>;
  if (!player)
    return (
      <div className="player-root">
        <p>That player isn't in this campaign.</p>
        <Link className="button" to="/player">Pick your player</Link>
      </div>
    );

  const builder = s.builder?.playerId === player.id ? s.builder : undefined;
  const scene = view.campaign?.outline?.locations.find((l) => l.id === s.locationId)?.name;

  return (
    <div className="player-root">
      <header className="pl-header">
        <div className="grow">
          <h1>{ch?.name ?? player.name}</h1>
          <div className="muted small">
            {ch ? `${ch.species} ${ch.className} ${ch.level} · ` : ""}
            {player.name}
            {scene ? ` · 📍 ${scene}` : ""}
          </div>
        </div>
        <span className={`dot ${view.connected ? "on" : ""}`} title={view.connected ? "connected" : "reconnecting"} />
        <Link to="/player" className="pl-switch">⇄</Link>
      </header>

      {builder && <DraftCard builder={builder} />}
      {!ch && !builder && <p className="muted pl-card">No character yet. Ask the host to add one, or to build one with the DM by voice.</p>}
      {ch && <Sheet ch={ch} state={s} view={view} playerId={player.id} lastRoll={lastRoll} />}
    </div>
  );
}

function Sheet({ ch, state, view, playerId, lastRoll }: { ch: Character; state: GameState; view: ServerView; playerId: string; lastRoll: RollResult | null }) {
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const pending = state.pendingRoll?.characterId === ch.id ? state.pendingRoll : undefined;
  const combat = state.combat.active ? state.combat : undefined;
  const current = combat?.order[combat.turnIndex];
  const myTurn = current?.entityId === ch.id;
  const hpPct = Math.max(0, Math.min(100, (ch.hp / ch.maxHp) * 100));
  const hpClass = hpPct <= 25 ? "low" : hpPct <= 50 ? "mid" : "";

  return (
    <>
      {myTurn && <div className="pl-your-turn">⚔ Your turn!</div>}
      {pending && <PhysicalPad playerId={playerId} label={pending.label} notation={pending.notation} run={run} />}
      {error && <div className="pl-error" onClick={() => setError(null)}>{error}</div>}

      <section className="pl-card">
        <div className="pl-hp">
          <div className={`pl-hp-fill ${hpClass}`} style={{ width: `${hpPct}%` }} />
          <div className="pl-hp-text">
            <b>{ch.hp}</b> / {ch.maxHp} HP{ch.tempHp ? <span className="temp"> +{ch.tempHp} temp</span> : null}
          </div>
        </div>
        <div className="pl-stats">
          <div><small>AC</small><b>{ch.ac}</b></div>
          <div><small>Speed</small><b>{ch.speed}</b></div>
          <div><small>Prof</small><b>{formatMod(ch.proficiencyBonus)}</b></div>
          <div><small>Gold</small><b>{ch.gold}</b></div>
        </div>
        {ch.conditions.length > 0 && (
          <div className="chips">
            {ch.conditions.map((x) => <span key={x} className="chip bad">{x}</span>)}
          </div>
        )}
      </section>

      {combat && (
        <section className="pl-card">
          <h2>Round {combat.round}</h2>
          <ol className="pl-order">
            {combat.order.map((o, i) => (
              <li key={o.entityId} className={`${i === combat.turnIndex ? "now" : ""} ${o.entityId === ch.id ? "me" : ""} ${o.entityType}`}>
                <span>{o.name}</span>
                <span className="muted">{o.initiative}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <Rolls ch={ch} playerId={playerId} run={run} lastRoll={lastRoll} dmRunning={view.dm.status !== "offline"} />

      <section className="pl-card">
        <h2>Abilities</h2>
        <div className="pl-abils">
          {ABILITY_KEYS.map((k) => (
            <div key={k} className="pl-abil">
              <small>{k.toUpperCase()}</small>
              <b>{formatMod(abilityMod(ch.abilities[k]))}</b>
              <span className="muted">{ch.abilities[k]}</span>
              <span className={`save ${isSaveProficient(ch, k) ? "prof" : ""}`}>save {formatMod(saveMod(ch, k))}</span>
            </div>
          ))}
        </div>
        <h3>Skills</h3>
        <ul className="pl-skills">
          {SKILLS.map(([name, ab]) => (
            <li key={name} className={isSkillProficient(ch, name) ? "prof" : ""}>
              <span>{name} <small className="muted">{ab}</small></span>
              <b>{formatMod(skillMod(ch, name, ab))}</b>
            </li>
          ))}
        </ul>
      </section>

      {ch.attacks.length > 0 && (
        <section className="pl-card">
          <h2>Attacks</h2>
          <ul className="pl-list">
            {ch.attacks.map((a, i) => (
              <li key={i}>
                <b>{a.name}</b> {a.toHit !== undefined && <span>{formatMod(a.toHit)} to hit</span>} {a.damage && <span className="muted">· {a.damage}</span>}
                {a.description && <p className="muted">{a.description}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(ch.spells.length > 0 || ch.features.length > 0) && (
        <section className="pl-card">
          {ch.spells.length > 0 && (
            <>
              <h2>Spells</h2>
              <div className="chips">{ch.spells.map((x) => <span key={x} className="chip">{x}</span>)}</div>
            </>
          )}
          {ch.features.length > 0 && (
            <>
              <h2>Features</h2>
              <ul className="pl-list">{ch.features.map((x) => <li key={x}>{x}</li>)}</ul>
            </>
          )}
        </section>
      )}

      <section className="pl-card">
        <h2>Inventory</h2>
        {ch.inventory.length === 0 && <p className="muted">Empty.</p>}
        <ul className="pl-list">
          {ch.inventory.map((i) => (
            <li key={i.id}>
              <details>
                <summary>
                  <b>{i.name}</b>
                  {i.qty > 1 && <span className="muted"> ×{i.qty}</span>}
                  {i.equipped && <span className="chip">equipped</span>}
                </summary>
                <p className="muted">{i.description || "No description."}</p>
              </details>
            </li>
          ))}
        </ul>
        <p className="muted small">💰 {ch.gold} gp</p>
      </section>

      <section className="pl-card">
        <h2>Dice</h2>
        <div className="pl-toggle">
          {(["virtual", "physical"] as const).map((m) => (
            <button key={m} className={ch.diceMode === m ? "active" : ""} onClick={() => run(() => api(`/players/${playerId}/dice-mode`, { diceMode: m }))}>
              {m === "virtual" ? "📱 Roll here" : "🎲 Real dice"}
            </button>
          ))}
        </div>
        {(ch.appearance || ch.notes || ch.background) && (
          <>
            <h3>About</h3>
            {ch.background && <p className="muted">Background: {ch.background}</p>}
            {ch.appearance && <p className="muted">{ch.appearance}</p>}
            {ch.notes && <p className="muted">{ch.notes}</p>}
          </>
        )}
      </section>
    </>
  );
}

/** Number pad for the physical roll the DM is waiting on. Only shown to the rolling player. */
function PhysicalPad({ playerId, label, notation, run }: { playerId: string; label: string; notation: string; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [value, setValue] = useState("");
  const press = (k: string) => setValue((v) => (k === "⌫" ? v.slice(0, -1) : k === "±" ? (v.startsWith("-") ? v.slice(1) : `-${v}`) : v.length < 3 ? v + k : v));
  return (
    <section className="pl-card pl-pending">
      <div>
        🎲 Roll <b>{notation}</b> for <b>{label}</b> and enter the total
      </div>
      <div className="pl-pad-value">{value || "–"}</div>
      <div className="pl-pad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "±", "0", "⌫"].map((k) => (
          <button key={k} onClick={() => press(k)}>{k}</button>
        ))}
      </div>
      <button className="primary big pl-wide" disabled={!value || value === "-"} onClick={() => run(async () => (await api(`/players/${playerId}/physical-roll`, { total: Number(value) }), setValue("")))}>
        Send {value}
      </button>
    </section>
  );
}

function Rolls({ ch, playerId, run, lastRoll, dmRunning }: { ch: Character; playerId: string; run: (fn: () => Promise<unknown>) => Promise<void>; lastRoll: RollResult | null; dmRunning: boolean }) {
  const [edge, setEdge] = useState<Edge>("normal");
  const [kind, setKind] = useState<"skill" | "save" | "attack" | "custom">("skill");
  const [custom, setCustom] = useState("1d20");
  const [customLabel, setCustomLabel] = useState("");
  const [busy, setBusy] = useState(false);

  if (ch.diceMode === "physical") {
    return (
      <section className="pl-card">
        <h2>Rolling</h2>
        <p className="muted">You roll real dice. When the DM asks, a number pad appears here for your total.</p>
      </section>
    );
  }

  const roll = (notation: string, label: string) =>
    run(async () => {
      setBusy(true);
      try {
        await api(`/players/${playerId}/roll`, { notation, label });
      } finally {
        setBusy(false);
      }
    });
  const edgeLabel = edge === "adv" ? " (adv)" : edge === "dis" ? " (dis)" : "";

  return (
    <section className="pl-card">
      <h2>Roll</h2>
      {lastRoll && (
        <div className="pl-last-roll">
          {lastRoll.label || lastRoll.notation}: <b>{lastRoll.total}</b>
          <span className="muted"> [{lastRoll.dice.map((d) => (d.dropped ? `(${d.value})` : d.value)).join(", ")}]</span>
        </div>
      )}
      <div className="pl-toggle">
        {(["normal", "adv", "dis"] as const).map((e) => (
          <button key={e} className={edge === e ? "active" : ""} onClick={() => setEdge(e)}>
            {e === "normal" ? "Normal" : e === "adv" ? "Advantage" : "Disadvantage"}
          </button>
        ))}
      </div>
      <div className="pl-toggle">
        {(["skill", "save", "attack", "custom"] as const).map((k) => (
          <button key={k} className={kind === k ? "active" : ""} onClick={() => setKind(k)}>
            {k[0].toUpperCase() + k.slice(1)}
          </button>
        ))}
      </div>
      <div className="pl-roll-grid">
        {kind === "skill" &&
          SKILLS.map(([name, ab]) => {
            const mod = skillMod(ch, name, ab);
            return (
              <button key={name} disabled={busy} onClick={() => roll(d20(mod, edge), `${name}${edgeLabel}`)}>
                {name} <b>{formatMod(mod)}</b>
              </button>
            );
          })}
        {kind === "save" &&
          ABILITY_KEYS.map((k) => {
            const mod = saveMod(ch, k);
            return (
              <button key={k} disabled={busy} onClick={() => roll(d20(mod, edge), `${ABILITY_NAMES[k]} save${edgeLabel}`)}>
                {ABILITY_NAMES[k]} <b>{formatMod(mod)}</b>
              </button>
            );
          })}
        {kind === "attack" &&
          ch.attacks.flatMap((a, i) => {
            const dmg = damageNotation(a.damage);
            return [
              a.toHit !== undefined && (
                <button key={`h${i}`} disabled={busy} onClick={() => roll(d20(a.toHit!, edge), `${a.name} attack${edgeLabel}`)}>
                  {a.name} <b>{formatMod(a.toHit)}</b>
                </button>
              ),
              dmg && (
                <button key={`d${i}`} disabled={busy} onClick={() => roll(dmg, `${a.name} damage`)}>
                  {a.name} dmg <b>{dmg}</b>
                </button>
              ),
            ].filter(Boolean);
          })}
        {kind === "attack" && ch.attacks.length === 0 && <p className="muted">No attacks on your sheet.</p>}
      </div>
      {kind === "custom" && (
        <div className="pl-custom">
          <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="1d20+3" inputMode="text" />
          <input value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} placeholder="What for?" />
          <button className="primary" disabled={busy || !custom} onClick={() => roll(custom, customLabel || custom)}>
            Roll
          </button>
        </div>
      )}
      <p className="muted small">Rolls show on the table screen{dmRunning ? " and the DM hears about them" : ""}.</p>
    </section>
  );
}

/** Live view of the character the DM is building with this player. */
function DraftCard({ builder }: { builder: CharacterBuilder }) {
  const d = builder.draft;
  const rows: [string, string | undefined][] = [
    ["Name", d.name],
    ["Species", d.species],
    ["Class", d.className ? `${d.className} ${builder.level}` : undefined],
    ["Background", d.background],
    ["Abilities", d.abilities ? ABILITY_KEYS.filter((k) => d.abilities?.[k] !== undefined).map((k) => `${k.toUpperCase()} ${d.abilities![k]}`).join(" · ") : undefined],
    ["HP / AC", d.maxHp || d.ac ? `${d.maxHp ?? "?"} / ${d.ac ?? "?"}` : undefined],
    ["Skills", d.skills?.join(", ")],
    ["Attacks", d.attacks?.map((a) => a.name).join(", ")],
    ["Spells", d.spells?.join(", ")],
    ["Gear", d.inventory?.map((i) => (i.qty > 1 ? `${i.name} ×${i.qty}` : i.name)).join(", ")],
    ["Looks", d.appearance],
  ];
  return (
    <section className="pl-card pl-draft">
      <h2>✨ Your new character (level {builder.level})</h2>
      <p className="muted small">Talk it through with the DM. This updates as you decide.</p>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k} className={v ? "" : "todo"}>
            <dt>{k}</dt>
            <dd>{v || "…"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
