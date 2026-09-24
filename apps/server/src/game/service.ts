import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  Campaign,
  Character,
  emptyGameState,
  isToolName,
  type DmMode,
  type DmStatus,
  type GameState,
  type LogEntry,
  type Monster,
  type Player,
  type ServerEvent,
} from "@dm/shared";
import { config } from "../config.js";
import { Store } from "../db/index.js";
import { Hub } from "../hub.js";
import { cryptoRng, newId } from "../engine/ids.js";
import { addLog } from "../engine/state.js";
import { ensureCharacterTokens, executeEngineTool, isEngineTool, type EngineContext } from "../engine/tools.js";
import { RulesIndex } from "../rules/srd.js";
import { MonsterCatalog } from "../rules/monsters.js";
import { ImageService } from "../images/index.js";
import { createProvider, type LLMProvider } from "../brain/provider.js";
import { consult, generateOutline, generatePregens, parseCharacterSheet, summarizeSession, type CharacterDraft } from "../brain/content.js";
import { SpeakerService } from "../speaker/service.js";
import { buildInstructions, openingPrompt } from "../realtime/instructions.js";
import { createVoiceCall, DmSession, type DmHost } from "../realtime/session.js";

const TOKEN_COLORS = ["#e0b83c", "#4fa3e0", "#e05a4f", "#62c370", "#b07ce0", "#e08a3c", "#3cc9c0", "#e05ab5"];
/** A host "who's speaking" tap applies to turns ending within this window. */
const MANUAL_SPEAKER_MS = 20_000;

export class GameService {
  readonly store: Store;
  readonly hub = new Hub();
  readonly rules = new RulesIndex();
  readonly monsters = new MonsterCatalog();
  readonly images = new ImageService();
  readonly speaker: SpeakerService;
  readonly brain: LLMProvider | undefined = createProvider();

  campaign: Campaign | null = null;
  state: GameState | null = null;
  private dm?: DmSession;
  private dmStatus: DmStatus = "offline";
  private dmMode: DmMode = "none";
  private manualSpeaker?: { playerId: string; ts: number };
  private lastUnconfirmed?: Float32Array;
  private sessionStartTs = Date.now();

