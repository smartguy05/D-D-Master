import { useEffect, useState } from "react";
import type { Campaign } from "@dm/shared";
import { api, del, patch } from "../lib/api";
import type { ServerView } from "../lib/useServer";
import { ExportButton, ImportButton, ResetPanel } from "./CampaignFiles";
import { fogStatus } from "./fogStatus";
import { OutlineEditor } from "./OutlineEditor";
import { PartySpotlight } from "./PartySpotlight";
import { PortraitView } from "../lib/PortraitView";

type Run = (fn: () => Promise<unknown>) => Promise<void>;
type DeathRule = Campaign["deathRule"];

/** When character deaths end the campaign in failure (the server ends it by itself). */
function DeathRuleSelect({ value, onChange }: { value: DeathRule; onChange: (v: DeathRule) => void }) {
  return (
    <label title="A campaign that ends on a party wipe lets the table revive a fallen character">
      Campaign fails when{" "}
      <select value={value} onChange={(e) => onChange(e.target.value as DeathRule)}>
        <option value="party_wipe">the whole party is dead</option>
        <option value="any_death">any character dies</option>
      </select>
    </label>
  );
}

export function AdventureTab({ view, run }: { view: ServerView; run: Run }) {
  const { campaign, state } = view;
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [name, setName] = useState("");
  const [level, setLevel] = useState(1);
  const [deathRule, setDeathRule] = useState<DeathRule>("party_wipe");
  const [premise, setPremise] = useState("");
  const [length, setLength] = useState<"one-shot" | "short" | "campaign">("one-shot");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [paintingIds, setPaintingIds] = useState<Set<string>>(new Set());
  const [mapView, setMapView] = useState<{ id: string; previous?: boolean } | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);

  const refresh = () => api<Campaign[]>("/campaigns").then(setCampaigns).catch(() => undefined);
  useEffect(() => {
    void refresh();
  }, [campaign?.id]);
  useEffect(() => {
    setPremise(campaign?.premise ?? "");
    setEditing(false);
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
                <ExportButton id={c.id} />
                <button className="small" title="Reset (start over)" onClick={() => setResettingId(resettingId === c.id ? null : c.id)}>
                  ↺
                </button>
                {c.id !== campaign?.id && <button onClick={() => run(() => api(`/campaigns/${c.id}/load`, {}))}>Load</button>}
                <button
                  className="danger"
                  onClick={() => confirm(`Delete "${c.name}" forever?`) && run(async () => (await del(`/campaigns/${c.id}`), refresh()))}
                >
                  ✕
                </button>
              </span>
              {resettingId === c.id && <ResetPanel campaign={c} run={run} onDone={() => (setResettingId(null), void refresh())} />}
            </li>
          ))}
          {campaigns.length === 0 && <li className="muted">No campaigns yet.</li>}
        </ul>
        <ImportButton run={run} onImported={() => void refresh()} />
        {campaign && (
          <div className="form">
            <span className="muted">{campaign.name}:</span>
            <DeathRuleSelect value={campaign.deathRule ?? "party_wipe"} onChange={(v) => run(() => patch("/campaign/settings", { deathRule: v }))} />
          </div>
        )}
        <h3>New campaign</h3>
        <div className="form">
          <input placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
          <label>
            Party level <input type="number" min={1} max={20} value={level} onChange={(e) => setLevel(+e.target.value)} />
          </label>
          <DeathRuleSelect value={deathRule} onChange={setDeathRule} />
          <button className="primary" onClick={() => run(async () => (await api("/campaigns", { name, partyLevel: level, deathRule }), setName(""), refresh()))}>
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
            <button disabled={editing} onClick={() => setEditing(true)}>
              ✎ {outline ? "Edit outline" : "Write outline by hand"}
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

      {campaign && editing && (
        <section className="card span2">
          <h2>Edit outline</h2>
          <OutlineEditor key={campaign.id} outline={outline} fallbackTitle={campaign.name} run={run} onClose={() => setEditing(false)} />
        </section>
      )}

      {campaign && state && <PartySpotlight campaign={campaign} state={state} run={run} />}

      {outline && (
        <section className="card span2">
          <h2>Locations</h2>
          <div className="locations">
            {outline.locations.map((l) => {
              // A paint runs from the button or on its own (new outline, scene change): either way, wait for it.
              const painting = paintingIds.has(l.id) || view.jobs.some((j) => j.status === "running" && j.label === `Painting map: ${l.name}`);
              const choose = (keep: "new" | "previous") => run(() => api("/campaign/map/choose", { locationId: l.id, keep }));
              return (
                <div key={l.id} className={`location ${state?.locationId === l.id ? "current" : ""}`}>
                  {l.mapUrl ? (
                    <img
                      src={l.mapUrl}
                      alt={l.name}
                      role="button"
                      tabIndex={0}
                      title="View full screen"
                      onClick={() => setMapView({ id: l.id })}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setMapView({ id: l.id }))}
                    />
                  ) : (
                    <div className="map-placeholder">no map yet</div>
                  )}
                  <div className="loc-body">
                    <b>{l.name}</b> <span className="muted">{l.gridW}×{l.gridH}</span>{" "}
                    {(() => {
                      const f = fogStatus(l, state?.fog?.[l.id]);
                      return (
                        <span className={`pill fog-pill ${f.on ? "on" : ""}`} title="Fog of war on the TV. Change it in Edit outline (first visit) or the Board tab (current location).">
                          ☁ {f.label}
                        </span>
                      );
                    })()}
                    <p>{l.description}</p>
                    <div className="row">
                      <button onClick={() => run(() => api("/tools/change_scene", { location_id: l.id }))}>
                        {state?.locationId === l.id && !Object.keys(state.scenes ?? {}).length ? "Reset party here" : Object.keys(state?.scenes ?? {}).length ? "Regroup here" : "Go here"}
                      </button>
                      <button
                        disabled={painting}
                        onClick={() =>
                          run(async () => {
                            setPaintingIds((p) => new Set(p).add(l.id));
                            try {
                              await api("/campaign/map", { locationId: l.id, force: !!l.mapUrl });
                            } finally {
                              setPaintingIds((p) => (p.delete(l.id), new Set(p)));
                            }
                          })
                        }
                      >
                        {painting ? "Painting…" : l.mapUrl ? "Repaint map" : "Paint map"}
                      </button>
                    </div>
                    {l.previousMap && (
                      <div className="map-choice">
                        <img
                          src={l.previousMap.mapUrl}
                          alt={`${l.name} (previous map)`}
                          role="button"
                          tabIndex={0}
                          title="View the previous map full screen"
                          onClick={() => setMapView({ id: l.id, previous: true })}
                          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setMapView({ id: l.id, previous: true }))}
                        />
                        <div>
                          <span className="muted">New map painted. Keep it, or go back to the previous one (left)?</span>
                          <div className="row">
                            <button className="small" disabled={painting} onClick={() => choose("new")}>
                              Keep new
                            </button>
                            <button
                              className="small"
                              disabled={painting}
                              title="Brings back the previous map with its feature fixes and fog. If the party is here, it is moved back to the entrance."
                              onClick={() => choose("previous")}
                            >
                              Restore previous
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
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
              );
            })}
          </div>
          {(() => {
            // By id, so a repaint while it's open shows the new map.
            const loc = outline.locations.find((l) => l.id === mapView?.id);
            const src = mapView?.previous ? loc?.previousMap?.mapUrl : loc?.mapUrl;
            if (!loc || !src) return null;
            const name = mapView?.previous ? `${loc.name} (previous map)` : loc.name;
            return <PortraitView wide name={name} src={src} appearance={loc.description} label={`${name} map`} onClose={() => setMapView(null)} />;
          })()}
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
