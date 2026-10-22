import { describe, expect, it } from "vitest";
import { Campaign, GameState, Monster, type RollResult, type ServerEvent } from "@dm/shared";
import { PublicFeed, publicSnapshot, seatRollReply, viewerTier } from "./publicFeed.js";

function state(over: Record<string, unknown> = {}): GameState {
  return GameState.parse({
    campaignId: "c",
    locationId: "crypt",
    monsters: [Monster.parse({ id: "m_vis", name: "Goblin", maxHp: 7, hp: 7, ac: 15 }), Monster.parse({ id: "m_hid", name: "Assassin", maxHp: 30, hp: 30, hidden: true })],
    tokens: [
      { id: "t1", entityId: "m_vis", entityType: "monster", x: 1, y: 1 },
      { id: "t2", entityId: "m_hid", entityType: "monster", x: 2, y: 2 },
    ],
    ...over,
  });
}

const campaign = () =>
  Campaign.parse({
    id: "c",
    name: "Crypt",
    createdAt: 0,
    updatedAt: 0,
    outline: {
      title: "Crypt",
      hook: "The mayor did it.",
      locations: [
        { id: "crypt", name: "Crypt" },
        { id: "lair", name: "Lair" },
      ],
    },
  });

const roll = (r: Partial<RollResult>): RollResult =>
  ({ id: "r", notation: "1d20", label: "", rollerName: "DM", dice: [{ sides: 20, value: 7 }], modifier: 0, total: 7, physical: false, secret: false, source: "dm", attack: false, ts: 0, ...r }) as RollResult;

const locIds = (ev: ServerEvent | undefined) => (ev?.type === "campaign" ? ev.campaign?.outline?.locations.map((l) => l.id) : undefined);

describe("viewerTier", () => {
  it("a player cookie is always public; host and table sockets are full only once they say host or table", () => {
    const player = { level: "player" as const, anySeat: false, playerId: "pl_1" };
    const lan = { level: "table" as const, anySeat: true };
    const host = { level: "host" as const, anySeat: true };
    expect(viewerTier(player, undefined)).toBe("public");
    expect(viewerTier(player, "player")).toBe("public");
    // A LAN phone (table access) on /player says hello "player": the public projection.
    expect(viewerTier(lan, "player")).toBe("public");
    expect(viewerTier(lan, "table")).toBe("full");
    expect(viewerTier(host, "host")).toBe("full");
    expect(viewerTier(host, "player")).toBe("public");
    // Before its hello the tier is unknown (the hub sends it only public events meanwhile).
    expect(viewerTier(lan, undefined)).toBeUndefined();
  });
});

describe("PublicFeed", () => {
  it("projects state and campaign, using the latest state for the campaign's visited locations", () => {
    const feed = new PublicFeed();
    const [s] = feed.next({ type: "state", state: state() });
    expect(s.type === "state" && s.state.monsters.map((m) => m.id)).toEqual(["m_vis"]);
    const [c] = feed.next({ type: "campaign", campaign: campaign() });
    expect(locIds(c)).toEqual(["crypt"]);
    expect(c.type === "campaign" && c.campaign?.outline?.hook).toBe("");
  });

  it("re-sends the campaign before a state that reaches a new location", () => {
    const feed = new PublicFeed();
    feed.next({ type: "campaign", campaign: campaign() });
    expect(feed.next({ type: "state", state: state() }).map((e) => e.type)).toEqual(["campaign", "state"]);
    expect(feed.next({ type: "state", state: state() }).map((e) => e.type)).toEqual(["state"]);
    const moved = feed.next({ type: "state", state: state({ locationId: "lair" }) });
    expect(moved.map((e) => e.type)).toEqual(["campaign", "state"]);
    expect(locIds(moved[0])).toEqual(["lair"]);
  });

  it("filters rolls, effects and moments against the latest state", () => {
    const feed = new PublicFeed();
    feed.next({ type: "state", state: state() });
    const [r] = feed.next({ type: "roll", roll: roll({ rollerId: "m_hid", rollerName: "Assassin", label: "Sneak attack" }) });
    expect(r).toMatchObject({ type: "roll", roll: { rollerName: "DM", label: "" } });
    expect(feed.next({ type: "roll", roll: roll({ secret: true }) })).toMatchObject([{ roll: { total: 0 } }]);
    expect(feed.next({ type: "effect", effect: { id: "e", kind: "hit", targetId: "m_hid", ts: 0 } })).toEqual([]);
    expect(feed.next({ type: "effect", effect: { id: "e", kind: "hit", targetId: "m_vis", sourceId: "m_hid", ts: 0 } })).toEqual([{ type: "effect", effect: { id: "e", kind: "hit", targetId: "m_vis", sourceId: undefined, ts: 0 } }]);
    expect(feed.next({ type: "moment", moment: { id: "m", kind: "death", targetId: "m_hid", ts: 0 } })).toEqual([]);
    const victory: ServerEvent = { type: "moment", moment: { id: "v", kind: "victory", ts: 0 } };
    expect(feed.next(victory)).toEqual([victory]);
  });

  it("drops host-only events and passes the rest through unchanged", () => {
    const feed = new PublicFeed();
    expect(feed.next({ type: "error", message: "OpenAI key missing" })).toEqual([]);
    expect(feed.next({ type: "job", id: "j", label: "Painting the lair", status: "running", startedAt: 0 })).toEqual([]);
    expect(feed.next({ type: "log", entry: { id: "l", ts: 0, kind: "tool", text: "[tool] x" } })).toEqual([]);
    const talk: ServerEvent = { type: "talk", talk: { who: "player", active: true, level: 0.3 } };
    expect(feed.next(talk)[0]).toBe(talk);
    // Who holds the push-to-talk floor is not secret: players see "Sam is talking to the DM".
    const floor: ServerEvent = { type: "floor", floor: { pushToTalk: true, holder: { playerId: "p1", inRoom: false } } };
    expect(feed.next(floor)).toEqual([floor]);
  });

  it("a log event is filtered like the log in publicState (no hidden creature's roll line, no AC)", () => {
    const feed = new PublicFeed();
    feed.next({ type: "state", state: state() });
    expect(feed.next({ type: "log", entry: { id: "l1", ts: 0, kind: "roll", speaker: "Assassin", text: "Assassin rolled Stealth: 22" } })).toEqual([]);
    expect(feed.next({ type: "log", entry: { id: "l2", ts: 0, kind: "roll", speaker: "X", unseen: true, text: "X rolled Stealth: 9" } })).toEqual([]);
    expect(feed.next({ type: "log", entry: { id: "l3", ts: 0, kind: "roll", speaker: "Thorin", text: "Thorin rolled attack: 16 vs AC 17 (half cover)" } })).toEqual([
      { type: "log", entry: { id: "l3", ts: 0, kind: "roll", speaker: "Thorin", text: "Thorin rolled attack: 16 (half cover)" } },
    ]);
  });
});

