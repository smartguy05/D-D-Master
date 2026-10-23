import { useEffect, useState } from "react";
import type { Character, GameState, RosterEntry } from "@dm/shared";
import { api, del } from "../lib/api";
import { joinBlocked, rosterLabel, updatedAgo } from "./roster";

type Run = (fn: () => Promise<unknown>) => Promise<void>;

/** Fetches GET /api/roster; `version` changes (after a save/join/delete) trigger a refetch. */
export function useRoster(version: number, run: Run): RosterEntry[] {
  const [entries, setEntries] = useState<RosterEntry[]>([]);
  useEffect(() => {
    let live = true;
    run(async () => {
      const list = await api<RosterEntry[]>("/roster");
      if (live) setEntries(list);
    });
    return () => {
      live = false;
    };
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  return entries;
}

/**
 * "Bring an existing hero": the global roster (characters saved from any campaign, including ended
 * or deleted ones). Joining copies the hero into this campaign with a new id, links a player and
 * carries over the voiceprint and portrait. See docs/gameplay/character-roster.md.
 */
export function RosterPanel({ state, run, version, onChange }: { state: GameState; run: Run; version: number; onChange: () => void }) {
  const entries = useRoster(version, run);
  const [players, setPlayers] = useState<Record<string, string>>({});
  const now = Date.now();
  // Players free to take a hero: no character, or a link to a character that no longer exists.
  const free = state.players.filter((p) => !p.characterId || !state.characters.some((c: Character) => c.id === p.characterId));

  if (entries.length === 0)
    return <p className="muted">The roster is empty. Use “Save to roster” on a character (or end a campaign) to keep a hero for later campaigns.</p>;

  return (
    <div className="pregens roster">
      {entries.map((e) => {
        const blocked = joinBlocked(e.id, state);
        return (
          <div key={e.id} className="pregen roster-entry">
            <div className="row roster-head">
              {e.spriteUrl ? <img className="roster-portrait" src={e.spriteUrl} alt="" /> : <div className="roster-portrait initial">{e.name.slice(0, 1).toUpperCase()}</div>}
              <div className="grow">
                <b>{e.name}</b>
                <div className="muted">{rosterLabel(e)}</div>
                <div className="muted small">
                  {e.playerName ? `played by ${e.playerName}` : "no player"} · updated {updatedAgo(e.updatedAt, now)}
                  {e.campaignsPlayed ? ` · ${e.campaignsPlayed} campaign${e.campaignsPlayed === 1 ? "" : "s"}` : ""}
                </div>
                {blocked && <div className="muted small">{blocked}</div>}
              </div>
              <span className={`pill ${e.hasVoiceprint ? "ok" : ""}`} title={e.hasVoiceprint ? "The voice carries over: no need to record again" : "No voice recorded yet"}>
                {e.hasVoiceprint ? "🎙 voice" : "no voice"}
              </span>
            </div>
            <div className="row roster-actions">
              <select value={players[e.id] ?? ""} disabled={!!blocked} onChange={(ev) => setPlayers((m) => ({ ...m, [e.id]: ev.target.value }))}>
                <option value="">{e.playerName ? `Player: match “${e.playerName}” or add` : "Player: new"}</option>
                {free.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                className="primary small"
                disabled={!!blocked}
                title={blocked ?? `Copy ${e.name} into this campaign at full HP`}
                onClick={() =>
                  run(async () => {
                    await api(`/roster/${e.id}/join`, { playerId: players[e.id] || undefined });
                    onChange();
                  })
                }
              >
                Join campaign
              </button>
              <button
                className="danger small"
                onClick={() =>
                  confirm(`Delete ${e.name} from the roster? Campaign copies stay.`) &&
                  run(async () => {
                    await del(`/roster/${e.id}`);
                    onChange();
                  })
                }
              >
                Delete
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
