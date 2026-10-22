import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerEvent } from "@dm/shared";
import { Store } from "../db/index.js";
import { SAMPLE_RATE } from "../speaker/audio.js";
import { GameService } from "./service.js";

const v = (...xs: number[]) => Float32Array.from(xs);

/** A campaign with two enrolled players (Sam ≈ [1,0], Ana ≈ [0,1]) and a fake embedding model. */
function setup({ enrolled = true, pushToTalk = false } = {}) {
  const store = new Store(":memory:");
  const game = new GameService(store, { pushToTalk });
  const c = game.createCampaign({ name: "Crypt" });
  const sam = game.addPlayer("Sam");
  const ana = game.addPlayer("Ana");
  // The embedding the fake model returns for the next clip.
  const model = { next: v(1, 0) };
  (game.speaker as any).extractor = {
    dim: 2,
    createStream: () => ({ acceptWaveform: () => undefined, inputFinished: () => undefined }),
    compute: () => model.next,
  };
  if (enrolled) {
    game.speaker.addSample(c.id, sam.id, v(1, 0));
    game.speaker.addSample(c.id, ana.id, v(0, 1));
  }
  const events: ServerEvent[] = [];
  const broadcast = game.hub.broadcast.bind(game.hub);
  game.hub.broadcast = (ev) => {
    events.push(ev);
    broadcast(ev);
  };
  /** Someone talks for `seconds` (loud enough to survive trimSilence), ending now. */
  const talk = (seconds: number) => {
    vi.advanceTimersByTime(seconds * 1000);
    game.speaker.ring.push(new Float32Array(Math.round(SAMPLE_RATE * seconds)).fill(0.3), Date.now());
  };
  return { store, game, c, sam, ana, model, events, talk };
}

describe("GameService voice ID test", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("says who spoke with every player's score, and saves nothing", () => {
    const { store, game, c, sam, ana, model, events, talk } = setup();
    game.startVoiceTest();
    talk(2);
    model.next = v(0.95, 0.1);
    const res = game.finishVoiceTest();
    expect(res.ok).toBe(true);
    expect(res.match).toMatchObject({ playerId: sam.id, confident: true });
    expect(res.scores.map((s) => s.playerId)).toEqual([sam.id, ana.id]);
    expect(events.at(-1)).toMatchObject({ type: "voice_test", ok: true, playerId: sam.id, confident: true });
    expect(store.getVoiceprints(c.id).map((p) => p.samples)).toEqual([1, 1]);
    expect(game.state?.players.map((p) => p.voiceSamples)).toEqual([0, 0]);
  });

  it("reports an unsure match when two voices score alike", () => {
    const { game, model, talk } = setup();
    game.startVoiceTest();
    talk(2);
    model.next = v(0.7, 0.69);
    const res = game.finishVoiceTest();
    expect(res.ok).toBe(true);
    expect(res.match?.confident).toBe(false);
  });

  it("needs enough speech and at least one voiceprint", () => {
    const short = setup();
    short.game.startVoiceTest();
    short.talk(0.3);
    expect(short.game.finishVoiceTest()).toMatchObject({ ok: false, message: expect.stringMatching(/enough speech/), scores: [] });
    expect(short.events.at(-1)).toMatchObject({ type: "voice_test", ok: false });

    const empty = setup({ enrolled: false });
    empty.game.startVoiceTest();
    empty.talk(2);
    expect(empty.game.finishVoiceTest()).toMatchObject({ ok: false, message: expect.stringMatching(/No voices/) });
  });

  it("a test and an enrollment don't finish each other", () => {
    const { game, sam, talk } = setup();
    game.startVoiceTest();
    talk(2);
    expect(game.finishEnrollment(sam.id).ok).toBe(false);
    expect(game.finishVoiceTest().ok).toBe(true);
    game.startEnrollment(sam.id);
    talk(2);
    expect(game.finishVoiceTest()).toMatchObject({ ok: false, message: expect.stringMatching(/No voice test/) });
    expect(game.finishEnrollment(sam.id).ok).toBe(true);
  });

  it("keeps the table mic open while testing, like enrollment", () => {
    const { game } = setup({ pushToTalk: true });
    game.startVoiceTest();
    expect(game.floorView().enrolling).toBe(true);
    game.finishVoiceTest();
    expect(game.floorView().enrolling).toBeUndefined();
  });

  it("the DM drops a turn said during the test or an enrollment, not one after it", () => {
    const { game, sam, talk } = setup();
    const host = (game as any).dmHost();
    const t0 = Date.now();
    game.startVoiceTest();
    talk(2);
    expect(host.inVoiceRecording(t0 - 450, Date.now())).toBe(true);
    game.finishVoiceTest();
    // The turn is committed just after Done: its speech still overlaps the recording.
    vi.advanceTimersByTime(500);
    expect(host.inVoiceRecording(t0 + 500, Date.now() - 400)).toBe(true);
    // Someone talks afterwards: a normal turn.
    vi.advanceTimersByTime(2000);
    expect(host.inVoiceRecording(Date.now() - 1000, Date.now())).toBe(false);

    game.startEnrollment(sam.id);
    talk(2);
    expect(host.inVoiceRecording(Date.now() - 1000, Date.now())).toBe(true);
  });
});
