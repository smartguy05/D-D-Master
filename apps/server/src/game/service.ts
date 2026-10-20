import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  Campaign,
  Character,
  DiceMode,
  emptyGameState,
  ToolArgs,
  isHostOnlyTool,
  isToolName,
  proficiencyBonusFor,
  type DmMode,
  type DmStatus,
  type GameState,
  type Location,
  type LogEntry,
  type MapFeature,
  type WallSeg,
  type Monster,
  type NpcFocusView,
  type Player,
  type ServerEvent,
} from "@dm/shared";
import { config } from "../config.js";
import { Store, type ActiveCall } from "../db/index.js";
import { Hub } from "../hub.js";
import { cryptoRng, newId } from "../engine/ids.js";
import { addLog } from "../engine/state.js";
import { stalledTurn } from "../engine/turns.js";
import { applyDerived, isDead, upgradeCharacters } from "../engine/rules/derive.js";
import { endLinkedToConcentration } from "../engine/rules/conditions.js";
import { normalizeSpellList } from "../brain/spells.js";
import { regainedHp } from "../engine/rules/vitals.js";
import { moment } from "../engine/moments.js";
import { spellLevelRows } from "../engine/rules/cast.js";
import { ensureCharacterTokens, executeEngineTool, isEngineTool, refogForWalls, resetForRepaint, restageForMap, titleCase, type EngineContext } from "../engine/tools.js";
import { RulesIndex } from "../rules/srd.js";
import { MonsterCatalog } from "../rules/monsters.js";
import { ClassCatalog } from "../rules/classes.js";
import { SpellCatalog } from "../rules/spells.js";
import { ImageService } from "../images/index.js";
import { createProvider, type LLMProvider } from "../brain/provider.js";
import { consult, generateOutline, generatePregens, parseCharacterSheet, readMapFeatures, summarizeSession, type CharacterDraft } from "../brain/content.js";
import { SpeakerService } from "../speaker/service.js";
import { LiveTalk } from "../speaker/live.js";
import { NpcFocus } from "../realtime/npc-focus.js";
import { buildInstructions, openingPrompt } from "../realtime/instructions.js";
import { createVoiceCall, DmSession, type DmHost, type DmSessionOptions, type SpeakerTurn } from "../realtime/session.js";
import { restoredState, sameState, StateHistory, toolLabel, type HistoryEntry } from "./history.js";
import { hostActionNote } from "./hostNote.js";
import { resetState, type ResetOptions } from "./reset.js";
import { buildBundle, encodeBundle, decodeBundle, importBundle } from "./bundle.js";
import { mergeOutline } from "./outline.js";
import { createNpcVoice, speakAsNpc } from "../realtime/npc-voice.js";
import { NpcClipQueue } from "../realtime/npc-queue.js";
import { builderPrompt, draftSummary, finalizeDraft, mergeDraft, startBuilder } from "./builder.js";
import { authorizePhysicalRoll, checkPlayerRoll, parseNatural, parseNotes, parseTotal, playerCharacter, spellSummaries } from "./player.js";

const TOKEN_COLORS = ["#e0b83c", "#4fa3e0", "#e05a4f", "#62c370", "#b07ce0", "#e08a3c", "#3cc9c0", "#e05ab5"];
/** A saved voice call older than this is not re-attached after a restart (Realtime sessions are capped at 60 min). */
export const VOICE_CALL_MAX_AGE_MS = 60 * 60_000;
/** The note the DM gets after the server re-attached to a live call. */
export const RESTART_NOTE =
  "[The game server restarted and re-attached to this call. Tool calls that were in flight may be lost; the game state is current (see instructions). Do not greet or recap; wait for the players and continue naturally.]";

export interface GameServiceOptions {
  /** Options for every DmSession (tests inject a fake socket factory and short retry delays). */
  dmSession?: DmSessionOptions;
  /** Creates the WebRTC call at OpenAI (default createVoiceCall; tests inject a fake). */
  createVoiceCall?: typeof createVoiceCall;
}

/** Sprite subject for a monster kind. Pre-draws and spawns must build the same text to share the image cache. */
/** A map read's features and walls (an older reader that returned only the feature list counts as no walls). */
function asMapRead(r: { features: MapFeature[]; walls: WallSeg[] } | MapFeature[]): { features: MapFeature[]; walls: WallSeg[] } {
  return Array.isArray(r) ? { features: r, walls: [] } : { features: r.features ?? [], walls: r.walls ?? [] };
}

