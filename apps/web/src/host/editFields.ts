/**
 * Dirty tracking for the host CharacterEditor's number/text fields. `base` is the server value the
 * field was last synced to (or saved as). A clean field follows the server; a field the host has
 * typed into and not saved keeps the typed value, and editHint() says when the server changed it.
 */
export interface EditField<T> {
  value: T;
  base: T;
}

export const editField = <T>(server: T): EditField<T> => ({ value: server, base: server });

export const isDirty = <T>(f: EditField<T>): boolean => f.value !== f.base;

/** New server value arrived: clean fields take it, dirty ones are kept (same object if unchanged). */
export function syncEditField<T>(f: EditField<T>, server: T): EditField<T> {
  if (isDirty(f)) return f;
  return f.base === server ? f : { value: server, base: server };
}

/** "changed on server: N" for a dirty field whose server value moved since it was typed. */
export function editHint<T>(f: EditField<T>, server: T): string | undefined {
  return isDirty(f) && server !== f.base ? `changed on server: ${server}` : undefined;
}

/** After Save: the typed value is now what the server has. */
export const savedField = <T>(f: EditField<T>): EditField<T> => ({ value: f.value, base: f.value });
