import type { DmStatus } from "@dm/shared";

/**
 * The TV's DM orb. While the table mic is hard-muted, a listening DM shows "Muted", matching the
 * "The DM isn't listening" banner; thinking (a typed message or a host note is being answered),
 * speaking and offline stay as they are.
 */
function mutedNow(status: DmStatus, micMuted: boolean): boolean {
  return micMuted && status === "listening";
}

export function orbClass(status: DmStatus, micMuted: boolean): string {
  return mutedNow(status, micMuted) ? "muted" : status;
}

export function orbLabel(status: DmStatus, micMuted: boolean, npcName?: string): string {
  if (mutedNow(status, micMuted)) return "Muted";
  if (status === "speaking") return npcName ? `${npcName} speaks…` : "The DM speaks…";
  if (status === "thinking") return "The DM ponders…";
  if (status === "listening") return "Listening";
  if (status === "connecting") return "Summoning the DM…";
  return "DM offline";
}
