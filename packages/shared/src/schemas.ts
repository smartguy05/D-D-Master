import { z } from "zod";

/** Ability scores, standard 5e abbreviations. */
export const Abilities = z.object({
  str: z.number().int().min(1).max(30),
  dex: z.number().int().min(1).max(30),
  con: z.number().int().min(1).max(30),
  int: z.number().int().min(1).max(30),
  wis: z.number().int().min(1).max(30),
  cha: z.number().int().min(1).max(30),
});
export type Abilities = z.infer<typeof Abilities>;
export type AbilityKey = keyof Abilities;

export const DEFAULT_ABILITIES: Abilities = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };

export const Item = z.object({
  id: z.string(),
  name: z.string(),
  qty: z.number().int().min(0).default(1),
  description: z.string().optional(),
  equipped: z.boolean().optional(),
});
export type Item = z.infer<typeof Item>;

/** How a player prefers to roll their dice. */
export const DiceMode = z.enum(["virtual", "physical"]);
export type DiceMode = z.infer<typeof DiceMode>;

export const Attack = z.object({
  name: z.string(),
  toHit: z.number().int().optional(),
  damage: z.string().optional(),
  description: z.string().optional(),
});
export type Attack = z.infer<typeof Attack>;

export const Character = z.object({
  id: z.string(),
  playerName: z.string(),
  name: z.string(),
  species: z.string().default(""),
  className: z.string().default(""),
  level: z.number().int().min(1).max(20).default(1),
  background: z.string().default(""),
  abilities: Abilities.default(DEFAULT_ABILITIES),
  maxHp: z.number().int().min(1),
  hp: z.number().int(),
  tempHp: z.number().int().min(0).default(0),
  ac: z.number().int().min(0).default(10),
  speed: z.number().int().min(0).default(30),
  proficiencyBonus: z.number().int().default(2),
  skills: z.array(z.string()).default([]),
  savingThrows: z.array(z.string()).default([]),
  attacks: z.array(Attack).default([]),
  spells: z.array(z.string()).default([]),
  features: z.array(z.string()).default([]),
  conditions: z.array(z.string()).default([]),
  inventory: z.array(Item).default([]),
  gold: z.number().min(0).default(0),
  notes: z.string().default(""),
  appearance: z.string().default(""),
  spriteUrl: z.string().optional(),
  diceMode: DiceMode.default("virtual"),
  color: z.string().default("#c9a227"),
  /** Light/vision radius in grid cells for fog of war; unset means DEFAULT_LIGHT_RADIUS (a torch). */
  lightRadius: z.number().int().min(0).max(30).optional(),
});
export type Character = z.infer<typeof Character>;

export const Monster = z.object({
  id: z.string(),
  name: z.string(),
  /** SRD stat block name this monster was built from, if any. */
  srdName: z.string().optional(),
  maxHp: z.number().int().min(1),
  hp: z.number().int(),
  ac: z.number().int().min(0).default(10),
  initiativeBonus: z.number().int().default(0),
  abilities: Abilities.optional(),
  attacks: z.array(Attack).default([]),
  conditions: z.array(z.string()).default([]),
  cr: z.string().optional(),
  spriteUrl: z.string().optional(),
  hidden: z.boolean().default(false),
});
export type Monster = z.infer<typeof Monster>;

export const EntityType = z.enum(["character", "monster", "npc"]);
export type EntityType = z.infer<typeof EntityType>;

export const Token = z.object({
  id: z.string(),
  entityId: z.string(),
  entityType: EntityType,
  x: z.number().int(),
  y: z.number().int(),
  /** Size in grid cells (1 = medium, 2 = large...). */
  size: z.number().int().min(1).max(4).default(1),
});
export type Token = z.infer<typeof Token>;

export const InitiativeEntry = z.object({
  entityId: z.string(),
  entityType: EntityType,
  name: z.string(),
  initiative: z.number().int(),
});
export type InitiativeEntry = z.infer<typeof InitiativeEntry>;

export const Combat = z.object({
  active: z.boolean().default(false),
  round: z.number().int().default(0),
  turnIndex: z.number().int().default(0),
  order: z.array(InitiativeEntry).default([]),
});
export type Combat = z.infer<typeof Combat>;

export const DieRoll = z.object({
  sides: z.number().int(),
  value: z.number().int(),
  /** Dropped by keep-highest/lowest (advantage/disadvantage). */
  dropped: z.boolean().optional(),
});
export type DieRoll = z.infer<typeof DieRoll>;

export const RollResult = z.object({
  id: z.string(),
  notation: z.string(),
  label: z.string().default(""),
  rollerId: z.string().optional(),
  rollerName: z.string().default("DM"),
  dice: z.array(DieRoll),
  modifier: z.number().int(),
  total: z.number().int(),
  physical: z.boolean().default(false),
  secret: z.boolean().default(false),
  dc: z.number().int().optional(),
  success: z.boolean().optional(),
  ts: z.number(),
});
export type RollResult = z.infer<typeof RollResult>;

