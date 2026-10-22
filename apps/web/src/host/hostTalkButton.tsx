import { useEffect, useMemo, useState } from "react";
import type { FloorView } from "@dm/shared";
import { sendToServer } from "../lib/useServer";
import { useHoldCountdown } from "../lib/useHoldCountdown";
import { RoomTalk, roomTalkPointer, roomTalkView } from "./hostTalk";

/**
 * Hold to talk for the room from /host (the TV may have no keyboard for Space, and there may be no
 * phones). Shown only while push-to-talk is on; the server decides who holds the floor (first press wins,
 * and RoomTalk asks again when a refused press's floor comes free). The last seconds before the 30 s
 * cap count down; a press still held after it says to press again (it is never re-taken on its own).
 */
export function HostTalkButton({ floor, players }: { floor: FloorView | null; players: { id: string; name: string }[] }) {
  const [pressed, setPressed] = useState(false);
  const talk = useMemo(() => new RoomTalk(sendToServer, setPressed), []);
  const pointer = useMemo(() => roomTalkPointer(talk), [talk]);
  // Let go when the page hides or unmounts (a tab switch or a closed lid sends no pointerup).
  useEffect(() => talk.attach(document), [talk]);
  useEffect(() => talk.update(floor), [talk, floor]);
  const secondsLeft = useHoldCountdown(floor);

  const v = roomTalkView(floor, players, pressed, { secondsLeft, expired: talk.expiredFor(floor) });
  if (!v) return null;
  return (
    <button
      className={`big host-talk ${v.state}`}
      {...pointer}
      onContextMenu={(e) => e.preventDefault()}
      title="Hold to talk to the DM for the whole table (like Space on the TV). The DM only hears a voice turn while someone holds the floor."
    >
      🎙 {v.text}
    </button>
  );
}
