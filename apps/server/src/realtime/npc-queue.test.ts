import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerEvent } from "@dm/shared";
import { CLIP_END_GRACE_MS, DM_SPEAKING_MAX_WAIT_MS, NpcClipQueue } from "./npc-queue.js";

function setup() {
  const events: ServerEvent[] = [];
  const q = new NpcClipQueue({ broadcast: (ev) => void events.push(ev) });
  const clip = (n: number, durationMs = 2000) => ({ npcName: `NPC ${n}`, line: `Line ${n}`, url: `/media/c/npc_${n}.mp3`, durationMs });
  const played = () => events.map((e) => (e as Extract<ServerEvent, { type: "npc_speech" }>).url);
  return { q, events, clip, played };
}

describe("NpcClipQueue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("plays at once when the DM is silent and resolves when the table reports the end", async () => {
    const { q, clip, played, events } = setup();
    let done = false;
    void q.enqueue(clip(1)).then(() => (done = true));
    expect(played()).toEqual(["/media/c/npc_1.mp3"]);
    expect(events[0]).toMatchObject({ type: "npc_speech", npcName: "NPC 1", line: "Line 1" });
    await vi.advanceTimersByTimeAsync(500);
    expect(done).toBe(false);
    expect(q.clipEnded("/media/c/npc_1.mp3")).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
    // A second report (another table) is ignored.
    expect(q.clipEnded("/media/c/npc_1.mp3")).toBe(false);
  });

  it("holds the broadcast until the DM's audio stops", async () => {
    const { q, clip, played } = setup();
    q.setDmSpeaking(true);
    void q.enqueue(clip(1));
    await vi.advanceTimersByTimeAsync(5000);
    expect(played()).toEqual([]);
    q.setDmSpeaking(false);
    expect(played()).toEqual(["/media/c/npc_1.mp3"]);
  });

  it("plays anyway if the DM never reports silence", async () => {
    const { q, clip, played } = setup();
    q.setDmSpeaking(true);
    void q.enqueue(clip(1));
    await vi.advanceTimersByTimeAsync(DM_SPEAKING_MAX_WAIT_MS - 1);
    expect(played()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(played()).toEqual(["/media/c/npc_1.mp3"]);
  });

  it("times out at clip length + grace when no table reports (no table connected)", async () => {
    const { q, clip } = setup();
    let done = false;
    void q.enqueue(clip(1, 3000)).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(3000 + CLIP_END_GRACE_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it("plays several clips in order, one at a time", async () => {
    const { q, clip, played } = setup();
    const order: number[] = [];
    void q.enqueue(clip(1)).then(() => order.push(1));
    void q.enqueue(clip(2)).then(() => order.push(2));
    void q.enqueue(clip(3)).then(() => order.push(3));
    expect(played()).toEqual(["/media/c/npc_1.mp3"]);
    // An end report for a clip that isn't playing yet doesn't skip ahead.
    expect(q.clipEnded("/media/c/npc_3.mp3")).toBe(false);
    q.clipEnded("/media/c/npc_1.mp3");
    expect(played()).toEqual(["/media/c/npc_1.mp3", "/media/c/npc_2.mp3"]);
    // The DM starts talking between clips: the next waits again.
    q.setDmSpeaking(true);
    q.clipEnded("/media/c/npc_2.mp3");
    expect(played()).toHaveLength(2);
    q.setDmSpeaking(false);
    expect(played()).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(order).toEqual([1, 2, 3]);
  });

  it("clear() releases every waiting clip without playing it", async () => {
    const { q, clip, played } = setup();
    q.setDmSpeaking(true);
    const all = Promise.all([q.enqueue(clip(1)), q.enqueue(clip(2))]);
    q.clear();
    await all;
    expect(played()).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(played()).toEqual([]);
  });
});
