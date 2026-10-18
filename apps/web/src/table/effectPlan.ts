import { elementFor, type BoardEffect, type EffectElement, type EffectKind } from "@dm/shared";
import type { EffectSound } from "../dice/sound";

/**
 * Pure timing and recipe selection for board effects (tested; Effects.tsx draws them).
 * An effect is: an optional travel from the source (swing, arrow, orb, bolt), then an impact visual
 * on the target at `impactAtMs`, the token reaction (shake, dodge, glow) and sounds.
 */

/** A travel for a source→target pair that already travelled this recently only shows its landing. */
export const TRAVEL_DEDUPE_MS = 1500;

export type Visual =
  | "slash"
  | "fireball"
  | "lightning"
  | "frost"
  | "poison"
  | "radiant"
  | "necrotic"
  | "thunder"
  | "arcane"
  | "heal"
  | "crit"
  | "miss"
  /** small impact spark in the element colour (ranged hit, unknown outcome) */
  | "spark"
  /** ring of the area's radius + the element visual */
  | "area";

export type Travel = "swing" | "arrow" | "orb" | "bolt";
export type Reaction = "hit" | "miss" | "crit" | "heal";

export interface EffectPlan {
  travel?: Travel;
  travelMs: number;
  /** Darts flying (Magic Missile); each starts DART_STAGGER_MS after the previous. */
  count: number;
  impact?: Visual;
  impactAtMs: number;
  /** Visual of the element under an area ring. */
  areaVisual?: Visual;
  areaRadius?: number;
  /** Token reaction at impact. */
  reaction?: Reaction;
  /** Main colour (orb, ring, token flash). */
  color: string;
  sounds: { name: EffectSound; atMs: number }[];
}

export const DART_STAGGER_MS = 90;

const ELEMENT_COLOR: Record<EffectElement, string> = {
  fire: "#ff7a1a",
  cold: "#8fe3ff",
  lightning: "#9fd8ff",
  thunder: "#c9d8ff",
  acid: "#9be04a",
  poison: "#7ddc4a",
  radiant: "#fff1a8",
  necrotic: "#a05cff",
  force: "#c77dff",
  psychic: "#ff7fd0",
  physical: "#ff3b2f",
};

export function elementColor(element?: string): string {
  return ELEMENT_COLOR[elementFor(element)];
}

const VISUAL_COLOR: Record<Visual, string> = {
  slash: "#ff3b2f",
  crit: "#ffd75e",
  fireball: "#ff7a1a",
  lightning: "#9fd8ff",
  frost: "#8fe3ff",
  poison: "#7ddc4a",
  radiant: "#fff1a8",
  necrotic: "#a05cff",
  thunder: "#c9d8ff",
  arcane: "#c77dff",
  heal: "#6dff9a",
  miss: "#9a9a9a",
  spark: "#ffcf7a",
  area: "#ff7a1a",
};

/** Element look of a damage type (hits, spells): physical damage is a slash. */
function elementVisual(element?: string): Visual {
  const e = elementFor(element);
  const map: Partial<Record<EffectElement, Visual>> = {
    fire: "fireball",
    lightning: "lightning",
    cold: "frost",
    poison: "poison",
    acid: "poison",
    radiant: "radiant",
    necrotic: "necrotic",
    thunder: "thunder",
    force: "arcane",
    psychic: "arcane",
  };
  return map[e] ?? "slash";
}

/** Map a board effect kind to a visual. Hits, attacks and areas use their damage type. */
export function visualFor(kind: EffectKind, element?: string): Visual {
  if (kind === "hit" || kind === "attack") return elementVisual(element);
  if (kind === "area") return "area";
  return kind;
}

/** Tint used for the token flash when an effect lands. */
export function flashColor(kind: EffectKind, element?: string): string {
  return VISUAL_COLOR[visualFor(kind, element)];
}

function impactSound(v: Visual | undefined, element?: string): EffectSound | undefined {
  switch (v) {
    case "crit":
      return "clang";
    case "miss":
      return "whiff";
    case "fireball":
    case "thunder":
    case "area":
      return elementFor(element) === "lightning" ? "crackle" : "boom";
    case "lightning":
      return "crackle";
    case "heal":
    case "radiant":
      return "chime";
    case "frost":
    case "arcane":
    case "necrotic":
    case "poison":
      return "zap";
    case "slash":
    case "spark":
      return "thud";
    default:
      return undefined;
  }
}

