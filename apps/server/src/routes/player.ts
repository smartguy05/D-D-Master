import type { FastifyInstance, FastifyRequest } from "fastify";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import { config } from "../config.js";
import { lanIPv4 } from "../tls.js";
import type { GameService } from "../game/service.js";
import { seatRollReply } from "../publicFeed.js";

type Body = Record<string, any>;

/** Addresses the phones can open (the host laptop is usually on localhost): PUBLIC_URL first, then the LAN IPs. */
export function lanUrls(port = config.port, publicUrl = config.publicUrl, nets: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): string[] {
  const urls: string[] = publicUrl ? [`${publicUrl.replace(/\/+$/, "")}/player`] : [];
  // Docker/VM bridges last: phones can't reach them, and the QR code uses the first address.
  // Phones stay on http: no certificate warning to click through on every phone.
  for (const ip of lanIPv4(nets)) urls.push(`http://${ip}:${port}/player`);
  return urls;
}

/** The host screen over HTTPS (mic allowed off localhost) for a laptop on the LAN; empty with HTTPS_PORT=0. */
export function hostUrls(httpsPort = config.httpsPort, nets: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): string[] {
  return httpsPort ? lanIPv4(nets).map((ip) => `https://${ip}:${httpsPort}/host`) : [];
}

/**
 * Routes for player phones (/player/:playerId) and the voice character builder (host Party tab).
 * Phones get state over /ws like the host; the POSTs below are their only write paths.
 */
export function registerPlayerRoutes(app: FastifyInstance, game: GameService) {
  // `preferred`: PUBLIC_URL is set, so links and QR codes use it even when the host isn't on localhost.
  // `hostUrls`: https links for a laptop running /host and /table against this server (see tls.ts).
  app.get("/api/player-urls", async () => ({ urls: lanUrls(), preferred: !!config.publicUrl, hostUrls: hostUrls() }));

  // Virtual dice from a phone: rolls, animates on the TV and tells the DM.
  // Below the host the reply is trimmed (seatRollReply): the tool result names the target's AC and DM hints.
  const rollReply = (req: FastifyRequest, result: unknown) =>
    req.access && req.access.level !== "host" ? seatRollReply(result as Record<string, unknown>) : result;
  app.post("/api/players/:id/roll", async (req) => {
    const b = (req.body ?? {}) as Body;
    return rollReply(req, await game.playerRoll((req.params as Body).id, String(b.notation ?? ""), String(b.label ?? "")));
  });
  // Physical dice total from a phone: only accepted for that player's pending roll.
  app.post("/api/players/:id/physical-roll", async (req) => {
    const b = (req.body ?? {}) as Body;
    return rollReply(req, await game.submitPhysicalRoll({ total: b.total, natural: b.natural, critical: b.critical, playerId: (req.params as Body).id }));
  });
  // Read-only spell cards for the phone's spell chips (level badge, concentration, ritual).
  // Private notes: only this phone reads and writes them (not in the /ws state, not shown to the DM).
  app.get("/api/players/:id/notes", async (req) => game.playerNotes((req.params as Body).id));
  app.put("/api/players/:id/notes", async (req) => game.savePlayerNotes((req.params as Body).id, ((req.body ?? {}) as Body).text));
  app.get("/api/players/:id/spells", async (req) => ({ spells: game.playerSpells((req.params as Body).id) }));
  // Table mic mute from a phone (the log says who).
  app.post("/api/players/:id/mic", async (req) => game.setMicMuted(((req.body ?? {}) as Body).muted === true, (req.params as Body).id));
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
