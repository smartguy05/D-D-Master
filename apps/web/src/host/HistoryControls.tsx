import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Run = (fn: () => Promise<unknown>) => Promise<void>;

interface HistoryEntry {
  id: number;
  version: number;
  ts: number;
  label: string;
}

/** "Undo last action" + a dropdown to rewind to before any of the last 50 changes. */
export function HistoryControls({ version, run }: { version: number; run: Run }) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    api<HistoryEntry[]>("/history").then(setEntries).catch(() => setEntries([]));
  }, [version]);

  const last = entries[0];
  return (
    <div className="row wrap history">
      <button disabled={!last} title={last ? `Undo: ${last.label}` : "Nothing to undo"} onClick={() => run(() => api("/history/undo", {}))}>
        ↶ Undo{last ? `: ${last.label}` : ""}
      </button>
      <select
        value=""
        disabled={!entries.length}
        onChange={(e) => {
          const entry = entries.find((x) => x.version === Number(e.target.value));
          if (entry && confirm(`Rewind to before "${entry.label}"? That change and everything after it are undone.`))
            void run(() => api("/history/restore", { version: entry.version }));
        }}
      >
        <option value="">History ({entries.length})…</option>
        {entries.map((h) => (
          <option key={h.id} value={h.version}>
            {new Date(h.ts).toLocaleTimeString()} · before {h.label}
          </option>
        ))}
      </select>
    </div>
  );
}
