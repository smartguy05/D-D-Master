import { describe, expect, it } from "vitest";
import { Store } from "../db/index.js";
import type { EngineContext } from "../engine/tools.js";
import { GameService } from "./service.js";

describe("GameService rules data", () => {
  it("loads the spell and class catalogs and passes them to the engine context", async () => {
    const game = new GameService(new Store(":memory:"));
    await game.init();
    expect(game.spells.size).toBeGreaterThanOrEqual(300);
    expect(game.classes.size).toBe(12);
    expect(game.capabilities()).toMatchObject({ srdSpells: game.spells.size, srdClasses: 12 });
    const ctx = (game as unknown as { engineCtx(): EngineContext }).engineCtx();
    expect(ctx.spell("fireball")?.level).toBe(3);
    expect(ctx.spell("not a spell")).toBeUndefined();
    expect(ctx.spell("Fire")).toBeUndefined();
    expect(ctx.spellCandidates("Fire")).toEqual(expect.arrayContaining(["Fire Bolt", "Fireball"]));
    expect(ctx.classData("Wizard")?.levels[4].slots).toEqual([4, 3, 2]);
    expect(ctx.classData("wizard")?.featureText("Arcane Recovery")).toMatch(/Short Rest/);
    expect(ctx.classData("Artificer")).toBeUndefined();
  });
});

async function rulesGame() {
  const g = new GameService(new Store(":memory:"));
  await g.init();
  g.hub.broadcast = () => undefined;
  g.createCampaign({ name: "Rules" });
  return g;
}

