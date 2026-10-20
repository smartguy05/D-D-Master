import {
  abilityMod,
  cellsInRadius,
  cellsInRect,
  coverBetween,
  coverNote,
  effectiveFeatures,
  effectiveWalls,
  entryCell,
  moveBlocked,
  visibilityOf,
  type BoardEffect,
  ToolArgs,
  type Character,
  type ClassData,
  type GameState,
  type InitiativeEntry,
  type Location,
  type Moment,
  type MapFeature,
  type Monster,
  type Npc,
  type Pickup,
  type Rng,
  type RollResult,
  type SpellEffect,
  type SpellInfo,
  type WallSeg,
  type ToolArgsOf,
  type ToolName,
  naturalD20,
  attitudeForDisposition,
  attitudeForScore,
  attitudeOf,
  clampAttitudeScore,
  defaultNpcVoice,
  dispositionForAttitude,
  formatAttitude,
  type Disposition,
} from "@dm/shared";
import { newId } from "./ids.js";
import { effect, isAttackRoll, makeRoll, rollEffects, rollSummary } from "./rolls.js";
import { attackRollEffect, castEffects, damageEffect } from "./effects.js";
import { fogEntry, revealAroundCharacters, revealCells } from "./fog.js";
import { editFog, editMapFeature, editWalls, setMonsterHidden } from "./board.js";
import { dropLoot, mapObjectsStatus, pickUp, placeInteractable, removeMapObject, setInteractable } from "./mapObjects.js";
import { planSpawn } from "./spawn.js";
import { dmCreatureTurn, dmTurnInstruction } from "./turns.js";
import { announceCombatResult, foesBeaten, moment, partyDown } from "./moments.js";
import { budgetView, economyGate, isErrorOutput, syncTurn, takeAction } from "./economy.js";
import { RULES_HANDLERS, RULES_TOOLS } from "./rules/index.js";
import { isDead, rulesStatus } from "./rules/derive.js";
import {
  addConditionMeta,
  conditionMetaFor,
  dropConditionMeta,
  endTimedConditions,
  expireAtTurnEnd,
  expireAtTurnStart,
  expireOrphaned,
} from "./rules/conditions.js";
import {
  afterCondition,
  afterHealing,
  damageCharacter,
  needsDeathSave,
  recordAutomaticRoll,
  replacedPending,
  rollDeathSave,
  type DamageNotes,
} from "./rules/vitals.js";
import {
  addLog,
  addRoll,
  addToInventory,
  findCombatant,
  isCellBlocked,
  nearestFreeCell,
  requireCharacter,
  requireCombatant,
  tokenFor,
  type Combatant,
} from "./state.js";

/** Tools the pure engine executes. The rest (lookup_rule, consult_brain, confirm_speaker) are async services. */
export const ENGINE_TOOLS = [
  "get_party_status",
  "roll_dice",
  "request_player_roll",
  "record_physical_roll",
  "apply_damage",
  "heal",
  "set_temp_hp",
  "add_condition",
  "remove_condition",
  "give_item",
  "remove_item",
  "adjust_gold",
  "split_gold",
  "move_token",
  "spawn_monster",
  "remove_monster",
  "add_npc",
  "set_disposition",
  "adjust_attitude",
  "start_combat",
  "next_turn",
  "end_combat",
  "take_action",
  "change_scene",
  "reveal_area",
  "set_fog",
  "play_effect",
  "set_monster_hidden",
  "set_door",
  "edit_fog",
  "edit_map_feature",
  "edit_walls",
  "drop_loot",
  "pick_up",
  "place_interactable",
  "set_interactable",
  "remove_map_object",
  ...RULES_TOOLS,
] as const satisfies readonly ToolName[];
export type EngineTool = (typeof ENGINE_TOOLS)[number];

export function isEngineTool(name: string): name is EngineTool {
  return (ENGINE_TOOLS as readonly string[]).includes(name);
}

export interface EngineContext {
  rng: Rng;
  /** Template for an SRD monster by name (stats only; id/hp filled by the engine). */
  monsterTemplate: (name: string) => Omit<Monster, "id" | "hp"> | undefined;
  /** SRD spell by name: exact normalised key, unique prefix or unique close misspelling; else undefined. */
  spell: (name: string) => SpellInfo | undefined;
  /** Up to ~5 nearest spell names, for "did you mean …" when spell() finds nothing. */
  spellCandidates: (name: string) => string[];
  /** SRD class table + features by class name (case-insensitive). */
  classData: (className: string) => ClassData | undefined;
  locations: Location[];
  /** The outline's NPCs: add_npc takes an outline NPC's look from here. */
  npcs?: Npc[];
  /** Who called the tool. The host (Board tab, REST) may put tokens on `blocks` features; the DM may not. Default "dm". */
  source?: "dm" | "host";
}

export interface EngineOutcome {
  /** JSON-serialisable result returned to the model. */
  output: unknown;
  rolls: RollResult[];
  /** Monsters created by this call (for async sprite generation). */
  spawned: Monster[];
  sceneChanged?: string;
  /** Visual effects for the table (broadcast as `effect` events, never persisted). */
  effects: BoardEffect[];
  /** Table moments (victory, death, revived, turn_start…), broadcast as `moment` events, never persisted (engine/moments.ts). */
  moments: Moment[];
  /** Loot objects drop_loot created (the service draws their item icons and the loot sack). */
  lootDropped: string[];
  /** pick_up results, broadcast as `pickup` events for the TV toast, never persisted. */
  pickups: Pickup[];
  /** cast_spell: the resolved spell and targets (executeEngineTool turns it into board effects, engine/effects.ts). */
  cast?: SpellCast;
}

export interface SpellCast {
  casterId: string;
  spell: SpellInfo;
  /** Slot level used (0 for a cantrip). */
  castLevel: number;
  effect: SpellEffect;
  targetIds: string[];
  x?: number;
  y?: number;
}

const DEFAULT_GRID = { gridW: 24, gridH: 16, features: [] as MapFeature[], walls: [] as WallSeg[] };

export function currentGrid(state: GameState, ctx: Pick<EngineContext, "locations">) {
  const loc = ctx.locations.find((l) => l.id === state.locationId);
  // Host fixes (state.featureEdits) win over the features read from the map, until it is repainted;
  // wall edits (state.wallEdits: host editor, set_door) win over the detected walls.
  return loc ? { gridW: loc.gridW, gridH: loc.gridH, features: effectiveFeatures(state, loc), walls: effectiveWalls(state, loc) } : DEFAULT_GRID;
}

function combatantName(c: Combatant): string {
  return c.entity.name;
}

function hpLine(c: Combatant) {
  const e = c.entity;
  return { id: e.id, name: e.name, hp: e.hp, maxHp: e.maxHp, conditions: e.conditions };
}

export function partyStatus(state: GameState, ctx: EngineContext) {
  const pos = (id: string) => {
    const t = tokenFor(state, id);
    return t ? [t.x, t.y] : null;
  };
  const current = state.combat.active ? state.combat.order[state.combat.turnIndex] : undefined;
  return {
    location: ctx.locations.find((l) => l.id === state.locationId)?.name ?? null,
    grid: gridStatus(currentGrid(state, ctx)),
    characters: state.characters.map((c) => ({
      id: c.id,
      name: c.name,
      player: c.playerName,
      class: `${c.species} ${c.className} ${c.level}`.trim(),
      hp: `${c.hp}/${c.maxHp}${c.tempHp ? ` +${c.tempHp}tmp` : ""}`,
      ac: c.ac,
      conditions: c.conditions,
      dice: c.diceMode,
      gold: c.gold,
      items: c.inventory.map((i) => (i.qty > 1 ? `${i.name} x${i.qty}` : i.name)),
      pos: pos(c.id),
      ...rulesStatus(c),
    })),
    fog: fogSummary(state),
    monsters: state.monsters.map((m) => ({
      id: m.id,
      unseen: unseenByParty(state, m.id) || undefined,
      hidden: m.hidden || undefined,
      npc: m.npc || undefined,
      ally: m.ally || undefined,
      neutral: m.neutral || undefined,
      out_of_combat: m.combatant === false || m.neutral || undefined,
      follows: m.follows || undefined,
      name: m.name,
      hp: `${m.hp}/${m.maxHp}`,
      ac: m.ac,
      conditions: m.conditions,
      attacks: m.attacks.map((a) => `${a.name}${a.toHit !== undefined ? ` +${a.toHit}` : ""}${a.damage ? ` ${a.damage}` : ""}`),
      pos: pos(m.id),
      attitude: attitudeOf(m).attitude,
      attitude_score: attitudeOf(m).score,
    })),
    combat: state.combat.active
      ? {
          round: state.combat.round,
          current: current?.name,
          order: state.combat.order.map((o) => `${o.name} (${o.initiative})`),
          turn: budgetView(state),
          reactions_used: state.combat.reactionsUsed.map((id) => findCombatant(state, id)?.entity.name ?? id),
        }
      : null,
    map_objects: mapObjectsStatus(state),
  };
}

