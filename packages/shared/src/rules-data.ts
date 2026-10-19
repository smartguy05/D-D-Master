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

/**
 * How a damage entry combines with the others:
 * - "base": dealt together with the other base entries (Ice Storm: Bludgeoning + Cold);
 * - "or": an alternative to the entry before it (Spirit Guardians Radiant or Necrotic, Fire Shield
 *   warm/chill, Prismatic Spray's coloured rays after the first);
 * - "later": a staged or separately triggered hit (Acid Arrow end-of-turn acid, Wall of Thorns when
 *   entering the wall, Storm of Vengeance later turns).
 */
export type DamageRole = "base" | "or" | "later";

export interface SpellDamage {
  /** Dice notation, e.g. "8d6" or "1d4+1". */
  dice: string;
  /** Lower-case damage type, e.g. "fire"; "choice" when the caster picks it. */
  type: string;
  role: DamageRole;
  /** Add the caster's spellcasting ability modifier ("1d8 plus your spellcasting ability modifier"). */
  addMod?: boolean;
}

/** Per-slot-level damage increase for some of the spell's damage entries. */
export interface SpellIncrement {
  dice: string;
  /** Only entries of these types (lower-case). Absent = any type. */
  types?: string[];
  /** Only entries with these roles. Absent = every role. */
  roles?: DamageRole[];
  /** Only the damage entry at this position (0-based); set when the text gives one increase per effect (Wall of Ice). */
  index?: number;
}

export interface SpellUpcast {
  /** The SRD "Using a Higher-Level Spell Slot" sentence(s). */
  text: string;
  /** Dice added per slot level above the spell's level (the first increment). */
  perLevelDice?: string;
  appliesTo?: "damage" | "heal" | "both";
  /** Which damage entries each increase applies to (set when appliesTo is damage or both). */
  damageIncrements?: SpellIncrement[];
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
  /** In text order. See DamageRole; use primaryDamage() for "what to roll on a hit". */
  damage: SpellDamage[];
  heal?: { dice: string; addMod: boolean };
  area?: SpellArea;
  /** Base number of darts/rays/beams (Magic Missile 3, Scorching Ray 3, Eldritch Blast 1). */
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

const DEFAULT_INCREMENT_ROLES: DamageRole[] = ["base", "or", "later"];

/** Does an upcast increment apply to this damage entry? */
export function incrementApplies(inc: SpellIncrement, d: SpellDamage, index: number): boolean {
  if (inc.index !== undefined) return inc.index === index;
  if (inc.types && !inc.types.includes(d.type)) return false;
  return (inc.roles ?? DEFAULT_INCREMENT_ROLES).includes(d.role);
}

/**
 * The spell's numbers at a given slot level (leveled spells) or caster level (cantrips).
 * A missing or too-low slot level means "cast at the spell's own level"; above 9 clamps to 9.
 */
export function spellEffectAt(spell: SpellInfo, opts: { slotLevel?: number; casterLevel?: number }): SpellEffect {
  const damage = spell.damage.map((d) => ({ ...d }));
  const heal = spell.heal ? { ...spell.heal } : undefined;
  let projectiles = spell.projectiles;
  let extraTargets = 0;

  if (spell.level === 0) {
    const lvl = opts.casterLevel ?? 1;
    const tier = [...(spell.cantripScaling?.tiers ?? [])].reverse().find((t) => lvl >= t.level);
    if (tier?.dice) {
      // Cantrip tiers replace the dice of every entry that uses the same die size (Fire Bolt 1d10 → 2d10).
      const size = /d(\d+)/.exec(tier.dice)?.[1];
      for (const d of damage) if (/d(\d+)/.exec(d.dice)?.[1] === size || damage.length === 1) d.dice = tier.dice.replace(/^d/, "1d");
    }
    if (tier?.projectiles) projectiles = tier.projectiles;
    return { castLevel: 0, damage, heal, projectiles, extraTargets };
  }

  const castLevel = Math.max(spell.level, Math.min(9, opts.slotLevel ?? spell.level));
  const above = castLevel - spell.level;
  const up = spell.upcast;
  if (up && above > 0) {
    for (const inc of up.damageIncrements ?? []) {
      damage.forEach((d, i) => {
        if (incrementApplies(inc, d, i)) d.dice = addDice(d.dice, inc.dice, above);
      });
    }
    if (up.perLevelDice && up.appliesTo !== "damage" && heal) heal.dice = addDice(heal.dice, up.perLevelDice, above);
    if (up.perLevelTargets) extraTargets = up.perLevelTargets * above;
    if (up.perLevelProjectiles && projectiles !== undefined) projectiles += up.perLevelProjectiles * above;
  }
  return { castLevel, damage, heal, projectiles, extraTargets };
}

/**
 * The damage to roll when the spell takes effect: every "base" entry, and for an "or" group whose
 * base entry is missing, its first alternative. "later" entries are left out (roll them when they
 * trigger). Accepts a SpellEffect or a SpellInfo.
 */
export function primaryDamage(effect: { damage: SpellDamage[] }): SpellDamage[] {
  return effect.damage.filter((d, i) => {
    const prev = effect.damage[i - 1];
    return d.role === "base" || (d.role === "or" && (!prev || prev.role === "later"));
  });
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

/** Feature-name key: lower case, curly apostrophes straightened, a trailing "( … )" dropped. */
function featureKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s+/g, " ");
}

