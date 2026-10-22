import type { FastifyInstance } from "fastify";
import { isToolName, SAY_MIN_GAP_MS, sayText } from "@dm/shared";
import { config } from "../config.js";
import type { GameService } from "../game/service.js";
import { registerPlayerRoutes } from "./player.js";
import { registerRosterRoutes } from "./roster.js";

type Body = Record<string, any>;

/** REST API used by the /host screen. Every route answers JSON; errors become { error }. */
export function registerApi(app: FastifyInstance, game: GameService) {
  app.get("/api/status", async () => ({ ...game.capabilities(), dm: game.dmState, campaignId: game.campaign?.id ?? null }));

  // campaigns
  app.get("/api/campaigns", async () => game.listCampaigns());
  app.post("/api/campaigns", async (req) => game.createCampaign(req.body as Body as { name: string }));
  app.patch("/api/campaign/settings", async (req) => game.updateCampaignSettings(req.body as Body));
  // Host: lock or unlock players' edits of characters that joined (set by itself when play starts).
  // Host: draft custom species for the campaign's character constraints (returned, not saved).
  app.post("/api/campaign/custom-species/draft", async (req) => ({ species: await game.draftCustomSpecies(String(((req.body ?? {}) as Body).prompt ?? "")) }));
  // Every SRD species and class name, for the host's Character rules pickers.
  app.get("/api/rules/origins", async () => game.originCatalog());
  app.post("/api/campaign/creation-lock", async (req) => game.setCreationLock(((req.body ?? {}) as Body).locked === true));
  app.post("/api/campaigns/:id/load", async (req) => {
    game.loadCampaign((req.params as Body).id);
    return { ok: true };
  });
  app.delete("/api/campaigns/:id", async (req) => {
    game.deleteCampaign((req.params as Body).id);
    return { ok: true };
  });
  app.post("/api/campaign/outline", async (req) => game.generateOutline(req.body as Body));
  app.post("/api/campaign/map", async (req) => {
    const b = req.body as Body;
    return { url: await game.generateMap(b.locationId, !!b.force) };
  });
  app.post("/api/campaign/end-session", async () => ({ summary: await game.endSession() }));

  // global character roster
  registerRosterRoutes(app, game);

  // players & voice enrollment
  app.post("/api/players", async (req) => game.addPlayer(String((req.body as Body).name ?? ""), { ai: (req.body as Body).ai === true }));
  app.post("/api/players/:id/ai/nudge", async (req) => game.nudgeAiPlayer((req.params as Body).id));
  app.patch("/api/players/:id", async (req) => {
    game.updatePlayer((req.params as Body).id, req.body as Body);
    return { ok: true };
  });
  app.delete("/api/players/:id", async (req) => {
    game.removePlayer((req.params as Body).id);
    return { ok: true };
  });
  app.post("/api/players/:id/enroll/start", async (req) => {
    game.startEnrollment((req.params as Body).id);
    return { ok: true };
  });
  app.post("/api/players/:id/enroll/stop", async (req) => game.finishEnrollment((req.params as Body).id));
  app.post("/api/voice-test/start", async () => {
    game.startVoiceTest();
    return { ok: true };
  });
  app.post("/api/voice-test/stop", async () => game.finishVoiceTest());
  app.post("/api/speaker", async (req) => {
    game.setManualSpeaker((req.body as Body).playerId ?? null);
    return { ok: true };
  });

  // characters
  app.post("/api/characters", async (req) => {
    const b = req.body as Body;
    return game.addCharacter(b.character, b.playerId);
  });
  app.patch("/api/characters/:id", async (req) => {
    game.updateCharacter((req.params as Body).id, req.body as Body);
    return { ok: true };
  });
  app.delete("/api/characters/:id", async (req) => {
    game.removeCharacter((req.params as Body).id);
    return { ok: true };
  });
  app.post("/api/characters/:id/sprite", async (req) => {
    await game.generateCharacterSprite((req.params as Body).id);
    return { ok: true };
  });
  app.post("/api/characters/pregens", async (req) => {
    const b = req.body as Body;
    return game.generatePregens(Math.min(8, Math.max(1, Number(b.count) || 4)), String(b.wishes ?? ""));
  });
  app.post("/api/characters/import", async (req) => {
    const b = req.body as Body;
    return game.importSheet(String(b.sheet ?? ""), b.playerId);
  });

  // manual tools (host overrides) and rules
  app.post("/api/tools/:name", async (req) => {
    const name = (req.params as Body).name;
    if (!isToolName(name)) throw new Error(`Unknown tool ${name}`);
    return { result: await game.runTool(name, req.body ?? {}, "host") };
  });
  app.post("/api/rules/search", async (req) => game.rules.query(String((req.body as Body).q ?? ""), 8));
  app.get("/api/monsters", async () => game.monsters.names());

  // physical dice: host enters the total a player called out
  // (playerId limits it to that player's own pending roll; see game/player.ts)
  app.post("/api/rolls/physical", async (req) => {
    const b = (req.body ?? {}) as Body;
    return game.submitPhysicalRoll({ total: b.total, natural: b.natural, critical: b.critical, characterId: b.characterId, playerId: b.playerId });
  });
  registerPlayerRoutes(app, game);

  // WebRTC ICE servers for player video and voice (ICE_SERVERS).
  app.get("/api/rtc/config", async () => ({ iceServers: config.iceServers }));

  // DM session
  app.addContentTypeParser("application/sdp", { parseAs: "string" }, (_req, body, done) => done(null, body));
  app.post("/api/dm/voice", async (req, reply) => {
    const q = req.query as { resume?: string; handover?: string };
    // handover=1: the standby peer of a planned call renewal (GameService.startVoice).
    const answer = await game.startVoice(String(req.body), q.resume === "1", q.handover === "1");
    reply.header("content-type", "application/sdp");
    return answer;
  });
  // /host buttons: /table carries the call, so these ask it to start or rebuild (resume) one.
  app.post("/api/dm/voice/start", async () => game.requestVoice("start"));
  app.post("/api/dm/voice/reconnect", async () => game.requestVoice("reconnect"));
  app.post("/api/dm/text", async () => {
    await game.startText();
    return { ok: true };
  });
  app.post("/api/dm/stop", async () => {
    game.stopDm();
    return { ok: true };
  });
  app.post("/api/dm/stop-talking", async () => game.stopTalking());
  // Table mic mute (host button/hotkey, TV key): the DM hears nothing until unmuted.
  app.post("/api/mic", async (req) => {
    const b = (req.body ?? {}) as Body;
    // source: which control sent it (host-key, host-button, table-key), for the session diagnostics.
    const source = typeof b.source === "string" && /^[a-z-]{1,20}$/.test(b.source) ? b.source : undefined;
    return game.setMicMuted(b.muted === true, undefined, source);
  });
  // Host toggle: push-to-talk to the DM (players hold a button) or open mic. Host-only (auth/access.ts).
  app.post("/api/push-to-talk", async (req) => game.setPushToTalk(((req.body ?? {}) as Body).on === true));
  // Host: take the push-to-talk floor back from whoever holds it (a stuck or hogged button). Host-only.
  app.post("/api/floor/release", async () => game.freeFloor());
  // Typed input to the DM. Capped here (SAY_MAX), not only on the page. A seat-bound caller (a remote
  // player, auth/access.ts) types only as its own seat, at most SAY_MAX characters, at most once per
  // SAY_MIN_GAP_MS (counted only when the line reached the DM), and not while
  // someone else holds the push-to-talk floor (the text would cut into their turn).
  const lastSay = new Map<string, number>();
  app.post("/api/dm/say", async (req, reply) => {
    const b = (req.body ?? {}) as Body;
    const seatBound = !!req.access && !req.access.anySeat;
    if (seatBound && (!req.access!.playerId || b.playerId !== req.access!.playerId)) {
      return reply.status(403).send({ error: "You can only speak for your own character." });
    }
    // Players are capped at SAY_MAX; the host types for a seat on purpose and keeps its full line.
    const text = seatBound ? sayText(b.text) : typeof b.text === "string" ? b.text.trim() || undefined : undefined;
    if (!text) return reply.status(400).send({ error: "Type something to say." });
    const playerId = typeof b.playerId === "string" ? b.playerId : undefined;
    if (seatBound) {
      const floor = game.floorView();
      if (floor.pushToTalk && floor.holder && ("room" in floor.holder || floor.holder.playerId !== playerId)) {
        return reply.status(409).send({ error: "Someone else is talking to the DM; wait for them to finish." });
      }
      const key = req.access!.sid ?? playerId!;
      const now = Date.now();
      const last = lastSay.get(key);
      if (last !== undefined && now - last < SAY_MIN_GAP_MS) {
        return reply.status(429).send({ error: "Slow down a little before typing to the DM again." });
      }
      // sendText throws while the DM is down: only a line that reached it uses up the slot.
      game.sendText(text, playerId);
      lastSay.set(key, now);
      // Forget old entries so the map stays small.
      if (lastSay.size > 200) for (const [k, t] of lastSay) if (now - t >= SAY_MIN_GAP_MS) lastSay.delete(k);
      return { ok: true };
    }
    game.sendText(text, playerId);
    return { ok: true };
  });
  // /table reports that an NPC clip (speak_as_npc) ended, failed or was skipped (muted).
  app.post("/api/npc/clip-ended", async (req) => game.npcClipEnded(String((req.body as Body)?.url ?? "")));
  app.post("/api/dm/whisper", async (req) => {
    game.whisper(String((req.body as Body).text ?? ""));
    return { ok: true };
  });
}
