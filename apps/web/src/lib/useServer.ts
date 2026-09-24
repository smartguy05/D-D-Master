import { useEffect, useRef, useState } from "react";
import type { ActiveSpeaker, Campaign, DmMode, DmStatus, GameState, RollResult, ServerEvent } from "@dm/shared";

export interface Job {
  id: string;
  label: string;
  status: "running" | "done" | "error";
  detail?: string;
}

export interface ServerView {
  connected: boolean;
  campaign: Campaign | null;
  state: GameState | null;
  dm: { status: DmStatus; mode: DmMode };
  speaker: ActiveSpeaker | null;
  jobs: Job[];
  errors: { id: number; message: string }[];
  lastEnroll?: { playerId: string; ok: boolean; samples: number; message: string };
}

type RollListener = (roll: RollResult) => void;

/** Live connection to /ws. Rolls are delivered via onRoll (for animations) and in state.rolls. */
export function useServer(role: "host" | "table", onRoll?: RollListener): ServerView {
  const [view, setView] = useState<ServerView>({
    connected: false,
    campaign: null,
    state: null,
    dm: { status: "offline", mode: "none" },
    speaker: null,
    jobs: [],
    errors: [],
  });
  const rollRef = useRef(onRoll);
  rollRef.current = onRoll;

  useEffect(() => {
    let ws: WebSocket | undefined;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout>;
    let errId = 0;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => {
        ws!.send(JSON.stringify({ type: "hello", role }));
        setView((v) => ({ ...v, connected: true }));
      };
      ws.onclose = () => {
        setView((v) => ({ ...v, connected: false }));
        if (!stopped) retry = setTimeout(connect, 1500);
      };
      ws.onmessage = (msg) => {
        const ev = JSON.parse(msg.data) as ServerEvent;
        switch (ev.type) {
          case "state":
            setView((v) => ({ ...v, state: ev.state, speaker: ev.state.activeSpeaker ?? v.speaker }));
            break;
          case "campaign":
            setView((v) => ({ ...v, campaign: ev.campaign }));
            break;
          case "roll":
            rollRef.current?.(ev.roll);
            break;
          case "speaker":
            setView((v) => ({ ...v, speaker: ev.speaker }));
            break;
          case "dm_status":
            setView((v) => ({ ...v, dm: { status: ev.status, mode: ev.mode } }));
            break;
          case "job":
            setView((v) => {
              const jobs = v.jobs.filter((j) => j.id !== ev.id);
              jobs.push({ id: ev.id, label: ev.label, status: ev.status, detail: ev.detail });
              return { ...v, jobs: jobs.slice(-12) };
            });
            if (ev.status === "done") {
              setTimeout(() => setView((v) => ({ ...v, jobs: v.jobs.filter((j) => j.id !== ev.id) })), 3000);
            }
            break;
          case "npc_speech":
            // speak_as_npc: the TV (table speaker) plays the synthesized NPC line.
            if (role === "table") void new Audio(ev.url).play().catch(() => undefined);
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
      ws?.close();
    };
  }, [role]);

  return view;
}
