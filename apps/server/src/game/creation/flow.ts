import {
  Character,
  CreationDraft,
  sayText,
  type Campaign,
  type CreationOptions,
  type CreationView,
  type GameState,
  type ServerEvent,
} from "@dm/shared";
import type { CharacterDraft } from "../../brain/content.js";
import { runCreationTurn, type ChatDeps, type ChatInput, type ChatResult } from "../../brain/creation-chat.js";
import type { LLMProvider } from "../../brain/provider.js";
import type { Store } from "../../db/index.js";
import { newId } from "../../engine/ids.js";
import { applyDerived } from "../../engine/rules/derive.js";
import { mergeChoices } from "./draft.js";
import { derivedSummary, resolveChoices, rollAbilitySet, type CreationContext, type CreationRules, type Resolved } from "./validate.js";

/**
 * Phone character creation (docs/gameplay/phone-creation.md). Each seat has one draft in SQLite
 * (character_drafts, never GameState: publicState goes to every phone). Every change is saved,
 * then a content-free `creation` event tells the seat's phone and the host to refetch.
 * A valid draft joins the party at once (GameService.addCharacter) and is saved to the roster; an
 * invalid one may go to the host for approval. Before play starts a joined character can still be
 * edited from the phone (the edit re-checks and goes through updateCharacter).
 */

/** Portrait draws per draft (each one is an image API call). */
export const PORTRAIT_MAX_DRAWS = 6;

/** What CreationFlow needs from GameService. */
export interface CreationHost {
  store: Store;
  broadcast(ev: ServerEvent): void;
  campaign(): Campaign;
  state(): GameState;
  rules: CreationRules;
  addCharacter(draft: Partial<CharacterDraft> & { name: string }, playerId: string, opts: { spriteUrl?: string }): Character;
  updateCharacter(id: string, patch: Partial<Character>): void;
  saveToRoster(characterId: string): { rosterId: string };
  /** Draw a sprite for the campaign (throws without an image key). */
  drawPortrait(campaignId: string, label: string, subject: string, fresh: boolean): Promise<string>;
  imagesAvailable(): boolean;
  log(text: string): void;
  options(level: number): CreationOptions;
  /** The chat helper's model (undefined without a brain key). */
  chatLlm(): LLMProvider | undefined;
  job<T>(label: string, fn: () => Promise<T>): Promise<T>;
  /** SRD text for a question (RulesIndex.lookup). */
  lookup(query: string): string;
}

/** Chat turns kept per draft. */
export const CHAT_KEEP = 80;

/** Fields of a joined character that a phone edit (before play) may change. */
const EDIT_FIELDS = [
  "name",
  "species",
  "className",
  "subclass",
  "background",
  "abilities",
  "maxHp",
  "ac",
  "speed",
  "proficiencyBonus",
  "skills",
  "savingThrows",
  "attacks",
  "spells",
  "features",
  "notes",
  "appearance",
  "backstory",
  "personality",
  "ideals",
  "bonds",
  "flaws",
  "diceMode",
] as const;

export class CreationFlow {
  constructor(private readonly host: CreationHost) {}

  private get level() {
    return this.host.campaign().partyLevel;
  }

  locked(): boolean {
    return this.host.campaign().creation.playStartedAt !== undefined;
  }

  private player(playerId: string) {
    const p = this.host.state().players.find((x) => x.id === playerId);
    if (!p) throw new Error("Unknown player.");
    return p;
  }

  /** The seat's draft (a fresh one if none). A `joined` draft whose character is gone (undo) is a draft again. */
  get(playerId: string): CreationDraft {
    const c = this.host.campaign();
    this.player(playerId);
    const d = this.host.store.getCreationDraft(c.id, playerId) ?? CreationDraft.parse({ playerId });
    if (d.status === "joined" && !this.host.state().characters.some((ch) => ch.id === d.characterId)) {
      d.status = "draft";
      delete d.characterId;
    }
    return d;
  }

  /** Save, stamp and announce a draft. */
  put(d: CreationDraft): CreationDraft {
    d.updatedAt = Date.now();
    this.host.store.saveCreationDraft(this.host.campaign().id, d);
    this.host.broadcast({ type: "creation", playerId: d.playerId, status: d.status, updatedAt: d.updatedAt, ...(d.chatBusy || d.portraitBusy ? { busy: true } : {}) });
    return d;
  }

  context(d: CreationDraft): CreationContext {
    const s = this.host.campaign().creation;
    return { level: this.level, methods: s.abilityMethods, allowHomebrew: s.allowHomebrew, rolledScores: d.rolledScores, rules: this.host.rules };
  }

