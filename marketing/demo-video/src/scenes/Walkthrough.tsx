import React from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Camera } from "../components/Camera";
import { Phone } from "../components/Phone";
import { Candle } from "../components/Props";
import { Shot } from "../components/Shot";
import { C, FONT } from "../theme";
import { useTiming } from "../timing";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Where the host clicks "start", as a fraction of the host screen. Tune to the real footage. */
export const HOST_CLICK = { x: 0.164, y: 0.145 }; // "Start text-only DM" in host-start.mp4

/** Small numbered step tag, top-left, that writes in and hands off to the next. */
export const StepTag: React.FC<{ n: number; text: string; at: number; out?: number }> = ({ n, text, at, out }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (f < at) return null;
  const s = spring({ frame: f - at, fps, config: { damping: 13, stiffness: 220 } });
  const leave = out != null ? interpolate(f, [out - 6, out], [1, 0], clamp) : 1;
  return (
    <div
      style={{
        position: "absolute",
        left: 90,
        top: 60,
        display: "flex",
        alignItems: "center",
        gap: 18,
        opacity: s * leave,
        transform: `translateX(${(1 - s) * -60}px)`,
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: "50%",
          border: `3px solid ${C.gold}`,
          background: "rgba(18,13,10,0.9)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: FONT.display,
          fontWeight: 800,
          fontSize: 34,
          color: C.gold,
          boxShadow: "0 0 24px rgba(224,184,60,0.45)",
        }}
      >
        {n}
      </div>
      <div
        style={{
          fontFamily: FONT.display,
          fontWeight: 800,
          fontSize: 44,
          color: C.text,
          padding: "8px 22px",
          background: "rgba(18,13,10,0.82)",
          border: `2px solid ${C.line}`,
          borderRadius: 12,
          textShadow: "0 3px 10px rgba(0,0,0,0.9)",
        }}
      >
        {text}
      </div>
    </div>
  );
};

/** Bar 9: the host laptop on the table; the cursor clicks to start the session. */
export const HostStart: React.FC<{ duration: number }> = ({ duration }) => {
  const f = useCurrentFrame();
  const { beat } = useTiming();
  const lw = 1160;
  const lh = lw * 0.5625;
  const click = beat(2);
  const cursorP = Easing.inOut(Easing.cubic)(interpolate(f, [beat(0.4), click], [0, 1], clamp));
  const cx = interpolate(cursorP, [0, 1], [0.35, HOST_CLICK.x]) * lw;
  const cy = interpolate(cursorP, [0, 1], [0.7, HOST_CLICK.y]) * lh;
  const ring = interpolate(f, [click, click + 18], [0, 1], clamp);
  const push = interpolate(f, [0, duration], [1, 1.12]);
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: C.bg }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at 50% 30%, rgba(255,170,80,0.25), rgba(0,0,0,0) 60%), linear-gradient(180deg, #22170f, #4a2f1c 55%, #6e4628)`,
        }}
      />
      <Candle height={200} seed={11} style={{ position: "absolute", left: 140, top: 560, filter: "blur(3px)" }} />
      <Candle height={160} seed={12} style={{ position: "absolute", left: 1700, top: 600, filter: "blur(4px)" }} />
      <AbsoluteFill style={{ transform: `scale(${push})`, transformOrigin: `${50 + (HOST_CLICK.x - 0.5) * 60}% 35%` }}>
        <div style={{ position: "absolute", left: (1920 - lw) / 2, top: 190 }}>
          {/* laptop lid */}
          <div style={{ width: lw + 36, height: lh + 36, marginLeft: -18, borderRadius: 22, background: "linear-gradient(180deg,#2a2a2d,#141416)", padding: 18, boxSizing: "border-box", boxShadow: "0 30px 70px rgba(0,0,0,0.7)" }}>
            <div style={{ position: "relative", width: lw, height: lh, overflow: "hidden", borderRadius: 6, background: "#000" }}>
              <div style={{ width: 1920, height: 1080, transform: `scale(${lw / 1920})`, transformOrigin: "0 0" }}>
                <Shot id="host-start" alignFrame={click} fit="cover" />
              </div>
              {/* click ring + cursor */}
              <div
                style={{
                  position: "absolute",
                  left: cx - 50,
                  top: cy - 50,
                  width: 100,
                  height: 100,
                  borderRadius: "50%",
                  border: `4px solid ${C.gold}`,
                  transform: `scale(${0.3 + ring * 1.3})`,
                  opacity: ring > 0 ? 1 - ring : 0,
                }}
              />
              <svg width={44} height={44} viewBox="0 0 24 24" style={{ position: "absolute", left: cx - 6, top: cy - 4, filter: "drop-shadow(0 3px 4px rgba(0,0,0,0.8))" }}>
                <path d="M3 2 L3 20 L8 15 L11.5 22 L14.5 20.5 L11 13.8 L18 13.5 Z" fill="#fff" stroke="#000" strokeWidth="1.2" />
              </svg>
            </div>
          </div>
          {/* base */}
          <div style={{ width: lw + 260, height: 34, marginLeft: -130, marginTop: -2, borderRadius: "0 0 30px 30px", background: "linear-gradient(180deg,#3a3a3e,#151517)" }} />
        </div>
      </AbsoluteFill>
      <StepTag n={1} text="Start the session" at={beat(0.25)} />
    </AbsoluteFill>
  );
};

/**
 * Bars 10–12: one continuous take on the TV view, with step tags and the phone sliding in when
 * HP drops. `phoneBeat` is when the phone appears (scene-relative beats).
 */
export const Walkthrough: React.FC<{ duration: number; phoneBeat?: number }> = ({ duration, phoneBeat = 7 }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { beat } = useTiming();
  const phoneIn = spring({ frame: f - beat(phoneBeat), fps, config: { damping: 14, stiffness: 140 } });
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Camera move="orbit" duration={duration} intensity={0.8}>
        <Shot id="walkthrough" alignFrame={0} />
      </Camera>
      <StepTag n={2} text="The table comes alive" at={0} out={beat(3)} />
      <StepTag n={3} text="The DM voices every NPC" at={beat(3)} out={beat(6)} />
      <StepTag n={4} text="Rolls resolve themselves" at={beat(6)} out={beat(phoneBeat + 0.5)} />
      <StepTag n={5} text="Sheets update live" at={beat(phoneBeat + 0.5)} />
      {f >= beat(phoneBeat) ? (
        <div
          style={{
            position: "absolute",
            right: 90,
            bottom: 60,
            transform: `translateY(${(1 - phoneIn) * 700}px) rotate(${interpolate(phoneIn, [0, 1], [14, 4])}deg)`,
          }}
        >
          <Phone height={640} hpAt={beat(phoneBeat + 1)} />
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