export const LogEntry = z.object({
  id: z.string(),
  ts: z.number(),
  kind: z.enum(["dm", "player", "system", "roll", "tool"]),
  speaker: z.string().optional(),
  text: z.string(),
});
export type LogEntry = z.infer<typeof LogEntry>;

export const Location = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(""),
  mapPrompt: z.string().default(""),
  mapUrl: z.string().optional(),
  gridW: z.number().int().min(4).max(60).default(24),
  gridH: z.number().int().min(4).max(60).default(16),
});
export type Location = z.infer<typeof Location>;

export const Npc = z.object({
  name: z.string(),
  description: z.string().default(""),
  motive: z.string().default(""),
});
export type Npc = z.infer<typeof Npc>;

export const Encounter = z.object({
  id: z.string(),
  locationId: z.string(),
  description: z.string().default(""),
  monsters: z.array(z.object({ name: z.string(), count: z.number().int().min(1).default(1) })).default([]),
});
export type Encounter = z.infer<typeof Encounter>;

export const Outline = z.object({
  title: z.string(),
  hook: z.string().default(""),
  acts: z.array(z.object({ title: z.string(), summary: z.string() })).default([]),
  locations: z.array(Location).default([]),
  npcs: z.array(Npc).default([]),
  encounters: z.array(Encounter).default([]),
});
export type Outline = z.infer<typeof Outline>;

export const Player = z.object({
  id: z.string(),
  name: z.string(),
  characterId: z.string().optional(),
  /** Number of voice samples in this player's voiceprint. 0 = not enrolled. */
  voiceSamples: z.number().int().default(0),
});
export type Player = z.infer<typeof Player>;

export const Campaign = z.object({
  id: z.string(),
  name: z.string(),
  premise: z.string().default(""),
  partyLevel: z.number().int().min(1).max(20).default(1),
  outline: Outline.optional(),
  sessionSummaries: z.array(z.object({ ts: z.number(), summary: z.string() })).default([]),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Campaign = z.infer<typeof Campaign>;

export const ActiveSpeaker = z.object({
  playerId: z.string(),
  playerName: z.string(),
  characterName: z.string().optional(),
  confidence: z.number(),
  ts: z.number(),
});
export type ActiveSpeaker = z.infer<typeof ActiveSpeaker>;

/** Fog of war for one location: which cells ("x,y") the party has seen. */
export const LocationFog = z.object({
  enabled: z.boolean().default(false),
  revealed: z.array(z.string()).default([]),
});
export type LocationFog = z.infer<typeof LocationFog>;

/** Default light/vision radius in cells (torchlight: 20 ft bright + 20 ft dim, rounded up). */
export const DEFAULT_LIGHT_RADIUS = 6;

/** Visual board effects the table can play (see events.ts `effect`). */
export const EffectKind = z.enum([
  "hit",
  "crit",
  "miss",
  "heal",
  "slash",
  "fireball",
  "lightning",
  "frost",
  "poison",
  "radiant",
  "necrotic",
  "thunder",
  "arcane",
]);
export type EffectKind = z.infer<typeof EffectKind>;

export const BoardEffect = z.object({
  id: z.string(),
  kind: EffectKind,
  /** Entity the effect lands on (its token position is used). */
  targetId: z.string().optional(),
  /** Entity the effect comes from (bolts travel from source to target). */
  sourceId: z.string().optional(),
  /** Target cell when there is no target entity. */
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  /** Area radius in cells (fireball etc.). */
  radius: z.number().min(0).max(20).optional(),
  /** Damage type, e.g. "fire", used to tint hits. */
  element: z.string().optional(),
  ts: z.number(),
});
export type BoardEffect = z.infer<typeof BoardEffect>;

/** The authoritative, server-owned game state for a campaign. */
export const GameState = z.object({
  campaignId: z.string(),
  locationId: z.string().optional(),
  players: z.array(Player).default([]),
  characters: z.array(Character).default([]),
  monsters: z.array(Monster).default([]),
  tokens: z.array(Token).default([]),
  combat: Combat.default({}),
  rolls: z.array(RollResult).default([]),
  log: z.array(LogEntry).default([]),
  activeSpeaker: ActiveSpeaker.optional(),
  pendingRoll: z
    .object({ characterId: z.string(), notation: z.string(), label: z.string(), dc: z.number().int().optional() })
    .optional(),
  /** Fog of war per location id. Missing entry = fog off for that location. */
  fog: z.record(z.string(), LocationFog).default({}),
  version: z.number().int().default(0),
});
export type GameState = z.infer<typeof GameState>;

export function emptyGameState(campaignId: string): GameState {
  return GameState.parse({ campaignId });
}

export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function formatMod(mod: number): string {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}
