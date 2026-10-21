import { describe, expect, it, vi } from "vitest";
import { Character, Player, emptyGameState, type GameState, type LogEntry, type ServerEvent } from "@dm/shared";
import type { LLMProvider } from "../brain/provider.js";
import {
  AI_SPEAK_MAX_MS,
  AiPlayerController,
  activeAiSeats,
  addresses,
  aiPlayerPrompt,
  asksParty,
  pickAiTurn,
  playOnSlot,
  type AiPlayerHost,
  type AiSeat,
  type PickContext,
} from "./ai-player.js";

function game(): GameState {
  const s = emptyGameState("c1");
  s.characters.push(
    Character.parse({ id: "pc_t", playerName: "Robo", name: "Thorin Oakheart", className: "Fighter", maxHp: 12, hp: 12, attacks: [{ name: "Greataxe", toHit: 5, damage: "1d12+3" }] }),
    Character.parse({ id: "pc_l", playerName: "Sam", name: "Lyra", className: "Wizard", maxHp: 8, hp: 8 }),
  );
  s.players.push(
    Player.parse({ id: "plr_ai", name: "Robo", characterId: "pc_t", ai: true, aiPersona: "Brave and blunt", aiVoice: "ash" }),
    Player.parse({ id: "plr_sam", name: "Sam", characterId: "pc_l" }),
  );
  return s;
}

let seq = 0;
const entry = (kind: LogEntry["kind"], speaker: string, text: string): LogEntry => ({ id: `log_${++seq}`, ts: Date.now(), kind, speaker, text });

const ctx = (over: Partial<PickContext> = {}): PickContext => ({ newEntries: [], now: 1_000_000, lastSpokeAt: new Map(), actedTurn: new Map(), cooldownMs: 90_000, ...over });

const seatOf = (s: GameState): AiSeat => activeAiSeats(s)[0];

function inCombat(s: GameState, turnIndex: number) {
  s.combat = {
    ...s.combat,
    active: true,
    round: 1,
    turnIndex,
    order: [
      { entityId: "pc_t", entityType: "character", name: "Thorin Oakheart", initiative: 15 },
      { entityId: "pc_l", entityType: "character", name: "Lyra", initiative: 10 },
    ],
  } as GameState["combat"];
}

describe("activeAiSeats", () => {
  it("lists AI players with a living character, not paused ones or humans", () => {
    const s = game();
    expect(activeAiSeats(s).map((x) => x.player.id)).toEqual(["plr_ai"]);
    s.players[0].aiPaused = true;
    expect(activeAiSeats(s)).toEqual([]);
    s.players[0].aiPaused = false;
    s.characters[0].hp = 0;
    expect(activeAiSeats(s)).toEqual([]);
  });
});

describe("addresses / asksParty", () => {
  const seat = seatOf(game());
  it("a question or an opening name speaks to the seat", () => {
    expect(addresses("Thorin, what do you do?", seat)).toBe(true);
    expect(addresses("The ogre roars. What does Thorin do?", seat)).toBe(true);
    expect(addresses("Thorin Oakheart, the door creaks open.", seat)).toBe(true);
    expect(addresses("Robo, you're up.", seat)).toBe(true);
  });
  it("narration that only mentions the character does not", () => {
    expect(addresses("Thorin's axe bites deep into the goblin.", seat)).toBe(false);
    expect(addresses("Lyra, what do you do?", seat)).toBe(false);
  });
  it("party-wide questions", () => {
    expect(asksParty("The bridge sways in the wind. What do you do?")).toBe(true);
    expect(asksParty("Does anyone want to search the chest?")).toBe(true);
    expect(asksParty("The goblin falls.")).toBe(false);
  });
});

