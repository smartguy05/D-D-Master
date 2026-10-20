import type { Monster } from "@dm/shared";

export type Disposition = "foe" | "ally" | "neutral";

export function dispositionOf(m: Pick<Monster, "ally" | "neutral">): Disposition {
  return m.neutral ? "neutral" : m.ally ? "ally" : "foe";
}

/** The Monsters panel button cycles foe → ally → neutral → foe. */
export function nextDisposition(m: Pick<Monster, "ally" | "neutral">): Disposition {
  const order: Disposition[] = ["foe", "ally", "neutral"];
  return order[(order.indexOf(dispositionOf(m)) + 1) % order.length];
}

export const DISPOSITION_LABEL: Record<Disposition, string> = { foe: "👹 Foe", ally: "🤝 Ally", neutral: "😐 Neutral" };
