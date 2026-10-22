// Take v2 (docks): Pip, an AI-played seat, answers in its own voice (ai-player); then Quill splits
// off to the lighthouse and the TV cuts between the groups (party-split); Quill's phone map (phone-split).
// Usage: node take-v2-ai.mjs [ai|split|phone ...]
import { launch, TV, PHONE, WEB, api, record, saveShots, sleep, tool } from "./recorder.mjs";
import { connectLive } from "./live.mjs";
import { dialogTracker } from "./dialog.mjs";
import { pan, zoom } from "./cam.mjs";
import { PLAYERS, PCS, LOCATIONS } from "./cast.mjs";

const want = new Set(process.argv.slice(2).length ? process.argv.slice(2) : ["ai", "split", "phone"]);
const live = connectLive();
await live.waitFor((l) => l.state, 10000);
const place = (id, x, y) => tool("move_token", { entity_id: id, x, y, ignore_terrain: true, override: true }).catch((e) => console.log(e.message));
const pip = () => live.state.characters.find((c) => c.name === "Pip");
const b = await launch();
const table = await (await b.newContext(TV)).newPage();
const shots = [];

async function framedTable(close = true) {
  await table.goto(WEB + "/table");
  await sleep(7000);
  if (!close) return;
  await pan(table, [780, 300], [780, 470], 1);
  await zoom(table, -3, 300);
  await sleep(1500);
}

if (want.has("ai")) {
  if (live.state.locationId !== LOCATIONS.docks) await tool("change_scene", { location_id: LOCATIONS.docks, forced: true });
  for (const [id, x, y] of [[PCS.Brienne, 11, 8], [PCS.Morra, 12, 8], [PCS.Quill, 13, 8], [pip().id, 12, 9], ["mon_dc206c1c01", 11, 10], ["mon_0a4db87c92", 13, 10]]) await place(id, x, y);
  await live.settle(2500, 20000);
  await framedTable();
  const say = dialogTracker(live);
  const rec = await record(table, "ai-player");
  await sleep(1000);
  const robin = live.state.players.find((p) => p.name === "Robin");
  const n0 = live.npcSpeech?.length ?? 0;
  rec.mark("Brienne asks Pip");
  await api("/api/dm/say", { text: "Brienne turns to the halfling: Pip, you've got the sharpest eyes of any of us. What do you make of that wreck out past the pier?", playerId: PLAYERS.Alice });
  let ok = await live.waitFor((l) => (l.npcSpeech ?? []).slice(n0).some((s) => s.pc || /Pip/.test(s.npcName)), 60000);
  if (!ok) { rec.mark("nudge"); await api(`/api/players/${robin.id}/ai/nudge`, {}); ok = await live.waitFor((l) => (l.npcSpeech ?? []).slice(n0).some((s) => s.pc || /Pip/.test(s.npcName)), 40000); }
  rec.mark(ok ? "Pip speaks" : "Pip silent");
  await sleep(4000);
  await live.settle(4000, 40000);
  await sleep(2000);
  rec.mark("end");
  shots.push(await rec.stop());
  console.log(JSON.stringify(say("ai-player").clips, null, 1));
}

if (want.has("split")) {
  if (Object.keys(live.state.partyLocations ?? {}).length) await tool("change_scene", { location_id: LOCATIONS.docks, forced: true });
  await live.settle(2500, 20000);
  await framedTable(false);
  const say = dialogTracker(live);
  const rec = await record(table, "party-split");
  await sleep(1000);
  rec.mark("Quill splits off");
  await api("/api/dm/say", { text: "Quill tucks Mara's journal under his arm: You three check the wreck. I'm heading back up to the lighthouse to study these pages alone.", playerId: PLAYERS.Ben });
  let split = await live.waitFor((l) => Object.keys(l.state.partyLocations ?? {}).length > 0, 12000);
  if (!split) { rec.mark("change_scene forced"); await tool("change_scene", { location_id: LOCATIONS.lighthouse, character_ids: [PCS.Quill], forced: true }); split = await live.waitFor((l) => Object.keys(l.state.partyLocations ?? {}).length > 0, 10000); }
  rec.mark("Quill leaves: other groups line");
  await live.settle(3000, 30000);
  await sleep(1500);
  rec.mark("focus the lighthouse");
  await tool("focus_scene", { location_id: LOCATIONS.lighthouse });
  await sleep(6000);
  rec.mark("focus back to the docks");
  await tool("focus_scene", { location_id: LOCATIONS.docks });
  await sleep(5000);
  rec.mark("end");
  shots.push(await rec.stop());
  say("party-split");
}

if (want.has("phone")) {
  const phone = await (await b.newContext(PHONE)).newPage();
  await phone.goto(`${WEB}/player/${PLAYERS.Ben}`);
  await sleep(5000);
  const rec = await record(phone, "phone-split");
  await sleep(4000);
  rec.mark("end");
  shots.push(await rec.stop());
}

await saveShots(shots);
live.close();
await b.close();
process.exit(0);
