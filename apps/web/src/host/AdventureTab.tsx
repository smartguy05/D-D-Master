import { useEffect, useState } from "react";
import type { Campaign } from "@dm/shared";
import { api, del } from "../lib/api";
import type { ServerView } from "../lib/useServer";

type Run = (fn: () => Promise<unknown>) => Promise<void>;

export function AdventureTab({ view, run }: { view: ServerView; run: Run }) {
  const { campaign, state } = view;
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [name, setName] = useState("");
  const [level, setLevel] = useState(1);
  const [premise, setPremise] = useState("");
  const [length, setLength] = useState<"one-shot" | "short" | "campaign">("one-shot");
  const [busy, setBusy] = useState(false);

  const refresh = () => api<Campaign[]>("/campaigns").then(setCampaigns).catch(() => undefined);
  useEffect(() => {
    void refresh();
  }, [campaign?.id]);
  useEffect(() => {
    setPremise(campaign?.premise ?? "");
  }, [campaign?.id]);

  const outline = campaign?.outline;

  return (
    <div className="grid2">
      <section className="card">
        <h2>Campaigns</h2>
        <ul className="list">
          {campaigns.map((c) => (
            <li key={c.id} className={c.id === campaign?.id ? "current" : ""}>
              <span>
                <b>{c.name}</b> <span className="muted">lvl {c.partyLevel}</span>
              </span>
              <span className="row">
                {c.id !== campaign?.id && <button onClick={() => run(() => api(`/campaigns/${c.id}/load`, {}))}>Load</button>}
                <button
                  className="danger"
                  onClick={() => confirm(`Delete "${c.name}" forever?`) && run(async () => (await del(`/campaigns/${c.id}`), refresh()))}
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
          {campaigns.length === 0 && <li className="muted">No campaigns yet.</li>}
        </ul>
        <h3>New campaign</h3>
        <div className="form">
          <input placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
          <label>
            Party level <input type="number" min={1} max={20} value={level} onChange={(e) => setLevel(+e.target.value)} />
          </label>
          <button className="primary" onClick={() => run(async () => (await api("/campaigns", { name, partyLevel: level }), setName(""), refresh()))}>
            Create
          </button>
        </div>
      </section>

      {campaign && (
        <section className="card">
          <h2>Story</h2>
          <p className="muted">Give the AI a general idea. It writes the acts, locations (with maps), NPCs and encounters.</p>
          <textarea rows={4} placeholder="e.g. A haunted lighthouse on a stormy coast; smugglers, a drowned god, and a village that won't talk." value={premise} onChange={(e) => setPremise(e.target.value)} />
          <div className="row">
            <select value={length} onChange={(e) => setLength(e.target.value as typeof length)}>
              <option value="one-shot">One-shot (3-4 locations)</option>
              <option value="short">Short adventure (4-6)</option>
              <option value="campaign">Campaign arc (6-8)</option>
            </select>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  setBusy(true);
                  try {
                    await api("/campaign/outline", { premise, length });
                  } finally {
                    setBusy(false);
                  }
                })
              }
            >
              {busy ? "Writing…" : outline ? "Rewrite adventure" : "Write adventure"}
            </button>
          </div>
          {outline && (
            <div className="outline">
              <h3>{outline.title}</h3>
              <p>{outline.hook}</p>
              <ol>
                {outline.acts.map((a) => (
                  <li key={a.title}>
                    <b>{a.title}.</b> {a.summary}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
      )}

      {outline && (
        <section className="card span2">
          <h2>Locations</h2>
          <div className="locations">
            {outline.locations.map((l) => (
              <div key={l.id} className={`location ${state?.locationId === l.id ? "current" : ""}`}>
                {l.mapUrl ? <img src={l.mapUrl} alt={l.name} /> : <div className="map-placeholder">no map yet</div>}
                <div className="loc-body">
                  <b>{l.name}</b> <span className="muted">{l.gridW}×{l.gridH}</span>
                  <p>{l.description}</p>
                  <div className="row">
                    <button onClick={() => run(() => api("/tools/change_scene", { location_id: l.id }))}>{state?.locationId === l.id ? "Reset party here" : "Go here"}</button>
                    <button onClick={() => run(() => api("/campaign/map", { locationId: l.id, force: !!l.mapUrl }))}>{l.mapUrl ? "Repaint map" : "Paint map"}</button>
                  </div>
                  {outline.encounters
                    .filter((e) => e.locationId === l.id)
                    .map((e) => (
                      <div key={e.id} className="encounter">
                        ⚔ {e.description}{" "}
                        <button
                          className="small"
                          onClick={() =>
                            run(async () => {
                              for (const m of e.monsters) await api("/tools/spawn_monster", { name: m.name, count: m.count });
                            })
                          }
                        >
                          Spawn {e.monsters.map((m) => `${m.count}× ${m.name}`).join(", ")}
                        </button>
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
          <h2>NPCs</h2>
          <ul className="npcs">
            {outline.npcs.map((n) => (
              <li key={n.name}>
                <b>{n.name}</b> — {n.description} <i>Wants: {n.motive}</i>
              </li>
            ))}
          </ul>
        </section>
      )}

      {campaign && (
        <section className="card span2">
          <h2>Sessions</h2>
          <p className="muted">Ending a session writes a "previously on…" recap the DM reads at the start of the next one.</p>
          <button
            onClick={() =>
              confirm("End the session and write a recap? The DM will disconnect.") &&
              run(() => api("/campaign/end-session", {}))
            }
          >
            End session & write recap
          </button>
          {campaign.sessionSummaries
            .slice()
            .reverse()
            .map((s) => (
              <details key={s.ts} className="recap">
                <summary>{new Date(s.ts).toLocaleString()}</summary>
                <pre>{s.summary}</pre>
              </details>
            ))}
        </section>
      )}
    </div>
  );
}
