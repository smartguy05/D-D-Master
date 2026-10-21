import { locationOfCharacter, isAway, partyGroups, type GameState } from "@dm/shared";

type Loc = { id: string; name: string };

/**
 * Party split, under the TV's scene title: one line per group the TV is not showing, e.g.
 * "Lyra, Thorin · Old Mill · ⏸ ⚔ round 2" (a fight there is frozen until the DM cuts back).
 */
export function otherGroupLines(state: GameState, locations: readonly Loc[]): string[] {
  return partyGroups(state, locations)
    .filter((g) => !g.focused)
    .map((g) => `${g.names.join(", ")} · ${g.name}${g.combat ? ` · ⏸ ⚔ round ${g.combat.round}` : ""}`);
}

/** "@ Old Mill" for a PC with a group the TV isn't showing (their party card), else undefined. */
export function awayTag(state: GameState, characterId: string, locations: readonly Loc[]): string | undefined {
  if (!isAway(state, characterId)) return undefined;
  const id = locationOfCharacter(state, characterId);
  return `@ ${locations.find((l) => l.id === id)?.name ?? id}`;
}
