import React from "react";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion";
import { Camera } from "../components/Camera";
import { EnterTransition } from "../components/Transitions";
import { Shot } from "../components/Shot";
import { ShotId } from "../data";
import { useTiming } from "../timing";

const Flash: React.FC = () => {
  const f = useCurrentFrame();
  return <AbsoluteFill style={{ background: "#fff3d0", opacity: interpolate(f, [0, 4], [0.32, 0], { extrapolateRight: "clamp" }) }} />;
};

export type MontageCut = { id: ShotId; keyword?: RegExp };

/** Fast cuts (every `step` beats) across the shots, each whipping in with a flash frame. */
export const Montage: React.FC<{ shots: MontageCut[]; step?: number }> = ({ shots, step = 0.5 }) => {
  const { beat } = useTiming();
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {shots.map(({ id, keyword }, i) => {
        const from = beat(i * step);
        const len = beat((i + 1) * step) - from;
        return (
          <Sequence key={id + i} from={from} durationInFrames={i === shots.length - 1 ? len : len + 6} layout="none">
            <AbsoluteFill>
              <EnterTransition type="whip" duration={5}>
                <Camera move="punch" duration={len}>
                  <Shot id={id} keyword={keyword} alignFrame={2} />
                </Camera>
              </EnterTransition>
              <Flash />
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
