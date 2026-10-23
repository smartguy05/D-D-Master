import { useEffect, useState } from "react";
import type { Campaign, CharacterConstraints, CustomSpecies } from "@dm/shared";
import { api, patch } from "../lib/api";
import { addDrafted, blankSpecies, choicesFromText, choicesToText, classesToSave, removeCustom, renameCustom, tickedClasses, toggleName, traitsFromText, traitsToText } from "./characterRules";
import { speciesSummary } from "./seats";

type Run = (fn: () => Promise<unknown>) => Promise<void>;
type Catalog = { species: string[]; classes: string[] };

/**
 * Host Party tab: the campaign's character constraints (docs/gameplay/character-constraints.md).
 * Custom species (drafted by the AI, then edited), which species and classes PCs may be. Saved with
 * PATCH /campaign/settings; characters that already break them are only flagged.
 */
export function CharacterRulesCard({ campaign, run }: { campaign: Campaign; run: Run }) {
  const [draft, setDraft] = useState<CharacterConstraints>(campaign.constraints);
  const [catalog, setCatalog] = useState<Catalog>({ species: [], classes: [] });
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  // One custom species is edited at a time; the rest are one-line summaries.
  const [openSpecies, setOpenSpecies] = useState<number | null>(null);
  const saved = JSON.stringify(campaign.constraints);
  useEffect(() => setDraft(campaign.constraints), [campaign.id, saved]);
  useEffect(() => setOpenSpecies(null), [campaign.id]);
  useEffect(() => {
    api<Catalog>("/rules/origins")
      .then(setCatalog)
      .catch(() => undefined);
  }, []);
  const dirty = JSON.stringify(draft) !== saved;

  const speciesNames = [...draft.customSpecies.map((s) => s.name), ...catalog.species.filter((n) => !draft.customSpecies.some((s) => s.name.toLowerCase() === n.toLowerCase()))];
  const isAllowed = (n: string) => draft.allowedSpecies.some((a) => a.toLowerCase() === n.toLowerCase());
  const ticked = tickedClasses(draft.allowedClasses, catalog.classes);
  const setSpecies = (i: number, s: Partial<CustomSpecies>) => setDraft((d) => ({ ...d, customSpecies: d.customSpecies.map((x, j) => (j === i ? { ...x, ...s } : x)) }));

  const draftSpecies = () =>
    run(async () => {
      setBusy(true);
      try {
        const r = await api<{ species: CustomSpecies[] }>("/campaign/custom-species/draft", { prompt });
        setOpenSpecies(draft.customSpecies.length);
        setDraft((d) => addDrafted(d, r.species));
        setPrompt("");
      } finally {
        setBusy(false);
      }
    });

  return (
    <section className="card span2 character-rules">
      <div className="row">
        <h2 className="grow">Character rules</h2>
        {dirty && <span className="muted small">Unsaved changes</span>}
        <button disabled={!dirty} onClick={() => setDraft(campaign.constraints)}>
          Revert
        </button>
        <button className="primary" disabled={!dirty} onClick={() => run(() => patch("/campaign/settings", { constraints: draft }))}>
          Save rules
        </button>
      </div>
      <p className="muted small">
        Limit which species and classes heroes may be (a world of rats, say). Phones, the voice builder, pregens and sheet imports refuse anything else; your own edits only get a warning. No species or class picked means
        anything goes.
      </p>

      <h3>Custom species</h3>
      <div className="row">
        <input className="grow" placeholder="Ask the AI, e.g. 'three rat species for a sewer city'" value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !busy && draftSpecies()} />
        <button disabled={busy} onClick={draftSpecies}>
          {busy ? "Drafting…" : "✨ Draft species"}
        </button>
        <button
          onClick={() => {
            setOpenSpecies(draft.customSpecies.length);
            setDraft((d) => addDrafted(d, [blankSpecies(`New species ${d.customSpecies.length + 1}`)]));
          }}
        >
          + Blank
        </button>
      </div>
      {draft.customSpecies.map((s, i) => {
        const remove = () => {
          setDraft((d) => removeCustom(d, i));
          setOpenSpecies((o) => (o === null || o === i ? null : o > i ? o - 1 : o));
        };
        if (openSpecies !== i)
          return (
            <div key={i} className="species-row" role="button" tabIndex={0} title="Edit this species" onClick={() => setOpenSpecies(i)} onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && setOpenSpecies(i)}>
              <span className="caret" aria-hidden>▸</span>
              <b>{s.name}</b>
              <span className="muted small grow">{speciesSummary(s)}</span>
              <button className="danger small" onClick={(e) => (e.stopPropagation(), remove())}>
                ✕
              </button>
            </div>
          );
        return (
          <div key={i} className="custom-species">
            <div className="row wrap">
              <button className="small" title="Collapse" aria-label="Collapse" onClick={() => setOpenSpecies(null)}>
                ▾
              </button>
              <input className="grow" value={s.name} placeholder="Name" onChange={(e) => setDraft((d) => renameCustom(d, i, e.target.value))} />
              <label>
                Type <input value={s.creatureType} onChange={(e) => setSpecies(i, { creatureType: e.target.value })} style={{ width: 110 }} />
              </label>
              <label>
                Speed <input type="number" min={0} max={120} step={5} value={s.speed} onChange={(e) => setSpecies(i, { speed: +e.target.value || 0 })} style={{ width: 64 }} />
              </label>
              <label>
                Darkvision <input type="number" min={0} max={300} step={30} value={s.darkvision ?? 0} onChange={(e) => setSpecies(i, { darkvision: +e.target.value || undefined })} style={{ width: 64 }} />
              </label>
              <button className="danger small" onClick={remove}>
                ✕
              </button>
            </div>
            <input placeholder="Look (used to draw tokens), e.g. 'a wiry grey rat with a torn ear'" value={s.description} onChange={(e) => setSpecies(i, { description: e.target.value })} />
            <SpeciesText label="Traits, one per line: Name: rules text" value={traitsToText(s)} parse={(t) => setSpecies(i, { traits: traitsFromText(t) })} />
            <SpeciesText label="Choices, one per line: Label [option|size|skill|feat|ability]: A / B" value={choicesToText(s)} parse={(t) => setSpecies(i, { choices: choicesFromText(t, s.choices) })} />
          </div>
        );
      })}

      <h3>Allowed species {draft.allowedSpecies.length === 0 && <span className="muted small">(any)</span>}</h3>
      <div className="chips">
        {speciesNames.map((n) => (
          <span key={n} className={`chip ${isAllowed(n) ? "on" : ""}`} onClick={() => setDraft((d) => ({ ...d, allowedSpecies: toggleName(d.allowedSpecies, n, !isAllowed(n)) }))}>
            {isAllowed(n) ? "✓ " : ""}
            {n}
          </span>
        ))}
        {draft.allowedSpecies.length > 0 && (
          <button className="small" onClick={() => setDraft((d) => ({ ...d, allowedSpecies: [] }))}>
            Allow any
          </button>
        )}
      </div>

      <h3>Allowed classes {draft.allowedClasses.length === 0 && <span className="muted small">(all)</span>}</h3>
      <div className="row wrap">
        {catalog.classes.map((c) => (
          <label key={c} className="row">
            <input
              type="checkbox"
              checked={ticked.includes(c)}
              onChange={(e) => setDraft((d) => ({ ...d, allowedClasses: classesToSave(toggleName(ticked, c, e.target.checked), catalog.classes) }))}
            />{" "}
            {c}
          </label>
        ))}
      </div>
    </section>
  );
}

/** A textarea edited as text and parsed on blur, so half-typed lines aren't thrown away. */
function SpeciesText({ label, value, parse }: { label: string; value: string; parse: (text: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label className="species-text">
      <span className="muted small">{label}</span>
      <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text !== value && parse(text)} />
    </label>
  );
}
