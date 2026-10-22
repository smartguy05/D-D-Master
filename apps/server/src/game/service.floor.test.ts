import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FLOOR_MAX_HOLD_MS, FLOOR_TAIL_MS, type FloorView, type ServerEvent } from "@dm/shared";
import type { Access } from "../auth/access.js";
import type { OriginKind } from "../auth/origin.js";
import { ENROLL_MAX_MS } from "../speaker/service.js";
import { Store } from "../db/index.js";
import type { HubSocket } from "../hub.js";
import { PTT_MIN_GAP_MS } from "./floor.js";
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

/** A campaign with two human players (Sam as Lia, Ana as Bo) and an AI seat (Robo as Thorin). */
function setup(pushToTalk = true) {
  const game = new GameService(new Store(":memory:"), { pushToTalk });
  game.createCampaign({ name: "Crypt" });
  const sam = game.addPlayer("Sam");
  const ana = game.addPlayer("Ana");
  const robo = game.addPlayer("Robo", { ai: true });
  game.addCharacter({ name: "Lia", maxHp: 9 }, sam.id);
  game.addCharacter({ name: "Bo", maxHp: 9 }, ana.id);
  game.addCharacter({ name: "Thorin", maxHp: 12 }, robo.id);
  const connect = (role: "host" | "table" | "player", access?: Access, origin?: OriginKind) => {
    const ws = new FakeWs();
    game.hub.add(ws as FakeWs & HubSocket, access, origin);
    ws.say({ type: "hello", role });
    return ws;
  };
  /** A player cookie bound to this seat, from `origin` (default: through the tunnel). */
  const remote = (playerId: string, origin: OriginKind = "remote") =>
    connect("player", { level: "player", anySeat: false, playerId, sid: `s_${playerId}` }, origin);
  return { game, connect, remote, sam, ana, robo };
}

