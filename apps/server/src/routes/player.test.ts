import type { NetworkInterfaceInfo } from "node:os";
import { describe, expect, it } from "vitest";
import { lanUrls } from "./player.js";

const nets = {
  lo: [{ family: "IPv4", address: "127.0.0.1", internal: true }],
  wlan0: [
    { family: "IPv4", address: "192.168.1.20", internal: false },
    { family: "IPv6", address: "fe80::1", internal: false },
  ],
} as unknown as NodeJS.Dict<NetworkInterfaceInfo[]>;

describe("lanUrls (phone join links and QR codes)", () => {
  it("external IPv4 addresses on the server port", () => {
    expect(lanUrls(8787, "", nets)).toEqual(["http://192.168.1.20:8787/player"]);
  });

  it("PUBLIC_URL comes first, without a trailing slash", () => {
    expect(lanUrls(8787, "https://dnd.example.lan/", nets)).toEqual(["https://dnd.example.lan/player", "http://192.168.1.20:8787/player"]);
  });
});
