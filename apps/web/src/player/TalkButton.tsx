import { useEffect, useMemo, useState } from "react";
import type { FloorView } from "@dm/shared";
import { floorLabel, TalkPress } from "../lib/floor";
import { sendToServer } from "../lib/useServer";

/**
 * Push-to-talk on a phone (and later the remote /play page): hold to talk to the DM. The press goes
 * over /ws as `ptt` for this seat; the server decides who holds the floor (first press wins) and
 * everyone sees it. Shown only while push-to-talk is on.
 */
export function TalkButton({ floor, playerId, players }: { floor: FloorView | null; playerId: string; players: { id: string; name: string }[] }) {
  const [pressed, setPressed] = useState(false);
  // One press per seat: a seat change lets go of the old seat's press (the cleanup below).
  const talk = useMemo(() => new TalkPress((down) => sendToServer({ type: "ptt", down, playerId })), [playerId]);
  const release = () => {
    talk.release();
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
  // Push-to-talk turned off mid-press: the button disappears without a pointerup, so let go here.
  const pushToTalk = !!floor?.pushToTalk;
  useEffect(() => {
    talk.sync(pushToTalk);
    setPressed(talk.pressed);
  }, [talk, pushToTalk]);

  if (!floor?.pushToTalk) return null;
  const holder = floor.holder;
  const mine = !!holder && "playerId" in holder && holder.playerId === playerId;
  const other = !!holder && !mine;
  const label = floorLabel(floor, players, playerId);
  return (
    <button
      className={`pl-talk ${mine ? "live" : ""} ${other ? "busy" : ""} ${pressed && !mine ? "pending" : ""}`}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        if (talk.press()) setPressed(true);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(e) => e.preventDefault()}
    >
      🎙 {mine ? "Talking to the DM… let go when done" : other ? label : "Hold to talk to the DM"}
    </button>
  );
}
