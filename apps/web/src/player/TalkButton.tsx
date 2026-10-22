import { useEffect, useRef, useState } from "react";
import type { FloorView } from "@dm/shared";
import { floorLabel } from "../lib/floor";
import { sendToServer } from "../lib/useServer";

/**
 * Push-to-talk on a phone (and later the remote /play page): hold to talk to the DM. The press goes
 * over /ws as `ptt` for this seat; the server decides who holds the floor (first press wins) and
 * everyone sees it. Shown only while push-to-talk is on.
 */
export function TalkButton({ floor, playerId, players }: { floor: FloorView | null; playerId: string; players: { id: string; name: string }[] }) {
  const [pressed, setPressed] = useState(false);
  const down = useRef(false);
  const release = () => {
    if (!down.current) return;
    down.current = false;
    setPressed(false);
    sendToServer({ type: "ptt", down: false, playerId });
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
  }, [playerId]);

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
        if (down.current) return;
        down.current = sendToServer({ type: "ptt", down: true, playerId });
        setPressed(down.current);
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
