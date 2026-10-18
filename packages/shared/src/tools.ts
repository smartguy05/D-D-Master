import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { BuilderDraft, EffectKind, MapFeature, PendingRollKind } from "./schemas.js";

/**
 * Tools the voice DM (OpenAI Realtime) can call. Each tool has a zod schema for
 * validation on the server and is exported as JSON Schema for the Realtime session.
 * Keep descriptions short: they are sent with every Realtime session.
 */
const id = z.string().describe("Character or monster id (see party status)");

export const ToolArgs = {
  get_party_status: z.object({}),
  roll_dice: z.object({
    notation: z.string().describe("Dice notation, e.g. 1d20+5, 2d6+3, 2d20kh1+4 (advantage), 8d6"),
    label: z.string().describe("What the roll is for, e.g. 'Goblin scimitar attack'"),
    roller_id: z.string().optional().describe("Monster/character id rolling, omit for DM"),
    secret: z.boolean().optional().describe("Hide the result from players"),
    dc: z.number().int().optional().describe("Target DC/AC to compare against"),
  }),
  request_player_roll: z.object({
    character_id: id,
    notation: z.string().describe("Dice notation including modifier, e.g. 1d20+3"),
    label: z.string().describe("e.g. 'Stealth check' or 'Longsword attack'"),
    dc: z.number().int().optional(),
  }),
  record_physical_roll: z.object({
    character_id: id,
    notation: z.string(),
    label: z.string(),
    total: z.number().int().describe("Total the player said out loud"),
    dc: z.number().int().optional(),
    kind: PendingRollKind.optional().describe("death_save or concentration when recording one; default: the pending roll's kind"),
  }),
  apply_damage: z.object({
    target_id: id,
    amount: z.number().int().min(0),
    damage_type: z.string().optional(),
    critical: z.boolean().optional().describe("From a Critical Hit (2 death-save failures at 0 HP)"),
  }),
  heal: z.object({ target_id: id, amount: z.number().int().min(0) }),
  set_temp_hp: z.object({ target_id: id, amount: z.number().int().min(0) }),
  add_condition: z.object({ target_id: id, condition: z.string() }),
  remove_condition: z.object({ target_id: id, condition: z.string() }),
  give_item: z.object({
    character_id: id,
    name: z.string(),
    qty: z.number().int().min(1).default(1),
    description: z.string().optional(),
  }),
  remove_item: z.object({ character_id: id, name: z.string(), qty: z.number().int().min(1).default(1) }),
  adjust_gold: z.object({ character_id: id, amount: z.number().describe("Positive to add, negative to spend") }),
  move_token: z.object({
    entity_id: id,
    x: z.number().int().describe("Grid column (0 = left)"),
    y: z.number().int().describe("Grid row (0 = top)"),
  }),
  spawn_monster: z.object({
    name: z.string().describe("SRD monster name if possible, e.g. 'Goblin Warrior'"),
    count: z.number().int().min(1).max(12).default(1),
    x: z.number().int().optional().describe("Grid column; omit to place at the map's focal feature (lair/altar)"),
    y: z.number().int().optional().describe("Grid row; omit to place at the map's focal feature"),
    hp: z.number().int().optional().describe("Override HP"),
    ac: z.number().int().optional().describe("Override AC"),
  }),
  remove_monster: z.object({ monster_id: id }),
  start_combat: z.object({}),
  next_turn: z.object({}),
  end_combat: z.object({}),
  change_scene: z.object({ location_id: z.string().describe("Location id from the campaign outline") }),
  lookup_rule: z.object({ query: z.string().describe("Rule, spell, condition, item or monster to look up") }),
  consult_brain: z.object({
    question: z.string().describe("Story/planning question for the campaign planner, e.g. what happens next"),
  }),
  confirm_speaker: z.object({
    player_name: z.string().describe("The player who actually spoke, after you asked who it was"),
  }),
  speak_as_npc: z.object({
    npc_name: z.string().min(1).describe("NPC name from the outline (or an improvised NPC)"),
    line: z.string().min(1).max(400).describe("The exact short line the NPC says (one or two sentences)"),
    style: z.string().max(200).optional().describe("Extra delivery direction for this line, e.g. 'whispered, terrified'"),
  }),
  start_character_builder: z.object({
    player_id: z.string().describe("Player id or name who wants to build a character"),
    level: z.number().int().min(1).max(20).optional().describe("Character level, default = party level"),
  }),
  draft_character_update: BuilderDraft.describe(
    "Only the fields decided so far. abilities are scores (8-20), e.g. {str:15}. Lists replace the old list.",
  ),
  finalize_character: z.object({}),
  reveal_area: z.object({
    x: z.number().int().describe("Center column, or left column when w/h are given"),
    y: z.number().int().describe("Center row, or top row when w/h are given"),
    radius: z.number().int().min(0).max(30).default(3).describe("Radius in cells (circle)"),
    w: z.number().int().min(1).max(60).optional().describe("Rectangle width in cells (instead of radius)"),
    h: z.number().int().min(1).max(60).optional().describe("Rectangle height in cells"),
  }),
  set_fog: z.object({
    mode: z.enum(["enable", "disable", "reset"]).describe("enable: hide unexplored cells; disable: show all; reset: forget explored cells"),
  }),
  play_effect: z.object({
    kind: EffectKind.describe("Visual: slash, fireball, lightning, frost, poison, radiant, necrotic, thunder, arcane, heal, hit, crit, miss"),
    target_id: z.string().optional().describe("Creature the effect hits"),
    source_id: z.string().optional().describe("Caster/attacker (bolts fly from here)"),
    x: z.number().int().optional().describe("Target cell column when there is no target creature"),
    y: z.number().int().optional().describe("Target cell row"),
    radius: z.number().int().min(0).max(20).optional().describe("Area radius in cells, e.g. 4 for a 20-ft fireball"),
  }),
  set_monster_hidden: z.object({
    monster_id: id,
    hidden: z.boolean().default(true).describe("true: hide from the table (ambush, invisible); false: show"),
  }),
  // Rules engine (engine/rules): spells, rests, levels, death saves.
  cast_spell: z.object({
    caster_id: id,
    spell: z.string().describe("Spell name"),
    slot_level: z.number().int().min(1).max(9).optional().describe("Slot level to spend (upcast); default the spell's level"),
    as_ritual: z.boolean().optional().describe("Cast as a Ritual (Ritual spells only): no slot, 10 minutes longer"),
    target_ids: z.array(z.string()).max(20).optional().describe("Creatures targeted"),
    x: z.number().int().optional().describe("Target cell column for an area spell"),
    y: z.number().int().optional().describe("Target cell row"),
  }),
  end_concentration: z.object({ character_id: id }),
  use_resource: z.object({
    character_id: id,
    resource: z.string().describe("Feature name, e.g. Rage, Channel Divinity, Second Wind"),
    amount: z.number().int().min(-100).max(100).default(1).describe("Uses to spend; negative gives uses back"),
  }),
  short_rest: z.object({
    character_ids: z.array(z.string()).min(1),
    hit_dice: z.record(z.string(), z.number().int().min(0).max(20)).optional().describe("Hit dice each character spends, by id, e.g. {\"pc_1\": 2}"),
  }),
  long_rest: z.object({ character_ids: z.array(z.string()).optional().describe("Default: the whole party") }),
  level_up: z.object({
    character_id: id,
    hp: z.enum(["average", "roll"]).default("average").describe("Fixed average HP or roll the Hit Die"),
    subclass: z.string().optional().describe("Required at the class's subclass level (3)"),
  }),
  death_save: z.object({ character_id: id }),
  stabilize: z.object({ character_id: id }),
  // Host-only board tools (see HOST_ONLY_TOOLS): never offered to the voice DM.
  edit_fog: z.object({
    cells: z.array(z.tuple([z.number().int(), z.number().int()])).min(1).max(3600).describe("Cells as [x, y]"),
    mode: z.enum(["reveal", "hide"]).describe("reveal: show the cells; hide: shroud them and keep them shrouded"),
  }),
  edit_map_feature: z.object({
    action: z.enum(["add", "update", "delete", "reset"]).describe("reset: drop all host edits for this map"),
    index: z.number().int().min(0).optional().describe("Feature index (update/delete)"),
    expect_name: z.string().optional().describe("update/delete: the name the feature at index must have (guards a stale index)"),
    feature: z
      .object({
        name: MapFeature.shape.name,
        kind: MapFeature.shape.kind.removeDefault(),
        lit: z.boolean(),
        blocks: z.boolean(),
        // Plain numbers: the handler rounds and clamps them into the grid before validating.
        x: z.number().finite(),
        y: z.number().finite(),
        w: z.number().finite(),
        h: z.number().finite(),
      })
      .partial()
      .optional()
      .describe("add: the full feature; update: only the fields to change"),
  }),
} as const;

