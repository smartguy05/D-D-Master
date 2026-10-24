import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  BuilderDraft,
  Campaign,
  Character,
  CharacterConstraints,
  type CharacterConstraintsInput,
  checkConstraints,
  classAllowed,
  cleanNames,
  CreationSettings,
  type CustomSpecies,
  DiceMode,
  findCustomSpecies,
  speciesAllowed,
  type CreationOptions,
  allMonsters,
  emptyGameState,
  ToolArgs,
  isHostOnlyTool,
  isToolName,
  type ToolName,
  proficiencyBonusFor,
  type DmMode,
  type DmStatus,
  type FloorHolder,
  type FloorView,
  type GameState,
  type Location,
  type LogEntry,
  type MapFeature,
  type WallSeg,
  type Monster,
  type NpcFocusView,
  Player,
  type RosterEntry,
  type ServerEvent,
  type VoiceLinkState,
} from "@dm/shared";
import { config } from "../config.js";
import { Store, type ActiveCall } from "../db/index.js";
import { Hub, type HubSocket } from "../hub.js";
import { Floor, PTT_MIN_GAP_MS } from "./floor.js";
import { RtcRelay } from "../rtcRelay.js";
import { pickAudioSource, pickVoiceOwner, voiceOwnerView, type AudioRole } from "./voice-owner.js";
import { cryptoRng, newId } from "../engine/ids.js";
import { addLog } from "../engine/state.js";
import { stalledTurn } from "../engine/turns.js";
import { applyDerived, isDead, upgradeCharacters } from "../engine/rules/derive.js";
import { endLinkedToConcentration } from "../engine/rules/conditions.js";
import { normalizeSpellList } from "../brain/spells.js";
import { regainedHp } from "../engine/rules/vitals.js";
import { deathRuleEnds, deathRuleMet, moment } from "../engine/moments.js";
import { spellLevelRows } from "../engine/rules/cast.js";
import { revealAroundCharacters } from "../engine/fog.js";
import { forgetCharacter, mapScene, normalizeScenes } from "../engine/scenes.js";
import { currentGrid, ensureCharacterTokens, executeEngineTool, isEngineTool, partyStatus, refogForWalls, resetForRepaint, restageForMap, titleCase, type EngineContext } from "../engine/tools.js";
import { RulesIndex } from "../rules/srd.js";
import { MonsterCatalog } from "../rules/monsters.js";
import { ClassCatalog } from "../rules/classes.js";
import { OriginCatalog } from "../rules/origins.js";
import { EquipmentCatalog } from "../rules/equipment.js";
import { CreationFlow } from "./creation/flow.js";
import type { CreationRules } from "./creation/validate.js";
import { SpellCatalog } from "../rules/spells.js";
import { ImageService } from "../images/index.js";
import { createAiPlayerProvider, createConsultProvider, createCreationProvider, createProvider, type LLMProvider } from "../brain/provider.js";
import { consult, draftCustomSpecies, generateOutline, generatePregens, parseCharacterSheet, readMapFeatures, summarizeSession, type CharacterDraft } from "../brain/content.js";
import { ENROLL_MAX_MS, SpeakerService, type RecordFrom } from "../speaker/service.js";
import { LiveTalk } from "../speaker/live.js";
import { NpcFocus } from "../realtime/npc-focus.js";
import { buildInstructions, openingPrompt } from "../realtime/instructions.js";
import { createVoiceCall, DmSession, type DmHost, type DmSessionOptions, type SpeakerTurn } from "../realtime/session.js";
import { restoredState, sameState, StateHistory, toolLabel, type HistoryEntry } from "./history.js";
import { hostActionNote } from "./hostNote.js";
import { departureGate, type DepartureArgs, type ReadyCheck } from "./readyCheck.js";
import { resetState, type ResetOptions } from "./reset.js";
import { copyRosterPortraitTo, deleteRosterPortrait, ROSTER_MEDIA_ID, rosterEntryFrom, saveRosterPortrait, snapshotForRoster } from "./roster.js";
import { buildBundle, encodeBundle, decodeBundle, importBundle } from "./bundle.js";
import { mergeOutline } from "./outline.js";
import { createNpcVoice, pickAiVoice, speakAsNpc } from "../realtime/npc-voice.js";
import { AiPlayerController, aiVoiceDirection, playOnSlot, type AiSeat } from "../players/ai-player.js";
import { NpcClipQueue } from "../realtime/npc-queue.js";
import { builderPrompt, builderStatus, draftSummary, finalizeDraft, mergeDraft, startBuilder } from "./builder.js";
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
  /** Planned call renewal timing (default VOICE_HANDOVER_AFTER_MS / VOICE_HANDOVER_DEADLINE_MS). */
  voiceHandover?: { afterMs?: number; deadlineMs?: number };
  /** Push-to-talk to the DM at start-up (default PUSH_TO_TALK); the host can toggle it while playing. */
  pushToTalk?: boolean;
}

/** How often the handover watcher looks at the call's age and the table. */
export const HANDOVER_TICK_MS = 5_000;
/** No table speech for this long (and nothing in flight) counts as a quiet moment for the swap. */
export const HANDOVER_QUIET_MS = 4_000;
/** The standby call's sideband must be open this soon after prepare, else the handover is dropped. */
export const HANDOVER_STANDBY_MAX_MS = 20_000;
/** After a dropped handover, try again this much later. */
export const HANDOVER_RETRY_MS = 60_000;
/** The note the DM gets on the fresh line: the conversation history is gone, so recent play comes with it. */
export const HANDOVER_NOTE =
  "[Same session continuing on a fresh line; don't greet, recap or announce anything; carry on exactly where you were. Wait for the players.]";

/** The session a dmHost belongs to; `standby` until a handover makes it the live DM. */
interface DmOwner {
  dm?: DmSession;
  standby?: boolean;
}

/** A planned voice-call renewal in progress (GameService.startVoice with handover). */
interface Handover {
  /** When prepare was broadcast. */
  startedAt: number;
  /** The standby call is being created at OpenAI. */
  creating?: boolean;
  callId?: string;
  standby?: DmSession;
  owner?: DmOwner;
  /** The standby's sideband is open: ready to swap. */
  ready?: boolean;
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

/** consult_brain's answer when the planner times out or fails: the DM keeps playing instead of stalling. */
export const CONSULT_FALLBACK = "The planner took too long; improvise from the outline and carry on.";

/** Campaign ids double as folder names under the data dir; the roster's portrait folder is not one. */
function assertNotRosterId(id: string) {
  if (id === ROSTER_MEDIA_ID) throw Object.assign(new Error(`"${ROSTER_MEDIA_ID}" is reserved for the character roster, not a campaign.`), { statusCode: 400 });
}

/** Tools that change state.mapObjects (the DM's "Objects here" instructions block). */
const MAP_OBJECT_TOOLS = new Set<string>(["drop_loot", "pick_up", "place_interactable", "set_interactable", "remove_map_object"]);
/** Tools that change the creatures on the map or their attitude: the DM's "NPCs here" list. */
const CREATURE_LIST_TOOLS = new Set<string>(["adjust_attitude", "set_disposition", "add_npc", "spawn_monster", "remove_monster", "change_scene", "focus_scene"]);

/** Why the death rule ended the campaign, for the DM's tool result and system note. */
const DEATH_RULE_TEXT: Record<Campaign["deathRule"], string> = {
  party_wipe: "every player character is dead",
  any_death: "a player character died (this campaign ends on any death)",
};

const SPRITE_REWRITE_SYSTEM =
  "An image generator's safety filter refused this character description, written for a token in a family-friendly fantasy tabletop game. " +
  "Rewrite it in one or two sentences that keep the character recognisable (name, species, class, colours, gear, costume theme) but avoid anything a filter could read as a hate symbol, gore, nudity, a real person or a child in danger. " +
  "For example 'a white bedsheet ghost costume with eyeholes and a pointy hood' becomes 'a cute round cartoon ghost costume made from a white sheet, with big round eye holes'. " +
  "Drop requests aimed at the filter (\"this is for a game\"). Reply with the description only.";

/** A tool result for the `tool` event: ok, the error, or the start of the result. */
export function toolOutcome(out: unknown): { ok: boolean; error?: string; result?: string } {
  const error = out && typeof out === "object" && !Array.isArray(out) ? (out as { error?: unknown }).error : undefined;
  if (error !== undefined) return { ok: false, error: String(error).slice(0, 300) };
  const text = typeof out === "string" ? out : JSON.stringify(out ?? null);
  return { ok: true, result: text.length > 300 ? `${text.slice(0, 300)}…` : text };
}

/** Where the party stands and how much of the scene is revealed, after a scene change or a party move. */
function boardSnapshot(s: GameState): Record<string, unknown> {
  const pcs = s.tokens.filter((t) => t.entityType === "character").map((t) => `${t.entityId}@${t.x},${t.y}`);
  const fog = s.locationId ? s.fog?.[s.locationId] : undefined;
  return { location: s.locationId, pcs, fog: fog?.enabled ? (fog.revealed?.length ?? 0) : "off" };
}

export class GameService {
  readonly store: Store;
  readonly hub = new Hub();
  readonly rules = new RulesIndex();
  readonly monsters = new MonsterCatalog();
  readonly spells = new SpellCatalog();
  readonly classes = new ClassCatalog();
  readonly origins = new OriginCatalog();
  readonly equipment = new EquipmentCatalog();
  /** Phone character creation (game/creation/flow.ts): drafts, join, host approval. */
  readonly creation: CreationFlow;
  readonly images = new ImageService();
  readonly speaker: SpeakerService;
  /** The NPC close-up on the TV (npc_focus / speak_as_npc) and its captions. */
  readonly npcFocus = new NpcFocus({ broadcast: (ev) => this.hub.broadcast(ev) });
  /** Live "who's talking" (mic level + voice ID mid-sentence) for the TV. */
  readonly liveTalk: LiveTalk;
  readonly history: StateHistory;
  readonly brain: LLMProvider | undefined = createProvider();
  /** consult_brain's planner: the brain's models with CONSULT_TIMEOUT_MS, since the DM waits on it mid-conversation. */
  readonly consultLlm: LLMProvider | undefined = createConsultProvider();
  /** The phone character creation helper (CREATION_TIMEOUT_MS); tests replace it. */
  creationLlm: LLMProvider | undefined = createCreationProvider();
  readonly npcVoice = createNpcVoice();
  /** speak_as_npc clips: played on /table only while the DM is silent, one at a time. */
  readonly npcClips = new NpcClipQueue({ broadcast: (ev) => this.hub.broadcast(ev), dmBusy: () => !!this.dm?.busy });
  /** The AI players' model (AI_PLAYER_*), separate from the brain: fast, short timeout. */
  readonly aiLlm: LLMProvider | undefined = createAiPlayerProvider();
  /** Seats played by an AI: they speak after a DM reply, in their own voice, as typed player lines. */
  readonly aiPlayers = new AiPlayerController(
    {
      state: () => this.state,
      board: () => (this.state ? partyStatus(this.state, this.engineCtx()) : null),
      adventure: () => this.campaign?.outline?.title ?? this.campaign?.name,
      llm: () => this.aiLlm,
      dmLive: () => !!this.dm?.isOpen && !this.dm.isReconnecting,
      tableBusy: () => !!this.dm?.busy,
      speak: (seat, line, signal) => this.speakAiLine(seat, line, signal),
      say: (line, playerId) => this.sendText(line, playerId),
      broadcast: (ev) => this.hub.broadcast(ev),
      warn: (message) => console.warn(message),
      log: (message) => console.log(message),
    },
    { cooldownMs: config.aiPlayerCooldownMs },
  );

