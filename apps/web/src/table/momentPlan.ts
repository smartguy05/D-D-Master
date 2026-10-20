import type { Moment } from "@dm/shared";
import type { EffectSound } from "../dice/sound";
import { HOLD_CAP_MS } from "./effectPlan";

/**
 * Pure timing and choice for "moments" on the TV (victory, death, revival, campaign end, turn
 * banner). The server sends each moment once (`{type:"moment"}`, never in the snapshot); TablePage
 * filters it (visibility.momentForTable), holds it behind the dice tray (releaseHeldMoments), then
 * plays it: full-screen variants go through the overlay queue one at a time, `rallied` is a small
 * toast, token variants (death, monster_death, revived) animate the standee (tokenMomentPose), and
 * attitude flashes the token ring in its new colour (ringFlash), with no banner.
 */

export type MomentVariant = "victory" | "defeat" | "fled" | "death" | "monster_death" | "revived" | "rallied" | "campaign_end" | "turn_start" | "attitude" | "combat_start";

export function momentVariant(m: Pick<Moment, "kind" | "outcome">): MomentVariant {
  if (m.kind === "death") return m.outcome === "monster" ? "monster_death" : "death";
  if (m.kind === "revived") return m.outcome === "rallied" ? "rallied" : "revived";
  return m.kind;
}

/** How long each variant plays (overlay, toast or token animation). */
export const MOMENT_MS: Record<MomentVariant, number> = {
  victory: 4500,
  defeat: 5000,
  fled: 3500,
  death: 4000,
  monster_death: 2500,
  revived: 3500,
  rallied: 3000,
  campaign_end: 8000,
  turn_start: 2000,
  /** An NPC's attitude changed: the token ring flashes its new colour (no banner). */
  attitude: 1500,
  /** Battle intro: "Roll for initiative", the order dealt out card by card, "Battle begins!". */
  combat_start: 5500,
};

const FULL_SCREEN: ReadonlySet<MomentVariant> = new Set(["victory", "defeat", "fled", "death", "revived", "campaign_end", "turn_start", "combat_start"]);

/** Variants that take the one full-screen overlay slot (rallied is a toast, monster_death token-only). */
export function isFullScreen(v: MomentVariant): boolean {
  return FULL_SCREEN.has(v);
}

/**
 * Overlays the dice tray waits for: the battle intro and the turn banners, so the table sees the
 * order and whose turn it is before that creature's attack rolls.
 */
export function holdsDice(v: MomentVariant | undefined): boolean {
  return v === "combat_start" || v === "turn_start";
}

/** Battle intro timing for `n` cards: each card's delay (ms) and when "Battle begins!" lands. */
export function introTiming(n: number): { cardDelay: (i: number) => number; titleDelay: number } {
  const first = 600;
  const step = Math.min(350, 2200 / Math.max(1, n));
  return { cardDelay: (i) => first + i * step, titleDelay: first + Math.max(1, n) * step + 300 };
}

/** Variants that animate the target's token on the board (attitude only flashes its ring). */
export function isTokenMoment(v: MomentVariant): boolean {
  return v === "death" || v === "monster_death" || v === "revived" || v === "attitude";
}

/** Ring pulses during an attitude moment. */
const ATTITUDE_PULSES = 3;

/**
 * Ring flash strength `ageMs` into an attitude moment: ATTITUDE_PULSES smooth pulses (0..1) that
 * fade out by MOMENT_MS.attitude; 0 before, after, or for a non-finite age. Other variants give 0.
 */
export function ringFlash(v: MomentVariant, ageMs: number): number {
  if (v !== "attitude") return 0;
  const dur = MOMENT_MS.attitude;
  if (!(ageMs >= 0 && ageMs <= dur)) return 0;
  const t = ageMs / dur;
  return Math.max(0, Math.sin(t * Math.PI * ATTITUDE_PULSES)) * (1 - t * 0.5);
}

export interface HeldMoment {
  moment: Moment;
  heldAt: number;
}

/**
 * Tokens whose death moment is still held behind the dice: they stay standing until it plays (the
 * state already says hp 0, but the tip-over belongs to the moment, after the killing blow lands).
 */
export function heldStanding(held: HeldMoment[]): string[] {
  return held.flatMap((h) => {
    const v = momentVariant(h.moment);
    return (v === "death" || v === "monster_death") && h.moment.targetId ? [h.moment.targetId] : [];
  });
}

/** A token's resting fallen pose: the state's, except while its death moment is held (heldStanding). */
export function tokenFallen(fallenInState: boolean, entityId: string, standing: readonly string[]): boolean {
  return fallenInState && !standing.includes(entityId);
}

export interface ShownTurn {
  /** The creature the TV marks as acting (spotlight, initiative strip, Now card). */
  id: string | undefined;
  /** A newer turn from the state, waiting for the dice; `since` starts the HOLD_CAP_MS clock. */
  pending?: { id: string; since: number };
}

