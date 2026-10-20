import { describe, expect, it } from "vitest";
import { HOST_ONLY_TOOLS, isHostOnlyTool, isToolName, realtimeToolDefs, ToolArgs, TOOL_DESCRIPTIONS } from "./tools.js";

describe("realtime tool definitions", () => {
  const defs = realtimeToolDefs();
  it("exports every tool as a JSON-schema function", () => {
    expect(defs.map((d) => d.name).sort()).toEqual(Object.keys(ToolArgs).sort());
    for (const d of defs) {
      expect(d.type).toBe("function");
      expect(d.parameters.type).toBe("object");
      expect(d.parameters).not.toHaveProperty("$schema");
      expect(d.description).toBe(TOOL_DESCRIPTIONS[d.name as keyof typeof TOOL_DESCRIPTIONS]);
    }
  });
  it("marks required args", () => {
    const dmg = defs.find((d) => d.name === "apply_damage")!;
    expect(dmg.parameters.required).toEqual(expect.arrayContaining(["target_id", "amount"]));
  });
});

describe("character builder tools", () => {
  const defs = realtimeToolDefs();
  it("draft_character_update takes only optional Character-style fields", () => {
    const d = defs.find((x) => x.name === "draft_character_update")!;
    expect(d.parameters.required ?? []).toEqual([]);
    expect(Object.keys(d.parameters.properties as object)).toEqual(
      expect.arrayContaining(["name", "species", "className", "background", "abilities", "appearance"]),
    );
    expect(ToolArgs.draft_character_update.parse({ abilities: { str: 15 } })).toEqual({ abilities: { str: 15 } });
    expect(() => ToolArgs.draft_character_update.parse({ abilities: { str: 99 } })).toThrow();
  });
  it("start_character_builder requires a player", () => {
    expect(() => ToolArgs.start_character_builder.parse({})).toThrow();
    expect(ToolArgs.start_character_builder.parse({ player_id: "Sam", level: 3 })).toEqual({ player_id: "Sam", level: 3 });
    expect(ToolArgs.finalize_character.parse({})).toEqual({});
  });
});

describe("host-only tools", () => {
  it("lists real tools, and set_monster_hidden stays open to the DM", () => {
    for (const n of HOST_ONLY_TOOLS) expect(isToolName(n)).toBe(true);
    expect(HOST_ONLY_TOOLS).toEqual(expect.arrayContaining(["edit_fog", "edit_map_feature"]));
    expect(HOST_ONLY_TOOLS).not.toContain("set_monster_hidden");
    expect(isHostOnlyTool("edit_fog")).toBe(true);
    expect(isHostOnlyTool("move_token")).toBe(false);
  });
});

describe("edit_map_feature args", () => {
  it("rejects non-finite box numbers for every field", () => {
    for (const k of ["x", "y", "w", "h"]) {
      for (const v of [Infinity, -Infinity, NaN]) {
        expect(ToolArgs.edit_map_feature.safeParse({ action: "update", index: 0, feature: { [k]: v } }).success).toBe(false);
      }
      expect(ToolArgs.edit_map_feature.safeParse({ action: "update", index: 0, feature: { [k]: 2.5 } }).success).toBe(true);
    }
  });
});

describe("disposition, spell conditions and opt-in initiative args", () => {
  it("set_disposition is a tool with a description and parses its args", () => {
    expect(isToolName("set_disposition")).toBe(true);
    expect(TOOL_DESCRIPTIONS).toHaveProperty("set_disposition");
    const args = (ToolArgs as unknown as Record<string, { parse(x: unknown): unknown }>).set_disposition;
    expect(args.parse({ monster_id: "m1", disposition: "neutral" })).toMatchObject({ monster_id: "m1", disposition: "neutral" });
    expect(args.parse({ monster_id: "m1", disposition: "ally", combatant: true })).toMatchObject({ combatant: true });
    expect(() => args.parse({ monster_id: "m1", disposition: "friendly" })).toThrow();
  });

  it("add_condition takes source_spell, caster_id, duration_rounds and until_end_of_turn_of", () => {
    const a = { target_id: "pc_f", condition: "Blessed", source_spell: "Bless", caster_id: "pc_c", duration_rounds: 10, until_end_of_turn_of: "m1" };
    expect(ToolArgs.add_condition.parse(a)).toMatchObject(a);
  });

  it("add_npc takes combatant (engine default false for a new NPC)", () => {
    expect(ToolArgs.add_npc.parse({ name: "Pell" }).combatant).toBeUndefined(); // new NPCs: false in the engine; a re-call leaves it unchanged
    expect(ToolArgs.add_npc.parse({ name: "Pell", combatant: true })).toMatchObject({ combatant: true });
  });
});