/** The grid for get_party_status: walls are left out (the map shows them); doors are listed for set_door. */
function gridStatus(g: ReturnType<typeof currentGrid>) {
  const doors = g.walls.filter((w) => w.kind === "door").map((d) => ({ id: d.id, from: [d.x1, d.y1], to: [d.x2, d.y2], open: d.open }));
  return { gridW: g.gridW, gridH: g.gridH, features: g.features, doors: doors.length ? doors : undefined };
}

function fogSummary(state: GameState) {
  const f = state.locationId ? state.fog[state.locationId] : undefined;
  return f?.enabled ? { enabled: true, revealedCells: f.revealed.length } : null;
}

function unseenByParty(state: GameState, entityId: string): boolean {
  const t = tokenFor(state, entityId);
  return !!t && !visibilityOf(state)(t.x, t.y);
}

/**
 * The character's latest roll was an attack roll at `targetId` showing a natural 20, within the last
 * 2 minutes: the damage is critical. (Several attacks rolled before their damage: the DM passes critical.)
 */
function lastAttackWasNat20(state: GameState, characterId: string, targetId: string): boolean {
  const last = [...state.rolls].reverse().find((r) => r.rollerId === characterId);
  return !!last && last.attack && last.targetId === targetId && naturalD20(last.dice) === 20 && Date.now() - last.ts <= 120_000;
}

/** "1d8+3" → "2d8+3": a critical hit rolls the damage dice twice; modifiers once. */
export function doubleDice(notation: string): string {
  return notation.replace(/(\d*)d(\d+)/gi, (_, n: string, sides: string) => `${(parseInt(n || "1", 10) || 1) * 2}d${sides}`);
}

/** apply_damage, and a recorded physical damage roll: HP, the 0-HP rules, the TV hit, the log line. */
function dealDamage(
  state: GameState,
  ctx: EngineContext,
  c: Combatant,
  amount: number,
  o: { damageType?: string; sourceId?: string; attackName?: string; critical?: boolean },
  out: EngineOutcome,
) {
  const notes = applyDamage(state, ctx, c, amount, o.critical ?? false, out);
  if (amount > 0) out.effects.push(damageEffect(state, ctx, { targetId: c.entity.id, damageType: o.damageType, sourceId: o.sourceId, attackName: o.attackName, critical: o.critical }));
  addLog(state, { kind: "system", text: `${c.entity.name} takes ${amount}${o.damageType ? ` ${o.damageType}` : ""} damage (${c.entity.hp}/${c.entity.maxHp})` });
  return { ...hpLine(c), ...notes };
}

/** An attack roll at another known creature: with no DC given it is checked against the target's AC. */
function targetAc(state: GameState, notation: string, targetId: string | undefined, rollerId: string | undefined, label: string): number | undefined {
  if (!isAttackRoll(notation, targetId, label)) return undefined;
  const target = findCombatant(state, targetId!)?.entity;
  const roller = rollerId ? findCombatant(state, rollerId)?.entity : undefined;
  if (!target || target.id === roller?.id) return undefined; // a creature's own save or check
  return target.ac;
}

/** SRD cover: half +2 AC, three-quarters +5 (total cover: the attack can't be made). */
const COVER_BONUS = { half: 2, "three-quarters": 5 } as const;

/**
 * Line of sight and cover for an attack roll between two creatures with tokens on the board (SRD
 * corner-to-corner lines, los.ts). Undefined for theatre of mind: not an attack, no roller, or a
 * token missing / off the board. Other creatures' tokens and `blocks` features count as blockers.
 */
function attackCover(state: GameState, ctx: EngineContext, notation: string, targetId: string | undefined, rollerId: string | undefined, label: string) {
  if (!rollerId || !isAttackRoll(notation, targetId, label)) return undefined;
  const roller = findCombatant(state, rollerId);
  const target = findCombatant(state, targetId!);
  if (!roller || !target || roller.entity.id === target.entity.id) return undefined;
  const a = tokenFor(state, roller.entity.id);
  const b = tokenFor(state, target.entity.id);
  if (!a || !b || a.x < 0 || a.y < 0 || b.x < 0 || b.y < 0) return undefined;
  const grid = currentGrid(state, ctx);
  const dead = new Set(state.monsters.filter((m) => m.conditions.includes("Dead")).map((m) => m.id));
  const blockers = [
    ...state.tokens.filter((t) => t !== a && t !== b && t.x >= 0 && t.y >= 0 && !dead.has(t.entityId)).map((t) => ({ x: t.x, y: t.y })),
    ...grid.features.filter((f) => f.blocks).flatMap((f) => cellsInRect(f.x, f.y, f.w, f.h, grid.gridW, grid.gridH).map((k) => {
      const [x, y] = k.split(",").map(Number);
      return { x: x!, y: y! };
    })),
  ];
  const cover = coverBetween(a, b, grid.walls, blockers);
  const error =
    cover === "total"
      ? `${combatantName(roller)} has no line of sight to ${combatantName(target)}: a wall or closed door blocks it. Choose another target or move first.`
      : undefined;
  const partial = cover === "half" || cover === "three-quarters" ? cover : undefined;
  return { cover, error, partial };
}

/** SRD attack rolls: a natural 20 always hits, a natural 1 always misses; else total vs AC/DC. Checks and saves have no such rule. */
function attackHit(roll: RollResult, dc: number | undefined, notation: string, targetId: string | undefined, label: string): boolean | undefined {
  if (dc === undefined || !isAttackRoll(notation, targetId, label)) return undefined;
  const nat = naturalD20(roll.dice);
  if (nat === 20) return true;
  if (nat === 1) return false;
  return roll.total >= dc;
}

/**
 * Characters follow the SRD 0-HP rules (engine/rules/vitals.ts); a foe at 0 HP is Dead. An ally
 * (a story NPC fighting beside the party) is knocked out instead: Unconscious, still on the board,
 * until healed or the DM removes it.
 */
function applyDamage(state: GameState, ctx: EngineContext, c: Combatant, amount: number, critical: boolean, out: EngineOutcome): DamageNotes {
  if (c.kind === "character") return damageCharacter(state, ctx, c.entity, amount, critical, out);
  const e = c.entity;
  const before = e.hp;
  e.hp = Math.max(0, e.hp - amount);
  const down = e.ally ? "Unconscious" : "Dead";
  if (e.hp === 0 && !e.conditions.includes(down)) e.conditions.push(down);
  if (!e.ally && before > 0 && e.hp === 0) out.moments.push(moment("death", { targetId: e.id, outcome: "monster" }));
  return {};
}

/**
 * Start the current creature's turn: its fresh budget, effects that end now (`ended`: ones that
 * ended with the previous turn), and a downed PC's death save (SRD: "Whenever you start your turn
 * with 0 Hit Points, you must make a Death Saving Throw").
 */
function beginTurn(state: GameState, ctx: EngineContext, out: EngineOutcome, ended: string[] = []) {
  syncTurn(state); // the new creature's fresh budget, before its instruction quotes it
  const cur = state.combat.order[state.combat.turnIndex];
  if (!cur) return {};
  out.moments.push(moment("turn_start", { targetId: cur.entityId }));
  const expired = [...ended, ...expireAtTurnStart(state, cur.entityId), ...expireOrphaned(state)];
  if (expired.length) addLog(state, { kind: "system", text: `Wears off: ${expired.join(", ")}` });
  const pc = state.characters.find((c) => c.id === cur.entityId);
  const deathSave = pc && needsDeathSave(pc) ? rollDeathSave(state, ctx, pc, out) : undefined;
  return { wore_off: expired.length ? expired : undefined, death_save: deathSave };
}

/** leaveInitiative from a handler: when the creature whose turn it was left, the next one's turn starts now. */
function leaveInitiativeAndBegin(state: GameState, ctx: EngineContext, out: EngineOutcome, id: string) {
  const wasCurrent = state.combat.active && state.combat.order[state.combat.turnIndex]?.entityId === id;
  leaveInitiative(state, id);
  if (!wasCurrent || !state.combat.order.length) return undefined;
  const next = state.combat.order[state.combat.turnIndex];
  return { next_turn: next.name, ...beginTurn(state, ctx, out), instruction: dmCreatureTurn(state) ? dmTurnInstruction(dmCreatureTurn(state)!) : undefined };
}

