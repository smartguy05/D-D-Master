import { z } from "zod";
import { CreationChoices, type AbilityMethod, type ChatTurn, type CreationIssue, type CreationOptions } from "@dm/shared";
import { completeJson, type LLMProvider } from "./provider.js";

/**
 * The phone character creation helper (docs/gameplay/phone-creation.md): a session-zero chat where
 * the AI fills the player's draft. Each player line is one turn: the history is serialised into the
 * prompt, the model replies with { reply, patch }, the server merges the patch and runs the SRD
 * validator, and errors the patch caused go back for a repair. The model never sets derived numbers.
 */

export const CreationReply = z.object({
  /** What the helper says to the player (short; it may ask one or two questions). */
  reply: z.string().max(2000),
  /** Only the choices this turn changes. */
  patch: CreationChoices.default({}),
  /** Up to 2 SRD searches to read before answering (rules questions). */
  lookups: z.array(z.string().max(120)).max(2).default([]),
  /** Draw the portrait now (the appearance is settled). */
  drawPortrait: z.boolean().default(false),
});
export type CreationReply = z.infer<typeof CreationReply>;

/** History kept in the prompt: the newest turns, each cut, within a total budget. */
export const HISTORY_TURNS = 12;
export const TURN_CHARS = 600;
export const HISTORY_CHARS = 6000;
/** LLM calls per player line (answer, lookup round, repairs). */
export const MAX_CALLS = 4;
/** Thinking counts against max_tokens on Anthropic (.memories/bugs/pregens-no-json-thinking-budget.md). */
export const CHAT_MAX_TOKENS = 12_000;

export interface ChatInput {
  playerName: string;
  level: number;
  methods: AbilityMethod[];
  allowHomebrew: boolean;
  rolledScores?: number[];
  options: CreationOptions;
  choices: CreationChoices;
  errors: CreationIssue[];
  warnings: CreationIssue[];
  /** Derived numbers (scores, AC, HP, attacks…) so the helper can talk about them. */
  derived: string;
  history: ChatTurn[];
  text: string;
}

const METHOD_TEXT: Record<AbilityMethod, string> = {
  standard_array: "standard array (15, 14, 13, 12, 10, 8, each once)",
  point_buy: "point buy (27 points; 8 costs 0, 9:1, 10:2, 11:3, 12:4, 13:5, 14:7, 15:9; scores 8-15)",
  rolled: "rolled scores (the player taps Roll on the phone; you can only assign the rolled numbers)",
};

/** The SRD options in a compact form; spells only for the chosen class (and Magic Initiate lists). */
export function catalogText(o: CreationOptions, choices: CreationChoices, level: number): string {
  const lines: string[] = [];
  lines.push("CLASSES:");
  for (const c of o.classes) {
    const skills = c.skillChoices ? `skills: ${c.skillChoices.count} of ${c.skillChoices.options === "any" ? "any" : c.skillChoices.options.join("/")}` : "";
    const pkgs = c.equipment.map((e) => `${e.letter}) ${[...e.items.map((i) => (i.qty > 1 ? `${i.name} x${i.qty}` : i.name)), ...(e.gold ? [`${e.gold} GP`] : [])].join(", ")}`).join(" | ");
    const casting = c.cantrips || c.preparedSpells ? `; at level ${level}: ${c.cantrips} cantrips, ${c.preparedSpells} prepared spells up to level ${c.maxSpellLevel}` : "";
    const extra = [c.fightingStyle ? "needs fightingStyle" : "", c.subclass && c.subclassLevel !== undefined ? `subclass at ${c.subclassLevel}: ${c.subclass}` : "", c.asiLevels.length ? `ASI at levels ${c.asiLevels.join(", ")}` : ""].filter(Boolean).join("; ");
    lines.push(`- ${c.name} (d${c.hitDie}; ${skills}${casting}${extra ? `; ${extra}` : ""}; equipment ${pkgs})`);
  }
  lines.push("SPECIES (speciesChoices key: options):");
  for (const s of o.species) {
    const ch = s.choices.map((c) => `${c.key}: ${c.options.length > 8 ? `${c.kind === "skill" ? "any skill" : c.options.map((x) => x.name).join("/")}` : c.options.map((x) => x.name).join("/")}`).join("; ");
    lines.push(`- ${s.name} (speed ${s.speed}; ${s.traits.map((t) => t.name).join(", ")}${ch ? `; choices ${ch}` : ""})`);
  }
  lines.push("BACKGROUNDS:");
  for (const b of o.backgrounds) {
    const pkgs = b.equipment.map((e) => `${e.letter}) ${[...e.items.map((i) => i.name), ...(e.gold ? [`${e.gold} GP`] : [])].join(", ")}`).join(" | ");
    lines.push(`- ${b.name} (bonuses among ${b.abilities.join("/")}; feat ${b.feat}; skills ${b.skills.join(", ")}; equipment ${pkgs})`);
  }
  lines.push(`ORIGIN FEATS: ${o.feats.filter((f) => f.category === "origin").map((f) => f.name).join(", ")}`);
  lines.push(`FIGHTING STYLES: ${o.feats.filter((f) => f.category === "fighting_style").map((f) => f.name).join(", ")}`);
  lines.push(`GENERAL FEATS (instead of an ASI): ${o.feats.filter((f) => f.category === "general").map((f) => f.name).join(", ")}`);
  const cls = o.classes.find((c) => c.name.toLowerCase() === choices.className?.trim().toLowerCase());
  const lists = new Set<string>();
  if (cls && (cls.cantrips || cls.preparedSpells)) lists.add(cls.name);
  for (const p of Object.values(choices.featPicks ?? {})) if (p.list) lists.add(p.list);
  const bgFeat = o.backgrounds.find((b) => b.name === choices.background)?.feat;
  const fixed = bgFeat && /Magic Initiate \(([^)]+)\)/.exec(bgFeat)?.[1];
  if (fixed) lists.add(fixed);
  for (const list of lists) {
    const max = list === cls?.name ? cls.maxSpellLevel : 1;
    const spells = (o.spells[list] ?? []).filter((s) => s.level <= max);
    lines.push(`${list.toUpperCase()} SPELLS: cantrips: ${spells.filter((s) => s.level === 0).map((s) => s.name).join(", ")}; ${Array.from({ length: max }, (_, i) => `level ${i + 1}: ${spells.filter((s) => s.level === i + 1).map((s) => s.name).join(", ")}`).join("; ")}`);
  }
  return lines.join("\n");
}

