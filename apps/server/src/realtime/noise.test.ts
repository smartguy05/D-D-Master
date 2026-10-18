import { describe, expect, it } from "vitest";
import { isNoiseTranscript } from "./noise.js";

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
    // "yes" answers and pointing at someone are real turns
    ["Mm-hmm."],
    ["Mhm."],
    ["mhm"],
    ["You."],
    // spoken dice totals and numbers are never noise
    ["Six."],
    ["six"],
    ["Twelve!"],
    ["Seventeen."],
    ["nat 20"],
    ["Nat twenty!"],
    ["Uh, six."],
    ["3"],
    ["Um... 14."],
    // a roll the transcriber wrote as an annotation still counts
    ["(rolls 17)"],
    ["*rolls a six*"],
  ])("%j is not noise", (text) => {
    expect(isNoiseTranscript(text)).toBe(false);
  });

  it("never drops short real words, even from short audio with no voice match", () => {
    // The VAD speech length includes the prefix padding, so a short window says little; only the
    // words decide.
    expect(isNoiseTranscript("Six.")).toBe(false);
    expect(isNoiseTranscript("12")).toBe(false);
    expect(isNoiseTranscript("no")).toBe(false);
  });
});
