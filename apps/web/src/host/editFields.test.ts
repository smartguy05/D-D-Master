import { describe, expect, it } from "vitest";
import { editField, editHint, isDirty, savedField, syncEditField } from "./editFields";

describe("host editor fields (dirty tracking)", () => {
  it("a clean field follows the server", () => {
    const f = editField(10);
    expect(isDirty(f)).toBe(false);
    expect(syncEditField(f, 25)).toEqual({ value: 25, base: 25 });
    expect(editHint(f, 25)).toBeUndefined();
  });

  it("a dirty (typed, unsaved) field keeps the typed value and hints at the server change", () => {
    const typed = { ...editField(10), value: 7 };
    expect(isDirty(typed)).toBe(true);
    const after = syncEditField(typed, 25);
    expect(after).toEqual({ value: 7, base: 10 });
    expect(editHint(after, 25)).toBe("changed on server: 25");
    expect(editHint(after, 10)).toBeUndefined();
  });

  it("typing back the original value makes it clean again", () => {
    const f = { ...editField(10), value: 10 };
    expect(isDirty(f)).toBe(false);
    expect(syncEditField(f, 12).value).toBe(12);
  });

  it("after Save the typed value is the new base, so later server changes flow in", () => {
    const saved = savedField({ value: 7, base: 10 });
    expect(saved).toEqual({ value: 7, base: 7 });
    expect(syncEditField(saved, 30)).toEqual({ value: 30, base: 30 });
  });

  it("returns the same object when nothing changes", () => {
    const f = editField("elf");
    expect(syncEditField(f, "elf")).toBe(f);
  });
});
