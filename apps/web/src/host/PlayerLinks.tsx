import { useEffect, useState } from "react";
import { api } from "../lib/api";

/** "Players: open http://<lan-ip>:8787/player on your phone" hint for the Party tab. */
export function PlayerLinks() {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    api<{ urls: string[] }>("/player-urls")
      .then((r) => setUrls(r.urls))
      .catch(() => undefined);
  }, []);
  const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
  // In dev (Vite on :5173) the server's LAN URLs point at :8787, which also serves the built app only after `pnpm build`.
  const shown = local && urls.length ? urls : [`${location.origin}/player`];
  return (
    <p className="muted player-links">
      📱 Players: open{" "}
      {shown.map((u, i) => (
        <span key={u}>
          {i > 0 && " or "}
          <a href={u} target="_blank" rel="noreferrer">
            <b>{u}</b>
          </a>
        </span>
      ))}{" "}
      on your phone (same Wi-Fi) to see your character sheet and roll.
    </p>
  );
}
