import { useRef, useState } from "react";
import type { Campaign } from "@dm/shared";
import { api } from "../lib/api";
import { redirectIfUnauthorized } from "../lib/auth";

type Run = (fn: () => Promise<unknown>) => Promise<void>;

/** Download a campaign as a single .dmc.json.gz file (state, voiceprints, maps and sprites). */
export function ExportButton({ id }: { id: string }) {
  return (
    <a className="button small" href={`/api/campaigns/${id}/export`} download title="Export campaign (.dmc.json.gz)">
      ⇩
    </a>
  );
}

/** Upload an exported file; the server creates a NEW campaign from it. */
export function ImportButton({ run, onImported }: { run: Run; onImported: (c: Campaign) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const upload = (file: File) =>
    run(async () => {
      setBusy(true);
      try {
        const res = await fetch("/api/campaigns/import", {
          method: "POST",
          headers: { "content-type": file.name.endsWith(".json") ? "application/json" : "application/gzip" },
          body: file,
        });
        redirectIfUnauthorized(res, "/api/campaigns/import");
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error ?? `${res.status} ${res.statusText}`);
        onImported(data as Campaign);
      } finally {
        setBusy(false);
        if (input.current) input.current.value = "";
      }
    });
  return (
    <>
      <button disabled={busy} onClick={() => input.current?.click()}>
        {busy ? "Importing…" : "⇧ Import campaign file"}
      </button>
      <input ref={input} type="file" accept=".gz,.json,application/gzip,application/json" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
    </>
  );
}

/** "Start over": choose what to keep, then wipe the rest (board, log, undo history, events). */
export function ResetPanel({ campaign, run, onDone }: { campaign: Campaign; run: Run; onDone: () => void }) {
  const [keep, setKeep] = useState({ keepOutline: true, keepPlayers: true, keepCharacters: true });
  const box = (key: keyof typeof keep, label: string) => (
    <label>
      <input type="checkbox" checked={keep[key]} onChange={(e) => setKeep({ ...keep, [key]: e.target.checked })} /> {label}
    </label>
  );
  const reset = () =>
    confirm(`Reset "${campaign.name}"? The board, log, session summaries and undo history are wiped. This cannot be undone.`) &&
    run(async () => (await api(`/campaigns/${campaign.id}/reset`, keep), onDone()));
  return (
    <div className="form reset-panel">
      <span className="muted">
        Start over. Export first (<ExportButton id={campaign.id} />) if you may want this state back. Keep:
      </span>
      {box("keepOutline", "outline & maps")}
      {box("keepPlayers", "players & voiceprints")}
      {box("keepCharacters", "characters (restored to full)")}
      <span className="row">
        <button className="danger" onClick={reset}>
          Reset
        </button>
        <button onClick={onDone}>Cancel</button>
      </span>
    </div>
  );
}
