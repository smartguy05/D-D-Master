import { useState } from "react";
import type { Creation } from "./useCreation";
import { BuildForm } from "./BuildForm";
import { ChatTab } from "./ChatTab";
import { DraftPreview } from "./DraftPreview";
import { SavedTab } from "./SavedTab";
import { actionFor } from "./view";
import "./creation.css";

type Tab = "chat" | "build" | "saved";

/**
 * Phone character creation: chat with the AI helper, build by hand, or bring a saved hero. Chat
 * and Build edit the same draft; the preview and the rule check come from the server.
 */
export function CreatePanel({ playerId, creation, editing = false, onClose }: { playerId: string; creation: Creation; editing?: boolean; onClose?: () => void }) {
  const { view, options } = creation;
  const [tab, setTab] = useState<Tab>(view?.draft.chat.length || !view?.draft.choices.name ? "chat" : "build");
  const [note, setNote] = useState("");
  if (!view) return <p className="muted pl-card">{creation.error ?? "Loading…"}</p>;
  const d = view.draft;
  const action = actionFor(view);
  const errors = view.validation.errors;
  return (
    <div className="cr-panel">
      <div className="cr-title">
        <h2>{editing ? "Edit your character" : "Create your character"}</h2>
        <span className="muted small">Level {view.level}</span>
        <span className="grow" />
        {onClose && <button className="small" onClick={onClose}>Done</button>}
      </div>
      {d.status === "pending" && <div className="cr-banner">⏳ Waiting for the host to approve {d.choices.name ?? "your character"}.</div>}
      {d.status === "returned" && <div className="cr-banner bad">↩ The host sent it back{d.hostMessage ? `: "${d.hostMessage}"` : "."} Make changes, then try again.</div>}
      {creation.error && <div className="pl-error" onClick={() => creation.setError(null)}>{creation.error}</div>}

      {!editing && (
        <div className="pl-toggle cr-tabs">
          <button className={tab === "chat" ? "active" : ""} onClick={() => setTab("chat")}>💬 Chat</button>
          <button className={tab === "build" ? "active" : ""} onClick={() => setTab("build")}>🛠 Build</button>
          <button className={tab === "saved" ? "active" : ""} onClick={() => setTab("saved")}>📚 Saved</button>
        </div>
      )}

      {tab === "saved" && !editing ? (
        <SavedTab playerId={playerId} level={view.level} />
      ) : (
        <div className="cr-work">
          <div className="cr-main">
            {tab === "chat" && !editing ? (
              <ChatTab playerId={playerId} creation={creation} view={view} onBuild={() => setTab("build")} />
            ) : options ? (
              <BuildForm creation={creation} view={view} options={options} />
            ) : (
              <p className="muted">Loading the rules…</p>
            )}
          </div>
          <div className="cr-side">
            <DraftPreview ch={view.preview} portraitUrl={d.portraitUrl} level={view.level} />
            <section className="pl-card cr-actions">
              {errors.length > 0 ? (
                <details>
                  <summary>⚠ {errors.length} thing{errors.length === 1 ? "" : "s"} to fix</summary>
                  <ul className="cr-issues">{errors.map((e, i) => <li key={i} className="error">{e.message}</li>)}</ul>
                </details>
              ) : view.preview ? (
                <p className="ok">✓ Follows the rules.</p>
              ) : null}
              {action.kind === "submit" && (
                <input placeholder="Note for the host (why it's okay)" value={note} onChange={(e) => setNote(e.target.value)} />
              )}
              {action.kind !== "none" && (
                <button
                  className="primary pl-wide big"
                  disabled={creation.busy || d.chatBusy}
                  onClick={() => creation.act(action.kind === "join" ? "/join" : action.kind === "submit" ? "/submit" : "/withdraw", action.kind === "submit" ? { note } : {})}
                >
                  {action.label}
                </button>
              )}
              {d.status !== "pending" && d.status !== "joined" && (Object.keys(d.choices).length > 0 || d.chat.length > 0) && (
                <button className="small danger" onClick={() => confirm("Start over? Your draft and chat are deleted.") && creation.reset()}>Start over</button>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
