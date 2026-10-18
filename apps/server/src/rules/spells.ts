import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AbilityKey, CantripTier, DamageRole, SpellArea, SpellDamage, SpellIncrement, SpellInfo, SpellUpcast } from "@dm/shared";

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
  // Cylinders: "20-foot-radius, 40-foot-high", "50-foot-radius, 100-foot high", "40-foot-tall, 20-foot-radius",
  // "Cylinder that is 10 feet tall with a 60-foot radius"
  add(/(\d+)-foot-radius,\s*(\d+)[- ]foot[- ](?:high|tall) Cylinder/g, (m) => ({ shape: "cylinder", sizeFt: +m[1], heightFt: +m[2] }));
  add(/(\d+)[- ]foot[- ](?:high|tall),\s*(\d+)-foot-radius Cylinder/g, (m) => ({ shape: "cylinder", sizeFt: +m[2], heightFt: +m[1] }));
  add(/Cylinder that is (\d+) feet (?:tall|high) with an? (\d+)-foot radius/g, (m) => ({ shape: "cylinder", sizeFt: +m[2], heightFt: +m[1] }));
  // Lines: length first or width first
  add(/(\d+)-foot-long,\s*(\d+)-foot-wide Line/g, (m) => ({ shape: "line", sizeFt: +m[1], widthFt: +m[2] }));
  add(/(\d+)-foot-wide,\s*(\d+)-foot-long Line/g, (m) => ({ shape: "line", sizeFt: +m[2], widthFt: +m[1] }));
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
    // Default: every entry of the named types (or all entries). "The initial damage" leaves later hits alone.
    if (/\binitial\b/.test(lower) && !/\blater\b/.test(lower)) inc.roles = ["base", "or"];
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
  /** One entry, or several for a type list ("5d10 Radiant or Necrotic damage"): first + alternatives. */
  entries: Omit<SpellDamage, "role">[];
}

const DICE = "\\d+d\\d+(?:\\s*\\+\\s*\\d+)?";
const TYPE_SEP = /,\s*(?:or\s+)?|\s+or\s+/;

