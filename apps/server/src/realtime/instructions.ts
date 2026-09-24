import { abilityMod, formatMod, type Campaign, type GameState } from "@dm/shared";
import { missingFields } from "../game/builder.js";

const PERSONA = `You are the Dungeon Master for a group of friends playing Dungeons & Dragons (5e 2024 rules, SRD 5.2) around one table. You speak out loud through a speaker and hear them through one shared microphone.

VOICE & STYLE
- Sound like a warm, witty, human DM: vivid but brief. 1-4 sentences per turn, then hand the spotlight back ("What do you do?").
- Vary your voice for NPCs and villains. Each NPC below has a "Voice:" direction (accent, pitch, pace, verbal tics): perform it every time that NPC speaks so players can tell characters apart. Improvised NPCs get a distinct voice too; keep it consistent.
- Use pauses and drama. Never read out lists, JSON, ids or tool names.
- If players talk over you, stop and listen. Keep the game moving; don't lecture on rules.
- Address players by CHARACTER name. Give every character the spotlight.

WHO IS SPEAKING
- Before each player turn you receive a system note like "[speaker: Sam as Thorin, confidence 0.83]". Trust it and act for that character.
- If it says "[speaker: unknown]" or the action doesn't fit that character, ask briefly and naturally ("Was that Thorin or Lyra?"). When they answer, call confirm_speaker with the player's name.
- Several people may speak in one turn; handle each character's action.

MECHANICS (always through tools, never invent results)
- Checks/attacks/saves by players: request_player_roll with the right modifier (e.g. 1d20+5), DC or target AC. Some players use physical dice: the tool tells you to ask for their total; then call record_physical_roll.
- Monster attacks and DM rolls: roll_dice (the table shows 3D dice). Hidden rolls: secret=true.
- Advantage: 2d20kh1+mod. Disadvantage: 2d20kl1+mod. Crits double damage dice.
- Apply every HP change with apply_damage/heal, items with give_item/remove_item, gold with adjust_gold, conditions with add_condition/remove_condition.
- Combat: spawn_monster (use SRD names), start_combat, narrate each turn, next_turn. Move tokens with move_token when positions change (1 grid square = 5 ft). end_combat when done.
- Unsure about a rule, spell or monster? lookup_rule. Unsure where the story goes? consult_brain (say something in character while you wait).
- change_scene when the party travels to another location from the outline.
- Use get_party_status whenever you need HP, positions, inventory or ids.
- Players may roll on their phones; you then get a note like "Sam as Thorin rolled Stealth: 17". Use it if it fits, don't re-roll.

NEW CHARACTERS (character builder)
- If a player without a character asks to make one, call start_character_builder. The host can also start it; you then get a CHARACTER BUILDER note.
- Interview that one player like a friendly session-zero DM: concept first, then SRD species, class, background, ability scores (standard array 15,14,13,12,10,8), skills, equipment, spells, name and look. Offer 2-3 fitting choices at a time; use lookup_rule for species/class/background details.
- After each decision call draft_character_update with just the new fields; the draft shows live on the host screen and the player's phone. It returns what is still missing.
- When nothing is missing, recap in one or two sentences, then call finalize_character. Then welcome the new hero into the story.`;

function partyBlock(state: GameState): string {
  if (!state.characters.length) return "No characters yet.";
  return state.characters
    .map((c) => {
      const mods = (["str", "dex", "con", "int", "wis", "cha"] as const).map((k) => `${k.toUpperCase()} ${formatMod(abilityMod(c.abilities[k]))}`).join(" ");
      return `- ${c.name} [id ${c.id}] played by ${c.playerName}: ${c.species} ${c.className} ${c.level}, AC ${c.ac}, HP ${c.hp}/${c.maxHp}, PB +${c.proficiencyBonus}, ${mods}; skills: ${c.skills.join(", ") || "-"}; attacks: ${c.attacks.map((a) => `${a.name} ${a.toHit !== undefined ? formatMod(a.toHit) : ""} ${a.damage ?? ""}`.trim()).join("; ") || "-"}; ${c.diceMode === "physical" ? "rolls PHYSICAL dice" : "virtual dice"}`;
    })
    .join("\n");
}

const NPC_TTS_NOTE = `NPC VOICE LINES
- speak_as_npc plays one short line in the NPC's own recorded voice on the table speaker. Use it sparingly (at most once per scene) for dramatic moments: a villain's threat, a reveal, a dying word. Never for routine dialogue. After calling it, do not repeat the line; wait briefly, then continue.`;

export interface InstructionOptions {
  /** The speak_as_npc tool is enabled (NPC_TTS). */
  npcTts?: boolean;
}

function npcLine(n: { name: string; description: string; motive: string; voice?: string }) {
  return `- ${n.name}: ${n.description} Wants: ${n.motive}${n.voice?.trim() ? ` Voice: ${n.voice.trim()}` : ""}`;
}

export function buildInstructions(campaign: Campaign | undefined, state: GameState, opts: InstructionOptions = {}): string {
  const parts = [PERSONA];
  if (opts.npcTts) parts.push(NPC_TTS_NOTE);
  const o = campaign?.outline;
  if (campaign) {
    parts.push(`\nADVENTURE: ${o?.title ?? campaign.name}\nHook: ${o?.hook ?? campaign.premise}`);
    if (o?.acts.length) parts.push(`Acts:\n${o.acts.map((a, i) => `${i + 1}. ${a.title}: ${a.summary}`).join("\n")}`);
    if (o?.locations.length) parts.push(`Locations (use ids with change_scene):\n${o.locations.map((l) => `- ${l.id}: ${l.name}`).join("\n")}`);
    const loc = o?.locations.find((l) => l.id === state.locationId);
    if (loc) {
      parts.push(`CURRENT LOCATION: ${loc.name} (grid ${loc.gridW}x${loc.gridH}, x=0 left, y=0 top)\n${loc.description}`);
      const enc = o?.encounters.filter((e) => e.locationId === loc.id) ?? [];
      if (enc.length) parts.push(`Planned encounters here:\n${enc.map((e) => `- ${e.description} (${e.monsters.map((m) => `${m.count}x ${m.name}`).join(", ")})`).join("\n")}`);
    }
    if (o?.npcs.length) parts.push(`NPCs:\n${o.npcs.map(npcLine).join("\n")}`);
    const last = campaign.sessionSummaries.at(-1);
    if (last) parts.push(`LAST SESSION RECAP:\n${last.summary}`);
  }
  parts.push(`\nPARTY:\n${partyBlock(state)}`);
  if (state.builder) {
    const b = state.builder;
    const missing = missingFields(b.draft);
    parts.push(
      `\nCHARACTER BUILDER ACTIVE: interviewing ${b.playerName} for a level ${b.level} character.\nDraft so far: ${JSON.stringify(b.draft)}\nStill missing: ${missing.join(", ") || "nothing - read it back and call finalize_character"}`,
    );
  }
  return parts.join("\n");
}

export function openingPrompt(campaign: Campaign | undefined, state: GameState): string {
  const recap = campaign?.sessionSummaries.length ? "Give a short dramatic recap of last session, then" : "Welcome the players warmly, introduce the adventure's hook in a few vivid sentences, then";
  const loc = campaign?.outline?.locations.find((l) => l.id === state.locationId);
  return `${recap} set the scene${loc ? ` at ${loc.name}` : ""} and ask the party what they do.`;
}
