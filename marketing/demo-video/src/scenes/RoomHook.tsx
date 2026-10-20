import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { InkCaption } from "../components/InkCaption";
import { Nat20Burst, shake } from "../components/Effects";
import { Room } from "../components/Room";
import { Shot } from "../components/Shot";
import { useTiming } from "../timing";

/**
 * Bars 1–2. Candlelit table with the TV at the far end; the camera pushes into the screen while the
 * dice tumble, landing as the camera arrives. The crit burst hits on `hitBeat`.
 */
export const RoomHook: React.FC<{ hitBeat: number }> = ({ hitBeat }) => {
  const f = useCurrentFrame();
  const { beat } = useTiming();
  const hit = beat(hitBeat);
  const zoom = Easing.inOut(Easing.cubic)(interpolate(f, [beat(0.5), hit - beat(0.25)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  // Slow-mo creep after the hit so the frame never sits still.
  const after = interpolate(f, [hit, hit + beat(4)], [1, 1.08], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ transform: shake(f, hit, 22) }}>
      <AbsoluteFill style={{ transform: `scale(${after})` }}>
        <Room zoom={zoom} screen={<Shot id="hook-dice" alignFrame={hit} />} />
      </AbsoluteFill>
      <Nat20Burst at={hit} />
      <InkCaption text="Your DM just rolled in." at={hit + beat(1.5)} mode="write" size={92} />
    </AbsoluteFill>
  );
};
