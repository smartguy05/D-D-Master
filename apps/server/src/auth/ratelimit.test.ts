import { describe, expect, it, vi } from "vitest";
import { FailureLimiter, limitKey } from "./ratelimit.js";

describe("FailureLimiter (wrong code / password attempts per IP)", () => {
  it("blocks an IP after 10 failures within 10 minutes, others are unaffected", () => {
    let t = 0;
    const lim = new FailureLimiter({ max: 10, windowMs: 600_000, now: () => t });
    for (let i = 0; i < 9; i++) lim.fail("1.2.3.4");
    expect(lim.blocked("1.2.3.4")).toBe(false);
    lim.fail("1.2.3.4");
    expect(lim.blocked("1.2.3.4")).toBe(true);
    expect(lim.blocked("5.6.7.8")).toBe(false);
    expect(lim.retryAfterMs("1.2.3.4")).toBe(600_000);
    t = 300_000;
    expect(lim.retryAfterMs("1.2.3.4")).toBe(300_000);
  });

  it("failures older than the window no longer count", () => {
    let t = 0;
    const lim = new FailureLimiter({ max: 3, windowMs: 1000, now: () => t });
    lim.fail("a");
    lim.fail("a");
    t = 600;
    lim.fail("a");
    expect(lim.blocked("a")).toBe(true);
    t = 1001;
    expect(lim.blocked("a")).toBe(false);
    expect(lim.retryAfterMs("a")).toBe(0);
  });

  it("forgets idle IPs so the map can't grow without bound", () => {
    let t = 0;
    const lim = new FailureLimiter({ max: 3, windowMs: 1000, now: () => t });
    for (let i = 0; i < 50; i++) lim.fail(`ip${i}`);
    expect(lim.size).toBe(50);
    t = 5000;
    lim.fail("fresh");
    expect(lim.size).toBe(1);
  });

  // An IPv6 caller usually holds a whole /64: each guess could come from a new address in it.
  it("counts IPv6 addresses per /64", () => {
    const lim = new FailureLimiter({ max: 3, windowMs: 1000, now: () => 0 });
    lim.fail("2001:db8:1:1::1");
    lim.fail("2001:db8:1:1::2");
    lim.fail("2001:db8:1:1:ffff:1:2:3");
    expect(lim.blocked("2001:db8:1:1::abcd")).toBe(true);
    expect(lim.blocked("2001:db8:1:2::1")).toBe(false);
    expect(lim.blocked("1.2.3.4")).toBe(false);
  });

  it("limitKey: IPv4 as is, IPv6 as its /64 prefix", () => {
    expect(limitKey("203.0.113.9")).toBe("203.0.113.9");
    expect(limitKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(limitKey("2001:DB8:0:0:1::")).toBe("2001:db8:0:0::/64");
    expect(limitKey("::1")).toBe("0:0:0:0::/64");
    expect(limitKey("junk")).toBe("junk");
  });

  // The table code space is small: many addresses guessing together must still run out of tries.
  it("a global budget blocks everyone once too many failures pile up across addresses", () => {
    let t = 0;
    const warn = vi.fn();
    const lim = new FailureLimiter({ max: 10, globalMax: 5, windowMs: 1000, now: () => t, warn });
    for (let i = 0; i < 4; i++) lim.fail(`10.0.0.${i}`);
    expect(lim.blocked("10.9.9.9")).toBe(false);
    lim.fail("10.0.0.4");
    expect(lim.blocked("10.9.9.9")).toBe(true);
    expect(lim.retryAfterMs("10.9.9.9")).toBe(1000);
    expect(warn).toHaveBeenCalledTimes(1);
    t = 1001;
    expect(lim.blocked("10.9.9.9")).toBe(false);
  });
});
