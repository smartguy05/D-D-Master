import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { CharacterConstraints, findCustomSpecies, type CreationChoices } from "@dm/shared";
import { ClassCatalog } from "../../rules/classes.js";
import { EquipmentCatalog } from "../../rules/equipment.js";
import { OriginCatalog } from "../../rules/origins.js";
import { SpellCatalog } from "../../rules/spells.js";
import { resolveChoices, rollAbilitySet, validateDraft, type CreationContext, type CreationRules } from "./validate.js";

const SRD_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "../../../../../data/srd");
const classes = new ClassCatalog();
const origins = new OriginCatalog();
const equipment = new EquipmentCatalog();
const spells = new SpellCatalog();
classes.load(SRD_DIR);
origins.load(SRD_DIR);
equipment.load(SRD_DIR);
spells.load(SRD_DIR);

const rules: CreationRules = {
  classData: (n) => classes.get(n),
  species: (n) => origins.species(n),
  background: (n) => origins.background(n),
  feat: (n) => origins.feat(n),
  armor: (n) => equipment.armor(n),
  weapon: (n) => equipment.weapon(n),
  spell: (n) => spells.get(n) ?? spells.find(n),
  classSpells: (c) => spells.list().filter((s) => s.classes.includes(c)),
  isHomebrew: (n) => n === "Moonblade",
};

const ctx = (over: Partial<CreationContext> = {}): CreationContext => ({ level: 1, methods: ["standard_array", "point_buy"], allowHomebrew: false, rules, ...over });

/** A legal level 1 Human Soldier Fighter (standard array). */
const fighter = (over: CreationChoices = {}): CreationChoices => ({
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
  ...over,
});

const codes = (c: CreationChoices, x?: Partial<CreationContext>) => validateDraft(c, ctx(x)).errors.map((e) => `${e.field}:${e.code}`);

describe("resolveChoices: a legal character", () => {
  it("passes with no errors and derives the sheet", () => {
    const r = resolveChoices(fighter(), ctx());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    const d = r.draft!;
    expect(d.abilities).toEqual({ str: 17, dex: 13, con: 15, int: 8, wis: 12, cha: 10 });
    expect(d.maxHp).toBe(12); // d10 + CON +2
    expect(d.ac).toBe(17); // Chain Mail 16 + Defense 1
    expect(d.proficiencyBonus).toBe(2);
    expect(d.skills).toEqual(expect.arrayContaining(["Athletics", "Intimidation", "Perception", "Acrobatics", "Survival"]));
    expect(d.savingThrows).toEqual(["str", "con"]);
    expect(d.attacks).toContainEqual(expect.objectContaining({ name: "Greatsword", toHit: 5, damage: "2d6+3 slashing" }));
    expect(d.attacks).toContainEqual(expect.objectContaining({ name: "Javelin", toHit: 5 }));
    expect(d.inventory).toContainEqual(expect.objectContaining({ name: "Chain Mail", equipped: true }));
    expect(d.gold).toBe(4 + 50);
    expect(d.features).toEqual(expect.arrayContaining(["Skillful (Perception)", "Versatile (Alert)", "Savage Attacker", "Alert", "Fighting Style: Defense", "Second Wind"]));
  });

  it("a point-buy High Elf Sage Wizard with Magic Initiate, cantrips and prepared spells", () => {
    const wizard: CreationChoices = {
      name: "Ilsa",
      species: "Elf",
      speciesChoices: { elven_lineage: "High Elf", elven_lineage_ability: "Intelligence", keen_senses: "Perception" },
      className: "Wizard",
      background: "Sage",
      abilityMethod: "point_buy",
      baseAbilities: { str: 8, dex: 14, con: 14, int: 15, wis: 10, cha: 10 },
      backgroundBonuses: { int: 2, con: 1 },
      classSkills: ["Investigation", "Insight"],
      featPicks: { background: { cantrips: ["Mage Hand", "Light"], spell: "Shield" } },
      cantrips: ["Fire Bolt", "Minor Illusion", "Ray of Frost"],
      spells: ["Magic Missile", "Sleep", "Detect Magic", "Burning Hands"],
      classEquipment: "A",
      backgroundEquipment: "A",
      appearance: "Silver hair, ink-stained fingers.",
    };
    const r = resolveChoices(wizard, ctx());
    expect(r.errors).toEqual([]);
    expect(r.draft!.speed).toBe(30);
    expect(r.draft!.spells).toEqual(expect.arrayContaining(["Prestidigitation", "Mage Hand", "Light", "Shield", "Fire Bolt", "Magic Missile"]));
    expect(r.draft!.ac).toBe(12); // 10 + DEX 2, no armor training
  });

  it("level 3: subclass and the Elf/Tiefling level 3 spell", () => {
    const r = resolveChoices(
      fighter({ species: "Tiefling", speciesChoices: { size: "Medium", fiendish_legacy: "Infernal", fiendish_legacy_ability: "Charisma" }, subclass: "Champion" }),
      ctx({ level: 3 }),
    );
    expect(r.errors).toEqual([]);
    expect(r.draft!.spells).toEqual(expect.arrayContaining(["Thaumaturgy", "Fire Bolt", "Hellish Rebuke"]));
    expect(r.draft!.features).toEqual(expect.arrayContaining(["Subclass: Champion", "Champion: Improved Critical"]));
    expect(r.draft!.maxHp).toBe(10 + 2 + 2 * (6 + 2));
  });
});

