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

/** A pool of spell slots of one level (`used` of `max` spent). */
export const SlotPool = z.object({
  level: z.number().int().min(1).max(9),
  max: z.number().int().min(0),
  used: z.number().int().min(0).default(0),
});
export type SlotPool = z.infer<typeof SlotPool>;

/** Hit Point Dice: `max` = character level (0 = not derived yet, see deriveClassResources). */
export const HitDice = z.object({
  die: z.number().int().min(1).default(8),
  max: z.number().int().min(0).default(0),
  used: z.number().int().min(0).default(0),
});
export type HitDice = z.infer<typeof HitDice>;

/** Death Saving Throws while at 0 HP. */
/**
 * Why a condition is there, when it came from a spell or has a duration: ending the caster's
 * concentration, the duration running out or a long rest removes it (engine/rules/conditions.ts).
 */
export const ConditionMeta = z.object({
  name: z.string(),
  casterId: z.string().optional(),
  spell: z.string().optional(),
  until: z
    .object({
      kind: z.enum(["concentration", "rounds", "end_of_turn"]),
      /** rounds: expires at the start of `entityId`'s turn in this round. */
      round: z.number().int().optional(),
      entityId: z.string().optional(),
    })
    .optional(),
});
export type ConditionMeta = z.infer<typeof ConditionMeta>;

export const DeathSaves = z.object({
  successes: z.number().int().min(0).max(3).default(0),
  failures: z.number().int().min(0).max(3).default(0),
  stable: z.boolean().default(false),
  /** Whose turn (round + entity) the last death save was rolled on: one per turn in combat. */
  lastRolled: z.object({ round: z.number().int(), entityId: z.string() }).nullable().default(null),
});
export type DeathSaves = z.infer<typeof DeathSaves>;

/** A limited-use class feature (Rage, Channel Divinity, Ki...). See `resourcesFor` in rules-data. */
export const CharacterResource = z.object({
  name: z.string(),
  max: z.number().int().min(0),
  used: z.number().int().min(0).default(0),
  resetOn: z.enum(["short", "long"]).default("long"),
  shortRestRegain: z.number().int().min(0).optional(),
  note: z.string().optional(),
});
export type CharacterResource = z.infer<typeof CharacterResource>;

export const Concentration = z.object({ spell: z.string(), since: z.number() });
export type Concentration = z.infer<typeof Concentration>;

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
  conditionMeta: z.array(ConditionMeta).default([]),
  inventory: z.array(Item).default([]),
  gold: z.number().min(0).default(0),
  notes: z.string().default(""),
  appearance: z.string().default(""),
  spriteUrl: z.string().optional(),
  diceMode: DiceMode.default("virtual"),
  color: z.string().default("#c9a227"),
  /** Light/vision radius in grid cells for fog of war; unset means DEFAULT_LIGHT_RADIUS (a torch). */
  lightRadius: z.number().int().min(0).max(30).optional(),
  // ---- rules engine (engine/rules); all defaulted so older saves still load ----
  subclass: z.string().default(""),
  spellSlots: z.array(SlotPool).default([]),
  /** Warlock Pact Magic slots (all of one level; recover on a Short Rest). */
  pactSlots: SlotPool.optional(),
  hitDice: HitDice.default({}),
  deathSaves: DeathSaves.default({}),
  concentration: Concentration.nullable().default(null),
  resources: z.array(CharacterResource).default([]),
  /** Combat round and turn index in which this character last spent a spell slot (one per turn). */
  slotTurn: z.object({ round: z.number().int(), turn: z.number().int() }).optional(),
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
  /** Walking Speed in feet (SRD stat block). */
  speed: z.number().int().min(0).default(30),
  /** Attacks per Attack action (Multiattack "makes two ... attacks"). */
  attacksPerAction: z.number().int().min(1).default(1),
  abilities: Abilities.optional(),
  attacks: z.array(Attack).default([]),
  conditions: z.array(z.string()).default([]),
  conditionMeta: z.array(ConditionMeta).default([]),
  cr: z.string().optional(),
  spriteUrl: z.string().optional(),
  hidden: z.boolean().default(false),
  /**
   * A named NPC on the map (add_npc), not a stat-block monster: its sprite is drawn from its own
   * name + `appearance` instead of being shared by every monster of the same kind.
   */
  npc: z.boolean().default(false),
  appearance: z.string().default(""),
  /** On the party's side (a friendly NPC): a green token; the DM plays its combat turns. */
  ally: z.boolean().default(false),
  /** Travels with the party: kept and placed next to them by change_scene and map restaging. */
  follows: z.boolean().default(false),
  /** Rolls initiative in start_combat. Story NPCs (add_npc) default to false: the DM opts them in. */
  combatant: z.boolean().default(true),
  /** Neither friend nor foe: stays out of initiative and out of both TV lists (set_disposition). */
  neutral: z.boolean().default(false),
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

