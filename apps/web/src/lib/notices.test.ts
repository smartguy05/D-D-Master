import { describe, expect, it } from "vitest";
import { addNotice, autoDismissMs, dismissNotice, expireNotice, MAX_NOTICES, type Notice } from "./notices";

describe("notices", () => {
  it("adds a new notice with the given id", () => {
    const r = addNotice([], { level: "error", message: "boom" }, 1);
    expect(r).toEqual({ list: [{ id: 1, level: "error", message: "boom" }], id: 1, added: true });
  });

  it("merges a repeat of the same message into one card (job error + its HTTP rejection)", () => {
    // Bug host-error-shown-twice: a failed map paint showed as a job chip and again as a notice.
    const job = addNotice([], { level: "error", title: "Painting map: Pantry Peaks", message: "400 The model does not exist." }, 1);
    const http = addNotice(job.list, { level: "error", message: "400 The model does not exist." }, 2);
    expect(http.added).toBe(false);
    expect(http.id).toBe(1);
    expect(http.list).toEqual([{ id: 1, level: "error", title: "Painting map: Pantry Peaks", message: "400 The model does not exist." }]);
  });

  it("fills in the title and keeps the more severe level when the repeat arrives second", () => {
    const http = addNotice([], { level: "warning", message: "x" }, 1);
    const job = addNotice(http.list, { level: "error", title: "Painting map: A", message: "x" }, 2);
    expect(job.list).toEqual([{ id: 1, level: "error", title: "Painting map: A", message: "x" }]);
    const info = addNotice(job.list, { level: "info", message: "x" }, 3);
    expect(info.list[0]!.level).toBe("error");
  });

  it("keeps only the newest MAX_NOTICES", () => {
    let list: Notice[] = [];
    for (let i = 1; i <= MAX_NOTICES + 2; i++) list = addNotice(list, { level: "error", message: `m${i}` }, i).list;
    expect(list).toHaveLength(MAX_NOTICES);
    expect(list[0]!.message).toBe("m3");
  });

  it("dismisses by id", () => {
    const a = addNotice([], { level: "error", message: "a" }, 1).list;
    const b = addNotice(a, { level: "error", message: "b" }, 2).list;
    expect(dismissNotice(b, 1).map((n) => n.id)).toEqual([2]);
  });

  it("errors stay until dismissed; warnings and info close on their own", () => {
    expect(autoDismissMs("error")).toBeUndefined();
    expect(autoDismissMs("warning")).toBeGreaterThan(0);
    expect(autoDismissMs("info")).toBeGreaterThan(0);
  });

  it("an expiry timer never removes a notice that is (or became) an error", () => {
    const w = addNotice([], { level: "warning", message: "x" }, 1).list;
    expect(expireNotice(w, 1)).toEqual([]);
    const upgraded = addNotice(w, { level: "error", message: "x" }, 2).list;
    expect(expireNotice(upgraded, 1)).toEqual(upgraded);
  });
});
