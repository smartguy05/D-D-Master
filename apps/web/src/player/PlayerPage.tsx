import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { abilityMod, formatMod, type Character, type CharacterBuilder, type GameState, type RollResult, type SpellChipInfo } from "@dm/shared";
import { api, put } from "../lib/api";
import { chooseNotes, NOTES_SAVE_DELAY_MS, readDraft, writeDraft } from "./notes";
import { useServer, type ServerView } from "../lib/useServer";
import {
  ABILITY_KEYS,
  ABILITY_NAMES,
  d20,
  damageNotation,
  deathSaveView,
  hitDiceLabel,
  isSaveProficient,
  isSkillProficient,
  resourceRows,
  saveMod,
  SKILLS,
  skillMod,
  slotRows,
  sortSpellNames,
  spellTags,
  type Edge,
} from "./sheet";
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
        {ch.concentration && <div className="pl-conc" title="You are concentrating on this spell">◎ Concentrating: <b>{ch.concentration.spell}</b></div>}
        <DeathSaves ch={ch} />
      </section>

      <RulesCard ch={ch} />

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
          {ch.spells.length > 0 && <SpellChips spells={ch.spells} playerId={playerId} refreshKey={spellRowsKey(ch)} />}
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

      <PlayerNotes playerId={playerId} />

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

/** Death Saving Throw pips (3 successes, 3 failures), only while at 0 HP; Stable / Dead badges. */
function DeathSaves({ ch }: { ch: Character }) {
  const v = deathSaveView(ch);
  if (!v) return null;
  if (v.state === "dead") return <div className="pl-ds dead">☠ Dead</div>;
  if (v.state === "stable") return <div className="pl-ds stable">✚ Stable <span className="muted small">unconscious, no more death saves</span></div>;
  return (
    <div className="pl-ds">
      <div className="pl-ds-title">Death saves</div>
      <div className="pl-ds-row ok" aria-label={`${ch.deathSaves.successes} successes`}>
        <span>Successes</span>
        {v.successes.map((on, i) => <i key={i} className={`pip ${on ? "on" : ""}`} />)}
      </div>
      <div className="pl-ds-row bad" aria-label={`${ch.deathSaves.failures} failures`}>
        <span>Failures</span>
        {v.failures.map((on, i) => <i key={i} className={`pip ${on ? "on" : ""}`} />)}
      </div>
    </div>
  );
}

