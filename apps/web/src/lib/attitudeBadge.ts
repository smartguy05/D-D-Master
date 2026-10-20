import { attitudeOf, type Attitude, type Monster } from "@dm/shared";

const ICON: Record<Attitude, string> = { hostile: "😠", indifferent: "😐", friendly: "🙂" };
const LABEL: Record<Attitude, string> = { hostile: "Hostile", indifferent: "Indifferent", friendly: "Friendly" };

type Source = Partial<Pick<Monster, "ally" | "neutral" | "attitude" | "attitudeScore">>;

/** Badge text for a creature's attitude, e.g. "🙂 Friendly +3", "😐 Indifferent 0", "😠 Hostile −3". */
export function attitudeBadge(m: Source): string {
  const { attitude, score } = attitudeOf(m);
  const signed = score > 0 ? `+${score}` : score < 0 ? `−${-score}` : "0";
  return `${ICON[attitude]} ${LABEL[attitude]} ${signed}`;
}
