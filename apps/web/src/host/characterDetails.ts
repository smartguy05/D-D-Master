import type { Character } from "@dm/shared";
import { personaRows, resourceRows, slotRows, hitDiceLabel } from "../player/sheet";

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
