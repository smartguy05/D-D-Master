// Take C: a kobold ambush in the cove, run live by the DM. Records the TV (combat-turn) and
// Brienne's phone (phone-sheet) at the same time; players act on their turns by "speaking".
import { launch, TV, PHONE, WEB, api, record, saveShots, sleep, tool } from "./recorder.mjs";
import { connectLive } from "./live.mjs";
import { PLAYERS, PCS } from "./cast.mjs";

const live = connectLive();
const b = await launch();
const table = await (await b.newContext(TV)).newPage();
const phone = await (await b.newContext(PHONE)).newPage();
await table.goto(WEB + "/table");
await phone.goto(WEB + `/player/${PLAYERS.Alice}`);
await sleep(5000);

const hp = (id) => live.state?.characters.find((c) => c.id === id)?.hp;
const brienneHp0 = hp(PCS.Brienne);
const recTv = await record(table, "combat-turn");
const recPhone = await record(phone, "phone-sheet");
const mark = (l) => { recTv.mark(l); recPhone.mark(l); };

await api("/api/dm/whisper", {
  text: "Ambush now: three Kobold Warriors burst from the shipwreck (spawn_monster near the wreck, close to the party), then start_combat. Run monster turns fully, have a kobold attack Brienne, and keep fog on.",
});
await sleep(800);
mark("Quill peers into the dark");
await api("/api/dm/say", { text: "Quill holds up a glowing hand: Wait... something's moving in the wreck.", playerId: PLAYERS.Ben });
let ok = await live.waitFor((l) => l.state?.combat?.active, 60000);
if (!ok) {
  mark("ambush forced");
  await tool("spawn_monster", { name: "Kobold Warrior", count: 3, near: "Old shipwreck and broken deck", formation: "arc" });
  await tool("start_combat");
  await live.waitFor((l) => l.state?.combat?.active, 10000);
}
mark("combat starts");

// Play turns for up to ~2.5 minutes: on a PC's turn, its player declares an attack.
const lines = {
  [PCS.Brienne]: { player: "Alice", text: "Brienne roars and charges the nearest kobold, swinging her longsword!" },
  [PCS.Morra]: { player: "Cara", text: "Sister Morra raises her holy symbol and strikes the closest kobold with her mace!" },
  [PCS.Quill]: { player: "Ben", text: "Quill flings a Fire Bolt at the kobold nearest Brienne!" },
};
const end = Date.now() + 150000;
let lastTurnKey = "";
while (Date.now() < end) {
  const c = live.state?.combat;
  if (!c?.active) break;
  const cur = c.order[c.turnIndex];
  const key = `${c.round}:${c.turnIndex}`;
  // Quill rolls physical dice: answer a pending roll with a respectable value.
  const quill = live.state.characters.find((x) => x.id === PCS.Quill);
  if (quill?.pendingRoll) {
    const nat = 15;
    mark("Quill's physical roll");
    await api(`/api/players/${PLAYERS.Ben}/physical-roll`, { total: nat + 5, natural: nat }).catch((e) => console.log(e.message));
    await live.settle(3500, 60000);
    continue;
  }
  if (cur && key !== lastTurnKey && lines[cur.entityId]) {
    lastTurnKey = key;
    const l = lines[cur.entityId];
    mark(`${cur.name}'s turn`);
    await api("/api/dm/say", { text: l.text, playerId: PLAYERS[l.player] });
    await live.settle(4500, 60000);
    // If the DM is waiting for the player to end their turn, nudge it along.
    const c2 = live.state?.combat;
    if (c2?.active && `${c2.round}:${c2.turnIndex}` === key) {
      await api("/api/dm/say", { text: "That's my turn.", playerId: PLAYERS[l.player] });
      await live.settle(4500, 60000);
    }
  } else {
    await live.settle(3000, 30000);
  }
  if (hp(PCS.Brienne) < brienneHp0 && live.rolls.length >= 4) { mark("Brienne hurt"); break; }
}
if (hp(PCS.Brienne) >= brienneHp0) {
  mark("damage forced");
  const kobold = live.state.monsters.find((m) => !m.npc && m.hp > 0);
  await tool("apply_damage", { target_id: PCS.Brienne, amount: 5, damage_type: "slashing", source_id: kobold?.id, attack_name: "Spear" });
}
await sleep(4000);
mark("end");
const shots = await Promise.all([recTv.stop(), recPhone.stop()]);
await saveShots(shots);
console.log("Brienne HP", brienneHp0, "→", hp(PCS.Brienne), "| rolls:", live.rolls.length);
live.close();
await b.close();
