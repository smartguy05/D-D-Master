import { isSplit, type Combat, type GameState, type SceneStash } from "@dm/shared";

/**
 * Party split, the engine side: "swap on focus". The focused scene (what the TV shows and the only
 * one that acts) is the top-level `locationId/tokens/monsters/combat/pendingRoll`, so the rest of
 * the engine needs no notion of scenes. Every other group's scene is parked in `state.scenes`, and
 * `state.partyLocations` maps only the away PCs to their location. Read helpers: @dm/shared scenes.ts.
 * Everything here mutates the state it is given (handlers pass their working copy).
 */

export const noCombat = (): Combat => ({ active: false, round: 0, turnIndex: 0, order: [], turn: null, reactionsUsed: [], announced: [] });

function park(state: GameState): SceneStash {
  const stash: SceneStash = { tokens: state.tokens, monsters: state.monsters, combat: state.combat };
  if (state.pendingRoll) stash.pendingRoll = state.pendingRoll;
  return stash;
}

function load(state: GameState, stash: SceneStash | undefined) {
  state.tokens = stash?.tokens ?? [];
  state.monsters = stash?.monsters ?? [];
  state.combat = stash?.combat ?? noCombat();
  if (stash?.pendingRoll) state.pendingRoll = stash.pendingRoll;
  else delete state.pendingRoll;
}

/**
 * Make `to` the focused scene, parking the current one as it is (even when nobody is left there:
 * callers prune). The focused PCs get a partyLocations entry; those at `to` lose theirs.
 */
function swapFocus(state: GameState, to: string) {
  const from = state.locationId;
  if (to === from) return;
  state.scenes ??= {};
  state.partyLocations ??= {};
  if (from) {
    for (const c of state.characters) state.partyLocations[c.id] ??= from;
    state.scenes[from] = park(state);
  }
  load(state, state.scenes[to]);
  delete state.scenes[to];
  state.locationId = to;
  for (const [id, loc] of Object.entries(state.partyLocations)) if (loc === to) delete state.partyLocations[id];
}

/**
 * Keep the split invariants: no partyLocations entry for the focus, for a removed PC, or pointing
 * nowhere; no parked scene without a PC (its monsters vanish, as when the whole party leaves a place).
 */
export function pruneScenes(state: GameState) {
  state.scenes ??= {};
  state.partyLocations ??= {};
  for (const [id, loc] of Object.entries(state.partyLocations))
    if (loc === state.locationId || !state.characters.some((c) => c.id === id) || !state.scenes[loc]) delete state.partyLocations[id];
  const occupied = new Set(Object.values(state.partyLocations));
  for (const loc of Object.keys(state.scenes)) if (!occupied.has(loc)) delete state.scenes[loc];
}

/** Cut to `to`: the old focus is parked while PCs remain there, else dropped. */
export function focusScene(state: GameState, to: string) {
  swapFocus(state, to);
  pruneScenes(state);
}

/**
 * Run `fn` with `locId` swapped in as the focused scene, then swap back (the scene stays parked).
 * Lets focused-scene code (leaveInitiative, restaging, fog) work on a parked group. Mutates `state`.
 */
export function inScene<T>(state: GameState, locId: string | undefined, fn: (s: GameState) => T): T {
  const focus = state.locationId;
  if (!locId || locId === focus || !focus) return fn(state);
  swapFocus(state, locId);
  try {
    return fn(state);
  } finally {
    swapFocus(state, focus);
  }
}

/**
 * Like inScene for a function returning a new state (restageForMap, resetForRepaint): the input is
 * not modified. A location nobody is at is left alone (the function is not run).
 */
export function mapScene(state: GameState, locId: string, fn: (s: GameState) => GameState): GameState {
  if (!state.locationId || locId === state.locationId) return fn(state);
  if (!state.scenes?.[locId]) return state;
  const focus = state.locationId;
  const s = structuredClone(state);
  swapFocus(s, locId);
  const r = fn(s);
  if (r === s) return state; // nothing to do there (e.g. restaging mid-fight)
  swapFocus(r, focus);
  return r;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A PC was deleted: forget their location and their tokens and initiative entries in parked scenes
 * (the focused scene is the caller's). Mutates `state`.
 */
export function forgetCharacter(state: GameState, id: string) {
  for (const stash of Object.values(state.scenes ?? {})) {
    stash.tokens = stash.tokens.filter((t) => t.entityId !== id);
    const at = stash.combat.order.findIndex((o) => o.entityId === id);
    if (at < 0) continue;
    stash.combat.order.splice(at, 1);
    if (at < stash.combat.turnIndex) stash.combat.turnIndex -= 1;
    if (stash.combat.turnIndex >= stash.combat.order.length) stash.combat.turnIndex = 0;
  }
  if (state.partyLocations) delete state.partyLocations[id];
  pruneScenes(state);
}

/** pruneScenes on a committed state: the same object when nothing needed fixing. */
export function normalizeScenes(state: GameState): GameState {
  if (!isSplit(state) && !Object.keys(state.partyLocations ?? {}).length) return state;
  const next = structuredClone(state);
  pruneScenes(next);
  return sameJson(next, state) ? state : next;
}
