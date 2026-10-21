import { abilityMod, presentCharacters, type Character, type GameState, type ToolArgsOf } from "@dm/shared";
import { makeRoll } from "../rolls.js";
import { addLog, findCombatant, requireCharacter } from "../state.js";
import type { EngineContext, EngineOutcome } from "../tools.js";
import { hitDiceText, isDead, pactText, slotsText } from "./derive.js";
import { endSpellConditionsOnRest } from "./conditions.js";
import { endConcentration } from "./vitals.js";

/**
 * Short and Long Rests and limited-use resources, per the SRD 5.2.1 Rules Glossary.
 * Both rests: "To start a Short/Long Rest, you must have at least 1 Hit Point." Characters at 0 HP
 * are skipped with a reason.
 */

const MIN_HP_REASON = "needs at least 1 Hit Point to rest";

function resolveHitDiceCounts(state: GameState, raw: Record<string, number> | undefined): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [key, n] of Object.entries(raw ?? {})) {
    const c = findCombatant(state, key);
    if (c?.kind === "character") counts.set(c.entity.id, (counts.get(c.entity.id) ?? 0) + n);
  }
  return counts;
}

/**
 * Short Rest. SRD: "Spend Hit Point Dice. ... For each Hit Point Die you spend in this way, roll the
 * die and add your Constitution modifier to it. You regain Hit Points equal to the total (minimum of
 * 1 Hit Point). You can decide to spend an additional Hit Point Die after each roll." We stop early
 * once HP is full (a later die would be wasted).
 * "Special Feature. Some features are recharged by a Short Rest": Pact Magic slots ("You regain all
 * expended Pact Magic spell slots when you finish a Short or Long Rest"), resources with
 * resetOn "short", and `shortRestRegain` uses of long-rest ones (Rage, Channel Divinity...).
 */
export function shortRest(state: GameState, a: ToolArgsOf<"short_rest">, ctx: EngineContext, out: EngineOutcome) {
  const counts = resolveHitDiceCounts(state, a.hit_dice);
  const seen = new Set<string>();
  const characters = [];
  for (const id of a.character_ids) {
    const c = requireCharacter(state, id);
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    if (c.hp < 1 || isDead(c)) {
      characters.push({ name: c.name, skipped: MIN_HP_REASON });
      continue;
    }
    const want = counts.get(c.id) ?? 0;
    const mod = abilityMod(c.abilities.con);
    const notation = `1d${c.hitDice.die}${mod >= 0 ? "+" : ""}${mod}`;
    let spent = 0;
    let healed = 0;
    while (spent < want && c.hitDice.used < c.hitDice.max && c.hp < c.maxHp) {
      const roll = makeRoll(state, ctx, notation, "Hit Point Die", { rollerId: c.id, rollerName: c.name });
      out.rolls.push(roll);
      const gain = Math.max(1, roll.total);
      const before = c.hp;
      c.hp = Math.min(c.maxHp, c.hp + gain);
      healed += c.hp - before;
      c.hitDice.used += 1;
      spent += 1;
    }
    const recovered: string[] = [];
    if (c.pactSlots && c.pactSlots.used > 0) {
      c.pactSlots.used = 0;
      recovered.push("Pact Magic slots");
    }
    for (const r of c.resources) {
      if (r.used === 0) continue;
      if (r.resetOn === "short") r.used = 0;
      else if (r.shortRestRegain) r.used = Math.max(0, r.used - r.shortRestRegain);
      else continue;
      recovered.push(r.name);
    }
    // Features whose note describes a Short Rest option (Arcane Recovery, Sorcerous Restoration...).
    const options = c.resources.filter((r) => r.used < r.max && /short rest/i.test(r.note ?? "")).map((r) => `${r.name}: ${r.note}`);
    if (spent || recovered.length) addLog(state, { kind: "system", text: `${c.name} finishes a Short Rest${healed ? ` (+${healed} HP)` : ""}.` });
    characters.push({
      name: c.name,
      hit_dice_spent: spent,
      healed,
      hp: `${c.hp}/${c.maxHp}`,
      hit_dice_left: hitDiceText(c),
      recovered: recovered.length ? recovered : undefined,
      options: options.length ? options : undefined,
      pact_left: pactText(c),
    });
  }
  return { rest: "short", characters };
}