describe("GameService rules engine wiring", () => {
  it("derives slots, hit dice and resources when a character is created", async () => {
    const g = await rulesGame();
    const c = g.addCharacter({ name: "Lyra", className: "Wizard", level: 5, maxHp: 27, abilities: { str: 8, dex: 14, con: 12, int: 16, wis: 12, cha: 10 } });
    expect(c.spellSlots.map((s) => s.max)).toEqual([4, 3, 2]);
    expect(c.hitDice).toEqual({ die: 6, max: 5, used: 0 });
    expect(c.resources.map((r) => r.name)).toEqual(["Arcane Recovery"]);
    expect(g.state!.characters[0]).toEqual(c);
  });

  it("upgrades an old save on load (and persists it), without touching set values", async () => {
    const g = await rulesGame();
    const id = g.campaign!.id;
    const old = {
      campaignId: id,
      characters: [
        { id: "pc_w", playerName: "Alex", name: "Lyra", className: "Wizard", level: 5, maxHp: 27, hp: 11 },
        { id: "pc_k", playerName: "Jo", name: "Kel", className: "Warlock", level: 5, maxHp: 30, hp: 30, hitDice: { die: 8, max: 5, used: 2 }, pactSlots: { level: 3, max: 2, used: 2 } },
      ],
      version: 3,
    };
    g.store.db.prepare("UPDATE game_states SET data = ? WHERE campaign_id = ?").run(JSON.stringify(old), id);
    g.loadCampaign(id);
    const [w, k] = g.state!.characters;
    expect(w.spellSlots.map((s) => s.max)).toEqual([4, 3, 2]);
    expect(w.hp).toBe(11);
    expect(k.hitDice.used).toBe(2);
    expect(k.pactSlots?.used).toBe(2);
    expect(g.store.getState(id)!.characters[0].hitDice.max).toBe(5);
  });

  it("host edits of class or level re-derive the maxima but keep what was spent", async () => {
    const g = await rulesGame();
    const c = g.addCharacter({ name: "Lyra", className: "Wizard", level: 3, maxHp: 17 });
    await g.runTool("cast_spell", { caster_id: c.id, spell: "Magic Missile" }, "host");
    g.updateCharacter(c.id, { level: 5 });
    const n = g.state!.characters[0];
    expect(n.spellSlots).toEqual([
      { level: 1, max: 4, used: 1 },
      { level: 2, max: 3, used: 0 },
      { level: 3, max: 2, used: 0 },
    ]);
    expect(n.hitDice.max).toBe(5);
  });

  it("cast_spell through runTool is undoable; a failed cast leaves no history entry", async () => {
    const g = await rulesGame();
    const c = g.addCharacter({ name: "Lyra", className: "Wizard", level: 5, maxHp: 27 });
    const before = g.listHistory().length;
    const bad = (await g.runTool("cast_spell", { caster_id: c.id, spell: "Fire" }, "dm")) as { did_you_mean: string[] };
    expect(bad.did_you_mean).toEqual(expect.arrayContaining(["Fireball"]));
    expect(g.listHistory().length).toBe(before);
    await g.runTool("cast_spell", { caster_id: c.id, spell: "Fireball" }, "dm");
    expect(g.state!.characters[0].spellSlots[2].used).toBe(1);
    g.undo();
    expect(g.state!.characters[0].spellSlots[2].used).toBe(0);
  });

  it("a phone's physical death save goes through submitPhysicalRoll", async () => {
    const g = await rulesGame();
    const p = g.addPlayer("Alex");
    const c = g.addCharacter({ name: "Lyra", className: "Wizard", level: 1, maxHp: 7, diceMode: "physical" }, p.id);
    await g.runTool("apply_damage", { target_id: c.id, amount: 7 }, "dm");
    await g.runTool("death_save", { character_id: c.id }, "dm");
    expect(g.state!.pendingRoll).toMatchObject({ kind: "death_save", characterId: c.id });
    const r = (await g.submitPhysicalRoll({ total: 20, playerId: p.id })) as { death_save: { natural20: boolean } };
    expect(r.death_save.natural20).toBe(true);
    expect(g.state!.characters[0].hp).toBe(1);
  });

  it("a host level edit keeps a hand-added resource, and fields sent in the same patch win", async () => {
    const g = await rulesGame();
    const c = g.addCharacter({ name: "Lyra", className: "Wizard", level: 5, maxHp: 27 });
    g.updateCharacter(c.id, { resources: [...c.resources, { name: "Wand of Magic Missiles", max: 7, used: 0, resetOn: "long" }] });
    g.updateCharacter(c.id, { level: 6 });
    expect(g.state!.characters[0].resources.map((r) => r.name)).toContain("Wand of Magic Missiles");
    const slots = [
      { level: 1, max: 4, used: 0 },
      { level: 2, max: 3, used: 0 },
      { level: 3, max: 3, used: 0 }, // house rule / item: one extra 3rd-level slot
    ];
    g.updateCharacter(c.id, { level: 5, spellSlots: slots });
    expect(g.state!.characters[0].spellSlots).toEqual(slots);
    expect(g.state!.characters[0].hitDice.max).toBe(5);
  });

  it("each patched rules field wins over the re-derive on a level change", async () => {
    const g = await rulesGame();
    const k = g.addCharacter({ name: "Kel", className: "Warlock", level: 5, maxHp: 30 });
    const resources = [{ name: "Hex Charges", max: 2, used: 0, resetOn: "long" as const }];
    g.updateCharacter(k.id, { level: 6, resources });
    expect(g.state!.characters[0].resources).toEqual(resources);
    const pactSlots = { level: 3, max: 3, used: 1 };
    g.updateCharacter(k.id, { level: 7, pactSlots });
    expect(g.state!.characters[0].pactSlots).toEqual(pactSlots);
    const hitDice = { die: 10, max: 8, used: 2 };
    g.updateCharacter(k.id, { level: 8, hitDice });
    expect(g.state!.characters[0].hitDice).toEqual(hitDice);
    expect(g.state!.characters[0].pactSlots).toEqual({ level: 4, max: 2, used: 1 }); // re-derived when not patched
  });

  it("raising a downed PC's HP in the host editor wakes them and resets death saves", async () => {
    const g = await rulesGame();
    const c = g.addCharacter({ name: "Lyra", className: "Wizard", level: 5, maxHp: 27 });
    await g.runTool("apply_damage", { target_id: c.id, amount: 27 }, "dm");
    await g.runTool("apply_damage", { target_id: c.id, amount: 1 }, "dm"); // one death-save failure
    expect(g.state!.characters[0]).toMatchObject({ hp: 0, conditions: ["Unconscious"] });
    // CharacterEditor "Save" sends { hp, maxHp, ac, gold, appearance }.
    g.updateCharacter(c.id, { hp: 10, maxHp: 27 });
    expect(g.state!.characters[0]).toMatchObject({ hp: 10, conditions: [], deathSaves: { successes: 0, failures: 0, stable: false } });
    // A patch that sets conditions/deathSaves itself is left alone, and a Dead PC is not woken.
    await g.runTool("apply_damage", { target_id: c.id, amount: 10 }, "dm");
    g.updateCharacter(c.id, { hp: 5, conditions: ["Unconscious"] });
    expect(g.state!.characters[0].conditions).toEqual(["Unconscious"]);
    g.updateCharacter(c.id, { hp: 0, conditions: ["Dead"] });
    g.updateCharacter(c.id, { hp: 5 });
    expect(g.state!.characters[0].conditions).toEqual(["Dead"]);
  });

  it("commit() upgrades an old snapshot restored from history", async () => {
    const g = await rulesGame();
    const id = g.campaign!.id;
    g.addPlayer("Sam"); // a labelled change so there is a current state to rewind from
    const old = { campaignId: id, characters: [{ id: "pc_w", playerName: "Alex", name: "Lyra", className: "Wizard", level: 5, maxHp: 27, hp: 27 }], version: 1 };
    g.store.db
      .prepare("INSERT INTO state_history (campaign_id, version, ts, label, data) VALUES (?, ?, ?, ?, ?)")
      .run(id, 1, Date.now(), "old", JSON.stringify(old));
    g.restoreHistory(1);
    expect(g.state!.characters[0].spellSlots.map((s) => s.max)).toEqual([4, 3, 2]);
    expect(g.store.getState(id)!.characters[0].hitDice.max).toBe(5);
  });

  it("the voice builder passes a subclass through and the character gets its slots", async () => {
    const g = await rulesGame();
    const p = g.addPlayer("Sam");
    g.startCharacterBuilder(p.id, 3);
    g.updateCharacterDraft({ name: "Vex", species: "Elf", className: "Wizard", subclass: "Evoker", abilities: { str: 8, dex: 14, con: 12, int: 16, wis: 12, cha: 10 } });
    const res = g.finalizeCharacter();
    expect(res.ok).toBe(true);
    const ch = g.state!.characters[0];
    expect(ch).toMatchObject({ subclass: "Evoker", level: 3, hitDice: { die: 6, max: 3 } });
    expect(ch.spellSlots.map((s) => s.max)).toEqual([4, 2]);
  });
});

