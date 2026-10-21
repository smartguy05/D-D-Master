import { locationOfCharacter, partyGroups, type GameState } from "@dm/shared";

/** One row of the host's "Party & spotlight" card: a group, where it is, and its fight. */
export interface SpotlightRow {
  locationId: string;
  name: string;
  focused: boolean;
  members: string;
  /** "⚔ round 2 · Wolf's turn", with "(frozen)" for a group the TV isn't showing; undefined out of combat. */
  fight?: string;
}

type Loc = { id: string; name: string };

export function spotlightRows(state: GameState, locations: readonly Loc[]): SpotlightRow[] {
  return partyGroups(state, locations).map((g) => ({
    locationId: g.locationId,
    name: g.name,
    focused: g.focused,
    members: g.names.join(", ") || "nobody",
    fight: g.combat ? `⚔ round ${g.combat.round}${g.combat.current ? ` · ${g.combat.current}'s turn` : ""}${g.focused ? "" : " (frozen)"}` : undefined,
  }));
}

/** Each PC and the location they are at (for the per-PC "send to" dropdown). */
export function characterPlaces(state: GameState): { id: string; name: string; locationId?: string }[] {
  return state.characters.map((c) => ({ id: c.id, name: c.name, locationId: locationOfCharacter(state, c.id) }));
}
