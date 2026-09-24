import {
  abilityMod,
  cellsInRadius,
  cellsInRect,
  visibilityOf,
  type BoardEffect,
  naturalD20,
  rollNotation,
  ToolArgs,
  type Character,
  type GameState,
  type InitiativeEntry,
  type Location,
  type Monster,
  type Rng,
  type RollResult,
  type ToolArgsOf,
  type ToolName,
} from "@dm/shared";
import { newId } from "./ids.js";
import { fogEntry, revealAroundCharacters, revealCells } from "./fog.js";
import {
  addLog,
  addRoll,
  findCombatant,
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
  "move_token",
  "spawn_monster",
  "remove_monster",
  "start_combat",
  "next_turn",
  "end_combat",
  "change_scene",
  "reveal_area",
  "set_fog",
  "play_effect",
] as const satisfies readonly ToolName[];
export type EngineTool = (typeof ENGINE_TOOLS)[number];

export function isEngineTool(name: string): name is EngineTool {
  return (ENGINE_TOOLS as readonly string[]).includes(name);
}

export interface EngineContext {
  rng: Rng;
  /** Template for an SRD monster by name (stats only; id/hp filled by the engine). */
  monsterTemplate: (name: string) => Omit<Monster, "id" | "hp"> | undefined;
  locations: Location[];
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
}

const DEFAULT_GRID = { gridW: 24, gridH: 16 };

function currentGrid(state: GameState, ctx: EngineContext) {
  const loc = ctx.locations.find((l) => l.id === state.locationId);
  return loc ? { gridW: loc.gridW, gridH: loc.gridH } : DEFAULT_GRID;
}

function combatantName(c: Combatant): string {
  return c.entity.name;
}

function hpLine(c: Combatant) {
  const e = c.entity;
  return { id: e.id, name: e.name, hp: e.hp, maxHp: e.maxHp, conditions: e.conditions };
}

function makeRoll(
  state: GameState,
  ctx: EngineContext,
  notation: string,
  label: string,
  opts: { rollerId?: string; rollerName?: string; secret?: boolean; dc?: number } = {},
): RollResult {
  const outcome = rollNotation(notation, ctx.rng);
  const roll: RollResult = {
    id: newId("roll"),
    notation: outcome.notation,
    label,
    rollerId: opts.rollerId,
    rollerName: opts.rollerName ?? "DM",
    dice: outcome.dice,
    modifier: outcome.modifier,
    total: outcome.total,
    physical: false,
    secret: opts.secret ?? false,
    dc: opts.dc,
    success: opts.dc !== undefined ? outcome.total >= opts.dc : undefined,
    ts: Date.now(),
  };
  addRoll(state, roll);
  addLog(state, {
    kind: "roll",
    speaker: roll.rollerName,
    text: `${roll.rollerName} rolled ${label || notation}: ${roll.secret ? "(secret)" : roll.total}`,
  });
  return roll;
}

function effect(e: Omit<BoardEffect, "id" | "ts">): BoardEffect {
  return { id: newId("fx"), ts: Date.now(), ...e };
}

/** A natural 20 or 1 on a visible d20 roll flashes on the roller's token. */
function rollEffects(roll: RollResult, out: EngineOutcome) {
  if (roll.secret || !roll.rollerId) return;
  const nat = naturalD20(roll.dice);
  if (nat === 20) out.effects.push(effect({ kind: "crit", targetId: roll.rollerId }));
  else if (nat === 1) out.effects.push(effect({ kind: "miss", targetId: roll.rollerId }));
}

function rollSummary(roll: RollResult) {
  const nat = naturalD20(roll.dice);
  return {
    total: roll.total,
    dice: roll.dice.map((d) => (d.dropped ? `(${d.value})` : d.value)),
    modifier: roll.modifier,
    natural20: nat === 20 || undefined,
    natural1: nat === 1 || undefined,
    success: roll.success,
  };
}

