import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { safeNext, type Me } from "../lib/auth";
import "../player/player.css";
import "./signin.css";

/** /login: the host password (HOST_PASSWORD) for /host and /table on another machine. */
export function LoginPage() {
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"), "/host");
  const navigate = useNavigate();
  const [me, setMe] = useState<Me | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Me>("/auth/me")
      .then((m) => (m.level === "host" ? navigate(next, { replace: true }) : setMe(m)))
      .catch((e: Error) => setError(e.message));
  }, [navigate, next]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/auth/host", { password });
      // A full load: every socket and fetch on the next page carries the new cookie.
      location.assign(next);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="signin">
      <h1>Host sign-in</h1>
      {me && !me.hostLogin && (
        <p className="muted">
          Host sign-in is off on this server. Set <code>HOST_PASSWORD</code> in <code>.env</code> and restart it, or open the host screen on the
          server's own machine.
        </p>
      )}
      {me?.hostLogin && (
        <form onSubmit={submit}>
          <input type="password" autoFocus autoComplete="current-password" placeholder="Host password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button className="primary big" disabled={busy || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
      <p className="muted">
        Joining as a player? <a href="/join">Enter the table code</a>.
      </p>
    </div>
  );
}
