import { useEffect, useState } from "react";
import type { Abilities, Attack, Character, CharacterConstraints, Item, Player } from "@dm/shared";
import { abilityMod, checkConstraints, formatMod } from "@dm/shared";
import { api, del, patch } from "../lib/api";
import { RulesEditor } from "./RulesPanel";
import { editField, editHint, isDirty, savedField, syncEditField, type EditField } from "./editFields";

const PERSONA_KEYS = ["personality", "ideals", "bonds", "flaws", "backstory"] as const;
const EDIT_KEYS = ["hp", "maxHp", "ac", "gold", "appearance", ...PERSONA_KEYS] as const;
type EditKey = (typeof EDIT_KEYS)[number];

type Run = (fn: () => Promise<unknown>) => Promise<void>;
export type Draft = Omit<Character, "id" | "hp" | "spriteUrl" | "color">;

const ABILITIES: (keyof Abilities)[] = ["str", "dex", "con", "int", "wis", "cha"];

function parseAttacks(text: string): Attack[] {
  // "Longsword +5 1d8+3 slashing" per line
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = /^(.*?)\s+([+-]\d+)\s+(.+)$/.exec(l);
      return m ? { name: m[1], toHit: parseInt(m[2], 10), damage: m[3] } : { name: l };
    });
}

function parseItems(text: string): Item[] {
  // "Rope" or "Torch x5" per line
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l, i) => {
      const m = /^(.*?)\s*[x×]\s*(\d+)$/i.exec(l);
      return { id: `new_${i}`, name: m ? m[1] : l, qty: m ? parseInt(m[2], 10) : 1 };
    });
}

