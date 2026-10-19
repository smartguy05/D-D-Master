import type { ServerEvent } from "@dm/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NPC_FOCUS_IDLE_MS, NpcFocus } from "./npc-focus.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup() {
  const events: ServerEvent[] = [];
  const focus = new NpcFocus({ broadcast: (e) => void events.push(e) });
  return { focus, events };
}

describe("NpcFocus (TV close-up)", () => {
  it("broadcasts focus and clear; the snapshot repeats the current focus", () => {
    const { focus, events } = setup();
    focus.set({ name: "Mira", portraitUrl: "/a/mira.png" });
    expect(events.at(-1)).toEqual({ type: "npc_focus", focus: { name: "Mira", portraitUrl: "/a/mira.png" } });
    expect(focus.snapshot()).toEqual({ type: "npc_focus", focus: { name: "Mira", portraitUrl: "/a/mira.png" } });
    focus.set(null);
    expect(events.at(-1)).toEqual({ type: "npc_focus", focus: null });
    // Clearing twice says nothing new.
    focus.set(null);
    expect(events).toHaveLength(2);
  });

  it("forwards the DM's transcript as captions only while an NPC has the focus", () => {
    const { focus, events } = setup();
    focus.caption("r1", "Narration…", false);
    expect(events).toHaveLength(0);
    focus.set({ name: "Mira" });
    focus.caption("r1", "Welcome, ", false);
    focus.caption("r1", "Welcome, travellers.", true);
    expect(events.slice(1)).toEqual([
      { type: "caption", caption: { id: "r1", npcName: "Mira", text: "Welcome, ", final: false } },
      { type: "caption", caption: { id: "r1", npcName: "Mira", text: "Welcome, travellers.", final: true } },
    ]);
  });

  it("clears itself after a quiet minute; each line resets the clock", () => {
    const { focus, events } = setup();
    focus.set({ name: "Mira" });
    vi.advanceTimersByTime(NPC_FOCUS_IDLE_MS - 1000);
    focus.caption("r2", "Still here.", true);
    vi.advanceTimersByTime(NPC_FOCUS_IDLE_MS - 1000);
    expect(focus.current?.name).toBe("Mira");
    vi.advanceTimersByTime(1000);
    expect(focus.current).toBeNull();
    expect(events.at(-1)).toEqual({ type: "npc_focus", focus: null });
  });

  it("dispose stops the idle timer", () => {
    const { focus, events } = setup();
    focus.set({ name: "Mira" });
    focus.dispose();
    vi.advanceTimersByTime(NPC_FOCUS_IDLE_MS * 2);
    expect(events).toHaveLength(1);
  });
});
