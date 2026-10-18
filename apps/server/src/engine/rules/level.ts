import {
  abilityMod,
  findClassFeature,
  proficiencyBonusFor,
  subclassMatches,
  type ClassData,
  type ClassFeature,
  type GameState,
  type ToolArgsOf,
} from "@dm/shared";
import { makeRoll } from "../rolls.js";
import { addLog, requireCharacter } from "../state.js";
import type { EngineContext, EngineOutcome } from "../tools.js";
import { applyDerived, hitDiceText, isDead, pactText, slotsText } from "./derive.js";
import { regainedHp } from "./vitals.js";

/**
 * level_up, per SRD 5.2.1 "Level Advancement":
 * "Adjust Hit Points and Hit Point Dice. Each time you gain a level, you gain an additional Hit Die.
 * Roll that die, add your Constitution modifier to the roll, and add the total (minimum of 1) to
 * your Hit Point maximum. Instead of rolling, you can use the fixed value shown in the Fixed Hit
 * Points by Class table" (die/2 + 1: Barbarian 7, Fighter 6, Wizard 4 ...).
 * "Record New Class Features" and "Adjust Proficiency Bonus". Current HP rises by the same amount;
 * spent slots, Hit Dice and resource uses stay spent (it is not a rest).
 */

const FEATURE_TEXT = 200;

function shortText(text: string): string {
  if (text.length <= FEATURE_TEXT) return text;
  const cut = text.slice(0, FEATURE_TEXT);
  const stop = cut.lastIndexOf(". ");
  return stop > 80 ? cut.slice(0, stop + 1) : `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

const isSubclassPlaceholder = (name: string) => /subclass( feature)?$/i.test(name.trim());

/** The level at which the class picks its subclass (the "<Class> Subclass" table entry), if any. */
export function subclassLevel(cls: ClassData): number | undefined {
  return cls.levels.find((l) => l.features.some((f) => /subclass$/i.test(f.trim())))?.level;
}

export function levelUp(state: GameState, a: ToolArgsOf<"level_up">, ctx: EngineContext, out: EngineOutcome) {
  const c = requireCharacter(state, a.character_id);
  if (c.level >= 20) return { error: `${c.name} is already level 20, the highest level.` };
  if (isDead(c)) return { error: `${c.name} is dead; revive them before levelling up.` };
  const cls = c.className ? ctx.classData(c.className) : undefined;
  const level = c.level + 1;
  const notes: string[] = [];

  // Subclass: required at the class's subclass level (3 for every SRD class).
  let subclass = a.subclass?.trim() || c.subclass;
  if (cls?.subclass) {
    const at = subclassLevel(cls);
    if (at !== undefined && level >= at && !subclass) {
      return {
        error: `${c.name} reaches ${cls.name} level ${level} and must choose a subclass. The SRD subclass is ${cls.subclass.name}; call level_up again with subclass.`,
        subclass_options: [cls.subclass.name],
      };
    }
    if (subclass && subclassMatches(cls.subclass.name, subclass)) subclass = cls.subclass.name;
    else if (a.subclass?.trim()) notes.push(`${subclass} is not the SRD subclass (${cls.subclass.name}): add its features by hand.`);
  }
  if (!cls) notes.push(`${c.className || "This class"} is not an SRD class: HP uses a d8 and no features were added.`);

  // Hit points.
  const before = { maxHp: c.maxHp };
  const die = cls?.hitDie ?? c.hitDice.die ?? 8;
  const con = abilityMod(c.abilities.con);
  let rolled: number | undefined;
  if (a.hp === "roll") {
    const roll = makeRoll(state, ctx, `1d${die}${con >= 0 ? "+" : ""}${con}`, `${c.name} level ${level} HP`, { rollerId: c.id, rollerName: c.name });
    out.rolls.push(roll);
    rolled = roll.total;
  }
  const gain = Math.max(1, rolled ?? die / 2 + 1 + con);
  c.level = level;
  c.maxHp += gain;
  const wasDown = c.hp <= 0;
  c.hp = Math.max(0, c.hp) + gain;
  // Regaining HP at 0 ends Unconscious and resets the death saves (SRD "Falling Unconscious").
  if (wasDown) regainedHp(state, c);
  c.proficiencyBonus = proficiencyBonusFor(level);
  c.subclass = subclass ?? "";
  applyDerived(c, cls);

  // Features gained at this level: the table row's Class Features column (the SRD writes a
  // repeated feature such as Ability Score Improvement only once as a heading, at its first level),
  // then the subclass's own features. Each gets its feature text for the DM.
  const gained: ClassFeature[] = [];
  const row = cls?.levels.find((l) => l.level === level);
  if (cls) {
    for (const name of row?.features ?? []) {
      if (isSubclassPlaceholder(name)) continue;
      const f = findClassFeature(cls, name);
      const entry = f ? { level, name: f.name, text: f.text } : { level, name: name.trim(), text: "" };
      if (!gained.some((g) => g.name === entry.name)) gained.push(entry);
    }
    if (cls.subclass && subclassMatches(cls.subclass.name, c.subclass)) gained.push(...cls.subclass.features.filter((f) => f.level === level));
  }
  for (const f of gained) if (!c.features.includes(f.name)) c.features.push(f.name);

  addLog(state, { kind: "system", text: `${c.name} reaches level ${level}! (+${gain} max HP${gained.length ? `; ${gained.map((f) => f.name).join(", ")}` : ""})` });
  return {
    name: c.name,
    level,
    subclass: c.subclass || undefined,
    hp_gain: gain,
    hp: `${c.hp}/${c.maxHp}`,
    previous_max_hp: before.maxHp,
    proficiency_bonus: c.proficiencyBonus,
    hit_dice: hitDiceText(c),
    slots: slotsText(c),
    pact: pactText(c),
    cantrips: row?.cantrips,
    prepared_spells: row?.preparedSpells,
    resources: c.resources.length ? c.resources.map((r) => `${r.name} ${r.max - r.used}/${r.max}`) : undefined,
    new_features: gained.map((f) => ({ name: f.name, text: shortText(f.text) })),
    note: notes.length ? notes.join(" ") : undefined,
  };
}
