import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { cellKey, effectiveFeatures, revealedSet, type MapFeature } from "@dm/shared";
import { api } from "../../lib/api";
import type { ServerView } from "../../lib/useServer";
import { HistoryControls } from "../HistoryControls";
import { boxFromInputs, cellsOfRect, clientToCell, clientToPoint, hitCorner, moveFeature, rectBetween, resizeFeature, sameRect, type Cell, type Corner, type Rect } from "./geometry";

type Run = (fn: () => Promise<unknown>) => Promise<void>;
type Mode = "move" | "reveal" | "hide" | "features" | "monsters";

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "move", label: "✋ Move", hint: "Drag a token to another cell." },
  { id: "reveal", label: "☀ Reveal", hint: "Drag a rectangle to reveal fog." },
  { id: "hide", label: "☁ Hide", hint: "Drag a rectangle to hide cells; party light will not re-reveal them." },
  { id: "features", label: "▣ Features", hint: "Click a feature to edit it, drag to move, drag a corner to resize." },
  { id: "monsters", label: "👹 Monsters", hint: "Click a monster to hide, show or remove it." },
];

const KIND_COLOR: Record<MapFeature["kind"], string> = {
  entrance: "#4cc46a",
  exit: "#7fe0ff",
  focal: "#e0b83c",
  feature: "#c79cff",
};

type Drag =
  | { kind: "token"; entityId: string; from: Cell; cell: Cell }
  | { kind: "fog"; start: Cell; end: Cell }
  | { kind: "move-feature"; index: number; name: string; start: Cell; orig: Rect; box: Rect }
  | { kind: "resize-feature"; index: number; name: string; corner: Corner; orig: Rect; box: Rect };

const tool = (name: string, body: unknown) => api(`/tools/${name}`, body);