  resolve(d: CreationDraft): Resolved {
    return resolveChoices(d.choices, this.context(d));
  }

  /** The character the draft builds, for the phone's preview (derived slots, saves; no id). */
  preview(r: Resolved, d: CreationDraft): Character | null {
    if (!r.draft) return null;
    const player = this.host.state().players.find((p) => p.id === d.playerId);
    const ch = Character.parse({
      ...r.draft,
      id: d.characterId ?? "preview",
      playerName: player?.name ?? "",
      hp: r.draft.maxHp ?? 1,
      maxHp: r.draft.maxHp ?? 1,
      spriteUrl: d.portraitUrl,
      inventory: (r.draft.inventory ?? []).map((i, n) => ({ ...i, id: i.id || `prev_${n}` })),
    });
    return applyDerived(ch, ch.className ? this.host.rules.classData(ch.className) : undefined);
  }

  view(playerId: string): CreationView {
    const d = this.get(playerId);
    const r = this.resolve(d);
    const s = this.host.campaign().creation;
    return {
      draft: d,
      validation: { ok: r.ok, errors: r.errors, warnings: r.warnings },
      preview: this.preview(r, d),
      level: this.level,
      settings: { abilityMethods: s.abilityMethods, allowHomebrew: s.allowHomebrew, phoneCreation: s.phoneCreation },
      locked: this.locked(),
      hasOtherCharacter: this.otherCharacter(playerId, d) !== undefined,
    };
  }

  /** The character this seat plays that didn't come from its draft (roster, host form, voice builder). */
  private otherCharacter(playerId: string, d: CreationDraft): Character | undefined {
    const s = this.host.state();
    const id = s.players.find((p) => p.id === playerId)?.characterId;
    const ch = id ? s.characters.find((c) => c.id === id) : undefined;
    return ch && ch.id !== d.characterId ? ch : undefined;
  }

  private requireOpen() {
    if (!this.host.campaign().creation.phoneCreation) throw new Error("The host turned off character creation on phones.");
  }

  /** May this draft be changed now? */
  private requireEditable(d: CreationDraft) {
    this.requireOpen();
    if (d.status === "pending") throw new Error("Your character is waiting for the host. Withdraw it to make changes.");
    if (d.status === "joined" && this.locked()) throw new Error("Play has started: ask the host to change your character.");
  }

  patch(playerId: string, patch: unknown, clear?: string[], opts: { fromAi?: boolean } = {}): CreationView {
    const d = this.get(playerId);
    this.requireEditable(d);
    d.choices = mergeChoices(d.choices, patch, { fromAi: opts.fromAi, clear });
    if (d.status === "returned" && !opts.fromAi) d.status = "draft";
    this.put(d);
    return this.view(playerId);
  }

  /** Start over: drop the draft (a joined character stays in the party). */
  reset(playerId: string): CreationView {
    const d = this.get(playerId);
    this.requireOpen();
    if (d.status === "pending") throw new Error("Withdraw your character from the host first.");
    if (d.chatBusy) throw new Error("Wait for the helper's reply first.");
    this.host.store.deleteCreationDraft(this.host.campaign().id, playerId);
    this.host.broadcast({ type: "creation", playerId, status: "none", updatedAt: Date.now() });
    return this.view(playerId);
  }

  /** Roll 4d6-drop-lowest six times, once per draft (the host can clear it with reset). */
  rollScores(playerId: string): CreationView {
    const d = this.get(playerId);
    this.requireEditable(d);
    if (!this.host.campaign().creation.abilityMethods.includes("rolled")) throw new Error("The host doesn't allow rolled ability scores.");
    if (d.rolledScores?.length) throw new Error("You already rolled your scores.");
    d.rolledScores = rollAbilitySet();
    d.choices = { ...d.choices, abilityMethod: "rolled" };
    this.put(d);
    this.host.log(`${this.player(playerId).name} rolled ability scores: ${d.rolledScores.join(", ")}.`);
    return this.view(playerId);
  }

