import { afterEach, describe, expect, it, vi } from "vitest";
import { DmSession } from "../realtime/session.js";
import { READY_CHECK_MAX_AGE_MS, READY_CHECK_MAX_INPUTS } from "./readyCheck.js";
import { Store } from "../db/index.js";
import { GameService } from "./service.js";

/** Two locations, a fake live DM, one human (Sam as Lia) and one AI seat (Robo as Thorin); open mic (no push-to-talk). */
function setup() {
  const game = new GameService(new Store(":memory:"), { pushToTalk: false });
  vi.spyOn(game.hub, "broadcast").mockImplementation(() => undefined);
  (game as any).images = { map: async () => "/m.png", sprite: async () => "/s.png", cachedSprite: () => undefined, readAsset: () => undefined, available: true };
  (game as any).readFeatures = async () => ({ features: [], walls: [] });
  game.createCampaign({ name: "Test" });
  game.updateOutline({
    title: "T",
    locations: [
      { id: "loc_a", name: "Alpha", gridW: 10, gridH: 8 },
      { id: "loc_b", name: "Bravo", gridW: 10, gridH: 8 },
    ],
  });
  const dm = { isOpen: true, prompt: vi.fn(), addSystemNote: vi.fn(), refreshInstructions: vi.fn(), sendPlayerText: vi.fn(), holdResponses: vi.fn(), close: vi.fn() };
  (game as any).dm = dm;
  const sam = game.addPlayer("Sam");
  const robo = game.addPlayer("Robo", { ai: true });
  const thorin = game.addCharacter({ name: "Thorin", maxHp: 12 }, robo.id);
  const lia = game.addCharacter({ name: "Lia", maxHp: 9 }, sam.id);
  return { game, sam, robo, thorin, lia };
}

/** The voice path: the turn is answered (DmHost.onTurnAccepted), then its transcript is logged. */
const speak = (game: GameService, text: string) => {
  const host = (game as any).dmHost();
  host.onTurnAccepted();
  host.onPlayerText(text, "Sam as Lia");
};