describe("resolveChoices: rule errors", () => {
  it("ability methods: wrong array, point buy over budget, method not allowed, rolled scores", () => {
    expect(codes(fighter({ baseAbilities: { str: 15, dex: 15, con: 14, int: 8, wis: 12, cha: 10 } }))).toContain("baseAbilities:standard_array");
    expect(codes(fighter({ abilityMethod: "point_buy", baseAbilities: { str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 9 } }))).toContain("baseAbilities:point_buy_over");
    expect(codes(fighter({ abilityMethod: "point_buy", baseAbilities: { str: 16, dex: 8, con: 8, int: 8, wis: 8, cha: 8 } }))).toContain("baseAbilities:point_buy_range");
    expect(codes(fighter({ abilityMethod: "rolled" }))).toEqual(expect.arrayContaining(["abilityMethod:method_not_allowed", "baseAbilities:not_rolled"]));
    const rolled = { abilityMethod: "rolled" as const, baseAbilities: { str: 16, dex: 12, con: 14, int: 9, wis: 11, cha: 7 } };
    expect(codes(fighter(rolled), { methods: ["rolled"], rolledScores: [16, 14, 12, 11, 9, 7] })).toEqual([]);
    expect(codes(fighter(rolled), { methods: ["rolled"], rolledScores: [16, 14, 12, 11, 9, 8] })).toContain("baseAbilities:rolled");
    expect(codes(fighter({ baseAbilities: { str: 15 } }))).toContain("baseAbilities:missing");
  });

  it("background bonuses: only its three abilities, +2/+1 or +1/+1/+1", () => {
    expect(codes(fighter({ backgroundBonuses: {} }))).toContain("backgroundBonuses:missing");
    expect(codes(fighter({ backgroundBonuses: { str: 2, wis: 1 } }))).toContain("backgroundBonuses:wrong_ability");
    expect(codes(fighter({ backgroundBonuses: { str: 2, con: 2 } }))).toContain("backgroundBonuses:pattern");
    expect(codes(fighter({ backgroundBonuses: { str: 1, dex: 1, con: 1 } }))).toEqual([]);
  });

  it("skills: count, offered options, and no repeat of a background skill", () => {
    expect(codes(fighter({ classSkills: ["Acrobatics"] }))).toContain("classSkills:count");
    expect(codes(fighter({ classSkills: ["Acrobatics", "Arcana"] }))).toContain("classSkills:not_offered");
    expect(codes(fighter({ classSkills: ["Acrobatics", "Athletics"] }))).toContain("classSkills:duplicate");
    expect(validateDraft(fighter({ classSkills: ["Acrobatics", "Athletics"] }), ctx()).errors.find((e) => e.code === "duplicate")!.message).toMatch(/Soldier background/);
  });

  it("species, class and background must be SRD (homebrew only when allowed and listed)", () => {
    expect(codes(fighter({ species: "Kender" }))).toContain("species:unknown");
    expect(codes(fighter({ speciesChoices: { size: "Medium", skillful: "Perception" } }))).toContain("speciesChoices.versatile:missing");
    expect(codes(fighter({ className: "Gunslinger" }))).toContain("className:unknown");
    expect(codes(fighter({ background: "Pirate" }))).toContain("background:unknown");
    const hb = validateDraft(fighter({ subclass: "Moonblade" }), ctx({ level: 3, allowHomebrew: true }));
    expect(hb.errors).toEqual([]);
    expect(hb.warnings.map((w) => w.code)).toContain("homebrew");
  });

  it("subclass: not before its level, required from it, SRD name", () => {
    expect(codes(fighter({ subclass: "Champion" }))).toContain("subclass:too_early");
    expect(codes(fighter(), { level: 3 })).toContain("subclass:missing");
    expect(codes(fighter({ subclass: "Battle Master" }), { level: 3 })).toContain("subclass:unknown");
  });

  it("ASIs: one per ASI level, +2 split or a General feat's +1", () => {
    const lvl4 = { level: 4 } as const;
    const base = fighter({ subclass: "Champion" });
    expect(codes(base, lvl4)).toContain("asi:missing");
    expect(codes({ ...base, asi: [{ feat: "Ability Score Improvement", increases: { str: 1 } }] }, lvl4)).toContain("asi.0:asi_split");
    expect(codes({ ...base, asi: [{ feat: "Ability Score Improvement", increases: { str: 2 } }] }, lvl4)).toEqual([]);
    expect(codes({ ...base, asi: [{ feat: "Grappler", increases: { wis: 1 } }] }, lvl4)).toContain("asi.0:feat_bonus");
    expect(codes({ ...base, asi: [{ feat: "Alert", increases: { dex: 1 } }] }, lvl4)).toContain("asi.0:feat_category");
    expect(codes({ ...base, baseAbilities: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 }, backgroundBonuses: { str: 2, con: 1 }, asi: [{ feat: "Ability Score Improvement", increases: { str: 2 } }] }, { level: 4 })).toEqual([]);
  });

  it("scores can't pass 20", () => {
    const c = fighter({ subclass: "Champion", backgroundBonuses: { str: 2, con: 1 }, asi: [{ feat: "Ability Score Improvement", increases: { str: 2 } }, { feat: "Ability Score Improvement", increases: { str: 2 } }] });
    expect(codes(c, { level: 6 })).toContain("baseAbilities:over_cap");
  });

  it("fighting style: required for a level 1 Fighter, an SRD Fighting Style feat", () => {
    expect(codes(fighter({ fightingStyle: undefined }))).toContain("fightingStyle:missing");
    expect(codes(fighter({ fightingStyle: "Alert" }))).toContain("fightingStyle:unknown");
  });

  it("spells: counts, class list, level and cantrip vs spell", () => {
    const cleric: CreationChoices = {
      name: "Bran",
      species: "Dwarf",
      className: "Cleric",
      background: "Acolyte",
      abilityMethod: "standard_array",
      baseAbilities: { str: 13, dex: 10, con: 14, int: 8, wis: 15, cha: 12 },
      backgroundBonuses: { wis: 2, cha: 1 },
      classSkills: ["History", "Medicine"],
      featPicks: { background: { cantrips: ["Guidance", "Spare the Dying"], spell: "Bless" } },
      cantrips: ["Sacred Flame", "Thaumaturgy", "Light"],
      spells: ["Cure Wounds", "Healing Word", "Shield of Faith", "Command"],
      classEquipment: "A",
      backgroundEquipment: "B",
      appearance: "Braided beard.",
    };
    expect(codes(cleric)).toEqual([]);
    expect(resolveChoices(cleric, ctx()).draft!.maxHp).toBe(8 + 2 + 1); // Dwarven Toughness
    expect(codes({ ...cleric, cantrips: ["Sacred Flame", "Thaumaturgy"] })).toContain("cantrips:too_few");
    expect(codes({ ...cleric, spells: ["Cure Wounds", "Magic Missile", "Shield of Faith", "Command"] })).toContain("spells:not_on_list");
    expect(codes({ ...cleric, spells: ["Cure Wounds", "Spiritual Weapon", "Shield of Faith", "Command"] })).toContain("spells:too_high");
    expect(codes({ ...cleric, spells: ["Cure Wounds", "Sacred Flame", "Shield of Faith", "Command"] })).toContain("spells:is_cantrip");
    expect(codes({ ...cleric, featPicks: { background: { cantrips: ["Fire Bolt", "Guidance"], spell: "Bless" } } })).toContain("featPicks.background:cantrip_list");
    expect(codes({ ...fighter(), cantrips: ["Light"] })).toContain("cantrips:none_allowed");
  });

  it("equipment must be one of the packages", () => {
    expect(codes(fighter({ classEquipment: undefined }))).toContain("classEquipment:missing");
    expect(codes(fighter({ backgroundEquipment: "C" }))).toContain("backgroundEquipment:invalid");
  });

  it("HP and AC overrides: warnings within reason, errors past what the rules allow", () => {
    const hp = validateDraft(fighter({ maxHpOverride: 11 }), ctx());
    expect(hp.errors).toEqual([]);
    expect(hp.warnings.map((w) => w.field)).toContain("maxHpOverride");
    expect(codes(fighter({ maxHpOverride: 40 }))).toContain("maxHpOverride:too_high");
    expect(codes(fighter({ acOverride: 25 }))).toContain("acOverride:too_high");
    expect(validateDraft(fighter({ acOverride: 18 }), ctx()).warnings.map((w) => w.field)).toContain("acOverride");
  });

  it("no draft without a name; the missing-name error", () => {
    const r = resolveChoices(fighter({ name: "" }), ctx());
    expect(r.draft).toBeUndefined();
    expect(r.errors.map((e) => e.field)).toContain("name");
  });
});

