import {
  ABILITY_KEYS,
  ABILITY_LABELS,
  abilityMod,
  checkConstraints,
  formatMod,
  MAGIC_INITIATE_LISTS,
  pointBuyCost,
  POINT_BUY_BUDGET,
  proficiencyBonusFor,
  rollNotation,
  SKILL_NAMES,
  skillName,
  STANDARD_ARRAY,
  type Abilities,
  type AbilityBonuses,
  type AbilityKey,
  type AbilityMethod,
  type ArmorInfo,
  type Attack,
  type BackgroundInfo,
  type CharacterConstraints,
  type ClassData,
  type CreationChoices,
  type CreationIssue,
  type CreationValidation,
  type FeatInfo,
  type FeatPicks,
  type Rng,
  type SpeciesInfo,
  type SpellInfo,
  type WeaponInfo,
} from "@dm/shared";
import type { CharacterDraft } from "../../brain/content.js";
import { defaultMaxHp } from "../builder.js";

/**
 * Phone character creation: the SRD check and the character build, both pure. The draft holds a
 * player's *choices*; resolveChoices checks every rule it can (ability method, background bonuses,
 * ASIs, skills, species choices, Origin feats, subclass level, spells, equipment, HP/AC overrides)
 * and derives the character (final scores, skills, spells, features, attacks, inventory, AC, HP).
 * Errors block joining (the host can still approve); warnings are advice. Messages are short and
 * say what to do, because both the player and the AI helper act on them.
 */

/** The SRD lookups resolveChoices needs (GameService passes its catalogs). */
export interface CreationRules {
  classData(name: string): ClassData | undefined;
  species(name: string): SpeciesInfo | undefined;
  background(name: string): BackgroundInfo | undefined;
  feat(name: string): FeatInfo | undefined;
  armor(name: string): ArmorInfo | undefined;
  weapon(name: string): WeaponInfo | undefined;
  /** Exact-or-fuzzy SRD spell lookup. */
  spell(name: string): SpellInfo | undefined;
  /** Spells on a class list (cantrips included). */
  classSpells(className: string): SpellInfo[];
  /** The name appears in the house rules (rules/custom). */
  isHomebrew(name: string): boolean;
}

export interface CreationContext {
  level: number;
  methods: AbilityMethod[];
  allowHomebrew: boolean;
  rolledScores?: number[];
  rules: CreationRules;
  /** The campaign's allowed species/classes: breaking them is an error (docs/gameplay/character-constraints.md). */
  constraints?: CharacterConstraints;
}

