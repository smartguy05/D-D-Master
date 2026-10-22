import {
  abilityMod,
  BuilderDraft,
  checkConstraints,
  constraintsText,
  DEFAULT_ABILITIES,
  findCustomSpecies,
  hitDieFor,
  proficiencyBonusFor,
  type Abilities,
  type CharacterBuilder,
  type CharacterConstraints,
  type ConstraintIssue,
  type GameState,
} from "@dm/shared";
import type { CharacterDraft } from "../brain/content.js";

/**
 * Voice character builder: pure helpers. The DM interviews one player and fills a draft
 * (state.builder.draft) with draft_character_update; finalize_character turns it into a character.
 * GameService wires these into state mutations, tools and the host API.
 */

export { CLASS_HIT_DIE, hitDieFor, proficiencyBonusFor } from "@dm/shared";

const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"] as const;

/** Fixed-value max HP: full hit die at level 1, then the average (die/2 + 1) per level, + CON each level. */
export function defaultMaxHp(className: string, level: number, con: number): number {
  const die = hitDieFor(className);
  const mod = abilityMod(con);
  return Math.max(1, die + mod + (level - 1) * (die / 2 + 1 + mod));
}

/** Start (or restart) the builder for a player. Throws if the player is unknown. */
export function startBuilder(state: GameState, playerIdOrName: string, level: number, now = Date.now()): CharacterBuilder {
  const key = playerIdOrName.trim().toLowerCase();
  const player =
    state.players.find((p) => p.id === playerIdOrName) ?? state.players.find((p) => p.name.toLowerCase() === key);
  if (!player) throw new Error(`No player "${playerIdOrName}". Players: ${state.players.map((p) => p.name).join(", ") || "none"}`);
  const builder: CharacterBuilder = { playerId: player.id, playerName: player.name, level, draft: {}, startedAt: now, updatedAt: now };
  state.builder = builder;
  return builder;
}

/**
 * Merge a partial update into a draft. Scalars overwrite, abilities merge per score, lists replace.
 * `undefined` leaves a field alone. The patch is validated (throws a ZodError on bad input).
 */
export function mergeDraft(draft: BuilderDraft, rawPatch: unknown): BuilderDraft {
  const patch = BuilderDraft.parse(rawPatch ?? {});
  const next: BuilderDraft = { ...draft };
  for (const [k, v] of Object.entries(patch) as [keyof BuilderDraft, unknown][]) {
    if (v === undefined) continue;
    if (k === "abilities") next.abilities = { ...(draft.abilities ?? {}), ...(v as Partial<Abilities>) };
    else (next as Record<string, unknown>)[k] = v;
  }
  return next;
}

/** Fields the DM still has to settle before finalize_character succeeds. */
export function missingFields(draft: BuilderDraft): string[] {
  const missing: string[] = [];
  if (!draft.name?.trim()) missing.push("name");
  if (!draft.species?.trim()) missing.push("species");
  if (!draft.className?.trim()) missing.push("className");
  const scores = ABILITY_KEYS.filter((k) => draft.abilities?.[k] === undefined);
  if (scores.length) missing.push(`abilities (${scores.join(", ")})`);
  return missing;
}

/** Nice-to-have fields that are not required but make a better character. */
export function suggestedFields(draft: BuilderDraft): string[] {
  const out: string[] = [];
  if (!draft.background) out.push("background");
  if (!draft.skills?.length) out.push("skills");
  if (!draft.attacks?.length && !draft.spells?.length) out.push("attacks or spells");
  if (!draft.inventory?.length) out.push("inventory");
  if (!draft.appearance) out.push("appearance (used to draw the token)");
  return out;
}

export type FinalizeResult =
  | { ok: true; character: Partial<CharacterDraft> & { name: string } }
  | { ok: false; missing: string[]; issues?: ConstraintIssue[] };

/**
 * Turn a complete draft into the CharacterDraft accepted by GameService.addCharacter.
 * Fills in derived values: proficiency bonus from level, HP from class hit die + CON when not given,
 * AC 10 + DEX when not given.
 */
