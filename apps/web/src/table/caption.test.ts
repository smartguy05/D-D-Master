import { describe, expect, it } from "vitest";
import { CAPTION_CPS, CAPTION_LINGER_MS, applyCaption, captionVisible, clipLine, shownText, voiceChanged } from "./caption";

describe("NPC captions", () => {
  it("appends pieces of one reply, replaces with the final text, and starts over for a new reply", () => {
    let l = applyCaption(null, { id: "a", text: "Hail, ", final: false }, 0);
    l = applyCaption(l, { id: "a", text: "friends", final: false }, 100);
    expect(l).toMatchObject({ text: "Hail, friends", final: false, startedAt: 0 });
    l = applyCaption(l, { id: "a", text: "Hail, friends.", final: true }, 200);
    expect(l).toMatchObject({ text: "Hail, friends.", final: true });
    expect(applyCaption(l, { id: "b", text: "Next", final: false }, 300)).toMatchObject({ id: "b", text: "Next", startedAt: 300 });
  });

  it("reveals at speaking pace, cut at a word, never past what arrived", () => {
    const l = applyCaption(null, { id: "a", text: "Rooms are two silver a night.", final: true }, 0);
    const msFor = (chars: number) => (chars / CAPTION_CPS) * 1000;
    expect(shownText(l, 0)).toBe("");
    expect(shownText(l, msFor(12))).toBe("Rooms are");
    expect(shownText(l, msFor(100))).toBe("Rooms are two silver a night.");
  });

  it("shows everything when the voice stops, then fades after the linger", () => {
    let l: ReturnType<typeof applyCaption> | null = applyCaption(null, { id: "a", text: "A long speech that is not yet revealed.", final: true }, 0);
    l = voiceChanged(l, false, 500);
    expect(shownText(l!, 500)).toBe("A long speech that is not yet revealed.");
    expect(captionVisible(l, 500 + CAPTION_LINGER_MS - 1)).toBe(true);
    expect(captionVisible(l, 500 + CAPTION_LINGER_MS)).toBe(false);
  });

  it("a line still streaming doesn't start its linger when the voice pauses", () => {
    let l: ReturnType<typeof applyCaption> | null = applyCaption(null, { id: "a", text: "Well", final: false }, 0);
    l = voiceChanged(l, false, 100);
    expect(l!.endedAt).toBeUndefined();
    expect(captionVisible(l, 60_000)).toBe(true);
  });

  it("a clip's line reveals over its own length and ignores the DM's voice", () => {
    const text = "Get out of my inn.";
    const l = clipLine(applyCaption(null, { id: "clip.mp3", text, final: true }, 1000));
    const end = 1000 + (text.length / CAPTION_CPS) * 1000;
    expect(voiceChanged(l, false, 1100)).toBe(l);
    expect(shownText(l, 1100)).not.toBe(text);
    expect(shownText(l, end)).toBe(text);
    expect(captionVisible(l, end + CAPTION_LINGER_MS - 1)).toBe(true);
    expect(captionVisible(l, end + CAPTION_LINGER_MS)).toBe(false);
  });
});
