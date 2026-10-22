import { useState } from "react";
import {
  ABILITY_KEYS,
  ABILITY_LABELS,
  abilityMod,
  formatMod,
  MAGIC_INITIATE_LISTS,
  POINT_BUY_COST,
  SKILL_NAMES,
  STANDARD_ARRAY,
  type AbilityKey,
  type AsiPick,
  type CreationChoices,
  type CreationOptions,
  type CreationView,
  type FeatPicks,
} from "@dm/shared";
import type { Creation } from "./useCreation";
import { applyBonusPattern, bonusPattern, issuesFor, METHOD_LABELS, pointsLeft, setArrayScore, stepIssues, STEPS, toggleInList, type StepKey } from "./view";

/** The manual builder: one step at a time, every change checked by the server (issues inline). */
export function BuildForm({ creation, view, options }: { creation: Creation; view: CreationView; options: CreationOptions }) {
  const [step, setStep] = useState<StepKey>("origin");
  const c = creation.choices;
  const set = creation.change;
  const Step = { origin: OriginStep, class: ClassStep, abilities: AbilitiesStep, spells: SpellsStep, gear: GearStep, details: DetailsStep }[step];
  const at = STEPS.findIndex((s) => s.key === step);
  return (
    <div className="cr-build">
      <nav className="cr-steps">
        {STEPS.map((s) => {
          const n = stepIssues(view.validation, s.key);
          return (
            <button key={s.key} className={`${s.key === step ? "active" : ""} ${n.errors ? "todo" : "done"}`} onClick={() => setStep(s.key)}>
              {s.label}
              {n.errors ? <span className="cr-count">{n.errors}</span> : " ✓"}
            </button>
          );
        })}
      </nav>
      <Step c={c} set={set} view={view} options={options} creation={creation} />
      <div className="row">
        {at > 0 && <button onClick={() => setStep(STEPS[at - 1].key)}>← {STEPS[at - 1].label}</button>}
        <span className="grow" />
        {at < STEPS.length - 1 && <button className="primary" onClick={() => setStep(STEPS[at + 1].key)}>{STEPS[at + 1].label} →</button>}
      </div>
    </div>
  );
}

interface StepProps {
  c: CreationChoices;
  set: (fields: CreationChoices) => void;
  view: CreationView;
  options: CreationOptions;
  creation: Creation;
}

/** The validator's messages for these fields, under the inputs. */
function Issues({ view, fields }: { view: CreationView; fields: string[] }) {
  const list = fields.flatMap((f) => issuesFor(view.validation, f));
  if (!list.length) return null;
  return (
    <ul className="cr-issues">
      {list.map((i, n) => (
        <li key={n} className={view.validation.errors.includes(i) ? "error" : "warning"}>{i.message}</li>
      ))}
    </ul>
  );
}

function Select({ value, onChange, options, placeholder }: { value: string | undefined; onChange: (v: string | undefined) => void; options: { value: string; label: string }[]; placeholder: string }) {
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function Chips({ all, picked, max, onChange, locked = [] }: { all: string[]; picked: string[]; max: number; onChange: (next: string[]) => void; locked?: string[] }) {
  return (
    <div className="chips cr-chips">
      {all.map((x) => {
        const from = locked.includes(x);
        const on = picked.includes(x);
        return (
          <button key={x} type="button" className={`chip ${on || from ? "on" : ""}`} disabled={from || (!on && picked.length >= max)} onClick={() => onChange(toggleInList(picked, x, max))}>
            {x}
          </button>
        );
      })}
    </div>
  );
}

/** Magic Initiate (list, 2 cantrips, a level 1 spell) or Skilled (3 skills) picks. */
function FeatPicker({ feat, source, c, set, options }: { feat: string; source: "background" | "species"; c: CreationChoices; set: StepProps["set"]; options: CreationOptions }) {
  const picks: FeatPicks = c.featPicks?.[source] ?? {};
  const put = (p: FeatPicks) => set({ featPicks: { ...(c.featPicks ?? {}), [source]: { ...picks, ...p } } });
  const base = feat.replace(/\s*\([^)]*\)\s*$/, "");
  const fixed = /\(([^)]+)\)\s*$/.exec(feat)?.[1];
  if (base === "Magic Initiate") {
    const list = fixed ?? picks.list;
    const spells = list ? (options.spells[list] ?? []) : [];
    return (
      <div className="cr-sub">
        <b>Magic Initiate{list ? ` (${list})` : ""}</b>
        {!fixed && <Select value={picks.list} placeholder="Spell list…" onChange={(v) => put({ list: v, cantrips: [], spell: undefined })} options={MAGIC_INITIATE_LISTS.map((l) => ({ value: l, label: l }))} />}
        {list && (
          <>
            <small className="muted">2 cantrips</small>
            <Chips all={spells.filter((s) => s.level === 0).map((s) => s.name)} picked={picks.cantrips ?? []} max={2} onChange={(cantrips) => put({ cantrips })} />
            <Select value={picks.spell} placeholder="Level 1 spell…" onChange={(spell) => put({ spell })} options={spells.filter((s) => s.level === 1).map((s) => ({ value: s.name, label: s.name }))} />
          </>
        )}
      </div>
    );
  }
  if (base === "Skilled") {
    return (
      <div className="cr-sub">
        <b>Skilled</b> <small className="muted">3 skills</small>
        <Chips all={SKILL_NAMES} picked={picks.skills ?? []} max={3} onChange={(skills) => put({ skills })} />
      </div>
    );
  }
  return null;
}

