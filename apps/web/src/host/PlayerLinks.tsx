import type { Character, Player } from "@dm/shared";
import { Qr } from "../lib/Qr";
import { useJoinBase } from "../lib/join";

/**
 * "Players: open <base>/player on your phone" for the Party tab, plus one QR code per player that
 * opens their own sheet (/player/:id) directly. The base is PUBLIC_URL, else the LAN address when
 * the host page is on localhost (lib/join.ts). In dev (Vite on :5173) the LAN URL points at :8787,
 * which serves the app only after `pnpm build`.
 */
export function PlayerLinks({ players, characters }: { players: Player[]; characters: Character[] }) {
  const base = useJoinBase();
  return (
    <>
      <p className="muted player-links">
        📱 Players: open{" "}
        <a href={`${base}/player`} target="_blank" rel="noreferrer">
          <b>{base}/player</b>
        </a>{" "}
        on your phone (same Wi-Fi) to see your character sheet and roll, or scan your code below.
      </p>
      {players.length > 0 && (
        <details className="player-qrs">
          <summary>Show join QR codes</summary>
          <div className="qr-grid">
            {players.map((p) => {
              const ch = characters.find((c) => c.id === p.characterId);
              return (
                <figure key={p.id} className="qr-card">
                  <Qr url={`${base}/player/${p.id}`} size={140} />
                  <figcaption>
                    <b>{p.name}</b>
                    {ch && <span className="muted"> · {ch.name}</span>}
                  </figcaption>
                </figure>
              );
            })}
          </div>
        </details>
      )}
    </>
  );
}