describe("GameService push-to-talk floor", () => {
  afterEach(() => vi.useRealTimers());

  it("the floor is in every client's snapshot, players included", () => {
    const { connect, remote, sam } = setup();
    expect(connect("host").floor()).toEqual({ pushToTalk: true, holder: null });
    expect(remote(sam.id).floor()).toEqual({ pushToTalk: true, holder: null });
  });

  it("/table presses for the room; release frees it; everyone sees it", () => {
    vi.useFakeTimers();
    const { game, connect, remote, sam } = setup();
    const tv = connect("table", TABLE);
    const phone = remote(sam.id);
    tv.say({ type: "ptt", down: true });
    expect(phone.floor()).toEqual({ pushToTalk: true, holder: { room: true }, holdLeftMs: FLOOR_MAX_HOLD_MS });
    expect(game.floorView().holder).toEqual({ room: true });
    tv.say({ type: "ptt", down: false });
    expect(phone.floor()?.holder).toBeNull();
  });

  it("/host presses for the room (its Talk button); only that socket can release", () => {
    const { game, connect } = setup();
    const host = connect("host");
    const tv = connect("table", TABLE);
    host.say({ type: "ptt", down: true });
    expect(game.floorView().holder).toEqual({ room: true });
    expect(tv.floor()?.holder).toEqual({ room: true });
    // The TV's own Space release is not the host's hold.
    tv.say({ type: "ptt", down: false });
    expect(game.floorView().holder).toEqual({ room: true });
    host.say({ type: "ptt", down: false });
    expect(game.floorView().holder).toBeNull();
    expect(tv.floor()?.holder).toBeNull();
  });

  it("a remote player presses only for its own seat (not in the room)", () => {
    const { game, remote, sam, ana } = setup();
    const phone = remote(sam.id);
    phone.say({ type: "ptt", down: true, playerId: ana.id });
    expect(game.floorView().holder).toBeNull();
    phone.say({ type: "ptt", down: true });
    expect(game.floorView().holder).toEqual({ playerId: sam.id, inRoom: false });
    // Another socket can't release it for them.
    remote(ana.id).say({ type: "ptt", down: false });
    expect(game.floorView().holder).toEqual({ playerId: sam.id, inRoom: false });
  });

  it("a home-network phone presses for a human seat it names (in the room); unknown and AI seats are refused", () => {
    const { game, connect, sam, robo } = setup();
    const lan = connect("player", TABLE);
    lan.say({ type: "ptt", down: true, playerId: "p_nobody" });
    lan.say({ type: "ptt", down: true, playerId: robo.id });
    lan.say({ type: "ptt", down: true, playerId: 42 });
    expect(game.floorView().holder).toBeNull();
    lan.say({ type: "ptt", down: true, playerId: sam.id });
    expect(game.floorView().holder).toEqual({ playerId: sam.id, inRoom: true });
  });

  it("a phone can't press for the room", () => {
    const { game, connect, remote, sam } = setup();
    connect("player", TABLE).say({ type: "ptt", down: true });
    remote(sam.id).say({ type: "ptt", down: true, playerId: undefined });
    // The remote phone's press is for its own seat, never the room.
    expect(game.floorView().holder).toEqual({ playerId: sam.id, inRoom: false });
  });

  it("first speaker wins; the second press is refused until the first lets go", () => {
    vi.useFakeTimers();
    const { game, connect, remote, sam } = setup();
    const tv = connect("table", TABLE);
    const phone = remote(sam.id);
    tv.say({ type: "ptt", down: true });
    phone.say({ type: "ptt", down: true });
    expect(game.floorView().holder).toEqual({ room: true });
    tv.say({ type: "ptt", down: false });
    vi.advanceTimersByTime(PTT_MIN_GAP_MS);
    phone.say({ type: "ptt", down: true });
    expect(game.floorView().holder).toEqual({ playerId: sam.id, inRoom: false });
  });

  it("a socket that closes while holding the floor releases it", () => {
    const { game, remote, sam } = setup();
    const phone = remote(sam.id);
    phone.say({ type: "ptt", down: true });
    phone.close();
    expect(game.floorView().holder).toBeNull();
  });

  it("another socket of the same seat can't release a hold it didn't make", () => {
    const { game, remote, sam } = setup();
    const a = remote(sam.id);
    const b = remote(sam.id);
    a.say({ type: "ptt", down: true });
    b.say({ type: "ptt", down: false });
    b.close();
    expect(game.floorView().holder).toEqual({ playerId: sam.id, inRoom: false });
  });

  it("releases on its own after the max hold and tells everyone", () => {
    vi.useFakeTimers();
    const { game, connect } = setup();
    const tv = connect("table", TABLE);
    tv.say({ type: "ptt", down: true });
    vi.advanceTimersByTime(FLOOR_MAX_HOLD_MS);
    expect(tv.floor()?.holder).toBeNull();
    expect(game.floorView().holder).toBeNull();
  });

  it("the floor tells everyone how long the hold has left before the cap (holdLeftMs), from when it is sent", () => {
    vi.useFakeTimers();
    const { game, connect, remote, sam } = setup();
    const tv = connect("table", TABLE);
    remote(sam.id).say({ type: "ptt", down: true });
    expect(tv.floor()?.holdLeftMs).toBe(FLOOR_MAX_HOLD_MS);
    vi.advanceTimersByTime(12_000);
    // A page that connects mid-hold gets what is left in its snapshot.
    expect(connect("table", TABLE).floor()?.holdLeftMs).toBe(FLOOR_MAX_HOLD_MS - 12_000);
    expect(game.floorView().holdLeftMs).toBe(FLOOR_MAX_HOLD_MS - 12_000);
    vi.advanceTimersByTime(FLOOR_MAX_HOLD_MS);
    expect(tv.floor()).toEqual({ pushToTalk: true, holder: null });
  });

  it("the auto release is announced even when something read the floor after the cap first", () => {
    vi.useFakeTimers();
    const { game, connect } = setup();
    const tv = connect("table", TABLE);
    tv.say({ type: "ptt", down: true });
    vi.setSystemTime(Date.now() + FLOOR_MAX_HOLD_MS + 10); // the clock passes the cap, the timer hasn't run
    expect(game.floorView().holder).toBeNull(); // a lazy read expires it silently
    expect(tv.floor()?.holder).toEqual({ room: true });
    vi.advanceTimersByTime(FLOOR_MAX_HOLD_MS);
    expect(tv.floor()?.holder).toBeNull();
  });

  it("the auto release is announced even when the timer fires a little before the cap", () => {
    vi.useFakeTimers();
    const { connect } = setup();
    const tv = connect("table", TABLE);
    tv.say({ type: "ptt", down: true });
    // Node timers can run a ms or so early by Date.now(): skew the clock back so the timer fires at cap - 1 ms.
    vi.setSystemTime(Date.now() - 1);
    vi.advanceTimersByTime(FLOOR_MAX_HOLD_MS);
    expect(tv.floor()?.holder).toEqual({ room: true }); // still held at cap - 1 ms
    vi.advanceTimersByTime(5);
    expect(tv.floor()?.holder).toBeNull();
  });

  it("a release after the hold already lapsed silently is still announced", () => {
    vi.useFakeTimers();
    const { game, connect } = setup();
    const tv = connect("table", TABLE);
    tv.say({ type: "ptt", down: true });
    vi.setSystemTime(Date.now() + FLOOR_MAX_HOLD_MS + 10);
    expect(game.floorView().holder).toBeNull(); // a lazy read expires it silently
    tv.say({ type: "ptt", down: false });
    expect(tv.floor()?.holder).toBeNull();
  });

  it("switching, resetting or deleting the campaign frees the floor and tells everyone", () => {
    vi.useFakeTimers();
    const { game, connect, sam } = setup();
    const first = game.state!.campaignId;
    const tv = connect("table", TABLE);
    const phone = connect("player", TABLE);
    phone.say({ type: "ptt", down: true, playerId: sam.id });
    expect(tv.floor()?.holder).toEqual({ playerId: sam.id, inRoom: true });
    game.createCampaign({ name: "Other" });
    expect(game.floorView().holder).toBeNull();
    expect(tv.floor()?.holder).toBeNull();
    // A press from the old hold's socket no longer owns anything; the room can take the floor.
    phone.say({ type: "ptt", down: false, playerId: sam.id });
    tv.say({ type: "ptt", down: true });
    expect(tv.floor()?.holder).toEqual({ room: true });
    game.loadCampaign(first);
    expect(tv.floor()?.holder).toBeNull();
    vi.advanceTimersByTime(PTT_MIN_GAP_MS);
    tv.say({ type: "ptt", down: true });
    game.resetCampaign(first, { keepOutline: false, keepPlayers: true, keepCharacters: true });
    expect(tv.floor()?.holder).toBeNull();
    vi.advanceTimersByTime(PTT_MIN_GAP_MS);
    tv.say({ type: "ptt", down: true });
    game.deleteCampaign(first);
    expect(tv.floor()?.holder).toBeNull();
  });

  it("with push-to-talk off, presses are ignored (open mic as before)", () => {
    const { game, connect } = setup(false);
    const tv = connect("table", TABLE);
    expect(tv.floor()).toEqual({ pushToTalk: false, holder: null });
    tv.say({ type: "ptt", down: true });
    expect(game.floorView().holder).toBeNull();
  });

  it("the host toggles push-to-talk at runtime; turning it off frees the floor", () => {
    const { game, connect } = setup();
    const tv = connect("table", TABLE);
    tv.say({ type: "ptt", down: true });
    expect(game.setPushToTalk(false)).toEqual({ pushToTalk: false });
    expect(tv.floor()).toEqual({ pushToTalk: false, holder: null });
    game.setPushToTalk(true);
    expect(tv.floor()).toEqual({ pushToTalk: true, holder: null });
  });

  it("speech with nobody holding the floor is side chatter: no live who's-talking, no AI interrupt", () => {
    const { game, connect } = setup();
    const interrupt = vi.spyOn(game.aiPlayers, "interrupt");
    const started = vi.spyOn(game.liveTalk, "speechStarted");
    const host = (game as any).dmHost();
    host.onUserSpeech(true);
    expect(interrupt).not.toHaveBeenCalled();
    expect(started).not.toHaveBeenCalled();
    connect("table", TABLE).say({ type: "ptt", down: true });
    host.onUserSpeech(true);
    expect(started).toHaveBeenCalledOnce();
  });

  it("a press interrupts a pending AI player line", () => {
    const { game, connect } = setup();
    const interrupt = vi.spyOn(game.aiPlayers, "interrupt");
    connect("table", TABLE).say({ type: "ptt", down: true });
    expect(interrupt).toHaveBeenCalled();
  });

  describe("speaker identification", () => {
    it("the floor holder during the turn is the speaker (push-to-talk), before voice ID", () => {
      const { game, remote, ana } = setup();
      const events: ServerEvent[] = [];
      const broadcast = game.hub.broadcast.bind(game.hub);
      game.hub.broadcast = (ev) => {
        events.push(ev);
        broadcast(ev);
      };
      const identify = vi.spyOn(game.speaker, "identify");
      const t0 = Date.now();
      const phone = remote(ana.id);
      phone.say({ type: "ptt", down: true });
      phone.say({ type: "ptt", down: false });
      const turn = game.identifySpeaker(t0 - 500, Date.now() + 200);
      expect(turn.note).toBe("[speaker: Ana as Bo (push-to-talk)]");
      expect(turn.label).toBe("Ana as Bo");
      expect(identify).not.toHaveBeenCalled();
      turn.accept?.();
      expect(events.filter((e) => e.type === "speaker").at(-1)).toMatchObject({ speaker: { playerId: ana.id, confidence: 1 } });
    });

    it("a room hold falls through to the host's tap / voice ID", () => {
      const { game, connect, sam } = setup();
      const tv = connect("table", TABLE);
      const t0 = Date.now();
      tv.say({ type: "ptt", down: true });
      game.setManualSpeaker(sam.id);
      expect(game.identifySpeaker(t0, Date.now()).note).toBe("[speaker: Sam as Lia (selected by host)]");
    });

    it("live who's-talking uses the floor holder too", () => {
      const { game, remote, ana } = setup();
      const t0 = Date.now();
      remote(ana.id).say({ type: "ptt", down: true });
      expect((game as any).liveSpeaker(t0, Date.now())).toEqual({ playerId: ana.id, confident: true });
    });
  });

  describe("the session gate (DmHost.outsideFloor)", () => {
    it("with push-to-talk on, a turn is outside the floor unless a hold (plus tail) covers it", () => {
      vi.useFakeTimers();
      const { game, connect } = setup();
      const host = (game as any).dmHost();
      const tv = connect("table", TABLE);
      const t0 = Date.now();
      expect(host.outsideFloor(t0 - 2000, t0)).toBe(true);
      tv.say({ type: "ptt", down: true });
      vi.advanceTimersByTime(1500);
      tv.say({ type: "ptt", down: false });
      expect(host.outsideFloor(t0 - 400, Date.now())).toBe(false);
      vi.advanceTimersByTime(FLOOR_TAIL_MS + 100);
      expect(host.outsideFloor(Date.now() - 50, Date.now())).toBe(true);
    });

    it("with push-to-talk off, nothing is outside the floor", () => {
      const { game } = setup(false);
      expect((game as any).dmHost().outsideFloor(0, Date.now())).toBe(false);
    });
  });

  describe("in the room by origin, not by access level", () => {
    it("a player cookie from the home network (TRUST_LAN off) holds in the room; one through the tunnel doesn't", () => {
      vi.useFakeTimers();
      const { game, remote, sam, ana } = setup();
      const lan = remote(sam.id, "lan");
      lan.say({ type: "ptt", down: true });
      expect(game.floorView().holder).toEqual({ playerId: sam.id, inRoom: true });
      lan.say({ type: "ptt", down: false });
      remote(ana.id, "remote").say({ type: "ptt", down: true });
      expect(game.floorView().holder).toEqual({ playerId: ana.id, inRoom: false });
    });

    it("this machine counts as the room too", () => {
      const { game, remote, sam } = setup();
      remote(sam.id, "local").say({ type: "ptt", down: true });
      expect(game.floorView().holder).toEqual({ playerId: sam.id, inRoom: true });
    });

    it("a host cookie through the tunnel naming a seat holds for it, not in the room", () => {
      const { game, connect, sam } = setup();
      connect("host", { level: "host", anySeat: true, sid: "s_host" }, "remote").say({ type: "ptt", down: true, playerId: sam.id });
      expect(game.floorView().holder).toEqual({ playerId: sam.id, inRoom: false });
    });
  });

  describe("press throttle (per socket)", () => {
    it("a press within PTT_MIN_GAP_MS of that socket's last press is ignored", () => {
      vi.useFakeTimers();
      const { game, connect, remote, sam, ana } = setup();
      const tv = connect("table", TABLE);
      const phone = remote(sam.id);
      phone.say({ type: "ptt", down: true });
      // The TV's press is refused (Sam holds it), and its next press inside the gap is dropped too.
      tv.say({ type: "ptt", down: true });
      phone.say({ type: "ptt", down: false });
      tv.say({ type: "ptt", down: true });
      expect(game.floorView().holder).toBeNull();
      // Another socket isn't throttled by this one.
      remote(ana.id).say({ type: "ptt", down: true });
      expect(game.floorView().holder).toEqual({ playerId: ana.id, inRoom: false });
    });

    it("a press right after that socket's own release counts (a release doesn't start the gap)", () => {
      vi.useFakeTimers();
      const { game, connect } = setup();
      const tv = connect("table", TABLE);
      tv.say({ type: "ptt", down: true });
      vi.advanceTimersByTime(PTT_MIN_GAP_MS);
      tv.say({ type: "ptt", down: false });
      expect(game.floorView().holder).toBeNull();
      tv.say({ type: "ptt", down: true });
      expect(game.floorView().holder).toEqual({ room: true });
    });

    it("a press after the gap counts; releases are never throttled", () => {
      vi.useFakeTimers();
      const { game, connect } = setup();
      const tv = connect("table", TABLE);
      tv.say({ type: "ptt", down: true });
      tv.say({ type: "ptt", down: false });
      expect(game.floorView().holder).toBeNull();
      vi.advanceTimersByTime(PTT_MIN_GAP_MS);
      tv.say({ type: "ptt", down: true });
      expect(game.floorView().holder).toEqual({ room: true });
      tv.say({ type: "ptt", down: false });
      expect(game.floorView().holder).toBeNull();
    });

    it("a refused press (someone else holds the floor) still starts the gap", () => {
      vi.useFakeTimers();
      const { game, connect, remote, sam } = setup();
      const tv = connect("table", TABLE);
      const phone = remote(sam.id);
      tv.say({ type: "ptt", down: true });
      phone.say({ type: "ptt", down: true });
      tv.say({ type: "ptt", down: false });
      phone.say({ type: "ptt", down: true });
      expect(game.floorView().holder).toBeNull();
    });
  });

  describe("the host frees the floor (freeFloor)", () => {
    it("lets go of anyone's hold and tells everyone; the old holder's release changes nothing", () => {
      vi.useFakeTimers();
      const { game, connect, remote, sam } = setup();
      const tv = connect("table", TABLE);
      const phone = remote(sam.id);
      phone.say({ type: "ptt", down: true });
      expect(game.freeFloor()).toEqual({ pushToTalk: true, holder: null });
      expect(tv.floor()?.holder).toBeNull();
      expect(phone.floor()?.holder).toBeNull();
      tv.say({ type: "ptt", down: true });
      phone.say({ type: "ptt", down: false });
      expect(game.floorView().holder).toEqual({ room: true });
    });

    it("with nobody on the floor it is a no-op", () => {
      const { game } = setup();
      expect(game.freeFloor()).toEqual({ pushToTalk: true, holder: null });
    });
  });

  describe("voice enrollment (the table mic stays open while recording)", () => {
    function enrollable() {
      const ctx = setup();
      vi.spyOn(ctx.game.speaker, "available", "get").mockReturnValue(true);
      return ctx;
    }

    it("the floor says enrolling from start to finish, and everyone is told", () => {
      const { game, connect, sam } = enrollable();
      const tv = connect("table", TABLE);
      game.startEnrollment(sam.id);
      expect(tv.floor()).toEqual({ pushToTalk: true, holder: null, enrolling: true });
      game.finishEnrollment(sam.id);
      expect(tv.floor()).toEqual({ pushToTalk: true, holder: null });
    });

    it("a stop for a player who isn't being recorded (a second host tab) leaves the recording and its cap alone", () => {
      vi.useFakeTimers();
      const { game, connect, sam, ana } = enrollable();
      const tv = connect("table", TABLE);
      game.startEnrollment(sam.id);
      expect(game.finishEnrollment(ana.id).ok).toBe(false);
      expect(tv.floor()?.enrolling).toBe(true);
      // The forgotten recording still stops keeping the mic open at the cap.
      vi.advanceTimersByTime(ENROLL_MAX_MS + 10);
      expect(tv.floor()).toEqual({ pushToTalk: true, holder: null });
    });

    it("a forgotten enrollment stops keeping the mic open after ENROLL_MAX_MS", () => {
      vi.useFakeTimers();
      const { game, connect, sam } = enrollable();
      const tv = connect("table", TABLE);
      game.startEnrollment(sam.id);
      vi.advanceTimersByTime(ENROLL_MAX_MS + 10);
      expect(tv.floor()).toEqual({ pushToTalk: true, holder: null });
    });

    it("words said while enrolling are still no DM turn: nobody holds the floor", () => {
      const { game, sam } = enrollable();
      game.startEnrollment(sam.id);
      const t0 = Date.now();
      expect((game as any).dmHost().outsideFloor(t0 - 3000, t0)).toBe(true);
    });
  });
});