describe("pickAiTurn", () => {
  it("acts on its own combat turn once per turn", () => {
    const s = game();
    inCombat(s, 0);
    expect(pickAiTurn(s, ctx())).toMatchObject({ trigger: "combat_turn", seat: { player: { id: "plr_ai" } } });
    expect(pickAiTurn(s, ctx({ actedTurn: new Map([["plr_ai", "1:0"]]) }))).toBeUndefined();
  });

  it("does not act on someone else's turn unless addressed; never spontaneous in combat", () => {
    const s = game();
    inCombat(s, 1);
    expect(pickAiTurn(s, ctx({ newEntries: [entry("dm", "DM", "The ogre lumbers closer.")] }))).toBeUndefined();
    expect(pickAiTurn(s, ctx({ newEntries: [entry("player", "Sam as Lyra", "Thorin, can you cover me?")] }))).toMatchObject({ trigger: "addressed" });
  });

  it("an incapable AI character does not take its turn", () => {
    const s = game();
    inCombat(s, 0);
    s.characters[0].hp = 0;
    expect(pickAiTurn(s, ctx())).toBeUndefined();
  });

  it("its own lines never address it", () => {
    const s = game();
    expect(pickAiTurn(s, ctx({ newEntries: [entry("player", "Robo as Thorin Oakheart", "Thorin, you fool, what now?")], lastSpokeAt: new Map([["plr_ai", 999_999]]) }))).toBeUndefined();
  });

  it("answers a party-wide question out of combat", () => {
    const s = game();
    expect(pickAiTurn(s, ctx({ newEntries: [entry("dm", "DM", "The tavern goes quiet. What do you do?")], lastSpokeAt: new Map([["plr_ai", 999_999]]) }))).toMatchObject({ trigger: "addressed" });
  });

  it("speaks unprompted only after the cooldown and after a DM line", () => {
    const s = game();
    const dm = [entry("dm", "DM", "Rain drums on the roof.")];
    expect(pickAiTurn(s, ctx({ newEntries: dm }))).toMatchObject({ trigger: "spontaneous" });
    expect(pickAiTurn(s, ctx({ newEntries: dm, lastSpokeAt: new Map([["plr_ai", 1_000_000 - 10_000]]) }))).toBeUndefined();
    expect(pickAiTurn(s, ctx({ newEntries: [] }))).toBeUndefined();
  });
});

describe("aiPlayerPrompt", () => {
  it("carries the sheet, board, transcript, persona and the trigger", () => {
    const s = game();
    const { system, prompt } = aiPlayerPrompt({
      seat: seatOf(s),
      trigger: "combat_turn",
      board: { location: "Old Mill", characters: [{ name: "Thorin Oakheart", pos: [2, 3] }] },
      transcript: [entry("dm", "DM", "An ogre bursts in.")],
      adventure: "The Sunken Bell",
    });
    expect(system).toContain("playing the character Thorin Oakheart");
    expect(system).toContain("Brave and blunt");
    expect(system).toMatch(/Never roll dice/);
    expect(prompt).toContain("Greataxe +5 1d12+3");
    expect(prompt).toContain('"location":"Old Mill"');
    expect(prompt).toContain("DM: An ogre bursts in.");
    expect(prompt).toContain("YOUR TURN");
    expect(prompt).toContain("The Sunken Bell");
  });
});

