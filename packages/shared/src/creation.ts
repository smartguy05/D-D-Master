import { z } from "zod";
import { Abilities, AbilityMethod, Character, DiceMode, type AbilityKey } from "./schemas.js";

/**
 * Phone character creation (docs/gameplay/phone-creation.md). A player's draft stores *choices*
 * (base scores, background bonuses, skill picks, spells, equipment packages…); the server checks
 * them against the SRD (apps/server/src/game/creation/validate.ts) and derives the character
 * (build.ts). The SRD origin/equipment shapes parsed from data/srd live here so the phone form can
 * use them too.
 */

// ---------- SRD shapes (apps/server/src/rules/origins.ts, equipment.ts, classes.ts) ----------

/** The 18 skills and their abilities (SRD 5.2). */
export const SKILL_ABILITIES: Record<string, AbilityKey> = {
  Acrobatics: "dex",
  "Animal Handling": "wis",
  Arcana: "int",
  Athletics: "str",
  Deception: "cha",
  History: "int",
  Insight: "wis",
  Intimidation: "cha",
  Investigation: "int",
  Medicine: "wis",
  Nature: "int",
  Perception: "wis",
  Performance: "cha",
  Persuasion: "cha",
  Religion: "int",
  "Sleight of Hand": "dex",
  Stealth: "dex",
  Survival: "wis",
};
export const SKILL_NAMES = Object.keys(SKILL_ABILITIES);

/** The canonical skill name ("sleight of hand" → "Sleight of Hand"), or undefined. */
export function skillName(name: string): string | undefined {
  const k = name.trim().toLowerCase();
  return SKILL_NAMES.find((s) => s.toLowerCase() === k);
}

export const ABILITY_KEYS: AbilityKey[] = ["str", "dex", "con", "int", "wis", "cha"];
export const ABILITY_LABELS: Record<AbilityKey, string> = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8] as const;
/** Point buy: 27 points, scores 8–15 before background bonuses. */
export const POINT_BUY_BUDGET = 27;
export const POINT_BUY_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };

/** Points spent on a set of base scores (undefined scores count 0); NaN when one is outside 8–15. */
export function pointBuyCost(base: Partial<Abilities>): number {
  let total = 0;
  for (const k of ABILITY_KEYS) {
    const v = base[k];
    if (v === undefined) continue;
    const cost = POINT_BUY_COST[v];
    if (cost === undefined) return NaN;
    total += cost;
  }
  return total;
}

/** One starting-equipment package ("(A) Greataxe, 4 Handaxes, … and 15 GP"). */
export interface EquipmentOption {
  letter: string;
  items: { name: string; qty: number }[];
  gold: number;
}

export interface SkillChoice {
  count: number;
  /** "any" = any skill (Bard). */
  options: string[] | "any";
}

export interface BackgroundInfo {
  name: string;
  abilities: AbilityKey[];
  /** The Origin feat, e.g. "Magic Initiate (Cleric)", "Alert". */
  feat: string;
  skills: string[];
  tool: string;
  equipment: EquipmentOption[];
}

/** One option of a species choice (a lineage, an ancestry, a size or a skill). */
export interface SpeciesOption {
  name: string;
  text?: string;
  /** Cantrips this option grants at level 1. */
  cantrips?: string[];
  /** Spells learned at a character level (Elf lineages, Tiefling legacies). */
  spells?: { level: number; name: string }[];
  speed?: number;
  darkvision?: number;
}

export interface SpeciesChoice {
  /** Key in CreationChoices.speciesChoices, e.g. "elven_lineage", "size", "skillful". */
  key: string;
  label: string;
  kind: "option" | "size" | "skill" | "feat" | "ability";
  options: SpeciesOption[];
}

export interface SpeciesInfo {
  name: string;
  creatureType: string;
  speed: number;
  darkvision?: number;
  /** Cantrips every member knows (Tiefling Thaumaturgy). */
  cantrips: string[];
  traits: { name: string; text: string }[];
  choices: SpeciesChoice[];
}

export interface FeatInfo {
  name: string;
  category: "origin" | "general" | "fighting_style" | "epic";
  text: string;
  repeatable: boolean;
  /** Abilities a general feat's +1 may go to (from "Increase your X or Y score by 1"). */
  abilities?: AbilityKey[];
}

export interface ArmorInfo {
  name: string;
  category: "light" | "medium" | "heavy" | "shield";
  /** Base AC (the shield's bonus for a shield). */
  base: number;
  /** Most DEX modifier that counts: undefined = all of it; 0 = none (heavy). */
  dexCap?: number;
}

export interface WeaponInfo {
  name: string;
  category: "simple" | "martial";
  ranged: boolean;
  /** "1d8" ("1" for a Blowgun). */
  dice: string;
  damageType: string;
  properties: string[];
  finesse: boolean;
}

/** The magic spell lists Magic Initiate may draw from. */
export const MAGIC_INITIATE_LISTS = ["Cleric", "Druid", "Wizard"] as const;

// ---------- the draft a player edits ----------

const Bonus = z.number().int().min(0).max(2);
export const AbilityBonuses = z.object({ str: Bonus, dex: Bonus, con: Bonus, int: Bonus, wis: Bonus, cha: Bonus }).partial();
export type AbilityBonuses = z.infer<typeof AbilityBonuses>;

