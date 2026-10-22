import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import type { Me } from "../lib/auth";
import "../player/player.css";
import "./signin.css";

interface Seat {
  id: string;
  name: string;
  character?: string;
  /** Held by another device. */
  claimed: boolean;
  /** Held by this browser. */
  mine: boolean;
}

/**
 * /join?code=WOLF-RUNE-7342: a remote player enters the table code, then picks their seat; the server
 * binds this browser's cookie to it and the player goes to their sheet. On the home network
 * (TRUST_LAN) no code is needed: the seat list shows straight away.
 */
export function JoinPage() {
  const [params] = useSearchParams();
  const [code, setCode] = useState(params.get("code") ?? "");
  const [seats, setSeats] = useState<Seat[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const join = useCallback(async (value: string) => {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ seats: Seat[] }>("/auth/join", { code: value });
      setSeats(r.seats);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    let live = true;
    api<Me>("/auth/me")
      .then(async (me) => {
        if (!live) return;
        // Already in (home network, host, or this browser joined before): just pick the seat.
        if (me.level !== "none") {
          const r = await api<{ seats: Seat[] }>("/auth/claim");
          if (live) setSeats(r.seats);
        } else if (params.get("code")) await join(params.get("code")!);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [join, params]);

  const pick = async (seat: Seat) => {
    setBusy(true);
    setError("");
    try {
      await api("/auth/claim", { playerId: seat.id });
      // A full load so the sheet's socket opens with the seat-bound cookie.
      location.assign(`/player/${seat.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="signin">
      <h1>Join the table</h1>
      {!seats && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void join(code);
          }}
        >
          <p className="muted">Enter the table code the host gave you.</p>
          <input className="code" autoFocus autoCapitalize="characters" autoComplete="off" placeholder="WOLF-RUNE-7342" value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="primary big" disabled={busy || !code.trim()}>
            {busy ? "Checking…" : "Join"}
          </button>
        </form>
      )}
      {seats && (
        <>
          <p className="muted">Who are you?</p>
          <div className="pl-pick">
            {seats.map((s) => (
              <button key={s.id} className={`pl-pick-btn ${s.mine ? "last" : ""}`} disabled={busy || s.claimed} onClick={() => void pick(s)}>
                <span>
                  <b>{s.name}</b>
                  <span className="muted">
                    {s.character ?? "no character yet"}
                    {s.claimed && " · playing on another device"}
                    {s.mine && " · you"}
                  </span>
                </span>
              </button>
            ))}
            {seats.length === 0 && <p className="muted">The host hasn't added any players yet. Ask them to add you, then reload this page.</p>}
          </div>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
