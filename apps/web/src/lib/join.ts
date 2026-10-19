import { useEffect, useState } from "react";
import { api } from "./api";

/**
 * Base URL phones should open (player links and QR codes). The server lists PUBLIC_URL (when set,
 * `preferred`) and its LAN addresses as `<base>/player`. A host or TV opened on localhost can't hand
 * out its own origin, so it uses the server's first address; otherwise its own origin works.
 */
export function joinBase(server: { urls: string[]; preferred?: boolean } | undefined, loc: { hostname: string; origin: string }): string {
  const local = /^(localhost|127\.|\[::1\])/.test(loc.hostname);
  const first = server?.urls[0]?.replace(/\/player$/, "");
  if (first && (server?.preferred || local)) return first;
  return loc.origin;
}

/** joinBase for this page, once the server's addresses arrive (own origin until then). */
export function useJoinBase(): string {
  const [server, setServer] = useState<{ urls: string[]; preferred?: boolean }>();
  useEffect(() => {
    let live = true;
    api<{ urls: string[]; preferred?: boolean }>("/player-urls")
      .then((r) => live && setServer(r))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return joinBase(server, location);
}