/**
 * Find a class or subclass feature by name: exact (after normalising case, curly apostrophes and a
 * trailing "(one use)" style suffix), then prefix. Class features win over subclass ones.
 */
export function findClassFeature(cls: ClassInfo, name: string): ClassFeature | undefined {
  const q = featureKey(name);
  if (!q) return undefined;
  const all = [...cls.features, ...(cls.subclass?.features ?? [])];
  return all.find((f) => featureKey(f.name) === q) ?? all.find((f) => featureKey(f.name).startsWith(q));
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
  /** Special recovery or use rule for the DM (regain on Initiative, partial recovery …). */
  note?: string;
}

interface ResourceRule {
  name: string;
  minLevel?: number;
  /** Max from a table column (by resource name in ClassLevel.resources). */
  column?: boolean;
  max?: (level: number, abilities: Abilities) => number;
  resetOn: ResetOn | ((level: number) => ResetOn);
  shortRestRegain?: number;
  note?: string | ((level: number) => string | undefined);
}

const byLevel = (steps: [number, number][]) => (level: number) =>
  steps.reduce((n, [lvl, v]) => (level >= lvl ? v : n), 0);
const modMin1 = (key: AbilityKey) => (_l: number, a: Abilities) => Math.max(1, abilityMod(a[key]));
const one = () => 1;

