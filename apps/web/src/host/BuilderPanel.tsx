import { useEffect, useState } from "react";
import type { AbilityKey, BuilderDraft, CharacterBuilder } from "@dm/shared";
import { abilityMod, formatMod } from "@dm/shared";
import { api, del, patch } from "../lib/api";

type Run = (fn: () => Promise<unknown>) => Promise<void>;

const ABILITIES: AbilityKey[] = ["str", "dex", "con", "int", "wis", "cha"];
const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

/**
 * Live, editable view of the voice character builder's draft (state.builder). The DM fills it with
 * draft_character_update while interviewing the player; the host can correct any field, then finalize.
 */
export function BuilderPanel({ builder, run }: { builder: CharacterBuilder; run: Run }) {
  const d = builder.draft;
  const [f, setF] = useState(() => toForm(d, builder.level));
  const [dirty, setDirty] = useState(false);
  // Follow the DM's updates unless the host is in the middle of an edit.
  useEffect(() => {
    if (!dirty) setF(toForm(d, builder.level));
  }, [builder.updatedAt, builder.level, dirty, d]);

  const set = (k: keyof ReturnType<typeof toForm>, v: string) => {
    setDirty(true);
    setF((x) => ({ ...x, [k]: v }));
  };
  const setAbil = (k: AbilityKey, v: string) => {
    setDirty(true);
    setF((x) => ({ ...x, abilities: { ...x.abilities, [k]: v } }));
  };

  const save = () =>
    run(async () => {
      const abilities: Partial<Record<AbilityKey, number>> = {};
      for (const k of ABILITIES) if (f.abilities[k] !== "") abilities[k] = Number(f.abilities[k]);
      const draft: BuilderDraft = {
        name: f.name || undefined,
        species: f.species || undefined,
        className: f.className || undefined,
        background: f.background || undefined,
        appearance: f.appearance || undefined,
        maxHp: f.maxHp ? Number(f.maxHp) : undefined,
        ac: f.ac ? Number(f.ac) : undefined,
        skills: f.skills ? list(f.skills) : undefined,
        spells: f.spells ? list(f.spells) : undefined,
        abilities,
      };
      await patch("/builder", { draft, level: Number(f.level) || builder.level });
      setDirty(false);
    });

  return (
    <section className="card span2 builder">
      <h2>🗣 Building a character with {builder.playerName} (level {builder.level})</h2>
      <p className="muted">
        The DM is interviewing {builder.playerName}; choices appear here and on their phone as they are made. Fix anything, then
        finalize. Blank HP/AC are derived from class hit die, CON and DEX.
      </p>
      <div className="row wrap">
        <input placeholder="Name" value={f.name} onChange={(e) => set("name", e.target.value)} />
        <input placeholder="Species" value={f.species} onChange={(e) => set("species", e.target.value)} />
        <input placeholder="Class" value={f.className} onChange={(e) => set("className", e.target.value)} />
        <input placeholder="Background" value={f.background} onChange={(e) => set("background", e.target.value)} />
        <label>
          Lvl <input type="number" min={1} max={20} value={f.level} onChange={(e) => set("level", e.target.value)} />
        </label>
        <label>
          HP <input type="number" min={1} placeholder="auto" value={f.maxHp} onChange={(e) => set("maxHp", e.target.value)} />
        </label>
        <label>
          AC <input type="number" min={0} placeholder="auto" value={f.ac} onChange={(e) => set("ac", e.target.value)} />
        </label>
      </div>
      <div className="row wrap">
        {ABILITIES.map((k) => (
          <label key={k} className="abil">
            {k.toUpperCase()}
            <input type="number" min={1} max={30} value={f.abilities[k]} onChange={(e) => setAbil(k, e.target.value)} />
            <span className="muted">{f.abilities[k] !== "" ? formatMod(abilityMod(Number(f.abilities[k]))) : "–"}</span>
          </label>
        ))}
      </div>
      <input placeholder="Skills, comma separated" value={f.skills} onChange={(e) => set("skills", e.target.value)} />
      <input placeholder="Spells, comma separated" value={f.spells} onChange={(e) => set("spells", e.target.value)} />
      <input placeholder="Appearance (used to draw the token)" value={f.appearance} onChange={(e) => set("appearance", e.target.value)} />
      <p className="muted">
        {d.attacks?.length ? `Attacks: ${d.attacks.map((a) => `${a.name}${a.toHit !== undefined ? ` ${formatMod(a.toHit)}` : ""} ${a.damage ?? ""}`).join("; ")}. ` : ""}
        {d.inventory?.length ? `Gear: ${d.inventory.map((i) => (i.qty > 1 ? `${i.name} ×${i.qty}` : i.name)).join(", ")}. ` : ""}
        {d.features?.length ? `Features: ${d.features.join(", ")}.` : ""}
      </p>
      <div className="row">
        <button className={dirty ? "primary" : ""} disabled={!dirty} onClick={save}>
          Save edits
        </button>
        {dirty && (
          <button onClick={() => (setDirty(false), setF(toForm(d, builder.level)))}>Discard edits</button>
        )}
        <button className="primary" disabled={dirty} onClick={() => run(() => api("/builder/finalize", {}))}>
          ✔ Finalize character
        </button>
        <button className="danger" onClick={() => confirm("Cancel the character builder?") && run(() => del("/builder"))}>
          Cancel
        </button>
      </div>
    </section>
  );
}

function toForm(d: BuilderDraft, level: number) {
  const abilities = {} as Record<AbilityKey, string>;
  for (const k of ABILITIES) abilities[k] = d.abilities?.[k] !== undefined ? String(d.abilities[k]) : "";
  return {
    name: d.name ?? "",
    species: d.species ?? "",
    className: d.className ?? "",
    background: d.background ?? "",
    appearance: d.appearance ?? "",
    level: String(level),
    maxHp: d.maxHp !== undefined ? String(d.maxHp) : "",
    ac: d.ac !== undefined ? String(d.ac) : "",
    skills: d.skills?.join(", ") ?? "",
    spells: d.spells?.join(", ") ?? "",
    abilities,
  };
}
