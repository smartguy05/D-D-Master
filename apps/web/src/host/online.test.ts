import { describe, expect, it } from "vitest";
import { inviteUrl, seatStatus } from "./online";

describe("inviteUrl", () => {
  it("uses ONLINE_URL (the tunnel) when set, without a trailing slash", () => {
    expect(inviteUrl({ onlineUrl: "https://dnd.example.com/", invitePath: "/join?code=WOLF-1234" }, "http://192.168.1.20:8787")).toBe("https://dnd.example.com/join?code=WOLF-1234");
  });

  it("falls back to the page's join base", () => {
    expect(inviteUrl({ onlineUrl: "", invitePath: "/join?code=WOLF-1234" }, "http://192.168.1.20:8787")).toBe("http://192.168.1.20:8787/join?code=WOLF-1234");
  });
});

describe("seatStatus", () => {
  it("online beats claimed beats free", () => {
    expect(seatStatus({ claimed: true, connected: 2 })).toEqual({ label: "online (2 devices)", kickable: true, tone: "ok" });
    expect(seatStatus({ claimed: true, connected: 1 })).toEqual({ label: "online", kickable: true, tone: "ok" });
    expect(seatStatus({ claimed: true, connected: 0 })).toEqual({ label: "joined, offline", kickable: true, tone: "muted" });
    expect(seatStatus({ claimed: false, connected: 0 })).toEqual({ label: "free", kickable: false, tone: "muted" });
  });
});
