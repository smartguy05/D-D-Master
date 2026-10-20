import { describe, expect, it } from "vitest";
import { orbLabel, orbClass } from "./orb";

describe("TV DM orb", () => {
  it("says Muted (not Listening) while the table mic is muted", () => {
    expect(orbLabel("listening", true)).toBe("Muted");
    expect(orbClass("listening", true)).toBe("muted");
  });

  it("follows the DM status otherwise", () => {
    expect(orbLabel("listening", false)).toBe("Listening");
    expect(orbLabel("speaking", false, "Mara")).toBe("Mara speaks…");
    expect(orbLabel("speaking", false)).toBe("The DM speaks…");
    expect(orbLabel("thinking", false)).toBe("The DM ponders…");
    expect(orbLabel("connecting", false)).toBe("Summoning the DM…");
    expect(orbLabel("offline", false)).toBe("DM offline");
    expect(orbClass("speaking", false)).toBe("speaking");
  });

  it("an offline DM stays offline when muted; a speaking DM keeps speaking", () => {
    expect(orbLabel("offline", true)).toBe("DM offline");
    expect(orbLabel("speaking", true)).toBe("The DM speaks…");
    // A typed message or host note is answered while muted: the DM is working on a reply.
    expect(orbLabel("thinking", true)).toBe("The DM ponders…");
    expect(orbClass("thinking", true)).toBe("thinking");
  });
});