const monsterSpriteSubject = (base: string) => `${base}, a D&D monster. Menacing, readable silhouette.`;
const monsterKind = (m: Monster) => m.srdName ?? m.name.replace(/\s+\d+$/, "");
/** Sprite subject for a named NPC. add_npc takes an outline NPC's description as its look, so pre-draws hit the cache. */
const npcSpriteSubject = (name: string, appearance?: string) => `${name}, a D&D character.${appearance ? ` ${appearance}` : ""}`;
/** Monsters of one kind share a sprite; a named NPC (add_npc) gets its own portrait. */
const spriteKey = (m: Monster) => (m.npc ? `npc:${m.name.toLowerCase()}` : monsterKind(m).toLowerCase());
const spriteSubject = (m: Monster) => (m.npc ? npcSpriteSubject(m.name, m.appearance) : monsterSpriteSubject(monsterKind(m)));

/** A host "who's speaking" tap applies to turns ending within this window. */
const MANUAL_SPEAKER_MS = 20_000;

export class GameService {
  readonly store: Store;
  readonly hub = new Hub();
  readonly rules = new RulesIndex();
  readonly monsters = new MonsterCatalog();
  readonly spells = new SpellCatalog();
  readonly classes = new ClassCatalog();
  readonly images = new ImageService();
  readonly speaker: SpeakerService;
  /** The NPC close-up on the TV (npc_focus / speak_as_npc) and its captions. */
  readonly npcFocus = new NpcFocus({ broadcast: (ev) => this.hub.broadcast(ev) });
  /** Live "who's talking" (mic level + voice ID mid-sentence) for the TV. */
  readonly liveTalk: LiveTalk;
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
  /** Table mic hard mute (runtime, not saved): /host disables the mic track, the server drops audio. */
  private micMuted = false;
  private manualSpeaker?: { playerId: string; ts: number };
  private lastUnconfirmed?: Float32Array;
  private sessionStartTs = Date.now();
  /** Sprite draws in flight by campaign + subject: a spawn during a pre-draw waits for it instead of paying twice. */
  private readonly spriteDraws = new Map<string, Promise<string>>();

  private readonly dmSessionOpts: DmSessionOptions;
  private readonly createCall: typeof createVoiceCall;

  constructor(store?: Store, opts: GameServiceOptions = {}) {
    this.dmSessionOpts = opts.dmSession ?? {};
    this.createCall = opts.createVoiceCall ?? createVoiceCall;
    this.store = store ?? new Store(join(config.dataDir, "dm.sqlite"));
    this.speaker = new SpeakerService(this.store);
    this.liveTalk = new LiveTalk({
      now: () => Date.now(),
      broadcast: (ev) => this.hub.broadcast(ev),
      identify: (from, to) => this.liveSpeaker(from, to),
    });
    this.history = new StateHistory(this.store);
    this.hub.setSnapshot(() => {
      const evs: ServerEvent[] = [
        { type: "campaign", campaign: this.campaign },
        { type: "dm_status", status: this.dmStatus, mode: this.dmMode },
        { type: "mic", muted: this.micMuted },
      ];
      if (this.state) evs.push({ type: "state", state: this.state });
      if (this.npcFocus.current) evs.push(this.npcFocus.snapshot());
      return evs;
    });
  }

