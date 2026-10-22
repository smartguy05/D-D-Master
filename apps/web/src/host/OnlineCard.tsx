import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { useJoinBase } from "../lib/join";
import { inviteUrl, seatStatus, type OnlineSessions } from "./online";

type Run = (fn: () => Promise<unknown>) => Promise<void>;

/** How often the card refreshes who is connected. */
const REFRESH_MS = 5000;

/**
 * Party tab "Online" card (docs/setup/online-play.md): the table code remote players type at /join,
 * Rotate (logs every remote player out), the invite link, each seat's sign-in with Kick, and (with
 * HOST_PASSWORD) signing every other host device out.
 */
export function OnlineCard({ run }: { run: Run }) {
  const base = useJoinBase();
  const [s, setS] = useState<OnlineSessions | null>(null);
  const [copied, setCopied] = useState(false);
  const load = useCallback(() => api<OnlineSessions>("/auth/sessions").then(setS), []);

  useEffect(() => {
    load().catch(() => undefined);
    const t = setInterval(() => load().catch(() => undefined), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  if (!s) return null;
  const link = inviteUrl(s, base);
  const copy = () =>
    run(async () => {
      try {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Clipboard needs https or localhost: show it to copy by hand.
        prompt("Copy the invite link:", link);
      }
    });

  return (
    <section className="card online-card">
      <h2>Online</h2>
      <div className="row">
        <span className="muted">Table code</span>
        <b className="table-code">{s.code}</b>
        {!s.fixedCode && (
          <button
            className="small"
            title="New code: every remote player is signed out and has to join again"
            onClick={() => confirm("Make a new table code? Every remote player is signed out.") && run(async () => (await api("/auth/code/rotate", {}), await load()))}
          >
            ↻ Rotate
          </button>
        )}
        {s.fixedCode && <span className="muted">(TABLE_CODE in .env)</span>}
      </div>
      <div className="row">
        <button onClick={copy}>{copied ? "✓ Copied" : "⧉ Copy invite link"}</button>
        <code className="grow invite-link">{link}</code>
      </div>
      {!s.onlineUrl && (
        <p className="muted">
          Set <code>ONLINE_URL</code> to your Cloudflare Tunnel address so this link works outside your home.
        </p>
      )}
      <p className="muted">
        Host sign-in from other machines: {s.hostLogin ? "on (/login)" : "off (set HOST_PASSWORD)"}. Home network: {s.trustLan ? "no code needed" : "code needed"}.
      </p>
      {s.hostLogin && (
        <div className="row">
          <button
            className="small"
            title="Every other browser signed in with the host password has to sign in again (this one stays signed in)"
            onClick={() => confirm("Sign out every other device signed in as the host?") && run(async () => void (await api("/auth/hosts/revoke", {})))}
          >
            Sign out other host devices
          </button>
        </div>
      )}
      <ul className="list">
        {s.seats.map((seat) => {
          const st = seatStatus(seat);
          return (
            <li key={seat.playerId} className="row">
              <b>{seat.name}</b>
              {seat.character && <span className="muted">{seat.character}</span>}
              <span className={`grow ${st.tone}`}>{st.label}</span>
              {st.kickable && (
                <button
                  className="small danger"
                  title="Sign this device out and free the seat (rotate the code too if they shouldn't come back)"
                  onClick={() => run(async () => (await api("/auth/kick", { playerId: seat.playerId }), await load()))}
                >
                  Kick
                </button>
              )}
            </li>
          );
        })}
        {s.seats.length === 0 && <li className="muted">No human players yet.</li>}
      </ul>
    </section>
  );
}