/** Manual character builder (the "fill in the form" path). */
export function CharacterForm({ players, constraints, run }: { players: Player[]; constraints?: CharacterConstraints; run: Run }) {
  const [f, setF] = useState({
    name: "",
    playerId: "",
    species: "Human",
    className: "Fighter",
    level: 1,
    maxHp: 12,
    ac: 16,
    speed: 30,
    appearance: "",
    attacks: "Longsword +5 1d8+3 slashing",
    items: "Explorer's Pack\nTorch x5\nRations x5",
    skills: "Athletics, Perception",
    saves: "",
    gold: 10,
    diceMode: "virtual" as "virtual" | "physical",
  });
  const [abil, setAbil] = useState<Abilities>({ str: 16, dex: 13, con: 14, int: 8, wis: 12, cha: 10 });
  const set = (k: keyof typeof f, v: unknown) => setF((x) => ({ ...x, [k]: v }));

  const submit = () =>
    run(async () => {
      const character = {
        name: f.name,
        species: f.species,
        className: f.className,
        level: f.level,
        maxHp: f.maxHp,
        ac: f.ac,
        speed: f.speed,
        appearance: f.appearance,
        abilities: abil,
        proficiencyBonus: 2 + Math.floor((f.level - 1) / 4),
        attacks: parseAttacks(f.attacks),
        inventory: parseItems(f.items),
        skills: f.skills.split(",").map((s) => s.trim()).filter(Boolean),
        // Empty: the server fills the SRD class's saving throw proficiencies.
        savingThrows: f.saves.split(",").map((s) => s.trim().toLowerCase().slice(0, 3)).filter(Boolean),
        gold: f.gold,
        diceMode: f.diceMode,
      };
      await api("/characters", { character, playerId: f.playerId || undefined });
      set("name", "");
    });

  return (
    <div className="form char-form">
      <div className="row wrap">
        <input placeholder="Character name" value={f.name} onChange={(e) => set("name", e.target.value)} />
        <select value={f.playerId} onChange={(e) => set("playerId", e.target.value)}>
          <option value="">Player…</option>
          {players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input placeholder="Species" value={f.species} onChange={(e) => set("species", e.target.value)} />
        <input placeholder="Class" value={f.className} onChange={(e) => set("className", e.target.value)} />
        <label>
          Lvl <input type="number" min={1} max={20} value={f.level} onChange={(e) => set("level", +e.target.value)} />
        </label>
        <label>
          HP <input type="number" min={1} value={f.maxHp} onChange={(e) => set("maxHp", +e.target.value)} />
        </label>
        <label>
          AC <input type="number" min={0} value={f.ac} onChange={(e) => set("ac", +e.target.value)} />
        </label>
        <label>
          Gold <input type="number" min={0} value={f.gold} onChange={(e) => set("gold", +e.target.value)} />
        </label>
        <select value={f.diceMode} onChange={(e) => set("diceMode", e.target.value)}>
          <option value="virtual">💻 Virtual dice</option>
          <option value="physical">🎲 Physical dice</option>
        </select>
      </div>
      <RulesWarning species={f.species} className={f.className} constraints={constraints} />
      <div className="row wrap">
        {ABILITIES.map((k) => (
          <label key={k} className="abil">
            {k.toUpperCase()}
            <input type="number" min={1} max={30} value={abil[k]} onChange={(e) => setAbil((a) => ({ ...a, [k]: +e.target.value }))} />
            <span className="muted">{formatMod(abilityMod(abil[k]))}</span>
          </label>
        ))}
      </div>
      <input placeholder="Appearance (used to draw the token), e.g. 'stocky red-bearded dwarf in dented plate armor'" value={f.appearance} onChange={(e) => set("appearance", e.target.value)} />
      <input placeholder="Skills, comma separated" value={f.skills} onChange={(e) => set("skills", e.target.value)} />
      <input placeholder="Saving throws, e.g. STR, CON (empty: the class's)" value={f.saves} onChange={(e) => set("saves", e.target.value)} />
      <div className="row">
        <label className="grow">
          Attacks (one per line: name +hit damage)
          <textarea rows={3} value={f.attacks} onChange={(e) => set("attacks", e.target.value)} />
        </label>
        <label className="grow">
          Inventory (one per line, "Torch x5")
          <textarea rows={3} value={f.items} onChange={(e) => set("items", e.target.value)} />
        </label>
      </div>
      <button className="primary" disabled={!f.name} onClick={submit}>
        Create character
      </button>
    </div>
  );
}

/** The host may break the campaign's character rules (an override); say so, but don't block the save. */
function RulesWarning({ species, className, constraints }: { species: string; className: string; constraints?: CharacterConstraints }) {
  const issues = checkConstraints({ species, className }, constraints);
  if (!issues.length) return null;
  return <p className="rules-warning">⚠ {issues.map((i) => i.message).join(" ")} You can still save it as the host.</p>;
}

/** Host override panel: fix anything the AI got wrong. */
export function CharacterEditor({ character: c, constraints, run, onDone }: { character: Character; constraints?: CharacterConstraints; run: Run; onDone: () => void }) {
  const [fields, setFields] = useState(() => ({
    hp: editField(c.hp),
    maxHp: editField(c.maxHp),
    ac: editField(c.ac),
    gold: editField(c.gold),
    appearance: editField(c.appearance),
    personality: editField(c.personality),
    ideals: editField(c.ideals),
    bonds: editField(c.bonds),
    flaws: editField(c.flaws),
    backstory: editField(c.backstory),
  }));
  const [item, setItem] = useState("");
  const [cond, setCond] = useState("");
  const server: Record<EditKey, number | string> = { hp: c.hp, maxHp: c.maxHp, ac: c.ac, gold: c.gold, appearance: c.appearance, personality: c.personality, ideals: c.ideals, bonds: c.bonds, flaws: c.flaws, backstory: c.backstory };
  // Follow server changes (rests, damage, level-up) in fields the host hasn't typed into; typed,
  // unsaved values are kept and get a "changed on server" hint (editFields.ts).
  useEffect(() => {
    setFields((f) => {
      const next = { ...f };
      for (const k of EDIT_KEYS) (next as Record<EditKey, EditField<unknown>>)[k] = syncEditField(f[k] as EditField<unknown>, server[k]);
      return EDIT_KEYS.every((k) => next[k] === f[k]) ? f : next;
    });
  }, [c.hp, c.maxHp, c.ac, c.gold, c.appearance, c.personality, c.ideals, c.bonds, c.flaws, c.backstory]);
  const set = (k: EditKey, value: number | string) => setFields((f) => ({ ...f, [k]: { ...f[k], value } }));
  const dirtyPatch = () => Object.fromEntries(EDIT_KEYS.filter((k) => isDirty(fields[k] as EditField<unknown>)).map((k) => [k, fields[k].value]));
  const markSaved = (keys: EditKey[]) => setFields((f) => ({ ...f, ...Object.fromEntries(keys.map((k) => [k, savedField(f[k] as EditField<unknown>)])) }));
  const hint = (k: EditKey) => {
    const h = editHint(fields[k] as EditField<unknown>, server[k]);
    return h ? <small className="hint">{h}</small> : null;
  };
  const num = (k: "hp" | "maxHp" | "ac" | "gold", label: string) => (
    <label className={isDirty(fields[k]) ? "dirty" : ""}>
      {label} <input type="number" value={fields[k].value} onChange={(e) => set(k, +e.target.value)} />
      {hint(k)}
    </label>
  );
  const save = () =>
    run(async () => {
      const body = dirtyPatch();
      if (!Object.keys(body).length) return;
      await patch(`/characters/${c.id}`, body);
      markSaved(Object.keys(body) as EditKey[]);
    });

  return (
    <div className="editor">
      <h3>Edit {c.name}</h3>
      <RulesWarning species={c.species} className={c.className} constraints={constraints} />
      <div className="row wrap">
        {num("hp", "HP")}
        {num("maxHp", "Max")}
        {num("ac", "AC")}
        {num("gold", "Gold")}
        <select value={c.diceMode} onChange={(e) => run(() => patch(`/characters/${c.id}`, { diceMode: e.target.value }))}>
          <option value="virtual">💻 Virtual dice</option>
          <option value="physical">🎲 Physical dice</option>
        </select>
        <button className="primary" disabled={!EDIT_KEYS.some((k) => isDirty(fields[k] as EditField<unknown>))} onClick={save}>
          Save
        </button>
      </div>
      <div className="row wrap persona-edit">
        {PERSONA_KEYS.map((k) => (
          <label key={k} className={`grow ${isDirty(fields[k]) ? "dirty" : ""}`}>
            {k[0].toUpperCase() + k.slice(1)}
            {k === "backstory" ? (
              <textarea rows={2} value={fields[k].value} onChange={(e) => set(k, e.target.value)} />
            ) : (
              <input value={fields[k].value} onChange={(e) => set(k, e.target.value)} />
            )}
            {hint(k)}
          </label>
        ))}
      </div>
      <RulesEditor c={c} run={run} />
      <div className="chips">
        {c.conditions.map((x) => (
          <span key={x} className="chip bad" onClick={() => run(() => api("/tools/remove_condition", { target_id: c.id, condition: x }))} title="Click to remove">
            {x} ✕
          </span>
        ))}
        <input className="small" placeholder="Add condition" value={cond} onChange={(e) => setCond(e.target.value)} onKeyDown={(e) => e.key === "Enter" && cond && run(async () => (await api("/tools/add_condition", { target_id: c.id, condition: cond }), setCond("")))} />
      </div>
      <div className="chips">
        {c.inventory.map((i) => (
          <span key={i.id} className="chip" onClick={() => run(() => api("/tools/remove_item", { character_id: c.id, name: i.name, qty: 1 }))} title="Click to remove one">
            {i.name}
            {i.qty > 1 ? ` ×${i.qty}` : ""} ✕
          </span>
        ))}
        <input className="small" placeholder="Add item" value={item} onChange={(e) => setItem(e.target.value)} onKeyDown={(e) => e.key === "Enter" && item && run(async () => (await api("/tools/give_item", { character_id: c.id, name: item, qty: 1 }), setItem("")))} />
      </div>
      <div className="row">
        <input className="grow" placeholder="Appearance" value={fields.appearance.value} onChange={(e) => set("appearance", e.target.value)} />
        {hint("appearance")}
        <button
          onClick={() =>
            run(async () => {
              await patch(`/characters/${c.id}`, { appearance: fields.appearance.value });
              markSaved(["appearance"]);
              await api(`/characters/${c.id}/sprite`, {});
            })
          }
        >
          Redraw sprite
        </button>
        <button className="danger" onClick={() => confirm(`Delete ${c.name}?`) && run(async () => (await del(`/characters/${c.id}`), onDone()))}>
          Delete
        </button>
      </div>
    </div>
  );
}
