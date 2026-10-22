import { describe, expect, it } from "vitest";
import { watchReply, type WatchScene } from "./watch.js";

const scene: WatchScene = {
  inCombat: false,
  otherLocations: [
    { id: "loc_square", name: "Hollowberry Town Square" },
    { id: "loc_graves", name: "The Giggling Graveyard" },
    { id: "loc_tower", name: "Wisp's Hideout on Gloom Hill" },
  ],
};
const none = new Set<string>();

// Lines from the 2026-10-21 play-test, where no token moved.
describe("watchReply", () => {
  it("flags a player's move the DM only narrated", () => {
    const hit = watchReply({
      playerText: "I move around the graveyard, grabbing the loot bags on the way.",
      dmText: "Sir Bonesworth stands by the iron gate. How would you like to proceed?",
      tools: new Set(["get_party_status", "add_npc"]),
      scene: { ...scene, otherLocations: scene.otherLocations.filter((l) => l.id !== "loc_graves") },
    });
    expect(hit?.kind).toBe("move");
    expect(hit?.prompt).toMatch(/move_party/);
  });

  it("flags the DM narrating an arrival", () => {
    const hit = watchReply({
      playerText: "Do they have anything that might help us?",
      dmText: "Brannoc makes his way toward the stalls and now stands beside the berry and pastry stall.",
      tools: none,
      scene,
    });
    expect(hit?.kind).toBe("move");
  });

  it("points at change_scene when the move names another location", () => {
    const hit = watchReply({
      playerText: "We enter the hatch and go down into the cellar.",
      dmText: "You all descend into the cellar. Luminous footprints lead through a shallow passage toward the graveyard beyond. Where do you go from here?",
      tools: none,
      scene,
    });
    expect(hit?.kind).toBe("travel");
    expect(hit?.prompt).toMatch(/change_scene loc_graves/);
  });

  it("stays quiet when a move tool ran, in combat, or when nobody moved", () => {
    const moving = { playerText: "I head to the fortune teller's booth.", dmText: "Elowen reaches the tent.", scene };
    expect(watchReply({ ...moving, tools: new Set(["move_token"]) })).toBeUndefined();
    expect(watchReply({ ...moving, tools: new Set(["move_party"]) })).toBeUndefined();
    expect(watchReply({ ...moving, tools: none, scene: { ...scene, inCombat: true } })).toBeUndefined();
    expect(watchReply({ playerText: "Free food. Can I have some free food?", dmText: "What do you ask them?", tools: none, scene })).toBeUndefined();
    expect(watchReply({ playerText: "I use my persuasion skill on the ghost.", dmText: "Who wants to go first?", tools: none, scene })).toBeUndefined();
  });
});
