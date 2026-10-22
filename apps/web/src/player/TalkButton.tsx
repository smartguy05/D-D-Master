import { useEffect, useMemo, useState } from "react";
import type { FloorView } from "@dm/shared";
import { floorLabel, seatIsMine, TalkPress } from "../lib/floor";
import { sendToServer } from "../lib/useServer";
import { useHoldCountdown } from "../lib/useHoldCountdown";

/**
 * A seat's push-to-talk press over /ws (one per seat; /play shares it between the button and Space).
 * Fed the floor (`update`), a press the server refused (someone else held it, or its throttle) asks
 * again once the floor is free; one that was given the floor is never re-taken after the 30 s cap.
 */
export function seatTalkPress(playerId: string): TalkPress {
  return new TalkPress((down) => sendToServer({ type: "ptt", down, playerId }), { mine: seatIsMine(playerId) });
}

/**
 * Push-to-talk on a phone and on the remote /play page: hold to talk to the DM. The press goes
 * over /ws as `ptt` for this seat; the server decides who holds the floor (first press wins) and
 * everyone sees it. Shown only while push-to-talk is on. `press`: a TalkPress the page shares with
 * its Space key (/play), so the two send one down and one up between them; default: its own. In the
 * last seconds before the server's 30 s cap it counts down; held past it, it says to press again.
 */
export function TalkButton({ floor, playerId, players, press }: { floor: FloorView | null; playerId: string; players: { id: string; name: string }[]; press?: TalkPress }) {
  const [pressed, setPressed] = useState(false);
  // One press per seat: a seat change lets go of the old seat's press (the cleanup below).
  const own = useMemo(() => (press ? undefined : seatTalkPress(playerId)), [playerId, press]);
  const talk = press ?? own!;
  // The pointer's own share of the press: Space on /play holds it under "key" and keeps holding.
  const release = () => {
    talk.release("pointer");
    setPressed(false);
  };
  // Let go when the page hides or unmounts (a phone locked mid-press never sends pointerup).
  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && release();
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [talk]);
  // Every floor update: push-to-talk turned off mid-press (the button disappears without a pointerup)
  // lets go; a refused press asks again once the floor is free.
  useEffect(() => {
    talk.update(floor);
    setPressed(talk.holds("pointer"));
  }, [talk, floor]);
  const secondsLeft = useHoldCountdown(floor);

  if (!floor?.pushToTalk) return null;
  const holder = floor.holder;
  const mine = !!holder && "playerId" in holder && holder.playerId === playerId;
  const other = !!holder && !mine;
  const label = floorLabel(floor, players, playerId);
  // Still held after the cap ended this seat's hold (Space on /play counts too).
  const expired = talk.expiredFor(floor);
  const left = mine && secondsLeft !== undefined ? ` (${secondsLeft} s left)` : "";
  const text = expired ? "Time's up: let go and press again" : mine ? `Talking to the DM… let go when done${left}` : other ? label : "Hold to talk to the DM";
  return (
    <button
      className={`pl-talk ${mine ? "live" : ""} ${other && !expired ? "busy" : ""} ${pressed && !mine && !expired ? "pending" : ""} ${expired ? "expired" : ""}`}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        if (talk.press("pointer")) setPressed(true);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(e) => e.preventDefault()}
    >
      🎙 {text}
    </button>
  );
}