function parseDamage(name: string, main: string): SpellDamage[] {
  const hits: DamageHit[] = [];
  const push = (m: RegExpMatchArray, dice: string, types: string[], addMod = false) => {
    const entries = types.map((t) => {
      const d: Omit<SpellDamage, "role"> = { dice: dice.replace(/\s+/g, ""), type: t.toLowerCase() };
      if (addMod) d.addMod = true;
      return d;
    });
    hits.push({ index: m.index!, end: m.index! + m[0].length, entries });
  };
  // "8d6 Fire damage", "5d10 Radiant or Necrotic damage", "5d8 Acid, Cold, Fire, Lightning, or Thunder damage"
  const typed = new RegExp(`(${DICE}) ((?:${DAMAGE_TYPES})(?:(?:,\\s*(?:or\\s+)?|\\s+or\\s+)(?:${DAMAGE_TYPES}))*) damage`, "g");
  for (const m of main.matchAll(typed)) push(m, m[1], m[2].split(TYPE_SEP));
  // "Force damage equal to 1d8 plus your spellcasting ability modifier"
  const eq = new RegExp(`(${DAMAGE_TYPES}) damage (?:to the target )?equal to (${DICE})( plus your spellcasting ability modifier)?`, "g");
  for (const m of main.matchAll(eq)) push(m, m[2], [m[1]], !!m[3]);
  if (!hits.length) {
    const base = /base damage is (\d+d\d+)/.exec(main);
    if (base) push(base, base[1], [new RegExp(`(${DAMAGE_TYPES}) damage`).exec(main)?.[1] ?? "choice"]);
  }
  if (!hits.length) {
    // "3d8 damage of the chosen type", "4d8 damage of the spirit's type" …
    for (const m of main.matchAll(new RegExp(`(${DICE}) damage`, "g"))) push(m, m[1], ["choice"]);
  }
  if (!hits.length) {
    // flat damage without dice: "taking 20 Radiant damage"
    for (const m of main.matchAll(new RegExp(`(?<![\\dd])(\\d+) (${DAMAGE_TYPES}) damage`, "g"))) push(m, m[1], [m[2]]);
  }
  // Keep the first of any overlapping matches; equal dice+type at different places are separate hits.
  hits.sort((a, b) => a.index - b.index);
  const unique: DamageHit[] = [];
  for (const h of hits) if (!unique.length || h.index >= unique[unique.length - 1].end) unique.push(h);

  const options = OPTION_SPELLS.test(name);
  const out: SpellDamage[] = [];
  unique.forEach((h, i) => {
    let role: DamageRole = "base";
    if (i > 0 && options) role = "or"; // one ray/layer/hand applies per creature or turn
    else if (i > 0) {
      const between = main.slice(unique[i - 1].end, h.index);
      const after = main.slice(h.end).split(/[.!?](?:\s|$)/)[0];
      if (/\bor\b/.test(between) && !/[.!?]\s/.test(between)) role = "or";
      else if (LATER_CUE.test(between) || LATER_CUE.test(after) || /\bat the (?:end|start) of\b/.test(after)) role = "later";
    }
    h.entries.forEach((d, j) => out.push({ ...d, role: j === 0 ? role : "or" }));
  });
  return out;
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

/** Fuzzy tolerance: distance 1 for 5–7 character queries, 2 for 8+ ("links" must not become Blink). */
export function fuzzyDistanceFor(len: number): number {
  return len < FUZZY_MIN ? 0 : len < 8 ? 1 : 2;
}

/**
 * Older (pre-SRD) names → SRD 5.2.1 names. Every target is checked against the SRD in
 * spells.test.ts; an alias whose target is missing is ignored.
 */
export const SPELL_ALIASES: Record<string, string> = {
  "Melf's Acid Arrow": "Acid Arrow",
  "Tasha's Hideous Laughter": "Hideous Laughter",
  "Bigby's Hand": "Arcane Hand",
  "Bigby's Clenched Fist": "Arcane Hand",
  "Bigby's Forceful Hand": "Arcane Hand",
  "Bigby's Grasping Hand": "Arcane Hand",
  "Bigby's Interposing Hand": "Arcane Hand",
  "Mordenkainen's Sword": "Arcane Sword",
  "Mordenkainen's Faithful Hound": "Faithful Hound",
  "Mordenkainen's Private Sanctum": "Private Sanctum",
  "Mordenkainen's Magnificent Mansion": "Magnificent Mansion",
  "Otiluke's Resilient Sphere": "Resilient Sphere",
  "Otiluke's Freezing Sphere": "Freezing Sphere",
  "Leomund's Tiny Hut": "Tiny Hut",
  "Leomund's Secret Chest": "Secret Chest",
  "Evard's Black Tentacles": "Black Tentacles",
  "Nystul's Magic Aura": "Arcanist's Magic Aura",
  "Rary's Telepathic Bond": "Telepathic Bond",
  "Drawmij's Instant Summons": "Instant Summons",
  "Otto's Irresistible Dance": "Irresistible Dance",
  "Cure Light Wounds": "Cure Wounds",
};

/** Spoken-query cleanup: "the shield spell" → "shield". */
function cleanQuery(name: string): string {
  return name
    .trim()
    .replace(/^the\s+/i, "")
    .replace(/\s+spell$/i, "")
    .trim();
}

/** "Melf's acid arrow" → "acid arrow" (fallback when the possessive isn't a known alias). */
function stripPossessive(name: string): string | undefined {
  const m = /^[A-Za-z]+['’]s\s+(.+)$/.exec(name);
  return m?.[1];
}

export class SpellCatalog {
  private byName = new Map<string, SpellInfo>();
  /** alias key → SRD spell (only aliases whose target exists). */
  private aliases = new Map<string, SpellInfo>();

  load(srdDir: string) {
    const path = join(srdDir, "spells.md");
    if (!existsSync(path)) return;
    const md = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
    // Split at every h1–h4 so a summoned creature's `## Stat Block` doesn't leak into the spell body.
    for (const part of md.split(/^(?=#{1,4} )/m)) {
      const m = /^#### (.+)\n/.exec(part);
      if (!m) continue;
      const name = m[1].trim();
      const s = parseSpellBlock(name, part.slice(m[0].length));
      if (s) this.byName.set(spellKey(name), s);
    }
    for (const [alias, target] of Object.entries(SPELL_ALIASES)) {
      const s = this.byName.get(spellKey(target));
      if (s) this.aliases.set(spellKey(alias), s);
    }
  }

  get size() {
    return this.byName.size;
  }

  names(): string[] {
    return [...this.byName.values()].map((s) => s.name);
  }

  /** Alias pairs that resolved to an SRD spell. */
  aliasTargets(): Record<string, string> {
    return Object.fromEntries(
      Object.keys(SPELL_ALIASES)
        .filter((a) => this.aliases.has(spellKey(a)))
        .map((a) => [a, this.aliases.get(spellKey(a))!.name]),
    );
  }

  /** Exact match on the normalised key only (aliases included). */
  get(name: string): SpellInfo | undefined {
    const k = spellKey(name);
    return this.byName.get(k) ?? this.aliases.get(k);
  }

  /**
   * Strict lookup. The query is cleaned ("the … spell"), checked against the alias table, then
   * matched by exact key, a *unique* prefix, then a *unique* spell within the fuzzy distance
   * (1 for 5–7 characters, 2 for 8+). If that fails and the query starts with a possessive
   * ("Melf's …"), the rest is tried the same way. Ambiguous or too-short (<3) queries return
   * undefined; use candidates() to offer "did you mean …".
   */
  find(name: string): SpellInfo | undefined {
    const q = cleanQuery(name);
    const alias = this.aliases.get(spellKey(q));
    if (alias) return alias;
    const hit = this.match(q);
    if (hit) return hit;
    const rest = stripPossessive(q);
    return rest ? this.match(rest) : undefined;
  }

  private match(name: string): SpellInfo | undefined {
    const q = spellKey(name);
    if (q.length < MIN_QUERY) return undefined;
    const exact = this.byName.get(q);
    if (exact) return exact;
    const prefixed = [...this.byName].filter(([k]) => k.startsWith(q));
    if (prefixed.length === 1) return prefixed[0][1];
    const maxDist = fuzzyDistanceFor(q.length);
    if (prefixed.length > 1 || maxDist === 0) return undefined;
    const close = [...this.byName].filter(([k]) => editDistance(q, k) <= maxDist);
    return close.length === 1 ? close[0][1] : undefined;
  }

  /** Up to `limit` nearest spell names (aliases count): prefix matches, then contains, then by edit distance. */
  candidates(name: string, limit = 5): string[] {
    const cleaned = cleanQuery(name);
    const queries = [spellKey(cleaned), ...(stripPossessive(cleaned) ? [spellKey(stripPossessive(cleaned)!)] : [])].filter(
      (q) => q.length >= MIN_QUERY,
    );
    if (!queries.length) return [];
    const best = new Map<string, number>();
    const consider = (k: string, s: SpellInfo) => {
      for (const q of queries) {
        const maxDist = Math.max(2, Math.ceil(q.length / 2));
        const score = k === q ? -1 : k.startsWith(q) ? 0 : k.includes(q) ? 1 : 2 + editDistance(q, k);
        if (score >= 2 && score - 2 > maxDist) continue;
        if (score < (best.get(s.name) ?? Infinity)) best.set(s.name, score);
      }
    };
    for (const [k, s] of this.byName) consider(k, s);
    for (const [k, s] of this.aliases) consider(k, s);
    return [...best]
      .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([n]) => n);
  }
}
