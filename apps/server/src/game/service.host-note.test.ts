import { describe, expect, it, vi } from "vitest";
import { Store } from "../db/index.js";
import { GameService } from "./service.js";

/** GameService on an in-memory DB with a fake running DM that records notes and prompts. */
function setup() {
  const game = new GameService(new Store(":memory:"));
  game.createCampaign({ name: "Test", partyLevel: 2 });
  vi.spyOn(game.hub, "broadcast").mockImplementation(() => undefined);
  const dm = { isOpen: true, prompt: vi.fn(), addSystemNote: vi.fn(), refreshInstructions: vi.fn(), holdResponses: vi.fn(), close: vi.fn() };
  (game as any).dm = dm;
  const sam = game.addPlayer("Sam");
  const alex = game.addPlayer("Alex");
  const thorin = game.addCharacter({ name: "Thorin", maxHp: 12 }, sam.id);
  const lyra = game.addCharacter({ name: "Lyra", maxHp: 8, diceMode: "physical" }, alex.id);
  return { game, dm, sam, alex, thorin, lyra };
}

const texts = (dm: ReturnType<typeof setup>["dm"]) => [...dm.prompt.mock.calls, ...dm.addSystemNote.mock.calls].map((c) => String(c[0]));

describe("host tool calls are told to the live DM", () => {
  it("adds a silent 'Host did:' system note (no spoken response) for a host tool call", async () => {
    const { game, dm, thorin } = setup();
    await game.runTool("give_item", { character_id: thorin.id, name: "Torch", qty: 2 }, "host");
    expect(dm.addSystemNote).toHaveBeenCalledWith(expect.stringMatching(/^Host did:.*give_item/));
    expect(dm.prompt).not.toHaveBeenCalled();
  });

  it("does not note the DM's own tool calls", async () => {
    const { game, dm, thorin } = setup();
    await game.runTool("give_item", { character_id: thorin.id, name: "Torch" }, "dm");
    expect(texts(dm).some((t) => t.includes("Host did:"))).toBe(false);
  });
});

describe("physical roll from the phone/host", () => {
  it("tells the DM the roll is already recorded and not to record it again", async () => {
    const { game, dm, alex, lyra } = setup();
    await game.runTool("request_player_roll", { character_id: lyra.id, notation: "1d20+2", label: "Athletics", dc: 12 });
    await game.submitPhysicalRoll({ total: 15, playerId: alex.id });
    const note = texts(dm).find((t) => t.includes("physical dice"));
    expect(note).toBeDefined();
    expect(note).toContain("already recorded");
    expect(note).toContain("do not call record_physical_roll");
    expect(texts(dm).some((t) => t.startsWith("Host did:"))).toBe(false); // one note, not two
  });
});

describe("physical damage roll from the phone/host", () => {
  it("applies the pending damage roll to its target and tells the DM damage was applied", async () => {
    const { game, dm, alex, lyra } = setup();
    game.state!.monsters.push({
      id: "m_gob",
      name: "Goblin",
      maxHp: 7,
      hp: 7,
      ac: 13,
      initiativeBonus: 0,
      speed: 30,
      attacksPerAction: 1,
      attacks: [{ name: "Scimitar", toHit: 4, damage: "1d6+2" }],
      conditions: [],
      hidden: false,
      npc: false,
      appearance: "",
      ally: false,
      follows: false,
      combatant: true,
      neutral: false,
      conditionMeta: [],
    });
    await game.runTool("request_player_roll", { character_id: lyra.id, notation: "1d6+2", label: "Shortsword damage", target_id: "m_gob", kind: "damage" });
    expect(game.state!.pendingRoll).toMatchObject({ kind: "damage", targetId: "m_gob" });
    await game.submitPhysicalRoll({ total: 5, playerId: alex.id });
    expect(game.state!.monsters.find((m) => m.id === "m_gob")!.hp).toBe(2);
    expect(game.state!.pendingRoll).toBeUndefined();
    const note = texts(dm).find((t) => t.includes("physical dice"));
    expect(note).toBeDefined();
    expect(note).toMatch(/damage[_ ]applied/i);
  });
});

describe("critical physical damage from the phone/host", () => {
  /** Thorin is down (0 HP, Unconscious); Lyra's damage roll at him is pending. */
  async function downedTarget() {
    const ctx = setup();
    const t = ctx.game.state!.characters.find((c) => c.id === ctx.thorin.id)!;
    t.hp = 0;
    t.conditions = ["Unconscious"];
    t.deathSaves = { ...t.deathSaves, successes: 0, failures: 0, stable: false };
    await ctx.game.runTool("request_player_roll", { character_id: ctx.lyra.id, notation: "1d6+2", label: "Shortsword damage", target_id: ctx.thorin.id, kind: "damage" });
    expect(ctx.game.state!.pendingRoll).toMatchObject({ kind: "damage", targetId: ctx.thorin.id });
    return ctx;
  }
  const failures = (game: GameService, id: string) => game.state!.characters.find((c) => c.id === id)!.deathSaves.failures;

  it("critical: true from the pad applies the damage as a critical hit (2 death-save failures)", async () => {
    const { game, alex, thorin } = await downedTarget();
    await game.submitPhysicalRoll({ total: 5, playerId: alex.id, critical: true } as Parameters<GameService["submitPhysicalRoll"]>[0]);
    expect(failures(game, thorin.id)).toBe(2);
  });

  it("a non-boolean critical is ignored (the pending roll's flag applies: none here, 1 failure)", async () => {
    const { game, alex, thorin } = await downedTarget();
    await game.submitPhysicalRoll({ total: 5, playerId: alex.id, critical: "yes" } as unknown as Parameters<GameService["submitPhysicalRoll"]>[0]);
    expect(failures(game, thorin.id)).toBe(1);
  });
});

describe("host end_campaign reaches the live DM (bug: host-end-campaign-dm-unaware)", () => {
  it("a host end_campaign adds a system note and refreshes the DM's instructions", async () => {
    const { game, dm } = setup();
    await game.runTool("end_campaign", { outcome: "success", epilogue: "The bell rings again." }, "host");
    expect(dm.addSystemNote).toHaveBeenCalledWith(expect.stringMatching(/^Host did: end_campaign.*completed/));
    expect(dm.refreshInstructions).toHaveBeenCalled();
    expect(dm.prompt).not.toHaveBeenCalled();
  });

  it("the DM's own end_campaign gets no note (it has the tool result)", async () => {
    const { game, dm } = setup();
    await game.runTool("end_campaign", { outcome: "success" }, "dm");
    expect(game.campaign?.status).toBe("completed");
    expect(dm.addSystemNote).not.toHaveBeenCalled();
  });

  it("a death-rule auto end tells the live DM to narrate the ending", async () => {
    const { game, dm, thorin, lyra } = setup();
    await game.runTool("add_condition", { target_id: thorin.id, condition: "Dead" }, "host");
    expect(dm.addSystemNote).not.toHaveBeenCalledWith(expect.stringMatching(/campaign/i));
    await game.runTool("add_condition", { target_id: lyra.id, condition: "Dead" }, "host");
    expect(game.campaign?.status).toBe("failed");
    expect(dm.addSystemNote).toHaveBeenCalledWith(expect.stringMatching(/failed[\s\S]*every player character is dead/i));
  });
});
