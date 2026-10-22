import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { orbClass, orbLabel } from "./orb";
import type { BoardEffect, Character, GameState, Moment, Pickup, RollResult } from "@dm/shared";
import { coverNote, naturalD20 } from "@dm/shared";
import { momentForTable, monsterShownOnTable, rollForTable } from "./visibility";
import { useServer } from "../lib/useServer";
import { api } from "../lib/api";
import { isMicHotkey } from "../lib/mic";
import { useTableVoice } from "./useTableVoice";
import { onTalkLevel } from "../lib/talk";
import { deathSaveView, isDeadChar, tableRulesView } from "../player/sheet";
import { MapBoard, type ReceivedEffect, type TokenMoment } from "./MapBoard";
import { EFFECT_LIFETIME_MS } from "./Effects";
import { releaseHeld, type HeldEffect } from "./effectPlan";
import { DiceTray } from "../dice/DiceTray";
import { isAudioUnlocked, isMuted, onAudioLockChange, onMuteChange, playEffectSound, setMuted, unlockAudio } from "../dice/sound";
import { CritBurst } from "./CritBurst";
import { NpcCloseup } from "./NpcCloseup";
import { Qr } from "../lib/Qr";
import { TurnBudgetChips } from "../lib/TurnBudgetChips";
import { useJoinBase } from "../lib/join";
import { FLOURISH_MS, flourishFor, type Flourish } from "./flourish";
import { MOMENT_MS, dismiss, emptyMomentQueue, enqueueMoment, heldStanding, holdsDice, isFullScreen, isTokenMoment, momentVariant, nextOverlay, releaseHeldMoments, shownTurn, soundForMoment, type HeldMoment, type MomentQueue, type MomentVariant, type ShownTurn } from "./momentPlan";
import { MomentOverlay, RalliedToast } from "./MomentOverlay";
import { hpBand, nowPanelFor } from "./nowPanel";
import { displayState, emptyHold, holdBoard, type BoardHold } from "./boardHold";
import { pickupToastText } from "./mapObjects";
import { monsterColor } from "../lib/tokenColor";
import { attitudeBadge } from "../lib/attitudeBadge";
import { awayTag, otherGroupLines } from "./otherGroups";

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

/** Spell slots and limited-use resources, shown on the active player's card only. */
function PartyRules({ c }: { c: Character }) {
  const view = tableRulesView(c);
  if (!view) return null;
  return (
    <div className="pc-rules">
      {view.slots.map((r) => (
        <div key={r.key} className={`pc-rules-row ${r.pact ? "pact" : ""}`} title={`${r.left}/${r.max} left`}>
          <span>{r.label}</span>
          <span className="pc-rules-pips">{r.pips.map((on, i) => <i key={i} className={`pip ${on ? "on" : ""}`} />)}</span>
        </div>
      ))}
      {view.resources.map((r) => (
        <div key={r.name} className="pc-rules-row" title={r.reset}>
          <span>{r.name}</span>
          <span className="pc-rules-pips">
            {r.pips ? r.pips.map((on, i) => <i key={i} className={`pip ${on ? "on" : ""}`} />) : <b>{r.left}/{r.max}</b>}
          </span>
        </div>
      ))}
    </div>
  );
}

function PartyCard({ c, active, speaking, live, turn, showRules, away }: { c: Character; active: boolean; speaking: boolean; live: boolean; turn: boolean; showRules: boolean; away?: string }) {
  const ds = deathSaveView(c);
  return (
    <div className={`party-card ${speaking || live ? "speaking" : ""} ${live ? "live" : ""} ${turn ? "turn" : ""} ${c.hp <= 0 ? "down" : ""} ${isDeadChar(c) ? "dead" : ""} ${away ? "away" : ""}`} style={{ borderColor: c.color }}>
      {live && <TalkLevel />}
      <div className="pc-head">
        {c.spriteUrl ? <img src={c.spriteUrl} alt="" /> : <div className="pc-dot" style={{ background: c.color }} />}
        <div>
          <div className="pc-name">{c.name}</div>
          <div className="pc-sub">
            {c.playerName} · {c.species} {c.className} {c.level}
          </div>
          {away && <div className="pc-away">{away}</div>}
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
      {showRules && c.hp > 0 && <PartyRules c={c} />}
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
            {i.iconUrl && <img className="inv-icon" src={i.iconUrl} alt="" />}
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
        {roll.cover && !roll.secret && <span className="rt-cover">{` ·${coverNote(roll)}`}</span>}
        {roll.success !== undefined && <b className={roll.success ? "ok" : "bad"}>{roll.success ? " · success" : " · fail"}</b>}
      </div>
    </div>
  );
}

