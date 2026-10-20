import { staticFile } from "remotion";
import { DEFAULT_BPM } from "./timing";

/** Shot ids from the BRIEF shot list. */
export type ShotId =
  | "hook-dice"
  | "voice-talking"
  | "map-fog"
  | "npc-closeup"
  | "combat-turn"
  | "phone-sheet"
  | "host-start"
  | "walkthrough";

export type Highlight = { tSec: number; label: string };
export type ShotEntry = {
  id: string;
  file: string;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  highlights?: Highlight[];
};

export type Analysis = {
  file: string;
  title?: string;
  artist?: string;
  bpm: number;
  downbeatSec?: number;
  windowStartSec: number;
  hitSec?: number;
  endingSec?: number;
};

/** Resolved inputs passed to the composition as props by calculateMetadata. */
export type DemoProps = {
  bpm: number;
  /** Audio file under public/ and where the 30s window starts in it; null renders silent. */
  audio: { src: string; startSec: number } | null;
  /** Beats from frame 0 at which the musical hit lands (crit burst). */
  hitBeat: number | null;
  /** Shots that exist on disk, by id. Missing ids fall back to stills. */
  shots: Partial<Record<ShotId, ShotEntry>>;
  /** Synthesized SFX present under public/sfx/ (see scripts/make-sfx.sh). */
  sfx: string[];
};

export const defaultProps: DemoProps = { bpm: DEFAULT_BPM, audio: null, hitBeat: null, shots: {}, sfx: [] };

/**
 * Placeholder still per shot (public/stills/) and which highlight to align to. `keyword` picks the
 * first highlight whose label matches; otherwise the first highlight is used.
 */
export const SHOT_CONFIG: Record<ShotId, { still: string; keyword?: RegExp }> = {
  "hook-dice": { still: "stills/crit.png", keyword: /nat|20|crit|land/i },
  "voice-talking": { still: "stills/table.png", keyword: /talk|speak|voice|name/i },
  "map-fog": { still: "stills/table-after.png", keyword: /fog|reveal|map/i },
  "npc-closeup": { still: "stills/closeup.png", keyword: /speaks \(dm\)|subtitle|close/i },
  "combat-turn": { still: "stills/table-screenshot.png", keyword: /attack|damage|hit|hp/i },
  "phone-sheet": { still: "stills/sprite-8.png", keyword: /hp|damage|sheet/i },
  "host-start": { still: "stills/map_873bffb1ffdc.png", keyword: /start|session|dm/i },
  walkthrough: { still: "stills/table-screenshot.png" },
};

const exists = async (path: string) => {
  try {
    const res = await fetch(staticFile(path), { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
};

const readJson = async <T,>(path: string): Promise<T | null> => {
  try {
    const res = await fetch(staticFile(path));
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
};

/** Reads public/footage/shots.json, public/audio/analysis.json and the sfx folder, if present. */
export const loadInputs = async (): Promise<DemoProps> => {
  const [shotsJson, analysis] = await Promise.all([
    readJson<ShotEntry[]>("footage/shots.json"),
    readJson<Analysis>("audio/analysis.json"),
  ]);

  const shots: DemoProps["shots"] = {};
  for (const s of shotsJson ?? []) {
    const file = s.file.replace(/^(public\/)?(footage\/)?/, "footage/");
    if (s.id in SHOT_CONFIG && (await exists(file))) shots[s.id as ShotId] = { ...s, file };
  }

  let audio: DemoProps["audio"] = null;
  let bpm = DEFAULT_BPM;
  let hitBeat: number | null = null;
  const candidates = [analysis?.file, "track.mp3", "track.wav", "track.m4a", "track.ogg"].filter(Boolean) as string[];
  for (const f of candidates) {
    const src = `audio/${f.replace(/^(public\/)?(audio\/)?/, "")}`;
    if (await exists(src)) {
      audio = { src, startSec: analysis?.windowStartSec ?? 0 };
      break;
    }
  }
  if (analysis?.bpm && analysis.bpm > 60 && analysis.bpm < 200) bpm = analysis.bpm;
  if (analysis?.hitSec != null && analysis.windowStartSec != null) {
    const beats = ((analysis.hitSec - analysis.windowStartSec) * bpm) / 60;
    // Only honour hits that fall inside the hook (bars 1–2); snap to the nearest beat.
    if (beats >= 1 && beats <= 7) hitBeat = Math.round(beats);
  }

  const sfxNames = ["whoosh", "impact", "dice", "chime", "sword", "stamp"];
  const sfx: string[] = [];
  for (const n of sfxNames) if (await exists(`sfx/${n}.wav`)) sfx.push(n);

  return { bpm, audio, hitBeat, shots, sfx };
};