export function creationSystem(input: ChatInput): string {
  return `You are a friendly session-zero helper for Dungeons & Dragons 5e (2024 rules, SRD 5.2). You help ${input.playerName} create a level ${input.level} character by chatting on their phone. Be warm and brief: 1-4 short sentences per reply, offer 2-3 fitting options at a time, ask at most two questions.

HARD RULES (the server checks every choice and tells you what broke):
- Use only the SRD species, classes, subclasses, backgrounds, feats and spells listed below${input.allowHomebrew ? " (or homebrew from the table's house rules, if the player names it)" : ""}. Never invent options.
- Ability scores: the host allows ${input.methods.map((m) => METHOD_TEXT[m]).join("; or ")}.${input.rolledScores?.length ? ` The player rolled: ${input.rolledScores.join(", ")}.` : ""} baseAbilities are the scores BEFORE the background bonus.
- backgroundBonuses: +2 to one and +1 to another of the background's three abilities, or +1 to all three (e.g. {"str":2,"con":1}).
- classSkills: exactly the class's count, from its list, never one the background or species already gives.
- Never set derived numbers: the server computes final scores, HP, AC, proficiency, saves, attacks and spell slots. Leave maxHpOverride and acOverride out unless the player insists on homebrew numbers.
- speciesChoices: an object of choice key → option name, using the keys listed for the species (e.g. {"elven_lineage":"High Elf","elven_lineage_ability":"Intelligence","keen_senses":"Perception"}).
- featPicks: {"background": {...}} for the background's Origin feat, {"species": {...}} for a Human's Versatile feat. Magic Initiate: {"list":"Wizard","cantrips":[two],"spell":"one level 1 spell"} (the list is fixed when the feat names it). Skilled: {"skills":[three]}.
- asi: one entry per ASI level reached, e.g. [{"feat":"Ability Score Improvement","increases":{"str":2}}].
- classEquipment / backgroundEquipment: the package letter ("A", "B"…).
- Spells: "cantrips" and "spells" (prepared, level 1+) from the class list, the exact counts for the level.
- Flavour is yours to write with the player: name, appearance (one vivid sentence used to draw the portrait), personality, ideals, bonds, flaws, backstory (a short paragraph). Write them when the player gives you the idea; ask before inventing big facts.

HOW TO REPLY
- "patch" holds ONLY the fields you set or change this turn; leave everything else out. When the player decides something, put it in the patch right away; the phone shows the sheet live.
- When the player asks a rules question, answer from the SRD text given; put up to 2 search phrases in "lookups" if you need more text first (your reply is then asked again with it).
- Set "drawPortrait" true once name and appearance are settled and the player wants to see them (or asks for a new picture).
- When nothing is left to fix, tell the player they can tap "Join the party".

SRD OPTIONS
${catalogText(input.options, input.choices, input.level)}`;
}

