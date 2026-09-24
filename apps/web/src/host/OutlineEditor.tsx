import { useEffect, useState } from "react";
import type { Outline } from "@dm/shared";
import { api } from "../lib/api";

type Run = (fn: () => Promise<unknown>) => Promise<void>;
type Loc = Outline["locations"][number];
type Enc = Outline["encounters"][number];

const newLocation = (): Loc => ({ id: `loc_${Math.random().toString(36).slice(2, 8)}`, name: "New location", description: "", mapPrompt: "", gridW: 24, gridH: 16 });

/**
 * Host editor for the adventure outline. Edits a local draft; Save sends it to PUT /api/campaign/outline,
 * which validates it, keeps maps whose prompt didn't change and refreshes the running DM.
 */
export function OutlineEditor({ outline, fallbackTitle, run, onClose }: { outline?: Outline; fallbackTitle: string; run: Run; onClose: () => void }) {
  const [d, setD] = useState<Outline>(() =>
    structuredClone(outline ?? { title: fallbackTitle, hook: "", acts: [], locations: [], npcs: [], encounters: [] }),
  );
  const [monsters, setMonsters] = useState<string[]>([]);
  useEffect(() => {
    api<string[]>("/monsters").then(setMonsters).catch(() => undefined);
  }, []);

  const set = (patch: Partial<Outline>) => setD((o) => ({ ...o, ...patch }));
  const at = <T,>(list: T[], i: number, patch: Partial<T>) => list.map((x, j) => (j === i ? { ...x, ...patch } : x));
  const without = <T,>(list: T[], i: number) => list.filter((_, j) => j !== i);
  const setEnc = (i: number, patch: Partial<Enc>) => set({ encounters: at(d.encounters, i, patch) });

  const removeLocation = (i: number) => {
    const loc = d.locations[i];
    const encs = d.encounters.filter((e) => e.locationId === loc.id);
    if (encs.length && !confirm(`Remove "${loc.name}" and its ${encs.length} encounter(s)?`)) return;
    set({ locations: without(d.locations, i), encounters: d.encounters.filter((e) => e.locationId !== loc.id) });
  };

  const save = () =>
    run(async () => {
      await api("/campaign/outline", d, "PUT");
      onClose();
    });

  return (
    <div className="outline-editor">
      <datalist id="srd-monsters">
        {monsters.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <div className="row">
        <button className="primary" onClick={save}>
          Save outline
        </button>
        <button onClick={onClose}>Cancel</button>
        <span className="muted">Changing a map prompt clears that map so you can repaint it.</span>
      </div>

      <label className="form">
        Title <input value={d.title} onChange={(e) => set({ title: e.target.value })} />
      </label>
      <label className="form">
        Hook <textarea rows={2} value={d.hook} onChange={(e) => set({ hook: e.target.value })} />
      </label>

      <h3>Acts</h3>
      {d.acts.map((a, i) => (
        <div key={i} className="oe-item">
          <div className="row">
            <input className="grow" placeholder="Act title" value={a.title} onChange={(e) => set({ acts: at(d.acts, i, { title: e.target.value }) })} />
            <button className="small danger" onClick={() => set({ acts: without(d.acts, i) })}>
              ✕
            </button>
          </div>
          <textarea rows={2} placeholder="Summary" value={a.summary} onChange={(e) => set({ acts: at(d.acts, i, { summary: e.target.value }) })} />
        </div>
      ))}
      <button className="small" onClick={() => set({ acts: [...d.acts, { title: `Act ${d.acts.length + 1}`, summary: "" }] })}>
        + Act
      </button>

      <h3>Locations</h3>
      {d.locations.map((l, i) => (
        <div key={l.id} className="oe-item">
          <div className="row">
            <input className="grow" placeholder="Name" value={l.name} onChange={(e) => set({ locations: at(d.locations, i, { name: e.target.value }) })} />
            <label>
              W <input type="number" min={4} max={60} value={l.gridW} onChange={(e) => set({ locations: at(d.locations, i, { gridW: +e.target.value }) })} />
            </label>
            <label>
              H <input type="number" min={4} max={60} value={l.gridH} onChange={(e) => set({ locations: at(d.locations, i, { gridH: +e.target.value }) })} />
            </label>
            <button className="small danger" onClick={() => removeLocation(i)}>
              ✕
            </button>
          </div>
          <textarea rows={2} placeholder="Description (read by the DM)" value={l.description} onChange={(e) => set({ locations: at(d.locations, i, { description: e.target.value }) })} />
          <textarea rows={2} placeholder="Map prompt (top-down battle map)" value={l.mapPrompt} onChange={(e) => set({ locations: at(d.locations, i, { mapPrompt: e.target.value }) })} />
        </div>
      ))}
      <button className="small" onClick={() => set({ locations: [...d.locations, newLocation()] })}>
        + Location
      </button>

      <h3>NPCs</h3>
      {d.npcs.map((n, i) => (
        <div key={i} className="oe-item">
          <div className="row">
            <input className="grow" placeholder="Name" value={n.name} onChange={(e) => set({ npcs: at(d.npcs, i, { name: e.target.value }) })} />
            <button className="small danger" onClick={() => set({ npcs: without(d.npcs, i) })}>
              ✕
            </button>
          </div>
          <div className="row">
            <input className="grow" placeholder="Description" value={n.description} onChange={(e) => set({ npcs: at(d.npcs, i, { description: e.target.value }) })} />
            <input className="grow" placeholder="Wants…" value={n.motive} onChange={(e) => set({ npcs: at(d.npcs, i, { motive: e.target.value }) })} />
            <input className="grow" placeholder="Voice (accent, pitch, pace, tics)" value={n.voice ?? ""} onChange={(e) => set({ npcs: at(d.npcs, i, { voice: e.target.value }) })} />
          </div>
        </div>
      ))}
      <button className="small" onClick={() => set({ npcs: [...d.npcs, { name: "New NPC", description: "", motive: "", voice: "" }] })}>
        + NPC
      </button>

      <h3>Encounters</h3>
      {d.encounters.map((enc, i) => (
        <div key={enc.id} className="oe-item">
          <div className="row">
            <select value={enc.locationId} onChange={(e) => setEnc(i, { locationId: e.target.value })}>
              {d.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <input className="grow" placeholder="Description" value={enc.description} onChange={(e) => setEnc(i, { description: e.target.value })} />
            <button className="small danger" onClick={() => set({ encounters: without(d.encounters, i) })}>
              ✕
            </button>
          </div>
          {enc.monsters.map((m, j) => (
            <div key={j} className="row">
              <input className="grow" list="srd-monsters" placeholder="SRD monster" value={m.name} onChange={(e) => setEnc(i, { monsters: at(enc.monsters, j, { name: e.target.value }) })} />
              <input type="number" min={1} value={m.count} onChange={(e) => setEnc(i, { monsters: at(enc.monsters, j, { count: Math.max(1, +e.target.value || 1) }) })} />
              {m.name && monsters.length > 0 && !monsters.some((x) => x.toLowerCase() === m.name.toLowerCase()) && <span className="muted">not in SRD</span>}
              <button className="small danger" onClick={() => setEnc(i, { monsters: without(enc.monsters, j) })}>
                ✕
              </button>
            </div>
          ))}
          <button className="small" onClick={() => setEnc(i, { monsters: [...enc.monsters, { name: "", count: 1 }] })}>
            + Monster
          </button>
        </div>
      ))}
      <button
        className="small"
        disabled={!d.locations.length}
        onClick={() => set({ encounters: [...d.encounters, { id: `enc_${Math.random().toString(36).slice(2, 8)}`, locationId: d.locations[0].id, description: "", monsters: [] }] })}
      >
        + Encounter
      </button>
      <div className="row">
        <button className="primary" onClick={save}>
          Save outline
        </button>
        <button onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
