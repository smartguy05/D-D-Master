import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes, randomInt } from "node:crypto";
import { safeEqual } from "./token.js";

/** Short, easy to read aloud and type on a phone. */
const WORDS = [
  "WOLF", "BEAR", "HAWK", "OWL", "FOX", "STAG", "BOAR", "RAVEN", "DRAKE", "WYRM", "ORC", "ELF", "DWARF", "GNOME", "TROLL", "OGRE",
  "SWORD", "AXE", "BOW", "SHIELD", "HELM", "TORCH", "ROPE", "SCROLL", "RUNE", "GEM", "CROWN", "RING", "WAND", "STAFF", "MACE", "SPEAR",
  "TOWER", "KEEP", "CAVE", "CRYPT", "FORGE", "TAVERN", "BRIDGE", "GATE", "MOON", "STAR", "STORM", "FROST", "EMBER", "MIST", "STONE", "IRON",
];

/**
 * A fresh table code like WOLF-RUNE-7342: 48 x 48 words x 10,000 numbers = 23 million codes. It is the
 * only thing guarding the tunnel, so it must outlast rate-limited guessing (auth/ratelimit.ts).
 */
export function newTableCode(): string {
  const word = () => WORDS[randomInt(WORDS.length)];
  return `${word()}-${word()}-${String(randomInt(10_000)).padStart(4, "0")}`;
}

/** Codes compare without case, spaces or dashes ("wolf 7342" = "WOLF-7342"). */
export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

interface Claim {
  sid: string;
  at: number;
}

interface AuthData {
  /** HMAC key for the sign-in cookies (auth/token.ts). */
  secret: string;
  code: string;
  /** Bumped by every code change: player cookies of an older generation are dead. */
  gen: number;
  /** Seat (player id) -> the sign-in holding it. */
  claims: Record<string, Claim>;
}

export interface AuthStoreOptions {
  /** <DATA_DIR>/auth.json; omit to keep everything in memory. */
  file?: string;
  /** TABLE_CODE from .env: a fixed code (rotate refuses). Empty = generated and kept in the file. */
  envCode?: string;
  now?: () => number;
  warn?: (msg: string) => void;
}

/**
 * Sign-in state that outlives a restart: the cookie secret, the table code and its generation, and
 * seat claims. Kept in <DATA_DIR>/auth.json (mode 600), rewritten on every change.
 */
export class AuthStore {
  private data: AuthData;
  private readonly file?: string;
  private readonly now: () => number;
  readonly fixedCode: boolean;

  constructor(opts: AuthStoreOptions) {
    this.file = opts.file;
    this.now = opts.now ?? Date.now;
    const envCode = opts.envCode?.trim() ?? "";
    this.fixedCode = !!envCode;
    const loaded = this.load(opts.warn ?? ((m) => console.warn(m)));
    this.data = loaded ?? { secret: randomBytes(32).toString("hex"), code: envCode || newTableCode(), gen: 1, claims: {} };
    let dirty = !loaded;
    if (envCode && normalizeCode(this.data.code) !== normalizeCode(envCode)) {
      // TABLE_CODE changed in .env (or was just set): everyone signed in with the old code is out.
      this.data = { ...this.data, code: envCode, gen: this.data.gen + 1, claims: {} };
      dirty = true;
    }
    if (dirty) this.save();
  }

  private load(warn: (m: string) => void): AuthData | undefined {
    if (!this.file || !existsSync(this.file)) return undefined;
    try {
      const d = JSON.parse(readFileSync(this.file, "utf8")) as Partial<AuthData>;
      if (typeof d.secret !== "string" || d.secret.length < 32 || typeof d.code !== "string" || !Number.isInteger(d.gen)) throw new Error("missing fields");
      const claims: Record<string, Claim> = {};
      for (const [pid, c] of Object.entries(d.claims ?? {})) if (c && typeof c.sid === "string") claims[pid] = { sid: c.sid, at: Number(c.at) || 0 };
      return { secret: d.secret, code: d.code, gen: d.gen as number, claims };
    } catch (err) {
      warn(`${this.file} is unreadable (${(err as Error).message}); making a new one. Everyone has to sign in again.`);
      return undefined;
    }
  }

  private save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 });
  }

  get secret(): string {
    return this.data.secret;
  }
  get code(): string {
    return this.data.code;
  }
  get gen(): number {
    return this.data.gen;
  }

  codeMatches(input: string): boolean {
    const given = normalizeCode(input);
    return given.length > 0 && safeEqual(given, normalizeCode(this.data.code));
  }

  /** A new code: every player cookie dies and every seat is free again. Refused when TABLE_CODE is set. */
  rotate(): string {
    if (this.fixedCode) throw new Error("The table code comes from TABLE_CODE in .env; change it there and restart the server.");
    let code = newTableCode();
    while (code === this.data.code) code = newTableCode();
    this.data = { ...this.data, code, gen: this.data.gen + 1, claims: {} };
    this.save();
    return code;
  }

  /** The sign-in (sid) holding a seat. */
  seatOwner(playerId: string): string | undefined {
    return this.data.claims[playerId]?.sid;
  }

  /**
   * Bind a seat to a sign-in; a sid holds one seat at a time. Refused while another sign-in holds it,
   * unless `force` (routes/auth.ts: the holder has had no socket open for a while). The holder's cookie
   * then stops working, since a player cookie is only valid while its sid owns the seat.
   */
  claim(playerId: string, sid: string, opts: { force?: boolean } = {}): { ok: boolean } {
    const held = this.data.claims[playerId];
    const takeover = !!held && held.sid !== sid;
    if (takeover && !opts.force) return { ok: false };
    const claims: Record<string, Claim> = {};
    for (const [pid, c] of Object.entries(this.data.claims)) if (c.sid !== sid) claims[pid] = c;
    claims[playerId] = { sid, at: held && !takeover ? held.at : this.now() };
    this.data = { ...this.data, claims };
    this.save();
    return { ok: true };
  }

  /** Free a seat (kick, logout); false if nobody held it. */
  release(playerId: string): boolean {
    if (!this.data.claims[playerId]) return false;
    const { [playerId]: _gone, ...rest } = this.data.claims;
    this.data = { ...this.data, claims: rest };
    this.save();
    return true;
  }

  claims(): { playerId: string; sid: string; at: number }[] {
    return Object.entries(this.data.claims).map(([playerId, c]) => ({ playerId, ...c }));
  }
}