/** The newest turns, each cut to TURN_CHARS, within HISTORY_CHARS (oldest dropped first). */
export function historyText(history: ChatTurn[]): string {
  const out: string[] = [];
  let total = 0;
  for (const t of history.slice(-HISTORY_TURNS).reverse()) {
    const text = t.text.length > TURN_CHARS ? `${t.text.slice(0, TURN_CHARS - 1)}…` : t.text;
    const line = `${t.role === "player" ? "PLAYER" : t.role === "ai" ? "YOU" : "NOTE"}: ${text}`;
    if (total + line.length > HISTORY_CHARS) break;
    out.unshift(line);
    total += line.length;
  }
  return out.join("\n");
}

const issueLines = (xs: CreationIssue[]) => xs.map((i) => `- ${i.field}: ${i.message}`).join("\n") || "- none";

export function creationPrompt(input: ChatInput, extra: { rules?: string; repair?: CreationIssue[]; previous?: CreationReply } = {}): string {
  const parts = [
    `CURRENT CHOICES (JSON):\n${JSON.stringify(input.choices)}`,
    `DERIVED BY THE SERVER: ${input.derived || "(not yet: no name or scores)"}`,
    `STILL TO FIX (errors):\n${issueLines(input.errors)}`,
    `ADVICE (warnings):\n${issueLines(input.warnings)}`,
  ];
  if (extra.rules) parts.push(`SRD TEXT:\n${extra.rules}`);
  const history = historyText(input.history);
  if (history) parts.push(`CONVERSATION SO FAR:\n${history}`);
  parts.push(`PLAYER NOW: ${input.text}`);
  if (extra.repair?.length && extra.previous) {
    parts.push(
      `YOUR LAST ANSWER: ${JSON.stringify({ reply: extra.previous.reply, patch: extra.previous.patch })}\nTHE SERVER REJECTED PARTS OF YOUR PATCH:\n${issueLines(extra.repair)}\nReturn the whole answer again with a corrected patch (and adjust the reply if it promised something that broke a rule).`,
    );
  }
  return parts.join("\n\n");
}

/** What the server does with a patch: merge it into the choices and run the validator. */
export interface ChatDeps {
  apply(patch: CreationChoices): { choices: CreationChoices; errors: CreationIssue[]; warnings: CreationIssue[]; derived: string };
  /** SRD text for a question (RulesIndex.lookup). */
  lookup(query: string): string;
}

export interface ChatResult {
  reply: string;
  /** The accepted patch (the service merges it onto the draft as it is by then). */
  patch: CreationChoices;
  choices: CreationChoices;
  drawPortrait: boolean;
  calls: number;
}

const isEmpty = (v: unknown) => v === undefined || v === "" || (Array.isArray(v) && !v.length) || (!!v && typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length);

/** Errors in fields the patch set (empty values are "no change", see mergeChoices): the ones the helper caused. */
export function patchErrors(patch: CreationChoices, errors: CreationIssue[]): CreationIssue[] {
  const keys = Object.entries(patch)
    .filter(([, v]) => !isEmpty(v))
    .map(([k]) => k);
  return errors.filter((e) => keys.some((k) => e.field === k || e.field.startsWith(`${k}.`)));
}

/** One player line: answer (with an optional SRD lookup round), apply, and repair what the patch broke. */
export async function runCreationTurn(llm: LLMProvider, input: ChatInput, deps: ChatDeps): Promise<ChatResult> {
  const system = creationSystem(input);
  let calls = 0;
  const ask = (extra: Parameters<typeof creationPrompt>[1]) => {
    calls++;
    return completeJson(llm, { system, prompt: creationPrompt(input, extra), schema: CreationReply, schemaName: "CreationReply", maxTokens: CHAT_MAX_TOKENS });
  };
  let rules = deps.lookup(input.text);
  let answer = await ask({ rules });
  if (answer.lookups.length && calls < MAX_CALLS) {
    rules = [rules, ...answer.lookups.map((q) => deps.lookup(q))].join("\n\n").slice(0, 6000);
    answer = await ask({ rules });
  }
  let applied = deps.apply(answer.patch);
  let caused = patchErrors(answer.patch, applied.errors);
  while (caused.length && calls < MAX_CALLS) {
    // A repair that fails (timeout, bad JSON) keeps the answer we have.
    const retry = await ask({ rules, repair: caused, previous: answer }).catch(() => undefined);
    if (!retry) break;
    const next = deps.apply(retry.patch);
    const nextCaused = patchErrors(retry.patch, next.errors);
    // Keep the better attempt: a repair that breaks more than it fixes is dropped.
    if (nextCaused.length > caused.length) break;
    answer = retry;
    applied = next;
    caused = nextCaused;
  }
  return { reply: answer.reply.trim() || "Okay!", patch: answer.patch, choices: applied.choices, drawPortrait: answer.drawPortrait, calls };
}
