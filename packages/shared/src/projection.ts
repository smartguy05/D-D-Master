import type { Campaign, Combat, ConditionMeta, GameState, LogEntry, MapFeature, Monster, PendingRoll, RollResult, SceneStash, Token } from "./schemas.js";
import { interactiveFeatureShownOnTable, mapObjectShownOnTable, monsterShownOnTable, rollForTable } from "./visibility.js";

/**
 * What a player-tier socket may receive (docs/server/state-projection.md). The host and the TV get
 * the full state; a player's phone or remote page gets these projections, built on the server with
 * the TV's own visibility rules (visibility.ts), so hidden information never reaches their browser.
 * Pure: the input is never changed.
 */

/**
 * Locations the party has been to: the focused scene, parked scenes (party split), PCs away from the
 * focus, and any location with explored fog. A location with fog off (a shop) counts while someone is there.
 */
export function visitedLocations(state: Pick<GameState, "locationId" | "scenes" | "partyLocations" | "fog">): Set<string> {
  const out = new Set<string>();
  if (state.locationId) out.add(state.locationId);
  for (const id of Object.keys(state.scenes ?? {})) out.add(id);
  for (const id of Object.values(state.partyLocations ?? {})) out.add(id);
  for (const [id, f] of Object.entries(state.fog ?? {})) if (f.revealed.length > 0) out.add(id);
  return out;
}

type SceneSlice = { locationId?: string; monsters: Monster[]; tokens: Token[] };

function hiddenIn(state: GameState, scene: SceneSlice, into: Set<string>) {
  const shown = monsterShownOnTable({ monsters: scene.monsters, tokens: scene.tokens, fog: state.fog, locationId: scene.locationId });
  for (const m of scene.monsters) if (!shown(m.id)) into.add(m.id);
}

/** Monsters the table can't see (host-hidden or in unseen fog), in the focused scene and every parked one. */
export function hiddenCreatureIds(state: GameState): Set<string> {
  const out = new Set<string>();
  hiddenIn(state, state, out);
  for (const [locationId, s] of Object.entries(state.scenes ?? {})) hiddenIn(state, { locationId, monsters: s.monsters, tokens: s.tokens }, out);
  return out;
}

/**
 * A visible monster as players see it: name, HP, conditions, position and looks. Stat-block values
 * (AC, attacks, ability scores, CR, initiative bonus) and DM notes (voice, attitude score) are
 * removed; required fields get neutral values (AC 0, no attacks) so the GameState type still holds.
 */
function publicMonster(m: Monster, hidden: Set<string>): Monster {
  const { srdName: _s, abilities: _a, cr: _c, voice: _v, attitudeScore: _sc, ...rest } = m;
  return { ...rest, conditionMeta: publicConditionMeta(m.conditionMeta, hidden), ac: 0, attacks: [], initiativeBonus: 0, attacksPerAction: 1 };
}

/** Condition notes without a hidden creature's id (its caster, or whose turn ends the effect). */
function publicConditionMeta(meta: ConditionMeta[], hidden: Set<string>): ConditionMeta[] {
  if (!meta.some((m) => (m.casterId && hidden.has(m.casterId)) || (m.until?.entityId && hidden.has(m.until.entityId)))) return meta;
  return meta.map(({ casterId, until, ...m }) => {
    const out: ConditionMeta = { ...m };
    if (casterId && !hidden.has(casterId)) out.casterId = casterId;
    if (until) {
      const { entityId, ...u } = until;
      out.until = entityId && !hidden.has(entityId) ? { ...u, entityId } : u;
    }
    return out;
  });
}

/** A location's features as players see them: plain ones, and interactive ones only once one of their cells has been seen (as the TV draws them). */
function publicFeatures(features: MapFeature[], state: Pick<GameState, "fog">, locationId: string): MapFeature[] {
  const shown = interactiveFeatureShownOnTable({ fog: state.fog, locationId });
  return features.filter((f) => !f.interactive || shown(f));
}

