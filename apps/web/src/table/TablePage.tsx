import { useCallback, useEffect, useRef, useState } from "react";
import type { Character, GameState, RollResult } from "@dm/shared";
import { naturalD20 } from "@dm/shared";
import { useServer } from "../lib/useServer";
import { MapBoard } from "./MapBoard";
import { DiceTray } from "../dice/DiceTray";

const DM_DICE_COLOR = "#8c1c1c";

function rollColor(state: GameState | null, roll: RollResult) {
  return state?.characters.find((c) => c.id === roll.rollerId)?.color ?? DM_DICE_COLOR;
}

function HpBar({ hp, max, temp }: { hp: number; max: number; temp: number }) {
  const frac = max ? Math.max(0, Math.min(1, hp / max)) : 0;
  return (
    <div className="hpbar">
      <div className={`hpfill ${frac > 0.5 ? "ok" : frac > 0.25 ? "warn" : "bad"}`} style={{ width: `${frac * 100}%` }} />
      <span>
        {hp}/{max}
        {temp ? ` +${temp}` : ""} HP
      </span>
    </div>
  );
}

function PartyCard({ c, active, speaking, turn }: { c: Character; active: boolean; speaking: boolean; turn: boolean }) {
  return (
    <div className={`party-card ${speaking ? "speaking" : ""} ${turn ? "turn" : ""} ${c.hp <= 0 ? "down" : ""}`} style={{ borderColor: c.color }}>
      <div className="pc-head">
        {c.spriteUrl ? <img src={c.spriteUrl} alt="" /> : <div className="pc-dot" style={{ background: c.color }} />}
        <div>
          <div className="pc-name">{c.name}</div>
          <div className="pc-sub">
            {c.playerName} · {c.species} {c.className} {c.level}
          </div>
        </div>
        <div className="pc-ac" title="Armor Class">
          {c.ac}
        </div>
      </div>
      <HpBar hp={c.hp} max={c.maxHp} temp={c.tempHp} />
      {c.conditions.length > 0 && (
        <div className="chips">
          {c.conditions.map((x) => (
            <span key={x} className="chip bad">
              {x}
            </span>
          ))}
        </div>
      )}
      <div className={`inv ${active ? "open" : ""}`}>
        {c.inventory.length === 0 && <span className="muted">Empty pack</span>}
        {c.inventory.map((i) => (
          <span key={i.id} className="inv-item" title={i.description}>
            {i.name}
            {i.qty > 1 ? ` ×${i.qty}` : ""}
          </span>
        ))}
        <span className="inv-item gold">{c.gold} gp</span>
      </div>
    </div>
  );
}

function RollToast({ roll }: { roll: RollResult }) {
  const nat = naturalD20(roll.dice);
  const kept = roll.dice.filter((d) => !d.dropped).map((d) => d.value);
  return (
    <div className={`roll-toast ${nat === 20 ? "crit" : nat === 1 ? "fumble" : ""}`}>
      <div className="rt-who">
        {roll.rollerName} · {roll.label || roll.notation}
      </div>
      <div className="rt-total">{roll.secret ? "?" : roll.total}</div>
      <div className="rt-detail">
        {roll.physical ? "physical dice" : `${roll.notation}${kept.length ? ` → [${kept.join(", ")}]` : ""}${roll.modifier ? ` ${roll.modifier > 0 ? "+" : ""}${roll.modifier}` : ""}`}
        {nat === 20 && " · NATURAL 20!"}
        {nat === 1 && " · natural 1"}
        {roll.success !== undefined && <b className={roll.success ? "ok" : "bad"}>{roll.success ? " · success" : " · fail"}</b>}
      </div>
    </div>
  );
}

