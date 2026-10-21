import { describe, expect, it } from "vitest";
import { config } from "../config.js";
import { Store } from "../db/index.js";
import { pickAiVoice } from "../realtime/npc-voice.js";
import { buildInstructions } from "../realtime/instructions.js";
import { GameService } from "./service.js";

function table() {
  const game = new GameService(new Store(":memory:"));
  game.hub.broadcast = () => undefined;
  game.createCampaign({ name: "Crypt" });
  const sam = game.addPlayer("Sam");
  const robo = game.addPlayer("Robo", { ai: true });
  const thorin = game.addCharacter({ name: "Thorin", maxHp: 12 }, robo.id);
  game.addCharacter({ name: "Lia", maxHp: 9 }, sam.id);
  return { game, sam, robo, thorin };
}

describe("AI players in GameService", () => {
  it("an AI player gets its own voice, never the DM's", () => {
    const { game, robo } = table();
    const p = game.state!.players.find((x) => x.id === robo.id)!;
    expect(p.ai).toBe(true);
    expect(p.aiVoice).toBeTruthy();
    expect(p.aiVoice).not.toBe(config.realtimeVoice);
  });

  it("turning AI on assigns a voice no other AI player has; the patch ignores unknown keys", () => {
    const { game, sam, robo } = table();
    game.updatePlayer(sam.id, { ai: true, aiPersona: "Cautious", voiceSamples: 99 } as never);
    const players = game.state!.players;
    const a = players.find((x) => x.id === sam.id)!;
    expect(a).toMatchObject({ ai: true, aiPersona: "Cautious", voiceSamples: 0 });
    expect(a.aiVoice).not.toBe(players.find((x) => x.id === robo.id)!.aiVoice);
  });

  it("the one-human shortcut in speaker ID ignores AI players", () => {
    const { game } = table();
    const turn = game.identifySpeaker(0, 1000);
    expect(turn.note).toBe("[speaker: Sam as Lia]");
  });

  it("the DM instructions name the AI players and say who rolls for them", () => {
    const { game } = table();
    const text = buildInstructions(game.campaign!, game.state!);
    expect(text).toContain("played by Robo (AI player)");
    expect(text).toContain("AI PLAYERS: Thorin is played by an AI");
    expect(text).toContain("Never call request_player_roll for them");
  });

  it("nudge refuses when the DM is not running", () => {
    const { game, robo } = table();
    expect(game.nudgeAiPlayer(robo.id)).toEqual({ ok: false, error: "The DM is not running." });
  });
});

describe("pickAiVoice", () => {
  it("never the DM's voice, a free one while any is left, stable per seed", () => {
    const taken: string[] = [];
    for (let i = 0; i < 9; i++) taken.push(pickAiVoice(taken, "cedar", `p${i}`));
    expect(new Set(taken).size).toBe(9);
    expect(taken).not.toContain("cedar");
    expect(pickAiVoice([], "cedar", "Robo")).toBe(pickAiVoice([], "cedar", "Robo"));
  });
});
