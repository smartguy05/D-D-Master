import type { Campaign, Character, GameState, RosterEntry } from "@dm/shared";

/**
 * Pure helpers for the host's global character roster (RosterPanel, PartyTab save buttons and the
 * end-of-campaign "save to roster" prompt). See docs/gameplay/character-roster.md.
 */

/** "Fighter (Champion) · Lv 5"; "Fighter · Lv 5" without a subclass; "Adventurer · Lv 1" without a class. */
export function rosterLabel(entry: Pick<RosterEntry, "className" | "subclass" | "level">): string {
  const cls = entry.className.trim() || "Adventurer";
  const sub = entry.className.trim() && entry.subclass.trim() ? ` (${entry.subclass.trim()})` : "";
  return `${cls}${sub} · Lv ${entry.level}`;
}

/** Characters in the campaign that are not linked to a roster entry yet. */
export function unlinkedCharacters(state: GameState | null): Character[] {
  return state ? state.characters.filter((c) => !c.rosterId) : [];
}

/** The unlinked PCs to offer saving once the campaign has ended (completed or failed); [] otherwise. */
export function rosterPrompt(campaign: Campaign | null, state: GameState | null): Character[] {
  if (!campaign || !state) return [];
  if (campaign.status !== "completed" && campaign.status !== "failed") return [];
  return unlinkedCharacters(state);
}

/**
 * A key that changes when the roster may have changed server-side without a host roster call:
 * end_campaign saves every linked PC back to the roster, so the key flips when the campaign ends.
 * HostPage bumps the Roster panel's version whenever it changes.
 */
export function rosterRefreshKey(campaign: Campaign | null): string {
  if (!campaign) return "";
  const ended = campaign.status === "completed" || campaign.status === "failed";
  return `${campaign.id}:${ended ? "ended" : "open"}`;
}

/** Reason a roster entry can't join the active campaign, or null when it can. */
export function joinBlocked(rosterId: string, state: GameState | null): string | null {
  if (!state) return "Load a campaign first";
  const here = state.characters.find((c) => c.rosterId === rosterId);
  return here ? `Already in this campaign as ${here.name}` : null;
}

/** Short relative time for "updated …": "just now", "5 min ago", "3 h ago", "2 d ago". */
export function updatedAgo(updatedAt: number, now: number): string {
  const s = Math.max(0, Math.floor((now - updatedAt) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}
