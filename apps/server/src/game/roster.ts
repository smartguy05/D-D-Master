import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { RosterEntry, type Character } from "@dm/shared";
import { newId } from "../engine/ids.js";
import { freshCharacter } from "./reset.js";

/**
 * The global character roster: heroes saved outside any campaign so they can join another one with
 * their level, items, gold, features and voiceprint. Rows live in the store (roster_characters,
 * roster_voiceprints); portraits are copied to <dataDir>/roster/assets so deleting the source
 * campaign keeps them. GameService (saveToRoster, joinFromRoster...) uses these pure helpers.
 */

/**
 * The roster copy of a character: its build, maxima, inventory and gold, restored to fresh (full HP,
 * no conditions, death saves or concentration, every slot, hit die and resource unused). Does not
 * mutate its input.
 */
export function snapshotForRoster(character: Character): Character {
  return freshCharacter(character);
}

/** The list row the host shows for a roster hero. */
export function rosterEntryFrom(row: { id: string; data: Character; updatedAt: number }, hasVoiceprint: boolean): RosterEntry {
  const d = row.data;
  return RosterEntry.parse({
    id: row.id,
    name: d.name,
    playerName: d.playerName,
    className: d.className,
    subclass: d.subclass,
    level: d.level,
    species: d.species,
    ...(d.spriteUrl ? { spriteUrl: d.spriteUrl } : {}),
    hasVoiceprint,
    updatedAt: row.updatedAt,
  });
}

/** Ids and file names that are safe as one path segment. */
const SAFE_ID = /^[\w-]+$/;
/** A campaign asset URL: /media/<campaignId>/<file>.png (no traversal: the id has no dots or slashes). */
const MEDIA_PNG = /^\/media\/([\w-]+)\/([\w-][\w.-]*\.png)$/;

export const ROSTER_MEDIA_ID = "roster";

export function rosterAssetDir(dataDir: string): string {
  return join(dataDir, ROSTER_MEDIA_ID, "assets");
}

function rosterPortraitPath(dataDir: string, rosterId: string): string | undefined {
  return SAFE_ID.test(rosterId) ? join(rosterAssetDir(dataDir), `${rosterId}.png`) : undefined;
}

/**
 * The portrait file keeps one name per roster id and is overwritten on every save, but /media is
 * served `immutable`; a content-hash query (?v=) gives each version its own URL so browsers refetch.
 */
const rosterPortraitUrl = (rosterId: string, file: string) =>
  `/media/${ROSTER_MEDIA_ID}/${rosterId}.png?v=${createHash("sha1").update(readFileSync(file)).digest("hex").slice(0, 12)}`;

/**
 * Copy a character's sprite (a /media/<campaignId>/<file>.png url) to the roster portrait
 * <dataDir>/roster/assets/<rosterId>.png. Returns the roster url (/media/roster/<rosterId>.png?v=<content hash>), served
 * by the existing /media route. A missing or foreign source keeps the previous roster portrait; with
 * none, returns undefined.
 */
export function saveRosterPortrait(dataDir: string, rosterId: string, spriteUrl: string | undefined): string | undefined {
  const dest = rosterPortraitPath(dataDir, rosterId);
  if (!dest) return undefined;
  const m = spriteUrl ? MEDIA_PNG.exec(spriteUrl) : null;
  if (m) {
    const src = join(dataDir, m[1], "assets", m[2]);
    if (src !== dest && existsSync(src)) {
      mkdirSync(rosterAssetDir(dataDir), { recursive: true });
      copyFileSync(src, dest);
    }
  }
  return existsSync(dest) ? rosterPortraitUrl(rosterId, dest) : undefined;
}

/** Copy a roster portrait into a campaign's assets; returns its /media/<campaignId>/<file>.png url, or undefined without one. */
export function copyRosterPortraitTo(dataDir: string, rosterId: string, campaignId: string): string | undefined {
  const src = rosterPortraitPath(dataDir, rosterId);
  if (!src || !SAFE_ID.test(campaignId) || !existsSync(src)) return undefined;
  const dir = join(dataDir, campaignId, "assets");
  mkdirSync(dir, { recursive: true });
  const file = `${newId("sprite")}.png`;
  copyFileSync(src, join(dir, file));
  return `/media/${campaignId}/${file}`;
}

/** Remove a roster portrait file (no error when there is none). */
export function deleteRosterPortrait(dataDir: string, rosterId: string) {
  const p = rosterPortraitPath(dataDir, rosterId);
  if (p) rmSync(p, { force: true });
}
