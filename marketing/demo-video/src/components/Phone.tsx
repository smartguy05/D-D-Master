import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, FONT } from "../theme";
import { Shot, useInputs } from "./Shot";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Stand-in for the /player sheet when no phone footage exists yet. */
const MockSheet: React.FC<{ hpAt: number }> = ({ hpAt }) => {
  const f = useCurrentFrame();
  const hp = interpolate(f, [hpAt, hpAt + 10], [22, 13], clamp);
  const hit = interpolate(f, [hpAt, hpAt + 4, hpAt + 18], [0, 1, 0], clamp);
  return (
    <AbsoluteFill style={{ background: C.bg, padding: 48, color: C.text, fontFamily: FONT.body }}>
      <div style={{ display: "flex", gap: 30, alignItems: "center" }}>
        <div style={{ width: 200, height: 200, borderRadius: "50%", overflow: "hidden", border: `5px solid ${C.gold}` }}>
          <Img src={staticFile("stills/sprite-8.png")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>
        <div>
          <div style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 64, color: C.gold, lineHeight: 1.05 }}>Brienne Saltblade</div>
          <div style={{ fontSize: 36, color: C.muted, marginTop: 8 }}>Human Fighter 2</div>
        </div>
      </div>
      <div style={{ marginTop: 60, fontFamily: FONT.display, fontWeight: 800, fontSize: 48, display: "flex", justifyContent: "space-between" }}>
        <span>Hit Points</span>
        <span style={{ color: hp < 14 ? C.bad : C.text }}>{Math.round(hp)} / 22</span>
      </div>
      <div style={{ position: "relative", height: 56, borderRadius: 28, background: C.panel2, border: `3px solid ${C.line}`, marginTop: 18, overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, width: `${(hp / 22) * 100}%`, background: hp < 14 ? `linear-gradient(90deg,#8a1d17,${C.bad})` : `linear-gradient(90deg,#2e8a46,${C.ok})` }} />
        <div style={{ position: "absolute", inset: 0, background: `rgba(255,255,255,${hit * 0.6})` }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24, marginTop: 60 }}>
        {[
          ["AC", "18"],
          ["Speed", "30"],
          ["Init", "+1"],
          ["STR", "+3"],
          ["DEX", "+1"],
          ["CON", "+2"],
        ].map(([k, v]) => (
          <div key={k} style={{ background: C.panel, border: `2px solid ${C.line}`, borderRadius: 24, padding: "28px 0", textAlign: "center" }}>
            <div style={{ fontSize: 30, color: C.muted }}>{k}</div>
            <div style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 64 }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 60, fontFamily: FONT.display, fontWeight: 800, fontSize: 44, color: C.gold }}>Actions</div>
      {["Longsword  +5 · 1d8+3", "Second Wind", "Action Surge"].map((a) => (
        <div key={a} style={{ marginTop: 20, padding: "26px 30px", background: C.panel, border: `2px solid ${C.line}`, borderRadius: 20, fontSize: 36 }}>
          {a}
        </div>
      ))}
    </AbsoluteFill>
  );
};

/**
 * A phone showing the player sheet, as if lying on / lifted above the table. Content is 1080x2340
 * (phone-sheet footage scaled to cover, or the mock sheet).
 */
export const Phone: React.FC<{ height: number; hpAt?: number; style?: React.CSSProperties; screen?: React.ReactNode }> = ({ height, hpAt = 30, style, screen }) => {
  const { shots } = useInputs();
  const w = height * (1080 / 2340);
  const inner = 1080;
  const scale = (w - 24) / inner;
  return (
    <div
      style={{
        width: w,
        height,
        borderRadius: w * 0.13,
        background: "linear-gradient(145deg, #2b2b2e, #0b0b0c)",
        padding: 12,
        boxSizing: "border-box",
        boxShadow: "0 40px 80px rgba(0,0,0,0.75), inset 0 0 0 2px #3a3a3e",
        ...style,
      }}
    >
      <div style={{ width: "100%", height: "100%", borderRadius: w * 0.11, overflow: "hidden", position: "relative", background: C.bg }}>
        <div style={{ width: inner, height: (height - 24) / scale, transform: `scale(${scale})`, transformOrigin: "0 0", position: "relative" }}>
          {screen ?? (shots["phone-sheet"] ? <Shot id="phone-sheet" alignFrame={hpAt} /> : <MockSheet hpAt={hpAt} />)}
        </div>
        <div style={{ position: "absolute", top: 10, left: "50%", width: w * 0.3, height: 22, marginLeft: -w * 0.15, borderRadius: 11, background: "#000" }} />
      </div>
    </div>
  );
};
