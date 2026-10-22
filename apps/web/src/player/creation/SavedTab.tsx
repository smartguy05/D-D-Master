import { useEffect, useState } from "react";
import type { RosterEntry } from "@dm/shared";
import { api } from "../../lib/api";

type Entry = RosterEntry & { mine: boolean; levelMismatch: boolean; inCampaign: boolean };

/** Bring a hero from the global roster (other campaigns): the player's own first. */
export function SavedTab({ playerId, level }: { playerId: string; level: number }) {
  const [roster, setRoster] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    api<{ roster: Entry[] }>(`/players/${playerId}/roster`)
      .then((r) => setRoster(r.roster))
      .catch((e) => setError((e as Error).message));
  }, [playerId]);
  const join = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      await api(`/players/${playerId}/roster/${id}/join`, {});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  if (error) return <div className="pl-error" onClick={() => setError(null)}>{error}</div>;
  if (!roster) return <p className="muted">Loading saved characters…</p>;
  if (!roster.length) return <p className="muted pl-card">No saved characters yet. Build one, and it's saved for your next campaign.</p>;
  return (
    <div className="pl-pick">
      {roster.map((r) => (
        <div key={r.id} className={`pl-pick-btn cr-saved ${r.mine ? "last" : ""}`}>
          {r.spriteUrl ? <img src={r.spriteUrl} alt="" /> : <span className="pc-dot" />}
          <span className="grow">
            <b>{r.name}</b>
            <span className="muted small">
              {r.species} {r.className}{r.subclass ? ` (${r.subclass})` : ""} {r.level}
              {r.playerName ? ` · ${r.playerName}` : ""}
            </span>
            {r.mine && <span className="chip">yours</span>}
            {r.levelMismatch && <span className="small hint">This campaign starts at level {level}; ask the host to adjust.</span>}
          </span>
          {r.inCampaign ? <span className="muted small">In this campaign</span> : <button className="primary" disabled={!!busy} onClick={() => join(r.id)}>{busy === r.id ? "…" : "Play"}</button>}
        </div>
      ))}
    </div>
  );
}