/**
 * What the creature whose turn it is has spent (engine/economy.ts). Rebuilt whenever the turn passes
 * to another creature or a new round starts; `speed` is refreshed from the creature on every tool call.
 */
export const TurnBudget = z.object({
  entityId: z.string(),
  round: z.number().int(),
  /** Feet: current Speed (0 when Grappled, Restrained...). */
  speed: z.number().int().min(0).default(30),
  movementUsed: z.number().int().min(0).default(0),
  /** Feet added by Dash (once per Dash taken). */
  extraMovement: z.number().int().min(0).default(0),
  action: z.boolean().default(false),
  bonusAction: z.boolean().default(false),
  /** Attacks made with the Attack action (Extra Attack / Multiattack allow more than one). */
  attacksUsed: z.number().int().min(0).default(0),
  attacksPerAction: z.number().int().min(1).default(1),
  disengaged: z.boolean().default(false),
  dodging: z.boolean().default(false),
  /** Attack rolls left from an attack spell cast this turn (one per ray/beam): they cost nothing more. */
  spellAttacks: z.number().int().min(0).default(0),
  /** The spell those attack rolls belong to (matched against attack_name/label). */
  spellAttackSpell: z.string().default(""),
});
export type TurnBudget = z.infer<typeof TurnBudget>;

export const Combat = z.object({
  active: z.boolean().default(false),
  round: z.number().int().default(0),
  turnIndex: z.number().int().default(0),
  order: z.array(InitiativeEntry).default([]),
  /** The current creature's turn budget (null out of combat). */
  turn: TurnBudget.nullable().default(null),
  /** Creatures that used their Reaction since the start of their last turn. */
  reactionsUsed: z.array(z.string()).default([]),
  /** Victory/defeat moments already shown this combat (once-per-combat guard; reset with each new Combat). */
  announced: z.array(z.enum(["victory", "defeat"])).default([]),
});
export type Combat = z.infer<typeof Combat>;

export const MomentKind = z.enum(["victory", "defeat", "fled", "death", "revived", "campaign_end", "turn_start"]);
export type MomentKind = z.infer<typeof MomentKind>;

/**
 * A big table moment (victory banner, a death, someone back up, a turn banner, the campaign's end).
 * Transient: broadcast as a `moment` event, never stored in GameState or the snapshot.
 * outcome: death of a monster = "monster"; revived from 0 HP (not Dead) = "rallied";
 * campaign_end = "success" | "failure". text: campaign_end's epilogue.
 */
export const Moment = z.object({
  id: z.string(),
  kind: MomentKind,
  targetId: z.string().optional(),
  outcome: z.enum(["monster", "rallied", "success", "failure"]).optional(),
  text: z.string().optional(),
  ts: z.number(),
});
export type Moment = z.infer<typeof Moment>;

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
  /** Who recorded it: "host" for the phone pad, Play tab or REST; "dm" for the voice DM. */
  source: z.enum(["dm", "host"]).default("dm"),
  /** An attack roll at a creature (a natural 20 makes the damage that follows critical). */
  attack: z.boolean().default(false),
  /** The creature an attack roll targeted (critical inference matches it to the damage target). */
  targetId: z.string().optional(),
  /** Attack rolls: cover the target had (its AC was raised by 2 / 5 for the roll). Optional: old saves load. */
  cover: z.enum(["half", "three-quarters"]).optional(),
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

