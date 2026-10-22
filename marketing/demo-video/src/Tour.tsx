import React from "react";
import { AbsoluteFill, Audio, Easing, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Camera } from "./components/Camera";
import { shake } from "./components/Effects";
import { VoiceHud } from "./components/Hud";
import { InkCaption } from "./components/InkCaption";
import { Atmosphere, Grain } from "./components/Overlays";
import { Phone } from "./components/Phone";
import { Candle, D20 } from "./components/Props";
import { Room } from "./components/Room";
import { InputsContext, Shot } from "./components/Shot";
import { Enter, EnterTransition } from "./components/Transitions";
import { DemoProps, ShotId } from "./data";
import { EndCard } from "./scenes/EndCard";
import { RoomPullback } from "./scenes/RoomPullback";
import { HostStart, StepTag } from "./scenes/Walkthrough";
import { C, FONT } from "./theme";
import { FPS, TimingContext, makeTiming, useTiming } from "./timing";

/**
 * The ~2 minute narrated tour: the whole of the track (55 bars from its first downbeat), a narrator
 * walking through the features, the DM's own lines in the DM voice, and the NPC / AI-player clips
 * the server played. Everything is placed in beats (TOUR) so cuts stay on the music.
 */
export const TOUR_BARS = 55;
/** The track's first downbeat; bar 18 of the tour (beat 72) is its big hit at 39.3 s. */
export const TOUR_AUDIO_START_SEC = 0.265;

/** Scene boundaries in beats. */
const S = {
  hook: 0,
  host: 12,
  voice: 23,
  sprites: 34,
  fog: 43,
  doors: 55,
  crit: 68, // the nat 20 lands on beat 72, the track's hit
  turns: 80,
  victory: 96,
  loot: 104,
  phone: 112,
  split: 120,
  npc: 132,
  ai: 151,
  roster: 184,
  pullback: 192,
  end: 200,
  total: 220,
} as const;
const HIT = 72;

/** Voice cues: line id, start beat, optional max seconds (cut with a short fade). */
const VOICE: { id: string; beat: number; maxSec?: number; sub?: string }[] = [
  { id: "vo-hook", beat: 1.2 },
  { id: "vo-host", beat: 12.5 },
  { id: "vo-voice", beat: 23.4 },
  { id: "vo-sprites", beat: 34.4 },
  { id: "vo-doors", beat: 43.2 },
  { id: "player-doors", beat: 55.2, sub: "Alice (Brienne)" },
  { id: "dm-doors", beat: 61.6, sub: "DM" },
  { id: "vo-combat", beat: 75.5 },
  { id: "vo-moments", beat: 96.4 },
  { id: "vo-loot", beat: 104.4 },
  { id: "vo-phone", beat: 112.4 },
  { id: "vo-split", beat: 120.4 },
  { id: "vo-npc", beat: 132.4 },
  { id: "clip-ysolde", beat: 138.3 },
  { id: "vo-npc2", beat: 147.6 },
  { id: "vo-ai", beat: 151.1 },
  { id: "dm-pip", beat: 158.1, sub: "DM" },
  { id: "clip-pip", beat: 165.6, maxSec: 6.3 },
  { id: "vo-ai2", beat: 178 },
  { id: "vo-roster", beat: 184.5 },
  { id: "vo-end", beat: 192.6 },
  { id: "vo-cta", beat: 206 },
];

const SFX: { name: string; beat: number; volume?: number }[] = [
  { name: "whoosh", beat: S.host - 0.25, volume: 0.5 },
  { name: "whoosh", beat: S.voice - 0.25, volume: 0.5 },
  { name: "whoosh", beat: S.sprites - 0.25, volume: 0.5 },
  { name: "dice", beat: S.crit + 0.5, volume: 0.7 },
  { name: "impact", beat: HIT },
  { name: "sword", beat: HIT + 1, volume: 0.6 },
  { name: "whoosh", beat: S.turns - 0.25, volume: 0.5 },
  { name: "dice", beat: S.turns + 11, volume: 0.5 },
  { name: "chime", beat: S.victory + 2 },
  { name: "chime", beat: S.loot + 4.5, volume: 0.5 },
  { name: "stamp", beat: S.phone + 0.5, volume: 0.6 },
  { name: "whoosh", beat: S.split + 10, volume: 0.5 },
  { name: "chime", beat: S.npc + 15, volume: 0.5 },
  { name: "whoosh", beat: S.pullback, volume: 0.6 },
  { name: "chime", beat: S.end + 1.5 },
  { name: "stamp", beat: S.end + 5 },
];

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const TAIL = 18;

