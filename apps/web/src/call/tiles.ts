import type { FloorView, GameState, PeerInfo, PeerPrefs } from "@dm/shared";

/**
 * The call's video tiles (call/VideoStrip.tsx, docs/web/online-call.md), as pure view models: who a
 * tile is, whether it shows video or the character card, the talking ring (a local level meter) and the
 * gold push-to-talk ring. Plus the per-device prefs (camera, character instead, mute toward players).
 */

/** Fallback color dot for a seat without a character (the Character schema's default). */
const NO_CHARACTER_COLOR = "#c9a227";

export interface TileView {
  key: string;
  self: boolean;
  room: boolean;
  /** Character name, the player's name without one, or "The table". */
  title: string;
  /** The player's name under a character name. */
  subtitle?: string;
  spriteUrl?: string;
  color: string;
  hp?: { hp: number; max: number; temp: number };
  conditions: string[];
  /** Show the video element (else the character card). */
  video: boolean;
  /** Ring from the local level meter. */
  talking: boolean;
  /** Gold ring: holds the push-to-talk floor (the room tile for the room and in-room players). */
  floor: boolean;
  /** Muted toward the other players. */
  micOff: boolean;
}

export function tileView(o: { peer: PeerInfo; state: GameState | null; floor: FloorView | null; talking: boolean; self: boolean; hasVideo: boolean }): TileView {
  const { peer } = o;
  const h = o.floor?.pushToTalk ? o.floor.holder : null;
  const floor = !!h && (peer.room ? "room" in h || h.inRoom : "playerId" in h && !h.inRoom && h.playerId === peer.playerId);
  const base = { key: peer.peerId, self: o.self, room: peer.room, video: o.hasVideo && peer.camera && !peer.showCharacter, talking: o.talking, floor, micOff: !peer.micOn, conditions: [] as string[] };
  if (peer.room) return { ...base, title: "The table", color: NO_CHARACTER_COLOR };
  const player = o.state?.players.find((p) => p.id === peer.playerId);
  const ch = player?.characterId ? o.state?.characters.find((c) => c.id === player.characterId) : undefined;
  if (!ch) return { ...base, title: player?.name ?? "Player", color: NO_CHARACTER_COLOR };
  return {
    ...base,
    title: ch.name,
    subtitle: player?.name,
    spriteUrl: ch.spriteUrl,
    color: ch.color,
    hp: { hp: ch.hp, max: ch.maxHp, temp: ch.tempHp ?? 0 },
    conditions: ch.conditions,
  };
}

/** The strip's order: this page's own tile, then the room, then the other players in join order. */
export function stripTiles(peers: PeerInfo[], self: string | null): PeerInfo[] {
  const own = peers.filter((p) => p.peerId === self);
  const room = peers.filter((p) => p.room && p.peerId !== self);
  const rest = peers.filter((p) => !p.room && p.peerId !== self);
  return [...own, ...room, ...rest];
}

/** Level 0..1 of one analyser frame (time-domain samples -1..1): the RMS, scaled so speech nears 1. */
export function levelOf(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.min(1, Math.sqrt(sum / samples.length) * 4);
}

const TALK_ON = 0.15;
const TALK_OFF = 0.06;

/** The talking ring with hysteresis: on above TALK_ON, off below TALK_OFF, so it doesn't flicker. */
export function nextTalking(prev: boolean, level: number): boolean {
  return prev ? level >= TALK_OFF : level > TALK_ON;
}

/** A remote /play page: camera off until the player turns it on (no prompt, no error without a webcam), mic on toward the players. */
export const DEFAULT_PLAY_PREFS: PeerPrefs = { camera: false, showCharacter: false, micOn: true };
/** The TV: no webcam unless someone turns it on; the room mic on toward the remote players. */
export const DEFAULT_TABLE_PREFS: PeerPrefs = { camera: false, showCharacter: false, micOn: true };

/** An in-room phone used as its player's mic: no camera, no card, muted toward players (the server forces the same). */
export const PHONE_MIC_PREFS: PeerPrefs = { camera: false, showCharacter: false, micOn: false };

export function callPrefsKey(page: "play" | "table" | "player"): string {
  return `dm.call.${page}`;
}

type PrefsStorage = Pick<Storage, "getItem" | "setItem">;

/** This device's prefs (localStorage); the defaults when missing, unreadable or blocked. */
export function loadCallPrefs(storage: PrefsStorage | undefined, key: string, defaults: PeerPrefs): PeerPrefs {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return defaults;
    const v = JSON.parse(raw) as Partial<PeerPrefs>;
    return {
      camera: typeof v.camera === "boolean" ? v.camera : defaults.camera,
      showCharacter: typeof v.showCharacter === "boolean" ? v.showCharacter : defaults.showCharacter,
      micOn: typeof v.micOn === "boolean" ? v.micOn : defaults.micOn,
    };
  } catch {
    return defaults;
  }
}

export function saveCallPrefs(storage: PrefsStorage | undefined, key: string, prefs: PeerPrefs) {
  try {
    storage?.setItem(key, JSON.stringify(prefs));
  } catch {
    /* storage blocked: the prefs last for this page only */
  }
}