/** "Sylvaine picks up Dagger x2, 15 gp" with the item icons (a name chip until an icon exists). */
function PickupToast({ pickup }: { pickup: Pickup }) {
  return (
    <div className="pickup-toast">
      <div className="pk-icons">
        {pickup.items.map((i, n) =>
          i.iconUrl ? <img key={n} src={i.iconUrl} alt={i.name} title={i.name} /> : (
            <span key={n} className="chip">
              {i.name}
            </span>
          ),
        )}
        {pickup.gold > 0 && <span className="chip gold">{pickup.gold} gp</span>}
      </div>
      <div className="pk-text">{pickupToastText(pickup)}</div>
    </div>
  );
}

const PICKUP_TOAST_MS = 5000;

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
  // Autoplay lock (lib/audioUnlock): shows "Click to enable sound" until a gesture unlocks it.
  const [soundLocked, setSoundLocked] = useState(() => !isAudioUnlocked());
  const [flourish, setFlourish] = useState<{ id: string; kind: Flourish; who: string } | null>(null);
  const flourishTimer = useRef<ReturnType<typeof setTimeout>>();
  // Moments (momentPlan): overlay queue, "back up" toasts and token animations, all transient.
  const [momentQueue, setMomentQueue] = useState<MomentQueue>(emptyMomentQueue);
  const [rallied, setRallied] = useState<{ id: string; name: string }[]>([]);
  const [tokenMoments, setTokenMoments] = useState<TokenMoment[]>([]);
  const heldMoments = useRef<HeldMoment[]>([]);
  // Tokens kept standing while their death moment waits behind the dice (momentPlan.heldStanding).
  const [standing, setStanding] = useState<string[]>([]);
  const syncStanding = useCallback(() => {
    const ids = heldStanding(heldMoments.current);
    setStanding((cur) => (cur.length === ids.length && cur.every((x, i) => x === ids[i]) ? cur : ids));
  }, []);
  const latestForMoments = useRef<GameState | null>(null);
  // The turn marker waits for the dice too (momentPlan.shownTurn); synced like `standing`.
  const stateTurnId = useRef<string | undefined>(undefined);
  const turnShown = useRef<ShownTurn>({ id: undefined });
  const [turnId, setTurnId] = useState<string | undefined>(undefined);

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
  // Moments wait behind the dice and the board effects (the killing blow lands before the banner).
  const playMoment = useCallback((m: Moment) => {
    const v = momentVariant(m);
    if (isFullScreen(v)) {
      setMomentQueue((q) => nextOverlay(enqueueMoment(q, m), performance.now()));
    } else {
      playEffectSound(soundForMoment(v));
    }
    if (v === "rallied") {
      const name = latestForMoments.current?.characters.find((c) => c.id === m.targetId)?.name ?? "A hero";
      setRallied((list) => [...list.slice(-3), { id: m.id, name }]);
      setTimeout(() => setRallied((list) => list.filter((x) => x.id !== m.id)), MOMENT_MS.rallied);
    }
    if (isTokenMoment(v) && m.targetId) {
      const tm: TokenMoment = { id: m.id, entityId: m.targetId, variant: v, at: performance.now() };
      setTokenMoments((list) => [...list.filter((x) => x.entityId !== tm.entityId), tm]);
      animating.current = [...animating.current, tm.id + "|" + tm.entityId];
      setTimeout(() => {
        setTokenMoments((list) => list.filter((x) => x.id !== tm.id));
        animating.current = animating.current.filter((x) => x !== tm.id + "|" + tm.entityId);
      }, MOMENT_MS[v] + 500);
    }
  }, []);
  const flushMoments = useCallback(() => {
    if (!heldMoments.current.length) return;
    const { release, keep } = releaseHeldMoments(heldMoments.current, { diceBusy: diceBusy.current, effectsHeld: held.current.length > 0, now: performance.now() });
    heldMoments.current = keep;
    release.forEach(playMoment);
    syncStanding();
  }, [playMoment, syncStanding]);
  const overlayVariant = useRef<MomentVariant | undefined>(undefined);
  // HP changes and removed monsters wait for the dice too (boardHold); `animating`: "momentId|entityId"
  // of token animations still playing, so a removed monster stays until its death has played.
  const animating = useRef<string[]>([]);
  const liveState = useRef<GameState | null>(null);
  const seenState = useRef<GameState | null>(null);
  const boardHold = useRef<BoardHold>(emptyHold());
  const [hold, setHold] = useState<BoardHold>(boardHold.current);
  const syncBoard = useCallback(() => {
    const now = performance.now();
    const busy = diceBusy.current || held.current.length > 0 || heldMoments.current.length > 0;
    // The battle intro holds the spotlight too: it lights up with the first turn banner.
    turnShown.current = shownTurn(turnShown.current, stateTurnId.current, { busy: busy || overlayVariant.current === "combat_start", now });
    setTurnId(turnShown.current.id);
    const live = liveState.current;
    if (!live) return;
    const next = holdBoard(boardHold.current, seenState.current, live, { busy, animating: animating.current.map((x) => x.split("|")[1]!), now });
    seenState.current = live;
    const same = JSON.stringify(next) === JSON.stringify(boardHold.current);
    if (!same) {
      boardHold.current = next;
      setHold(next);
    }
  }, []);
  const onMoment = useCallback(
    (moment: Moment, latest: GameState | null) => {
      latestForMoments.current = latest;
      // Deaths, revivals and turn banners of monsters the table can't see are dropped.
      const m = latest ? momentForTable(latest, moment) : moment;
      if (!m) return;
      heldMoments.current = [...heldMoments.current, { moment: m, heldAt: performance.now() }];
      flushHeld();
      flushMoments(); // also syncs `standing`
    },
    [flushHeld, flushMoments],
  );
  const onEffect = useCallback(
    (effect: BoardEffect) => {
      held.current = [...held.current, { effect, heldAt: performance.now() }];
      flushHeld();
    },
    [flushHeld],
  );
  const [pickups, setPickups] = useState<(Pickup & { key: number })[]>([]);
  const pickupSeq = useRef(0);
  const onPickup = useCallback((pickup: Pickup) => {
    const key = ++pickupSeq.current;
    setPickups((list) => [...list.slice(-2), { ...pickup, key }]);
    setTimeout(() => setPickups((list) => list.filter((p) => p.key !== key)), PICKUP_TOAST_MS);
  }, []);
  const view = useServer("table", onRoll, onEffect, onMoment, onPickup);
  const { state: live, campaign, speaker, dm, talk, npcFocus, micMuted } = view;
  liveState.current = live;
  // What the TV draws: the live state with HP changes and removed monsters held behind the dice.
  const state = useMemo(() => (live ? displayState(live, hold) : null), [live, hold]);
  const micMutedRef = useRef(micMuted);
  micMutedRef.current = micMuted;
  // This screen carries the voice call (mic + the DM's audio); /host only sends commands.
  const voice = useTableVoice(view);
  const voiceDm = dm.mode === "voice" && dm.status !== "offline";

  useEffect(() => {
    const busy = !!current || queue.length > 0;
    if (busy !== diceBusy.current) idleSince.current = busy ? undefined : performance.now();
    diceBusy.current = busy;
    flushHeld();
    flushMoments();
    syncBoard();
  }, [current, queue, flushHeld, flushMoments, syncBoard]);
  useEffect(() => {
    const t = setInterval(() => {
      flushHeld();
      flushMoments();
      syncBoard();
      setMomentQueue((q) => nextOverlay(q, performance.now()));
    }, 200);
    return () => clearInterval(t);
  }, [flushHeld, flushMoments, syncBoard]);
  // Each overlay plays its sound when it actually shows (it may have queued behind another).
  const overlay = momentQueue.current;
  overlayVariant.current = overlay?.variant;
  useEffect(() => {
    if (overlay) playEffectSound(soundForMoment(overlay.variant));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay?.moment.id]);

  // The next roll waits for the battle intro and turn banners (momentPlan.holdsDice).
  const diceHeld = holdsDice(overlay?.variant);
  useEffect(() => {
    if (current || queue.length === 0 || diceHeld) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    setCurrent(next);
    setToast(null);
  }, [queue, current, diceHeld]);

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
      if (isMicHotkey(e)) api("/mic", { muted: !micMutedRef.current, source: "table-key" }).catch(() => undefined);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", unlockAudio);
    const off = onMuteChange(setMutedView);
    const offLock = onAudioLockChange((unlocked) => setSoundLocked(!unlocked));
    // A kiosk/autoplay-allowed browser unlocks without a click; otherwise this just fails quietly.
    unlockAudio();
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", unlockAudio);
      off();
      offLock();
    };
  }, []);

  const location = campaign?.outline?.locations.find((l) => l.id === state?.locationId);
  const liveTurnId = live?.combat.active ? live.combat.order[live.combat.turnIndex]?.entityId : undefined;
  stateTurnId.current = liveTurnId;
  useEffect(syncBoard, [live, syncBoard]);
  const speakerCharId = state?.players.find((p) => p.id === speaker?.playerId)?.characterId;
  // Live talker (mid-sentence voice ID) wins over the last turn's speaker.
  const livePlayer = talk?.playerId ? state?.players.find((p) => p.id === talk.playerId) : undefined;
  const liveCharId = livePlayer?.characterId;
  const liveChar = state?.characters.find((c) => c.id === liveCharId);
  const liveLabel = livePlayer ? `${livePlayer.name}${liveChar ? ` (${liveChar.name})` : ""}` : "Someone's talking";
  const pendingChar = state?.pendingRoll && state.characters.find((c) => c.id === state.pendingRoll!.characterId);
  const speakerFresh = speaker && Date.now() - speaker.ts < 15000;
  // Whose slots and resources the TV shows: the turn holder in combat, else whoever is talking.
  const rulesCharId = turnId ?? liveCharId ?? (!talk && speakerFresh ? speakerCharId : undefined);
  // Monsters the host/DM hid (ambush) or standing in the fog of war are not listed.
  const seenMonster = state ? monsterShownOnTable(state) : () => true;
  const now = state ? nowPanelFor(state, turnId) : null;

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
        <MapBoard state={state} location={location} speakerPlayerId={livePlayer?.id ?? (speakerFresh && !talk ? speaker?.playerId : undefined)} effects={effects} tokenMoments={tokenMoments} standing={standing} turnId={turnId} />
      </div>

      <div className="scene-title">
        <div className="campaign-name">{campaign?.outline?.title ?? campaign?.name}</div>
        <div className="location-name">{location?.name ?? "—"}</div>
        {/* Party split: the groups the TV isn't showing (the DM cuts to them with focus_scene). */}
        {otherGroupLines(state, campaign?.outline?.locations ?? []).map((line) => (
          <div key={line} className="other-group">
            {line}
          </div>
        ))}
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
              <span key={o.entityId} className={`init ${o.entityId === turnId ? "now" : ""} ${m?.ally ? "ally" : o.entityType} ${down ? "down" : ""}`}>
                <b>{o.initiative}</b> {o.name}
              </span>
            );
          })}
        </div>
      )}
      {/* "Now" panel. A hidden monster's (ambusher's) turn is an unknown foe with no budget: it would give it away. */}
      {now &&
        (now.hidden ? (
          <div className="now-panel hidden">
            <span className="np-label">Now</span> <span className="np-name">{now.name}</span>
          </div>
        ) : (
          <div className="now-panel">
            {now.portraitUrl ? <img src={now.portraitUrl} alt="" /> : <div className="np-dot" />}
            <div className="np-body">
              <div className="np-head">
                <span className="np-label">Now</span>
                <span className="np-name">{now.name}</span>
                {now.hp ? <span className="np-hp">{now.hp} HP</span> : now.hpBand && <span className={`np-hp ${now.hpBand.replace(" ", "-")}`}>{now.hpBand}</span>}
              </div>
              {!!now.conditions?.length && (
                <div className="chips">
                  {now.conditions.map((x) => (
                    <span key={x} className="chip bad">
                      {x}
                    </span>
                  ))}
                </div>
              )}
              {state.combat.turn && <TurnBudgetChips combat={state.combat} />}
            </div>
          </div>
        ))}

      <aside className="party">
        {state.characters.map((c) => (
          <PartyCard key={c.id} c={c} active={showInv} speaking={!talk && !!speakerFresh && speakerCharId === c.id} live={!!liveCharId && liveCharId === c.id} turn={turnId === c.id} showRules={!!rulesCharId && rulesCharId === c.id} away={awayTag(state, c.id, campaign?.outline?.locations ?? [])} />
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
                  <span className="attitude-badge" style={{ background: monsterColor(m) }}>
                    {attitudeBadge(m)}
                  </span>
                  <span className="foe-hp">{m.hp <= 0 && m.ally ? "knocked out" : hpBand(m.hp, m.maxHp)}</span>
                </div>
              ))}
            </div>
          );
        })}
      </aside>

      <div className={`dm-orb ${orbClass(dm.status, micMuted)}`}>
        <div className="orb" />
        <span>{orbLabel(dm.status, micMuted, npcFocus?.name)}</span>
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
          {state.pendingRoll.kind === "damage" ? "💥" : "🎲"} {pendingChar.name}, roll <b>{state.pendingRoll.notation}</b> {state.pendingRoll.kind === "damage" ? `damage${state.pendingRoll.critical ? " (critical: roll twice)" : ""}` : `for ${state.pendingRoll.label}`}!
        </div>
      )}

      <button type="button" className={`mute-badge ${muted ? "muted" : ""}`} title="Click or press M to toggle table sounds" onClick={() => setMuted(!isMuted())}>
        {muted ? "🔇" : "🔊"} <span>M</span>
      </button>
      {voice.state !== "idle" && voice.state !== "connected" && (
        <span className={`voice-pill ${voice.state === "failed" ? "bad" : ""}`} title={voice.error ?? "This screen's voice call to the DM"}>
          🎙 voice: {voice.state === "failed" ? `failed${voice.error ? ` (${voice.error})` : ""}` : `${voice.state}…`}
        </span>
      )}
      {soundLocked && (!muted || voiceDm) && (
        <button type="button" className="sound-unlock" onClick={unlockAudio}>
          🔊 <b>{voiceDm ? "Click to enable sound and the DM's voice" : "Click to enable sound"}</b>
          <span className="muted">the browser blocks the DM, NPC voices and dice until someone clicks or presses a key</span>
        </button>
      )}

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
      {overlay && <MomentOverlay key={overlay.moment.id} moment={overlay.moment} variant={overlay.variant} state={state} campaign={campaign} onDismiss={() => setMomentQueue((q) => nextOverlay(dismiss(q), performance.now()))} />}
      {pickups.length > 0 && (
        <div className="pickup-stack">
          {pickups.map((p) => (
            <PickupToast key={p.key} pickup={p} />
          ))}
        </div>
      )}
      {rallied.map((r) => (
        <RalliedToast key={r.id} name={r.name} />
      ))}
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
