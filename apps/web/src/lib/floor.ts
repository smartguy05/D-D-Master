import { FLOOR_TAIL_MS, type FloorHolder, type FloorView } from "@dm/shared";

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
 * `localPress`: the TV's own Space is down and waiting for the floor. On a free floor the mic opens at
 * once rather than a server round trip later (the first syllable); the server still drops a turn that
 * no hold covered (a press it refused). Not while someone else holds it: that press will be refused.
 */
export function tableMicEnabled(o: { muted: boolean; floor: FloorView | null; tailUntil: number; now: number; localPress?: boolean }): boolean {
  if (o.muted) return false;
  if (o.localPress && o.floor?.pushToTalk && !o.floor.holder) return true;
  return roomHoldsFloor(o.floor) || !!o.floor?.enrolling || o.now < o.tailUntil;
}

/** The holder is warned for this long before the server's hold cap (FLOOR_MAX_HOLD_MS) lets go. */
export const HOLD_WARN_MS = 10_000;

/**
 * Whole seconds left on the current hold, only in its last HOLD_WARN_MS (undefined otherwise).
 * `receivedAt`: when this page got the floor (the server sends ms left, not a time: clocks differ).
 */
export function holdSecondsLeft(floor: FloorView | null, receivedAt: number, now: number): number | undefined {
  if (!floor?.pushToTalk || !floor.holder || floor.holdLeftMs === undefined) return undefined;
  const left = receivedAt + floor.holdLeftMs - now;
  if (left > HOLD_WARN_MS) return undefined;
  return Math.max(0, Math.ceil(left / 1000));
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

/** Longer than the server's press throttle (PTT_MIN_GAP_MS, 250 ms), which drops a down silently. */
export const TALK_RETRY_MS = 300;

export interface TalkPressOptions {
  /** The floor's holder is this press's own (its seat, or the room). Without it a refused press isn't retried. */
  mine?: (holder: FloorHolder) => boolean;
  /** The press started or ended, or was given the floor. */
  onChange?: () => void;
}

/**
 * A hold-to-talk press (the phone's and /play's seat button, the TV's Space, /host's room button):
 * one `ptt` down per press and one up per release, whatever pointer or key events repeat. Several
 * inputs may share it (/play: the button and Space), each under its own `source`: the down goes when
 * the first one presses and the up only when the last one lets go, so one input never ends another's
 * press. `send` returns false when the socket couldn't send.
 *
 * The server drops a down while someone else holds the floor (first press wins) or inside its press
 * throttle, rather than queueing it. Fed every floor update (`update`), a press with `mine` that hasn't
 * been given the floor sends its down again when the floor is free, then every TALK_RETRY_MS. Once it
 * has had the floor it never takes it back on its own: that would undo the server's 30 s cap (the hold
 * is then `expiredFor` that floor until the user lets go and presses again).
 */
export class TalkPress {
  private readonly sources = new Set<string>();
  private floor: FloorView | null = null;
  /** This press has held the floor since it started. */
  private granted = false;
  private lastDown = -Infinity;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly send: (down: boolean) => boolean,
    private readonly opts: TalkPressOptions = {},
  ) {}

  get pressed(): boolean {
    return this.sources.size > 0;
  }

  /** Pressed and not given the floor yet. */
  get waiting(): boolean {
    return this.pressed && !this.granted;
  }

  /** Still pressed after its hold ended without a release (the 30 s cap, or the host freed it), by this floor. */
  expiredFor(floor: FloorView | null): boolean {
    return this.pressed && this.granted && !this.isMine(floor);
  }

  /** This input is holding the press. */
  holds(source = "default"): boolean {
    return this.sources.has(source);
  }

  /** True when this input started holding (the first one sends the down). */
  press(source = "default"): boolean {
    if (this.sources.has(source)) return false;
    if (this.sources.size === 0) {
      if (!this.send(true)) return false;
      // Its own holder (the room, or its seat) may already have the floor: that hold is this press's too.
      this.granted = this.isMine(this.floor);
      this.lastDown = Date.now();
      this.schedule(TALK_RETRY_MS);
    }
    this.sources.add(source);
    if (this.sources.size === 1) this.opts.onChange?.();
    return true;
  }

  /** This input lets go; the up goes once no input holds the press. */
  release(source = "default") {
    if (!this.sources.delete(source)) return;
    if (this.sources.size === 0) this.end();
  }

  /** Every input lets go (the page blurs or unmounts). */
  releaseAll() {
    if (this.sources.size === 0) return;
    this.sources.clear();
    this.end();
  }

  /** Push-to-talk turned off hides the button mid-press (no pointerup comes): let go, so it works once it's back. */
  sync(pushToTalk: boolean) {
    if (!pushToTalk) this.releaseAll();
  }

  /** Each floor update from the server: push-to-talk off lets go; a refused press asks again once the floor is free. */
  update(floor: FloorView | null) {
    this.floor = floor;
    if (!floor?.pushToTalk) return this.releaseAll();
    if (this.pressed && !this.granted && this.isMine(floor)) {
      this.granted = true;
      this.opts.onChange?.();
    }
    this.retry();
  }

  private isMine(floor: FloorView | null): boolean {
    const h = floor?.holder;
    return !!h && !!this.opts.mine?.(h);
  }

  private end() {
    this.clear();
    this.send(false);
    this.opts.onChange?.();
  }

  private retry() {
    this.clear();
    if (!this.opts.mine || !this.waiting || !this.floor?.pushToTalk || this.floor.holder) return;
    const wait = this.lastDown + TALK_RETRY_MS - Date.now();
    if (wait > 0) return this.schedule(wait);
    this.lastDown = Date.now();
    this.send(true);
    this.schedule(TALK_RETRY_MS);
  }

  private schedule(ms: number) {
    this.clear();
    if (this.opts.mine) this.timer = setTimeout(() => this.retry(), ms);
  }

  private clear() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}

/** The room's floor (Space on the TV, /host's button): the room holds it, whoever pressed for it. */
export const roomIsMine = (h: FloorHolder): boolean => "room" in h;

/** A seat's floor (its phone, /play). */
export const seatIsMine =
  (playerId: string) =>
  (h: FloorHolder): boolean =>
    "playerId" in h && h.playerId === playerId;
