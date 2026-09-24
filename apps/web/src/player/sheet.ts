import { abilityMod, type AbilityKey, type Character } from "@dm/shared";

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
