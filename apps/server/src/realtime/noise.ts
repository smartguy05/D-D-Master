/**
 * Noise-turn detection for the voice DM's transcript gate. Semantic VAD can commit a cough, a
 * sneeze or an "uh" as a turn; the DM shouldn't answer those ("bless you", "did someone say
 * something?"). Pure and conservative: anything with a real word in it is kept.
 */

/** Below this speech length (VAD audio_start..end, incl. prefix padding) a one-word turn with no voice match is noise. */
export const SHORT_UNMATCHED_MS = 300;

/** Hesitations and body noises, matched per word after lower-casing (stretched forms like "ummm" included). */
const FILLER_WORD = /^(u+h+|u+m+|u+h+m+|h+m+|m+|m+h+m+|m+-?h+m+|e+r+m*|a+h+|o+h+|e+h+|a+c+h+o+o+|cough(s|ing)?|sneez(e|es|ing)|ahem|you)$/;

/** Social phrases that are not meant for the DM when they are the whole turn. */
const FILLER_PHRASES = [/\bbless you\b/g, /\bgesundheit\b/g];

/** Transcriber annotations for non-speech: [noise], (coughs), *sneeze*, [BLANK_AUDIO]. */
const ANNOTATION = /\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g;

export interface NoiseContext {
  /** Length of the committed speech in ms, if known. */
  speechMs?: number;
  /** Voice ID matched a player (true), found no match (false), or wasn't available (undefined). */
  voiceMatched?: boolean;
}

/** True if the turn has no words meant for the DM: empty, punctuation, fillers, annotations only. */
export function isNoiseTranscript(text: string, ctx: NoiseContext = {}): boolean {
  const t = text.toLowerCase().replace(ANNOTATION, " ");
  // "bless you" alone is noise; "bless you, priest, …" keeps its other words and is kept.
  const phrases = FILLER_PHRASES.reduce((acc, re) => acc.replace(re, " "), t);
  const words = (s: string) =>
    s
      .split(/[^\p{L}\p{N}'-]+/u)
      .map((w) => w.replace(/^[-']+|[-']+$/g, ""))
      .filter(Boolean);
  const real = words(phrases).filter((w) => !FILLER_WORD.test(w));
  if (real.length === 0) return true;
  if (real.length === 1 && ctx.voiceMatched === false && ctx.speechMs !== undefined && ctx.speechMs < SHORT_UNMATCHED_MS) return true;
  return false;
}