  constructor(store?: Store) {
    this.store = store ?? new Store(join(config.dataDir, "dm.sqlite"));
    this.speaker = new SpeakerService(this.store);
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
    const last = this.store.listCampaigns()[0];
    if (last) this.loadCampaign(last.id);
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

  /** Persist + broadcast the current state. */
  private commit(state: GameState) {
    this.state = state;
    this.store.saveState(state);
    this.hub.broadcast({ type: "state", state });
  }

  private mutate(fn: (s: GameState) => void) {
    const s = structuredClone(this.requireState());
    fn(s);
    s.version += 1;
    this.commit(s);
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
    this.saveCampaign();
    return url;
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
    this.mutate((s) => void s.players.push(p));
    return p;
  }

  updatePlayer(id: string, patch: Partial<Pick<Player, "name" | "characterId">>) {
    this.mutate((s) => {
      const p = s.players.find((x) => x.id === id);
      if (!p) throw new Error("Unknown player");
      Object.assign(p, patch);
      const ch = s.characters.find((c) => c.id === p.characterId);
      if (ch) ch.playerName = p.name;
    });
    this.dm?.refreshInstructions();
  }

  removePlayer(id: string) {
    const c = this.requireCampaign();
    this.store.deleteVoiceprint(c.id, id);
    this.mutate((s) => void (s.players = s.players.filter((p) => p.id !== id)));
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
    });
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
    });
    this.dm?.refreshInstructions();
  }

  removeCharacter(id: string) {
    this.mutate((s) => {
      s.characters = s.characters.filter((c) => c.id !== id);
      s.tokens = s.tokens.filter((t) => t.entityId !== id);
      for (const p of s.players) if (p.characterId === id) p.characterId = undefined;
    });
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
      const { state, outcome } = executeEngineTool(this.requireState(), name, args, this.engineCtx());
      this.commit(state);
      for (const roll of outcome.rolls) this.hub.broadcast({ type: "roll", roll });
      if (outcome.spawned.length) void this.generateMonsterSprites(outcome.spawned);
      if (outcome.sceneChanged) {
        this.dm?.refreshInstructions();
        void this.generateMap(outcome.sceneChanged).catch(() => undefined);
      }
      return outcome.output;
    }

    const a = (args ?? {}) as Record<string, string>;
    switch (name) {
      case "lookup_rule":
        return this.rules.lookup(String(a.query ?? ""));
      case "consult_brain":
        if (!this.brain) return "No planner available. Improvise something fun that fits the adventure.";
        return consult(this.brain, c, this.requireState(), String(a.question ?? ""));
      case "confirm_speaker":
        return this.confirmSpeaker(String(a.player_name ?? ""));
    }
    throw new Error(`Unhandled tool ${name}`);
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

  identifySpeaker(fromTs: number, toTs: number): { note: string; label?: string } {
    const s = this.requireState();
    const c = this.requireCampaign();
    if (this.manualSpeaker && Date.now() - this.manualSpeaker.ts < MANUAL_SPEAKER_MS) {
      const { label } = this.speakerLabel(this.manualSpeaker.playerId);
      this.announceSpeaker(this.manualSpeaker.playerId, 1);
      this.manualSpeaker = undefined;
      return { note: `[speaker: ${label} (selected by host)]`, label };
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
      this.lastUnconfirmed = undefined;
      this.announceSpeaker(match.playerId, match.score);
      return { note: `[speaker: ${label}, confidence ${match.score.toFixed(2)}]`, label };
    }
    this.lastUnconfirmed = embedding;
    return { note: `[speaker: unknown, possibly ${label} (low confidence ${match.score.toFixed(2)}) - ask if unclear, then call confirm_speaker]`, label: `${label}?` };
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

  private dmHost(): DmHost {
    return {
      instructions: () => buildInstructions(this.campaign ?? undefined, this.requireState()),
      opening: () => openingPrompt(this.campaign ?? undefined, this.requireState()),
      runTool: (name, args) => this.runTool(name, args, "dm"),
      identifySpeaker: (from, to) => this.identifySpeaker(from, to),
      onPlayerText: (text, label) => this.log({ kind: "player", speaker: label ?? "Player", text }),
      onDmText: (text) => this.log({ kind: "dm", speaker: "DM", text }),
      onStatus: (status, mode) => {
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

  /** Browser sends its WebRTC offer; we create the call and attach the sideband socket. */
  async startVoice(offerSdp: string): Promise<string> {
    this.requireState();
    this.stopDm();
    const host = this.dmHost();
    const { answerSdp, callId } = await createVoiceCall(host, offerSdp);
    const dm = new DmSession(host, "voice", callId);
    this.dm = dm;
    // Attach after returning the answer so the peer connection can complete.
    setTimeout(() => {
      dm.connect()
        .then(() => dm.begin())
        .catch((err) => host.onError(`Sideband connect failed: ${(err as Error).message}`));
    }, 250);
    return answerSdp;
  }

  async startText() {
    this.requireState();
    if (!config.openaiKey) throw new Error("OPENAI_API_KEY is not set.");
    this.stopDm();
    const dm = new DmSession(this.dmHost(), "text");
    this.dm = dm;
    await dm.connect();
    dm.begin();
  }

  stopDm() {
    this.dm?.close();
    this.dm = undefined;
    this.dmStatus = "offline";
    this.dmMode = "none";
    this.hub.broadcast({ type: "dm_status", status: "offline", mode: "none" });
  }

  /** Typed player input (text mode, or typing while voice is live). */
  sendText(text: string, playerId?: string) {
    if (!this.dm?.isOpen) throw new Error("The DM is not running.");
    const label = playerId ? this.speakerLabel(playerId).label : undefined;
    if (playerId) this.announceSpeaker(playerId, 1);
    this.log({ kind: "player", speaker: label ?? "Player", text });
    this.dm.sendPlayerText(text, label ? `[speaker: ${label} (typed)]` : "[speaker: unknown (typed)]");
  }

  /** Host whisper to the DM (e.g. "skip ahead", "be scarier"). */
  whisper(text: string) {
    if (!this.dm?.isOpen) throw new Error("The DM is not running.");
    this.dm.prompt(`Host note (do not read aloud): ${text}`);
  }

  get dmState() {
    return { status: this.dmStatus, mode: this.dmMode };
  }
}