function OriginStep({ c, set, view, options }: StepProps) {
  const species = options.species.find((s) => s.name === c.species);
  const bg = options.backgrounds.find((b) => b.name === c.background);
  const homebrew = view.settings.allowHomebrew;
  const versatile = species?.choices.find((ch) => ch.kind === "feat");
  const versatileFeat = versatile ? c.speciesChoices?.[versatile.key] : undefined;
  return (
    <section className="pl-card">
      <h2>Species</h2>
      <Select value={c.species} placeholder="Pick a species…" onChange={(v) => set({ species: v, speciesChoices: undefined, featPicks: c.featPicks?.background ? { background: c.featPicks.background } : undefined })} options={options.species.map((s) => ({ value: s.name, label: `${s.name} (speed ${s.speed})` }))} />
      {homebrew && !species && <input placeholder="…or a homebrew species" value={c.species ?? ""} onChange={(e) => set({ species: e.target.value || undefined })} />}
      {species && (
        <p className="muted small">
          {species.description ? `${species.description} ` : ""}
          {species.traits.map((t) => t.name).join(" · ")}
          {species.darkvision ? ` · Darkvision ${species.darkvision} ft` : ""}
        </p>
      )}
      {species?.choices.map((ch) => (
        <label key={ch.key} className="cr-field">
          {ch.label}
          <Select value={c.speciesChoices?.[ch.key]} placeholder="Choose…" onChange={(v) => set({ speciesChoices: { ...(c.speciesChoices ?? {}), ...(v ? { [ch.key]: v } : {}) } })} options={ch.options.map((o) => ({ value: o.name, label: o.text && o.text.length < 40 ? `${o.name} (${o.text})` : o.name }))} />
          {(() => {
            const o = ch.options.find((x) => x.name === c.speciesChoices?.[ch.key]);
            return o?.text && o.text.length >= 40 ? <small className="muted">{o.text}</small> : null;
          })()}
        </label>
      ))}
      {versatileFeat && <FeatPicker feat={versatileFeat} source="species" c={c} set={set} options={options} />}
      <Issues view={view} fields={["species", "speciesChoices", "featPicks.species"]} />

      <h2>Background</h2>
      <Select value={c.background} placeholder="Pick a background…" onChange={(v) => set({ background: v, backgroundBonuses: undefined, featPicks: c.featPicks?.species ? { species: c.featPicks.species } : undefined, backgroundEquipment: undefined })} options={options.backgrounds.map((b) => ({ value: b.name, label: b.name }))} />
      {homebrew && !bg && <input placeholder="…or a homebrew background" value={c.background ?? ""} onChange={(e) => set({ background: e.target.value || undefined })} />}
      {bg && (
        <p className="muted small">
          {bg.abilities.map((a) => ABILITY_LABELS[a]).join(", ")} · Feat: {bg.feat} · Skills: {bg.skills.join(", ")} · Tool: {bg.tool}
        </p>
      )}
      {bg && <FeatPicker feat={bg.feat} source="background" c={c} set={set} options={options} />}
      <Issues view={view} fields={["background", "featPicks.background"]} />
    </section>
  );
}