/**
 * A landmark read off a painted map, in grid cells (x=0 left, y=0 top). `entrance` is where the
 * party arrives, `focal` the main feature/lair (default monster spawn), `lit` ones glow through fog,
 * `blocks` ones (furniture, pillars, walls) are solid: tokens should not stand on them.
 */
export const MapFeature = z.object({
  name: z.string(),
  kind: z.enum(["entrance", "exit", "focal", "feature"]).default("feature"),
  lit: z.boolean().default(false),
  blocks: z.boolean().default(false),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1).default(1),
  h: z.number().int().min(1).default(1),
});
export type MapFeature = z.infer<typeof MapFeature>;

/**
 * A wall, door or window on the map grid. Coordinates are grid-line intersections in cell units
 * (0..gridW, 0..gridH); a segment is axis-aligned and lies along cell edges. Walls block sight and
 * movement, closed doors both, open doors neither, windows movement only (see los.ts).
 */
export const WallSeg = z.object({
  id: z.string(),
  x1: z.number().int().min(0),
  y1: z.number().int().min(0),
  x2: z.number().int().min(0),
  y2: z.number().int().min(0),
  kind: z.enum(["wall", "door", "window"]).default("wall"),
  /** Doors only: open doors let sight and movement through. */
  open: z.boolean().default(false),
});
export type WallSeg = z.infer<typeof WallSeg>;

export const Location = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(""),
  mapPrompt: z.string().default(""),
  mapUrl: z.string().optional(),
  /** Read from the painted map (server-owned, like `mapUrl`). Empty until a map is read. */
  features: z.array(MapFeature).default([]),
  /** Walls, doors and windows read from the painted map (server-owned). Empty until a map is read. */
  walls: z.array(WallSeg).default([]),
  gridW: z.number().int().min(4).max(60).default(24),
  gridH: z.number().int().min(4).max(60).default(16),
  /** Fog of war is switched on when the party first arrives (false for shops, inns, lit halls). */
  fog: z.boolean().default(true),
});
export type Location = z.infer<typeof Location>;

