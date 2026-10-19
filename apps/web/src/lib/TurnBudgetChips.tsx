import { turnBudgetParts, type Combat } from "@dm/shared";

const ICON = { move: "👣", action: "⚔", bonus: "◆", reaction: "↺" } as const;

/** The current turn's movement / action / bonus action / reaction, used ones dimmed (TV strip, phone banner). */
export function TurnBudgetChips({ combat, className = "" }: { combat: Pick<Combat, "turn" | "reactionsUsed">; className?: string }) {
  const parts = turnBudgetParts(combat);
  if (!parts.length) return null;
  return (
    <div className={`turn-chips ${className}`}>
      {parts.map((p) => (
        <span key={p.key} className={`turn-chip ${p.key} ${p.used ? "used" : ""}`} title={p.used ? "used" : "available"}>
          {ICON[p.key]} {p.label}
        </span>
      ))}
    </div>
  );
}
