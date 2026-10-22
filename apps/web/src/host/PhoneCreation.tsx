import { useCallback, useEffect, useState } from "react";
import type { AbilityMethod, Campaign, CreationView } from "@dm/shared";
import { api, patch } from "../lib/api";
import { onCreation } from "../lib/useServer";
import { METHOD_LABELS } from "../player/creation/view";

type Run = (fn: () => Promise<unknown>) => Promise<void>;
type Pending = CreationView & { playerName: string };

/**
 * Host Party tab: rules for players creating characters on their phones (level, ability methods,
 * homebrew, the edit lock) and the characters they sent for approval.
 */
export function PhoneCreationCard({ campaign, run, onRosterChange }: { campaign: Campaign; run: Run; onRosterChange: () => void }) {
  const [pending, setPending] = useState<Pending[]>([]);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const load = useCallback(() => {
    api<{ pending: Pending[] }>("/creation/pending")
      .then((r) => setPending(r.pending))
      .catch(() => undefined);
  }, []);
  useEffect(load, [load, campaign.id]);
  useEffect(
    () =>
      onCreation((ev) => {
        load();
        if (ev.status === "joined") onRosterChange(); // a phone join saves the hero to the roster
      }),
    [load, onRosterChange],
  );
  const s = campaign.creation;
  const setCreation = (creation: Partial<typeof s>) => run(() => patch("/campaign/settings", { creation }));
  const toggleMethod = (m: AbilityMethod, on: boolean) => {
    const next = on ? [...new Set([...s.abilityMethods, m])] : s.abilityMethods.filter((x) => x !== m);
    if (next.length) void setCreation({ abilityMethods: next });
  };
  const locked = s.playStartedAt !== undefined;
  return (
    <section className="card">
      <h2>Character creation on phones</h2>
      <div className="row wrap">
        <label className="row" title="Players can create their own character on /player (by hand, with the AI helper, or from the roster)">
          <input type="checkbox" checked={s.phoneCreation} onChange={(e) => setCreation({ phoneCreation: e.target.checked })} /> Players create on their phones
        </label>
        <label>
          Starting level{" "}
          <input type="number" min={1} max={20} value={campaign.partyLevel} onChange={(e) => e.target.value && run(() => patch("/campaign/settings", { partyLevel: +e.target.value }))} style={{ width: 60 }} />
        </label>
      </div>
      <div className="row wrap">
        <span className="muted">Ability scores:</span>
        {(Object.keys(METHOD_LABELS) as AbilityMethod[]).map((m) => (
          <label key={m} className="row">
            <input type="checkbox" checked={s.abilityMethods.includes(m)} onChange={(e) => toggleMethod(m, e.target.checked)} /> {METHOD_LABELS[m]}
          </label>
        ))}
        <label className="row" title="Names found in rules/custom (house rules) pass the check as warnings instead of errors">
          <input type="checkbox" checked={s.allowHomebrew} onChange={(e) => setCreation({ allowHomebrew: e.target.checked })} /> Allow homebrew
        </label>
      </div>
      <div className="row">
        <span className="grow muted small">
          {locked ? `🔒 Play started ${new Date(s.playStartedAt!).toLocaleString()}: players can't edit their characters.` : "Players can edit their phone-made characters until the DM starts the session."}
        </span>
        <button className="small" onClick={() => run(() => api("/campaign/creation-lock", { locked: !locked }))}>
          {locked ? "Unlock edits" : "Lock edits now"}
        </button>
      </div>

      {pending.length > 0 && <h3>Waiting for your approval</h3>}
      {pending.map((p) => {
        const id = p.draft.playerId;
        const ch = p.preview;
        return (
          <div key={id} className="pending-creation">
            <div className="row">
              {p.draft.portraitUrl && <img src={p.draft.portraitUrl} alt="" className="pending-portrait" />}
              <div className="grow">
                <b>{ch?.name ?? p.draft.choices.name ?? "?"}</b> <span className="muted">({p.playerName})</span>
                {ch && <div className="muted small">{ch.species} {ch.className} {p.level} · AC {ch.ac} · HP {ch.maxHp} · {(["str", "dex", "con", "int", "wis", "cha"] as const).map((k) => `${k.toUpperCase()} ${ch.abilities[k]}`).join(" ")}</div>}
              </div>
            </div>
            {p.draft.playerNote && <p className="small">“{p.draft.playerNote}”</p>}
            <ul className="small bad">{p.validation.errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul>
            <div className="row">
              <input className="grow" placeholder="Message if you send it back" value={messages[id] ?? ""} onChange={(e) => setMessages((m) => ({ ...m, [id]: e.target.value }))} />
              <button onClick={() => run(async () => (await api(`/creation/${id}/return`, { message: messages[id] ?? "" }), load()))}>Send back</button>
              <button className="primary" onClick={() => run(async () => (await api(`/creation/${id}/approve`, {}), load()))}>Approve</button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
