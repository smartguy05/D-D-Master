import type { Campaign, GameState } from "@dm/shared";
import { api } from "../lib/api";
import { characterPlaces, spotlightRows } from "./partyGroups";

type Run = (fn: () => Promise<unknown>) => Promise<void>;

/**
 * Party split controls: where each group is, which one the TV shows (Focus = focus_scene), and a
 * per-PC "send to" that splits or regroups the party (change_scene with character_ids).
 */
export function PartySpotlight({ campaign, state, run, compact }: { campaign: Campaign; state: GameState; run: Run; compact?: boolean }) {
  const locations = campaign.outline?.locations ?? [];
  if (!state.locationId || !locations.length || !state.characters.length) return null;
  const rows = spotlightRows(state, locations);
  return (
    <section className={`card spotlight ${compact ? "" : "span2"}`}>
      <h2>Party &amp; spotlight</h2>
      {!compact && <p className="muted">The TV shows the group in focus. Send a character elsewhere to split the party; send them to another group's location to regroup.</p>}
      <ul className="list">
        {rows.map((g) => (
          <li key={g.locationId} className={g.focused ? "current" : ""}>
            <span>
              {g.focused ? "★ " : ""}
              <b>{g.name}</b> <span className="muted">{g.members}</span> {g.fight && <span className="pill">{g.fight}</span>}
            </span>
            {g.focused ? (
              <span className="pill ok">on the TV</span>
            ) : (
              <button onClick={() => run(() => api("/tools/focus_scene", { location_id: g.locationId }))}>Focus</button>
            )}
          </li>
        ))}
      </ul>
      <div className="row wrap">
        {characterPlaces(state).map((c) => (
          <label key={c.id}>
            {c.name} at{" "}
            <select
              value={c.locationId ?? ""}
              onChange={(e) => run(() => api("/tools/change_scene", { location_id: e.target.value, character_ids: [c.id] }))}
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </section>
  );
}