describe("change_scene ready check", () => {
  afterEach(() => vi.useRealTimers());
  it("the first arrival needs no ready check", async () => {
    const { game } = setup();
    expect(await game.runTool("change_scene", { location_id: "loc_a" })).toMatchObject({ location: "Alpha" });
    expect(game.state!.locationId).toBe("loc_a");
  });

  it("leaving is refused until a human answers; an AI player's line doesn't count", async () => {
    const { game, robo } = setup();
    await game.runTool("change_scene", { location_id: "loc_a" });
    game.sendText("Let's head on to Bravo.", robo.id);
    const refused = (await game.runTool("change_scene", { location_id: "loc_b" })) as { error: string; ask: string[] };
    expect(refused.ask).toEqual(["Lia"]);
    expect(refused.error).toContain("ask Lia by name whether they are ready");
    expect(game.state!.locationId).toBe("loc_a");
    // Retried with only the AI talking: still refused.
    game.sendText("Come on, let's go!", robo.id);
    expect(await game.runTool("change_scene", { location_id: "loc_b" })).toHaveProperty("ask");
    speak(game, "Yeah, I'm ready.");
    expect(await game.runTool("change_scene", { location_id: "Bravo" })).toMatchObject({ location: "Bravo" });
    expect(game.state!.locationId).toBe("loc_b");
  });

  it("an answer counts only for the place that was asked about", async () => {
    const { game } = setup();
    await game.runTool("change_scene", { location_id: "loc_a" });
    await game.runTool("change_scene", { location_id: "loc_b" });
    speak(game, "Sure.");
    await game.runTool("change_scene", { location_id: "loc_b" });
    // Next departure asks again.
    expect(await game.runTool("change_scene", { location_id: "loc_a" })).toHaveProperty("ask");
  });

  it("forced moves, AI-only groups and the host skip the check", async () => {
    const { game, thorin } = setup();
    await game.runTool("change_scene", { location_id: "loc_a" });
    expect(await game.runTool("change_scene", { location_id: "loc_b", character_ids: [thorin.id] })).not.toHaveProperty("ask");
    expect(game.state!.locationId).toBe("loc_b");
    await game.runTool("focus_scene", { location_id: "loc_a" });
    expect(await game.runTool("change_scene", { location_id: "loc_b", forced: true })).not.toHaveProperty("ask");
    await game.runTool("change_scene", { location_id: "loc_a" }, "host");
    expect(game.state!.locationId).toBe("loc_a");
  });

  it("a transcript alone (no answered turn) doesn't count: the turn may have been skipped as noise", async () => {
    const { game } = setup();
    await game.runTool("change_scene", { location_id: "loc_a" });
    await game.runTool("change_scene", { location_id: "loc_b" });
    (game as any).dmHost().onPlayerText("uh", "Sam as Lia");
    expect(await game.runTool("change_scene", { location_id: "loc_b" })).toHaveProperty("ask");
  });

  it("a yes answered on the gate timeout, before its transcript arrives, still counts", async () => {
    vi.useFakeTimers();
    const { game } = setup();
    await game.runTool("change_scene", { location_id: "loc_a" });
    const owner: { dm?: DmSession } = {};
    const s = new DmSession((game as any).dmHost(owner), "voice", "rtc_1", { turnGate: true, turnGateTimeoutMs: 1200, log: () => undefined });
    (s as any).ws = { readyState: 1, send: () => undefined, close: () => undefined };
    owner.dm = s;
    (game as any).dm = s;
    expect(await game.runTool("change_scene", { location_id: "loc_b" })).toHaveProperty("ask");
    const emit = (ev: Record<string, unknown>) => (s as any).onEvent(ev);
    emit({ type: "input_audio_buffer.speech_started" });
    emit({ type: "input_audio_buffer.speech_stopped" });
    emit({ type: "input_audio_buffer.committed", item_id: "it_yes" });
    vi.advanceTimersByTime(1200); // answered on the timeout; no transcript yet
    expect(await game.runTool("change_scene", { location_id: "loc_b" })).toMatchObject({ location: "Bravo" });
    // The late transcript is logged but not counted twice.
    emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "it_yes", transcript: "Yes." });
    expect(game.state!.log.some((l) => l.kind === "player" && l.text === "Yes.")).toBe(true);
    expect((game as any).humanInputs).toBe(1);
    s.close();
  });

  it("a stale check (over 5 minutes old) is refused again as a fresh one", async () => {
    vi.useFakeTimers();
    const { game } = setup();
    await game.runTool("change_scene", { location_id: "loc_a" });
    await game.runTool("change_scene", { location_id: "loc_b" });
    speak(game, "Hmm, maybe.");
    vi.advanceTimersByTime(READY_CHECK_MAX_AGE_MS + 1);
    expect(await game.runTool("change_scene", { location_id: "loc_b" })).toHaveProperty("ask");
    speak(game, "Yes, let's go.");
    expect(await game.runTool("change_scene", { location_id: "loc_b" })).toMatchObject({ location: "Bravo" });
  });

  it(`a check after more than ${READY_CHECK_MAX_INPUTS} human lines is stale too`, async () => {
    const { game } = setup();
    await game.runTool("change_scene", { location_id: "loc_a" });
    await game.runTool("change_scene", { location_id: "loc_b" });
    for (let i = 0; i <= READY_CHECK_MAX_INPUTS; i++) speak(game, `line ${i}`);
    expect(await game.runTool("change_scene", { location_id: "loc_b" })).toHaveProperty("ask");
    speak(game, "Ready.");
    expect(await game.runTool("change_scene", { location_id: "loc_b" })).toMatchObject({ location: "Bravo" });
  });

  it("the party moving by another path clears the pending check", async () => {
    const { game } = setup();
    await game.runTool("change_scene", { location_id: "loc_a" });
    await game.runTool("change_scene", { location_id: "loc_b" });
    speak(game, "Sure.");
    // The host moves the party to Bravo and back: the old answer is about a departure that happened.
    await game.runTool("change_scene", { location_id: "loc_b" }, "host");
    expect((game as any).readyCheck).toBeUndefined();
    await game.runTool("change_scene", { location_id: "loc_a" }, "host");
    expect(await game.runTool("change_scene", { location_id: "loc_b" })).toHaveProperty("ask");
  });

  it("loading a campaign or starting a new DM session clears it", async () => {
    vi.useFakeTimers();
    const { game } = setup();
    await game.runTool("change_scene", { location_id: "loc_a" });
    await game.runTool("change_scene", { location_id: "loc_b" });
    expect((game as any).readyCheck).toBeDefined();
    game.loadCampaign(game.campaign!.id);
    expect((game as any).readyCheck).toBeUndefined();
    await game.runTool("change_scene", { location_id: "loc_b" });
    expect((game as any).readyCheck).toBeDefined();
    (game as any).createCall = async () => ({ answerSdp: "answer", callId: "rtc_new" });
    await game.startVoice("offer");
    expect((game as any).readyCheck).toBeUndefined();
    game.stopDm();
  });

  it("an unknown location gets change_scene's own error, not a ready check", async () => {
    const { game } = setup();
    await game.runTool("change_scene", { location_id: "loc_a" });
    const out = await game.runTool("change_scene", { location_id: "loc_nowhere" }).catch((e: Error) => ({ thrown: e.message }));
    expect(out).not.toHaveProperty("ask");
    expect((game as any).readyCheck).toBeUndefined();
  });
});
