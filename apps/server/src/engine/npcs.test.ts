import { describe, expect, it } from "vitest";
import * as shared from "@dm/shared";
import { Character, emptyGameState, type GameState, type Monster, type Rng } from "@dm/shared";
import { executeEngineTool, restageForMap, type EngineContext } from "./tools.js";
import { stalledTurn } from "./turns.js";

const seq =
  (...values: number[]): Rng =>
  () =>
    values.length > 1 ? values.shift()! : values[0];

const template = (name: string, maxHp: number, ac: number): Omit<Monster, "id" | "hp"> => ({
  name,
  srdName: name,
  maxHp,
  ac,
  initiativeBonus: 1,
  speed: 30,
  attacksPerAction: 1,
  attacks: [{ name: "Longsword", toHit: 5, damage: "1d8+3" }],
  conditions: [],
  hidden: false,
  npc: false,
  appearance: "",
  ally: false,
  follows: false,
  combatant: true,
  neutral: false,
  conditionMeta: [],
});

function ctx(rng: Rng = seq(10)): EngineContext {
  const templates: Record<string, Omit<Monster, "id" | "hp">> = {
    commoner: template("Commoner", 4, 10),
    veteran: template("Veteran", 65, 17),
    "goblin warrior": template("Goblin Warrior", 10, 15),
  };
  return {
    rng,
    monsterTemplate: (name) => templates[name.toLowerCase()],
    spell: () => undefined,
    spellCandidates: () => [],
    classData: () => undefined,
    locations: [
      { id: "loc_market", name: "Lantern Market", description: "", mapPrompt: "", fog: false, walls: [], features: [], gridW: 12, gridH: 8 },
      { id: "loc_garden", name: "Royal Gardens", description: "", mapPrompt: "", fog: false, walls: [], features: [], gridW: 12, gridH: 8 },
    ],
    npcs: [{ name: "Captain Mara Venn", description: "A scarred captain of the watch in a blue cloak.", motive: "", voice: "" }],
  };
}

const run = (s: GameState, tool: Parameters<typeof executeEngineTool>[1], args: unknown, rng?: Rng) => executeEngineTool(s, tool, args, ctx(rng));

function inMarket(): GameState {
  let s = emptyGameState("c1");
  s.characters.push(
    Character.parse({ id: "pc_a", playerName: "Anthony", name: "Bram", maxHp: 12, hp: 12 }),
    Character.parse({ id: "pc_b", playerName: "Sam", name: "Sylvaine", maxHp: 9, hp: 9 }),
  );
  s = run(s, "change_scene", { location_id: "loc_market" }).state;
  return s;
}

const tokenOf = (s: GameState, id: string) => s.tokens.find((t) => t.entityId === id);
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

describe("add_npc", () => {
  it("puts an outline NPC next to the party with its outline look, a stat block and its own sprite request", () => {
    const r = run(inMarket(), "add_npc", { name: "captain mara venn", stat_block: "Veteran" });
    const m = r.state.monsters[0];
    expect(m).toMatchObject({ name: "Captain Mara Venn", npc: true, ally: true, follows: true, srdName: "Veteran", maxHp: 65, ac: 17 });
    expect(m.appearance).toMatch(/blue cloak/);
    expect(r.outcome.spawned.map((x) => x.id)).toEqual([m.id]);
    const t = tokenOf(r.state, m.id)!;
    expect(t.entityType).toBe("monster");
    expect(dist(t, tokenOf(r.state, "pc_a")!)).toBeLessThanOrEqual(2);
    expect(r.state.tokens.filter((x) => x.x === t.x && x.y === t.y)).toHaveLength(1);
  });

  it("defaults to a Commoner and takes the given appearance", () => {
    const r = run(inMarket(), "add_npc", { name: "Pip", appearance: "a nervous halfling lamplighter" });
    expect(r.state.monsters[0]).toMatchObject({ name: "Pip", srdName: "Commoner", maxHp: 4, appearance: "a nervous halfling lamplighter" });
  });

  it("calling it again for the same NPC updates it instead of adding a second one", () => {
    let s = run(inMarket(), "add_npc", { name: "Pip" }).state;
    const r = run(s, "add_npc", { name: "pip", follows: false, x: 10, y: 6 });
    s = r.state;
    expect(s.monsters).toHaveLength(1);
    expect(s.monsters[0].follows).toBe(false);
    expect(tokenOf(s, s.monsters[0].id)).toMatchObject({ x: 10, y: 6 });
    expect(r.outcome.spawned).toHaveLength(0); // same look: no redraw
    const redraw = run(s, "add_npc", { name: "Pip", appearance: "now wearing armour" });
    expect(redraw.outcome.spawned).toHaveLength(1);
    expect(redraw.state.monsters[0].spriteUrl).toBeUndefined();
  });

  it("a spawned monster never borrows a named NPC's portrait", () => {
    let s = run(inMarket(), "add_npc", { name: "Captain Mara Venn", stat_block: "Veteran" }).state;
    s.monsters[0].spriteUrl = "/media/c1/mara.png";
    s = run(s, "spawn_monster", { name: "Veteran" }).state;
    expect(s.monsters[1].spriteUrl).toBeUndefined();
  });
});