/**
 * Take a creature out of the initiative order, keeping the turn on the same creature: removing an
 * earlier entry shifts it back by one; removing the current creature passes the turn to the next.
 */
function leaveInitiative(state: GameState, id: string) {
  const removedAt = state.combat.order.findIndex((o) => o.entityId === id);
  state.combat.order = state.combat.order.filter((o) => o.entityId !== id);
  if (removedAt >= 0 && removedAt < state.combat.turnIndex) state.combat.turnIndex -= 1;
  if (state.combat.turnIndex >= state.combat.order.length) {
    state.combat.turnIndex = 0;
    if (state.combat.active && state.combat.order.length) state.combat.round += 1; // the last creature left on its turn: a new round
  }
}

/**
 * Put a monster/NPC on a side (set_disposition, adjust_attitude crossing a threshold): sets the
 * ally/neutral/combatant flags and, mid-combat, joins or leaves the initiative order now.
 */
function applyDisposition(state: GameState, ctx: EngineContext, out: EngineOutcome, m: Monster, disposition: Disposition, combatant?: boolean, killDowned = true) {
  m.ally = disposition === "ally";
  m.neutral = disposition === "neutral";
  // A creature turning hostile fights unless told otherwise; an ally keeps its setting.
  if (combatant !== undefined) m.combatant = combatant;
  else if (disposition === "foe") m.combatant = true;
  // A knocked-out ally that is now a foe follows the foe rule: 0 HP is dead. Only the hard flip
  // (set_disposition); a gradual adjust_attitude drift leaves a downed creature Unconscious.
  if (killDowned && disposition === "foe" && m.hp <= 0 && m.conditions.includes("Unconscious")) m.conditions = [...m.conditions.filter((x) => x !== "Unconscious"), "Dead"];
  const fights = !m.neutral && m.combatant !== false && m.hp > 0;
  let initiative: number | undefined;
  let turn: ReturnType<typeof leaveInitiativeAndBegin>;
  if (state.combat.active) {
    const inOrder = state.combat.order.some((o) => o.entityId === m.id);
    if (!fights && inOrder) turn = leaveInitiativeAndBegin(state, ctx, out, m.id);
    if (fights && !inOrder) initiative = joinInitiative(state, ctx, m);
  }
  return { fights, initiative, turn, inCombat: state.combat.active ? fights : undefined };
}

/**
 * set_disposition is the hard override: the attitude follows it. foe -> hostile at most -3;
 * neutral -> indifferent with a stored score clamped into -2..2 (0 when it was only derived);
 * ally -> friendly at least +3.
 */
function syncAttitude(m: Monster, disposition: Disposition) {
  const { score } = attitudeOf(m);
  m.attitude = attitudeForDisposition(disposition);
  if (disposition === "foe") m.attitudeScore = Math.min(score, -3);
  else if (disposition === "ally") m.attitudeScore = Math.max(score, 3);
  else m.attitudeScore = m.attitudeScore === undefined ? 0 : Math.max(-2, Math.min(2, m.attitudeScore));
}

/** Roll initiative for a creature joining a running fight and slot it in; the turn stays put. */
function joinInitiative(state: GameState, ctx: EngineContext, m: Monster): number {
  const initiative = ctx.rng(20) + m.initiativeBonus;
  const order = state.combat.order;
  let at = order.findIndex((o) => o.initiative < initiative);
  if (at < 0) at = order.length;
  order.splice(at, 0, { entityId: m.id, entityType: "monster", name: m.name, initiative });
  if (at <= state.combat.turnIndex && order.length > 1) state.combat.turnIndex += 1;
  return initiative;
}

function placeCharacters(state: GameState, ctx: EngineContext) {
  const grid = currentGrid(state, ctx);
  const { gridW, gridH } = grid;
  state.tokens = state.tokens.filter((t) => t.entityType !== "monster");
  const { x: startX, y: startY } = entryCell(grid);
  for (const c of state.characters) {
    let t = tokenFor(state, c.id);
    const cell = nearestFreeCell(state, startX, startY, gridW, gridH, grid.features);
    if (!t) {
      t = { id: newId("tok"), entityId: c.id, entityType: "character", x: cell.x, y: cell.y, size: 1 };
      state.tokens.push(t);
    } else {
      t.x = -1;
      t.y = -1;
      const free = nearestFreeCell(state, startX, startY, gridW, gridH, grid.features);
      t.x = free.x;
      t.y = free.y;
    }
  }
  for (const m of state.monsters) {
    if (!m.follows) continue;
    const cell = nearestFreeCell(state, startX, startY, gridW, gridH, grid.features);
    state.tokens.push({ id: newId("tok"), entityId: m.id, entityType: "monster", x: cell.x, y: cell.y, size: 1 });
  }
}

/** A free cell next to the party (their centroid), else by the entrance: where a new companion stands. */
function besideParty(state: GameState, grid: ReturnType<typeof currentGrid>) {
  const pcs = state.tokens.filter((t) => t.entityType === "character" && t.x >= 0 && t.y >= 0);
  const at = pcs.length
    ? { x: Math.round(pcs.reduce((s, t) => s + t.x, 0) / pcs.length), y: Math.round(pcs.reduce((s, t) => s + t.y, 0) / pcs.length) }
    : entryCell(grid);
  return nearestFreeCell(state, at.x, at.y, grid.gridW, grid.gridH, grid.features);
}

/** Ensure every character has a token on the current map. */
export function ensureCharacterTokens(state: GameState, ctx: EngineContext) {
  const grid = currentGrid(state, ctx);
  const { gridW, gridH } = grid;
  const entry = entryCell(grid);
  for (const c of state.characters) {
    if (tokenFor(state, c.id)) continue;
    const cell = nearestFreeCell(state, entry.x, entry.y, gridW, gridH, grid.features);
    state.tokens.push({ id: newId("tok"), entityId: c.id, entityType: "character", x: cell.x, y: cell.y, size: 1 });
  }
  state.tokens = state.tokens.filter(
    (t) => state.characters.some((c) => c.id === t.entityId) || state.monsters.some((m) => m.id === t.entityId),
  );
  revealAroundCharacters(state, grid);
}

/**
 * After the current location's map is (re)painted and read, positions on the old picture are
 * meaningless: move the party to the entrance, monsters to the focal feature, and redraw the fog
 * (party light + lit features). Returns a new state, or the same one during combat / with no scene.
 * `keepFog` (a first paint: there was no old picture) keeps the explored and hidden cells.
 */
export function restageForMap(state: GameState, ctx: EngineContext, opts: { keepFog?: boolean } = {}): GameState {
  if (!state.locationId || state.combat.active) return state;
  const next = structuredClone(state);
  const grid = currentGrid(next, ctx);
  const entry = entryCell(grid);
  for (const t of next.tokens) t.x = t.y = -1;
  // The party first (at the entrance), then the monsters laid out like a fresh spawn around the
  // focal feature: off blocking cells, 3+ cells from the party when there is room, facing it.
  // NPCs travelling with the party stand with it.
  const follows = new Set(next.monsters.filter((m) => m.follows).map((m) => m.id));
  const withParty = next.tokens.filter((t) => t.entityType === "character" || follows.has(t.entityId));
  for (const t of withParty) {
    const cell = nearestFreeCell(next, entry.x, entry.y, grid.gridW, grid.gridH, grid.features);
    t.x = cell.x;
    t.y = cell.y;
  }
  const monTokens = next.tokens.filter((t) => !withParty.includes(t));
  const cells = planSpawn(next, grid, monTokens.length);
  monTokens.forEach((t, i) => {
    t.x = cells[i].x;
    t.y = cells[i].y;
  });
  const fog = next.fog?.[next.locationId!];
  if (fog && !opts.keepFog) {
    fog.revealed = [];
    fog.hidden = []; // a new picture: the host's hidden cells no longer mean anything
  }
  revealAroundCharacters(next, grid);
  next.version += 1;
  return next;
}

/**
 * A location's map was (re)painted: host feature fixes and fog painting were made for the old
 * picture, so drop that location's feature edit, a wall edit holding only DM door states (host wall
 * fixes are kept), and its explored + hidden fog cells. If the party is
 * there, its own light is revealed again. Returns a new state (the input is not modified).
 */
