import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("api", () => {
  it("names the cause when the server can't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(api("/campaigns", { name: "x" })).rejects.toThrow("Can't reach the game server");
  });

  it("throws the server's error message on a failed response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Unknown campaign x" }), { status: 400 })));
    await expect(api("/campaigns/x/load", {})).rejects.toThrow("Unknown campaign x");
  });

  it("POSTs JSON and returns the parsed body", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "cmp_1" })));
    vi.stubGlobal("fetch", fetch);
    expect(await api("/campaigns", { name: "x" })).toEqual({ id: "cmp_1" });
    expect(fetch).toHaveBeenCalledWith("/api/campaigns", expect.objectContaining({ method: "POST", body: '{"name":"x"}' }));
  });
});