/**
 * The turn marker the TV shows. The state moves to the next turn as soon as the DM calls next_turn,
 * often while the last attack's dice are still rolling; the marker stays on the previous creature
 * until the dice and board effects finish (with the turn banner), or HOLD_CAP_MS passes. Combat
 * ending clears it at once.
 */
export function shownTurn(prev: ShownTurn, stateTurn: string | undefined, tray: { busy: boolean; now: number }): ShownTurn {
  if (stateTurn === undefined || stateTurn === prev.id) return { id: stateTurn };
  const since = prev.pending?.since ?? tray.now;
  if (!tray.busy || tray.now - since >= HOLD_CAP_MS) return { id: stateTurn };
  return { id: prev.id, pending: { id: stateTurn, since } };
}

/**
 * Moments wait for the dice tray and the board effects (the killing blow lands before the victory
 * banner). While dice roll or effects are held, everything waits; then all go in arrival order.
 * Anything held HOLD_CAP_MS goes anyway (a lost roll, a stuck tray).
 */
export function releaseHeldMoments(held: HeldMoment[], tray: { diceBusy: boolean; effectsHeld: boolean; now: number }): { release: Moment[]; keep: HeldMoment[] } {
  const release: Moment[] = [];
  const keep: HeldMoment[] = [];
  const busy = tray.diceBusy || tray.effectsHeld;
  for (const h of held) {
    if (tray.now - h.heldAt >= HOLD_CAP_MS || !busy) release.push(h.moment);
    else keep.push(h);
  }
  return { release, keep };
}

export interface MomentQueue {
  current: { moment: Moment; variant: MomentVariant; startedAt: number } | null;
  pending: Moment[];
}

export function emptyMomentQueue(): MomentQueue {
  return { current: null, pending: [] };
}

/**
 * Add a moment to the overlay queue (FIFO). Only full-screen variants queue; a new turn banner
 * replaces any turn banner not shown yet (only the latest turn matters).
 */
export function enqueueMoment(q: MomentQueue, m: Moment): MomentQueue {
  const v = momentVariant(m);
  if (!isFullScreen(v)) return q;
  const pending = v === "turn_start" ? q.pending.filter((p) => p.kind !== "turn_start") : q.pending;
  return { current: q.current, pending: [...pending, m] };
}

/** Advance the queue at `now`: the current overlay stays for MOMENT_MS, then the next one starts. */
export function nextOverlay(q: MomentQueue, now: number): MomentQueue {
  if (q.current && now - q.current.startedAt < MOMENT_MS[q.current.variant]) return q;
  if (!q.pending.length) return q.current ? { current: null, pending: q.pending } : q;
  const [m, ...rest] = q.pending;
  return { current: { moment: m, variant: momentVariant(m), startedAt: now }, pending: rest };
}

/** Drop the current overlay early (a click on the campaign-end screen). */
export function dismiss(q: MomentQueue): MomentQueue {
  return q.current ? { current: null, pending: q.pending } : q;
}

const SOUND: Record<MomentVariant, EffectSound> = {
  victory: "victory",
  defeat: "death",
  fled: "fumble",
  death: "death",
  monster_death: "thud",
  revived: "revive",
  rallied: "chime",
  campaign_end: "campaign",
  turn_start: "chime",
  attitude: "chime",
  combat_start: "battle",
};

export function soundForMoment(v: MomentVariant): EffectSound {
  return SOUND[v];
}

export interface TokenPose {
  /** Standee tilt in radians: 0 upright, PI/2 lying on its side. */
  tilt: number;
  /** 0 full colour, 1 grey. */
  desaturate: number;
  /** Golden column strength (revived), 0–1. */
  column: number;
}

const NEUTRAL: TokenPose = { tilt: 0, desaturate: 0, column: 0 };
/** Time the standee takes to tip over (death) or stand up (revived). */
const TIP_MS = 1000;
const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

/**
 * A token's pose `ageMs` into a moment. Death tips the standee over within ~1 s and greys it out;
 * revived lifts it back up under a golden column that fades by MOMENT_MS. A negative, non-finite or
 * past-the-end age gives the end pose. Other variants are neutral. Always finite.
 */
export function tokenMomentPose(v: MomentVariant, ageMs: number): TokenPose {
  if (v !== "death" && v !== "monster_death" && v !== "revived") return { ...NEUTRAL };
  const dur = MOMENT_MS[v];
  const ended = !(ageMs >= 0 && ageMs <= dur);
  if (v === "revived") {
    if (ended) return { ...NEUTRAL };
    return { tilt: (Math.PI / 2) * (1 - easeOut(ageMs / TIP_MS)), desaturate: 0, column: Math.max(0, Math.min(1, Math.sin((ageMs / dur) * Math.PI))) };
  }
  if (ended) return { tilt: Math.PI / 2, desaturate: 1, column: 0 };
  return { tilt: (Math.PI / 2) * easeOut(ageMs / TIP_MS), desaturate: Math.min(1, ageMs / TIP_MS), column: 0 };
}
