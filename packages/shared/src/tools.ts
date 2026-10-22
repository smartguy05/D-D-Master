import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { BuilderDraft, EffectKind, MapFeature, PendingRollKind } from "./schemas.js";

/**
 * Tools the voice DM (OpenAI Realtime) can call. Each tool has a zod schema for
 * validation on the server and is exported as JSON Schema for the Realtime session.
 * Keep descriptions short: they are sent with every Realtime session.
 */
const id = z.string().describe("Character or monster id (see party status)");
/** Combat turn economy (engine/economy.ts): skip the movement/action check for a real exception. */
const override = z
  .boolean()
  .default(false)
  .describe("Combat only: allow it although the turn budget refuses (Action Surge, Haste, a readied action, a feature that grants more)");
const actionType = z
  .enum(["action", "bonus_action", "reaction"])
  .optional()
  .describe("Attack rolls in combat: what the attack uses. Default action; bonus_action for an off-hand or Flurry attack; reaction for an opportunity attack");
export const TakeActionKind = z.enum(["dash", "dodge", "disengage", "help", "hide", "ready", "search", "study", "influence", "magic", "utilize", "other"]);

export const ToolArgs = {
  get_party_status: z.object({}),
  roll_dice: z.object({
    notation: z.string().describe("Dice notation, e.g. 1d20+5, 2d6+3, 2d20kh1+4 (advantage), 8d6"),
    label: z.string().describe("What the roll is for, e.g. 'Goblin scimitar attack'"),
    roller_id: z.string().optional().describe("Monster/character id rolling, omit for DM"),
    secret: z.boolean().optional().describe("Hide the result from players"),
    dc: z.number().int().optional().describe("Target DC/AC to compare against"),
    target_id: z.string().optional().describe("Attack rolls: the creature attacked (animates the attack on the TV)"),
    attack_name: z.string().optional().describe("Attack rolls: weapon or spell used, e.g. Shortbow"),
    action_type: actionType,
    override,
  }),
  request_player_roll: z.object({
    character_id: id,
    notation: z.string().describe("Dice notation including modifier, e.g. 1d20+3"),
    label: z.string().describe("e.g. 'Stealth check' or 'Longsword attack'"),
    dc: z.number().int().optional(),
    target_id: z.string().optional().describe("Attack rolls: the creature attacked (animates the attack on the TV)"),
    attack_name: z.string().optional().describe("Attack rolls: weapon or spell used, e.g. Longsword"),
    kind: z.enum(["check", "damage"]).default("check").describe("damage: the damage roll after a hit, with target_id; a physical-dice player's total is applied to the target when recorded"),
    critical: z.boolean().optional().describe("kind damage after a critical hit: the player rolls the damage dice twice (inferred from a natural 20 attack just before when omitted)"),
    action_type: actionType,
    override,
  }),
  record_physical_roll: z.object({
    character_id: id,
    notation: z.string(),
    label: z.string(),
    total: z.number().int().describe("Total the player said out loud"),
    natural: z.number().int().min(1).max(20).optional().describe("For a d20 roll: the face the d20 showed, when the player says it (20 = natural 20, 1 = natural 1)"),
    dc: z.number().int().optional(),
    kind: PendingRollKind.optional().describe("death_save, concentration or damage when recording one; default: the pending roll's kind"),
    critical: z.boolean().optional().describe("damage: from a critical hit (dice already doubled)"),
  }),
  apply_damage: z.object({
    target_id: id,
    amount: z.number().int().min(0),
    damage_type: z.string().optional(),
    critical: z.boolean().optional().describe("From a Critical Hit (2 death-save failures at 0 HP)"),
    source_id: z.string().optional().describe("Attacker/caster (the hit flies from them on the TV)"),
    attack_name: z.string().optional().describe("Weapon or spell that dealt it, e.g. Shortbow"),
  }),
  heal: z.object({ target_id: id, amount: z.number().int().min(0) }),
  set_temp_hp: z.object({ target_id: id, amount: z.number().int().min(0) }),
  add_condition: z.object({
    target_id: id,
    condition: z.string(),
    source_spell: z.string().optional().describe("Spell that causes it (Bless): removed when the caster's concentration on it ends"),
    caster_id: z.string().optional().describe("Who cast source_spell"),
    duration_rounds: z.number().int().min(1).optional().describe("Combat rounds it lasts: ends at the start of the caster's (else the target's) turn that many rounds later"),
    until_end_of_turn_of: z.string().optional().describe("Ends when this creature's turn ends; given on that creature's own turn it lasts until the end of its next turn"),
  }),
  remove_condition: z.object({ target_id: id, condition: z.string() }),
  give_item: z.object({
    character_id: id,
    name: z.string(),
    qty: z.number().int().min(1).default(1),
    description: z.string().optional(),
  }),
  remove_item: z.object({ character_id: id, name: z.string(), qty: z.number().int().min(1).default(1) }),
  adjust_gold: z.object({ character_id: id, amount: z.number().int().describe("Whole gp: positive to add, negative to spend") }),
  split_gold: z.object({
    total: z.number().int().min(0).describe("Whole gp to share"),
    character_ids: z.array(id).min(1).describe("Who shares it; any remainder goes 1 gp each to the first ones"),
  }),
  move_token: z.object({
    entity_id: id,
    x: z.number().int().describe("Grid column (0 = left)"),
    y: z.number().int().describe("Grid row (0 = top)"),
    ignore_terrain: z
      .boolean()
      .default(false)
      .describe("Place it exactly at x,y past walls, closed doors, windows and furniture: a jump, a climb, squeezing through, a teleport, or the painted map is wrong. Combat still counts the squares unless override"),
    override,
  }),
  move_party: z.object({
    to: z.string().optional().describe("Map feature name to walk to, e.g. 'pie stall', 'cellar hatch', 'iron gate'"),
    x: z.number().int().optional().describe("Grid column, instead of a feature"),
    y: z.number().int().optional().describe("Grid row, instead of a feature"),
    character_ids: z.array(id).optional().describe("Only these PCs (and listed follower NPC ids) go; omit for the whole party here and its followers"),
  }),
  spawn_monster: z.object({
    name: z.string().describe("SRD monster name if possible, e.g. 'Goblin Warrior'"),
    count: z.number().int().min(1).max(12).default(1),
    x: z.number().int().optional().describe("Grid column; omit to place near the map's focal feature (lair/altar)"),
    y: z.number().int().optional().describe("Grid row; omit to place near the map's focal feature"),
    near: z.string().optional().describe("Map feature name to gather around, e.g. 'altar' (x/y win if given)"),
    formation: z.enum(["cluster", "arc", "line"]).default("cluster").describe("cluster = tight group, arc = half-ring facing the party, line = battle line"),
    fog: z.enum(["any", "revealed", "hidden"]).default("any").describe("Prefer cells the party can see (revealed) or can't (hidden)"),
    hidden: z.boolean().default(false).describe("Hide them from the table (ambush) until set_monster_hidden false"),
    hp: z.number().int().optional().describe("Override HP"),
    ac: z.number().int().optional().describe("Override AC"),
  }),
  remove_monster: z.object({ monster_id: id }),
  set_disposition: z.object({
    monster_id: id,
    disposition: z.enum(["foe", "ally", "neutral"]),
    combatant: z.boolean().optional().describe("Joins initiative and fights (neutral creatures never do)"),
  }),
  adjust_attitude: z.object({
    npc_id: id,
    delta: z
      .number()
      .int()
      .min(-5)
      .max(5)
      .refine((d) => d !== 0, "delta must not be 0")
      .describe("How far the attitude moves: +1 small favour/kind word, +2 real help or a gift, -1 rudeness, -2 insult or threat, ±3 a big betrayal or rescue"),
    reason: z.string().min(1).describe("Why, in a few words, e.g. 'saved his dog'"),
  }),
  add_npc: z.object({
    name: z.string().min(1).describe("The NPC's name, e.g. 'Captain Mara Venn' (outline NPCs are recognised)"),
    appearance: z.string().optional().describe("Short look for the token picture; omit for an outline NPC"),
    stat_block: z.string().optional().describe("SRD stat block for HP/AC/attacks, e.g. 'Guard', 'Veteran', 'Priest' (default Commoner)"),
    follows: z.boolean().optional().describe("Travels with the party to new scenes (false = stays here). New NPC default true; omitted on a re-call: unchanged"),
    ally: z.boolean().optional().describe("On the party's side (false = neutral or hostile). New NPC default true; omitted on a re-call: unchanged"),
    combatant: z.boolean().optional().describe("Rolls initiative and fights (true for a guard or bodyguard). New NPC default: false for an ally (story NPCs stay out of combat), true when ally=false; omitted on a re-call: unchanged"),
    x: z.number().int().optional().describe("Grid column; omit to stand next to the party"),
    y: z.number().int().optional().describe("Grid row; omit to stand next to the party"),
    near: z.string().optional().describe("Map feature name to stand by instead of the party"),
    voice: z.string().max(200).optional().describe("Voice direction for speak_as_npc, e.g. 'gravelly, slow, coastal drawl' (omit for an outline NPC or a generated default)"),
  }),
  start_combat: z.object({}),
  next_turn: z.object({}),
  end_combat: z.object({
    outcome: z
      .enum(["victory", "fled", "defeat"])
      .optional()
      .describe("How the fight ended: victory (foes beaten), fled (the party escaped), defeat (the party fell). Omit to auto-detect"),
  }),
  end_campaign: z.object({
    outcome: z.enum(["success", "failure"]).describe("success = the campaign's final goal is reached; failure = the party is wiped out or the story is lost for good"),
    epilogue: z.string().optional().describe("One or two closing sentences shown on the TV"),
  }),
  take_action: z.object({
    entity_id: z.string().optional().describe("Who acts; default the creature whose turn it is"),
    kind: TakeActionKind.describe("dash = extra movement equal to Speed; dodge; disengage; help; hide; ready; search; study; influence; magic (item); utilize (object); other"),
    cost: z.enum(["action", "bonus_action", "reaction"]).default("action").describe("bonus_action e.g. Cunning Action Dash; reaction e.g. a readied action going off"),
    note: z.string().max(200).optional().describe("What they do, e.g. 'drinks a Potion of Healing'"),
    override,
  }),
  change_scene: z.object({
    location_id: z.string().describe("Location id from the campaign outline"),
    character_ids: z
      .array(z.string())
      .optional()
      .describe("Split the party: only these PCs (and any follower NPC ids listed) go; the rest stay where they are. Omit to move the whole party"),
    forced: z
      .boolean()
      .optional()
      .describe("Only when the characters have no choice (a trapdoor, a teleport trap, captured): skips the ready check"),
  }),
  focus_scene: z.object({ location_id: z.string().describe("Location id where a split-off group is") }),
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
  npc_focus: z.object({
    npc_name: z.string().optional().describe("The NPC you are about to speak as; omit when the conversation with the NPC is over"),
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
    kind: EffectKind.describe("Visual: slash, fireball, lightning, frost, poison, radiant, necrotic, thunder, arcane, heal, hit, crit, miss, attack (travel from source), area (ring of radius)"),
    target_id: z.string().optional().describe("Creature the effect hits"),
    source_id: z.string().optional().describe("Caster/attacker (bolts fly from here)"),
    x: z.number().int().optional().describe("Target cell column when there is no target creature"),
    y: z.number().int().optional().describe("Target cell row"),
    radius: z.number().int().min(0).max(20).optional().describe("Area radius in cells, e.g. 4 for a 20-ft fireball"),
  }),
  set_door: z.object({
    door_id: z.string().describe("Door id from the scene's door list, e.g. d1"),
    open: z.boolean().describe("true: open it; false: close it"),
    location: z.string().optional().describe("Location id; default the current location"),
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
    override,
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
  revive: z.object({
    character_id: id,
    hp: z.number().int().min(1).default(1).describe("HP on return (Revivify 1; Raise Dead 1)"),
  }),
  drop_loot: z.object({
    monster_id: z.string().optional().describe("The defeated monster whose cell the loot lies on (call before remove_monster)"),
    x: z.number().int().optional().describe("Grid column, instead of monster_id (x/y win if both are given)"),
    y: z.number().int().optional().describe("Grid row, with x"),
    items: z
      .array(
        z.object({
          name: z.string().min(1),
          qty: z.number().int().min(1).default(1),
          description: z.string().optional(),
        }),
      )
      .default([])
      .describe("What it carried, e.g. [{name:'Shortsword'},{name:'Copper ring'}]"),
    gold: z.number().int().min(0).default(0).describe("Whole gp in the pile"),
    name: z.string().optional().describe("Label, default \"<monster>'s loot\" or 'Loot'"),
  }),
  pick_up: z.object({
    object_id: z.string().describe("Map object id (see Objects here / party status)"),
    character_id: id,
    items: z.array(z.string()).optional().describe("Item names to take (whole stacks); omit to take everything"),
    gold: z.boolean().optional().describe("Take the gold too; default: only when items is omitted"),
  }),
  place_interactable: z.object({
    name: z.string().min(1).describe("e.g. 'Rusty lever', 'Iron chest', 'Altar of Bane'"),
    x: z.number().int().describe("Grid column"),
    y: z.number().int().describe("Grid row"),
    hidden: z.boolean().default(false).describe("Not shown on the TV until revealed (secret latch)"),
  }),
  set_interactable: z.object({
    id: z.string().describe("Map object id"),
    used: z.boolean().optional().describe("true once pulled, opened or activated (dims its aura)"),
    hidden: z.boolean().optional().describe("Hide it from the table, or false to reveal it"),
    name: z.string().min(1).optional().describe("Rename it, e.g. 'Broken lever'"),
  }),
  remove_map_object: z.object({ id: z.string().describe("Map object id") }),
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
        interactive: z.boolean(),
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
  edit_walls: z.object({
    action: z.enum(["add", "delete", "toggle", "reset"]).describe("reset: drop all host wall edits for this location"),
    id: z.string().optional().describe("Segment id (delete/toggle)"),
    segment: z
      .object({
        // Plain numbers: the handler rounds, validates and clamps them into the grid.
        x1: z.number().finite(),
        y1: z.number().finite(),
        x2: z.number().finite(),
        y2: z.number().finite(),
        kind: z.enum(["wall", "door", "window"]).default("wall"),
      })
      .optional()
      .describe("add: the new segment, between two grid intersections in one row or column"),
  }),
} as const;

export type ToolName = keyof typeof ToolArgs;
export type ToolArgsOf<N extends ToolName> = z.infer<(typeof ToolArgs)[N]>;

export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  get_party_status: "Get current HP, AC, conditions, inventory, positions and combat order for everyone.",
  roll_dice: "Roll dice for the DM or a monster. Shows 3D dice on the table screen. Returns the result. For an attack pass target_id and attack_name: the TV animates it (swing, arrow, spell orb; hit/miss/crit). With no dc an attack is checked against the target's AC (vs_ac; natural 20 hits, natural 1 misses): deal damage only on success. Saves and checks are never checked against AC. In combat an attack spends the attacker's action (Extra Attack/Multiattack allow more) and is refused once it is spent.",
  request_player_roll:
    "Ask a player's character to roll. If they use virtual dice it is rolled now and returned; if they use physical dice, ask them to roll and say the total, then call record_physical_roll. For an attack pass target_id and attack_name (animated on the TV; with no dc it is checked against the target's AC); in combat it spends their action like roll_dice, except an attack spell's own rolls right after cast_spell. Damage after a hit: kind 'damage' with target_id (critical: true after a crit; inferred when the attack at that target was a natural 20).",
  record_physical_roll: "Record the total a player rolled on physical dice. Pass natural when the player says the d20 showed a 20 or a 1 (crit/fumble on the TV, crit damage). If the host or phone already recorded it you get already_recorded: nothing is added.",
  apply_damage: "Apply damage to a character or monster (temp HP absorbs first). Pass source_id (and attack_name) so the hit flies from the attacker on the TV.",
  heal: "Restore hit points to a character or monster.",
  set_temp_hp: "Give temporary hit points.",
  add_condition:
    "Add a condition such as Poisoned, Prone, Frightened. For a spell effect pass source_spell and caster_id (it ends with the caster's concentration), and duration_rounds or until_end_of_turn_of when it is timed.",
  remove_condition: "Remove a condition.",
  give_item: "Put an item into a character's inventory.",
  remove_item: "Remove/consume an item from a character's inventory.",
  adjust_gold: "Add or spend gold pieces.",
  split_gold: "Share a gold reward between characters evenly in whole gp (the remainder goes 1 gp each to the first in the list). Use it instead of several adjust_gold calls.",
  move_token:
    "Move a character's or monster's token on the map grid. It walks around walls, closed doors, windows and furniture by itself (give the destination once); an unreachable cell stops as close as it can (redirected, with pos). ignore_terrain places it straight there when the fiction allows it. In combat it is refused off-turn or beyond the creature's movement left, counting the squares of the route (1 square = 5 ft, diagonals too).",
  move_party:
    "Out of combat: walk the whole party (or character_ids) with its followers to a map feature (to) or a cell, side by side around it, each around walls and furniture. Use it whenever the group goes somewhere on the map; it clears the fog as they go. At an exit it says where the way leads. In combat use move_token.",
  spawn_monster: "Add monsters to the scene (auto-filled from the SRD) and place their tokens: a cluster near the focal feature by default, never on furniture or other tokens and kept 3+ squares from the party when there is room. Use near/formation/fog to stage them; hidden=true for an ambush.",
  remove_monster: "Remove a monster or NPC (fled, left, or dead and looted).",
  set_disposition:
    "Change a creature's side: foe, ally (green, on the party's side) or neutral (stays out of combat). Use it when monsters surrender, are charmed or befriended, or an NPC turns on the party. combatant decides whether an ally/foe rolls initiative; in combat it joins or leaves the order now. It is the hard override (sudden flips: charmed, betrayal, surrender) and sets the attitude to match.",
  adjust_attitude:
    "Move an NPC's or creature's attitude (2024 SRD) on a -5..+5 scale after a meaningful interaction: a gift, help, an insult, a threat, a won or failed Influence check. <= -3 Hostile, -2..+2 Indifferent, >= +3 Friendly; crossing a threshold changes its side (Hostile = foe, Indifferent = neutral, Friendly = ally) and initiative now. Use set_disposition only for sudden hard flips.",
  add_npc:
    "Put a named NPC on the map with its own token picture, e.g. when one joins or follows the party (next to them, kept across scenes) or when the party meets one. Calling it again for the same name updates follows/ally/voice and moves it if x/y/near are given. voice = its speak_as_npc direction (a default is generated if none).",
  start_combat: "Roll initiative for everyone on the map and start combat. The TV plays a battle intro with the order; say the returned announce line before the first turn.",
  next_turn: "Advance to the next creature in initiative order.",
  end_combat:
    "End combat. outcome: victory (foes beaten, e.g. after a victory_hint), fled (the party escaped) or defeat (the party fell); omit it to auto-detect from who is still standing. Shows the matching banner on the TV. victory is refused while a foe of the fight still stands (the error names it).",
  end_campaign:
    "End the whole campaign when its story is finished: outcome success (final goal reached) or failure, with an optional epilogue for the TV. Never for a single combat or one PC's death (they can be revived). failure is refused until the campaign's death rule is met; the server ends it by itself then.",
  take_action:
    "Combat: spend the action, bonus action or reaction on something that isn't an attack roll or a spell (Dash, Dodge, Disengage, Help, Hide, Ready, drink a potion...). Refused if already spent. Returns what is left.",
  change_scene:
    "Move the party to another location; shows its map. On the first visit it turns fog of war on if the location has fog. With character_ids only those PCs go (the party splits; the TV follows them); a group reaching another group's location joins it. Without character_ids a split party regroups there. Ready check: the first call for a move that takes human players away is refused until you ask them if they're ready and one answers; then call it again.",
  focus_scene:
    "Party split: cut to another group's scene. The TV shows their map; a fight there resumes exactly where it was frozen. Play every PC in the focused scene, then focus the other group.",
  lookup_rule: "Search the D&D SRD 5.2 and house rules. Use for any rule you are unsure of.",
  consult_brain:
    "Ask the campaign planner for story guidance (plot, NPC motives, what's next). Slower; say something in character while waiting.",
  confirm_speaker: "Tell the system who actually spoke after you asked, to improve voice recognition.",
  speak_as_npc:
    "Play one short, dramatic NPC line in that NPC's own distinct voice on the table speaker. Use it for every quoted NPC line (one or two sentences); narrate between lines yourself and stay silent until it has played.",
  npc_focus:
    "Show an NPC's close-up with subtitles on the TV. Call it right before you speak as that NPC (a new NPC replaces the old one); call it without npc_name when the conversation ends. Instant, no game effect.",
  start_character_builder:
    "Start building a new character for a player by interviewing them. Only when a player asks to make a character.",
  draft_character_update:
    "Character builder: save the choices made so far (merged into the live draft shown to everyone). Returns the draft and what is still missing. A species or class the campaign doesn't allow is refused (the error lists the allowed ones).",
  finalize_character:
    "Character builder: validate the draft and create the character for that player. Returns problems to fix if incomplete or if it breaks the campaign's species/class rules.",
  reveal_area: "Reveal part of the map through the fog of war (a circle around x,y or a w×h rectangle).",
  set_fog: "Turn fog of war on/off for the current location, or reset what the party has explored.",
  play_effect: "Show a spell/attack visual on the table map (fireball, lightning, slash, heal...). No game effect.",
  set_door:
    "Open or close a door on the map (door ids are in your scene notes). Call it when someone opens, closes, breaks or slams a door: opening lets sight, attacks and movement through and reveals the fog beyond it.",
  set_monster_hidden: "Hide a monster from the table screen (ambush, invisible) or reveal it again.",
  cast_spell:
    "Cast a spell for a character: spends the slot (cantrips and rituals free), handles concentration, returns save DC, attack bonus, damage dice and area. Unknown names return did_you_mean. In combat it spends the action, bonus action or reaction its casting time needs.",
  end_concentration: "End a character's concentration spell.",
  use_resource: "Spend (or give back) uses of a class feature such as Rage, Channel Divinity or Second Wind.",
  short_rest: "Short Rest (1 hour): spend Hit Dice to heal; Pact slots and short-rest features recover.",
  long_rest: "Long Rest (8 hours): full HP, all slots, Hit Dice and features restored.",
  level_up: "Level a character up: HP, Hit Dice, slots, features (with short text) and resources.",
  death_save: "Roll a Death Saving Throw for a character at 0 HP (normally automatic on their turn).",
  stabilize: "Make a dying character Stable (e.g. after a DC 10 Medicine check or Spare the Dying).",
  revive: "Bring a dead character back to life after a revival spell (Revivify, Raise Dead...). Heal doesn't work on the dead.",
  drop_loot:
    "Leave loot on the map: at a defeated monster's cell (monster_id, before remove_monster) or at x,y. Items and gold the foe plausibly carried; the TV shows a loot sack. Players take it with pick_up.",
  pick_up:
    "A character takes loot (or the contents of a chest) from a map object into their inventory and gold. Omit items to take everything; empty loot disappears. No distance check.",
  place_interactable:
    "Put a notable usable thing on the map (lever, chest, altar, wheel) at x,y; it glows on the TV. hidden=true keeps it off the TV until revealed.",
  set_interactable: "Update a map object: used=true once pulled/opened/activated (its glow dims), hidden to hide or reveal it, or rename it.",
  remove_map_object: "Remove a loot pile or interactable from the map.",
  edit_fog: "Host: reveal or hide fog-of-war cells; hidden cells stay dark until revealed again.",
  edit_map_feature: "Host: add, move/resize, change or delete a map feature for the current map picture.",
  edit_walls: "Host: add, delete or toggle (doors) a wall, door or window segment on the current map, or reset to the detected walls.",
};

/** Tools only the host's board UI calls (POST /api/tools/:name); filtered out of the DM's tool list. */
export const HOST_ONLY_TOOLS = ["edit_fog", "edit_map_feature", "edit_walls"] as const satisfies readonly ToolName[];

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
