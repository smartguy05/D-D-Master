import type { FastifyInstance } from "fastify";
import type { GameService } from "../game/service.js";

type Body = Record<string, any>;

/** The global character roster (game/roster.ts). Registered by registerApi; errors become 400 + { error }. */
export function registerRosterRoutes(app: FastifyInstance, game: GameService) {
  app.get("/api/roster", async () => game.listRoster());
  app.post("/api/roster/save-all", async () => game.saveAllToRoster());
  app.post("/api/roster/save/:characterId", async (req) => game.saveToRoster((req.params as Body).characterId));
  app.post("/api/roster/:id/join", async (req) => {
    const playerId = (req.body as Body | undefined)?.playerId;
    return game.joinFromRoster((req.params as Body).id, typeof playerId === "string" && playerId ? playerId : undefined);
  });
  app.delete("/api/roster/:id", async (req) => {
    game.deleteRoster((req.params as Body).id);
    return { ok: true };
  });
}
