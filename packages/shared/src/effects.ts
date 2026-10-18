/**
 * Pure helpers for automatic board animations (attacks and spells on the TV). The server uses them
 * to pick a travel style and an element for an effect; the web uses `elementFor` to colour it.
 */

/** How an effect travels from the source to the target: a melee swing, a flying arrow, a spell orb or an area burst. */
export type AttackStyle = "melee" | "ranged" | "spell" | "area";

/** What an attack roll did to the target. */
export type AttackOutcome = "hit" | "miss" | "crit";

/** The look of a damage type. Bludgeoning/piercing/slashing (and unknown types) are "physical". */
export type EffectElement = "fire" | "cold" | "lightning" | "thunder" | "acid" | "poison" | "radiant" | "necrotic" | "force" | "psychic" | "physical";

const ELEMENTS: EffectElement[] = ["fire", "cold", "lightning", "thunder", "acid", "poison", "radiant", "necrotic", "force", "psychic"];

/** Damage type (or any text containing one, e.g. "1d6+2 fire") → element. */
export function elementFor(damageType: string | undefined): EffectElement {
  const t = (damageType ?? "").toLowerCase();
  return ELEMENTS.find((e) => t.includes(e)) ?? "physical";
}

const DAMAGE_TYPES = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];

/** The damage type named in an attack's damage text ("1d6+2 slashing" → "slashing"), if any. */
export function damageTypeOf(damage: string | undefined): string | undefined {
  const t = (damage ?? "").toLowerCase();
  return DAMAGE_TYPES.find((d) => t.includes(d));
}

/** Weapon names that fire or are thrown (whole words; "bow" also as a suffix: shortbow, longbow). */
const RANGED_NAME = /(\w*bow\b|\bsling\b|\bdarts?\b|\bjavelins?\b|\bblowgun\b|\bnet\b|\bthrown\b|\bthrowing\b|\barrows?\b|\bspit\b|\bhurl)/i;

export interface AttackStyleInput {
  /** An explicit style (wins over everything). */
  hint?: AttackStyle;
  /** Attack/weapon name, e.g. "Shortbow". */
  name?: string;
  /** Stat-block text, e.g. "Melee Attack Roll: +4, reach 5 ft." */
  description?: string;
  /** The attack is a spell (Fire Bolt, Eldritch Blast...). */
  isSpell?: boolean;
}

/**
 * Melee, ranged or spell for an attack: explicit hint, then a spell, then the SRD "Melee Attack
 * Roll" / "Ranged Attack Roll" text, then weapon-name keywords (bow, crossbow, sling, dart,
 * javelin, blowgun, net, thrown...). Anything else is melee. "Melee or Ranged" text defers to the name.
 */
export function attackStyle(a: AttackStyleInput): AttackStyle {
  if (a.hint) return a.hint;
  if (a.isSpell) return "spell";
  const d = a.description ?? "";
  if (!/melee or ranged/i.test(d)) {
    if (/ranged (weapon |spell )?attack/i.test(d)) return "ranged";
    if (/melee (weapon |spell )?attack/i.test(d)) return "melee";
  }
  return RANGED_NAME.test(a.name ?? "") ? "ranged" : "melee";
}

/**
 * The attack an attack roll or damage call refers to: by `attackName` (exact, then partial match),
 * else the first attack whose name appears in the roll label ("Goblin scimitar attack" → Scimitar).
 */
export function findAttack<T extends { name: string }>(attacks: T[], attackName?: string, label?: string): T | undefined {
  const q = attackName?.trim().toLowerCase();
  if (q) {
    const exact = attacks.find((a) => a.name.toLowerCase() === q);
    if (exact) return exact;
    const partial = attacks.find((a) => a.name.toLowerCase().includes(q) || q.includes(a.name.toLowerCase()));
    if (partial) return partial;
  }
  const l = label?.toLowerCase();
  return l ? attacks.find((a) => l.includes(a.name.toLowerCase())) : undefined;
}
