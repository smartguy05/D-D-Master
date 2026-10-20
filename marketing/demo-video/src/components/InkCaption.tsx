import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT } from "../theme";

type Props = {
  text: string;
  /** Optional smaller second line. */
  sub?: string;
  /** Frame (relative to the parent Sequence) the caption lands on; place it on a beat. */
  at?: number;
  /** Frame it starts leaving; omit to stay. */
  out?: number;
  mode?: "write" | "stamp";
  align?: "left" | "center";
  size?: number;
  /** Distance from the bottom edge in px. */
  bottom?: number;
  /** Anchor to the top edge instead (for shots with their own subtitles at the bottom). */
  top?: number;
};

/** Inked map-label caption: letters write on left to right, or the whole line stamps down. */
export const InkCaption: React.FC<Props> = ({
  text,
  sub,
  at = 0,
  out,
  mode = "write",
  align = "left",
  size = 84,
  bottom = 120,
  top,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const f = frame - at;
  if (f < 0) return null;

  const leave = out != null ? interpolate(frame, [out, out + 10], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  const stamp = spring({ frame: f, fps, config: { damping: 11, stiffness: 220, mass: 0.6 } });
  const chars = Array.from(text);
  const writeFrames = Math.min(26, 6 + chars.length * 0.9);
  const flourish = interpolate(f, [writeFrames * 0.6, writeFrames + 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const subIn = interpolate(f, [writeFrames, writeFrames + 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const lineStyle: React.CSSProperties = {
    fontFamily: FONT.display,
    fontWeight: 800,
    fontSize: size,
    lineHeight: 1.05,
    letterSpacing: "0.02em",
    color: C.text,
    textShadow: `0 2px 0 ${C.ink}, 0 0 24px rgba(224,184,60,0.35), 0 6px 30px rgba(0,0,0,0.85)`,
    whiteSpace: "nowrap",
  };

  const body =
    mode === "stamp" ? (
      <div
        style={{
          ...lineStyle,
          transform: `scale(${interpolate(stamp, [0, 1], [1.9, 1])}) rotate(${interpolate(stamp, [0, 1], [-4, -1])}deg)`,
          opacity: interpolate(f, [0, 3], [0, 1], { extrapolateRight: "clamp" }),
          filter: `blur(${interpolate(f, [0, 5], [6, 0], { extrapolateRight: "clamp" })}px)`,
        }}
      >
        {text}
      </div>
    ) : (
      <div style={lineStyle}>
        {chars.map((ch, i) => {
          const p = interpolate(f, [(i / chars.length) * writeFrames, (i / chars.length) * writeFrames + 6], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                opacity: p,
                transform: `translateY(${(1 - p) * 14}px)`,
                filter: `blur(${(1 - p) * 5}px)`,
                color: p < 1 ? C.goldHi : C.text,
                whiteSpace: "pre",
              }}
            >
              {ch}
            </span>
          );
        })}
      </div>
    );

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: leave }}>
      {/* Legibility band */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(to ${top != null ? "bottom" : "top"}, rgba(10,6,4,0.82) 0%, rgba(10,6,4,0.45) 22%, rgba(10,6,4,0) 42%)`,
          opacity: interpolate(f, [0, 8], [0, 1], { extrapolateRight: "clamp" }),
        }}
      />
      <div
        style={{
          position: "absolute",
          left: align === "left" ? 110 : 0,
          right: align === "left" ? undefined : 0,
          ...(top != null ? { top } : { bottom }),
          display: "flex",
          flexDirection: "column",
          alignItems: align === "left" ? "flex-start" : "center",
        }}
      >
        {body}
        <svg width={Math.min(900, size * 9)} height={28} style={{ marginTop: 6, overflow: "visible" }}>
          <path
            d={`M4 14 C ${size * 2} 2, ${size * 4} 26, ${Math.min(896, size * 9 - 4)} 12`}
            stroke={C.gold}
            strokeWidth={4}
            strokeLinecap="round"
            fill="none"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - flourish}
            style={{ filter: "drop-shadow(0 0 6px rgba(224,184,60,0.6))" }}
          />
        </svg>
        {sub ? (
          <div
            style={{
              fontFamily: FONT.display,
              fontWeight: 600,
              fontSize: size * 0.5,
              color: C.gold,
              marginTop: 4,
              opacity: subIn,
              transform: `translateY(${(1 - subIn) * 12}px)`,
              textShadow: "0 4px 18px rgba(0,0,0,0.9)",
              whiteSpace: "nowrap",
            }}
          >
            {sub}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
