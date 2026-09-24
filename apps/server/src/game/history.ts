import { GameState } from "@dm/shared";
import type { Store } from "../db/index.js";

/** How many snapshots are kept per campaign. Older ones are pruned on write. */
export const HISTORY_LIMIT = 50;
const LABEL_MAX = 90;

export interface HistoryEntry {
  id: number;
  /** `GameState.version` of the stored snapshot (the state *before* the labelled change). */
  version: number;
  ts: number;
  /** What changed right after this snapshot, e.g. `apply_damage Thorin amount=5` or `host edit: …`. */
  label: string;
}

/**
 * Bounded undo history. Each row is the whole GameState captured just *before* a labelled change,
 * so restoring a row undoes that change and everything after it. Voiceprints are never stored here
 * (they live in their own table and GameState only carries a sample count).
 */
export class StateHistory {
  constructor(
    private store: Store,
    readonly limit = HISTORY_LIMIT,
  ) {}

  record(before: GameState, label: string, ts = Date.now()) {
    const db = this.store.db;
    db.prepare("INSERT INTO state_history (campaign_id, version, ts, label, data) VALUES (?, ?, ?, ?, ?)").run(
      before.campaignId,
      before.version,
      ts,
      clip(label),
      JSON.stringify(before),
    );
    db.prepare(
      "DELETE FROM state_history WHERE campaign_id = ? AND id NOT IN (SELECT id FROM state_history WHERE campaign_id = ? ORDER BY id DESC LIMIT ?)",
    ).run(before.campaignId, before.campaignId, this.limit);
  }

  /** Newest first. */
  list(campaignId: string, limit = this.limit): HistoryEntry[] {
    return this.store.db
      .prepare("SELECT id, version, ts, label FROM state_history WHERE campaign_id = ? ORDER BY id DESC LIMIT ?")
      .all(campaignId, limit) as HistoryEntry[];
  }

  latest(campaignId: string): (HistoryEntry & { state: GameState }) | undefined {
    const row = this.store.db
      .prepare("SELECT id, version, ts, label, data FROM state_history WHERE campaign_id = ? ORDER BY id DESC LIMIT 1")
      .get(campaignId) as (HistoryEntry & { data: string }) | undefined;
    return row ? hydrate(row) : undefined;
  }

  /** Newest snapshot with this version. */
  get(campaignId: string, version: number): (HistoryEntry & { state: GameState }) | undefined {
    const row = this.store.db
      .prepare("SELECT id, version, ts, label, data FROM state_history WHERE campaign_id = ? AND version = ? ORDER BY id DESC LIMIT 1")
      .get(campaignId, version) as (HistoryEntry & { data: string }) | undefined;
    return row ? hydrate(row) : undefined;
  }

  /** Drop the entry `id` and everything newer (after a restore those changes no longer exist). */
  truncateFrom(campaignId: string, id: number) {
    this.store.db.prepare("DELETE FROM state_history WHERE campaign_id = ? AND id >= ?").run(campaignId, id);
  }

  clear(campaignId: string) {
    this.store.db.prepare("DELETE FROM state_history WHERE campaign_id = ?").run(campaignId);
  }
}

function hydrate(row: HistoryEntry & { data: string }): HistoryEntry & { state: GameState } {
  const { data, ...entry } = row;
  return { ...entry, state: GameState.parse(JSON.parse(data)) };
}

function clip(s: string) {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > LABEL_MAX ? `${one.slice(0, LABEL_MAX - 1)}…` : one;
}

/** Short, human-readable label for a tool call: name + args, with entity ids replaced by names. */
export function toolLabel(name: string, args: unknown, state?: GameState, source: "dm" | "host" = "dm"): string {
  const names = new Map<string, string>();
  for (const c of state?.characters ?? []) names.set(c.id, c.name);
  for (const m of state?.monsters ?? []) names.set(m.id, m.name);
  const parts: string[] = [];
  if (args && typeof args === "object") {
    for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
      if (v === undefined || v === null || v === "") continue;
      if (typeof v === "string" && names.has(v)) parts.push(names.get(v)!);
      else if (typeof v === "object") parts.push(`${k}=${JSON.stringify(v).slice(0, 24)}`);
      else parts.push(`${k}=${String(v).slice(0, 24)}`);
    }
  }
  return clip(`${source === "host" ? "host: " : ""}${name}${parts.length ? ` ${parts.join(" ")}` : ""}`);
}

/**
 * Build the state to commit when restoring `snapshot` over `current`: the whole snapshot (so combat,
 * tokens and monsters stay consistent), with a version above the current one so clients accept it,
 * no stale active-speaker badge, and voice sample counts taken from the live voiceprint table.
 */
export function restoredState(current: GameState, snapshot: GameState, voiceSamples: Map<string, number>): GameState {
  const s = structuredClone(snapshot);
  s.campaignId = current.campaignId;
  s.version = current.version + 1;
  s.activeSpeaker = undefined;
  for (const p of s.players) p.voiceSamples = voiceSamples.get(p.id) ?? 0;
  return s;
}

/** True when two states differ only by `version` (read-only tools like get_party_status). */
export function sameState(a: GameState, b: GameState): boolean {
  return JSON.stringify({ ...a, version: 0 }) === JSON.stringify({ ...b, version: 0 });
}
