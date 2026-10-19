import type { NpcFocusView, ServerEvent } from "@dm/shared";

/** The close-up goes away after this long without an NPC line (the DM forgot to clear it). */
export const NPC_FOCUS_IDLE_MS = 60_000;

/**
 * The NPC the DM is voicing, for the TV close-up (npc_focus tool, speak_as_npc). While an NPC has
 * the focus the DM's audio transcript is forwarded as captions. Ephemeral: not in GameState or the
 * undo history; repeated to a /table that connects (snapshot).
 */
export class NpcFocus {
  current: NpcFocusView | null = null;
  private idle?: ReturnType<typeof setTimeout>;

  constructor(private deps: { broadcast(ev: ServerEvent): void }) {}

  set(view: NpcFocusView | null) {
    if (!view && !this.current) return;
    this.current = view;
    this.deps.broadcast({ type: "npc_focus", focus: view });
    this.touch();
  }

  /** The DM's transcript for one spoken reply (`id`): `final` carries the whole text. */
  caption(id: string, text: string, final: boolean) {
    if (!this.current || !text) return;
    this.deps.broadcast({ type: "caption", caption: { id, npcName: this.current.name, text, final } });
    this.touch();
  }

  snapshot(): ServerEvent {
    return { type: "npc_focus", focus: this.current };
  }

  dispose() {
    clearTimeout(this.idle);
  }

  private touch() {
    clearTimeout(this.idle);
    if (this.current) this.idle = setTimeout(() => this.set(null), NPC_FOCUS_IDLE_MS);
  }
}
