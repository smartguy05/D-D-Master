import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { Character, emptyGameState, type GameState, type Rng } from "@dm/shared";
import { ClassCatalog } from "../../rules/classes.js";
import { SpellCatalog } from "../../rules/spells.js";
import type { EngineContext } from "../tools.js";

/**
 * Test helpers for the rules engine: an EngineContext backed by the real SRD spell and class
 * catalogs (loaded once), a scripted die roller and ready-made characters. Used by *.test.ts only.
 */

const SRD_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "../../../../../data/srd");
let catalogs: { spells: SpellCatalog; classes: ClassCatalog } | undefined;

function load() {
  if (!catalogs) {
    const spells = new SpellCatalog();
    spells.load(SRD_DIR);
    const classes = new ClassCatalog();
    classes.load(SRD_DIR);
    catalogs = { spells, classes };
  }
  return catalogs;
}

/** A die roller that returns the given values in order (the last one repeats). */
export const seq =
  (...values: number[]): Rng =>
  () =>
    values.length > 1 ? values.shift()! : values[0];

export function rulesCtx(rng: Rng = seq(10)): EngineContext {
  const { spells, classes } = load();
  return {
    rng,
    monsterTemplate: () => undefined,
    spell: (n) => spells.find(n),
    spellCandidates: (n) => spells.candidates(n),
    classData: (n) => classes.get(n),
    locations: [],
  };
}

export function makeCharacter(over: Partial<Character> & { id: string; name: string }): Character {
  return Character.parse({ playerName: over.name, maxHp: 10, hp: 10, ...over });
}

export function stateWith(...characters: Character[]): GameState {
  const s = emptyGameState("c1");
  s.characters.push(...characters);
  return s;
}
