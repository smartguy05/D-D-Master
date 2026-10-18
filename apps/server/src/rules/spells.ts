import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AbilityKey, CantripTier, SpellArea, SpellDamage, SpellIncrement, SpellInfo, SpellUpcast } from "@dm/shared";

/**
 * SRD spell catalog: parses `data/srd/spells.md` `#### Name` blocks into SpellInfo. A block is a
 * spell only if its first line is `_Level N School (Classes)_` or `_School Cantrip (Classes)_`;
 * this rejects rules sub-headings ("Spell Slots") and summoned-creature stat-block headings
 * ("Actions", "Traits").
 */

const ABILITY: Record<string, AbilityKey> = {
  strength: "str",
  dexterity: "dex",
  constitution: "con",
  intelligence: "int",
  wisdom: "wis",
  charisma: "cha",
};
const DAMAGE_TYPES = "Acid|Bludgeoning|Cold|Fire|Force|Lightning|Necrotic|Piercing|Poison|Psychic|Radiant|Slashing|Thunder";
const NUMBER: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const num = (w: string) => NUMBER[w.toLowerCase()] ?? parseInt(w, 10);

/** Strip markdown emphasis and HTML so text reads cleanly for the model. */
export function plainText(md: string): string {
  return md
    .replace(/<[^>]+>/g, " ")
    .replace(/\*\*|__|(?<![A-Za-z0-9])_|_(?![A-Za-z0-9])/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

export function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const stop = cut.lastIndexOf(". ");
  return stop > max * 0.5 ? cut.slice(0, stop + 1) : `${cut.trimEnd()}…`;
}

const field = (body: string, label: string) => new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)`).exec(body)?.[1].trim() ?? "";

/** Phrases that state a size limit ("no larger than a 5-foot Cube"), not an area of effect. */
const SIZE_LIMIT = /(?:no larger than|fit (?:in|within)|exceed \d+ contiguous)\s+(?:a |an )?$/i;

function parseArea(text: string): SpellArea | undefined {
  const found: { index: number; area: SpellArea }[] = [];
  const add = (re: RegExp, make: (m: RegExpMatchArray) => SpellArea) => {
    for (const m of text.matchAll(re)) {
      if (SIZE_LIMIT.test(text.slice(Math.max(0, m.index! - 40), m.index))) continue;
      found.push({ index: m.index!, area: make(m) });
    }
  };
  add(/(\d+)-foot-radius,\s*(\d+)-foot-high Cylinder/g, (m) => ({ shape: "cylinder", sizeFt: +m[1], heightFt: +m[2] }));
  add(/(\d+)-foot-long,\s*(\d+)-foot-wide Line/g, (m) => ({ shape: "line", sizeFt: +m[1], widthFt: +m[2] }));
  add(/Line (?:of [a-z ]+)?(\d+) feet long and (\d+) feet wide/g, (m) => ({ shape: "line", sizeFt: +m[1], widthFt: +m[2] }));
  add(/(\d+)-foot(?:-radius)? (Sphere|Cone|Cube|Emanation)/g, (m) => ({ shape: m[2].toLowerCase() as SpellArea["shape"], sizeFt: +m[1] }));
  found.sort((a, b) => a.index - b.index);
  return found[0]?.area;
}

const TYPES_RE = new RegExp(`\\b(${DAMAGE_TYPES})\\b`, "g");

function parseUpcast(text: string): SpellUpcast {
  const up: SpellUpcast = { text };
  const increments: SpellIncrement[] = [];
  let last = 0;
  for (const m of text.matchAll(/\bincreases? by (\d+(?:d\d+)?)/g)) {
    const clause = text.slice(last, m.index);
    last = m.index! + m[0].length;
    const dice = m[1];
    const lower = clause.toLowerCase();
    if (/healing and damage/.test(lower)) {
      up.appliesTo ??= "both";
      up.perLevelDice ??= dice;
      increments.push({ dice });
      continue;
    }
    if (/healing/.test(lower)) {
      up.appliesTo ??= "heal";
      up.perLevelDice ??= dice;
      continue;
    }
    if (!/damage|slam/.test(lower)) continue;
    up.appliesTo ??= "damage";
    up.perLevelDice ??= dice;
    const inc: SpellIncrement = { dice };
    const types = [...new Set([...clause.matchAll(TYPES_RE)].map((t) => t[1].toLowerCase()))];
    if (types.length) inc.types = types;
    if (/both initial and later|both types/.test(lower)) inc.roles = ["base", "or", "later"];
    else if (/initial/.test(lower)) inc.roles = ["base", "or"];
    increments.push(inc);
  }
  // Several untyped increases ("the damage the wall deals when it appears increases by 2d6 and the
  // damage from passing through … by 1d6") go to the damage entries in order.
  const untyped = increments.filter((i) => !i.types && !i.roles);
  if (untyped.length > 1) untyped.forEach((inc, i) => (inc.index = i));
  if (increments.length) up.damageIncrements = increments;
  const targets = /(?:target|affect) (one|two|three) additional [A-Za-z]+ for each spell slot level above/i.exec(text);
  if (targets) up.perLevelTargets = num(targets[1]);
  const proj = /(one|two) (?:more|additional) (?:dart|ray|beam)s? for each spell slot level above/i.exec(text);
  if (proj) up.perLevelProjectiles = num(proj[1]);
  return up;
}

function parseCantripScaling(text: string): { text: string; tiers: CantripTier[] } {
  const tiers: CantripTier[] = [];
  for (const m of text.matchAll(/(\d+) \((\d*d\d+)\)/g)) tiers.push({ level: +m[1], dice: m[2].replace(/^d/, "1d") });
  if (!tiers.length) {
    for (const m of text.matchAll(/(two|three|four) (?:beams|rays|darts) at level (\d+)/gi)) tiers.push({ level: +m[2], projectiles: num(m[1]) });
  }
  return { text, tiers };
}

/** Timing cues that make a later damage entry a separate, staged hit. */
const LATER_CUE =
  /\b(?:at the (?:end|start) of (?:each|its|your)|ends? its turn|first time|Turns? \d|later turns|each of (?:its|your) turns|later rounds)\b/i;

/**
 * Spells whose damage entries are mutually exclusive modes: Prismatic Spray (a d8 picks the ray),
 * Prismatic Wall (one entry per layer), Arcane Hand (Clenched Fist or Grasping Hand).
 */
const OPTION_SPELLS = /^(?:Prismatic Spray|Prismatic Wall|Arcane Hand)$/;

interface DamageHit {
  index: number;
  end: number;
  d: Omit<SpellDamage, "role">;
}

function parseDamage(name: string, main: string): SpellDamage[] {
  const hits: DamageHit[] = [];
  const push = (m: RegExpMatchArray, dice: string, type: string, addMod: boolean) => {
    const d: DamageHit["d"] = { dice: dice.replace(/\s+/g, ""), type: type.toLowerCase() };
    if (addMod) d.addMod = true;
    hits.push({ index: m.index!, end: m.index! + m[0].length, d });
  };
  for (const m of main.matchAll(new RegExp(`(\\d+d\\d+(?:\\s*\\+\\s*\\d+)?) (${DAMAGE_TYPES}) damage`, "g"))) push(m, m[1], m[2], false);
  const eq = new RegExp(`(${DAMAGE_TYPES}) damage (?:to the target )?equal to (\\d+d\\d+(?:\\s*\\+\\s*\\d+)?)( plus your spellcasting ability modifier)?`, "g");
  for (const m of main.matchAll(eq)) push(m, m[2], m[1], !!m[3]);
  if (!hits.length) {
    const base = /base damage is (\d+d\d+)/.exec(main);
    if (base) {
      const type = new RegExp(`(${DAMAGE_TYPES}) damage`).exec(main)?.[1] ?? "choice";
      push(base, base[1], type, false);
    }
  }
  if (!hits.length) {
    // "3d8 damage of the chosen type", "1d8 damage of a type you choose" …
    const any = /(\d+d\d+(?:\s*\+\s*\d+)?) damage/.exec(main);
    if (any) push(any, any[1], "choice", false);
  }
  hits.sort((a, b) => a.index - b.index);
  const unique = hits.filter((h, i) => hits.findIndex((x) => x.d.dice === h.d.dice && x.d.type === h.d.type) === i);

  const options = OPTION_SPELLS.test(name);
  return unique.map((h, i): SpellDamage => {
    if (i === 0) return { ...h.d, role: "base" };
    if (options) return { ...h.d, role: "or" }; // one ray/layer/hand applies per creature or turn
    const prev = unique[i - 1];
    const between = main.slice(prev.end, h.index);
    const after = main.slice(h.end).split(/[.!?](?:\s|$)/)[0];
    if (/\bor\b/.test(between) && !/[.!?]\s/.test(between)) return { ...h.d, role: "or" };
    if (LATER_CUE.test(between) || /\bat the (?:end|start) of\b/.test(after) || /\banother\s*$/.test(between)) return { ...h.d, role: "later" };
    return { ...h.d, role: "base" };
  });
}

/** The save the spell forces ("makes a / succeed on a Dexterity saving throw"); ignores "Advantage on … saving throws". */
function parseSave(main: string): AbilityKey | undefined {
  const m = /\b(?:makes?|make|succeeds?(?: on)?|fails?) (?:a|an|another) (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw/.exec(main);
  return m ? ABILITY[m[1].toLowerCase()] : undefined;
}

const STAT_LINE = /^\*\*(?:Casting Time|Range|Components|Duration):\*\*/;
const UPCAST_MARK = "_Using a Higher-Level Spell Slot._";
const CANTRIP_MARK = "_Cantrip Upgrade._";

/** Parse one `#### Name` block (body = everything after the heading line). Undefined if not a spell. */
export function parseSpellBlock(name: string, body: string): SpellInfo | undefined {
  const head = /^\s*_(?:Level (\d) ([A-Za-z]+)|([A-Za-z]+) Cantrip) \(([^)]+)\)_/.exec(body);
  if (!head) return undefined;
  const level = head[1] ? parseInt(head[1], 10) : 0;
  const school = head[2] ?? head[3];
  const classes = head[4].split(",").map((c) => c.trim());

  const castingTime = plainText(field(body, "Casting Time"));
  const duration = plainText(field(body, "Duration"));
  const range = plainText(field(body, "Range"));
  const components = plainText(field(body, "Components"));

  // Line by line: drop the level line and the **X:** stat lines; the upgrade markers start their
  // own sections even when the SRD has no blank line before them.
  const sections: Record<"main" | "upcast" | "cantrip", string[]> = { main: [], upcast: [], cantrip: [] };
  let section: keyof typeof sections = "main";
  for (const raw of body.slice(head.index + head[0].length).split("\n")) {
    const line = raw.trim();
    if (STAT_LINE.test(line)) continue;
    if (line.startsWith(UPCAST_MARK)) {
      section = "upcast";
      sections.upcast.push(line.slice(UPCAST_MARK.length));
      continue;
    }
    if (line.startsWith(CANTRIP_MARK)) {
      section = "cantrip";
      sections.cantrip.push(line.slice(CANTRIP_MARK.length));
      continue;
    }
    sections[section].push(raw);
  }
  const main = plainText(sections.main.join("\n"));

  const save = parseSave(main);
  const attack = /\b(melee|ranged) spell attack/i.exec(main);
  const damage = parseDamage(name, main);

  let heal: SpellInfo["heal"];
  const healMod = /regains? (?:a number of )?Hit Points equal to (\d+d\d+) plus your spellcasting ability modifier/.exec(main);
  const healFlat = /(?:regains?|restoring|restores?) (\d+(?:d\d+)?) Hit Points/.exec(main);
  if (healMod) heal = { dice: healMod[1], addMod: true };
  else if (healFlat) heal = { dice: healFlat[1], addMod: false };

  const projMatch = /\b(two|three|four|five) (?:glowing |fiery )?(?:darts|rays|beams)\b/i.exec(main);

  const spell: SpellInfo = {
    name,
    level,
    school,
    classes,
    castingTime,
    range,
    components,
    duration,
    concentration: /^Concentration/i.test(duration),
    ritual: /\bRitual\b/.test(castingTime),
    reaction: /^Reaction/.test(castingTime),
    bonusAction: /^Bonus Action/.test(castingTime),
    damage,
    summary: shorten(main, 300),
  };
  if (save) spell.save = save;
  if (attack) spell.attack = attack[1].toLowerCase() as "melee" | "ranged";
  if (heal) spell.heal = heal;
  const area = parseArea(main);
  if (area) spell.area = area;
  if (projMatch) spell.projectiles = num(projMatch[1]);
  if (sections.upcast.length) spell.upcast = parseUpcast(plainText(sections.upcast.join("\n")));
  if (sections.cantrip.length) {
    spell.cantripScaling = parseCantripScaling(plainText(sections.cantrip.join("\n")));
    if (spell.projectiles === undefined && spell.cantripScaling.tiers.some((t) => t.projectiles)) spell.projectiles = 1;
  }
  return spell;
}

