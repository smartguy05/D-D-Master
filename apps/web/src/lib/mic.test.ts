import { describe, expect, it } from "vitest";
import { applyMicMute, isMicHotkey } from "./mic";

describe("applyMicMute", () => {
  it("disables every audio track when muted and re-enables them when unmuted", () => {
    const tracks = [{ enabled: true }, { enabled: true }];
    const stream = { getAudioTracks: () => tracks };
    applyMicMute(stream, true);
    expect(tracks.map((t) => t.enabled)).toEqual([false, false]);
    applyMicMute(stream, false);
    expect(tracks.map((t) => t.enabled)).toEqual([true, true]);
  });

  it("does nothing before the mic is enabled", () => {
    expect(() => applyMicMute(null, true)).not.toThrow();
  });
});

describe("isMicHotkey", () => {
  const body = { tagName: "BODY" };
  it("P or p on the page toggles", () => {
    expect(isMicHotkey({ key: "p", target: body })).toBe(true);
    expect(isMicHotkey({ key: "P", target: body })).toBe(true);
    expect(isMicHotkey({ key: "m", target: body })).toBe(false);
  });

  it("not while typing, and not with a modifier (Ctrl+P prints)", () => {
    expect(isMicHotkey({ key: "p", target: { tagName: "INPUT" } })).toBe(false);
    expect(isMicHotkey({ key: "p", target: { tagName: "TEXTAREA" } })).toBe(false);
    expect(isMicHotkey({ key: "p", target: { tagName: "DIV", isContentEditable: true } })).toBe(false);
    expect(isMicHotkey({ key: "p", ctrlKey: true, target: body })).toBe(false);
  });
});