export const Npc = z.object({
  name: z.string(),
  description: z.string().default(""),
  motive: z.string().default(""),
  /** Performance direction for the DM: accent, pitch, pace, verbal tics. */
  voice: z.string().default(""),
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
  /** completed/failed after end_campaign; resetCampaign reopens it. */
  status: z.enum(["active", "completed", "failed"]).default("active"),
  completedAt: z.number().optional(),
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

/**
 * A character being built by talking to the DM (voice character builder). Every field is optional:
 * the DM fills it in piece by piece with draft_character_update; finalize_character validates it.
 */
export const BuilderDraft = z
  .object({
    name: z.string(),
    species: z.string(),
    className: z.string(),
    subclass: z.string(),
    background: z.string(),
    abilities: Abilities.partial(),
    maxHp: z.number().int().min(1),
    ac: z.number().int().min(0),
    speed: z.number().int().min(0),
    skills: z.array(z.string()),
    savingThrows: z.array(z.string()),
    attacks: z.array(Attack),
    spells: z.array(z.string()),
    features: z.array(z.string()),
    inventory: z.array(z.object({ name: z.string(), qty: z.number().int().min(1).default(1), description: z.string().optional() })),
    gold: z.number().min(0),
    appearance: z.string(),
    notes: z.string(),
    diceMode: DiceMode,
  })
  .partial();
export type BuilderDraft = z.infer<typeof BuilderDraft>;

export const CharacterBuilder = z.object({
  playerId: z.string(),
  playerName: z.string().default(""),
  level: z.number().int().min(1).max(20).default(1),
  draft: BuilderDraft.default({}),
  startedAt: z.number(),
  updatedAt: z.number(),
});
export type CharacterBuilder = z.infer<typeof CharacterBuilder>;

/** Fog of war for one location: which cells ("x,y") the party has seen. */
export const LocationFog = z.object({
  enabled: z.boolean().default(false),
  revealed: z.array(z.string()).default([]),
  /** Cells the host hid again: never auto-revealed by party light until revealed explicitly. */
  hidden: z.array(z.string()).default([]),
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
  /** Travel from source to target (swing, arrow or spell orb by `style`), then the `outcome` reaction. */
  "attack",
  /** Area burst (ring + dome) of `radius` cells in the element's colour. */
  "area",
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
  /** How it travels from the source (attack/area/hit with a source): melee swing, ranged arrow, spell orb, area burst. */
  style: z.enum(["melee", "ranged", "spell", "area"]).optional(),
  /** Attack-roll result shown on the target: hit, miss (dodge) or crit (big flash). */
  outcome: z.enum(["hit", "miss", "crit"]).optional(),
  /** Attack or spell name, e.g. "Shortbow" or "Magic Missile". */
  label: z.string().optional(),
  /** Projectiles (Magic Missile darts, Scorching Ray rays) flying at this target, 1-6. */
  count: z.number().int().min(1).max(6).optional(),
  /** Area shape (sphere, cone, cube, line, emanation, cylinder) for `area` effects. */
  shape: z.string().optional(),
  ts: z.number(),
});
export type BoardEffect = z.infer<typeof BoardEffect>;

/** The host's corrected feature list for one location's map picture (see `effectiveFeatures`). */
export const FeatureEdit = z.object({
  /** The map picture these features belong to ("" = no map painted yet). */
  mapUrl: z.string().default(""),
  features: z.array(MapFeature).default([]),
});
export type FeatureEdit = z.infer<typeof FeatureEdit>;

/**
 * The host's (or the DM's door) changes to a location's walls (see `effectiveWalls`). No mapUrl
 * gate: a host fix is kept across repaints. `host` is false while only set_door wrote it (door
 * states for the current picture): a repaint drops that one, so the new picture's walls apply.
 */
export const WallEdit = z.object({
  walls: z.array(WallSeg).default([]),
  /** True once the host edited the walls (edit_walls); old saves count as host fixes. */
  host: z.boolean().default(true),
});
export type WallEdit = z.infer<typeof WallEdit>;

export const PendingRollKind = z.enum(["check", "death_save", "concentration", "damage"]);
export type PendingRollKind = z.infer<typeof PendingRollKind>;

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
    .object({
      characterId: z.string(),
      notation: z.string(),
      label: z.string(),
      dc: z.number().int().optional(),
      /** What record_physical_roll does with the total: a plain check, a death save or a concentration save. */
      kind: PendingRollKind.default("check"),
      /** Attack rolls: the creature attacked and the weapon/spell, animated when the total is recorded. */
      targetId: z.string().optional(),
      attackName: z.string().optional(),
      /** Damage after a critical hit: the player rolls the dice twice; applied as critical. */
      critical: z.boolean().optional(),
      /** Attack rolls: cover that raised `dc` (the target's AC) by 2 / 5. */
      cover: z.enum(["half", "three-quarters"]).optional(),
    })
    .optional(),
  /** Voice character builder in progress (at most one at a time). */
  builder: CharacterBuilder.optional(),

  /** Fog of war per location id. Missing entry = fog off for that location. */
  fog: z.record(z.string(), LocationFog).default({}),
  /**
   * Host fixes to a location's map features, by location id. Kept in GameState so they can be
   * undone; only used while `mapUrl` matches the location's current map (a repaint resets them).
   */
  featureEdits: z.record(z.string(), FeatureEdit).default({}),
  /**
   * Wall/door edits by location id (host editor, set_door). Unlike featureEdits they survive a
   * repaint of the same location until the host resets them.
   */
  wallEdits: z.record(z.string(), WallEdit).default({}),
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
