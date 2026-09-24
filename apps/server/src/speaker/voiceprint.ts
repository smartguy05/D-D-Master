/** Pure voiceprint math: normalisation, running averages and nearest-speaker matching. */

export function l2normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (const x of v) sum += x * x;
  const n = Math.sqrt(sum) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return -1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na * nb) || 1);
}

/** Merge a new sample into a stored voiceprint (running mean of normalised embeddings). */
export function mergeEmbedding(existing: Float32Array | undefined, samples: number, next: Float32Array): Float32Array {
  const n = l2normalize(next);
  if (!existing || samples <= 0) return n;
  const out = new Float32Array(n.length);
  for (let i = 0; i < n.length; i++) out[i] = (existing[i] * samples + n[i]) / (samples + 1);
  return l2normalize(out);
}

export interface Voiceprint {
  playerId: string;
  embedding: Float32Array;
  samples: number;
}

export interface SpeakerMatch {
  playerId: string;
  score: number;
  /** Gap between the best and second-best score; small margins are ambiguous. */
  margin: number;
  confident: boolean;
}

/**
 * Best-matching enrolled voice. Confident when above the threshold and clearly ahead of
 * the runner-up (so two similar voices trigger a "who said that?" instead of a guess).
 */
export function matchSpeaker(
  embedding: Float32Array,
  prints: Voiceprint[],
  threshold: number,
  minMargin = 0.06,
): SpeakerMatch | undefined {
  if (!prints.length) return undefined;
  const scored = prints
    .map((p) => ({ playerId: p.playerId, score: cosine(embedding, p.embedding) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  const margin = scored.length > 1 ? best.score - scored[1].score : 1;
  return { ...best, margin, confident: best.score >= threshold && margin >= minMargin };
}
