/**
 * Character `spells` from the brain (pregens, sheet imports) as SRD spell names. Models sometimes
 * write prose ("Prepared level-1 cleric spells: Bless, Cure Wounds…") that shows up as "?" chips
 * with no spell cards. `isSpell` gives the canonical SRD name, or undefined.
 * `keepHomebrew` (sheet imports): name-like entries the SRD doesn't know are kept too.
 */
export function normalizeSpellList(list: string[], isSpell: (name: string) => string | undefined, opts: { keepHomebrew?: boolean } = {}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (name: string) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(name);
  };
  // Notes: "(reaction)", "[R]", "x2".
  const clean = (s: string) => s.replace(/\([^)]*\)|\[[^\]]*\]/g, " ").replace(/\s+x\d+\s*$/i, " ").replace(/\s+/g, " ").trim();
  const nameLike = (s: string) => !/[:\d;]/.test(s) && s.split(" ").length <= 4;
  const cleaned = list.map(clean).filter(Boolean);
  const unknown: string[] = [];
  for (const entry of cleaned) {
    // Whole entry first: "Protection from Evil and Good" must not be split on "and".
    const whole = isSpell(entry);
    if (whole) {
      add(whole);
      continue;
    }
    // "Cantrips: Sacred Flame, Guidance and Light": the names follow the last colon.
    const tail = entry.slice(entry.lastIndexOf(":") + 1).trim();
    const tailSpell = isSpell(tail);
    if (tailSpell) {
      add(tailSpell);
      continue;
    }
    let found = false;
    const unmatched: string[] = [];
    for (const part of tail.split(/[,;]/)) {
      const p = clean(part);
      const spell = isSpell(p);
      if (spell) {
        add(spell);
        found = true;
        continue;
      }
      let partFound = false;
      for (const n of p.split(/\band\b/i)) {
        const s = isSpell(n.trim());
        if (s) {
          add(s);
          found = partFound = true;
        }
      }
      if (!partFound && p && nameLike(p)) unmatched.push(p);
    }
    if (found) unknown.push(...unmatched);
    else if (nameLike(entry)) unknown.push(entry);
  }
  // Nothing from the SRD (or an import): keep entries that look like names (homebrew), never prose.
  if (!out.length || opts.keepHomebrew) for (const u of unknown) add(u);
  return out;
}
