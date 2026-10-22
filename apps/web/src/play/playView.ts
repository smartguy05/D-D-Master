import { locationOfCharacter, sceneView, type GameState } from "@dm/shared";

/**
 * Why the /play page's sheet drawer should get the player's attention: the DM waits for a physical
 * roll from this character ("roll": the drawer opens on its own, the number pad is in it), or it is
 * this character's turn ("turn": the Sheet button glows). Only in the scene the DM is running; a
 * party split's other scene waits (the sheet says so). A projected `turnIndex` of -1 (a hidden
 * creature's turn) is nobody's.
 */
export function sheetAttention(state: GameState, characterId: string | undefined): "roll" | "turn" | undefined {
  if (!characterId) return undefined;
  const here = sceneView(state, locationOfCharacter(state, characterId));
  if (!here.focused) return undefined;
  if (here.pendingRoll?.characterId === characterId) return "roll";
  if (here.combat.active && here.combat.order[here.combat.turnIndex]?.entityId === characterId) return "turn";
  return undefined;
}
