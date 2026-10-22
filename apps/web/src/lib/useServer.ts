import { useEffect, useRef, useState } from "react";
import { isMuted, markAudioLocked, onMuteChange } from "../dice/sound";
import { api } from "./api";
import { afterSocketClose, needsCheck, redirectToSignIn, type Me } from "./auth";
import { NpcClipPlayer, type ClipAudio } from "./npcAudio";
import { pushCaption, reduceTalk, setTalkLevel, type TalkView } from "./talk";
import type { ActiveSpeaker, BoardEffect, Campaign, ClientEvent, DmMode, DmStatus, FloorView, GameState, Moment, NpcFocusView, Pickup, RollResult, ServerEvent, VoiceOwnerView } from "@dm/shared";

export interface Job {
  id: string;
  label: string;
  status: "running" | "done" | "error";
  /** Server clock (the host laptop usually runs the server): the host chip shows the elapsed time. */
  startedAt?: number;
  detail?: string;
}

export interface ServerView {
  connected: boolean;
  campaign: Campaign | null;
  state: GameState | null;
  dm: { status: DmStatus; mode: DmMode };
  speaker: ActiveSpeaker | null;
  /** Someone is talking right now (live; level via lib/talk onTalkLevel). */
  talk: TalkView | null;
  /** The NPC the DM is voicing (close-up on the TV); its subtitles come via lib/talk onCaption. */
  npcFocus: NpcFocusView | null;
  /** Table mic muted: the DM hears nothing (see lib/mic). */
  micMuted: boolean;
  jobs: Job[];
  errors: { id: number; message: string }[];
  lastEnroll?: { playerId: string; ok: boolean; samples: number; message: string };
  /** AI players: what each is doing now (by player id; missing = idle). */
  aiPlayers: Record<string, { status: "idle" | "thinking" | "speaking"; line?: string }>;
  /** The /table screen carrying the voice call (mic, DM audio): /host shows it. null until the server said. */
  voiceOwner: VoiceOwnerView | null;
  /** Push-to-talk: on or off, and who holds the floor (lib/floor.ts). null until the server said. */
  floor: FloorView | null;
}

/** `state` is the latest state received, set synchronously (it never lags a React render). */
type RollListener = (roll: RollResult, state: GameState | null) => void;
type EffectListener = (effect: BoardEffect) => void;
/** Moments are transient (never in ServerView or the snapshot); `state` as for RollListener. */
type MomentListener = (moment: Moment, state: GameState | null) => void;
/** A pick_up for the TV toast (transient, never in the snapshot). */
type PickupListener = (pickup: Pickup) => void;

/** Planned voice-call handover phases (the /table call's VoiceLink acts on them). */
export type VoiceHandoverPhase = "prepare" | "swap" | "abort";
const handoverListeners = new Set<(phase: VoiceHandoverPhase) => void>();

/** Listen for voice_handover events; returns an unsubscribe function. */
export function onVoiceHandover(fn: (phase: VoiceHandoverPhase) => void): () => void {
  handoverListeners.add(fn);
  return () => void handoverListeners.delete(fn);
}

export type VoiceCommand = Extract<ServerEvent, { type: "voice_command" }>["action"];
const commandListeners = new Set<(action: VoiceCommand) => void>();

/** Listen for voice_command events (sent only to the /table that carries the call). */
export function onVoiceCommand(fn: (action: VoiceCommand) => void): () => void {
  commandListeners.add(fn);
  return () => void commandListeners.delete(fn);
}

/** The page's open /ws socket. */
let openSocket: WebSocket | undefined;

/** Send a ClientEvent over /ws; false while disconnected (the caller re-sends on reconnect). */
export function sendToServer(ev: ClientEvent): boolean {
  if (openSocket?.readyState !== WebSocket.OPEN) return false;
  openSocket.send(JSON.stringify(ev));
  return true;
}

/** Live connection to /ws. Rolls are delivered via onRoll (for animations) and in state.rolls. */
export interface UseServerOptions {
  /**
   * Play speak_as_npc clips on this page. Default: only the TV (`table`), which also reports each
   * clip's end so the DM can go on. A remote /play page plays them too but never reports (the room's
   * TV does; /api/npc/clip-ended is a table route).
   */
  playClips?: boolean;
}

