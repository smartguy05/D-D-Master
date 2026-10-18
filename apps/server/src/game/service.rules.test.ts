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
