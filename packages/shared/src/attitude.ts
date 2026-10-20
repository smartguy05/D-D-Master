import type { Monster } from "./schemas.js";

/**
 * NPC attitude (2024 SRD "Friendly / Hostile / Indifferent [Attitude]") on a gradual -5..+5 score.
 * Thresholds: <= -3 Hostile, -2..+2 Indifferent, >= +3 Friendly. Old saves without the stored
 * fields derive both from the disposition flags (neutral wins over ally, as dispositionOf).
 */
export type Attitude = "hostile" | "indifferent" | "friendly";
export type Disposition = "foe" | "ally" | "neutral";

export const ATTITUDE_MIN = -5;
export const ATTITUDE_MAX = 5;

/** The default score for an attitude: hostile -3, indifferent 0, friendly +3. */
export const ATTITUDE_BASE_SCORE: Record<Attitude, number> = { hostile: -3, indifferent: 0, friendly: 3 };

export function attitudeForScore(score: number): Attitude {
  if (score <= -3) return "hostile";
  if (score >= 3) return "friendly";
  return "indifferent";
}

export function dispositionForAttitude(attitude: Attitude): Disposition {
  return attitude === "hostile" ? "foe" : attitude === "friendly" ? "ally" : "neutral";
}

export function attitudeForDisposition(disposition: Disposition): Attitude {
  return disposition === "foe" ? "hostile" : disposition === "ally" ? "friendly" : "indifferent";
}

export function clampAttitudeScore(score: number): number {
  return Math.max(ATTITUDE_MIN, Math.min(ATTITUDE_MAX, Math.round(score)));
}

type AttitudeSource = Partial<Pick<Monster, "ally" | "neutral" | "attitude" | "attitudeScore">>;

/** The creature's attitude and score: stored values when present, else derived. */
export function attitudeOf(m: AttitudeSource): { attitude: Attitude; score: number } {
  const storedScore = typeof m.attitudeScore === "number" ? m.attitudeScore : undefined;
  if (m.attitude && storedScore !== undefined) return { attitude: m.attitude, score: storedScore };
  if (storedScore !== undefined) return { attitude: attitudeForScore(storedScore), score: storedScore };
  if (m.attitude) return { attitude: m.attitude, score: ATTITUDE_BASE_SCORE[m.attitude] };
  const attitude: Attitude = m.neutral ? "indifferent" : m.ally ? "friendly" : "hostile";
  return { attitude, score: ATTITUDE_BASE_SCORE[attitude] };
}

/** "Friendly (+3)", "Hostile (-3)", "Indifferent (0)". */
export function formatAttitude(attitude: Attitude, score: number): string {
  const label = attitude.charAt(0).toUpperCase() + attitude.slice(1);
  return `${label} (${score > 0 ? `+${score}` : score})`;
}

const PITCH = ["low", "deep", "mid-pitched", "high", "light", "husky", "reedy", "booming"];
const PACE = ["slow and deliberate", "quick and clipped", "measured", "rambling", "halting", "brisk", "lazy drawl", "rapid-fire"];
const TIMBRE = ["gravelly", "warm", "nasal", "smooth", "raspy", "breathy", "bright", "throaty", "soft", "crisp"];
const MANNER = ["coastal accent", "rustic country accent", "formal court diction", "street-tough slang", "lilting sing-song", "gruff and terse", "nervous and wary", "cheerful and chatty", "weary and dry", "proud and theatrical"];

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** murmur3's 32-bit finalizer: every output bit depends on every input bit. */
function mix32(x: number): number {
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
}

/**
 * A short, deterministic voice direction for an NPC that has none (no LLM call): pitch, pace,
 * timbre and manner picked independently by hashing the name (and appearance / creature type when
 * given). add_npc and speak_as_npc both call it with the name alone, so an NPC keeps one voice
 * whether it speaks before or after it is put on the map.
 */
export function defaultNpcVoice(name: string, appearance?: string, creatureType?: string): string {
  const key = `${name.trim().toLowerCase()}|${(appearance ?? "").trim().toLowerCase()}|${(creatureType ?? "").trim().toLowerCase()}`;
  const h = hash(key);
  // Each component gets its own fully mixed hash (murmur3 finalizer of h ^ salt): a single odd
  // multiplier keeps the low bits, so 8-entry lists would all follow h & 7 (pitch fixed by pace).
  const pick = <T>(list: T[], salt: number) => list[mix32(h ^ salt) % list.length];
  const timbre = pick(TIMBRE, 0x9e37);
  const pitch = pick(PITCH, 0x85eb);
  const pace = pick(PACE, 0xc2b2);
  const manner = pick(MANNER, 0x27d4);
  const type = (creatureType ?? "").trim().toLowerCase();
  const extra = type && type !== "humanoid" ? `, faintly ${type === "beast" ? "animal" : "otherworldly"}` : "";
  return `${timbre}, ${pitch} voice; ${pace}; ${manner}${extra}`.slice(0, 200);
}
