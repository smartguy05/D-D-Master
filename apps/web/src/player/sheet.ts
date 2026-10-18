import { abilityMod, type AbilityKey, type Character, type SlotPool, type SpellChipInfo } from "@dm/shared";

/** SRD 5.2 skills and their abilities. */
export const SKILLS: [string, AbilityKey][] = [
  ["Acrobatics", "dex"],
  ["Animal Handling", "wis"],
  ["Arcana", "int"],
  ["Athletics", "str"],
  ["Deception", "cha"],
  ["History", "int"],
  ["Insight", "wis"],
  ["Intimidation", "cha"],
  ["Investigation", "int"],
  ["Medicine", "wis"],
  ["Nature", "int"],
  ["Perception", "wis"],
  ["Performance", "cha"],
  ["Persuasion", "cha"],
  ["Religion", "int"],
  ["Sleight of Hand", "dex"],
  ["Stealth", "dex"],
  ["Survival", "wis"],
];

export const ABILITY_KEYS: AbilityKey[] = ["str", "dex", "con", "int", "wis", "cha"];
export const ABILITY_NAMES: Record<AbilityKey, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

const norm = (s: string) => s.trim().toLowerCase();

export function isSkillProficient(c: Character, skill: string): boolean {
  return c.skills.some((s) => norm(s) === norm(skill));
}

/** Saving throw proficiencies may be stored as "dex", "DEX" or "Dexterity". */
export function isSaveProficient(c: Character, key: AbilityKey): boolean {
  return c.savingThrows.some((s) => norm(s).slice(0, 3) === key);
}

export function skillMod(c: Character, skill: string, ability: AbilityKey): number {
  return abilityMod(c.abilities[ability]) + (isSkillProficient(c, skill) ? c.proficiencyBonus : 0);
}

export function saveMod(c: Character, key: AbilityKey): number {
  return abilityMod(c.abilities[key]) + (isSaveProficient(c, key) ? c.proficiencyBonus : 0);
}

export type Edge = "normal" | "adv" | "dis";

/** d20 notation with modifier and advantage/disadvantage, e.g. 2d20kh1+5. */
export function d20(mod: number, edge: Edge = "normal"): string {
  const dice = edge === "adv" ? "2d20kh1" : edge === "dis" ? "2d20kl1" : "1d20";
  return mod === 0 ? dice : `${dice}${mod > 0 ? "+" : ""}${mod}`;
}

/** Damage strings look like "1d8+3 slashing": keep the dice part. */
export function damageNotation(damage: string | undefined): string | undefined {
  const m = /^\s*(\d*d\d+(?:\s*[+-]\s*\d+)?)/i.exec(damage ?? "");
  return m ? m[1].replace(/\s+/g, "") : undefined;
}

// ---------- rules state (slots, hit dice, resources, death saves) ----------
// Pure view helpers shared by the phone sheet, the host Party tab and the TV PartyCard.

const left = (p: { max: number; used: number }) => Math.max(0, p.max - p.used);
const ORD = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];

/** One pip per use; true = still available. */
export function pips(max: number, used: number): boolean[] {
  const free = Math.max(0, max - used);
  return Array.from({ length: Math.max(0, max) }, (_, i) => i < free);
}

export function isDeadChar(c: Pick<Character, "conditions">): boolean {
  return c.conditions.some((x) => x.trim().toLowerCase() === "dead");
}

export interface SlotRow {
  key: string;
  label: string;
  level: number;
  max: number;
  used: number;
  left: number;
  pips: boolean[];
  pact: boolean;
}

/** Spell slot pools by level (empty pools skipped), then the Warlock's Pact Magic pool. */
export function slotRows(c: Character): SlotRow[] {
  const rows: SlotRow[] = [...c.spellSlots]
    .filter((s) => s.max > 0)
    .sort((a, b) => a.level - b.level)
    .map((s) => ({ key: `s${s.level}`, label: ORD[s.level], level: s.level, max: s.max, used: s.used, left: left(s), pips: pips(s.max, s.used), pact: false }));
  const p = c.pactSlots;
  if (p && p.max > 0) rows.push({ key: "pact", label: `Pact ${ORD[p.level]}`, level: p.level, max: p.max, used: p.used, left: left(p), pips: pips(p.max, p.used), pact: true });
  return rows;
}

