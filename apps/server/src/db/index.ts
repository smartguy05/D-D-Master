import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Campaign, Character, CreationDraft, GameState } from "@dm/shared";
import { ROSTER_MEDIA_ID } from "../game/roster.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS game_states (
  campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_campaign ON events(campaign_id, id);
CREATE TABLE IF NOT EXISTS voiceprints (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  embedding BLOB NOT NULL,
  samples INTEGER NOT NULL,
  PRIMARY KEY (campaign_id, player_id)
);
CREATE TABLE IF NOT EXISTS state_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  label TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS state_history_campaign ON state_history(campaign_id, id);
CREATE TABLE IF NOT EXISTS player_notes (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  text TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (campaign_id, player_id)
);
CREATE TABLE IF NOT EXISTS character_drafts (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (campaign_id, player_id)
);
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS roster_characters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS roster_voiceprints (
  roster_id TEXT PRIMARY KEY REFERENCES roster_characters(id) ON DELETE CASCADE,
  embedding BLOB NOT NULL,
  samples INTEGER NOT NULL
);
`;

/** The live OpenAI Realtime voice call, kept so a restarted server can re-attach its sideband. */
export interface ActiveCall {
  callId: string;
  campaignId: string;
  startedAt: number;
}

const ACTIVE_CALL_KEY = "active_voice_call";

/** A hero in the global roster: a fresh snapshot of the character (game/roster.ts). Not tied to a campaign. */
export interface RosterRow {
  id: string;
  name: string;
  data: Character;
  createdAt: number;
  updatedAt: number;
}

const blobToFloat32 = (b: Buffer) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
const float32ToBlob = (f: Float32Array) => Buffer.from(f.buffer, f.byteOffset, f.byteLength);

export interface EventRow {
  id: number;
  ts: number;
  type: string;
  payload: unknown;
}

/** Thin synchronous persistence layer (SQLite). One file for all campaigns. */
export class Store {
  readonly db: Database.Database;

  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);
  }

  listCampaigns(): Campaign[] {
    return this.db
      .prepare("SELECT data FROM campaigns ORDER BY updated_at DESC")
      .all()
      .map((r) => Campaign.parse(JSON.parse((r as { data: string }).data)));
  }

  getCampaign(id: string): Campaign | undefined {
    if (id === ROSTER_MEDIA_ID) return undefined; // <dataDir>/roster holds roster portraits, never a campaign
    const row = this.db.prepare("SELECT data FROM campaigns WHERE id = ?").get(id) as { data: string } | undefined;
    return row ? Campaign.parse(JSON.parse(row.data)) : undefined;
  }

  saveCampaign(c: Campaign) {
    c.updatedAt = Date.now();
    this.db
      .prepare("INSERT INTO campaigns (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
      .run(c.id, JSON.stringify(c), c.updatedAt);
  }

  deleteCampaign(id: string) {
    if (id === ROSTER_MEDIA_ID) throw new Error(`"${ROSTER_MEDIA_ID}" is reserved for the character roster, not a campaign.`);
    this.db.prepare("DELETE FROM campaigns WHERE id = ?").run(id);
  }

  getState(campaignId: string): GameState | undefined {
    const row = this.db.prepare("SELECT data FROM game_states WHERE campaign_id = ?").get(campaignId) as { data: string } | undefined;
    return row ? GameState.parse(JSON.parse(row.data)) : undefined;
  }

  saveState(s: GameState) {
    this.db
      .prepare("INSERT INTO game_states (campaign_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(campaign_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
      .run(s.campaignId, JSON.stringify(s), Date.now());
  }

  deleteEvents(campaignId: string) {
    this.db.prepare("DELETE FROM events WHERE campaign_id = ?").run(campaignId);
  }

  appendEvent(campaignId: string, type: string, payload: unknown) {
    this.db.prepare("INSERT INTO events (campaign_id, ts, type, payload) VALUES (?, ?, ?, ?)").run(campaignId, Date.now(), type, JSON.stringify(payload));
  }

  eventsSince(campaignId: string, sinceTs: number, limit = 2000): EventRow[] {
    return (
      this.db
        .prepare("SELECT id, ts, type, payload FROM events WHERE campaign_id = ? AND ts >= ? ORDER BY id ASC LIMIT ?")
        .all(campaignId, sinceTs, limit) as { id: number; ts: number; type: string; payload: string }[]
    ).map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
  }

  getVoiceprints(campaignId: string): { playerId: string; embedding: Float32Array; samples: number }[] {
    return (
      this.db.prepare("SELECT player_id, embedding, samples FROM voiceprints WHERE campaign_id = ?").all(campaignId) as {
        player_id: string;
        embedding: Buffer;
        samples: number;
      }[]
    ).map((r) => ({
      playerId: r.player_id,
      embedding: new Float32Array(r.embedding.buffer.slice(r.embedding.byteOffset, r.embedding.byteOffset + r.embedding.byteLength)),
      samples: r.samples,
    }));
  }

  saveVoiceprint(campaignId: string, playerId: string, embedding: Float32Array, samples: number) {
    this.db
      .prepare("INSERT INTO voiceprints (campaign_id, player_id, embedding, samples) VALUES (?, ?, ?, ?) ON CONFLICT(campaign_id, player_id) DO UPDATE SET embedding = excluded.embedding, samples = excluded.samples")
      .run(campaignId, playerId, Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength), samples);
  }

  deleteVoiceprint(campaignId: string, playerId: string) {
    this.db.prepare("DELETE FROM voiceprints WHERE campaign_id = ? AND player_id = ?").run(campaignId, playerId);
  }

  deleteVoiceprints(campaignId: string) {
    this.db.prepare("DELETE FROM voiceprints WHERE campaign_id = ?").run(campaignId);
  }

  /** A player's private phone notes (never in GameState, so neither the DM nor other clients see them). */
  getPlayerNotes(campaignId: string, playerId: string): { text: string; updatedAt: number } | undefined {
    const row = this.db.prepare("SELECT text, updated_at FROM player_notes WHERE campaign_id = ? AND player_id = ?").get(campaignId, playerId) as
      | { text: string; updated_at: number }
      | undefined;
    return row && { text: row.text, updatedAt: row.updated_at };
  }

  savePlayerNotes(campaignId: string, playerId: string, text: string, updatedAt = Date.now()) {
    this.db
      .prepare("INSERT INTO player_notes (campaign_id, player_id, text, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(campaign_id, player_id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at")
      .run(campaignId, playerId, text, updatedAt);
  }

  deletePlayerNotes(campaignId: string) {
    this.db.prepare("DELETE FROM player_notes WHERE campaign_id = ?").run(campaignId);
  }

  // ---------- phone character creation drafts (game/creation; never in GameState) ----------

  getCreationDraft(campaignId: string, playerId: string): CreationDraft | undefined {
    const row = this.db.prepare("SELECT data FROM character_drafts WHERE campaign_id = ? AND player_id = ?").get(campaignId, playerId) as { data: string } | undefined;
    return row ? CreationDraft.parse(JSON.parse(row.data)) : undefined;
  }

  saveCreationDraft(campaignId: string, draft: CreationDraft) {
    this.db
      .prepare("INSERT INTO character_drafts (campaign_id, player_id, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(campaign_id, player_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
      .run(campaignId, draft.playerId, JSON.stringify(draft), draft.updatedAt);
  }

  listCreationDrafts(campaignId: string): CreationDraft[] {
    const rows = this.db.prepare("SELECT data FROM character_drafts WHERE campaign_id = ? ORDER BY updated_at").all(campaignId) as { data: string }[];
    return rows.map((r) => CreationDraft.parse(JSON.parse(r.data)));
  }

  deleteCreationDraft(campaignId: string, playerId: string) {
    this.db.prepare("DELETE FROM character_drafts WHERE campaign_id = ? AND player_id = ?").run(campaignId, playerId);
  }

  deleteCreationDrafts(campaignId: string) {
    this.db.prepare("DELETE FROM character_drafts WHERE campaign_id = ?").run(campaignId);
  }

  // ---------- global character roster ----------

  private rosterRow(r: { id: string; name: string; data: string; created_at: number; updated_at: number }): RosterRow {
    return { id: r.id, name: r.name, data: Character.parse(JSON.parse(r.data)), createdAt: r.created_at, updatedAt: r.updated_at };
  }

  /** Every roster hero, most recently saved first. */
  listRoster(): RosterRow[] {
    return (this.db.prepare("SELECT id, name, data, created_at, updated_at FROM roster_characters ORDER BY updated_at DESC, rowid DESC").all() as {
      id: string;
      name: string;
      data: string;
      created_at: number;
      updated_at: number;
    }[]).map((r) => this.rosterRow(r));
  }

  getRoster(id: string): RosterRow | undefined {
    const r = this.db.prepare("SELECT id, name, data, created_at, updated_at FROM roster_characters WHERE id = ?").get(id) as
      | { id: string; name: string; data: string; created_at: number; updated_at: number }
      | undefined;
    return r && this.rosterRow(r);
  }

  /** Upsert: an update keeps created_at and always moves updated_at forward. */
  saveRoster(id: string, name: string, data: Character) {
    const prev = this.db.prepare("SELECT updated_at FROM roster_characters WHERE id = ?").get(id) as { updated_at: number } | undefined;
    const now = Math.max(Date.now(), prev ? prev.updated_at + 1 : 0);
    this.db
      .prepare(
        "INSERT INTO roster_characters (id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, data = excluded.data, updated_at = excluded.updated_at",
      )
      .run(id, name, JSON.stringify(data), now, now);
  }

  /** Removes the hero and (cascade) its roster voiceprint. */
  deleteRoster(id: string) {
    this.db.prepare("DELETE FROM roster_characters WHERE id = ?").run(id);
  }

  getRosterVoiceprint(id: string): { embedding: Float32Array; samples: number } | undefined {
    const r = this.db.prepare("SELECT embedding, samples FROM roster_voiceprints WHERE roster_id = ?").get(id) as { embedding: Buffer; samples: number } | undefined;
    return r && { embedding: blobToFloat32(r.embedding), samples: r.samples };
  }

  saveRosterVoiceprint(id: string, embedding: Float32Array, samples: number) {
    this.db
      .prepare("INSERT INTO roster_voiceprints (roster_id, embedding, samples) VALUES (?, ?, ?) ON CONFLICT(roster_id) DO UPDATE SET embedding = excluded.embedding, samples = excluded.samples")
      .run(id, float32ToBlob(embedding), samples);
  }

  getKv(key: string): string | undefined {
    return (this.db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined)?.value;
  }

  setKv(key: string, value: string | undefined) {
    if (value === undefined) this.db.prepare("DELETE FROM kv WHERE key = ?").run(key);
    else this.db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  getActiveCall(): ActiveCall | undefined {
    const raw = this.getKv(ACTIVE_CALL_KEY);
    if (!raw) return undefined;
    try {
      const v = JSON.parse(raw) as ActiveCall;
      return typeof v.callId === "string" && typeof v.campaignId === "string" ? { callId: v.callId, campaignId: v.campaignId, startedAt: Number(v.startedAt) || 0 } : undefined;
    } catch {
      return undefined;
    }
  }

  setActiveCall(call: ActiveCall) {
    this.setKv(ACTIVE_CALL_KEY, JSON.stringify(call));
  }

  clearActiveCall() {
    this.setKv(ACTIVE_CALL_KEY, undefined);
  }
}