export interface Resolved extends CreationValidation {
  /** The character the choices build (undefined without a name). */
  draft?: Partial<CharacterDraft> & { name: string };
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const listText = (xs: readonly (string | number)[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} or ${xs.at(-1)}` : String(xs[0] ?? ""));
const sortedNums = (xs: number[]) => [...xs].sort((a, b) => b - a);
const label = (k: AbilityKey) => ABILITY_LABELS[k];

/** Six 4d6-drop-lowest scores, highest first (the "rolled" method; the server rolls them). */
export function rollAbilitySet(rng?: Rng): number[] {
  return sortedNums(Array.from({ length: 6 }, () => rollNotation("4d6kh3", rng).total));
}

class Issues {
  errors: CreationIssue[] = [];
  warnings: CreationIssue[] = [];
  error(field: string, code: string, message: string) {
    this.errors.push({ field, code, message });
  }
  warn(field: string, code: string, message: string) {
    this.warnings.push({ field, code, message });
  }
}

/** Remove values from a pool (multiset); false when one isn't there. */
function takeAll(pool: number[], values: number[]): boolean {
  const left = [...pool];
  for (const v of values) {
    const i = left.indexOf(v);
    if (i < 0) return false;
    left.splice(i, 1);
  }
  return true;
}

function sumBonuses(b: AbilityBonuses | undefined): number {
  return ABILITY_KEYS.reduce((n, k) => n + (b?.[k] ?? 0), 0);
}

function checkAbilities(c: CreationChoices, ctx: CreationContext, bg: BackgroundInfo | undefined, asiLevels: number[], out: Issues): Abilities | undefined {
  const method = c.abilityMethod ?? ctx.methods[0];
  if (!ctx.methods.includes(method)) out.error("abilityMethod", "method_not_allowed", `The host allows ${listText(ctx.methods.map(methodName))} for ability scores.`);
  const base = c.baseAbilities ?? {};
  const given = ABILITY_KEYS.filter((k) => base[k] !== undefined);
  const values = given.map((k) => base[k]!);
  if (given.length < 6) out.error("baseAbilities", "missing", `Set all six ability scores (missing ${given.length ? ABILITY_KEYS.filter((k) => base[k] === undefined).map(label).join(", ") : "all"}).`);
  if (method === "standard_array" && !takeAll([...STANDARD_ARRAY], values)) {
    out.error("baseAbilities", "standard_array", `Standard array: use each of ${STANDARD_ARRAY.join(", ")} exactly once.`);
  } else if (method === "point_buy") {
    const cost = pointBuyCost(base);
    if (Number.isNaN(cost)) out.error("baseAbilities", "point_buy_range", "Point buy: every score must be 8 to 15 before bonuses.");
    else if (cost > POINT_BUY_BUDGET) out.error("baseAbilities", "point_buy_over", `Point buy: ${cost} points spent, the budget is ${POINT_BUY_BUDGET}. Lower a score.`);
    else if (given.length === 6 && cost < POINT_BUY_BUDGET) out.warn("baseAbilities", "point_buy_left", `Point buy: ${POINT_BUY_BUDGET - cost} points left to spend.`);
  } else if (method === "rolled") {
    if (!ctx.rolledScores?.length) out.error("baseAbilities", "not_rolled", "Roll your ability scores first.");
    else if (!takeAll(ctx.rolledScores, values)) out.error("baseAbilities", "rolled", `Rolled scores: use each of ${ctx.rolledScores.join(", ")} exactly once.`);
  }

  // Background: +2/+1 or +1/+1/+1 among its three abilities.
  const bonus = c.backgroundBonuses ?? {};
  const used = ABILITY_KEYS.filter((k) => (bonus[k] ?? 0) > 0);
  if (bg) {
    const allowed = bg.abilities;
    const names = allowed.map(label).join(", ");
    const pattern = sortedNums(used.map((k) => bonus[k]!)).join(",");
    if (!used.length) out.error("backgroundBonuses", "missing", `Add your ${bg.name} bonus: +2 to one and +1 to another of ${names}, or +1 to all three.`);
    else if (used.some((k) => !allowed.includes(k))) out.error("backgroundBonuses", "wrong_ability", `${bg.name} bonuses go only to ${names}.`);
    else if (pattern !== "2,1" && pattern !== "1,1,1") out.error("backgroundBonuses", "pattern", `Background bonus: +2 and +1 on two different abilities, or +1 on all three of ${names}.`);
  }

  // Ability Score Improvements (and the feats taken instead).
  const asi = c.asi ?? [];
  if (asi.length < asiLevels.length) out.error("asi", "missing", `Choose your Ability Score Improvement for level ${asiLevels.slice(asi.length).join(", ")}.`);
  else if (asi.length > asiLevels.length) out.error("asi", "extra", `Only ${asiLevels.length} Ability Score Improvement${asiLevels.length === 1 ? "" : "s"} at level ${ctx.level}.`);
  let epic = false;
  asi.slice(0, asiLevels.length).forEach((pick, i) => {
    const at = asiLevels[i];
    const feat = ctx.rules.feat(pick.feat);
    const field = `asi.${i}`;
    const total = sumBonuses(pick.increases);
    if (!feat) {
      if (ctx.allowHomebrew && ctx.rules.isHomebrew(pick.feat)) out.warn(field, "homebrew", `${pick.feat} is homebrew: check its bonuses with the host.`);
      else out.error(field, "unknown_feat", `Level ${at}: "${pick.feat}" isn't an SRD feat. Take Ability Score Improvement or a General feat.`);
      return;
    }
    const okCategory = feat.category === "general" || (at >= 19 && feat.category === "epic");
    if (!okCategory) out.error(field, "feat_category", `Level ${at}: ${feat.name} can't be taken here; take Ability Score Improvement or a General feat${at >= 19 ? " or an Epic Boon" : ""}.`);
    if (feat.category === "epic") epic = true;
    if (feat.name === "Ability Score Improvement") {
      if (total !== 2 || ABILITY_KEYS.some((k) => (pick.increases?.[k] ?? 0) > 2)) out.error(field, "asi_split", `Level ${at}: Ability Score Improvement is +2 to one score or +1 to two.`);
    } else if (total !== 1) {
      out.error(field, "feat_bonus", `Level ${at}: ${feat.name} gives +1 to ${feat.abilities?.length ? listText(feat.abilities.map(label)) : "one score"}.`);
    } else if (feat.abilities?.length && ABILITY_KEYS.some((k) => (pick.increases?.[k] ?? 0) > 0 && !feat.abilities!.includes(k))) {
      out.error(field, "feat_bonus", `Level ${at}: ${feat.name}'s +1 goes to ${listText(feat.abilities.map(label))}.`);
    }
  });
  if (given.length < 6) return undefined;

  const final = {} as Abilities;
  for (const k of ABILITY_KEYS) {
    final[k] = base[k]! + (bonus[k] ?? 0) + asi.slice(0, asiLevels.length).reduce((n, p) => n + (p.increases?.[k] ?? 0), 0);
    const cap = epic ? 30 : 20;
    if (final[k] > cap) out.error("baseAbilities", "over_cap", `${label(k)} would be ${final[k]}; scores can't go above ${cap}.`);
  }
  return final;
}