function ClassStep({ c, set, view, options }: StepProps) {
  const cls = options.classes.find((x) => x.name === c.className);
  const bg = options.backgrounds.find((b) => b.name === c.background);
  const species = options.species.find((s) => s.name === c.species);
  const fixedSkills = [...(bg?.skills ?? []), ...(species?.choices ?? []).filter((ch) => ch.kind === "skill").map((ch) => c.speciesChoices?.[ch.key]).filter((s): s is string => !!s)];
  const skillOptions = cls?.skillChoices ? (cls.skillChoices.options === "any" ? SKILL_NAMES : cls.skillChoices.options) : [];
  const styles = options.feats.filter((f) => f.category === "fighting_style");
  const homebrew = view.settings.allowHomebrew;
  return (
    <section className="pl-card">
      <h2>Class</h2>
      <Select
        value={c.className}
        placeholder="Pick a class…"
        onChange={(v) => set({ className: v, subclass: undefined, classSkills: [], cantrips: [], spells: [], fightingStyle: undefined, classEquipment: undefined, asi: undefined })}
        options={options.classes.map((x) => ({ value: x.name, label: `${x.name} (d${x.hitDie})` }))}
      />
      {homebrew && !cls && <input placeholder="…or a homebrew class" value={c.className ?? ""} onChange={(e) => set({ className: e.target.value || undefined })} />}
      {cls && <p className="muted small">Saves: {cls.savingThrows.map((s) => s.toUpperCase()).join(", ")} · Armor: {cls.armorTraining.join(", ") || "none"}{cls.spellcasting ? ` · Casts with ${ABILITY_LABELS[cls.spellcasting as AbilityKey]}` : ""}</p>}
      {cls?.subclassLevel !== undefined && view.level >= cls.subclassLevel && (
        <label className="cr-field">
          Subclass
          {homebrew ? (
            <input list="cr-subclasses" placeholder={cls.subclass ?? "Subclass"} value={c.subclass ?? ""} onChange={(e) => set({ subclass: e.target.value || undefined })} />
          ) : (
            <Select value={c.subclass} placeholder="Choose…" onChange={(v) => set({ subclass: v })} options={cls.subclass ? [{ value: cls.subclass, label: cls.subclass }] : []} />
          )}
          <datalist id="cr-subclasses">{cls.subclass && <option value={cls.subclass} />}</datalist>
        </label>
      )}
      <Issues view={view} fields={["className", "subclass"]} />
      {cls?.skillChoices && (
        <>
          <h3>Skills: pick {cls.skillChoices.count}</h3>
          {fixedSkills.length > 0 && <small className="muted">Already yours: {fixedSkills.join(", ")}</small>}
          <Chips all={skillOptions} picked={c.classSkills ?? []} max={cls.skillChoices.count} locked={fixedSkills} onChange={(classSkills) => set({ classSkills })} />
        </>
      )}
      <Issues view={view} fields={["classSkills"]} />
      {cls?.fightingStyle && (
        <label className="cr-field">
          Fighting Style
          <Select value={c.fightingStyle} placeholder="Choose…" onChange={(v) => set({ fightingStyle: v })} options={styles.map((f) => ({ value: f.name, label: f.name }))} />
          {(() => {
            const f = styles.find((x) => x.name === c.fightingStyle);
            return f ? <small className="muted">{f.text}</small> : null;
          })()}
        </label>
      )}
      <Issues view={view} fields={["fightingStyle"]} />
    </section>
  );
}

