import type { Character, Combat, GameState, Monster, PendingRoll, Token } from "./schemas.js";

/**
 * Party split (read side). The focused scene (the one the TV shows) lives in the top-level
 * `locationId`, `tokens`, `monsters`, `combat` and `pendingRoll`; every other group's scene is parked
 * in `state.scenes[locationId]`, and `state.partyLocations` lists only the PCs away from the focus.
 * The engine side (switching focus, moving PCs) is apps/server/src/engine/scenes.ts.
 */

type SplitState = Pick<GameState, "locationId" | "characters" | "tokens" | "monsters" | "combat" | "pendingRoll"> & {
  scenes?: GameState["scenes"];
  partyLocations?: GameState["partyLocations"];
};

/** Where a PC is: their away location, else the focused scene. */
export function locationOfCharacter(state: SplitState, characterId: string): string | undefined {
  return state.partyLocations?.[characterId] ?? state.locationId;
}

/** The PC is with a group the TV is not showing. */
export function isAway(state: SplitState, characterId: string): boolean {
  const loc = state.partyLocations?.[characterId];
  return !!loc && loc !== state.locationId;
}

/** The PCs in the focused scene. */
export function presentCharacters<S extends SplitState>(state: S): S["characters"] {
  return state.characters.filter((c) => !isAway(state, c.id));
}

/** The PCs at a location (the focused one included). */
export function charactersAt<S extends SplitState>(state: S, locationId: string): S["characters"] {
  return state.characters.filter((c) => locationOfCharacter(state, c.id) === locationId);
}

/** More than one group: some scene is parked. */
export function isSplit(state: SplitState): boolean {
  return Object.keys(state.scenes ?? {}).length > 0;
}

export interface SceneView {
  locationId?: string;
  focused: boolean;
  tokens: Token[];
  monsters: Monster[];
  combat: Combat;
  pendingRoll?: PendingRoll;
}

const NO_COMBAT: Combat = { active: false, round: 0, turnIndex: 0, order: [], turn: null, reactionsUsed: [], announced: [] };

/** One location's scene: the top level when it is focused, else its parked stash (empty if nobody is there). */
export function sceneView(state: SplitState, locationId: string | undefined): SceneView {
  if (!locationId || locationId === state.locationId)
    return { locationId: state.locationId, focused: true, tokens: state.tokens, monsters: state.monsters, combat: state.combat, pendingRoll: state.pendingRoll };
  const s = state.scenes?.[locationId];
  return { locationId, focused: false, tokens: s?.tokens ?? [], monsters: s?.monsters ?? [], combat: s?.combat ?? NO_COMBAT, pendingRoll: s?.pendingRoll };
}

/**
 * The state as if `locationId` were focused, for read-only helpers written for the focused scene
 * (visibilityOf, monsterShownOnTable, activeFog). Never commit it.
 */
export function sceneState<S extends SplitState>(state: S, locationId: string | undefined): S {
  const v = sceneView(state, locationId);
  if (v.focused) return state;
  return { ...state, locationId: v.locationId, tokens: v.tokens, monsters: v.monsters, combat: v.combat, pendingRoll: v.pendingRoll };
}

export interface PartyGroup {
  locationId: string;
  name: string;
  focused: boolean;
  characterIds: string[];
  names: string[];
  /** The group's fight (frozen when not focused), or null. */
  combat: { round: number; current?: string } | null;
}

/** One entry per location with PCs, the focused group first. Empty before the first scene. */
export function partyGroups(state: SplitState, locations: readonly { id: string; name: string }[]): PartyGroup[] {
  const ids = [state.locationId, ...Object.keys(state.scenes ?? {})].filter((x, i, a): x is string => !!x && a.indexOf(x) === i);
  return ids
    .map((id) => {
      const v = sceneView(state, id);
      const pcs: Character[] = charactersAt(state, id);
      const cur = v.combat.active ? v.combat.order[v.combat.turnIndex] : undefined;
      return {
        locationId: id,
        name: locations.find((l) => l.id === id)?.name ?? id,
        focused: v.focused,
        characterIds: pcs.map((c) => c.id),
        names: pcs.map((c) => c.name),
        combat: v.combat.active ? { round: v.combat.round, current: cur?.name } : null,
      };
    })
    .filter((g) => g.focused || g.characterIds.length > 0);
}

/** Every monster in every scene (focused first): the live objects, so callers may update them in place. */
export function allMonsters(state: Pick<GameState, "monsters"> & { scenes?: GameState["scenes"] }): Monster[] {
  return [...state.monsters, ...Object.values(state.scenes ?? {}).flatMap((s) => s.monsters)];
}
