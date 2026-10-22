import { FLOOR_TAIL_MS, type FloorView } from "@dm/shared";

/**
 * Push-to-talk floor on the client (server: apps/server/src/game/floor.ts). The /table page opens the
 * room mic toward the DM only while the room (Space on the TV) or a player in the room (a home-network
 * phone) holds the floor, plus a short tail; mute stays a hard override on top. Players see who holds it.
 */

/** The room mic should be open: push-to-talk is off (or not known yet), or the room / an in-room player holds the floor. */
export function roomHoldsFloor(floor: FloorView | null): boolean {
  if (!floor || !floor.pushToTalk) return true;
  const h = floor.holder;
  return !!h && ("room" in h || h.inRoom);
}

/**
 * The table mic track toward the DM is enabled: not muted, and the room holds the floor or its tail is
 * still running, or a voice is being enrolled (the recording may come from this mic; the server's
 * push-to-talk gate still drops the words as a DM turn, since nobody holds the floor).
 */
export function tableMicEnabled(o: { muted: boolean; floor: FloorView | null; tailUntil: number; now: number }): boolean {
  if (o.muted) return false;
  return roomHoldsFloor(o.floor) || !!o.floor?.enrolling || o.now < o.tailUntil;
}

/** The new tail end: a fresh tail when the room just let go, none while it holds, else unchanged. */
export function tailAfter(wasHeld: boolean, held: boolean, now: number, tailUntil: number): number {
  if (held) return 0;
  return wasHeld ? now + FLOOR_TAIL_MS : tailUntil;
}

/** "Sam is talking to the DM" (or "You…", "The table…"); undefined when nobody holds the floor. */
export function floorLabel(floor: FloorView | null, players: { id: string; name: string }[], selfId?: string): string | undefined {
  const h = floor?.pushToTalk ? floor.holder : null;
  if (!h) return undefined;
  if ("room" in h) return "The table is talking to the DM";
  if (h.playerId === selfId) return "You are talking to the DM";
  const name = players.find((p) => p.id === h.playerId)?.name;
  return `${name ?? "Someone"} is talking to the DM`;
}

/** The push-to-talk key (Space), unless the user is typing in a field. */
export function isTalkKey(e: { key: string; code?: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; target: unknown }): boolean {
  if (e.code !== "Space" && e.key !== " ") return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return !isTypingTarget(e.target);
}

/** The key went to a text field (Space and page hotkeys like M must not fire while someone types). */
export function isTypingTarget(target: unknown): boolean {
  const t = target as { tagName?: string; isContentEditable?: boolean } | null;
  return !!t && (!!t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName ?? ""));
}

/**
 * The phone's hold-to-talk press (player/TalkButton.tsx): one `ptt` down per press and one up per
 * release, whatever pointer events repeat. Several inputs may share it (/play: the button and Space),
 * each under its own `source`: the down goes when the first one presses and the up only when the
 * last one lets go, so one input never ends another's press. `send` returns false when the socket
 * couldn't send.
 */
export class TalkPress {
  private readonly sources = new Set<string>();
  constructor(private readonly send: (down: boolean) => boolean) {}

  get pressed(): boolean {
    return this.sources.size > 0;
  }

  /** This input is holding the press. */
  holds(source = "default"): boolean {
    return this.sources.has(source);
  }

  /** True when this input started holding (the first one sends the down). */
  press(source = "default"): boolean {
    if (this.sources.has(source)) return false;
    if (this.sources.size === 0 && !this.send(true)) return false;
    this.sources.add(source);
    return true;
  }

  /** This input lets go; the up goes once no input holds the press. */
  release(source = "default") {
    if (!this.sources.delete(source)) return;
    if (this.sources.size === 0) this.send(false);
  }

  /** Every input lets go (the page blurs or unmounts). */
  releaseAll() {
    if (this.sources.size === 0) return;
    this.sources.clear();
    this.send(false);
  }

  /** Push-to-talk turned off hides the button mid-press (no pointerup comes): let go, so it works once it's back. */
  sync(pushToTalk: boolean) {
    if (!pushToTalk) this.releaseAll();
  }
}
