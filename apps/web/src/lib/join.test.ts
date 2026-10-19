import { describe, expect, it } from "vitest";
import { joinBase } from "./join";

const lan = { urls: ["http://192.168.1.20:8787/player"] };

describe("joinBase", () => {
  it("localhost hands out the server's LAN address", () => {
    expect(joinBase(lan, { hostname: "localhost", origin: "http://localhost:8787" })).toBe("http://192.168.1.20:8787");
  });

  it("opened over the LAN: its own origin", () => {
    expect(joinBase(lan, { hostname: "192.168.1.20", origin: "http://192.168.1.20:8787" })).toBe("http://192.168.1.20:8787");
    expect(joinBase(lan, { hostname: "laptop.lan", origin: "http://laptop.lan:8787" })).toBe("http://laptop.lan:8787");
  });

  it("PUBLIC_URL wins everywhere", () => {
    const pub = { urls: ["https://dnd.example/player", ...lan.urls], preferred: true };
    expect(joinBase(pub, { hostname: "laptop.lan", origin: "http://laptop.lan:8787" })).toBe("https://dnd.example");
  });

  it("no server answer: own origin", () => {
    expect(joinBase(undefined, { hostname: "localhost", origin: "http://localhost:5173" })).toBe("http://localhost:5173");
  });
});