/** A live shot under a camera move, with a caption. */
const Beat: React.FC<{
  shot: ShotId;
  startSec: number;
  duration: number;
  move?: "push" | "orbit" | "drift" | "punch";
  intensity?: number;
  caption?: string;
  captionBeat?: number;
  captionTop?: number;
  rate?: number;
  /** CSS transform-origin for the camera, to keep the action in frame. */
  focus?: string;
  children?: React.ReactNode;
}> = ({ shot, startSec, duration, move = "push", intensity = 1, caption, captionBeat = 0.5, captionTop, rate, focus, children }) => {
  const { beat } = useTiming();
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Camera move={move} duration={duration} intensity={intensity}>
        <AbsoluteFill style={{ transformOrigin: focus ?? "50% 50%" }}>
          <Shot id={shot} startSec={startSec} playbackRate={rate} />
        </AbsoluteFill>
      </Camera>
      {children}
      {caption ? <InkCaption text={caption} at={beat(captionBeat)} mode="write" top={captionTop} /> : null}
    </AbsoluteFill>
  );
};

/** The phone lying on the table with real footage on its screen. */
const PhoneOnTable: React.FC<{ shot: ShotId; startSec: number; duration: number; caption: string }> = ({ shot, startSec, duration, caption }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { beat } = useTiming();
  const lift = spring({ frame: f, fps, config: { damping: 14, stiffness: 120 } });
  const drift = interpolate(f, [0, duration], [0, -24]);
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at 30% 60%, rgba(255,170,80,0.35), rgba(0,0,0,0) 55%),
            repeating-linear-gradient(100deg, rgba(0,0,0,0.25) 0 3px, transparent 3px 220px),
            linear-gradient(170deg, #4a2f1c, #6e4628 50%, #3a2416)`,
          transform: `scale(1.1) translateX(${drift}px)`,
        }}
      />
      <Candle height={260} seed={7} style={{ position: "absolute", left: 220, top: 520, filter: "blur(4px)" }} />
      <D20 size={180} color="#7a1f1a" face="20" style={{ position: "absolute", left: 1560, top: 760, transform: "rotate(-20deg)", filter: "blur(3px)" }} />
      <div
        style={{
          position: "absolute",
          left: 1180,
          top: 70,
          transform: `perspective(1600px) rotateX(${interpolate(lift, [0, 1], [38, 6])}deg) rotateZ(${interpolate(lift, [0, 1], [-12, -3])}deg) translateY(${(1 - lift) * 300}px)`,
          transformOrigin: "50% 100%",
        }}
      >
        <Phone height={940} screen={<Shot id={shot} startSec={startSec} />} />
      </div>
      <AbsoluteFill style={{ background: `linear-gradient(90deg, rgba(18,13,10,0.75), rgba(18,13,10,0) 55%)` }} />
      <InkCaption text={caption} at={beat(0.5)} mode="stamp" size={72} />
      <div style={{ position: "absolute", inset: 0, boxShadow: `inset 0 0 200px ${C.bg}` }} />
    </AbsoluteFill>
  );
};