export type ToolName = keyof typeof ToolArgs;
export type ToolArgsOf<N extends ToolName> = z.infer<(typeof ToolArgs)[N]>;

export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  get_party_status: "Get current HP, AC, conditions, inventory, positions and combat order for everyone.",
  roll_dice: "Roll dice for the DM or a monster. Shows 3D dice on the table screen. Returns the result.",
  request_player_roll:
    "Ask a player's character to roll. If they use virtual dice it is rolled now and returned; if they use physical dice, ask them to roll and say the total, then call record_physical_roll.",
  record_physical_roll: "Record the total a player rolled on physical dice.",
  apply_damage: "Apply damage to a character or monster (temp HP absorbs first).",
  heal: "Restore hit points to a character or monster.",
  set_temp_hp: "Give temporary hit points.",
  add_condition: "Add a condition such as Poisoned, Prone, Frightened.",
  remove_condition: "Remove a condition.",
  give_item: "Put an item into a character's inventory.",
  remove_item: "Remove/consume an item from a character's inventory.",
  adjust_gold: "Add or spend gold pieces.",
  move_token: "Move a character's or monster's token on the map grid.",
  spawn_monster: "Add monsters to the scene (auto-filled from the SRD) and place their tokens.",
  remove_monster: "Remove a monster (fled or dead and looted).",
  start_combat: "Roll initiative for everyone on the map and start combat.",
  next_turn: "Advance to the next creature in initiative order.",
  end_combat: "End combat.",
  change_scene: "Move the party to another location; shows its map.",
  lookup_rule: "Search the D&D SRD 5.2 and house rules. Use for any rule you are unsure of.",
  consult_brain:
    "Ask the campaign planner for story guidance (plot, NPC motives, what's next). Slower; say something in character while waiting.",
  confirm_speaker: "Tell the system who actually spoke after you asked, to improve voice recognition.",
  speak_as_npc:
    "Play one short, dramatic NPC line in that NPC's own distinct voice on the table speaker. Use sparingly; stay silent until it has played.",
  start_character_builder:
    "Start building a new character for a player by interviewing them. Only when a player asks to make a character.",
  draft_character_update:
    "Character builder: save the choices made so far (merged into the live draft shown to everyone). Returns the draft and what is still missing.",
  finalize_character:
    "Character builder: validate the draft and create the character for that player. Returns problems to fix if incomplete.",
  reveal_area: "Reveal part of the map through the fog of war (a circle around x,y or a w×h rectangle).",
  set_fog: "Turn fog of war on/off for the current location, or reset what the party has explored.",
  play_effect: "Show a spell/attack visual on the table map (fireball, lightning, slash, heal...). No game effect.",
  set_monster_hidden: "Hide a monster from the table screen (ambush, invisible) or reveal it again.",
  cast_spell:
    "Cast a spell for a character: spends the slot (cantrips and rituals free), handles concentration, returns save DC, attack bonus, damage dice and area. Unknown names return did_you_mean.",
  end_concentration: "End a character's concentration spell.",
  use_resource: "Spend (or give back) uses of a class feature such as Rage, Channel Divinity or Second Wind.",
  short_rest: "Short Rest (1 hour): spend Hit Dice to heal; Pact slots and short-rest features recover.",
  long_rest: "Long Rest (8 hours): full HP, all slots, Hit Dice and features restored.",
  level_up: "Level a character up: HP, Hit Dice, slots, features (with short text) and resources.",
  death_save: "Roll a Death Saving Throw for a character at 0 HP (normally automatic on their turn).",
  stabilize: "Make a dying character Stable (e.g. after a DC 10 Medicine check or Spare the Dying).",
  edit_fog: "Host: reveal or hide fog-of-war cells; hidden cells stay dark until revealed again.",
  edit_map_feature: "Host: add, move/resize, change or delete a map feature for the current map picture.",
};

/** Tools only the host's board UI calls (POST /api/tools/:name); filtered out of the DM's tool list. */
export const HOST_ONLY_TOOLS = ["edit_fog", "edit_map_feature"] as const satisfies readonly ToolName[];

export function isHostOnlyTool(name: string): boolean {
  return (HOST_ONLY_TOOLS as readonly string[]).includes(name);
}

export interface RealtimeToolDef {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export function realtimeToolDefs(): RealtimeToolDef[] {
  return (Object.keys(ToolArgs) as ToolName[]).map((name) => {
    const schema = zodToJsonSchema(ToolArgs[name], { $refStrategy: "none", target: "openApi3" }) as Record<
      string,
      unknown
    >;
    delete schema.$schema;
    return { type: "function", name, description: TOOL_DESCRIPTIONS[name], parameters: schema };
  });
}

export function isToolName(name: string): name is ToolName {
  return Object.prototype.hasOwnProperty.call(ToolArgs, name);
}
