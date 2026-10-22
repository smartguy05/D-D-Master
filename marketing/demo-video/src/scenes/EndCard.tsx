import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Embers } from "../components/Effects";
import { InkCaption } from "../components/InkCaption";
import { D20 } from "../components/Props";
import { Room } from "../components/Room";
import { Shot } from "../components/Shot";
import { C, FONT } from "../theme";
import { FPS, useTiming } from "../timing";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const WORD = "HEARTHMASTER";

/** Aged parchment with burnt, darkened edges. */
const Parchment: React.FC = () => (
  <AbsoluteFill>
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 45%, #3b2a1c 0%, #2a1d13 45%, #170f0a 80%, #0b0705 100%)` }} />
    <AbsoluteFill
      style={{
        opacity: 0.5,
        background:
          "radial-gradient(circle at 20% 30%, rgba(233,215,176,0.08), rgba(0,0,0,0) 30%), radial-gradient(circle at 75% 65%, rgba(233,215,176,0.07), rgba(0,0,0,0) 35%)",
      }}
    />
    {/* ink map linework, faint */}
    <svg width="100%" height="100%" viewBox="0 0 1920 1080" style={{ position: "absolute", opacity: 0.12 }}>
      <g stroke={C.parchment} strokeWidth={2} fill="none">
        <path d="M80 900 C 300 760, 420 980, 640 840 S 980 700, 1100 860 S 1500 1000, 1840 820" />
        <path d="M120 180 C 340 260, 520 120, 760 200 S 1200 300, 1400 160 S 1700 120, 1860 240" strokeDasharray="8 14" />
        <circle cx="1640" cy="300" r="70" />
        <path d="M1640 210 L1640 390 M1550 300 L1730 300 M1580 240 L1700 360 M1700 240 L1580 360" strokeWidth={1.4} />
      </g>
    </svg>
  </AbsoluteFill>
);

/** Bars 13–15: the room dissolves into parchment; wordmark, compatibility line, status and CTA. */
export const EndCard: React.FC<{ continueFrom: number; screen?: React.ReactNode; caption?: boolean }> = ({ continueFrom, screen, caption = true }) => {
  const f = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const { beat } = useTiming();
  const toParchment = interpolate(f, [0, beat(2)], [0, 1], clamp);
  const emblem = spring({ frame: f - beat(1), fps, config: { damping: 11, stiffness: 120 } });
  const wordAt = beat(1.5);
  const shimmer = interpolate(f, [beat(4), beat(6)], [-30, 130], clamp);

  return (
    <AbsoluteFill>
      {toParchment < 1 ? (
        <AbsoluteFill style={{ filter: `blur(${toParchment * 12}px)` }}>
          <Room zoom={0} screen={screen ?? <Shot id="walkthrough" alignFrame={0} offsetSec={continueFrom / FPS} />} />
        </AbsoluteFill>
      ) : null}
      <AbsoluteFill style={{ opacity: toParchment }}>
        <Parchment />
        <Embers count={36} seed="end" opacity={0.7} />
      </AbsoluteFill>

      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", paddingBottom: 60 }}>
        <div style={{ transform: `scale(${emblem}) rotate(${interpolate(emblem, [0, 1], [-160, 0])}deg)`, opacity: emblem, marginBottom: 18 }}>
          <D20 size={150} color="#8a1d17" face="20" glow={0.9} />
        </div>
        <div style={{ position: "relative", display: "flex" }}>
          {Array.from(WORD).map((ch, i) => {
            const s = spring({ frame: f - wordAt - i * 2, fps, config: { damping: 12, stiffness: 200 } });
            return (
              <span
                key={i}
                style={{
                  display: "inline-block",
                  fontFamily: FONT.display,
                  fontWeight: 800,
                  fontSize: 168,
                  letterSpacing: "0.04em",
                  color: C.gold,
                  backgroundImage: `linear-gradient(100deg, ${C.gold} ${shimmer - 18}%, #fff6d0 ${shimmer}%, ${C.gold} ${shimmer + 18}%)`,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  filter: `drop-shadow(0 4px 0 ${C.goldDeep}) drop-shadow(0 0 26px rgba(224,184,60,0.45)) blur(${(1 - s) * 8}px)`,
                  opacity: s,
                  transform: `translateY(${(1 - s) * 50}px)`,
                }}
              >
                {ch}
              </span>
            );
          })}
        </div>
        <div
          style={{
            width: interpolate(f, [beat(2.5), beat(3.5)], [0, 900], clamp),
            height: 3,
            marginTop: 8,
            background: `linear-gradient(90deg, rgba(224,184,60,0), ${C.gold}, rgba(224,184,60,0))`,
          }}
        />
        <div
          style={{
            fontFamily: FONT.display,
            fontWeight: 600,
            fontSize: 40,
            letterSpacing: "0.14em",
            color: C.text,
            marginTop: 26,
            opacity: interpolate(f, [beat(3), beat(3.5)], [0, 1], clamp),
            transform: `translateY(${interpolate(f, [beat(3), beat(3.5)], [16, 0], clamp)}px)`,
          }}
        >
          Compatible with 5e · SRD 5.2
        </div>
      </AbsoluteFill>
      {/* "Coming soon" stamp, top-right of the wordmark */}
      <ComingSoon at={beat(5)} x={width / 2 + 470} y={300} />
      {caption ? <InkCaption text="Gather your party." at={beat(6)} mode="write" align="center" size={64} bottom={110} /> : null}
    </AbsoluteFill>
  );
};

const ComingSoon: React.FC<{ at: number; x: number; y: number }> = ({ at, x, y }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (f < at) return null;
  const s = spring({ frame: f - at, fps, config: { damping: 10, stiffness: 260, mass: 0.6 } });
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: `translate(-50%, -50%) rotate(-10deg) scale(${interpolate(s, [0, 1], [2.4, 1])})`,
        opacity: Math.min(1, s * 2),
        border: `5px solid ${C.gold}`,
        borderRadius: 12,
        padding: "10px 26px",
        fontFamily: FONT.display,
        fontWeight: 800,
        fontSize: 46,
        letterSpacing: "0.12em",
        color: C.goldHi,
        background: "rgba(18,13,10,0.55)",
        textShadow: "0 0 12px rgba(224,184,60,0.6)",
        boxShadow: "0 0 24px rgba(224,184,60,0.3)",
      }}
    >
      COMING SOON
    </div>
  );
};
