import { describe, expect, it } from "vitest";
import { TurnBudget } from "./schemas.js";
import { actionSpent, movementLeft, turnBudgetParts } from "./turn.js";

const budget = (over: Partial<TurnBudget> = {}) => TurnBudget.parse({ entityId: "pc_a", round: 1, ...over });

describe("turn budget display", () => {
  it("counts Dash into the movement left", () => {
    expect(movementLeft(budget({ speed: 30, movementUsed: 20 }))).toBe(10);
    expect(movementLeft(budget({ speed: 30, extraMovement: 30, movementUsed: 40 }))).toBe(20);
    expect(movementLeft(budget({ speed: 30, movementUsed: 45 }))).toBe(0);
  });

  it("keeps the action open between Extra Attack swings", () => {
    expect(actionSpent(budget({ action: true, attacksUsed: 1, attacksPerAction: 2 }))).toBe(false);
    expect(actionSpent(budget({ action: true, attacksUsed: 2, attacksPerAction: 2 }))).toBe(true);
    expect(actionSpent(budget({ action: true, attacksUsed: 0 }))).toBe(true);
  });

  it("builds chips with used flags and the reaction from the round's list", () => {
    const parts = turnBudgetParts({ turn: budget({ movementUsed: 10, action: true, attacksUsed: 1, attacksPerAction: 2 }), reactionsUsed: ["pc_a"] });
    expect(parts).toEqual([
      { key: "move", label: "20/30 ft", used: false },
      { key: "action", label: "Action (1/2 attacks)", used: false },
      { key: "bonus", label: "Bonus", used: false },
      { key: "reaction", label: "Reaction", used: true },
    ]);
    expect(turnBudgetParts({ turn: null, reactionsUsed: [] })).toEqual([]);
  });
});
