import { locationOfCharacter, type GameState } from "@dm/shared";

/** A refused change_scene waiting for a human player to answer the DM's "ready to go?". */
export interface ReadyCheck {
  /** Where the DM wants to take the party. */
  locationId: string;
  /** Where the party was when the DM was told to ask. */
  fromLocationId: string;
  /** GameService's human-input counter when the DM was told to ask. */
  askedAtInput: number;
  /** When the DM was told to ask (ms epoch). */
  askedAt: number;
}

/** A "yes" counts for the repeat change_scene only this soon after the ask... */
export const READY_CHECK_MAX_AGE_MS = 5 * 60_000;
/** ...and only within this many human lines after it (later talk is about something else). */
export const READY_CHECK_MAX_INPUTS = 8;

export interface DepartureArgs {
  location_id?: string;
  character_ids?: string[];
  forced?: boolean;
}

export type DepartureVerdict = { allow: true } | { allow: false; pending: ReadyCheck; refusal: { error: string; ask: string[] } };

/**
 * Ready check before the DM's change_scene: the human players whose characters leave the scene in
 * focus must get the question first. The first call is refused and asks the DM to check; a repeat
 * to the same place goes through once a human said anything since (an AI player's typed line does
 * not count), within READY_CHECK_MAX_AGE_MS and READY_CHECK_MAX_INPUTS of the ask. A stale check
 * is refused again as a fresh one. No current location, no human leaving, an unknown location (the
 * engine reports it), or `forced` (a trapdoor, a teleport) skips it.
 */
export function departureGate(
  state: GameState,
  args: DepartureArgs,
  ctx: { pending?: ReadyCheck; humanInputs: number; now: number; locations: { id: string; name: string }[] },
): DepartureVerdict {
  if (args.forced || !state.locationId) return { allow: true };
  const raw = String(args.location_id ?? "").trim();
  const loc = ctx.locations.find((l) => l.id === raw) ?? ctx.locations.find((l) => l.name.toLowerCase() === raw.toLowerCase());
  // Not a place in the outline: change_scene reports the error, not a ready check.
  if (!loc) return { allow: true };
  const target = loc.id;
  const here = state.characters.filter((c) => locationOfCharacter(state, c.id) === state.locationId);
  // Travelling to where they already are (a split group regrouping onto them) is not leaving.
  if (target === state.locationId) return { allow: true };
  const movers = args.character_ids?.length ? here.filter((c) => args.character_ids!.includes(c.id)) : here;
  const humans = movers.filter((c) => !state.players.some((p) => p.ai && p.characterId === c.id));
  if (!humans.length) return { allow: true };
  if (answered(ctx.pending, target, state.locationId, ctx)) return { allow: true };
  const names = humans.map((c) => c.name);
  const where = loc.name;
  return {
    allow: false,
    pending: { locationId: target, fromLocationId: state.locationId, askedAtInput: ctx.humanInputs, askedAt: ctx.now },
    refusal: {
      error: `Ready check: before anyone leaves for ${where}, ask ${names.join(", ")} by name whether they are ready to go, then wait for their answer. An AI player's suggestion is not the party's decision. Call change_scene again once they agree; if someone isn't ready, stay and play on.`,
      ask: names,
    },
  };
}

/** A human answered the pending check for this departure, recently enough to still count. */
function answered(p: ReadyCheck | undefined, target: string, from: string, ctx: { humanInputs: number; now: number }): boolean {
  if (!p || p.locationId !== target || p.fromLocationId !== from) return false;
  const since = ctx.humanInputs - p.askedAtInput;
  return since > 0 && since <= READY_CHECK_MAX_INPUTS && ctx.now - p.askedAt <= READY_CHECK_MAX_AGE_MS;
}