  /** Draw (or redraw, `fresh`) the portrait from the name, species, class and appearance. Runs in the background. */
  drawPortrait(playerId: string, fresh: boolean): CreationView {
    const d = this.get(playerId);
    this.requireEditable(d);
    if (!this.host.imagesAvailable()) throw new Error("No image key: the host can't draw portraits.");
    if (d.portraitBusy) throw new Error("Your portrait is already being drawn.");
    if (d.portraitDraws >= PORTRAIT_MAX_DRAWS) throw new Error(`That's ${PORTRAIT_MAX_DRAWS} portraits: keep one, or ask the host to redraw it later.`);
    const c = d.choices;
    if (!c.name?.trim() || !c.appearance?.trim()) throw new Error("Give your character a name and an appearance first.");
    const subject = `${c.name.trim()}, a ${c.species ?? ""} ${c.className ?? ""}. ${c.appearance.trim()}`.replace(/\s+/g, " ");
    d.portraitBusy = true;
    d.portraitDraws += 1;
    this.put(d);
    const campaignId = this.host.campaign().id;
    void this.host
      .drawPortrait(campaignId, `Drawing ${c.name.trim()}`, subject, fresh || d.portraitDraws > 1)
      .then((url) => this.finishPortrait(campaignId, playerId, url))
      .catch(() => this.finishPortrait(campaignId, playerId, undefined));
    return this.view(playerId);
  }

  private finishPortrait(campaignId: string, playerId: string, url: string | undefined) {
    if (this.host.campaign().id !== campaignId) return; // the host loaded another campaign meanwhile
    const d = this.get(playerId);
    d.portraitBusy = false;
    if (url) {
      d.portraitUrl = url;
      if (d.status === "joined" && d.characterId) this.host.updateCharacter(d.characterId, { spriteUrl: url });
    }
    this.put(d);
  }

  /**
   * Join the party with a valid draft (a new character, saved to the roster), or save the edits of a
   * joined one. `approved`: the host passed it despite errors.
   */
  join(playerId: string, opts: { approved?: boolean } = {}): CreationView {
    const d = this.get(playerId);
    if (!opts.approved) this.requireEditable(d);
    const r = this.resolve(d);
    if (!r.draft) throw new Error(r.errors[0]?.message ?? "Finish your character first.");
    if (!r.ok && !opts.approved) throw new Error(`Not ready: ${r.errors[0].message} Fix it, or send it to the host for approval.`);
    const other = this.otherCharacter(playerId, d);
    if (other) throw new Error(`${this.player(playerId).name} already plays ${other.name}.`);
    const name = this.player(playerId).name;
    if (d.status === "joined" && d.characterId) {
      const patch: Partial<Character> = Object.fromEntries(EDIT_FIELDS.map((k) => [k, r.draft![k]]).filter(([, v]) => v !== undefined));
      // Before play: full HP at the new maximum; gear follows the packages (gold too).
      patch.hp = r.draft.maxHp;
      patch.inventory = Character.shape.inventory.parse((r.draft.inventory ?? []).map((i) => ({ ...i, id: i.id || newId("item") })));
      patch.gold = r.draft.gold;
      if (d.portraitUrl) patch.spriteUrl = d.portraitUrl;
      this.host.updateCharacter(d.characterId, patch);
      this.host.log(`${name} updated ${r.draft.name} on their phone${opts.approved ? " (approved by the host)" : ""}.`);
    } else {
      const ch = this.host.addCharacter({ ...r.draft, ...(d.rosterId ? { rosterId: d.rosterId } : {}) }, playerId, { spriteUrl: d.portraitUrl });
      d.characterId = ch.id;
      this.host.log(`${name} created ${ch.name} on their phone${opts.approved ? " (approved by the host)" : ""}.`);
    }
    try {
      d.rosterId = this.host.saveToRoster(d.characterId!).rosterId;
    } catch (err) {
      console.warn(`Saving ${r.draft.name} to the roster failed: ${(err as Error).message}`);
    }
    d.status = "joined";
    d.hostMessage = "";
    d.playerNote = "";
    this.put(d);
    return this.view(playerId);
  }

  /** Send a draft that breaks a rule to the host, with a note ("rolled at the table"). */
  submit(playerId: string, note: unknown): CreationView {
    const d = this.get(playerId);
    this.requireEditable(d);
    const r = this.resolve(d);
    if (!r.draft) throw new Error(r.errors[0]?.message ?? "Finish your character first.");
    const other = this.otherCharacter(playerId, d);
    if (other) throw new Error(`${this.player(playerId).name} already plays ${other.name}.`);
    d.playerNote = typeof note === "string" ? note.trim().slice(0, 500) : "";
    d.status = "pending";
    d.hostMessage = "";
    this.put(d);
    this.host.log(`${this.player(playerId).name} sent ${r.draft.name} to the host for approval.`);
    return this.view(playerId);
  }

  /** Take a pending draft back to keep editing. */
  withdraw(playerId: string): CreationView {
    const d = this.get(playerId);
    if (d.status !== "pending") throw new Error("Nothing is waiting for the host.");
    d.status = d.characterId ? "joined" : "draft";
    this.put(d);
    return this.view(playerId);
  }