  campaign: Campaign | null = null;
  state: GameState | null = null;
  private dm?: DmSession;
  private dmStatus: DmStatus = "offline";
  private dmMode: DmMode = "none";
  /** Table mic hard mute (runtime, not saved): /table (and /host) disable the mic track, the server drops audio. */
  private micMuted = false;
  /** The /table call's last reported state, from the screen that carries it (see game/voice-owner.ts). */
  private voiceLink?: { ws: HubSocket; state: VoiceLinkState; error?: string };
  /** Open /ws/audio streams by role. */
  private readonly audioSockets: Record<AudioRole, number> = { host: 0, table: 0, player: 0 };
  private manualSpeaker?: { playerId: string; ts: number };
  /** Push-to-talk (runtime; starts from PUSH_TO_TALK): voice turns count only while someone holds the floor. */
  private pushToTalk: boolean;
  /** Who is talking to the DM (game/floor.ts), and the /ws socket that pressed for them. */
  private readonly floor = new Floor();
  private floorWs?: HubSocket;
  /** The WebRTC call between remote players and the room: members and signaling (rtcRelay.ts). */
  readonly rtc = new RtcRelay<HubSocket>({
    send: (ws, ev) => this.hub.send(ws, ev),
    seatOk: (id) => !!this.state?.players.some((p) => p.id === id && !p.ai),
  });
  private floorTimer?: ReturnType<typeof setTimeout>;
  /** Each /ws socket's last ptt press (the press throttle, PTT_MIN_GAP_MS; releases don't count). */
  private readonly lastPtt = new WeakMap<HubSocket, number>();
  /** Announces the end of a forgotten enrollment (ENROLL_MAX_MS), when the table mic may close again. */
  private enrollTimer?: ReturnType<typeof setTimeout>;
  private lastUnconfirmed?: Float32Array;
  private sessionStartTs = Date.now();
  /** Counts human player lines (voice turns, typed lines not from an AI seat) for the change_scene ready check. */
  private humanInputs = 0;
  /** A DM change_scene refused until a human answers "ready to go?" (game/readyCheck.ts). */
  private readyCheck?: ReadyCheck;
  /** Sprite draws in flight by campaign + subject: a spawn during a pre-draw waits for it instead of paying twice. */
  private readonly spriteDraws = new Map<string, Promise<string>>();
  /** Item icon draws in flight, by campaign id + lower-cased item name (drawItemIcon). */
  private readonly itemDraws = new Map<string, Promise<string>>();

  private readonly dmSessionOpts: DmSessionOptions;
  private readonly createCall: typeof createVoiceCall;
  private readonly handoverAfterMs: number;
  private readonly handoverDeadlineMs: number;
  /** The planned call renewal in progress, if any. */
  private handover?: Handover;
  /** No new handover before this (ms epoch): set after one was dropped. */
  private handoverRetryAt = 0;
  private handoverTimer?: ReturnType<typeof setInterval>;

