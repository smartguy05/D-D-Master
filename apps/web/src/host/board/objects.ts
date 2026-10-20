import type { MapObject } from "@dm/shared";

/** What a map object holds, for the host list: ["Dagger x2", "15 gp"]. */
export function objectContents(o: Pick<MapObject, "items" | "gold">): string[] {
  return [...o.items.map((i) => (i.qty > 1 ? `${i.name} x${i.qty}` : i.name)), ...(o.gold > 0 ? [`${o.gold} gp`] : [])];
}

/** Board tooltip: "Goblin's loot (loot) at 3,4: Dagger x2, 15 gp · hidden". */
export function objectSummary(o: MapObject): string {
  const contents = objectContents(o);
  const flags = [o.hidden ? "hidden" : "", o.used ? "used" : ""].filter(Boolean);
  return `${o.name} (${o.kind}) at ${o.x},${o.y}${contents.length ? `: ${contents.join(", ")}` : ""}${flags.length ? ` · ${flags.join(", ")}` : ""}`;
}