/** Hand-curated from the SRD 5.2.1 class feature text (data/srd/classes.md). */
const RESOURCE_RULES: Record<string, ResourceRule[]> = {
  barbarian: [
    { name: "Rage", column: true, resetOn: "long", shortRestRegain: 1 },
    { name: "Persistent Rage", minLevel: 15, max: one, resetOn: "long", note: "When you roll Initiative, regain all expended uses of Rage." },
  ],
  bard: [
    {
      name: "Bardic Inspiration",
      max: modMin1("cha"),
      resetOn: (l) => (l >= 5 ? "short" : "long"), // Font of Inspiration (level 5)
      note: (l) =>
        [
          l >= 5 ? "Font of Inspiration: expend a spell slot to regain one use." : "",
          l >= 18 ? "Superior Inspiration: when you roll Initiative, regain uses until you have two." : "",
        ]
          .filter(Boolean)
          .join(" ") || undefined,
    },
  ],
  cleric: [
    { name: "Channel Divinity", column: true, resetOn: "long", shortRestRegain: 1 },
    {
      name: "Divine Intervention",
      minLevel: 10,
      max: one,
      resetOn: "long",
      note: (l) => (l >= 20 ? "Greater Divine Intervention: you can choose Wish; if you do, you can't use Divine Intervention again until you finish 2d4 Long Rests." : undefined),
    },
  ],
  druid: [
    {
      name: "Wild Shape",
      column: true,
      resetOn: "long",
      shortRestRegain: 1,
      note: (l) => (l >= 20 ? "Evergreen Wild Shape: when you roll Initiative with no uses left, regain one." : undefined),
    },
    { name: "Wild Resurgence", minLevel: 5, max: one, resetOn: "long", note: "Expend one Wild Shape use to gain a level 1 spell slot." },
    { name: "Nature Magician", minLevel: 20, max: one, resetOn: "long", note: "Convert Wild Shape uses into one spell slot (2 spell levels per use)." },
  ],
  fighter: [
    { name: "Second Wind", column: true, resetOn: "long", shortRestRegain: 1 },
    { name: "Action Surge", minLevel: 2, max: byLevel([[2, 1], [17, 2]]), resetOn: "short" },
    { name: "Indomitable", minLevel: 9, max: byLevel([[9, 1], [13, 2], [17, 3]]), resetOn: "long" },
  ],
  monk: [
    {
      name: "Focus Points",
      column: true,
      resetOn: "short",
      note: (l) => (l >= 15 ? "Perfect Focus: when you roll Initiative without using Uncanny Metabolism, regain points up to 4." : undefined),
    },
    {
      name: "Uncanny Metabolism",
      minLevel: 2,
      max: one,
      resetOn: "long",
      note: "When you roll Initiative: regain all Focus Points and heal Monk level + a Martial Arts die roll.",
    },
  ],
  paladin: [
    { name: "Channel Divinity", column: true, resetOn: "long", shortRestRegain: 1 },
    { name: "Lay On Hands", max: (l) => 5 * l, resetOn: "long", note: "A pool of Hit Points; 5 points also remove the Poisoned condition." },
    { name: "Paladin's Smite", minLevel: 2, max: one, resetOn: "long", note: "Cast Divine Smite without a spell slot." },
    { name: "Faithful Steed", minLevel: 5, max: one, resetOn: "long", note: "Cast Find Steed without a spell slot." },
  ],
  ranger: [
    { name: "Favored Enemy", column: true, resetOn: "long", note: "Cast Hunter's Mark without a spell slot." },
    { name: "Tireless", minLevel: 10, max: modMin1("wis"), resetOn: "long", note: "Magic action: gain 1d8 + WIS mod Temporary Hit Points." },
    { name: "Nature's Veil", minLevel: 14, max: modMin1("wis"), resetOn: "long" },
  ],
  rogue: [{ name: "Stroke of Luck", minLevel: 20, max: one, resetOn: "short" }],
  sorcerer: [
    { name: "Sorcery Points", column: true, resetOn: "long" },
    { name: "Innate Sorcery", max: () => 2, resetOn: "long" },
    {
      name: "Sorcerous Restoration",
      minLevel: 5,
      max: one,
      resetOn: "long",
      note: "On a Short Rest, regain Sorcery Points up to half your Sorcerer level (round down).",
    },
  ],
  warlock: [
    {
      name: "Magical Cunning",
      minLevel: 2,
      max: one,
      resetOn: "long",
      note: (l) =>
        l >= 20
          ? "1-minute rite: regain all expended Pact Magic slots (Eldritch Master)."
          : "1-minute rite: regain Pact Magic slots up to half your maximum (round up).",
    },
    { name: "Contact Patron", minLevel: 9, max: one, resetOn: "long", note: "Cast Contact Other Plane without a spell slot." },
    ...[6, 7, 8, 9].map(
      (spellLevel): ResourceRule => ({
        name: `Mystic Arcanum (level ${spellLevel})`,
        minLevel: 11 + (spellLevel - 6) * 2,
        max: one,
        resetOn: "long",
        note: `Cast your level ${spellLevel} arcanum spell without a spell slot.`,
      }),
    ),
  ],
  wizard: [
    {
      name: "Arcane Recovery",
      max: one,
      resetOn: "long",
      note: "On a Short Rest, recover spell slots with combined levels up to half your Wizard level (round up), none level 6+.",
    },
    { name: "Signature Spells", minLevel: 20, max: () => 2, resetOn: "short", note: "Cast each of your two signature spells once at level 3 without a slot." },
  ],
};