/** Spell slots, Pact Magic, Hit Dice and class resources (read-only; the host and the DM change them). */
function RulesCard({ ch }: { ch: Character }) {
  const slots = slotRows(ch);
  const res = resourceRows(ch);
  const hd = hitDiceLabel(ch);
  if (!slots.length && !res.length && !hd) return null;
  return (
    <section className="pl-card">
      {slots.length > 0 && (
        <>
          <h2>Spell slots</h2>
          <ul className="pl-slots">
            {slots.map((r) => (
              <li key={r.key} className={r.pact ? "pact" : ""}>
                <span className="lbl">{r.label}</span>
                <span className="pips">{r.pips.map((on, i) => <i key={i} className={`pip ${on ? "on" : ""}`} />)}</span>
                <span className="muted">{r.left}/{r.max}</span>
              </li>
            ))}
          </ul>
          {ch.pactSlots && <p className="muted small">Pact slots come back on a Short Rest.</p>}
        </>
      )}
      {hd && (
        <div className="pl-hd">
          <span>Hit Dice</span>
          <b>{hd}</b>
        </div>
      )}
      {res.length > 0 && (
        <>
          <h3>Features with uses</h3>
          <ul className="pl-slots">
            {res.map((r) => (
              <li key={r.name} title={r.note}>
                <span className="lbl">{r.name}</span>
                <span className="pips">{r.pips ? r.pips.map((on, i) => <i key={i} className={`pip ${on ? "on" : ""}`} />) : null}</span>
                <span className="muted">{r.left}/{r.max}</span>
                <small className="muted reset">{r.reset}</small>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** Spell chips with a level badge and C(oncentration)/R(itual) tags; tap one for its SRD summary. */
/** The spell card's damage rows depend on level, abilities and the slots left: refetch when they change. */
function spellRowsKey(ch: Character): string {
  return JSON.stringify([ch.level, ch.className, ch.abilities, ch.spellSlots, ch.pactSlots ?? null]);
}

function SpellChips({ spells, playerId, refreshKey }: { spells: string[]; playerId: string; refreshKey: string }) {
  const [info, setInfo] = useState<SpellChipInfo[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const key = `${spells.join("|")}#${refreshKey}`;
  useEffect(() => {
    let live = true;
    api<{ spells: SpellChipInfo[] }>(`/players/${playerId}/spells`)
      .then((r) => live && setInfo(r.spells))
      .catch(() => live && setInfo([]));
    return () => {
      live = false;
    };
  }, [playerId, key]);
  const byName = new Map(info.map((i) => [i.name, i]));
  const sel = open ? byName.get(open.trim()) : undefined;
  return (
    <>
      <h2>Spells</h2>
      <div className="chips">
        {sortSpellNames(spells, info).map((x) => {
          const t = spellTags(byName.get(x.trim()));
          return (
            <button key={x} className={`chip spell ${open === x ? "open" : ""}`} onClick={() => setOpen(open === x ? null : x)}>
              <span className="lvl" title={t.title}>{t.badge}</span>
              {x}
              {t.concentration && <span className="tag c" title="Concentration">C</span>}
              {t.ritual && <span className="tag r" title="Ritual">R</span>}
            </button>
          );
        })}
      </div>
      {open && (
        <div className="pl-spell-card">
          <b>{sel?.srdName ?? open}</b>
          {sel?.known ? (
            <>
              <div className="muted small">
                {sel.level === 0 ? `${sel.school} cantrip` : `Level ${sel.level} ${sel.school}`} · {sel.castingTime} · {sel.range} · {sel.duration}
              </div>
              <p>{sel.summary}</p>
              {sel.atLevels && sel.atLevels.length > 0 && (
                <table className="pl-spell-levels">
                  <tbody>
                    {sel.atLevels.map((r) => (
                      <tr key={r.level} className={r.available ? "" : "spent"} title={r.available ? undefined : "No slot of this level left"}>
                        <th>{r.level === 0 ? "Now" : `L${r.level}`}</th>
                        <td>
                          {[r.damage, r.heal && `heals ${r.heal}`, r.extraTargets && `+${r.extraTargets} target${r.extraTargets > 1 ? "s" : ""}`].filter(Boolean).join(" · ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : (
            <p className="muted">Not in the SRD spell list. Ask the DM.</p>
          )}
        </div>
      )}
    </>
  );
}

/** Private notes: only on this phone (saved on the server, never sent to the DM or other screens). */
function PlayerNotes({ playerId }: { playerId: string }) {
  const [text, setText] = useState(() => readDraft(playerId)?.text ?? "");
  const [status, setStatus] = useState<"loading" | "saved" | "saving" | "offline">("loading");
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const latest = useRef(text);

  const save = (value: string) => {
    setStatus("saving");
    put(`/players/${playerId}/notes`, { text: value })
      .then(() => {
        // A newer edit may have landed meanwhile; its own save will follow.
        if (latest.current === value) {
          writeDraft(playerId, { text: value, dirty: false });
          setStatus("saved");
        }
      })
      .catch(() => setStatus("offline"));
  };

  useEffect(() => {
    let live = true;
    api<{ text: string }>(`/players/${playerId}/notes`)
      .then((r) => {
        if (!live) return;
        const pick = chooseNotes(r.text, readDraft(playerId));
        latest.current = pick.text;
        setText(pick.text);
        if (pick.needsSave) save(pick.text);
        else setStatus("saved");
      })
      .catch(() => live && setStatus("offline"));
    return () => {
      live = false;
      clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId]);

  const onChange = (value: string) => {
    setText(value);
    latest.current = value;
    writeDraft(playerId, { text: value, dirty: true });
    setStatus("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(value), NOTES_SAVE_DELAY_MS);
  };

  return (
    <section className="pl-card">
      <h2>
        My notes <span className={`pl-notes-status ${status}`}>{status === "saved" ? "saved ✓" : status === "saving" ? "saving…" : status === "offline" ? "offline: kept on this phone" : ""}</span>
      </h2>
      <textarea className="pl-notes" value={text} placeholder="Clues, names, loot, plans… only you can see these." onChange={(e) => onChange(e.target.value)} maxLength={20000} rows={6} />
    </section>
  );
}

/** Number pad for the physical roll the DM is waiting on. Only shown to the rolling player. */
function PhysicalPad({ playerId, label, notation, run }: { playerId: string; label: string; notation: string; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [value, setValue] = useState("");
  const [natural, setNatural] = useState<1 | 20 | undefined>();
  const d20 = /d20/i.test(notation);
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
      {d20 && (
        <div className="pl-nat">
          {([20, 1] as const).map((n) => (
            <button key={n} className={natural === n ? (n === 20 ? "on crit" : "on fumble") : ""} onClick={() => setNatural(natural === n ? undefined : n)}>
              {n === 20 ? "⭐ Natural 20" : "💀 Natural 1"}
            </button>
          ))}
        </div>
      )}
      <button
        className="primary big pl-wide"
        disabled={!value || value === "-"}
        onClick={() =>
          run(async () => {
            await api(`/players/${playerId}/physical-roll`, { total: Number(value), natural: d20 ? natural : undefined });
            setValue("");
            setNatural(undefined);
          })
        }
      >
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
