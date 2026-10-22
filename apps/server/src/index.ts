import { config } from "./config.js";
import { GameService } from "./game/service.js";
import { buildApp, createSockets } from "./app.js";
import { hostUrls } from "./routes/player.js";
import { loadOrCreateCert } from "./tls.js";
import { Auth } from "./auth/index.js";

const game = new GameService();
await game.init();

// One GameService and one pair of socket servers behind both listeners.
const sockets = createSockets(game);
// One sign-in store (cookie secret, table code, seats) behind both listeners: <DATA_DIR>/auth.json.
const auth = Auth.fromConfig(Auth.defaultFile());
const app = await buildApp(game, { sockets, auth });
await app.listen({ port: config.port, host: "0.0.0.0" });

// HTTPS on a second port: browsers allow the mic only on https or localhost, so a laptop running
// /host against this machine needs it. Phones and a plain TV keep using http on PORT.
let httpsUrl = "";
if (config.httpsPort) {
  try {
    const tls = await loadOrCreateCert(config.dataDir, { certPath: config.httpsCert, keyPath: config.httpsKey });
    const secure = await buildApp(game, { sockets, auth, https: { key: tls.key, cert: tls.cert } });
    await secure.listen({ port: config.httpsPort, host: "0.0.0.0" });
    httpsUrl = `https://localhost:${config.httpsPort}`;
    if (tls.created) console.log(`  Made a self-signed certificate in ${config.dataDir}/certs (for ${tls.ips.join(", ")}).`);
  } catch (err) {
    console.warn(`HTTPS listener on port ${config.httpsPort} is off: ${(err as Error).message}`);
  }
}

const caps = game.capabilities();
console.log(`Hearthmaster server on http://localhost:${config.port}${httpsUrl ? ` and ${httpsUrl}` : ""}`);
const laptop = httpsUrl ? hostUrls()[0] : undefined; // real NICs first; Docker bridges are no use to a laptop
if (laptop) console.log(`  Laptop host/TV (accept the certificate once): ${laptop}  and  ${laptop.replace(/\/host$/, "/table")}`);
console.log(`  OpenAI: ${caps.openai ? "yes" : "NO (set OPENAI_API_KEY)"} | brain: ${caps.brain ?? "none"} | images: ${caps.images}`);
console.log(`  ${caps.voiceIdStatus}`);
console.log(`  Rules: ${caps.rulesChunks} chunks, ${caps.srdMonsters} SRD monsters, ${caps.srdSpells} spells, ${caps.srdClasses} classes`);
console.log(
  `  Online play: table code ${auth.store.code}${config.onlineUrl ? ` | invite ${config.onlineUrl}/join` : " | set ONLINE_URL to your tunnel address"} | host sign-in ${config.hostPassword ? "on (/login)" : "off (set HOST_PASSWORD)"}`,
);
