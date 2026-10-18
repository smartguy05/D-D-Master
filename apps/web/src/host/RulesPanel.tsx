import { useState } from "react";
import type { Character } from "@dm/shared";
import { api, patch } from "../lib/api";
import {
  adjustPact,
  adjustSlots,
  characterActions,
  hitDiceLabel,
  levelUpOutcome,
  resourceRows,
  restSummary,
  shortRestArgs,
  shortRestRows,
  slotRows,
  toolError,
} from "../player/sheet";

/**
 * Host controls for the rules engine (Party tab): rests, level up, slot and resource adjusters,
 * Stabilize / Revive / End concentration. Every change goes through POST /api/tools/:name or
 * PATCH /api/characters/:id, so it is logged and can be undone. View logic lives in player/sheet.ts.
 */

type Run = (fn: () => Promise<unknown>) => Promise<void>;

/** Call a tool and turn a returned `{error}` into a thrown Error (run() shows it). */
async function tool(name: string, args: unknown): Promise<unknown> {
  const { result } = await api<{ result: unknown }>(`/tools/${name}`, args);
  const err = toolError(result);
  if (err) throw new Error(err);
  return result;
}

/** Short Rest / Long Rest buttons with the per-PC Hit Dice panel. */
export function RestControls({ characters, run }: { characters: Character[]; run: Run }) {
  const [open, setOpen] = useState(false);
  const [dice, setDice] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState("");
  const rows = shortRestRows(characters);
  const args = shortRestArgs(characters, dice);

  return (
    <div className="rest-controls">
      <div className="row">
        <button onClick={() => (setOpen(!open), setMsg(""))} disabled={!characters.length} title="1 hour: spend Hit Dice; Pact slots and short-rest features recover">
          ☾ Short rest…
        </button>
        <button
          disabled={!characters.length}
          title="8 hours: full HP, all slots, Hit Dice and features; concentration ends"
          onClick={() => confirm("Long Rest for the whole party?") && run(async () => setMsg(restSummary(await tool("long_rest", {}))))}
        >
          ☀ Long rest
        </button>
        {msg && <span className="muted small grow">{msg}</span>}
      </div>
      {open && (
        <div className="rest-panel">
          <p className="muted small">Hit Point Dice to spend (each rolls the die + CON). Characters at 0 HP can't rest.</p>
          <ul className="list">
            {rows.map((r) => (
              <li key={r.id}>
                <b>{r.name}</b>
                {r.canRest ? (
                  <label>
                    <input type="number" min={0} max={r.available} value={dice[r.id] ?? 0} onChange={(e) => setDice((d) => ({ ...d, [r.id]: Math.max(0, Math.min(r.available, +e.target.value || 0)) }))} />
                    of {r.available} d{r.die}
                  </label>
                ) : (
                  <span className="bad small">{r.reason}</span>
                )}
              </li>
            ))}
          </ul>
          <div className="row">
            <button
              className="primary"
              disabled={!args}
              onClick={() =>
                run(async () => {
                  setMsg(restSummary(await tool("short_rest", args)));
                  setDice({});
                  setOpen(false);
                })
              }
            >
              Finish short rest
            </button>
            <button onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Stabilize / Revive / End concentration quick buttons for a party row. */
export function QuickActions({ c, run }: { c: Character; run: Run }) {
  const a = characterActions(c);
  return (
    <>
      {a.stabilize && (
        <button className="small" title="DC 10 Medicine check succeeded, or Spare the Dying" onClick={() => run(() => tool("stabilize", { character_id: c.id }))}>
          ✚ Stabilize
        </button>
      )}
      {a.revive && (
        <button className="small" title="After a revival spell (Revivify, Raise Dead…)" onClick={() => confirm(`Revive ${c.name} with 1 HP?`) && run(() => tool("revive", { character_id: c.id, hp: 1 }))}>
          ✨ Revive
        </button>
      )}
      {a.endConcentration && (
        <button className="small" title={`End concentration on ${c.concentration?.spell}`} onClick={() => run(() => tool("end_concentration", { character_id: c.id }))}>
          ◎ End {c.concentration?.spell}
        </button>
      )}
    </>
  );
}

/** Rules section of the character editor: level up, slots, Pact slots, resources. */
export function RulesEditor({ c, run }: { c: Character; run: Run }) {
  const [hpMode, setHpMode] = useState<"average" | "roll">("average");
  const [options, setOptions] = useState<string[] | null>(null);
  const [subclass, setSubclass] = useState("");
  const [msg, setMsg] = useState("");
  const a = characterActions(c);
  const slots = slotRows(c);
  const res = resourceRows(c);
  const hd = hitDiceLabel(c);

  const levelUp = (sub?: string) =>
    run(async () => {
      setMsg("");
      const { result } = await api<{ result: unknown }>("/tools/level_up", { character_id: c.id, hp: hpMode, ...(sub ? { subclass: sub } : {}) });
      const out = levelUpOutcome(result);
      if (out.kind === "error") throw new Error(out.message);
      if (out.kind === "subclass") {
        setOptions(out.options);
        setSubclass(out.options[0] ?? "");
        setMsg(out.message);
        return;
      }
      setOptions(null);
      setMsg(out.message);
    });

  const slotStep = (row: (typeof slots)[number], delta: number) =>
    run(() => (row.pact ? patch(`/characters/${c.id}`, { pactSlots: adjustPact(c, delta) }) : patch(`/characters/${c.id}`, { spellSlots: adjustSlots(c, row.level, delta) })));

  return (
    <div className="rules-editor">
      <h3>Rules</h3>
      <div className="row">
        <span className="muted">
          Level {c.level}
          {c.subclass ? ` · ${c.subclass}` : ""}
          {hd ? ` · Hit Dice ${hd}` : ""}
        </span>
        {a.levelUp && (
          <>
            <select value={hpMode} onChange={(e) => setHpMode(e.target.value as "average" | "roll")}>
              <option value="average">Average HP</option>
              <option value="roll">Roll HP</option>
            </select>
            <button onClick={() => levelUp()}>⬆ Level up</button>
          </>
        )}
        <QuickActions c={c} run={run} />
      </div>
      {options && (
        <div className="row">
          <span>Subclass:</span>
          <select value={options.includes(subclass) ? subclass : ""} onChange={(e) => setSubclass(e.target.value)}>
            {options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
            <option value="">Other…</option>
          </select>
          {!options.includes(subclass) && <input placeholder="Subclass name" value={subclass} onChange={(e) => setSubclass(e.target.value)} />}
          <button className="primary" disabled={!subclass.trim()} onClick={() => levelUp(subclass.trim())}>
            Level up as {subclass || "…"}
          </button>
          <button onClick={() => (setOptions(null), setMsg(""))}>Cancel</button>
        </div>
      )}
      {msg && <p className="muted small">{msg}</p>}
      {slots.length > 0 && (
        <ul className="list rules-rows">
          {slots.map((r) => (
            <li key={r.key}>
              <span className="lbl">{r.label}</span>
              <button className="small" disabled={r.left <= 0} title="Spend a slot" onClick={() => slotStep(r, 1)}>
                −
              </button>
              <span className="pips">{r.pips.map((on, i) => <i key={i} className={`pip ${on ? "on" : ""}`} />)}</span>
              <button className="small" disabled={r.used <= 0} title="Give a slot back" onClick={() => slotStep(r, -1)}>
                +
              </button>
              <span className="muted">
                {r.left}/{r.max}
              </span>
            </li>
          ))}
        </ul>
      )}
      {res.length > 0 && (
        <ul className="list rules-rows">
          {res.map((r) => (
            <li key={r.name} title={r.note}>
              <span className="lbl">{r.name}</span>
              <button className="small" disabled={r.left <= 0} title="Use one" onClick={() => run(() => tool("use_resource", { character_id: c.id, resource: r.name, amount: 1 }))}>
                −
              </button>
              <span className="pips">{r.pips ? r.pips.map((on, i) => <i key={i} className={`pip ${on ? "on" : ""}`} />) : null}</span>
              <button className="small" disabled={r.used <= 0} title="Give one back" onClick={() => run(() => tool("use_resource", { character_id: c.id, resource: r.name, amount: -1 }))}>
                +
              </button>
              <span className="muted">
                {r.left}/{r.max} · {r.reset}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
