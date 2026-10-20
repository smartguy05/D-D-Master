import type { GameState } from "@dm/shared";
import { monsterShownOnTable } from "./visibility";

/** What the TV says about a monster's health: never exact HP (same bands as the foe list). */
export type HpBand = "healthy" | "bloodied" | "near death" | "defeated";

export function hpBand(hp: number, maxHp: number): HpBand {
  if (hp <= 0) return "defeated";
  const frac = maxHp > 0 ? hp / maxHp : 0;
  return frac > 0.5 ? "healthy" : frac > 0.25 ? "bloodied" : "near death";
}

/** A PC has `hp` ("cur/max"); a shown monster has `hpBand`; a hidden monster only `{name: "Unknown foe", hidden: true}`. */
export interface NowPanel {
  name: string;
  kind?: "character" | "monster";
  entityId?: string;
  portraitUrl?: string;
  hp?: string;
  hpBand?: HpBand;
  conditions?: string[];
  hidden?: true;
}

/**
 * The TV's "Now" card for the creature whose turn it is (null out of combat). A PC shows exact HP;
 * a monster shows an HP band; a monster the table can't see (hidden, or in unseen fog) is an
 * "Unknown foe" with nothing else, so the card never gives an ambusher away.
 */
export function nowPanelFor(state: GameState, turnId?: string): NowPanel | null {
  if (!state.combat.active) return null;
  // `turnId`: the turn the TV shows (momentPlan.shownTurn), which can lag the state behind the dice.
  const entry = turnId ? state.combat.order.find((o) => o.entityId === turnId) : state.combat.order[state.combat.turnIndex];
  if (!entry) return null;
  const c = state.characters.find((x) => x.id === entry.entityId);
  if (c) return { kind: "character", entityId: c.id, name: c.name, portraitUrl: c.spriteUrl, hp: `${c.hp}/${c.maxHp}`, conditions: [...c.conditions] };
  const m = state.monsters.find((x) => x.id === entry.entityId);
  if (!m) return null;
  if (!monsterShownOnTable(state)(m.id)) return { name: "Unknown foe", hidden: true };
  return { kind: "monster", entityId: m.id, name: m.name, portraitUrl: m.spriteUrl, hpBand: hpBand(m.hp, m.maxHp), conditions: [...m.conditions] };
}
