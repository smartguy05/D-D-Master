// Take D: one continuous TV take. The party heads to the lighthouse (new map appears), Keeper Mara
// speaks in her own voice, skeletons rise, Brienne's attack resolves (walkthrough).
import { launch, TV, WEB, api, record, saveShots, sleep, tool } from "./recorder.mjs";
import { connectLive } from "./live.mjs";
import { PLAYERS, PCS, LOCATIONS } from "./cast.mjs";

const live = connectLive();
const b = await launch();
const table = await (await b.newContext(TV)).newPage();
await sleep(1500);
if (live.state?.combat?.active) await tool("end_combat");
// Start from the cove so the lighthouse map arrives on camera.
if (live.state?.locationId !== LOCATIONS.caves) await tool("change_scene", { location_id: LOCATIONS.caves });
await api("/api/dm/whisper", { text: "Wait for the players. When they say they go to the lighthouse, use change_scene, and voice Mara Venn's replies with speak_as_npc. Do not move them before they ask." });
await live.settle(3000, 40000);
await table.goto(WEB + "/table");
await sleep(5000);

const rec = await record(table, "walkthrough");
await sleep(1000);
rec.mark("Quill: to the lighthouse");
await api("/api/dm/say", { text: "Quill dusts off his robes: Let's get back up to the lighthouse and check on Keeper Mara.", playerId: PLAYERS.Ben });
let ok = await live.waitFor((l) => l.state?.locationId === LOCATIONS.lighthouse, 40000);
if (!ok) { rec.mark("change_scene forced"); await tool("change_scene", { location_id: LOCATIONS.lighthouse }); await live.waitFor((l) => l.state?.locationId === LOCATIONS.lighthouse, 10000); }
rec.mark("lighthouse map appears");
await live.settle(3000, 30000);

const n0 = live.npcSpeech?.length ?? 0;
rec.mark("Morra greets Mara");
await api("/api/dm/say", { text: "Sister Morra calls up the stairs: Keeper Mara? Are you alright up there?", playerId: PLAYERS.Cara });
ok = await live.waitFor((l) => (l.npcSpeech?.length ?? 0) > n0, 40000);
if (!ok) { rec.mark("speak_as_npc forced"); await tool("speak_as_npc", { npc_name: "Mara Venn", line: "Careful! The drowned dead climb the stairs when the bell is quiet. They're coming!", style: "urgent, frightened" }); }
else rec.mark("Mara speaks (DM)");
await sleep(9000);

rec.mark("skeletons rise");
await tool("spawn_monster", { name: "Skeleton", count: 2, formation: "line", fog: "revealed" });
await sleep(2500);
await tool("start_combat");
await sleep(3000);
const skel = live.state.monsters.find((m) => /Skeleton/.test(m.name) && m.hp > 0);
// Brienne swings until one connects (a miss plays out in full first: ~7 s per roll on the TV).
for (let tries = 0; tries < 4; tries++) {
  const ri = live.rolls.length;
  rec.mark(tries ? "Brienne attacks again" : "Brienne attacks");
  await tool("roll_dice", { notation: "1d20+5", label: "Longsword attack", roller_id: PCS.Brienne, target_id: skel.id, attack_name: "Longsword", dc: 13, override: true });
  await live.waitFor((l) => l.rolls.length > ri, 5000, 50);
  const total = live.rolls.at(-1)?.total ?? 0;
  if (total >= 13) break;
  await sleep(7500);
}
await sleep(4500);
rec.mark("damage");
await tool("apply_damage", { target_id: skel.id, amount: 9, damage_type: "slashing", source_id: PCS.Brienne, attack_name: "Longsword" });
await sleep(5000);
rec.mark("end");
await saveShots([await rec.stop()]);
live.close();
await b.close();
