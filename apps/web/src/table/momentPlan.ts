import type { Moment } from "@dm/shared";
import type { EffectSound } from "../dice/sound";
import { HOLD_CAP_MS } from "./effectPlan";

/**
 * Pure timing and choice for "moments" on the TV (victory, death, revival, campaign end, turn
 * banner). The server sends each moment once (`{type:"moment"}`, never in the snapshot); TablePage
 * filters it (visibility.momentForTable), holds it behind the dice tray (releaseHeldMoments), then
 * plays it: full-screen variants go through the overlay queue one at a time, `rallied` is a small
 * toast, and token variants (death, monster_death, revived) animate the standee (tokenMomentPose).
 */

export type MomentVariant = "victory" | "defeat" | "fled" | "death" | "monster_death" | "revived" | "rallied" | "campaign_end" | "turn_start";

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
};

const FULL_SCREEN: ReadonlySet<MomentVariant> = new Set(["victory", "defeat", "fled", "death", "revived", "campaign_end", "turn_start"]);

/** Variants that take the one full-screen overlay slot (rallied is a toast, monster_death token-only). */
export function isFullScreen(v: MomentVariant): boolean {
  return FULL_SCREEN.has(v);
}

/** Variants that animate the target's token on the board. */
export function isTokenMoment(v: MomentVariant): boolean {
  return v === "death" || v === "monster_death" || v === "revived";
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
