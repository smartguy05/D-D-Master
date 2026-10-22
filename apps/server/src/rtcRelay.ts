import { MAX_REMOTE_PEERS, peerPrefs, rtcSignal, RTC_SIGNAL_MAX_CHARS, type PeerInfo, type PeerPrefs, type ServerEvent } from "@dm/shared";
import type { Access } from "./auth/access.js";
import type { ClientRole } from "./hub.js";

/**
 * Signals one member may send to one other member per window: an offer/answer and the ICE burst of a
 * link (~25 candidates with separate audio/video transports and TURN). Per link, so the room starting
 * all MAX_REMOTE_PEERS links at once doesn't run out before its relay candidates (gathered last).
 */
export const RTC_RATE_MAX = 120;
export const RTC_RATE_WINDOW_MS = 10_000;
/** rtc_join messages (prefs toggles) one socket may send per window: each fans a peers list out to every member. */
export const RTC_JOIN_MAX = 20;

/** What the hub knows about the joining socket. */
export interface RtcJoinContext {
  role?: ClientRole;
  access?: Access;
  /** This machine or the home network (Hub.inRoom): an in-room phone hears the room already. */
  inRoom: boolean;
}

export interface RtcRelayDeps<S> {
  send(ws: S, ev: ServerEvent): void;
  /** The seat is a human player of the loaded campaign. */
  seatOk(playerId: string): boolean;
  now?(): number;
}

interface Member {
  peerId: string;
  room: boolean;
  playerId?: string;
  prefs: PeerPrefs;
  /** Signals sent per target peer id in the current window. */
  sent: Map<string, number>;
  windowStart: number;
}

interface Window {
  start: number;
  n: number;
}

const samePrefs = (a: PeerPrefs, b: PeerPrefs) => a.camera === b.camera && a.showCharacter === b.showCharacter && a.micOn === b.micOn;

/**
 * The WebRTC call's members and its signaling relay (docs/web/online-call.md). Media is peer to peer;
 * the server only decides who is in the call and forwards offers, answers and ICE candidates between
 * members, never to or from anyone else:
 * - the room: one /table screen (table access), the one carrying the voice DM if it joined, else the
 *   first table to join; other tables wait;
 * - remote players: a /play page outside the home network, as its bound seat (a player cookie can't
 *   name another), at most MAX_REMOTE_PEERS, one page per seat (a newer page replaces the older);
 * - nobody else: home-network phones are in the room, /host pages don't take part.
 * A signal must come from a member, go to another member, pass rtcSignal and stay under the rate.
 */
export class RtcRelay<S> {
  private byWs = new Map<S, Member>();
  /** Tables that asked to join, in order (one of them is the room). */
  private tables: { ws: S; prefs: PeerPrefs }[] = [];
  private roomOwner?: S;
  /** rtc_join counts per socket (RTC_JOIN_MAX). */
  private joins = new Map<S, Window>();
  private seq = 0;
  private readonly now: () => number;

  constructor(private readonly deps: RtcRelayDeps<S>) {
    this.now = deps.now ?? Date.now;
  }

  /** Join the call (or update this member's prefs). */
  join(ws: S, ev: { prefs: unknown; playerId?: unknown }, ctx: RtcJoinContext) {
    if (!this.allowJoin(ws)) return;
    const prefs = peerPrefs(ev.prefs);
    const access = ctx.access;
    if (ctx.role === "table" && access && (access.level === "table" || access.level === "host")) {
      const t = this.tables.find((x) => x.ws === ws);
      if (t && samePrefs(t.prefs, prefs)) return;
      if (t) t.prefs = prefs;
      else this.tables.push({ ws, prefs });
      this.pickRoom();
      return;
    }
    const refuse = (why: string) => {
      this.drop(ws);
      this.deps.send(ws, { type: "peers", self: null, peers: [], refused: why });
    };
    if (ctx.role !== "player" || !access || access.level === "none") return refuse("Only the table screen and remote player pages join the call.");
    if (ctx.inRoom) return refuse("You're in the room: the table's mic and TV carry your voice.");
    const playerId = access.level === "player" ? access.playerId : typeof ev.playerId === "string" ? ev.playerId : undefined;
    if (!playerId || !this.deps.seatOk(playerId)) return refuse("Pick a seat first.");
    const mine = this.byWs.get(ws);
    if (mine && mine.playerId === playerId) {
      if (samePrefs(mine.prefs, prefs)) return;
      mine.prefs = prefs;
      return this.announce();
    }
    // The same seat from another page (a reload, a second device): the newer one takes over.
    for (const [other, m] of this.byWs) {
      if (other !== ws && m.playerId === playerId) {
        this.byWs.delete(other);
        this.deps.send(other, { type: "peers", self: null, peers: [], refused: "You joined the call from another page." });
      }
    }
    const remotes = [...this.byWs].filter(([other, m]) => other !== ws && !m.room).length;
    if (remotes >= MAX_REMOTE_PEERS) return refuse(`The call is full (${MAX_REMOTE_PEERS} remote players).`);
    this.byWs.delete(ws);
    this.byWs.set(ws, this.member(false, prefs, playerId));
    this.announce();
  }

