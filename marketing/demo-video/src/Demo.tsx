import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile } from "remotion";
import { CombatOverlay } from "./components/CombatOverlay";
import { FogLift } from "./components/Effects";
import { InkCaption } from "./components/InkCaption";
import { VoiceHud } from "./components/Hud";
import { Atmosphere, Grain } from "./components/Overlays";
import { InputsContext } from "./components/Shot";
import { Enter, EnterTransition } from "./components/Transitions";
import { DemoProps } from "./data";
import { EndCard } from "./scenes/EndCard";
import { FeatureBeat } from "./scenes/FeatureBeat";
import { Montage } from "./scenes/Montage";
import { PhoneBeat } from "./scenes/PhoneBeat";
import { RoomHook } from "./scenes/RoomHook";
import { RoomPullback } from "./scenes/RoomPullback";
import { HostStart, Walkthrough } from "./scenes/Walkthrough";
import { BEATS, FPS, TimingContext, makeTiming } from "./timing";

/** Frames a scene keeps rendering past its end so the next scene's reveal has something beneath it. */
const TAIL = 24;

/** SFX cues in beats; each plays only if public/sfx/<name>.wav exists (npm run sfx). */
const SFX: { name: string; beat: number; volume?: number }[] = [
  { name: "dice", beat: 1 },
  { name: "impact", beat: BEATS.hookHit },
  { name: "whoosh", beat: BEATS.voice - 0.25 },
  { name: "whoosh", beat: BEATS.map - 0.25 },
  { name: "whoosh", beat: BEATS.npc - 0.25, volume: 0.6 },
  { name: "whoosh", beat: BEATS.combat - 0.25 },
  { name: "sword", beat: BEATS.combat + 2 },
  { name: "stamp", beat: BEATS.phone + 0.25, volume: 0.7 },
  { name: "whoosh", beat: BEATS.montage, volume: 0.5 },
  { name: "whoosh", beat: BEATS.montage + 1, volume: 0.5 },
  { name: "whoosh", beat: BEATS.host - 0.25 },
  { name: "dice", beat: BEATS.walkthrough + 6, volume: 0.6 },
  { name: "whoosh", beat: BEATS.pullback, volume: 0.7 },
  { name: "chime", beat: BEATS.end + 1.5 },
  { name: "stamp", beat: BEATS.end + 5 },
];

export const Demo: React.FC<DemoProps> = (props) => {
  const timing = makeTiming(props.bpm);
  const { beat, totalFrames } = timing;
  const hitBeat = props.hitBeat ?? BEATS.hookHit;
  const b = (from: number, to: number) => ({ from: beat(from), durationInFrames: beat(to) - beat(from) });
  const scene = (from: number, to: number, enter: Enter, node: React.ReactNode, tail = TAIL) => (
    <Sequence from={beat(from)} durationInFrames={beat(to) - beat(from) + tail}>
      <EnterTransition type={enter}>{node}</EnterTransition>
    </Sequence>
  );
  const len = (from: number, to: number) => beat(to) - beat(from);
  const lastBar = beat(BEATS.total - 4);

  return (
    <TimingContext.Provider value={timing}>
      <InputsContext.Provider value={props}>
        <AbsoluteFill style={{ background: "#000" }}>
          {scene(BEATS.hook, BEATS.voice, "cut", <RoomHook hitBeat={hitBeat} />)}
          {scene(
            BEATS.voice,
            BEATS.map,
            "dieWipe",
            <FeatureBeat
              shot="voice-talking"
              caption="Knows every voice at the table"
              duration={len(BEATS.voice, BEATS.map)}
              move="orbit"
              captionBeat={4.25}
              overlay={
                <VoiceHud
                  lines={[
                    { who: 0, text: "I shoulder the cellar door open!" },
                    { who: 1, text: "Light the way: Dancing Lights." },
                  ]}
                />
              }
            />,
          )}
          {scene(
            BEATS.map,
            BEATS.npc,
            "pageTurn",
            <FeatureBeat
              shot="map-fog"
              caption="The map builds itself"
              duration={len(BEATS.map, BEATS.npc)}
              move="push"
              captionBeat={0.5}
              overlay={<FogLift duration={len(BEATS.map, BEATS.npc)} />}
            />,
          )}
          {scene(
            BEATS.npc,
            BEATS.combat,
            "unroll",
            <FeatureBeat shot="npc-closeup" caption="NPCs that talk back" duration={len(BEATS.npc, BEATS.combat)} move="drift" captionBeat={0.5} captionTop={130} alignFrame={-20} />,
          )}
          {scene(
            BEATS.combat,
            BEATS.phone,
            "whip",
            <FeatureBeat
              shot="combat-turn"
              caption="Every rule, tracked"
              duration={len(BEATS.combat, BEATS.phone)}
              move="punch"
              captionBeat={1}
              captionMode="stamp"
              overlay={<CombatOverlay />}
            />,
          )}
          {scene(BEATS.phone, BEATS.montage, "whip", <PhoneBeat duration={len(BEATS.phone, BEATS.montage)} />, 6)}
          {scene(BEATS.montage, BEATS.host, "cut", <Montage shots={[{ id: "hook-dice" }, { id: "map-fog", keyword: /deep/i }, { id: "npc-closeup" }, { id: "walkthrough", keyword: /d20 lands/i }]} step={0.5} />)}
          {scene(BEATS.host, BEATS.walkthrough, "flicker", <HostStart duration={len(BEATS.host, BEATS.walkthrough)} />)}
          {scene(BEATS.walkthrough, BEATS.pullback, "pageTurn", <Walkthrough duration={len(BEATS.walkthrough, BEATS.pullback)} />, 0)}
          {scene(BEATS.pullback, BEATS.end, "cut", <RoomPullback duration={len(BEATS.pullback, BEATS.end)} continueFrom={len(BEATS.walkthrough, BEATS.pullback)} />, 0)}
          {scene(BEATS.end, BEATS.total, "cut", <EndCard continueFrom={len(BEATS.walkthrough, BEATS.end)} />, 0)}

          {/* Walkthrough headline spans the take and the pull-back to the room. */}
          <Sequence {...b(BEATS.walkthrough + 3.5, BEATS.end)}>
            <InkCaption
              text="No screens between friends."
              sub="Just one at the end of the table."
              at={0}
              out={len(BEATS.walkthrough + 3.5, BEATS.end) - 10}
              size={78}
            />
          </Sequence>

          <Atmosphere />
          <Grain />
        </AbsoluteFill>

        {props.audio ? (
          <Audio
            src={staticFile(props.audio.src)}
            startFrom={Math.round(props.audio.startSec * FPS)}
            volume={(f) => interpolate(f, [0, 3, lastBar, totalFrames], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}
          />
        ) : null}
        {/* SFX hook: synthesized by scripts/make-sfx.sh into public/sfx/. */}
        {SFX.filter((s) => props.sfx.includes(s.name)).map((s, i) => (
          <Sequence key={i} from={Math.max(0, beat(s.beat))} durationInFrames={FPS * 2} layout="none">
            <Audio src={staticFile(`sfx/${s.name}.wav`)} volume={(s.volume ?? 1) * 0.55} />
          </Sequence>
        ))}
      </InputsContext.Provider>
    </TimingContext.Provider>
  );
};
