// Take v2 NPC: at the docks, a new harbormaster (fresh sprite, own voice) starts Indifferent;
// Morra's gift wins her over: she answers in her own voice and her attitude turns Friendly.
import { launch, TV, WEB, api, record, saveShots, sleep, tool } from "./recorder.mjs";
import { connectLive } from "./live.mjs";
import { dialogTracker } from "./dialog.mjs";
import { pan, zoom } from "./cam.mjs";
import { PLAYERS, PCS, LOCATIONS } from "./cast.mjs";

const NPC = "Harbormaster Ysolde Varr";
const live = connectLive();
await live.waitFor((l) => l.state, 10000);
const place = (id, x, y) => tool("move_token", { entity_id: id, x, y, ignore_terrain: true, override: true }).catch((e) => console.log(e.message));
if (live.state.combat?.active) await tool("end_combat").catch(() => {});
if (live.state.locationId !== LOCATIONS.docks) await tool("change_scene", { location_id: LOCATIONS.docks, forced: true });
await sleep(1500);
let npc = live.state.monsters.find((m) => m.name === NPC);
if (!npc) {
  await tool("add_npc", { name: NPC, appearance: "stern middle-aged harbormaster, weathered blue coat with brass buttons, grey braid, ledger under one arm", stat_block: "Veteran", ally: false, follows: false, x: 12, y: 6, voice: "brisk, clipped, salt-weathered alto with a dry edge" });
  await live.waitFor((l) => l.state.monsters.find((m) => m.name === NPC)?.spriteUrl, 90000);
  npc = live.state.monsters.find((m) => m.name === NPC);
}
for (const [id, x, y] of [[PCS.Morra, 12, 8], [PCS.Brienne, 11, 9], [PCS.Quill, 13, 9], ["mon_dc206c1c01", 12, 10], ["mon_0a4db87c92", 13, 10]]) await place(id, x, y);
await place(npc.id, 12, 6);
// Start one step short of Friendly (+1, Indifferent) so a real kindness tips her over.
const cur = live.state.monsters.find((m) => m.id === npc.id).attitudeScore ?? 0;
if (cur !== 1) await tool("adjust_attitude", { npc_id: npc.id, delta: 1 - cur, reason: "demo reset" }).catch((e) => console.log(e.message));
await api("/api/dm/whisper", { text: `${NPC} (${npc.id}) is the harbormaster, indifferent to the party. Voice every line she says with speak_as_npc, and use adjust_attitude when the party treats her well or badly.` });
await live.settle(2500, 30000);

const b = await launch();
const table = await (await b.newContext(TV)).newPage();
await table.goto(WEB + "/table");
await sleep(7000);
await pan(table, [780, 300], [780, 500], 1);
await zoom(table, -3, 300);
await sleep(1500);

const say = dialogTracker(live);
const rec = await record(table, "npc-attitude");
await sleep(1000);
rec.mark("Morra offers a gift");
const n0 = live.npcSpeech?.length ?? 0;
await api("/api/dm/say", { text: "Sister Morra presses a pouch of silver into the harbormaster's hand: For the dock repairs, Harbormaster, and for keeping our boat safe while we were below.", playerId: PLAYERS.Cara });
const spoke = await live.waitFor((l) => (l.npcSpeech?.length ?? 0) > n0, 40000);
if (!spoke) { rec.mark("speak_as_npc forced"); await tool("speak_as_npc", { npc_name: NPC, line: "Well now. Coin for the docks and not for my pocket? Brinewatch owes you more than that, Sister.", style: "softening, surprised" }); }
else rec.mark("Ysolde speaks");
const friendly = await live.waitFor((l) => l.state.monsters.find((m) => m.id === npc.id)?.attitude === "friendly", 25000);
if (!friendly) { rec.mark("adjust_attitude forced"); await tool("adjust_attitude", { npc_id: npc.id, delta: 2, reason: "a gift for the dock repairs" }); }
rec.mark("Friendly");
await live.settle(3500, 30000);
await sleep(3000);
rec.mark("end");
await saveShots([await rec.stop()]);
const d = say("npc-attitude");
console.log(JSON.stringify(d.clips, null, 1));
live.close();
await b.close();
process.exit(0);