/** Extra short names that aren't words of the SRD subclass name. */
const SUBCLASS_ALIASES: Record<string, string> = {
  evocation: "evoker",
  "school of evocation": "evoker",
  "berserker path": "path of the berserker",
  "way of the open hand": "warrior of the open hand",
  "draconic bloodline": "draconic sorcery",
  "the fiend": "fiend patron",
};

const STOP_WORDS = new Set(["of", "the", "a"]);
/** Subclass category nouns: they name no particular subclass ("Path", "Domain", "Patron"). */
const CATEGORY_WORDS = new Set(["path", "domain", "circle", "college", "oath", "patron", "sorcery", "warrior", "conclave", "school", "way"]);
/** Generic words that only identify a subclass together with another word ("Open Hand"). */
const GENERIC_SINGLE_WORDS = new Set(["hand", "open"]);
const subKey = (n: string) => n.trim().toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ");

/**
 * Does `given` name this SRD subclass? Accepts the full name (any case) or a short form that is a
 * run of whole words inside it ("Berserker", "Open Hand", "Fiend", "Land"), or an alias
 * ("Evocation" → Evoker). A query made only of stop words and category nouns ("of the", "Path",
 * "Path of the", "Domain") or a lone generic word ("Hand", "Open") never matches.
 */
export function subclassMatches(srdName: string, given: string | undefined): boolean {
  if (!given) return false;
  const srd = subKey(srdName);
  let q = subKey(given);
  q = SUBCLASS_ALIASES[q] ?? q;
  if (!q) return false;
  if (q === srd) return true;
  const words = q.split(" ");
  if (words.every((w) => STOP_WORDS.has(w) || CATEGORY_WORDS.has(w))) return false;
  if (words.length === 1 && GENERIC_SINGLE_WORDS.has(words[0])) return false;
  return ` ${srd} `.includes(` ${q} `);
}

/** Subclass resources, keyed by the SRD subclass name (lower case). */
const SUBCLASS_RESOURCE_RULES: Record<string, ResourceRule[]> = {
  "path of the berserker": [
    { name: "Intimidating Presence", minLevel: 14, max: one, resetOn: "long", note: "Expend a Rage use to restore it." },
  ],
  "circle of the land": [
    { name: "Natural Recovery (spell)", minLevel: 6, max: one, resetOn: "long", note: "Cast a prepared Circle spell without a spell slot." },
    {
      name: "Natural Recovery (slots)",
      minLevel: 6,
      max: one,
      resetOn: "long",
      note: "On a Short Rest, recover spell slots with combined levels up to half your Druid level (round up), none level 6+.",
    },
  ],
  "warrior of the open hand": [{ name: "Wholeness of Body", minLevel: 6, max: modMin1("wis"), resetOn: "long" }],
  "oath of devotion": [{ name: "Holy Nimbus", minLevel: 20, max: one, resetOn: "long", note: "Expend a level 5 spell slot to restore it." }],
  "draconic sorcery": [
    { name: "Dragon Wings", minLevel: 14, max: one, resetOn: "long", note: "Spend 3 Sorcery Points to restore it." },
    { name: "Dragon Companion", minLevel: 18, max: one, resetOn: "long", note: "Cast Summon Dragon without a spell slot." },
  ],
  evoker: [
    {
      name: "Overchannel",
      minLevel: 14,
      max: one,
      resetOn: "long",
      note: "Max damage on a level 1–5 Wizard spell. The first use per Long Rest is free; each later use deals 2d12 Necrotic per slot level (+1d12 per extra use), ignoring Resistance and Immunity.",
    },
  ],
  "fiend patron": [
    { name: "Dark One's Own Luck", minLevel: 6, max: modMin1("cha"), resetOn: "long" },
    { name: "Hurl Through Hell", minLevel: 14, max: one, resetOn: "long", note: "Expend a Pact Magic slot to restore it." },
  ],
};

