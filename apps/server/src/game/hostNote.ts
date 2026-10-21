import type { GameState } from "@dm/shared";
import { describeArgs } from "./history.js";

/**
 * Host calls the DM isn't told about one by one: fog painted stroke by stroke and token drags would
 * flood its context (it reads positions from get_party_status), and edit_map_feature already
 * refreshes its instructions.
 */
const TOO_CHATTY = new Set(["edit_fog", "move_token", "edit_map_feature"]);

/**
 * The silent system note the live DM gets when the host changes the game from /host or REST, so it
 * doesn't redo it (e.g. spawn the boss a second time). Ids become names; null: nothing to tell.
 * Callers that tell the DM themselves (phone rolls, physical totals) pass `noteDm: false` to runTool.
 */
export function hostActionNote(name: string, args: Record<string, unknown>, before: GameState, after: GameState, output?: unknown): string | null {
  if (TOO_CHATTY.has(name)) return null;
  // Party split: the spotlight moved; the monster lists swap with the scene, so don't list them.
  if (name === "focus_scene" && output && typeof output === "object" && "characters" in output) {
    const o = output as { location: string; characters: string[]; combat: { current?: string; round: number } | null };
    const fight = o.combat ? ` Their fight resumes: it is ${o.combat.current}'s turn (round ${o.combat.round}).` : "";
    return `Host moved the spotlight to ${o.location}: ${o.characters.join(", ")} ${o.characters.length > 1 ? "are" : "is"} now in focus.${fight} Pick up with them; don't call focus_scene again.`;
  }
  const parts = describeArgs(args, [after, before], 60);
  const added = after.monsters.filter((m) => !before.monsters.some((b) => b.id === m.id)).map((m) => m.name);
  const removed = before.monsters.filter((m) => !after.monsters.some((a) => a.id === m.id)).map((m) => m.name);
  // Map objects (place/set/remove): name the object and its id (removed ones from the state before).
  const objAdded = (after.mapObjects ?? []).filter((o) => !(before.mapObjects ?? []).some((b) => b.id === o.id)).map((o) => `${o.name} (${o.id})`);
  const objRemoved = (before.mapObjects ?? []).filter((o) => !(after.mapObjects ?? []).some((a) => a.id === o.id)).map((o) => `${o.name} (${o.id})`);
  const objChanged = typeof args.id === "string" ? (after.mapObjects ?? []).find((o) => o.id === args.id) : undefined;
  const total = output && typeof output === "object" && "total" in output ? (output as { total: unknown }).total : undefined;
  const changes = [
    added.length ? `now on the scene: ${added.join(", ")}` : "",
    removed.length ? `removed: ${removed.join(", ")}` : "",
    objAdded.length ? `on the map: ${objAdded.join(", ")}` : "",
    objRemoved.length ? `taken off the map: ${objRemoved.join(", ")}` : "",
    objChanged ? `object: ${objChanged.name} (${objChanged.id})${objChanged.used ? ", used" : ""}${objChanged.hidden ? ", hidden" : ""}` : "",
    total !== undefined ? `result ${String(total)}` : "",
  ].filter(Boolean);
  return `Host did: ${name}${parts.length ? ` ${parts.join(" ")}` : ""}${changes.length ? ` (${changes.join("; ")})` : ""}. Already done - don't repeat it; take it into account.`;
}
