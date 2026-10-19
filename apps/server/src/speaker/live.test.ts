import type { ServerEvent } from "@dm/shared";
import { describe, expect, it } from "vitest";
import { LEVEL_EVERY_MS, LiveTalk, pcmLevel } from "./live.js";

function pcm(amplitude: number, n = 1600): Buffer {
  const b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round((i % 2 ? 1 : -1) * amplitude * 32767), i * 2);
  return b;
}

function setup(match?: { playerId: string; confident: boolean }) {
  let now = 1000;
  const events: ServerEvent[] = [];
  const calls: [number, number][] = [];
  const live = new LiveTalk({
    now: () => now,
    broadcast: (e) => void events.push(e),
    identify: (from, to) => (calls.push([from, to]), match),
  });
  return { live, events, calls, tick: (ms: number) => (now += ms), talks: () => events.filter((e) => e.type === "talk") };
}

describe("pcmLevel", () => {
  it("silence is 0, loud speech near 1, clamped", () => {
    expect(pcmLevel(pcm(0))).toBe(0);
    expect(pcmLevel(pcm(0.05))).toBeGreaterThan(0.2);
    expect(pcmLevel(pcm(1))).toBe(1);
  });
});

describe("LiveTalk", () => {
  it("announces speech start and stop", () => {
    const { live, talks } = setup();
    live.speechStarted();
    live.speechStopped();
    expect(talks()).toEqual([
      { type: "talk", talk: { who: "player", active: true, level: 0 } },
      { type: "talk", talk: { who: "player", active: false } },
    ]);
  });

  it("sends throttled levels only while someone is speaking", () => {
    const { live, talks, tick } = setup();
    live.onAudio(pcm(0.1));
    expect(talks()).toHaveLength(0);
    live.speechStarted();
    live.onAudio(pcm(0.1));
    tick(LEVEL_EVERY_MS - 1);
    live.onAudio(pcm(0.1));
    tick(1);
    live.onAudio(pcm(0.1));
    const levels = talks().filter((e) => e.type === "talk" && e.talk.active && e.talk.level! > 0);
    expect(levels).toHaveLength(2);
  });

  it("identifies the speaker during speech once enough audio is in, then reports it as provisional", () => {
    const { live, talks, calls, tick } = setup({ playerId: "plr_sam", confident: true });
    live.speechStarted();
    tick(500);
    live.onAudio(pcm(0.1));
    expect(calls).toHaveLength(0);
    tick(800);
    live.onAudio(pcm(0.1));
    expect(calls).toHaveLength(1);
    expect(calls[0][1] - calls[0][0]).toBeLessThanOrEqual(3000);
    expect(talks().at(-1)).toMatchObject({ talk: { who: "player", active: true, playerId: "plr_sam", provisional: true } });
    // Not again right away.
    tick(200);
    live.onAudio(pcm(0.1));
    expect(calls).toHaveLength(1);
  });

  it("an unsure match is not shown", () => {
    const { live, talks, tick } = setup({ playerId: "plr_sam", confident: false });
    live.speechStarted();
    tick(1500);
    live.onAudio(pcm(0.1));
    expect(talks().some((e) => e.type === "talk" && e.talk.playerId)).toBe(false);
  });

  it("nothing after the speech stopped", () => {
    const { live, calls, talks, tick } = setup({ playerId: "plr_sam", confident: true });
    live.speechStarted();
    live.speechStopped();
    tick(2000);
    live.onAudio(pcm(0.1));
    expect(calls).toHaveLength(0);
    expect(talks()).toHaveLength(2);
  });
});