/** A feat's picks (Magic Initiate: list + 2 cantrips + a level 1 spell; Skilled: 3 skills or tools). */
export const FeatPicks = z
  .object({
    list: z.string(),
    cantrips: z.array(z.string()),
    spell: z.string(),
    skills: z.array(z.string()),
  })
  .partial();
export type FeatPicks = z.infer<typeof FeatPicks>;

/** An Ability Score Improvement level's choice: the ASI feat (+2 split) or another general feat (+1). */
export const AsiPick = z.object({ feat: z.string().default("Ability Score Improvement"), increases: AbilityBonuses.default({}) });
export type AsiPick = z.infer<typeof AsiPick>;

/** Everything a player chooses. All optional: the validator says what is missing. */
export const CreationChoices = z
  .object({
    name: z.string().max(80),
    species: z.string().max(80),
    /** Species choice key → option name (lineage, ancestry, size, Skillful skill, Versatile feat…). */
    speciesChoices: z.record(z.string().max(60)),
    className: z.string().max(80),
    subclass: z.string().max(80),
    background: z.string().max(80),
    abilityMethod: AbilityMethod,
    baseAbilities: Abilities.partial(),
    backgroundBonuses: AbilityBonuses,
    /** One per Ability Score Improvement level reached, in level order. */
    asi: z.array(AsiPick).max(6),
    classSkills: z.array(z.string().max(40)).max(8),
    /** The Fighting Style feat (Fighter level 1, Paladin and Ranger level 2). */
    fightingStyle: z.string().max(60),
    /** Feat picks by source: "background" (its Origin feat) or "species" (Human Versatile). */
    featPicks: z.record(FeatPicks),
    cantrips: z.array(z.string().max(60)).max(10),
    /** Prepared spells (level 1+) from the class list. */
    spells: z.array(z.string().max(60)).max(30),
    classEquipment: z.string().max(2),
    backgroundEquipment: z.string().max(2),
    /** Hand-entered numbers: homebrew; checked against what the rules allow. */
    maxHpOverride: z.number().int().min(1).max(999),
    acOverride: z.number().int().min(0).max(40),
    appearance: z.string().max(600),
    backstory: z.string().max(2000),
    personality: z.string().max(400),
    ideals: z.string().max(400),
    bonds: z.string().max(400),
    flaws: z.string().max(400),
    diceMode: DiceMode,
  })
  .partial();
export type CreationChoices = z.infer<typeof CreationChoices>;

export const ChatTurn = z.object({
  role: z.enum(["player", "ai", "system"]),
  text: z.string(),
  ts: z.number(),
});
export type ChatTurn = z.infer<typeof ChatTurn>;

/**
 * A player's character draft (SQLite character_drafts, never GameState: other phones must not see
 * it). `joined` once it became a character; `pending` while the host reviews a rule-breaking one.
 */
export const CreationDraft = z.object({
  playerId: z.string(),
  status: z.enum(["draft", "pending", "returned", "joined"]).default("draft"),
  choices: CreationChoices.default({}),
  /** 4d6-drop-lowest scores the server rolled (the "rolled" method); never taken from a client. */
  rolledScores: z.array(z.number().int()).optional(),
  portraitUrl: z.string().optional(),
  /** Portrait draws used (capped). */
  portraitDraws: z.number().int().default(0),
  portraitBusy: z.boolean().default(false),
  playerNote: z.string().default(""),
  hostMessage: z.string().default(""),
  characterId: z.string().optional(),
  /** The roster entry the join saved (a re-join after an undo updates it instead of adding another). */
  rosterId: z.string().optional(),
  chat: z.array(ChatTurn).default([]),
  chatBusy: z.boolean().default(false),
  updatedAt: z.number().default(0),
});
export type CreationDraft = z.infer<typeof CreationDraft>;

export interface CreationIssue {
  /** The choice the issue is about ("baseAbilities", "classSkills", "speciesChoices.elven_lineage"…). */
  field: string;
  code: string;
  message: string;
}

export interface CreationValidation {
  ok: boolean;
  errors: CreationIssue[];
  warnings: CreationIssue[];
}

/** What GET /api/players/:id/creation returns. */
export interface CreationView {
  draft: CreationDraft;
  validation: CreationValidation;
  /** The character these choices build (null until there is a name). */
  preview: Character | null;
  level: number;
  settings: { abilityMethods: AbilityMethod[]; allowHomebrew: boolean; phoneCreation: boolean };
  /** Play started: a joined character can't be edited from the phone. */
  locked: boolean;
  /** The seat plays a character that didn't come from this draft (roster, host, voice builder). */
  hasOtherCharacter: boolean;
}

/** The SRD options the phone form offers (GET /api/players/:id/creation/options). */
export interface CreationOptions {
  classes: {
    name: string;
    hitDie: number;
    skillChoices?: SkillChoice;
    equipment: EquipmentOption[];
    subclass?: string;
    subclassLevel?: number;
    asiLevels: number[];
    cantrips: number;
    preparedSpells: number;
    maxSpellLevel: number;
    spellcasting?: string;
    savingThrows: AbilityKey[];
    /** Has the Fighting Style feature at this level. */
    fightingStyle: boolean;
    armorTraining: string[];
  }[];
  species: SpeciesInfo[];
  backgrounds: BackgroundInfo[];
  feats: FeatInfo[];
  /** Spells by class (name + level), cantrips included. */
  spells: Record<string, { name: string; level: number }[]>;
}
