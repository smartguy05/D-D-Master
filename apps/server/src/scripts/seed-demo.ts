/**
 * Creates a ready-to-play demo campaign without any API keys:
 *   pnpm --filter @dm/server seed:demo
 * Useful for trying the table screen, dice and manual controls.
 */
import { GameService } from "../game/service.js";

const game = new GameService();
await game.init();

const c = game.createCampaign({ name: "The Sunken Chapel (demo)", premise: "Goblins have taken an old chapel above a flooded crypt.", partyLevel: 1 });
c.outline = {
  title: "The Sunken Chapel",
  hook: "The village of Brindle's bell has gone silent. Goblins were seen carrying lanterns into the old chapel on the hill.",
  acts: [
    { title: "The Silent Bell", summary: "Investigate the village and climb the hill." },
    { title: "The Chapel", summary: "Clear the goblin warband from the nave." },
    { title: "The Drowned Crypt", summary: "Descend into the flooded crypt and face what the goblins woke." },
  ],
  locations: [
    { id: "loc_nave", name: "Chapel Nave", description: "Broken pews, a collapsed bell rope, lantern light flickering behind the altar.", mapPrompt: "", gridW: 22, gridH: 14 },
    { id: "loc_crypt", name: "Drowned Crypt", description: "Knee-deep black water between stone sarcophagi.", mapPrompt: "", gridW: 18, gridH: 12 },
  ],
  npcs: [{ name: "Sister Maren", description: "The last caretaker, hiding in the belfry.", motive: "Keep the crypt sealed.", voice: "Frail, breathy whisper; long pauses; repeats the last word of a sentence when frightened." }],
  encounters: [{ id: "enc_1", locationId: "loc_nave", description: "Goblins looting the altar", monsters: [{ name: "Goblin Warrior", count: 3 }] }],
};
game.store.saveCampaign(c);
game.loadCampaign(c.id);

const sam = game.addPlayer("Sam");
const alex = game.addPlayer("Alex");
const jo = game.addPlayer("Jo");
game.addCharacter(
  {
    name: "Thorin",
    species: "Dwarf",
    className: "Fighter",
    maxHp: 13,
    ac: 18,
    abilities: { str: 16, dex: 12, con: 16, int: 8, wis: 13, cha: 10 },
    attacks: [{ name: "Battleaxe", toHit: 5, damage: "1d8+3 slashing" }],
    inventory: [
      { id: "i1", name: "Battleaxe", qty: 1 },
      { id: "i2", name: "Torch", qty: 5 },
      { id: "i3", name: "Rations", qty: 3 },
    ],
    gold: 12,
    appearance: "stocky red-bearded dwarf in dented plate armor",
  },
  sam.id,
);
game.addCharacter(
  {
    name: "Lyra",
    species: "Elf",
    className: "Wizard",
    maxHp: 8,
    ac: 12,
    abilities: { str: 8, dex: 14, con: 12, int: 16, wis: 12, cha: 10 },
    spells: ["Fire Bolt", "Magic Missile", "Shield"],
    inventory: [
      { id: "i4", name: "Spellbook", qty: 1 },
      { id: "i5", name: "Potion of Healing", qty: 1 },
    ],
    gold: 20,
    diceMode: "physical",
    appearance: "silver-haired elf wizard in blue robes holding a glowing staff",
  },
  alex.id,
);
game.addCharacter(
  {
    name: "Pip",
    species: "Halfling",
    className: "Rogue",
    maxHp: 10,
    ac: 14,
    abilities: { str: 8, dex: 17, con: 12, int: 12, wis: 10, cha: 14 },
    attacks: [{ name: "Shortsword", toHit: 5, damage: "1d6+3 piercing" }],
    inventory: [
      { id: "i6", name: "Thieves' Tools", qty: 1 },
      { id: "i7", name: "Rope (50 ft)", qty: 1 },
    ],
    gold: 5,
    appearance: "grinning halfling rogue in a green hooded cloak",
  },
  jo.id,
);
await game.runTool("change_scene", { location_id: "loc_nave" }, "host");
await game.runTool("spawn_monster", { name: "Goblin Warrior", count: 3 }, "host");
console.log(`Demo campaign ${c.id} created. Start the server and open /table.`);
process.exit(0);