/** Lookup key: lower case with apostrophes, punctuation and spaces removed ("Fire Ball" → "fireball"). */
export function spellKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Levenshtein distance (small strings only). */
export function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

const MIN_QUERY = 3;
const FUZZY_MIN = 5;
const FUZZY_MAX_DIST = 2;

export class SpellCatalog {
  private byName = new Map<string, SpellInfo>();

  load(srdDir: string) {
    const path = join(srdDir, "spells.md");
    if (!existsSync(path)) return;
    const md = readFileSync(path, "utf8").replace(/^﻿/, "");
    // Split at every h1–h4 so a summoned creature's `## Stat Block` doesn't leak into the spell body.
    for (const part of md.split(/^(?=#{1,4} )/m)) {
      const m = /^#### (.+)\n/.exec(part);
      if (!m) continue;
      const name = m[1].trim();
      const s = parseSpellBlock(name, part.slice(m[0].length));
      if (s) this.byName.set(spellKey(name), s);
    }
  }

  get size() {
    return this.byName.size;
  }

  names(): string[] {
    return [...this.byName.values()].map((s) => s.name);
  }

  /** Exact match on the normalised key only. */
  get(name: string): SpellInfo | undefined {
    return this.byName.get(spellKey(name));
  }

  /**
   * Strict lookup: exact key, then a *unique* prefix, then a *unique* spell within edit distance 2
   * (queries of 5+ characters). Ambiguous or too-short (<3) queries return undefined; use
   * candidates() to offer "did you mean …".
   */
  find(name: string): SpellInfo | undefined {
    const q = spellKey(name);
    if (q.length < MIN_QUERY) return undefined;
    const exact = this.byName.get(q);
    if (exact) return exact;
    const prefixed = [...this.byName].filter(([k]) => k.startsWith(q));
    if (prefixed.length === 1) return prefixed[0][1];
    if (prefixed.length > 1 || q.length < FUZZY_MIN) return undefined;
    const close = [...this.byName].filter(([k]) => editDistance(q, k) <= FUZZY_MAX_DIST);
    return close.length === 1 ? close[0][1] : undefined;
  }

  /** Up to `limit` nearest spell names: prefix matches, then contains, then by edit distance. */
  candidates(name: string, limit = 5): string[] {
    const q = spellKey(name);
    if (q.length < MIN_QUERY) return [];
    const maxDist = Math.max(FUZZY_MAX_DIST, Math.ceil(q.length / 2));
    const scored: { name: string; score: number }[] = [];
    for (const [k, s] of this.byName) {
      const score = k.startsWith(q) ? 0 : k.includes(q) ? 1 : 2 + editDistance(q, k);
      if (score < 2 || score - 2 <= maxDist) scored.push({ name: s.name, score });
    }
    scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
    return scored.slice(0, limit).map((s) => s.name);
  }
}
