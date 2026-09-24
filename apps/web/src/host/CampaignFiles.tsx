import { useRef, useState } from "react";
import type { Campaign } from "@dm/shared";

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
