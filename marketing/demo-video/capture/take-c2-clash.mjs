// Take C2: the kobolds close in under the torchlight. Records combat-turn (live player attack the
// DM resolves, then a kobold hits Brienne: HP drains on TV and phone) and hook-dice (a natural 20).
// Run after take-c-combat.mjs, while that combat is still active.
import { launch, TV, PHONE, WEB, api, record, saveShots, sleep, tool } from "./recorder.mjs";
import { connectLive } from "./live.mjs";
import { PLAYERS, PCS } from "./cast.mjs";

const only = process.argv[2]; // optional: "clash" | "dice"
const live = connectLive();
const b = await launch();
const table = await (await b.newContext(TV)).newPage();
const phone = await (await b.newContext(PHONE)).newPage();
await sleep(1500);
const kobolds = () => live.state.monsters.filter((m) => !m.npc && m.hp > 0);
const pc = (id) => live.state.characters.find((c) => c.id === id);

// Stage: light the fight and bring the kobolds right up to the party.
await tool("reveal_area", { x: 10, y: 0, w: 12, h: 10 });
const spots = [[17, 5], [17, 4], [16, 6]];
for (const [i, k] of kobolds().entries()) {
  await tool("set_monster_hidden", { monster_id: k.id, hidden: false }).catch(() => {});
  if (spots[i]) await tool("move_token", { entity_id: k.id, x: spots[i][0], y: spots[i][1], override: true });
}
await table.goto(WEB + "/table");
await phone.goto(WEB + `/player/${PLAYERS.Alice}`);
await sleep(5000);

if (!only || only === "clash") {
  const tv = await record(table, "combat-turn");
  const ph = await record(phone, "phone-sheet");
  const mark = (l) => { tv.mark(l); ph.mark(l); };
  await sleep(1200);
  // A player declares the attack; the DM rolls and narrates it live.
  mark("Brienne declares attack");
  const r0 = live.rolls.length;
  await api("/api/dm/say", { text: "Brienne steps up and slashes at the kobold right in front of her!", playerId: PLAYERS.Alice });
  const rolled = await live.waitFor((l) => l.rolls.length > r0, 30000);
  if (!rolled) {
    mark("attack roll forced");
    await tool("roll_dice", { notation: "1d20+5", label: "Longsword attack", roller_id: PCS.Brienne, target_id: kobolds()[0].id, attack_name: "Longsword", override: true });
  } else mark("DM rolls the attack");
  await live.settle(4000, 40000);
  // A kobold strikes back: attack animation from kobold to Brienne, then damage.
  const k = kobolds()[0];
  mark("kobold attacks Brienne");
  await tool("roll_dice", { notation: "1d20+4", label: "Dagger attack", roller_id: k.id, target_id: PCS.Brienne, attack_name: "Dagger", dc: 1, override: true });
  await sleep(3500);
  mark("Brienne takes damage");
  await tool("apply_damage", { target_id: PCS.Brienne, amount: 4, damage_type: "piercing", source_id: k.id, attack_name: "Dagger" });
  await sleep(4500);
  mark("end");
  await saveShots(await Promise.all([tv.stop(), ph.stop()]));
}

if (!only || only === "dice") {
  // hook-dice: one recorded take per attack (the TV shows each roll ~7 s), keeping only the take
  // whose d20 lands on a natural 20, followed by the critical hit.
  let nat20 = false;
  for (let i = 0; i < 60 && !nat20; i++) {
    const target = kobolds()[0];
    const tv = await record(table, "hook-dice");
    await sleep(700);
    tv.mark("dice thrown");
    const n0 = live.rolls.length;
    await tool("roll_dice", { notation: "1d20+5", label: "Longsword attack", roller_id: PCS.Brienne, target_id: target.id, attack_name: "Longsword", override: true });
    await live.waitFor((l) => l.rolls.length > n0, 5000, 50);
    const d20 = live.rolls.at(-1)?.dice?.find((d) => d.sides === 20)?.value;
    nat20 = d20 === 20;
    if (!nat20) {
      await sleep(8500); // let the TV finish this roll before the next take
      await tv.discard();
      continue;
    }
    await sleep(3000);
    tv.mark("NAT 20 lands");
    await sleep(2000);
    tv.mark("critical damage");
    await tool("apply_damage", { target_id: target.id, amount: 14, damage_type: "slashing", critical: true, source_id: PCS.Brienne, attack_name: "Longsword" });
    await sleep(5500);
    tv.mark("end");
    await saveShots([await tv.stop()]);
  }
  console.log("nat20:", nat20);
}
live.close();
await b.close();
