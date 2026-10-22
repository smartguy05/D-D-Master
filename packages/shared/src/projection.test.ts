import { describe, expect, it } from "vitest";
import { Campaign, Character, MapFeature, GameState, Monster, Player, SceneStash, type RollResult } from "./index.js";
import { hiddenCreatureIds, publicCampaign, publicRoll, publicState, visitedLocations } from "./projection.js";

const roll = (r: Partial<RollResult>): RollResult =>
  ({ id: "r", notation: "1d20+4", label: "", rollerName: "DM", dice: [{ sides: 20, value: 12 }], modifier: 4, total: 16, physical: false, secret: false, source: "dm", attack: false, ts: 0, ...r }) as RollResult;

/** A crypt with a visible goblin, a hidden assassin, a goblin in unseen fog, a hidden chest and a secret roll. */
function crypt(): GameState {
  return GameState.parse({
    campaignId: "c",
    locationId: "crypt",
    players: [
      Player.parse({ id: "pl_1", name: "Sam", characterId: "pc" }),
      Player.parse({ id: "pl_ai", name: "Robo", ai: true, aiPersona: "Secretly betrays the party in act 3" }),
    ],
    characters: [
      Character.parse({ id: "pc", playerName: "Sam", name: "Thorin", maxHp: 12, hp: 12, conditionMeta: [{ name: "Frightened", casterId: "m_hid" }] }),
    ],
    monsters: [
      Monster.parse({ id: "m_vis", name: "Goblin", srdName: "Goblin Warrior", maxHp: 7, hp: 5, ac: 15, cr: "1/4", attacks: [{ name: "Scimitar", toHit: 4, damage: "1d6+2" }], abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 }, voice: "squeaky", attitudeScore: -4, initiativeBonus: 2 }),
      Monster.parse({ id: "m_hid", name: "Assassin", maxHp: 30, hp: 30, hidden: true }),
      Monster.parse({ id: "m_fog", name: "Ghoul", maxHp: 22, hp: 22 }),
    ],
    tokens: [
      { id: "t1", entityId: "m_vis", entityType: "monster", x: 1, y: 1 },
      { id: "t2", entityId: "m_hid", entityType: "monster", x: 1, y: 2 },
      { id: "t3", entityId: "m_fog", entityType: "monster", x: 9, y: 9 },
      { id: "t4", entityId: "pc", entityType: "character", x: 2, y: 1 },
    ],
    combat: {
      active: true,
      round: 1,
      turnIndex: 2,
      order: [
        { entityId: "pc", entityType: "character", name: "Thorin", initiative: 18 },
        { entityId: "m_vis", entityType: "monster", name: "Goblin", initiative: 12 },
        { entityId: "m_hid", entityType: "monster", name: "Assassin", initiative: 10 },
        { entityId: "m_fog", entityType: "monster", name: "Ghoul", initiative: 4 },
      ],
      turn: { entityId: "m_hid", round: 1 },
      reactionsUsed: ["m_hid", "pc"],
    },
    pendingRoll: { characterId: "pc", notation: "1d20+5", label: "Attack", targetId: "m_hid" },
    rolls: [
      roll({ id: "r1", rollerId: "m_hid", rollerName: "Assassin", label: "Assassin dagger" }),
      roll({ id: "r2", secret: true, label: "Insight vs lie", dc: 15, success: true }),
      roll({ id: "r3", rollerId: "pc", rollerName: "Thorin", label: "Attack", attack: true, targetId: "m_hid" }),
    ],
    log: [
      { id: "l1", ts: 0, kind: "dm", text: "The crypt is cold." },
      { id: "l2", ts: 0, kind: "tool", text: "[tool] add_monster(Assassin, hidden)" },
      { id: "l3", ts: 0, kind: "system", text: "Host note" },
      { id: "l4", ts: 0, kind: "roll", speaker: "Assassin", text: "Assassin rolled Stealth: 22" },
      { id: "l5", ts: 0, kind: "roll", speaker: "Thorin", text: "Thorin rolled Attack: 16" },
      { id: "l6", ts: 0, kind: "player", speaker: "Sam", text: "I open the door" },
    ],
    fog: {
      crypt: { enabled: true, revealed: ["1,1", "1,2", "2,1", "3,3"] },
      lair: { enabled: true, revealed: [] },
    },
    mapObjects: [
      { id: "o_vis", locationId: "crypt", kind: "loot", name: "Sack", x: 3, y: 3, items: [{ id: "i1", name: "Torch", qty: 1 }] },
      { id: "o_hid", locationId: "crypt", kind: "interactable", name: "Secret lever", x: 1, y: 1, hidden: true },
      { id: "o_fog", locationId: "crypt", kind: "loot", name: "Hoard", x: 9, y: 9 },
      { id: "o_away", locationId: "lair", kind: "loot", name: "Gold pile", x: 0, y: 0 },
    ],
    wallEdits: { crypt: { walls: [] }, lair: { walls: [{ id: "w", x1: 0, y1: 0, x2: 0, y2: 1 }] } },
    featureEdits: { lair: { mapUrl: "", features: [{ name: "Egg", x: 1, y: 1 }] } },
  });
}

