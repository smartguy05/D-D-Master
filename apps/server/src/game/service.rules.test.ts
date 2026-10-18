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
    expect(ctx.classData("Wizard")?.levels[4].slots).toEqual([4, 3, 2]);
    expect(ctx.classData("wizard")?.featureText("Arcane Recovery")).toMatch(/Short Rest/);
    expect(ctx.classData("Artificer")).toBeUndefined();
  });
});
