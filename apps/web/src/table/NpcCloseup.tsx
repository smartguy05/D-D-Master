import { useEffect, useRef, useState } from "react";
import type { NpcFocusView } from "@dm/shared";
import { onCaption } from "../lib/talk";
import { applyCaption, captionVisible, clipLine, shownText, voiceChanged, type CaptionLine } from "./caption";

/**
 * The NPC the DM is voicing (npc_focus / speak_as_npc): while it speaks, a large portrait slides
 * in with a name plate and subtitles (paced by caption.ts); between lines it shrinks to a docked
 * card until the DM clears the focus (or the server's idle timeout does).
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
          return c.clip ? clipLine(next) : voiceChanged(next, speaking.current, t);
        });
      }),
    [],
  );
  useEffect(() => setLine((l) => voiceChanged(l, dmSpeaking, performance.now())), [dmSpeaking]);
  // A new NPC (or none) starts without the previous NPC's words.
  useEffect(() => setLine(null), [focus?.name]);

  const visible = !!focus && captionVisible(line, now);
  useEffect(() => {
    if (!line || !focus) return;
    const t = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(t);
  }, [line, focus]);

  if (!focus) return null;
  const text = line && visible ? shownText(line, now) : "";
  const talking = visible && (dmSpeaking || (!!line?.clip && line.endedAt !== undefined && now < line.endedAt));
  return (
    <div className={`npc-closeup ${visible ? "open" : "docked"} ${talking ? "talking" : ""}`}>
      <div className="npc-portrait">{focus.portraitUrl ? <img src={focus.portraitUrl} alt="" /> : <span>{focus.name.trim().charAt(0).toUpperCase()}</span>}</div>
      <div className="npc-plate">{focus.name}</div>
      {visible && (
        <div className="npc-subtitle">
          <span>{text || "…"}</span>
        </div>
      )}
    </div>
  );
}
