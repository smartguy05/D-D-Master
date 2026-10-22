import { describe, expect, it } from "vitest";
import { RollResult } from "@dm/shared";
import { rollToastView } from "./rollToast";

const roll = (o: Partial<RollResult> = {}) => RollResult.parse({ id: "r", notation: "1d20+3", label: "Stealth", rollerName: "Mara", dice: [{ sides: 20, value: 14 }], modifier: 3, total: 17, ts: 1, ...o });

describe("rollToastView", () => {
  it("an open roll shows its total, kept dice, modifier and result", () => {
    expect(rollToastView(roll({ dc: 15, success: true }))).toEqual({ total: "17", detail: "1d20+3 → [14] +3", nat: undefined, cover: "", success: true });
  });

  it("dropped dice are left out and a negative modifier keeps its sign", () => {
    const v = rollToastView(roll({ notation: "2d20kh1-1", dice: [{ sides: 20, value: 3, dropped: true }, { sides: 20, value: 20 }], modifier: -1, total: 19 }));
    expect(v.detail).toBe("2d20kh1-1 → [20] -1");
    expect(v.nat).toBe(20);
  });

  it("a physical roll says so instead of listing dice", () => {
    expect(rollToastView(roll({ physical: true, dice: [] })).detail).toBe("physical dice");
  });

  it("a secret roll shows no dice, modifier, natural, cover or result: only its notation and a ?", () => {
    const v = rollToastView(roll({ secret: true, dice: [{ sides: 20, value: 20 }], cover: "half", dc: 15, success: true }));
    expect(v).toEqual({ total: "?", detail: "1d20+3", nat: undefined, cover: "", success: undefined });
  });

  it("a secret roll redacted by the server (zeroed dice, players' projection) reads the same as on the TV", () => {
    const tv = rollToastView(roll({ secret: true }));
    const remote = rollToastView(roll({ secret: true, dice: [{ sides: 20, value: 0 }], modifier: 0, total: 0 }));
    expect(remote).toEqual(tv);
  });

  it("cover shows on an open attack roll (with the AC when known)", () => {
    expect(rollToastView(roll({ attack: true, cover: "half", dc: 15 })).cover).toBe(" · vs AC 15 (half cover +2)");
    expect(rollToastView(roll({ attack: true, cover: "half" })).cover).toBe(" · (half cover +2)");
  });
});
