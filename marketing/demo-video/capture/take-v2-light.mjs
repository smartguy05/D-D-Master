// Take v2 (lighthouse): sprite close-ups, a door opening through the fog onto skeletons, combat
// (battle intro, turn banners, a natural 20), the victory moment, loot pick-up, phone inventory.
// Usage: node take-v2-light.mjs [sprites|doors|combat|loot ...]  (default: all, in order)
import { launch, TV, PHONE, WEB, api, record, saveShots, sleep, tool } from "./recorder.mjs";
import { connectLive } from "./live.mjs";
import { dialogTracker } from "./dialog.mjs";
import { pan, zoom, orbit } from "./cam.mjs";
import { PLAYERS, PCS, LOCATIONS } from "./cast.mjs";

const want = new Set(process.argv.slice(2).length ? process.argv.slice(2) : ["sprites", "doors", "combat", "loot"]);
const live = connectLive();
await live.waitFor((l) => l.state, 10000);
const b = await launch();
const tvCtx = await b.newContext(TV);
const table = await tvCtx.newPage();
const shots = [];
const skeletons = () => live.state.monsters.filter((m) => /Skeleton/.test(m.name));
const place = async (id, x, y) => tool("move_token", { entity_id: id, x, y, ignore_terrain: true, override: true }).catch((e) => console.log(e.message));

async function freshTable() {
  await table.goto(WEB + "/table");
  await sleep(6000);
}

if (live.state.combat?.active) await tool("end_combat").catch(() => {});
if (live.state.locationId !== LOCATIONS.lighthouse) await tool("change_scene", { location_id: LOCATIONS.lighthouse, forced: true });
await api("/api/dm/text", {}).catch((e) => console.log(e.message));
await sleep(2000);
await api("/api/dm/whisper", { text: "Demo session: keep every reply to one or two vivid sentences. Act only on what the players say; use the tools as usual." });
await live.settle(2500, 30000);

if (want.has("sprites")) {
  // The party gathers in the hall below the storeroom.
  for (const [id, x, y] of [[PCS.Brienne, 8, 9], [PCS.Quill, 6, 10], [PCS.Morra, 7, 9], ["mon_dc206c1c01", 5, 9], ["mon_0a4db87c92", 7, 11]]) await place(id, x, y);
  if (live.state.wallEdits?.loc_light?.walls?.find((w) => w.id === "d2")?.open) await tool("set_door", { door_id: "d2", open: false });
  await tool("set_fog", { mode: "reset" });
  await sleep(1500);
  await freshTable();
  const rec = await record(table, "sprites");
  await sleep(1200);
  rec.mark("push in");
  await pan(table, [480, 610], [780, 470], 1500);
  await zoom(table, -4, 2500);
  rec.mark("close on standees");
  await orbit(table, 160, -20, 3500);
  await sleep(500);
  await orbit(table, -260, 10, 5000);
  rec.mark("end");
  await sleep(800);
  shots.push(await rec.stop());
}

if (want.has("doors")) {
  if (live.state.combat?.active) await tool("end_combat").catch(() => {});
  for (const s of skeletons()) await tool("remove_monster", { monster_id: s.id });
  await tool("set_door", { door_id: "d2", open: false }).catch(() => {});
  for (const [id, x, y] of [[PCS.Brienne, 8, 8], [PCS.Quill, 7, 10], [PCS.Morra, 9, 9], ["mon_dc206c1c01", 6, 9], ["mon_0a4db87c92", 8, 11]]) await place(id, x, y);
  await tool("set_fog", { mode: "reset" });
  // Hidden in the storeroom (it is all barrels, so they are placed past the furniture).
  await tool("spawn_monster", { name: "Skeleton", count: 2, hidden: true });
  await sleep(500);
  const [s1, s2] = skeletons();
  await place(s1.id, 8, 6);
  await place(s2.id, 9, 5);
  await api("/api/dm/whisper", { text: "Two skeletons lurk behind the storeroom door (d2). If a player opens it, open it with set_door, reveal them with set_monster_hidden and describe them. Do not start combat until a player attacks." });
  await live.settle(2500, 20000);
  await freshTable();
  await pan(table, [560, 560], [780, 600], 1);
  await zoom(table, -3, 300);
  await sleep(1500);
  const say = dialogTracker(live);
  const rec = await record(table, "doors");
  await sleep(1000);
  rec.mark("Brienne opens the storeroom door");
  await api("/api/dm/say", { text: "Brienne grips the handle: I throw open the storeroom door!", playerId: PLAYERS.Alice });
  const opened = await live.waitFor((l) => l.state.wallEdits?.loc_light?.walls?.find((w) => w.id === "d2")?.open, 25000);
  if (!opened) { rec.mark("set_door forced"); await tool("set_door", { door_id: "d2", open: true }); }
  rec.mark("door open: fog lifts, skeletons");
  await sleep(1200);
  for (const m of skeletons()) if (m.hidden) await tool("set_monster_hidden", { monster_id: m.id, hidden: false }).catch((e) => console.log(e.message));
  await live.settle(3500, 25000);
  await sleep(1500);
  rec.mark("end");
  shots.push(await rec.stop());
  say("doors");
}

