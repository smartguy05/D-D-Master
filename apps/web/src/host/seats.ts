import type { Character, CustomSpecies, Player } from "@dm/shared";

/** One row of the host Party tab's seat list: a player (maybe with a character) or a character nobody holds. */
export interface Seat {
  /** "p:<playerId>" or "c:<characterId>". */
  key: string;
  player?: Player;
  character?: Character;
}

/** The selection that opens the "add a character" pane instead of a seat. */
export const NEW_SEAT = "new";

/** Players first (in table order, with the character each holds), then every character no player holds. */
export function buildSeats(players: Player[], characters: Character[]): Seat[] {
  const held = new Set(players.map((p) => p.characterId).filter(Boolean));
  return [
    ...players.map((p) => ({ key: `p:${p.id}`, player: p, character: characters.find((c) => c.id === p.characterId) })),
    ...characters.filter((c) => !held.has(c.id)).map((c) => ({ key: `c:${c.id}`, character: c })),
  ];
}

/** Keep the selected seat while it exists; otherwise (removed, or nothing picked yet) the first seat. */
export function pickSelected(seats: Seat[], selected: string | null): string | null {
  if (selected === NEW_SEAT || seats.some((s) => s.key === selected)) return selected;
  return seats[0]?.key ?? null;
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** A custom species' collapsed row in Character rules: "Humanoid · 30 ft · darkvision 60 · 3 traits". */
export function speciesSummary(s: CustomSpecies): string {
  return [
    s.creatureType,
    `${s.speed} ft`,
    s.darkvision ? `darkvision ${s.darkvision}` : "",
    s.traits.length ? count(s.traits.length, "trait") : "",
    s.choices.length ? count(s.choices.length, "choice") : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