/** The host laptop on the table showing a host-page take. */
const Laptop: React.FC<{ shot: ShotId; startSec: number; duration: number; rate?: number; step: [number, string] }> = ({ shot, startSec, duration, rate, step }) => {
  const f = useCurrentFrame();
  const lw = 1160;
  const lh = lw * 0.5625;
  const push = interpolate(f, [0, duration], [1, 1.1]);
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: C.bg }}>
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 30%, rgba(255,170,80,0.25), rgba(0,0,0,0) 60%), linear-gradient(180deg, #22170f, #4a2f1c 55%, #6e4628)` }} />
      <Candle height={200} seed={11} style={{ position: "absolute", left: 140, top: 560, filter: "blur(3px)" }} />
      <Candle height={160} seed={12} style={{ position: "absolute", left: 1700, top: 600, filter: "blur(4px)" }} />
      <AbsoluteFill style={{ transform: `scale(${push})`, transformOrigin: "50% 45%" }}>
        <div style={{ position: "absolute", left: (1920 - lw) / 2, top: 190 }}>
          <div style={{ width: lw + 36, height: lh + 36, marginLeft: -18, borderRadius: 22, background: "linear-gradient(180deg,#2a2a2d,#141416)", padding: 18, boxSizing: "border-box", boxShadow: "0 30px 70px rgba(0,0,0,0.7)" }}>
            <div style={{ position: "relative", width: lw, height: lh, overflow: "hidden", borderRadius: 6, background: "#000" }}>
              <div style={{ width: 1920, height: 1080, transform: `scale(${lw / 1920})`, transformOrigin: "0 0" }}>
                <Shot id={shot} startSec={startSec} playbackRate={rate} />
              </div>
            </div>
          </div>
          <div style={{ width: lw + 260, height: 34, marginLeft: -130, marginTop: -2, borderRadius: "0 0 30px 30px", background: "linear-gradient(180deg,#3a3a3e,#151517)" }} />
        </div>
      </AbsoluteFill>
      <StepTag n={step[0]} text={step[1]} at={6} />
    </AbsoluteFill>
  );
};

/** Who is talking, bottom-centre: the DM or a player, with the line. */
const Subtitle: React.FC<{ who: string; text: string; duration: number }> = ({ who, text, duration }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, 8, duration - 10, duration], [0, 1, 1, 0], clamp);
  const dm = who === "DM";
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 70, opacity: o }}>
      <div style={{ maxWidth: 1300, padding: "16px 30px", borderRadius: 14, background: "rgba(18,13,10,0.86)", border: `2px solid ${dm ? C.gold : C.accent}`, textAlign: "center" }}>
        <div style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 24, letterSpacing: "0.12em", color: dm ? C.gold : C.accent }}>{dm ? "THE DM" : who.toUpperCase()}</div>
        <div style={{ fontFamily: FONT.body, fontSize: 34, color: C.text, marginTop: 6, fontStyle: dm ? "italic" : "normal" }}>{text}</div>
      </div>
    </AbsoluteFill>
  );
};

/** Callout for the NPC attitude badge flipping from Indifferent to Friendly. */
const AttitudeFlip: React.FC<{ at: number }> = ({ at }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (f < at) return null;
  const s = spring({ frame: f - at, fps, config: { damping: 12, stiffness: 180 } });
  const flip = interpolate(f, [at + 20, at + 34], [0, 1], clamp);
  const pill = (label: string, color: string, bg: string) => (
    <div style={{ padding: "10px 22px", borderRadius: 30, background: bg, color, fontFamily: FONT.body, fontWeight: 600, fontSize: 32, border: `2px solid ${color}` }}>{label}</div>
  );
  return (
    <div style={{ position: "absolute", right: 420, top: 110, display: "flex", alignItems: "center", gap: 18, opacity: s, transform: `translateY(${(1 - s) * -40}px)` }}>
      <div style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 30, color: C.text, textShadow: "0 3px 10px #000" }}>Harbormaster Ysolde</div>
      {pill("😐 Indifferent +1", C.muted, "rgba(18,13,10,0.9)")}
      <div style={{ fontSize: 40, color: C.gold, opacity: flip }}>→</div>
      <div style={{ opacity: flip, transform: `scale(${0.6 + 0.4 * flip})` }}>{pill("🙂 Friendly +3", C.ok, "rgba(20,40,24,0.92)")}</div>
    </div>
  );
};

