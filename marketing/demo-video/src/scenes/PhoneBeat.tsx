import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { InkCaption } from "../components/InkCaption";
import { Phone } from "../components/Phone";
import { Candle, D20 } from "../components/Props";
import { C } from "../theme";
import { useTiming } from "../timing";

/** The phone sheet lifts off the table into frame; HP drops on the beat. */
export const PhoneBeat: React.FC<{ duration: number }> = ({ duration }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { beat } = useTiming();
  const lift = spring({ frame: f, fps, config: { damping: 14, stiffness: 120 } });
  const tilt = interpolate(lift, [0, 1], [38, 8]);
  const drift = interpolate(f, [0, duration], [0, -20]);
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {/* Close-up of the table top */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at 30% 60%, rgba(255,170,80,0.35), rgba(0,0,0,0) 55%),
            repeating-linear-gradient(100deg, rgba(0,0,0,0.25) 0 3px, transparent 3px 220px),
            repeating-linear-gradient(100deg, rgba(255,220,170,0.04) 0 1px, transparent 1px 19px),
            linear-gradient(170deg, #4a2f1c, #6e4628 50%, #3a2416)`,
          transform: `scale(1.1) translateX(${drift}px)`,
        }}
      />
      <Candle height={260} seed={7} style={{ position: "absolute", left: 220, top: 520, filter: "blur(4px)" }} />
      <D20 size={180} color="#7a1f1a" face="20" style={{ position: "absolute", left: 1500, top: 700, transform: "rotate(-20deg)", filter: "blur(3px)" }} />
      <D20 size={110} color="#244a3a" face="6" style={{ position: "absolute", left: 1380, top: 860, transform: "rotate(30deg)", filter: "blur(5px)" }} />
      <div
        style={{
          position: "absolute",
          left: 1330,
          top: 90,
          transform: `perspective(1600px) rotateX(${tilt}deg) rotateZ(${interpolate(lift, [0, 1], [-12, -4])}deg) translateY(${(1 - lift) * 300}px)`,
          transformOrigin: "50% 100%",
        }}
      >
        <Phone height={900} hpAt={beat(1)} />
      </div>
      <AbsoluteFill style={{ background: `linear-gradient(90deg, rgba(18,13,10,0.7), rgba(18,13,10,0) 55%)` }} />
      <InkCaption text="Your sheet, in your pocket" at={beat(0.25)} mode="stamp" size={72} />
      <div style={{ position: "absolute", inset: 0, boxShadow: `inset 0 0 200px ${C.bg}` }} />
    </AbsoluteFill>
  );
};
