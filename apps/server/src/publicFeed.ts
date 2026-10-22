import { effectForTable, momentForTable, publicCampaign, publicLogEntry, publicRoll, publicState, type Campaign, type GameState, type ServerEvent } from "@dm/shared";
import type { Access } from "./auth/access.js";
import type { ClientRole } from "./hub.js";

/**
 * Server-side filtering of hidden information (docs/server/state-projection.md). Every /ws socket
 * has a viewer tier: `full` (the host and the TV, which filters at render time with the same rules)
 * or `public` (a player's phone or remote page), which only ever receives the projections from
 * @dm/shared projection.ts. The Hub builds each public event once per broadcast with PublicFeed.
 */
export type ViewerTier = "full" | "public";

/**
 * A socket's tier: a player cookie is always public; a host or table (trusted LAN) socket is full
 * once its hello says host or table, public when it says player (a LAN phone), and undefined before
 * its hello (the hub sends it public events only and its snapshot after the hello).
 */
export function viewerTier(access: Access, role: ClientRole | undefined): ViewerTier | undefined {
  if (access.level !== "host" && access.level !== "table") return "public";
  if (!role) return undefined;
  return role === "player" ? "public" : "full";
}

/** Events players never get: background job chips and server errors are for the host. */
const HOST_ONLY = new Set<ServerEvent["type"]>(["job", "error"]);

/**
 * What the public campaign shows that depends on the state: the visited locations, and in each the
 * walls and features the party has seen (fog). A change means player pages need the campaign again.
 */
function shownKey(campaign: Campaign | null): string {
  return JSON.stringify(campaign?.outline?.locations.map((l) => [l.id, l.walls, l.features]) ?? null);
}

/**
 * The public version of the broadcast stream. It remembers the latest full state and campaign (so a
 * roll, effect or moment is judged against the state it follows, as on the TV) and re-sends the
 * public campaign before a state that changes what it shows: a new location (its map and walls are
 * in the campaign), or a door or feature of a visited one coming into (or out of) the party's sight.
 */
export class PublicFeed {
  private state: GameState | undefined;
  private campaign: Campaign | null = null;
  /** The state the players' campaign was last projected against, and its shownKey once worked out. */
  private shownState: GameState | undefined;
  private shown: string | undefined;

  /** Remember a broadcast event's state or campaign without projecting it (no player socket is open). */
  observe(ev: ServerEvent) {
    if (ev.type === "state") {
      this.state = ev.state;
      this.shownAt(ev.state);
    } else if (ev.type === "campaign") this.setCampaign(ev.campaign);
  }

  /** A different (or no) campaign: the remembered state belongs to the old one, so forget it. */
  private setCampaign(campaign: Campaign | null) {
    this.campaign = campaign;
    if (!campaign || this.state?.campaignId !== campaign.id) this.state = undefined;
    this.shownAt(this.state);
  }

  /** Players have the campaign as projected against this state (its key is worked out when next needed). */
  private shownAt(state: GameState | undefined, key?: string) {
    this.shownState = state;
    this.shown = key;
  }

  /** The public events for one broadcast event: none, the event itself, its projection, or campaign + state. */
  next(ev: ServerEvent): ServerEvent[] {
    if (HOST_ONLY.has(ev.type)) return [];
    switch (ev.type) {
      case "state": {
        this.state = ev.state;
        const out: ServerEvent[] = [];
        if (this.campaign) {
          const before = this.shown ?? shownKey(publicCampaign(this.campaign, this.shownState));
          const campaign = publicCampaign(this.campaign, ev.state);
          const key = shownKey(campaign);
          if (key !== before) out.push({ type: "campaign", campaign });
          this.shownAt(ev.state, key);
        } else this.shownAt(ev.state);
        out.push({ type: "state", state: publicState(ev.state) });
        return out;
      }
      case "campaign":
        this.setCampaign(ev.campaign);
        return [{ type: "campaign", campaign: publicCampaign(ev.campaign, this.state) }];
      case "roll":
        return [{ type: "roll", roll: publicRoll(ev.roll, this.state) }];
      case "effect": {
        const effect = this.state ? effectForTable(this.state, ev.effect) : ev.effect;
        return effect ? [{ type: "effect", effect }] : [];
      }
      case "moment": {
        const moment = this.state ? momentForTable(this.state, ev.moment) : ev.moment;
        return moment ? [{ type: "moment", moment }] : [];
      }
      case "log": {
        // Nothing broadcasts `log` today (log lines travel in state); filtered like publicState's log if it ever does.
        const entry = publicLogEntry(ev.entry, this.state);
        return entry ? [entry === ev.entry ? ev : { type: "log", entry }] : [];
      }
      default:
        return [ev];
    }
  }
}

/** The public version of a connect snapshot (same order), projected with the snapshot's own state. */
export function publicSnapshot(evs: ServerEvent[]): ServerEvent[] {
  const feed = new PublicFeed();
  const st = evs.find((e): e is Extract<ServerEvent, { type: "state" }> => e.type === "state");
  // Seed the feed with the state first, so the campaign that comes before it sees its locations.
  if (st) feed.next(st);
  return evs.flatMap((ev) => (ev.type === "campaign" ? [{ type: "campaign", campaign: publicCampaign(ev.campaign, st?.state) } as ServerEvent] : feed.next(ev)));
}

/**
 * The reply to a phone's roll (POST /api/players/:id/roll and /physical-roll) for a caller below
 * the host: the tool result names the target's AC, the next turn (maybe a hidden creature's) and DM
 * hints, so only the total (and whether the DM was told) goes back. The TV and the state carry the rest.
 */
export function seatRollReply(result: Record<string, unknown>): { ok: boolean; total?: number; dmInformed?: boolean; error?: string } {
  if (typeof result.error === "string") return { ok: false, error: result.error };
  const total = typeof result.total === "number" ? result.total : typeof result.damage_applied === "number" ? result.damage_applied : undefined;
  const out: { ok: boolean; total?: number; dmInformed?: boolean } = { ok: true };
  if (total !== undefined) out.total = total;
  if (typeof result.dmInformed === "boolean") out.dmInformed = result.dmInformed;
  return out;
}
