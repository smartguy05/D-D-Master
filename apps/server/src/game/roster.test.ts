import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Character } from "@dm/shared";
import * as shared from "@dm/shared";
import { copyRosterPortraitTo, deleteRosterPortrait, rosterAssetDir, rosterEntryFrom, saveRosterPortrait, snapshotForRoster } from "./roster.js";

/** A versioned roster portrait URL: /media/roster/<id>.png?v=<content hash>. */
const PORTRAIT_URL = (id: string) => new RegExp(`^/media/roster/${id}\\.png\\?v=[0-9a-f]{12}$`);

const RosterEntry = (shared as unknown as Record<string, { parse: (v: unknown) => unknown }>).RosterEntry;

/** The spec's example: a downed level-5 PC mid-adventure. */
function battered(): Character {
  return Character.parse({
    id: "pc_m",
    playerName: "Sam",
    name: "Mara",
    species: "Human",
    className: "Barbarian",
    subclass: "Berserker",
    level: 5,
    background: "Soldier",
    abilities: { str: 18, dex: 14, con: 16, int: 8, wis: 12, cha: 10 },
    maxHp: 55,
    hp: 0,
    tempHp: 5,
    ac: 15,
    speed: 40,
    proficiencyBonus: 3,
    skills: ["Athletics"],
    savingThrows: ["str", "con"],
    attacks: [{ name: "Greataxe", toHit: 7, damage: "1d12+4" }],
    spells: ["Bless"],
    features: ["Rage", "Reckless Attack", "Extra Attack"],
    conditions: ["unconscious"],
    conditionMeta: [{ name: "unconscious" }],
    inventory: [
      { id: "it_axe", name: "Greataxe", qty: 1, equipped: true },
      { id: "it_ring", name: "Ring of Protection", qty: 1, description: "+1 AC" },
    ],
    gold: 120,
    notes: "Owes the guild",
    appearance: "Tall, red braids",
    spriteUrl: "/media/cmp_a/sprite_mara.png",
    diceMode: "physical",
    color: "#ff0000",
    lightRadius: 4,
    spellSlots: [
      { level: 1, max: 4, used: 3 },
      { level: 2, max: 2, used: 1 },
    ],
    pactSlots: { level: 2, max: 2, used: 2 },
    hitDice: { die: 12, max: 5, used: 4 },
    deathSaves: { successes: 1, failures: 2, stable: false, lastRolled: { round: 3, entityId: "pc_m" } },
    concentration: { spell: "Bless", since: 2 },
    resources: [{ name: "Rage", max: 3, used: 2, resetOn: "long" }],
    slotTurn: { round: 3, turn: 1 },
    rosterId: "ros_1",
  } as Record<string, unknown>);
}

describe("snapshotForRoster", () => {
  it("resets the transient combat state to fresh", () => {
    const snap = snapshotForRoster(battered());
    expect(snap.hp).toBe(55);
    expect(snap.tempHp).toBe(0);
    expect(snap.conditions).toEqual([]);
    expect(snap.conditionMeta).toEqual([]);
    expect(snap.concentration).toBeNull();
    expect(snap.deathSaves).toEqual({ successes: 0, failures: 0, stable: false, lastRolled: null });
    expect(snap.spellSlots.map((s) => s.used)).toEqual([0, 0]);
    expect(snap.pactSlots?.used).toBe(0);
    expect(snap.hitDice.used).toBe(0);
    expect(snap.resources.map((r) => r.used)).toEqual([0]);
    expect(snap.slotTurn).toBeUndefined();
    expect("slotTurn" in snap).toBe(false);
  });

  it("keeps the build, maxima, inventory, gold and rosterId", () => {
    const src = battered();
    const snap = snapshotForRoster(src);
    const kept = [
      "name", "playerName", "species", "className", "subclass", "level", "background", "abilities", "maxHp", "ac", "speed",
      "proficiencyBonus", "skills", "savingThrows", "attacks", "spells", "features", "gold", "notes", "appearance",
      "spriteUrl", "diceMode", "color", "lightRadius",
    ] as const;
    for (const k of kept) expect(snap[k], k).toEqual(src[k]);
    expect(snap.inventory.map((i) => ({ id: i.id, name: i.name, qty: i.qty }))).toEqual(src.inventory.map((i) => ({ id: i.id, name: i.name, qty: i.qty })));
    expect(snap.spellSlots.map((s) => [s.level, s.max])).toEqual([[1, 4], [2, 2]]);
    expect(snap.pactSlots).toMatchObject({ level: 2, max: 2 });
    expect(snap.hitDice).toMatchObject({ die: 12, max: 5 });
    expect(snap.resources[0]).toMatchObject({ name: "Rage", max: 3, resetOn: "long" });
    expect((snap as Character & { rosterId?: string }).rosterId).toBe("ros_1");
  });

  it("does not mutate its input and passes Character.parse", () => {
    const src = battered();
    const copy = structuredClone(src);
    const snap = snapshotForRoster(src);
    expect(src).toEqual(copy);
    expect(snap).not.toBe(src);
    expect(snap.spellSlots).not.toBe(src.spellSlots);
    expect(Character.parse(snap)).toEqual(snap);
  });

  it("works for a character with no pact slots", () => {
    const src = battered();
    delete src.pactSlots;
    const snap = snapshotForRoster(src);
    expect(snap.pactSlots).toBeUndefined();
    expect(Character.parse(snap).hp).toBe(55);
  });
});

