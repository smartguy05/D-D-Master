import React, { createContext, useContext } from "react";
import { AbsoluteFill, Img, OffthreadVideo, interpolate, staticFile, useCurrentFrame } from "remotion";
import { DemoProps, SHOT_CONFIG, ShotId, defaultProps } from "../data";
import { FPS } from "../timing";

export const InputsContext = createContext<DemoProps>(defaultProps);
export const useInputs = () => useContext(InputsContext);

type Props = {
  id: ShotId;
  /** Scene-relative frame at which the chosen highlight should be on screen. */
  alignFrame?: number;
  /** Overrides SHOT_CONFIG's highlight keyword. */
  keyword?: RegExp;
  /** Extra seconds to offset from the highlight (negative = earlier). */
  offsetSec?: number;
  fit?: "cover" | "contain";
  style?: React.CSSProperties;
  /** Start the clip at this footage second (scene frame 0), instead of aligning a highlight. */
  startSec?: number;
  playbackRate?: number;
};

/** Live footage for a shot id, or its placeholder still with a slow push-in when it's missing. */
export const Shot: React.FC<Props> = ({ id, alignFrame = 0, keyword, offsetSec = 0, fit = "cover", style, startSec: fixedStart, playbackRate = 1 }) => {
  const { shots } = useInputs();
  const frame = useCurrentFrame();
  const entry = shots[id];
  const cfg = SHOT_CONFIG[id];

  if (entry) {
    const re = keyword ?? cfg.keyword;
    const hl = (re && entry.highlights?.find((h) => re.test(h.label))) ?? entry.highlights?.[0];
    const anchor = hl ? hl.tSec : 0;
    const startSec = Math.min(Math.max(0, fixedStart ?? anchor + offsetSec - alignFrame / FPS), Math.max(0, entry.durationSec - 1));
    return (
      <AbsoluteFill style={style}>
        <OffthreadVideo
          src={staticFile(entry.file)}
          startFrom={Math.round(startSec * FPS)}
          muted
          playbackRate={playbackRate}
          style={{ width: "100%", height: "100%", objectFit: fit }}
        />
      </AbsoluteFill>
    );
  }

  const scale = interpolate(frame, [0, 360], [1.02, 1.14], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ overflow: "hidden", ...style }}>
      <Img
        src={staticFile(cfg.still)}
        style={{ width: "100%", height: "100%", objectFit: fit, transform: `scale(${scale})` }}
      />
    </AbsoluteFill>
  );
};
