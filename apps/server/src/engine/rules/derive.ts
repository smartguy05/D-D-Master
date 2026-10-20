import {
  ALL_CLASS_RESOURCE_NAMES,
  hitDieFor,
  resourcesFor,
  type Character,
  type CharacterResource,
  type ClassData,
  type GameState,
  type HitDice,
  type SlotPool,
} from "@dm/shared";
import { defaultSavingThrows, needsSavingThrows } from "./saves.js";

/**
 * Class-derived rules state for a character: spell slots, Pact Magic slots, Hit Point Dice and
 * limited-use resources, from the SRD class tables (ClassCatalog). Pure: nothing is mutated except
 * by `applyDerived`, which writes into the character it is given (a clone inside the engine).
 */

export interface DerivedRules {
  hitDice: HitDice;
  spellSlots: SlotPool[];
  pactSlots?: SlotPool;
  resources: CharacterResource[];
}

const clampUsed = (used: number | undefined, max: number) => Math.max(0, Math.min(max, used ?? 0));

/**
 * The slots, hit dice and resources a character of this class and level has. Whatever was already
 * spent (`used`) is kept, capped at the new maximum, so a level-up or re-derive never refills or
 * clobbers anything. Without class data (non-SRD class) only the hit dice are derived (d8 fallback);
 * existing slots and resources are kept as they are.
 */
export function deriveClassResources(char: Character, cls: ClassData | undefined): DerivedRules {
  const level = Math.max(1, Math.min(20, char.level));
  const die = cls?.hitDie ?? hitDieFor(char.className);
  const hitDice = { die, max: level, used: clampUsed(char.hitDice?.used, level) };
  // Non-SRD class: keep whatever slots and resources the host set by hand.
  if (!cls) {
    return {
      hitDice,
      spellSlots: structuredClone(char.spellSlots ?? []),
      pactSlots: char.pactSlots ? { ...char.pactSlots } : undefined,
      resources: structuredClone(char.resources ?? []),
    };
  }

  const row = cls.levels.find((l) => l.level === level);
  const oldSlots = new Map((char.spellSlots ?? []).map((s) => [s.level, s.used]));
  const spellSlots = (row?.slots ?? [])
    .map((max, i) => ({ level: i + 1, max, used: clampUsed(oldSlots.get(i + 1), max) }))
    .filter((s) => s.max > 0);
  const pactSlots = row?.pact && row.pact.slots > 0
    ? { level: row.pact.slotLevel, max: row.pact.slots, used: clampUsed(char.pactSlots?.used, row.pact.slots) }
    : undefined;

  const oldRes = new Map((char.resources ?? []).map((r) => [r.name.toLowerCase(), r.used]));
  const resources: CharacterResource[] = resourcesFor(cls, level, char.abilities, char.subclass).map((r) => ({
    ...r,
    used: clampUsed(oldRes.get(r.name.toLowerCase()), r.max),
  }));
  // Keep resources no SRD class or subclass produces (feats, magic items, homebrew: added by the
  // host). Class resources the character no longer qualifies for (another class, subclass or a
  // lower level) are dropped.
  const own = new Set(resources.map((r) => r.name.toLowerCase()));
  for (const r of char.resources ?? []) {
    const key = r.name.toLowerCase();
    if (!own.has(key) && !ALL_CLASS_RESOURCE_NAMES.has(key)) resources.push(structuredClone(r));
  }
  return { hitDice, spellSlots, pactSlots, resources };
}

/** Write the derived values into `char` (mutates it; call it on a clone). */
export function applyDerived(char: Character, cls: ClassData | undefined): Character {
  const d = deriveClassResources(char, cls);
  char.hitDice = d.hitDice;
  char.spellSlots = d.spellSlots;
  char.resources = d.resources;
  if (d.pactSlots) char.pactSlots = d.pactSlots;
  else delete char.pactSlots;
  return defaultSavingThrows(char, () => cls);
}

/** A character saved before the rules engine still has the zeroed defaults (`hitDice.max === 0`). */
export function needsDerive(char: Character): boolean {
  return (char.hitDice?.max ?? 0) === 0;
}

/**
 * Old saves: give every character that still holds the zeroed defaults its derived slots, hit dice
 * and resources. Returns the same state object when nothing needed deriving (so callers can skip a
 * save), else an upgraded copy. Characters that already have values are never touched.
 */
export function upgradeCharacters(state: GameState, classData: (className: string) => ClassData | undefined): GameState {
  if (!state.characters.some((c) => needsDerive(c) || needsSavingThrows(c, classData))) return state;
  const next = structuredClone(state);
  for (const c of next.characters) {
    if (needsDerive(c)) applyDerived(c, c.className ? classData(c.className) : undefined);
    defaultSavingThrows(c, classData); // saving throw proficiencies missing from the form or an import
  }
  return next;
}

// ---------- compact summaries (get_party_status, DM instructions) ----------

const left = (p: { max: number; used: number }) => p.max - p.used;

export function slotsText(c: Character): string | undefined {
  return c.spellSlots.length ? c.spellSlots.map((s) => `${s.level}:${left(s)}/${s.max}`).join(" ") : undefined;
}

export function pactText(c: Character): string | undefined {
  return c.pactSlots ? `L${c.pactSlots.level} ${left(c.pactSlots)}/${c.pactSlots.max}` : undefined;
}

export function hitDiceText(c: Character): string | undefined {
  return c.hitDice.max > 0 ? `${left(c.hitDice)}/${c.hitDice.max} d${c.hitDice.die}` : undefined;
}

export function isDead(c: Pick<Character, "conditions">): boolean {
  return c.conditions.some((x) => x.toLowerCase() === "dead");
}

/** "DEAD", "STABLE", "DOWN saves S1 F2" for a character at 0 HP; undefined otherwise. */
export function downedText(c: Character): string | undefined {
  if (isDead(c)) return "DEAD";
  if (c.hp > 0) return undefined;
  if (c.deathSaves.stable) return "STABLE";
  return `DOWN saves S${c.deathSaves.successes} F${c.deathSaves.failures}`;
}

/** One compact line for the DM's PARTY block, e.g. "slots 1:2/4 2:0/3; HD 4/5 d6; conc Bless; Rage 2/3". Left/max everywhere. */
export function rulesSummary(c: Character): string {
  const slots = slotsText(c);
  const pact = pactText(c);
  const hd = hitDiceText(c);
  return [
    slots && `slots ${slots}`,
    pact && `pact ${pact}`,
    hd && `HD ${hd}`,
    c.concentration && `conc ${c.concentration.spell}`,
    downedText(c),
    c.resources.length ? c.resources.map((r) => `${r.name} ${left(r)}/${r.max}`).join(", ") : undefined,
  ]
    .filter(Boolean)
    .join("; ");
}

/** The same, as fields for get_party_status (empty ones left out). */
export function rulesStatus(c: Character) {
  return {
    subclass: c.subclass || undefined,
    slots: slotsText(c),
    pact: pactText(c),
    hitDice: hitDiceText(c),
    concentration: c.concentration?.spell,
    deathSaves: c.hp <= 0 && !isDead(c) ? c.deathSaves : undefined,
    resources: c.resources.length ? c.resources.map((r) => `${r.name} ${left(r)}/${r.max}`) : undefined,
  };
}
