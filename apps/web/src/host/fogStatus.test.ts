import { describe, expect, it } from "vitest";
import { fogStatus } from "./fogStatus";

describe("fogStatus", () => {
  it("before the first visit, follows the location's fog setting", () => {
    expect(fogStatus({ fog: true }, undefined)).toEqual({ on: true, label: "Fog on arrival" });
    expect(fogStatus({ fog: false }, undefined)).toEqual({ on: false, label: "No fog" });
  });

  it("after a visit, shows the live fog entry (overrides win over the outline)", () => {
    expect(fogStatus({ fog: true }, { enabled: false })).toEqual({ on: false, label: "Fog off" });
    expect(fogStatus({ fog: false }, { enabled: true })).toEqual({ on: true, label: "Fog on" });
  });
});
