import React from "react";
import { AbsoluteFill, Easing, interpolate, random, useCurrentFrame, useVideoConfig } from "remotion";
import { C } from "../theme";
import { D20 } from "./Props";

export type Enter = "cut" | "dieWipe" | "pageTurn" | "unroll" | "flicker" | "whip" | "fade";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/**
 * Wraps an incoming scene and reveals it over the previous one (which must keep rendering
 * underneath for `duration` frames; see TAIL in Demo.tsx). The reveal starts at frame 0, which
 * sits on the bar line, so the cut still reads as on-beat.
 */
export const EnterTransition: React.FC<{ type: Enter; duration?: number; children: React.ReactNode }> = ({ type, duration = 14, children }) => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const p = Easing.inOut(Easing.cubic)(interpolate(f, [0, duration], [0, 1], clamp));

  if (type === "cut" || f > duration + 1) return <AbsoluteFill>{children}</AbsoluteFill>;

  if (type === "fade") return <AbsoluteFill style={{ opacity: p }}>{children}</AbsoluteFill>;

  if (type === "whip") {
    const blur = (1 - p) * 30;
    return <AbsoluteFill style={{ transform: `translateX(${(1 - p) * width * 0.35}px)`, filter: `blur(${blur}px)`, opacity: Math.min(1, p * 3) }}>{children}</AbsoluteFill>;
  }

  if (type === "flicker") {
    const n = random(`fl-${f}`);
    const o = p < 1 ? Math.min(1, p * 1.4) * (0.55 + 0.45 * n) : 1;
    return (
      <AbsoluteFill style={{ background: "#000" }}>
        <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>
      </AbsoluteFill>
    );
  }

  if (type === "dieWipe") {
    // A d20 tumbles left → right; the new scene is revealed behind its trail.
    const x = interpolate(p, [0, 1], [-260, width + 260]);
    const edge = x + 40;
    return (
      <AbsoluteFill>
        <AbsoluteFill style={{ clipPath: `polygon(0 0, ${edge + 140}px 0, ${edge - 140}px ${height}px, 0 ${height}px)` }}>{children}</AbsoluteFill>
        <div
          style={{
            position: "absolute",
            left: edge - 420,
            top: 0,
            width: 520,
            height,
            background: `linear-gradient(90deg, rgba(255,140,40,0), rgba(255,170,60,0.45) 80%, rgba(255,230,160,0.8))`,
            transform: "skewX(-14deg)",
            filter: "blur(18px)",
          }}
        />
        <div style={{ position: "absolute", left: x - 150, top: height / 2 - 150 + Math.abs(Math.sin(p * Math.PI * 3)) * -120, transform: `rotate(${p * 900}deg)` }}>
          <D20 size={300} color="#8a1d17" face="20" glow={0.8} />
        </div>
      </AbsoluteFill>
    );
  }

  if (type === "pageTurn") {
    // A diagonal page edge sweeps right → left with the back of the page and a soft shadow.
    const x = interpolate(p, [0, 1], [width + 500, -500]);
    const skew = 260;
    return (
      <AbsoluteFill>
        <AbsoluteFill style={{ clipPath: `polygon(${x}px 0, ${width + 600}px 0, ${width + 600}px ${height}px, ${x - skew}px ${height}px)` }}>{children}</AbsoluteFill>
        <div
          style={{
            position: "absolute",
            left: x - 200,
            top: -100,
            width: 220,
            height: height + 200,
            transform: `skewX(${-Math.atan(skew / height) * (180 / Math.PI)}deg)`,
            transformOrigin: "0 0",
            background: `linear-gradient(90deg, rgba(0,0,0,0), rgba(0,0,0,0.35) 40%, ${C.parchment} 70%, #c9a874 92%, rgba(0,0,0,0.5))`,
            boxShadow: "20px 0 40px rgba(0,0,0,0.5)",
          }}
        />
      </AbsoluteFill>
    );
  }

  // unroll: a parchment scroll unrolls top → bottom with a wooden rod on the edge.
  const y = interpolate(p, [0, 1], [-40, height + 40]);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ clipPath: `inset(0 0 ${Math.max(0, height - y)}px 0)` }}>{children}</AbsoluteFill>
      <div style={{ position: "absolute", left: 0, top: y - 70, width, height: 70, background: `linear-gradient(180deg, rgba(0,0,0,0), ${C.parchment} 60%, #b8935e)` }} />
      <div style={{ position: "absolute", left: -20, top: y - 18, width: width + 40, height: 36, borderRadius: 18, background: "linear-gradient(180deg, #8a5a32, #4a2f1c)", boxShadow: "0 12px 24px rgba(0,0,0,0.6)" }} />
    </AbsoluteFill>
  );
};