if (want.has("combat")) {
  if (live.state.combat?.active) await tool("end_combat").catch(() => {});
  for (const m of skeletons()) if (m.hidden) await tool("set_monster_hidden", { monster_id: m.id, hidden: false });
  await freshTable();
  await pan(table, [560, 540], [780, 560], 1);
  await zoom(table, -2, 200);
  await sleep(1500);
  const say = dialogTracker(live);
  const rec = await record(table, "combat2");
  await sleep(800);
  rec.mark("initiative");
  await tool("start_combat");
  await sleep(7000);
  // Brienne swings until a natural 20 (each roll plays ~7 s on the TV; misses are cut in the edit).
  let crit = false;
  for (let i = 0; i < 40 && !crit; i++) {
    const target = skeletons().find((m) => m.hp > 0);
    if (!target) break;
    const n0 = live.rolls.length;
    rec.mark(`attack ${i}`);
    await tool("roll_dice", { notation: "1d20+5", label: "Longsword attack", roller_id: PCS.Brienne, target_id: target.id, attack_name: "Longsword", override: true });
    await live.waitFor((l) => l.rolls.length > n0, 5000, 50);
    const d20 = live.rolls.at(-1)?.dice?.find((d) => d.sides === 20)?.value;
    crit = d20 === 20;
    if (crit) {
      rec.mark("nat20");
      await sleep(4200);
      await tool("apply_damage", { target_id: target.id, amount: 16, damage_type: "slashing", source_id: PCS.Brienne, attack_name: "Longsword", critical: true }).catch(() =>
        tool("apply_damage", { target_id: target.id, amount: 16, damage_type: "slashing", source_id: PCS.Brienne, attack_name: "Longsword" }));
      rec.mark("skeleton 1 falls");
    } else await sleep(7600);
  }
  await sleep(5000);
  rec.mark("next turn");
  await tool("next_turn").catch((e) => console.log(e.message));
  await sleep(4500);
  const last = skeletons().find((m) => m.hp > 0);
  if (last) {
    rec.mark("Morra: sacred flame");
    await tool("play_effect", { kind: "radiant", source_id: PCS.Morra, target_id: last.id }).catch((e) => console.log(e.message));
    await tool("apply_damage", { target_id: last.id, amount: 20, damage_type: "radiant", source_id: PCS.Morra, attack_name: "Sacred Flame" });
    rec.mark("skeleton 2 falls");
  }
  await sleep(3500);
  if (live.state.combat?.active) { rec.mark("end_combat"); await tool("end_combat", { outcome: "victory" }).catch((e) => console.log(e.message)); }
  rec.mark("victory");
  await sleep(7000);
  rec.mark("end");
  shots.push(await rec.stop());
  say("combat2");
}

if (want.has("loot")) {
  const dead = skeletons();
  const loot = { items: [{ name: "Barnacled Cutlass" }, { name: "Drowned Sailor's Locket", description: "a tarnished silver locket with a lighthouse etched inside" }], gold: 12, name: "Skeleton's loot" };
  await tool("drop_loot", dead[0] ? { monster_id: dead[0].id, ...loot } : { x: 9, y: 6, ...loot });
  for (const s of dead) await tool("remove_monster", { monster_id: s.id });
  await place(PCS.Brienne, 8, 9);
  await sleep(8000); // item icons are generated on drop
  await freshTable();
  await pan(table, [600, 420], [780, 500], 1);
  await zoom(table, -4, 300);
  await sleep(2000);
  const rec = await record(table, "loot");
  await sleep(2500);
  const obj = live.state.mapObjects.find((o) => o.kind === "loot" || /loot/i.test(o.name));
  rec.mark("Brienne steps to the loot");
  await tool("move_token", { entity_id: PCS.Brienne, x: obj.x, y: obj.y, override: true }).catch(() => place(PCS.Brienne, obj.x, obj.y));
  await sleep(2000);
  rec.mark("picks up");
  await tool("pick_up", { object_id: obj.id, character_id: PCS.Brienne });
  await sleep(6000);
  rec.mark("end");
  shots.push(await rec.stop());
}

if (want.has("phone")) {
  const phone = await (await b.newContext(PHONE)).newPage();
  await phone.goto(`${WEB}/player/${PLAYERS.Alice}`);
  await sleep(5000);
  const rec = await record(phone, "phone-loot");
  await sleep(2000);
  rec.mark("scroll to inventory");
  for (let i = 0; i < 30; i++) { await phone.mouse.wheel(0, 40); await sleep(50); }
  await sleep(3000);
  for (let i = 0; i < 30; i++) { await phone.mouse.wheel(0, 40); await sleep(50); }
  await sleep(3000);
  rec.mark("end");
  shots.push(await rec.stop());
}

await saveShots(shots);
live.close();
await b.close();
process.exit(0);
