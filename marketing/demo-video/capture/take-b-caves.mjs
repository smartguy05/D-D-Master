// Take B: Pell speaks in his own voice (npc-closeup), then the party sails to the sea caves and
// explores under fog of war (map-fog).
import { launch, TV, WEB, api, record, saveShots, sleep, tool } from "./recorder.mjs";
import { connectLive } from "./live.mjs";
import { PLAYERS, PCS, LOCATIONS } from "./cast.mjs";

const only = process.argv[2]; // optional: "npc" | "fog"
const live = connectLive();
const b = await launch();
const table = await (await b.newContext(TV)).newPage();
await table.goto(WEB + "/table");
await sleep(4000);
const shots = [];
const status = async () => (await tool("get_party_status")).result;

if (!only || only === "npc") {
  await api("/api/dm/whisper", { text: "Give Pell Netter's next line in his own voice with speak_as_npc (one or two vivid sentences)." });
  await sleep(1500);
  const rec = await record(table, "npc-closeup");
  await sleep(1200);
  const n0 = live.npcSpeech?.length ?? 0;
  rec.mark("Morra asks Pell");
  await api("/api/dm/say", { text: "Sister Morra smiles at Pell: Will you sail us out to the caves one more time, old friend?", playerId: PLAYERS.Cara });
  let ok = await live.waitFor((l) => (l.npcSpeech?.length ?? 0) > n0, 45000);
  if (!ok) {
    rec.mark("speak_as_npc forced");
    await tool("speak_as_npc", { npc_name: "Pell Netter", line: "Aye, Sister! Hold fast to the rail. The tide waits for no one, and those caves bite back.", style: "salty, warm, excited" });
  } else rec.mark("Pell speaks (DM)");
  await sleep(12000);
  rec.mark("end");
  shots.push(await rec.stop());
  await live.settle(3000, 30000);
}

if (!only || only === "fog") {
  await api("/api/dm/whisper", { text: "The party boards Pell's skiff now: move them to The Smuggler's Cove with change_scene right away." });
  const rec = await record(table, "map-fog");
  await sleep(1000);
  rec.mark("Brienne: to the caves");
  await api("/api/dm/say", { text: "Brienne grins: Then cast off! Take us to the Smuggler's Cove.", playerId: PLAYERS.Alice });
  let ok = await live.waitFor((l) => l.state?.locationId === LOCATIONS.caves, 45000);
  if (!ok) {
    rec.mark("change_scene forced");
    await tool("change_scene", { location_id: LOCATIONS.caves });
    await live.waitFor((l) => l.state?.locationId === LOCATIONS.caves, 10000);
  }
  rec.mark("cave map appears");
  await sleep(4000);
  // Walk the party deeper in, a square at a time, so the fog peels back.
  const s = await status();
  console.log(JSON.stringify(s).slice(0, 1500));
  rec.mark("party advances");
  for (let step = 0; step < 6; step++) {
    for (const id of Object.values(PCS)) {
      const c = live.state.characters.find((x) => x.id === id);
      if (!c?.pos) continue;
      await tool("move_token", { entity_id: id, x: c.pos.x + 1, y: c.pos.y, override: true }).catch((e) => console.log(e.message));
    }
    await sleep(900);
  }
  await sleep(3000);
  rec.mark("end");
  shots.push(await rec.stop());
}

await saveShots(shots);
live.close();
await b.close();