describe("rollAbilitySet", () => {
  it("six 4d6-drop-lowest totals, highest first", () => {
    let i = 0;
    const seq = [6, 6, 6, 1];
    const set = rollAbilitySet(() => seq[i++ % 4]!);
    expect(set).toEqual([18, 18, 18, 18, 18, 18]);
    const random = rollAbilitySet();
    expect(random).toHaveLength(6);
    for (const v of random) expect(v).toBeGreaterThanOrEqual(3);
    expect([...random].sort((a, b) => b - a)).toEqual(random);
  });
});

describe("resolveChoices: campaign character constraints", () => {
  const rats = CharacterConstraints.parse({
    allowedSpecies: ["Sewer Rat", "Human"],
    allowedClasses: ["Fighter", "Rogue"],
    customSpecies: [
      {
        name: "Sewer Rat",
        speed: 35,
        darkvision: 60,
        traits: [{ name: "Squeeze", text: "You can move through a space as narrow as 6 inches." }],
        choices: [{ key: "size", label: "Size", kind: "size", options: [{ name: "Small" }, { name: "Medium" }] }],
      },
    ],
  });
  // The service looks up custom species first (GameService.creationRules).
  const ratRules: CreationRules = { ...rules, species: (n) => findCustomSpecies(n, rats) ?? origins.species(n) };

  it("rejects a species the campaign doesn't allow", () => {
    expect(codes(fighter({ species: "Elf", speciesChoices: {} }), { constraints: rats })).toContain("species:species_not_allowed");
  });

  it("rejects a class the campaign doesn't allow", () => {
    expect(codes(fighter({ className: "Wizard" }), { constraints: rats })).toContain("className:class_not_allowed");
  });

  it("an allowed character passes", () => {
    expect(codes(fighter(), { constraints: rats })).toEqual([]);
  });

  it("a custom species resolves its speed, traits and choices", () => {
    const r = resolveChoices(fighter({ species: "Sewer Rat", speciesChoices: { size: "Small" }, featPicks: {} }), ctx({ constraints: rats, rules: ratRules }));
    expect(r.errors).toEqual([]);
    expect(r.draft!.species).toBe("Sewer Rat");
    expect(r.draft!.speed).toBe(35);
    expect(r.draft!.features).toContain("Squeeze");
    const missing = resolveChoices(fighter({ species: "Sewer Rat", speciesChoices: {} }), ctx({ constraints: rats, rules: ratRules }));
    expect(missing.errors.map((e) => `${e.field}:${e.code}`)).toContain("speciesChoices.size:missing");
  });
});
