import { abilityMod, formatMod, type Character } from "@dm/shared";
import { ABILITY_KEYS, deathSaveView, hitDiceLabel, isSaveProficient, isSkillProficient, personaRows, resourceRows, saveMod, SKILLS, skillMod, slotRows } from "../player/sheet";
import { detailSections } from "./characterDetails";

/** Read-only full sheet under an expanded Party tab row (the Edit button changes it). */
export function CharacterDetails({ c }: { c: Character }) {
  const show = detailSections(c);
  const ds = deathSaveView(c);
  const slots = slotRows(c);
  const res = resourceRows(c);
  const hd = hitDiceLabel(c);
  return (
    <div className="char-details" style={{ borderColor: c.color }}>
      <div className="cd-stats">
        <span>HP <b>{c.hp}/{c.maxHp}</b>{c.tempHp ? <span className="muted"> +{c.tempHp} temp</span> : null}</span>
        <span>AC <b>{c.ac}</b></span>
        <span>Speed <b>{c.speed}</b></span>
        <span>Prof <b>{formatMod(c.proficiencyBonus)}</b></span>
        <span>Passive Perception <b>{10 + skillMod(c, "Perception", "wis")}</b></span>
        <span>💰 <b>{c.gold}</b> gp</span>
        {c.background && <span className="muted">Background: {c.background}</span>}
        {c.subclass && <span className="muted">Subclass: {c.subclass}</span>}
      </div>
      {(c.conditions.length > 0 || c.concentration || ds) && (
        <div className="chips">
          {c.conditions.map((x) => <span key={x} className="chip bad">{x}</span>)}
          {c.concentration && <span className="chip on">◎ Concentrating: {c.concentration.spell}</span>}
          {ds?.state === "dead" && <span className="chip bad">☠ Dead</span>}
          {ds?.state === "stable" && <span className="chip">✚ Stable</span>}
          {ds?.state === "dying" && <span className="chip bad">Death saves ✓{c.deathSaves.successes} ✗{c.deathSaves.failures}</span>}
        </div>
      )}

      <div className="cd-abils">
        {ABILITY_KEYS.map((k) => (
          <div key={k} className="cd-abil">
            <small>{k.toUpperCase()}</small>
            <b>{formatMod(abilityMod(c.abilities[k]))}</b>
            <span className="muted">{c.abilities[k]}</span>
            <span className={`save ${isSaveProficient(c, k) ? "prof" : ""}`}>save {formatMod(saveMod(c, k))}</span>
          </div>
        ))}
      </div>

      <h4>Skills</h4>
      <ul className="cd-skills">
        {SKILLS.map(([name, ab]) => (
          <li key={name} className={isSkillProficient(c, name) ? "prof" : ""}>
            <span>{name} <small className="muted">{ab}</small></span>
            <b>{formatMod(skillMod(c, name, ab))}</b>
          </li>
        ))}
      </ul>

      {show.attacks && (
        <>
          <h4>Attacks</h4>
          <ul className="cd-list">
            {c.attacks.map((a, i) => (
              <li key={i}>
                <b>{a.name}</b> {a.toHit !== undefined && <span>{formatMod(a.toHit)} to hit</span>} {a.damage && <span className="muted">· {a.damage}</span>}
                {a.description && <div className="muted small">{a.description}</div>}
              </li>
            ))}
          </ul>
        </>
      )}

      {show.rules && (
        <>
          <h4>Slots &amp; resources</h4>
          <ul className="cd-list">
            {slots.map((r) => (
              <li key={r.key} className="cd-pool">
                <span className="lbl">{r.label}</span>
                <span className="pips">{r.pips.map((on, i) => <i key={i} className={`pip ${on ? "on" : ""}`} />)}</span>
                <span className="muted">{r.left}/{r.max}</span>
              </li>
            ))}
            {hd && (
              <li className="cd-pool">
                <span className="lbl">Hit Dice</span>
                <span className="muted">{hd}</span>
              </li>
            )}
            {res.map((r) => (
              <li key={r.name} className="cd-pool" title={r.note}>
                <span className="lbl">{r.name}</span>
                <span className="pips">{r.pips?.map((on, i) => <i key={i} className={`pip ${on ? "on" : ""}`} />)}</span>
                <span className="muted">{r.left}/{r.max} · {r.reset}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {show.spells && (
        <>
          <h4>Spells</h4>
          <div className="chips">{c.spells.map((s) => <span key={s} className="chip">{s}</span>)}</div>
        </>
      )}

      {show.features && (
        <>
          <h4>Features</h4>
          <ul className="cd-list">{c.features.map((x) => <li key={x}>{x}</li>)}</ul>
        </>
      )}

      <h4>Inventory</h4>
      {c.inventory.length === 0 && <p className="muted small">Empty.</p>}
      <ul className="cd-list">
        {c.inventory.map((i) => (
          <li key={i.id}>
            <details>
              <summary>
                {i.iconUrl && <img className="inv-icon" src={i.iconUrl} alt="" />}
                <b>{i.name}</b>
                {i.qty > 1 && <span className="muted"> ×{i.qty}</span>}
                {i.equipped && <span className="chip">equipped</span>}
              </summary>
              <p className="muted small">{i.description || "No description."}</p>
            </details>
          </li>
        ))}
      </ul>

      {show.about && (
        <>
          <h4>About</h4>
          {c.appearance.trim() && <p className="muted"><b>Appearance:</b> {c.appearance}</p>}
          {personaRows(c).map((r) => (
            <p key={r.label} className="muted"><b>{r.label}:</b> {r.text}</p>
          ))}
          {c.notes.trim() && <p className="muted"><b>Notes:</b> {c.notes}</p>}
        </>
      )}
    </div>
  );
}
