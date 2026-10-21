import type { TalkState } from "@dm/shared";

/**
 * Live "who's talking" on the client. `reduceTalk` keeps the slow part (is someone talking, who)
 * for React state and returns the same object when only the level moved, so the ~8 Hz level
 * updates don't re-render the page; the level itself goes to `onTalkLevel` subscribers that
 * paint a bar directly.
 */
export interface TalkView {
  playerId?: string;
  provisional?: boolean;
}

export function reduceTalk(prev: TalkView | null, t: TalkState): TalkView | null {
  if (!t.active) return null;
  if (prev && prev.playerId === t.playerId && prev.provisional === t.provisional) return prev;
  return t.playerId ? { playerId: t.playerId, provisional: t.provisional } : {};
}

let level = 0;
const listeners = new Set<(level: number) => void>();

export function setTalkLevel(l: number) {
  level = Math.max(0, Math.min(1, l));
  listeners.forEach((fn) => fn(level));
}

export function onTalkLevel(fn: (level: number) => void): () => void {
  listeners.add(fn);
  fn(level);
  return () => listeners.delete(fn);
}

/** NPC close-up subtitles (caption events, speak_as_npc lines): streamed to NpcCloseup, not React state. */
export interface CaptionPiece {
  id: string;
  npcName: string;
  text: string;
  final: boolean;
  /** A speak_as_npc clip's line: timed by its length, not by the DM's voice. */
  clip?: boolean;
  /** A clip's speaker portrait (an AI player's sprite). */
  portraitUrl?: string;
  /** A clip spoken by a player character (an AI player). */
  pc?: boolean;
}

const captionListeners = new Set<(c: CaptionPiece) => void>();

export function pushCaption(c: CaptionPiece) {
  captionListeners.forEach((fn) => fn(c));
}

export function onCaption(fn: (c: CaptionPiece) => void): () => void {
  captionListeners.add(fn);
  return () => captionListeners.delete(fn);
}
