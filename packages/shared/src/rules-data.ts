import { abilityMod, type Abilities, type AbilityKey } from "./schemas.js";

/**
 * Structured SRD 5.2.1 rules data: spells and class tables. The server parses `data/srd/*.md` into
 * these shapes (apps/server/src/rules/spells.ts, classes.ts). The types and the pure helpers live
 * here so the web app can use them too.
 */

// ---------- classes: hit dice and proficiency bonus ----------

/** SRD 5.2 class hit dice. Unknown classes fall back to d8. */
export const CLASS_HIT_DIE: Record<string, number> = {
  barbarian: 12,
  fighter: 10,
  paladin: 10,
  ranger: 10,
  bard: 8,
  cleric: 8,
  druid: 8,
  monk: 8,
  rogue: 8,
  warlock: 8,
  sorcerer: 6,
  wizard: 6,
};

export function hitDieFor(className: string): number {
  return CLASS_HIT_DIE[className.trim().toLowerCase()] ?? 8;
}

export function proficiencyBonusFor(level: number): number {
  return 2 + Math.floor((level - 1) / 4);
}

// ---------- spells ----------

export type SpellAreaShape = "sphere" | "cone" | "cube" | "line" | "emanation" | "cylinder";

export interface SpellArea {
  shape: SpellAreaShape;
  /** Radius (sphere, emanation, cylinder), length (cone, line) or side (cube), in feet. */
  sizeFt: number;
  widthFt?: number;
  heightFt?: number;
}

export interface SpellDamage {
  /** Dice notation, e.g. "8d6" or "1d4+1". */
  dice: string;
  /** Lower-case damage type, e.g. "fire". */
  type: string;
}

export interface SpellUpcast {
  /** The SRD "Using a Higher-Level Spell Slot" sentence(s). */
  text: string;
  /** Dice added per slot level above the spell's level. */
  perLevelDice?: string;
  appliesTo?: "damage" | "heal" | "both";
  /** Extra targets per slot level above the spell's level. */
  perLevelTargets?: number;
  /** Extra darts/rays/beams per slot level above the spell's level. */
  perLevelProjectiles?: number;
}

export interface CantripTier {
  level: number;
  dice?: string;
  projectiles?: number;
}

export interface SpellInfo {
  name: string;
  /** 0 = cantrip. */
  level: number;
  school: string;
  classes: string[];
  castingTime: string;
  range: string;
  components: string;
  duration: string;
  concentration: boolean;
  ritual: boolean;
  reaction: boolean;
  bonusAction: boolean;
  save?: AbilityKey;
  attack?: "melee" | "ranged";
  damage: SpellDamage[];
  heal?: { dice: string; addMod: boolean };
  area?: SpellArea;
  /** Base number of darts/rays/beams (Magic Missile 3, Scorching Ray 3). */
  projectiles?: number;
  upcast?: SpellUpcast;
  cantripScaling?: { text: string; tiers: CantripTier[] };
  /** Short plain-text description (first paragraph, ~300 chars). */
  summary: string;
}

const DICE_RE = /^(\d*)d(\d+)(.*)$/;

/** Add `times` copies of `extra` dice to `base`: ("8d6","1d6",2) → "10d6"; mixed sizes are appended. */
export function addDice(base: string, extra: string, times: number): string {
  if (times <= 0) return base;
  if (/^\d+$/.test(base.trim()) && /^\d+$/.test(extra.trim())) return String(parseInt(base, 10) + parseInt(extra, 10) * times);
  const b = DICE_RE.exec(base.replace(/\s+/g, ""));
  const e = DICE_RE.exec(extra.replace(/\s+/g, ""));
  if (!e) return base;
  const eCount = (parseInt(e[1] || "1", 10) || 1) * times;
  if (b && b[2] === e[2]) return `${(parseInt(b[1] || "1", 10) || 1) + eCount}d${b[2]}${b[3]}`;
  return `${base}+${eCount}d${e[2]}`;
}

export interface SpellEffect {
  /** The level the spell is cast at (slot level, or 0 for a cantrip). */
  castLevel: number;
  damage: SpellDamage[];
  heal?: { dice: string; addMod: boolean };
  projectiles?: number;
  /** Targets beyond the base number allowed by the spell. */
  extraTargets: number;
}

