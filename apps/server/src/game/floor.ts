import { FLOOR_MAX_HOLD_MS, FLOOR_TAIL_MS, type FloorHolder } from "@dm/shared";

/**
 * The push-to-talk floor (pure, clock injected): who is talking to the DM. The first press wins and
 * a press while someone else holds it is refused. A hold ends on release, or on its own after
 * `maxHoldMs` (a forgotten button). Every hold is kept on a short timeline, extended by `tailMs`
 * after it ends, so a finished voice turn can be matched to whoever held the floor while it was
 * spoken (`holderDuring`) and a turn nobody covered can be dropped (`covered`).
 */
export interface FloorOptions {
  now?: () => number;
  maxHoldMs?: number;
  tailMs?: number;
  /** Forget holds that ended longer ago than this. */
  keepMs?: number;
}

interface Hold {
  holder: FloorHolder;
  start: number;
  /** Release time (or the auto-release cap); undefined while held. */
  end?: number;
}

/** Most holds kept on the timeline. */
const MAX_HOLDS = 100;

export function sameHolder(a: FloorHolder | null | undefined, b: FloorHolder | null | undefined): boolean {
  if (!a || !b) return false;
  if ("room" in a || "room" in b) return "room" in a && "room" in b;
  return a.playerId === b.playerId;
}

function copy(h: FloorHolder): FloorHolder {
  return "room" in h ? { room: true } : { playerId: h.playerId, inRoom: h.inRoom };
}

export class Floor {
  private readonly now: () => number;
  private readonly maxHoldMs: number;
  private readonly tailMs: number;
  private readonly keepMs: number;
  private holds: Hold[] = [];
  private current?: Hold;

  constructor(opts: FloorOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.maxHoldMs = opts.maxHoldMs ?? FLOOR_MAX_HOLD_MS;
    this.tailMs = opts.tailMs ?? FLOOR_TAIL_MS;
    this.keepMs = opts.keepMs ?? 120_000;
  }

  /** Who holds the floor now (after any auto release), as a copy. */
  get holder(): FloorHolder | null {
    this.expire();
    return this.current ? copy(this.current.holder) : null;
  }

  /** When the current hold began (undefined when nobody holds it). */
  get since(): number | undefined {
    this.expire();
    return this.current?.start;
  }

  /** Take the floor. True when `holder` holds it afterwards (a repeat press keeps the original start). */
  press(holder: FloorHolder): boolean {
    this.expire();
    if (this.current) return sameHolder(this.current.holder, holder);
    this.prune();
    this.current = { holder: copy(holder), start: this.now() };
    this.holds.push(this.current);
    return true;
  }

  /** Give the floor back; only its holder can. True when it was released. */
  release(holder: FloorHolder): boolean {
    this.expire();
    if (!this.current || !sameHolder(this.current.holder, holder)) return false;
    this.current.end = this.now();
    this.current = undefined;
    return true;
  }

  /** Apply the auto release; true when it just released the floor. */
  expire(): boolean {
    const c = this.current;
    if (!c || this.now() - c.start < this.maxHoldMs) return false;
    c.end = c.start + this.maxHoldMs;
    this.current = undefined;
    return true;
  }

  /** ms until the current hold is auto-released (undefined when nobody holds it). */
  msUntilExpiry(): number | undefined {
    this.expire();
    return this.current ? Math.max(0, this.current.start + this.maxHoldMs - this.now()) : undefined;
  }

  /** Somebody held the floor at `ts` (or released it within the tail before it). */
  activeAt(ts: number): boolean {
    return this.covered(ts, ts);
  }

  /** Any hold (plus its tail) overlaps the window [from, to]. */
  covered(from: number, to: number): boolean {
    this.expire();
    return this.holds.some((h) => h.start <= to && this.until(h) >= from);
  }

  /** The holder that overlapped [from, to] the most (plus tails); undefined if nobody did. */
  holderDuring(from: number, to: number): FloorHolder | undefined {
    this.expire();
    let best: Hold | undefined;
    let bestMs = -1;
    for (const h of this.holds) {
      const ms = Math.min(to, this.until(h)) - Math.max(from, h.start);
      if (ms < 0 || ms <= bestMs) continue;
      best = h;
      bestMs = ms;
    }
    return best && copy(best.holder);
  }

  /** Forget the holder and the timeline (push-to-talk turned off, campaign switch). */
  clear() {
    this.current = undefined;
    this.holds = [];
  }

  /** End of a hold's coverage: still held = open-ended. */
  private until(h: Hold): number {
    return h.end === undefined ? Infinity : h.end + this.tailMs;
  }

  private prune() {
    const cutoff = this.now() - this.keepMs;
    this.holds = this.holds.filter((h) => h.end === undefined || h.end + this.tailMs >= cutoff).slice(-MAX_HOLDS);
  }
}
