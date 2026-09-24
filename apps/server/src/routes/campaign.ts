import type { FastifyInstance } from "fastify";
import type { GameService } from "../game/service.js";
import { BUNDLE_MAX_BYTES, bundleFilename } from "../game/bundle.js";

type Body = Record<string, any>;

/** Campaign management: undo history, export/import bundles, outline editing. */
export function registerCampaignRoutes(app: FastifyInstance, game: GameService) {
  // undo history
  app.get("/api/history", async (req) => {
    const limit = Number((req.query as Body).limit);
    return game.listHistory(Number.isFinite(limit) && limit > 0 ? limit : undefined);
  });
  app.post("/api/history/undo", async () => game.undo());
  app.post("/api/history/restore", async (req) => {
    const version = Number((req.body as Body | undefined)?.version);
    if (!Number.isInteger(version)) throw new Error("version (integer) is required");
    return game.restoreHistory(version);
  });

  // export / import
  app.get("/api/campaigns/:id/export", async (req, reply) => {
    const q = req.query as Body;
    const { campaign, data } = game.exportCampaign((req.params as Body).id, { events: q.events !== "0" && q.events !== "false" });
    reply
      .header("content-type", "application/gzip")
      .header("content-disposition", `attachment; filename="${bundleFilename(campaign.name)}"`);
    return reply.send(data);
  });
  // Raw file upload: gzip (the export) or plain JSON bytes. JSON bodies go through Fastify's parser.
  app.addContentTypeParser(["application/gzip", "application/x-gzip", "application/octet-stream"], { parseAs: "buffer", bodyLimit: BUNDLE_MAX_BYTES }, (_req, body, done) =>
    done(null, body),
  );
  app.post("/api/campaigns/import", { bodyLimit: BUNDLE_MAX_BYTES }, async (req) => {
    if (!req.body) throw new Error("Upload the .dmc.json.gz file as the request body.");
    return game.importCampaign(req.body as Buffer | object);
  });

  // outline editing
  app.put("/api/campaign/outline", async (req) => game.updateOutline(req.body));
}
