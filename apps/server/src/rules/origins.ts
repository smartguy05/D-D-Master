import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SKILL_NAMES, skillName, type AbilityKey, type BackgroundInfo, type FeatInfo, type SpeciesChoice, type SpeciesInfo, type SpeciesOption } from "@dm/shared";
import { parseEquipmentOptions } from "./equipment.js";
import { plainText } from "./spells.js";

/**
 * SRD character origins for phone character creation: backgrounds and species from
 * `data/srd/character-origins.md`, feats from `data/srd/feats.md`. Species traits that make the
 * player choose something (a lineage table, "Choose one of the following", a size, a skill, an
 * Origin feat, a spellcasting ability) become SpeciesChoice entries the validator checks.
 */

const ABILITY: Record<string, AbilityKey> = { strength: "str", dexterity: "dex", constitution: "con", intelligence: "int", wisdom: "wis", charisma: "cha" };
const FEAT_CATEGORY: Record<string, FeatInfo["category"]> = { "origin feats": "origin", "general feats": "general", "fighting style feats": "fighting_style", "epic boon feats": "epic" };

const key = (name: string) => name.trim().toLowerCase().replace(/[‘’]/g, "'");
const slug = (name: string) => key(name).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const field = (body: string, label: string) => {
  const m = new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)`).exec(body);
  return m ? plainText(m[1]).trim() : "";
};
const abilityList = (text: string) =>
  text
    .split(/,|\bor\b|\band\b/)
    .map((s) => ABILITY[s.trim().toLowerCase()])
    .filter((a): a is AbilityKey => !!a);

/** `## Heading` / `#### Heading` sections: [title, body]. */
function sections(md: string, level: number): [string, string][] {
  const hashes = "#".repeat(level);
  const out: [string, string][] = [];
  for (const part of md.split(new RegExp(`^(?=${hashes} )`, "m"))) {
    const m = new RegExp(`^${hashes} (.+)\\n`).exec(part);
    if (m) out.push([m[1].trim(), part.slice(m[0].length)]);
  }
  return out;
}

