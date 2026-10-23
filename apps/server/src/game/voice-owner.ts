import type { VoiceLinkState, VoiceOwnerView } from "@dm/shared";

/**
 * Who carries the voice call and whose mic feeds voice ID. /table runs the call (mic, the DM's
 * audio, WebRTC) so /host can be closed; /host only sends commands, and streams its own mic just
 * for enrollment. Pure so it can be unit-tested; GameService keeps the sockets.
 */

/** "player": a phone recording its own player's voice (a phone enrollment) and nothing else. */
export type AudioRole = "host" | "table" | "player";

/**
 * Which /ws/audio stream feeds the speaker ring (both hear the same table, but interleaved chunks
 * would garble voice ID). While a voice is recorded, the recording's source wins if it streams: the
 * phone for a phone enrollment, else /host. Otherwise the /table stream, or /host when no table
 * streams. A phone stream never feeds play-time voice ID.
 */
export function pickAudioSource(i: { enrolling: boolean; from?: "host" | "player"; host: number; table: number; player?: number }): AudioRole | undefined {
  if (i.enrolling && i.from === "player" && (i.player ?? 0) > 0) return "player";
  if (i.enrolling && i.from !== "player" && i.host > 0) return "host";
  if (i.table > 0) return "table";
  return i.host > 0 ? "host" : undefined;
}

/**
 * The /table screen that gets voice commands: the one whose call is up (it claimed the call),
 * else the newest. A second /table tab never takes a live call away from the first.
 */
export function pickVoiceOwner<T>(tables: readonly T[], claimed: T | undefined): T | undefined {
  return claimed !== undefined && tables.includes(claimed) ? claimed : tables.at(-1);
}

/** What /host shows about the call. */
export function voiceOwnerView(i: { tables: number; link?: { state: VoiceLinkState; error?: string }; tableAudio: number }): VoiceOwnerView {
  const link = i.tables > 0 ? i.link?.state ?? "idle" : "idle";
  const error = i.tables > 0 ? i.link?.error : undefined;
  return { table: i.tables > 0, link, ...(error && { error }), micStream: i.tableAudio > 0 };
}