function AbilitiesStep({ c, set, view, options, creation }: StepProps) {
  const methods = view.settings.abilityMethods;
  const method = c.abilityMethod ?? methods[0];
  const base = c.baseAbilities ?? {};
  const bg = options.backgrounds.find((b) => b.name === c.background);
  const cls = options.classes.find((x) => x.name === c.className);
  const pattern = bonusPattern(c.backgroundBonuses);
  const pool = method === "rolled" ? (view.draft.rolledScores ?? []) : [...STANDARD_ARRAY];
  const final = view.preview?.abilities;
  const setBonus = (p: typeof pattern) => bg && set({ backgroundBonuses: applyBonusPattern(bg.abilities, p) });
  return (
    <section className="pl-card">
      <h2>Ability scores</h2>
      {methods.length > 1 && (
        <div className="pl-toggle">
          {methods.map((m) => (
            <button key={m} className={m === method ? "active" : ""} onClick={() => set({ abilityMethod: m, baseAbilities: m === "point_buy" ? Object.fromEntries(ABILITY_KEYS.map((k) => [k, 8])) : {} })}>
              {METHOD_LABELS[m]}
            </button>
          ))}
        </div>
      )}
      {method === "rolled" && !view.draft.rolledScores?.length && (
        <button className="primary pl-wide" disabled={creation.busy} onClick={() => creation.act("/roll-scores")}>🎲 Roll 4d6 ×6 (once)</button>
      )}
      {method === "rolled" && !!view.draft.rolledScores?.length && <p className="muted small">Your rolls: {view.draft.rolledScores.join(", ")}</p>}
      {method === "point_buy" && <p className="small">Points left: <b>{Number.isNaN(pointsLeft(base)) ? "?" : pointsLeft(base)}</b> / 27</p>}
      <div className="cr-abils">
        {ABILITY_KEYS.map((k) => (
          <div key={k} className="cr-abil">
            <small>{k.toUpperCase()}</small>
            {method === "point_buy" ? (
              <div className="cr-stepper">
                <button disabled={(base[k] ?? 8) <= 8} onClick={() => set({ baseAbilities: { ...base, [k]: (base[k] ?? 8) - 1 } })}>−</button>
                <b>{base[k] ?? 8}</b>
                <button disabled={(base[k] ?? 8) >= 15 || pointsLeft({ ...base, [k]: (base[k] ?? 8) + 1 }) < 0} onClick={() => set({ baseAbilities: { ...base, [k]: (base[k] ?? 8) + 1 } })}>+</button>
              </div>
            ) : null}
            {method === "point_buy" ? (
              <small className="muted">{POINT_BUY_COST[base[k] ?? 8]} pt</small>
            ) : (
              <select value={base[k] ?? ""} onChange={(e) => set({ baseAbilities: setArrayScore(base, k, e.target.value ? +e.target.value : undefined) })}>
                <option value="">–</option>
                {pool.map((v, i) => (
                  <option key={`${v}-${i}`} value={v}>{v}</option>
                ))}
              </select>
            )}
            {final && <span className="muted small">→ {final[k]} ({formatMod(abilityMod(final[k]))})</span>}
          </div>
        ))}
      </div>
      <Issues view={view} fields={["abilityMethod", "baseAbilities"]} />
      {bg && (
        <>
          <h3>{bg.name} bonus</h3>
          <div className="pl-toggle">
            <button className={pattern.kind === "21" ? "active" : ""} onClick={() => setBonus({ kind: "21" })}>+2 / +1</button>
            <button className={pattern.kind === "111" ? "active" : ""} onClick={() => setBonus({ kind: "111" })}>+1 / +1 / +1</button>
          </div>
          {pattern.kind === "21" && (
            <div className="row">
              <label>+2 <Select value={pattern.plus2} placeholder="–" onChange={(v) => setBonus({ ...pattern, plus2: v as AbilityKey })} options={bg.abilities.map((a) => ({ value: a, label: ABILITY_LABELS[a] }))} /></label>
              <label>+1 <Select value={pattern.plus1} placeholder="–" onChange={(v) => setBonus({ ...pattern, plus1: v as AbilityKey })} options={bg.abilities.filter((a) => a !== pattern.plus2).map((a) => ({ value: a, label: ABILITY_LABELS[a] }))} /></label>
            </div>
          )}
        </>
      )}
      <Issues view={view} fields={["backgroundBonuses"]} />
      {cls && cls.asiLevels.length > 0 && <AsiPicker c={c} set={set} levels={cls.asiLevels} options={options} />}
      <Issues view={view} fields={["asi"]} />
    </section>
  );
}