  /** Leave the call (rtc_leave, or the socket closed). */
  leave(ws: S) {
    const wasTable = this.tables.some((t) => t.ws === ws);
    this.tables = this.tables.filter((t) => t.ws !== ws);
    if (this.roomOwner === ws) this.roomOwner = undefined;
    this.joins.delete(ws);
    const was = this.byWs.delete(ws);
    if (wasTable) this.pickRoom();
    else if (was) this.announce();
    if (was) this.deps.send(ws, { type: "peers", self: null, peers: [] });
  }

  /** The /table carrying the voice DM (GameService voice owner) is the room once it joins. */
  setRoomOwner(ws: S | undefined) {
    if (this.roomOwner === ws) return;
    this.roomOwner = ws;
    this.pickRoom();
  }

  /** Relay one signaling message to another member, from the sender's own peer id. */
  signal(ws: S, ev: { to: unknown; signal: unknown }) {
    const from = this.byWs.get(ws);
    if (!from || typeof ev.to !== "string" || ev.to === from.peerId) return;
    const target = [...this.byWs].find(([, m]) => m.peerId === ev.to)?.[0];
    if (target === undefined) return;
    const now = this.now();
    if (now - from.windowStart >= RTC_RATE_WINDOW_MS) {
      from.windowStart = now;
      from.sent.clear();
    }
    const sent = from.sent.get(ev.to) ?? 0;
    if (sent >= RTC_RATE_MAX) return;
    const signal = rtcSignal(ev.signal);
    if (!signal || JSON.stringify(signal).length > RTC_SIGNAL_MAX_CHARS + 200) return;
    from.sent.set(ev.to, sent + 1);
    this.deps.send(target, { type: "rtc", from: from.peerId, signal });
  }

  /** Every member, the room first, then remote players in join order. */
  members(): PeerInfo[] {
    const out = [...this.byWs.values()].map((m): PeerInfo => ({ peerId: m.peerId, room: m.room, ...(m.playerId && { playerId: m.playerId }), ...m.prefs }));
    return out.sort((a, b) => Number(b.room) - Number(a.room));
  }

  private member(room: boolean, prefs: PeerPrefs, playerId?: string): Member {
    const peerId = `${room ? "r" : "p"}${++this.seq}`;
    return { peerId, room, ...(playerId && { playerId }), prefs, sent: new Map(), windowStart: this.now() };
  }

  /**
   * Drop remote members whose seat no longer passes `seatOk` (seat removed, campaign switched) and
   * tell everyone; nothing is sent when every seat still holds. GameService calls it on each commit.
   */
  recheckSeats() {
    const gone = [...this.byWs].filter(([, m]) => !m.room && m.playerId && !this.deps.seatOk(m.playerId));
    if (!gone.length) return;
    for (const [ws] of gone) {
      this.byWs.delete(ws);
      this.deps.send(ws, { type: "peers", self: null, peers: [], refused: "Your seat is no longer in this game." });
    }
    this.announce();
  }

  /** Count one rtc_join against the socket's window; false once it is over RTC_JOIN_MAX. */
  private allowJoin(ws: S): boolean {
    const now = this.now();
    let w = this.joins.get(ws);
    if (!w || now - w.start >= RTC_RATE_WINDOW_MS) this.joins.set(ws, (w = { start: now, n: 0 }));
    return ++w.n <= RTC_JOIN_MAX;
  }

  private drop(ws: S) {
    if (this.byWs.delete(ws)) this.announce();
  }

  /**
   * Make the right table the room: the voice owner if it joined, else the first table; the others
   * wait. A new room screen gets a new peer id, so remote pages build a fresh connection to it.
   */
  private pickRoom() {
    const want = this.tables.find((t) => t.ws === this.roomOwner) ?? this.tables[0];
    const current = [...this.byWs].find(([, m]) => m.room);
    if (current && want && current[0] === want.ws) current[1].prefs = want.prefs;
    else {
      if (current) this.byWs.delete(current[0]);
      if (want) this.byWs.set(want.ws, this.member(true, want.prefs));
    }
    this.announce();
    for (const t of this.tables) if (t.ws !== want?.ws) this.deps.send(t.ws, { type: "peers", self: null, peers: [], refused: "Another table screen carries the call." });
  }

  /** Every member gets the list with its own peer id. */
  private announce() {
    const peers = this.members();
    for (const [ws, m] of this.byWs) this.deps.send(ws, { type: "peers", self: m.peerId, peers });
  }
}
