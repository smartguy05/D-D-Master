import { describe, expect, it, vi } from "vitest";
import type { ServerEvent } from "@dm/shared";
import { Store } from "../db/index.js";
import { GameService } from "./service.js";

/** GameService on an in-memory DB with a fake running DM (no OpenAI key needed). */
function setup() {
  const game = new GameService(new Store(":memory:"));
  game.createCampaign({ name: "Test", partyLevel: 2 });
  const events: ServerEvent[] = [];
  vi.spyOn(game.hub, "broadcast").mockImplementation((ev) => void events.push(ev));
  const dm = { isOpen: true, prompt: vi.fn(), refreshInstructions: vi.fn(), close: vi.fn() };
  (game as any).dm = dm;
  const sam = game.addPlayer("Sam");
  const alex = game.addPlayer("Alex");
  const thorin = game.addCharacter({ name: "Thorin", maxHp: 12, abilities: { str: 16, dex: 12, con: 14, int: 8, wis: 10, cha: 10 } }, sam.id);
  const lyra = game.addCharacter({ name: "Lyra", maxHp: 8, diceMode: "physical" }, alex.id);
  return { game, events, dm, sam, alex, thorin, lyra };
}

describe("player phone actions", () => {
  it("rolls for a virtual-dice player, broadcasts the roll and tells the DM", async () => {
    const { game, events, dm, sam } = setup();
    const res = await game.playerRoll(sam.id, "1d20+3", "Stealth");
    expect(res.dmInformed).toBe(true);
    const roll = events.find((e) => e.type === "roll");
    expect(roll && roll.type === "roll" && roll.roll).toMatchObject({ rollerName: "Thorin", label: "Stealth", total: res.total });
    expect(dm.prompt).toHaveBeenCalledWith(expect.stringContaining(`Sam as Thorin rolled Stealth: ${res.total}`));
    expect(game.state!.log.at(-1)?.text).toContain("Thorin rolled Stealth");
  });

  it("still rolls when no DM is running", async () => {
    const { game, sam } = setup();
    (game as any).dm = undefined;
    expect((await game.playerRoll(sam.id, "1d20", "Perception")).dmInformed).toBe(false);
  });

  it("refuses phone rolls for physical-dice players, unknown players and bad notation", async () => {
    const { game, alex, sam } = setup();
    await expect(game.playerRoll(alex.id, "1d20", "x")).rejects.toThrow(/physical dice/);
    await expect(game.playerRoll("plr_nope", "1d20", "x")).rejects.toThrow(/Unknown player/);
    await expect(game.playerRoll(sam.id, "banana", "x")).rejects.toThrow();
  });

  it("only lets the pending character's player submit a physical total", async () => {
    const { game, events, dm, sam, alex, lyra } = setup();
    await game.runTool("request_player_roll", { character_id: lyra.id, notation: "1d20+2", label: "Athletics", dc: 12 });
    await expect(game.submitPhysicalRoll({ total: 15, playerId: sam.id })).rejects.toThrow(/No roll is waiting for Thorin/);
    await expect(game.submitPhysicalRoll({ total: 1700, playerId: alex.id })).rejects.toThrow(/between/);
    expect(game.state!.pendingRoll?.characterId).toBe(lyra.id);

    const res = await game.submitPhysicalRoll({ total: "15", playerId: alex.id });
    expect(res).toMatchObject({ character: "Lyra", total: 15, success: true });
    expect(game.state!.pendingRoll).toBeUndefined();
    expect(events.some((e) => e.type === "roll" && e.roll.physical && e.roll.label === "Athletics")).toBe(true);
    expect(dm.prompt).toHaveBeenCalledWith(expect.stringContaining("physical dice"));
    await expect(game.submitPhysicalRoll({ total: 3, playerId: alex.id })).rejects.toThrow(/No roll is waiting/);
  });

  it("host submission defaults to the pending character and refuses a different one", async () => {
    const { game, thorin, lyra } = setup();
    await game.runTool("request_player_roll", { character_id: lyra.id, notation: "1d20", label: "Save" });
    await expect(game.submitPhysicalRoll({ total: 9, characterId: thorin.id })).rejects.toThrow(/pending roll is for Lyra/);
    expect(await game.submitPhysicalRoll({ total: 9 })).toMatchObject({ character: "Lyra", total: 9 });
    await expect(game.submitPhysicalRoll({ total: 9 })).rejects.toThrow(/No physical roll is pending/);
  });

  it("lets a player switch only their own dice mode", () => {
    const { game, sam, thorin } = setup();
    game.setPlayerDiceMode(sam.id, "physical");
    expect(game.state!.characters.find((c) => c.id === thorin.id)?.diceMode).toBe("physical");
    expect(() => game.setPlayerDiceMode(sam.id, "psychic")).toThrow();
  });
});

describe("voice character builder (service)", () => {
  it("host start prompts the DM; DM drafts and finalizes a character for the player", async () => {
    const { game, dm } = setup();
    const jo = game.addPlayer("Jo");
    const started = game.startCharacterBuilder(jo.id, undefined, "host");
    expect(started).toMatchObject({ player: "Jo", level: 2 });
    expect(dm.prompt).toHaveBeenCalledWith(expect.stringContaining("CHARACTER BUILDER for Jo"));

    const partial = (await game.runTool("draft_character_update", { name: "Pip", species: "Halfling", abilities: { dex: 15 } })) as { missing: string[] };
    expect(partial.missing).toContain("className");
    expect(game.state!.builder?.draft).toMatchObject({ name: "Pip", species: "Halfling" });

    const early = (await game.runTool("finalize_character", {})) as { ok: boolean; missing: string[] };
    expect(early.ok).toBe(false);

    await game.runTool("draft_character_update", { className: "Rogue", abilities: { str: 8, con: 14, int: 12, wis: 10, cha: 13 }, skills: ["Stealth"] });
    const done = (await game.runTool("finalize_character", {})) as { ok: boolean; character: { id: string; hp: number } };
    expect(done.ok).toBe(true);
    const s = game.state!;
    expect(s.builder).toBeUndefined();
    const ch = s.characters.find((c) => c.id === done.character.id)!;
    expect(ch).toMatchObject({ name: "Pip", playerName: "Jo", className: "Rogue", level: 2, maxHp: 17, ac: 12 });
    expect(s.players.find((p) => p.id === jo.id)?.characterId).toBe(ch.id);
  });

  it("DM can start it by player name; host can edit level and cancel", async () => {
    const { game, dm } = setup();
    const out = (await game.runTool("start_character_builder", { player_id: "alex", level: 4 })) as { player: string; level: number };
    expect(out).toMatchObject({ player: "Alex", level: 4 });
    expect(dm.prompt).not.toHaveBeenCalledWith(expect.stringContaining("CHARACTER BUILDER"));
    game.updateCharacterDraft({ name: "Vex" }, 3);
    expect(game.state!.builder).toMatchObject({ level: 3, draft: { name: "Vex" } });
    game.cancelCharacterBuilder();
    expect(game.state!.builder).toBeUndefined();
    await expect(game.runTool("draft_character_update", { name: "x" })).rejects.toThrow(/No character is being built/);
  });
});
