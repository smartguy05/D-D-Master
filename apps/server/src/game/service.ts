import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  Campaign,
  Character,
  DiceMode,
  emptyGameState,
  ToolArgs,
  isToolName,
  type DmMode,
  type DmStatus,
  type GameState,
  type Location,
  type LogEntry,
  type MapFeature,
  type Monster,
  type Player,
  type ServerEvent,
} from "@dm/shared";
import { config } from "../config.js";
import { Store, type ActiveCall } from "../db/index.js";
import { Hub } from "../hub.js";
import { cryptoRng, newId } from "../engine/ids.js";
import { addLog } from "../engine/state.js";
import { ensureCharacterTokens, executeEngineTool, isEngineTool, restageForMap, type EngineContext } from "../engine/tools.js";
import { RulesIndex } from "../rules/srd.js";
import { MonsterCatalog } from "../rules/monsters.js";
import { ImageService } from "../images/index.js";
import { createProvider, type LLMProvider } from "../brain/provider.js";
import { consult, generateOutline, generatePregens, parseCharacterSheet, readMapFeatures, summarizeSession, type CharacterDraft } from "../brain/content.js";
import { SpeakerService } from "../speaker/service.js";
import { buildInstructions, openingPrompt } from "../realtime/instructions.js";
import { createVoiceCall, DmSession, type DmHost, type DmSessionOptions, type SpeakerTurn } from "../realtime/session.js";
import { restoredState, sameState, StateHistory, toolLabel, type HistoryEntry } from "./history.js";
import { buildBundle, encodeBundle, decodeBundle, importBundle } from "./bundle.js";
import { mergeOutline } from "./outline.js";
import { createNpcVoice, speakAsNpc } from "../realtime/npc-voice.js";
import { NpcClipQueue } from "../realtime/npc-queue.js";
import { builderPrompt, draftSummary, finalizeDraft, mergeDraft, startBuilder } from "./builder.js";
import { authorizePhysicalRoll, checkPlayerRoll, parseTotal, playerCharacter } from "./player.js";

const TOKEN_COLORS = ["#e0b83c", "#4fa3e0", "#e05a4f", "#62c370", "#b07ce0", "#e08a3c", "#3cc9c0", "#e05ab5"];
/** A saved voice call older than this is not re-attached after a restart (Realtime sessions are capped at 60 min). */
export const VOICE_CALL_MAX_AGE_MS = 60 * 60_000;
/** The note the DM gets after the server re-attached to a live call. */
export const RESTART_NOTE =
  "[The game server restarted and re-attached to this call. Tool calls that were in flight may be lost; the game state is current (see instructions). Do not greet or recap; wait for the players and continue naturally.]";

export interface GameServiceOptions {
  /** Options for every DmSession (tests inject a fake socket factory and short retry delays). */
  dmSession?: DmSessionOptions;
}

/** A host "who's speaking" tap applies to turns ending within this window. */
const MANUAL_SPEAKER_MS = 20_000;

export class GameService {
  readonly store: Store;
  readonly hub = new Hub();
  readonly rules = new RulesIndex();
  readonly monsters = new MonsterCatalog();
  readonly images = new ImageService();
  readonly speaker: SpeakerService;
  readonly history: StateHistory;
  readonly brain: LLMProvider | undefined = createProvider();
  readonly npcVoice = createNpcVoice();
  /** speak_as_npc clips: played on /table only while the DM is silent, one at a time. */
  readonly npcClips = new NpcClipQueue({ broadcast: (ev) => this.hub.broadcast(ev) });

  campaign: Campaign | null = null;
  state: GameState | null = null;
  private dm?: DmSession;
  private dmStatus: DmStatus = "offline";
  private dmMode: DmMode = "none";
  private manualSpeaker?: { playerId: string; ts: number };
  private lastUnconfirmed?: Float32Array;
  private sessionStartTs = Date.now();

  private readonly dmSessionOpts: DmSessionOptions;

  constructor(store?: Store, opts: GameServiceOptions = {}) {
    this.dmSessionOpts = opts.dmSession ?? {};
    this.store = store ?? new Store(join(config.dataDir, "dm.sqlite"));
    this.speaker = new SpeakerService(this.store);
    this.history = new StateHistory(this.store);
    this.hub.setSnapshot(() => {
      const evs: ServerEvent[] = [
        { type: "campaign", campaign: this.campaign },
        { type: "dm_status", status: this.dmStatus, mode: this.dmMode },
      ];
      if (this.state) evs.push({ type: "state", state: this.state });
      return evs;
    });
  }