export function useServer(role: "host" | "table" | "player", onRoll?: RollListener, onEffect?: EffectListener, onMoment?: MomentListener, onPickup?: PickupListener, opts: UseServerOptions = {}): ServerView {
  const [view, setView] = useState<ServerView>({
    connected: false,
    campaign: null,
    state: null,
    dm: { status: "offline", mode: "none" },
    speaker: null,
    talk: null,
    npcFocus: null,
    micMuted: false,
    aiPlayers: {},
    voiceOwner: null,
    floor: null,
    jobs: [],
    errors: [],
  });
  const rollRef = useRef(onRoll);
  rollRef.current = onRoll;
  const effectRef = useRef(onEffect);
  effectRef.current = onEffect;
  const momentRef = useRef(onMoment);
  momentRef.current = onMoment;
  const pickupRef = useRef(onPickup);
  pickupRef.current = onPickup;
  // The server sends a roll right after the state it belongs to; React may not have rendered that
  // state yet when the roll arrives, so keep the newest one here for the roll callback.
  const latestState = useRef<GameState | null>(null);
  const playClips = !!opts.playClips;

  useEffect(() => {
    let ws: WebSocket | undefined;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout>;
    let errId = 0;
    // speak_as_npc clips: the TV (table speaker) plays them in order, honours mute, reports the end;
    // a remote /play page (playClips) plays them for its player without reporting.
    const reports = role === "table";
    const npc =
      reports || playClips
        ? new NpcClipPlayer({
            createAudio: (url) => new Audio(url) as unknown as ClipAudio,
            isMuted,
            reportEnded: (url) => void (reports && api("/npc/clip-ended", { url }).catch(() => undefined)),
            // autoplay refused the clip: the page shows "Click to enable sound" again
            onBlocked: markAudioLocked,
          })
        : undefined;
    const offMute = npc ? onMuteChange(() => npc.onMute()) : undefined;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      const sock = ws;
      let opened = false;
      ws.onopen = () => {
        opened = true;
        openSocket = sock;
        sock.send(JSON.stringify({ type: "hello", role }));
        setView((v) => ({ ...v, connected: true }));
      };
      ws.onclose = (ev) => {
        if (openSocket === sock) openSocket = undefined;
        // The server lets go of a floor held from this socket when it closes.
        setView((v) => ({ ...v, connected: false, talk: null, npcFocus: null, voiceOwner: null, floor: v.floor && { ...v.floor, holder: null } }));
        if (stopped) return;
        if (!needsCheck({ opened, code: ev.code })) {
          retry = setTimeout(connect, 1500);
          return;
        }
        // Refused (no sign-in) or signed out (kick, new table code): sign in instead of retrying forever.
        api<Me>("/auth/me")
          .catch(() => undefined)
          .then((me) => {
            if (stopped) return;
            if (afterSocketClose(me, role) === "sign-in" && redirectToSignIn()) return;
            retry = setTimeout(connect, 1500);
          });
      };
      ws.onmessage = (msg) => {
        const ev = JSON.parse(msg.data) as ServerEvent;
        switch (ev.type) {
          case "state":
            latestState.current = ev.state;
            setView((v) => ({ ...v, state: ev.state, speaker: ev.state.activeSpeaker ?? v.speaker }));
            break;
          case "campaign":
            setView((v) => ({ ...v, campaign: ev.campaign }));
            break;
          case "roll":
            rollRef.current?.(ev.roll, latestState.current);
            break;
          case "effect":
            effectRef.current?.(ev.effect);
            break;
          case "moment":
            momentRef.current?.(ev.moment, latestState.current);
            break;
          case "pickup":
            pickupRef.current?.(ev.pickup);
            break;
          case "speaker":
            setView((v) => ({ ...v, speaker: ev.speaker }));
            break;
          case "talk":
            setTalkLevel(ev.talk.active ? ev.talk.level ?? 0 : 0);
            setView((v) => {
              const talk = reduceTalk(v.talk, ev.talk);
              return talk === v.talk ? v : { ...v, talk };
            });
            break;
          case "dm_status":
            setView((v) => ({ ...v, dm: { status: ev.status, mode: ev.mode } }));
            break;
          case "mic":
            setView((v) => ({ ...v, micMuted: ev.muted }));
            break;
          case "ai_player":
            setView((v) => ({ ...v, aiPlayers: { ...v.aiPlayers, [ev.playerId]: { status: ev.status, line: ev.line ?? v.aiPlayers[ev.playerId]?.line } } }));
            break;
          case "job":
            setView((v) => {
              const jobs = v.jobs.filter((j) => j.id !== ev.id);
              jobs.push({ id: ev.id, label: ev.label, status: ev.status, detail: ev.detail, startedAt: ev.startedAt });
              return { ...v, jobs: jobs.slice(-12) };
            });
            if (ev.status === "done") {
              setTimeout(() => setView((v) => ({ ...v, jobs: v.jobs.filter((j) => j.id !== ev.id) })), 3000);
            }
            break;
          case "npc_speech":
            npc?.enqueue(ev.url);
            // The clip's line is its subtitle (the close-up shows it while the clip plays).
            pushCaption({ id: ev.url, npcName: ev.npcName, text: ev.line, final: true, clip: true, portraitUrl: ev.portraitUrl, pc: ev.pc });
            break;
          case "npc_focus":
            setView((v) => ({ ...v, npcFocus: ev.focus }));
            break;
          case "caption":
            pushCaption(ev.caption);
            break;
          case "voice_handover":
            handoverListeners.forEach((fn) => fn(ev.phase));
            break;
          case "voice_command":
            commandListeners.forEach((fn) => fn(ev.action));
            break;
          case "voice_owner":
            setView((v) => ({ ...v, voiceOwner: ev.owner }));
            break;
          case "floor":
            setView((v) => ({ ...v, floor: ev.floor }));
            break;
          case "enroll":
            setView((v) => ({ ...v, lastEnroll: ev }));
            break;
          case "error": {
            const id = ++errId;
            setView((v) => ({ ...v, errors: [...v.errors, { id, message: ev.message }].slice(-5) }));
            setTimeout(() => setView((v) => ({ ...v, errors: v.errors.filter((e) => e.id !== id) })), 8000);
            break;
          }
        }
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      offMute?.();
      npc?.stop();
      ws?.close();
    };
  }, [role, playClips]);

  return view;
}