export function TablePage() {
  const [queue, setQueue] = useState<RollResult[]>([]);
  const [current, setCurrent] = useState<RollResult | null>(null);
  const [toast, setToast] = useState<RollResult | null>(null);
  const [showInv, setShowInv] = useState(true);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const onRoll = useCallback((roll: RollResult) => setQueue((q) => [...q, roll]), []);
  const view = useServer("table", onRoll);
  const { state, campaign, speaker, dm } = view;

  useEffect(() => {
    if (current || queue.length === 0) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    setCurrent(next);
    setToast(null);
  }, [queue, current]);

  const onSettled = useCallback(() => {
    setToast(current);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 7000);
    setTimeout(() => setCurrent(null), 4000);
  }, [current]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "i") setShowInv((s) => !s);
      if (e.key === "f") void document.documentElement.requestFullscreen?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const location = campaign?.outline?.locations.find((l) => l.id === state?.locationId);
  const turnId = state?.combat.active ? state.combat.order[state.combat.turnIndex]?.entityId : undefined;
  const speakerCharId = state?.players.find((p) => p.id === speaker?.playerId)?.characterId;
  const pendingChar = state?.pendingRoll && state.characters.find((c) => c.id === state.pendingRoll!.characterId);
  const speakerFresh = speaker && Date.now() - speaker.ts < 15000;

  if (!state) {
    return (
      <div className="table-empty">
        <h1>AI Dungeon Master</h1>
        <p>{view.connected ? "Waiting for the host to load a campaign…" : "Connecting to server…"}</p>
      </div>
    );
  }

  return (
    <div className="table-root">
      <div className="map-layer">
        <MapBoard state={state} location={location} speakerPlayerId={speakerFresh ? speaker?.playerId : undefined} />
      </div>

      <div className="scene-title">
        <div className="campaign-name">{campaign?.outline?.title ?? campaign?.name}</div>
        <div className="location-name">{location?.name ?? "—"}</div>
      </div>

      {state.combat.active && (
        <div className="initiative">
          <span className="round">Round {state.combat.round}</span>
          {state.combat.order.map((o, i) => {
            const m = state.monsters.find((x) => x.id === o.entityId);
            const c = state.characters.find((x) => x.id === o.entityId);
            const down = (m && m.hp <= 0) || (c && c.hp <= 0);
            return (
              <span key={o.entityId} className={`init ${i === state.combat.turnIndex ? "now" : ""} ${o.entityType} ${down ? "down" : ""}`}>
                <b>{o.initiative}</b> {o.name}
              </span>
            );
          })}
        </div>
      )}

      <aside className="party">
        {state.characters.map((c) => (
          <PartyCard key={c.id} c={c} active={showInv} speaking={!!speakerFresh && speakerCharId === c.id} turn={turnId === c.id} />
        ))}
        {state.monsters.filter((m) => !m.hidden).length > 0 && (
          <div className="foes">
            {state.monsters
              .filter((m) => !m.hidden)
              .map((m) => (
                <div key={m.id} className={`foe ${m.hp <= 0 ? "down" : ""} ${turnId === m.id ? "turn" : ""}`}>
                  <span>{m.name}</span>
                  <span className="foe-hp">{m.hp <= 0 ? "defeated" : m.hp / m.maxHp > 0.5 ? "healthy" : m.hp / m.maxHp > 0.25 ? "bloodied" : "near death"}</span>
                </div>
              ))}
          </div>
        )}
      </aside>

      <div className={`dm-orb ${dm.status}`}>
        <div className="orb" />
        <span>{dm.status === "speaking" ? "The DM speaks…" : dm.status === "thinking" ? "The DM ponders…" : dm.status === "listening" ? "Listening" : dm.status === "connecting" ? "Summoning the DM…" : "DM offline"}</span>
        {speakerFresh && speaker && (
          <span className="speaker-tag">
            🎙 {speaker.playerName}
            {speaker.characterName ? ` (${speaker.characterName})` : ""}
          </span>
        )}
      </div>

      {pendingChar && state.pendingRoll && (
        <div className="pending-roll" style={{ borderColor: pendingChar.color }}>
          🎲 {pendingChar.name}, roll <b>{state.pendingRoll.notation}</b> for {state.pendingRoll.label}!
        </div>
      )}

      <DiceTray roll={current} color={current ? rollColor(state, current) : DM_DICE_COLOR} onSettled={onSettled} />
      {toast && <RollToast roll={toast} />}
      {view.jobs.filter((j) => j.status === "running").length > 0 && (
        <div className="jobs table-jobs">
          {view.jobs
            .filter((j) => j.status === "running")
            .map((j) => (
              <div key={j.id} className="job">
                ✦ {j.label}…
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
