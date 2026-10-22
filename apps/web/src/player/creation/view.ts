import { ABILITY_KEYS, POINT_BUY_BUDGET, pointBuyCost, type Abilities, type AbilityBonuses, type AbilityKey, type CreationIssue, type CreationValidation, type CreationView } from "@dm/shared";

/** Pure view logic for phone character creation (CreatePanel, BuildForm). */

export type StepKey = "origin" | "class" | "abilities" | "spells" | "gear" | "details";

/** The build steps and the validator fields each one covers (a field also covers "field.sub"). */
export const STEPS: { key: StepKey; label: string; fields: string[] }[] = [
  { key: "origin", label: "Origin", fields: ["species", "speciesChoices", "background", "featPicks"] },
  { key: "class", label: "Class", fields: ["className", "subclass", "classSkills", "fightingStyle"] },
  { key: "abilities", label: "Abilities", fields: ["abilityMethod", "baseAbilities", "backgroundBonuses", "asi"] },
  { key: "spells", label: "Spells", fields: ["cantrips", "spells"] },
  { key: "gear", label: "Gear", fields: ["classEquipment", "backgroundEquipment", "maxHpOverride", "acOverride"] },
  { key: "details", label: "Details", fields: ["name", "appearance", "backstory", "personality", "ideals", "bonds", "flaws", "diceMode"] },
];

const covers = (prefix: string, field: string) => field === prefix || field.startsWith(`${prefix}.`);

export function issuesFor(v: CreationValidation, prefix: string): CreationIssue[] {
  return [...v.errors, ...v.warnings].filter((i) => covers(prefix, i.field));
}

export function errorsFor(v: CreationValidation, prefix: string): CreationIssue[] {
  return v.errors.filter((i) => covers(prefix, i.field));
}

export function stepIssues(v: CreationValidation, step: StepKey): { errors: number; warnings: number } {
  const fields = STEPS.find((s) => s.key === step)!.fields;
  const hit = (i: CreationIssue) => fields.some((f) => covers(f, i.field));
  return { errors: v.errors.filter(hit).length, warnings: v.warnings.filter(hit).length };
}

/** Standard array / rolled pool: set one score; a value already on another ability swaps with it. */
export function setArrayScore(base: Partial<Abilities>, key: AbilityKey, value: number | undefined): Partial<Abilities> {
  const next = { ...base };
  if (value === undefined) {
    delete next[key];
    return next;
  }
  const holder = ABILITY_KEYS.find((k) => k !== key && next[k] === value);
  if (holder) {
    if (next[key] !== undefined) next[holder] = next[key];
    else delete next[holder];
  }
  next[key] = value;
  return next;
}

export function pointsLeft(base: Partial<Abilities>): number {
  return POINT_BUY_BUDGET - pointBuyCost(base);
}

export type BonusPattern = { kind: "21"; plus2?: AbilityKey; plus1?: AbilityKey } | { kind: "111" };

export function bonusPattern(b: AbilityBonuses | undefined): BonusPattern {
  const used = ABILITY_KEYS.filter((k) => (b?.[k] ?? 0) > 0);
  if (used.length === 3 && used.every((k) => b![k] === 1)) return { kind: "111" };
  const plus2 = used.find((k) => b![k] === 2);
  const plus1 = used.find((k) => b![k] === 1);
  return { kind: "21", ...(plus2 && { plus2 }), ...(plus1 && { plus1 }) };
}

/** The bonuses a pattern gives among the background's abilities (+2 and +1 on the same one keeps the +2). */
export function applyBonusPattern(abilities: AbilityKey[], p: BonusPattern): AbilityBonuses {
  if (p.kind === "111") return Object.fromEntries(abilities.map((k) => [k, 1]));
  const out: AbilityBonuses = {};
  if (p.plus2) out[p.plus2] = 2;
  if (p.plus1 && p.plus1 !== p.plus2) out[p.plus1] = 1;
  return out;
}

/** Add or remove a pick; adding past `max` changes nothing. */
export function toggleInList(list: string[], item: string, max: number): string[] {
  if (list.includes(item)) return list.filter((x) => x !== item);
  return list.length >= max ? list : [...list, item];
}

export type MainAction = { kind: "join"; label: string } | { kind: "submit"; label: string } | { kind: "withdraw"; label: string } | { kind: "none" };

/** The panel's main button. */
export function actionFor(v: CreationView): MainAction {
  const d = v.draft;
  if (d.status === "pending") return { kind: "withdraw", label: "Withdraw from the host" };
  if (d.status === "joined" && v.locked) return { kind: "none" };
  if (!v.preview) return { kind: "none" };
  if (v.validation.ok) return { kind: "join", label: d.status === "joined" ? "Save changes" : "Join the party" };
  return { kind: "submit", label: "Send to the host for approval" };
}

/**
 * What the phone shows: `create` (no character yet), `can-edit` (its own phone-made character,
 * editable until play starts), `sheet` (just the sheet) or `off` (the host turned creation off).
 */
export function panelMode(v: CreationView | null, hasCharacter: boolean): "create" | "can-edit" | "sheet" | "off" {
  if (!v) return hasCharacter ? "sheet" : "create";
  if (!hasCharacter) return v.settings.phoneCreation ? "create" : "off";
  if (v.hasOtherCharacter || !v.draft.characterId) return "sheet";
  if (v.draft.status === "pending") return "can-edit";
  return v.locked || !v.settings.phoneCreation ? "sheet" : "can-edit";
}

export const METHOD_LABELS = { standard_array: "Standard array", point_buy: "Point buy", rolled: "Roll 4d6" } as const;
