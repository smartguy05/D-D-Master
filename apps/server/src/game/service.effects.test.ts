import { describe, expect, it } from "vitest";
import type { ServerEvent } from "@dm/shared";
import { Store } from "../db/index.js";
import { GameService } from "./service.js";

describe("GameService effect events", () => {
  it("broadcasts effect events after the state for damage, heal and play_effect", async () => {
    const game = new GameService(new Store(":memory:"));
    const events: ServerEvent[] = [];
    game.hub.broadcast = (ev) => void events.push(ev);
    game.createCampaign({ name: "Test" });
    const pc = game.addCharacter({ name: "Thorin", maxHp: 12 });
    events.length = 0;

    await game.runTool("apply_damage", { target_id: pc.id, amount: 4, damage_type: "slashing" }, "host");
    expect(events.map((e) => e.type)).toEqual(["state", "effect"]);
    expect(events[1]).toMatchObject({ type: "effect", effect: { kind: "hit", targetId: pc.id, element: "slashing" } });

    events.length = 0;
    await game.runTool("heal", { target_id: "Thorin", amount: 2 }, "host");
    expect(events.find((e) => e.type === "effect")).toMatchObject({ effect: { kind: "heal", targetId: pc.id } });

    events.length = 0;
    await game.runTool("play_effect", { kind: "fireball", target_id: pc.id, radius: 4 }, "dm");
    expect(events.filter((e) => e.type === "effect")).toHaveLength(1);

    // effects are transient: never stored in the game state
    expect(JSON.stringify(game.state)).not.toContain("fireball");
  });
});