/** The initiative order without hidden creatures; when the current turn is a hidden creature's, nobody's turn shows (index -1). */
function publicCombat(combat: Combat, hidden: Set<string>): Combat {
  const current = combat.order[combat.turnIndex];
  const order = combat.order.filter((o) => !hidden.has(o.entityId));
  const turnIndex = current && !hidden.has(current.entityId) ? order.indexOf(current) : current ? -1 : combat.turnIndex;
  return {
    ...combat,
    order,
    turnIndex,
    turn: combat.turn && hidden.has(combat.turn.entityId) ? null : combat.turn,
    reactionsUsed: combat.reactionsUsed.filter((id) => !hidden.has(id)),
  };
}

/**
 * A pending physical roll as players see it. Aimed at a creature other than a PC, its `dc` is that
 * creature's AC (or a stat-block DC), so it goes (no player UI shows it); a save's DC is said aloud
 * and stays. A hidden target also loses its id and the attack's name.
 */
function publicPending(p: PendingRoll | undefined, hidden: Set<string>, pcIds: Set<string>): PendingRoll | undefined {
  if (!p?.targetId) return p;
  let out = p;
  if (p.dc !== undefined && !pcIds.has(p.targetId)) {
    const { dc: _d, ...rest } = out;
    out = rest;
  }
  if (hidden.has(p.targetId)) {
    const { targetId: _t, attackName: _n, ...rest } = out;
    out = rest;
  }
  return out;
}

function publicScene(scene: SceneStash, hidden: Set<string>, pcIds: Set<string>): SceneStash {
  return {
    ...scene,
    monsters: scene.monsters.filter((m) => !hidden.has(m.id)).map((m) => publicMonster(m, hidden)),
    tokens: scene.tokens.filter((t) => !hidden.has(t.entityId)),
    combat: publicCombat(scene.combat, hidden),
    pendingRoll: publicPending(scene.pendingRoll, hidden, pcIds),
  };
}

/** A secret roll's numbers are the DM's: the dice keep their sides (the tray shape) but no values, no total, DC or result. */
function redactSecret(roll: RollResult): RollResult {
  if (!roll.secret) return roll;
  const { dc: _d, success: _s, ...rest } = roll;
  return { ...rest, dice: roll.dice.map((d) => ({ sides: d.sides, value: 0 })), modifier: 0, total: 0 };
}

/**
 * A roll as players may see it: secret rolls redacted, an attack roll without its `dc` (the
 * target's AC; `success` keeps hit or miss), a hidden creature's roll shown as a plain DM roll
 * (rollForTable, extended to parked scenes, and sticky through `unseen` once the creature is gone),
 * and no target id naming a hidden creature. `hidden` defaults to hiddenCreatureIds(state).
 * Returned unchanged when nothing applies.
 */
export function publicRoll(roll: RollResult, state: GameState | null | undefined, hidden: Set<string> = state ? hiddenCreatureIds(state) : new Set()): RollResult {
  let r = redactSecret(roll);
  if ((r.attack || r.targetId) && r.dc !== undefined) {
    const { dc: _d, ...rest } = r;
    r = rest;
  }
  if (state) r = rollForTable(r, state);
  if (r.unseen || (r.rollerId && hidden.has(r.rollerId))) r = { ...r, rollerName: "DM", label: "", rollerId: undefined };
  if (r.targetId && hidden.has(r.targetId)) {
    const { targetId: _t, ...rest } = r;
    r = rest;
  }
  return r;
}

const PUBLIC_LOG_KINDS = new Set<LogEntry["kind"]>(["dm", "player", "roll"]);

/** coverNote's " vs AC 17" in a roll line: the target's AC, which players don't get. */
const AC_NOTE = / vs AC -?\d+/g;

/** Names of hidden creatures (any scene) that no character shares: their roll lines are dropped. */
function hiddenNamesOf(state: GameState, hidden: Set<string>): Set<string> {
  const names = new Set(allNamed(state).filter((m) => hidden.has(m.id)).map((m) => m.name));
  for (const c of state.characters) names.delete(c.name);
  return names;
}

/**
 * A log line as players may see it, or null: only DM, player and roll lines; no roll line tagged
 * `unseen` or spoken by a hidden creature; no target AC in a cover note. Shared by publicState and
 * any `log` event (publicFeed.ts). `hiddenNames` defaults to the state's hidden creatures' names.
 */
