import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardEffect, Character, GameState, RollResult } from "@dm/shared";
import { naturalD20 } from "@dm/shared";
import { monsterShownOnTable, rollForTable } from "./visibility";
import { useServer } from "../lib/useServer";
import { api } from "../lib/api";
import { isMicHotkey } from "../lib/mic";
import { onTalkLevel } from "../lib/talk";
import { deathSaveView, isDeadChar } from "../player/sheet";
import { MapBoard, type ReceivedEffect } from "./MapBoard";
import { EFFECT_LIFETIME_MS } from "./Effects";
import { releaseHeld, type HeldEffect } from "./effectPlan";
import { DiceTray } from "../dice/DiceTray";
import { isMuted, onMuteChange, playEffectSound, setMuted, unlockAudio } from "../dice/sound";
import { CritBurst } from "./CritBurst";
import { NpcCloseup } from "./NpcCloseup";
import { Qr } from "../lib/Qr";
import { TurnBudgetChips } from "../lib/TurnBudgetChips";
import { useJoinBase } from "../lib/join";
import { FLOURISH_MS, flourishFor, type Flourish } from "./flourish";

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

/** Live mic level bar: painted straight from the level bus (no React re-render per update). */
function TalkLevel({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => onTalkLevel((l) => ref.current?.style.setProperty("--lvl", l.toFixed(2))), []);
  return (
    <div ref={ref} className={`talk-level ${className}`}>
      <i />
    </div>
  );
}