const methodName = (m: AbilityMethod) => (m === "standard_array" ? "the standard array" : m === "point_buy" ? "point buy" : "rolled scores");

interface SpellPick {
  name: string;
  source: string;
}

/** Magic Initiate / Skilled picks for one feat source. Returns the spells and skills it adds. */
function checkFeat(featName: string, source: "background" | "species", picks: FeatPicks | undefined, ctx: CreationContext, out: Issues, otherList?: string) {
  const spells: SpellPick[] = [];
  const skills: string[] = [];
  const field = `featPicks.${source}`;
  const base = featName.replace(/\s*\([^)]*\)\s*$/, "");
  const fixedList = /\(([^)]+)\)\s*$/.exec(featName)?.[1];
  if (sameName(base, "Magic Initiate")) {
    const list = fixedList ?? picks?.list;
    if (!list || !MAGIC_INITIATE_LISTS.some((l) => sameName(l, list))) {
      out.error(field, "list", `Magic Initiate: pick the Cleric, Druid or Wizard spell list.`);
      return { spells, skills, list };
    }
    if (otherList && sameName(otherList, list)) out.error(field, "list_repeat", `Magic Initiate again: pick a different spell list than ${otherList}.`);
    const cantrips = picks?.cantrips ?? [];
    if (cantrips.length !== 2) out.error(field, "cantrips", `Magic Initiate (${list}): pick 2 ${list} cantrips${cantrips.length ? ` (${cantrips.length} picked)` : ""}.`);
    for (const name of cantrips) {
      const s = ctx.rules.spell(name);
      if (!s || s.level !== 0 || !s.classes.some((c) => sameName(c, list))) out.error(field, "cantrip_list", `Magic Initiate: ${name} isn't a ${list} cantrip.`);
      else spells.push({ name: s.name, source: `Magic Initiate (${list})` });
    }
    const spell = picks?.spell?.trim();
    if (!spell) out.error(field, "spell", `Magic Initiate (${list}): pick one level 1 ${list} spell.`);
    else {
      const s = ctx.rules.spell(spell);
      if (!s || s.level !== 1 || !s.classes.some((c) => sameName(c, list))) out.error(field, "spell_list", `Magic Initiate: ${spell} isn't a level 1 ${list} spell.`);
      else spells.push({ name: s.name, source: `Magic Initiate (${list})` });
    }
    return { spells, skills, list };
  }
  if (sameName(base, "Skilled")) {
    const picked = picks?.skills ?? [];
    if (picked.length !== 3) out.error(field, "skilled", `Skilled: pick 3 skills or tools${picked.length ? ` (${picked.length} picked)` : ""}.`);
    for (const p of picked) skills.push(skillName(p) ?? p.trim());
  }
  return { spells, skills, list: undefined };
}

