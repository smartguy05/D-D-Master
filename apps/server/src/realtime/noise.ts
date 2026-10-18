/**
 * Noise-turn detection for the voice DM's transcript gate. Semantic VAD can commit a cough, a
 * sneeze or an "uh" as a turn; the DM shouldn't answer those ("bless you", "did someone say
 * something?"). Pure and conservative: only the words decide, and anything with a real word or a
 * number in it is kept. (There is deliberately no "short audio" rule: the VAD speech window
 * includes the prefix padding, so its length says little, and a quick "six" or "no" is a real turn.)
 */

/** Hesitations and body noises, matched per word after lower-casing (stretched forms like "ummm" included). */
const FILLER_WORD = /^(u+h+|u+m+|u+h+m+|h+m+|m+|e+r+m*|a+h+|o+h+|e+h+|a+c+h+o+o+|cough(s|ing)?|sneez(e|es|ing)|ahem)$/;

/** Social phrases that are not meant for the DM when they are the whole turn. */
const FILLER_PHRASES = [/\bbless you\b/g, /\bgesundheit\b/g];

/** Transcriber annotations for non-speech: [noise], (coughs), *sneeze*, [BLANK_AUDIO]. */
const ANNOTATION = /\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g;

/** Spoken numbers (dice totals, "nat twenty"): a turn with one of these is never noise. */
const NUMBER_WORD =
  /^(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|nat)$/;

function words(s: string) {
  return s
    .split(/[^\p{L}\p{N}'-]+/u)
    .map((w) => w.replace(/^[-']+|[-']+$/g, ""))
    .filter(Boolean);
}

/** True if the turn has no words meant for the DM: empty, punctuation, fillers, annotations only. */
export function isNoiseTranscript(text: string): boolean {
  const lower = text.toLowerCase();
  if (/\p{N}/u.test(lower) || words(lower).some((w) => NUMBER_WORD.test(w))) return false;
  // "bless you" alone is noise; "bless you, priest, …" keeps its other words and is kept.
  const stripped = FILLER_PHRASES.reduce((acc, re) => acc.replace(re, " "), lower.replace(ANNOTATION, " "));
  return words(stripped).every((w) => FILLER_WORD.test(w));
}
