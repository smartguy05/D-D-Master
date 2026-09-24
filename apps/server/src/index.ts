import Fastify, { type FastifyError } from "fastify";
import fastifyStatic from "@fastify/static";
import { WebSocketServer } from "ws";
import { existsSync, createReadStream } from "node:fs";
import { join, normalize } from "node:path";
import { config } from "./config.js";
import { GameService } from "./game/service.js";
import { registerApi } from "./routes/api.js";
import { registerCampaignRoutes } from "./routes/campaign.js";
import { ASSET_URL_PREFIX } from "./images/index.js";

const game = new GameService();
await game.init();

const app = Fastify({ logger: { level: "warn" }, bodyLimit: 5 * 1024 * 1024 });

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

// WebSockets: /ws = state/events for host and table, /ws/audio = host mic PCM16 @16 kHz for voice ID.
const events = new WebSocketServer({ noServer: true });
const audio = new WebSocketServer({ noServer: true });
events.on("connection", (ws) => game.hub.add(ws));
audio.on("connection", (ws) => {
  ws.on("message", (data, isBinary) => {
    if (isBinary) game.pushAudio(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
  });
});
app.server.on("upgrade", (req, socket, head) => {
  const path = (req.url ?? "").split("?")[0];
  const target = path === "/ws" ? events : path === "/ws/audio" ? audio : undefined;
  if (!target) return socket.destroy();
  target.handleUpgrade(req, socket, head, (ws) => target.emit("connection", ws, req));
});

await app.listen({ port: config.port, host: "0.0.0.0" });
const caps = game.capabilities();
console.log(`AI Dungeon Master server on http://localhost:${config.port}`);
console.log(`  OpenAI: ${caps.openai ? "yes" : "NO (set OPENAI_API_KEY)"} | brain: ${caps.brain ?? "none"} | images: ${caps.images}`);
console.log(`  ${caps.voiceIdStatus}`);
console.log(`  Rules: ${caps.rulesChunks} chunks, ${caps.srdMonsters} SRD monsters`);
