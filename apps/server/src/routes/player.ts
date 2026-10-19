import type { FastifyInstance } from "fastify";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import { config } from "../config.js";
import type { GameService } from "../game/service.js";

type Body = Record<string, any>;

/** Addresses the phones can open (the host laptop is usually on localhost): PUBLIC_URL first, then the LAN IPs. */
export function lanUrls(port = config.port, publicUrl = config.publicUrl, nets: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): string[] {
  const urls: string[] = publicUrl ? [`${publicUrl.replace(/\/+$/, "")}/player`] : [];
  // Docker/VM bridges last: phones can't reach them, and the QR code uses the first address.
  const virtual = (name: string) => /^(docker|br-|veth|virbr|vboxnet|vmnet|lxc|lxd|tailscale|zt|utun)/i.test(name);
  const names = Object.keys(nets).sort((a, b) => Number(virtual(a)) - Number(virtual(b)));
  for (const list of names.map((n) => nets[n])) {
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) urls.push(`http://${a.address}:${port}/player`);
  }
  return urls;
}

/**
 * Routes for player phones (/player/:playerId) and the voice character builder (host Party tab).
 * Phones get state over /ws like the host; the POSTs below are their only write paths.
 */
export function registerPlayerRoutes(app: FastifyInstance, game: GameService) {
  // `preferred`: PUBLIC_URL is set, so links and QR codes use it even when the host isn't on localhost.
  app.get("/api/player-urls", async () => ({ urls: lanUrls(), preferred: !!config.publicUrl }));

  // Virtual dice from a phone: rolls, animates on the TV and tells the DM.
  app.post("/api/players/:id/roll", async (req) => {
    const b = (req.body ?? {}) as Body;
    return game.playerRoll((req.params as Body).id, String(b.notation ?? ""), String(b.label ?? ""));
  });
  // Physical dice total from a phone: only accepted for that player's pending roll.
  app.post("/api/players/:id/physical-roll", async (req) => {
    const b = (req.body ?? {}) as Body;
    return game.submitPhysicalRoll({ total: b.total, natural: b.natural, playerId: (req.params as Body).id });
  });
  // Read-only spell cards for the phone's spell chips (level badge, concentration, ritual).
  // Private notes: only this phone reads and writes them (not in the /ws state, not shown to the DM).
  app.get("/api/players/:id/notes", async (req) => game.playerNotes((req.params as Body).id));
  app.put("/api/players/:id/notes", async (req) => game.savePlayerNotes((req.params as Body).id, ((req.body ?? {}) as Body).text));
  app.get("/api/players/:id/spells", async (req) => ({ spells: game.playerSpells((req.params as Body).id) }));
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
