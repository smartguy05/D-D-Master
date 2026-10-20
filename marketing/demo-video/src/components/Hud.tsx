import React from "react";
import { AbsoluteFill, Img, interpolate, random, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT } from "../theme";
import { useTiming } from "../timing";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const PARTY = [
  { name: "Brienne Saltblade", cls: "Fighter", color: "#e0b83c", sprite: "stills/sprite-8.png" },
  { name: "Quill Emberwick", cls: "Wizard", color: "#58a6e0", sprite: "stills/sprite-2.png" },
  { name: "Sister Morra", cls: "Cleric", color: "#e06a5a", sprite: "stills/sprite-11.png" },
];

/** Live mic waveform + who's-talking name tag that hands off between two speakers. */
export const VoiceHud: React.FC<{ lines: { who: number; text: string }[] }> = ({ lines }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { framesPerBeat } = useTiming();
  const per = framesPerBeat * 4;
  const idx = Math.min(lines.length - 1, Math.floor(f / per));
  const local = f - idx * per;
  const line = lines[idx];
  const who = PARTY[line.who];
  const tagIn = spring({ frame: local - 6, fps, config: { damping: 12, stiffness: 200 } });
  const panelIn = spring({ frame: f, fps, config: { damping: 14, stiffness: 160 } });
  const typed = Math.floor(interpolate(local, [4, per * 0.7], [0, line.text.length], clamp));
  const talking = local < per * 0.8;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: 90,
          top: 90,
          width: 760,
          padding: "26px 30px",
          borderRadius: 18,
          background: "rgba(18,13,10,0.86)",
          border: `2px solid ${C.accent}`,
          boxShadow: `0 0 40px rgba(127,224,255,0.25), 0 20px 50px rgba(0,0,0,0.7)`,
          transform: `translateX(${(1 - panelIn) * -80}px)`,
          opacity: panelIn,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <svg width={44} height={60} viewBox="0 0 24 32">
            <rect x="6" y="1" width="12" height="20" rx="6" fill={C.accent} />
            <path d="M2 14 a10 10 0 0 0 20 0 M12 24 v6 M6 31 h12" stroke={C.accent} strokeWidth="2.4" fill="none" />
          </svg>
          <div style={{ display: "flex", alignItems: "center", gap: 6, height: 70 }}>
            {Array.from({ length: 34 }).map((_, i) => {
              const n = random(`w-${i}-${Math.floor(f / 2)}`);
              const env = Math.sin((i / 33) * Math.PI);
              const h = talking ? 8 + env * (14 + n * 52) * (0.6 + 0.4 * Math.sin(f / 4 + i)) : 6;
              return <div key={i} style={{ width: 8, height: h, borderRadius: 4, background: C.accent, opacity: 0.55 + 0.45 * env }} />;
            })}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 18, transform: `scale(${0.85 + 0.15 * tagIn})`, transformOrigin: "left center", opacity: tagIn }}>
          <div style={{ width: 66, height: 66, borderRadius: "50%", border: `3px solid ${who.color}`, overflow: "hidden", background: C.panel2 }}>
            <Img src={staticFile(who.sprite)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
          <div>
            <div style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 38, color: who.color }}>{who.name}</div>
            <div style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: 22, color: C.accent, letterSpacing: "0.08em" }}>
              ● SPEAKING · VOICE RECOGNIZED
            </div>
          </div>
        </div>
        <div style={{ fontFamily: FONT.body, fontSize: 28, color: C.text, marginTop: 16, minHeight: 40, fontStyle: "italic" }}>
          “{line.text.slice(0, typed)}
          {typed < line.text.length ? <span style={{ color: C.accent }}>▌</span> : "”"}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** Initiative / turn-order banner: portrait cards snap in from the top, active one glows. */
