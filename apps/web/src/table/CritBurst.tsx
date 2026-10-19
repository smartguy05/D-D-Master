import type { Flourish } from "./flourish";

/** Full-screen natural 20 / natural 1 flourish over the map (CSS only; TablePage keys and times it). */
export function CritBurst({ kind, who }: { kind: Flourish; who: string }) {
  return (
    <div className={`crit-burst ${kind}`} aria-live="polite">
      <div className="cb-rays" />
      {kind === "fumble" && <div className="cb-crack" />}
      <div className="cb-text">
        <div className="cb-title">{kind === "crit" ? "CRITICAL!" : "FUMBLE"}</div>
        <div className="cb-who">{who} · natural {kind === "crit" ? 20 : 1}</div>
      </div>
    </div>
  );
}
