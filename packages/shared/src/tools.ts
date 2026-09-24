import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

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
  }),
  apply_damage: z.object({
    target_id: id,
    amount: z.number().int().min(0),
    damage_type: z.string().optional(),
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
    x: z.number().int().optional(),
    y: z.number().int().optional(),
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
};

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
