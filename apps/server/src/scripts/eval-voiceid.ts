/**
 * Voice-ID accuracy check with synthetic voices (no microphone needed):
 *   pnpm models:download --with-tts      # fetches the multi-speaker VCTK TTS model
 *   pnpm --filter @dm/server eval:voiceid
 * Enrolls N synthetic speakers from ONE sentence each, then identifies new sentences
 * through the same ring-buffer + embedding + matching path the live game uses.
 */
import { createRequire } from "node:module";
import { join } from "node:path";
import { ROOT } from "../config.js";
import { Store } from "../db/index.js";
import { SpeakerService } from "../speaker/service.js";

const require = createRequire(import.meta.url);
const sherpa = require("sherpa-onnx-node");
const ttsDir = process.env.TTS_DIR ?? join(ROOT, "models/vits-vctk");
const tts = new sherpa.OfflineTts({
  model: { vits: { model: join(ttsDir, "vits-vctk.onnx"), lexicon: join(ttsDir, "lexicon.txt"), tokens: join(ttsDir, "tokens.txt") }, numThreads: 2 },
  maxNumSentences: 1,
});

function speak(text: string, sid: number): Float32Array {
  const a = tts.generate({ text, sid, speed: 1.0 });
  return new sherpa.LinearResampler(a.sampleRate, 16000).resample(a.samples, true);
}

const store = new Store(":memory:");
store.saveCampaign({ id: "eval", name: "eval", premise: "", partyLevel: 1, sessionSummaries: [], createdAt: 0, updatedAt: 0 });
const svc = new SpeakerService(store);
console.log(svc.status);
if (!svc.available) process.exit(1);

const speakers = [3, 17, 42, 60, 88, 101];
const names = ["Sam", "Alex", "Jo", "Kim", "Lee", "Max"];
speakers.forEach((sid, i) => {
  svc.addSample("eval", names[i], svc.embed(speak(`Hi, I'm ${names[i]}, and I'm playing a brave adventurer who loves treasure and trouble.`, sid)));
});

const lines = ["I swing my axe at the nearest goblin.", "Can I check the altar for hidden traps?", "Let's sneak around the back of the chapel.", "I cast magic missile at the big one.", "What does the old woman look like?"];
let correct = 0;
let confident = 0;
let wrongConfident = 0;
let ts = 1_000_000;
for (const [i, sid] of speakers.entries()) {
  for (const line of lines) {
    const clip = speak(line, sid);
    const start = ts;
    svc.ring.push(new Float32Array(8000), (ts += 500));
    svc.ring.push(clip, (ts += Math.round((clip.length / 16000) * 1000)));
    const { match } = svc.identify("eval", start + 500, ts);
    if (match?.playerId === names[i]) correct++;
    if (match?.confident) {
      confident++;
      if (match.playerId !== names[i]) wrongConfident++;
    }
    console.log(`${names[i].padEnd(5)} -> ${match?.playerId} score ${match?.score.toFixed(2)} margin ${match?.margin.toFixed(2)} ${match?.confident ? "confident" : "would ask"}`);
  }
}
const total = speakers.length * lines.length;
console.log({ total, correct, confident, wrongConfident });
process.exit(0);
