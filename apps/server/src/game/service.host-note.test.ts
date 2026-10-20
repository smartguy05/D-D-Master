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
