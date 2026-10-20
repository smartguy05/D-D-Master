import type { GameState, Monster, Token } from "@dm/shared";
import { HOLD_CAP_MS } from "./effectPlan";

/**
 * The board the TV shows lags the state while dice roll. The server applies damage and removes a
 * dead monster the moment the DM calls the tools, often while the attack's dice are still on the
 * tray; the table should see the HP drop and the creature leave after the roll, with its hit and
 * death animation. Pure: TablePage calls holdBoard on every state and tray change and renders
 * displayState(state, hold).
 */
export interface BoardHold {
  /** HP shown per creature id while its change waits for the dice (`since` starts HOLD_CAP_MS). */
  hp: Record<string, { hp: number; since: number }>;
  /** Monsters removed from the state while the dice rolled, still drawn until they are done. */
  gone: { monster: Monster; token?: Token; shownHp: number; since: number; locationId?: string }[];
}

export function emptyHold(): BoardHold {
  return { hp: {}, gone: [] };
}

type Tray = { busy: boolean; animating: readonly string[]; now: number };

function creatures(s: GameState | null): Map<string, number> {
  const m = new Map<string, number>();
  if (!s) return m;
  for (const c of s.characters) m.set(c.id, c.hp);
  for (const x of s.monsters) m.set(x.id, x.hp);
  return m;
}

/**
 * Next hold from the previous one, the last state seen (`before`) and the new one. While `busy`
 * (dice, held effects or moments) an HP change keeps the old value and a removed monster stays;
 * a lingering monster also stays while its death animation plays (`animating`). Everything lets go
 * after HOLD_CAP_MS, and lingering monsters of another location go at once.
 */
export function holdBoard(prev: BoardHold, before: GameState | null, next: GameState, tray: Tray): BoardHold {
  const fresh = (since: number) => tray.now - since < HOLD_CAP_MS;
  const nowHp = creatures(next);
  const wasHp = creatures(before);
  const hp: BoardHold["hp"] = {};
  for (const [id, cur] of nowHp) {
    const held = prev.hp[id];
    if (held) {
      if (held.hp !== cur && tray.busy && fresh(held.since)) hp[id] = held;
    } else if (tray.busy && wasHp.has(id) && wasHp.get(id) !== cur) {
      hp[id] = { hp: wasHp.get(id)!, since: tray.now };
    }
  }
  const gone: BoardHold["gone"] = [];
  for (const g of prev.gone) {
    if (nowHp.has(g.monster.id) || g.locationId !== next.locationId || !fresh(g.since)) continue;
    if (!tray.busy && !tray.animating.includes(g.monster.id)) continue;
    gone.push(tray.busy ? g : { ...g, shownHp: g.monster.hp });
  }
  if (tray.busy && before && before.locationId === next.locationId) {
    for (const m of before.monsters) {
      if (nowHp.has(m.id) || gone.some((g) => g.monster.id === m.id)) continue;
      gone.push({ monster: m, token: before.tokens.find((t) => t.entityId === m.id), shownHp: prev.hp[m.id]?.hp ?? m.hp, since: tray.now, locationId: next.locationId });
    }
  }
  return { hp, gone };
}

/** The state as the TV draws it: held HP and lingering monsters (the same object when nothing is held). */
export function displayState(state: GameState, hold: BoardHold): GameState {
  const held = Object.keys(hold.hp).length > 0;
  const gone = hold.gone.filter((g) => g.locationId === state.locationId && !state.monsters.some((m) => m.id === g.monster.id));
  if (!held && !gone.length) return state;
  const withHp = <T extends { id: string; hp: number }>(x: T): T => (hold.hp[x.id] ? { ...x, hp: hold.hp[x.id].hp } : x);
  return {
    ...state,
    characters: state.characters.map(withHp),
    monsters: [...state.monsters.map(withHp), ...gone.map((g) => ({ ...g.monster, hp: g.shownHp }))],
    tokens: [...state.tokens, ...gone.flatMap((g) => (g.token ? [g.token] : []))],
  };
}
