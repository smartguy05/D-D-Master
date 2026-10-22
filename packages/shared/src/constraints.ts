import { z } from "zod";
import type { SpeciesInfo } from "./creation.js";

/**
 * Per-campaign character constraints (docs/gameplay/character-constraints.md): which species and
 * classes PCs may be, plus the campaign's own custom species (a Rat world's Sewer Rat, Brown Rat…).
 * Phone creation, the voice builder, pregens and sheet import block a character that breaks them;
 * the host's own editor only warns. An empty allow-list means "no restriction".
 */

export const CustomSpeciesOption = z.object({
  name: z.string().min(1),
  text: z.string().optional(),
  cantrips: z.array(z.string()).optional(),
  spells: z.array(z.object({ level: z.number().int().min(1).max(20), name: z.string() })).optional(),
  speed: z.number().int().min(0).max(120).optional(),
  darkvision: z.number().int().min(0).max(300).optional(),
});

export const CustomSpeciesChoice = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["option", "size", "skill", "feat", "ability"]),
  options: z.array(CustomSpeciesOption).default([]),
});

/** A campaign-defined species in the same shape as an SRD one (SpeciesInfo). */
export const CustomSpecies = z.object({
  name: z.string().trim().min(1).max(80),
  /** Flavour for players and the sprite prompt. */
  description: z.string().default(""),
  creatureType: z.string().default("Humanoid"),
  speed: z.number().int().min(0).max(120).default(30),
  darkvision: z.number().int().min(0).max(300).optional(),
  cantrips: z.array(z.string()).default([]),
  traits: z.array(z.object({ name: z.string().min(1), text: z.string().default("") })).default([]),
  choices: z.array(CustomSpeciesChoice).default([]),
});
export type CustomSpecies = z.infer<typeof CustomSpecies>;

// A custom species must work everywhere an SRD SpeciesInfo does (validate.ts, the phone form).
const _speciesShape: SpeciesInfo = {} as CustomSpecies;
void _speciesShape;

export const CharacterConstraints = z.object({
  /** SRD and/or custom species names PCs may be. Empty = any. */
  allowedSpecies: z.array(z.string()).default([]),
  /** Class names PCs may be (subclasses follow their class). Empty = any. */
  allowedClasses: z.array(z.string()).default([]),
  customSpecies: z.array(CustomSpecies).default([]),
});
export type CharacterConstraints = z.infer<typeof CharacterConstraints>;
/** What a host sends (defaults not filled in yet). */
export type CharacterConstraintsInput = z.input<typeof CharacterConstraints>;

export interface ConstraintIssue {
  field: "species" | "className";
  code: "species_not_allowed" | "class_not_allowed";
  message: string;
}

const norm = (s: string) => s.trim().toLowerCase();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "Wood Elf" or "Elf (Drow)" counts as an allowed "Elf": the allowed name as a whole word. */
function nameMatches(name: string, allowed: string): boolean {
  const n = norm(name);
  const a = norm(allowed);
  if (!n || !a) return false;
  return n === a || new RegExp(`(^|[^a-z0-9])${escape(a)}([^a-z0-9]|$)`).test(n);
}

export function speciesAllowed(name: string, c: CharacterConstraints | undefined): boolean {
  if (!c || c.allowedSpecies.length === 0) return true;
  return c.allowedSpecies.some((a) => nameMatches(name, a));
}

export function classAllowed(name: string, c: CharacterConstraints | undefined): boolean {
  if (!c || c.allowedClasses.length === 0) return true;
  return c.allowedClasses.some((a) => norm(a) === norm(name));
}

export function findCustomSpecies(name: string, c: CharacterConstraints | undefined): CustomSpecies | undefined {
  if (!c || !name.trim()) return undefined;
  return c.customSpecies.find((s) => norm(s.name) === norm(name));
}

/** Issues for a character's species/class. Blank fields are not checked (other code asks for them). */
export function checkConstraints(ch: { species?: string; className?: string }, c: CharacterConstraints | undefined): ConstraintIssue[] {
  const out: ConstraintIssue[] = [];
  const species = ch.species?.trim() ?? "";
  const cls = ch.className?.trim() ?? "";
  if (species && !speciesAllowed(species, c))
    out.push({ field: "species", code: "species_not_allowed", message: `${species} isn't allowed in this campaign. Allowed species: ${c!.allowedSpecies.join(", ")}.` });
  if (cls && !classAllowed(cls, c))
    out.push({ field: "className", code: "class_not_allowed", message: `${cls} isn't allowed in this campaign. Allowed classes: ${c!.allowedClasses.join(", ")}.` });
  return out;
}

export function hasConstraints(c: CharacterConstraints | undefined): boolean {
  return !!c && (c.allowedSpecies.length > 0 || c.allowedClasses.length > 0 || c.customSpecies.length > 0);
}

/** A short block for prompts (voice builder, phone AI chat, pregens). Empty when there are no rules. */
export function constraintsText(c: CharacterConstraints | undefined): string {
  if (!hasConstraints(c)) return "";
  const lines: string[] = [];
  if (c!.allowedSpecies.length) lines.push(`Allowed species (only these): ${c!.allowedSpecies.join(", ")}.`);
  if (c!.allowedClasses.length) lines.push(`Allowed classes (only these): ${c!.allowedClasses.join(", ")}.`);
  for (const s of c!.customSpecies) {
    if (!speciesAllowed(s.name, c)) continue;
    const bits = [`${s.creatureType}`, `speed ${s.speed} ft`, s.darkvision ? `darkvision ${s.darkvision} ft` : ""].filter(Boolean).join(", ");
    const traits = s.traits.map((t) => t.name).join(", ");
    const choices = s.choices.map((ch) => `${ch.label}: ${ch.options.map((o) => o.name).join("/")}`).join("; ");
    lines.push(`Custom species ${s.name} (${bits})${s.description.trim() ? ` — ${s.description.trim().replace(/[.\s]+$/, "")}` : ""}${traits ? `. Traits: ${traits}` : ""}${choices ? `. Choices: ${choices}` : ""}.`);
  }
  return lines.join("\n");
}

/** Trim, drop blanks and de-duplicate (case-insensitive) a list of names. */
export function cleanNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const t = n.trim();
    if (!t || seen.has(norm(t))) continue;
    seen.add(norm(t));
    out.push(t);
  }
  return out;
}
