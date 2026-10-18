import type { GameState, ToolArgsOf } from "@dm/shared";
import type { EngineContext, EngineOutcome } from "../tools.js";
import { castSpell } from "./cast.js";
import { deathSaveTool, endConcentrationTool, stabilizeTool } from "./vitals.js";

/**
 * Rules-engine tools (spells, rests, level-up, death saves). Registered in engine/tools.ts through
 * RULES_TOOLS (added to ENGINE_TOOLS) and RULES_HANDLERS (spread into the handler map).
 */
export const RULES_TOOLS = ["cast_spell", "end_concentration", "death_save", "stabilize"] as const;
export type RulesTool = (typeof RULES_TOOLS)[number];

type RulesHandler<N extends RulesTool> = (state: GameState, args: ToolArgsOf<N>, ctx: EngineContext, out: EngineOutcome) => unknown;

export const RULES_HANDLERS: { [N in RulesTool]: RulesHandler<N> } = {
  cast_spell: (state, a, ctx, out) => castSpell(state, a, ctx, out),
  end_concentration: (state, a) => endConcentrationTool(state, a),
  death_save: (state, a, ctx, out) => deathSaveTool(state, a, ctx, out),
  stabilize: (state, a) => stabilizeTool(state, a),
};