function AsiPicker({ c, set, levels, options }: { c: CreationChoices; set: StepProps["set"]; levels: number[]; options: CreationOptions }) {
  const picks: AsiPick[] = levels.map((_, i) => c.asi?.[i] ?? { feat: "Ability Score Improvement", increases: {} });
  const put = (i: number, p: AsiPick) => set({ asi: picks.map((x, n) => (n === i ? p : x)) });
  return (
    <>
      <h3>Ability Score Improvements</h3>
      {levels.map((lvl, i) => {
        const pick = picks[i];
        const feats = options.feats.filter((f) => f.category === "general" || (lvl >= 19 && f.category === "epic"));
        const feat = options.feats.find((f) => f.name === pick.feat);
        const total = ABILITY_KEYS.reduce((n, k) => n + (pick.increases[k] ?? 0), 0);
        const room = pick.feat === "Ability Score Improvement" ? 2 : 1;
        const allowed = feat?.abilities?.length ? feat.abilities : ABILITY_KEYS;
        return (
          <div key={lvl} className="cr-sub">
            <b>Level {lvl}</b>
            <Select value={pick.feat} placeholder="Feat…" onChange={(v) => put(i, { feat: v ?? "Ability Score Improvement", increases: {} })} options={feats.map((f) => ({ value: f.name, label: f.name }))} />
            <div className="chips">
              {allowed.map((k) => {
                const n = pick.increases[k] ?? 0;
                return (
                  <button key={k} type="button" className={`chip ${n ? "on" : ""}`} onClick={() => {
                    const next = { ...pick.increases };
                    const bumped = n + 1 <= (room === 2 ? 2 : 1) && total < room ? n + 1 : 0;
                    if (bumped) next[k] = bumped;
                    else delete next[k];
                    put(i, { ...pick, increases: next });
                  }}>
                    {k.toUpperCase()}{n ? ` +${n}` : ""}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}

function SpellsStep({ c, set, view, options }: StepProps) {
  const cls = options.classes.find((x) => x.name === c.className);
  if (!cls) return <section className="pl-card"><p className="muted">Pick a class first.</p></section>;
  const list = options.spells[cls.name] ?? [];
  if (!cls.cantrips && !cls.preparedSpells) {
    return <section className="pl-card"><p className="muted">A level {view.level} {cls.name} doesn't cast spells.</p><Issues view={view} fields={["cantrips", "spells"]} /></section>;
  }
  return (
    <section className="pl-card">
      {cls.cantrips > 0 && (
        <>
          <h2>Cantrips: {(c.cantrips ?? []).length} / {cls.cantrips}</h2>
          <Chips all={list.filter((s) => s.level === 0).map((s) => s.name)} picked={c.cantrips ?? []} max={cls.cantrips} onChange={(cantrips) => set({ cantrips })} />
          <Issues view={view} fields={["cantrips"]} />
        </>
      )}
      {cls.preparedSpells > 0 && (
        <>
          <h2>Prepared spells: {(c.spells ?? []).length} / {cls.preparedSpells}</h2>
          {Array.from({ length: cls.maxSpellLevel }, (_, i) => i + 1).map((lvl) => (
            <div key={lvl}>
              <h3>Level {lvl}</h3>
              <Chips all={list.filter((s) => s.level === lvl).map((s) => s.name)} picked={c.spells ?? []} max={cls.preparedSpells} onChange={(spells) => set({ spells })} />
            </div>
          ))}
          <Issues view={view} fields={["spells"]} />
        </>
      )}
    </section>
  );
}

function packageText(o: { items: { name: string; qty: number }[]; gold: number }) {
  return [...o.items.map((i) => (i.qty > 1 ? `${i.name} ×${i.qty}` : i.name)), ...(o.gold ? [`${o.gold} GP`] : [])].join(", ");
}

function GearStep({ c, set, view, options }: StepProps) {
  const cls = options.classes.find((x) => x.name === c.className);
  const bg = options.backgrounds.find((b) => b.name === c.background);
  const p = view.preview;
  return (
    <section className="pl-card">
      <h2>Starting equipment</h2>
      {!cls && !bg && <p className="muted">Pick a class and a background first.</p>}
      {cls && <Packages title={cls.name} options={cls.equipment} value={c.classEquipment} onChange={(v) => set({ classEquipment: v })} />}
      <Issues view={view} fields={["classEquipment"]} />
      {bg && <Packages title={bg.name} options={bg.equipment} value={c.backgroundEquipment} onChange={(v) => set({ backgroundEquipment: v })} />}
      <Issues view={view} fields={["backgroundEquipment"]} />
      <h3>Hit points and AC</h3>
      {p && <p className="small">The rules give <b>{c.maxHpOverride === undefined ? p.maxHp : "?"}</b> max HP and <b>AC {c.acOverride === undefined ? p.ac : "?"}</b> with this gear.</p>}
      <div className="row">
        <label>Custom max HP <input type="number" min={1} value={c.maxHpOverride ?? ""} onChange={(e) => set({ maxHpOverride: e.target.value ? +e.target.value : undefined })} /></label>
        <label>Custom AC <input type="number" min={0} value={c.acOverride ?? ""} onChange={(e) => set({ acOverride: e.target.value ? +e.target.value : undefined })} /></label>
      </div>
      <small className="muted">Leave these empty to use the rules. Custom numbers may need the host's approval.</small>
      <Issues view={view} fields={["maxHpOverride", "acOverride"]} />
    </section>
  );
}

function Packages({ title, options, value, onChange }: { title: string; options: { letter: string; items: { name: string; qty: number }[]; gold: number }[]; value: string | undefined; onChange: (v: string) => void }) {
  return (
    <div className="cr-sub">
      <b>{title}</b>
      {options.map((o) => (
        <label key={o.letter} className={`cr-package ${value === o.letter ? "on" : ""}`}>
          <input type="radio" checked={value === o.letter} onChange={() => onChange(o.letter)} />
          <span><b>{o.letter}</b> {packageText(o)}</span>
        </label>
      ))}
    </div>
  );
}

function DetailsStep({ c, set, view, creation }: StepProps) {
  const d = view.draft;
  const text = (k: "personality" | "ideals" | "bonds" | "flaws", label: string, hint: string) => (
    <label className="cr-field">
      {label}
      <input placeholder={hint} value={c[k] ?? ""} onChange={(e) => set({ [k]: e.target.value || undefined })} />
    </label>
  );
  return (
    <section className="pl-card">
      <h2>Who are they?</h2>
      <label className="cr-field">
        Name
        <input value={c.name ?? ""} onChange={(e) => set({ name: e.target.value || undefined })} />
      </label>
      <Issues view={view} fields={["name"]} />
      <label className="cr-field">
        Appearance (draws the portrait)
        <textarea rows={2} placeholder="e.g. stocky red-bearded dwarf in dented plate armor" value={c.appearance ?? ""} onChange={(e) => set({ appearance: e.target.value || undefined })} />
      </label>
      <div className="cr-portrait">
        {d.portraitUrl ? <img src={d.portraitUrl} alt="" /> : <div className="cr-portrait-empty">🖼</div>}
        <div>
          <button disabled={creation.busy || d.portraitBusy || !c.name || !c.appearance} onClick={() => creation.act("/portrait", { fresh: !!d.portraitUrl })}>
            {d.portraitBusy ? "Drawing…" : d.portraitUrl ? "Redraw portrait" : "Draw portrait"}
          </button>
          <small className="muted"> {d.portraitDraws}/6 used</small>
        </div>
      </div>
      <Issues view={view} fields={["appearance"]} />
      {text("personality", "Personality", "Blunt, loyal, laughs too loud")}
      {text("ideals", "Ideals", "Freedom: chains are meant to be broken")}
      {text("bonds", "Bonds", "My sister, still lost in the city")}
      {text("flaws", "Flaws", "I never back down from a dare")}
      <label className="cr-field">
        Backstory
        <textarea rows={4} value={c.backstory ?? ""} onChange={(e) => set({ backstory: e.target.value || undefined })} />
      </label>
      <h3>Dice</h3>
      <div className="pl-toggle">
        {(["virtual", "physical"] as const).map((m) => (
          <button key={m} className={(c.diceMode ?? "virtual") === m ? "active" : ""} onClick={() => set({ diceMode: m })}>
            {m === "virtual" ? "📱 Roll here" : "🎲 Real dice"}
          </button>
        ))}
      </div>
    </section>
  );
}
