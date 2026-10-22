import { CreationChoices, type FeatPicks } from "@dm/shared";

/**
 * Merge a patch into a player's creation choices (pure; returns a new object). Scalars overwrite;
 * speciesChoices, baseAbilities, backgroundBonuses and featPicks merge per key; lists replace. A
 * background bonus of 0 removes it, and `clear` drops whole fields first (the overrides, or a record
 * the patch then replaces).
 * `fromAi`: structured output fills every field, so empty strings, lists and objects mean "no
 * change" (see .memories/bugs/pregens-blind-in-fog.md). Throws a ZodError on bad input.
 */
export function mergeChoices(choices: CreationChoices, rawPatch: unknown, opts: { fromAi?: boolean; clear?: string[] } = {}): CreationChoices {
  const parsed = CreationChoices.safeParse(rawPatch ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Can't use that ${issue.path.join(".") || "change"}: ${issue.message}.`);
  }
  const patch = parsed.data;
  const next: CreationChoices = structuredClone(choices);
  // Clear first: a client replaces a whole record by clearing it and sending the new value.
  for (const key of opts.clear ?? []) if (key in CreationChoices.shape) delete (next as Record<string, unknown>)[key];
  const empty = (v: unknown) => v === "" || (Array.isArray(v) && !v.length) || (!!v && typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length);
  for (const [key, value] of Object.entries(patch) as [keyof CreationChoices, unknown][]) {
    if (value === undefined || (opts.fromAi && empty(value))) continue;
    if (key === "speciesChoices" || key === "baseAbilities") {
      next[key] = { ...(next[key] ?? {}), ...(value as object) } as never;
    } else if (key === "backgroundBonuses") {
      const merged: Record<string, number> = { ...(next.backgroundBonuses ?? {}), ...(value as Record<string, number>) };
      for (const k of Object.keys(merged)) if (!merged[k]) delete merged[k];
      next.backgroundBonuses = merged;
    } else if (key === "featPicks") {
      const merged: Record<string, FeatPicks> = { ...(next.featPicks ?? {}) };
      for (const [source, picks] of Object.entries(value as Record<string, FeatPicks>)) {
        const kept = opts.fromAi ? Object.fromEntries(Object.entries(picks).filter(([, v]) => !empty(v))) : picks;
        merged[source] = { ...(merged[source] ?? {}), ...kept };
      }
      next.featPicks = merged;
    } else (next as Record<string, unknown>)[key] = value;
  }
  return next;
}
