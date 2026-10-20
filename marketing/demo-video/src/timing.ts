import { createContext, useContext } from "react";

export const FPS = 60;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const TOTAL_BARS = 15;
export const DEFAULT_BPM = 120;

export type Timing = {
  bpm: number;
  framesPerBeat: number;
  /** Frame of beat n (0-indexed from frame 0; fractional beats allowed). */
  beat: (n: number) => number;
  /** Frame of the start of bar n (0-indexed, 4/4). */
  bar: (n: number) => number;
  totalFrames: number;
};

export const makeTiming = (bpm: number): Timing => {
  const framesPerBeat = (FPS * 60) / bpm;
  const beat = (n: number) => Math.round(n * framesPerBeat);
  const bar = (n: number) => beat(n * 4);
  return { bpm, framesPerBeat, beat, bar, totalFrames: bar(TOTAL_BARS) };
};

export const TimingContext = createContext<Timing>(makeTiming(DEFAULT_BPM));
export const useTiming = () => useContext(TimingContext);

/**
 * Scene boundaries, in beats from frame 0. Everything in the timeline is placed from these, so a
 * different track only changes the bpm. Bars are 0-indexed here (BRIEF bar 1 = beat 0).
 */
export const BEATS = {
  hook: 0, // bars 1–2: room push-in, dice, nat 20
  hookHit: 4, // musical hit / crit burst (overridden by analysis.hitSec when present)
  voice: 8, // bars 3–4
  map: 16, // bar 5
  npc: 20, // bar 6
  combat: 24, // bar 7
  phone: 28, // bar 8, beats 1–2
  montage: 30, // bar 8, beats 3–4
  host: 32, // bars 9–12 walkthrough starts with the host laptop
  walkthrough: 36,
  pullback: 46, // last half-bar of the walkthrough: back out to the room
  end: 48, // bars 13–15 end card
  total: 60,
} as const;
