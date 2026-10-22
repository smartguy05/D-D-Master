import type { FloorView } from "@dm/shared";
import { floorLabel, roomIsMine, TALK_RETRY_MS, TalkPress } from "../lib/floor";

/**
 * The host's hold-to-talk button for the room (PlayTab). With push-to-talk on, the DM only hears a
 * voice turn while someone holds the floor; a TV without a keyboard and no phones would otherwise drop
 * every turn. The press goes over /ws as a `ptt` with no seat, which the server takes as the room.
 */

export type RoomTalkState = "idle" | "live" | "busy" | "pending" | "expired";

/**
 * What the button shows, or null when it is hidden (push-to-talk off or not known yet). live: the room
 * holds the floor (this press or Space on the TV), with the seconds left in the last ones before the
 * server's 30 s cap; busy: a player holds it; pending: pressed but the server hasn't given the room the
 * floor yet; expired: still pressed after the cap ended the room's hold.
 */
export function roomTalkView(
  floor: FloorView | null,
  players: { id: string; name: string }[],
  pressed: boolean,
  hold: { secondsLeft?: number; expired?: boolean } = {},
): { state: RoomTalkState; text: string } | null {
  if (!floor?.pushToTalk) return null;
  const h = floor.holder;
  const left = hold.secondsLeft !== undefined ? ` (${hold.secondsLeft} s left)` : "";
  if (h && "room" in h) return { state: "live", text: (pressed ? "Talking to the DM… let go when done" : "The table is talking to the DM") + left };
  if (pressed && hold.expired) return { state: "expired", text: "Time's up: let go and press again" };
  if (h) return { state: "busy", text: floorLabel(floor, players) ?? "Someone is talking to the DM" };
  return pressed ? { state: "pending", text: "Waiting for the floor…" } : { state: "idle", text: "Hold to talk (room)" };
}

/** Longer than the server's press throttle (PTT_MIN_GAP_MS, 250 ms), which drops a down silently. */
export const ROOM_TALK_RETRY_MS = TALK_RETRY_MS;

type Ptt = { type: "ptt"; down: boolean };
type VisibilityDoc = Pick<EventTarget, "addEventListener" | "removeEventListener"> & { visibilityState: DocumentVisibilityState };

/**
 * The room's press: one `ptt` down and one up per hold, with no playerId (the server reads that as
 * the room). A lib/floor.ts TalkPress for the room: while the button is held and the room hasn't been
 * given the floor, the down is sent again when the floor is free; once the room has had it (this
 * press, or Space on the TV), it is never taken back on its own: that would undo the server's 30 s cap.
 */
export class RoomTalk {
  private readonly talk: TalkPress;

  constructor(
    private readonly send: (ev: Ptt) => boolean,
    private readonly onChange: (pressed: boolean) => void = () => undefined,
  ) {
    this.talk = new TalkPress((down) => this.send({ type: "ptt", down }), { mine: roomIsMine, onChange: () => this.onChange(this.pressed) });
  }

  get pressed(): boolean {
    return this.talk.holds("pointer");
  }

  /** Still held after the room's hold ended without a release (the cap), by this floor. */
  expiredFor(floor: FloorView | null): boolean {
    return this.talk.expiredFor(floor);
  }

  down(): boolean {
    return this.talk.press("pointer");
  }

  up() {
    this.talk.release("pointer");
  }

  /** Each floor update from the server. Push-to-talk turned off mid-press hides the button with no pointerup: let go. */
  update(floor: FloorView | null) {
    this.talk.update(floor);
  }

  /** Let go when the page hides (a tab switch or a closed lid sends no pointerup); the returned detach lets go too (unmount). */
  attach(doc: VisibilityDoc): () => void {
    const onHide = () => doc.visibilityState === "hidden" && this.up();
    doc.addEventListener("visibilitychange", onHide);
    return () => {
      doc.removeEventListener("visibilitychange", onHide);
      this.up();
    };
  }
}

type PointerLike = { button: number; pointerId: number; preventDefault(): void; currentTarget: { setPointerCapture?(id: number): void } };

/** The button's pointer handlers: hold on a primary press; every way the pointer can go away lets go. */
export function roomTalkPointer(talk: RoomTalk) {
  const release = () => talk.up();
  return {
    onPointerDown(e: PointerLike) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      talk.down();
    },
    onPointerUp: release,
    onPointerCancel: release,
    onPointerLeave: release,
    onLostPointerCapture: release,
  };
}