export function resetForRepaint(state: GameState, ctx: EngineContext, locationId: string): GameState {
  const next = structuredClone(state);
  if (next.featureEdits) delete next.featureEdits[locationId];
  // Door states the DM set (set_door) belong to the old picture; host wall fixes are kept.
  if (next.wallEdits?.[locationId] && next.wallEdits[locationId]!.host === false) delete next.wallEdits[locationId];
  const fog = next.fog?.[locationId];
  if (fog) {
    fog.revealed = [];
    fog.hidden = [];
  }
  if (next.locationId === locationId) revealAroundCharacters(next, currentGrid(next, ctx));
  next.version += 1;
  return next;
}

/**
 * A location's first map read found walls: cells explored on the blank grid were lit straight
 * through walls nobody knew about yet, so drop the explored cells (the host's hidden cells stay)
 * and, if the party is there, reveal its light again, this time stopped by the walls. Returns a
 * new state (the input is not modified).
 */
export function refogForWalls(state: GameState, ctx: EngineContext, locationId: string): GameState {
  const fog = state.fog?.[locationId];
  if (!fog || fog.revealed.length === 0) return state;
  const next = structuredClone(state);
  next.fog[locationId]!.revealed = [];
  if (next.locationId === locationId) revealAroundCharacters(next, currentGrid(next, ctx));
  next.version += 1;
  return next;
}

type Handler<N extends EngineTool> = (state: GameState, args: ToolArgsOf<N>, ctx: EngineContext, out: EngineOutcome) => unknown;

