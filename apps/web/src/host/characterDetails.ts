import type { Character } from "@dm/shared";
import { personaRows, resourceRows, slotRows, hitDiceLabel } from "../player/sheet";

/** One character row open at a time: clicking the open one closes it. */
export function toggleOpen(current: string | null, id: string): string | null {
  return current === id ? null : id;
}

/** Clicks on these (the row's buttons, the portrait) do their own thing instead of toggling the row. */
export const NO_TOGGLE = "button, a, input, select, textarea, label, summary, details, [data-no-toggle]";

/** Duck-typed so it is testable without a DOM: an Element (or Text node's parent) has `closest`. */
export function isRowToggle(target: { closest?: (selector: string) => unknown } | null): boolean {
  if (!target || typeof target.closest !== "function") return true;
  return !target.closest(NO_TOGGLE);
}

export interface DetailSections {
  attacks: boolean;
  rules: boolean;
  spells: boolean;
  features: boolean;
  about: boolean;
}

/** Which optional sections of the host's character details have anything to show. */
export function detailSections(c: Character): DetailSections {
  return {
    attacks: c.attacks.length > 0,
    rules: slotRows(c).length > 0 || resourceRows(c).length > 0 || !!hitDiceLabel(c),
    spells: c.spells.length > 0,
    features: c.features.length > 0,
    about: !!(c.appearance.trim() || c.notes.trim() || personaRows(c).length),
  };
}
