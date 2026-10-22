import { isIP } from "node:net";

/**
 * The bucket a client address counts in: IPv4 as is, IPv6 by its /64 prefix ("2001:db8:0:0::/64").
 * An IPv6 caller usually holds a whole /64, so per-address counting would give it endless tries.
 */
export function limitKey(ip: string): string {
  if (isIP(ip) !== 6) return ip;
  const lower = ip.toLowerCase();
  const [head, tail] = lower.includes("::") ? lower.split("::") : [lower, undefined];
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  // An embedded IPv4 tail ("::ffff:1.2.3.4") takes two groups; it is past the /64 either way.
  const groups = tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return `${groups
    .slice(0, 4)
    .map((g) => (g ? parseInt(g, 16).toString(16) : "0"))
    .join(":")}::/64`;
}

export interface FailureLimiterOptions {
  /** Failures per address (IPv6: per /64) in the window before it is blocked. */
  max?: number;
  /** Failures across all addresses in the window before every address is blocked (the code space is small). */
  globalMax?: number;
  windowMs?: number;
  now?: () => number;
  /** Told once each time the global budget runs out. */
  warn?: (msg: string) => void;
}

/**
 * Failed sign-in attempts (table code, host password), in memory: `max` failures in `windowMs` from
 * one address (IPv6: one /64, limitKey) block it until the oldest ages out, and `globalMax` failures
 * from everyone block every address the same way. A server restart forgets everything.
 */
export class FailureLimiter {
  private readonly max: number;
  private readonly globalMax: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly warn: (msg: string) => void;
  private fails = new Map<string, number[]>();
  private all: number[] = [];
  private lastSweep = 0;

  constructor(opts: FailureLimiterOptions = {}) {
    this.max = opts.max ?? 10;
    this.globalMax = opts.globalMax ?? 100;
    this.windowMs = opts.windowMs ?? 600_000;
    this.now = opts.now ?? Date.now;
    this.warn = opts.warn ?? ((m) => console.warn(m));
  }

  get size(): number {
    return this.fails.size;
  }

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const list = (this.fails.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length) this.fails.set(key, list);
    else this.fails.delete(key);
    return list;
  }

  private recentAll(): number[] {
    const cutoff = this.now() - this.windowMs;
    this.all = this.all.filter((t) => t > cutoff);
    return this.all;
  }

  fail(ip: string): void {
    // Sweep idle entries once per window so a spray of addresses can't grow the map forever.
    if (this.now() - this.lastSweep >= this.windowMs) {
      this.lastSweep = this.now();
      for (const k of [...this.fails.keys()]) this.recent(k);
    }
    const key = limitKey(ip);
    const list = this.recent(key);
    list.push(this.now());
    this.fails.set(key, list);
    const all = this.recentAll();
    all.push(this.now());
    if (all.length === this.globalMax) {
      this.warn(`${this.globalMax} wrong sign-in tries in ${Math.round(this.windowMs / 60_000)} min from many addresses: sign-in is paused for everyone. Someone may be guessing the table code; rotate it from the host's Online card.`);
    }
  }

  blocked(ip: string): boolean {
    return this.retryAfterMs(ip) > 0;
  }

  /** How long until this address may try again (0 = now). */
  retryAfterMs(ip: string): number {
    const wait = (list: number[], max: number) => (list.length < max ? 0 : Math.max(0, list[list.length - max] + this.windowMs - this.now()));
    return Math.max(wait(this.recent(limitKey(ip)), this.max), wait(this.recentAll(), this.globalMax));
  }
}