describe("AiPlayerController", () => {
  function setup(reply: { speak: boolean; line: string } | (() => Promise<string>)) {
    const state = { current: game() as GameState | null };
    const events: ServerEvent[] = [];
    const llm: LLMProvider = {
      name: "fake",
      model: "fake",
      complete: vi.fn(typeof reply === "function" ? reply : async () => JSON.stringify(reply)),
    };
    const host: AiPlayerHost = {
      state: () => state.current,
      board: () => ({}),
      adventure: () => undefined,
      llm: () => llm,
      dmLive: () => true,
      tableBusy: vi.fn(() => false),
      speak: vi.fn(async () => true),
      say: vi.fn((line: string) => state.current!.log.push(entry("player", "Robo as Thorin Oakheart", line))),
      broadcast: (ev) => void events.push(ev),
      warn: vi.fn(),
    };
    const ctl = new AiPlayerController(host, { cooldownMs: 90_000, now: () => 1_000_000 });
    return { state, host, llm, ctl, events };
  }

  it("on its combat turn: thinks, plays the line, then hands it to the DM; once per turn", async () => {
    const { state, host, ctl, events } = setup({ speak: true, line: "I charge the ogre and swing my greataxe!" });
    inCombat(state.current!, 0);
    await ctl.onReplyDone();
    expect(host.speak).toHaveBeenCalledWith(expect.objectContaining({ player: expect.objectContaining({ id: "plr_ai" }) }), "I charge the ogre and swing my greataxe!", expect.any(AbortSignal));
    expect(host.say).toHaveBeenCalledWith("I charge the ogre and swing my greataxe!", "plr_ai");
    expect(events.map((e) => (e as { status?: string }).status)).toEqual(["thinking", "speaking", "idle"]);
    await ctl.onReplyDone();
    expect(host.say).toHaveBeenCalledOnce();
  });

  it("an optional trigger may pass (speak=false): nothing is said", async () => {
    const { state, host, ctl } = setup({ speak: false, line: "" });
    state.current!.log.push(entry("dm", "DM", "The wind howls outside."));
    await ctl.onReplyDone();
    expect(host.say).not.toHaveBeenCalled();
  });

  it("drops the line when the table moved on while the model was thinking", async () => {
    let release!: (v: string) => void;
    const { state, host, ctl } = setup(() => new Promise<string>((r) => (release = r)));
    inCombat(state.current!, 0);
    const run = ctl.onReplyDone();
    await Promise.resolve();
    state.current!.combat.turnIndex = 1;
    release(JSON.stringify({ speak: true, line: "I attack!" }));
    await run;
    expect(host.say).not.toHaveBeenCalled();
  });

  it("one decision at a time: a reply finishing meanwhile is looked at afterwards", async () => {
    let release!: (v: string) => void;
    const { state, llm, ctl } = setup(() => new Promise<string>((r) => (release = r)));
    inCombat(state.current!, 0);
    const first = ctl.onReplyDone();
    await Promise.resolve();
    void ctl.onReplyDone();
    expect(llm.complete).toHaveBeenCalledOnce();
    expect(ctl.busy).toBe(true);
    release(JSON.stringify({ speak: true, line: "I attack!" }));
    await first;
  });

  it("nudge forces a line even when the model says no, and refuses paused players", async () => {
    const { state, host, ctl } = setup({ speak: false, line: "Let's keep moving." });
    expect(ctl.nudge("plr_ai")).toEqual({ ok: true });
    await vi.waitFor(() => expect(host.say).toHaveBeenCalledWith("Let's keep moving.", "plr_ai"));
    state.current!.players[0].aiPaused = true;
    expect(ctl.nudge("plr_ai").ok).toBe(false);
    expect(ctl.nudge("plr_sam").ok).toBe(false);
  });

  it("a voice that never finishes doesn't stop the line: the DM gets it after AI_SPEAK_MAX_MS and the seat frees up", async () => {
    vi.useFakeTimers();
    try {
      const { state, host, ctl, events } = setup({ speak: true, line: "I attack!" });
      vi.mocked(host.speak).mockImplementation(() => new Promise<boolean>(() => undefined));
      inCombat(state.current!, 0);
      const run = ctl.onReplyDone();
      await vi.advanceTimersByTimeAsync(AI_SPEAK_MAX_MS - 1);
      expect(host.say).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await run;
      expect(host.say).toHaveBeenCalledWith("I attack!", "plr_ai");
      expect(host.warn).toHaveBeenCalledWith(expect.stringContaining("sending the line as text"));
      // The late clip is given up on, so it never plays after the DM got the text.
      expect((vi.mocked(host.speak).mock.calls[0] as unknown[])[2]).toMatchObject({ aborted: true });
      expect(ctl.busy).toBe(false);
      expect(ctl.statusOf("plr_ai")).toBe("idle");
      expect(events.at(-1)).toMatchObject({ type: "ai_player", status: "idle" });
      // Not stuck busy: the next combat turn is played.
      state.current!.combat.round = 2;
      vi.mocked(host.speak).mockResolvedValue(true);
      await ctl.onReplyDone();
      expect(host.say).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("someone speaks while the model thinks (no log entry yet): the line is dropped, the turn is not spent", async () => {
    let release!: (v: string) => void;
    const { state, host, ctl, llm } = setup(() => new Promise<string>((r) => (release = r)));
    inCombat(state.current!, 0);
    const run = ctl.onReplyDone();
    await Promise.resolve();
    ctl.interrupt("someone at the table spoke");
    release(JSON.stringify({ speak: true, line: "I attack!" }));
    await run;
    expect(host.speak).not.toHaveBeenCalled();
    expect(host.say).not.toHaveBeenCalled();
    expect(ctl.busy).toBe(false);
    // Still its turn: the next finished reply asks again.
    vi.mocked(llm.complete).mockResolvedValue(JSON.stringify({ speak: true, line: "I attack!" }));
    await ctl.onReplyDone();
    expect(host.say).toHaveBeenCalledWith("I attack!", "plr_ai");
  });

  it("the DM starts answering while the clip waits to play: the unheard line is dropped and never sent", async () => {
    const { state, host, ctl } = setup({ speak: true, line: "I attack!" });
    vi.mocked(host.speak).mockImplementation(
      (_seat, _line, signal) => new Promise<boolean>((resolve) => signal!.addEventListener("abort", () => resolve(false))),
    );
    inCombat(state.current!, 0);
    const run = ctl.onReplyDone();
    await vi.waitFor(() => expect(host.speak).toHaveBeenCalled());
    ctl.interrupt("the DM is responding");
    await run;
    expect(host.say).not.toHaveBeenCalled();
    expect(ctl.statusOf("plr_ai")).toBe("idle");
  });

  it("a line already heard when the interrupt comes still goes to the DM", async () => {
    const { state, host, ctl } = setup({ speak: true, line: "I attack!" });
    let finish!: (v: boolean) => void;
    vi.mocked(host.speak).mockImplementation(() => new Promise<boolean>((r) => (finish = r)));
    inCombat(state.current!, 0);
    const run = ctl.onReplyDone();
    await vi.waitFor(() => expect(host.speak).toHaveBeenCalled());
    ctl.interrupt("someone at the table spoke");
    finish(true);
    await run;
    expect(host.say).toHaveBeenCalledWith("I attack!", "plr_ai");
  });

  it("a busy table: no model call at all, and a line ready while the table got busy is dropped", async () => {
    const { state, host, ctl, llm } = setup({ speak: true, line: "I attack!" });
    inCombat(state.current!, 0);
    vi.mocked(host.tableBusy).mockReturnValue(true);
    await ctl.onReplyDone();
    expect(llm.complete).not.toHaveBeenCalled();
    expect(ctl.nudge("plr_ai").ok).toBe(false);
    vi.mocked(host.tableBusy).mockReturnValueOnce(false).mockReturnValue(true);
    await ctl.onReplyDone();
    expect(llm.complete).toHaveBeenCalledOnce();
    expect(host.speak).not.toHaveBeenCalled();
    expect(host.say).not.toHaveBeenCalled();
  });

  it("a model error is a warning, never a crash", async () => {
    const { state, host, ctl } = setup(async () => {
      throw new Error("timeout");
    });
    inCombat(state.current!, 0);
    await ctl.onReplyDone();
    expect(host.warn).toHaveBeenCalledWith(expect.stringContaining("timeout"));
    expect(host.say).not.toHaveBeenCalled();
  });
});

describe("playOnSlot", () => {
  it("an aborted line gives its slot up and never plays (a clip that came back too late)", async () => {
    const play = vi.fn(() => true);
    const cancel = vi.fn();
    const late = new AbortController();
    let finish!: (v: { url: string; durationMs: number }) => void;
    const p = playOnSlot({ play, cancel, done: Promise.resolve(), started: Promise.resolve(false) }, () => new Promise((r) => (finish = r)), "Mira", "Hi.", {}, late.signal);
    late.abort();
    expect(cancel).toHaveBeenCalled();
    finish({ url: "/m.mp3", durationMs: 900 });
    expect(await p).toBe(false);
    expect(play).not.toHaveBeenCalled();
  });

  it("fills the slot with the clip and the speaker's portrait and pc flag", async () => {
    const play = vi.fn(() => true);
    const heard = await playOnSlot({ play, cancel: vi.fn(), done: Promise.resolve(), started: Promise.resolve(true) }, async () => ({ url: "/m.mp3", durationMs: 900 }), "Mira", "Hi.", { portraitUrl: "/mira.png", pc: true });
    expect(play).toHaveBeenCalledWith({ npcName: "Mira", line: "Hi.", url: "/m.mp3", durationMs: 900, portraitUrl: "/mira.png", pc: true });
    expect(heard).toBe(true);
  });

  it("false when the queue never played the clip (dropped while the DM was busy)", async () => {
    const heard = await playOnSlot({ play: () => true, cancel: vi.fn(), done: Promise.resolve(), started: Promise.resolve(false) }, async () => ({ url: "/m.mp3", durationMs: 900 }), "Mira", "Hi.");
    expect(heard).toBe(false);
  });
});