const TRAVEL_SOUND: Record<Travel, EffectSound> = { swing: "whoosh", arrow: "twang", orb: "zap", bolt: "crackle" };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function travelTime(travel: Travel, distance: number): number {
  switch (travel) {
    case "swing":
      return 260;
    case "bolt":
      return 120;
    case "arrow":
      return Math.round(clamp(140 + distance * 40, 200, 600));
    case "orb":
      return Math.round(clamp(180 + distance * 50, 260, 700));
  }
}

function travelFor(e: BoardEffect): Travel | undefined {
  if (e.kind === "area") return e.shape === "emanation" ? undefined : "orb";
  if (e.kind !== "attack" && !(e.kind === "hit" && e.style)) return undefined;
  switch (e.style) {
    case "ranged":
      return "arrow";
    case "spell":
      return elementFor(e.element) === "lightning" ? "bolt" : "orb";
    case "melee":
    default:
      return "swing";
  }
}

/** What lands on the target for an `attack`: outcome first, then the style's look. */
function attackImpact(e: BoardEffect): Visual {
  if (e.outcome === "crit") return "crit";
  if (e.outcome === "miss") return "miss";
  if (e.style === "spell") return elementVisual(e.element);
  if (e.outcome === "hit" && e.style !== "ranged") return "slash";
  return "spark";
}

/**
 * The plan for one effect. `distance` is the source→target distance in cells (undefined when the
 * source has no token on the table or was hidden); `suppressed` drops the travel (see travelSuppressed).
 */
export function planEffect(e: BoardEffect, opts: { distance?: number; suppressed?: boolean }): EffectPlan {
  const canTravel = e.sourceId !== undefined && opts.distance !== undefined && opts.distance > 0.5 && !opts.suppressed;
  const travel = canTravel ? travelFor(e) : undefined;
  const count = travel === "orb" && e.kind === "attack" ? clamp(e.count ?? 1, 1, 6) : 1;
  const travelMs = travel ? travelTime(travel, opts.distance!) : 0;
  const impactAtMs = travel ? travelMs + (count - 1) * DART_STAGGER_MS : 0;

  let impact: Visual;
  let reaction: Reaction | undefined;
  if (e.kind === "attack") {
    impact = attackImpact(e);
    reaction = e.outcome;
  } else if (e.kind === "area") {
    impact = "area";
  } else {
    impact = visualFor(e.kind, e.element);
    reaction = e.kind === "heal" ? "heal" : e.kind === "miss" ? "miss" : e.kind === "crit" || e.outcome === "crit" ? "crit" : "hit";
  }
  const color = e.kind === "area" || e.style === "spell" ? elementColor(e.element) : VISUAL_COLOR[impact];
  const sounds: EffectPlan["sounds"] = [];
  if (travel) sounds.push({ name: TRAVEL_SOUND[travel], atMs: 0 });
  const hitSound = impactSound(impact, e.element);
  if (hitSound) sounds.push({ name: hitSound, atMs: impactAtMs });
  return {
    travel,
    travelMs,
    count,
    impact,
    impactAtMs,
    areaVisual: e.kind === "area" ? elementVisual(e.element) : undefined,
    areaRadius: e.kind === "area" ? e.radius ?? 1 : undefined,
    reaction,
    color,
    sounds,
  };
}

function travels(e: BoardEffect): boolean {
  return !!e.sourceId && !!e.targetId && (e.kind === "attack" || (e.kind === "hit" && !!e.style));
}

/**
 * Ids of effects whose travel is skipped: the same source→target pair already travelled within
 * TRAVEL_DEDUPE_MS (cast_spell orb then the spell's attack roll; attack roll then apply_damage with
 * source_id). Only effects that actually travelled count as the earlier one.
 */
export function travelSuppressed(list: { effect: BoardEffect; receivedAt: number }[]): Set<string> {
  const out = new Set<string>();
  const last = new Map<string, number>();
  for (const { effect: e, receivedAt } of [...list].sort((a, b) => a.receivedAt - b.receivedAt)) {
    if (!travels(e)) continue;
    const key = `${e.sourceId}>${e.targetId}`;
    const prev = last.get(key);
    if (prev !== undefined && receivedAt - prev <= TRAVEL_DEDUPE_MS) out.add(e.id);
    else last.set(key, receivedAt);
  }
  return out;
}
