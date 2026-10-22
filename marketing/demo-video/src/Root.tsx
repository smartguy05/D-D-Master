import React from "react";
import { AbsoluteFill, CalculateMetadataFunction, Composition } from "remotion";
import { Demo } from "./Demo";
import { DemoProps, defaultProps, loadInputs } from "./data";
import { FPS, HEIGHT, WIDTH, makeTiming } from "./timing";
import { TOUR_BARS, Tour } from "./Tour";

// Duration is 15 bars at the chosen track's bpm; inputs come from public/ at render time.
const calculateMetadata: CalculateMetadataFunction<DemoProps> = async () => {
  const props = await loadInputs();
  return { durationInFrames: makeTiming(props.bpm).totalFrames, props };
};

// The ~2 minute narrated tour: 55 bars, the whole track.
const calculateTourMetadata: CalculateMetadataFunction<DemoProps> = async () => {
  const props = await loadInputs();
  return { durationInFrames: makeTiming(props.bpm, TOUR_BARS).totalFrames, props };
};

/** 9:16 cut: the 16:9 film centred over a blurred, cropped copy of itself. */
const DemoVertical: React.FC<DemoProps> = (props) => {
  const s = 1080 / WIDTH;
  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      <AbsoluteFill style={{ filter: "blur(30px) brightness(0.55)", transform: `scale(${1920 / HEIGHT})`, transformOrigin: "50% 50%" }}>
        <div style={{ width: WIDTH, height: HEIGHT, position: "absolute", left: (1080 - WIDTH) / 2, top: (1920 - HEIGHT) / 2 }}>
          <Demo {...props} sfx={[]} audio={null} />
        </div>
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 0, top: (1920 - HEIGHT * s) / 2, width: WIDTH, height: HEIGHT, transform: `scale(${s})`, transformOrigin: "0 0" }}>
        <Demo {...props} />
      </div>
    </AbsoluteFill>
  );
};

export const Root: React.FC = () => (
  <>
    <Composition
      id="Demo"
      component={Demo}
      width={WIDTH}
      height={HEIGHT}
      fps={FPS}
      durationInFrames={makeTiming(defaultProps.bpm).totalFrames}
      defaultProps={defaultProps}
      calculateMetadata={calculateMetadata}
    />
    <Composition
      id="DemoVertical"
      component={DemoVertical}
      width={1080}
      height={1920}
      fps={FPS}
      durationInFrames={makeTiming(defaultProps.bpm).totalFrames}
      defaultProps={defaultProps}
      calculateMetadata={calculateMetadata}
    />
    <Composition
      id="Tour"
      component={Tour}
      width={WIDTH}
      height={HEIGHT}
      fps={FPS}
      durationInFrames={makeTiming(defaultProps.bpm, TOUR_BARS).totalFrames}
      defaultProps={defaultProps}
      calculateMetadata={calculateTourMetadata}
    />
  </>
);
