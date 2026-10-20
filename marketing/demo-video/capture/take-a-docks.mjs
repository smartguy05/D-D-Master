// Take A (docks): host starts the text DM, players talk (who's-talking), Pell Netter close-up.
// Shots: host-start, voice-talking, npc-closeup
import { launch, TV, WEB, api, record, saveShots, sleep, tool } from "./recorder.mjs";
import { connectLive } from "./live.mjs";
import { PLAYERS } from "./cast.mjs";

const live = connectLive();
const b = await launch();
const host = await (await b.newContext(TV)).newPage();
const table = await (await b.newContext(TV)).newPage();
await host.goto(WEB + "/host");
await table.goto(WEB + "/table");
await sleep(4000);
const shots = [];

// host-start: click the real button on the host laptop UI.
await api("/api/dm/stop", {}).catch(() => {});
const recHost = await record(host, "host-start");
await sleep(1500);
recHost.mark("open Play tab");
await host.getByRole("button", { name: /Play/ }).click();
await sleep(1500);
recHost.mark("click start DM");
await host.getByRole("button", { name: /Start text-only DM/ }).click();
await live.waitFor((l) => l.dm?.status && l.dm.status !== "offline", 30000);
recHost.mark("DM online");
await live.settle(4000, 60000);
await sleep(1000);
shots.push(await recHost.stop());

// voice-talking: three players speak in turn; the TV tags each speaker.
const recTalk = await record(table, "voice-talking");
await sleep(1000);
const say = async (who, text, wait = 2500) => {
  recTalk.mark(`${who} speaks`);
  await api("/api/dm/say", { text, playerId: PLAYERS[who] });
  await sleep(wait);
};
await say("Alice", "Brienne cracks her knuckles. Alright, who knows a boat that'll take us to the sea caves?");
await live.settle(3500, 60000);
await say("Ben", "Quill pipes up: I bet that fisherman, Pell, knows the tides better than anyone.");
await live.settle(3500, 60000);
await say("Cara", "Sister Morra walks over to Pell Netter and asks him kindly what he's seen out by the caves.");
recTalk.mark("DM answers as Pell");
await live.settle(5000, 90000);
shots.push(await recTalk.stop());

// npc-closeup: keep Pell talking; force the close-up if the DM didn't open one.
const recNpc = await record(table, "npc-closeup");
if (!live.focus) {
  recNpc.mark("npc_focus forced");
  await tool("npc_focus", { npc_name: "Pell Netter" });
}
await sleep(800);
recNpc.mark("Pell speaks");
await api("/api/dm/say", { text: "Brienne leans in: Pell, what's actually living in those caves? Tell us straight.", playerId: PLAYERS.Alice });
await live.settle(6000, 90000);
recNpc.mark("end");
shots.push(await recNpc.stop());

await saveShots(shots);
console.log("focus at end:", live.focus);
live.close();
await b.close();
