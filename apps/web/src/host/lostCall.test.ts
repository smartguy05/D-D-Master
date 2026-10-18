import { describe, expect, it } from "vitest";
import { LOST_CALL_GRACE_MS, lostCall, offlineSince } from "./lostCall";

describe("lostCall", () => {
  const base = { link: "connected" as const, dmStatus: "offline" as const, wsConnected: true };

  it("shows once the WebRTC call is live but the server DM has been offline for the grace period", () => {
    expect(lostCall({ ...base, offlineSince: 1000, now: 1000 + LOST_CALL_GRACE_MS })).toBe(true);
    expect(lostCall({ ...base, offlineSince: 1000, now: 1000 + LOST_CALL_GRACE_MS - 1 })).toBe(false);
  });

  it("stays hidden while the DM is up or (re)connecting", () => {
    for (const dmStatus of ["connecting", "listening", "thinking", "speaking"] as const) {
      expect(lostCall({ ...base, dmStatus, offlineSince: 0, now: 60_000 })).toBe(false);
    }
  });

  it("stays hidden when there is no live browser call", () => {
    for (const link of ["idle", "connecting", "reconnecting", "failed"] as const) {
      expect(lostCall({ ...base, link, offlineSince: 0, now: 60_000 })).toBe(false);
    }
  });

  it("stays hidden while /ws is down (no snapshot yet) or before offline was observed", () => {
    expect(lostCall({ ...base, wsConnected: false, offlineSince: 0, now: 60_000 })).toBe(false);
    expect(lostCall({ ...base, offlineSince: null, now: 60_000 })).toBe(false);
  });
});

describe("offlineSince", () => {
  it("starts the clock when the lost-call condition first holds and keeps it while it lasts", () => {
    expect(offlineSince(null, { ...{ link: "connected", dmStatus: "offline", wsConnected: true } }, 500)).toBe(500);
    expect(offlineSince(500, { link: "connected", dmStatus: "offline", wsConnected: true }, 900)).toBe(500);
  });

  it("resets when the DM comes back, the call ends or /ws drops", () => {
    expect(offlineSince(500, { link: "connected", dmStatus: "listening", wsConnected: true }, 900)).toBeNull();
    expect(offlineSince(500, { link: "idle", dmStatus: "offline", wsConnected: true }, 900)).toBeNull();
    expect(offlineSince(500, { link: "connected", dmStatus: "offline", wsConnected: false }, 900)).toBeNull();
  });
});