  constructor(store?: Store, opts: GameServiceOptions = {}) {
    // The session's greppable lines ([tool], [moves], [watch], [turn-timing], [cutoff]…) are also
    // saved as `diag` events, so a play-test can be reviewed after the console is gone.
    const dmOpts = opts.dmSession ?? {};
    const print = dmOpts.log ?? ((m: string) => console.log(m));
    const printWarn = dmOpts.warn ?? ((m: string) => console.warn(m));
    this.dmSessionOpts = {
      ...dmOpts,
      log: (line) => {
        print(line);
        this.diagLine(line);
      },
      warn: (message) => {
        printWarn(message);
        this.diagLine(message, "warn");
      },
    };
    this.createCall = opts.createVoiceCall ?? createVoiceCall;
    this.handoverAfterMs = opts.voiceHandover?.afterMs ?? config.voiceHandoverAfterMs;
    this.handoverDeadlineMs = opts.voiceHandover?.deadlineMs ?? config.voiceHandoverDeadlineMs;
    this.pushToTalk = opts.pushToTalk ?? config.pushToTalk;
    this.store = store ?? new Store(join(config.dataDir, "dm.sqlite"));
    this.creation = new CreationFlow({
      store: this.store,
      broadcast: (ev) => this.hub.broadcast(ev),
      campaign: () => this.requireCampaign(),
      state: () => this.requireState(),
      rules: this.creationRules(),
      addCharacter: (draft, playerId, o) => this.addCharacter(draft, playerId, o),
      updateCharacter: (id, patch) => this.updateCharacter(id, patch),
      saveToRoster: (id) => this.saveToRoster(id),
      drawPortrait: (campaignId, label, subject, fresh) => this.drawSprite(campaignId, label, subject, fresh),
      imagesAvailable: () => this.images.available,
      log: (text) => this.log({ kind: "system", text }),
      options: (level) => this.creationOptions(level),
      chatLlm: () => this.creationLlm,
      job: (label, fn) => this.job(label, fn),
      lookup: (q) => this.rules.lookup(q, 2, 2500),
    });
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
        { type: "voice_owner", owner: this.voiceOwner() },
        { type: "floor", floor: this.floorView() },
      ];
      if (this.state) evs.push({ type: "state", state: this.state });
      if (this.npcFocus.current) evs.push(this.npcFocus.snapshot());
      return evs;
    });
    this.hub.onClientEvent((ev, ws) => {
      if (ev.type === "ptt") return this.onPtt(ev, ws);
      if (ev.type === "rtc_join") return this.rtc.join(ws, ev, { role: this.hub.roleOf(ws), access: this.hub.accessOf(ws), inRoom: this.hub.inRoom(ws) });
      if (ev.type === "rtc_leave") return this.rtc.leave(ws);
      if (ev.type === "rtc") return this.rtc.signal(ws, ev);
      if (ev.type === "hello" && ev.role === "table") this.broadcastVoiceOwner();
      if (ev.type !== "voice_link" || this.hub.roleOf(ws) !== "table") return;
      // A table whose call is up claims it; another table's reports don't overwrite the owner's.
      const owner = this.voiceOwnerSocket();
      if (ws !== owner && ev.state === "idle") return;
      this.voiceLink = { ws, state: ev.state, ...(ev.error && { error: ev.error }) };
      this.broadcastVoiceOwner();
    });
    this.hub.onClose((ws, role) => {
      // A page that closes (or is kicked) while holding the floor lets go of it.
      if (ws === this.floorWs) this.releaseFloor();
      this.rtc.leave(ws);
      if (role !== "table") return;
      if (this.voiceLink?.ws === ws) this.voiceLink = undefined;
      this.broadcastVoiceOwner();
    });
  }

  async init() {
    this.rules.loadSrd(config.srdDir);
    await this.rules.loadCustom(config.customRulesDir);
    this.monsters.load(config.srdDir);
    this.spells.load(config.srdDir);
    this.classes.load(config.srdDir);
    this.origins.load(config.srdDir);
    this.equipment.load(config.srdDir);
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
    this.watchHandover();
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
      srdOrigins: this.origins.size,
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
    // Party split: no parked scene without a PC, no location entry for a removed PC (engine/scenes.ts).
    state = normalizeScenes(state);
    if (label && this.state && this.state !== state) this.history.record(this.state, label);
    // The party is somewhere else (DM or host move, split focus): a pending "ready to go?" is moot.
    if (this.state && this.state.locationId !== state.locationId) this.readyCheck = undefined;
    this.state = state;
    this.store.saveState(state);
    this.hub.broadcast({ type: "state", state });
    // A seat removed (or another campaign's seats): its remote page leaves the call.
    this.rtc.recheckSeats();
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

  /** Save a diagnostic event for the loaded campaign (see scripts/session_log.py). */
  diag(tag: string, data: Record<string, unknown> = {}) {
    if (this.campaign) this.store.appendEvent(this.campaign.id, "diag", { tag, ...data });
  }

  /** A "[tag] text" log line as a diag event (untagged lines get `tag`). */
  private diagLine(line: string, tag = "log") {
    const m = /^\[([\w-]+)\]\s*([\s\S]*)$/.exec(line);
    this.diag(m ? m[1]! : tag, { text: (m ? m[2]! : line).slice(0, 500) });
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
      this.diag("job", { label, status: "error", error: (err as Error).message.slice(0, 500), code: (err as { code?: unknown }).code, ms: Date.now() - startedAt });
      throw err;
    }
  }

  /** consult_brain: ask the planner (CONSULT_TIMEOUT_MS). A timeout or error is a tool result, never a throw. */
  private async consultPlanner(c: Campaign, question: string): Promise<string> {
    if (!this.consultLlm) return "No planner available. Improvise something fun that fits the adventure.";
    try {
      return await consult(this.consultLlm, c, this.requireState(), question);
    } catch (err) {
      console.warn(`consult_brain failed: ${(err as Error).message}`);
      return CONSULT_FALLBACK;
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

  createCampaign(input: { name: string; premise?: string; partyLevel?: number; deathRule?: Campaign["deathRule"] }): Campaign {
    const now = Date.now();
    const c = Campaign.parse({ id: newId("cmp"), name: input.name || "New Adventure", premise: input.premise ?? "", partyLevel: input.partyLevel ?? 1, deathRule: input.deathRule, createdAt: now, updatedAt: now });
    this.store.saveCampaign(c);
    this.store.saveState(emptyGameState(c.id));
    this.loadCampaign(c.id);
    return c;
  }

  /**
   * Host settings for the current campaign: the death rule, the party (starting) level and the
   * character creation rules. Saved, broadcast, and stated to the DM. The play lock is not set here
   * (setCreationLock).
   */
  updateCampaignSettings(input: {
    deathRule?: Campaign["deathRule"];
    partyLevel?: number;
    creation?: Partial<CreationSettings>;
    constraints?: Partial<CharacterConstraintsInput>;
  }): Campaign {
    const c = this.requireCampaign();
    if (input.deathRule !== undefined) c.deathRule = Campaign.shape.deathRule.parse(input.deathRule);
    if (input.partyLevel !== undefined) c.partyLevel = Campaign.shape.partyLevel.parse(input.partyLevel);
    if (input.creation !== undefined) {
      const { playStartedAt: _ignored, ...patch } = (input.creation ?? {}) as Partial<CreationSettings>;
      c.creation = CreationSettings.parse({ ...c.creation, ...patch });
    }
    // Existing characters that now break the constraints are only flagged (host Party tab), never changed.
    if (input.constraints !== undefined) {
      const next = CharacterConstraints.parse({ ...c.constraints, ...input.constraints });
      next.allowedSpecies = cleanNames(next.allowedSpecies);
      next.allowedClasses = cleanNames(next.allowedClasses);
      const names = next.customSpecies.map((s) => s.name.trim().toLowerCase());
      if (new Set(names).size !== names.length) throw new Error("Two custom species share a name.");
      c.constraints = next;
    }
    this.saveCampaign();
    this.dm?.refreshInstructions();
    return c;
  }

  /** Host: lock (or unlock) players' edits of characters that already joined (see markPlayStarted). */
  setCreationLock(locked: boolean): Campaign {
    const c = this.requireCampaign();
    if (locked) c.creation.playStartedAt = c.creation.playStartedAt ?? Date.now();
    else delete c.creation.playStartedAt;
    this.saveCampaign();
    return c;
  }

  /** The DM opened a session (begin, not a resume): players' characters that joined are locked from now on. */
  private markPlayStarted() {
    const c = this.campaign;
    if (!c || c.creation.playStartedAt !== undefined) return;
    c.creation.playStartedAt = Date.now();
    this.saveCampaign();
  }

  loadCampaign(id: string) {
    assertNotRosterId(id);
    const c = this.store.getCampaign(id);
    if (!c) throw new Error(`Unknown campaign ${id}`);
    this.stopDm();
    this.readyCheck = undefined;
    // A hold names a seat of the old campaign (and the turns it covered are gone with it).
    this.resetFloor();
    this.campaign = c;
    const loaded = this.store.getState(id) ?? emptyGameState(id);
    // Old saves: derive slots, hit dice and resources for characters that have none yet.
    this.state = upgradeCharacters(loaded, (n) => this.classes.get(n));
    if (this.state !== loaded) this.store.saveState(this.state);
    this.sessionStartTs = Date.now();
    this.hub.broadcast({ type: "campaign", campaign: c });
    this.hub.broadcast({ type: "state", state: this.state });
    this.rtc.recheckSeats();
    void this.predrawSprites();
    this.repairLootIcons();
  }

  deleteCampaign(id: string) {
    // <dataDir>/roster holds the roster portraits: rmSync below would wipe them.
    assertNotRosterId(id);
    if (this.campaign?.id === id) {
      this.stopDm();
      this.resetFloor();
      this.campaign = null;
      this.state = null;
      this.hub.broadcast({ type: "campaign", campaign: null });
      this.rtc.recheckSeats();
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
      this.store.deleteCreationDrafts(id);
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
    // A split-off group the TV isn't showing is at that location: its parked scene is restaged too.
    return mapScene(state, locationId, (s) => {
      let next = repaint ? resetForRepaint(s, ctx, locationId) : hasWalls ? refogForWalls(s, ctx, locationId) : s;
      if (hasFeatures && next.locationId === locationId) next = restageForMap(next, ctx, { keepFog: !repaint });
      return next;
    });
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

  addPlayer(name: string, opts: { ai?: boolean } = {}): Player {
    const p = Player.parse({ id: newId("plr"), name: name.trim() });
    if (opts.ai) Object.assign(p, { ai: true, aiVoice: this.freeAiVoice(p.name) });
    this.mutate((s) => void s.players.push(p), `host edit: add ${p.ai ? "AI " : ""}player ${p.name}`);
    if (p.ai) this.dm?.refreshInstructions();
    return p;
  }

  /** Host edit of a seat. `characterId: null` unassigns its character (JSON can't carry undefined). */
  updatePlayer(id: string, patch: Partial<Pick<Player, "name" | "ai" | "aiPersona" | "aiPaused">> & { characterId?: string | null }) {
    const allowed: (keyof typeof patch)[] = ["name", "characterId", "ai", "aiPersona", "aiPaused"];
    const clean = Object.fromEntries(Object.entries(patch ?? {}).filter(([k]) => allowed.includes(k as keyof typeof patch))) as typeof patch;
    this.mutate((s) => {
      const p = s.players.find((x) => x.id === id);
      if (!p) throw new Error("Unknown player");
      const { characterId, ...rest } = clean;
      Object.assign(p, rest);
      if (characterId !== undefined && (characterId || undefined) !== p.characterId) {
        const old = s.characters.find((c) => c.id === p.characterId);
        if (old && !s.players.some((x) => x !== p && x.characterId === old.id)) old.playerName = "";
        if (characterId) p.characterId = characterId;
        else delete p.characterId;
      }
      if (p.ai && !p.aiVoice) p.aiVoice = this.freeAiVoice(p.name, s);
      const ch = s.characters.find((c) => c.id === p.characterId);
      if (ch) ch.playerName = p.name;
    }, `host edit: player ${clean.name ?? id}`);
    this.dm?.refreshInstructions();
  }

  /** A speech voice no other AI player uses (never the DM's). */
  private freeAiVoice(seed: string, s = this.state): string {
    return pickAiVoice((s?.players ?? []).filter((p) => p.ai).map((p) => p.aiVoice), config.realtimeVoice, seed);
  }

  /** Host "Nudge" on an AI player: it says or does something now. */
  nudgeAiPlayer(playerId: string) {
    return this.aiPlayers.nudge(playerId);
  }

  /** Play an AI player's line; true if it was heard. The DM holds its next response while it plays. */
  private async speakAiLine(seat: AiSeat, line: string, signal?: AbortSignal): Promise<boolean> {
    const c = this.campaign;
    if (!c || !this.npcVoice.available) return false;
    const voice = seat.player.aiVoice ?? this.freeAiVoice(seat.player.name);
    try {
      const synth = () => this.npcVoice.synthesizeWith(c.id, { voice, instructions: aiVoiceDirection(seat) }, line);
      const slot = this.npcClips.reserve();
      // Hold from the start of play only: a hold queues responses, which the busy gate would wait on.
      void slot.started.then((ok) => ok && this.dm?.holdResponses(slot.done));
      return await playOnSlot(slot, synth, seat.character.name, line, { portraitUrl: seat.character.spriteUrl, pc: true }, signal);
    } catch (err) {
      console.warn(`AI player voice failed (the DM still gets the line): ${(err as Error).message}`);
      return false;
    }
  }

  removePlayer(id: string) {
    const c = this.requireCampaign();
    this.store.deleteVoiceprint(c.id, id);
    this.mutate((s) => void (s.players = s.players.filter((p) => p.id !== id)), `host edit: remove player ${this.state?.players.find((p) => p.id === id)?.name ?? id}`);
  }

  private characterFromDraft(draft: Partial<CharacterDraft> & { name: string }, s: GameState): Character {
    const maxHp = draft.maxHp ?? 10;
    // Light is never the draft's: a pregen made before CharacterDraft dropped it may carry 0 (blind in fog).
    const { lightRadius: _light, ...rest } = draft as typeof draft & { lightRadius?: number };
    const c = Character.parse({
      ...rest,
      id: newId("pc"),
      playerName: draft.playerName ?? "",
      maxHp,
      hp: maxHp,
      color: TOKEN_COLORS[s.characters.length % TOKEN_COLORS.length],
      inventory: (draft.inventory ?? []).map((i) => ({ ...i, id: i.id || newId("item") })),
    });
    return applyDerived(c, c.className ? this.classes.get(c.className) : undefined);
  }

  /** `spriteUrl`: a portrait drawn already (phone creation); else a sprite is drawn from the appearance. */
  addCharacter(draft: Partial<CharacterDraft> & { name: string }, playerId?: string, opts: { spriteUrl?: string } = {}): Character {
    let created!: Character;
    this.mutate((s) => {
      const player = s.players.find((p) => p.id === playerId);
      created = this.characterFromDraft({ ...draft, playerName: player?.name ?? draft.playerName ?? "" }, s);
      if (opts.spriteUrl) created.spriteUrl = opts.spriteUrl;
      s.characters.push(created);
      if (player) player.characterId = created.id;
      ensureCharacterTokens(s, this.engineCtx());
    }, `host edit: add character ${draft.name}`);
    this.dm?.refreshInstructions();
    if (!opts.spriteUrl) void this.generateCharacterSprite(created.id).catch(() => undefined);
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
      // A brighter light shows its new reach now, not on the next move.
      if (patch.lightRadius !== undefined) revealAroundCharacters(s, currentGrid(s, this.engineCtx()));
    }, `host edit: ${this.state?.characters.find((c) => c.id === id)?.name ?? id} (${Object.keys(patch).join(", ")})`);
    this.dm?.refreshInstructions();
  }

  removeCharacter(id: string) {
    this.mutate((s) => {
      s.characters = s.characters.filter((c) => c.id !== id);
      s.tokens = s.tokens.filter((t) => t.entityId !== id);
      forgetCharacter(s, id); // a split-off group's scene and location
      for (const p of s.players) if (p.characterId === id) p.characterId = undefined;
    }, `host edit: remove character ${this.state?.characters.find((c) => c.id === id)?.name ?? id}`);
    this.dm?.refreshInstructions();
  }

  // ---------- global character roster (game/roster.ts) ----------

  /** Every roster hero, newest first. Works with no campaign loaded. */
  listRoster(): RosterEntry[] {
    return this.store.listRoster().map((r) => rosterEntryFrom(r, !!this.store.getRosterVoiceprint(r.id)));
  }

  /**
   * Save a campaign character to the global roster as a fresh snapshot (see snapshotForRoster), with
   * its portrait copied to the roster folder and its player's voiceprint. The first save links the
   * character (rosterId) through a committed change that is not an undo entry; later saves update the
   * same roster row, recreating it under the same id if the host deleted it.
   */
  saveToRoster(characterId: string): { rosterId: string; created: boolean } {
    const c = this.requireCampaign();
    const s = this.requireState();
    const ch = s.characters.find((x) => x.id === characterId);
    if (!ch) throw new Error("Unknown character");
    const rosterId = ch.rosterId ?? newId("ros");
    const created = !this.store.getRoster(rosterId);
    const data = snapshotForRoster({ ...ch, rosterId });
    data.spriteUrl = saveRosterPortrait(config.dataDir, rosterId, ch.spriteUrl);
    if (!data.spriteUrl) delete data.spriteUrl;
    for (const item of data.inventory) delete item.iconUrl; // campaign-scoped media
    this.store.saveRoster(rosterId, data.name, data);
    const player = s.players.find((p) => p.characterId === ch.id);
    const vp = player && this.store.getVoiceprints(c.id).find((v) => v.playerId === player.id);
    if (vp) this.store.saveRosterVoiceprint(rosterId, vp.embedding, vp.samples);
    if (!ch.rosterId)
      // No label: linking is bookkeeping, not something the host should undo.
      this.mutate((next) => {
        const x = next.characters.find((y) => y.id === characterId);
        if (x) x.rosterId = rosterId;
      });
    return { rosterId, created };
  }

  /** saveToRoster for every character in the campaign, linked or not. */
  saveAllToRoster(): { saved: { characterId: string; rosterId: string; created: boolean }[] } {
    const ids = this.requireState().characters.map((ch) => ch.id);
    return { saved: ids.map((characterId) => ({ characterId, ...this.saveToRoster(characterId) })) };
  }

  /**
   * Bring a roster hero into the active campaign as a new character (new id, linked by rosterId, at
   * full HP). Links the given player, else a free player with the snapshot's player name, else a new
   * one. The roster voiceprint becomes that player's voiceprint here unless they already have one, and
   * the roster portrait is copied into this campaign (else a sprite is drawn). Undoable.
   */
  joinFromRoster(rosterId: string, playerId?: string): Character {
    const c = this.requireCampaign();
    const s = this.requireState();
    const row = this.store.getRoster(rosterId);
    if (!row) throw new Error("Unknown roster character");
    if (s.characters.some((ch) => ch.rosterId === rosterId)) throw new Error(`${row.data.name} is already in this campaign.`);
    const plays = (p: Player) => !!p.characterId && s.characters.some((ch) => ch.id === p.characterId);

    let player: Player | undefined;
    if (playerId) {
      player = s.players.find((p) => p.id === playerId);
      if (!player) throw new Error("Unknown player");
      if (plays(player)) throw new Error(`${player.name} already plays another character.`);
    } else {
      const wanted = (row.data.playerName.trim() || row.data.name).trim();
      const key = wanted.toLowerCase();
      const same = s.players.filter((p) => p.name.trim().toLowerCase() === key);
      player = same.find((p) => !plays(p));
      if (!player && same.length) throw new Error(`A player named ${wanted} already plays another character; choose which player joins with ${row.data.name}.`);
    }
    const newPlayer: Player | undefined = player ? undefined : Player.parse({ id: newId("plr"), name: (row.data.playerName.trim() || row.data.name).trim() });
    const linkedId = (player ?? newPlayer)!.id;

    this.pruneVoiceprints(c.id, s.players);
    const rosterVp = this.store.getRosterVoiceprint(rosterId);
    const copyVp = !!rosterVp && !this.store.getVoiceprints(c.id).some((v) => v.playerId === linkedId);

    const base = snapshotForRoster(row.data);
    const used = new Set([...s.characters.flatMap((ch) => ch.inventory), ...s.mapObjects.flatMap((o) => o.items)].map((i) => i.id));
    const inventory = base.inventory.map((item) => {
      const id = !item.id || used.has(item.id) ? newId("item") : item.id;
      used.add(id);
      return { ...item, id };
    });
    const spriteUrl = copyRosterPortraitTo(config.dataDir, rosterId, c.id);
    let created!: Character;
    this.mutate((next) => {
      const p = newPlayer ? (next.players.push(structuredClone(newPlayer)), next.players.at(-1)!) : next.players.find((x) => x.id === linkedId)!;
      created = Character.parse({ ...base, id: newId("pc"), rosterId, playerName: p.name, inventory, spriteUrl });
      next.characters.push(created);
      p.characterId = created.id;
      if (copyVp) p.voiceSamples = rosterVp!.samples;
      ensureCharacterTokens(next, this.engineCtx());
    }, `host edit: join from roster ${base.name}`);
    if (copyVp) this.store.saveVoiceprint(c.id, linkedId, rosterVp!.embedding, rosterVp!.samples);
    this.dm?.refreshInstructions();
    if (!spriteUrl) void this.generateCharacterSprite(created.id).catch(() => undefined);
    return structuredClone(this.requireState().characters.find((ch) => ch.id === created.id) ?? created);
  }

  /**
   * The roster as a phone sees it: every hero, the player's own (same player name, any case or
   * spacing) first and flagged `mine`, `levelMismatch` when the hero isn't at the party level, and
   * `inCampaign` when it already plays here.
   */
  playerRoster(playerId: string): (RosterEntry & { mine: boolean; levelMismatch: boolean; inCampaign: boolean })[] {
    const c = this.requireCampaign();
    const key = normName(this.requirePlayer(playerId).name);
    const here = new Set(this.requireState().characters.map((ch) => ch.rosterId).filter(Boolean));
    const rows = this.listRoster().map((r) => ({ ...r, mine: !!key && normName(r.playerName) === key, levelMismatch: r.level !== c.partyLevel, inCampaign: here.has(r.id) }));
    return [...rows.filter((r) => r.mine), ...rows.filter((r) => !r.mine)];
  }

  /** A phone brings a roster hero in for its own seat (joinFromRoster with that seat; never a new player). */
  playerJoinFromRoster(playerId: string, rosterId: string): Character {
    this.requirePhoneCreation();
    this.requirePlayer(playerId);
    const ch = this.joinFromRoster(rosterId, playerId);
    this.log({ kind: "system", text: `${ch.playerName} brought ${ch.name} from the roster on their phone.` });
    return ch;
  }

  private requirePhoneCreation() {
    if (!this.requireCampaign().creation.phoneCreation) throw new Error("The host turned off character creation on phones.");
  }

  // ---------- phone character creation (game/creation/) ----------

  /** The SRD lookups the creation validator uses. */
  private creationRules(): CreationRules {
    return {
      classData: (n) => this.classes.get(n),
      species: (n) => findCustomSpecies(n, this.campaign?.constraints) ?? this.origins.species(n),
      background: (n) => this.origins.background(n),
      feat: (n) => this.origins.feat(n),
      armor: (n) => this.equipment.armor(n),
      weapon: (n) => this.equipment.weapon(n),
      spell: (n) => this.spells.get(n) ?? this.spells.find(n),
      classSpells: (c) => this.spells.list().filter((s) => s.classes.some((x) => x.toLowerCase() === c.trim().toLowerCase())),
      isHomebrew: (n) => this.rules.inCustom(n),
    };
  }

  /** The SRD choices the phone form offers at a level (classes, species, backgrounds, feats, spell lists). */
  private creationOptions(level: number): CreationOptions {
    const classes = this.classes.names().map((name) => {
      const c = this.classes.get(name)!;
      const row = this.classes.level(name, level);
      return {
        name: c.name,
        hitDie: c.hitDie,
        skillChoices: c.skillChoices,
        equipment: c.equipment ?? [],
        subclass: c.subclass?.name,
        subclassLevel: c.subclassLevel,
        asiLevels: (c.asiLevels ?? []).filter((l) => l <= level),
        cantrips: row?.cantrips ?? 0,
        preparedSpells: row?.preparedSpells ?? 0,
        maxSpellLevel: row?.pact ? row.pact.slotLevel : (row?.slots.length ?? 0),
        spellcasting: c.spellcasting?.ability,
        savingThrows: c.savingThrows,
        fightingStyle: c.levels.some((l) => l.level <= level && l.features.includes("Fighting Style")),
        armorTraining: c.armorTraining ?? [],
      };
    });
    const lists = new Set([...classes.map((c) => c.name), "Cleric", "Druid", "Wizard"]);
    const spells: CreationOptions["spells"] = {};
    for (const list of lists) {
      spells[list] = this.spells
        .list()
        .filter((s) => s.classes.some((x) => x.toLowerCase() === list.toLowerCase()))
        .map((s) => ({ name: s.name, level: s.level }))
        .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
    }
    // The campaign's constraints: its custom species first, then only the allowed species and classes.
    const rules = this.campaign?.constraints;
    const custom = rules?.customSpecies ?? [];
    const species = [...custom, ...this.origins.allSpecies().filter((s) => !findCustomSpecies(s.name, rules))].filter((s) => speciesAllowed(s.name, rules));
    return { classes: classes.filter((c) => classAllowed(c.name, rules)), species, backgrounds: this.origins.allBackgrounds(), feats: this.origins.feats(), spells };
  }

  /** Remove a roster hero, its voiceprint and portrait. Campaign characters keep their rosterId. */
  deleteRoster(id: string) {
    if (!this.store.getRoster(id)) throw new Error("Unknown roster character");
    this.store.deleteRoster(id);
    deleteRosterPortrait(config.dataDir, id);
  }

  /** The canonical SRD spell name, or undefined (pregen and sheet spell lists). */
  private spellName = (name: string) => (this.spells.get(name) ?? this.spells.find(name))?.name;

  async generatePregens(count: number, wishes: string): Promise<CharacterDraft[]> {
    const brain = this.requireBrain();
    return this.job("Creating pregenerated characters", () =>
      generatePregens(brain, this.campaign ?? undefined, count, this.campaign?.partyLevel ?? 1, wishes, this.spellName),
    );
  }

  /** Host: draft custom species from a prompt (not saved; the host edits them, then saves the constraints). */
  async draftCustomSpecies(request: string): Promise<CustomSpecies[]> {
    const brain = this.requireBrain();
    return this.job("Drafting custom species", () => draftCustomSpecies(brain, this.campaign ?? undefined, request));
  }

  /** Every SRD species and class name, unfiltered, for the host's Character rules pickers. */
  originCatalog() {
    return { species: this.origins.allSpecies().map((s) => s.name), classes: this.classes.names().map((n) => this.classes.get(n)?.name ?? n) };
  }

  async importSheet(sheet: string, playerId?: string): Promise<Character> {
    const brain = this.requireBrain();
    const player = this.state?.players.find((p) => p.id === playerId);
    const parsed = await this.job("Reading character sheet", () => parseCharacterSheet(brain, sheet, player?.name ?? ""));
    const issues = checkConstraints(parsed, this.campaign?.constraints);
    if (issues.length) throw new Error(`${parsed.name || "This character"} breaks this campaign's character rules. ${issues.map((i) => i.message).join(" ")}`);
    const draft = { ...parsed, spells: normalizeSpellList(parsed.spells ?? [], this.spellName, { keepHomebrew: true }) };
    return this.addCharacter(draft, playerId);
  }

  async generateCharacterSprite(characterId: string) {
    const c = this.requireCampaign();
    const ch = this.requireState().characters.find((x) => x.id === characterId);
    if (!ch || !this.images.available) return;
    const custom = findCustomSpecies(ch.species, c.constraints);
    const desc = `${ch.name}, a ${ch.species} ${ch.className}. ${custom?.description ? `${custom.description} ` : ""}${ch.appearance}`;
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
          for (const x of allMonsters(s)) if (spriteKey(x) === kind) x.spriteUrl = url; // parked scenes too
        });
      } catch {
        /* job event already reported the error */
      }
    }
  }

  /** The image safety filter refused a sprite subject: the brain rewords it (images.sprite retries with it). */
  private async rewriteSpriteSubject(subject: string): Promise<string> {
    if (!this.brain) throw new Error("No brain to reword the sprite subject.");
    const text = await this.brain.complete({ system: SPRITE_REWRITE_SYSTEM, prompt: subject, maxTokens: 300 });
    const rewritten = text.trim().replace(/^["']+|["']+$/g, "");
    this.diag("image", { moderation: true, subject: subject.slice(0, 300), rewritten: rewritten.slice(0, 300) });
    return rewritten;
  }

  /** One sprite draw per campaign + subject at a time; later callers share the running one. */
  private drawSprite(campaignId: string, label: string, subject: string, fresh = false): Promise<string> {
    // A fresh draw (portrait redraw) never shares a cached or running one.
    if (fresh) return this.job(label, () => this.images.sprite(campaignId, subject, (d) => this.rewriteSpriteSubject(d), true));
    const key = `${campaignId}|${subject}`;
    let draw = this.spriteDraws.get(key);
    if (!draw) {
      draw = this.job(label, () => this.images.sprite(campaignId, subject, (d) => this.rewriteSpriteSubject(d))).finally(() => this.spriteDraws.delete(key));
      this.spriteDraws.set(key, draw);
    }
    return draw;
  }

  /** One item icon draw per campaign + name (any case) at a time; later callers share the running one. */
  drawItemIcon(campaignId: string, name: string): Promise<string> {
    return this.sharedItemDraw(`${campaignId}|${name.trim().toLowerCase()}`, `Drawing ${name}`, () => this.images.itemIcon(campaignId, name));
  }

  private sharedItemDraw(key: string, label: string, draw: () => Promise<string>): Promise<string> {
    let p = this.itemDraws.get(key);
    if (!p) {
      p = this.job(label, draw).finally(() => this.itemDraws.delete(key));
      this.itemDraws.set(key, p);
    }
    return p;
  }

  /**
   * After drop_loot: give the loot object the loot-sack marker and each of its items an icon
   * (cached ones at once, others drawn), then patch the icon into map-object and inventory items of
   * the same name that have none. Best effort: without images nothing is drawn.
   */
  private async drawLootIcons(objectId: string) {
    const c = this.campaign;
    const obj = this.state?.mapObjects.find((o) => o.id === objectId);
    if (!c || !obj || !this.images.available) return;
    const sameCampaign = () => this.campaign?.id === c.id; // the host may load another campaign meanwhile
    const names = new Map<string, string>();
    const key = (name: string) => name.trim().toLowerCase();
    for (const i of obj.items) if (!i.iconUrl && !names.has(key(i.name))) names.set(key(i.name), i.name.trim());
    const patchItems = (lower: string, url: string) =>
      this.mutate((s) => {
        const items = [...s.mapObjects.flatMap((o) => o.items), ...s.characters.flatMap((ch) => ch.inventory)];
        for (const i of items) if (!i.iconUrl && key(i.name) === lower) i.iconUrl = url;
      });
    const sack = obj.iconUrl
      ? Promise.resolve()
      : this.sharedItemDraw(`${c.id}|\u0000loot-sack`, "Drawing the loot sack", () => this.images.lootSack(c.id)).then((url) => {
          if (!sameCampaign()) return;
          this.mutate((s) => {
            const o = s.mapObjects.find((x) => x.id === objectId);
            if (o && !o.iconUrl) o.iconUrl = url;
          });
        });
    const icons = [...names].map(async ([lower, name]) => {
      const url = this.images.cachedItemIcon(c.id, name) ?? (await this.drawItemIcon(c.id, name));
      if (sameCampaign()) patchItems(lower, url);
    });
    await Promise.allSettled([sack, ...icons]); // the job events report failures
  }

  /**
   * Loot piles missing their marker or item icons get them again (cached pictures cost nothing).
   * drawLootIcons runs only after drop_loot and its patches are unlabelled, so an undo to a snapshot
   * taken before the draws finished, or a restart mid-draw, would otherwise leave them bare for good.
   */
  private repairLootIcons() {
    const s = this.state;
    if (!s || !this.images.available) return;
    for (const o of s.mapObjects ?? [])
      if (o.kind === "loot" && (!o.iconUrl || o.items.some((i) => !i.iconUrl))) void this.drawLootIcons(o.id).catch(() => undefined);
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

  /**
   * Run a DM tool (from the Realtime model or the host's manual controls). Every call is saved as a
   * `tool` event with its outcome (ok, error or a short result), so refusals and hints are reviewable.
   */
  async runTool(name: string, args: unknown, source: "dm" | "host" = "dm", opts: { noteDm?: boolean } = {}): Promise<unknown> {
    // Unknown and host-only names are refused before anything runs, and leave no tool event.
    if (!isToolName(name)) throw new Error(`Unknown tool ${name}`);
    if (source === "dm" && isHostOnlyTool(name)) throw new Error(`${name} is a host-only tool.`);
    const c = this.campaign;
    const started = Date.now();
    try {
      const out = await this.execTool(name, args, source, opts);
      if (c) this.store.appendEvent(c.id, "tool", { name, args, source, ...toolOutcome(out), ms: Date.now() - started });
      if (c && (name === "change_scene" || name === "move_party") && this.state) this.diag("board", boardSnapshot(this.state));
      return out;
    } catch (err) {
      if (c) this.store.appendEvent(c.id, "tool", { name, args, source, ok: false, error: (err as Error).message.slice(0, 300), ms: Date.now() - started });
      throw err;
    }
  }

  private async execTool(name: ToolName, args: unknown, source: "dm" | "host", opts: { noteDm?: boolean }): Promise<unknown> {
    const c = this.requireCampaign();

    if (isEngineTool(name)) {
      const before = this.requireState();
      if (name === "change_scene" && source === "dm") {
        const gate = departureGate(before, (args ?? {}) as DepartureArgs, { pending: this.readyCheck, humanInputs: this.humanInputs, now: Date.now(), locations: c.outline?.locations ?? [] });
        if (!gate.allow) {
          this.readyCheck = gate.pending;
          return gate.refusal;
        }
        this.readyCheck = undefined;
      }
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
      for (const id of outcome.lootDropped) void this.drawLootIcons(id).catch(() => undefined);
      // Pick-up toast on the TV: broadcast only, never stored or snapshotted.
      for (const pickup of outcome.pickups) this.hub.broadcast({ type: "pickup", pickup });
      // The DM's "Objects here" list changed.
      if (changed && MAP_OBJECT_TOOLS.has(name)) this.dm?.refreshInstructions();
      // The DM's "NPCs here" list (names, ids, attitudes) changed.
      else if (changed && CREATURE_LIST_TOOLS.has(name)) this.dm?.refreshInstructions();
      // The DM's map feature list, or its door list (ids, open/closed), changed.
      if (name === "edit_map_feature" || (changed && (name === "set_door" || name === "edit_walls"))) this.dm?.refreshInstructions();
      if (outcome.sceneChanged) {
        this.npcFocus.set(null); // the conversation stays behind
        this.dm?.refreshInstructions();
        void this.generateMap(outcome.sceneChanged).catch(() => undefined);
        this.prepaintAfter(outcome.sceneChanged);
      }
      // The campaign's death rule: the last PC died (party_wipe) or any PC died (any_death).
      if (c.status === "active" && deathRuleEnds(c.deathRule, before, state)) {
        this.endCampaign({ outcome: "failure" }, "auto");
        const ended = `failure: ${DEATH_RULE_TEXT[c.deathRule]}. The campaign is over; give a short closing narration.`;
        if (outcome.output && typeof outcome.output === "object" && !Array.isArray(outcome.output)) return { ...(outcome.output as object), campaign_ended: ended };
        return { result: outcome.output, campaign_ended: ended };
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
        return this.consultPlanner(c, String(a.question ?? ""));
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
          monsters: this.requireState().monsters,
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
   * Refused when the campaign is not active; resetCampaign reopens it. A failure from the DM is refused
   * until the campaign's death rule is met (a dead PC can be revived); the host can always end it.
   * `auto` is runTool ending it under the death rule. Refreshes the DM's instructions (they state the
   * status) and, when the host or the death rule ended it, tells the live DM in a system note.
   */
  private endCampaign(args: unknown, source: "dm" | "host" | "auto" = "dm") {
    const { outcome, epilogue } = ToolArgs.end_campaign.parse(args ?? {});
    const c = this.requireCampaign();
    if (c.status !== "active") return { error: `The campaign is already ${c.status}. The host can reset it to play again.` };
    if (source === "dm" && outcome === "failure" && !deathRuleMet(c.deathRule, this.requireState()))
      return {
        error: `Refused: the campaign fails only when ${c.deathRule === "any_death" ? "a player character dies" : "every player character is dead"}, and the server ends it by itself then. A dead PC can still be revived (Revivify, Raise Dead, a temple priest, divine help); keep the story going.`,
      };
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
    else if (source === "auto" && this.dm?.isOpen)
      this.dm.addSystemNote(`The campaign has ${c.status}: ${DEATH_RULE_TEXT[c.deathRule]}. The story is over. Wrap up with a short closing narration; don't start new scenes or call end_campaign.`);
    return { ok: true, status: c.status, outcome, roster: this.saveLinkedToRoster() };
  }

  /**
   * end_campaign: save every roster-linked PC back to the roster with its end-of-campaign state. A
   * failed save is skipped (the campaign still ends). Unlinked PCs are listed for the host's prompt.
   */
  private saveLinkedToRoster(): { saved: string[]; unlinked: { id: string; name: string }[] } {
    const saved: string[] = [];
    const unlinked: { id: string; name: string }[] = [];
    for (const ch of this.state?.characters ?? []) {
      if (!ch.rosterId) {
        unlinked.push({ id: ch.id, name: ch.name });
        continue;
      }
      try {
        this.saveToRoster(ch.id);
        saved.push(ch.name);
      } catch (err) {
        console.warn(`[roster] could not save ${ch.name}:`, (err as Error).message);
      }
    }
    return { saved, unlinked };
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

  /**
   * Voiceprint rows live outside GameState, so undo cannot roll them back. Drop the ones a restore
   * leaves stale: a roster voiceprint copied by an undone joinFromRoster onto a player who had none
   * before it, and every row whose player is not in the restored state (an orphan would otherwise
   * duplicate a later copy of the same embedding and make speaker matches never confident).
   */
  private dropVoiceprintsUndoneBy(campaignId: string, current: GameState, snapshot: GameState) {
    const kept = new Set(snapshot.characters.map((ch) => ch.id));
    for (const ch of current.characters) {
      if (!ch.rosterId || kept.has(ch.id)) continue;
      const player = current.players.find((p) => p.characterId === ch.id);
      const before = player && snapshot.players.find((p) => p.id === player.id);
      if (!player || !before || before.voiceSamples > 0) continue;
      const rosterVp = this.store.getRosterVoiceprint(ch.rosterId);
      const vp = this.store.getVoiceprints(campaignId).find((v) => v.playerId === player.id);
      if (rosterVp && vp && sameEmbedding(rosterVp.embedding, vp.embedding)) this.store.deleteVoiceprint(campaignId, player.id);
    }
    this.pruneVoiceprints(campaignId, snapshot.players);
  }

  /** Delete voiceprint rows for players that are not in `players`. */
  private pruneVoiceprints(campaignId: string, players: Player[]) {
    const ids = new Set(players.map((p) => p.id));
    for (const v of this.store.getVoiceprints(campaignId)) if (!ids.has(v.playerId)) this.store.deleteVoiceprint(campaignId, v.playerId);
  }

  private restoreEntry(entry: HistoryEntry & { state: GameState }, note: string) {
    const c = this.requireCampaign();
    this.dropVoiceprintsUndoneBy(c.id, this.requireState(), entry.state);
    const vp = new Map(this.store.getVoiceprints(c.id).map((v) => [v.playerId, v.samples]));
    const s = restoredState(this.requireState(), entry.state, vp);
    this.history.truncateFrom(c.id, entry.id);
    const line = { kind: "system" as const, text: note };
    addLog(s, line);
    this.commit(s);
    this.store.appendEvent(c.id, "log", line);
    this.store.appendEvent(c.id, "undo", { version: entry.version, label: entry.label });
    this.repairLootIcons();
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
    // Host start with the DM offline: the opening (openingPrompt) runs the interview once it starts.
    const how = builderPrompt(b, this.campaign?.constraints);
    const dmInformed = source === "host" ? this.notifyDm(how) : true;
    return { ...draftSummary(b), how, dmInformed };
  }

  /** Merge fields into the live draft (DM tool, or host edits with an optional level change). */
  updateCharacterDraft(patch: unknown, level?: number) {
    this.requireBuilder();
    // The campaign's allowed species/classes: refuse the whole patch so the DM offers an allowed one.
    const parsed = BuilderDraft.safeParse(patch ?? {});
    const issues = parsed.success ? checkConstraints(parsed.data, this.campaign?.constraints) : [];
    if (issues.length) throw new Error(issues.map((i) => i.message).join(" "));
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
    const res = finalizeDraft(b, this.campaign?.constraints);
    if (!res.ok && res.issues?.length) return { ok: false, missing: res.missing, issues: res.issues, message: res.issues.map((i) => i.message).join(" ") };
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

  /** `playerId`: the seat a "player" (phone) stream belongs to; only the seat being recorded counts. */
  pushAudio(chunk: Buffer, source: AudioRole = "table", playerId?: string) {
    if (this.micMuted && source !== "player") return;
    const on = this.speaker.recordingOn;
    if (source === "player" && (on?.from !== "player" || on.playerId !== playerId)) return;
    // One mic at a time: two streams of the same room interleaved would garble voice ID.
    const pick = pickAudioSource({ enrolling: this.speaker.enrolling, from: on?.from, ...this.audioSockets });
    if (pick && pick !== source) return;
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
    const held = this.floorSeat(fromTs, toTs);
    if (held) return { playerId: held, confident: true };
    const manual = this.manualSpeaker;
    if (manual && Date.now() - manual.ts < MANUAL_SPEAKER_MS) return { playerId: manual.playerId, confident: true };
    // AI players never talk into the mic: the shortcut counts only people.
    const withChars = s.players.filter((p) => p.characterId && !p.ai);
    if (withChars.length === 1) return { playerId: withChars[0].id, confident: true };
    if (!this.speaker.available) return undefined;
    const { match } = this.speaker.identify(c.id, fromTs, toTs);
    return match && { playerId: match.playerId, confident: match.confident };
  }

  /** `from` "player": the player records on their own phone (its /ws/audio?role=player stream). */
  startEnrollment(playerId: string, from: RecordFrom = "host") {
    if (!this.speaker.available) throw new Error(this.speaker.status);
    if (from === "host" && this.micMuted) throw new Error("Unmute the table mic first.");
    if (from === "player") {
      const p = this.state?.players.find((x) => x.id === playerId);
      if (!p || p.ai) throw new Error("No such player.");
      const on = this.speaker.recordingOn;
      if (on && !(on.from === "player" && on.playerId === playerId)) throw new Error("Another voice is being recorded. Try again in a moment.");
    }
    this.speaker.startEnrollment(playerId, from);
    // With push-to-talk on, /table keeps the room mic open while recording (FloorView.enrolling); the
    // session gate still drops the words as a DM turn, since nobody holds the floor.
    clearTimeout(this.enrollTimer);
    this.enrollTimer = setTimeout(() => this.broadcastFloor(), ENROLL_MAX_MS + 1);
    this.enrollTimer.unref?.();
    this.broadcastFloor();
  }

  finishEnrollment(playerId: string) {
    const c = this.requireCampaign();
    const res = this.speaker.finishEnrollment(c.id, playerId);
    // A stop for someone who isn't being recorded (a second host tab) leaves the running recording
    // alone: its timer still has to tell /table to close the room mic at the cap.
    if (!this.speaker.enrolling) {
      clearTimeout(this.enrollTimer);
      this.enrollTimer = undefined;
    }
    this.broadcastFloor();
    if (res.ok) {
      this.mutate((s) => {
        const p = s.players.find((x) => x.id === playerId);
        if (p) p.voiceSamples = res.samples;
      });
    }
    this.hub.broadcast({ type: "enroll", playerId, ...res });
    return res;
  }

  /** Voice ID test (Party tab): someone talks and finishVoiceTest says who it sounds like. Saves nothing. */
  startVoiceTest() {
    if (!this.speaker.available) throw new Error(this.speaker.status);
    if (this.micMuted) throw new Error("Unmute the table mic first.");
    this.requireCampaign();
    this.speaker.startTest();
    // Same mic handling as enrollment: /host's stream wins, /table keeps the room mic open.
    clearTimeout(this.enrollTimer);
    this.enrollTimer = setTimeout(() => this.broadcastFloor(), ENROLL_MAX_MS + 1);
    this.enrollTimer.unref?.();
    this.broadcastFloor();
  }

  finishVoiceTest() {
    const c = this.requireCampaign();
    const res = this.speaker.finishTest(c.id);
    if (!this.speaker.enrolling) {
      clearTimeout(this.enrollTimer);
      this.enrollTimer = undefined;
    }
    this.broadcastFloor();
    this.hub.broadcast({
      type: "voice_test",
      ok: res.ok,
      message: res.message,
      ...(res.match && { playerId: res.match.playerId, confident: res.match.confident }),
      scores: res.scores,
    });
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
    // Whoever held the push-to-talk floor while this was said; a room hold falls through to the rest.
    const held = this.floorSeat(fromTs, toTs);
    if (held) {
      const { label } = this.speakerLabel(held);
      // With push-to-talk off only a phone-mic hold names a seat.
      return { note: `[speaker: ${label} (${this.pushToTalk ? "push-to-talk" : "phone mic"})]`, label, accept: () => this.announceSpeaker(held, 1) };
    }
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
    const withChars = s.players.filter((p) => p.characterId && !p.ai);
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
  private dmHost(owner: DmOwner = {}): DmHost {
    /** This host's session is not the live DM (a standby line, or one replaced or retired). */
    const stale = () => !!owner.dm && this.dm !== owner.dm;
    return {
      instructions: () => buildInstructions(this.campaign ?? undefined, this.requireState(), { npcTts: this.npcVoice.available }),
      npcTts: this.npcVoice.available,
      recentContext: () => {
        // A restored or resumed line must not drop an interview in progress.
        const b = this.state?.builder;
        return b ? `${this.recentPlay()}\n${builderStatus(b)}` : this.recentPlay();
      },
      opening: () => {
        // begin() asks for the opening: the session is starting, so phone edits lock.
        if (!stale()) this.markPlayStarted();
        return openingPrompt(this.campaign ?? undefined, this.requireState());
      },
      runTool: async (name, args) => {
        // A standby line or a lingering old one must never change the game.
        if (stale()) return { error: "This voice line is no longer the live DM; the tool call was ignored." };
        return this.runTool(name, args, "dm");
      },
      stalledTurn: () => (this.state ? stalledTurn(this.state) : undefined),
      watchScene: () => {
        const s = this.state;
        if (!s?.locationId) return undefined;
        const others = (this.campaign?.outline?.locations ?? []).filter((l) => l.id !== s.locationId);
        return { inCombat: s.combat.active, otherLocations: others.map((l) => ({ id: l.id, name: l.name })) };
      },
      isEcho: (ts) => this.npcClips.echoAt(ts),
      outsideFloor: (from, to) => this.pushToTalk && !this.floor.covered(from, to),
      inVoiceRecording: (from, to) => this.speaker.inRecording(from, to),
      campaignOver: () => !!this.campaign && this.campaign.status !== "active",
      onReplyDone: () => {
        if (stale()) return;
        void this.aiPlayers.onReplyDone();
      },
      onResponseStart: () => {
        if (stale()) return;
        this.aiPlayers.interrupt("the DM is responding");
      },
      identifySpeaker: (from, to) => this.identifySpeaker(from, to),
      // A human mic turn is answered (possibly before its transcript): it counts for the ready check.
      onTurnAccepted: () => {
        if (stale()) return;
        this.humanInputs++;
      },
      onPlayerText: (text, label) => {
        if (stale()) return;
        this.log({ kind: "player", speaker: label ?? "Player", text });
      },
      onDmText: (text) => {
        if (stale()) return;
        this.log({ kind: "dm", speaker: "DM", text });
      },
      onDmCaption: (id, text, final) => {
        if (stale()) return;
        this.npcFocus.caption(id, text, final);
      },
      onStatus: (status, mode) => {
        if (stale()) return;
        if (status === "offline" && owner.dm) {
          this.dm = undefined;
          this.store.clearActiveCall();
          this.npcClips.clear();
          this.cancelHandover("the voice line dropped");
        }
        // "connecting" (a sideband reconnect) says nothing about the DM's audio: keep the last state.
        if (status !== "connecting") this.npcClips.setDmSpeaking(status === "speaking");
        this.dmStatus = status;
        this.dmMode = mode;
        this.hub.broadcast({ type: "dm_status", status, mode });
      },
      onError: (message, level) => {
        console.warn(message);
        // A standby line's errors are handled by the handover (it falls back to the old call).
        if (owner.standby) return;
        this.hub.broadcast({ type: "error", message, ...(level ? { level } : {}) });
      },
      onUserSpeech: (active) => {
        if (stale()) return;
        // Push-to-talk with nobody holding the floor: side chatter, not someone talking to the DM.
        if (active && this.pushToTalk && !this.floor.activeAt(Date.now())) return;
        // A person spoke (not the mic hearing a clip): a pending AI line gives them the floor.
        if (active && !this.npcClips.echoAt(Date.now())) this.aiPlayers.interrupt("someone at the table spoke");
        if (active) this.liveTalk.speechStarted();
        else this.liveTalk.speechStopped();
      },
    };
  }

  /** Recent DM, player and roll lines as plain text (a reconnect or a handover re-sends it). */
  private recentPlay(lines = 15, chars = 3000): string {
    return (this.state?.log ?? [])
      .filter((l) => l.kind === "dm" || l.kind === "player" || l.kind === "roll")
      .slice(-lines)
      .map((l) => `${l.speaker ? `${l.speaker}: ` : ""}${l.text}`)
      .join("\n")
      .slice(-chars);
  }

  /**
   * Browser sends its WebRTC offer; we create the call and attach the sideband socket.
   * `resume`: the browser rebuilt a dropped call, so the DM continues instead of re-greeting.
   * `handover`: the standby peer of a planned call renewal (see prepareHandover): the live DM keeps
   * running and the new call takes over at the next quiet moment.
   */
  async startVoice(offerSdp: string, resume = false, handover = false): Promise<string> {
    this.requireState();
    if (handover) return this.startStandby(offerSdp);
    this.stopDm({ keepCall: true });
    this.readyCheck = undefined;
    const owner: { dm?: DmSession } = {};
    const host = this.dmHost(owner);
    const { answerSdp, callId } = await this.createCall(host, offerSdp);
    const dm = new DmSession(host, "voice", callId, this.dmSessionOpts);
    dm.setMicMuted(this.micMuted);
    owner.dm = dm;
    this.dm = dm;
    this.store.setActiveCall({ callId, campaignId: this.requireCampaign().id, startedAt: Date.now() });
    this.watchHandover();
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

  // ---------- planned voice-call handover ----------
  //
  // Realtime calls end at 60 min. Past handoverAfterMs the watcher waits for a quiet table and asks
  // /host to build a standby peer (mic muted); its offer comes back through startVoice(handover).
  // Once the standby's sideband is open and the table is quiet again (or at the deadline, once the
  // DM isn't speaking) the standby becomes the DM and the browser swaps audio. Any failure drops
  // the standby, keeps the old call and retries a minute later.

  /** Run the handover watcher while a voice DM exists (it stops itself once there is none). */
  private watchHandover() {
    if (this.handoverTimer) return;
    this.handoverTimer = setInterval(() => this.handoverTick(), HANDOVER_TICK_MS);
    (this.handoverTimer as { unref?: () => void }).unref?.();
  }

  private stopHandoverWatch() {
    if (this.handoverTimer) clearInterval(this.handoverTimer);
    this.handoverTimer = undefined;
  }

  /** Nothing is happening at the table: a safe moment to prepare or swap the call. */
  private tableQuiet(dm: DmSession): boolean {
    return (
      dm.isQuiet() &&
      this.npcClips.size === 0 &&
      !this.aiPlayers.busy &&
      !dm.userSpeaking &&
      Date.now() - dm.lastUserSpeechAt >= HANDOVER_QUIET_MS
    );
  }

  private handoverTick() {
    const dm = this.dm;
    if (!dm || dm.mode !== "voice") {
      this.stopHandoverWatch();
      return;
    }
    const call = this.store.getActiveCall();
    if (!call) return;
    const now = Date.now();
    const h = this.handover;
    if (!h) {
      if (now - call.startedAt < this.handoverAfterMs || now < this.handoverRetryAt) return;
      if (!dm.isOpen || !this.tableQuiet(dm)) return;
      this.handover = { startedAt: now };
      console.log(`[handover] call ${call.callId} is ${Math.round((now - call.startedAt) / 60_000)} min old: preparing a fresh line`);
      this.hub.broadcast({ type: "voice_handover", phase: "prepare" });
      return;
    }
    if (!h.ready) {
      if (now - h.startedAt >= HANDOVER_STANDBY_MAX_MS) this.cancelHandover("the standby line did not connect in time", true);
      return;
    }
    this.maybeSwap();
  }

  /** The standby is ready: swap now if the table is quiet, or at the deadline once the DM is silent. */
  private maybeSwap() {
    const h = this.handover;
    const dm = this.dm;
    const call = this.store.getActiveCall();
    if (!h?.ready || !h.standby || !dm || !call) return;
    const pastDeadline = Date.now() - call.startedAt >= this.handoverDeadlineMs;
    if (this.tableQuiet(dm) || (pastDeadline && !dm.isSpeaking)) this.swapHandover();
  }

  /** startVoice(handover): create the standby call and its sideband; the live DM is untouched. */
  private async startStandby(offerSdp: string): Promise<string> {
    const h = this.handover;
    if (!h || h.creating || h.standby) throw new Error("No voice handover is waiting for a line.");
    if (this.dm?.mode !== "voice") {
      this.cancelHandover("the voice DM is not running");
      throw new Error("The voice DM is not running.");
    }
    h.creating = true;
    const owner: DmOwner = { standby: true };
    const host = this.dmHost(owner);
    let created: { answerSdp: string; callId: string };
    try {
      created = await this.createCall(host, offerSdp);
    } catch (err) {
      if (this.handover === h) this.cancelHandover(`creating the standby call failed: ${(err as Error).message}`, true);
      throw err;
    }
    if (this.handover !== h) throw new Error("The voice handover was cancelled.");
    const standby = new DmSession(host, "voice", created.callId, this.dmSessionOpts);
    standby.setMicMuted(this.micMuted);
    owner.dm = standby;
    h.creating = false;
    h.standby = standby;
    h.owner = owner;
    h.callId = created.callId;
    // Attach after returning the answer so the peer connection can complete (as in startVoice).
    setTimeout(() => {
      if (this.handover !== h) return;
      standby
        .connect()
        .then(() => {
          if (this.handover !== h) return;
          h.ready = true;
          this.maybeSwap();
        })
        .catch((err) => {
          if (standby.closedByCaller || this.handover !== h) return;
          this.cancelHandover(`the standby sideband failed: ${(err as Error).message}`, true);
        });
    }, 250);
    return created.answerSdp;
  }

  /** Make the standby the live DM, retire the old line and tell /host to swap audio. */
  private swapHandover() {
    const h = this.handover;
    const old = this.dm;
    if (!h?.standby || !h.callId || !old) return;
    const standby = h.standby;
    this.handover = undefined;
    try {
      // The call's session was configured at creation: bring its instructions up to date, then
      // hand it the recent play (the new conversation starts empty). No response: the DM waits.
      standby.refreshInstructions();
      const recent = this.recentPlay(40, 8000).trim();
      standby.seedHandover(recent ? `${HANDOVER_NOTE}\nRecent play:\n${recent}` : HANDOVER_NOTE);
    } catch (err) {
      this.handover = h;
      this.cancelHandover(`seeding the standby line failed: ${(err as Error).message}`, true);
      return;
    }
    this.dm = standby;
    if (h.owner) h.owner.standby = false;
    this.store.setActiveCall({ callId: h.callId, campaignId: this.requireCampaign().id, startedAt: Date.now() });
    old.close({ quiet: true });
    this.hub.broadcast({ type: "voice_handover", phase: "swap" });
    console.log(`[handover] swapped to call ${h.callId}`);
    this.log({ kind: "system", text: "Voice line renewed." });
  }

  /**
   * Drop a handover in progress: close the standby, keep the old call, tell /host to drop its
   * standby peer. `retry`: try again after HANDOVER_RETRY_MS (a failure, not a stop).
   */
  private cancelHandover(reason: string, retry = false) {
    const h = this.handover;
    if (!h) return;
    this.handover = undefined;
    h.standby?.close();
    if (retry) this.handoverRetryAt = Date.now() + HANDOVER_RETRY_MS;
    console.warn(`[handover] dropped: ${reason}`);
    this.hub.broadcast({ type: "voice_handover", phase: "abort" });
  }

  async startText() {
    this.requireState();
    if (!config.openaiKey) throw new Error("OPENAI_API_KEY is not set.");
    this.stopDm();
    this.readyCheck = undefined;
    const owner: { dm?: DmSession } = {};
    const dm = new DmSession(this.dmHost(owner), "text", undefined, this.dmSessionOpts);
    dm.setMicMuted(this.micMuted);
    owner.dm = dm;
    this.dm = dm;
    await dm.connect();
    dm.begin();
  }

  // ---------- the /table voice call ----------

  /** A /ws/audio stream opened (+1) or closed (-1). */
  audioSocket(role: AudioRole, delta: 1 | -1) {
    this.audioSockets[role] = Math.max(0, this.audioSockets[role] + delta);
    if (role === "table") this.broadcastVoiceOwner();
  }

  /** The /table screen that carries (or would carry) the call. */
  private voiceOwnerSocket(): HubSocket | undefined {
    const link = this.voiceLink;
    return pickVoiceOwner(this.hub.withRole("table"), link && link.state !== "idle" ? link.ws : undefined);
  }

  voiceOwner() {
    const owner = this.voiceOwnerSocket();
    const link = this.voiceLink?.ws === owner ? this.voiceLink : undefined;
    return voiceOwnerView({ tables: this.hub.withRole("table").length, link, tableAudio: this.audioSockets.table });
  }

  private broadcastVoiceOwner() {
    // The table carrying the voice DM is the call's room (it forwards the DM's voice to remote players).
    this.rtc.setRoomOwner(this.voiceOwnerSocket());
    this.hub.broadcast({ type: "voice_owner", owner: this.voiceOwner() });
  }

  /**
   * Host Start voice / Reconnect: /table runs the call, so ask it to (it then POSTs its offer to
   * /api/dm/voice). Throws when no table screen is open.
   */
  requestVoice(action: "start" | "reconnect"): { ok: true } {
    this.requireState();
    if (action === "start" && !config.openaiKey) throw new Error("OPENAI_API_KEY is not set.");
    const owner = this.voiceOwnerSocket();
    if (!owner) throw new Error("Open the table screen (/table) first: it runs the mic and the DM's voice.");
    this.hub.send(owner, { type: "voice_command", action });
    return { ok: true };
  }

  /**
   * Stop the DM. `keepCall`: a new call is replacing it (startVoice), so /table must not hang up;
   * otherwise /table is told to end its call too (else it would keep talking with no tools).
   */
  stopDm(opts: { keepCall?: boolean } = {}) {
    if (!opts.keepCall) {
      const owner = this.voiceOwnerSocket();
      if (owner) this.hub.send(owner, { type: "voice_command", action: "stop" });
    }
    this.cancelHandover("the DM was stopped");
    this.stopHandoverWatch();
    this.handoverRetryAt = 0;
    this.dm?.close();
    this.dm = undefined;
    this.store.clearActiveCall();
    this.npcClips.clear();
    this.aiPlayers.reset();
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

  // ---------- push-to-talk floor ----------

  floorView(): FloorView {
    const holdLeftMs = this.floor.msUntilExpiry();
    return {
      pushToTalk: this.pushToTalk,
      holder: this.floor.holder,
      ...(holdLeftMs !== undefined && { holdLeftMs }),
      ...(this.speaker.enrolling && { enrolling: true }),
      ...(this.speaker.recordingOn?.from === "player" && { enrollingPhone: this.speaker.recordingOn.playerId }),
    };
  }

  private broadcastFloor() {
    this.hub.broadcast({ type: "floor", floor: this.floorView() });
  }

  /**
   * A `ptt` from a /ws socket. /table (or /host) without a seat presses for the room. A player cookie
   * presses only for its own bound seat (remote, not in the room); a home-network phone (table access)
   * for the human seat it names (in the room). Anything else is ignored, as is every press while
   * push-to-talk is off. Only the socket that pressed can release. A press within PTT_MIN_GAP_MS of
   * the same socket's last press is ignored; releases always count and don't start the gap (a quick
   * let-go-and-press-again must not be dropped while the client thinks it holds).
   * A phone that is its player's mic (a micOnly call member) holds with `phone`, and may press with
   * push-to-talk off too: its voice reaches the DM only while it holds.
   */
  private onPtt(ev: { down: boolean; playerId?: unknown }, ws: HubSocket) {
    const holder = this.pttHolder(ev.playerId, ws);
    if (!holder) return;
    if (!this.pushToTalk && !("phone" in holder && holder.phone)) return;
    if (ev.down !== true) {
      // Its own hold, or one that lapsed on the 30 s cap without being announced yet.
      if (ws === this.floorWs && (this.floor.release(holder) || !this.floor.holder)) this.releaseFloor();
      return;
    }
    const now = Date.now();
    const last = this.lastPtt.get(ws);
    if (last !== undefined && now - last < PTT_MIN_GAP_MS) return;
    this.lastPtt.set(ws, now);
    if (this.floor.holder || !this.floor.press(holder)) return;
    this.floorWs = ws;
    // Someone wants the DM's ear: a pending AI player line yields.
    this.aiPlayers.interrupt("someone pressed to talk");
    this.armFloorTimer();
    this.broadcastFloor();
  }

  /**
   * Announce the auto release. A read after the cap may already have expired the hold silently, and
   * Node timers can fire a ms or so before Date.now() reaches the cap, so the callback re-arms while
   * the hold is still live instead of giving up.
   */
  private armFloorTimer() {
    clearTimeout(this.floorTimer);
    const left = this.floor.msUntilExpiry();
    if (left === undefined) return this.releaseFloor();
    this.floorTimer = setTimeout(() => this.armFloorTimer(), Math.max(1, left));
  }

  /**
   * Who a ptt from this socket speaks for, or undefined when it may not press (see onPtt). A seat hold
   * is in the room when the socket is (by its origin, Hub.inRoom: a home-network phone with a player
   * cookie under TRUST_LAN=0 is still at the table), so its hold opens the room mic.
   */
  private pttHolder(playerId: unknown, ws: HubSocket): FloorHolder | undefined {
    const access = this.hub.accessOf(ws);
    if (!access) return undefined;
    const inRoom = this.hub.inRoom(ws);
    if (access.level === "player") {
      // Its own bound seat only: naming another seat is refused, not rewritten.
      if (!access.playerId || (playerId !== undefined && playerId !== access.playerId)) return undefined;
      return this.seatHolder(access.playerId, inRoom, ws);
    }
    if (access.level !== "host" && access.level !== "table") return undefined;
    if (playerId === undefined) {
      const role = this.hub.roleOf(ws);
      return role === "table" || role === "host" ? { room: true } : undefined;
    }
    if (typeof playerId !== "string") return undefined;
    const p = this.state?.players.find((x) => x.id === playerId);
    return p && !p.ai ? this.seatHolder(p.id, inRoom, ws) : undefined;
  }

  /** A seat's hold; `phone` when this socket is that seat's phone mic in the call. */
  private seatHolder(playerId: string, inRoom: boolean, ws: HubSocket): FloorHolder {
    return this.rtc.micSeat(ws) === playerId ? { playerId, inRoom, phone: true } : { playerId, inRoom };
  }

  /** Host: take the floor back from whoever holds it (a stuck or hogged button); everyone is told. */
  freeFloor(): FloorView {
    const holder = this.floor.holder;
    if (holder) {
      this.diag("ptt", { freed: "room" in holder ? "room" : holder.playerId });
      this.log({ kind: "system", text: "The host freed the push-to-talk floor." });
      this.releaseFloor();
    }
    return this.floorView();
  }

  /** The floor was let go (release, auto release, holder socket closed, push-to-talk off): tell everyone. */
  private releaseFloor() {
    const holder = this.floor.holder;
    if (holder && this.floorWs) this.floor.release(holder);
    this.floorWs = undefined;
    clearTimeout(this.floorTimer);
    this.floorTimer = undefined;
    this.broadcastFloor();
  }

  /** Forget the holder and the timeline (push-to-talk toggled, campaign switched or closed): tell everyone. */
  private resetFloor() {
    this.floor.clear();
    this.floorWs = undefined;
    clearTimeout(this.floorTimer);
    this.floorTimer = undefined;
    this.broadcastFloor();
  }

  /**
   * The seat that held the floor most during [from, to], when a player (not the room) held it. With
   * push-to-talk off only phone-mic holds exist (and count).
   */
  private floorSeat(fromTs: number, toTs: number): string | undefined {
    const h = this.floor.holderDuring(fromTs, toTs);
    if (!h || !("playerId" in h) || (!this.pushToTalk && !h.phone)) return undefined;
    return this.state?.players.some((p) => p.id === h.playerId) ? h.playerId : undefined;
  }

  /** Host toggle: push-to-talk on (players hold a button) or off (open mic, as before). */
  setPushToTalk(on: boolean): { pushToTalk: boolean } {
    if (on === this.pushToTalk) return { pushToTalk: on };
    this.pushToTalk = on;
    this.diag("ptt", { on });
    this.resetFloor();
    this.log({ kind: "system", text: `Push-to-talk ${on ? "on: hold the button to talk to the DM" : "off: the DM hears the table"}.` });
    return { pushToTalk: on };
  }

  get isMicMuted() {
    return this.micMuted;
  }

  /**
   * Table mic hard mute, from the host, the TV or a phone (`playerId`), so the party can talk
   * without the DM hearing. A reply already playing finishes; unmuting doesn't prompt the DM.
   */
  setMicMuted(muted: boolean, playerId?: string, source?: string): { muted: boolean } {
    if (muted === this.micMuted) return { muted };
    this.micMuted = muted;
    const by = playerId && this.state ? this.speakerLabel(playerId).player?.name : undefined;
    // Which control did it (host P key or button, TV P key, phone, API): a session full of toggles can be traced.
    this.diag("mic", { muted, source: playerId ? "phone" : (source ?? "api"), ...(by ? { by } : {}) });
    if (muted) this.liveTalk.speechStopped();
    this.dm?.setMicMuted(muted);
    this.handover?.standby?.setMicMuted(muted);
    this.hub.broadcast({ type: "mic", muted, by });
    this.log({ kind: "system", text: `${by ?? "The table"} ${muted ? "muted" : "unmuted"} the table mic.` });
    return { muted };
  }

  /** Typed player input (text mode, or typing while voice is live). */
  sendText(text: string, playerId?: string) {
    const dm = this.requireLiveDm();
    const label = playerId ? this.speakerLabel(playerId).label : undefined;
    if (playerId) this.announceSpeaker(playerId, 1);
    if (!this.state?.players.some((p) => p.id === playerId && p.ai)) this.humanInputs++;
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

function sameEmbedding(a: Float32Array, b: Float32Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** A name for matching ("  Sam " = "sam"). */
function normName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}