describe("publicState", () => {
  it("drops hidden and fogged monsters with their tokens; strips stat blocks from the rest, keeps HP", () => {
    const p = publicState(crypt());
    expect(p.monsters.map((m) => m.id)).toEqual(["m_vis"]);
    expect(p.tokens.map((t) => t.entityId)).toEqual(["m_vis", "pc"]);
    const g = p.monsters[0];
    expect(g).toMatchObject({ name: "Goblin", hp: 5, maxHp: 7 });
    for (const k of ["srdName", "cr", "abilities", "voice", "attitudeScore"] as const) expect(g[k]).toBeUndefined();
    expect(g.attacks).toEqual([]);
    expect(g.ac).toBe(0);
    expect(g.initiativeBonus).toBe(0);
    const json = JSON.stringify(p);
    for (const secret of ["Assassin", "Ghoul", "Scimitar", "squeaky", "Goblin Warrior", "m_hid", "m_fog"]) expect(json).not.toContain(secret);
  });

  it("filters the initiative order, re-points the turn index, and hides a hidden creature's turn", () => {
    const s = crypt();
    s.combat.turnIndex = 1;
    s.combat.turn = { ...s.combat.turn!, entityId: "m_vis" };
    let p = publicState(s);
    expect(p.combat.order.map((o) => o.entityId)).toEqual(["pc", "m_vis"]);
    expect(p.combat.turnIndex).toBe(1);
    expect(p.combat.turn?.entityId).toBe("m_vis");
    expect(p.combat.reactionsUsed).toEqual(["pc"]);
    // The assassin's own turn: nobody's turn shows (and no budget names it).
    p = publicState(crypt());
    expect(p.combat.order[p.combat.turnIndex]).toBeUndefined();
    expect(p.combat.turn).toBeNull();
    // Out of combat too: a hidden current entry must not leave a raw index pointing at someone else.
    const idle = crypt();
    idle.combat.active = false;
    idle.combat.turnIndex = 2;
    expect(publicState(idle).combat.turnIndex).toBe(-1);
  });

  it("redacts secret rolls and anonymises hidden creatures' rolls and targets", () => {
    const p = publicState(crypt());
    const [r1, r2, r3] = p.rolls;
    expect(r1).toMatchObject({ rollerName: "DM", label: "", total: 16 });
    expect(r1.rollerId).toBeUndefined();
    expect(r2).toMatchObject({ secret: true, total: 0, modifier: 0, label: "Insight vs lie" });
    expect(r2.dice).toEqual([{ sides: 20, value: 0 }]);
    expect(r2.dc).toBeUndefined();
    expect(r2.success).toBeUndefined();
    expect(r3.targetId).toBeUndefined();
    expect(r3.rollerId).toBe("pc");
    expect(p.pendingRoll).toMatchObject({ characterId: "pc", label: "Attack" });
    expect(p.pendingRoll?.targetId).toBeUndefined();
  });

  it("drops tool and system log lines and a hidden creature's roll line", () => {
    expect(publicState(crypt()).log.map((l) => l.id)).toEqual(["l1", "l5", "l6"]);
  });

  it("drops roll lines tagged unseen and the AC from cover notes; parked pending attacks lose their dc", () => {
    const s = crypt();
    s.log.push({ id: "l7", ts: 0, kind: "roll", speaker: "Gone", unseen: true, text: "Gone rolled Stealth: 3" });
    s.log.push({ id: "l8", ts: 0, kind: "roll", speaker: "Thorin", text: "Thorin rolled Attack: 16 vs AC 17 (half cover)" });
    s.scenes.lair = SceneStash.parse({ pendingRoll: { characterId: "pc", notation: "1d20+5", label: "Attack", dc: 15, targetId: "m_x" } });
    const p = publicState(s);
    expect(p.log.map((l) => l.id)).toEqual(["l1", "l5", "l6", "l8"]);
    expect(p.log.at(-1)?.text).toBe("Thorin rolled Attack: 16 (half cover)");
    expect(p.scenes.lair.pendingRoll?.dc).toBeUndefined();
  });

  it("keeps only map objects the table can see, on locations the party has been to", () => {
    const p = publicState(crypt());
    expect(p.mapObjects.map((o) => o.id)).toEqual(["o_vis"]);
    expect(Object.keys(p.fog)).toEqual(["crypt"]);
    expect(Object.keys(p.wallEdits)).toEqual(["crypt"]);
    expect(p.featureEdits).toEqual({});
  });

  it("removes AI personas and hidden casters from condition notes", () => {
    const p = publicState(crypt());
    expect(p.players.find((x) => x.id === "pl_ai")!.aiPersona).toBe("");
    expect(p.characters[0].conditionMeta).toEqual([{ name: "Frightened" }]);
    expect(p.characters[0].conditions).toEqual(crypt().characters[0].conditions);
  });

  it("drops hidden creature ids from condition timers on characters and visible monsters", () => {
    const s = crypt();
    s.characters[0].conditionMeta = [{ name: "Blinded", until: { kind: "rounds", round: 2, entityId: "m_hid" } }];
    s.monsters[0].conditionMeta = [{ name: "Poisoned", casterId: "m_hid", until: { kind: "end_of_turn", entityId: "m_hid" } }];
    const p = publicState(s);
    expect(p.characters[0].conditionMeta).toEqual([{ name: "Blinded", until: { kind: "rounds", round: 2 } }]);
    expect(p.monsters[0].conditionMeta).toEqual([{ name: "Poisoned", until: { kind: "end_of_turn" } }]);
    expect(JSON.stringify(p)).not.toContain("m_hid");
  });

  it("feature edits keep only interactive features the party has seen", () => {
    const s = crypt();
    s.featureEdits = { crypt: { mapUrl: "", features: [{ name: "Pillar", x: 9, y: 9 }, { name: "Lever", x: 9, y: 9, interactive: true }, { name: "Door", x: 3, y: 3, interactive: true }].map((f) => MapFeature.parse(f)) } };
    expect(publicState(s).featureEdits.crypt.features.map((f) => f.name)).toEqual(["Pillar", "Door"]);
  });

  it("filters a parked scene (party split) with that location's own fog", () => {
    const s = crypt();
    s.fog.lair.revealed = ["0,0"];
    s.partyLocations = { pc2: "lair" };
    s.scenes = {
      lair: SceneStash.parse({
        tokens: [
          { id: "t9", entityId: "m_dragon", entityType: "monster", x: 5, y: 5, size: 2 },
          { id: "t8", entityId: "m_kobold", entityType: "monster", x: 0, y: 0, size: 1 },
        ],
        monsters: [Monster.parse({ id: "m_dragon", name: "Dragon", maxHp: 200, hp: 200 }), Monster.parse({ id: "m_kobold", name: "Kobold", maxHp: 5, hp: 5, ac: 12 })],
        combat: { active: true, round: 2, turnIndex: 0, order: [{ entityId: "m_dragon", entityType: "monster", name: "Dragon", initiative: 20 }, { entityId: "m_kobold", entityType: "monster", name: "Kobold", initiative: 3 }] },
      }),
    };
    s.rolls.push(roll({ id: "r4", rollerId: "m_dragon", rollerName: "Dragon", label: "Dragon bite" }));
    const p = publicState(s);
    const lair = p.scenes.lair;
    expect(lair.monsters.map((m) => m.id)).toEqual(["m_kobold"]);
    expect(lair.monsters[0].ac).toBe(0);
    expect(lair.tokens.map((t) => t.entityId)).toEqual(["m_kobold"]);
    expect(lair.combat.order.map((o) => o.entityId)).toEqual(["m_kobold"]);
    expect(lair.combat.order[lair.combat.turnIndex]).toBeUndefined();
    expect(p.rolls.at(-1)).toMatchObject({ rollerName: "DM", label: "" });
    expect(JSON.stringify(p)).not.toContain("Dragon");
    // The lair is visited now: its objects (seen cells), fog and edits come through.
    expect(p.mapObjects.map((o) => o.id)).toEqual(["o_vis", "o_away"]);
    expect(Object.keys(p.featureEdits)).toEqual(["lair"]);
  });

  it("does not change the input", () => {
    const s = crypt();
    const before = JSON.stringify(s);
    publicState(s);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("visitedLocations and hiddenCreatureIds", () => {
  it("visited: the focus, parked scenes, away PCs and any location with seen cells", () => {
    const s = crypt();
    expect([...visitedLocations(s)].sort()).toEqual(["crypt"]);
    s.partyLocations = { pc: "keep" };
    s.fog.lair.revealed = ["2,2"];
    expect([...visitedLocations(s)].sort()).toEqual(["crypt", "keep", "lair"]);
  });

  it("hidden creatures across every scene", () => {
    expect([...hiddenCreatureIds(crypt())].sort()).toEqual(["m_fog", "m_hid"]);
  });
});

describe("publicRoll", () => {
  it("drops the target's AC from attack rolls (dc) but keeps hit or miss; a plain check keeps its DC", () => {
    const atk = publicRoll(roll({ rollerId: "pc", attack: true, targetId: "m_vis", dc: 17, success: false, cover: "half" }), crypt());
    expect(atk.dc).toBeUndefined();
    expect(atk).toMatchObject({ success: false, cover: "half", targetId: "m_vis" });
    expect(publicRoll(roll({ rollerId: "pc", targetId: "m_vis", dc: 15, success: true }), crypt()).dc).toBeUndefined();
    expect(publicRoll(roll({ rollerId: "pc", label: "Athletics", dc: 12, success: true }), crypt()).dc).toBe(12);
  });

  it("a roll tagged unseen when it was made stays anonymous even if its creature is gone", () => {
    const r = publicRoll(roll({ rollerId: "m_gone", rollerName: "Doppelganger", label: "Stealth", unseen: true, targetId: "pc" }), crypt());
    expect(r).toMatchObject({ rollerName: "DM", label: "" });
    expect(r.rollerId).toBeUndefined();
  });

  it("redacts a secret roll even with no state, and anonymises a hidden roller", () => {
    expect(publicRoll(roll({ secret: true, total: 9 }), null)).toMatchObject({ total: 0, secret: true });
    expect(publicRoll(roll({ rollerId: "m_hid", rollerName: "Assassin" }), crypt())).toMatchObject({ rollerName: "DM", rollerId: undefined });
    const pc = roll({ rollerId: "pc", rollerName: "Thorin" });
    expect(publicRoll(pc, crypt())).toBe(pc);
  });
});

describe("publicCampaign", () => {
  const campaign = () =>
    Campaign.parse({
      id: "c",
      name: "The Sunken Crypt",
      premise: "A crypt under the village.",
      createdAt: 0,
      updatedAt: 0,
      sessionSummaries: [{ ts: 1, summary: "The party entered the crypt." }],
      outline: {
        title: "The Sunken Crypt",
        hook: "The mayor is the necromancer.",
        acts: [{ title: "Act 3", summary: "The mayor betrays the party." }],
        locations: [
          { id: "crypt", name: "Crypt", description: "Cold stone.", mapPrompt: "top-down crypt with a secret lever", mapUrl: "/media/c/map_a.png", features: [{ name: "Altar", x: 2, y: 2 }, { name: "Hidden trapdoor", x: 9, y: 9, interactive: true }, { name: "Gate", x: 1, y: 1, interactive: true }], walls: [{ id: "w1", x1: 0, y1: 0, x2: 0, y2: 3 }] },
          { id: "lair", name: "Necromancer's lair", description: "Bones everywhere.", mapPrompt: "lair", mapUrl: "/media/c/map_b.png" },
        ],
        npcs: [{ name: "Mayor Brand", description: "A kindly old man.", motive: "Raise the dead", voice: "gravelly" }],
        encounters: [{ id: "e1", locationId: "lair", description: "Necromancer + 6 skeletons", monsters: [{ name: "Skeleton", count: 6 }] }],
      },
    });

  it("keeps visited locations, NPC names and summaries; drops plot secrets and unvisited places", () => {
    const p = publicCampaign(campaign(), crypt())!;
    expect(p.name).toBe("The Sunken Crypt");
    expect(p.sessionSummaries).toHaveLength(1);
    const o = p.outline!;
    expect(o.hook).toBe("");
    expect(o.acts).toEqual([]);
    expect(o.encounters).toEqual([]);
    expect(o.locations.map((l) => l.id)).toEqual(["crypt"]);
    expect(o.locations[0]).toMatchObject({ name: "Crypt", description: "Cold stone.", mapUrl: "/media/c/map_a.png", mapPrompt: "" });
    // Interactive features only once a cell of theirs has been seen (as the TV draws them).
    expect(o.locations[0].features.map((f) => f.name)).toEqual(["Altar", "Gate"]);
    expect(o.locations[0].walls).toHaveLength(1);
    expect(o.npcs).toEqual([{ name: "Mayor Brand", description: "A kindly old man.", motive: "", voice: "" }]);
    const json = JSON.stringify(p);
    for (const secret of ["necromancer", "betrays", "Raise the dead", "gravelly", "secret lever", "lair", "map_b", "trapdoor"]) expect(json.toLowerCase()).not.toContain(secret.toLowerCase());
  });

  it("null stays null; no state means no locations", () => {
    expect(publicCampaign(null, crypt())).toBeNull();
    expect(publicCampaign(campaign(), null)!.outline!.locations).toEqual([]);
    // Another campaign's state (the host just loaded a new one) reveals nothing either.
    expect(publicCampaign({ ...campaign(), id: "other" }, crypt())!.outline!.locations).toEqual([]);
  });
});