function applyRules(rules: ResourceRule[], row: ClassLevel | undefined, level: number, abilities: Abilities, out: ClassResource[]) {
  for (const r of rules) {
    if (r.minLevel && level < r.minLevel) continue;
    const max = r.column ? row?.resources[r.name] ?? 0 : r.max?.(level, abilities) ?? 0;
    if (max <= 0) continue;
    const res: ClassResource = { name: r.name, max, resetOn: typeof r.resetOn === "function" ? r.resetOn(level) : r.resetOn };
    if (r.shortRestRegain) res.shortRestRegain = r.shortRestRegain;
    const note = typeof r.note === "function" ? r.note(level) : r.note;
    if (note) res.note = note;
    out.push(res);
  }
}

/**
 * Limited-use class resources at a level (spell slots excluded). Column resources come from the
 * parsed class table; formula ones (Bardic Inspiration = CHA mod, min 1; Lay On Hands = 5 × level)
 * are computed. Subclass resources are added only when `subclass` names the class's own SRD
 * subclass (full or short name, see subclassMatches).
 * The level is clamped to 20; below 1 there are no resources. Resources with max 0 are left out.
 */
export function resourcesFor(cls: ClassInfo | undefined, level: number, abilities: Abilities, subclass?: string): ClassResource[] {
  if (!cls || !(level >= 1)) return [];
  const lvl = Math.min(20, Math.floor(level));
  const row = cls.levels.find((l) => l.level === lvl);
  const out: ClassResource[] = [];
  applyRules(RESOURCE_RULES[cls.name.toLowerCase()] ?? [], row, lvl, abilities, out);
  // Gated on the class: only this class's own SRD subclass can add resources.
  if (cls.subclass && subclassMatches(cls.subclass.name, subclass)) {
    applyRules(SUBCLASS_RESOURCE_RULES[cls.subclass.name.toLowerCase()] ?? [], row, lvl, abilities, out);
  }
  return out;
}

/**
 * Lower-case names of every resource any SRD class or subclass rule can produce (any level). A
 * character resource outside this set was added by hand (feat, magic item, homebrew).
 */
export const ALL_CLASS_RESOURCE_NAMES: ReadonlySet<string> = new Set(
  [...Object.values(RESOURCE_RULES), ...Object.values(SUBCLASS_RESOURCE_RULES)].flat().map((r) => r.name.toLowerCase()),
);

/** Read-only spell card for the player phone (`GET /api/players/:id/spells`). */
export interface SpellChipInfo {
  /** The name as written on the sheet. */
  name: string;
  /** False when the SRD catalog doesn't know the spell (homebrew, typo). */
  known: boolean;
  /** SRD name when it differs from the sheet's (aliases such as "Melf's Acid Arrow"). */
  srdName?: string;
  /** 0 = cantrip. */
  level?: number;
  school?: string;
  concentration?: boolean;
  ritual?: boolean;
  castingTime?: string;
  range?: string;
  duration?: string;
  summary?: string;
  /** Damage/healing at each slot level the character can cast it with (one row for a cantrip). */
  atLevels?: SpellLevelRow[];
}

/** One row of the phone spell card's "at higher levels" table. */
export interface SpellLevelRow {
  /** Slot level (0 = cantrip at the character's level). */
  level: number;
  /** What to roll on a hit or failed save, e.g. "8d6 Fire" or "3× 1d4+1 Force". */
  damage?: string;
  heal?: string;
  /** Extra targets this level allows beyond the base. */
  extraTargets?: number;
  /** The character has a slot of this level left (always true for a cantrip). */
  available: boolean;
}
