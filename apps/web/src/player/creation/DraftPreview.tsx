import { abilityMod, formatMod, type Character } from "@dm/shared";
import { ABILITY_KEYS } from "../sheet";

/** The character the draft builds (server-derived), as a compact sheet. */
export function DraftPreview({ ch, portraitUrl, level }: { ch: Character | null; portraitUrl?: string; level: number }) {
  if (!ch) return <section className="pl-card cr-preview"><p className="muted">Your character appears here once it has a name.</p></section>;
  return (
    <section className="pl-card cr-preview">
      <div className="cr-preview-head">
        {portraitUrl ? <img src={portraitUrl} alt="" /> : <div className="cr-portrait-empty">🖼</div>}
        <div>
          <h2>{ch.name}</h2>
          <div className="muted small">
            {[ch.species, ch.className, ch.subclass && `(${ch.subclass})`, `level ${level}`].filter(Boolean).join(" ")}
            {ch.background ? ` · ${ch.background}` : ""}
          </div>
        </div>
      </div>
      <div className="pl-stats">
        <div><small>AC</small><b>{ch.ac}</b></div>
        <div><small>HP</small><b>{ch.maxHp}</b></div>
        <div><small>Speed</small><b>{ch.speed}</b></div>
        <div><small>Prof</small><b>{formatMod(ch.proficiencyBonus)}</b></div>
      </div>
      <div className="pl-abils cr-preview-abils">
        {ABILITY_KEYS.map((k) => (
          <div key={k} className="pl-abil">
            <small>{k.toUpperCase()}</small>
            <b>{formatMod(abilityMod(ch.abilities[k]))}</b>
            <span className="muted">{ch.abilities[k]}</span>
          </div>
        ))}
      </div>
      {ch.skills.length > 0 && <p className="small"><b>Skills:</b> {ch.skills.join(", ")}</p>}
      {ch.attacks.length > 0 && <p className="small"><b>Attacks:</b> {ch.attacks.map((a) => `${a.name} ${a.toHit !== undefined ? formatMod(a.toHit) : ""} ${a.damage ?? ""}`.trim()).join(" · ")}</p>}
      {ch.spells.length > 0 && <p className="small"><b>Spells:</b> {ch.spells.join(", ")}</p>}
      {ch.spellSlots.length > 0 && <p className="small muted">Slots: {ch.spellSlots.map((s) => `${s.max}× level ${s.level}`).join(", ")}</p>}
      <details>
        <summary className="small">Features, gear and notes</summary>
        <ul className="pl-list small">{ch.features.map((f) => <li key={f}>{f}</li>)}</ul>
        <p className="small">{ch.inventory.map((i) => (i.qty > 1 ? `${i.name} ×${i.qty}` : i.name)).join(", ")} · {ch.gold} gp</p>
        {ch.notes && <p className="small muted">{ch.notes}</p>}
      </details>
    </section>
  );
}