export function parseBackground(name: string, body: string): BackgroundInfo {
  return {
    name,
    abilities: abilityList(field(body, "Ability Scores")),
    feat: field(body, "Feat").replace(/\s*\(see "[^"]*"\)\s*$/, ""),
    skills: field(body, "Skill Proficiencies")
      .split(/\band\b|,/)
      .map((s) => skillName(s) ?? s.trim())
      .filter(Boolean),
    tool: field(body, "Tool Proficiency").replace(/\s*\(see "[^"]*"\)\s*$/, ""),
    equipment: parseEquipmentOptions(field(body, "Equipment")),
  };
}

/** "know the Dancing Lights cantrip" / "know the _Mending_ and _Prestidigitation_ cantrips". */
function cantripsIn(text: string): string[] {
  const m = /know the (.+?) cantrips?\b/i.exec(plainText(text));
  return m ? m[1].split(/\s+and\s+|,\s*/).map((s) => s.trim()).filter(Boolean) : [];
}

function tableCells(html: string): { head: string[]; rows: string[][] } {
  const cells = (row: string, tag: string) => [...row.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => plainText(m[1]).trim());
  const head = cells(/<thead>([\s\S]*?)<\/thead>/.exec(html)?.[1] ?? "", "th");
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? "";
  return { head, rows: [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => cells(m[1], "td")) };
}

/** Options from a choice trait's table: name/value pairs (Draconic Ancestors) or a lineage table. */
function tableOptions(html: string): SpeciesOption[] {
  const { head, rows } = tableCells(html);
  if (head.length === 4 && head[0] === head[2]) {
    // Two side-by-side "Dragon | Damage Type" columns: left column first, then right.
    return [0, 2].flatMap((col) => rows.map((r) => ({ name: r[col], text: r[col + 1] })));
  }
  const lvl = head.map((h) => /^Level (\d+)$/.exec(h)?.[1]);
  return rows.map((r) => {
    const opt: SpeciesOption = { name: r[0], text: r[1] };
    const cantrips = cantripsIn(r[1] ?? "");
    if (cantrips.length) opt.cantrips = cantrips;
    const spells = r.slice(2).map((name, i) => ({ level: parseInt(lvl[i + 2] ?? "0", 10), name })).filter((s) => s.level && s.name);
    if (spells.length) opt.spells = spells;
    const speed = /Speed increases to (\d+) feet/i.exec(r[1] ?? "");
    if (speed) opt.speed = parseInt(speed[1], 10);
    const dv = /Darkvision increases to (\d+) feet/i.exec(r[1] ?? "");
    if (dv) opt.darkvision = parseInt(dv[1], 10);
    return opt;
  });
}

/** `**Forest Gnome.** text` paragraphs after "Choose one of the following". */
function boldOptions(text: string): SpeciesOption[] {
  return [...text.matchAll(/^\*\*(.+?)\.\*\*\s*(.+)$/gm)].map((m) => {
    const opt: SpeciesOption = { name: m[1].trim(), text: plainText(m[2]) };
    const cantrips = cantripsIn(m[2]);
    if (cantrips.length) opt.cantrips = cantrips;
    const prepared = /always have the _?(.+?)_? spell prepared/i.exec(m[2]);
    if (prepared) opt.spells = [{ level: 1, name: prepared[1].trim() }];
    return opt;
  });
}

export function parseSpecies(name: string, body: string, originFeats: string[]): SpeciesInfo {
  const speed = parseInt(/\*\*Speed:\*\*\s*(\d+)/.exec(body)?.[1] ?? "30", 10);
  const size = field(body, "Size");
  const info: SpeciesInfo = { name, creatureType: field(body, "Creature Type") || "Humanoid", speed, cantrips: [], traits: [], choices: [] };
  if (/\bor Small\b/i.test(size) && /chosen/i.test(size)) {
    info.choices.push({ key: "size", label: "Size", kind: "size", options: [{ name: "Medium" }, { name: "Small" }] });
  }
  // Traits: "_Name._ text" paragraphs; tables and bold option paragraphs belong to the trait above them.
  const parts = body.split(/^(?=_[A-Z][^_\n]*\._ )/m).slice(1);
  for (const part of parts) {
    const m = /^_([^_]+)\._\s*/.exec(part)!;
    const traitName = m[1].trim();
    const rest = part.slice(m[0].length);
    const firstPara = rest.split(/\n\s*\n/)[0];
    const text = plainText(rest.replace(/<table>[\s\S]*?<\/table>/g, "").replace(/^\*\*[^*]+\*\*\s*$/gm, ""));
    info.traits.push({ name: traitName, text });
    const dv = /Darkvision with a range of (\d+) feet/i.exec(firstPara);
    if (traitName === "Darkvision" && dv) info.darkvision = parseInt(dv[1], 10);
    info.cantrips.push(...(/^You know the/i.test(plainText(firstPara)) ? cantripsIn(firstPara) : []));

    const choices: SpeciesChoice[] = [];
    const table = /<table>[\s\S]*?<\/table>/.exec(rest)?.[0];
    if (/\bChoose (?:the kind of|a lineage|a legacy)/i.test(firstPara) && table) {
      choices.push({ key: slug(traitName), label: traitName, kind: "option", options: tableOptions(table) });
    } else if (/Choose one of the following/i.test(firstPara)) {
      choices.push({ key: slug(traitName), label: traitName, kind: "option", options: boldOptions(rest) });
    }
    if (/Intelligence, Wisdom, or Charisma is your spellcasting ability/i.test(plainText(rest)) && choices.length) {
      choices.push({ key: `${slug(traitName)}_ability`, label: `${traitName} spellcasting ability`, kind: "ability", options: ["Intelligence", "Wisdom", "Charisma"].map((n) => ({ name: n })) });
    }
    if (/proficiency in one skill of your choice/i.test(firstPara)) {
      choices.push({ key: slug(traitName), label: `${traitName} skill`, kind: "skill", options: SKILL_NAMES.map((n) => ({ name: n })) });
    } else {
      const skills = /You have proficiency in the (.+?) skill\./i.exec(plainText(firstPara));
      if (skills) {
        const options = skills[1].split(/,\s*(?:or\s+)?|\s+or\s+/).map((s) => skillName(s)).filter((s): s is string => !!s);
        if (options.length > 1) choices.push({ key: slug(traitName), label: `${traitName} skill`, kind: "skill", options: options.map((n) => ({ name: n })) });
      }
    }
    if (/Origin feat of your choice/i.test(firstPara)) {
      choices.push({ key: slug(traitName), label: `${traitName} feat`, kind: "feat", options: originFeats.map((n) => ({ name: n })) });
    }
    info.choices.push(...choices);
  }
  return info;
}

export function parseFeats(md: string): FeatInfo[] {
  const feats: FeatInfo[] = [];
  for (const [title, body] of sections(md, 3)) {
    const category = FEAT_CATEGORY[title.toLowerCase()];
    if (!category) continue;
    for (const [name, text] of sections(body, 4)) {
      const feat: FeatInfo = { name, category, text: plainText(text.replace(/^_[^_]+_\s*$/m, "")), repeatable: /_Repeatable\._/.test(text) };
      const plus = /Increase your (.+?) score by 1/i.exec(text);
      if (plus) feat.abilities = abilityList(plus[1]);
      feats.push(feat);
    }
  }
  return feats;
}

export class OriginCatalog {
  private backgrounds = new Map<string, BackgroundInfo>();
  private speciesByName = new Map<string, SpeciesInfo>();
  private featList: FeatInfo[] = [];

  load(srdDir: string) {
    const featsPath = join(srdDir, "feats.md");
    if (existsSync(featsPath)) this.featList = parseFeats(readFileSync(featsPath, "utf8").replace(/^﻿/, ""));
    const path = join(srdDir, "character-origins.md");
    if (!existsSync(path)) return;
    const md = readFileSync(path, "utf8").replace(/^﻿/, "");
    const origin = this.feats("origin").map((f) => f.name);
    for (const [title, body] of sections(md, 2)) {
      const descriptions = sections(body, 3).find(([t]) => / Descriptions$/.test(t))?.[1] ?? "";
      for (const [name, part] of sections(descriptions, 4)) {
        if (title === "Character Backgrounds") this.backgrounds.set(key(name), parseBackground(name, part));
        else if (title === "Character Species") this.speciesByName.set(key(name), parseSpecies(name, part, origin));
      }
    }
  }

  get size() {
    return this.backgrounds.size + this.speciesByName.size;
  }

  background(name: string): BackgroundInfo | undefined {
    return this.backgrounds.get(key(name));
  }

  species(name: string): SpeciesInfo | undefined {
    return this.speciesByName.get(key(name));
  }

  backgroundNames(): string[] {
    return [...this.backgrounds.values()].map((b) => b.name);
  }

  speciesNames(): string[] {
    return [...this.speciesByName.values()].map((s) => s.name);
  }

  allBackgrounds(): BackgroundInfo[] {
    return [...this.backgrounds.values()];
  }

  allSpecies(): SpeciesInfo[] {
    return [...this.speciesByName.values()];
  }

  feats(category?: FeatInfo["category"]): FeatInfo[] {
    return category ? this.featList.filter((f) => f.category === category) : this.featList;
  }

  /** A feat by name; "Magic Initiate (Cleric)" finds Magic Initiate. */
  feat(name: string): FeatInfo | undefined {
    const k = key(name);
    return this.featList.find((f) => key(f.name) === k) ?? this.featList.find((f) => key(f.name) === k.replace(/\s*\([^)]*\)$/, ""));
  }
}
