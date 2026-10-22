import type { LogEntry } from "@dm/shared";

/**
 * The /play page's running transcript: until the DM's voice reaches remote players (phase 5,
 * WebRTC), they follow the game by reading the DM's replies and what players said. These come from
 * the log in the (projected) state; roll lines are left out, the dice tray shows those.
 */
export interface TranscriptLine {
  id: string;
  who: string;
  text: string;
  dm: boolean;
}

export function transcriptLines(log: readonly LogEntry[], max: number): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  for (let i = log.length - 1; i >= 0 && out.length < max; i--) {
    const e = log[i]!;
    if (e.kind !== "dm" && e.kind !== "player") continue;
    const text = e.text.trim();
    if (!text) continue;
    out.push({ id: e.id, who: e.speaker || (e.kind === "dm" ? "DM" : "Player"), text, dm: e.kind === "dm" });
  }
  return out.reverse();
}
