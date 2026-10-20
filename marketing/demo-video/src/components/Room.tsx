import React from "react";
import { AbsoluteFill, random, useCurrentFrame } from "remotion";
import { C } from "../theme";
import { Candle, D20, Mini, Sheet } from "./Props";

// TV screen rectangle in room space; zoom=1 scales it to exactly fill the 1920x1080 frame.
const SCREEN = { x: 480, y: 120, w: 960, h: 540 };

/**
 * The in-person framing: a TV at the end of a candlelit wooden table, dice, minis and a character
 * sheet in the foreground. `screen` renders inside the TV. `zoom` 0 → 1 pushes the camera into the
 * screen until it fills the frame, so the next full-frame shot can cut in seamlessly.
 */
export const Room: React.FC<{ zoom: number; screen: React.ReactNode; propsOpacity?: number }> = ({ zoom, screen, propsOpacity = 1 }) => {
  const f = useCurrentFrame();
  // X' = s*x + tx. The screen's top-left moves from (480,120) to (0,0) while s goes 1 → 2.
  const s = 1 + zoom * (1920 / SCREEN.w - 1);
  const tx = SCREEN.x * (1 - zoom) - s * SCREEN.x;
  const ty = SCREEN.y * (1 - zoom) - s * SCREEN.y;
  const flicker = 0.9 + 0.1 * Math.sin(f * 0.5) * Math.sin(f * 0.23 + 1) + 0.05 * (random(`room-${Math.floor(f / 4)}`) - 0.5);
  const propsFade = propsOpacity * Math.max(0, 1 - zoom * 1.6);

  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <AbsoluteFill style={{ transformOrigin: "0 0", transform: `translate(${tx}px, ${ty}px) scale(${s})` }}>
        {/* Back wall: dark plaster/stone with warm falloff */}
        <AbsoluteFill
          style={{
            background: `radial-gradient(ellipse at 50% 40%, #3a2a1e 0%, #22170f 45%, ${C.bg} 80%)`,
          }}
        />
        <AbsoluteFill
          style={{
            opacity: 0.18,
            backgroundImage:
              "repeating-linear-gradient(0deg, rgba(0,0,0,0.5) 0 2px, transparent 2px 70px), repeating-linear-gradient(90deg, rgba(0,0,0,0.35) 0 2px, transparent 2px 140px)",
          }}
        />
        {/* TV glow spilling on the wall */}
        <div
          style={{
            position: "absolute",
            left: SCREEN.x - 260,
            top: SCREEN.y - 160,
            width: SCREEN.w + 520,
            height: SCREEN.h + 360,
            background: "radial-gradient(ellipse, rgba(127,180,255,0.14), rgba(224,184,60,0.06) 45%, rgba(0,0,0,0) 70%)",
          }}
        />
        {/* TV */}
        <div
          style={{
            position: "absolute",
            left: SCREEN.x - 16,
            top: SCREEN.y - 16,
            width: SCREEN.w + 32,
            height: SCREEN.h + 32,
            borderRadius: 10,
            background: "linear-gradient(180deg, #1b1b1d, #0a0a0b)",
            boxShadow: "0 30px 60px rgba(0,0,0,0.8), inset 0 0 0 2px #2a2a2c",
          }}
        />
        <div style={{ position: "absolute", left: SCREEN.x, top: SCREEN.y, width: SCREEN.w, height: SCREEN.h, overflow: "hidden", background: "#000" }}>
          <div style={{ width: 1920, height: 1080, transform: `scale(${SCREEN.w / 1920})`, transformOrigin: "0 0" }}>{screen}</div>
          {/* screen sheen */}
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, rgba(255,255,255,0.07), rgba(255,255,255,0) 40%)", opacity: 1 - zoom }} />
        </div>
        <div style={{ position: "absolute", left: 900, top: SCREEN.y + SCREEN.h + 16, width: 120, height: 40, background: "#111", borderRadius: "0 0 8px 8px" }} />

        {/* Table: wooden plane in perspective */}
        <div style={{ position: "absolute", left: -400, top: 690, width: 2720, height: 900, perspective: 900, perspectiveOrigin: "50% 0%" }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              transformOrigin: "50% 0%",
              transform: "rotateX(58deg)",
              background: `repeating-linear-gradient(90deg, rgba(0,0,0,0.25) 0 3px, transparent 3px 260px),
                 repeating-linear-gradient(90deg, rgba(255,220,170,0.04) 0 1px, transparent 1px 23px),
                 linear-gradient(180deg, #4a2f1c, #6e4628 40%, #7b4f2c)`,
              boxShadow: "inset 0 40px 80px rgba(0,0,0,0.6)",
            }}
          />
        </div>
        {/* Candlelight pooling on the table */}
        <AbsoluteFill
          style={{
            background: "radial-gradient(ellipse at 22% 72%, rgba(255,170,80,0.32), rgba(0,0,0,0) 40%), radial-gradient(ellipse at 82% 74%, rgba(255,170,80,0.26), rgba(0,0,0,0) 38%)",
            opacity: flicker,
          }}
        />

        {/* Mid-ground props */}
        <div style={{ opacity: Math.max(0, 1 - zoom * 1.2) }}>
          <Candle height={150} seed={1} style={{ position: "absolute", left: 300, top: 600 }} />
          <Candle height={110} seed={2} style={{ position: "absolute", left: 360, top: 650 }} />
          <Candle height={130} seed={3} style={{ position: "absolute", left: 1600, top: 620 }} />
          <Mini size={70} color="#5b6e7a" style={{ position: "absolute", left: 760, top: 740 }} />
          <Mini size={64} color="#3e5a8a" style={{ position: "absolute", left: 850, top: 760 }} />
          <Mini size={66} color="#7a3f2c" style={{ position: "absolute", left: 1090, top: 750 }} />
          <D20 size={90} color="#2c4a7a" face="17" style={{ position: "absolute", left: 1330, top: 800, transform: "rotate(-14deg)" }} />
        </div>
      </AbsoluteFill>

      {/* Foreground props: blurred, move faster than the room (parallax) and leave frame on push */}
      <AbsoluteFill style={{ opacity: propsFade, transform: `scale(${1 + zoom * 1.4})`, transformOrigin: "50% 60%" }}>
        <D20 size={260} color="#7a1f1a" face="20" style={{ position: "absolute", left: 60, top: 760, filter: "blur(7px)", transform: "rotate(18deg)" }} />
        <D20 size={150} color="#244a3a" face="8" style={{ position: "absolute", left: 360, top: 900, filter: "blur(5px)", transform: "rotate(-24deg)" }} />
        <div style={{ position: "absolute", left: 1420, top: 760, transform: "rotate(-12deg)", filter: "blur(6px)" }}>
          <Sheet width={420} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
