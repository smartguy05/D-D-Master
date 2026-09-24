import type { FastifyInstance } from "fastify";
import { isToolName } from "@dm/shared";
import type { GameService } from "../game/service.js";

type Body = Record<string, any>;

/** REST API used by the /host screen. Every route answers JSON; errors become { error }. */
export function registerApi(app: FastifyInstance, game: GameService) {
  app.get("/api/status", async () => ({ ...game.capabilities(), dm: game.dmState, campaignId: game.campaign?.id ?? null }));

  // campaigns
  app.get("/api/campaigns", async () => game.listCampaigns());
  app.post("/api/campaigns", async (req) => game.createCampaign(req.body as Body as { name: string }));
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

  // players & voice enrollment
  app.post("/api/players", async (req) => game.addPlayer(String((req.body as Body).name ?? "")));
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
  app.post("/api/rolls/physical", async (req) => {
    const b = req.body as Body;
    const pending = game.state?.pendingRoll;
    const characterId = b.characterId ?? pending?.characterId;
    const result = await game.runTool(
      "record_physical_roll",
      { character_id: characterId, notation: pending?.notation ?? "1d20", label: pending?.label ?? "Roll", total: Number(b.total), dc: pending?.dc },
      "host",
    );
    try {
      game.whisper(`${JSON.stringify(result)} - the player rolled physical dice; continue.`);
    } catch {
      /* DM not running */
    }
    return result;
  });

  // DM session
  app.addContentTypeParser("application/sdp", { parseAs: "string" }, (_req, body, done) => done(null, body));
  app.post("/api/dm/voice", async (req, reply) => {
    const resume = (req.query as { resume?: string }).resume === "1";
    const answer = await game.startVoice(String(req.body), resume);
    reply.header("content-type", "application/sdp");
    return answer;
  });
  app.post("/api/dm/text", async () => {
    await game.startText();
    return { ok: true };
  });
  app.post("/api/dm/stop", async () => {
    game.stopDm();
    return { ok: true };
  });
  app.post("/api/dm/say", async (req) => {
    const b = req.body as Body;
    game.sendText(String(b.text ?? ""), b.playerId);
    return { ok: true };
  });
  app.post("/api/dm/whisper", async (req) => {
    game.whisper(String((req.body as Body).text ?? ""));
    return { ok: true };
  });
}