export function partyStatus(state: GameState, ctx: EngineContext) {
  const pos = (id: string) => {
    const t = tokenFor(state, id);
    return t ? [t.x, t.y] : null;
  };
  const current = state.combat.active ? state.combat.order[state.combat.turnIndex] : undefined;
  return {
    location: ctx.locations.find((l) => l.id === state.locationId)?.name ?? null,
    grid: currentGrid(state, ctx),
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
    })),
    fog: fogSummary(state),
    monsters: state.monsters.map((m) => ({
      id: m.id,
      unseen: unseenByParty(state, m.id) || undefined,
      name: m.name,
      hp: `${m.hp}/${m.maxHp}`,
      ac: m.ac,
      conditions: m.conditions,
      attacks: m.attacks.map((a) => `${a.name}${a.toHit !== undefined ? ` +${a.toHit}` : ""}${a.damage ? ` ${a.damage}` : ""}`),
      pos: pos(m.id),
    })),
    combat: state.combat.active
      ? { round: state.combat.round, current: current?.name, order: state.combat.order.map((o) => `${o.name} (${o.initiative})`) }
      : null,
  };
}

function fogSummary(state: GameState) {
  const f = state.locationId ? state.fog[state.locationId] : undefined;
  return f?.enabled ? { enabled: true, revealedCells: f.revealed.length } : null;
}

function unseenByParty(state: GameState, entityId: string): boolean {
  const t = tokenFor(state, entityId);
  return !!t && !visibilityOf(state)(t.x, t.y);
}

function applyDamage(c: Combatant, amount: number) {
  const e = c.entity;
  let remaining = amount;
  if (c.kind === "character" && c.entity.tempHp > 0) {
    const absorbed = Math.min(c.entity.tempHp, remaining);
    c.entity.tempHp -= absorbed;
    remaining -= absorbed;
  }
  e.hp = Math.max(0, e.hp - remaining);
  if (e.hp === 0) {
    const cond = c.kind === "character" ? "Unconscious" : "Dead";
    if (!e.conditions.includes(cond)) e.conditions.push(cond);
  }
}

function placeCharacters(state: GameState, ctx: EngineContext) {
  const { gridW, gridH } = currentGrid(state, ctx);
  state.tokens = state.tokens.filter((t) => t.entityType !== "monster");
  const startX = 1;
  const startY = Math.floor(gridH / 2);
  for (const c of state.characters) {
    let t = tokenFor(state, c.id);
    const cell = nearestFreeCell(state, startX, startY, gridW, gridH);
    if (!t) {
      t = { id: newId("tok"), entityId: c.id, entityType: "character", x: cell.x, y: cell.y, size: 1 };
      state.tokens.push(t);
    } else {
      t.x = -1;
      t.y = -1;
      const free = nearestFreeCell(state, startX, startY, gridW, gridH);
      t.x = free.x;
      t.y = free.y;
    }
  }
}

/** Ensure every character has a token on the current map. */
export function ensureCharacterTokens(state: GameState, ctx: EngineContext) {
  const { gridW, gridH } = currentGrid(state, ctx);
  for (const c of state.characters) {
    if (tokenFor(state, c.id)) continue;
    const cell = nearestFreeCell(state, 1, Math.floor(gridH / 2), gridW, gridH);
    state.tokens.push({ id: newId("tok"), entityId: c.id, entityType: "character", x: cell.x, y: cell.y, size: 1 });
  }
  state.tokens = state.tokens.filter(
    (t) => state.characters.some((c) => c.id === t.entityId) || state.monsters.some((m) => m.id === t.entityId),
  );  revealAroundCharacters(state, { gridW, gridH });
}

type Handler<N extends EngineTool> = (state: GameState, args: ToolArgsOf<N>, ctx: EngineContext, out: EngineOutcome) => unknown;

