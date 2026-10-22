import { describe, expect, it } from "vitest";
import type { LogEntry } from "@dm/shared";
import { transcriptLines } from "./transcript";

const e = (id: string, kind: LogEntry["kind"], text: string, speaker?: string): LogEntry => ({ id, ts: Number(id.slice(1)), kind, text, speaker });

describe("transcriptLines (what a remote player reads while the DM's voice isn't sent to them)", () => {
  it("keeps the newest DM and player lines, oldest first", () => {
    const log = [e("l1", "dm", "Welcome.", "DM"), e("l2", "player", "I look around.", "Sam (Mara)"), e("l3", "dm", "You see a door.", "DM")];
    expect(transcriptLines(log, 2)).toEqual([
      { id: "l2", who: "Sam (Mara)", text: "I look around.", dm: false },
      { id: "l3", who: "DM", text: "You see a door.", dm: true },
    ]);
  });

  it("skips roll, system and tool lines (rolls show in the dice tray) and blank lines", () => {
    const log = [e("l1", "dm", "Roll stealth."), e("l2", "roll", "Mara rolls 14"), e("l3", "system", "saved"), e("l4", "tool", "x"), e("l5", "player", "   ")];
    expect(transcriptLines(log, 5).map((l) => l.id)).toEqual(["l1"]);
  });

  it("names unnamed lines (DM, Player) and trims text", () => {
    expect(transcriptLines([e("l1", "dm", "  Hi  "), e("l2", "player", "Yo")], 5)).toEqual([
      { id: "l1", who: "DM", text: "Hi", dm: true },
      { id: "l2", who: "Player", text: "Yo", dm: false },
    ]);
  });

  it("is empty for no log", () => {
    expect(transcriptLines([], 3)).toEqual([]);
  });
});
