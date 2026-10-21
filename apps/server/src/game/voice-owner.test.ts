import { describe, expect, it } from "vitest";
import { pickAudioSource, pickVoiceOwner, voiceOwnerView } from "./voice-owner.js";

describe("pickAudioSource", () => {
  it("the table mic during play, the host mic while enrolling, whichever exists otherwise", () => {
    expect(pickAudioSource({ enrolling: false, host: 1, table: 1 })).toBe("table");
    expect(pickAudioSource({ enrolling: true, host: 1, table: 1 })).toBe("host");
    // Enrolling with no host mic: the table's stream records it.
    expect(pickAudioSource({ enrolling: true, host: 0, table: 1 })).toBe("table");
    expect(pickAudioSource({ enrolling: false, host: 1, table: 0 })).toBe("host");
    expect(pickAudioSource({ enrolling: false, host: 0, table: 0 })).toBeUndefined();
  });
});

describe("pickVoiceOwner", () => {
  it("keeps the table that carries the call; else the newest table", () => {
    expect(pickVoiceOwner(["a", "b"], "a")).toBe("a");
    expect(pickVoiceOwner(["a", "b"], undefined)).toBe("b");
    expect(pickVoiceOwner(["b"], "a")).toBe("b");
    expect(pickVoiceOwner([], "a")).toBeUndefined();
  });
});

describe("voiceOwnerView", () => {
  it("no table: idle, whatever was last reported", () => {
    expect(voiceOwnerView({ tables: 0, link: { state: "connected" }, tableAudio: 0 })).toEqual({ table: false, link: "idle", micStream: false });
  });
  it("a table with its link state, error and mic stream", () => {
    expect(voiceOwnerView({ tables: 1, link: { state: "failed", error: "no mic" }, tableAudio: 1 })).toEqual({ table: true, link: "failed", error: "no mic", micStream: true });
    expect(voiceOwnerView({ tables: 2, tableAudio: 0 })).toEqual({ table: true, link: "idle", micStream: false });
  });
});
