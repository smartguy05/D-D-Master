import type { GameState, ToolArgsOf } from "@dm/shared";
import type { EngineContext, EngineOutcome } from "../tools.js";
import { castSpell } from "./cast.js";
import { longRest, shortRest, useResource } from "./rests.js";
import { deathSaveTool, endConcentrationTool, stabilizeTool } from "./vitals.js";

/**
 * Rules-engine tools (spells, rests, level-up, death saves). Registered in engine/tools.ts through
 * RULES_TOOLS (added to ENGINE_TOOLS) and RULES_HANDLERS (spread into the handler map).
 */
export const RULES_TOOLS = ["cast_spell", "end_concentration", "use_resource", "short_rest", "long_rest", "death_save", "stabilize"] as const;
export type RulesTool = (typeof RULES_TOOLS)[number];

type RulesHandler<N extends RulesTool> = (state: GameState, args: ToolArgsOf<N>, ctx: EngineContext, out: EngineOutcome) => unknown;

export const RULES_HANDLERS: { [N in RulesTool]: RulesHandler<N> } = {
  cast_spell: (state, a, ctx, out) => castSpell(state, a, ctx, out),
  end_concentration: (state, a) => endConcentrationTool(state, a),
  use_resource: (state, a) => useResource(state, a),
  short_rest: (state, a, ctx, out) => shortRest(state, a, ctx, out),
  long_rest: (state, a) => longRest(state, a),
  death_save: (state, a, ctx, out) => deathSaveTool(state, a, ctx, out),
  stabilize: (state, a) => stabilizeTool(state, a),
};
