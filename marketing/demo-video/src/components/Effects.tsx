import React from "react";
import { AbsoluteFill, interpolate, random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT } from "../theme";
import { D20 } from "./Props";

/** Rising embers. `burst` spawns them all from a point at `at`; otherwise they drift up continuously. */
export const Embers: React.FC<{ count?: number; seed?: string; burst?: { x: number; y: number; at: number }; opacity?: number }> = ({
  count = 40,
  seed = "e",
  burst,
  opacity = 1,
}) => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity }}>
      {Array.from({ length: count }).map((_, i) => {
        const r = (k: string) => random(`${seed}-${i}-${k}`);
        const size = 3 + r("s") * 7;
        let x: number, y: number, a: number;
        if (burst) {
          const t = f - burst.at;
          if (t < 0) return null;
          const ang = r("a") * Math.PI * 2;
          const speed = 6 + r("v") * 22;
          const life = 40 + r("l") * 50;
          if (t > life) return null;
          // Fast outward burst that decelerates, then embers float upward.
          const dist = speed * 14 * (1 - Math.exp(-t / 10));
          x = burst.x + Math.cos(ang) * dist + Math.sin(t / 9 + i) * 8;
          y = burst.y + Math.sin(ang) * dist - t * 1.6;
          a = 1 - t / life;
        } else {
          const period = 140 + r("p") * 160;
          const t = ((f + r("o") * period) % period) / period;
          x = r("x") * width + Math.sin((f + i * 20) / (18 + r("w") * 20)) * 30;
          y = height + 40 - t * (height + 120);
          a = Math.sin(t * Math.PI) * (0.4 + r("b") * 0.6);
        }
        const hue = r("h") > 0.5 ? C.goldHi : "#ff8a2a";
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: size,
              height: size,
              borderRadius: "50%",
              background: hue,
              opacity: a,
              boxShadow: `0 0 ${size * 2.5}px ${hue}`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

/** Gold "NATURAL 20" crit burst: flash, rotating rays, spinning d20, stamped title, ember burst. */
export const Nat20Burst: React.FC<{ at: number }> = ({ at }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame - at;
  if (t < -4) return null;
  const pop = spring({ frame: t, fps, config: { damping: 9, stiffness: 180, mass: 0.7 } });
  const flash = interpolate(t, [-2, 0, 10], [0, 0.85, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const rays = interpolate(t, [0, 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fade = interpolate(t, [70, 100], [1, 0.0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const cx = width / 2;
  const cy = height * 0.44;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 44%, rgba(255,230,150,${flash}), rgba(224,184,60,${flash * 0.6}) 40%, rgba(0,0,0,0) 75%)` }} />
      <AbsoluteFill style={{ opacity: rays * fade * 0.75 }}>
        <svg width={width} height={height} style={{ position: "absolute" }}>
          <g transform={`translate(${cx} ${cy}) rotate(${t * 0.6})`}>
            {Array.from({ length: 24 }).map((_, i) => (
              <polygon
                key={i}
                points={`0,0 ${Math.cos((i / 24) * Math.PI * 2 - 0.035) * 1400},${Math.sin((i / 24) * Math.PI * 2 - 0.035) * 1400} ${Math.cos((i / 24) * Math.PI * 2 + 0.035) * 1400},${Math.sin((i / 24) * Math.PI * 2 + 0.035) * 1400}`}
                fill={i % 2 ? "rgba(255,215,94,0.22)" : "rgba(224,184,60,0.12)"}
              />
            ))}
          </g>
        </svg>
      </AbsoluteFill>
      <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 44%, rgba(0,0,0,0) 20%, rgba(10,6,4,${0.55 * rays * fade}) 70%)` }} />
      <div
        style={{
          position: "absolute",
          left: cx - 130,
          top: cy - 250,
          transform: `scale(${pop}) rotate(${interpolate(pop, [0, 1], [-200, 0])}deg)`,
          opacity: fade,
        }}
      >
        <D20 size={260} color="#8a1d17" glow={1} />
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: cy + 40,
          textAlign: "center",
          fontFamily: FONT.display,
          fontWeight: 800,
          fontSize: 150,
          letterSpacing: "0.06em",
          color: C.goldHi,
          opacity: fade * interpolate(t, [2, 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          transform: `scale(${interpolate(spring({ frame: t - 3, fps, config: { damping: 10, stiffness: 240 } }), [0, 1], [2.2, 1])})`,
          textShadow: `0 4px 0 ${C.goldDeep}, 0 0 40px rgba(255,215,94,0.8), 0 10px 50px rgba(0,0,0,0.9)`,
          backgroundClip: "text",
        }}
      >
        NATURAL 20
      </div>
      <Embers count={70} seed="nat20" burst={{ x: cx, y: cy, at }} />
    </AbsoluteFill>
  );
};

/** Screen shake offset for a hit at `at` (use as a transform on a parent). */
export const shake = (frame: number, at: number, amp = 18) => {
  const t = frame - at;
  if (t < 0 || t > 18) return "none";
  const d = (1 - t / 18) * amp;
  return `translate(${Math.sin(t * 2.7) * d}px, ${Math.cos(t * 3.3) * d * 0.7}px)`;
};

/** Drifting fog banks that part and clear over `duration` frames (over the map shot). */
export const FogLift: React.FC<{ duration: number }> = ({ duration }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [0, duration * 0.8], [0, 1], { extrapolateRight: "clamp" });
  const ease = 1 - Math.pow(1 - p, 3);
  const banks = [
    { x: 10, y: 30, w: 900, dx: -900 },
    { x: 55, y: 20, w: 1100, dx: 1000 },
    { x: 30, y: 70, w: 1000, dx: -1100 },
    { x: 75, y: 75, w: 900, dx: 900 },
    { x: 45, y: 50, w: 1300, dx: 0 },
  ];
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {banks.map((b, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${b.x}%`,
            top: `${b.y}%`,
            width: b.w,
            height: b.w * 0.55,
            transform: `translate(-50%, -50%) translateX(${b.dx * ease}px) scale(${1 + ease * 0.4})`,
            background: "radial-gradient(ellipse, rgba(30,26,34,0.92) 0%, rgba(30,26,34,0.6) 40%, rgba(30,26,34,0) 70%)",
            opacity: (1 - ease) * (i === 4 ? 0.9 : 1),
            filter: "blur(20px)",
          }}
        />
      ))}
    </AbsoluteFill>
  );
};
