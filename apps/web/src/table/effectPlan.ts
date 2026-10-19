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
  /** Colour of the impact visual where it takes one (spark). */
  tint: string;
  sounds: { name: EffectSound; atMs: number }[];
}

export const DART_STAGGER_MS = 90;

/** Tint of the small spark a travel-only effect lands with (a spell orb before its attack roll). */
export const NEUTRAL_SPARK = "#fff2d6";

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
  // A spell orb without an outcome is travel only (cast_spell before its attack roll): a small spark.
  if (e.style === "spell") return e.outcome ? elementVisual(e.element) : "spark";
  if (e.outcome === "hit" && e.style !== "ranged") return "slash";
  return "spark";
}

/**
 * The plan for one effect. `distance` is the source→target distance in cells (undefined when the
 * source has no token on the table or was hidden; ≤ 0.5 never travels). `suppressed` drops the
 * travel (see travelSuppressed): the impact then waits `waitMs` (until the earlier effect's travel
 * lands, so a hit/miss never shows before the orb), else the travel time it would have had.
 */
export function planEffect(e: BoardEffect, opts: { distance?: number; suppressed?: boolean; waitMs?: number }): EffectPlan {
  const canTravel = e.sourceId !== undefined && opts.distance !== undefined && opts.distance > 0.5;
  const wouldTravel = canTravel ? travelFor(e) : undefined;
  const travel = opts.suppressed ? undefined : wouldTravel;
  const count = wouldTravel === "orb" && e.kind === "attack" ? clamp(e.count ?? 1, 1, 6) : 1;
  const flight = wouldTravel ? travelTime(wouldTravel, opts.distance!) + (count - 1) * DART_STAGGER_MS : 0;
  const travelMs = travel ? travelTime(travel, opts.distance!) : 0;
  const impactAtMs = travel ? flight : opts.suppressed ? Math.max(0, opts.waitMs ?? flight) : 0;

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
    tint: impact === "spark" && !e.outcome ? NEUTRAL_SPARK : color,
    sounds,
  };
}

function travels(e: BoardEffect): boolean {
  return !!e.sourceId && !!e.targetId && (e.kind === "attack" || (e.kind === "hit" && !!e.style));
}

/**
 * Effects whose travel is skipped, each mapped to the earlier effect that travelled: the same
 * source→target pair already travelled within TRAVEL_DEDUPE_MS (cast_spell orb then the spell's
 * attack roll; attack roll then apply_damage with source_id). Only effects that actually travelled
 * count as the earlier one. Each suppressed follow-up extends the window (cast → roll → damage is one
 * chain), while the returned entry keeps pointing at the effect that travelled. MapBoard makes the
 * suppressed impact wait for that one's landing.
 */
export function travelSuppressed(list: { effect: BoardEffect; receivedAt: number }[]): Map<string, { byId: string; receivedAt: number }> {
  const out = new Map<string, { byId: string; receivedAt: number }>();
  const last = new Map<string, { byId: string; receivedAt: number; lastAt: number }>();
  for (const { effect: e, receivedAt } of [...list].sort((a, b) => a.receivedAt - b.receivedAt)) {
    if (!travels(e)) continue;
    const key = `${e.sourceId}>${e.targetId}`;
    const prev = last.get(key);
    if (prev && receivedAt - prev.lastAt <= TRAVEL_DEDUPE_MS) {
      out.set(e.id, { byId: prev.byId, receivedAt: prev.receivedAt });
      prev.lastAt = receivedAt;
    } else last.set(key, { byId: e.id, receivedAt, lastAt: receivedAt });
  }
  return out;
}

/** How long a token's hit/miss/crit/heal reaction lasts on the TV. */
export const REACTION_MS = 550;

/**
 * A token's reaction pose `age` ms after impact: body offset and flash strength. Hit = a quick
 * decaying shake + flash; crit = a bigger one; miss = a sidestep (dodge) without a flash; heal = a
 * gentle bob. Rest pose (all 0) before impact (a travel still flying), after the reaction, and with
 * no reaction (age Infinity). Always finite: a NaN position makes three.js drop the standee.
 */
export function reactionPose(kind: Reaction | undefined, age: number): { x: number; y: number; flash: number } {
  if (!kind || !(age >= 0 && age < REACTION_MS)) return { x: 0, y: 0, flash: 0 };
  const k = 1 - age / REACTION_MS;
  const arc = Math.sin((age / REACTION_MS) * Math.PI);
  const shake = kind === "crit" ? 0.17 : kind === "hit" ? 0.09 : 0;
  return {
    x: kind === "miss" ? arc * 0.28 : Math.sin(age * 0.09) * shake * k,
    y: kind === "heal" ? arc * 0.12 : kind === "crit" ? arc * 0.1 : 0,
    flash: kind === "miss" ? 0 : k * (kind === "crit" ? 2.4 : 1.4),
  };
}
