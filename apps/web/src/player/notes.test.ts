import { describe, expect, it } from "vitest";
import { chooseNotes } from "./notes";

describe("chooseNotes", () => {
  it("shows the server's notes when nothing is pending locally", () => {
    expect(chooseNotes("server text", undefined)).toEqual({ text: "server text", needsSave: false });
    expect(chooseNotes("server text", { text: "old", dirty: false })).toEqual({ text: "server text", needsSave: false });
  });

  it("an unsaved local draft wins and is saved", () => {
    expect(chooseNotes("server text", { text: "typed offline", dirty: true })).toEqual({ text: "typed offline", needsSave: true });
  });

  it("a dirty draft equal to the server copy needs no save", () => {
    expect(chooseNotes("same", { text: "same", dirty: true })).toEqual({ text: "same", needsSave: false });
  });
});
