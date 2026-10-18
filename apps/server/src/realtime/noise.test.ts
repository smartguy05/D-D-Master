import { describe, expect, it } from "vitest";
import { isNoiseTranscript, SHORT_UNMATCHED_MS } from "./noise.js";

describe("isNoiseTranscript", () => {
  it.each([
    [""],
    ["   "],
    ["\n\t"],
    ["..."],
    ["?!"],
    ["—"],
    ["uh"],
    ["Uh."],
    ["um."],
    ["Umm..."],
    ["Hmm..."],
    ["hmmmm"],
    ["Mm-hmm."],
    ["mhm"],
    ["Er,"],
    ["erm"],
    ["Ah."],
    ["Oh."],
    ["*cough*"],
    ["*coughs*"],
    ["(coughing)"],
    ["[noise]"],
    ["[inaudible]"],
    ["[BLANK_AUDIO]"],
    ["(sneezes)"],
    ["Achoo!"],
    ["Bless you."],
    ["bless you!"],
    ["Gesundheit."],
    ["Uh, um, hmm."],
    ["uh uh uh"],
    ["Um... uh..."],
    ["*cough* uh"],
    ["Hmm. Bless you."],
    ["You"],
    ["you."],
  ])("%j is noise", (text) => {
    expect(isNoiseTranscript(text)).toBe(true);
  });

  it.each([
    ["yes"],
    ["Yes."],
    ["no"],
    ["No!"],
    ["ok"],
    ["attack!"],
    ["I cast shield"],
    ["I attack the goblin."],
    ["Uh, I attack the goblin."],
    ["Hmm, I search the room."],
    ["What?"],
    ["Huh?"],
    ["Thank you."],
    ["Bless you, priest, I give him a coin."],
    ["Thorin"],
    ["roll"],
    ["12"],
    ["Natural 20!"],
    ["I go left"],
    ["Hi"],
  ])("%j is not noise", (text) => {
    expect(isNoiseTranscript(text)).toBe(false);
  });

  it("treats very short audio with no voice match as noise", () => {
    expect(isNoiseTranscript("no", { speechMs: SHORT_UNMATCHED_MS - 1, voiceMatched: false })).toBe(true);
    // A matched voice or long enough audio keeps the turn.
    expect(isNoiseTranscript("no", { speechMs: SHORT_UNMATCHED_MS - 1, voiceMatched: true })).toBe(false);
    expect(isNoiseTranscript("no", { speechMs: SHORT_UNMATCHED_MS, voiceMatched: false })).toBe(false);
    // Unknown match (voice ID unavailable) never triggers the short-audio rule.
    expect(isNoiseTranscript("no", { speechMs: 50 })).toBe(false);
    // Several real words are never dropped for being short.
    expect(isNoiseTranscript("I attack", { speechMs: 100, voiceMatched: false })).toBe(false);
  });
});
