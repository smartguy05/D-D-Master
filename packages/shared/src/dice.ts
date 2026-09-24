/**
 * Dice notation parser/roller.
 * Supports: "1d20+5", "2d6 + 1d4 - 1", "2d20kh1+3" (advantage), "2d20kl1" (disadvantage),
 * "d20", "d%", "1d100", "4d6kh3", and plain numbers.
 */
export const VALID_SIDES = [2, 3, 4, 6, 8, 10, 12, 20, 100] as const;

export interface DiceTerm {
  kind: "dice";
  sign: 1 | -1;
  count: number;
  sides: number;
  keep?: { mode: "h" | "l"; n: number };
}
export interface ModTerm {
  kind: "mod";
  sign: 1 | -1;
  value: number;
}
export type Term = DiceTerm | ModTerm;

export interface RolledDie {
  sides: number;
  value: number;
  dropped?: boolean;
}

export interface DiceOutcome {
  notation: string;
  dice: RolledDie[];
  modifier: number;
  total: number;
}

/** Returns an integer in [1, sides]. */
export type Rng = (sides: number) => number;

export const mathRng: Rng = (sides) => 1 + Math.floor(Math.random() * sides);

const TERM_RE = /^(\d*)d(\d+|%)(?:(kh|kl)(\d+))?$/i;

export function parseNotation(input: string): Term[] {
  const src = input.replace(/\s+/g, "").toLowerCase();
  if (!src) throw new Error("Empty dice notation");
  const parts = src.match(/[+-]?[^+-]+/g);
  if (!parts || parts.join("") !== src) throw new Error(`Invalid dice notation: ${input}`);
  const terms: Term[] = parts.map((raw) => {
    let sign: 1 | -1 = 1;
    let body = raw;
    if (body.startsWith("+")) body = body.slice(1);
    else if (body.startsWith("-")) {
      sign = -1;
      body = body.slice(1);
    }
    if (/^\d+$/.test(body)) return { kind: "mod", sign, value: parseInt(body, 10) };
    const m = TERM_RE.exec(body);
    if (!m) throw new Error(`Invalid dice term "${raw}" in ${input}`);
    const count = m[1] ? parseInt(m[1], 10) : 1;
    const sides = m[2] === "%" ? 100 : parseInt(m[2], 10);
    if (count < 1 || count > 100) throw new Error(`Dice count out of range in ${input}`);
    if (sides < 2 || sides > 1000) throw new Error(`Die sides out of range in ${input}`);
    const term: DiceTerm = { kind: "dice", sign, count, sides };
    if (m[3]) {
      const n = parseInt(m[4], 10);
      if (n < 1 || n > count) throw new Error(`Keep count out of range in ${input}`);
      term.keep = { mode: m[3][1] as "h" | "l", n };
    }
    return term;
  });
  return terms;
}

export function rollNotation(notation: string, rng: Rng = mathRng): DiceOutcome {
  const terms = parseNotation(notation);
  const dice: RolledDie[] = [];
  let total = 0;
  let modifier = 0;
  for (const t of terms) {
    if (t.kind === "mod") {
      modifier += t.sign * t.value;
      total += t.sign * t.value;
      continue;
    }
    const rolled: RolledDie[] = [];
    for (let i = 0; i < t.count; i++) rolled.push({ sides: t.sides, value: rng(t.sides) });
    if (t.keep) {
      const order = rolled
        .map((d, i) => ({ d, i }))
        .sort((a, b) => (t.keep!.mode === "h" ? b.d.value - a.d.value : a.d.value - b.d.value));
      order.slice(t.keep.n).forEach(({ d }) => (d.dropped = true));
    }
    for (const d of rolled) if (!d.dropped) total += t.sign * d.value;
    dice.push(...rolled);
  }
  return { notation: notation.replace(/\s+/g, ""), dice, modifier, total };
}

/** Natural d20 result if the roll was a single kept d20 (for crit/fumble display). */
export function naturalD20(dice: RolledDie[]): number | undefined {
  const kept = dice.filter((d) => d.sides === 20 && !d.dropped);
  return kept.length === 1 ? kept[0].value : undefined;
}