describe("rosterEntryFrom", () => {
  it("maps the roster row to a RosterEntry", () => {
    const data = snapshotForRoster(battered());
    const e = rosterEntryFrom({ id: "ros_1", data, updatedAt: 1234 }, true);
    expect(e).toMatchObject({
      id: "ros_1",
      name: "Mara",
      playerName: "Sam",
      className: "Barbarian",
      subclass: "Berserker",
      level: 5,
      species: "Human",
      spriteUrl: "/media/cmp_a/sprite_mara.png",
      updatedAt: 1234,
      hasVoiceprint: true,
    });
    expect(RosterEntry.parse(e)).toEqual(e);
  });

  it("hasVoiceprint false and spriteUrl undefined when absent", () => {
    const data = Character.parse({ id: "pc_x", playerName: "", name: "Nobody", maxHp: 5, hp: 5 });
    const e = rosterEntryFrom({ id: "ros_2", data, updatedAt: 1 }, false);
    expect(e.hasVoiceprint).toBe(false);
    expect(e.spriteUrl).toBeUndefined();
    expect(e.level).toBe(1);
    expect(RosterEntry.parse(e)).toEqual(e);
  });
});

describe("roster portrait files", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  function dataDir() {
    const d = mkdtempSync(join(tmpdir(), "dm-roster-"));
    dirs.push(d);
    return d;
  }
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 7, 7, 7]);
  function sprite(dir: string, campaignId: string, file: string, bytes = PNG) {
    const assets = join(dir, campaignId, "assets");
    mkdirSync(assets, { recursive: true });
    writeFileSync(join(assets, file), bytes);
  }

  it("rosterAssetDir is <dataDir>/roster/assets", () => {
    expect(rosterAssetDir("/data")).toBe(join("/data", "roster", "assets"));
  });

  it("copies a campaign sprite to <dataDir>/roster/assets/<rosterId>.png and returns /media/roster/<rosterId>.png", () => {
    const dir = dataDir();
    sprite(dir, "cmp_a", "sprite_mara.png");
    const url = saveRosterPortrait(dir, "ros_1", "/media/cmp_a/sprite_mara.png");
    expect(url).toMatch(PORTRAIT_URL("ros_1"));
    const dest = join(dir, "roster", "assets", "ros_1.png");
    expect(readFileSync(dest)).toEqual(PNG);
  });

  it("the URL changes when the portrait bytes change, and is stable when they don't (/media is served immutable)", () => {
    const dir = dataDir();
    const assets = join(dir, "cmp_a", "assets");
    mkdirSync(assets, { recursive: true });
    writeFileSync(join(assets, "sprite_a1.png"), Buffer.from([1, 1, 1]));
    writeFileSync(join(assets, "sprite_b2.png"), Buffer.from([2, 2, 2]));
    const first = saveRosterPortrait(dir, "ros_1", "/media/cmp_a/sprite_a1.png");
    expect(saveRosterPortrait(dir, "ros_1", undefined)).toBe(first);
    const second = saveRosterPortrait(dir, "ros_1", "/media/cmp_a/sprite_b2.png");
    expect(second).not.toBe(first);
    expect(second).toMatch(PORTRAIT_URL("ros_1"));
    expect(readFileSync(join(dir, "roster", "assets", "ros_1.png"))).toEqual(Buffer.from([2, 2, 2]));
  });

  it("the roster portrait survives deleting the source campaign's folder", () => {
    const dir = dataDir();
    sprite(dir, "cmp_a", "sprite_mara.png");
    saveRosterPortrait(dir, "ros_1", "/media/cmp_a/sprite_mara.png");
    rmSync(join(dir, "cmp_a"), { recursive: true, force: true });
    expect(existsSync(join(dir, "roster", "assets", "ros_1.png"))).toBe(true);
  });

  it("a missing source keeps the previous roster portrait; with none, the URL is undefined", () => {
    const dir = dataDir();
    expect(saveRosterPortrait(dir, "ros_1", "/media/cmp_a/gone.png")).toBeUndefined();
    expect(saveRosterPortrait(dir, "ros_1", undefined)).toBeUndefined();

    sprite(dir, "cmp_a", "sprite_mara.png");
    saveRosterPortrait(dir, "ros_1", "/media/cmp_a/sprite_mara.png");
    rmSync(join(dir, "cmp_a"), { recursive: true, force: true });
    expect(saveRosterPortrait(dir, "ros_1", "/media/cmp_a/sprite_mara.png")).toMatch(PORTRAIT_URL("ros_1"));
    expect(saveRosterPortrait(dir, "ros_1", undefined)).toMatch(PORTRAIT_URL("ros_1"));
    expect(readFileSync(join(dir, "roster", "assets", "ros_1.png"))).toEqual(PNG);
  });

  it("re-saving the portrait from an already-roster URL keeps the file", () => {
    const dir = dataDir();
    sprite(dir, "cmp_a", "sprite_mara.png");
    const url = saveRosterPortrait(dir, "ros_1", "/media/cmp_a/sprite_mara.png")!;
    expect(saveRosterPortrait(dir, "ros_1", url)).toBe(url);
    expect(readFileSync(join(dir, "roster", "assets", "ros_1.png"))).toEqual(PNG);
  });

  it("ignores URLs that are not /media/<campaignId>/<file>.png (no path traversal)", () => {
    const dir = dataDir();
    writeFileSync(join(dir, "secret.png"), PNG);
    expect(saveRosterPortrait(dir, "ros_1", "/media/../secret.png")).toBeUndefined();
    expect(saveRosterPortrait(dir, "ros_1", "https://example.com/x.png")).toBeUndefined();
    expect(existsSync(join(dir, "roster", "assets", "ros_1.png"))).toBe(false);
  });

  it("copyRosterPortraitTo copies into a campaign's assets and returns a /media/<campaignId>/<file>.png URL", () => {
    const dir = dataDir();
    sprite(dir, "cmp_a", "sprite_mara.png");
    saveRosterPortrait(dir, "ros_1", "/media/cmp_a/sprite_mara.png");
    const url = copyRosterPortraitTo(dir, "ros_1", "cmp_b");
    expect(url).toMatch(/^\/media\/cmp_b\/[\w.-]+\.png$/);
    const file = url!.split("/").pop()!;
    expect(readFileSync(join(dir, "cmp_b", "assets", file))).toEqual(PNG);
    expect(copyRosterPortraitTo(dir, "ros_none", "cmp_b")).toBeUndefined();
  });

  it("deleteRosterPortrait removes the file and tolerates a missing one", () => {
    const dir = dataDir();
    sprite(dir, "cmp_a", "sprite_mara.png");
    saveRosterPortrait(dir, "ros_1", "/media/cmp_a/sprite_mara.png");
    deleteRosterPortrait(dir, "ros_1");
    expect(existsSync(join(dir, "roster", "assets", "ros_1.png"))).toBe(false);
    expect(() => deleteRosterPortrait(dir, "ros_1")).not.toThrow();
  });
});
