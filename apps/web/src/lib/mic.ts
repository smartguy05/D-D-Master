/**
 * Table mic mute (hard mute). The server holds the flag (POST /api/mic, or /api/players/:id/mic
 * from a phone) and broadcasts it; /host applies it to the shared mic stream, which silences both
 * the WebRTC DM and voice ID without renegotiating the call.
 */

/** Disable (muted) or re-enable every audio track of the shared table mic. */
export function applyMicMute(stream: { getAudioTracks(): { enabled: boolean }[] } | null, muted: boolean) {
  for (const t of stream?.getAudioTracks() ?? []) t.enabled = !muted;
}

/** The mute hotkey (P), unless the user is typing in a field. */
export function isMicHotkey(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; target: unknown }): boolean {
  if (e.key !== "p" && e.key !== "P") return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  const t = e.target as { tagName?: string; isContentEditable?: boolean } | null;
  return !(t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName ?? ""));
}