/**
 * The spell's numbers at a given slot level (leveled spells) or caster level (cantrips).
 * A missing or too-low slot level means "cast at the spell's own level".
 */
export function spellEffectAt(spell: SpellInfo, opts: { slotLevel?: number; casterLevel?: number }): SpellEffect {
  const damage = spell.damage.map((d) => ({ ...d }));
  let heal = spell.heal ? { ...spell.heal } : undefined;
  let projectiles = spell.projectiles;
  let extraTargets = 0;

  if (spell.level === 0) {
    const lvl = opts.casterLevel ?? 1;
    const tier = [...(spell.cantripScaling?.tiers ?? [])].reverse().find((t) => lvl >= t.level);
    if (tier?.dice && damage[0]) damage[0].dice = tier.dice.replace(/^d/, "1d");
    if (tier?.projectiles) projectiles = tier.projectiles;
    return { castLevel: 0, damage, heal, projectiles, extraTargets };
  }

  const castLevel = Math.max(spell.level, Math.min(9, opts.slotLevel ?? spell.level));
  const above = castLevel - spell.level;
  const up = spell.upcast;
  if (up && above > 0) {
    if (up.perLevelDice) {
      if (up.appliesTo !== "heal" && damage[0]) damage[0].dice = addDice(damage[0].dice, up.perLevelDice, above);
      if (up.appliesTo !== "damage" && heal) heal.dice = addDice(heal.dice, up.perLevelDice, above);
    }
    if (up.perLevelTargets) extraTargets = up.perLevelTargets * above;
    if (up.perLevelProjectiles && projectiles !== undefined) projectiles += up.perLevelProjectiles * above;
  }
  return { castLevel, damage, heal, projectiles, extraTargets };
}

// ---------- classes ----------

export type CasterKind = "full" | "half" | "pact" | "none";
export type ResetOn = "short" | "long";

export interface ClassLevel {
  level: number;
  proficiencyBonus: number;
  /** Class Features column ("Subclass feature" kept as-is; "—" → []). */
  features: string[];
  /** Spell slots per spell level, index 0 = level 1. Trailing zeros trimmed. Empty for non-casters and Warlocks. */
  slots: number[];
  /** Warlock Pact Magic. */
  pact?: { slots: number; slotLevel: number };
  cantrips?: number;
  preparedSpells?: number;
  /** Numeric resource columns by resource name, e.g. { Rage: 3 } (see RESOURCE_COLUMNS). */
  resources: Record<string, number>;
  /** Every other table column as raw text, e.g. { "Rage Damage": "+2", "Martial Arts": "1d6" }. */
  columns: Record<string, string>;
}

export interface ClassFeature {
  level: number;
  name: string;
  /** Short plain text (≤400 chars). */
  text: string;
}

export interface ClassInfo {
  name: string;
  hitDie: number;
  savingThrows: AbilityKey[];
  spellcasting?: { ability: AbilityKey; kind: CasterKind };
  levels: ClassLevel[];
  features: ClassFeature[];
  subclass?: { name: string; features: ClassFeature[] };
}

/** ClassInfo plus a feature-text lookup (class and subclass features). */
export interface ClassData extends ClassInfo {
  featureText(name: string): string | undefined;
}

/** Find a class or subclass feature by name (case-insensitive). */
export function findClassFeature(cls: ClassInfo, name: string): ClassFeature | undefined {
  const q = name.trim().toLowerCase();
  if (!q) return undefined;
  const all = [...cls.features, ...(cls.subclass?.features ?? [])];
  return all.find((f) => f.name.toLowerCase() === q) ?? all.find((f) => f.name.toLowerCase().startsWith(q));
}

/** Class-table columns that count a limited-use resource → resource name. */
export const RESOURCE_COLUMNS: Record<string, string> = {
  Rages: "Rage",
  "Channel Divinity": "Channel Divinity",
  "Wild Shape": "Wild Shape",
  "Second Wind": "Second Wind",
  "Focus Points": "Focus Points",
  "Sorcery Points": "Sorcery Points",
  "Favored Enemy": "Favored Enemy",
};

