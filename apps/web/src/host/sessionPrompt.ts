import type { Campaign } from "@dm/shared";

/**
 * Whether the host should be prompted to end the session (stop the DM and write the recap) because
 * the campaign has ended (completed or failed). Without it a finished campaign's DM keeps running
 * until someone remembers to close it. True while the DM is still live, or while no recap has been
 * written since the campaign ended. See docs/web/host-ui.md.
 */
export function endSessionPrompt(campaign: Campaign | null, dmLive: boolean): boolean {
  if (!campaign || (campaign.status !== "completed" && campaign.status !== "failed")) return false;
  if (dmLive) return true;
  const since = campaign.completedAt;
  return since !== undefined && !campaign.sessionSummaries.some((s) => s.ts >= since);
}