function bestArmorClass(abilities: Abilities, items: string[], cls: ClassData | undefined, rules: CreationRules, defense: boolean): { ac: number; armor?: string; shield: boolean } {
  const dex = abilityMod(abilities.dex);
  const trained = new Set(cls?.armorTraining ?? []);
  const armors = items.map((n) => rules.armor(n)).filter((a): a is ArmorInfo => !!a);
  const shield = armors.some((a) => a.category === "shield") && trained.has("shield");
  const options: { ac: number; armor?: string; shield: boolean }[] = [];
  const unarmored = 10 + dex;
  const name = cls?.name.toLowerCase();
  if (name === "barbarian") options.push({ ac: unarmored + abilityMod(abilities.con) + (shield ? 2 : 0), shield });
  else if (name === "monk") options.push({ ac: unarmored + abilityMod(abilities.wis), shield: false });
  options.push({ ac: unarmored + (shield ? 2 : 0), shield });
  for (const a of armors) {
    if (a.category === "shield" || !trained.has(a.category)) continue;
    const dexPart = a.dexCap === undefined ? dex : Math.min(dex, a.dexCap);
    options.push({ ac: a.base + dexPart + (shield ? 2 : 0) + (defense ? 1 : 0), armor: a.name, shield });
  }
  return options.reduce((best, o) => (o.ac > best.ac ? o : best));
}

function weaponAttack(w: WeaponInfo, abilities: Abilities, pb: number, cls: ClassData | undefined, archery: boolean): Attack {
  const str = abilityMod(abilities.str);
  const dex = abilityMod(abilities.dex);
  const mod = w.ranged ? dex : w.finesse ? Math.max(str, dex) : str;
  const prof = cls?.weaponProficiency;
  const proficient = !prof
    ? false
    : w.category === "simple"
      ? prof.simple
      : prof.martial === true || (Array.isArray(prof.martial) && prof.martial.some((p) => w.properties.some((x) => x.toLowerCase().startsWith(p.toLowerCase()))));
  const toHit = mod + (proficient ? pb : 0) + (archery && w.ranged ? 2 : 0);
  const dmg = mod ? `${w.dice}${mod > 0 ? "+" : ""}${mod}` : w.dice;
  return { name: w.name, toHit, damage: `${dmg} ${w.damageType.toLowerCase()}`, ...(w.properties.length ? { description: w.properties.join(", ") } : {}) };
}