describe("publicSnapshot", () => {
  it("projects a connect snapshot with its own state and leaves the order alone", () => {
    const evs: ServerEvent[] = [
      { type: "campaign", campaign: campaign() },
      { type: "dm_status", status: "listening", mode: "voice" },
      { type: "state", state: state() },
    ];
    const out = publicSnapshot(evs);
    expect(out.map((e) => e.type)).toEqual(["campaign", "dm_status", "state"]);
    expect(locIds(out[0])).toEqual(["crypt"]);
    expect(out[2].type === "state" && out[2].state.monsters).toHaveLength(1);
    expect(out[1]).toBe(evs[1]);
  });
});

describe("seatRollReply", () => {
  it("answers a phone's roll with only what the table sees (no target AC, next turn or hints)", () => {
    expect(seatRollReply({ character: "Thorin", total: 17, vs_ac: 15, success: true, hint: "Call apply_damage on Assassin", next_turn: "Assassin", dmInformed: true })).toEqual({ ok: true, total: 17, dmInformed: true });
    expect(seatRollReply({ error: "No pending roll" })).toEqual({ ok: false, error: "No pending roll" });
    expect(seatRollReply({ character: "Thorin", damage_applied: 6, target: "Assassin", hp: 3 })).toEqual({ ok: true, total: 6 });
  });
});

describe("PublicFeed.observe", () => {
  it("remembers state and campaign without projecting, so a later roll is still judged against them", () => {
    const feed = new PublicFeed();
    feed.observe({ type: "campaign", campaign: campaign() });
    feed.observe({ type: "state", state: state() });
    // Nothing new was reached since the observed state: no campaign re-send.
    expect(feed.next({ type: "state", state: state() }).map((e) => e.type)).toEqual(["state"]);
    expect(feed.next({ type: "roll", roll: roll({ rollerId: "m_hid", rollerName: "Assassin" }) })).toMatchObject([{ roll: { rollerName: "DM" } }]);
  });
});

describe("PublicFeed: loading another campaign", () => {
  it("forgets the old campaign's state, so the new campaign's locations come with its first state", () => {
    const feed = new PublicFeed();
    feed.next({ type: "campaign", campaign: campaign() });
    feed.next({ type: "state", state: state() });
    const other = { ...campaign(), id: "c2" };
    expect(locIds(feed.next({ type: "campaign", campaign: other })[0])).toEqual([]);
    const evs = feed.next({ type: "state", state: state({ campaignId: "c2" }) });
    expect(evs.map((e) => e.type)).toEqual(["campaign", "state"]);
    expect(locIds(evs[0])).toEqual(["crypt"]);
  });
});