/** "Exhaustion 2" (or ": 2", "(2)") → "Exhaustion 1"; "Exhaustion"/"Exhaustion 1" → removed. */
function reduceExhaustion(conditions: string[]): string[] {
  const out: string[] = [];
  for (const cond of conditions) {
    // "Exhaustion", "Exhaustion 2", "Exhaustion: 2", "Exhaustion (2)", "Exhaustion (level 2)".
    const m = /^exhaustion(?:\s*[:(]?\s*(?:level\s*)?(\d+)\s*\)?)?$/i.exec(cond.trim());
    if (!m) out.push(cond);
    else {
      const level = (m[1] ? parseInt(m[1], 10) : 1) - 1;
      if (level > 0) out.push(`Exhaustion ${level}`);
    }
  }
  return out;
}

/**
 * Long Rest. SRD: "Regain All HP. You regain all lost Hit Points and all spent Hit Point Dice."
 * "Exhaustion Reduced. ... its level decreases by 1." "Special Feature": every class says spell
 * slots and its features come back on a Long Rest. Temporary Hit Points "last until they're
 * depleted or you finish a Long Rest". Sleeping gives the Unconscious condition, which ends
 * Concentration. Death saves are cleared.
 */
export function longRest(state: GameState, a: ToolArgsOf<"long_rest">) {
  const targets: Character[] = a.character_ids?.length ? a.character_ids.map((id) => requireCharacter(state, id)) : presentCharacters(state);
  const characters = [];
  for (const c of [...new Set(targets)]) {
    if (c.hp < 1 || isDead(c)) {
      characters.push({ name: c.name, skipped: MIN_HP_REASON });
      continue;
    }
    c.hp = c.maxHp;
    c.tempHp = 0;
    c.hitDice.used = 0;
    for (const s of c.spellSlots) s.used = 0;
    if (c.pactSlots) c.pactSlots.used = 0;
    for (const r of c.resources) r.used = 0;
    c.deathSaves = { successes: 0, failures: 0, stable: false, lastRolled: null };
    const ended = endConcentration(state, c, "slept");
    endSpellConditionsOnRest(state, [c.id]);
    c.conditions = reduceExhaustion(c.conditions);
    characters.push({
      name: c.name,
      hp: `${c.hp}/${c.maxHp}`,
      slots: slotsText(c),
      pact: pactText(c),
      hit_dice: hitDiceText(c),
      ended_concentration: ended,
    });
  }
  addLog(state, { kind: "system", text: `Long Rest: ${characters.filter((c) => !("skipped" in c)).map((c) => c.name).join(", ") || "nobody"} fully restored.` });
  return { rest: "long", characters };
}

export function useResource(state: GameState, a: ToolArgsOf<"use_resource">) {
  const c = requireCharacter(state, a.character_id);
  const q = a.resource.trim().toLowerCase();
  const r = c.resources.find((x) => x.name.toLowerCase() === q) ?? c.resources.find((x) => x.name.toLowerCase().startsWith(q));
  if (!r) throw new Error(`${c.name} has no resource "${a.resource}". Resources: ${c.resources.map((x) => x.name).join(", ") || "none"}.`);
  const left = r.max - r.used;
  if (a.amount > left) throw new Error(`${c.name} has no uses of ${r.name} left for that (${left}/${r.max}; ${r.resetOn === "short" ? "Short or Long Rest" : "Long Rest"} restores).`);
  r.used = Math.max(0, Math.min(r.max, r.used + a.amount));
  addLog(state, { kind: "system", text: `${c.name} ${a.amount >= 0 ? "uses" : "regains"} ${r.name} (${r.max - r.used}/${r.max} left)` });
  return { name: c.name, resource: r.name, left: `${r.max - r.used}/${r.max}`, note: r.note };
}
