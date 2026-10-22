// Take v2 crit: a close camera on Brienne and a skeleton; one recorded take per attack (with
// advantage), keeping only the one whose d20 lands on 20, then the critical damage and the fall.
import { launch, TV, WEB, record, saveShots, sleep, tool } from "./recorder.mjs";
import { connectLive } from "./live.mjs";
import { pan, zoom } from "./cam.mjs";
import { PCS } from "./cast.mjs";

const live = connectLive();
await live.waitFor((l) => l.state, 10000);
const place = (id, x, y) => tool("move_token", { entity_id: id, x, y, ignore_terrain: true, override: true }).catch((e) => console.log(e.message));
if (live.state.combat?.active) await tool("end_combat").catch(() => {});
for (const m of live.state.monsters.filter((m) => /Skeleton/.test(m.name))) await tool("remove_monster", { monster_id: m.id });
await tool("spawn_monster", { name: "Skeleton", count: 1, x: 9, y: 8 });
await sleep(500);
const skel = live.state.monsters.find((m) => /Skeleton/.test(m.name));
await place(PCS.Brienne, 8, 8);
await place(skel.id, 9, 8);
await tool("start_combat");
await sleep(1000);

const b = await launch();
const table = await (await b.newContext(TV)).newPage();
await table.goto(WEB + "/table");
await sleep(9000); // battle intro
await pan(table, [600, 400], [780, 520], 1);
await zoom(table, -4, 300);
await sleep(1500);

let shot = null;
for (let i = 0; i < 45 && !shot; i++) {
  const rec = await record(table, "crit2");
  await sleep(700);
  const n0 = live.rolls.length;
  rec.mark("Brienne attacks");
  await tool("roll_dice", { notation: "2d20kh1+5", label: "Longsword attack (advantage)", roller_id: PCS.Brienne, target_id: skel.id, attack_name: "Longsword", override: true });
  await live.waitFor((l) => l.rolls.length > n0, 5000, 50);
  const kept = Math.max(...(live.rolls.at(-1)?.dice ?? []).filter((d) => d.sides === 20).map((d) => d.value));
  if (kept === 20) {
    rec.mark("nat 20");
    await sleep(4200);
    rec.mark("critical damage");
    await tool("apply_damage", { target_id: skel.id, amount: 17, damage_type: "slashing", critical: true, source_id: PCS.Brienne, attack_name: "Longsword" });
    await sleep(5000);
    rec.mark("end");
    shot = await rec.stop();
  } else {
    await rec.discard();
    await sleep(7000);
  }
  console.log("try", i, "d20", kept);
}
if (shot) await saveShots([shot]);
live.close();
await b.close();
process.exit(0);
