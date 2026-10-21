import { useEffect, useRef, useState } from "react";
import type { NpcFocusView } from "@dm/shared";
import { onCaption } from "../lib/talk";
import { applyCaption, captionVisible, clipLine, clipSpeaker, closeupSubject, shownText, voiceChanged, type CaptionLine } from "./caption";

/**
 * The NPC the DM is voicing (npc_focus / speak_as_npc): while it speaks, a large portrait slides
 * in with a name plate and subtitles (paced by caption.ts); between lines it shrinks to a docked
 * card until the DM clears the focus (or the server's idle timeout does). An AI player's line
 * (a clip with its own speaker) takes the close-up while it is up, then gives it back.
 */
export function NpcCloseup({ focus, dmSpeaking }: { focus: NpcFocusView | null; dmSpeaking: boolean }) {
  const [line, setLine] = useState<CaptionLine | null>(null);
  const [now, setNow] = useState(() => performance.now());
  const speaking = useRef(dmSpeaking);
  speaking.current = dmSpeaking;

  useEffect(
    () =>
      onCaption((c) => {
        const t = performance.now();
        setLine((prev) => {
          const next = applyCaption(prev, c, t);
          return c.clip ? clipLine(next, clipSpeaker(c)) : voiceChanged(next, speaking.current, t);
        });
      }),
    [],
  );
  useEffect(() => setLine((l) => voiceChanged(l, dmSpeaking, performance.now())), [dmSpeaking]);
  // A new NPC (or none) starts without the previous NPC's words.
  useEffect(() => setLine(null), [focus?.name]);

  const subject = closeupSubject(focus, line, now);
  const visible = !!subject && captionVisible(line, now);
  useEffect(() => {
    if (!line || !visible) return;
    const t = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(t);
  }, [line, visible]);

  if (!subject) return null;
  const text = line && visible ? shownText(line, now) : "";
  const talking = visible && (dmSpeaking || (!!line?.clip && line.endedAt !== undefined && now < line.endedAt));
  return (
    <div className={`npc-closeup ${visible ? "open" : "docked"} ${talking ? "talking" : ""} ${subject.pc ? "pc" : ""}`}>
      <div className="npc-portrait">{subject.portraitUrl ? <img src={subject.portraitUrl} alt="" /> : <span>{subject.name.trim().charAt(0).toUpperCase()}</span>}</div>
      <div className="npc-plate">{subject.name}</div>
      {visible && (
        <div className="npc-subtitle">
          <span>{text || "…"}</span>
        </div>
      )}
    </div>
  );
}