/** Check the choices and build the character they describe. */
export function resolveChoices(c: CreationChoices, ctx: CreationContext): Resolved {
  const out = new Issues();
  const { rules, level } = ctx;
  const pb = proficiencyBonusFor(level);
  const homebrewOk = (name: string) => ctx.allowHomebrew && rules.isHomebrew(name);

  const name = c.name?.trim() ?? "";
  if (!name) out.error("name", "missing", "Give your character a name.");

  // ---- species ----
  const speciesName = c.species?.trim() ?? "";
  const species = speciesName ? rules.species(speciesName) : undefined;
  if (!speciesName) out.error("species", "missing", "Pick a species.");
  else if (!species) {
    if (homebrewOk(speciesName)) out.warn("species", "homebrew", `${speciesName} is homebrew: its traits aren't checked.`);
    else out.error("species", "unknown", `${speciesName} isn't an SRD species.`);
  }
  for (const issue of checkConstraints({ species: speciesName }, ctx.constraints)) out.error(issue.field, issue.code, issue.message);
  const speciesPicks: Record<string, string> = {};
  for (const choice of species?.choices ?? []) {
    const picked = c.speciesChoices?.[choice.key];
    const opt = picked ? choice.options.find((o) => sameName(o.name, picked)) : undefined;
    if (!opt) out.error(`speciesChoices.${choice.key}`, picked ? "invalid" : "missing", `${species!.name}: choose your ${choice.label} (${listText(choice.options.slice(0, 8).map((o) => o.name))}${choice.options.length > 8 ? ", …" : ""}).`);
    else speciesPicks[choice.key] = opt.name;
  }
  const speciesOptions = (species?.choices ?? []).filter((ch) => ch.kind === "option").map((ch) => ch.options.find((o) => o.name === speciesPicks[ch.key])).filter((o) => !!o);

  // ---- class and subclass ----
  const className = c.className?.trim() ?? "";
  const cls = className ? rules.classData(className) : undefined;
  if (!className) out.error("className", "missing", "Pick a class.");
  else if (!cls) {
    if (homebrewOk(className)) out.warn("className", "homebrew", `${className} is homebrew: its features and spells aren't checked.`);
    else out.error("className", "unknown", `${className} isn't an SRD class.`);
  }
  for (const issue of checkConstraints({ className }, ctx.constraints)) out.error(issue.field, issue.code, issue.message);
  const row = cls?.levels.find((l) => l.level === level);
  const subclass = c.subclass?.trim() ?? "";
  if (cls?.subclassLevel) {
    if (level < cls.subclassLevel && subclass) out.error("subclass", "too_early", `${cls.name}s choose a subclass at level ${cls.subclassLevel}; leave it empty for now.`);
    else if (level >= cls.subclassLevel && !subclass) out.error("subclass", "missing", `Choose your ${cls.name} subclass${cls.subclass ? ` (SRD: ${cls.subclass.name})` : ""}.`);
    else if (subclass && cls.subclass && !sameName(subclass, cls.subclass.name)) {
      if (homebrewOk(subclass)) out.warn("subclass", "homebrew", `${subclass} is homebrew: its features aren't checked.`);
      else out.error("subclass", "unknown", `The SRD ${cls.name} subclass is ${cls.subclass.name}.`);
    }
  }

  // ---- background ----
  const bgName = c.background?.trim() ?? "";
  const bg = bgName ? rules.background(bgName) : undefined;
  if (!bgName) out.error("background", "missing", "Pick a background.");
  else if (!bg) {
    if (homebrewOk(bgName)) out.warn("background", "homebrew", `${bgName} is homebrew: give its bonuses and skills with the host.`);
    else out.error("background", "unknown", `${bgName} isn't an SRD background.`);
  }

  // ---- ability scores ----
  const asiLevels = (cls?.asiLevels ?? []).filter((l) => l <= level);
  const abilities = checkAbilities(c, ctx, bg, asiLevels, out);

  // ---- feats from origins ----
  const originSpells: SpellPick[] = [];
  const featSkills: string[] = [];
  const featNames: string[] = [];
  let bgList: string | undefined;
  if (bg?.feat) {
    const r = checkFeat(bg.feat, "background", c.featPicks?.background, ctx, out);
    originSpells.push(...r.spells);
    featSkills.push(...r.skills);
    bgList = r.list;
    featNames.push(bg.feat);
  }
  const versatileKey = species?.choices.find((ch) => ch.kind === "feat")?.key;
  const versatile = versatileKey ? speciesPicks[versatileKey] : undefined;
  if (versatile) {
    const bgFeat = bg?.feat.replace(/\s*\([^)]*\)\s*$/, "");
    const feat = rules.feat(versatile);
    if (bgFeat && sameName(bgFeat, versatile) && !feat?.repeatable) out.error(`speciesChoices.${versatileKey}`, "feat_repeat", `You already have ${versatile} from your background; pick another Origin feat.`);
    const r = checkFeat(versatile, "species", c.featPicks?.species, ctx, out, bgList);
    originSpells.push(...r.spells);
    featSkills.push(...r.skills);
    featNames.push(r.list ? `${versatile} (${r.list})` : versatile);
  }

  // ---- fighting style ----
  const classFeatures = (cls?.levels ?? []).filter((l) => l.level <= level).flatMap((l) => l.features);
  const hasStyle = classFeatures.some((f) => sameName(f, "Fighting Style"));
  const style = c.fightingStyle?.trim();
  const styleFeat = style ? rules.feat(style) : undefined;
  if (hasStyle && !style) out.error("fightingStyle", "missing", "Choose a Fighting Style feat (Archery, Defense, Great Weapon Fighting or Two-Weapon Fighting).");
  else if (style && !hasStyle) out.error("fightingStyle", "not_yet", `${cls?.name ?? "Your class"} doesn't have Fighting Style at level ${level}.`);
  else if (style && styleFeat?.category !== "fighting_style" && !homebrewOk(style)) out.error("fightingStyle", "unknown", `${style} isn't a Fighting Style feat.`);

  // ---- skills ----
  const fixedSkills = new Map<string, string>(); // skill -> where it comes from
  for (const s of bg?.skills ?? []) fixedSkills.set(s, `your ${bg!.name} background`);
  for (const ch of species?.choices ?? []) if (ch.kind === "skill" && speciesPicks[ch.key]) fixedSkills.set(speciesPicks[ch.key], `your ${ch.label}`);
  for (const s of featSkills) if (skillName(s)) fixedSkills.set(skillName(s)!, "a feat");
  const picks = (c.classSkills ?? []).map((s) => skillName(s) ?? s.trim());
  const choice = cls?.skillChoices;
  if (choice) {
    const options = choice.options === "any" ? SKILL_NAMES : choice.options;
    if (picks.length !== choice.count) out.error("classSkills", "count", `Pick ${choice.count} ${cls!.name} skills from: ${listText(options)}${picks.length ? ` (${picks.length} picked)` : ""}.`);
    const seen = new Set<string>();
    for (const p of picks) {
      if (!options.some((o) => sameName(o, p))) out.error("classSkills", "not_offered", `${p} isn't a ${cls!.name} skill choice.`);
      else if (fixedSkills.has(p)) out.error("classSkills", "duplicate", `You already have ${p} from ${fixedSkills.get(p)}; pick another skill.`);
      else if (seen.has(p)) out.error("classSkills", "duplicate", `${p} is picked twice.`);
      seen.add(p);
    }
  }
  const skills = [...new Set([...fixedSkills.keys(), ...picks])];

  // ---- spells ----
  const cantripsWanted = row?.cantrips ?? 0;
  const preparedWanted = row?.preparedSpells ?? 0;
  const maxSpellLevel = row?.pact ? row.pact.slotLevel : (row?.slots.length ?? 0);
  const onList = (s: SpellInfo) => !!cls && s.classes.some((x) => sameName(x, cls.name));
  const classSpells: string[] = [];
  const checkSpells = (names: string[], kind: "cantrips" | "spells", wanted: number) => {
    const seen = new Set<string>();
    for (const n of names) {
      const s = rules.spell(n);
      if (!s) {
        if (homebrewOk(n)) out.warn(kind, "homebrew", `${n} is a homebrew spell: not checked.`);
        else out.error(kind, "unknown", `${n} isn't an SRD spell.`);
        continue;
      }
      if (seen.has(s.name)) out.error(kind, "duplicate", `${s.name} is picked twice.`);
      seen.add(s.name);
      if (kind === "cantrips" && s.level !== 0) out.error(kind, "not_cantrip", `${s.name} is a level ${s.level} spell, not a cantrip.`);
      else if (kind === "spells" && s.level === 0) out.error(kind, "is_cantrip", `${s.name} is a cantrip: pick it under cantrips.`);
      else if (kind === "spells" && s.level > maxSpellLevel) out.error(kind, "too_high", `${s.name} is level ${s.level}; at level ${level} you cast up to level ${maxSpellLevel}.`);
      else if (cls && !onList(s)) out.error(kind, "not_on_list", `${s.name} isn't on the ${cls.name} spell list.`);
      else if (originSpells.some((o) => o.name === s.name)) out.warn(kind, "origin_duplicate", `You already know ${s.name} from ${originSpells.find((o) => o.name === s.name)!.source}; pick another.`);
      classSpells.push(s.name);
    }
    if (!cls) return;
    if (!wanted && names.length) out.error(kind, "none_allowed", `A level ${level} ${cls.name} has no ${kind === "cantrips" ? "cantrips" : "prepared spells"}.`);
    else if (names.length < wanted) out.error(kind, "too_few", `Pick ${wanted - names.length} more ${kind === "cantrips" ? `${cls.name} cantrip` : `${cls.name} spell`}${wanted - names.length === 1 ? "" : "s"} (${wanted} in all${kind === "spells" ? `, up to level ${maxSpellLevel}` : ""}).`);
    else if (names.length > wanted) out.error(kind, "too_many", `A level ${level} ${cls.name} has ${wanted} ${kind === "cantrips" ? "cantrips" : "prepared spells"}; remove ${names.length - wanted}.`);
  };
  checkSpells(c.cantrips ?? [], "cantrips", cantripsWanted);
  checkSpells(c.spells ?? [], "spells", preparedWanted);
  const speciesSpells = [
    ...(species?.cantrips ?? []),
    ...speciesOptions.flatMap((o) => [...(o.cantrips ?? []), ...(o.spells ?? []).filter((s) => s.level <= level).map((s) => s.name)]),
  ].map((n) => rules.spell(n)?.name ?? n);

  // ---- equipment ----
  const items: { name: string; qty: number }[] = [];
  let gold = 0;
  const pickPackage = (options: { letter: string; items: { name: string; qty: number }[]; gold: number }[] | undefined, letter: string | undefined, field: string, owner: string) => {
    if (!options?.length) return;
    const opt = letter ? options.find((o) => sameName(o.letter, letter)) : undefined;
    if (!opt) {
      out.error(field, letter ? "invalid" : "missing", `Choose your ${owner} starting equipment: ${options.map((o) => `${o.letter}) ${[...o.items.map((i) => (i.qty > 1 ? `${i.name} ×${i.qty}` : i.name)), ...(o.gold ? [`${o.gold} GP`] : [])].join(", ")}`).join("; ")}.`);
      return;
    }
    for (const it of opt.items) {
      const have = items.find((x) => sameName(x.name, it.name));
      if (have) have.qty += it.qty;
      else items.push({ ...it });
    }
    gold += opt.gold;
  };
  pickPackage(cls?.equipment, c.classEquipment, "classEquipment", cls?.name ?? "class");
  pickPackage(bg?.equipment, c.backgroundEquipment, "backgroundEquipment", bg?.name ?? "background");

  // ---- personality (advice only) ----
  if (!c.appearance?.trim()) out.warn("appearance", "missing", "Describe how your character looks: it's used to draw the portrait.");

  if (!name || !abilities) return { ok: out.errors.length === 0, errors: out.errors, warnings: out.warnings };

  // ---- derived numbers ----
  const toughness = species && sameName(species.name, "Dwarf") ? level : 0;
  const hp = className ? defaultMaxHp(className, level, abilities.con) + toughness : 0;
  const hitDie = cls?.hitDie ?? 8;
  const hpCeiling = hitDie * level + abilityMod(abilities.con) * level + toughness;
  let maxHp = hp;
  if (c.maxHpOverride !== undefined) {
    if (c.maxHpOverride > hpCeiling && !ctx.allowHomebrew) out.error("maxHpOverride", "too_high", `Max HP ${c.maxHpOverride} is more than a level ${level} ${className} can have (${hpCeiling}).`);
    else if (c.maxHpOverride !== hp) out.warn("maxHpOverride", "custom", `Custom max HP ${c.maxHpOverride} (the fixed value is ${hp}).`);
    maxHp = c.maxHpOverride;
  }
  const defense = styleFeat?.name === "Defense";
  const armor = bestArmorClass(abilities, items.map((i) => i.name), cls, rules, defense);
  let ac = armor.ac;
  if (c.acOverride !== undefined) {
    if (c.acOverride > armor.ac + 2 && !ctx.allowHomebrew) out.error("acOverride", "too_high", `AC ${c.acOverride} is more than your gear gives (${armor.ac}).`);
    else if (c.acOverride !== armor.ac) out.warn("acOverride", "custom", `Custom AC ${c.acOverride} (your gear gives ${armor.ac}).`);
    ac = c.acOverride;
  }
  const speed = speciesOptions.find((o) => o.speed)?.speed ?? species?.speed ?? 30;
  const archery = styleFeat?.name === "Archery";
  const attacks: Attack[] = [];
  for (const it of items) {
    const w = rules.weapon(it.name);
    if (w && !attacks.some((a) => a.name === w.name)) attacks.push(weaponAttack(w, abilities, pb, cls, archery));
  }

  // ---- features and notes ----
  const features: string[] = [];
  for (const t of species?.traits ?? []) {
    const ch = species!.choices.find((x) => sameName(x.label, t.name) || x.key === t.name.toLowerCase().replace(/[^a-z0-9]+/g, "_"));
    features.push(ch && speciesPicks[ch.key] ? `${t.name} (${speciesPicks[ch.key]})` : t.name);
  }
  features.push(...featNames);
  for (const f of classFeatures) {
    if (f === "Ability Score Improvement" || f === "Subclass feature" || f === "Epic Boon") continue;
    if (/ Subclass$/.test(f)) features.push(subclass ? `Subclass: ${subclass}` : f);
    else if (sameName(f, "Fighting Style") && style) features.push(`Fighting Style: ${style}`);
    else features.push(f);
  }
  if (cls?.subclass && sameName(subclass, cls.subclass.name)) for (const f of cls.subclass.features) if (f.level <= level) features.push(`${cls.subclass.name}: ${f.name}`);
  for (const pick of (c.asi ?? []).slice(0, asiLevels.length)) if (pick.feat !== "Ability Score Improvement") features.push(pick.feat);

  const notes: string[] = [];
  if (bg?.tool) notes.push(`Tool: ${bg.tool}.`);
  if (featSkills.some((s) => !skillName(s))) notes.push(`Skilled tools: ${featSkills.filter((s) => !skillName(s)).join(", ")}.`);
  const abilityPicks = (species?.choices ?? []).filter((ch) => ch.kind === "ability" && speciesPicks[ch.key]);
  for (const ch of abilityPicks) notes.push(`${ch.label}: ${speciesPicks[ch.key]}.`);
  const sizePick = speciesPicks.size;
  if (sizePick) notes.push(`Size: ${sizePick}.`);
  notes.push("Languages: Common and two more of your choice.");

  const spells = [...new Set([...speciesSpells, ...originSpells.map((s) => s.name), ...classSpells])];
  const draft: Partial<CharacterDraft> & { name: string } = {
    name,
    species: species?.name ?? speciesName,
    className: cls?.name ?? className,
    subclass: level >= (cls?.subclassLevel ?? 1) ? subclass : "",
    level,
    background: bg?.name ?? bgName,
    abilities,
    maxHp: Math.max(1, maxHp),
    ac,
    speed,
    proficiencyBonus: pb,
    skills,
    savingThrows: cls?.savingThrows ?? [],
    attacks,
    spells,
    features,
    inventory: items.map((i) => ({ id: "", name: i.name, qty: i.qty, ...(i.name === armor.armor || (armor.shield && i.name === "Shield") ? { equipped: true } : {}) })),
    gold,
    notes: notes.join(" "),
    appearance: c.appearance?.trim() ?? "",
    backstory: c.backstory?.trim() ?? "",
    personality: c.personality?.trim() ?? "",
    ideals: c.ideals?.trim() ?? "",
    bonds: c.bonds?.trim() ?? "",
    flaws: c.flaws?.trim() ?? "",
    diceMode: c.diceMode ?? "virtual",
  };
  return { ok: out.errors.length === 0, errors: out.errors, warnings: out.warnings, draft };
}

export function validateDraft(c: CreationChoices, ctx: CreationContext): CreationValidation {
  const { ok, errors, warnings } = resolveChoices(c, ctx);
  return { ok, errors, warnings };
}

/** One line per derived number for the AI helper ("AC 16 (Chain Mail), HP 12, Longsword +5 …"). */
export function derivedSummary(d: Resolved["draft"]): string {
  if (!d) return "";
  const a = d.abilities!;
  const scores = ABILITY_KEYS.map((k) => `${k.toUpperCase()} ${a[k]} (${formatMod(abilityMod(a[k]))})`).join(", ");
  const attacks = (d.attacks ?? []).map((x) => `${x.name} ${formatMod(x.toHit ?? 0)} ${x.damage ?? ""}`.trim()).join("; ");
  return `${scores}; AC ${d.ac}; max HP ${d.maxHp}; speed ${d.speed}; skills ${(d.skills ?? []).join(", ") || "-"}; spells ${(d.spells ?? []).join(", ") || "-"}${attacks ? `; attacks ${attacks}` : ""}`;
}