const handlers: { [N in EngineTool]: Handler<N> } = {
  get_party_status: (state, _a, ctx) => partyStatus(state, ctx),

  roll_dice: (state, a, ctx, out) => {
    let rollerName = "DM";
    if (a.roller_id) {
      const roller = findCombatant(state, a.roller_id);
      if (!roller) return { error: `Unknown roller "${a.roller_id}" (removed or misspelled). Call get_party_status for current ids.` };
      rollerName = combatantName(roller);
    }
    // Walls: no line of sight means no attack (even with an explicit dc); cover raises the AC.
    const los = attackCover(state, ctx, a.notation, a.target_id, a.roller_id, a.label);
    if (los?.error) return { error: los.error };
    const baseAc = a.dc === undefined ? targetAc(state, a.notation, a.target_id, a.roller_id, a.label) : undefined;
    const cover = baseAc !== undefined ? los?.partial : undefined;
    const vsAc = baseAc !== undefined ? baseAc + (cover ? COVER_BONUS[cover] : 0) : undefined;
    // A secret attack keeps its hit/miss off the table: only the DM's output says it.
    const roll = makeRoll(state, ctx, a.notation, a.label, {
      rollerId: a.roller_id,
      rollerName,
      secret: a.secret,
      dc: a.dc ?? (a.secret ? undefined : vsAc),
      attack: isAttackRoll(a.notation, a.target_id, a.label),
      targetId: a.target_id,
      cover,
    });
    const hit = attackHit(roll, a.dc ?? vsAc, a.notation, a.target_id, a.label);
    if (roll.dc !== undefined && hit !== undefined) roll.success = hit;
    out.rolls.push(roll);
    attackOrRollEffects(state, ctx, roll, a.target_id, a.attack_name, out);
    return { ...rollSummary(roll), vs_ac: vsAc, cover, cover_bonus: cover ? COVER_BONUS[cover] : undefined, hit: a.secret ? hit : undefined };
  },

  request_player_roll: (state, a, ctx, out) => {
    const c = requireCharacter(state, a.character_id);
    const damage = a.kind === "damage";
    // Attacks (not damage, saves or checks): no line of sight is refused, cover raises the AC.
    const los = damage ? undefined : attackCover(state, ctx, a.notation, a.target_id, c.id, a.label);
    if (los?.error) return { error: los.error };
    const baseAc = a.dc === undefined && !damage ? targetAc(state, a.notation, a.target_id, c.id, a.label) : undefined;
    const cover = baseAc !== undefined ? los?.partial : undefined;
    const vsAc = baseAc !== undefined ? baseAc + (cover ? COVER_BONUS[cover] : 0) : undefined;
    const coverOut = cover ? { cover, cover_bonus: COVER_BONUS[cover] } : {};
    const dc = damage ? undefined : (a.dc ?? vsAc);
    if (c.diceMode === "physical" && damage) {
      if (!a.target_id) throw new Error("A damage roll needs target_id (who was hit).");
      const target = requireCombatant(state, a.target_id);
      const other = state.pendingRoll && state.pendingRoll.kind === "check" && state.pendingRoll.characterId !== c.id ? state.pendingRoll : undefined;
      const replaced =
        replacedPending(state) ??
        (other ? `${state.characters.find((x) => x.id === other.characterId)?.name ?? other.characterId}'s pending ${other.label} roll was replaced; ask for it again afterwards.` : undefined);
      const critical = a.critical ?? (lastAttackWasNat20(state, c.id, target.entity.id) || undefined);
      state.pendingRoll = { characterId: c.id, notation: a.notation, label: a.label, kind: "damage", targetId: target.entity.id, attackName: a.attack_name, critical };
      addLog(state, { kind: "system", text: `${c.name}: roll ${a.notation} damage${critical ? " (critical)" : ""} (physical dice)` });
      return {
        physical: true,
        critical,
        instruction: `${c.playerName} rolls real dice. Ask ${c.name} to roll ${a.notation} damage${critical ? " (critical hit: roll the damage dice twice)" : ""} and say the total; record_physical_roll applies it to ${combatantName(target)}.`,
        replaced,
      };
    }
    if (c.diceMode === "physical") {
      // One pendingRoll slot: replacing an automatic death/concentration save tells the DM to redo it.
      const replaced = replacedPending(state);
      state.pendingRoll = { characterId: c.id, notation: a.notation, label: a.label, dc, kind: "check", targetId: a.target_id, attackName: a.attack_name, cover };
      addLog(state, { kind: "system", text: `${c.name}: roll ${a.notation} for ${a.label} (physical dice)` });
      return {
        physical: true,
        vs_ac: vsAc,
        ...coverOut,
        instruction: `${c.playerName} rolls real dice. Ask ${c.name} to roll ${a.notation} for ${a.label} and tell you the total, then call record_physical_roll.`,
        replaced,
      };
    }
    // A critical damage roll on virtual dice rolls the damage dice twice (SRD Critical Hits).
    const critical = damage ? (a.critical ?? (!!a.target_id && lastAttackWasNat20(state, c.id, a.target_id))) : false;
    const notation = critical ? doubleDice(a.notation) : a.notation;
    const roll = makeRoll(state, ctx, notation, a.label, { rollerId: c.id, rollerName: c.name, dc, attack: !damage && isAttackRoll(a.notation, a.target_id, a.label), targetId: a.target_id, cover });
    const hit = damage ? undefined : attackHit(roll, dc, a.notation, a.target_id, a.label);
    if (hit !== undefined) roll.success = hit;
    out.rolls.push(roll);
    // A damage roll isn't another swing: no attack animation (apply_damage shows the hit).
    attackOrRollEffects(state, ctx, roll, damage ? undefined : a.target_id, a.attack_name, out);
    if (state.pendingRoll?.characterId === c.id) state.pendingRoll = undefined; // another player's prompt stays
    const hint = damage && a.target_id ? `Call apply_damage on ${combatantName(requireCombatant(state, a.target_id))} with ${roll.total}${critical ? ", critical: true" : ""}.` : undefined;
    return { character: c.name, ...rollSummary(roll), vs_ac: vsAc, ...coverOut, critical: critical || undefined, hint };
  },

  record_physical_roll: (state, a, ctx, out) => {
    const c = requireCharacter(state, a.character_id);
    const pending = state.pendingRoll?.characterId === c.id ? state.pendingRoll : undefined;
    // The phone pad / host just answered this character's roll (and told the DM): a DM record right
    // after it, with nothing pending, is that roll again (even if the DM heard another number).
    const last = state.rolls.at(-1);
    if (!pending && ctx.source !== "host" && last?.physical && last.source === "host" && last.rollerId === c.id && Date.now() - last.ts <= 15_000)
      return {
        character: c.name,
        already_recorded: true,
        recorded_total: last.total,
        note: `The host already recorded ${c.name}'s ${last.label || "roll"}: ${last.total}. Nothing was added. For a new roll, call request_player_roll first.`,
      };
    // The pending roll is what the DM asked for: a "check" recorded against a pending death or
    // concentration save is applied as that save.
    const asPending = a.kind === "check" && pending && (pending.kind === "death_save" || pending.kind === "concentration");
    const kind = asPending ? pending.kind : (a.kind ?? pending?.kind ?? "check");
    // A physical damage roll: the total is applied to the creature the DM named when asking.
    if (kind === "damage") {
      const targetId = pending?.kind === "damage" ? pending.targetId : undefined;
      if (!targetId) throw new Error(`No pending damage roll for ${c.name}: call request_player_roll kind "damage" with target_id first, or apply_damage.`);
      const target = findCombatant(state, targetId);
      if (!target) {
        state.pendingRoll = undefined;
        return { error: `The creature ${c.name} hit is gone; the damage roll was dropped.` };
      }
      const total = Math.max(0, a.total); // damage never heals
      const roll: RollResult = { id: newId("roll"), notation: a.notation, label: a.label, rollerId: c.id, rollerName: c.name, dice: [], modifier: 0, total, physical: true, secret: false, source: ctx.source ?? "dm", attack: false, ts: Date.now() };
      addRoll(state, roll);
      out.rolls.push(roll);
      addLog(state, { kind: "roll", speaker: c.name, text: `${c.name} rolled ${a.label}: ${total} (physical)` });
      // Free the slot first: the damage may need it (the target's concentration or death save).
      state.pendingRoll = undefined;
      const critical = a.critical ?? pending?.critical ?? false;
      const hp = dealDamage(state, ctx, target, total, { sourceId: c.id, attackName: pending?.attackName, critical }, out);
      return { character: c.name, damage_applied: total, target: combatantName(target), ...hp };
    }
    // Applied as the pending save: its DC is the one that counts, not a dc passed for the "check".
    const dc = asPending ? pending.dc : (a.dc ?? (pending && pending.kind === kind ? pending.dc : undefined));
    // A spoken natural on a d20 roll becomes the kept d20, so crits and the TV flourish see it.
    const natural = a.natural !== undefined && /d20/i.test(a.notation) ? a.natural : undefined;
    const roll: RollResult = {
      id: newId("roll"),
      notation: a.notation,
      label: a.label,
      rollerId: c.id,
      rollerName: c.name,
      dice: natural !== undefined ? [{ sides: 20, value: natural }] : [],
      modifier: natural !== undefined ? a.total - natural : 0,
      total: a.total,
      physical: true,
      secret: false,
      dc,
      success: dc !== undefined ? a.total >= dc : undefined,
      source: ctx.source ?? "dm",
      // The attack the DM asked for (a pending check at a creature).
      attack: kind === "check" && pending?.kind === "check" && !!pending.targetId && isAttackRoll(a.notation, pending.targetId, a.label),
      targetId: kind === "check" && pending?.kind === "check" ? pending.targetId : undefined,
      // The cover the pending attack's AC was raised for (shown in the roll breakdown).
      cover: kind === "check" && pending?.kind === "check" && dc === pending.dc ? pending.cover : undefined,
      ts: Date.now(),
    };
    // An attack the DM asked for: a spoken natural 20 hits and a natural 1 misses, whatever the total.
    if (kind === "check" && pending?.kind === "check" && pending.targetId) {
      const hit = attackHit(roll, dc, a.notation, pending.targetId, a.label);
      if (hit !== undefined) roll.success = hit;
    }
    const rules = recordAutomaticRoll(state, c, kind, a.total, dc, out);
    addRoll(state, roll);
    out.rolls.push(roll);
    // An attack the DM asked for with a target: animate it now that the total is known.
    if (kind === "check" && pending?.kind === "check" && pending.targetId) {
      const fx = attackRollEffect(state, ctx, roll, pending.targetId, pending.attackName);
      if (fx) out.effects.push(fx);
    }
    // Only clear this character's prompt: another player's pending roll stays, and so does this
    // character's damage roll when the DM records some other check meanwhile.
    const damageWaits = pending?.kind === "damage"; // (a damage record returned above)
    if (!damageWaits && (!state.pendingRoll || state.pendingRoll.characterId === c.id)) state.pendingRoll = undefined;
    addLog(state, { kind: "roll", speaker: c.name, text: `${c.name} rolled ${a.label}: ${a.total} (physical)${coverNote(roll)}` });
    const warning = asPending
      ? `Recorded as ${c.name}'s pending ${kind === "death_save" ? "death save" : "concentration save"}, not a check.`
      : damageWaits
        ? `Recorded as a check. ${c.name}'s damage roll (${pending!.notation}) is still waiting: record it without kind (or kind "damage").`
        : undefined;
    return { character: c.name, total: a.total, natural, success: roll.success, ...rules, warning };
  },

  apply_damage: (state, a, ctx, out) =>
    dealDamage(state, ctx, requireCombatant(state, a.target_id), a.amount, { damageType: a.damage_type, sourceId: a.source_id, attackName: a.attack_name, critical: a.critical }, out),

  heal: (state, a, _ctx, out) => {
    const c = requireCombatant(state, a.target_id);
    // SRD Dead: a dead creature "can't regain them unless it is first revived by magic".
    if (c.kind === "character" && isDead(c.entity))
      return { error: `${c.entity.name} is dead; use revive (Revivify, Raise Dead…) to bring them back.` };
    out.effects.push(effect({ kind: "heal", targetId: c.entity.id }));
    const before = c.entity.hp;
    c.entity.hp = Math.min(c.entity.maxHp, c.entity.hp + a.amount);
    if (c.entity.hp > 0) c.entity.conditions = c.entity.conditions.filter((x) => x !== "Unconscious" && x !== "Dead");
    if (c.kind === "character") afterHealing(state, c.entity, before, out);
    addLog(state, { kind: "system", text: `${c.entity.name} heals ${a.amount} (${c.entity.hp}/${c.entity.maxHp})` });
    return hpLine(c);
  },

  set_temp_hp: (state, a) => {
    const c = requireCharacter(state, a.target_id);
    c.tempHp = Math.max(c.tempHp, a.amount);
    return { name: c.name, tempHp: c.tempHp };
  },

  add_condition: (state, a) => {
    const c = requireCombatant(state, a.target_id);
    const cond = titleCase(a.condition);
    const had = c.entity.conditions.includes(cond);
    if (!had) c.entity.conditions.push(cond);
    const meta = conditionMetaFor(state, c.entity, cond, a);
    // A plain source counts too when a linked one exists (in either order): ending the spell then
    // leaves the condition the ghoul's claws gave.
    const linked = c.entity.conditionMeta.some((x) => x.name.toLowerCase() === cond.toLowerCase());
    if (meta && had && !linked) addConditionMeta(c.entity, { name: cond });
    if (!meta && linked) addConditionMeta(c.entity, { name: cond });
    if (meta) addConditionMeta(c.entity, meta);
    addLog(state, { kind: "system", text: `${c.entity.name} is ${cond}` });
    const ended = c.kind === "character" ? afterCondition(state, c.entity, cond) : undefined;
    return { ...hpLine(c), concentration_ended: ended };
  },

  remove_condition: (state, a) => {
    const c = requireCombatant(state, a.target_id);
    const cond = a.condition.toLowerCase();
    c.entity.conditions = c.entity.conditions.filter((x) => x.toLowerCase() !== cond);
    dropConditionMeta(c.entity, cond);
    return hpLine(c);
  },

  give_item: (state, a) => {
    const c = requireCharacter(state, a.character_id);
    addToInventory(c, { name: a.name, qty: a.qty, description: a.description });
    addLog(state, { kind: "system", text: `${c.name} gains ${a.qty > 1 ? `${a.qty}x ` : ""}${a.name}` });
    return { name: c.name, inventory: c.inventory.map((i) => `${i.name} x${i.qty}`) };
  },

  remove_item: (state, a) => {
    const c = requireCharacter(state, a.character_id);
    const lower = a.name.toLowerCase();
    const item = c.inventory.find((i) => i.name.toLowerCase() === lower) ?? c.inventory.find((i) => i.name.toLowerCase().includes(lower));
    if (!item) throw new Error(`${c.name} has no item named "${a.name}".`);
    item.qty -= a.qty;
    if (item.qty <= 0) c.inventory = c.inventory.filter((i) => i !== item);
    addLog(state, { kind: "system", text: `${c.name} loses ${a.qty > 1 ? `${a.qty}x ` : ""}${item.name}` });
    return { name: c.name, inventory: c.inventory.map((i) => `${i.name} x${i.qty}`) };
  },

  adjust_gold: (state, a) => {
    if (state.monsters.some((m) => m.id === a.character_id)) throw new Error("Only player characters have gold; a monster's loot is an item or a reward to split_gold.");
    const c = requireCharacter(state, a.character_id);
    if (c.gold + a.amount < 0) throw new Error(`${c.name} only has ${c.gold} gp.`);
    c.gold += a.amount;
    addLog(state, { kind: "system", text: `${c.name} ${a.amount >= 0 ? "gains" : "spends"} ${Math.abs(a.amount)} gp` });
    return { name: c.name, gold: c.gold };
  },

  split_gold: (state, a) => {
    const chars = [...new Set(a.character_ids.map((id) => requireCharacter(state, id)))]; // listed twice: one share
    const share = Math.floor(a.total / chars.length);
    const extra = a.total - share * chars.length;
    const got = chars.map((c, i) => {
      const amount = share + (i < extra ? 1 : 0);
      c.gold += amount;
      return { name: c.name, amount, gold: c.gold };
    });
    addLog(state, { kind: "system", text: `${a.total} gp shared: ${got.map((g) => `${g.name} ${g.amount}`).join(", ")}` });
    return { total: a.total, shares: got };
  },

  move_token: (state, a, ctx) => {
    const c = requireCombatant(state, a.entity_id);
    const { gridW, gridH, features, walls } = currentGrid(state, ctx);
    const x = Math.max(0, Math.min(gridW - 1, a.x));
    const y = Math.max(0, Math.min(gridH - 1, a.y));
    let t = tokenFor(state, c.entity.id);
    // Walls: the DM can't walk a token through a wall, closed door or window (straight line from
    // where it stands; no pathfinding). The host is the authority and may; a new token is placed.
    const onBoard = t && t.x >= 0 && t.y >= 0;
    const wallError = `${c.entity.name} can't move there: a wall or closed door is in the way (straight line). Open the door with set_door or move around.`;
    const throughWall = (to: { x: number; y: number }) => ctx.source !== "host" && onBoard && moveBlocked({ x: t!.x, y: t!.y }, to, walls);
    if (throughWall({ x, y })) return { error: wallError };
    if (!t) {
      t = { id: newId("tok"), entityId: c.entity.id, entityType: c.kind, x, y, size: 1 };
      state.tokens.push(t);
    }
    // An occupied cell, or (for the DM) one under furniture (a `blocks` feature): the nearest free
    // cell instead, and the result says why. The host is the authority and may use blocked cells.
    const mover = t;
    const others = state.tokens.filter((o) => o !== mover);
    const occupied = others.some((o) => o.x === x && o.y === y);
    const blocker = ctx.source === "host" ? undefined : features.find((f) => f.blocks && isCellBlocked([f], x, y));
    // The nearest free cell the mover can reach in a straight line (not one across a wall).
    const target = occupied || blocker ? nearestFreeCell({ ...state, tokens: others }, x, y, gridW, gridH, features, (cx, cy) => !throughWall({ x: cx, y: cy })) : { x, y };
    if (throughWall(target)) return { error: wallError };
    t.x = target.x;
    t.y = target.y;
    if (target.x !== x || target.y !== y) {
      const reason = occupied ? "another token is there" : `${blocker!.name} blocks that cell`;
      // Furniture (a lever, a wheel) is used from beside it: say so, or the model keeps retrying
      // cells inside it hunting for a spot "at" the object.
      const beside = blocker && t.x >= blocker.x - 1 && t.x <= blocker.x + blocker.w && t.y >= blocker.y - 1 && t.y <= blocker.y + blocker.h;
      const note = beside
        ? `${c.entity.name} stands beside ${blocker!.name}, close enough to use it. Leave the token there.`
        : `${c.entity.name} is at the nearest open cell. Leave the token there; don't try other cells.`;
      return { name: c.entity.name, pos: [t.x, t.y], redirected: true, reason, note };
    }
    return { name: c.entity.name, pos: [t.x, t.y] };
  },

  spawn_monster: (state, a, ctx, out) => {
    const template = ctx.monsterTemplate(a.name);
    const grid = currentGrid(state, ctx);
    const existing = state.monsters.filter((m) => (m.srdName ?? m.name).toLowerCase().startsWith((template?.name ?? a.name).toLowerCase())).length;
    const cells = planSpawn(state, grid, a.count, { anchor: { x: a.x, y: a.y }, near: a.near, formation: a.formation, fog: a.fog });
    const created: Monster[] = [];
    for (let i = 0; i < a.count; i++) {
      const maxHp = a.hp ?? template?.maxHp ?? 10;
      const baseName = template?.name ?? titleCase(a.name);
      const n = existing + i + 1;
      const m: Monster = {
        id: newId("mon"),
        name: a.count > 1 || existing > 0 ? `${baseName} ${n}` : baseName,
        srdName: template?.name,
        maxHp,
        hp: maxHp,
        ac: a.ac ?? template?.ac ?? 12,
        initiativeBonus: template?.initiativeBonus ?? 0,
        speed: template?.speed ?? 30,
        attacksPerAction: template?.attacksPerAction ?? 1,
        abilities: template?.abilities,
        attacks: template?.attacks ?? [],
        conditions: [],
        cr: template?.cr,
        spriteUrl: sharedSprite(state, baseName),
        npc: false,
        appearance: "",
        ally: false,
        follows: false,
        combatant: true,
        neutral: false,
        conditionMeta: [],
        hidden: a.hidden,
      };
      state.monsters.push(m);
      const cell = cells[i];
      state.tokens.push({ id: newId("tok"), entityId: m.id, entityType: "monster", x: cell.x, y: cell.y, size: 1 });
      created.push(m);
    }
    out.spawned.push(...created);
    addLog(state, { kind: "system", text: `${a.count}x ${template?.name ?? a.name} appear${a.count > 1 ? "" : "s"}${a.hidden ? " (hidden)" : ""}` });
    return {
      spawned: created.map((m) => ({ id: m.id, name: m.name, hp: m.hp, ac: m.ac, attacks: m.attacks.map((x) => x.name) })),
      srdMatch: template ? template.name : null,
      hidden: a.hidden || undefined,
    };
  },

  remove_monster: (state, a, ctx, out) => {
    const c = requireCombatant(state, a.monster_id);
    if (c.kind !== "monster") throw new Error("Only monsters can be removed.");
    state.monsters = state.monsters.filter((m) => m.id !== c.entity.id);
    state.tokens = state.tokens.filter((t) => t.entityId !== c.entity.id);
    const dropped = state.pendingRoll?.targetId === c.entity.id ? state.pendingRoll : undefined;
    if (dropped) state.pendingRoll = undefined; // nothing left to roll against
    const turn = leaveInitiativeAndBegin(state, ctx, out, c.entity.id);
    const who = dropped && (state.characters.find((x) => x.id === dropped.characterId)?.name ?? dropped.characterId);
    return { removed: c.entity.name, dropped_roll: dropped ? `${who}'s pending ${dropped.label} against ${c.entity.name} was cancelled.` : undefined, ...turn };
  },

  set_disposition: (state, a, ctx, out) => {
    const c = requireCombatant(state, a.monster_id);
    if (c.kind !== "monster") throw new Error("Only monsters and NPCs have a disposition; player characters are always the party.");
    const m = c.entity;
    syncAttitude(m, a.disposition);
    const r = applyDisposition(state, ctx, out, m, a.disposition, a.combatant);
    addLog(state, { kind: "system", text: `${m.name} is now ${a.disposition === "foe" ? "a foe" : a.disposition === "ally" ? "an ally" : "neutral"}` });
    return { name: m.name, disposition: a.disposition, combatant: !m.neutral && m.combatant !== false, joined_initiative: r.initiative, in_combat: r.inCombat, ...r.turn };
  },

  adjust_attitude: (state, a, ctx, out) => {
    const c = requireCombatant(state, a.npc_id);
    if (c.kind !== "monster") throw new Error("Only monsters and NPCs have an attitude; player characters are always the party.");
    const m = c.entity;
    const before = attitudeOf(m);
    const score = clampAttitudeScore(before.score + a.delta);
    const attitude = attitudeForScore(score);
    m.attitudeScore = score;
    m.attitude = attitude;
    const changed = attitude !== before.attitude;
    const reason = a.reason.trim();
    let r: ReturnType<typeof applyDisposition> | undefined;
    if (changed) {
      const disposition = dispositionForAttitude(attitude);
      r = applyDisposition(state, ctx, out, m, disposition, undefined, false);
      addLog(state, { kind: "system", text: `${m.name} is now ${formatAttitude(attitude, score)}: ${reason}` });
      out.moments.push(moment("attitude", { targetId: m.id, outcome: attitude }));
    } else {
      const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
      addLog(state, { kind: "system", text: `${m.name}'s attitude ${sign(before.score)} → ${formatAttitude(attitude, score)}: ${reason}` });
    }
    return {
      name: m.name,
      attitude,
      score,
      previous_attitude: before.attitude,
      previous_score: before.score,
      changed,
      disposition: changed ? dispositionForAttitude(attitude) : undefined,
      joined_initiative: r?.initiative,
      in_combat: r?.inCombat,
      ...r?.turn,
    };
  },

  add_npc: (state, a, ctx, out) => {
    const grid = currentGrid(state, ctx);
    const known = ctx.npcs?.find((n) => n.name.toLowerCase() === a.name.trim().toLowerCase());
    const name = known?.name ?? a.name.trim();
    const placed = a.x !== undefined || a.y !== undefined || a.near !== undefined;
    const cell = () => (placed ? planSpawn(state, grid, 1, { anchor: { x: a.x, y: a.y }, near: a.near })[0] : besideParty(state, grid));
    const summary = (m: Monster) => ({ id: m.id, name: m.name, hp: m.hp, ac: m.ac, attacks: m.attacks.map((x) => x.name), follows: m.follows, ally: m.ally });

    // Again for an NPC already here: update it (joins/leaves the party, changes sides, moves).
    const existing = state.monsters.find((m) => m.npc && m.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      // Only what the call gives changes (moving a hostile bodyguard keeps it hostile and fighting).
      if (a.follows !== undefined) existing.follows = a.follows;
      if (a.ally !== undefined) existing.ally = a.ally;
      if (a.combatant !== undefined) existing.combatant = a.combatant;
      if (a.ally) existing.neutral = false;
      if (a.ally !== undefined) syncAttitude(existing, existing.neutral ? "neutral" : existing.ally ? "ally" : "foe");
      if (a.voice?.trim()) existing.voice = a.voice.trim();
      if (state.combat.active) {
        const inOrder = state.combat.order.some((o) => o.entityId === existing.id);
        const fights = existing.combatant !== false && !existing.neutral && existing.hp > 0;
        if (inOrder && !fights) leaveInitiative(state, existing.id);
        if (!inOrder && fights) joinInitiative(state, ctx, existing);
      }
      if (a.appearance?.trim() && a.appearance.trim() !== existing.appearance) {
        existing.appearance = a.appearance.trim();
        existing.spriteUrl = undefined;
        out.spawned.push(existing); // redraw with the new look
      }
      let t = tokenFor(state, existing.id);
      if (!t || placed) {
        const c = cell();
        if (t) Object.assign(t, c);
        else state.tokens.push((t = { id: newId("tok"), entityId: existing.id, entityType: "monster", x: c.x, y: c.y, size: 1 }));
      }
      return { updated: summary(existing), pos: [t.x, t.y] };
    }

    const template = ctx.monsterTemplate(a.stat_block ?? "Commoner");
    const maxHp = template?.maxHp ?? 4;
    const appearance = a.appearance?.trim() || known?.description || "";
    const ally = a.ally ?? true;
    const m: Monster = {
      id: newId("mon"),
      name,
      srdName: template?.name,
      maxHp,
      hp: maxHp,
      ac: template?.ac ?? 10,
      initiativeBonus: template?.initiativeBonus ?? 0,
      speed: template?.speed ?? 30,
      attacksPerAction: template?.attacksPerAction ?? 1,
      abilities: template?.abilities,
      attacks: template?.attacks ?? [],
      conditions: [],
      cr: template?.cr,
      hidden: false,
      npc: true,
      appearance,
      ally,
      follows: a.follows ?? true,
      // Friendly story NPCs stay out of fights unless asked; a hostile one (ally: false) fights.
      combatant: a.combatant ?? a.ally === false,
      neutral: false,
      conditionMeta: [],
      // Its side as a 2024 SRD attitude: an ally is Friendly (+3), a hostile NPC Hostile (-3).
      attitude: ally ? "friendly" : "hostile",
      attitudeScore: ally ? 3 : -3,
      // speak_as_npc direction: the call's, else the outline's, else a generated default.
      // The default hashes the name alone, as speak_as_npc's fallback does: no voice change on placing.
      voice: a.voice?.trim() || known?.voice?.trim() || defaultNpcVoice(name),
    };
    state.monsters.push(m);
    if (state.combat.active && m.combatant) joinInitiative(state, ctx, m);
    const c = cell();
    state.tokens.push({ id: newId("tok"), entityId: m.id, entityType: "monster", x: c.x, y: c.y, size: 1 });
    out.spawned.push(m);
    addLog(state, { kind: "system", text: m.follows ? `${name} joins the party` : `${name} appears` });
    return { added: summary(m), pos: [c.x, c.y], statBlock: template?.name ?? null };
  },

  start_combat: (state, _a, ctx, out) => {
    const order: (InitiativeEntry & { tiebreak: number })[] = [];
    for (const c of state.characters) {
      if (isDead(c)) continue; // downed PCs keep their turn: they make death saves on it
      const dexMod = abilityMod(c.abilities.dex);
      order.push({ entityId: c.id, entityType: "character", name: c.name, initiative: ctx.rng(20) + dexMod, tiebreak: dexMod });
    }
    for (const m of state.monsters) {
      // Hidden monsters (ambushers) roll too: they act; only the table hides them. Story NPCs
      // (combatant false) and neutral creatures stay out until set_disposition brings them in.
      if (m.hp <= 0 || m.combatant === false || m.neutral) continue;
      order.push({ entityId: m.id, entityType: "monster", name: m.name, initiative: ctx.rng(20) + m.initiativeBonus, tiebreak: m.initiativeBonus });
    }
    order.sort((x, y) => y.initiative - x.initiative || y.tiebreak - x.tiebreak);
    state.combat = { active: true, round: 1, turnIndex: 0, order: order.map(({ tiebreak: _t, ...rest }) => rest), turn: null, reactionsUsed: [], announced: [] };
    syncTurn(state); // the first creature's budget, before its instruction quotes it
    for (const c of state.characters) {
      delete c.slotTurn; // a new combat: no slot spent this turn yet
      c.deathSaves.lastRolled = null; // nor a death save
    }
    addLog(state, { kind: "system", text: `Combat! Initiative: ${state.combat.order.map((o) => `${o.name} ${o.initiative}`).join(", ")}` });
    // The first creature starts its turn now: a downed PC makes its death save.
    if (state.combat.order[0]) out.moments.push(moment("turn_start", { targetId: state.combat.order[0].entityId }));
    const firstPc = state.characters.find((c) => c.id === state.combat.order[0]?.entityId);
    const deathSave = firstPc && needsDeathSave(firstPc) ? rollDeathSave(state, ctx, firstPc, out) : undefined;
    const dmTurn = dmCreatureTurn(state);
    return {
      order: state.combat.order.map((o) => `${o.name} (${o.initiative})`),
      first: state.combat.order[0]?.name,
      death_save: deathSave,
      instruction: dmTurn ? dmTurnInstruction(dmTurn) : undefined,
    };
  },

  next_turn: (state, _a, ctx, out) => {
    if (!state.combat.active || state.combat.order.length === 0) throw new Error("Combat is not active.");
    const n = state.combat.order.length;
    const ending = state.combat.order[state.combat.turnIndex]?.entityId;
    const expired = ending ? expireAtTurnEnd(state, ending) : [];
    for (let step = 0; step < n; step++) {
      state.combat.turnIndex = (state.combat.turnIndex + 1) % n;
      if (state.combat.turnIndex === 0) state.combat.round += 1;
      const cur = state.combat.order[state.combat.turnIndex];
      const alive =
        state.characters.find((c) => c.id === cur.entityId && !isDead(c)) ?? state.monsters.find((m) => m.id === cur.entityId && m.hp > 0);
      if (alive) break;
    }
    const cur = state.combat.order[state.combat.turnIndex];
    const { wore_off, death_save: deathSave } = beginTurn(state, ctx, out, expired);
    expired.splice(0, expired.length, ...(wore_off ?? []));
    const dmTurn = dmCreatureTurn(state);
    return {
      round: state.combat.round,
      current: cur.name,
      id: cur.entityId,
      type: cur.entityType,
      ally: dmTurn?.ally || undefined,
      wore_off: expired.length ? expired : undefined,
      death_save: deathSave,
      instruction: dmTurn ? dmTurnInstruction(dmTurn) : undefined,
    };
  },

  end_combat: (state, a, _ctx, out) => {
    // No combat running (a redundant second call): nothing to end, and no banner for an old fight.
    if (!state.combat.active) return { ok: true, outcome: undefined, note: "No combat is running." };
    // The outcome: the DM's, else auto-detected (foes beaten → victory, party down → defeat).
    const outcome = a.outcome ?? (foesBeaten(state) ? "victory" : partyDown(state) ? "defeat" : undefined);
    // No second banner for a victory/defeat already announced during this combat.
    if (outcome && !((state.combat.announced ?? []) as string[]).includes(outcome)) out.moments.push(moment(outcome));
    state.combat = { active: false, round: 0, turnIndex: 0, order: [], turn: null, reactionsUsed: [], announced: [] };
    for (const c of state.characters) {
      delete c.slotTurn;
      c.deathSaves.lastRolled = null;
    }
    // Round-based effects have no turns left to run out on.
    const ended = endTimedConditions(state);
    if (ended.length) addLog(state, { kind: "system", text: `Wears off: ${ended.join(", ")}` });
    addLog(state, { kind: "system", text: outcome ? `Combat ends (${outcome}).` : "Combat ends." });
    return { ok: true, outcome };
  },

  take_action: (state, a, ctx) => takeAction(state, a, ctx),

  change_scene: (state, a, ctx, out) => {
    const loc =
      ctx.locations.find((l) => l.id === a.location_id) ??
      ctx.locations.find((l) => l.name.toLowerCase() === a.location_id.toLowerCase());
    if (!loc) throw new Error(`Unknown location "${a.location_id}". Known: ${ctx.locations.map((l) => `${l.id} (${l.name})`).join(", ")}`);
    state.locationId = loc.id;
    state.monsters = state.monsters.filter((m) => m.follows && (m.hp > 0 || m.ally)); // companions come along (a knocked-out ally is carried)
    state.combat = { active: false, round: 0, turnIndex: 0, order: [], turn: null, reactionsUsed: [], announced: [] };
    // First arrival applies the location's fog setting; later visits keep any set_fog override.
    if (loc.fog && !state.fog?.[loc.id]) fogEntry(state)!.enabled = true;
    placeCharacters(state, ctx);
    out.sceneChanged = loc.id;
    addLog(state, { kind: "system", text: `The party arrives at ${loc.name}.` });
    return { location: loc.name, description: loc.description, grid: [loc.gridW, loc.gridH], fog: !!state.fog?.[loc.id]?.enabled };
  },

  reveal_area: (state, a, ctx) => {
    const { gridW, gridH } = currentGrid(state, ctx);
    if (!state.locationId) throw new Error("No current location.");
    const rect = a.w !== undefined || a.h !== undefined;
    const cells = rect ? cellsInRect(a.x, a.y, a.w ?? 1, a.h ?? 1, gridW, gridH) : cellsInRadius(a.x, a.y, a.radius, gridW, gridH);
    const added = revealCells(state, cells, { explicit: true });
    const fog = fogEntry(state)!;
    return { revealed: added, fogEnabled: fog.enabled, totalRevealed: fog.revealed.length };
  },

  set_fog: (state, a) => {
    const fog = fogEntry(state);
    if (!fog) throw new Error("No current location.");
    if (a.mode === "enable") fog.enabled = true;
    else if (a.mode === "disable") fog.enabled = false;
    else {
      fog.revealed = [];
      fog.hidden = [];
    }
    addLog(state, { kind: "system", text: a.mode === "reset" ? "The map is shrouded again." : `Fog of war ${a.mode}d.` });
    // The party's own light is re-revealed by executeEngineTool right after this handler.
    return { mode: a.mode, enabled: fog.enabled };
  },

  play_effect: (state, a, _ctx, out) => {
    const target = a.target_id ? requireCombatant(state, a.target_id).entity.id : undefined;
    const source = a.source_id ? findCombatant(state, a.source_id)?.entity.id : undefined;
    if (!target && (a.x === undefined || a.y === undefined)) throw new Error("Give target_id or x and y.");
    out.effects.push(effect({ kind: a.kind, targetId: target, sourceId: source, x: a.x, y: a.y, radius: a.radius }));
    return { ok: true };
  },

  set_door: (state, a, ctx) => {
    const locId = a.location ?? state.locationId;
    const loc = locId ? (ctx.locations.find((l) => l.id === locId) ?? ctx.locations.find((l) => l.name.toLowerCase() === locId.toLowerCase())) : undefined;
    if (!loc) throw new Error(a.location ? `Unknown location "${a.location}".` : "No current location.");
    state.wallEdits ??= {};
    const walls = structuredClone(effectiveWalls(state, loc));
    const door = walls.find((w) => w.id === a.door_id && w.kind === "door");
    if (!door) {
      const ids = walls.filter((w) => w.kind === "door").map((w) => w.id);
      throw new Error(`No door "${a.door_id}" at ${loc.name}. Doors: ${ids.length ? ids.join(", ") : "none"}.`);
    }
    door.open = a.open;
    // Only door states: a repaint drops this edit (resetForRepaint) unless the host edited too.
    state.wallEdits[loc.id] = { walls, host: state.wallEdits[loc.id]?.host ?? false };
    addLog(state, { kind: "system", text: `Door ${door.id} ${a.open ? "opened" : "closed"}.` });
    // Opening shows what is beyond it now; closing never re-fogs explored cells.
    const revealed = loc.id === state.locationId ? revealAroundCharacters(state, currentGrid(state, ctx)) : 0;
    return { door: door.id, open: a.open, revealed };
  },
  set_monster_hidden: (state, a) => setMonsterHidden(state, a),
  edit_fog: (state, a, ctx) => editFog(state, a, ctx),
  edit_map_feature: (state, a, ctx) => editMapFeature(state, a, ctx),
  edit_walls: (state, a, ctx) => editWalls(state, a, ctx),
  drop_loot: (state, a, ctx, out) => dropLoot(state, a, ctx, out),
  pick_up: (state, a, ctx, out) => pickUp(state, a, ctx, out),
  place_interactable: (state, a, ctx) => placeInteractable(state, a, ctx),
  set_interactable: (state, a) => setInteractable(state, a),
  remove_map_object: (state, a) => removeMapObject(state, a),
  ...RULES_HANDLERS,
};

