import { z } from "zod";
import { abilityMod, formatMod, presentCharacters, type Character, type GameState, type LogEntry, type Player, type ServerEvent } from "@dm/shared";
import { completeJson, type LLMProvider } from "../brain/provider.js";
import { rulesSummary } from "../engine/rules/derive.js";
import type { NpcSlot } from "../realtime/npc-queue.js";

/**
 * AI players: a seat at the table played by an LLM. After every finished DM reply the controller
 * picks at most one AI player who should act (its combat turn, someone spoke to it, or an
 * occasional unprompted line), asks the model for one line, plays it on the table speaker in the
 * AI's own voice, and then hands it to the DM as a typed player line. The AI never calls tools:
 * the DM resolves its actions and rolls for it like for anyone else.
 */

/** Why an AI player acts now. combat_turn and nudge must produce a line; the others may pass. */
export type AiTrigger = "combat_turn" | "addressed" | "spontaneous" | "nudge";

export type AiPlayerStatus = "idle" | "thinking" | "speaking";

/** Transcript entries the AI sees. */
export const AI_TRANSCRIPT_ENTRIES = 40;
/** An AI line is at most this long (it is spoken aloud; the DM gets the same text). */
export const AI_LINE_MAX_CHARS = 400;

export const AiPlayerReply = z.object({
  speak: z.boolean(),
  line: z.string(),
});
export type AiPlayerReply = z.infer<typeof AiPlayerReply>;

export interface AiSeat {
  player: Player;
  character: Character;
}

const isDead = (c: Character) => c.conditions.some((x) => x.toLowerCase() === "dead");

/** AI players who can act now: AI on, not paused, with a living character in the focused scene. */
export function activeAiSeats(state: GameState): AiSeat[] {
  const present = presentCharacters(state);
  return state.players
    .filter((p) => p.ai && !p.aiPaused && p.characterId)
    .map((p) => ({ player: p, character: present.find((c) => c.id === p.characterId) }))
    .filter((s): s is AiSeat => !!s.character && s.character.hp > 0 && !isDead(s.character));
}