  async init() {
    this.rules.loadSrd(config.srdDir);
    await this.rules.loadCustom(config.customRulesDir);
    this.monsters.load(config.srdDir);
    // Read before loadCampaign, whose stopDm() clears the record.
    const call = this.store.getActiveCall();
    const last = this.store.listCampaigns()[0];
    if (last) this.loadCampaign(last.id);
    if (call && this.campaign?.id === call.campaignId && Date.now() - call.startedAt < VOICE_CALL_MAX_AGE_MS) {
      void this.reattachVoice(call);
    } else if (call) {
      this.store.clearActiveCall();
    }
  }

  /**
   * After a server restart the browser's WebRTC call is still live, but nothing runs its tools.
   * Re-open the sideband to the saved call_id (with retries), push fresh instructions and tell
   * the DM. No greeting and no response: the DM waits for the next player turn. On failure the
   * record is cleared and the DM stays offline; the host banner offers Reconnect.
   */
  private async reattachVoice(call: ActiveCall): Promise<boolean> {
    const owner: { dm?: DmSession } = {};
    const host = this.dmHost(owner);
    const dm = new DmSession(host, "voice", call.callId, { ...this.dmSessionOpts, retryFirstConnect: true });
    owner.dm = dm;
    this.dm = dm;
    this.store.setActiveCall(call);
    console.log(`Re-attaching to voice call ${call.callId} after a restart…`);
    try {
      await dm.connect();
    } catch (err) {
      if (dm.closedByCaller) return false; // superseded by Stop / a new call
      if (this.dm === dm) this.dm = undefined;
      this.store.clearActiveCall();
      host.onError(`Could not re-attach to the voice call after the restart (${(err as Error).message}). Press Reconnect on the host.`);
      return false;
    }
    if (this.dm !== dm) return false;
    dm.refreshInstructions();
    dm.addSystemNote(RESTART_NOTE);
    this.log({ kind: "system", text: "Server restarted: re-attached to the live voice call." });
    return true;
  }

  capabilities() {
    return {
      openai: !!config.openaiKey,
      brain: this.brain ? `${this.brain.name}:${this.brain.model}` : null,
      images: this.images.available,
      voiceId: this.speaker.available,
      voiceIdStatus: this.speaker.status,
      rulesChunks: this.rules.chunks.length,
      srdMonsters: this.monsters.size,
      npcVoices: this.npcVoice.available,
    };
  }

  // ---------- state plumbing ----------

  private requireState(): GameState {
    if (!this.state || !this.campaign) throw new Error("No campaign loaded.");
    return this.state;
  }

  private requireCampaign(): Campaign {
    if (!this.campaign) throw new Error("No campaign loaded.");
    return this.campaign;
  }

  private engineCtx(): EngineContext {
    return {
      rng: cryptoRng,
      monsterTemplate: (name) => this.monsters.find(name),
      locations: this.campaign?.outline?.locations ?? [],
    };
  }

  /** Persist + broadcast the current state. With a label, the previous state goes to undo history. */
  private commit(state: GameState, label?: string) {
    if (label && this.state && this.state !== state) this.history.record(this.state, label);
    this.state = state;
    this.store.saveState(state);
    this.hub.broadcast({ type: "state", state });
  }

  private mutate(fn: (s: GameState) => void, label?: string) {
    const s = structuredClone(this.requireState());
    fn(s);
    s.version += 1;
    this.commit(s, label);
  }

  private saveCampaign() {
    const c = this.requireCampaign();
    this.store.saveCampaign(c);
    this.hub.broadcast({ type: "campaign", campaign: c });
  }

  private log(entry: Omit<LogEntry, "id" | "ts">) {
    if (!this.state) return;
    this.mutate((s) => void addLog(s, entry));
    if (this.campaign) this.store.appendEvent(this.campaign.id, "log", entry);
  }