/** An attack roll with a known target animates on the target; any other roll keeps the roller's nat-20/1 flash. */
function attackOrRollEffects(state: GameState, ctx: EngineContext, roll: RollResult, targetId: string | undefined, attackName: string | undefined, out: EngineOutcome) {
  const fx = attackRollEffect(state, ctx, roll, targetId, attackName);
  if (fx) out.effects.push(fx);
  else rollEffects(roll, out); // no attack effect (no or unknown target): the roller's nat-20/1 flash; nothing when secret
}

function sharedSprite(state: GameState, baseName: string): string | undefined {
  // A named NPC's portrait is its own, even when it uses a monster's stat block.
  return state.monsters.find((m) => m.spriteUrl && !m.npc && (m.srdName ?? m.name).toLowerCase().startsWith(baseName.toLowerCase()))?.spriteUrl;
}

export function titleCase(s: string): string {
  return s.trim().replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/**
 * Validate args and execute an engine tool against a *mutable copy* of the state.
 * Returns the new state; the input state is not modified.
 */
export function executeEngineTool(
  state: GameState,
  name: EngineTool,
  rawArgs: unknown,
  ctx: EngineContext,
): { state: GameState; outcome: EngineOutcome } {
  const args = ToolArgs[name].parse(rawArgs ?? {});
  const next = structuredClone(state);
  const outcome: EngineOutcome = { output: null, rolls: [], spawned: [], effects: [], moments: [], lootDropped: [], pickups: [] };
  // Combat turn economy (engine/economy.ts): a DM call past the creature's budget is refused
  // without running; otherwise the spend is recorded once the tool succeeded.
  syncTurn(next);
  const gate = economyGate(next, name, args, ctx);
  if (gate?.refusal) outcome.output = gate.refusal;
  else {
    outcome.output = (handlers[name] as Handler<EngineTool>)(next, args as never, ctx, outcome);
    if (gate?.commit && !isErrorOutput(outcome.output)) gate.commit(next);
  }
  syncTurn(next);
  // Victory/defeat banners, once per combat (start_combat/end_combat decide their own).
  if (name !== "start_combat" && name !== "end_combat") announceCombatResult(next, outcome);
  if (outcome.cast) outcome.effects.push(...castEffects(outcome.cast));
  // Fog of war: whatever the tool did (move, scene change, enable), the party sees around itself.
  revealAroundCharacters(next, currentGrid(next, ctx));
  next.version += 1;
  return { state: next, outcome };
}

export type { Character };