/** Opening: the candlelit table, pushing into the TV as the miniatures turn on the board. */
const TourHook: React.FC<{ duration: number }> = ({ duration }) => {
  const f = useCurrentFrame();
  const { beat } = useTiming();
  const zoom = Easing.inOut(Easing.cubic)(interpolate(f, [beat(1), duration - beat(1)], [0, 1], clamp));
  return (
    <AbsoluteFill>
      <Room zoom={zoom} screen={<Shot id="sprites" startSec={5} />} />
      <InkCaption text="Game night, upgraded." at={beat(7)} mode="write" size={88} />
    </AbsoluteFill>
  );
};

export const Tour: React.FC<DemoProps> = (props) => {
  const timing = makeTiming(props.bpm, TOUR_BARS);
  const { beat, totalFrames } = timing;
  const len = (a: number, b: number) => beat(b) - beat(a);
  const scene = (from: number, to: number, enter: Enter, node: React.ReactNode, tail = TAIL) => (
    <Sequence from={beat(from)} durationInFrames={len(from, to) + tail}>
      <EnterTransition type={enter}>{node}</EnterTransition>
    </Sequence>
  );

  // Voice cues resolved to frames; the music ducks under each.
  const cues = VOICE.flatMap((c) => {
    const v = props.voice[c.id];
    if (!v) return [];
    const frames = Math.round(Math.min(v.durationSec, c.maxSec ?? Infinity) * FPS);
    return [{ ...c, v, from: beat(c.beat), frames }];
  });
  const duck = (f: number) => {
    let d = 0;
    for (const c of cues) d = Math.max(d, interpolate(f, [c.from - 10, c.from, c.from + c.frames, c.from + c.frames + 14], [0, 1, 1, 0], clamp));
    return d;
  };
  const musicEnd = totalFrames;

  return (
    <TimingContext.Provider value={timing}>
      <InputsContext.Provider value={props}>
        <AbsoluteFill style={{ background: "#000" }}>
          {scene(S.hook, S.host, "cut", <TourHook duration={len(S.hook, S.host)} />)}
          {scene(S.host, S.voice, "flicker", <HostStart duration={len(S.host, S.voice)} />)}
          {scene(
            S.voice,
            S.sprites,
            "dieWipe",
            <Beat shot="voice-talking" startSec={0.6} duration={len(S.voice, S.sprites)} move="orbit" caption="Knows every voice at the table" captionBeat={4}>
              <VoiceHud lines={[{ who: 0, text: "I shoulder the cellar door open!" }, { who: 1, text: "Light the way: Dancing Lights." }]} />
            </Beat>,
          )}
          {scene(S.sprites, S.fog, "pageTurn", <Beat shot="sprites" startSec={5.5} duration={len(S.sprites, S.fog)} move="push" intensity={0.6} caption="Hand-painted miniatures" captionBeat={2} />)}
          {scene(S.fog, S.doors, "unroll", <Beat shot="map-fog" startSec={0.8} duration={len(S.fog, S.doors)} move="drift" caption="Walls, doors and line of sight" captionBeat={1} />)}
          {scene(S.doors, S.crit, "cut", <Beat shot="doors" startSec={0.2} duration={len(S.doors, S.crit)} move="push" intensity={1.4} focus="40% 40%" />)}
          {scene(S.crit, S.turns, "whip", <CritBeat hit={beat(HIT - S.crit)} />)}
          {scene(S.turns, S.victory, "whip", <Beat shot="combat2" startSec={0.4} duration={len(S.turns, S.victory)} move="orbit" intensity={0.6} caption="Every rule, tracked" captionBeat={11} />)}
          {scene(S.victory, S.loot, "cut", <Beat shot="victory" startSec={1.0} duration={len(S.victory, S.loot)} move="punch" caption="Every moment, celebrated" captionBeat={4.5} />)}
          {scene(S.loot, S.phone, "pageTurn", <Beat shot="loot" startSec={1.4} duration={len(S.loot, S.phone)} move="push" intensity={1.6} focus="35% 45%" caption="Loot you can pick up" captionBeat={1} />)}
          {scene(S.phone, S.split, "whip", <PhoneOnTable shot="phone-loot" startSec={0.5} duration={len(S.phone, S.split)} caption="Your sheet, in your pocket" />)}
          {scene(S.split, S.npc, "unroll", <Beat shot="party-split" startSec={11.6} duration={len(S.split, S.npc)} move="drift" intensity={0.6} caption="Split the party" captionBeat={1} />)}
          {scene(
            S.npc,
            S.ai,
            "pageTurn",
            <Beat shot="npc-attitude" startSec={1.4} duration={len(S.npc, S.ai)} move="push" intensity={0.8} focus="30% 70%" caption="NPCs remember" captionBeat={1} captionTop={130}>
              <AttitudeFlip at={beat(14.2)} />
            </Beat>,
          )}
          {scene(S.ai, S.roster, "dieWipe", <Beat shot="ai-player" startSec={0} duration={len(S.ai, S.roster)} move="push" intensity={0.7} focus="30% 80%" caption="AI companions" captionBeat={1} captionTop={130} />)}
          {scene(S.roster, S.pullback, "flicker", <Laptop shot="host-roster" startSec={1.2} rate={1.7} duration={len(S.roster, S.pullback)} step={[2, "Heroes that travel"]} />)}
          {scene(S.pullback, S.end, "cut", <RoomPullback duration={len(S.pullback, S.end)} continueFrom={0} screen={<Shot id="sprites" startSec={9} />} />, 0)}
          {scene(S.end, S.total, "cut", <EndCard continueFrom={0} screen={<Shot id="sprites" startSec={9 + len(S.pullback, S.end) / FPS} />} />, 0)}

          {cues
            .filter((c) => c.sub)
            .map((c) => (
              <Sequence key={c.id} from={c.from} durationInFrames={c.frames + 12}>
                {c.id === "player-doors" ? (
                  <VoiceHud lines={[{ who: 0, text: c.v.text }]} />
                ) : (
                  <Subtitle who={c.sub!} text={c.v.text} duration={c.frames + 12} />
                )}
              </Sequence>
            ))}

          <Atmosphere />
          <Grain />
        </AbsoluteFill>

        {props.audio ? (
          <Audio
            src={staticFile(props.audio.src)}
            startFrom={Math.round(TOUR_AUDIO_START_SEC * FPS)}
            volume={(f) => interpolate(f, [0, 6, musicEnd - 30, musicEnd], [0, 1, 1, 0], clamp) * (0.72 - 0.54 * duck(f))}
          />
        ) : null}
        {cues.map((c) => (
          <Sequence key={c.id} from={c.from} durationInFrames={c.frames} layout="none">
            <Audio src={staticFile(c.v.file)} volume={(f) => (c.maxSec ? interpolate(f, [c.frames - 12, c.frames], [1, 0], clamp) : 1)} />
          </Sequence>
        ))}
        {SFX.filter((s) => props.sfx.includes(s.name)).map((s, i) => (
          <Sequence key={`sfx${i}`} from={Math.max(0, beat(s.beat))} durationInFrames={FPS * 2} layout="none">
            <Audio src={staticFile(`sfx/${s.name}.wav`)} volume={(s.volume ?? 1) * 0.45} />
          </Sequence>
        ))}
      </InputsContext.Provider>
    </TimingContext.Provider>
  );
};

/** The natural 20: the dice tumble through the quiet bar and the crit lands on the hit. */
const CritBeat: React.FC<{ hit: number }> = ({ hit }) => {
  const f = useCurrentFrame();
  // crit2: the CRITICAL! burst appears 5.0 s into the clip.
  const start = 5.0 - hit / FPS;
  const punch = interpolate(f, [0, hit], [1.0, 1.18], clamp);
  return (
    <AbsoluteFill style={{ transform: shake(f, hit, 16), background: "#000" }}>
      <AbsoluteFill style={{ transform: `scale(${punch})`, transformOrigin: "35% 60%" }}>
        <Shot id="crit2" startSec={start} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