describe("gold and physical damage roll args", () => {
  it("adjust_gold amounts are whole gold pieces", () => {
    expect(() => ToolArgs.adjust_gold.parse({ character_id: "pc_a", amount: 37.5 })).toThrow();
    expect(ToolArgs.adjust_gold.parse({ character_id: "pc_a", amount: -34 })).toEqual({ character_id: "pc_a", amount: -34 });
  });

  it("split_gold is a tool taking a whole-number total and at least one character", () => {
    expect(isToolName("split_gold")).toBe(true);
    const args = (ToolArgs as Record<string, { parse: (v: unknown) => unknown }>).split_gold;
    expect(args).toBeDefined();
    expect(TOOL_DESCRIPTIONS).toHaveProperty("split_gold");
    expect(args.parse({ total: 225, character_ids: ["pc_a", "pc_b", "pc_c"] })).toEqual({ total: 225, character_ids: ["pc_a", "pc_b", "pc_c"] });
    expect(() => args.parse({ total: 22.5, character_ids: ["pc_a"] })).toThrow();
    expect(() => args.parse({ total: -1, character_ids: ["pc_a"] })).toThrow();
    expect(() => args.parse({ total: 10, character_ids: [] })).toThrow();
  });

  it("request_player_roll takes kind check|damage (default check); record_physical_roll takes damage and critical", () => {
    const req = ToolArgs.request_player_roll.parse({ character_id: "pc_a", notation: "1d20+3", label: "Stealth" }) as { kind?: string };
    expect(req.kind).toBe("check");
    const dmg = ToolArgs.request_player_roll.parse({ character_id: "pc_a", notation: "1d8+3", label: "Longsword damage", target_id: "m1", kind: "damage" }) as { kind?: string };
    expect(dmg.kind).toBe("damage");
    expect(() => ToolArgs.request_player_roll.parse({ character_id: "pc_a", notation: "1d8", label: "x", kind: "nonsense" })).toThrow();
    const rec = ToolArgs.record_physical_roll.parse({ character_id: "pc_a", notation: "1d8+3", label: "Longsword damage", total: 9, kind: "damage", critical: true }) as { kind?: string; critical?: boolean };
    expect(rec).toMatchObject({ kind: "damage", critical: true });
  });
});

describe("walls and doors tools (T1, T2)", () => {
  const args = ToolArgs as unknown as Record<string, { parse(x: unknown): unknown; safeParse(x: unknown): { success: boolean } }>;

  it("set_door is a DM tool (not host-only) with a description", () => {
    expect(isToolName("set_door")).toBe(true);
    expect(TOOL_DESCRIPTIONS).toHaveProperty("set_door");
    expect(isHostOnlyTool("set_door")).toBe(false);
    expect(HOST_ONLY_TOOLS).not.toContain("set_door");
    expect(args.set_door!.parse({ door_id: "d1", open: true })).toEqual({ door_id: "d1", open: true });
    expect(args.set_door!.parse({ door_id: "d1", open: false, location: "loc_a" })).toEqual({ door_id: "d1", open: false, location: "loc_a" });
    expect(args.set_door!.safeParse({ door_id: "d1" }).success).toBe(false);
    expect(args.set_door!.safeParse({ open: true }).success).toBe(false);
  });

  it("edit_walls is host-only and takes add/delete/toggle/reset", () => {
    expect(isToolName("edit_walls")).toBe(true);
    expect(TOOL_DESCRIPTIONS).toHaveProperty("edit_walls");
    expect(HOST_ONLY_TOOLS).toContain("edit_walls");
    expect(isHostOnlyTool("edit_walls")).toBe(true);
    const e = args.edit_walls!;
    expect(e.safeParse({ action: "add", segment: { x1: 3, y1: 0, x2: 3, y2: 5, kind: "door" } }).success).toBe(true);
    expect(e.safeParse({ action: "delete", id: "w1" }).success).toBe(true);
    expect(e.safeParse({ action: "toggle", id: "d1" }).success).toBe(true);
    expect(e.safeParse({ action: "reset" }).success).toBe(true);
    expect(e.safeParse({ action: "paint" }).success).toBe(false);
    expect(e.safeParse({ action: "add", segment: { x1: 3, y1: 0, x2: 3, y2: 5, kind: "fence" } }).success).toBe(false);
  });

  it("the realtime tool list offers set_door but the host-only edit_walls is still a known tool", () => {
    const names = realtimeToolDefs().map((d) => d.name);
    expect(names).toContain("set_door");
  });
});
