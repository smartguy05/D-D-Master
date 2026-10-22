import { useEffect, useRef, useState } from "react";
import { SAY_MAX, type CreationView } from "@dm/shared";
import type { Creation } from "./useCreation";

const STARTERS = ["I want to play a sneaky elf who picks locks", "A big friendly fighter with a shield", "Surprise me: something magical", "What class is good for a first game?"];

/** Talk the character through with the AI helper; it fills the same draft the Build tab edits. */
export function ChatTab({ creation, view, onBuild }: { playerId: string; creation: Creation; view: CreationView; onBuild: () => void }) {
  const [text, setText] = useState("");
  const d = view.draft;
  const end = useRef<HTMLDivElement>(null);
  // Braces: scrollIntoView returns a Promise in newer browsers, and an effect may only return a cleanup.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [d.chat.length, d.chatBusy]);
  const send = async (line = text) => {
    const t = line.trim();
    if (!t) return;
    setText("");
    await creation.act("/chat", { text: t });
  };
  return (
    <section className="pl-card cr-chat">
      <div className="cr-chat-log">
        {d.chat.length === 0 && (
          <>
            <p className="muted">Tell the helper what you'd like to play: a feeling, a hero from a book, or just "surprise me". It follows the rules for level {view.level} and fills in the sheet as you go.</p>
            <div className="chips">
              {STARTERS.map((s) => (
                <button key={s} className="chip" onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          </>
        )}
        {d.chat.map((t, i) => (
          <div key={i} className={`cr-msg ${t.role}`}>{t.text}</div>
        ))}
        {d.chatBusy && <div className="cr-msg ai typing">…</div>}
        <div ref={end} />
      </div>
      <form
        className="cr-chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          rows={2}
          maxLength={SAY_MAX}
          placeholder={d.chatBusy ? "The helper is thinking…" : "Type to the helper"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button className="primary" disabled={d.chatBusy || creation.busy || !text.trim()}>Send</button>
      </form>
      <div className="row small">
        {d.portraitBusy && <span className="muted">🎨 Drawing your portrait…</span>}
        <span className="grow" />
        <button className="small" onClick={onBuild}>Fine-tune in Build →</button>
      </div>
    </section>
  );
}
