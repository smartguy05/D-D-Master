import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";

type Move = "push" | "orbit" | "drift" | "punch";

/**
 * Trailer-style camera over a full-frame layer: slow push-in, a slight 3D orbit, a lateral drift,
 * or a fast punch-in that settles. `duration` is the scene length in frames.
 */
export const Camera: React.FC<{ move?: Move; duration: number; intensity?: number; children: React.ReactNode }> = ({
  move = "push",
  duration,
  intensity = 1,
  children,
}) => {
  const f = useCurrentFrame();
  const t = interpolate(f, [0, Math.max(1, duration)], [0, 1], { extrapolateRight: "clamp" });
  let transform = "";
  if (move === "push") {
    const s = 1.04 + 0.1 * intensity * Easing.inOut(Easing.quad)(t);
    transform = `scale(${s}) translate(${-12 * t * intensity}px, ${-6 * t * intensity}px)`;
  } else if (move === "orbit") {
    const ry = interpolate(t, [0, 1], [7, -5]) * intensity;
    const rx = interpolate(t, [0, 1], [4, 2]) * intensity;
    transform = `perspective(2200px) rotateX(${rx}deg) rotateY(${ry}deg) scale(${1.16 + 0.04 * t})`;
  } else if (move === "drift") {
    transform = `scale(1.1) translateX(${interpolate(t, [0, 1], [30, -30]) * intensity}px)`;
  } else {
    const p = Easing.out(Easing.exp)(interpolate(f, [0, 14], [0, 1], { extrapolateRight: "clamp" }));
    transform = `scale(${1.32 - 0.24 * p + 0.04 * t})`;
  }
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={{ transform, transformOrigin: "50% 50%" }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};
