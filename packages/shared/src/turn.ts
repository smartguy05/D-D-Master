import type { Combat, TurnBudget } from "./schemas.js";

/** Feet of movement the creature still has this turn (Speed plus any Dash, minus what it moved). */
export function movementLeft(b: TurnBudget): number {
  return Math.max(0, b.speed + b.extraMovement - b.movementUsed);
}

/** The action is spent once it was used for anything but an Attack with attacks still to make. */
export function actionSpent(b: TurnBudget): boolean {
  return b.action && (b.attacksUsed === 0 || b.attacksUsed >= b.attacksPerAction);
}

export interface TurnBudgetPart {
  key: "move" | "action" | "bonus" | "reaction";
  label: string;
  used: boolean;
}

/**
 * The current turn's budget as display chips for the TV strip and the phone, e.g.
 * "20/30 ft", "Action (1/2 attacks)", "Bonus", "Reaction". `used` dims a chip.
 */
export function turnBudgetParts(combat: Pick<Combat, "turn" | "reactionsUsed">): TurnBudgetPart[] {
  const b = combat.turn;
  if (!b) return [];
  const total = b.speed + b.extraMovement;
  const left = movementLeft(b);
  const partial = b.action && b.attacksUsed > 0 && b.attacksUsed < b.attacksPerAction;
  return [
    { key: "move", label: `${left}/${total} ft`, used: left === 0 },
    { key: "action", label: partial ? `Action (${b.attacksUsed}/${b.attacksPerAction} attacks)` : "Action", used: actionSpent(b) },
    { key: "bonus", label: "Bonus", used: b.bonusAction },
    { key: "reaction", label: "Reaction", used: combat.reactionsUsed.includes(b.entityId) },
  ];
}
