import { useEffect, useRef, useState } from "react";
import { api, patch } from "../lib/api";
import type { ServerView } from "../lib/useServer";
import { floorLabel } from "../lib/floor";
import { HistoryControls } from "./HistoryControls";
import { HostTalkButton } from "./hostTalkButton";
import { PartySpotlight } from "./PartySpotlight";
import { LOST_CALL_GRACE_MS, lostCall, offlineSince, type LostCallInput } from "./lostCall";

type Run = (fn: () => Promise<unknown>) => Promise<void>;

interface RuleHit {
  id: string;
  title: string;
  source: string;
  text: string;
}

/** True when the table's call is live but the server DM has been offline for LOST_CALL_GRACE_MS. */
function useLostCall(input: LostCallInput): boolean {
  const since = useRef<number | null>(null);
  const [, setTick] = useState(0);
  const now = Date.now();
  since.current = offlineSince(since.current, input, now);
  const shown = lostCall({ ...input, offlineSince: since.current, now });
  useEffect(() => {
    if (since.current === null || shown) return;
    const t = setTimeout(() => setTick((n) => n + 1), Math.max(0, since.current + LOST_CALL_GRACE_MS - Date.now()) + 50);
    return () => clearTimeout(t);
  }, [input.link, input.dmStatus, input.wsConnected, shown]);
  return shown;
}

