import { describe, expect, it } from "vitest";
import { flourishFor } from "./flourish";

describe("flourishFor", () => {
  it("natural 20 and natural 1 on the kept d20", () => {
    expect(flourishFor({ dice: [{ sides: 20, value: 20 }], secret: false })).toBe("crit");
    expect(flourishFor({ dice: [{ sides: 20, value: 1 }], secret: false })).toBe("fumble");
    expect(flourishFor({ dice: [{ sides: 20, value: 12 }], secret: false })).toBeUndefined();
  });

  it("advantage: only the kept die counts", () => {
    expect(flourishFor({ dice: [{ sides: 20, value: 1, dropped: true }, { sides: 20, value: 20 }], secret: false })).toBe("crit");
    expect(flourishFor({ dice: [{ sides: 20, value: 20, dropped: true }, { sides: 20, value: 4 }], secret: false })).toBeUndefined();
  });

  it("no flourish for secret rolls, damage dice or physical rolls without a natural", () => {
    expect(flourishFor({ dice: [{ sides: 20, value: 20 }], secret: true })).toBeUndefined();
    expect(flourishFor({ dice: [{ sides: 6, value: 1 }, { sides: 6, value: 1 }], secret: false })).toBeUndefined();
    expect(flourishFor({ dice: [], secret: false })).toBeUndefined();
  });
});
