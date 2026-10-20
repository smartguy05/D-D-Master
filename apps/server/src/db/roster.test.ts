import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Campaign, Character, emptyGameState } from "@dm/shared";
import { Store } from "./index.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const mara = (patch: Partial<Character> = {}) =>
  Character.parse({ id: "pc_m", playerName: "Sam", name: "Mara", maxHp: 30, hp: 30, level: 5, gold: 120, ...patch });

function campaign(store: Store, id = "cmp_a") {
  store.saveCampaign(Campaign.parse({ id, name: "A", createdAt: 1, updatedAt: 1 }));
  store.saveState(emptyGameState(id));
}

/** A store whose roster API may not exist yet (RED). */
type RosterStore = Store & {
  listRoster(): { id: string; name: string; data: Character; createdAt: number; updatedAt: number }[];
  getRoster(id: string): { id: string; name: string; data: Character; createdAt: number; updatedAt: number } | undefined;
  saveRoster(id: string, name: string, data: Character): void;
  deleteRoster(id: string): void;
  getRosterVoiceprint(id: string): { embedding: Float32Array; samples: number } | undefined;
  saveRosterVoiceprint(id: string, embedding: Float32Array, samples: number): void;
};
const open = (file = ":memory:") => new Store(file) as RosterStore;

const tables = (s: Store) => (s.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
const columns = (s: Store, t: string) => (s.db.prepare(`PRAGMA table_info(${t})`).all() as { name: string; type: string; notnull: number; pk: number }[]);
const fks = (s: Store, t: string) => s.db.prepare(`PRAGMA foreign_key_list(${t})`).all() as { table: string; from: string; to: string; on_delete: string }[];

describe("roster tables", () => {
  it("creates roster_characters and roster_voiceprints", () => {
    const s = open();
    expect(tables(s)).toEqual(expect.arrayContaining(["roster_characters", "roster_voiceprints"]));
    const rc = columns(s, "roster_characters");
    expect(rc.map((c) => c.name).sort()).toEqual(["created_at", "data", "id", "name", "updated_at"]);
    expect(rc.find((c) => c.name === "id")?.pk).toBe(1);
    for (const n of ["name", "data", "created_at", "updated_at"]) expect(rc.find((c) => c.name === n)?.notnull).toBe(1);
    const rv = columns(s, "roster_voiceprints");
    expect(rv.map((c) => c.name).sort()).toEqual(["embedding", "roster_id", "samples"]);
    expect(rv.find((c) => c.name === "roster_id")?.pk).toBe(1);
  });

  it("roster_voiceprints cascades from roster_characters and neither references campaigns", () => {
    const s = open();
    const rvFk = fks(s, "roster_voiceprints");
    expect(rvFk).toEqual([expect.objectContaining({ table: "roster_characters", from: "roster_id", to: "id", on_delete: "CASCADE" })]);
    expect(fks(s, "roster_characters")).toEqual([]);
    expect(rvFk.some((f) => f.table === "campaigns")).toBe(false);
  });

  it("re-opening an existing DB file (with campaigns and voiceprints) keeps them and does not throw", () => {
    const dir = mkdtempSync(join(tmpdir(), "dm-roster-db-"));
    dirs.push(dir);
    const file = join(dir, "dm.sqlite");
    const first = open(file);
    campaign(first);
    first.saveVoiceprint("cmp_a", "plr_1", Float32Array.from([1, 2, 3]), 3);
    first.saveRoster("ros_1", "Mara", mara());
    first.db.close();

    const second = open(file);
    expect(second.listCampaigns().map((c) => c.id)).toEqual(["cmp_a"]);
    expect(second.getVoiceprints("cmp_a")).toHaveLength(1);
    expect(second.listRoster().map((r) => r.id)).toEqual(["ros_1"]);
    second.db.close();
  });
});

describe("Store roster methods", () => {
  it("saveRoster/getRoster round-trips the character data", () => {
    const s = open();
    s.saveRoster("ros_1", "Mara", mara({ rosterId: "ros_1" } as Partial<Character>));
    const row = s.getRoster("ros_1")!;
    expect(row).toMatchObject({ id: "ros_1", name: "Mara" });
    expect(row.data).toEqual(mara({ rosterId: "ros_1" } as Partial<Character>));
    expect(typeof row.createdAt).toBe("number");
    expect(row.updatedAt).toBeGreaterThanOrEqual(row.createdAt);
    expect(s.getRoster("ros_missing")).toBeUndefined();
  });

  it("listRoster orders by updated_at DESC", async () => {
    const s = open();
    s.saveRoster("ros_1", "Mara", mara());
    await new Promise((r) => setTimeout(r, 5));
    s.saveRoster("ros_2", "Bryn", mara({ name: "Bryn" }));
    await new Promise((r) => setTimeout(r, 5));
    expect(s.listRoster().map((r) => r.id)).toEqual(["ros_2", "ros_1"]);
    s.saveRoster("ros_1", "Mara", mara({ level: 6 }));
    expect(s.listRoster().map((r) => r.id)).toEqual(["ros_1", "ros_2"]);
    expect(s.listRoster()[0].data.level).toBe(6);
  });

  it("saveRoster upserts: keeps created_at, bumps updated_at, one row", async () => {
    const s = open();
    s.saveRoster("ros_1", "Mara", mara());
    const before = s.getRoster("ros_1")!;
    await new Promise((r) => setTimeout(r, 5));
    s.saveRoster("ros_1", "Mara the Bold", mara({ name: "Mara the Bold", gold: 300 }));
    const after = s.getRoster("ros_1")!;
    expect(s.listRoster()).toHaveLength(1);
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.updatedAt).toBeGreaterThan(before.updatedAt);
    expect(after.name).toBe("Mara the Bold");
    expect(after.data.gold).toBe(300);
  });

  it("a roster voiceprint round-trips element-wise and upserts", () => {
    const s = open();
    s.saveRoster("ros_1", "Mara", mara());
    expect(s.getRosterVoiceprint("ros_1")).toBeUndefined();
    const emb = Float32Array.from([0.25, -0.5, 1.5, 3.125]);
    s.saveRosterVoiceprint("ros_1", emb, 4);
    const got = s.getRosterVoiceprint("ros_1")!;
    expect(got.embedding).toBeInstanceOf(Float32Array);
    expect(Array.from(got.embedding)).toEqual(Array.from(emb));
    expect(got.samples).toBe(4);

    s.saveRosterVoiceprint("ros_1", Float32Array.from([9, 8]), 7);
    const again = s.getRosterVoiceprint("ros_1")!;
    expect(Array.from(again.embedding)).toEqual([9, 8]);
    expect(again.samples).toBe(7);
    expect((s.db.prepare("SELECT COUNT(*) AS n FROM roster_voiceprints").get() as { n: number }).n).toBe(1);
  });

  it("deleteRoster removes the row and its voiceprint (cascade)", () => {
    const s = open();
    s.saveRoster("ros_1", "Mara", mara());
    s.saveRoster("ros_2", "Bryn", mara({ name: "Bryn" }));
    s.saveRosterVoiceprint("ros_1", Float32Array.from([1, 2]), 2);
    s.saveRosterVoiceprint("ros_2", Float32Array.from([3, 4]), 2);
    s.deleteRoster("ros_1");
    expect(s.getRoster("ros_1")).toBeUndefined();
    expect(s.getRosterVoiceprint("ros_1")).toBeUndefined();
    expect(s.listRoster().map((r) => r.id)).toEqual(["ros_2"]);
    expect(s.getRosterVoiceprint("ros_2")).toBeDefined();
  });

  it("deleteCampaign leaves every roster row and roster voiceprint intact", () => {
    const s = open();
    campaign(s, "cmp_a");
    s.saveVoiceprint("cmp_a", "plr_1", Float32Array.from([1, 2, 3]), 3);
    s.saveRoster("ros_1", "Mara", mara());
    s.saveRosterVoiceprint("ros_1", Float32Array.from([1, 2, 3]), 3);
    s.deleteCampaign("cmp_a");
    expect(s.getVoiceprints("cmp_a")).toEqual([]);
    expect(s.listRoster()).toHaveLength(1);
    expect(Array.from(s.getRosterVoiceprint("ros_1")!.embedding)).toEqual([1, 2, 3]);
  });
});
