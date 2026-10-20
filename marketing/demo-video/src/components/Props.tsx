import React from "react";
import { random, useCurrentFrame } from "remotion";
import { C, FONT } from "../theme";

/** Front view of a d20: hexagon silhouette, centre face with a number. */
export const D20: React.FC<{ size: number; face?: string; color?: string; edge?: string; glow?: number; style?: React.CSSProperties }> = ({
  size,
  face = "20",
  color = "#7a1f1a",
  edge = C.goldHi,
  glow = 0,
  style,
}) => {
  const id = `d20-${color.replace("#", "")}`;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ overflow: "visible", ...style }}>
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={color} stopOpacity={1} />
          <stop offset="1" stopColor="#000" stopOpacity={0.55} />
        </linearGradient>
      </defs>
      {glow > 0 ? <polygon points="50,0 93,25 93,75 50,100 7,75 7,25" fill={edge} opacity={0.35 * glow} style={{ filter: `blur(${6 * glow}px)` }} /> : null}
      <polygon points="50,0 93,25 93,75 50,100 7,75 7,25" fill={color} />
      <polygon points="50,0 93,25 93,75 50,100 7,75 7,25" fill={`url(#${id}-g)`} />
      <polygon points="50,20 80,70 20,70" fill="rgba(255,255,255,0.12)" />
      <polygon points="50,0 93,25 50,20" fill="rgba(255,255,255,0.18)" />
      <polygon points="7,75 20,70 50,100" fill="rgba(0,0,0,0.25)" />
      <g stroke={edge} strokeWidth={1.6} strokeLinejoin="round" fill="none" opacity={0.85}>
        <polygon points="50,0 93,25 93,75 50,100 7,75 7,25" />
        <polygon points="50,20 80,70 20,70" />
        <path d="M50 20 L50 0 M50 20 L7 25 M50 20 L93 25 M80 70 L93 25 M80 70 L93 75 M80 70 L50 100 M20 70 L7 25 M20 70 L7 75 M20 70 L50 100" />
      </g>
      <text x="50" y="58" textAnchor="middle" fontFamily={FONT.display} fontWeight={800} fontSize={face.length > 1 ? 19 : 22} fill={edge}>
        {face}
      </text>
    </svg>
  );
};

/** A painted miniature on a round base. */
export const Mini: React.FC<{ size: number; color: string; style?: React.CSSProperties }> = ({ size, color, style }) => (
  <svg width={size} height={size * 1.4} viewBox="0 0 100 140" style={style}>
    <ellipse cx="50" cy="128" rx="44" ry="11" fill="#1a1410" />
    <ellipse cx="50" cy="122" rx="44" ry="11" fill="#3a2c22" />
    <path d="M30 120 C 30 90, 36 70, 42 62 L 58 62 C 64 70, 70 90, 70 120 Z" fill={color} />
    <path d="M38 64 C 30 50, 70 50, 62 64 Z" fill={color} opacity={0.85} />
    <circle cx="50" cy="40" r="15" fill="#d9b38c" />
    <path d="M34 36 C 36 18, 64 18, 66 36 C 58 30, 42 30, 34 36 Z" fill="#2a1f18" />
    <rect x="70" y="40" width="5" height="78" rx="2" fill="#8a8a8a" transform="rotate(8 72 80)" />
  </svg>
);

/** A character sheet lying on the table (parchment with ruled boxes). */
export const Sheet: React.FC<{ width: number; style?: React.CSSProperties }> = ({ width, style }) => (
  <div
    style={{
      width,
      height: width * 1.3,
      background: `radial-gradient(circle at 40% 30%, #f3e4c2, ${C.parchment} 60%, #c9a874)`,
      borderRadius: 6,
      boxShadow: "0 20px 40px rgba(0,0,0,0.6)",
      padding: width * 0.07,
      boxSizing: "border-box",
      ...style,
    }}
  >
    <div style={{ fontFamily: FONT.display, fontWeight: 800, color: C.ink, fontSize: width * 0.085 }}>Brienne Saltblade</div>
    <div style={{ height: 3, background: C.ink, opacity: 0.5, margin: `${width * 0.02}px 0` }} />
    <div style={{ display: "flex", gap: width * 0.03, margin: `${width * 0.04}px 0` }}>
      {["STR", "DEX", "CON", "INT", "WIS", "CHA"].map((s) => (
        <div key={s} style={{ flex: 1, border: `2px solid ${C.ink}`, borderRadius: 6, height: width * 0.14, opacity: 0.6 }} />
      ))}
    </div>
    {Array.from({ length: 9 }).map((_, i) => (
      <div key={i} style={{ height: 2, background: C.ink, opacity: 0.25, margin: `${width * 0.05}px 0` }} />
    ))}
  </div>
);

/** A candle with a flickering flame and glow. */
export const Candle: React.FC<{ height: number; seed?: number; style?: React.CSSProperties }> = ({ height, seed = 1, style }) => {
  const f = useCurrentFrame();
  const flick = 0.85 + 0.15 * Math.sin(f * 0.9 + seed) * Math.sin(f * 0.37 + seed * 3) + 0.08 * (random(`c${seed}-${Math.floor(f / 3)}`) - 0.5);
  const w = height * 0.28;
  return (
    <div style={{ position: "relative", width: w, height, ...style }}>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: -height * 0.55,
          width: height * 1.6,
          height: height * 1.6,
          transform: "translate(-50%, -25%)",
          background: "radial-gradient(circle, rgba(255,190,90,0.55) 0%, rgba(255,140,40,0.18) 35%, rgba(0,0,0,0) 70%)",
          opacity: flick,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: -height * 0.3,
          width: w * 0.5,
          height: height * 0.32 * flick,
          transform: `translateX(-50%) skewX(${Math.sin(f * 0.4 + seed) * 5}deg)`,
          transformOrigin: "50% 100%",
          borderRadius: "50% 50% 50% 50% / 70% 70% 30% 30%",
          background: "radial-gradient(ellipse at 50% 70%, #fff6d0 0%, #ffd75e 35%, #ff8a2a 70%, rgba(255,80,0,0) 100%)",
          filter: "blur(1px)",
        }}
      />
      <div style={{ position: "absolute", left: "48%", top: -height * 0.03, width: 2, height: height * 0.05, background: "#222" }} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: `${w * 0.2}px ${w * 0.2}px 4px 4px`,
          background: "linear-gradient(90deg, #b9a07a, #f1e3c4 45%, #a38660)",
        }}
      />
    </div>
  );
};
