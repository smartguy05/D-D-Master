import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ArmorInfo, EquipmentOption, WeaponInfo } from "@dm/shared";
import { plainText } from "./spells.js";

/**
 * SRD equipment for character creation: the Armor and Weapons tables of `data/srd/equipment.md`
 * (AC from worn armor, attacks from starting weapons) and the "(A) …; or (B) 50 GP" starting
 * equipment text used by classes and backgrounds.
 */

/** Ammunition keeps its plural name ("Arrows x20"). */
const KEEP_PLURAL = new Set(["arrows", "bolts", "bullets", "needles"]);

function singular(name: string): string {
  if (KEEP_PLURAL.has(name.toLowerCase())) return name;
  const m = /^(.*?)(\s*\([^)]*\))?$/.exec(name)!;
  const [head, tail = ""] = [m[1], m[2]];
  if (/(ch|sh|ss)es$/i.test(head)) return head.slice(0, -2) + tail;
  if (/[^s]s$/i.test(head)) return head.slice(0, -1) + tail;
  return name;
}

/** Parse "Choose A or B: (A) Greataxe, 4 Handaxes, Explorer's Pack, and 15 GP; or (B) 75 GP". */
export function parseEquipmentOptions(text: string): EquipmentOption[] {
  const clean = plainText(text).replace(/_/g, "");
  const out: EquipmentOption[] = [];
  for (const m of clean.matchAll(/\(([A-Z])\)\s*([\s\S]*?)(?=;?\s*(?:or\s*)?\([A-Z]\)|$)/g)) {
    const option: EquipmentOption = { letter: m[1], items: [], gold: 0 };
    // Split on commas outside parentheses ("Book (prayers), Parchment (10 sheets)").
    const parts = m[2].replace(/;\s*$/, "").split(/,(?![^(]*\))/);
    for (let raw of parts) {
      raw = raw.trim().replace(/^and\s+/i, "").replace(/[.;]$/, "").trim();
      if (!raw) continue;
      const gp = /^(\d+)\s*GP$/i.exec(raw);
      if (gp) {
        option.gold += parseInt(gp[1], 10);
        continue;
      }
      const counted = /^(\d+)\s+(.+)$/.exec(raw);
      const qty = counted ? parseInt(counted[1], 10) : 1;
      const name = counted ? singular(counted[2].trim()) : raw;
      option.items.push({ name, qty });
    }
    out.push(option);
  }
  return out;
}

const cellsOf = (row: string) => [...row.matchAll(/<(td|th)([^>]*)>([\s\S]*?)<\/\1>/g)].map((m) => ({ tag: m[1], text: plainText(m[3]).trim() }));

/** Rows of the first <table> after `**Title**`, with the italic category row each one sits under. */
function tableRows(md: string, title: string): { category: string; cells: string[] }[] {
  const start = md.indexOf(`**${title}**`);
  if (start < 0) return [];
  const table = /<tbody>([\s\S]*?)<\/tbody>/.exec(md.slice(start))?.[1] ?? "";
  const rows: { category: string; cells: string[] }[] = [];
  let category = "";
  for (const tr of table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = cellsOf(tr[1]);
    if (cells.length === 1 && cells[0].tag === "th") category = cells[0].text;
    else if (cells.length > 1) rows.push({ category, cells: cells.map((c) => c.text) });
  }
  return rows;
}

const key = (name: string) => name.trim().toLowerCase().replace(/[‘’]/g, "'");

export class EquipmentCatalog {
  private armorByName = new Map<string, ArmorInfo>();
  private weaponByName = new Map<string, WeaponInfo>();

  load(srdDir: string) {
    const path = join(srdDir, "equipment.md");
    if (!existsSync(path)) return;
    const md = readFileSync(path, "utf8").replace(/^﻿/, "");
    for (const { category, cells } of tableRows(md, "Armor")) {
      const [name, ac] = cells;
      const cat = /^(Light|Medium|Heavy)/i.exec(category)?.[1]?.toLowerCase() as ArmorInfo["category"] | undefined;
      const kind: ArmorInfo["category"] | undefined = /^Shield/i.test(category) ? "shield" : cat;
      const base = parseInt(ac.replace("+", ""), 10);
      if (!kind || !Number.isFinite(base)) continue;
      const info: ArmorInfo = { name, category: kind, base };
      const cap = /max (\d+)/i.exec(ac);
      if (cap) info.dexCap = parseInt(cap[1], 10);
      else if (kind === "heavy") info.dexCap = 0;
      this.armorByName.set(key(name), info);
    }
    for (const { category, cells } of tableRows(md, "Weapons")) {
      const [name, damage, props] = cells;
      const dmg = /^(\d+(?:d\d+)?)\s+(\w+)/.exec(damage);
      if (!dmg) continue;
      const properties = props === "—" ? [] : props.split(/,(?![^(]*\))/).map((p) => p.trim()).filter(Boolean);
      this.weaponByName.set(key(name), {
        name,
        category: /^Martial/i.test(category) ? "martial" : "simple",
        ranged: /Ranged/i.test(category),
        dice: dmg[1],
        damageType: dmg[2],
        properties,
        finesse: properties.some((p) => /^Finesse/i.test(p)),
      });
    }
  }

  armor(name: string): ArmorInfo | undefined {
    return this.armorByName.get(key(name));
  }

  weapon(name: string): WeaponInfo | undefined {
    return this.weaponByName.get(key(name));
  }

  armorNames(): string[] {
    return [...this.armorByName.values()].map((a) => a.name);
  }

  weaponNames(): string[] {
    return [...this.weaponByName.values()].map((w) => w.name);
  }
}
