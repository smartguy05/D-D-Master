import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerEvent } from "@dm/shared";
import { CLIP_END_GRACE_MS, DM_SPEAKING_MAX_WAIT_MS, ECHO_TAIL_MS, NpcClipQueue, RESERVE_MAX_MS } from "./npc-queue.js";

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

  it("reserve(): a slot keeps its place in line until its clip is ready", async () => {
    const { q, clip, played } = setup();
    const first = q.reserve();
    const second = q.reserve();
    second.play(clip(2));
    expect(played()).toEqual([]);
    first.play(clip(1));
    expect(played()).toEqual(["/media/c/npc_1.mp3"]);
    q.clipEnded("/media/c/npc_1.mp3");
    expect(played()).toEqual(["/media/c/npc_1.mp3", "/media/c/npc_2.mp3"]);
    let done = false;
    void second.done.then(() => (done = true));
    q.clipEnded("/media/c/npc_2.mp3");
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });

  it("cancel() frees the slot at once, long before it would expire", async () => {
    const { q, clip, played } = setup();
    const failed = q.reserve();
    const next = q.reserve();
    next.play(clip(2));
    await vi.advanceTimersByTimeAsync(100);
    expect(played()).toEqual([]);
    failed.cancel();
    expect(played()).toEqual(["/media/c/npc_2.mp3"]);
  });

  it("play() reports whether the slot was still live", async () => {
    const { q, clip } = setup();
    const slot = q.reserve();
    await vi.advanceTimersByTimeAsync(RESERVE_MAX_MS);
    expect(slot.play(clip(1))).toBe(false);
    expect(q.reserve().play(clip(2))).toBe(true);
    q.clear();
  });

  it("a cancelled or never-filled slot doesn't block the queue", async () => {
    const { q, clip, played } = setup();
    const failed = q.reserve();
    const stuck = q.reserve();
    const next = q.reserve();
    next.play(clip(3));
    failed.cancel();
    expect(played()).toEqual([]);
    await vi.advanceTimersByTimeAsync(RESERVE_MAX_MS);
    expect(played()).toEqual(["/media/c/npc_3.mp3"]);
    // A late play() on the expired slot is ignored.
    stuck.play(clip(2));
    q.clipEnded("/media/c/npc_3.mp3");
    expect(played()).toEqual(["/media/c/npc_3.mp3"]);
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

describe("NpcClipQueue: back-to-back clips (Phase 4, every NPC line voiced)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("3 slots filled out of order (3rd, 1st, 2nd) play strictly in reservation order, each right after the previous ended", async () => {
    const { q, clip, played } = setup();
    const s1 = q.reserve();
    const s2 = q.reserve();
    const s3 = q.reserve();
    s3.play(clip(3));
    expect(played()).toEqual([]);
    s1.play(clip(1));
    expect(played()).toEqual(["/media/c/npc_1.mp3"]);
    s2.play(clip(2));
    // Clip 1 is still playing: nothing else starts, however long we wait short of its end.
    await vi.advanceTimersByTimeAsync(1500);
    expect(played()).toEqual(["/media/c/npc_1.mp3"]);
    // The table reports the end: clip 2 starts at once (no CLIP_END_GRACE_MS wait).
    expect(q.clipEnded("/media/c/npc_1.mp3")).toBe(true);
    expect(played()).toEqual(["/media/c/npc_1.mp3", "/media/c/npc_2.mp3"]);
    // Clip 3 waits for clip 2.
    expect(q.clipEnded("/media/c/npc_3.mp3")).toBe(false);
    expect(played()).toHaveLength(2);
    expect(q.clipEnded("/media/c/npc_2.mp3")).toBe(true);
    expect(played()).toEqual(["/media/c/npc_1.mp3", "/media/c/npc_2.mp3", "/media/c/npc_3.mp3"]);
    const order: number[] = [];
    void s1.done.then(() => order.push(1));
    void s2.done.then(() => order.push(2));
    void s3.done.then(() => order.push(3));
    q.clipEnded("/media/c/npc_3.mp3");
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual([1, 2, 3]);
    expect(q.size).toBe(0);
  });
});

describe("NpcClipQueue.echoAt (mic echo of table clips)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("is false before any clip, true while one plays and for ECHO_TAIL_MS after it ended", async () => {
    const { q, clip } = setup();
    expect(q.echoAt(Date.now())).toBe(false);
    const start = Date.now();
    void q.enqueue(clip(1, 10_000));
    await vi.advanceTimersByTimeAsync(1000);
    expect(q.echoAt(Date.now())).toBe(true);
    expect(q.echoAt(start - 1)).toBe(false);
    q.clipEnded("/media/c/npc_1.mp3");
    const ended = Date.now();
    expect(q.echoAt(ended + ECHO_TAIL_MS)).toBe(true);
    expect(q.echoAt(ended + ECHO_TAIL_MS + 1)).toBe(false);
  });
});