/** Round trips the host Party tab relies on (apps/web/src/host/RulesPanel.tsx). */
describe("host rules UI round trips", () => {
  const ch = (g: GameService, id: string) => g.state!.characters.find((c) => c.id === id)!;

  it("a host slot PATCH sticks (not re-derived on commit), for SRD and non-SRD classes and Pact slots", async () => {
    const g = await rulesGame();
    const w = g.addCharacter({ name: "Mira", maxHp: 10, className: "Wizard", level: 3 });
    const withUsed = (used: number) => ch(g, w.id).spellSlots.map((s) => (s.level === 1 ? { ...s, used } : s));
    g.updateCharacter(w.id, { spellSlots: withUsed(1) });
    expect(ch(g, w.id).spellSlots.find((s) => s.level === 1)).toEqual({ level: 1, max: 4, used: 1 });
    g.updateCharacter(w.id, { hp: 9 }); // another commit
    expect(ch(g, w.id).spellSlots.find((s) => s.level === 1)?.used).toBe(1);
    g.updateCharacter(w.id, { spellSlots: withUsed(0) });
    expect(ch(g, w.id).spellSlots.find((s) => s.level === 1)?.used).toBe(0);

    const k = g.addCharacter({ name: "Kai", maxHp: 10, className: "Warlock", level: 3 });
    g.updateCharacter(k.id, { pactSlots: { ...ch(g, k.id).pactSlots!, used: 1 } });
    expect(ch(g, k.id).pactSlots?.used).toBe(1);

    const h = g.addCharacter({ name: "Hex", maxHp: 10, className: "Artificer", level: 2 });
    g.updateCharacter(h.id, { spellSlots: [{ level: 1, max: 2, used: 0 }] });
    g.updateCharacter(h.id, { spellSlots: [{ level: 1, max: 2, used: 1 }] });
    expect(ch(g, h.id).spellSlots).toEqual([{ level: 1, max: 2, used: 1 }]);
  });

  it("resource -/+ via use_resource with amount 1 / -1", async () => {
    const g = await rulesGame();
    const b = g.addCharacter({ name: "Brak", maxHp: 20, className: "Barbarian", level: 3 });
    await g.runTool("use_resource", { character_id: b.id, resource: "Rage", amount: 1 }, "host");
    expect(ch(g, b.id).resources.find((r) => r.name === "Rage")?.used).toBe(1);
    await g.runTool("use_resource", { character_id: b.id, resource: "Rage", amount: -1 }, "host");
    expect(ch(g, b.id).resources.find((r) => r.name === "Rage")?.used).toBe(0);
  });

  it("level_up returns subclass_options, then succeeds when retried with one; a non-SRD subclass returns a note", async () => {
    const g = await rulesGame();
    const f = g.addCharacter({ name: "Fen", maxHp: 20, className: "Fighter", level: 2 });
    const first = (await g.runTool("level_up", { character_id: f.id, hp: "average" }, "host")) as { error?: string; subclass_options?: string[] };
    expect(first.error).toBeTruthy();
    expect(first.subclass_options?.length).toBeGreaterThan(0);
    const second = (await g.runTool("level_up", { character_id: f.id, hp: "average", subclass: first.subclass_options![0] }, "host")) as { error?: string; level: number };
    expect(second.error).toBeUndefined();
    expect(ch(g, f.id).level).toBe(3);

    const e = g.addCharacter({ name: "Echo", maxHp: 20, className: "Fighter", level: 2 });
    const res = (await g.runTool("level_up", { character_id: e.id, hp: "average", subclass: "Echo Knight" }, "host")) as { note?: string };
    expect(res.note).toMatch(/by hand/);
  });

  it("short_rest takes the host panel's args (hit_dice by id)", async () => {
    const g = await rulesGame();
    const f = g.addCharacter({ name: "Fen", maxHp: 20, className: "Fighter", level: 3 });
    g.updateCharacter(f.id, { hp: 5 });
    await g.runTool("short_rest", { character_ids: [f.id], hit_dice: { [f.id]: 3 } }, "host");
    expect(ch(g, f.id).hp).toBeGreaterThan(5);
    expect(ch(g, f.id).hitDice.used).toBeGreaterThan(0);
  });
});
