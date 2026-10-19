import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Abilities, Attack, Monster } from "@dm/shared";

export type MonsterTemplate = Omit<Monster, "id" | "hp">;

const num = (s: string) => parseInt(s.replace("−", "-"), 10);
const COUNTS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

/**
 * Attacks in a Multiattack's first sentence: "makes two Rend attacks" = 2, "makes one Bite attack
 * and one Claw attack" = 2. Uses of other actions ("and uses Constrict") aren't counted.
 */
export function multiattackCount(sentence: string): number {
  let n = 0;
  for (const m of sentence.matchAll(/\b(one|two|three|four|five|six)\b[^,.;]*?\battacks?\b/gi)) n += COUNTS[m[1].toLowerCase()];
  return Math.max(1, n);
}

/** Parse one "### Name" stat block from the SRD markdown. Returns undefined if it isn't a stat block. */
export function parseStatBlock(name: string, body: string): MonsterTemplate | undefined {
  const ac = /\*\*AC\*\*\s+(\d+)/.exec(body);
  const hp = /\*\*HP\*\*\s+(\d+)/.exec(body);
  if (!ac || !hp) return undefined;
  const init = /\*\*Initiative\*\*\s+([+−-]\d+)/.exec(body);
  const cr = /\*\*CR\*\*\s+([\d/]+)/.exec(body);
  // Walking Speed only ("**Speed** 10 ft., Swim 40 ft."); fly/swim/climb aren't tracked.
  const speed = /\*\*Speed\*\*\s+(\d+)\s*ft/.exec(body);
  const multi = /\*\*_Multiattack\._\*\*\s+([^.]*)/.exec(body);

  const abilities: Partial<Abilities> = {};
  for (const m of body.matchAll(/<strong>(STR|DEX|CON|INT|WIS|CHA)<\/strong><\/td>\s*<td>(\d+)<\/td>/g)) {
    abilities[m[1].toLowerCase() as keyof Abilities] = parseInt(m[2], 10);
  }

  const attacks: Attack[] = [];
  const attackRe = /\*\*_([^*]+?)\._\*\*\s+_(Melee|Ranged|Melee or Ranged) Attack Roll:_\s*([+−-]\d+)[^_]*_Hit:_\s*\d+\s*\(([^)]+)\)\s*([A-Za-z]+)?/g;
  for (const m of body.matchAll(attackRe)) {
    attacks.push({
      name: m[1].trim(),
      toHit: num(m[3]),
      damage: `${m[4].replace(/\s+/g, "")}${m[5] ? ` ${m[5].toLowerCase()}` : ""}`,
      // Kept for the board animations (attackStyle: melee swing vs flying arrow).
      description: `${m[2]} Attack Roll`,
    });
  }

  return {
    name,
    srdName: name,
    maxHp: parseInt(hp[1], 10),
    ac: parseInt(ac[1], 10),
    initiativeBonus: init ? num(init[1]) : 0,
    speed: speed ? parseInt(speed[1], 10) : 30,
    attacksPerAction: multi ? multiattackCount(multi[1]) : 1,
    abilities: Object.keys(abilities).length === 6 ? (abilities as Abilities) : undefined,
    attacks,
    conditions: [],
    cr: cr?.[1],
    hidden: false,
    npc: false,
    appearance: "",
    ally: false,
    follows: false,
  };
}

export class MonsterCatalog {
  private byName = new Map<string, MonsterTemplate>();

  load(srdDir: string) {
    // Stat block names are h3 in monsters-A-Z.md and h2 in animals.md.
    for (const [f, heading] of [["monsters-A-Z.md", /^### /m], ["animals.md", /^## /m]] as const) {
      const path = join(srdDir, f);
      if (!existsSync(path)) continue;
      const md = readFileSync(path, "utf8");
      const parts = md.split(heading).slice(1);
      for (const part of parts) {
        const nl = part.indexOf("\n");
        const name = part.slice(0, nl).trim();
        const t = parseStatBlock(name, part.slice(nl + 1));
        if (t) this.byName.set(name.toLowerCase(), t);
      }
    }
  }

  get size() {
    return this.byName.size;
  }

  names(): string[] {
    return [...this.byName.values()].map((m) => m.name);
  }

  /** Exact, then singular, then "contains" match (e.g. "goblins" -> "Goblin Warrior"). */
  find(name: string): MonsterTemplate | undefined {
    const q = name.trim().toLowerCase();
    if (!q) return undefined;
    const singular = singularize(q);
    const exact = this.byName.get(q) ?? this.byName.get(singular);
    if (exact) return exact;
    for (const [k, v] of this.byName) if (k.startsWith(singular)) return v;
    for (const [k, v] of this.byName) if (k.includes(singular)) return v;
    return undefined;
  }
}

function singularize(word: string): string {
  if (/ves$/.test(word)) return word.replace(/ves$/, "f");
  if (/ies$/.test(word)) return word.replace(/ies$/, "y");
  if (/(ch|sh|x)es$/.test(word)) return word.replace(/es$/, "");
  return word.replace(/s$/, "");
}
