import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { WebSocketServer } from "ws";
import { existsSync, createReadStream } from "node:fs";
import { join, normalize } from "node:path";
import { config } from "./config.js";
import type { IncomingMessage } from "node:http";
import type { GameService } from "./game/service.js";
import type { AudioRole } from "./game/voice-owner.js";
import { registerApi } from "./routes/api.js";
import { registerCampaignRoutes } from "./routes/campaign.js";
import { ASSET_URL_PREFIX } from "./images/index.js";

/** The /ws and /ws/audio socket servers: one pair per GameService, shared by every listener. */
export interface Sockets {
  events: WebSocketServer;
  audio: WebSocketServer;
}

/** /ws = state/events for host, table and phones; /ws/audio = table (or host, enrolling) mic PCM16 @16 kHz for voice ID. */
export function createSockets(game: GameService): Sockets {
  const events = new WebSocketServer({ noServer: true });
  const audio = new WebSocketServer({ noServer: true });
  events.on("connection", (ws) => game.hub.add(ws));
  audio.on("connection", (ws, req: IncomingMessage) => {
    // ?role=host: the host's mic, used only while enrolling a voice; anything else is the /table mic.
    const role: AudioRole = new URLSearchParams((req.url ?? "").split("?")[1] ?? "").get("role") === "host" ? "host" : "table";
    game.audioSocket(role, 1);
    ws.on("close", () => game.audioSocket(role, -1));
    ws.on("message", (data, isBinary) => {
      if (isBinary) game.pushAudio(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer), role);
    });
  });
  return { events, audio };
}

export interface BuildAppOptions {
  /** TLS key and certificate: this instance serves HTTPS (the laptop host listener). */
  https?: { key: string; cert: string };
  /** Socket servers to route upgrades to (share one pair between the HTTP and HTTPS apps). */
  sockets?: Sockets;
}

/**
 * One Fastify instance with every route, the media files, the built web app and the WebSocket
 * upgrades. index.ts builds it twice (HTTP on PORT, HTTPS on HTTPS_PORT) over the same GameService.
 */
export async function buildApp(game: GameService, opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const base = { logger: { level: "warn" }, bodyLimit: 5 * 1024 * 1024 };
  // Fastify's type switches on the `https` option; both shapes are a FastifyInstance for our routes.
  const app = (opts.https ? Fastify({ ...base, https: opts.https }) : Fastify(base)) as unknown as FastifyInstance;

  app.setErrorHandler((err: FastifyError, _req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 400;
    reply.status(status).send({ error: err.message });
  });

  registerApi(app, game);
  registerCampaignRoutes(app, game);

  // Campaign images and NPC voice clips (.png/.mp3): /media/<campaignId>/<file>  ->  <dataDir>/<campaignId>/assets/<file>
  app.get(`${ASSET_URL_PREFIX}/:campaignId/:file`, async (req, reply) => {
    const { campaignId, file } = req.params as { campaignId: string; file: string };
    if (!/^[\w-]+$/.test(campaignId) || !/^[\w.-]+\.(png|mp3)$/.test(file)) return reply.status(404).send();
    const path = normalize(join(config.dataDir, campaignId, "assets", file));
    if (!existsSync(path)) return reply.status(404).send();
    reply.header("cache-control", "public, max-age=31536000, immutable").type(file.endsWith(".mp3") ? "audio/mpeg" : "image/png");
    return reply.send(createReadStream(path));
  });

  // Built web app (production). In development Vite serves the UI and proxies /api and /ws here.
  if (existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist, wildcard: true });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api")) return reply.status(404).send({ error: "Not found" });
      return reply.sendFile("index.html");
    });
  }

  const sockets = opts.sockets ?? createSockets(game);
  app.server.on("upgrade", (req, socket, head) => {
    const path = (req.url ?? "").split("?")[0];
    const target = path === "/ws" ? sockets.events : path === "/ws/audio" ? sockets.audio : undefined;
    if (!target) return socket.destroy();
    target.handleUpgrade(req, socket, head, (ws) => target.emit("connection", ws, req));
  });
  return app;
}
