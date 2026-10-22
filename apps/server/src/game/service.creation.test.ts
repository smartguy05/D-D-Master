import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CreationChoices, type ServerEvent } from "@dm/shared";
import { config } from "../config.js";
import { Store } from "../db/index.js";
import { GameService } from "./service.js";

const origDataDir = config.dataDir;
let dataDir = "";
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "dm-svc-creation-"));
  config.dataDir = dataDir;
});
afterEach(() => {
  config.dataDir = origDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

function setup(opts: { images?: boolean } = {}) {
  const store = new Store(":memory:");
  const game = new GameService(store);
  const events: ServerEvent[] = [];
  game.hub.broadcast = (ev) => void events.push(ev);
  const sprite = vi.fn(async () => "/media/x/portrait.png");
  (game as unknown as { images: unknown }).images = { sprite, cachedSprite: () => undefined, map: async () => "/m.png", readAsset: () => undefined, available: opts.images ?? false };
  (game as unknown as { readFeatures: unknown }).readFeatures = async () => [];
  const campaign = game.createCampaign({ name: "A" });
  return { store, game, events, campaign, sprite };
}

describe("creation settings", () => {
  it("defaults: phone creation on, standard array and point buy, no homebrew, unlocked", () => {
    const { campaign } = setup();
    expect(campaign.creation).toEqual({ phoneCreation: true, abilityMethods: ["standard_array", "point_buy"], allowHomebrew: false });
  });

  it("the host changes the party level and creation rules; playStartedAt is not settable there", () => {
    const { game } = setup();
    const c = game.updateCampaignSettings({ partyLevel: 3, creation: { abilityMethods: ["rolled"], allowHomebrew: true, playStartedAt: 5 } });
    expect(c.partyLevel).toBe(3);
    expect(c.creation).toMatchObject({ abilityMethods: ["rolled"], allowHomebrew: true, phoneCreation: true });
    expect(c.creation.playStartedAt).toBeUndefined();
    expect(() => game.updateCampaignSettings({ creation: { abilityMethods: [] } })).toThrow();
    expect(() => game.updateCampaignSettings({ partyLevel: 21 })).toThrow();
  });

  it("the host locks and unlocks edits", () => {
    const { game, events } = setup();
    expect(game.setCreationLock(true).creation.playStartedAt).toBeGreaterThan(0);
    const at = game.campaign!.creation.playStartedAt;
    expect(game.setCreationLock(true).creation.playStartedAt).toBe(at);
    expect(game.setCreationLock(false).creation.playStartedAt).toBeUndefined();
    expect(events.some((e) => e.type === "campaign")).toBe(true);
  });

  it("the DM's opening (begin) locks edits; it survives a reload", () => {
    const { game, store, campaign } = setup();
    const host = (game as unknown as { dmHost(): { opening(): string } }).dmHost();
    host.opening();
    const at = game.campaign!.creation.playStartedAt;
    expect(at).toBeGreaterThan(0);
    host.opening();
    expect(game.campaign!.creation.playStartedAt).toBe(at);
    expect(store.getCampaign(campaign.id)!.creation.playStartedAt).toBe(at);
  });
});

describe("phone roster pick", () => {
  function withRosterHero() {
    const ctx = setup();
    const { game } = ctx;
    const sam = game.addPlayer("Sam");
    const pc = game.addCharacter({ name: "Mara", species: "Human", className: "Fighter", level: 3, maxHp: 28 }, sam.id);
    const { rosterId } = game.saveToRoster(pc.id);
    game.removeCharacter(pc.id);
    const other = game.addPlayer("Lee");
    return { ...ctx, sam, other, rosterId };
  }

  it("lists the whole roster and flags the player's own heroes by name (case and spaces ignored)", () => {
    const { game, sam, other, rosterId } = withRosterHero();
    game.updatePlayer(sam.id, { name: "  sam " });
    expect(game.playerRoster(sam.id)).toEqual([expect.objectContaining({ id: rosterId, name: "Mara", mine: true, levelMismatch: true })]);
    expect(game.playerRoster(other.id)[0]).toMatchObject({ mine: false });
    expect(() => game.playerRoster("plr_nope")).toThrow(/Unknown player/);
  });

  it("joins as the calling seat only, and refuses a seat that already plays someone", () => {
    const { game, other, rosterId } = withRosterHero();
    expect(game.playerRoster(other.id)[0].inCampaign).toBe(false);
    const pc = game.playerJoinFromRoster(other.id, rosterId);
    expect(game.playerRoster(other.id)[0].inCampaign).toBe(true);
    expect(pc.playerName).toBe("Lee");
    expect(game.state!.players.find((p) => p.id === other.id)!.characterId).toBe(pc.id);
    const second = game.addCharacter({ name: "Nim", maxHp: 8 });
    game.saveToRoster(second.id);
    game.removeCharacter(second.id);
    const nimRoster = game.listRoster().find((r) => r.name === "Nim")!;
    expect(() => game.playerJoinFromRoster(other.id, nimRoster.id)).toThrow(/already plays/);
  });

  it("refuses when the host turned phone creation off", () => {
    const { game, other, rosterId } = withRosterHero();
    game.updateCampaignSettings({ creation: { phoneCreation: false } });
    expect(() => game.playerJoinFromRoster(other.id, rosterId)).toThrow(/turned off/);
  });
});

/** A legal level 1 Human Soldier Fighter (standard array). */
const FIGHTER: CreationChoices = {
  name: "Mara",
  species: "Human",
  speciesChoices: { size: "Medium", skillful: "Perception", versatile: "Alert" },
  className: "Fighter",
  background: "Soldier",
  abilityMethod: "standard_array",
  baseAbilities: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  backgroundBonuses: { str: 2, con: 1 },
  classSkills: ["Acrobatics", "Survival"],
  fightingStyle: "Defense",
  classEquipment: "A",
  backgroundEquipment: "B",
  appearance: "Tall, scarred, in dented chain mail.",
  personality: "Blunt and loyal.",
};

async function withSrd(opts: { images?: boolean } = {}) {
  const ctx = setup(opts);
  await ctx.game.init(); // SRD catalogs (it reloads the newest campaign: ours)
  const sam = ctx.game.addPlayer("Sam");
  return { ...ctx, sam };
}

describe("phone creation drafts", () => {
  it("a fresh draft lists what is missing and has no preview; patches are validated live", async () => {
    const { game, sam, events } = await withSrd();
    const empty = game.creation.view(sam.id);
    expect(empty.draft.status).toBe("draft");
    expect(empty.validation.ok).toBe(false);
    expect(empty.preview).toBeNull();
    expect(empty.level).toBe(1);
    const v = game.creation.patch(sam.id, FIGHTER);
    expect(v.validation.errors).toEqual([]);
    expect(v.preview).toMatchObject({ name: "Mara", ac: 17, maxHp: 12, hitDice: { max: 1 } });
    expect(events.filter((e) => e.type === "creation").at(-1)).toMatchObject({ type: "creation", playerId: sam.id, status: "draft" });
    expect(() => game.creation.patch(sam.id, { baseAbilities: { str: 40 } })).toThrow(/baseAbilities.str/);
    expect(game.state!.characters).toHaveLength(0); // drafts never touch GameState
  });

  it("a valid draft joins at once: character, token, player link, roster entry; no sprite drawn when a portrait exists", async () => {
    const { game, sam, sprite } = await withSrd({ images: true });
    game.creation.patch(sam.id, FIGHTER);
    game.creation.drawPortrait(sam.id, false);
    await vi.waitFor(() => expect(game.creation.view(sam.id).draft.portraitUrl).toBe("/media/x/portrait.png"));
    expect(sprite).toHaveBeenCalledTimes(1);
    const v = game.creation.join(sam.id);
    expect(v.draft.status).toBe("joined");
    const pc = game.state!.characters[0];
    expect(pc).toMatchObject({ name: "Mara", playerName: "Sam", spriteUrl: "/media/x/portrait.png", personality: "Blunt and loyal.", ac: 17 });
    expect(game.state!.players.find((p) => p.id === sam.id)!.characterId).toBe(pc.id);
    expect(game.state!.tokens.some((t) => t.entityId === pc.id)).toBe(true);
    expect(game.listRoster().map((r) => r.name)).toEqual(["Mara"]);
    expect(sprite).toHaveBeenCalledTimes(1);
    expect(game.state!.log.at(-1)?.text).toMatch(/Sam created Mara on their phone/);
  });

  it("an invalid draft can't join; it goes to the host, who sends it back or approves it", async () => {
    const { game, sam } = await withSrd();
    game.creation.patch(sam.id, { ...FIGHTER, baseAbilities: { str: 17, dex: 13, con: 14, int: 8, wis: 12, cha: 10 } });
    expect(() => game.creation.join(sam.id)).toThrow(/Not ready: Standard array/);
    game.creation.submit(sam.id, "I rolled a 17 at the table");
    expect(() => game.creation.patch(sam.id, { name: "X" })).toThrow(/waiting for the host/);
    const [pending] = game.creation.pending();
    expect(pending).toMatchObject({ playerName: "Sam", draft: { status: "pending", playerNote: "I rolled a 17 at the table" } });
    expect(pending.validation.errors[0].field).toBe("baseAbilities");
    game.creation.sendBack(sam.id, "Use the array please");
    expect(game.creation.view(sam.id).draft).toMatchObject({ status: "returned", hostMessage: "Use the array please" });
    expect(game.creation.patch(sam.id, { name: "Mira" }).draft.status).toBe("draft");
    game.creation.submit(sam.id, "");
    game.creation.approve(sam.id);
    expect(game.state!.characters[0]).toMatchObject({ name: "Mira", abilities: { str: 19 } });
    expect(game.state!.log.at(-1)?.text).toMatch(/approved by the host/);
    expect(game.creation.pending()).toEqual([]);
  });

  it("before play a joined character can be edited from the phone; after the DM opens the session it's locked", async () => {
    const { game, sam } = await withSrd();
    game.creation.patch(sam.id, FIGHTER);
    game.creation.join(sam.id);
    const id = game.state!.characters[0].id;
    game.creation.patch(sam.id, { name: "Mara Vey", classEquipment: "B" });
    game.creation.join(sam.id);
    expect(game.state!.characters).toHaveLength(1);
    expect(game.state!.characters[0]).toMatchObject({ id, name: "Mara Vey", ac: 14 }); // Studded Leather 12 + DEX 1 + Defense
    expect(game.state!.characters[0].inventory.some((i) => i.name === "Chain Mail")).toBe(false);
    expect(game.listRoster().map((r) => r.name)).toEqual(["Mara Vey"]); // same roster entry, updated
    (game as unknown as { dmHost(): { opening(): string } }).dmHost().opening();
    expect(game.creation.view(sam.id).locked).toBe(true);
    expect(() => game.creation.patch(sam.id, { name: "Late" })).toThrow(/Play has started/);
    game.setCreationLock(false);
    expect(game.creation.patch(sam.id, { name: "Late" }).draft.choices.name).toBe("Late");
  });

  it("undoing the join makes it a draft again; a seat with another character can't join", async () => {
    const { game, sam } = await withSrd();
    game.creation.patch(sam.id, FIGHTER);
    game.creation.join(sam.id);
    game.undo(); // the log line and roster link aren't undo entries: this undoes the join
    expect(game.state!.characters).toHaveLength(0);
    expect(game.creation.view(sam.id).draft.status).toBe("draft");
    game.creation.join(sam.id); // joining again updates the same roster entry
    expect(game.listRoster()).toHaveLength(1);
    game.undo();
    game.addCharacter({ name: "Host Made", maxHp: 9 }, sam.id);
    expect(game.creation.view(sam.id).hasOtherCharacter).toBe(true);
    expect(() => game.creation.join(sam.id)).toThrow(/already plays Host Made/);
  });

  it("the host unassigns a phone-made hero: the seat starts a fresh draft and joins a new character", async () => {
    const { game, sam } = await withSrd();
    game.creation.patch(sam.id, FIGHTER);
    game.creation.join(sam.id);
    const old = game.state!.characters[0];
    game.updatePlayer(sam.id, { characterId: null });
    expect(game.state!.players.find((p) => p.id === sam.id)!.characterId).toBeUndefined();
    expect(game.state!.characters[0].playerName).toBe("");
    const v = game.creation.view(sam.id);
    expect(v.draft).toMatchObject({ status: "draft", choices: {} });
    expect(v.draft.characterId).toBeUndefined();
    game.creation.patch(sam.id, { ...FIGHTER, name: "Nell" });
    game.creation.join(sam.id);
    expect(game.state!.characters.map((c) => c.name)).toEqual(["Mara", "Nell"]);
    expect(game.state!.characters[0]).toMatchObject({ id: old.id, name: "Mara" }); // the old hero is untouched
    expect(game.listRoster().map((r) => r.name).sort()).toEqual(["Mara", "Nell"]); // a new roster entry
  });

  it("rolled scores: only when allowed, once, server-side", async () => {
    const { game, sam } = await withSrd();
    expect(() => game.creation.rollScores(sam.id)).toThrow(/doesn't allow rolled/);
    game.updateCampaignSettings({ creation: { abilityMethods: ["rolled"] } });
    const v = game.creation.rollScores(sam.id);
    expect(v.draft.rolledScores).toHaveLength(6);
    expect(v.draft.choices.abilityMethod).toBe("rolled");
    expect(() => game.creation.rollScores(sam.id)).toThrow(/already rolled/);
    expect(() => game.creation.patch(sam.id, { rolledScores: [18, 18, 18, 18, 18, 18] })).not.toThrow();
    expect(game.creation.view(sam.id).draft.rolledScores).toEqual(v.draft.rolledScores); // not settable by a patch
  });

  it("portraits need an image key, a name and an appearance, and are capped", async () => {
    const { game, sam } = await withSrd();
    game.creation.patch(sam.id, FIGHTER);
    expect(() => game.creation.drawPortrait(sam.id, false)).toThrow(/No image key/);
  });

  it("start over deletes the draft; resetting the campaign without players deletes every draft", async () => {
    const { game, sam, store, campaign } = await withSrd();
    game.creation.patch(sam.id, FIGHTER);
    expect(game.creation.reset(sam.id).draft.choices).toEqual({});
    game.creation.patch(sam.id, FIGHTER);
    game.resetCampaign(campaign.id, { keepOutline: false, keepPlayers: false, keepCharacters: false } as never);
    expect(store.listCreationDrafts(campaign.id)).toEqual([]);
  });

  it("phone creation off: every change is refused", async () => {
    const { game, sam } = await withSrd();
    game.updateCampaignSettings({ creation: { phoneCreation: false } });
    expect(() => game.creation.patch(sam.id, FIGHTER)).toThrow(/turned off/);
    expect(game.creation.view(sam.id).settings.phoneCreation).toBe(false);
  });

  it("options: classes with level data, species, backgrounds, feats and spell lists", async () => {
    const { game, sam } = await withSrd();
    game.creation.view(sam.id);
    const o = game.creation.options();
    expect(o.classes.find((c) => c.name === "Wizard")).toMatchObject({ cantrips: 3, preparedSpells: 4, maxSpellLevel: 1, subclassLevel: 3 });
    expect(o.species).toHaveLength(9);
    expect(o.backgrounds).toHaveLength(4);
    expect(o.spells.Cleric.some((s) => s.name === "Guidance" && s.level === 0)).toBe(true);
  });
});

describe("phone creation chat (AI helper)", () => {
  function fakeLlm(replies: (object | Error)[]) {
    return {
      name: "fake",
      model: "fake",
      complete: vi.fn(async () => {
        const r = replies.shift();
        if (!r || r instanceof Error) throw r ?? new Error("empty");
        return JSON.stringify(r);
      }),
    };
  }

  it("a line runs in the background; the reply and its patch land on the draft", async () => {
    const { game, sam, events } = await withSrd();
    game.creationLlm = fakeLlm([{ reply: "A Human Fighter, great choice!", patch: { species: "Human", className: "Fighter", name: "" } }]);
    const v = game.creation.chat(sam.id, "  I want a big human fighter  ");
    expect(v.draft.chatBusy).toBe(true);
    expect(v.draft.chat).toEqual([expect.objectContaining({ role: "player", text: "I want a big human fighter" })]);
    expect(() => game.creation.chat(sam.id, "and?")).toThrow(/still answering/);
    await vi.waitFor(() => expect(game.creation.view(sam.id).draft.chatBusy).toBe(false));
    const d = game.creation.view(sam.id).draft;
    expect(d.chat.at(-1)).toMatchObject({ role: "ai", text: "A Human Fighter, great choice!" });
    expect(d.choices).toMatchObject({ species: "Human", className: "Fighter" });
    expect(d.choices.name).toBeUndefined(); // "" from the AI is no change
    expect(events.filter((e) => e.type === "creation" && e.busy).length).toBeGreaterThan(0);
  });

  it("the player's own edits during the reply are kept", async () => {
    const { game, sam } = await withSrd();
    game.creationLlm = fakeLlm([{ reply: "Soldier fits!", patch: { background: "Soldier" } }]);
    game.creation.chat(sam.id, "a soldier maybe");
    game.creation.patch(sam.id, { name: "Mara" });
    await vi.waitFor(() => expect(game.creation.view(sam.id).draft.chatBusy).toBe(false));
    expect(game.creation.view(sam.id).draft.choices).toMatchObject({ name: "Mara", background: "Soldier" });
  });

  it("a failed reply becomes a note in the chat; without a brain the chat is refused", async () => {
    const { game, sam } = await withSrd();
    game.creationLlm = fakeLlm([new Error("timeout"), new Error("timeout")]);
    game.creation.chat(sam.id, "hello");
    await vi.waitFor(() => expect(game.creation.view(sam.id).draft.chatBusy).toBe(false));
    expect(game.creation.view(sam.id).draft.chat.at(-1)).toMatchObject({ role: "system" });
    game.creationLlm = undefined;
    expect(() => game.creation.chat(sam.id, "hello")).toThrow(/needs a brain key/);
    expect(() => game.creation.chat(sam.id, "   ")).toThrow();
  });

  it("the helper sees the SRD rules and is asked to fix what its patch broke", async () => {
    const { game, sam } = await withSrd();
    const llm = fakeLlm([
      { reply: "Skills!", patch: { className: "Fighter", classSkills: ["Arcana", "Athletics"] } },
      { reply: "Skills: Athletics and Survival.", patch: { className: "Fighter", classSkills: ["Athletics", "Survival"] } },
    ]);
    game.creationLlm = llm;
    game.creation.chat(sam.id, "fighter skills please");
    await vi.waitFor(() => expect(game.creation.view(sam.id).draft.chatBusy).toBe(false));
    expect(llm.complete).toHaveBeenCalledTimes(2);
    const prompts = llm.complete.mock.calls.map((c) => (c as unknown as [{ prompt: string; system: string }])[0]);
    expect(prompts[0].system).toContain("- Fighter (d10; skills: 2 of");
    expect(prompts[1].prompt).toContain("Arcana isn't a Fighter skill choice");
    expect(game.creation.view(sam.id).draft.choices.classSkills).toEqual(["Athletics", "Survival"]);
  });
});
