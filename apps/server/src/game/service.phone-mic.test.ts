import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FloorView, ServerEvent } from "@dm/shared";
import type { Access } from "../auth/access.js";
import { Store } from "../db/index.js";
import type { HubSocket } from "../hub.js";
import { GameService } from "./service.js";

class FakeWs extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  sent: ServerEvent[] = [];
  send(msg: string) {
    this.sent.push(JSON.parse(msg));
  }
  say(ev: unknown) {
    this.emit("message", Buffer.from(JSON.stringify(ev)));
  }
  close() {
    this.readyState = 3;
    this.emit("close");
  }
  floor(): FloorView | undefined {
    return (this.sent.filter((e) => e.type === "floor").at(-1) as Extract<ServerEvent, { type: "floor" }> | undefined)?.floor;
  }
}

const TABLE: Access = { level: "table", anySeat: true };
const v = (...xs: number[]) => Float32Array.from(xs);

/** Two human players (Sam as Lia, Ana as Bo), a fake embedding model, home-network sockets. */
function setup(pushToTalk = true) {
  const store = new Store(":memory:");
  const game = new GameService(store, { pushToTalk });
  const c = game.createCampaign({ name: "Crypt" });
  const sam = game.addPlayer("Sam");
  const ana = game.addPlayer("Ana");
  game.addCharacter({ name: "Lia", maxHp: 9 }, sam.id);
  game.addCharacter({ name: "Bo", maxHp: 9 }, ana.id);
  (game.speaker as any).extractor = {
    dim: 2,
    createStream: () => ({ acceptWaveform: () => undefined, inputFinished: () => undefined }),
    compute: () => v(1, 0),
  };
  const connect = (role: "table" | "player", access: Access = TABLE) => {
    const ws = new FakeWs();
    game.hub.add(ws as FakeWs & HubSocket, access, "lan");
    ws.say({ type: "hello", role });
    return ws;
  };
  /** A home-network phone for this seat; `mic`: it joined the call as the seat's phone mic. */
  const phone = (playerId: string, mic = true) => {
    const ws = connect("player");
    if (mic) ws.say({ type: "rtc_join", prefs: {}, playerId, micOnly: true });
    return ws;
  };
  /** 100 ms of loud PCM16, as a phone or the table streams it. */
  const chunk = () => Buffer.from(new Int16Array(1600).fill(9000).buffer);
  return { store, game, c, sam, ana, connect, phone, chunk };
}

describe("a player's phone as their mic", () => {
  afterEach(() => vi.useRealTimers());

  describe("holding Talk on the phone", () => {
    it("a phone mic's hold is marked phone; a plain phone's hold isn't", () => {
      const { game, phone, sam, ana } = setup();
      const p = phone(sam.id);
      p.say({ type: "ptt", down: true, playerId: sam.id });
      expect(game.floorView().holder).toEqual({ playerId: sam.id, inRoom: true, phone: true });
      p.say({ type: "ptt", down: false, playerId: sam.id });
      vi.useFakeTimers();
      vi.advanceTimersByTime(1000);
      const plain = phone(ana.id, false);
      plain.say({ type: "ptt", down: true, playerId: ana.id });
      expect(game.floorView().holder).toEqual({ playerId: ana.id, inRoom: true });
    });

    it("a phone mic can't hold for another seat as its phone", () => {
      const { game, phone, sam, ana } = setup();
      const p = phone(sam.id);
      p.say({ type: "ptt", down: true, playerId: ana.id });
      expect(game.floorView().holder).toEqual({ playerId: ana.id, inRoom: true });
    });

    it("with push-to-talk off only a phone mic may press, and the turn is that player's", () => {
      const { game, connect, phone, sam, ana } = setup(false);
      const tv = connect("table");
      tv.say({ type: "ptt", down: true });
      phone(ana.id, false).say({ type: "ptt", down: true, playerId: ana.id });
      expect(game.floorView().holder).toBeNull();
      const t0 = Date.now();
      const p = phone(sam.id);
      p.say({ type: "ptt", down: true, playerId: sam.id });
      expect(tv.floor()).toMatchObject({ pushToTalk: false, holder: { playerId: sam.id, phone: true } });
      expect(game.identifySpeaker(t0, Date.now()).note).toBe("[speaker: Sam as Lia (phone mic)]");
      expect((game as any).liveSpeaker(t0, Date.now())).toEqual({ playerId: sam.id, confident: true });
      // Still open mic for everyone else: nothing is outside the floor.
      expect((game as any).dmHost().outsideFloor(t0 - 5000, t0 - 4000)).toBe(false);
      p.say({ type: "ptt", down: false, playerId: sam.id });
      expect(game.floorView().holder).toBeNull();
    });

    it("with push-to-talk on, the phone mic's hold names the speaker as push-to-talk", () => {
      const { game, phone, sam } = setup();
      const t0 = Date.now();
      phone(sam.id).say({ type: "ptt", down: true, playerId: sam.id });
      expect(game.identifySpeaker(t0, Date.now()).note).toBe("[speaker: Sam as Lia (push-to-talk)]");
    });
  });

  describe("recording the voice on the phone", () => {
    beforeEach(() => vi.useFakeTimers());

    it("records the phone's stream for that seat only, and merges it into the voiceprint", () => {
      const { store, game, c, sam, ana, connect, chunk } = setup();
      const tv = connect("table");
      game.audioSocket("table", 1);
      game.audioSocket("player", 1);
      game.audioSocket("player", 1);
      game.startEnrollment(sam.id, "player");
      expect(tv.floor()).toMatchObject({ enrolling: true, enrollingPhone: sam.id });
      const pushed = vi.spyOn(game.speaker.ring, "pushPcm16");
      for (let i = 0; i < 20; i++) {
        vi.advanceTimersByTime(100);
        game.pushAudio(chunk(), "player", sam.id);
        game.pushAudio(chunk(), "player", ana.id);
        game.pushAudio(chunk(), "table");
      }
      // Only Sam's phone reached the ring.
      expect(pushed).toHaveBeenCalledTimes(20);
      const res = game.finishEnrollment(sam.id);
      expect(res).toMatchObject({ ok: true, samples: 1 });
      expect(store.getVoiceprints(c.id).map((p) => p.playerId)).toEqual([sam.id]);
      expect(tv.floor()?.enrollingPhone).toBeUndefined();
      // Out of a recording, a phone stream feeds nothing; the table does.
      pushed.mockClear();
      game.pushAudio(chunk(), "player", sam.id);
      game.pushAudio(chunk(), "table");
      expect(pushed).toHaveBeenCalledTimes(1);
    });

    it("works with the table mic muted, and the words are no DM turn", () => {
      const { game, sam, chunk } = setup();
      game.setMicMuted(true);
      game.audioSocket("player", 1);
      game.startEnrollment(sam.id, "player");
      const t0 = Date.now();
      for (let i = 0; i < 20; i++) {
        vi.advanceTimersByTime(100);
        game.pushAudio(chunk(), "player", sam.id);
      }
      expect(game.speaker.inRecording(t0, Date.now())).toBe(true);
      expect(game.finishEnrollment(sam.id).ok).toBe(true);
    });

    it("refuses a phone recording for an unknown seat, or while another voice is recorded", () => {
      const { game, sam, ana } = setup();
      expect(() => game.startEnrollment("nobody", "player")).toThrow(/No such player/);
      game.startEnrollment(sam.id, "player");
      expect(() => game.startEnrollment(ana.id, "player")).toThrow(/Another voice/);
      // The same phone pressing Record again just restarts its own recording.
      expect(() => game.startEnrollment(sam.id, "player")).not.toThrow();
    });
  });
});