describe("followers across scenes", () => {
  it("change_scene keeps living followers next to the party and drops monsters and NPCs that stay", () => {
    let s = inMarket();
    s = run(s, "add_npc", { name: "Captain Mara Venn" }).state;
    s = run(s, "add_npc", { name: "Shopkeeper", follows: false }).state;
    s = run(s, "spawn_monster", { name: "Goblin Warrior" }).state;
    s = run(s, "change_scene", { location_id: "loc_garden" }).state;
    expect(s.monsters.map((m) => m.name)).toEqual(["Captain Mara Venn"]);
    const mara = tokenOf(s, s.monsters[0].id)!;
    expect(dist(mara, tokenOf(s, "pc_a")!)).toBeLessThanOrEqual(2);
    expect(s.tokens.filter((t) => t.entityType === "monster")).toHaveLength(1);
  });

  it("a dead (non-ally) follower stays behind; a knocked-out ally is carried along", () => {
    let s = run(inMarket(), "add_npc", { name: "Pip", ally: false }).state;
    s = run(s, "apply_damage", { target_id: "Pip", amount: 10 }).state;
    s = run(s, "change_scene", { location_id: "loc_garden" }).state;
    expect(s.monsters).toHaveLength(0);
    s = run(inMarket(), "add_npc", { name: "Pip" }).state;
    s = run(s, "apply_damage", { target_id: "Pip", amount: 10 }).state;
    s = run(s, "change_scene", { location_id: "loc_garden" }).state;
    expect(s.monsters.map((m) => [m.name, m.conditions])).toEqual([["Pip", ["Unconscious"]]]);
  });

  it("restageForMap puts followers with the party at the entrance, not with the monsters", () => {
    let s = run(inMarket(), "add_npc", { name: "Pip" }).state;
    s = run(s, "spawn_monster", { name: "Goblin Warrior" }).state;
    const next = restageForMap(s, ctx());
    const pip = tokenOf(next, next.monsters[0].id)!;
    const goblin = tokenOf(next, next.monsters[1].id)!;
    const pc = tokenOf(next, "pc_a")!;
    expect(dist(pip, pc)).toBeLessThanOrEqual(2);
    expect(dist(goblin, pc)).toBeGreaterThan(2);
  });
});

