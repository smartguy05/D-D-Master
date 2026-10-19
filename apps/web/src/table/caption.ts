/**
 * Subtitle pacing for the NPC close-up (pure, tested). The DM's transcript arrives ahead of its
 * audio, so the text is revealed at speaking rate from the first piece, never ahead of what has
 * arrived; once the line is final and the voice stopped, all of it shows, then it fades after
 * CAPTION_LINGER_MS.
 */

/** Characters per second revealed (about the DM's speaking pace). */
export const CAPTION_CPS = 15;
/** How long a finished line stays on screen after the voice stopped. */
export const CAPTION_LINGER_MS = 4000;

export interface CaptionLine {
  id: string;
  text: string;
  final: boolean;
  /** When the first piece arrived (reveal starts). */
  startedAt: number;
  /** When the voice stopped after the line was final (linger starts); unset while it's still talking. */
  endedAt?: number;
  /** A speak_as_npc clip (see clipLine). */
  clip?: boolean;
}

/** Add a caption piece (not final: append) or the whole line (final: replace); a new id starts a new line. */
export function applyCaption(line: CaptionLine | null, c: { id: string; text: string; final: boolean }, now: number): CaptionLine {
  if (!line || line.id !== c.id) return { id: c.id, text: c.text, final: c.final, startedAt: now };
  return { ...line, text: c.final ? c.text : line.text + c.text, final: c.final || line.final, endedAt: undefined };
}

/** The voice is (still) speaking or stopped: a final line starts its linger when the voice stops. */
export function voiceChanged(line: CaptionLine | null, speaking: boolean, now: number): CaptionLine | null {
  if (!line || line.clip) return line;
  if (speaking) return line.endedAt === undefined ? line : { ...line, endedAt: undefined };
  return line.final && line.endedAt === undefined ? { ...line, endedAt: now } : line;
}

/** A clip's line (speak_as_npc) ends when its text would have been spoken; the voice state doesn't apply. */
export function clipLine(line: CaptionLine): CaptionLine {
  return { ...line, clip: true, endedAt: line.startedAt + (line.text.length / CAPTION_CPS) * 1000 };
}

/** The text to show now: revealed at CAPTION_CPS, all of it once the line ended; cut at a word. */
export function shownText(line: CaptionLine, now: number): string {
  if (line.endedAt !== undefined && now >= line.endedAt) return line.text;
  const n = Math.floor(((now - line.startedAt) / 1000) * CAPTION_CPS);
  if (n >= line.text.length) return line.text;
  const cut = line.text.lastIndexOf(" ", n);
  return line.text.slice(0, cut > 0 ? cut : n);
}

export function captionVisible(line: CaptionLine | null, now: number): boolean {
  return !!line && (line.endedAt === undefined || now - line.endedAt < CAPTION_LINGER_MS);
}