/** "3/5 d8" (left/max), or undefined before hit dice are derived. */
export function hitDiceLabel(c: Character): string | undefined {
  return c.hitDice.max > 0 ? `${left(c.hitDice)}/${c.hitDice.max} d${c.hitDice.die}` : undefined;
}

export interface ResourceRow {
  name: string;
  max: number;
  used: number;
  left: number;
  reset: string;
  note?: string;
  /** Only for pools of 10 or fewer (bigger ones show a number). */
  pips?: boolean[];
}

export function resourceRows(c: Character): ResourceRow[] {
  return c.resources.map((r) => ({
    name: r.name,
    max: r.max,
    used: r.used,
    left: left(r),
    reset: r.resetOn === "short" ? "Short Rest" : r.shortRestRegain ? `Long Rest (${r.shortRestRegain} back on a Short Rest)` : "Long Rest",
    note: r.note,
    pips: r.max <= 10 ? pips(r.max, r.used) : undefined,
  }));
}

export type DeathSaveView = { state: "dead" } | { state: "stable" } | { state: "dying"; successes: boolean[]; failures: boolean[] };

/** Death-save display: only at 0 HP (or Dead). Pips are filled per success/failure so far. */
export function deathSaveView(c: Character): DeathSaveView | undefined {
  if (isDeadChar(c)) return { state: "dead" };
  if (c.hp > 0) return undefined;
  if (c.deathSaves.stable) return { state: "stable" };
  const mark = (n: number) => [0, 1, 2].map((i) => i < n);
  return { state: "dying", successes: mark(c.deathSaves.successes), failures: mark(c.deathSaves.failures) };
}

