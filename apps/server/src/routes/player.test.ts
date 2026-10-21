import type { NetworkInterfaceInfo } from "node:os";
import { describe, expect, it } from "vitest";
import { hostUrls, lanUrls } from "./player.js";

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

  it("real network cards before Docker/VM bridges (the QR code uses the first address)", () => {
    const withBridges = { docker0: [{ family: "IPv4", address: "172.17.0.1", internal: false }], "br-1a2b": [{ family: "IPv4", address: "172.18.0.1", internal: false }], ...nets } as unknown as NodeJS.Dict<NetworkInterfaceInfo[]>;
    expect(lanUrls(8787, "", withBridges)).toEqual(["http://192.168.1.20:8787/player", "http://172.17.0.1:8787/player", "http://172.18.0.1:8787/player"]);
  });

  it("PUBLIC_URL comes first, without a trailing slash", () => {
    expect(lanUrls(8787, "https://dnd.example.lan/", nets)).toEqual(["https://dnd.example.lan/player", "http://192.168.1.20:8787/player"]);
  });
});

describe("hostUrls (laptop host screen over HTTPS)", () => {
  it("https on the HTTPS port for each LAN IPv4 address; phones stay on http", () => {
    expect(hostUrls(8443, nets)).toEqual(["https://192.168.1.20:8443/host"]);
    expect(lanUrls(8787, "", nets)[0]).toMatch(/^http:\/\//);
  });

  it("is empty when HTTPS is off (HTTPS_PORT=0)", () => {
    expect(hostUrls(0, nets)).toEqual([]);
  });
});
