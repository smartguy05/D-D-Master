/**
 * Board watcher: after a finished reply, did the table hear the party move (a player's "I head to
 * the pie stall", the DM's "Brannoc makes his way to…") while no tool moved a token? The realtime
 * model narrates such moves without move_token, so the map and the fog stay put (a play-test sat
 * at the entrance for a whole scene). Pure: the session decides whether to nudge.
 */

/** Tools that move someone on (or off) the map: any of them in the reply means the board followed. */
export const MOVE_TOOLS = new Set(["move_token", "move_party", "change_scene", "focus_scene"]);

/** A player saying their character goes somewhere. */
const PLAYER_MOVE =
  /\b(i|we|he|she|they|let's|lets|[a-z]+ (?:goes|heads|walks|moves|runs|climbs|enters|descends|crosses|sneaks|approaches))\b.*\b(go|goes|going|head|heads|heading|walk|walks|walking|move|moves|moving|run|runs|approach|approaches|enter|enters|descend|descends|climb|climbs|cross|crosses|sneak|sneaks|advance|advances|proceed|proceeds|step|steps|wander|wanders|make (?:my|our|his|her|their) way)\b/i;
/** The DM narrating someone arriving somewhere (not "who wants to go first?"). */
const DM_MOVE =
  /\b(makes? (?:his|her|their|your) way|join(?:s|ed)? \w+ (?:near|by|at)|reach(?:es|ed)?|arrive[sd]?|walks? (?:to|toward|over|into|down|up|through)|heads? (?:to|toward|over|into|down|up)|descend(?:s|ed)?|climbs?|steps? (?:into|onto|up|over|through)|moves? (?:to|toward|over)|now stands?|crosses|you all (?:go|head|walk|move|descend|enter))\b/i;

const STOP = new Set(["the", "a", "an", "of", "on", "in", "at", "and", "to", "old", "hill", "s"]);

/** The distinctive words of a location name ("The Giggling Graveyard" → giggling, graveyard). */
function nameWords(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 4 && !STOP.has(w));
}

export interface WatchScene {
  inCombat: boolean;
  /** Other locations of the campaign (not the current one). */
  otherLocations: { id: string; name: string }[];
}

export interface WatchInput {
  /** All the DM said in the reply (every tool round). */
  dmText: string;
  /** The player line the reply answered, if any. */
  playerText?: string;
  /** Tools the DM called in the reply. */
  tools: ReadonlySet<string>;
  scene: WatchScene;
}

export interface WatchHit {
  kind: "move" | "travel";
  /** What triggered it, for the log. */
  cue: string;
  /** The system note that asks the DM to fix the board. */
  prompt: string;
}

/** Whether the reply moved people in the story but not on the board (and what to tell the DM), else undefined. */
export function watchReply({ dmText, playerText = "", tools, scene }: WatchInput): WatchHit | undefined {
  if (scene.inCombat) return undefined; // combat moves have their own turn loop and nudges
  if ([...tools].some((t) => MOVE_TOOLS.has(t))) return undefined;
  const player = PLAYER_MOVE.exec(playerText);
  const dm = DM_MOVE.exec(dmText);
  if (!player && !dm) return undefined;
  const text = `${playerText} ${dmText}`.toLowerCase();
  const dest = scene.otherLocations.find((l) => nameWords(l.name).some((w) => new RegExp(`\\b${w}\\b`).test(text)) || text.includes(l.id.toLowerCase()));
  const cue = (player?.[0] ?? dm?.[0] ?? "").slice(0, 60);
  const fix =
    "If anyone changed position, call move_party (the group, to a map feature) or move_token (one character) now so the map and fog follow. Don't repeat your narration; if nobody actually moved, do nothing and say nothing.";
  if (dest)
    return {
      kind: "travel",
      cue: `${cue} -> ${dest.id}`,
      prompt: `[Board check: you described the party moving ("${cue}") but no token moved. If they are leaving for ${dest.name}, call change_scene ${dest.id} now (it runs the ready check). Otherwise: ${fix}]`,
    };
  return { kind: "move", cue, prompt: `[Board check: you described someone moving ("${cue}") but no token moved. ${fix}]` };
}
