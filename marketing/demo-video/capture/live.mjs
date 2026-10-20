// Live game feed over the server's /ws: latest state, log lines, rolls, NPC focus, DM status.
import { API, sleep } from "./recorder.mjs";

export function connectLive() {
  const live = { state: null, dm: null, focus: null, rolls: [], logs: [], events: [] };
  const ws = new WebSocket(API.replace("http", "ws") + "/ws");
  ws.addEventListener("open", () => ws.send(JSON.stringify({ type: "hello", role: "host" })));
  ws.addEventListener("message", (msg) => {
    const ev = JSON.parse(msg.data);
    live.events.push({ t: Date.now(), type: ev.type });
    if (ev.type === "state") {
      // Log lines arrive inside state updates; print the new ones.
      const prev = live.state?.log ?? [];
      const next = ev.state.log ?? [];
      const known = new Set(prev.map((e) => e.id ?? `${e.ts}${e.text}`));
      if (live.state) {
        for (const e of next) {
          if (known.has(e.id ?? `${e.ts}${e.text}`)) continue;
          live.logs.push({ t: Date.now(), ...e });
          console.log(`  [${e.kind}] ${e.speaker ? e.speaker + ": " : ""}${String(e.text ?? "").slice(0, 220)}`);
        }
      }
      live.state = ev.state;
    }
    if (ev.type === "dm_status") live.dm = ev;
    if (ev.type === "npc_focus") live.focus = ev.focus;
    if (ev.type === "npc_speech") {
      live.npcSpeech = [...(live.npcSpeech ?? []), { t: Date.now(), ...ev }];
      console.log(`  [npc_speech] ${ev.npcName}: ${ev.line}`);
    }
    if (ev.type === "roll") {
      live.rolls.push({ t: Date.now(), ...ev.roll });
      const d20 = ev.roll.dice?.find((d) => d.sides === 20);
      console.log(`  [roll] ${ev.roll.label ?? ""} ${ev.roll.notation} = ${ev.roll.total}${d20 ? ` (d20 ${d20.value})` : ""}`);
    }
    if (ev.type === "log") {
      live.logs.push({ t: Date.now(), ...ev.entry });
      const e = ev.entry;
      console.log(`  [${e.kind}] ${e.speaker ? e.speaker + ": " : ""}${String(e.text ?? "").slice(0, 220)}`);
    }
    if (ev.type === "error") console.log(`  [error] ${ev.message}`);
  });
  live.close = () => ws.close();
  /** Resolve when pred(live) is true; returns false on timeout. */
  live.waitFor = async (pred, timeoutMs = 60000, everyMs = 250) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      try { if (pred(live)) return true; } catch {}
      await sleep(everyMs);
    }
    return false;
  };
  /** Wait until the DM has been quiet (no new log lines) for quietMs. */
  live.settle = async (quietMs = 4000, timeoutMs = 90000) => {
    const end = Date.now() + timeoutMs;
    let n = live.logs.length, since = Date.now();
    while (Date.now() < end) {
      await sleep(250);
      if (live.logs.length !== n) { n = live.logs.length; since = Date.now(); }
      else if (Date.now() - since > quietMs) return true;
    }
    return false;
  };
  return live;
}