  async init() {
    this.rules.loadSrd(config.srdDir);
    await this.rules.loadCustom(config.customRulesDir);
    this.monsters.load(config.srdDir);
    this.spells.load(config.srdDir);
    this.classes.load(config.srdDir);
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
      srdSpells: this.spells.size,
      srdClasses: this.classes.size,
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
      spell: (name) => this.spells.find(name),
      spellCandidates: (name) => this.spells.candidates(name),
      classData: (className) => this.classes.get(className),
      locations: this.campaign?.outline?.locations ?? [],
      npcs: this.campaign?.outline?.npcs ?? [],
    };
  }

  /** Persist + broadcast the current state. With a label, the previous state goes to undo history. */
  private commit(state: GameState, label?: string) {
    // Characters still holding zeroed rules defaults (old saves, restored history) get derived values.
    state = upgradeCharacters(state, (n) => this.classes.get(n));
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
    const startedAt = Date.now(); // the host shows elapsed time on the chip
    this.hub.broadcast({ type: "job", id, label, status: "running", startedAt });
    try {
      const res = await fn();
      this.hub.broadcast({ type: "job", id, label, status: "done", startedAt });
      return res;
    } catch (err) {
      this.hub.broadcast({ type: "job", id, label, status: "error", detail: (err as Error).message, startedAt });
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
    const loaded = this.store.getState(id) ?? emptyGameState(id);
    // Old saves: derive slots, hit dice and resources for characters that have none yet.
    this.state = upgradeCharacters(loaded, (n) => this.classes.get(n));
    if (this.state !== loaded) this.store.saveState(this.state);
    this.sessionStartTs = Date.now();
    this.hub.broadcast({ type: "campaign", campaign: c });
    this.hub.broadcast({ type: "state", state: this.state });
    void this.predrawSprites();
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

  /**
   * Start a campaign over (see resetState). Undo history, the event log and session summaries are
   * always cleared, so this cannot be undone; the host offers an export first. Written straight to
   * the store (no commit) so no history entry is made.
   */
  resetCampaign(id: string, opts: ResetOptions & { keepOutline: boolean }) {
    const c = this.store.getCampaign(id);
    if (!c) throw new Error(`Unknown campaign ${id}`);
    const current = this.campaign?.id === id && this.state ? this.state : (this.store.getState(id) ?? emptyGameState(id));
    if (!opts.keepOutline) delete c.outline;
    c.sessionSummaries = [];
    c.status = "active"; // a finished campaign is open again
    delete c.completedAt;
    c.updatedAt = Date.now();
    this.store.saveCampaign(c);
    let fresh = resetState(current, opts);
    // A kept outline starts where the adventure starts: the first location, party placed.
    const first = opts.keepOutline ? c.outline?.locations[0] : undefined;
    if (first) fresh = executeEngineTool(fresh, "change_scene", { location_id: first.id }, { ...this.engineCtx(), locations: c.outline?.locations ?? [], npcs: c.outline?.npcs ?? [], source: "host" }).state;
    this.store.saveState(fresh);
    this.history.clear(id);
    this.store.deleteEvents(id);
    if (!opts.keepPlayers) {
      this.store.deleteVoiceprints(id);
      this.store.deletePlayerNotes(id);
    }
    if (this.campaign?.id === id) {
      this.loadCampaign(id);
      if (first && !first.mapUrl) void this.generateMap(first.id).catch(() => undefined);
      if (first) this.prepaintAfter(first.id);
    }
    return { ok: true };
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
    void this.predrawSprites();
    const first = outline.locations[0];
    if (first) {
      this.mutate((s) => {
        s.locationId = first.id;
        ensureCharacterTokens(s, this.engineCtx());
      });
      void this.generateMap(first.id).catch(() => undefined);
      this.prepaintAfter(first.id);
    }
    this.dm?.refreshInstructions();
    return outline;
  }

  /** Paints in progress (campaign:location): an arrival during a prepaint shares it. */
  private paints = new Map<string, Promise<string>>();
  /** Paints started per campaign:location: a paint that a newer (forced) one overtook lands without writing. */
  private paintSeq = new Map<string, number>();
  /** Background prepaints that failed (campaign:location): not retried in the background. */
  private prepaintFailed = new Set<string>();
  /** The one background prepaint running, if any. */
  private prepainting?: string;

  async generateMap(locationId: string, force = false): Promise<string> {
    const key = `${this.requireCampaign().id}:${locationId}`;
    const running = this.paints.get(key);
    if (running && !force) return running;
    const seq = (this.paintSeq.get(key) ?? 0) + 1;
    this.paintSeq.set(key, seq);
    const p = this.paintMap(locationId, force, () => this.paintSeq.get(key) === seq);
    this.paints.set(key, p);
    try {
      return await p;
    } finally {
      if (this.paints.get(key) === p) this.paints.delete(key);
    }
  }

  /**
   * The party arrived at `locationId`: paint the next unpainted location of the outline in the
   * background (PREPAINT_MAPS), so the next arrival doesn't wait about a minute. One at a time.
   */
  private prepaintAfter(locationId: string) {
    if (!config.prepaintMaps || this.prepainting || !this.images.available) return;
    const c = this.campaign;
    const locs = c?.outline?.locations ?? [];
    const at = locs.findIndex((l) => l.id === locationId);
    const next = at >= 0 ? locs[at + 1] : undefined; // where the adventure goes next
    const key = `${c?.id}:${next?.id}`;
    if (!next || next.mapUrl || this.prepaintFailed.has(key)) return;
    this.prepainting = next.id;
    void this.generateMap(next.id)
      .then(() => {
        this.prepainting = undefined;
        // The party may have reached that location meanwhile: carry on from where it is now.
        if (this.state?.locationId) this.prepaintAfter(this.state.locationId);
      })
      .catch(() => {
        this.prepainting = undefined;
        this.prepaintFailed.add(key); // no background retries (paid calls, error chips); arrival paints it
      });
  }

  private async paintMap(locationId: string, force: boolean, latest: () => boolean = () => true): Promise<string> {
    const c = this.requireCampaign();
    const loc = c.outline?.locations.find((l) => l.id === locationId);
    if (!loc) throw new Error(`Unknown location ${locationId}`);
    if (loc.mapUrl && !force) return loc.mapUrl;
    const oldUrl = loc.mapUrl;
    // A forced repaint skips the image cache, so the host gets a new picture (and a new URL).
    const url = await this.job(`Painting map: ${loc.name}`, () => this.images.map(c.id, `${loc.name}. ${loc.mapPrompt || loc.description}`, force));
    const { features, walls } = asMapRead(await this.readFeatures({ ...loc, mapUrl: url }));
    // A newer paint (a forced repaint) started meanwhile: its picture wins, unless there is still none.
    if (!latest() && this.campaign?.outline?.locations.find((l) => l.id === locationId)?.mapUrl) return url;

    // The host may have loaded another campaign while we waited: never touch that one's state.
    const live = this.campaign?.id === c.id ? this.campaign : undefined;
    const target = live ?? this.store.getCampaign(c.id);
    const tloc = target?.outline?.locations.find((l) => l.id === locationId);
    if (!target || !tloc) return url; // campaign deleted or location removed meanwhile
    tloc.mapUrl = url;
    tloc.features = features;
    tloc.walls = walls; // host wall edits (state.wallEdits) still win: they survive a repaint
    // A repaint replaces an existing picture: host feature fixes and fog painting belonged to it.
    const repaint = force || (!!oldUrl && url !== oldUrl);
    if (!live) {
      // Not loaded now: persist the map, and on a repaint clean that campaign's saved state too
      // (no history entry: its undo history belongs to its own session).
      this.store.saveCampaign(target);
      const saved = repaint || walls.length > 0 ? this.store.getState(c.id) : undefined;
      if (saved) {
        const next = this.stateAfterPaint(saved, { ...this.engineCtx(), locations: target.outline?.locations ?? [] }, locationId, features.length > 0, repaint, walls.length > 0);
        if (!sameState(saved, next)) this.store.saveState(next);
      }
      return url;
    }
    this.saveCampaign();

    if (this.state) {
      const next = this.stateAfterPaint(this.state, this.engineCtx(), locationId, features.length > 0, repaint, walls.length > 0);
      if (!sameState(this.state, next)) this.commit(next, `${repaint ? "map repainted" : "map painted"}: ${tloc.name}`);
    }
    this.dm?.refreshInstructions();
    return url;
  }

  /**
   * The game state after a location's map was painted. A repaint drops the old picture's Board
   * edits and fog (`resetForRepaint`); if the party is there and features were read, tokens are
   * restaged (a first paint keeps the fog: cells revealed or hidden on the blank grid still apply,
   * except that when walls were read the explored cells are recomputed (`refogForWalls`): the
   * party's light on the blank grid went straight through them).
   */
  private stateAfterPaint(state: GameState, ctx: EngineContext, locationId: string, hasFeatures: boolean, repaint: boolean, hasWalls = false): GameState {
    let next = repaint ? resetForRepaint(state, ctx, locationId) : hasWalls ? refogForWalls(state, ctx, locationId) : state;
    if (hasFeatures && next.locationId === locationId) next = restageForMap(next, ctx, { keepFog: !repaint });
    return next;
  }

  /** Locate entrance, focal and lit features, and walls/doors, on a location's painted map. Empty without a brain or on failure. */
  private async readFeatures(loc: Location): Promise<{ features: MapFeature[]; walls: WallSeg[] }> {
    const image = loc.mapUrl ? this.images.readAsset(loc.mapUrl) : undefined;
    if (!this.brain || !image) return { features: [], walls: [] };
    try {
      return await this.job(`Reading map: ${loc.name}`, () => readMapFeatures(this.brain!, loc, image));
    } catch {
      return { features: [], walls: [] };
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
    const c = Character.parse({
      ...draft,
      id: newId("pc"),
      playerName: draft.playerName ?? "",
      maxHp,
      hp: maxHp,
      color: TOKEN_COLORS[s.characters.length % TOKEN_COLORS.length],
      inventory: (draft.inventory ?? []).map((i) => ({ ...i, id: i.id || newId("item") })),
    });
    return applyDerived(c, c.className ? this.classes.get(c.className) : undefined);
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
      const prev = s.characters[idx];
      const next = Character.parse({ ...prev, ...patch, id });
      // Saves that were the old class's defaults follow a class change (applyDerived refills them).
      const oldSaves = prev.className ? this.classes.get(prev.className)?.savingThrows : undefined;
      if (patch.className !== undefined && patch.savingThrows === undefined && oldSaves && sameList(prev.savingThrows, oldSaves)) next.savingThrows = [];
      // Host edits of conditions/concentration keep the spell links consistent.
      next.conditionMeta = next.conditionMeta.filter((m) => next.conditions.some((c) => c.toLowerCase() === m.name.toLowerCase()));
      // Class, level or subclass changed: re-derive slot/hit-die/resource maxima (spent uses kept).
      if (patch.className !== undefined || patch.level !== undefined || patch.subclass !== undefined) {
        if (patch.level !== undefined && patch.proficiencyBonus === undefined) next.proficiencyBonus = proficiencyBonusFor(next.level);
        applyDerived(next, next.className ? this.classes.get(next.className) : undefined);
        // Fields the host sent in this same patch win over the derived ones.
        if (patch.spellSlots !== undefined) next.spellSlots = Character.shape.spellSlots.parse(patch.spellSlots);
        if (patch.resources !== undefined) next.resources = Character.shape.resources.parse(patch.resources);
        if (patch.pactSlots !== undefined) next.pactSlots = patch.pactSlots ? Character.shape.pactSlots.parse(patch.pactSlots) : undefined;
        if (patch.hitDice !== undefined) next.hitDice = Character.shape.hitDice.parse(patch.hitDice);
      }
      // A host HP edit that brings a downed PC above 0 is regaining HP: wake up, reset death saves.
      const before = s.characters[idx];
      if (before.hp <= 0 && next.hp > 0 && !isDead(next) && patch.conditions === undefined && patch.deathSaves === undefined) regainedHp(s, next);
      s.characters[idx] = next;
      if (prev.concentration && !next.concentration) endLinkedToConcentration(s, next.id, prev.concentration.spell);
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

  /** The canonical SRD spell name, or undefined (pregen and sheet spell lists). */
  private spellName = (name: string) => (this.spells.get(name) ?? this.spells.find(name))?.name;

  async generatePregens(count: number, wishes: string): Promise<CharacterDraft[]> {
    const brain = this.requireBrain();
    return this.job("Creating pregenerated characters", () =>
      generatePregens(brain, this.campaign ?? undefined, count, this.campaign?.partyLevel ?? 1, wishes, this.spellName),
    );
  }

  async importSheet(sheet: string, playerId?: string): Promise<Character> {
    const brain = this.requireBrain();
    const player = this.state?.players.find((p) => p.id === playerId);
    const parsed = await this.job("Reading character sheet", () => parseCharacterSheet(brain, sheet, player?.name ?? ""));
    const draft = { ...parsed, spells: normalizeSpellList(parsed.spells ?? [], this.spellName, { keepHomebrew: true }) };
    return this.addCharacter(draft, playerId);
  }

  async generateCharacterSprite(characterId: string) {
    const c = this.requireCampaign();
    const ch = this.requireState().characters.find((x) => x.id === characterId);
    if (!ch || !this.images.available) return;
    const desc = `${ch.name}, a ${ch.species} ${ch.className}. ${ch.appearance}`;
    const url = await this.drawSprite(c.id, `Drawing ${ch.name}`, desc);
    if (this.campaign?.id !== c.id) return; // the host loaded another campaign meanwhile
    this.mutate((s) => {
      const x = s.characters.find((y) => y.id === characterId);
      if (x) x.spriteUrl = url;
    });
  }

  private async generateMonsterSprites(spawned: Monster[]) {
    if (!this.images.available || !this.campaign) return;
    const campaignId = this.campaign.id;
    const kinds = new Map<string, Monster>();
    for (const m of spawned) if (!m.spriteUrl) kinds.set(spriteKey(m), m);
    for (const [kind, m] of kinds) {
      const base = m.npc ? m.name : monsterKind(m);
      try {
        const subject = spriteSubject(m);
        const url = this.images.cachedSprite(campaignId, subject) ?? (await this.drawSprite(campaignId, `Drawing ${base}`, subject));
        if (this.campaign?.id !== campaignId) return; // the host loaded another campaign meanwhile
        this.mutate((s) => {
          for (const x of s.monsters) if (spriteKey(x) === kind) x.spriteUrl = url;
        });
      } catch {
        /* job event already reported the error */
      }
    }
  }

  /** One sprite draw per campaign + subject at a time; later callers share the running one. */
  private drawSprite(campaignId: string, label: string, subject: string): Promise<string> {
    const key = `${campaignId}|${subject}`;
    let draw = this.spriteDraws.get(key);
    if (!draw) {
      draw = this.job(label, () => this.images.sprite(campaignId, subject)).finally(() => this.spriteDraws.delete(key));
      this.spriteDraws.set(key, draw);
    }
    return draw;
  }

  /**
   * Draw sprites before play needs them: missing PC and monster sprites (an earlier draw failed),
   * then every outline NPC's portrait and every monster kind in the outline's encounters, one at a
   * time. Drawn images are cached by prompt, so a later add_npc or spawn_monster gets its sprite at
   * once instead of waiting mid-scene.
   */
  private async predrawSprites() {
    const c = this.campaign;
    const s = this.state;
    if (!c || !s || !this.images.available) return;
    try {
      for (const ch of s.characters) if (!ch.spriteUrl) void this.generateCharacterSprite(ch.id).catch(() => undefined);
      if (s.monsters.some((m) => !m.spriteUrl)) await this.generateMonsterSprites(s.monsters);
      // NPCs first: one often greets the party in the opening scene, before any fight.
      const npcs = (c.outline?.npcs ?? []).filter((n) => n.name.trim()).map((n) => ({ label: n.name, subject: npcSpriteSubject(n.name, n.description) }));
      const kinds = new Set((c.outline?.encounters ?? []).flatMap((e) => e.monsters.map((m) => this.monsters.find(m.name)?.name ?? titleCase(m.name))));
      const monsters = [...kinds].map((base) => ({ label: base, subject: monsterSpriteSubject(base) }));
      for (const { label, subject } of [...npcs, ...monsters]) {
        if (this.campaign?.id !== c.id) return; // the host loaded another campaign
        if (this.images.cachedSprite(c.id, subject)) continue;
        await this.drawSprite(c.id, `Drawing ${label}`, subject).catch(() => undefined); // the job event reports errors
      }
    } catch {
      /* best effort: spawns draw their own sprites */
    }
  }

  // ---------- tools ----------

  /** Run a DM tool (from the Realtime model or the host's manual controls). */
  async runTool(name: string, args: unknown, source: "dm" | "host" = "dm", opts: { noteDm?: boolean } = {}): Promise<unknown> {
    if (!isToolName(name)) throw new Error(`Unknown tool ${name}`);
    if (source === "dm" && isHostOnlyTool(name)) throw new Error(`${name} is a host-only tool.`);
    const c = this.requireCampaign();
    this.store.appendEvent(c.id, "tool", { name, args, source });

    if (isEngineTool(name)) {
      const before = this.requireState();
      const { state, outcome } = executeEngineTool(before, name, args, { ...this.engineCtx(), source });
      const changed = !sameState(before, state);
      this.commit(state, changed ? toolLabel(name, args, before, source) : undefined);
      // The live DM only re-reads the state when it asks; tell it what the host just did (silently).
      if (source === "host" && changed && opts.noteDm !== false && this.dm?.isOpen) {
        const note = hostActionNote(name, (args ?? {}) as Record<string, unknown>, before, state, outcome.output);
        if (note) this.dm.addSystemNote(note);
      }
      for (const roll of outcome.rolls) this.hub.broadcast({ type: "roll", roll });
      for (const effect of outcome.effects) this.hub.broadcast({ type: "effect", effect });
      // Table moments (victory, death, turn banner…): broadcast only, never stored or snapshotted.
      for (const m of outcome.moments) this.hub.broadcast({ type: "moment", moment: m });
      if (outcome.spawned.length) void this.generateMonsterSprites(outcome.spawned);
      // The DM's map feature list, or its door list (ids, open/closed), changed.
      if (name === "edit_map_feature" || (changed && (name === "set_door" || name === "edit_walls"))) this.dm?.refreshInstructions();
      if (outcome.sceneChanged) {
        this.npcFocus.set(null); // the conversation stays behind
        this.dm?.refreshInstructions();
        void this.generateMap(outcome.sceneChanged).catch(() => undefined);
        this.prepaintAfter(outcome.sceneChanged);
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
      case "end_campaign":
        return this.endCampaign(args, source);
      case "consult_brain":
        if (!this.brain) return "No planner available. Improvise something fun that fits the adventure.";
        return consult(this.brain, c, this.requireState(), String(a.question ?? ""));
      case "confirm_speaker":
        return this.confirmSpeaker(String(a.player_name ?? ""));
      case "npc_focus": {
        const { npc_name } = ToolArgs.npc_focus.parse(args ?? {});
        if (!npc_name?.trim()) {
          this.npcFocus.set(null);
          return { ok: true, focus: null };
        }
        this.focusNpc(npc_name);
        return { ok: true, focus: this.npcFocus.current?.name ?? null };
      }
      case "speak_as_npc":
        if (typeof a.npc_name === "string" && a.npc_name.trim()) this.focusNpc(a.npc_name);
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

  /**
   * end_campaign: the story is over. Marks the campaign completed/failed (saved and broadcast as a
   * `campaign` event), logs it and plays the campaign_end moment with the epilogue on the TV.
   * Refused when the campaign is not active; resetCampaign reopens it. Refreshes the DM's instructions
   * (they state the status) and, when the host ended it, tells the live DM in a system note.
   */
  private endCampaign(args: unknown, source: "dm" | "host" = "dm") {
    const { outcome, epilogue } = ToolArgs.end_campaign.parse(args ?? {});
    const c = this.requireCampaign();
    if (c.status !== "active") return { error: `The campaign is already ${c.status}. The host can reset it to play again.` };
    c.status = outcome === "success" ? "completed" : "failed";
    c.completedAt = Date.now();
    this.saveCampaign();
    this.log({ kind: "system", text: outcome === "success" ? "The campaign is complete: success!" : "The campaign ends in failure." });
    this.hub.broadcast({ type: "moment", moment: moment("campaign_end", { outcome, text: epilogue?.trim() || undefined }) });
    // The instructions carry the status; a host's call is also told to the live DM (its own call has the result).
    this.dm?.refreshInstructions();
    if (source === "host" && this.dm?.isOpen)
      this.dm.addSystemNote(
        `Host did: end_campaign (${outcome}). The campaign is now ${c.status}: the story is over. Wrap up with a short closing narration${epilogue?.trim() ? ` (epilogue: ${epilogue.trim()})` : ""}; don't start new scenes or call end_campaign again.`,
      );
    return { ok: true, status: c.status, outcome };
  }

  /** Show an NPC's close-up; without a picture yet, draw one and update the close-up when it's ready. */
  private focusNpc(raw: string) {
    const { view, subject } = this.npcFocusView(raw);
    this.npcFocus.set(view);
    const c = this.campaign;
    if (view.portraitUrl || !c || !this.images.available) return;
    void this.drawSprite(c.id, `Drawing ${view.name}`, subject)
      .then((portraitUrl) => {
        // Only if that NPC still has the close-up (the DM may have moved on).
        if (this.campaign?.id === c.id && this.npcFocus.current?.name === view.name && !this.npcFocus.current.portraitUrl) this.npcFocus.set({ ...view, portraitUrl });
      })
      .catch(() => undefined); // the job event reports it; the close-up keeps the initial
  }

  /**
   * Name and portrait for the NPC close-up: an NPC token (add_npc) with its own sprite, else an
   * outline NPC with its pre-drawn portrait, else the name as given (improvised NPC). Names match
   * exactly, else a unique NPC whose name holds every given word ("Venn" → "Captain Mara Venn").
   * `subject` is the sprite to draw when there is no picture (the same one add_npc would draw).
   */
  private npcFocusView(raw: string): { view: NpcFocusView; subject: string } {
    const name = raw.trim();
    const words = name.toLowerCase().split(/\s+/).filter(Boolean);
    const byName = <T extends { name: string }>(list: T[]): T | undefined => {
      const exact = list.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (exact) return exact;
      const hits = list.filter((x) => {
        const own = x.name.toLowerCase().split(/\s+/);
        return words.every((w) => own.includes(w));
      });
      return hits.length === 1 ? hits[0] : undefined;
    };
    const c = this.campaign;
    const token = byName((this.state?.monsters ?? []).filter((m) => m.npc));
    const npc = byName(c?.outline?.npcs ?? []);
    if (token) {
      const subject = npcSpriteSubject(token.name, token.appearance);
      const portraitUrl = token.spriteUrl ?? (c && this.images.available ? this.images.cachedSprite(c.id, subject) : undefined);
      return { view: portraitUrl ? { name: token.name, portraitUrl } : { name: token.name }, subject };
    }
    const subject = npc ? npcSpriteSubject(npc.name, npc.description) : npcSpriteSubject(name);
    const portraitUrl = c && this.images.available ? this.images.cachedSprite(c.id, subject) : undefined;
    const display = npc?.name ?? name;
    return { view: portraitUrl ? { name: display, portraitUrl } : { name: display }, subject };
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
    void this.predrawSprites();
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
    const result = (await this.runTool("roll_dice", { notation: r.notation, label: r.label, roller_id: r.character.id }, "host", { noteDm: false })) as { total: number };
    const dmInformed = this.notifyDm(
      `Player roll (from ${r.player.name}'s phone, not requested by you): ${r.player.name} as ${r.character.name} rolled ${r.label || r.notation}: ${result.total}. React only if it matters right now.`,
    );
    return { ...result, dmInformed };
  }

  /** Physical dice total from the host (Play tab) or from the rolling player's phone. */
  async submitPhysicalRoll(input: { total: unknown; natural?: unknown; critical?: unknown; playerId?: string; characterId?: string }) {
    const s = this.requireState();
    const total = parseTotal(input.total);
    const natural = parseNatural(input.natural);
    const characterId = authorizePhysicalRoll(s, input);
    const pending = s.pendingRoll;
    const result = await this.runTool(
      "record_physical_roll",
      // critical (damage from the pads): only a real boolean counts; omitted, the pending roll's flag applies.
      { character_id: characterId, notation: pending?.notation ?? "1d20", label: pending?.label ?? "Roll", total, natural, dc: pending?.dc, critical: typeof input.critical === "boolean" ? input.critical : undefined },
      "host",
      { noteDm: false },
    );
    this.notifyDm(
      `Host note (do not read aloud): ${JSON.stringify(result)} - the player rolled physical dice and it is already recorded; do not call record_physical_roll for it again. Continue.`,
    );
    return result;
  }

  /** Players may switch their own dice mode (nothing else) from their phone. */
  setPlayerDiceMode(playerId: string, mode: unknown) {
    const { character } = playerCharacter(this.requireState(), playerId);
    this.updateCharacter(character.id, { diceMode: DiceMode.parse(mode) });
  }

  /** A player's private notes (phone only; kept in SQLite, not in GameState, so the DM never sees them). */
  playerNotes(playerId: string): { text: string; updatedAt: number } {
    const c = this.requireCampaign();
    this.requirePlayer(playerId);
    return this.store.getPlayerNotes(c.id, playerId) ?? { text: "", updatedAt: 0 };
  }

  savePlayerNotes(playerId: string, raw: unknown): { updatedAt: number } {
    const c = this.requireCampaign();
    this.requirePlayer(playerId);
    const text = parseNotes(raw);
    const updatedAt = Date.now();
    this.store.savePlayerNotes(c.id, playerId, text, updatedAt);
    return { updatedAt };
  }

  private requirePlayer(playerId: string) {
    const p = this.requireState().players.find((x) => x.id === playerId);
    if (!p) throw new Error("Unknown player.");
    return p;
  }

  /** Read-only spell cards (level, concentration, ritual, summary) for a player's own sheet. */
  playerSpells(playerId: string) {
    const { character } = playerCharacter(this.requireState(), playerId);
    return spellSummaries(
      character.spells,
      (n) => this.spells.find(n),
      (spell) => spellLevelRows(character, spell, this.engineCtx()),
    );
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
    if (this.micMuted) return;
    this.speaker.ring.pushPcm16(chunk);
    this.liveTalk.onAudio(chunk);
  }

  /**
   * Provisional speaker while someone is still talking (LiveTalk): the host's tap, the only player,
   * else voice ID on the audio so far. No side effects; the turn's identifySpeaker decides.
   */
  private liveSpeaker(fromTs: number, toTs: number): { playerId: string; confident: boolean } | undefined {
    const s = this.state;
    const c = this.campaign;
    if (!s || !c) return undefined;
    const manual = this.manualSpeaker;
    if (manual && Date.now() - manual.ts < MANUAL_SPEAKER_MS) return { playerId: manual.playerId, confident: true };
    const withChars = s.players.filter((p) => p.characterId);
    if (withChars.length === 1) return { playerId: withChars[0].id, confident: true };
    if (!this.speaker.available) return undefined;
    const { match } = this.speaker.identify(c.id, fromTs, toTs);
    return match && { playerId: match.playerId, confident: match.confident };
  }

  startEnrollment(playerId: string) {
    if (!this.speaker.available) throw new Error(this.speaker.status);
    if (this.micMuted) throw new Error("Unmute the table mic first.");
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
      stalledTurn: () => (this.state ? stalledTurn(this.state) : undefined),
      identifySpeaker: (from, to) => this.identifySpeaker(from, to),
      onPlayerText: (text, label) => this.log({ kind: "player", speaker: label ?? "Player", text }),
      onDmText: (text) => this.log({ kind: "dm", speaker: "DM", text }),
      onDmCaption: (id, text, final) => {
        if (owner.dm && this.dm !== owner.dm) return;
        this.npcFocus.caption(id, text, final);
      },
      onStatus: (status, mode) => {
        if (owner.dm && this.dm !== owner.dm) return;
        if (status === "offline" && owner.dm) {
          this.dm = undefined;
          this.store.clearActiveCall();
          this.npcClips.clear();
        }
        // "connecting" (a sideband reconnect) says nothing about the DM's audio: keep the last state.
        if (status !== "connecting") this.npcClips.setDmSpeaking(status === "speaking");
        this.dmStatus = status;
        this.dmMode = mode;
        this.hub.broadcast({ type: "dm_status", status, mode });
      },
      onError: (message) => {
        console.warn(message);
        this.hub.broadcast({ type: "error", message });
      },
      onUserSpeech: (active) => {
        if (owner.dm && this.dm !== owner.dm) return;
        if (active) this.liveTalk.speechStarted();
        else this.liveTalk.speechStopped();
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
    const { answerSdp, callId } = await this.createCall(host, offerSdp);
    const dm = new DmSession(host, "voice", callId, this.dmSessionOpts);
    dm.setMicMuted(this.micMuted);
    owner.dm = dm;
    this.dm = dm;
    this.store.setActiveCall({ callId, campaignId: this.requireCampaign().id, startedAt: Date.now() });
    // Attach after returning the answer so the peer connection can complete.
    setTimeout(() => {
      if (this.dm !== dm) return; // replaced before it attached
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
    dm.setMicMuted(this.micMuted);
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
    this.npcFocus.set(null);
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

  get isMicMuted() {
    return this.micMuted;
  }

  /**
   * Table mic hard mute, from the host, the TV or a phone (`playerId`), so the party can talk
   * without the DM hearing. A reply already playing finishes; unmuting doesn't prompt the DM.
   */
  setMicMuted(muted: boolean, playerId?: string): { muted: boolean } {
    if (muted === this.micMuted) return { muted };
    this.micMuted = muted;
    const by = playerId && this.state ? this.speakerLabel(playerId).player?.name : undefined;
    if (muted) this.liveTalk.speechStopped();
    this.dm?.setMicMuted(muted);
    this.hub.broadcast({ type: "mic", muted, by });
    this.log({ kind: "system", text: `${by ?? "The table"} ${muted ? "muted" : "unmuted"} the table mic.` });
    return { muted };
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

/** Same entries, any order (saving throw lists). */
function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}