describe("DM-played combat turns", () => {
  it("start_combat and next_turn tell the DM to take a monster's or ally's turn now", () => {
    let s = run(inMarket(), "add_npc", { name: "Pip", combatant: true }).state;
    s = run(s, "spawn_monster", { name: "Goblin Warrior" }).state;
    // Bram 2, Sylvaine 3, Pip 20 (+1), Goblin 10 (+1): Pip, Goblin, Sylvaine, Bram
    let r = run(s, "start_combat", {}, seq(2, 3, 20, 10));
    expect(r.outcome.output).toMatchObject({ first: "Pip", instruction: expect.stringMatching(/party's side.*next_turn/) });
    r = run(r.state, "next_turn", {});
    expect(r.outcome.output).toMatchObject({ current: "Goblin Warrior", instruction: expect.stringMatching(/You play Goblin Warrior/) });
    r = run(r.state, "next_turn", {});
    expect((r.outcome.output as { instruction?: string }).instruction).toBeUndefined();
  });

  it("stalledTurn names the open DM-played turn and nothing on a player's turn or outside combat", () => {
    let s = run(inMarket(), "spawn_monster", { name: "Goblin Warrior" }).state;
    expect(stalledTurn(s)).toBeUndefined();
    s = run(s, "start_combat", {}, seq(2, 3, 20)).state; // Goblin, Sylvaine, Bram
    const first = stalledTurn(s)!;
    expect(first.prompt).toMatch(/still Goblin Warrior's turn.*next_turn/);
    s = run(s, "next_turn", {}).state;
    expect(stalledTurn(s)).toBeUndefined();
    s = run(run(s, "next_turn", {}).state, "next_turn", {}).state; // round 2, the goblin again
    expect(stalledTurn(s)!.key).not.toBe(first.key);
  });
});

describe("end-of-combat nudge", () => {
  /** Goblin, Sylvaine, Bram in initiative; then it's Sylvaine's turn. */
  function fight(): GameState {
    let s = run(inMarket(), "spawn_monster", { name: "Goblin Warrior" }).state;
    s = run(s, "start_combat", {}, seq(2, 3, 20)).state;
    return run(s, "next_turn", {}).state;
  }
  const goblinId = (s: GameState) => s.monsters.find((m) => m.name === "Goblin Warrior")!.id;

  it("doesn't remind while a PC is dying, or in a fight that never had a foe", () => {
    let s = fight();
    s = run(s, "apply_damage", { target_id: goblinId(s), amount: 50 }).state;
    s.characters[0].hp = 0;
    expect(stalledTurn(s)).toBeUndefined();
    const noFoes = run(inMarket(), "start_combat", {}, seq(2, 3)).state;
    expect(stalledTurn(noFoes)).toBeUndefined();
  });

  it("reminds the DM to end_combat when no foe is left standing, with a key stable for the combat", () => {
    let s = fight();
    expect(stalledTurn(s)).toBeUndefined(); // a player's turn, the goblin still up
    s = run(s, "apply_damage", { target_id: goblinId(s), amount: 50 }).state;
    expect(s.combat.active).toBe(true);
    const nudge = stalledTurn(s)!;
    expect(nudge).toBeDefined();
    expect(nudge.prompt).toMatch(/end_combat/);
    expect(stalledTurn(s)!.key).toBe(nudge.key);
    expect(stalledTurn(run(s, "next_turn", {}).state)?.key).toBe(nudge.key);
  });

  it("counts allies and neutral creatures as no foes", () => {
    let s = run(inMarket(), "add_npc", { name: "Pip", combatant: true }).state;
    s = run(s, "spawn_monster", { name: "Commoner" }).state;
    s = run(s, "spawn_monster", { name: "Goblin Warrior" }).state;
    const commoner = s.monsters.find((m) => !m.npc && m.srdName === "Commoner")!.id;
    s = run(s, "set_disposition", { monster_id: commoner, disposition: "neutral" }).state;
    s = run(s, "start_combat", {}, seq(20, 3, 2, 1)).state; // Bram first (a player's turn)
    expect(s.combat.order[s.combat.turnIndex].entityId).toBe("pc_a");
    expect(stalledTurn(s)).toBeUndefined();
    s = run(s, "apply_damage", { target_id: s.monsters.find((m) => m.srdName === "Goblin Warrior")!.id, amount: 50 }).state;
    expect(stalledTurn(s)!.prompt).toMatch(/end_combat/);
  });

  it("says nothing out of combat", () => {
    let s = fight();
    s = run(s, "apply_damage", { target_id: goblinId(s), amount: 50 }).state;
    s = run(s, "end_combat", {}).state;
    expect(stalledTurn(s)).toBeUndefined();
  });
});

describe("add_npc: voice direction and attitude (Phase 4)", () => {
  const defaultNpcVoice = (shared as unknown as { defaultNpcVoice: (name: string, appearance?: string, creatureType?: string) => string }).defaultNpcVoice;
  const withOutline = (voice: string): EngineContext => ({ ...ctx(), npcs: [{ name: "Captain Mara Venn", description: "A scarred captain.", motive: "", voice }] });
  const runOutline = (s: GameState, args: unknown, voice: string) => executeEngineTool(s, "add_npc", args, withOutline(voice));
  const npc = (s: GameState, name: string) => s.monsters.find((x) => x.name === name) as (Monster & Record<string, unknown>) | undefined;

  it("stores the given voice on a new NPC", () => {
    const s = run(inMarket(), "add_npc", { name: "Pell Netter", voice: "gravelly, slow, coastal drawl" }).state;
    expect(npc(s, "Pell Netter")!.voice).toBe("gravelly, slow, coastal drawl");
  });

  it("a re-call updates the voice when given and keeps it when not", () => {
    let s = run(inMarket(), "add_npc", { name: "Pell Netter", voice: "gravelly" }).state;
    s = run(s, "add_npc", { name: "Pell Netter", follows: false }).state;
    expect(npc(s, "Pell Netter")!.voice).toBe("gravelly");
    s = run(s, "add_npc", { name: "Pell Netter", voice: "hoarse whisper" }).state;
    expect(npc(s, "Pell Netter")!.voice).toBe("hoarse whisper");
    expect(s.monsters.filter((x) => x.name === "Pell Netter")).toHaveLength(1);
  });

  it("an outline NPC takes the outline voice when no voice arg is given; the arg wins", () => {
    let s = runOutline(inMarket(), { name: "captain mara venn" }, "clipped military bark").state;
    expect(npc(s, "Captain Mara Venn")!.voice).toBe("clipped military bark");
    s = runOutline(inMarket(), { name: "Captain Mara Venn", voice: "tired alto" }, "clipped military bark").state;
    expect(npc(s, "Captain Mara Venn")!.voice).toBe("tired alto");
  });

  it("with no voice anywhere, a deterministic default direction is generated (never empty)", () => {
    const a = run(inMarket(), "add_npc", { name: "Old Wick", appearance: "a stooped lamplighter" }).state;
    const b = run(inMarket(), "add_npc", { name: "Old Wick", appearance: "a stooped lamplighter" }).state;
    const v = npc(a, "Old Wick")!.voice as string;
    expect(typeof v).toBe("string");
    expect(v.trim().length).toBeGreaterThan(0);
    expect(npc(b, "Old Wick")!.voice).toBe(v);
    // An outline NPC whose outline voice is empty gets one too.
    const c = runOutline(inMarket(), { name: "Captain Mara Venn" }, "").state;
    expect((npc(c, "Captain Mara Venn")!.voice as string).trim().length).toBeGreaterThan(0);
    expect(typeof defaultNpcVoice).toBe("function");
  });

  it("the generated default matches what speak_as_npc used before the NPC was placed: defaultNpcVoice(name) (review fix)", () => {
    const s = run(inMarket(), "add_npc", { name: "Old Tam", appearance: "a stooped fisherman", stat_block: "Commoner" }).state;
    expect(npc(s, "Old Tam")!.voice).toBe(defaultNpcVoice("Old Tam"));
  });

  it("new NPCs get an attitude matching their side: ally -> friendly/+3, ally false -> hostile/-3", () => {
    let s = run(inMarket(), "add_npc", { name: "Pell Netter" }).state;
    expect(npc(s, "Pell Netter")).toMatchObject({ attitude: "friendly", attitudeScore: 3 });
    s = run(s, "add_npc", { name: "Grub", ally: false }).state;
    expect(npc(s, "Grub")).toMatchObject({ attitude: "hostile", attitudeScore: -3 });
  });
});
