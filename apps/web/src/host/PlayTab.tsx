import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { VoiceLink, VoiceLinkState } from "../lib/voice";
import type { ServerView } from "../lib/useServer";
import type { MicControl } from "./HostPage";
import { HistoryControls } from "./HistoryControls";

type Run = (fn: () => Promise<unknown>) => Promise<void>;

interface RuleHit {
  id: string;
  title: string;
  source: string;
  text: string;
}

function useVoiceLinkState(link: VoiceLink): { state: VoiceLinkState; error?: string } {
  const [, setTick] = useState(0);
  useEffect(() => link.subscribe(() => setTick((n) => n + 1)), [link]);
  return { state: link.state, error: link.error };
}

export function PlayTab({ view, run, mic }: { view: ServerView; run: Run; mic: MicControl }) {
  const { state, dm, speaker } = view;
  const [text, setText] = useState("");
  const [asPlayer, setAsPlayer] = useState("");
  const [whisper, setWhisper] = useState("");
  const [physical, setPhysical] = useState("");
  const [notation, setNotation] = useState("1d20");
  const [target, setTarget] = useState("");
  const [amount, setAmount] = useState(5);
  const [ruleQ, setRuleQ] = useState("");
  const [rules, setRules] = useState<RuleHit[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const link = useVoiceLinkState(mic.voice);
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

  const startVoice = () =>
    run(async () => {
      const stream = await mic.enable();
      await mic.voice.start(stream);
    });
  const stop = () =>
    run(async () => {
      mic.voice.stop();
      await api("/dm/stop", {});
    });

  return (
    <div className="play">
      <section className="card">
        <h2>Dungeon Master</h2>
        <div className="row wrap">
          {!live ? (
            <>
              <button className="primary big" onClick={startVoice}>
                🗣 Start voice DM
              </button>
              <button onClick={() => run(() => api("/dm/text", {}))}>⌨ Start text-only DM</button>
            </>
          ) : (
            <button className="danger big" onClick={stop}>
              ⏹ Stop DM ({dm.mode})
            </button>
          )}
          <span className={`pill dm-${dm.status}`}>{dm.status === "connecting" && wasLive.current ? "reconnecting…" : dm.status}</span>
          {link.state !== "idle" && (
            <>
              <span className={`pill ${link.state === "connected" ? "ok" : link.state === "failed" ? "bad" : ""}`} title="Browser WebRTC link to the voice DM">
                voice link: {link.state === "reconnecting" ? "reconnecting…" : link.state}
              </span>
              <button onClick={() => run(() => mic.voice.reconnect())} title="Build a new voice call; the DM continues where it was">
                ↻ Reconnect
              </button>
            </>
          )}
        </div>
        {link.state === "failed" && link.error && <p className="muted">{link.error}</p>}

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
            <b>{pendingChar.name}</b> is rolling <b>{state.pendingRoll.notation}</b> for {state.pendingRoll.label} (physical dice).
            <div className="row">
              <input type="number" placeholder="Total" value={physical} onChange={(e) => setPhysical(e.target.value)} />
              <button className="primary" disabled={!physical} onClick={() => run(async () => (await api("/rolls/physical", { total: Number(physical) }), setPhysical("")))}>
                Enter roll
              </button>
            </div>
          </div>
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
          <button disabled={!state.combat.active} onClick={() => run(() => api("/tools/end_combat", {}))}>
            End combat
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
