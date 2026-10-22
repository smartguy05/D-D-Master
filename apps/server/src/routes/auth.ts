import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { GameService } from "../game/service.js";
import type { Auth } from "../auth/index.js";
import { authCookie, clearAuthCookie, safeEqual } from "../auth/token.js";

type Body = Record<string, any>;

/** The cookie gets Secure when the browser is on https (directly, or behind a tunnel/proxy that says so). */
function secureRequest(req: FastifyRequest): boolean {
  const fwd = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim().toLowerCase();
  return req.protocol === "https" || fwd === "https";
}

/** Sign-in routes (docs/server/auth.md). Access levels per route are in auth/access.ts (routeNeed). */
export function registerAuthRoutes(app: FastifyInstance, game: GameService, auth: Auth) {
  const caller = (req: FastifyRequest) => auth.caller(req.socket.remoteAddress, req.headers);
  const limited = (req: FastifyRequest, reply: FastifyReply) => {
    const { ip, kind } = caller(req).origin;
    const remote = kind === "remote";
    if (!auth.limiter.blocked(ip, remote)) return undefined;
    const wait = Math.ceil(auth.limiter.retryAfterMs(ip, remote) / 1000);
    reply.header("retry-after", String(wait));
    return reply.status(429).send({ error: `Too many wrong tries. Wait ${Math.ceil(wait / 60)} min and try again.` });
  };

  const fail = (req: FastifyRequest) => {
    const { ip, kind } = caller(req).origin;
    auth.limiter.fail(ip, kind === "remote");
  };

  /** Human seats of the loaded campaign, as this sign-in sees them. */
  const seats = (sid?: string) => {
    const s = game.state;
    if (!s) return [];
    return s.players
      .filter((p) => !p.ai)
      .map((p) => {
        const owner = auth.store.seatOwner(p.id);
        return {
          id: p.id,
          name: p.name,
          character: s.characters.find((c) => c.id === p.characterId)?.name,
          claimed: !!owner && owner !== sid,
          mine: !!owner && owner === sid,
        };
      });
  };

  app.get("/api/auth/me", async (req) => {
    const { access, origin } = caller(req);
    return { level: access.level, playerId: access.playerId, origin: origin.kind, hostLogin: !!auth.hostPassword };
  });

  app.post("/api/auth/host", async (req, reply) => {
    if (limited(req, reply)) return reply;
    if (!auth.hostPassword) return reply.status(403).send({ error: "Host sign-in is off. Set HOST_PASSWORD in .env, or open the host screen on the server's own machine." });
    const password = String(((req.body ?? {}) as Body).password ?? "");
    if (!safeEqual(password, auth.hostPassword)) {
      fail(req);
      return reply.status(401).send({ error: "Wrong password." });
    }
    reply.header("set-cookie", authCookie(auth.issue({ k: "host", sid: auth.newSid(), pw: auth.hostFingerprint }), secureRequest(req)));
    return { ok: true, level: "host" };
  });

  app.post("/api/auth/join", async (req, reply) => {
    if (limited(req, reply)) return reply;
    const code = String(((req.body ?? {}) as Body).code ?? "");
    if (!auth.store.codeMatches(code)) {
      fail(req);
      return reply.status(401).send({ error: "That code doesn't match. Check it with the host." });
    }
    // Already signed in as a player for this code: keep that sign-in (and its seat).
    const current = caller(req).token;
    if (current?.k === "player") return { ok: true, seats: seats(current.sid), playerId: current.pid };
    const sid = auth.newSid();
    reply.header("set-cookie", authCookie(auth.issue({ k: "player", sid }), secureRequest(req)));
    return { ok: true, seats: seats(sid) };
  });

  app.get("/api/auth/claim", async (req) => ({ seats: seats(caller(req).token?.sid) }));

  app.post("/api/auth/claim", async (req, reply) => {
    const { token, access } = caller(req);
    const playerId = String(((req.body ?? {}) as Body).playerId ?? "");
    const player = game.state?.players.find((p) => p.id === playerId);
    if (!player || player.ai) return reply.status(400).send({ error: "Pick one of the players at this table." });
    if (!token || token.k !== "player") {
      // The LAN and the host need no seat binding: any seat works for them.
      if (access.anySeat) return { ok: true, playerId };
      return reply.status(401).send({ error: "Join with the table code first." });
    }
    // A seat held by another sign-in is in use while it has a socket open, or had one within the grace
    // time (a reload, a Wi-Fi blip). Past that its holder is gone (cleared cookies, another browser), so
    // this sign-in may take it over without the host having to kick it.
    const owner = auth.store.seatOwner(playerId);
    const claimedAt = auth.store.claims().find((c) => c.playerId === playerId)?.at ?? 0;
    const lastUsed = Math.max(game.hub.seatLastSeen(playerId) ?? 0, claimedAt);
    const inUse = !!owner && owner !== token.sid && (!!game.hub.connectedPlayers()[playerId] || auth.now() - lastUsed < auth.seatGraceMs);
    if (inUse || !auth.store.claim(playerId, token.sid, { force: true }).ok) {
      return reply.status(409).send({ error: `${player.name} is already playing on another device. If that was you on another browser, try again in two minutes, or ask the host to free the seat (Online card, Kick).` });
    }
    // This sign-in's sockets still carry its old seat: drop them, they reconnect with the new cookie.
    if (token.pid !== playerId) game.hub.closeWhere((a) => a.level === "player" && a.sid === token.sid);
    reply.header("set-cookie", authCookie(auth.issue({ k: "player", sid: token.sid, pid: playerId }), secureRequest(req)));
    return { ok: true, playerId };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const { token } = caller(req);
    if (token?.k === "player" && token.pid && auth.store.seatOwner(token.pid) === token.sid) auth.store.release(token.pid);
    if (token) game.hub.closeWhere((a) => a.sid === token.sid);
    reply.header("set-cookie", clearAuthCookie(secureRequest(req)));
    return { ok: true };
  });

  // ---- host only ----
  app.post("/api/auth/code/rotate", async () => {
    const code = auth.store.rotate();
    // Every player cookie is now dead: close their sockets (LAN phones and the TV keep theirs).
    game.hub.closeWhere((a) => a.level === "player");
    return { code };
  });

  app.post("/api/auth/kick", async (req) => {
    const playerId = String(((req.body ?? {}) as Body).playerId ?? "");
    const released = auth.store.release(playerId);
    const closed = game.hub.closeWhere((a) => a.level === "player" && a.playerId === playerId);
    return { ok: true, released, closed };
  });

  app.get("/api/auth/sessions", async () => {
    const connected = game.hub.connectedPlayers();
    const claims = new Map(auth.store.claims().map((c) => [c.playerId, c]));
    return {
      code: auth.store.code,
      fixedCode: auth.store.fixedCode,
      onlineUrl: auth.onlineUrl,
      invitePath: `/join?code=${encodeURIComponent(auth.store.code)}`,
      hostLogin: !!auth.hostPassword,
      trustLan: auth.policy.trustLan,
      seats: seats().map((s) => ({
        playerId: s.id,
        name: s.name,
        character: s.character,
        claimed: s.claimed,
        claimedAt: claims.get(s.id)?.at,
        connected: connected[s.id] ?? 0,
      })),
    };
  });
}
