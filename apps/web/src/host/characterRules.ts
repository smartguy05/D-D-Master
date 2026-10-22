import type { CharacterConstraints, CustomSpecies } from "@dm/shared";

/**
 * Pure helpers for the host's Character rules card (CharacterRules.tsx): allow-list toggles and the
 * plain-text editing of a custom species' traits and choices.
 */

const norm = (s: string) => s.trim().toLowerCase();

export function toggleName(list: string[], name: string, on: boolean): string[] {
  const rest = list.filter((x) => norm(x) !== norm(name));
  return on ? [...rest, name] : rest;
}

/** The ticked classes: an empty allow-list means every class. */
export function tickedClasses(allowed: string[], all: string[]): string[] {
  return allowed.length ? all.filter((c) => allowed.some((a) => norm(a) === norm(c))) : [...all];
}

/** What to save: every class ticked (or none) is stored as [] ("no restriction"). */
export function classesToSave(ticked: string[], all: string[]): string[] {
  return ticked.length === 0 || all.every((c) => ticked.some((t) => norm(t) === norm(c))) ? [] : ticked;
}

/** Add drafted species to the list (replacing same-named ones) and allow them. */
export function addDrafted(c: CharacterConstraints, drafted: CustomSpecies[]): CharacterConstraints {
  const names = new Set(drafted.map((s) => norm(s.name)));
  let allowed = c.allowedSpecies;
  for (const s of drafted) allowed = toggleName(allowed, s.name, true);
  return { ...c, customSpecies: [...c.customSpecies.filter((s) => !names.has(norm(s.name))), ...drafted], allowedSpecies: allowed };
}

/** Remove a custom species and its allow-list entry. */
export function removeCustom(c: CharacterConstraints, index: number): CharacterConstraints {
  const gone = c.customSpecies[index];
  if (!gone) return c;
  return { ...c, customSpecies: c.customSpecies.filter((_, i) => i !== index), allowedSpecies: toggleName(c.allowedSpecies, gone.name, false) };
}

/** Rename a custom species and keep its allow-list entry in step. */
export function renameCustom(c: CharacterConstraints, index: number, name: string): CharacterConstraints {
  const old = c.customSpecies[index];
  if (!old) return c;
  const allowed = c.allowedSpecies.map((a) => (norm(a) === norm(old.name) ? name : a));
  return { ...c, allowedSpecies: allowed, customSpecies: c.customSpecies.map((s, i) => (i === index ? { ...s, name } : s)) };
}

export const blankSpecies = (name = "New species"): CustomSpecies => ({ name, description: "", creatureType: "Humanoid", speed: 30, cantrips: [], traits: [], choices: [] });

/** Traits as lines of "Name: rules text". */
export const traitsToText = (s: CustomSpecies) => s.traits.map((t) => (t.text ? `${t.name}: ${t.text}` : t.name)).join("\n");

export function traitsFromText(text: string): CustomSpecies["traits"] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf(":");
      return i < 0 ? { name: l, text: "" } : { name: l.slice(0, i).trim(), text: l.slice(i + 1).trim() };
    })
    .filter((t) => t.name);
}

const KINDS = ["option", "size", "skill", "feat", "ability"] as const;
type Kind = (typeof KINDS)[number];

/** Choices as lines of "Label [kind]: A / B / C". Option extras (cantrips, speed…) survive when the names don't change. */
export function choicesToText(s: CustomSpecies): string {
  return s.choices.map((c) => `${c.label} [${c.kind}]: ${c.options.map((o) => o.name).join(" / ")}`).join("\n");
}

export function choicesFromText(text: string, prev: CustomSpecies["choices"] = []): CustomSpecies["choices"] {
  const out: CustomSpecies["choices"] = [];
  for (const raw of text.split("\n")) {
    const m = /^\s*([^[:]+?)\s*(?:\[(\w+)\])?\s*:\s*(.+)$/.exec(raw);
    if (!m) continue;
    const label = m[1]!.trim();
    const kind: Kind = KINDS.includes(m[2] as Kind) ? (m[2] as Kind) : /^size$/i.test(label) ? "size" : "option";
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `choice_${out.length + 1}`;
    const before = prev.find((c) => c.key === key);
    const options = m[3]!
      .split("/")
      .map((o) => o.trim())
      .filter(Boolean)
      .map((name) => before?.options.find((o) => norm(o.name) === norm(name)) ?? { name });
    if (options.length) out.push({ key, label, kind, options });
  }
  return out;
}
