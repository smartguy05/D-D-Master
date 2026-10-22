/** GET /api/auth/sessions (routes/auth.ts): the host's Online card. */
export interface OnlineSessions {
  code: string;
  /** TABLE_CODE is set in .env: no Rotate button. */
  fixedCode: boolean;
  /** ONLINE_URL: the tunnel's address. */
  onlineUrl: string;
  invitePath: string;
  hostLogin: boolean;
  trustLan: boolean;
  seats: { playerId: string; name: string; character?: string; claimed: boolean; claimedAt?: number; connected: number }[];
}

/** The invite link: ONLINE_URL (the tunnel's address) when set, else this page's join base (lib/join.ts). */
export function inviteUrl(s: Pick<OnlineSessions, "onlineUrl" | "invitePath">, base: string): string {
  return `${(s.onlineUrl || base).replace(/\/+$/, "")}${s.invitePath}`;
}

/** One seat's line on the card. Kick frees a claimed seat and closes its sockets. */
export function seatStatus(s: { claimed: boolean; connected: number }): { label: string; kickable: boolean; tone: "ok" | "muted" } {
  if (s.connected > 0) return { label: s.connected > 1 ? `online (${s.connected} devices)` : "online", kickable: true, tone: "ok" };
  if (s.claimed) return { label: "joined, offline", kickable: true, tone: "muted" };
  return { label: "free", kickable: false, tone: "muted" };
}