export function finalizeDraft(builder: CharacterBuilder, constraints?: CharacterConstraints): FinalizeResult {
  const d = builder.draft;
  const missing = missingFields(d);
  if (missing.length) return { ok: false, missing };
  const issues = checkConstraints(d, constraints);
  if (issues.length) return { ok: false, missing: [], issues };
  const custom = findCustomSpecies(d.species!, constraints);
  const abilities = { ...DEFAULT_ABILITIES, ...d.abilities } as Abilities;
  const level = builder.level;
  return {
    ok: true,
    character: {
      name: d.name!.trim(),
      playerName: builder.playerName,
      species: d.species!.trim(),
      className: d.className!.trim(),
      subclass: d.subclass?.trim() ?? "",
      level,
      background: d.background ?? "",
      abilities,
      maxHp: d.maxHp ?? defaultMaxHp(d.className!, level, abilities.con),
      ac: d.ac ?? 10 + abilityMod(abilities.dex),
      speed: d.speed ?? custom?.speed ?? 30,
      proficiencyBonus: proficiencyBonusFor(level),
      skills: d.skills ?? [],
      savingThrows: d.savingThrows ?? [],
      attacks: d.attacks ?? [],
      spells: d.spells ?? [],
      features: d.features ?? custom?.traits.map((t) => t.name) ?? [],
      inventory: (d.inventory ?? []).map((i) => ({ id: "", name: i.name, qty: i.qty, description: i.description })),
      gold: d.gold ?? 0,
      appearance: d.appearance ?? "",
      backstory: d.backstory ?? "",
      personality: d.personality ?? "",
      ideals: d.ideals ?? "",
      bonds: d.bonds ?? "",
      flaws: d.flaws ?? "",
      notes: d.notes ?? "",
      diceMode: d.diceMode ?? "virtual",
    },
  };
}

/** Compact, model-friendly view of the draft returned from builder tools. */
export function draftSummary(builder: CharacterBuilder) {
  return {
    player: builder.playerName,
    level: builder.level,
    draft: builder.draft,
    missing: missingFields(builder.draft),
    suggested: suggestedFields(builder.draft),
  };
}

/** How the DM runs the interview (shared by the host note, the opening and the instructions). */
export function builderSteps(builder: CharacterBuilder, constraints?: CharacterConstraints): string {
  const rules = constraintsText(constraints);
  const offer = rules
    ? `This campaign restricts characters; offer only what it allows (draft_character_update refuses anything else):\n${rules}\nUse lookup_rule for SRD species/class/background details; a custom species' traits are listed above.`
    : "Offer SRD 5.2 options and use lookup_rule for species/class/background details.";
  return `Interview ${builder.playerName} to build their level ${builder.level} character, one or two questions at a time: concept, species, class, background, ability scores (standard array 15,14,13,12,10,8 or point buy), skills, starting equipment, spells if any, name, appearance, and a line each of personality, ideals, bonds, flaws and backstory. ${offer} After each decision call draft_character_update with only the new fields (everyone sees the draft live). When nothing is missing, read a short summary back, then call finalize_character.`;
}

/** System note that switches the DM into interview mode. */
export function builderPrompt(builder: CharacterBuilder, constraints?: CharacterConstraints): string {
  return `Host note (do not read aloud): CHARACTER BUILDER for ${builder.playerName}, level ${builder.level}. Pause the adventure now. ${builderSteps(builder, constraints)} Ask ${builder.playerName} your first question in this reply. Afterwards welcome the new hero and resume the adventure.`;
}

/** One line for a restored or resumed DM: a build is still running and what it still needs. */
export function builderStatus(builder: CharacterBuilder): string {
  const missing = missingFields(builder.draft);
  return `A character build for ${builder.playerName} is in progress: continue the interview before the adventure (still missing: ${missing.join(", ") || "nothing - read it back and call finalize_character"}).`;
}
