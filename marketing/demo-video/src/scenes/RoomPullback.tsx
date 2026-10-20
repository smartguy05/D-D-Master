import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { Room } from "../components/Room";
import { Shot } from "../components/Shot";
import { FPS } from "../timing";

/**
 * The last half-bar of the walkthrough: pull back out of the TV to the table, so the walkthrough
 * ends the way the video started, in the room. `continueFrom` keeps the footage continuous.
 */
export const RoomPullback: React.FC<{ duration: number; continueFrom: number }> = ({ duration, continueFrom }) => {
  const f = useCurrentFrame();
  const zoom = 1 - Easing.inOut(Easing.cubic)(interpolate(f, [0, duration], [0, 1], { extrapolateRight: "clamp" }));
  return (
    <AbsoluteFill>
      <Room zoom={zoom} screen={<Shot id="walkthrough" alignFrame={0} offsetSec={continueFrom / FPS} />} />
    </AbsoluteFill>
  );
};