/** Compact rules status for the host's party list (left/max everywhere), like the DM's PARTY line. */
export function rulesLine(c: Character): string {
  const slots = [...c.spellSlots].filter((s) => s.max > 0).sort((a, b) => a.level - b.level);
  const ds = deathSaveView(c);
  const hd = hitDiceLabel(c);
  return [
    slots.length ? `slots ${slots.map((s) => `${s.level}:${left(s)}/${s.max}`).join(" ")}` : undefined,
    c.pactSlots && c.pactSlots.max > 0 ? `pact L${c.pactSlots.level} ${left(c.pactSlots)}/${c.pactSlots.max}` : undefined,
    hd && `HD ${hd}`,
    c.concentration && `conc ${c.concentration.spell}`,
    ds && (ds.state === "dead" ? "DEAD" : ds.state === "stable" ? "STABLE" : `DOWN S${c.deathSaves.successes} F${c.deathSaves.failures}`),
    c.resources.length ? c.resources.map((r) => `${r.name} ${left(r)}/${r.max}`).join(", ") : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

export interface CharacterActions {
  stabilize: boolean;
  revive: boolean;
  endConcentration: boolean;
  levelUp: boolean;
  /** At least 1 HP: may take a Short or Long Rest. */
  rest: boolean;
}

/** Which host buttons make sense for this character right now. */
export function characterActions(c: Character): CharacterActions {
  const dead = isDeadChar(c);
  return {
    stabilize: !dead && c.hp <= 0 && !c.deathSaves.stable,
    revive: dead,
    endConcentration: !!c.concentration,
    levelUp: !dead && c.level < 20,
    rest: !dead && c.hp >= 1,
  };
}

/** New spellSlots with `used` at `level` moved by delta (clamped 0..max), for PATCH /api/characters/:id. */
export function adjustSlots(c: Character, level: number, delta: number): SlotPool[] {
  return c.spellSlots.map((s) => (s.level === level ? { ...s, used: Math.max(0, Math.min(s.max, s.used + delta)) } : { ...s }));
}

export function adjustPact(c: Character, delta: number): SlotPool | undefined {
  const p = c.pactSlots;
  return p ? { ...p, used: Math.max(0, Math.min(p.max, p.used + delta)) } : undefined;
}

export interface ShortRestRow {
  id: string;
  name: string;
  available: number;
  die: number;
  canRest: boolean;
  reason?: string;
}

/** Rows for the host's Short Rest panel. SRD: a rest needs at least 1 Hit Point. */
export function shortRestRows(chars: Character[]): ShortRestRow[] {
  return chars.map((c) => {
    const row: ShortRestRow = { id: c.id, name: c.name, available: left(c.hitDice), die: c.hitDice.die, canRest: characterActions(c).rest };
    if (!row.canRest) row.reason = isDeadChar(c) ? "dead" : "at 0 HP";
    return row;
  });
}

/** short_rest args for the characters who can rest; hit dice clamped to what each has left. */
export function shortRestArgs(chars: Character[], dice: Record<string, number>): { character_ids: string[]; hit_dice?: Record<string, number> } | undefined {
  const rows = shortRestRows(chars).filter((r) => r.canRest);
  if (!rows.length) return undefined;
  const hit: Record<string, number> = {};
  for (const r of rows) {
    const n = Math.min(r.available, Math.max(0, Math.floor(dice[r.id] ?? 0)));
    if (n > 0) hit[r.id] = n;
  }
  return Object.keys(hit).length ? { character_ids: rows.map((r) => r.id), hit_dice: hit } : { character_ids: rows.map((r) => r.id) };
}

// ---------- tool results (POST /api/tools/:name → {result}) ----------

/** Engine tools report some refusals as `{error}` in the result instead of an HTTP error. */
export function toolError(result: unknown): string | undefined {
  if (result && typeof result === "object" && typeof (result as { error?: unknown }).error === "string") return (result as { error: string }).error;
  return undefined;
}

export type LevelUpOutcome = { kind: "ok"; message: string } | { kind: "subclass"; message: string; options: string[] } | { kind: "error"; message: string };

export function levelUpOutcome(result: unknown): LevelUpOutcome {
  const err = toolError(result);
  const r = (result ?? {}) as { subclass_options?: string[]; name?: string; level?: number; hp_gain?: number; new_features?: { name: string }[]; note?: string };
  if (err) return r.subclass_options?.length ? { kind: "subclass", message: err, options: r.subclass_options } : { kind: "error", message: err };
  const feats = (r.new_features ?? []).map((f) => f.name);
  const base = `${r.name} is now level ${r.level} (+${r.hp_gain} HP)${feats.length ? `. New: ${feats.join(", ")}` : "."}`;
  // The engine's note (non-SRD class or subclass: add features by hand) must reach the host.
  return { kind: "ok", message: r.note ? `${base}${feats.length ? "." : ""} ${r.note}` : base };
}

interface RestLine {
  name: string;
  skipped?: string;
  hit_dice_spent?: number;
  healed?: number;
  hp?: string;
  recovered?: string[];
}

/** One readable line from a short_rest / long_rest result for the host. */
export function restSummary(result: unknown): string {
  const r = (result ?? {}) as { rest?: string; characters?: RestLine[] };
  if (!Array.isArray(r.characters)) return "Done.";
  const parts = r.characters.map((c) => {
    if (c.skipped) return `${c.name} skipped (${c.skipped}).`;
    if (r.rest === "long") return `${c.name} ${c.hp} HP.`;
    const bits = [c.healed ? `+${c.healed} HP (${c.hit_dice_spent} Hit ${c.hit_dice_spent === 1 ? "Die" : "Dice"})` : "", c.recovered?.length ? `recovered ${c.recovered.join(", ")}` : ""].filter(Boolean);
    return bits.length ? `${c.name} ${bits.join(", ")}.` : `${c.name} rested.`;
  });
  return [`${r.rest === "long" ? "Long" : "Short"} Rest.`, ...parts].join(" ");
}

// ---------- spell chips ----------

export interface SpellTags {
  badge: string;
  title: string;
  concentration: boolean;
  ritual: boolean;
}

/** Level badge ("0" = cantrip, "?" = not in the SRD) plus the C(oncentration) and R(itual) tags. */
export function spellTags(info: SpellChipInfo | undefined): SpellTags {
  if (!info) return { badge: "…", title: "Loading", concentration: false, ritual: false };
  if (!info.known || info.level === undefined) return { badge: "?", title: "Not in the SRD", concentration: false, ritual: false };
  return { badge: String(info.level), title: info.level === 0 ? "Cantrip" : `Level ${info.level}`, concentration: !!info.concentration, ritual: !!info.ritual };
}

/** Sheet spell names by level (cantrips first); unknown or not-yet-loaded ones last; sheet order within a level. */
export function sortSpellNames(names: string[], chips: SpellChipInfo[]): string[] {
  const level = new Map(chips.filter((c) => c.known && c.level !== undefined).map((c) => [c.name, c.level!]));
  return names
    .map((n, i) => ({ n, i, l: level.get(n.trim()) ?? 99 }))
    .sort((a, b) => a.l - b.l || a.i - b.i)
    .map((x) => x.n);
}
