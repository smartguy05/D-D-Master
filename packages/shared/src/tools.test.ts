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
