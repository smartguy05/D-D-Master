import type { Location, LocationFog } from "@dm/shared";

/**
 * Fog badge for a location card. A visited location has a fog entry, and that entry is what the TV
 * shows (a set_fog override beats the outline). Before the first visit, the outline's `fog` flag says
 * whether change_scene will turn fog on.
 */
export function fogStatus(loc: Pick<Location, "fog">, entry: Pick<LocationFog, "enabled"> | undefined): { on: boolean; label: string } {
  if (entry) return { on: entry.enabled, label: entry.enabled ? "Fog on" : "Fog off" };
  return { on: loc.fog, label: loc.fog ? "Fog on arrival" : "No fog" };
}
