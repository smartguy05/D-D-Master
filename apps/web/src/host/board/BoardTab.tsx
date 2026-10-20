import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { cellKey, effectiveFeatures, effectiveWalls, revealedSet, type MapFeature, type MapObject, type WallSeg } from "@dm/shared";
import { api } from "../../lib/api";
import type { ServerView } from "../../lib/useServer";
import { HistoryControls } from "../HistoryControls";
import { objectContents, objectSummary } from "./objects";
import { monsterColor } from "../../lib/tokenColor";
import { DISPOSITION_LABEL, dispositionOf, nextDisposition } from "../disposition";
import { boxFromInputs, cellsOfRect, featureLabelPlacement, clientToCell, clientToIntersection, clientToPoint, hitCorner, hitSegment, moveFeature, rectBetween, resizeFeature, sameRect, segmentBetween, type Cell, type Corner, type Rect } from "./geometry";

type Run = (fn: () => Promise<unknown>) => Promise<void>;
type Mode = "move" | "reveal" | "hide" | "features" | "walls" | "monsters" | "objects";
type WallKind = WallSeg["kind"];

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "move", label: "✋ Move", hint: "Drag a token to another cell." },
  { id: "reveal", label: "☀ Reveal", hint: "Drag a rectangle to reveal fog." },
  { id: "hide", label: "☁ Hide", hint: "Drag a rectangle to hide cells; party light will not re-reveal them." },
  { id: "features", label: "▣ Features", hint: "Click a feature to edit it, drag to move, drag a corner to resize." },
  { id: "walls", label: "▮ Walls", hint: "Click two grid crossings in one row or column to add a segment; click a segment to select it." },
  { id: "monsters", label: "👹 Monsters", hint: "Click a monster to hide, show or remove it." },
  { id: "objects", label: "✦ Objects", hint: "Loot and interactables here. Choose “Place interactable”, then click a cell." },
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
  const [wallKind, setWallKind] = useState<WallKind>("wall");
  const [wallStart, setWallStart] = useState<Cell | null>(null);
  const [wallHover, setWallHover] = useState<Cell | null>(null);
  const [selWall, setSelWall] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [selObject, setSelObject] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const loc = campaign?.outline?.locations.find((l) => l.id === state?.locationId);
  const features = state && loc ? effectiveFeatures(state, loc) : [];
  const walls = state && loc ? effectiveWalls(state, loc) : [];
  useEffect(() => {
    if (selWall !== null && !walls.some((w) => w.id === selWall)) setSelWall(null);
  }, [walls, selWall]);
  useEffect(() => {
    if (mode !== "walls") setWallStart(null);
    if (mode !== "objects") setPlacing(false);
  }, [mode]);
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
  const objects = (state.mapObjects ?? []).filter((o) => o.locationId === loc.id);
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
    } else if (mode === "walls") {
      onWallClick(e);
      return;
    } else if (mode === "monsters") {
      const t = tokenAt(cell);
      setSelMonster(t?.entityType === "monster" ? t.entityId : null);
    } else if (mode === "objects") {
      if (placing) {
        setPlacing(false);
        const name = prompt("Name of the interactable (lever, chest, altar…)", "lever")?.trim();
        if (name) void run(() => tool("place_interactable", { name, x: cell.x, y: cell.y }));
        return;
      }
      setSelObject([...objects].reverse().find((o) => o.x === cell.x && o.y === cell.y)?.id ?? null);
    }
    if (next) {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag(next);
    }
  };

  // Walls: first click picks a segment (when on one) or anchors a new one; the second click ends it.
  const onWallClick = (e: ReactPointerEvent<SVGSVGElement>) => {
    const r = svgRef.current!.getBoundingClientRect();
    const point = clientToPoint(e.clientX, e.clientY, r, gridW, gridH);
    const ix = clientToIntersection(e.clientX, e.clientY, r, gridW, gridH);
    if (!wallStart) {
      const hit = hitSegment(walls, point, 0.2);
      // A click right on a grid crossing starts a segment even when it touches a wall end.
      const onCrossing = Math.hypot(point.x - ix.x, point.y - ix.y) <= 0.2;
      if (hit && !onCrossing) {
        setSelWall(hit);
        return;
      }
      setSelWall(null);
      setWallStart(ix);
      setWallHover(ix);
      return;
    }
    const seg = segmentBetween(wallStart, ix);
    if (!seg && (ix.x !== wallStart.x || ix.y !== wallStart.y)) return; // diagonal: keep the anchor, wait for a straight pick
    setWallStart(null);
    setWallHover(null);
    if (seg) void run(() => tool("edit_walls", { action: "add", segment: { ...seg, kind: wallKind } }));
  };

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (mode === "walls" && wallStart) {
      const ix = clientToIntersection(e.clientX, e.clientY, svgRef.current!.getBoundingClientRect(), gridW, gridH);
      if (!wallHover || ix.x !== wallHover.x || ix.y !== wallHover.y) setWallHover(ix);
      return;
    }
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
  const wallsEdited = !!state.wallEdits?.[loc.id] && state.wallEdits[loc.id]!.host !== false; // DM door toggles alone are not host edits
  const pendingSeg = wallStart && wallHover ? segmentBetween(wallStart, wallHover) : null;

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
              const label = `${f.name}${f.lit ? " 💡" : ""}${f.blocks ? " ⛔" : ""}${f.interactive ? " ✦" : ""}`;
              const at = featureLabelPlacement(b, gridW, label); // stays on the board
              return (
                <g key={`${i}-${f.name}`} className={`board-feature${isSel ? " selected" : ""}`} style={{ color: KIND_COLOR[f.kind] }}>
                  <rect x={b.x + 0.05} y={b.y + 0.05} width={b.w - 0.1} height={b.h - 0.1} rx={0.15} />
                  <text x={at.x} y={b.y + 0.55} textAnchor={at.anchor}>
                    {label}
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
            {objects.map((o) => (
              <g key={o.id} className={`board-object ${o.kind}${o.hidden ? " is-hidden" : ""}${o.used ? " used" : ""}${mode === "objects" && o.id === selObject ? " selected" : ""}`}>
                <title>{objectSummary(o)}</title>
                <rect x={o.x + 0.12} y={o.y + 0.12} width={0.76} height={0.76} rx={o.kind === "loot" ? 0.12 : 0.38} />
                <text x={o.x + 0.5} y={o.y + 0.66} textAnchor="middle">
                  {o.kind === "loot" ? "💰" : "✦"}
                </text>
              </g>
            ))}
            {state.tokens.map((t) => {
              const ch = state.characters.find((c) => c.id === t.entityId);
              const mon = state.monsters.find((m) => m.id === t.entityId);
              const moving = drag?.kind === "token" && drag.entityId === t.entityId;
              const pos = moving ? drag.cell : t;
              if (pos.x < 0 || pos.y < 0) return null;
              const color = ch?.color ?? (mon ? monsterColor(mon) : "#e0463c"); // same colours as the TV
              const label = nameOf(t.entityId);
              return (
                <g
                  key={t.id}
                  className={`board-token${mon?.hidden ? " is-hidden" : ""}${mon && mon.id === selMonster ? " selected" : ""}${moving ? " moving" : ""}`}
                >
                  <title>
                    {label}
                    {mon && dispositionOf(mon) !== "foe" ? ` · ${dispositionOf(mon)}` : ""}
                    {mon?.hidden ? " (hidden from table)" : ""}
                  </title>
                  <circle cx={pos.x + 0.5} cy={pos.y + 0.5} r={0.4} fill={color} stroke={mon ? "#3a0d0a" : "#120d0a"} />
                  <text x={pos.x + 0.5} y={pos.y + 0.62} textAnchor="middle">
                    {label.replace(/[^A-Za-z0-9]/g, "").slice(0, 2) || "?"}
                  </text>
                </g>
              );
            })}
            {/* Host-only overlay of the walls in effect (the TV draws doors only). */}
            <g className="board-walls">
              {walls.map((w) => (
                <line key={w.id} className={`${w.kind}${w.kind === "door" && w.open ? " open" : ""}${mode === "walls" && w.id === selWall ? " selected" : ""}`} x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2}>
                  <title>{`${w.id} · ${w.kind}${w.kind === "door" ? (w.open ? " (open)" : " (closed)") : ""}`}</title>
                </line>
              ))}
              {mode === "walls" && wallStart && <circle className="anchor" cx={wallStart.x} cy={wallStart.y} r={0.15} />}
              {mode === "walls" && pendingSeg && <line className="pending" x1={pendingSeg.x1} y1={pendingSeg.y1} x2={pendingSeg.x2} y2={pendingSeg.y2} />}
            </g>
            {fogRect && <rect className={`board-drag ${mode}`} x={fogRect.x} y={fogRect.y} width={fogRect.w} height={fogRect.h} />}
          </svg>
        </div>
      </section>

      <aside className="card board-side">
        {mode === "features" ? (
          <FeaturePanel key={`${selected}-${sel ? JSON.stringify(sel) : ""}`} index={selected} feature={sel} count={features.length} edited={edited} gridW={gridW} gridH={gridH} run={run} onSelect={setSelected} />
        ) : mode === "walls" ? (
          <WallPanel
            walls={walls}
            selected={walls.find((w) => w.id === selWall)}
            kind={wallKind}
            onKind={setWallKind}
            anchored={!!wallStart}
            onCancel={() => setWallStart(null)}
            edited={wallsEdited}
            run={run}
            onSelect={setSelWall}
          />
        ) : mode === "monsters" ? (
          <MonsterPanel view={view} selected={monster?.id ?? null} onSelect={setSelMonster} run={run} />
        ) : mode === "objects" ? (
          <ObjectPanel objects={objects} selected={selObject} onSelect={setSelObject} placing={placing} onPlacing={setPlacing} run={run} />
        ) : (
          <>
            <h2>Legend</h2>
            <ul className="list board-legend">
              {(Object.keys(KIND_COLOR) as MapFeature["kind"][]).map((k) => (
                <li key={k}>
                  <span style={{ color: KIND_COLOR[k] }}>■ {k}</span>
                </li>
              ))}
              <li>💡 lit (glows through fog) · ⛔ blocks movement · ✦ interactive (aura on the TV)</li>
              <li>💰 loot · ✦ interactable (Objects mode); faded = hidden from the TV</li>
              <li>Lines: white wall · orange door (dashed when open) · blue window. Only doors show on the TV.</li>
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
            <label title="Players can use or open it (lever, chest, altar, door): the DM uses it from beside it and the TV shows an aura">
              <input type="checkbox" checked={!!form.interactive} onChange={(e) => set({ interactive: e.target.checked })} /> interactive
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

const WALL_KINDS: { id: WallKind; label: string; hint: string }[] = [
  { id: "wall", label: "Wall", hint: "Blocks sight and movement" },
  { id: "door", label: "Door", hint: "Blocks both while closed; the DM can open it with set_door" },
  { id: "window", label: "Window", hint: "Blocks movement, not sight" },
];

function WallPanel(props: {
  walls: WallSeg[];
  selected: WallSeg | undefined;
  kind: WallKind;
  onKind: (k: WallKind) => void;
  anchored: boolean;
  onCancel: () => void;
  edited: boolean;
  run: Run;
  onSelect: (id: string | null) => void;
}) {
  const { walls, selected, kind, onKind, anchored, onCancel, edited, run, onSelect } = props;
  const doors = walls.filter((w) => w.kind === "door");
  return (
    <>
      <h2>Walls &amp; doors</h2>
      <div className="row wrap">
        {WALL_KINDS.map((k) => (
          <button key={k.id} className={kind === k.id ? "active" : ""} title={k.hint} onClick={() => onKind(k.id)}>
            {k.label}
          </button>
        ))}
      </div>
      <p className="muted">
        {anchored ? "Now click the end crossing (same row or column)." : `Click a grid crossing to start a ${kind}.`}
        {anchored && (
          <>
            {" "}
            <button onClick={onCancel}>Cancel</button>
          </>
        )}
      </p>
      <div className="row wrap">
        <button
          disabled={!edited}
          title="Throw away host wall edits and door states; use the walls read from the map"
          onClick={() => confirm("Reset walls and doors to what was read from the map?") && run(() => tool("edit_walls", { action: "reset" }))}
        >
          ↺ Use map read
        </button>
        <span className="muted">
          {walls.length} segment{walls.length === 1 ? "" : "s"}
          {edited ? " · edited by host" : ""}
        </span>
      </div>
      {selected ? (
        <div className="feature-form">
          <p>
            <b>{selected.id}</b> · {selected.kind}
            {selected.kind === "door" ? (selected.open ? " (open)" : " (closed)") : ""}
            <br />
            <span className="muted">
              ({selected.x1},{selected.y1}) → ({selected.x2},{selected.y2})
            </span>
          </p>
          <div className="row">
            {selected.kind === "door" && (
              <button className="primary" onClick={() => run(() => tool("edit_walls", { action: "toggle", id: selected.id }))}>
                {selected.open ? "Close door" : "Open door"}
              </button>
            )}
            <button
              className="danger"
              onClick={() =>
                run(async () => {
                  await tool("edit_walls", { action: "delete", id: selected.id });
                  onSelect(null);
                })
              }
            >
              Delete
            </button>
          </div>
        </div>
      ) : (
        <p className="muted">{walls.length ? "Click a segment on the board to select it." : "No walls yet: draw some, or paint the map to read them."}</p>
      )}
      {doors.length > 0 && (
        <>
          <h3>Doors</h3>
          <ul className="list">
            {doors.map((d) => (
              <li key={d.id} className={d.id === selected?.id ? "current" : ""} onClick={() => onSelect(d.id)}>
                <b>{d.id}</b>
                <span className="muted">{d.open ? "open" : "closed"}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void run(() => tool("edit_walls", { action: "toggle", id: d.id }));
                  }}
                >
                  {d.open ? "Close" : "Open"}
                </button>
              </li>
            ))}
          </ul>
        </>
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
              {m.combatant === false && !m.neutral ? " · out of combat" : ""}
            </span>
            <span className="row">
              <button
                title="Foe → ally → neutral (the DM is told)"
                onClick={() => run(() => tool("set_disposition", { monster_id: m.id, disposition: nextDisposition(m) }))}
              >
                {DISPOSITION_LABEL[dispositionOf(m)]}
              </button>
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


function ObjectPanel(props: {
  objects: MapObject[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  placing: boolean;
  onPlacing: (p: boolean) => void;
  run: Run;
}) {
  const { objects, selected, onSelect, placing, onPlacing, run } = props;
  return (
    <>
      <h2>Loot &amp; interactables</h2>
      <div className="row wrap">
        <button className={placing ? "active" : ""} onClick={() => onPlacing(!placing)}>
          ✦ Place interactable
        </button>
      </div>
      <p className="muted">{placing ? "Click a cell on the board." : "Loot comes from the DM's drop_loot; place levers, chests and altars here."}</p>
      {!objects.length && <p className="muted">No objects in this location.</p>}
      <ul className="list">
        {objects.map((o) => (
          <li key={o.id} className={o.id === selected ? "current" : ""} onClick={() => onSelect(o.id)}>
            <b>
              {o.kind === "loot" ? "💰" : "✦"} {o.name}
            </b>
            <span className="muted">
              {o.kind} · {o.x},{o.y}
              {objectContents(o).length ? ` · ${objectContents(o).join(", ")}` : ""}
              {o.hidden ? " · hidden" : ""}
              {o.used ? " · used" : ""}
            </span>
            <span className="row">
              <button onClick={(e) => (e.stopPropagation(), void run(() => tool("set_interactable", { id: o.id, hidden: !o.hidden })))}>{o.hidden ? "Show" : "Hide"}</button>
              {o.kind === "interactable" && (
                <button onClick={(e) => (e.stopPropagation(), void run(() => tool("set_interactable", { id: o.id, used: !o.used })))}>{o.used ? "Unuse" : "Mark used"}</button>
              )}
              <button
                className="danger"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Remove ${o.name}?`)) void run(() => tool("remove_map_object", { id: o.id }));
                }}
              >
                Remove
              </button>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
