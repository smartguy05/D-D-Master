/**
 * Typed input to the DM (POST /api/dm/say; the /play page's text box). Shared so the page and the
 * server cap it the same way: the server enforces it, the page only mirrors it.
 */

/** Longest typed message sent to the DM. */
export const SAY_MAX = 500;

/** A seat-bound caller (a remote player) may type to the DM at most once per this long. */
export const SAY_MIN_GAP_MS = 2_000;

/** Typed input as sent to the DM: trimmed and capped; undefined when blank. */
export function sayText(raw: unknown): string | undefined {
  const t = typeof raw === "string" ? raw.trim() : "";
  return t ? t.slice(0, SAY_MAX) : undefined;
}
