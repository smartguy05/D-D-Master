import { useState } from "react";
import type { Abilities, Attack, Character, Item, Player } from "@dm/shared";
import { abilityMod, formatMod } from "@dm/shared";
import { api, del, patch } from "../lib/api";

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
export function CharacterForm({ players, run }: { players: Player[]; run: Run }) {
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

/** Host override panel: fix anything the AI got wrong. */
export function CharacterEditor({ character: c, run, onDone }: { character: Character; run: Run; onDone: () => void }) {
  const [hp, setHp] = useState(c.hp);
  const [maxHp, setMaxHp] = useState(c.maxHp);
  const [ac, setAc] = useState(c.ac);
  const [gold, setGold] = useState(c.gold);
  const [item, setItem] = useState("");
  const [cond, setCond] = useState("");
  const [appearance, setAppearance] = useState(c.appearance);

  return (
    <div className="editor">
      <h3>Edit {c.name}</h3>
      <div className="row wrap">
        <label>
          HP <input type="number" value={hp} onChange={(e) => setHp(+e.target.value)} />
        </label>
        <label>
          Max <input type="number" value={maxHp} onChange={(e) => setMaxHp(+e.target.value)} />
        </label>
        <label>
          AC <input type="number" value={ac} onChange={(e) => setAc(+e.target.value)} />
        </label>
        <label>
          Gold <input type="number" value={gold} onChange={(e) => setGold(+e.target.value)} />
        </label>
        <select value={c.diceMode} onChange={(e) => run(() => patch(`/characters/${c.id}`, { diceMode: e.target.value }))}>
          <option value="virtual">💻 Virtual dice</option>
          <option value="physical">🎲 Physical dice</option>
        </select>
        <button className="primary" onClick={() => run(() => patch(`/characters/${c.id}`, { hp, maxHp, ac, gold, appearance }))}>
          Save
        </button>
      </div>
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
        <input className="grow" placeholder="Appearance" value={appearance} onChange={(e) => setAppearance(e.target.value)} />
        <button onClick={() => run(async () => (await patch(`/characters/${c.id}`, { appearance }), await api(`/characters/${c.id}/sprite`, {})))}>Redraw sprite</button>
        <button className="danger" onClick={() => confirm(`Delete ${c.name}?`) && run(async () => (await del(`/characters/${c.id}`), onDone()))}>
          Delete
        </button>
      </div>
    </div>
  );
}