  /** Host: the drafts waiting for approval, with what breaks the rules. */
  pending(): (CreationView & { playerName: string })[] {
    const c = this.host.campaign();
    return this.host.store
      .listCreationDrafts(c.id)
      .filter((d) => d.status === "pending" && this.host.state().players.some((p) => p.id === d.playerId))
      .map((d) => ({ ...this.view(d.playerId), playerName: this.player(d.playerId).name }));
  }

  approve(playerId: string): CreationView {
    if (this.get(playerId).status !== "pending") throw new Error("That character isn't waiting for approval.");
    return this.join(playerId, { approved: true });
  }

  /** Host: send a pending draft back with a message. */
  sendBack(playerId: string, message: unknown): CreationView {
    const d = this.get(playerId);
    if (d.status !== "pending") throw new Error("That character isn't waiting for approval.");
    d.status = "returned";
    d.hostMessage = typeof message === "string" ? message.trim().slice(0, 500) : "";
    this.put(d);
    return this.view(playerId);
  }

  options(): CreationOptions {
    return this.host.options(this.level);
  }

  /**
   * A line to the AI helper. The turn runs in the background (chatBusy until it ends); its patch is
   * merged onto the draft as it is then (the player may keep building by hand), and a `creation`
   * event tells the phone to refetch. A failure becomes a system line in the chat.
   */
  chat(playerId: string, raw: unknown): CreationView {
    const d = this.get(playerId);
    this.requireEditable(d);
    const llm = this.host.chatLlm();
    if (!llm) throw new Error("The AI helper needs a brain key (OPENAI_API_KEY or ANTHROPIC_API_KEY). Use Build instead.");
    if (d.chatBusy) throw new Error("The helper is still answering.");
    const text = sayText(raw);
    if (!text) throw new Error("Type something first.");
    const player = this.player(playerId);
    const before = this.resolve(d);
    const s = this.host.campaign().creation;
    const input: ChatInput = {
      playerName: player.name,
      level: this.level,
      methods: s.abilityMethods,
      allowHomebrew: s.allowHomebrew,
      rolledScores: d.rolledScores,
      options: this.options(),
      choices: d.choices,
      errors: before.errors,
      warnings: before.warnings,
      derived: derivedSummary(before.draft),
      history: d.chat,
      text,
    };
    d.chat = [...d.chat, { role: "player" as const, text, ts: Date.now() }].slice(-CHAT_KEEP);
    d.chatBusy = true;
    if (d.status === "returned") d.status = "draft";
    this.put(d);
    const campaignId = this.host.campaign().id;
    const start = d.choices;
    const deps: ChatDeps = {
      apply: (patch) => {
        const choices = mergeChoices(start, patch, { fromAi: true });
        const r = resolveChoices(choices, this.context(d));
        return { choices, errors: r.errors, warnings: r.warnings, derived: derivedSummary(r.draft) };
      },
      lookup: (q) => this.host.lookup(q),
    };
    void this.host
      .job(`Character chat: ${player.name}`, () => runCreationTurn(llm, input, deps))
      .then((res) => this.finishChat(campaignId, playerId, res))
      .catch((err) => this.finishChat(campaignId, playerId, undefined, err as Error));
    return this.view(playerId);
  }

  private finishChat(campaignId: string, playerId: string, res: ChatResult | undefined, err?: Error) {
    if (this.host.campaign().id !== campaignId) return; // the host loaded another campaign meanwhile
    if (!this.host.state().players.some((p) => p.id === playerId)) return;
    const d = this.get(playerId);
    d.chatBusy = false;
    const now = Date.now();
    if (res) {
      // A pending or locked draft (the player sent it off meanwhile) keeps its choices; the reply still shows.
      const editable = d.status !== "pending" && !(d.status === "joined" && this.locked());
      if (editable) {
        try {
          d.choices = mergeChoices(d.choices, res.patch, { fromAi: true });
        } catch {
          /* a patch that no longer parses is dropped */
        }
      }
      d.chat = [...d.chat, { role: "ai" as const, text: res.reply, ts: now }].slice(-CHAT_KEEP);
    } else {
      console.warn(`Character chat failed: ${err?.message}`);
      d.chat = [...d.chat, { role: "system" as const, text: "The helper couldn't answer just now. Try again, or switch to Build.", ts: now }].slice(-CHAT_KEEP);
    }
    this.put(d);
    if (res?.drawPortrait && this.host.imagesAvailable() && d.choices.name && d.choices.appearance && !d.portraitBusy && d.portraitDraws < PORTRAIT_MAX_DRAWS) {
      try {
        this.drawPortrait(playerId, !!d.portraitUrl);
      } catch {
        /* no portrait this time */
      }
    }
  }
}
