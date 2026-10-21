import { useState } from "react";
import type { GameState, Location } from "@dm/shared";
import { playerMapPlan, viewWindow } from "./playerMap";

/**
 * View-only top-down map of the player's own location (their group's scene when the party is
 * split), drawn like the host Board: picture, fog, doors, loot, tokens. Tap a token for its name.
 */
export function PlayerMap({ state, locations, characterId }: { state: GameState; locations: Location[]; characterId: string }) {
  const [zoom, setZoom] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const plan = playerMapPlan(state, locations, characterId);
  if (!plan) return null;
  const win = viewWindow(plan, zoom);
  const pickedName = plan.tokens.find((t) => t.id === picked)?.name;
  return (
    <section className="pl-card pl-map-card">
      <div className="row">
        <h2 className="grow">Map</h2>
        {plan.me && (
          <button className={`small ${zoom ? "active" : ""}`} onClick={() => setZoom(!zoom)}>
            {zoom ? "Whole map" : "Zoom to me"}
          </button>
        )}
      </div>
      <svg className="pl-map" viewBox={`${win.x} ${win.y} ${win.w} ${win.h}`} style={{ aspectRatio: `${win.w} / ${win.h}` }} onClick={() => setPicked(null)}>
        <rect x={0} y={0} width={plan.gridW} height={plan.gridH} fill="#0e0a08" />
        {plan.mapUrl && <image href={plan.mapUrl} x={0} y={0} width={plan.gridW} height={plan.gridH} preserveAspectRatio="none" />}
        {plan.auras.map((a) => (
          <rect key={a.key} className="pl-map-aura" x={a.x} y={a.y} width={a.w} height={a.h} rx={0.2} />
        ))}
        {plan.loot.map((o) => (
          <text key={o.id} x={o.x + 0.5} y={o.y + 0.7} textAnchor="middle" fontSize={0.7}>
            💰
          </text>
        ))}
        {plan.fog && (
          <g className="pl-map-fog">
            {plan.fog.map((c) => (
              <rect key={`${c.x},${c.y}`} x={c.x} y={c.y} width={1.02} height={1.02} />
            ))}
          </g>
        )}
        {plan.doors.map((d) => (
          <line key={d.id} className={`pl-map-door ${d.open ? "open" : ""}`} x1={d.x1} y1={d.y1} x2={d.x2} y2={d.y2} />
        ))}
        {plan.tokens.map((t) => (
          <g
            key={t.id}
            className={`pl-map-token ${t.me ? "me" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              setPicked(picked === t.id ? null : t.id);
            }}
          >
            {t.me && <circle cx={t.x + 0.5} cy={t.y + 0.5} r={0.62} className="pl-map-ring" />}
            <circle cx={t.x + 0.5} cy={t.y + 0.5} r={0.4} fill={t.color} />
            <text x={t.x + 0.5} y={t.y + 0.62} textAnchor="middle">
              {t.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2) || "?"}
            </text>
          </g>
        ))}
      </svg>
      <div className="muted small">{pickedName ?? "Tap a token to see who it is."}</div>
    </section>
  );
}
