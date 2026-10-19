/**
 * Private phone notes: saved on the server (GET/PUT /api/players/:id/notes), with a local draft so
 * typing survives a dropped connection or a reload before the save went through.
 */

export interface NotesDraft {
  text: string;
  /** Not saved to the server yet. */
  dirty: boolean;
}

export const NOTES_SAVE_DELAY_MS = 800;

export const draftKey = (playerId: string) => `dm.notes.${playerId}`;

export function readDraft(playerId: string): NotesDraft | undefined {
  try {
    const raw = localStorage.getItem(draftKey(playerId));
    const d = raw ? (JSON.parse(raw) as Partial<NotesDraft>) : undefined;
    return d && typeof d.text === "string" ? { text: d.text, dirty: !!d.dirty } : undefined;
  } catch {
    return undefined;
  }
}

export function writeDraft(playerId: string, draft: NotesDraft) {
  try {
    localStorage.setItem(draftKey(playerId), JSON.stringify(draft));
  } catch {
    /* storage blocked: the server copy is all there is */
  }
}

/**
 * What to show once the server copy arrives: an unsaved local draft wins (and must be saved);
 * otherwise the server's text.
 */
export function chooseNotes(server: string, draft: NotesDraft | undefined): { text: string; needsSave: boolean } {
  if (draft?.dirty && draft.text !== server) return { text: draft.text, needsSave: true };
  return { text: server, needsSave: false };
}