export const InitiativeBanner: React.FC<{ active?: number; at?: number }> = ({ active = 0, at = 0 }) => {
  const f = useCurrentFrame() - at;
  const { fps, width } = useVideoConfig();
  if (f < 0) return null;
  const order = [
    { ...PARTY[0], init: 18 },
    { name: "Kobold Skirmisher", cls: "Foe", color: C.bad, sprite: "stills/sprite-5.png", init: 15 },
    { ...PARTY[1], init: 12 },
    { ...PARTY[2], init: 9 },
  ];
  const label = spring({ frame: f, fps, config: { damping: 12, stiffness: 200 } });
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", top: 40, left: 0, width, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div
          style={{
            fontFamily: FONT.display,
            fontWeight: 800,
            fontSize: 34,
            letterSpacing: "0.2em",
            color: C.gold,
            textShadow: "0 3px 12px rgba(0,0,0,0.9)",
            opacity: label,
            transform: `translateY(${(1 - label) * -30}px)`,
          }}
        >
          ROUND 1 · INITIATIVE
        </div>
        <div style={{ display: "flex", gap: 18, marginTop: 14 }}>
          {order.map((o, i) => {
            const s = spring({ frame: f - 3 - i * 3, fps, config: { damping: 10, stiffness: 260, mass: 0.6 } });
            const isActive = i === active;
            return (
              <div
                key={o.name}
                style={{
                  width: 210,
                  padding: "12px 14px",
                  borderRadius: 14,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  background: "rgba(18,13,10,0.9)",
                  border: `2px solid ${isActive ? C.gold : C.line}`,
                  boxShadow: isActive ? `0 0 28px rgba(224,184,60,0.6)` : "0 10px 30px rgba(0,0,0,0.6)",
                  transform: `translateY(${(1 - s) * -160}px) scale(${isActive ? 1.08 : 1})`,
                  opacity: s,
                }}
              >
                <div style={{ width: 52, height: 52, borderRadius: "50%", overflow: "hidden", border: `2px solid ${o.color}`, flexShrink: 0 }}>
                  <Img src={staticFile(o.sprite)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 19, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {o.name.split(" ")[0]}
                  </div>
                  <div style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: 16, color: isActive ? C.gold : C.muted }}>Init {o.init}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** Floating damage number that pops and drifts up. Coordinates in px. */
export const DamageNumber: React.FC<{ x: number; y: number; at: number; text: string; crit?: boolean }> = ({ x, y, at, text, crit }) => {
  const f = useCurrentFrame() - at;
  const { fps } = useVideoConfig();
  if (f < 0 || f > 70) return null;
  const s = spring({ frame: f, fps, config: { damping: 8, stiffness: 300, mass: 0.5 } });
  const color = crit ? C.goldHi : C.bad;
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y - f * 1.8,
        transform: `translate(-50%, -50%) scale(${s * (crit ? 1.25 : 1)}) rotate(${crit ? -6 : 0}deg)`,
        opacity: interpolate(f, [45, 70], [1, 0], clamp),
        fontFamily: FONT.display,
        fontWeight: 800,
        fontSize: 120,
        color,
        textShadow: `0 4px 0 #3a0d0a, 0 0 30px ${color}, 0 8px 30px rgba(0,0,0,0.9)`,
        whiteSpace: "nowrap",
      }}
    >
      {text}
      {crit ? <div style={{ fontSize: 34, letterSpacing: "0.2em", textAlign: "center", color: C.gold }}>CRITICAL</div> : null}
    </div>
  );
};

/** HP bar that drains from `from` to `to` at `at`, with a lagging ghost bar. */
export const HpBar: React.FC<{ name: string; max: number; from: number; to: number; at: number; x: number; y: number; w?: number }> = ({
  name,
  max,
  from,
  to,
  at,
  x,
  y,
  w = 520,
}) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const inn = spring({ frame: f, fps, config: { damping: 14, stiffness: 180 } });
  const now = interpolate(f, [at, at + 8], [from, to], clamp);
  const ghost = interpolate(f, [at + 14, at + 40], [from, to], clamp);
  const hit = interpolate(f, [at, at + 4, at + 16], [0, 1, 0], clamp);
  const pct = (v: number) => `${(v / max) * 100}%`;
  const low = now / max < 0.5;
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        transform: `translateX(${(1 - inn) * 60}px) translate(${Math.sin(f * 3) * hit * 8}px, 0)`,
        opacity: inn,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: FONT.display, fontWeight: 800, fontSize: 30, color: C.text, textShadow: "0 3px 10px rgba(0,0,0,0.9)" }}>
        <span>{name}</span>
        <span style={{ color: low ? C.bad : C.text }}>
          {Math.round(now)}/{max} HP
        </span>
      </div>
      <div style={{ position: "relative", height: 26, marginTop: 8, borderRadius: 13, background: "rgba(10,6,4,0.85)", border: `2px solid ${C.line}`, overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, width: pct(ghost), background: "#f4d9a0" }} />
        <div style={{ position: "absolute", inset: 0, width: pct(now), background: low ? `linear-gradient(90deg, #8a1d17, ${C.bad})` : `linear-gradient(90deg, #2e8a46, ${C.ok})` }} />
        <div style={{ position: "absolute", inset: 0, background: `rgba(255,255,255,${hit * 0.5})` }} />
      </div>
    </div>
  );
};