  private async job<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const id = newId("job");
    this.hub.broadcast({ type: "job", id, label, status: "running" });
    try {
      const res = await fn();
      this.hub.broadcast({ type: "job", id, label, status: "done" });
      return res;
    } catch (err) {
      this.hub.broadcast({ type: "job", id, label, status: "error", detail: (err as Error).message });
      throw err;
    }
  }

  private requireBrain(): LLMProvider {
    if (!this.brain) throw new Error(`No brain configured: set ${config.brainProvider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"}.`);
    return this.brain;
  }

  // ---------- campaigns ----------

  listCampaigns() {
    return this.store.listCampaigns();
  }

  createCampaign(input: { name: string; premise?: string; partyLevel?: number }): Campaign {
    const now = Date.now();
    const c = Campaign.parse({ id: newId("cmp"), name: input.name || "New Adventure", premise: input.premise ?? "", partyLevel: input.partyLevel ?? 1, createdAt: now, updatedAt: now });
    this.store.saveCampaign(c);
    this.store.saveState(emptyGameState(c.id));
    this.loadCampaign(c.id);
    return c;
  }

  loadCampaign(id: string) {
    const c = this.store.getCampaign(id);
    if (!c) throw new Error(`Unknown campaign ${id}`);
    this.stopDm();
    this.campaign = c;
    this.state = this.store.getState(id) ?? emptyGameState(id);
    this.sessionStartTs = Date.now();
    this.hub.broadcast({ type: "campaign", campaign: c });
    this.hub.broadcast({ type: "state", state: this.state });
  }

  deleteCampaign(id: string) {
    if (this.campaign?.id === id) {
      this.stopDm();
      this.campaign = null;
      this.state = null;
      this.hub.broadcast({ type: "campaign", campaign: null });
    }
    this.store.deleteCampaign(id);
    rmSync(join(config.dataDir, id), { recursive: true, force: true });
  }

  async generateOutline(input: { premise?: string; length?: "one-shot" | "short" | "campaign" }) {
    const c = this.requireCampaign();
    const brain = this.requireBrain();
    if (input.premise !== undefined) c.premise = input.premise;
    const outline = await this.job("Writing the adventure", () =>
      generateOutline(brain, { premise: c.premise, partyLevel: c.partyLevel, partySize: Math.max(1, this.state?.characters.length || 4), length: input.length ?? "one-shot" }, this.monsters.names()),
    );
    c.outline = outline;
    if (c.name === "New Adventure") c.name = outline.title;
    this.saveCampaign();
    const first = outline.locations[0];
    if (first) {
      this.mutate((s) => {
        s.locationId = first.id;
        ensureCharacterTokens(s, this.engineCtx());
      });
      void this.generateMap(first.id).catch(() => undefined);
    }
    this.dm?.refreshInstructions();
    return outline;
  }

  async generateMap(locationId: string, force = false) {
    const c = this.requireCampaign();
    const loc = c.outline?.locations.find((l) => l.id === locationId);
    if (!loc) throw new Error(`Unknown location ${locationId}`);
    if (loc.mapUrl && !force) return loc.mapUrl;
    const url = await this.job(`Painting map: ${loc.name}`, () => this.images.map(c.id, `${loc.name}. ${loc.mapPrompt || loc.description}`));
    loc.mapUrl = url;
    loc.features = await this.readFeatures(loc);
    this.saveCampaign();
    // A new picture invalidates positions on the old one: restage the scene the party is in.
    if (loc.features.length && this.state?.locationId === loc.id) {
      const next = restageForMap(this.state, this.engineCtx());
      if (next !== this.state) this.commit(next, `map read: restage ${loc.name}`);
    }
    this.dm?.refreshInstructions();
    return url;
  }

  /** Locate entrance, focal and lit features on a location's painted map. [] without a brain or on failure. */
  private async readFeatures(loc: Location): Promise<MapFeature[]> {
    const image = loc.mapUrl ? this.images.readAsset(loc.mapUrl) : undefined;
    if (!this.brain || !image) return [];
    try {
      return await this.job(`Reading map: ${loc.name}`, () => readMapFeatures(this.brain!, loc, image));
    } catch {
      return [];
    }
  }

  async endSession(): Promise<string> {
    const c = this.requireCampaign();
    const s = this.requireState();
    const transcript = this.store
      .eventsSince(c.id, this.sessionStartTs)
      .filter((e) => e.type === "log")
      .map((e) => {
        const p = e.payload as { speaker?: string; text: string };
        return `${p.speaker ? `${p.speaker}: ` : ""}${p.text}`;
      })
      .join("\n");
    const summary = this.brain
      ? await this.job("Writing session recap", () => summarizeSession(this.brain!, c, s, transcript))
      : `Session log:\n${transcript.slice(-3000)}`;
    c.sessionSummaries.push({ ts: Date.now(), summary });
    this.saveCampaign();
    this.stopDm();
    this.sessionStartTs = Date.now();
    return summary;
  }

  // ---------- players & characters ----------

  addPlayer(name: string): Player {
    const p: Player = { id: newId("plr"), name: name.trim(), voiceSamples: 0 };
    this.mutate((s) => void s.players.push(p), `host edit: add player ${p.name}`);
    return p;
  }

  updatePlayer(id: string, patch: Partial<Pick<Player, "name" | "characterId">>) {
    this.mutate((s) => {
      const p = s.players.find((x) => x.id === id);
      if (!p) throw new Error("Unknown player");
      Object.assign(p, patch);
      const ch = s.characters.find((c) => c.id === p.characterId);
      if (ch) ch.playerName = p.name;
    }, `host edit: player ${patch.name ?? id}`);
    this.dm?.refreshInstructions();
  }

  removePlayer(id: string) {
    const c = this.requireCampaign();
    this.store.deleteVoiceprint(c.id, id);
    this.mutate((s) => void (s.players = s.players.filter((p) => p.id !== id)), `host edit: remove player ${this.state?.players.find((p) => p.id === id)?.name ?? id}`);
  }

  private characterFromDraft(draft: Partial<CharacterDraft> & { name: string }, s: GameState): Character {
    const maxHp = draft.maxHp ?? 10;
    return Character.parse({
      ...draft,
      id: newId("pc"),
      playerName: draft.playerName ?? "",
      maxHp,
      hp: maxHp,
      color: TOKEN_COLORS[s.characters.length % TOKEN_COLORS.length],
      inventory: (draft.inventory ?? []).map((i) => ({ ...i, id: i.id || newId("item") })),
    });
  }

  addCharacter(draft: Partial<CharacterDraft> & { name: string }, playerId?: string): Character {
    let created!: Character;
    this.mutate((s) => {
      const player = s.players.find((p) => p.id === playerId);
      created = this.characterFromDraft({ ...draft, playerName: player?.name ?? draft.playerName ?? "" }, s);
      s.characters.push(created);
      if (player) player.characterId = created.id;
      ensureCharacterTokens(s, this.engineCtx());
    }, `host edit: add character ${draft.name}`);
    this.dm?.refreshInstructions();
    void this.generateCharacterSprite(created.id).catch(() => undefined);
    return created;
  }

  /** Host manual override: patch any character field (HP fixes, inventory edits...). */
  updateCharacter(id: string, patch: Partial<Character>) {
    this.mutate((s) => {
      const idx = s.characters.findIndex((c) => c.id === id);
      if (idx < 0) throw new Error("Unknown character");
      s.characters[idx] = Character.parse({ ...s.characters[idx], ...patch, id });
    }, `host edit: ${this.state?.characters.find((c) => c.id === id)?.name ?? id} (${Object.keys(patch).join(", ")})`);
    this.dm?.refreshInstructions();
  }

  removeCharacter(id: string) {
    this.mutate((s) => {
      s.characters = s.characters.filter((c) => c.id !== id);
      s.tokens = s.tokens.filter((t) => t.entityId !== id);
      for (const p of s.players) if (p.characterId === id) p.characterId = undefined;
    }, `host edit: remove character ${this.state?.characters.find((c) => c.id === id)?.name ?? id}`);
    this.dm?.refreshInstructions();
  }

  async generatePregens(count: number, wishes: string): Promise<CharacterDraft[]> {
    const brain = this.requireBrain();
    return this.job("Creating pregenerated characters", () => generatePregens(brain, this.campaign ?? undefined, count, this.campaign?.partyLevel ?? 1, wishes));
  }

  async importSheet(sheet: string, playerId?: string): Promise<Character> {
    const brain = this.requireBrain();
    const player = this.state?.players.find((p) => p.id === playerId);
    const draft = await this.job("Reading character sheet", () => parseCharacterSheet(brain, sheet, player?.name ?? ""));
    return this.addCharacter(draft, playerId);
  }

  async generateCharacterSprite(characterId: string) {
    const c = this.requireCampaign();
    const ch = this.requireState().characters.find((x) => x.id === characterId);
    if (!ch || !this.images.available) return;
    const desc = `${ch.name}, a ${ch.species} ${ch.className}. ${ch.appearance}`;
    const url = await this.job(`Drawing ${ch.name}`, () => this.images.sprite(c.id, desc));
    this.mutate((s) => {
      const x = s.characters.find((y) => y.id === characterId);
      if (x) x.spriteUrl = url;
    });
  }

  private async generateMonsterSprites(spawned: Monster[]) {
    if (!this.images.available || !this.campaign) return;
    const campaignId = this.campaign.id;
    const kinds = new Map<string, Monster>();
    for (const m of spawned) if (!m.spriteUrl) kinds.set((m.srdName ?? m.name.replace(/\s+\d+$/, "")).toLowerCase(), m);
    for (const [kind, m] of kinds) {
      const base = m.srdName ?? m.name.replace(/\s+\d+$/, "");
      try {
        const url = await this.job(`Drawing ${base}`, () => this.images.sprite(campaignId, `${base}, a D&D monster. Menacing, readable silhouette.`));
        this.mutate((s) => {
          for (const x of s.monsters) if ((x.srdName ?? x.name.replace(/\s+\d+$/, "")).toLowerCase() === kind) x.spriteUrl = url;
        });
      } catch {
        /* job event already reported the error */
      }
    }
  }

  // ---------- tools ----------

  /** Run a DM tool (from the Realtime model or the host's manual controls). */
  async runTool(name: string, args: unknown, source: "dm" | "host" = "dm"): Promise<unknown> {
    if (!isToolName(name)) throw new Error(`Unknown tool ${name}`);
    const c = this.requireCampaign();
    this.store.appendEvent(c.id, "tool", { name, args, source });

    if (isEngineTool(name)) {
      const before = this.requireState();
      const { state, outcome } = executeEngineTool(before, name, args, this.engineCtx());
      this.commit(state, sameState(before, state) ? undefined : toolLabel(name, args, before, source));
      for (const roll of outcome.rolls) this.hub.broadcast({ type: "roll", roll });
      for (const effect of outcome.effects) this.hub.broadcast({ type: "effect", effect });
      if (outcome.spawned.length) void this.generateMonsterSprites(outcome.spawned);
      if (outcome.sceneChanged) {
        this.dm?.refreshInstructions();
        void this.generateMap(outcome.sceneChanged).catch(() => undefined);
      }
      return outcome.output;
    }

    const a = (args ?? {}) as Record<string, string>;
    switch (name) {
      case "start_character_builder": {
        const b = ToolArgs.start_character_builder.parse(args ?? {});
        return this.startCharacterBuilder(b.player_id, b.level, "dm");
      }
      case "draft_character_update":
        return this.updateCharacterDraft(args);
      case "finalize_character":
        return this.finalizeCharacter();
      case "lookup_rule":
        return this.rules.lookup(String(a.query ?? ""));
      case "consult_brain":
        if (!this.brain) return "No planner available. Improvise something fun that fits the adventure.";
        return consult(this.brain, c, this.requireState(), String(a.question ?? ""));
      case "confirm_speaker":
        return this.confirmSpeaker(String(a.player_name ?? ""));
      case "speak_as_npc":
        return speakAsNpc(args, {
          campaignId: c.id,
          npcs: c.outline?.npcs ?? [],
          voice: this.npcVoice,
          reserve: () => {
            const slot = this.npcClips.reserve();
            // The DM's follow-up (and any player turn) waits until the clip has played.
            this.dm?.holdResponses(slot.done);
            return slot;
          },
          log: (speaker, text) => this.log({ kind: "dm", speaker, text }),
        });
    }
    throw new Error(`Unhandled tool ${name}`);
  }

  // ---------- undo history ----------

  listHistory(limit?: number): HistoryEntry[] {
    return this.campaign ? this.history.list(this.campaign.id, limit) : [];
  }

  /** Restore the state from just before the most recent labelled change. */
  undo() {
    const c = this.requireCampaign();
    const entry = this.history.latest(c.id);
    if (!entry) throw new Error("Nothing to undo.");
    return this.restoreEntry(entry, `Host undid: ${entry.label}`);
  }

  /** Restore the snapshot with this version (undoing its change and everything after it). */
  restoreHistory(version: number) {
    const c = this.requireCampaign();
    const entry = this.history.get(c.id, version);
    if (!entry) throw new Error(`No history entry with version ${version}.`);
    return this.restoreEntry(entry, `Host rewound to before: ${entry.label}`);
  }

  private restoreEntry(entry: HistoryEntry & { state: GameState }, note: string) {
    const c = this.requireCampaign();
    const vp = new Map(this.store.getVoiceprints(c.id).map((v) => [v.playerId, v.samples]));
    const s = restoredState(this.requireState(), entry.state, vp);
    this.history.truncateFrom(c.id, entry.id);
    const line = { kind: "system" as const, text: note };
    addLog(s, line);
    this.commit(s);
    this.store.appendEvent(c.id, "log", line);
    this.store.appendEvent(c.id, "undo", { version: entry.version, label: entry.label });
    this.dm?.refreshInstructions();
    this.dm?.addSystemNote(`${note}. The game state was rolled back; treat that action as never having happened and continue from the current state.`);
    return { ok: true, restored: { version: entry.version, label: entry.label } };
  }

  // ---------- export / import / outline editing ----------

  exportCampaign(id: string, opts: { events?: boolean } = {}): { campaign: Campaign; data: Buffer } {
    const bundle = buildBundle(this.store, config.dataDir, id, opts);
    return { campaign: bundle.campaign as Campaign, data: encodeBundle(bundle) };
  }

  /** Import an exported campaign as a NEW campaign (never overwrites). Does not load it. */
  importCampaign(input: Buffer | string | object): Campaign {
    return importBundle(this.store, config.dataDir, decodeBundle(input), newId("cmp"));
  }

  /** Host edited the outline: validate, keep maps whose prompt didn't change, refresh the DM. */
  updateOutline(input: unknown) {
    const c = this.requireCampaign();
    c.outline = mergeOutline(c.outline, input);
    this.saveCampaign();
    this.dm?.refreshInstructions();
    return c.outline;
  }

  // ---------- player phones (/player) - pure checks in game/player.ts ----------

  /** Tell the running DM something (system note + response). Returns false if no DM is running. */
  notifyDm(text: string): boolean {
    if (!this.dm?.isOpen) return false;
    this.dm.prompt(text);
    return true;
  }

  /** A virtual-dice player tapped "roll" on their phone: roll, animate on the TV, tell the DM. */
  async playerRoll(playerId: string, notation: string, label: string) {
    const r = checkPlayerRoll(this.requireState(), playerId, notation, label);
    const result = (await this.runTool("roll_dice", { notation: r.notation, label: r.label, roller_id: r.character.id }, "host")) as { total: number };
    const dmInformed = this.notifyDm(
      `Player roll (from ${r.player.name}'s phone, not requested by you): ${r.player.name} as ${r.character.name} rolled ${r.label || r.notation}: ${result.total}. React only if it matters right now.`,
    );
    return { ...result, dmInformed };
  }

  /** Physical dice total from the host (Play tab) or from the rolling player's phone. */
  async submitPhysicalRoll(input: { total: unknown; playerId?: string; characterId?: string }) {
    const s = this.requireState();
    const total = parseTotal(input.total);
    const characterId = authorizePhysicalRoll(s, input);
    const pending = s.pendingRoll;
    const result = await this.runTool(
      "record_physical_roll",
      { character_id: characterId, notation: pending?.notation ?? "1d20", label: pending?.label ?? "Roll", total, dc: pending?.dc },
      "host",
    );
    this.notifyDm(`Host note (do not read aloud): ${JSON.stringify(result)} - the player rolled physical dice; continue.`);
    return result;
  }

  /** Players may switch their own dice mode (nothing else) from their phone. */
  setPlayerDiceMode(playerId: string, mode: unknown) {
    const { character } = playerCharacter(this.requireState(), playerId);
    this.updateCharacter(character.id, { diceMode: DiceMode.parse(mode) });
  }

  // ---------- voice character builder - pure logic in game/builder.ts ----------

  private requireBuilder() {
    const b = this.requireState().builder;
    if (!b) throw new Error("No character is being built. Start with start_character_builder.");
    return b;
  }

  startCharacterBuilder(playerId: string, level: number | undefined, source: "dm" | "host" = "host") {
    const lvl = level ?? this.requireCampaign().partyLevel;
    let b!: ReturnType<typeof startBuilder>;
    this.mutate((s) => void (b = startBuilder(s, playerId, lvl)));
    this.log({ kind: "system", text: `Character builder started for ${b.playerName} (level ${b.level}).` });
    this.dm?.refreshInstructions();
    if (source === "host") this.notifyDm(builderPrompt(b));
    return { ...draftSummary(b), how: builderPrompt(b) };
  }

  /** Merge fields into the live draft (DM tool, or host edits with an optional level change). */
  updateCharacterDraft(patch: unknown, level?: number) {
    this.requireBuilder();
    let b!: NonNullable<GameState["builder"]>;
    this.mutate((s) => {
      b = s.builder!;
      b.draft = mergeDraft(b.draft, patch);
      if (level !== undefined) b.level = Math.min(20, Math.max(1, Math.trunc(level)));
      b.updatedAt = Date.now();
    });
    return draftSummary(b);
  }

  finalizeCharacter() {
    const b = this.requireBuilder();
    const res = finalizeDraft(b);
    if (!res.ok) return { ok: false, missing: res.missing, message: `Still missing: ${res.missing.join(", ")}` };
    const ch = this.addCharacter(res.character, b.playerId);
    this.mutate((s) => void (s.builder = undefined));
    this.log({ kind: "system", text: `${b.playerName} created ${ch.name}, a ${ch.species} ${ch.className} ${ch.level}.` });
    this.dm?.refreshInstructions();
    return { ok: true, character: { id: ch.id, name: ch.name, player: b.playerName, class: `${ch.species} ${ch.className} ${ch.level}`, hp: ch.maxHp, ac: ch.ac } };
  }

  cancelCharacterBuilder() {
    const b = this.requireState().builder;
    if (!b) return;
    this.mutate((s) => void (s.builder = undefined));
    this.dm?.refreshInstructions();
    this.notifyDm(`Host note (do not read aloud): the host cancelled building ${b.playerName}'s character. Resume the adventure.`);
  }

  // ---------- speaker identification ----------

  pushAudio(chunk: Buffer) {
    this.speaker.ring.pushPcm16(chunk);
  }

  startEnrollment(playerId: string) {
    if (!this.speaker.available) throw new Error(this.speaker.status);
    this.speaker.startEnrollment(playerId);
  }

  finishEnrollment(playerId: string) {
    const c = this.requireCampaign();
    const res = this.speaker.finishEnrollment(c.id, playerId);
    if (res.ok) {
      this.mutate((s) => {
        const p = s.players.find((x) => x.id === playerId);
        if (p) p.voiceSamples = res.samples;
      });
    }
    this.hub.broadcast({ type: "enroll", playerId, ...res });
    return res;
  }

  /** Host tapped a "who's speaking" button. */
  setManualSpeaker(playerId: string | null) {
    this.manualSpeaker = playerId ? { playerId, ts: Date.now() } : undefined;
    if (playerId) this.announceSpeaker(playerId, 1);
  }

  private speakerLabel(playerId: string) {
    const s = this.requireState();
    const p = s.players.find((x) => x.id === playerId);
    const ch = s.characters.find((x) => x.id === p?.characterId);
    return { player: p, character: ch, label: p ? `${p.name}${ch ? ` as ${ch.name}` : ""}` : "unknown" };
  }

  private announceSpeaker(playerId: string, confidence: number) {
    const { player, character } = this.speakerLabel(playerId);
    if (!player) return;
    const speaker = { playerId, playerName: player.name, characterName: character?.name, confidence, ts: Date.now() };
    this.state = { ...this.requireState(), activeSpeaker: speaker };
    this.hub.broadcast({ type: "speaker", speaker });
  }

  /**
   * Speaker ID for one voice turn. Side effects (announcing the speaker, consuming the host's
   * tap, keeping a low-confidence sample for confirm_speaker) happen in `accept()`, which the DM
   * session calls only if the turn is answered, so a skipped noise turn changes nothing.
   */
  identifySpeaker(fromTs: number, toTs: number): SpeakerTurn {
    const s = this.requireState();
    const c = this.requireCampaign();
    const manual = this.manualSpeaker;
    if (manual && Date.now() - manual.ts < MANUAL_SPEAKER_MS) {
      const { label } = this.speakerLabel(manual.playerId);
      return {
        note: `[speaker: ${label} (selected by host)]`,
        label,
        accept: () => {
          this.announceSpeaker(manual.playerId, 1);
          if (this.manualSpeaker === manual) this.manualSpeaker = undefined;
        },
      };
    }
    const withChars = s.players.filter((p) => p.characterId);
    if (withChars.length === 1) {
      const { label } = this.speakerLabel(withChars[0].id);
      return { note: `[speaker: ${label}]`, label };
    }
    let result: ReturnType<SpeakerService["identify"]> = {};
    try {
      result = this.speaker.identify(c.id, fromTs, toTs);
    } catch (err) {
      console.warn("speaker identify failed", err);
    }
    const { match, embedding } = result;
    if (!match) {
      return { note: "[speaker: unknown - voice ID has no match; if it matters, ask who is acting]" };
    }
    const { label } = this.speakerLabel(match.playerId);
    if (match.confident) {
      return {
        note: `[speaker: ${label}, confidence ${match.score.toFixed(2)}]`,
        label,
        accept: () => {
          this.lastUnconfirmed = undefined;
          this.announceSpeaker(match.playerId, match.score);
        },
      };
    }
    return {
      note: `[speaker: unknown, possibly ${label} (low confidence ${match.score.toFixed(2)}) - ask if unclear, then call confirm_speaker]`,
      label: `${label}?`,
      accept: () => void (this.lastUnconfirmed = embedding),
    };
  }

  private confirmSpeaker(playerName: string) {
    const s = this.requireState();
    const lower = playerName.toLowerCase();
    const p =
      s.players.find((x) => x.name.toLowerCase() === lower) ??
      s.players.find((x) => s.characters.find((ch) => ch.id === x.characterId)?.name.toLowerCase() === lower);
    if (!p) return { ok: false, error: `No player named ${playerName}. Players: ${s.players.map((x) => x.name).join(", ")}` };
    if (this.lastUnconfirmed && this.campaign) {
      const samples = this.speaker.addSample(this.campaign.id, p.id, this.lastUnconfirmed);
      this.lastUnconfirmed = undefined;
      this.mutate((st) => {
        const x = st.players.find((y) => y.id === p.id);
        if (x) x.voiceSamples = samples;
      });
    }
    this.announceSpeaker(p.id, 1);
    return { ok: true, speaker: this.speakerLabel(p.id).label };
  }

  // ---------- the voice/text DM ----------

  /**
   * Host callbacks for one DmSession. `owner.dm` is that session (set right after it is built):
   * statuses from a session that is no longer current are ignored, and when the current session
   * goes offline on its own (first connect failed, or it gave up reconnecting) it is dropped and
   * the saved call record cleared, so a later restart doesn't try to re-attach to a dead call.
   */
  private dmHost(owner: { dm?: DmSession } = {}): DmHost {
    return {
      instructions: () => buildInstructions(this.campaign ?? undefined, this.requireState(), { npcTts: this.npcVoice.available }),
      npcTts: this.npcVoice.available,
      recentContext: () =>
        (this.state?.log ?? [])
          .filter((l) => l.kind === "dm" || l.kind === "player" || l.kind === "roll")
          .slice(-15)
          .map((l) => `${l.speaker ? `${l.speaker}: ` : ""}${l.text}`)
          .join("\n")
          .slice(-3000),
      opening: () => openingPrompt(this.campaign ?? undefined, this.requireState()),
      runTool: (name, args) => this.runTool(name, args, "dm"),
      identifySpeaker: (from, to) => this.identifySpeaker(from, to),
      onPlayerText: (text, label) => this.log({ kind: "player", speaker: label ?? "Player", text }),
      onDmText: (text) => this.log({ kind: "dm", speaker: "DM", text }),
      onStatus: (status, mode) => {
        if (owner.dm && this.dm !== owner.dm) return;
        if (status === "offline" && owner.dm) {
          this.dm = undefined;
          this.store.clearActiveCall();
          this.npcClips.clear();
        }
        this.npcClips.setDmSpeaking(status === "speaking");
        this.dmStatus = status;
        this.dmMode = mode;
        this.hub.broadcast({ type: "dm_status", status, mode });
      },
      onError: (message) => {
        console.warn(message);
        this.hub.broadcast({ type: "error", message });
      },
    };
  }

  /**
   * Browser sends its WebRTC offer; we create the call and attach the sideband socket.
   * `resume`: the browser rebuilt a dropped call, so the DM continues instead of re-greeting.
   */
  async startVoice(offerSdp: string, resume = false): Promise<string> {
    this.requireState();
    this.stopDm();
    const owner: { dm?: DmSession } = {};
    const host = this.dmHost(owner);
    const { answerSdp, callId } = await createVoiceCall(host, offerSdp);
    const dm = new DmSession(host, "voice", callId, this.dmSessionOpts);
    owner.dm = dm;
    this.dm = dm;
    this.store.setActiveCall({ callId, campaignId: this.requireCampaign().id, startedAt: Date.now() });
    // Attach after returning the answer so the peer connection can complete.
    setTimeout(() => {
      dm.connect()
        .then(() => (resume ? dm.resume() : dm.begin()))
        .catch((err) => {
          if (dm.closedByCaller) return; // stopped or replaced before it opened
          this.store.clearActiveCall();
          host.onError(`Sideband connect failed: ${(err as Error).message}`);
        });
    }, 250);
    return answerSdp;
  }

  async startText() {
    this.requireState();
    if (!config.openaiKey) throw new Error("OPENAI_API_KEY is not set.");
    this.stopDm();
    const owner: { dm?: DmSession } = {};
    const dm = new DmSession(this.dmHost(owner), "text", undefined, this.dmSessionOpts);
    owner.dm = dm;
    this.dm = dm;
    await dm.connect();
    dm.begin();
  }

  stopDm() {
    this.dm?.close();
    this.dm = undefined;
    this.store.clearActiveCall();
    this.npcClips.clear();
    this.dmStatus = "offline";
    this.dmMode = "none";
    this.hub.broadcast({ type: "dm_status", status: "offline", mode: "none" });
  }

  /** /table finished (or skipped, when muted) an NPC clip: the DM may continue. */
  npcClipEnded(url: string): { ok: boolean } {
    return { ok: this.npcClips.clipEnded(url) };
  }

  /** Host "Stop talking": cut the DM off mid-narration (players can't by voice). */
  stopTalking(): { stopped: boolean } {
    const stopped = this.requireLiveDm().stopTalking();
    if (stopped) this.log({ kind: "system", text: "The host stopped the DM mid-sentence." });
    return { stopped };
  }

  private requireLiveDm(): DmSession {
    if (this.dm?.isReconnecting) throw new Error("The DM is reconnecting; try again in a moment.");
    if (!this.dm?.isOpen) throw new Error("The DM is not running.");
    return this.dm;
  }

  /** Typed player input (text mode, or typing while voice is live). */
  sendText(text: string, playerId?: string) {
    const dm = this.requireLiveDm();
    const label = playerId ? this.speakerLabel(playerId).label : undefined;
    if (playerId) this.announceSpeaker(playerId, 1);
    this.log({ kind: "player", speaker: label ?? "Player", text });
    dm.sendPlayerText(text, label ? `[speaker: ${label} (typed)]` : "[speaker: unknown (typed)]");
  }

  /** Host whisper to the DM (e.g. "skip ahead", "be scarier"). */
  whisper(text: string) {
    this.requireLiveDm().prompt(`Host note (do not read aloud): ${text}`);
  }

  get dmState() {
    return { status: this.dmStatus, mode: this.dmMode };
  }
}
