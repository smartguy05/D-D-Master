import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  findClassFeature,
  RESOURCE_COLUMNS,
  resourcesFor,
  type Abilities,
  type AbilityKey,
  type CasterKind,
  type ClassData,
  type ClassFeature,
  type ClassInfo,
  type ClassLevel,
  type ClassResource,
} from "@dm/shared";
import { plainText, shorten } from "./spells.js";
import { parseEquipmentOptions } from "./equipment.js";

/**
 * SRD class catalog: parses `data/srd/classes.md` (one `## Class` section per class) into ClassInfo:
 * hit die, saves, spellcasting ability + caster kind, the 20-row "<Class> Features" table (features,
 * slots, Pact Magic, resource columns) and `#### Level N: Feature` text for the class and its SRD
 * subclass.
 */

const ABILITY: Record<string, AbilityKey> = {
  strength: "str",
  dexterity: "dex",
  constitution: "con",
  intelligence: "int",
  wisdom: "wis",
  charisma: "cha",
};

const FEATURE_TEXT_MAX = 400;

const cells = (row: string, tag: "td" | "th") =>
  [...row.matchAll(new RegExp(`<${tag}([^>]*)>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => ({ attrs: m[1], text: plainText(m[2]) }));

const toInt = (s: string | undefined) => {
  const n = parseInt((s ?? "").replace(/[+−]/g, (c) => (c === "−" ? "-" : "")), 10);
  return Number.isFinite(n) ? n : 0;
};

interface ParsedTable {
  kind: CasterKind;
  levels: ClassLevel[];
}

/** Parse the "<Class> Features" HTML table. */
export function parseClassTable(tableHtml: string): ParsedTable {
  const thead = /<thead>([\s\S]*?)<\/thead>/.exec(tableHtml)?.[1] ?? "";
  const firstRow = /<tr>([\s\S]*?)<\/tr>/.exec(thead)?.[1] ?? "";
  const headers: string[] = [];
  let slotCols = 0;
  for (const th of cells(firstRow, "th")) {
    const span = /colspan="(\d+)"/.exec(th.attrs);
    if (span) {
      slotCols = parseInt(span[1], 10);
      for (let i = 1; i <= slotCols; i++) headers.push(`Slot ${i}`);
    } else headers.push(th.text);
  }
  const pact = headers.includes("Spell Slots") && headers.includes("Slot Level");
  const kind: CasterKind = pact ? "pact" : slotCols >= 9 ? "full" : slotCols > 0 ? "half" : "none";

  const tbody = /<tbody>([\s\S]*?)<\/tbody>/.exec(tableHtml)?.[1] ?? "";
  const levels: ClassLevel[] = [];
  for (const tr of tbody.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    // Rows can carry a trailing empty <td>; only the first headers.length cells count.
    const row = cells(tr[1], "td").slice(0, headers.length).map((c) => c.text);
    const get = (h: string) => row[headers.indexOf(h)];
    const level = toInt(get("Level"));
    if (!level) continue;
    const featuresCell = get("Class Features") ?? "";
    const out: ClassLevel = {
      level,
      proficiencyBonus: toInt(get("Proficiency Bonus")),
      features: featuresCell === "—" || !featuresCell ? [] : featuresCell.split(",").map((f) => f.trim()).filter(Boolean),
      slots: [],
      resources: {},
      columns: {},
    };
    if (slotCols) {
      const slots = Array.from({ length: slotCols }, (_, i) => toInt(get(`Slot ${i + 1}`)));
      while (slots.length && slots[slots.length - 1] === 0) slots.pop();
      out.slots = slots;
    }
    if (pact) out.pact = { slots: toInt(get("Spell Slots")), slotLevel: toInt(get("Slot Level")) };
    headers.forEach((h, i) => {
      if (["Level", "Proficiency Bonus", "Class Features"].includes(h) || h.startsWith("Slot ") || h === "Spell Slots") return;
      const v = row[i] ?? "";
      if (h === "Cantrips") out.cantrips = toInt(v);
      else if (h === "Prepared Spells") out.preparedSpells = toInt(v);
      else {
        out.columns[h] = v;
        const res = RESOURCE_COLUMNS[h];
        if (res && toInt(v) > 0) out.resources[res] = toInt(v);
      }
    });
    levels.push(out);
  }
  return { kind, levels };
}

/** The text of a "Core <Class> Traits" row, e.g. coreTrait(body, "Skill Proficiencies"). */
function coreTrait(body: string, label: string): string | undefined {
  const m = new RegExp(`<td>${label}</td>\\s*<td>([\\s\\S]*?)</td>`).exec(body);
  return m ? plainText(m[1]) : undefined;
}

/** "Choose 2: Athletics, …, or Survival" / "Choose any 3 skills". */
export function parseSkillChoices(text: string): ClassInfo["skillChoices"] {
  const any = /Choose any (\d+) skills/i.exec(text);
  if (any) return { count: parseInt(any[1], 10), options: "any" };
  const m = /Choose (\d+):\s*(.+)$/i.exec(text);
  if (!m) return undefined;
  const options = m[2]
    .split(/,\s*(?:or\s+)?|\s+or\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return { count: parseInt(m[1], 10), options };
}

/** Creation fields from the core traits table and the class table. */
function creationData(body: string, levels: ClassLevel[]): Partial<ClassInfo> {
  const out: Partial<ClassInfo> = {};
  const skills = coreTrait(body, "Skill Proficiencies");
  if (skills) out.skillChoices = parseSkillChoices(skills);
  const equipment = coreTrait(body, "Starting Equipment");
  if (equipment) out.equipment = parseEquipmentOptions(equipment);
  const armor = (coreTrait(body, "Armor Training") ?? "").toLowerCase();
  out.armorTraining = (["light", "medium", "heavy", "shield"] as const).filter((a) => armor.includes(a));
  const weapons = coreTrait(body, "Weapon Proficiencies") ?? "";
  const props = /Martial weapons that have the (.+?) property/i.exec(weapons);
  out.weaponProficiency = {
    simple: /Simple/i.test(weapons),
    martial: props ? props[1].split(/\s+or\s+|,\s*/).map((p) => p.trim()) : /Martial/i.test(weapons),
  };
  out.subclassLevel = levels.find((l) => l.features.some((f) => / Subclass$/.test(f)))?.level;
  out.asiLevels = levels.filter((l) => l.features.some((f) => f === "Ability Score Improvement" || f === "Epic Boon")).map((l) => l.level);
  return out;
}

/** Parse one `## Class` section (body after the heading line). */
export function parseClassSection(name: string, body: string): ClassInfo | undefined {
  const hd = /Hit Point Die<\/td>\s*<td>\s*D(\d+)/i.exec(body);
  const tableStart = body.indexOf(`**${name} Features**`);
  if (!hd || tableStart < 0) return undefined;
  const tableHtml = /<table>[\s\S]*?<\/table>/.exec(body.slice(tableStart))?.[0] ?? "";
  const { kind, levels } = parseClassTable(tableHtml);

  const saves = /Saving Throw Proficiencies<\/td>\s*<td>([^<]+)</.exec(body)?.[1] ?? "";
  const savingThrows = saves
    .split(/,|\band\b/)
    .map((s) => ABILITY[s.trim().toLowerCase()])
    .filter((a): a is AbilityKey => !!a);

  const castAbility = /(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) is (?:your|the) spellcasting ability for your/.exec(body);

  const features: ClassFeature[] = [];
  let subclass: ClassInfo["subclass"];
  let mode: "class" | "subclass" | "other" = "other";
  for (const part of body.split(/^(?=#{3,4} )/m)) {
    const h3 = /^### (.+)/.exec(part);
    if (h3) {
      const title = h3[1].trim();
      const sub = /Subclass: (.+)$/.exec(title);
      if (sub) {
        mode = "subclass";
        subclass = { name: sub[1].trim(), features: [] };
      } else mode = / Class Features$/.test(title) ? "class" : "other";
      continue;
    }
    const h4 = /^#### Level (\d+): (.+)\n/.exec(part);
    if (!h4 || mode === "other") continue;
    const feature: ClassFeature = {
      level: parseInt(h4[1], 10),
      name: h4[2].trim(),
      text: shorten(plainText(part.slice(h4[0].length)), FEATURE_TEXT_MAX),
    };
    if (mode === "class") features.push(feature);
    else subclass?.features.push(feature);
  }

  const info: ClassInfo = { name, hitDie: parseInt(hd[1], 10), savingThrows, levels, features, ...creationData(body, levels) };
  if (kind !== "none" && castAbility) info.spellcasting = { ability: ABILITY[castAbility[1].toLowerCase()], kind };
  if (subclass) info.subclass = subclass;
  return info;
}

export class ClassCatalog {
  private byName = new Map<string, ClassData>();

  load(srdDir: string) {
    const path = join(srdDir, "classes.md");
    if (!existsSync(path)) return;
    const md = readFileSync(path, "utf8").replace(/^﻿/, "");
    for (const part of md.split(/^(?=## )/m)) {
      const m = /^## (.+)\n/.exec(part);
      if (!m) continue;
      const info = parseClassSection(m[1].trim(), part.slice(m[0].length));
      if (!info) continue;
      const data: ClassData = { ...info, featureText: (n) => findClassFeature(info, n)?.text };
      this.byName.set(info.name.toLowerCase(), data);
    }
  }

  get size() {
    return this.byName.size;
  }

  names(): string[] {
    return [...this.byName.values()].map((c) => c.name);
  }

  get(className: string): ClassData | undefined {
    return this.byName.get(className.trim().toLowerCase());
  }

  /** One row of the class table (level clamped to 1–20). */
  level(className: string, level: number): ClassLevel | undefined {
    const c = this.get(className);
    return c?.levels.find((l) => l.level === Math.max(1, Math.min(20, Math.floor(level))));
  }

  /** Class resources at a level; subclass resources too when `subclass` is the class's SRD subclass. */
  resourcesFor(className: string, level: number, abilities: Abilities, subclass?: string): ClassResource[] {
    return resourcesFor(this.get(className), level, abilities, subclass);
  }

  featureText(className: string, feature: string): string | undefined {
    return this.get(className)?.featureText(feature);
  }
}
