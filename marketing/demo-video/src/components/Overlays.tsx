import React from "react";
import { AbsoluteFill, random, useCurrentFrame } from "remotion";

/** Animated paper/film grain. The noise seed changes every 2 frames. */
export const Grain: React.FC<{ opacity?: number }> = ({ opacity = 0.11 }) => {
  const f = useCurrentFrame();
  const seed = Math.floor(f / 2) % 97;
  return (
    <AbsoluteFill style={{ pointerEvents: "none", mixBlendMode: "overlay", opacity }}>
      <svg width="100%" height="100%">
        <filter id={`grain-${seed}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={seed} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#grain-${seed})`} />
      </svg>
    </AbsoluteFill>
  );
};

/** Vignette plus a warm candle-light flicker over everything. */
export const Atmosphere: React.FC<{ warmth?: number }> = ({ warmth = 1 }) => {
  const f = useCurrentFrame();
  const flick = 0.75 + 0.25 * Math.sin(f * 0.31) * Math.sin(f * 0.13 + 2) + 0.1 * (random(`atm-${Math.floor(f / 3)}`) - 0.5);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill
        style={{
          mixBlendMode: "soft-light",
          opacity: 0.35 * warmth * flick,
          background: "radial-gradient(ellipse at 30% 85%, rgba(255,150,60,0.9), rgba(255,120,40,0) 60%)",
        }}
      />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 55%, rgba(8,4,2,0.55) 100%)" }} />
    </AbsoluteFill>
  );
};
