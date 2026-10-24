/**
 * The /host notice stack (bottom right): errors stay until the host dismisses them, warnings and
 * info close on their own. One message is one card: a failed job and the HTTP call it rejected
 * carry the same text, so whichever arrives second merges into the first.
 */
export type NoticeLevel = "error" | "warning" | "info";

export interface Notice {
  id: number;
  level: NoticeLevel;
  /** What failed (a job label such as "Painting map: Pantry Peaks"). */
  title?: string;
  message: string;
}

export const MAX_NOTICES = 5;

const RANK: Record<NoticeLevel, number> = { info: 0, warning: 1, error: 2 };

/** Add a notice, or merge it into the card that already shows this message (the more severe level wins). */
export function addNotice(list: Notice[], n: Omit<Notice, "id">, id: number): { list: Notice[]; id: number; added: boolean } {
  const same = list.find((o) => o.message === n.message);
  if (same) {
    const merged: Notice = {
      ...same,
      level: RANK[n.level] > RANK[same.level] ? n.level : same.level,
      ...(same.title || !n.title ? {} : { title: n.title }),
    };
    return { list: list.map((o) => (o === same ? merged : o)), id: same.id, added: false };
  }
  return { list: [...list, { id, ...n }].slice(-MAX_NOTICES), id, added: true };
}

export function dismissNotice(list: Notice[], id: number): Notice[] {
  return list.filter((n) => n.id !== id);
}

/** How long a notice stays on screen; undefined: until dismissed. */
export function autoDismissMs(level: NoticeLevel): number | undefined {
  return level === "error" ? undefined : level === "warning" ? 8000 : 5000;
}

/** A timer's removal: skipped when the notice is (or was merged into) one that stays until dismissed. */
export function expireNotice(list: Notice[], id: number): Notice[] {
  const n = list.find((o) => o.id === id);
  return n && autoDismissMs(n.level) !== undefined ? dismissNotice(list, id) : list;
}
