import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AbilityKey, CantripTier, SpellArea, SpellDamage, SpellInfo, SpellUpcast } from "@dm/shared";

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

function parseArea(text: string): SpellArea | undefined {
  let m = /(\d+)-foot-radius,\s*(\d+)-foot-high Cylinder/.exec(text);
  if (m) return { shape: "cylinder", sizeFt: +m[1], heightFt: +m[2] };
  m = /(\d+)-foot-long,\s*(\d+)-foot-wide Line/.exec(text);
  if (m) return { shape: "line", sizeFt: +m[1], widthFt: +m[2] };
  m = /Line (?:of [a-z ]+)?(\d+) feet long and (\d+) feet wide/.exec(text);
  if (m) return { shape: "line", sizeFt: +m[1], widthFt: +m[2] };
  m = /(\d+)-foot(?:-radius)? (Sphere|Cone|Cube|Emanation)/.exec(text);
  if (m) return { shape: m[2].toLowerCase() as SpellArea["shape"], sizeFt: +m[1] };
  return undefined;
}

function parseUpcast(text: string): SpellUpcast {
  const up: SpellUpcast = { text };
  const dice = /(healing and damage|healing|damage)[^.]*?increases? by (\d+(?:d\d+)?)[^.]*?for (?:each|every) (?:spell )?slot level above/i.exec(text);
  if (dice) {
    up.perLevelDice = dice[2];
    up.appliesTo = dice[1].toLowerCase() === "healing" ? "heal" : dice[1].toLowerCase() === "damage" ? "damage" : "both";
  }
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

  // Description = paragraphs after the stat lines, split into the main text and the upgrade notes.
  const paras = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith("**Casting Time") && !p.startsWith("**Range") && !p.startsWith("**Components") && !p.startsWith("**Duration") && p !== head[0].trim());
  const upPara = paras.find((p) => p.startsWith("_Using a Higher-Level Spell Slot._"));
  const cantripPara = paras.find((p) => p.startsWith("_Cantrip Upgrade._"));
  const main = plainText(paras.filter((p) => p !== upPara && p !== cantripPara).join("\n\n"));

  const save = /(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw/.exec(main);
  const attack = /\b(melee|ranged) spell attack/i.exec(main);

  const damage: SpellDamage[] = [];
  const damageRe = new RegExp(`(\\d+d\\d+(?:\\s*\\+\\s*\\d+)?) (${DAMAGE_TYPES}) damage`, "g");
  for (const m of main.matchAll(damageRe)) {
    const d = { dice: m[1].replace(/\s+/g, ""), type: m[2].toLowerCase() };
    if (!damage.some((x) => x.dice === d.dice && x.type === d.type)) damage.push(d);
  }

  if (!damage.length) {
    // "3d8 damage of the chosen type", "1d8 damage of a type you choose" …
    const any = /(\d+d\d+(?:\s*\+\s*\d+)?) damage/.exec(main);
    if (any) damage.push({ dice: any[1].replace(/\s+/g, ""), type: "choice" });
  }

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
  if (save) spell.save = ABILITY[save[1].toLowerCase()];
  if (attack) spell.attack = attack[1].toLowerCase() as "melee" | "ranged";
  if (heal) spell.heal = heal;
  const area = parseArea(main);
  if (area) spell.area = area;
  if (projMatch) spell.projectiles = num(projMatch[1]);
  if (upPara) spell.upcast = parseUpcast(plainText(upPara.replace("_Using a Higher-Level Spell Slot._", "")));
  if (cantripPara) spell.cantripScaling = parseCantripScaling(plainText(cantripPara.replace("_Cantrip Upgrade._", "")));
  return spell;
}

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
      if (s) this.byName.set(key(name), s);
    }
  }

  get size() {
    return this.byName.size;
  }

  names(): string[] {
    return [...this.byName.values()].map((s) => s.name);
  }

  /** Exact (case/punctuation-insensitive) name. */
  get(name: string): SpellInfo | undefined {
    return this.byName.get(key(name));
  }

  /** Exact, then prefix, then contains. */
  find(name: string): SpellInfo | undefined {
    const q = key(name);
    if (!q) return undefined;
    const exact = this.byName.get(q);
    if (exact) return exact;
    for (const [k, v] of this.byName) if (k.startsWith(q)) return v;
    for (const [k, v] of this.byName) if (k.includes(q)) return v;
    return undefined;
  }
}

function key(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