export function publicLogEntry(entry: LogEntry, state: GameState | null | undefined, hiddenNames?: Set<string>): LogEntry | null {
  if (!PUBLIC_LOG_KINDS.has(entry.kind)) return null;
  if (entry.kind !== "roll") return entry;
  if (entry.unseen) return null;
  const names = hiddenNames ?? (state ? hiddenNamesOf(state, hiddenCreatureIds(state)) : new Set<string>());
  if (entry.speaker && names.has(entry.speaker)) return null;
  const text = entry.text.replace(AC_NOTE, "");
  return text === entry.text ? entry : { ...entry, text };
}

/**
 * The GameState a player-tier socket gets: hidden and fogged monsters (with their tokens, initiative
 * entries, turn budget and reactions) are gone from every scene, visible monsters lose their stat
 * blocks, secret rolls are redacted, attack rolls and pending attacks lose the target's AC, hidden objects and unvisited locations' fog and edits are
 * dropped, tool/system log lines and AI personas are removed. HP stays (the TV shows HP bars).
 */
export function publicState(state: GameState): GameState {
  const hidden = hiddenCreatureIds(state);
  const visited = visitedLocations(state);
  const hiddenNames = hiddenNamesOf(state, hidden);
  const pcIds = new Set(state.characters.map((c) => c.id));
  const onlyVisited = <T>(rec: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(rec).filter(([id]) => visited.has(id)));
  const objectShown = (o: GameState["mapObjects"][number]) => visited.has(o.locationId) && mapObjectShownOnTable({ fog: state.fog, locationId: o.locationId })(o);
  return {
    ...state,
    players: state.players.map((p) => (p.aiPersona ? { ...p, aiPersona: "" } : p)),
    characters: state.characters.map((c) => {
      const conditionMeta = publicConditionMeta(c.conditionMeta, hidden);
      return conditionMeta === c.conditionMeta ? c : { ...c, conditionMeta };
    }),
    monsters: state.monsters.filter((m) => !hidden.has(m.id)).map((m) => publicMonster(m, hidden)),
    tokens: state.tokens.filter((t) => !hidden.has(t.entityId)),
    combat: publicCombat(state.combat, hidden),
    pendingRoll: publicPending(state.pendingRoll, hidden, pcIds),
    rolls: state.rolls.map((r) => publicRoll(r, state, hidden)),
    log: state.log.flatMap((l) => publicLogEntry(l, state, hiddenNames) ?? []),
    scenes: Object.fromEntries(Object.entries(state.scenes).map(([id, s]) => [id, publicScene(s, hidden, pcIds)])),
    mapObjects: state.mapObjects.filter(objectShown),
    fog: onlyVisited(state.fog),
    featureEdits: Object.fromEntries(Object.entries(onlyVisited(state.featureEdits)).map(([id, e]) => [id, { ...e, features: publicFeatures(e.features, state, id) }])),
    wallEdits: onlyVisited(state.wallEdits),
  };
}

function allNamed(state: GameState): Monster[] {
  return [...state.monsters, ...Object.values(state.scenes ?? {}).flatMap((s) => s.monsters)];
}

/**
 * The Campaign a player-tier socket gets: its name, premise and session summaries; visited locations
 * (name, description, map, features, walls; no map prompt); NPC names and descriptions (no motive or
 * voice). The hook, acts, encounters and unvisited locations are dropped. No state (or another
 * campaign's): no locations.
 */
export function publicCampaign(campaign: Campaign | null, state: GameState | null | undefined): Campaign | null {
  if (!campaign) return null;
  const o = campaign.outline;
  if (!o) return campaign;
  const visited = state && state.campaignId === campaign.id ? visitedLocations(state) : new Set<string>();
  return {
    ...campaign,
    outline: {
      title: o.title,
      hook: "",
      acts: [],
      encounters: [],
      locations: o.locations.filter((l) => visited.has(l.id)).map((l) => ({ ...l, mapPrompt: "", features: publicFeatures(l.features, state!, l.id) })),
      npcs: o.npcs.map((n) => ({ name: n.name, description: n.description, motive: "", voice: "" })),
    },
  };
}