/** Combat turn key (changes with every turn), or undefined out of combat. */
export function turnKey(state: GameState): string | undefined {
  return state.combat.active ? `${state.combat.round}:${state.combat.turnIndex}` : undefined;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The names someone would call this seat by: the character's full and first name, the player's name. */
function callNames(seat: AiSeat): string[] {
  const first = seat.character.name.trim().split(/\s+/)[0] ?? "";
  return [seat.character.name.trim(), first, seat.player.name.trim()].filter((n) => n.length >= 3);
}

/**
 * The text speaks to this seat: a sentence that names it and asks a question ("Thorin, what do
 * you do?") or opens with its name ("Mira, the door creaks open…"). Plain narration that mentions
 * the character ("Thorin's axe bites deep") doesn't count.
 */
export function addresses(text: string, seat: AiSeat): boolean {
  const sentences = text.split(/(?<=[.!?])\s+/);
  return callNames(seat).some((name) => {
    const re = new RegExp(`\\b${escape(name)}\\b`, "i");
    const opens = new RegExp(`^["'“]?${escape(name)}\\s*,`, "i");
    return sentences.some((s) => re.test(s) && (/\?["'”’)]*$/.test(s.trim()) || opens.test(s.trim()) || /\byou'?re up\b|\byour turn\b/i.test(s)));
  });
}

/** A DM line that asks the whole party ("What do you do?", "Anyone?"). */
export function asksParty(text: string): boolean {
  return /\?["'”’)]*\s*$/.test(text.trim()) && /\b(what do you( all)? do|what do you want to do|anyone|everyone|any of you|the (rest of the )?party|you all|y'all)\b/i.test(text);
}

export interface PickContext {
  /** Log entries since the last check (DM and player lines). */
  newEntries: LogEntry[];
  now: number;
  /** When each AI player last spoke (by player id). */
  lastSpokeAt: ReadonlyMap<string, number>;
  /** The combat turn key each AI player last acted on (by player id). */
  actedTurn: ReadonlyMap<string, string>;
  cooldownMs: number;
}

/** Log label of a seat's typed lines (GameService.speakerLabel). */
export const seatLabel = (seat: AiSeat) => `${seat.player.name} as ${seat.character.name}`;

/**
 * Which AI player acts after this DM reply, and why. Priority: the AI whose combat turn it is,
 * then one that was spoken to, then (out of combat, after the cooldown) one unprompted line.
 * At most one per reply, so AI players never pile up lines.
 */
export function pickAiTurn(state: GameState, ctx: PickContext): { seat: AiSeat; trigger: AiTrigger } | undefined {
  const seats = activeAiSeats(state);
  if (!seats.length) return undefined;
  const key = turnKey(state);
  if (key) {
    const cur = state.combat.order[state.combat.turnIndex];
    const own = cur?.entityType === "character" ? seats.find((s) => s.character.id === cur.entityId) : undefined;
    if (own && ctx.actedTurn.get(own.player.id) !== key) return { seat: own, trigger: "combat_turn" };
  }
  // Lines the seat itself said don't address it.
  const heard = (seat: AiSeat) => ctx.newEntries.filter((e) => (e.kind === "dm" || e.kind === "player") && e.speaker !== seatLabel(seat));
  const spokenTo = seats.find((s) => heard(s).some((e) => addresses(e.text, s)));
  if (spokenTo) return { seat: spokenTo, trigger: "addressed" };
  if (key) return undefined;
  const leastRecent = [...seats].sort((a, b) => (ctx.lastSpokeAt.get(a.player.id) ?? 0) - (ctx.lastSpokeAt.get(b.player.id) ?? 0))[0];
  const dmLines = ctx.newEntries.filter((e) => e.kind === "dm" && e.speaker === "DM");
  if (dmLines.some((e) => asksParty(e.text))) return { seat: leastRecent, trigger: "addressed" };
  const last = Math.max(0, ...seats.map((s) => ctx.lastSpokeAt.get(s.player.id) ?? 0));
  if (dmLines.length && ctx.now - last >= ctx.cooldownMs) return { seat: leastRecent, trigger: "spontaneous" };
  return undefined;
}

/** The character sheet as the AI sees it. */
export function characterSheet(c: Character): string {
  const mods = (["str", "dex", "con", "int", "wis", "cha"] as const).map((k) => `${k.toUpperCase()} ${c.abilities[k]} (${formatMod(abilityMod(c.abilities[k]))})`).join(", ");
  const rules = rulesSummary(c);
  return [
    `${c.name}: ${c.species} ${c.className}${c.subclass ? ` (${c.subclass})` : ""} level ${c.level}${c.background ? `, ${c.background}` : ""}`,
    `HP ${c.hp}/${c.maxHp}${c.tempHp ? ` +${c.tempHp} temp` : ""}, AC ${c.ac}, speed ${c.speed} ft, proficiency +${c.proficiencyBonus}`,
    `Abilities: ${mods}`,
    `Saves: ${c.savingThrows.join(", ") || "-"}; skills: ${c.skills.join(", ") || "-"}`,
    `Attacks: ${c.attacks.map((a) => `${a.name}${a.toHit !== undefined ? ` ${formatMod(a.toHit)}` : ""}${a.damage ? ` ${a.damage}` : ""}`).join("; ") || "-"}`,
    c.spells.length ? `Spells: ${c.spells.join(", ")}` : "",
    rules ? `Resources: ${rules}` : "",
    c.features.length ? `Features: ${c.features.join("; ")}` : "",
    `Conditions: ${c.conditions.join(", ") || "none"}`,
    `Inventory: ${c.inventory.map((i) => (i.qty > 1 ? `${i.name} x${i.qty}` : i.name)).join(", ") || "-"}; ${c.gold} gp`,
    c.appearance ? `Looks: ${c.appearance}` : "",
    c.notes ? `Notes: ${c.notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const TRIGGER_TEXT: Record<AiTrigger, string> = {
  combat_turn:
    "It is YOUR TURN in combat now. Declare your whole turn to the DM: where you move (use the grid), your action (attack whom with what, or which spell at whom), and any bonus action. You must speak.",
  addressed: "Someone just spoke to you or asked the party what they do. Answer in character if your character would; if the question was clearly for someone else, set speak to false.",
  spontaneous:
    "Nobody asked you anything. Speak only if your character would naturally chime in now (a remark, an idea, a question to an NPC, a plan); otherwise set speak to false. Don't interrupt every scene.",
  nudge: "The host asks you to say or do something now. You must speak.",
};

/** The system and user prompts for one AI player decision. */
export function aiPlayerPrompt(input: { seat: AiSeat; trigger: AiTrigger; board: unknown; transcript: LogEntry[]; adventure?: string }): { system: string; prompt: string } {
  const { seat, trigger } = input;
  const c = seat.character;
  const system = [
    `You are ${seat.player.name}, a player at an in-person D&D 5e (2024) table, playing the character ${c.name}. A voice AI is the Dungeon Master; the other players are people sitting at the table.`,
    seat.player.aiPersona.trim() ? `Your personality and playstyle: ${seat.player.aiPersona.trim()}` : "Play a friendly, cooperative player who keeps the game moving and gives other players room.",
    "Your line is spoken aloud to the table in your own voice, then the DM hears it. Rules:",
    "- First person, as a player talking to the DM: say what you do and/or speak in character. 1-3 short sentences, no stage directions, no emoji, no markdown.",
    "- Declare intent only (\"I move next to the orc and swing my axe at it\"). Never roll dice, invent results, damage, or what NPCs or monsters do: the DM decides and rolls for you.",
    "- Never speak or act for other players' characters. Stay consistent with your sheet, your HP and resources, and the board.",
    "- Act like a good table-mate: work with the party, pick sensible tactics, don't hog the spotlight.",
  ].join("\n");
  const transcript = input.transcript.map((l) => `${l.speaker ? `${l.speaker}: ` : ""}${l.text}`).join("\n");
  const prompt = [
    input.adventure ? `ADVENTURE: ${input.adventure}` : "",
    `YOUR CHARACTER SHEET\n${characterSheet(c)}`,
    `BOARD (game state as JSON; pos is [x, y] in 5 ft grid cells, x=0 left, y=0 top)\n${JSON.stringify(input.board)}`,
    `RECENT TRANSCRIPT (oldest first)\n${transcript || "(nothing yet)"}`,
    `NOW: ${TRIGGER_TEXT[trigger]}`,
    'Reply with {"speak": true|false, "line": "what you say"}.',
  ]
    .filter(Boolean)
    .join("\n\n");
  return { system, prompt };
}

/** The speech-voice direction for a seat (the persona colours it). */
export function aiVoiceDirection(seat: AiSeat): string {
  const c = seat.character;
  const persona = seat.player.aiPersona.trim();
  return `A player at a game table voicing ${c.name}, a ${`${c.species} ${c.className}`.trim()}. Natural, conversational and in character${persona ? `; ${persona.slice(0, 200)}` : ""}.`;
}

/** What the controller needs from the game (implemented by GameService). */
export interface AiPlayerHost {
  state(): GameState | null;
  /** The board for the prompt (get_party_status). */
  board(): unknown;
  adventure(): string | undefined;
  llm(): LLMProvider | undefined;
  /** The DM is live and can take a typed line. */
  dmLive(): boolean;
  /**
   * Play the line on the table speaker in the seat's voice; resolves when it has played (or right
   * away when speech is off or fails: the DM still gets the text).
   */
  speak(seat: AiSeat, line: string): Promise<void>;
  /** Hand the line to the DM as the seat's typed player line (GameService.sendText). */
  say(line: string, playerId: string): void;
  broadcast(ev: ServerEvent): void;
  warn(message: string): void;
}

export interface AiPlayerOptions {
  cooldownMs: number;
  now?: () => number;
}

/** Runs AI players: one decision at a time, at most one line per DM reply. */
export class AiPlayerController {
  private busy = false;
  /** A reply finished while busy: look again once done. */
  private again = false;
  private lastSeenId?: string;
  private readonly lastSpokeAt = new Map<string, number>();
  private readonly actedTurn = new Map<string, string>();
  private readonly status = new Map<string, AiPlayerStatus>();

  constructor(
    private host: AiPlayerHost,
    private opts: AiPlayerOptions,
  ) {}

  private now() {
    return this.opts.now?.() ?? Date.now();
  }

  /** The DM finished a reply: maybe an AI player acts. */
  onReplyDone(): Promise<void> {
    return this.consider();
  }

  /** Host "Nudge": this AI player says or does something now (ignores the cooldown, not the pause). */
  nudge(playerId: string): { ok: boolean; error?: string } {
    const state = this.host.state();
    const seat = state && activeAiSeats(state).find((s) => s.player.id === playerId);
    if (!seat) return { ok: false, error: "That player is not an active AI player (AI on, not paused, with a living character in the scene)." };
    if (!this.host.dmLive()) return { ok: false, error: "The DM is not running." };
    if (this.busy) return { ok: false, error: "An AI player is already deciding; try again in a moment." };
    this.markSeen(state);
    void this.run(seat, "nudge");
    return { ok: true };
  }

  /** Forget per-session memory (new campaign or session). */
  reset() {
    this.lastSeenId = undefined;
    this.lastSpokeAt.clear();
    this.actedTurn.clear();
  }

  statusOf(playerId: string): AiPlayerStatus {
    return this.status.get(playerId) ?? "idle";
  }

  private markSeen(state: GameState) {
    this.lastSeenId = state.log.at(-1)?.id;
  }

  private newEntries(state: GameState): LogEntry[] {
    const i = this.lastSeenId ? state.log.findIndex((l) => l.id === this.lastSeenId) : -1;
    return state.log.slice(i + 1);
  }

  private async consider(): Promise<void> {
    if (this.busy) {
      this.again = true;
      return;
    }
    const state = this.host.state();
    if (!state || !this.host.dmLive() || !this.host.llm() || state.builder) return;
    const newEntries = this.newEntries(state);
    this.markSeen(state);
    const pick = pickAiTurn(state, { newEntries, now: this.now(), lastSpokeAt: this.lastSpokeAt, actedTurn: this.actedTurn, cooldownMs: this.opts.cooldownMs });
    if (!pick) return;
    await this.run(pick.seat, pick.trigger);
  }

  private setStatus(playerId: string, status: AiPlayerStatus, line?: string) {
    this.status.set(playerId, status);
    this.host.broadcast({ type: "ai_player", playerId, status, ...(line ? { line } : {}) });
  }

  private async run(seat: AiSeat, trigger: AiTrigger) {
    const llm = this.host.llm();
    const state = this.host.state();
    if (!llm || !state) return;
    this.busy = true;
    const id = seat.player.id;
    const key = turnKey(state);
    const lastLog = state.log.at(-1)?.id;
    this.setStatus(id, "thinking");
    try {
      const transcript = state.log.filter((l) => l.kind === "dm" || l.kind === "player" || l.kind === "roll").slice(-AI_TRANSCRIPT_ENTRIES);
      const { system, prompt } = aiPlayerPrompt({ seat, trigger, board: this.host.board(), transcript, adventure: this.host.adventure() });
      const reply = await completeJson(llm, { system, prompt, maxTokens: 2000, schema: AiPlayerReply, schemaName: "AiPlayerReply" });
      const line = reply.line.trim().slice(0, AI_LINE_MAX_CHARS);
      const forced = trigger === "combat_turn" || trigger === "nudge";
      if ((!reply.speak && !forced) || !line) return;
      // The table moved on while the model thought (someone spoke, the turn passed): drop the line.
      const now = this.host.state();
      const moved = !now || turnKey(now) !== key || (trigger !== "nudge" && now.log.at(-1)?.id !== lastLog);
      if (moved || !this.host.dmLive()) return;
      if (key && trigger === "combat_turn") this.actedTurn.set(id, key);
      this.lastSpokeAt.set(id, this.now());
      this.setStatus(id, "speaking", line);
      await this.host.speak(seat, line);
      if (this.host.dmLive()) this.host.say(line, id);
    } catch (err) {
      this.host.warn(`AI player ${seat.player.name}: ${(err as Error).message}`);
    } finally {
      this.busy = false;
      this.setStatus(id, "idle");
    }
    if (this.again) {
      this.again = false;
      await this.consider();
    }
  }
}

/** Map an NpcSlot-based speaker into AiPlayerHost.speak (GameService wires the voice in). */
export async function playOnSlot(slot: NpcSlot, synth: () => Promise<{ url: string; durationMs: number }>, npcName: string, line: string): Promise<void> {
  let clip;
  try {
    clip = await synth();
  } catch (err) {
    slot.cancel();
    throw err;
  }
  if (slot.play({ npcName, line, url: clip.url, durationMs: clip.durationMs })) await slot.done;
}
