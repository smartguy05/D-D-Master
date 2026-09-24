import { Outline } from "@dm/shared";
import { newId } from "../engine/ids.js";

/**
 * Validate a host-edited outline and merge it with the saved one.
 * - Locations/encounters without an id get a fresh one.
 * - `mapUrl` is server-owned: a location keeps its saved map unless its `mapPrompt` changed
 *   (then it is cleared so the host can repaint it). Client-sent `mapUrl`s are ignored.
 * - Location ids must be unique and every encounter must point at an existing location.
 */
export function mergeOutline(prev: Outline | undefined, input: unknown): Outline {
  const withIds = fillIds(input);
  const parsed = Outline.safeParse(withIds);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    throw new Error(`Invalid outline: ${i?.path.join(".") || "root"}: ${i?.message}`);
  }
  const next = parsed.data;
  const ids = new Set<string>();
  for (const l of next.locations) {
    if (ids.has(l.id)) throw new Error(`Invalid outline: duplicate location id ${l.id}`);
    ids.add(l.id);
    const old = prev?.locations.find((p) => p.id === l.id);
    if (old?.mapUrl && old.mapPrompt === l.mapPrompt) l.mapUrl = old.mapUrl;
    else delete l.mapUrl;
  }
  for (const e of next.encounters) {
    if (!ids.has(e.locationId)) throw new Error(`Invalid outline: encounter "${e.description || e.id}" points at unknown location ${e.locationId}`);
  }
  return next;
}

function fillIds(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const o = { ...(input as Record<string, unknown>) };
  const withId = (prefix: string) => (x: unknown) =>
    x && typeof x === "object" && !(x as { id?: unknown }).id ? { ...(x as object), id: newId(prefix) } : x;
  if (Array.isArray(o.locations)) o.locations = o.locations.map(withId("loc"));
  if (Array.isArray(o.encounters)) o.encounters = o.encounters.map(withId("enc"));
  return o;
}