function PartyCard({ c, active, speaking, live, turn }: { c: Character; active: boolean; speaking: boolean; live: boolean; turn: boolean }) {
  const ds = deathSaveView(c);
  return (
    <div className={`party-card ${speaking || live ? "speaking" : ""} ${live ? "live" : ""} ${turn ? "turn" : ""} ${c.hp <= 0 ? "down" : ""} ${isDeadChar(c) ? "dead" : ""}`} style={{ borderColor: c.color }}>
      {live && <TalkLevel />}
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
      {ds?.state === "dying" && (
        <div className="pc-ds" title="Death saving throws">
          <span className="pc-ds-row ok">
            ✔ {ds.successes.map((on, i) => <i key={i} className={`pip ${on ? "on" : ""}`} />)}
          </span>
          <span className="pc-ds-row bad">
            ✖ {ds.failures.map((on, i) => <i key={i} className={`pip ${on ? "on" : ""}`} />)}
          </span>
        </div>
      )}
      {ds?.state === "stable" && <div className="pc-badge stable">✚ Stable</div>}
      {c.concentration && <div className="pc-badge conc">◎ {c.concentration.spell}</div>}
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
  const [showJoin, setShowJoin] = useState(false);
  const joinUrl = `${useJoinBase()}/player`;
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const [effects, setEffects] = useState<ReceivedEffect[]>([]);
  const [muted, setMutedView] = useState(isMuted);
  const [flourish, setFlourish] = useState<{ id: string; kind: Flourish; who: string } | null>(null);
  const flourishTimer = useRef<ReturnType<typeof setTimeout>>();

  // Rolls by monsters the table can't see are shown as anonymous DM rolls (rollForTable), judged
  // on the newest state useServer received (not the last rendered one).
  const showEffect = useCallback((effect: BoardEffect) => {
    setEffects((list) => [...list.slice(-59), { effect, receivedAt: performance.now() }]); // pruned by age below; 60 is only a safety cap
    setTimeout(() => setEffects((list) => list.filter((e) => e.effect.id !== effect.id)), EFFECT_LIFETIME_MS);
  }, []);
  // Effects wait for the dice tray (d20 → damage dice → swing), see releaseHeld.
  const held = useRef<HeldEffect[]>([]);
  const diceBusy = useRef(false);
  const idleSince = useRef<number | undefined>(performance.now());
  const onRoll = useCallback((roll: RollResult, latest: GameState | null) => {
    // Busy right away: the roll's own effect (attack) can arrive before React commits the queue.
    diceBusy.current = true;
    idleSince.current = undefined;
    setQueue((q) => [...q, rollForTable(roll, latest)]);
  }, []);
  const flushHeld = useCallback(() => {
    if (!held.current.length) return;
    const { release, keep } = releaseHeld(held.current, { diceBusy: diceBusy.current, idleSince: idleSince.current, now: performance.now() });
    held.current = keep;
    release.forEach(showEffect);
  }, [showEffect]);
  const onEffect = useCallback(
    (effect: BoardEffect) => {
      held.current = [...held.current, { effect, heldAt: performance.now() }];
      flushHeld();
    },
    [flushHeld],
  );
  const view = useServer("table", onRoll, onEffect);
  const { state, campaign, speaker, dm, talk, npcFocus, micMuted } = view;
  const micMutedRef = useRef(micMuted);
  micMutedRef.current = micMuted;

  useEffect(() => {
    const busy = !!current || queue.length > 0;
    if (busy !== diceBusy.current) idleSince.current = busy ? undefined : performance.now();
    diceBusy.current = busy;
    flushHeld();
  }, [current, queue, flushHeld]);
  useEffect(() => {
    const t = setInterval(flushHeld, 200);
    return () => clearInterval(t);
  }, [flushHeld]);

  useEffect(() => {
    if (current || queue.length === 0) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    setCurrent(next);
    setToast(null);
  }, [queue, current]);

  const onSettled = useCallback(() => {
    // Natural 20 / 1: 3D dice once they land, physical rolls when they reach the front of the queue.
    const kind = current && flourishFor(current);
    if (current && kind) {
      setFlourish({ id: current.id, kind, who: current.rollerName });
      playEffectSound(kind === "crit" ? "fanfare" : "fumble");
      clearTimeout(flourishTimer.current);
      flourishTimer.current = setTimeout(() => setFlourish(null), FLOURISH_MS);
    }
    setToast(current);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 7000);
    setTimeout(() => setCurrent(null), 4000);
  }, [current]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      unlockAudio();
      if (e.key === "i") setShowInv((s) => !s);
      if (e.key === "q" || e.key === "Q") setShowJoin((s) => !s);
      if (e.key === "f") void document.documentElement.requestFullscreen?.();
      if (e.key === "m" || e.key === "M") setMuted(!isMuted());
      if (isMicHotkey(e)) api("/mic", { muted: !micMutedRef.current }).catch(() => undefined);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", unlockAudio);
    const off = onMuteChange(setMutedView);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", unlockAudio);
      off();
    };
  }, []);

  const location = campaign?.outline?.locations.find((l) => l.id === state?.locationId);
  const turnId = state?.combat.active ? state.combat.order[state.combat.turnIndex]?.entityId : undefined;
  const speakerCharId = state?.players.find((p) => p.id === speaker?.playerId)?.characterId;
  // Live talker (mid-sentence voice ID) wins over the last turn's speaker.
  const livePlayer = talk?.playerId ? state?.players.find((p) => p.id === talk.playerId) : undefined;
  const liveCharId = livePlayer?.characterId;
  const liveChar = state?.characters.find((c) => c.id === liveCharId);
  const liveLabel = livePlayer ? `${livePlayer.name}${liveChar ? ` (${liveChar.name})` : ""}` : "Someone's talking";
  const pendingChar = state?.pendingRoll && state.characters.find((c) => c.id === state.pendingRoll!.characterId);
  const speakerFresh = speaker && Date.now() - speaker.ts < 15000;
  // Monsters the host/DM hid (ambush) or standing in the fog of war are not listed.
  const seenMonster = state ? monsterShownOnTable(state) : () => true;

  if (!state) {
    return (
      <div className="table-empty">
        <h1>AI Dungeon Master</h1>
        <p>{view.connected ? "Waiting for the host to load a campaign…" : "Connecting to server…"}</p>
        <div className="table-join">
          <Qr url={joinUrl} size={260} />
          <div>📱 Scan to join, or open</div>
          <div className="join-url">{joinUrl}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`table-root ${flourish?.kind === "crit" ? "shake" : ""}`}>
      <div className="map-layer">
        <MapBoard state={state} location={location} speakerPlayerId={livePlayer?.id ?? (speakerFresh && !talk ? speaker?.playerId : undefined)} effects={effects} />
      </div>

      <div className="scene-title">
        <div className="campaign-name">{campaign?.outline?.title ?? campaign?.name}</div>
        <div className="location-name">{location?.name ?? "—"}</div>
      </div>

      {state.combat.active && (
        <div className="initiative">
          <span className="round">Round {state.combat.round}</span>
          {state.combat.order.map((o, i) => {
            if (o.entityType === "monster" && !seenMonster(o.entityId)) return null;
            const m = state.monsters.find((x) => x.id === o.entityId);
            const c = state.characters.find((x) => x.id === o.entityId);
            const down = (m && m.hp <= 0) || (c && c.hp <= 0);
            return (
              <span key={o.entityId} className={`init ${i === state.combat.turnIndex ? "now" : ""} ${m?.ally ? "ally" : o.entityType} ${down ? "down" : ""}`}>
                <b>{o.initiative}</b> {o.name}
              </span>
            );
          })}
        </div>
      )}
      {/* A hidden monster's (ambusher's) turn shows no budget: it would give it away. */}
      {state.combat.active && turnId && state.combat.turn && (state.combat.order[state.combat.turnIndex]?.entityType !== "monster" || seenMonster(turnId)) && (
        <div className="turn-budget">
          <TurnBudgetChips combat={state.combat} />
        </div>
      )}

      <aside className="party">
        {state.characters.map((c) => (
          <PartyCard key={c.id} c={c} active={showInv} speaking={!talk && !!speakerFresh && speakerCharId === c.id} live={!!liveCharId && liveCharId === c.id} turn={turnId === c.id} />
        ))}
        {[true, false].map((ally) => {
          // Neutral creatures (set_disposition) are on neither side's list.
          const list = state.monsters.filter((m) => !!m.ally === ally && !m.neutral && seenMonster(m.id));
          if (!list.length) return null;
          return (
            <div key={ally ? "allies" : "foes"} className={ally ? "foes allies" : "foes"}>
              {list.map((m) => (
                <div key={m.id} className={`foe ${m.hp <= 0 ? "down" : ""} ${turnId === m.id ? "turn" : ""}`}>
                  <span>{m.name}</span>
                  <span className="foe-hp">{m.hp <= 0 ? (m.ally ? "knocked out" : "defeated") : m.hp / m.maxHp > 0.5 ? "healthy" : m.hp / m.maxHp > 0.25 ? "bloodied" : "near death"}</span>
                </div>
              ))}
            </div>
          );
        })}
      </aside>

      <div className={`dm-orb ${dm.status}`}>
        <div className="orb" />
        <span>{dm.status === "speaking" ? (npcFocus ? `${npcFocus.name} speaks…` : "The DM speaks…") : dm.status === "thinking" ? "The DM ponders…" : dm.status === "listening" ? "Listening" : dm.status === "connecting" ? "Summoning the DM…" : "DM offline"}</span>
        {talk && (
          <span className="speaker-tag live">
            🎙 {liveLabel}…
            <TalkLevel className="inline" />
          </span>
        )}
        {!talk && speakerFresh && speaker && (
          <span className="speaker-tag">
            🎙 {speaker.playerName}
            {speaker.characterName ? ` (${speaker.characterName})` : ""}
          </span>
        )}
      </div>

      {micMuted && (
        <div className="mic-muted-banner" role="status">
          🔇 <b>The DM isn't listening</b> <span className="muted">press P or tap 🔇 on a phone to resume</span>
        </div>
      )}

      {pendingChar && state.pendingRoll && (
        <div className="pending-roll" style={{ borderColor: pendingChar.color }}>
          🎲 {pendingChar.name}, roll <b>{state.pendingRoll.notation}</b> for {state.pendingRoll.label}!
        </div>
      )}

      <div className={`mute-badge ${muted ? "muted" : ""}`} title="Press M to toggle dice sounds">
        {muted ? "🔇" : "🔊"} <span>M</span>
      </div>

      <DiceTray roll={current} color={current ? rollColor(state, current) : DM_DICE_COLOR} onSettled={onSettled} />
      {toast && <RollToast roll={toast} />}
      <NpcCloseup focus={npcFocus} dmSpeaking={dm.status === "speaking"} />
      {showJoin && (
        <div className="join-corner">
          <Qr url={joinUrl} size={150} />
          <div className="txt">
            📱 <b>Join the game</b>
            <br />
            scan, or open
            <br />
            <b>{joinUrl}</b>
            <br />
            <span className="muted">Q hides this</span>
          </div>
        </div>
      )}
      {flourish && <CritBurst key={flourish.id} kind={flourish.kind} who={flourish.who} />}
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
