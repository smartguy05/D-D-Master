import { describe, expect, it } from "vitest";
import { shouldAutoResume } from "./voicePlan";

const base = { wsConnected: true, dmMode: "voice", dmStatus: "connecting", link: "idle", ownerLink: "idle", tried: false } as const;

describe("shouldAutoResume", () => {
  it("rejoins a voice DM that is still up when no table carries its call", () => {
    expect(shouldAutoResume(base)).toBe(true);
    expect(shouldAutoResume({ ...base, dmStatus: "listening" })).toBe(true);
  });

  it("not for a stopped or text DM, nor while this or another table has a call", () => {
    expect(shouldAutoResume({ ...base, dmStatus: "offline" })).toBe(false);
    expect(shouldAutoResume({ ...base, dmMode: "text" })).toBe(false);
    expect(shouldAutoResume({ ...base, link: "connected" })).toBe(false);
    expect(shouldAutoResume({ ...base, ownerLink: "connected" })).toBe(false);
  });

  it("only once, and only after the server's snapshot", () => {
    expect(shouldAutoResume({ ...base, tried: true })).toBe(false);
    expect(shouldAutoResume({ ...base, ownerLink: null })).toBe(false);
    expect(shouldAutoResume({ ...base, wsConnected: false })).toBe(false);
  });
});