const handlers: { [N in EngineTool]: Handler<N> } = {
  get_party_status: (state, _a, ctx) => partyStatus(state, ctx),

  roll_dice: (state, a, ctx, out) => {
    let rollerName = "DM";
    if (a.roller_id) {
      try {
        rollerName = combatantName(requireCombatant(state, a.roller_id));
      } catch {
        rollerName = a.roller_id;
      }
    }
    const roll = makeRoll(state, ctx, a.notation, a.label, {
      rollerId: a.roller_id,
      rollerName,
      secret: a.secret,
      dc: a.dc,
    });
    out.rolls.push(roll);
    rollEffects(roll, out);
    return rollSummary(roll);
  },

  request_player_roll: (state, a, ctx, out) => {
    const c = requireCharacter(state, a.character_id);
    if (c.diceMode === "physical") {
      state.pendingRoll = { characterId: c.id, notation: a.notation, label: a.label, dc: a.dc };
      addLog(state, { kind: "system", text: `${c.name}: roll ${a.notation} for ${a.label} (physical dice)` });
      return {
        physical: true,
        instruction: `${c.playerName} rolls real dice. Ask ${c.name} to roll ${a.notation} for ${a.label} and tell you the total, then call record_physical_roll.`,
      };
    }
    const roll = makeRoll(state, ctx, a.notation, a.label, { rollerId: c.id, rollerName: c.name, dc: a.dc });
    out.rolls.push(roll);
    rollEffects(roll, out);
    state.pendingRoll = undefined;
    return { character: c.name, ...rollSummary(roll) };
  },

  record_physical_roll: (state, a, _ctx, out) => {
    const c = requireCharacter(state, a.character_id);
    const roll: RollResult = {
      id: newId("roll"),
      notation: a.notation,
      label: a.label,
      rollerId: c.id,
      rollerName: c.name,
      dice: [],
      modifier: 0,
      total: a.total,
      physical: true,
      secret: false,
      dc: a.dc,
      success: a.dc !== undefined ? a.total >= a.dc : undefined,
      ts: Date.now(),
    };
    addRoll(state, roll);
    out.rolls.push(roll);
    state.pendingRoll = undefined;
    addLog(state, { kind: "roll", speaker: c.name, text: `${c.name} rolled ${a.label}: ${a.total} (physical)` });
    return { character: c.name, total: a.total, success: roll.success };
  },

  apply_damage: (state, a, _ctx, out) => {
    const c = requireCombatant(state, a.target_id);
    applyDamage(c, a.amount);
    if (a.amount > 0) out.effects.push(effect({ kind: "hit", targetId: c.entity.id, element: a.damage_type?.toLowerCase() }));
    addLog(state, {
      kind: "system",
      text: `${c.entity.name} takes ${a.amount}${a.damage_type ? ` ${a.damage_type}` : ""} damage (${c.entity.hp}/${c.entity.maxHp})`,
    });
    return hpLine(c);
  },

  heal: (state, a, _ctx, out) => {
    const c = requireCombatant(state, a.target_id);
    out.effects.push(effect({ kind: "heal", targetId: c.entity.id }));
    c.entity.hp = Math.min(c.entity.maxHp, c.entity.hp + a.amount);
    if (c.entity.hp > 0) c.entity.conditions = c.entity.conditions.filter((x) => x !== "Unconscious" && x !== "Dead");
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
    if (!c.entity.conditions.includes(cond)) c.entity.conditions.push(cond);
    addLog(state, { kind: "system", text: `${c.entity.name} is ${cond}` });
    return hpLine(c);
  },

  remove_condition: (state, a) => {
    const c = requireCombatant(state, a.target_id);
    const cond = a.condition.toLowerCase();
    c.entity.conditions = c.entity.conditions.filter((x) => x.toLowerCase() !== cond);
    return hpLine(c);
  },

  give_item: (state, a) => {
    const c = requireCharacter(state, a.character_id);
    const existing = c.inventory.find((i) => i.name.toLowerCase() === a.name.toLowerCase());
    if (existing) existing.qty += a.qty;
    else c.inventory.push({ id: newId("item"), name: a.name, qty: a.qty, description: a.description });
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
    const c = requireCharacter(state, a.character_id);
    if (c.gold + a.amount < 0) throw new Error(`${c.name} only has ${c.gold} gp.`);
    c.gold = Math.round((c.gold + a.amount) * 100) / 100;
    addLog(state, { kind: "system", text: `${c.name} ${a.amount >= 0 ? "gains" : "spends"} ${Math.abs(a.amount)} gp` });
    return { name: c.name, gold: c.gold };
  },

  move_token: (state, a, ctx) => {
    const c = requireCombatant(state, a.entity_id);
    const { gridW, gridH } = currentGrid(state, ctx);
    const x = Math.max(0, Math.min(gridW - 1, a.x));
    const y = Math.max(0, Math.min(gridH - 1, a.y));
    let t = tokenFor(state, c.entity.id);
    if (!t) {
      t = { id: newId("tok"), entityId: c.entity.id, entityType: c.kind, x, y, size: 1 };
      state.tokens.push(t);
    }
    const target = state.tokens.some((o) => o !== t && o.x === x && o.y === y) ? nearestFreeCell(state, x, y, gridW, gridH) : { x, y };
    t.x = target.x;
    t.y = target.y;
    return { name: c.entity.name, pos: [t.x, t.y] };
  },

  spawn_monster: (state, a, ctx, out) => {
    const template = ctx.monsterTemplate(a.name);
    const { gridW, gridH } = currentGrid(state, ctx);
    const existing = state.monsters.filter((m) => (m.srdName ?? m.name).toLowerCase().startsWith((template?.name ?? a.name).toLowerCase())).length;
    const baseX = a.x ?? gridW - 3;
    const baseY = a.y ?? Math.floor(gridH / 2);
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
        abilities: template?.abilities,
        attacks: template?.attacks ?? [],
        conditions: [],
        cr: template?.cr,
        spriteUrl: sharedSprite(state, baseName),
        hidden: false,
      };
      state.monsters.push(m);
      const cell = nearestFreeCell(state, baseX, baseY + i, gridW, gridH);
      state.tokens.push({ id: newId("tok"), entityId: m.id, entityType: "monster", x: cell.x, y: cell.y, size: 1 });
      created.push(m);
    }
    out.spawned.push(...created);
    addLog(state, { kind: "system", text: `${a.count}x ${template?.name ?? a.name} appear${a.count > 1 ? "" : "s"}` });
    return {
      spawned: created.map((m) => ({ id: m.id, name: m.name, hp: m.hp, ac: m.ac, attacks: m.attacks.map((x) => x.name) })),
      srdMatch: template ? template.name : null,
    };
  },

  remove_monster: (state, a) => {
    const c = requireCombatant(state, a.monster_id);
    if (c.kind !== "monster") throw new Error("Only monsters can be removed.");
    state.monsters = state.monsters.filter((m) => m.id !== c.entity.id);
    state.tokens = state.tokens.filter((t) => t.entityId !== c.entity.id);
    state.combat.order = state.combat.order.filter((o) => o.entityId !== c.entity.id);
    if (state.combat.turnIndex >= state.combat.order.length) state.combat.turnIndex = 0;
    return { removed: c.entity.name };
  },

  start_combat: (state, _a, ctx) => {
    const order: (InitiativeEntry & { tiebreak: number })[] = [];
    for (const c of state.characters) {
      if (c.hp <= 0) continue;
      const dexMod = abilityMod(c.abilities.dex);
      order.push({ entityId: c.id, entityType: "character", name: c.name, initiative: ctx.rng(20) + dexMod, tiebreak: dexMod });
    }
    for (const m of state.monsters) {
      if (m.hp <= 0 || m.hidden) continue;
      order.push({ entityId: m.id, entityType: "monster", name: m.name, initiative: ctx.rng(20) + m.initiativeBonus, tiebreak: m.initiativeBonus });
    }
    order.sort((x, y) => y.initiative - x.initiative || y.tiebreak - x.tiebreak);
    state.combat = { active: true, round: 1, turnIndex: 0, order: order.map(({ tiebreak: _t, ...rest }) => rest) };
    addLog(state, { kind: "system", text: `Combat! Initiative: ${state.combat.order.map((o) => `${o.name} ${o.initiative}`).join(", ")}` });
    return { order: state.combat.order.map((o) => `${o.name} (${o.initiative})`), first: state.combat.order[0]?.name };
  },

  next_turn: (state) => {
    if (!state.combat.active || state.combat.order.length === 0) throw new Error("Combat is not active.");
    const n = state.combat.order.length;
    for (let step = 0; step < n; step++) {
      state.combat.turnIndex = (state.combat.turnIndex + 1) % n;
      if (state.combat.turnIndex === 0) state.combat.round += 1;
      const cur = state.combat.order[state.combat.turnIndex];
      const alive =
        state.characters.find((c) => c.id === cur.entityId) ?? state.monsters.find((m) => m.id === cur.entityId && m.hp > 0);
      if (alive) break;
    }
    const cur = state.combat.order[state.combat.turnIndex];
    return { round: state.combat.round, current: cur.name, id: cur.entityId, type: cur.entityType };
  },

  end_combat: (state) => {
    state.combat = { active: false, round: 0, turnIndex: 0, order: [] };
    addLog(state, { kind: "system", text: "Combat ends." });
    return { ok: true };
  },

  change_scene: (state, a, ctx, out) => {
    const loc =
      ctx.locations.find((l) => l.id === a.location_id) ??
      ctx.locations.find((l) => l.name.toLowerCase() === a.location_id.toLowerCase());
    if (!loc) throw new Error(`Unknown location "${a.location_id}". Known: ${ctx.locations.map((l) => `${l.id} (${l.name})`).join(", ")}`);
    state.locationId = loc.id;
    state.monsters = [];
    state.combat = { active: false, round: 0, turnIndex: 0, order: [] };
    placeCharacters(state, ctx);
    out.sceneChanged = loc.id;
    addLog(state, { kind: "system", text: `The party arrives at ${loc.name}.` });
    return { location: loc.name, description: loc.description, grid: [loc.gridW, loc.gridH] };
  },

  reveal_area: (state, a, ctx) => {
    const { gridW, gridH } = currentGrid(state, ctx);
    if (!state.locationId) throw new Error("No current location.");
    const rect = a.w !== undefined || a.h !== undefined;
    const cells = rect ? cellsInRect(a.x, a.y, a.w ?? 1, a.h ?? 1, gridW, gridH) : cellsInRadius(a.x, a.y, a.radius, gridW, gridH);
    const added = revealCells(state, cells);
    const fog = fogEntry(state)!;
    return { revealed: added, fogEnabled: fog.enabled, totalRevealed: fog.revealed.length };
  },

  set_fog: (state, a) => {
    const fog = fogEntry(state);
    if (!fog) throw new Error("No current location.");
    if (a.mode === "enable") fog.enabled = true;
    else if (a.mode === "disable") fog.enabled = false;
    else fog.revealed = [];
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
};

function sharedSprite(state: GameState, baseName: string): string | undefined {
  return state.monsters.find((m) => m.spriteUrl && (m.srdName ?? m.name).toLowerCase().startsWith(baseName.toLowerCase()))?.spriteUrl;
}

function titleCase(s: string): string {
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
  const outcome: EngineOutcome = { output: null, rolls: [], spawned: [], effects: [] };
  outcome.output = (handlers[name] as Handler<EngineTool>)(next, args as never, ctx, outcome);
  // Fog of war: whatever the tool did (move, scene change, enable), the party sees around itself.
  revealAroundCharacters(next, currentGrid(next, ctx));
  next.version += 1;
  return { state: next, outcome };
}

export type { Character };
