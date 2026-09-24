import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Campaign, GameState } from "@dm/shared";

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
`;

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
}
