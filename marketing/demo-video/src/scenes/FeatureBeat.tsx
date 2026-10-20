import React from "react";
import { AbsoluteFill } from "remotion";
import { Camera } from "../components/Camera";
import { InkCaption } from "../components/InkCaption";
import { Shot } from "../components/Shot";
import { ShotId } from "../data";
import { useTiming } from "../timing";

/** One feature: a full-frame live shot under a trailer camera move, an overlay and one caption. */
export const FeatureBeat: React.FC<{
  shot: ShotId;
  caption: string;
  duration: number;
  move?: "push" | "orbit" | "drift" | "punch";
  /** Beat (scene-relative) the caption lands on. */
  captionBeat?: number;
  /** Scene-relative frame where the shot's highlight should be on screen. */
  alignFrame?: number;
  overlay?: React.ReactNode;
  captionMode?: "write" | "stamp";
  /** Put the caption at the top (px from top edge). */
  captionTop?: number;
}> = ({ shot, caption, duration, move = "push", captionBeat = 0.5, alignFrame, overlay, captionMode = "write", captionTop }) => {
  const { beat } = useTiming();
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Camera move={move} duration={duration}>
        <Shot id={shot} alignFrame={alignFrame ?? beat(1)} />
      </Camera>
      {overlay}
      <InkCaption text={caption} at={beat(captionBeat)} mode={captionMode} top={captionTop} />
    </AbsoluteFill>
  );
};
