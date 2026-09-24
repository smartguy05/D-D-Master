import type { FastifyInstance } from "fastify";
import { networkInterfaces } from "node:os";
import { config } from "../config.js";
import type { GameService } from "../game/service.js";

type Body = Record<string, any>;

/** LAN addresses the phones can open (the host laptop is usually on localhost). */
export function lanUrls(port = config.port): string[] {
  const urls: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) urls.push(`http://${a.address}:${port}/player`);
  }
  return urls;
}

/**
 * Routes for player phones (/player/:playerId) and the voice character builder (host Party tab).
 * Phones get state over /ws like the host; these are their only write paths.
 */
export function registerPlayerRoutes(app: FastifyInstance, game: GameService) {
  app.get("/api/player-urls", async () => ({ urls: lanUrls() }));

  // Virtual dice from a phone: rolls, animates on the TV and tells the DM.
  app.post("/api/players/:id/roll", async (req) => {
    const b = (req.body ?? {}) as Body;
    return game.playerRoll((req.params as Body).id, String(b.notation ?? ""), String(b.label ?? ""));
  });
  // Physical dice total from a phone: only accepted for that player's pending roll.
  app.post("/api/players/:id/physical-roll", async (req) => {
    const b = (req.body ?? {}) as Body;
    return game.submitPhysicalRoll({ total: b.total, playerId: (req.params as Body).id });
  });
  app.post("/api/players/:id/dice-mode", async (req) => {
    game.setPlayerDiceMode((req.params as Body).id, ((req.body ?? {}) as Body).diceMode);
    return { ok: true };
  });

  // Voice character builder (host side). The DM uses the draft_character_update / finalize_character tools.
  app.post("/api/builder/start", async (req) => {
    const b = (req.body ?? {}) as Body;
    return game.startCharacterBuilder(String(b.playerId ?? ""), b.level === undefined ? undefined : Number(b.level), "host");
  });
  app.patch("/api/builder", async (req) => {
    const b = (req.body ?? {}) as Body;
    return game.updateCharacterDraft(b.draft ?? {}, b.level === undefined ? undefined : Number(b.level));
  });
  app.post("/api/builder/finalize", async () => {
    const res = game.finalizeCharacter();
    if (!res.ok) throw new Error(res.message);
    return res;
  });
  app.delete("/api/builder", async () => {
    game.cancelCharacterBuilder();
    return { ok: true };
  });
}