export function PlayTab({ view, run }: { view: ServerView; run: Run }) {
  const { state, dm, speaker } = view;
  const [text, setText] = useState("");
  const [asPlayer, setAsPlayer] = useState("");
  const [whisper, setWhisper] = useState("");
  const [physical, setPhysical] = useState("");
  /** Host override of a pending damage roll's critical flag (null: the pending roll's own). */
  const [critOverride, setCritOverride] = useState<boolean | null>(null);
  const pr = state?.pendingRoll;
  const pendingKey = pr ? `${pr.characterId}:${pr.kind}:${pr.label}:${pr.notation}:${pr.targetId ?? ""}:${pr.critical ? 1 : 0}` : "";
  useEffect(() => setCritOverride(null), [pendingKey]); // a new pending roll starts from its own flag
  const [notation, setNotation] = useState("1d20");
  const [target, setTarget] = useState("");
  // end_combat outcome ("" = let the server detect it) and end_campaign inputs.
  const [combatOutcome, setCombatOutcome] = useState<"" | "victory" | "fled" | "defeat">("");
  const [campaignOutcome, setCampaignOutcome] = useState<"success" | "failure">("success");
  const [epilogue, setEpilogue] = useState("");
  const [amount, setAmount] = useState(5);
  const [npcName, setNpcName] = useState("");
  const [npcFollows, setNpcFollows] = useState(true);
  const [ruleQ, setRuleQ] = useState("");
  const [rules, setRules] = useState<RuleHit[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  // The voice call runs on /table; this page only sends it commands and shows its state.
  const link = { state: view.voiceOwner?.link ?? "idle", error: view.voiceOwner?.error };
  const tableOpen = view.voiceOwner?.table ?? true;
  const callLost = useLostCall({ link: link.state, dmStatus: dm.status, wsConnected: view.connected });
  // "connecting" after the DM was already up means the server is re-attaching the sideband.
  const wasLive = useRef(false);
  if (dm.status === "offline") wasLive.current = false;
  else if (dm.status !== "connecting") wasLive.current = true;

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [state?.log.length]);

  if (!state) return <p className="muted">Create or load a campaign first.</p>;
  const live = dm.status !== "offline";
  const combatants = [...state.characters.map((c) => ({ id: c.id, name: c.name })), ...state.monsters.map((m) => ({ id: m.id, name: m.name }))];
  const pendingChar = state.pendingRoll && state.characters.find((c) => c.id === state.pendingRoll!.characterId);

  const startVoice = () => run(() => api("/dm/voice/start", {}));
  const reconnect = () => run(() => api("/dm/voice/reconnect", {}));
  const stop = () => run(() => api("/dm/stop", {}));

  return (
    <div className="play">
      <section className="card">
        <h2>Dungeon Master</h2>
        <div className="row wrap">
          {!live ? (
            <>
              <button className="primary big" onClick={startVoice} disabled={!tableOpen} title={tableOpen ? "The table screen runs the mic and the DM's voice" : "Open the table screen first"}>
                🗣 Start voice DM
              </button>
              <button onClick={() => run(() => api("/dm/text", {}))}>⌨ Start text-only DM</button>
            </>
          ) : (
            <>
              <button
                className="big"
                disabled={dm.status !== "speaking" && dm.status !== "thinking"}
                onClick={() => run(() => api("/dm/stop-talking", {}))}
                title="Cut the DM off mid-sentence (talking over it no longer does)"
              >
                ✋ Stop talking
              </button>
              <button className="danger big" onClick={stop}>
                ⏹ Stop DM ({dm.mode})
              </button>
            </>
          )}
          <button
            className={`big mic-toggle ${view.micMuted ? "on" : ""}`}
            onClick={() => run(() => api("/mic", { muted: !view.micMuted, source: "host-button" }))}
            title="Hard mute: the DM hears nothing (a sentence it is saying still finishes). Hotkey P; the TV (P) and phones can toggle it too."
          >
            {view.micMuted ? "🎙 Unmute (DM not listening)" : "🔇 Mute table mic"}
          </button>
          {view.floor && (
            <button
              className={`ptt-toggle ${view.floor.pushToTalk ? "on" : ""}`}
              onClick={() => run(() => api("/push-to-talk", { on: !view.floor?.pushToTalk }))}
              title="Push-to-talk: the DM hears a voice turn only while someone holds Space on the TV, the Talk button here or the talk button on a phone. Off: open mic (voice ID tells players apart)."
            >
              {view.floor.pushToTalk ? "✋ Push-to-talk: on" : "🎙 Open mic"}
            </button>
          )}
          <HostTalkButton floor={view.floor ?? null} players={view.state?.players ?? []} />
          {view.floor?.pushToTalk && view.floor.holder && (
            <>
              <span className="pill ok">{floorLabel(view.floor, view.state?.players ?? [])}</span>
              <button
                className="small"
                onClick={() => run(() => api("/floor/release"))}
                title="Take the push-to-talk floor back from whoever holds it (a stuck or hogged button)."
              >
                Free the floor
              </button>
            </>
          )}
          <span className={`pill dm-${dm.status}`}>{dm.status === "connecting" && wasLive.current ? "reconnecting…" : dm.status}</span>
          {link.state !== "idle" && (
            <>
              <span className={`pill ${link.state === "connected" ? "ok" : link.state === "failed" ? "bad" : ""}`} title="Browser WebRTC link to the voice DM">
                voice link: {link.state === "reconnecting" ? "reconnecting…" : link.state}
              </span>
              <button onClick={reconnect} title="Build a new voice call; the DM continues where it was">
                ↻ Reconnect
              </button>
            </>
          )}
        </div>
        {link.state === "failed" && link.error && <p className="muted">{link.error}</p>}
        {!tableOpen && (
          <div className="notice" role="alert">
            <p>
              <strong>The table screen is closed.</strong> It runs the mic and the DM's voice: open it on this laptop to start or keep the voice DM.
            </p>
            <a className="button primary" href="/table" target="_blank" rel="noreferrer">
              Open the table screen ↗
            </a>
          </div>
        )}
        {callLost && (
          <div className="notice" role="alert">
            <p>
              <strong>The server lost the voice call.</strong> Players can still talk to the DM, but no rolls, damage, moves or
              speaker ID will happen (the server probably restarted).
            </p>
            <button className="primary" onClick={reconnect} title="Build a new voice call; the DM continues where it was">
              ↻ Reconnect voice DM
            </button>
          </div>
        )}

        <h3>Who's speaking?</h3>
        <p className="muted">Voice ID picks this automatically. Tap a name to override the next turn.</p>
        <div className="row wrap">
          {state.players.map((p) => {
            const ch = state.characters.find((c) => c.id === p.characterId);
            const active = speaker?.playerId === p.id && Date.now() - speaker.ts < 15000;
            return (
              <button key={p.id} className={active ? "active" : ""} style={{ borderColor: ch?.color }} onClick={() => run(() => api("/speaker", { playerId: p.id }))}>
                {p.name}
                {ch ? ` · ${ch.name}` : ""}
                {p.voiceSamples ? "" : " (no voice)"}
              </button>
            );
          })}
        </div>

        {pendingChar && state.pendingRoll && (
          <div className="pending">
            <b>{pendingChar.name}</b> is rolling <b>{state.pendingRoll.notation}</b> {state.pendingRoll.kind === "damage" ? `damage${state.pendingRoll.critical ? " 💥 critical" : ""} (applied to the target when entered)` : `for ${state.pendingRoll.label}`} (physical dice).
            <div className="row">
              <input type="number" placeholder="Total" value={physical} onChange={(e) => setPhysical(e.target.value)} />
              {state.pendingRoll.kind === "damage" && (
                <label>
                  <input type="checkbox" checked={critOverride ?? !!state.pendingRoll.critical} onChange={(e) => setCritOverride(e.target.checked)} /> 💥 Critical
                </label>
              )}
              <button
                className="primary"
                disabled={!physical}
                onClick={() =>
                  run(async () => {
                    const critical = state.pendingRoll?.kind === "damage" ? (critOverride ?? !!state.pendingRoll.critical) : undefined;
                    await api("/rolls/physical", { total: Number(physical), critical });
                    setPhysical("");
                    setCritOverride(null);
                  })
                }
              >
                Enter roll
              </button>
            </div>
          </div>
        )}

        {state.players.some((p) => p.ai) && (
          <>
            <h3>AI players</h3>
            <ul className="list">
              {state.players
                .filter((p) => p.ai)
                .map((p) => {
                  const ai = view.aiPlayers[p.id];
                  const ch = state.characters.find((c) => c.id === p.characterId);
                  return (
                    <li key={p.id} className="row">
                      <b>
                        🤖 {p.name}
                        {ch ? ` (${ch.name})` : ""}
                      </b>
                      <span className={p.aiPaused ? "muted" : ai?.status === "idle" || !ai ? "muted" : "ok"}>{p.aiPaused ? "paused" : !ch ? "no character" : (ai?.status ?? "idle")}</span>
                      {ai?.line && <span className="hint grow">“{ai.line}”</span>}
                      <button className="small" onClick={() => run(() => patch(`/players/${p.id}`, { aiPaused: !p.aiPaused }))}>
                        {p.aiPaused ? "▶ Resume" : "⏸ Pause"}
                      </button>
                      <button
                        className="small"
                        disabled={p.aiPaused || !ch || view.dm.status === "offline" || (ai && ai.status !== "idle")}
                        title="Make this AI player say or do something now"
                        onClick={() =>
                          run(async () => {
                            const res = (await api(`/players/${p.id}/ai/nudge`, {})) as { ok: boolean; error?: string };
                            if (!res.ok) throw new Error(res.error ?? "Nudge failed");
                          })
                        }
                      >
                        👉 Nudge
                      </button>
                    </li>
                  );
                })}
            </ul>
          </>
        )}

        <h3>Type to the DM</h3>
        <div className="row">
          <select value={asPlayer} onChange={(e) => setAsPlayer(e.target.value)}>
            <option value="">as…</option>
            {state.players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            className="grow"
            placeholder="I search the altar for traps."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && text && run(async () => (await api("/dm/say", { text, playerId: asPlayer || undefined }), setText("")))}
          />
        </div>
        <div className="row">
          <input className="grow" placeholder="Whisper to the DM (players won't hear): 'raise the stakes', 'wrap up this scene'…" value={whisper} onChange={(e) => setWhisper(e.target.value)} onKeyDown={(e) => e.key === "Enter" && whisper && run(async () => (await api("/dm/whisper", { text: whisper }), setWhisper("")))} />
        </div>
      </section>

      <section className="card log-card">
        <h2>Table log</h2>
        <div className="log" ref={logRef}>
          {state.log.map((l) => (
            <div key={l.id} className={`log-${l.kind}`}>
              {l.speaker && <b>{l.speaker}: </b>}
              {l.text}
            </div>
          ))}
        </div>
      </section>

      {/* Party split: switch the TV between the groups from here during play. */}
      {view.campaign && Object.keys(state.scenes ?? {}).length > 0 && <PartySpotlight campaign={view.campaign} state={state} run={run} compact />}

      <section className="card">
        <h2>Manual controls</h2>
        <HistoryControls version={state.version} run={run} />
        <div className="row">
          <input value={notation} onChange={(e) => setNotation(e.target.value)} style={{ width: 120 }} />
          <button onClick={() => run(() => api("/tools/roll_dice", { notation, label: "DM roll" }))}>Roll</button>
          {["1d20", "2d20kh1", "1d6", "2d6", "1d8", "1d10", "1d12", "1d100", "8d6"].map((n) => (
            <button key={n} className="small" onClick={() => run(() => api("/tools/roll_dice", { notation: n, label: n }))}>
              {n}
            </button>
          ))}
        </div>
        <div className="row">
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">target…</option>
            {combatants.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input type="number" min={0} value={amount} onChange={(e) => setAmount(+e.target.value)} style={{ width: 70 }} />
          <button disabled={!target} onClick={() => run(() => api("/tools/apply_damage", { target_id: target, amount }))}>
            Damage
          </button>
          <button disabled={!target} onClick={() => run(() => api("/tools/heal", { target_id: target, amount }))}>
            Heal
          </button>
          <button disabled={!target || !state.monsters.some((m) => m.id === target)} onClick={() => run(() => api("/tools/remove_monster", { monster_id: target }))}>
            Remove
          </button>
        </div>
        <div className="row">
          <button onClick={() => run(() => api("/tools/start_combat", {}))}>⚔ Start combat</button>
          <button disabled={!state.combat.active} onClick={() => run(() => api("/tools/next_turn", {}))}>
            Next turn ▶
          </button>
          <select value={combatOutcome} disabled={!state.combat.active} onChange={(e) => setCombatOutcome(e.target.value as typeof combatOutcome)} title="How the fight ended (auto: the server decides from HP)">
            <option value="">auto</option>
            <option value="victory">Victory</option>
            <option value="fled">Fled</option>
            <option value="defeat">Defeat</option>
          </select>
          <button disabled={!state.combat.active} onClick={() => run(() => api("/tools/end_combat", combatOutcome ? { outcome: combatOutcome } : {}))}>
            End combat
          </button>
        </div>
        <div className="row">
          {/* The campaign's story is over (not a single fight): the TV shows the campaign-complete screen. */}
          {view.campaign && view.campaign.status !== "active" ? (
            <button disabled title="Reset the campaign to reopen it">
              🏁 Campaign {view.campaign.status}
            </button>
          ) : (
            <>
              <select value={campaignOutcome} onChange={(e) => setCampaignOutcome(e.target.value as "success" | "failure")}>
                <option value="success">success</option>
                <option value="failure">failure</option>
              </select>
              <input className="grow" placeholder="Epilogue (optional)…" value={epilogue} onChange={(e) => setEpilogue(e.target.value)} />
              <button
                disabled={!view.campaign}
                onClick={() =>
                  confirm(`End the campaign as a ${campaignOutcome}? This closes the story.`) &&
                  run(() => api("/tools/end_campaign", { outcome: campaignOutcome, ...(epilogue.trim() ? { epilogue: epilogue.trim() } : {}) }))
                }
              >
                🏁 End campaign
              </button>
            </>
          )}
        </div>
        <div className="row">
          {/* Outline NPCs keep their look; the token stands next to the party. */}
          <input list="outline-npcs" placeholder="NPC name…" value={npcName} onChange={(e) => setNpcName(e.target.value)} />
          <datalist id="outline-npcs">
            {(view.campaign?.outline?.npcs ?? []).map((n) => (
              <option key={n.name} value={n.name} />
            ))}
          </datalist>
          <label className="muted">
            <input type="checkbox" checked={npcFollows} onChange={(e) => setNpcFollows(e.target.checked)} /> follows party
          </label>
          <button disabled={!npcName.trim()} onClick={() => run(() => api("/tools/add_npc", { name: npcName.trim(), follows: npcFollows }))}>
            Add NPC
          </button>
        </div>
        <h3>Rules lookup</h3>
        <div className="row">
          <input className="grow" placeholder="grappled, fireball, opportunity attack…" value={ruleQ} onChange={(e) => setRuleQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run(async () => setRules(await api<RuleHit[]>("/rules/search", { q: ruleQ })))} />
          <button onClick={() => run(async () => setRules(await api<RuleHit[]>("/rules/search", { q: ruleQ })))}>Search</button>
        </div>
        <div className="rules">
          {rules.map((r) => (
            <details key={r.id}>
              <summary>
                {r.title} <span className="muted">{r.source}</span>
              </summary>
              <pre>{r.text}</pre>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