/** Host "Board" tab: a 2D grid over the painted map to fix tokens, fog, map features and monsters. */
export function BoardTab({ view, run }: { view: ServerView; run: Run }) {
  const { state, campaign } = view;
  const [mode, setMode] = useState<Mode>("move");
  const [drag, setDrag] = useState<Drag | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [selMonster, setSelMonster] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const loc = campaign?.outline?.locations.find((l) => l.id === state?.locationId);
  const features = state && loc ? effectiveFeatures(state, loc) : [];
  useEffect(() => {
    if (selected !== null && selected >= features.length) setSelected(null);
  }, [features.length, selected]);

  if (!state) return <p className="muted">Create or load a campaign first.</p>;
  if (!loc) return <p className="muted">No current scene. Pick a location (Adventure tab or the DM's change_scene) to edit its board.</p>;

  const { gridW, gridH } = loc;
  const edited = state.featureEdits?.[loc.id]?.mapUrl === (loc.mapUrl ?? "");
  const fog = state.fog?.[loc.id];
  const seen = fog ? revealedSet(fog) : null;
  const hidden = new Set(fog?.hidden ?? []);
  const nameOf = (id: string) => state.characters.find((c) => c.id === id)?.name ?? state.monsters.find((m) => m.id === id)?.name ?? "?";

  const pointer = (e: ReactPointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { cell: clientToCell(e.clientX, e.clientY, r, gridW, gridH), point: clientToPoint(e.clientX, e.clientY, r, gridW, gridH) };
  };
  const tokenAt = (c: Cell) => [...state.tokens].reverse().find((t) => t.x === c.x && t.y === c.y);
  const featureAt = (c: Cell) => {
    for (let i = features.length - 1; i >= 0; i--) {
      const f = features[i]!;
      if (c.x >= f.x && c.x < f.x + f.w && c.y >= f.y && c.y < f.y + f.h) return i;
    }
    return null;
  };

  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const { cell, point } = pointer(e);
    let next: Drag | null = null;
    if (mode === "move") {
      const t = tokenAt(cell);
      if (t) next = { kind: "token", entityId: t.entityId, from: cell, cell };
    } else if (mode === "reveal" || mode === "hide") {
      next = { kind: "fog", start: cell, end: cell };
    } else if (mode === "features") {
      const sel = selected !== null ? features[selected] : undefined;
      const corner = sel ? hitCorner(sel, point, 0.45) : null;
      if (sel && corner) next = { kind: "resize-feature", index: selected!, name: sel.name, corner, orig: sel, box: sel };
      else {
        const i = featureAt(cell);
        setSelected(i);
        if (i !== null) next = { kind: "move-feature", index: i, name: features[i]!.name, start: cell, orig: features[i]!, box: features[i]! };
      }
    } else if (mode === "monsters") {
      const t = tokenAt(cell);
      setSelMonster(t?.entityType === "monster" ? t.entityId : null);
    }
    if (next) {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag(next);
    }
  };

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const { cell } = pointer(e);
    if (drag.kind === "token") setDrag({ ...drag, cell });
    else if (drag.kind === "fog") setDrag({ ...drag, end: cell });
    else if (drag.kind === "move-feature") setDrag({ ...drag, box: moveFeature(drag.orig, cell.x - drag.start.x, cell.y - drag.start.y, gridW, gridH) });
    else setDrag({ ...drag, box: resizeFeature(drag.orig, drag.corner, cell, gridW, gridH) });
  };

  // One tool call per drop (never one per pointermove), so each edit is a single undo step.
  const onUp = () => {
    const d = drag;
    setDrag(null);
    if (!d) return;
    if (d.kind === "token") {
      if (d.cell.x !== d.from.x || d.cell.y !== d.from.y) void run(() => tool("move_token", { entity_id: d.entityId, x: d.cell.x, y: d.cell.y }));
    } else if (d.kind === "fog") {
      void run(() => tool("edit_fog", { mode, cells: cellsOfRect(rectBetween(d.start, d.end)) }));
    } else if (!sameRect(d.box, d.orig)) {
      // expect_name: if the list changed under us (DM/undo), the server refuses instead of editing the wrong one.
      void run(() => tool("edit_map_feature", { action: "update", index: d.index, expect_name: d.name, feature: d.box }));
    }
  };

  const fogRect = drag?.kind === "fog" ? rectBetween(drag.start, drag.end) : null;
  const boxOf = (i: number, f: MapFeature): Rect => (drag && (drag.kind === "move-feature" || drag.kind === "resize-feature") && drag.index === i ? drag.box : f);
  const sel = selected !== null ? features[selected] : undefined;
  const monster = state.monsters.find((m) => m.id === selMonster);

  return (
    <div className="board-tab">
      <section className="card board-card">
        <div className="row wrap">
          <b className="board-title">{loc.name}</b>
          <span className="muted">
            {gridW}×{gridH}
            {edited ? " · features edited by host" : ""}
          </span>
          <span className="grow" />
          <HistoryControls version={state.version} run={run} />
        </div>
        <div className="row wrap">
          {MODES.map((m) => (
            <button key={m.id} className={mode === m.id ? "active" : ""} title={m.hint} onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
          <span className="grow" />
          <span className="muted">Fog:</span>
          <button className={fog?.enabled ? "active" : ""} onClick={() => run(() => tool("set_fog", { mode: fog?.enabled ? "disable" : "enable" }))}>
            {fog?.enabled ? "on" : "off"}
          </button>
          <button disabled={!fog} onClick={() => confirm("Forget everything the party explored here (and un-hide hidden cells)?") && run(() => tool("set_fog", { mode: "reset" }))}>
            reset
          </button>
        </div>
        <p className="muted board-hint">{MODES.find((m) => m.id === mode)!.hint}</p>
        <div className="board-wrap" style={{ aspectRatio: `${gridW} / ${gridH}`, width: `min(100%, calc((100vh - 230px) * ${gridW / gridH}))` }}>
          <svg
            ref={svgRef}
            className={`board-svg mode-${mode}`}
            viewBox={`0 0 ${gridW} ${gridH}`}
            preserveAspectRatio="none"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={() => setDrag(null)}
          >
            <rect x={0} y={0} width={gridW} height={gridH} fill="#0e0a08" />
            {loc.mapUrl && <image href={loc.mapUrl} x={0} y={0} width={gridW} height={gridH} preserveAspectRatio="none" />}
            <g className="board-grid">
              {Array.from({ length: gridW + 1 }, (_, x) => (
                <line key={`v${x}`} x1={x} y1={0} x2={x} y2={gridH} />
              ))}
              {Array.from({ length: gridH + 1 }, (_, y) => (
                <line key={`h${y}`} x1={0} y1={y} x2={gridW} y2={y} />
              ))}
            </g>
            {seen && (
              <g className={`board-fog ${fog?.enabled ? "on" : "off"}`}>
                {Array.from({ length: gridW * gridH }, (_, i) => {
                  const x = i % gridW;
                  const y = Math.floor(i / gridW);
                  const k = cellKey(x, y);
                  if (seen.has(k)) return null;
                  return <rect key={k} x={x} y={y} width={1} height={1} className={hidden.has(k) ? "hidden-cell" : undefined} />;
                })}
              </g>
            )}
            {features.map((f, i) => {
              const b = boxOf(i, f);
              const isSel = mode === "features" && i === selected;
              return (
                <g key={`${i}-${f.name}`} className={`board-feature${isSel ? " selected" : ""}`} style={{ color: KIND_COLOR[f.kind] }}>
                  <rect x={b.x + 0.05} y={b.y + 0.05} width={b.w - 0.1} height={b.h - 0.1} rx={0.15} />
                  <text x={b.x + 0.15} y={b.y + 0.55}>
                    {f.name}
                    {f.lit ? " 💡" : ""}
                    {f.blocks ? " ⛔" : ""}
                  </text>
                  {isSel &&
                    ([
                      [b.x, b.y],
                      [b.x + b.w, b.y],
                      [b.x, b.y + b.h],
                      [b.x + b.w, b.y + b.h],
                    ] as const).map(([hx, hy]) => <rect key={`${hx},${hy}`} className="handle" x={hx - 0.22} y={hy - 0.22} width={0.44} height={0.44} />)}
                </g>
              );
            })}
            {state.tokens.map((t) => {
              const ch = state.characters.find((c) => c.id === t.entityId);
              const mon = state.monsters.find((m) => m.id === t.entityId);
              const moving = drag?.kind === "token" && drag.entityId === t.entityId;
              const pos = moving ? drag.cell : t;
              if (pos.x < 0 || pos.y < 0) return null;
              const color = ch?.color ?? "#e0463c";
              const label = nameOf(t.entityId);
              return (
                <g
                  key={t.id}
                  className={`board-token${mon?.hidden ? " is-hidden" : ""}${mon && mon.id === selMonster ? " selected" : ""}${moving ? " moving" : ""}`}
                >
                  <title>{label}{mon?.hidden ? " (hidden from table)" : ""}</title>
                  <circle cx={pos.x + 0.5} cy={pos.y + 0.5} r={0.4} fill={color} stroke={mon ? "#3a0d0a" : "#120d0a"} />
                  <text x={pos.x + 0.5} y={pos.y + 0.62} textAnchor="middle">
                    {label.replace(/[^A-Za-z0-9]/g, "").slice(0, 2) || "?"}
                  </text>
                </g>
              );
            })}
            {fogRect && <rect className={`board-drag ${mode}`} x={fogRect.x} y={fogRect.y} width={fogRect.w} height={fogRect.h} />}
          </svg>
        </div>
      </section>

      <aside className="card board-side">
        {mode === "features" ? (
          <FeaturePanel key={`${selected}-${sel ? JSON.stringify(sel) : ""}`} index={selected} feature={sel} count={features.length} edited={edited} gridW={gridW} gridH={gridH} run={run} onSelect={setSelected} />
        ) : mode === "monsters" ? (
          <MonsterPanel view={view} selected={monster?.id ?? null} onSelect={setSelMonster} run={run} />
        ) : (
          <>
            <h2>Legend</h2>
            <ul className="list board-legend">
              {(Object.keys(KIND_COLOR) as MapFeature["kind"][]).map((k) => (
                <li key={k}>
                  <span style={{ color: KIND_COLOR[k] }}>■ {k}</span>
                </li>
              ))}
              <li>💡 lit (glows through fog) · ⛔ blocks movement</li>
              <li>Dark cells: unexplored fog. Red-hatched: hidden by the host.</li>
            </ul>
          </>
        )}
      </aside>
    </div>
  );
}

function FeaturePanel(props: {
  index: number | null;
  feature: MapFeature | undefined;
  count: number;
  edited: boolean;
  gridW: number;
  gridH: number;
  run: Run;
  onSelect: (i: number | null) => void;
}) {
  const { index, feature, count, edited, gridW, gridH, run, onSelect } = props;
  const [form, setForm] = useState<MapFeature | undefined>(feature);
  // Number fields stay raw text while typing; an empty field keeps the current value (never 0).
  const [nums, setNums] = useState({ x: String(feature?.x ?? ""), y: String(feature?.y ?? ""), w: String(feature?.w ?? ""), h: String(feature?.h ?? "") });
  const set = (patch: Partial<MapFeature>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const num = (k: "x" | "y" | "w" | "h") => (
    <label className="abil">
      {k}
      <input className="small num" type="number" min={k === "w" || k === "h" ? 1 : 0} value={nums[k]} onChange={(e) => setNums((n) => ({ ...n, [k]: e.target.value }))} />
    </label>
  );
  const add = () =>
    run(async () => {
      await tool("edit_map_feature", {
        action: "add",
        feature: { name: "new feature", kind: "feature", x: Math.floor(gridW / 2) - 1, y: Math.floor(gridH / 2) - 1, w: 2, h: 2 },
      });
      onSelect(count);
    });

  return (
    <>
      <h2>Map features</h2>
      <div className="row wrap">
        <button onClick={add}>＋ Add feature</button>
        <button disabled={!edited} title="Throw away host edits and use the features read from the painted map" onClick={() => confirm("Reset features to what was read from the map?") && run(() => tool("edit_map_feature", { action: "reset" }))}>
          ↺ Use map read
        </button>
      </div>
      {!form || index === null ? (
        <p className="muted">{count ? "Click a feature on the board to edit it." : "No features yet: add one, or paint the map to read them."}</p>
      ) : (
        <div className="feature-form">
          <label>
            Name
            <input value={form.name} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label>
            Kind
            <select value={form.kind} onChange={(e) => set({ kind: e.target.value as MapFeature["kind"] })}>
              <option value="entrance">entrance (party arrives)</option>
              <option value="exit">exit</option>
              <option value="focal">focal (monster spawn)</option>
              <option value="feature">feature</option>
            </select>
          </label>
          <div className="row">
            <label>
              <input type="checkbox" checked={form.lit} onChange={(e) => set({ lit: e.target.checked })} /> lit
            </label>
            <label>
              <input type="checkbox" checked={form.blocks} onChange={(e) => set({ blocks: e.target.checked })} /> blocks
            </label>
          </div>
          <div className="row">
            {num("x")}
            {num("y")}
            {num("w")}
            {num("h")}
          </div>
          <div className="row">
            <button className="primary" disabled={!form.name.trim()} onClick={() =>
                run(() =>
                  tool("edit_map_feature", { action: "update", index, expect_name: feature!.name, feature: { ...form, ...boxFromInputs(nums, form, gridW, gridH) } }),
                )
              }
            >
              Save
            </button>
            <button
              className="danger"
              onClick={() =>
                run(async () => {
                  await tool("edit_map_feature", { action: "delete", index, expect_name: feature!.name });
                  onSelect(null);
                })
              }
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function MonsterPanel({ view, selected, onSelect, run }: { view: ServerView; selected: string | null; onSelect: (id: string | null) => void; run: Run }) {
  const monsters = view.state?.monsters ?? [];
  return (
    <>
      <h2>Monsters</h2>
      {!monsters.length && <p className="muted">No monsters on this map.</p>}
      <ul className="list">
        {monsters.map((m) => (
          <li key={m.id} className={m.id === selected ? "current" : ""} onClick={() => onSelect(m.id)}>
            <b>{m.name}</b>
            <span className="muted">
              {m.hp}/{m.maxHp} HP{m.hidden ? " · hidden" : ""}
            </span>
            <span className="row">
              <button onClick={() => run(() => tool("set_monster_hidden", { monster_id: m.id, hidden: !m.hidden }))}>{m.hidden ? "Show" : "Hide"}</button>
              <button className="danger" onClick={() => confirm(`Remove ${m.name}?`) && run(() => tool("remove_monster", { monster_id: m.id }))}>
                Remove
              </button>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
