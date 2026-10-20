import type { Character, ClassData } from "@dm/shared";

/**
 * A character with no saving throw proficiencies gets its SRD class's (Fighter: STR, CON). The host
 * form, sheet imports and pregens often leave them out; an explicit list is never touched.
 */
export function defaultSavingThrows(c: Character, classData: (className: string) => ClassData | undefined): Character {
  if (c.savingThrows.length || !c.className) return c;
  const saves = classData(c.className)?.savingThrows;
  if (saves?.length) c.savingThrows = [...saves];
  return c;
}

export function needsSavingThrows(c: Character, classData: (className: string) => ClassData | undefined): boolean {
  return !c.savingThrows.length && !!c.className && !!classData(c.className)?.savingThrows?.length;
}