export interface ClassResource {
  name: string;
  max: number;
  /** "short": all uses come back on a Short or Long Rest. "long": only a Long Rest restores all. */
  resetOn: ResetOn;
  /** Uses regained on a Short Rest when resetOn is "long" (Rage, Channel Divinity, Wild Shape, Second Wind). */
  shortRestRegain?: number;
}

interface ResourceRule {
  name: string;
  minLevel?: number;
  /** Max from a table column (by resource name in ClassLevel.resources). */
  column?: boolean;
  max?: (level: number, abilities: Abilities) => number;
  resetOn: ResetOn | ((level: number) => ResetOn);
  shortRestRegain?: number;
}

const byLevel = (steps: [number, number][]) => (level: number) =>
  steps.reduce((n, [lvl, v]) => (level >= lvl ? v : n), 0);

/** Hand-curated from the SRD 5.2.1 feature text (data/srd/classes.md). */
const RESOURCE_RULES: Record<string, ResourceRule[]> = {
  barbarian: [{ name: "Rage", column: true, resetOn: "long", shortRestRegain: 1 }],
  bard: [
    {
      name: "Bardic Inspiration",
      max: (_l, a) => Math.max(1, abilityMod(a.cha)),
      resetOn: (l) => (l >= 5 ? "short" : "long"), // Font of Inspiration (level 5)
    },
  ],
  cleric: [
    { name: "Channel Divinity", column: true, resetOn: "long", shortRestRegain: 1 },
    { name: "Divine Intervention", minLevel: 10, max: () => 1, resetOn: "long" },
  ],
  druid: [{ name: "Wild Shape", column: true, resetOn: "long", shortRestRegain: 1 }],
  fighter: [
    { name: "Second Wind", column: true, resetOn: "long", shortRestRegain: 1 },
    { name: "Action Surge", minLevel: 2, max: byLevel([[2, 1], [17, 2]]), resetOn: "short" },
    { name: "Indomitable", minLevel: 9, max: byLevel([[9, 1], [13, 2], [17, 3]]), resetOn: "long" },
  ],
  monk: [
    { name: "Focus Points", column: true, resetOn: "short" },
    { name: "Uncanny Metabolism", minLevel: 2, max: () => 1, resetOn: "long" },
  ],
  paladin: [
    { name: "Channel Divinity", column: true, resetOn: "long", shortRestRegain: 1 },
    { name: "Lay On Hands", max: (l) => 5 * l, resetOn: "long" },
  ],
  ranger: [{ name: "Favored Enemy", column: true, resetOn: "long" }],
  rogue: [{ name: "Stroke of Luck", minLevel: 20, max: () => 1, resetOn: "short" }],
  sorcerer: [
    { name: "Sorcery Points", column: true, resetOn: "long" },
    { name: "Innate Sorcery", max: () => 2, resetOn: "long" },
    { name: "Sorcerous Restoration", minLevel: 5, max: () => 1, resetOn: "long" },
  ],
  warlock: [{ name: "Magical Cunning", minLevel: 2, max: () => 1, resetOn: "long" }],
  wizard: [{ name: "Arcane Recovery", max: () => 1, resetOn: "long" }],
};

/**
 * Limited-use class resources at a level (spell slots excluded). Column resources come from the
 * parsed class table; formula ones (Bardic Inspiration = CHA mod, min 1; Lay On Hands = 5 × level)
 * are computed. Resources with max 0 at this level are left out.
 */
export function resourcesFor(cls: ClassInfo | undefined, level: number, abilities: Abilities): ClassResource[] {
  if (!cls) return [];
  const rules = RESOURCE_RULES[cls.name.toLowerCase()] ?? [];
  const row = cls.levels.find((l) => l.level === Math.max(1, Math.min(20, level)));
  const out: ClassResource[] = [];
  for (const r of rules) {
    if (r.minLevel && level < r.minLevel) continue;
    const max = r.column ? row?.resources[r.name] ?? 0 : r.max?.(level, abilities) ?? 0;
    if (max <= 0) continue;
    const res: ClassResource = { name: r.name, max, resetOn: typeof r.resetOn === "function" ? r.resetOn(level) : r.resetOn };
    if (r.shortRestRegain) res.shortRestRegain = r.shortRestRegain;
    out.push(res);
  }
  return out;
}
