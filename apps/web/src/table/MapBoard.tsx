import { useEffect, useMemo, useRef, useState } from "react";
import { monsterColor } from "../lib/tokenColor";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Billboard, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { activeFog, effectiveFeatures, effectiveWalls, lightRadiusOf, revealedSet, visibilityOf, type BoardEffect, type GameState, type Location, type Token, type WallSeg } from "@dm/shared";
import { FogLayer } from "./FogLayer";
import { DOOR_HEIGHT, DOOR_THICKNESS, doorTransform, doorVisible } from "./doors";
import { effectForTable, monsterShownOnTable } from "./visibility";
import { BoardEffects, Particles, type PlacedEffect } from "./Effects";
import { planEffect, reactionPose, travelSuppressed, type EffectPlan, type Reaction } from "./effectPlan";
import { tokenFallen, tokenMomentPose, type MomentVariant } from "./momentPlan";
import { isDeadChar } from "../player/sheet";
import { auraPlan, lootMarkers, type Aura, type LootMarker } from "./mapObjects";

/** A token animation from a moment (death, monster_death, revived), stamped with the local play time. */
export interface TokenMoment {
  id: string;
  entityId: string;
  variant: MomentVariant;
  at: number;
}

/** An effect event as received by the table, stamped with the local receive time. */
export interface ReceivedEffect {
  effect: BoardEffect;
  receivedAt: number;
}

const texCache = new Map<string, THREE.Texture>();

function useTexture(url?: string): THREE.Texture | null {
  const [tex, setTex] = useState<THREE.Texture | null>(url ? texCache.get(url) ?? null : null);
  useEffect(() => {
    if (!url) return setTex(null);
    const cached = texCache.get(url);
    if (cached) return setTex(cached);
    let alive = true;
    new THREE.TextureLoader().load(
      url,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        texCache.set(url, t);
        if (alive) setTex(t);
      },
      undefined,
      () => alive && setTex(null),
    );
    return () => {
      alive = false;
    };
  }, [url]);
  return tex;
}

function initialsTexture(name: string, color: string): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.beginPath();
  ctx.arc(128, 128, 118, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = "#1b1410";
  ctx.stroke();
  ctx.fillStyle = "#1b1410";
  ctx.font = "800 110px Cinzel, Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  ctx.fillText(initials, 128, 136);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface TokenView {
  token: Token;
  name: string;
  color: string;
  spriteUrl?: string;
  hpFrac: number;
  down: boolean;
  isTurn: boolean;
  isSpeaker: boolean;
  monster: boolean;
  /** Latest effect that landed on this token (drives the shake/dodge + color flash). `at` may be in the future (after a travel). */
  hit?: { at: number; color: string; kind: Reaction };
  /** Lying down from state (a Dead PC, a defeated foe): the pose a reload shows, and where a death moment ends. */
  fallen: boolean;
  /** A moment playing on this token (tip over + mist, or rise + golden column). */
  moment?: TokenMoment;
}

const GREY = new THREE.Color("#5c5c5c");
const GOLD = new THREE.Color("#ffd75e");
const WHITE = new THREE.Color("#ffffff");

/** Dark mist rising off a fallen token (lighter for a monster). */
function DeathMist({ light }: { light: boolean }) {
  const n = light ? 18 : 40;
  return (
    <Particles
      spec={{
        count: n,
        life: light ? 1.6 : 2.4,
        size: light ? 0.35 : 0.5,
        drag: 0.6,
        additive: false,
        colors: ["#120a0a", "#2a1414", "#1c1c22"],
        init: (_, p, v) => {
          const a = Math.random() * Math.PI * 2;
          p.set(Math.cos(a) * 0.3, 0.15, Math.sin(a) * 0.3);
          v.set(Math.cos(a) * 0.2, 0.6 + Math.random() * 0.8, Math.sin(a) * 0.2);
        },
      }}
    />
  );
}

/** Golden sparks rising in the revival column. */
function ReviveSparks() {
  return (
    <Particles
      spec={{
        count: 36,
        life: 2.2,
        size: 0.18,
        drag: 0.2,
        colors: ["#fff3b0", "#ffd75e", "#ffffff"],
        init: (_, p, v) => {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * 0.35;
          p.set(Math.cos(a) * r, 0.1, Math.sin(a) * r);
          v.set(0, 1.2 + Math.random() * 1.6, 0);
        },
      }}
    />
  );
}

function cellToWorld(x: number, y: number, loc: { gridW: number; gridH: number }) {
  return new THREE.Vector3(x - loc.gridW / 2 + 0.5, 0, y - loc.gridH / 2 + 0.5);
}

function TokenMesh({ view, loc }: { view: TokenView; loc: { gridW: number; gridH: number } }) {
  const group = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const body = useRef<THREE.Group>(null);
  const standeeMat = useRef<THREE.MeshStandardMaterial>(null);
  const tiltGroup = useRef<THREE.Group>(null);
  const column = useRef<THREE.Mesh>(null);
  const columnMat = useRef<THREE.MeshBasicMaterial>(null);
  const beamMat = useRef<THREE.MeshBasicMaterial>(null);
  const turnLight = useRef<THREE.PointLight>(null);
  const tilt = useRef(view.fallen ? Math.PI / 2 : 0);
  const grey = useRef(view.fallen ? 1 : 0);
  const flash = useMemo(() => new THREE.Color(view.hit?.color ?? "#ffffff"), [view.hit?.color]);
  const sprite = useTexture(view.spriteUrl);
  const fallback = useMemo(() => initialsTexture(view.name, view.color), [view.name, view.color]);
  const target = cellToWorld(view.token.x, view.token.y, loc);
  const size = view.token.size;

  useEffect(() => {
    if (group.current && group.current.position.lengthSq() === 0) group.current.position.copy(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((state, dt) => {
    const g = group.current;
    if (!g) return;
    const step = Math.min(dt, 0.1);
    const d = g.position.distanceTo(target);
    g.position.lerp(target, Math.min(1, step * 6));
    g.position.y = d > 0.05 ? Math.sin(Math.min(d, 1) * Math.PI) * 0.35 : 0; // hop while moving
    const t = state.clock.elapsedTime;
    if (ring.current) {
      const pulse = view.isTurn ? 1 + Math.sin(t * 4) * 0.14 : view.isSpeaker ? 1 + Math.sin(t * 5) * 0.08 : 1;
      ring.current.scale.setScalar(pulse);
    }
    // Turn spotlight: a soft gold beam + light that breathes with the ring.
    if (beamMat.current) beamMat.current.opacity = view.isTurn ? 0.16 + Math.sin(t * 4) * 0.05 : 0;
    if (turnLight.current) turnLight.current.intensity = view.isTurn ? 6 + Math.sin(t * 4) * 1.5 : 0;
    // Moment pose (momentPlan.tokenMomentPose) while one plays, else ease to the pose the state implies.
    const mp = view.moment ? tokenMomentPose(view.moment.variant, performance.now() - view.moment.at) : undefined;
    const restTilt = view.fallen ? Math.PI / 2 : 0;
    const restGrey = view.fallen ? 1 : 0;
    const k = Math.min(1, step * 4);
    tilt.current = mp ? (view.moment!.variant === "revived" ? mp.tilt : Math.max(mp.tilt, tilt.current)) : tilt.current + (restTilt - tilt.current) * k;
    grey.current = mp ? (view.moment!.variant === "revived" ? 0 : Math.max(mp.desaturate * (view.moment!.variant === "monster_death" ? 0.7 : 1), grey.current)) : grey.current + (restGrey - grey.current) * k;
    if (tiltGroup.current) tiltGroup.current.rotation.z = -tilt.current;
    const col = mp?.column ?? 0;
    if (columnMat.current) columnMat.current.opacity = col * 0.55;
    if (column.current) {
      column.current.visible = col > 0.01;
      column.current.scale.set(0.6 + col * 0.4, 1, 0.6 + col * 0.4);
    }
    // Hit/miss/crit/heal reaction (effectPlan.reactionPose); rest pose before `at` (the travel is still flying).
    const pose = reactionPose(view.hit?.kind, view.hit ? performance.now() - view.hit.at : Infinity);
    if (body.current) body.current.position.set(pose.x, pose.y, 0);
    if (standeeMat.current) {
      standeeMat.current.emissive.copy(col > 0.01 ? GOLD : flash);
      standeeMat.current.emissiveIntensity = Math.max(pose.flash, col * 0.8);
      standeeMat.current.color.copy(WHITE).lerp(GREY, grey.current);
    }
  });

  const standee = sprite ?? fallback;
  const h = 1.25 * size;
  return (
    <group ref={group}>
      <mesh position={[0, 0.04, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.44 * size, 0.47 * size, 0.08, 40]} />
        <meshStandardMaterial color={view.down ? "#3a3a3a" : view.monster ? "#5a1f1a" : "#2a2016"} roughness={0.6} />
      </mesh>
      <mesh ref={ring} position={[0, 0.09, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.4 * size, 0.47 * size, 48]} />
        <meshBasicMaterial color={view.isSpeaker ? "#7fe0ff" : view.isTurn ? "#ffd75e" : view.color} toneMapped={false} />
      </mesh>
      {view.isTurn && (
        <>
          {/* light beam from above: open cone, additive, no depth write */}
          <mesh position={[0, 2.6, 0]}>
            <cylinderGeometry args={[0.18 * size, 0.5 * size, 5.2, 32, 1, true]} />
            <meshBasicMaterial ref={beamMat} color="#ffe39a" transparent opacity={0.16} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
          </mesh>
          <pointLight ref={turnLight} position={[0, 2.2, 0]} color="#ffd98a" intensity={6} distance={4} decay={1.4} />
        </>
      )}
      <mesh ref={column} position={[0, 2, 0]} visible={false}>
        <cylinderGeometry args={[0.45 * size, 0.45 * size, 4, 32, 1, true]} />
        <meshBasicMaterial ref={columnMat} color="#ffe27a" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      {view.moment && (view.moment.variant === "death" || view.moment.variant === "monster_death") && <DeathMist key={view.moment.id} light={view.moment.variant === "monster_death"} />}
      {view.moment?.variant === "revived" && <ReviveSparks key={view.moment.id} />}
      <group ref={body}>
      <Billboard position={[0, h / 2 + 0.08, 0]}>
        {/* Tips over sideways around its foot (death), stands back up (revived). */}
        <group ref={tiltGroup} position={[0, -h / 2, 0]}>
          <mesh castShadow position={[0, h / 2, 0]}>
            <planeGeometry args={[h * 0.9, h]} />
            <meshStandardMaterial ref={standeeMat} map={standee} emissiveMap={standee} transparent alphaTest={0.2} side={THREE.DoubleSide} opacity={view.down ? 0.45 : 1} />
          </mesh>
        </group>
        <mesh position={[0, h / 2 + 0.12, 0.01]}>
          <planeGeometry args={[0.9 * size, 0.09]} />
          <meshBasicMaterial color="#1a1a1a" />
        </mesh>
        <mesh position={[(-0.9 * size * (1 - view.hpFrac)) / 2, h / 2 + 0.12, 0.02]}>
          <planeGeometry args={[Math.max(0.001, 0.9 * size * view.hpFrac), 0.07]} />
          <meshBasicMaterial color={view.hpFrac > 0.5 ? "#4cc46a" : view.hpFrac > 0.25 ? "#e0b83c" : "#e0463c"} toneMapped={false} />
        </mesh>
      </Billboard>
      </group>
    </group>
  );
}

/** Flickering warm torch light carried by a character when the map is dark (fog of war on). */
function TorchLight({ x, y, radius, loc }: { x: number; y: number; radius: number; loc: { gridW: number; gridH: number } }) {
  const light = useRef<THREE.PointLight>(null);
  const seed = useMemo(() => Math.random() * 100, []);
  const target = cellToWorld(x, y, loc);
  useFrame((state, dt) => {
    const l = light.current;
    if (!l) return;
    l.position.lerp(new THREE.Vector3(target.x, 1.6, target.z), Math.min(1, dt * 6));
    const t = state.clock.elapsedTime + seed;
    l.intensity = 14 * (0.9 + Math.sin(t * 9.1) * 0.05 + Math.sin(t * 23.7) * 0.04 + Math.sin(t * 3.3) * 0.04);
  });
  return <pointLight ref={light} position={[target.x, 1.6, target.z]} color="#ffb870" intensity={14} distance={radius + 2} decay={1.2} />;
}

function Grid({ w, h }: { w: number; h: number }) {
  const geo = useMemo(() => {
    const pts: number[] = [];
    for (let x = 0; x <= w; x++) pts.push(x - w / 2, 0.012, -h / 2, x - w / 2, 0.012, h / 2);
    for (let y = 0; y <= h; y++) pts.push(-w / 2, 0.012, y - h / 2, w / 2, 0.012, y - h / 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [w, h]);
  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial color="#000000" transparent opacity={0.28} />
    </lineSegments>
  );
}

function FitCamera({ w, h }: { w: number; h: number }) {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / size.height;
    const view = 2 * Math.tan(THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov / 2));
    const dist = Math.max((h + 2) / view, (w + 2) / (view * aspect)) * 1.05;
    camera.position.set(0, dist * 0.94, dist * 0.34);
    camera.lookAt(0, 0, 0);
  }, [camera, w, h, size.width, size.height]);
  return null;
}

function Board({ location }: { location: Location }) {
  const tex = useTexture(location.mapUrl);
  const { gridW: w, gridH: h } = location;
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[w, h]} />
        {/* Keyed so a loaded map mounts a fresh material: adding `map` to the compiled fallback
            material would not recompile its shader, leaving a plain white board. */}
        {tex ? <meshStandardMaterial key={tex.uuid} map={tex} roughness={0.95} /> : <meshStandardMaterial key="fallback" color="#3b3024" roughness={1} />}
      </mesh>
      {/* table edge */}
      <mesh position={[0, -0.16, 0]} receiveShadow>
        <boxGeometry args={[w + 1.2, 0.3, h + 1.2]} />
        <meshStandardMaterial color="#2b1a10" roughness={0.7} />
      </mesh>
      <Grid w={w} h={h} />
    </group>
  );
}

/**
 * Doors of the current location as thin wooden slabs on their grid edges. Plain walls and windows
 * are painted on the map, so they draw nothing here. An open door stands swung a quarter turn and
 * a little translucent. Doors with no explored cell beside them stay hidden under the fog.
 */
function Doors({ walls, loc, revealed }: { walls: WallSeg[]; loc: { gridW: number; gridH: number }; revealed: ReadonlySet<string> | null }) {
  return (
    <group>
      {walls
        .filter((w) => w.kind === "door" && doorVisible(w, revealed))
        .map((w) => {
          const t = doorTransform(w, loc);
          return (
            <mesh key={w.id} position={t.position} rotation-y={t.rotationY} castShadow receiveShadow>
              <boxGeometry args={[Math.max(0.05, t.length - 0.04), DOOR_HEIGHT, DOOR_THICKNESS]} />
              <meshStandardMaterial color={w.open ? "#8a5a2b" : "#6b4320"} roughness={0.8} transparent={w.open} opacity={w.open ? 0.55 : 1} />
            </mesh>
          );
        })}
    </group>
  );
}

/** A few golden glints circling a loot drop, twinkling forever (unlike the one-shot Particles burst). */
function Sparkles() {
  const pts = useRef<THREE.Points>(null);
  const mat = useRef<THREE.PointsMaterial>(null);
  const geometry = useMemo(() => {
    const pos = new Float32Array(8 * 3);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      pos.set([Math.cos(a) * 0.45, 0.25 + (i % 3) * 0.25, Math.sin(a) * 0.45], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    return g;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (pts.current) pts.current.rotation.y = t * 0.8;
    if (mat.current) mat.current.opacity = 0.45 + Math.sin(t * 5) * 0.35;
  });
  return (
    <points ref={pts} geometry={geometry}>
      <pointsMaterial ref={mat} color="#ffe27a" size={0.14} transparent opacity={0.6} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
    </points>
  );
}

/**
 * A loot drop: the generated loot-sack sprite as a billboard (a small chest mesh until it loads),
 * bobbing gently with a few sparkles. Only shown loot reaches here (mapObjects.lootMarkers).
 */
function LootMesh({ marker, loc }: { marker: LootMarker; loc: { gridW: number; gridH: number } }) {
  const body = useRef<THREE.Group>(null);
  const seed = useMemo(() => Math.random() * 10, []);
  const tex = useTexture(marker.iconUrl);
  const at = cellToWorld(marker.x, marker.y, loc);
  useFrame((state) => {
    if (body.current) body.current.position.y = 0.08 + Math.sin(state.clock.elapsedTime * 2 + seed) * 0.06;
  });
  return (
    <group position={at}>
      <group ref={body}>
        {tex ? (
          <Billboard position={[0, 0.55, 0]}>
            <mesh renderOrder={2}>
              <planeGeometry args={[1, 1]} />
              <meshBasicMaterial map={tex} transparent alphaTest={0.15} side={THREE.DoubleSide} toneMapped={false} />
            </mesh>
          </Billboard>
        ) : (
          <group position={[0, 0.15, 0]}>
            <mesh castShadow>
              <boxGeometry args={[0.5, 0.28, 0.34]} />
              <meshStandardMaterial color="#7a4a22" roughness={0.7} />
            </mesh>
            <mesh position={[0, 0.17, 0]} castShadow>
              <boxGeometry args={[0.52, 0.08, 0.36]} />
              <meshStandardMaterial color="#c9a227" metalness={0.6} roughness={0.35} />
            </mesh>
          </group>
        )}
      </group>
      {/* Gold ground glow: reads as "loot here" even on top of a corpse token. */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.04, 0]} renderOrder={1}>
        <circleGeometry args={[0.48, 32]} />
        <meshBasicMaterial color="#ffd75e" transparent opacity={0.35} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <Sparkles />
    </group>
  );
}

/**
 * A pulsing soft glow on an interactable's cells. Transparent, additive and without depth write so
 * the fog shroud never covers it (.memories/bugs/fog-hides-effects.md); faint once used.
 */
function AuraMesh({ aura, loc }: { aura: Aura; loc: { gridW: number; gridH: number } }) {
  const ring = useRef<THREE.Mesh>(null);
  const ringMat = useRef<THREE.MeshBasicMaterial>(null);
  const fillMat = useRef<THREE.MeshBasicMaterial>(null);
  const glowMat = useRef<THREE.MeshBasicMaterial>(null);
  const seed = useMemo(() => Math.random() * 10, []);
  const a = cellToWorld(aura.x, aura.y, loc);
  const cx = a.x + (aura.w - 1) / 2;
  const cz = a.z + (aura.h - 1) / 2;
  const r = Math.max(aura.w, aura.h) * 0.5;
  const base = aura.dim ? 0.18 : 0.9;
  useFrame((state) => {
    const t = state.clock.elapsedTime + seed;
    const pulse = aura.dim ? 1 : 1 + Math.sin(t * 2.4) * 0.08;
    if (ring.current) ring.current.scale.setScalar(pulse);
    if (ringMat.current) ringMat.current.opacity = base * (aura.dim ? 1 : 0.75 + Math.sin(t * 2.4) * 0.25);
    if (fillMat.current) fillMat.current.opacity = base * (aura.dim ? 0.3 : 0.3 + Math.sin(t * 2.4) * 0.12);
    if (glowMat.current) glowMat.current.opacity = aura.dim ? 0 : 0.22 + Math.sin(t * 2.4) * 0.1;
  });
  return (
    <group position={[cx, 0.05, cz]}>
      <mesh ref={ring} rotation-x={-Math.PI / 2} renderOrder={1}>
        <ringGeometry args={[r * 0.72, r * 1.02, 48]} />
        <meshBasicMaterial ref={ringMat} color="#8fe3ff" transparent opacity={base} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} renderOrder={1}>
        <circleGeometry args={[r * 0.8, 40]} />
        <meshBasicMaterial ref={fillMat} color="#8fe3ff" transparent opacity={base * 0.3} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      {/* Faint shimmer rising from the cells, so it stands out from the painted map. */}
      <mesh position={[0, 0.35, 0]} renderOrder={1}>
        <cylinderGeometry args={[r * 0.8, r * 0.9, 0.7, 32, 1, true]} />
        <meshBasicMaterial ref={glowMat} color="#8fe3ff" transparent opacity={0} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

export function MapBoard({
  state,
  location,
  speakerPlayerId,
  effects = [],
  tokenMoments = [],
  standing = [],
}: {
  state: GameState;
  location?: Location;
  speakerPlayerId?: string;
  effects?: ReceivedEffect[];
  tokenMoments?: TokenMoment[];
  /** Tokens whose death moment is still held behind the dice: they stay up until it plays (momentPlan.heldStanding). */
  standing?: string[];
}) {
  const loc: Location = location ?? { id: "none", name: "", description: "", mapPrompt: "", features: [], walls: [], fog: false, gridW: 20, gridH: 12 };
  const current = state.combat.active ? state.combat.order[state.combat.turnIndex]?.entityId : undefined;
  const speakerCharacter = state.players.find((p) => p.id === speakerPlayerId)?.characterId;
  const fog = activeFog(state);
  const fogEntry = state.locationId ? state.fog?.[state.locationId] : undefined;
  const revealed = useMemo(() => (fog ? revealedSet(fog) : null), [fog]);
  const canSee = visibilityOf(state);
  const showMonster = monsterShownOnTable(state);
  // Plans are decided once per effect (when first placed): the dedupe must not flip when an
  // earlier effect expires, or a travel would start late.
  const plans = useRef(new Map<string, EffectPlan>());
  const suppressed = travelSuppressed(effects);
  const tokenPos = (id?: string) => {
    const t = id ? state.tokens.find((x) => x.entityId === id) : undefined;
    return t ? { x: t.x, y: t.y } : undefined;
  };
  const placedWithTime = effects.flatMap(({ effect: raw, receivedAt }): (PlacedEffect & { receivedAt: number; cell: { x: number; y: number } })[] => {
    const effect = effectForTable(state, raw);
    if (!effect) return [];
    const cell = tokenPos(effect.targetId) ?? (effect.x !== undefined && effect.y !== undefined ? { x: effect.x, y: effect.y } : undefined);
    if (!cell || !canSee(cell.x, cell.y)) return [];
    const src = tokenPos(effect.sourceId);
    let plan = plans.current.get(effect.id);
    if (!plan) {
      const distance = src ? Math.hypot(src.x - cell.x, src.y - cell.y) : undefined;
      // A repeat waits for the earlier travel to land (its plan is cached: it was placed first).
      const by = suppressed.get(effect.id);
      const earlier = by ? plans.current.get(by.byId) : undefined;
      const waitMs = by && earlier ? by.receivedAt + earlier.impactAtMs - receivedAt : undefined;
      plan = planEffect(effect, { distance, suppressed: !!by, waitMs });
      plans.current.set(effect.id, plan);
    }
    return [{ effect, at: cellToWorld(cell.x, cell.y, loc), from: src ? cellToWorld(src.x, src.y, loc) : undefined, plan, receivedAt, cell }];
  });
  const live = new Set(effects.map((e) => e.effect.id));
  for (const id of plans.current.keys()) if (!live.has(id)) plans.current.delete(id);
  const placed: PlacedEffect[] = placedWithTime.map(({ effect, at, from, plan }) => ({ effect, at, from, plan }));
  // Token reactions at the moment of impact: the target, or every token inside an area's ring.
  const lastHit = new Map<string, TokenView["hit"]>();
  for (const { effect, plan, receivedAt, cell } of [...placedWithTime].sort((a, b) => a.receivedAt + a.plan.impactAtMs - (b.receivedAt + b.plan.impactAtMs))) {
    const at = receivedAt + plan.impactAtMs;
    if (effect.kind === "area") {
      const r = plan.areaRadius ?? 0;
      for (const t of state.tokens) if (Math.hypot(t.x - cell.x, t.y - cell.y) <= r + 0.5) lastHit.set(t.entityId, { at, color: plan.color, kind: "hit" });
    } else if (effect.targetId && plan.reaction) lastHit.set(effect.targetId, { at, color: plan.color, kind: plan.reaction });
  }
  const views: TokenView[] = state.tokens.flatMap((t): TokenView[] => {
    const hit = lastHit.get(t.entityId);
    const moment = tokenMoments.find((x) => x.entityId === t.entityId);
    const c = state.characters.find((x) => x.id === t.entityId);
    if (c)
      return [{ token: t, name: c.name, color: c.color, spriteUrl: c.spriteUrl, hpFrac: c.maxHp ? c.hp / c.maxHp : 0, down: c.hp <= 0, isTurn: current === c.id, isSpeaker: speakerCharacter === c.id, monster: false, hit, fallen: tokenFallen(isDeadChar(c), c.id, standing), moment }];
    const m = state.monsters.find((x) => x.id === t.entityId);
    // Hidden (ambush) monsters and monsters standing in unexplored fog stay off the table.
    if (m && showMonster(m.id))
      // Allies (friendly NPCs) get a green ring and a neutral base instead of the hostile red; neutral creatures amber.
      return [{ token: t, name: m.name, color: monsterColor(m), spriteUrl: m.spriteUrl, hpFrac: m.maxHp ? m.hp / m.maxHp : 0, down: m.hp <= 0, isTurn: current === m.id, isSpeaker: false, monster: !m.ally && !m.neutral, hit, fallen: tokenFallen(m.hp <= 0 && !m.ally, m.id, standing), moment }];
    return [];
  });
  const torches = fog
    ? state.characters.flatMap((c) => {
        const t = state.tokens.find((x) => x.entityId === c.id);
        return t ? [{ id: c.id, x: t.x, y: t.y, radius: lightRadiusOf(c) }] : [];
      })
    : [];
  const dim = fog ? 0.6 : 1;
  const walls = effectiveWalls(state, loc);
  const auras = auraPlan(state, effectiveFeatures(state, loc));
  const loot = lootMarkers(state);

  return (
    <Canvas shadows camera={{ fov: 40, position: [0, 20, 12] }} dpr={[1, 2]}>
      <color attach="background" args={["#120d0a"]} />
      <fog attach="fog" args={["#120d0a", 40, 90]} />
      <hemisphereLight args={["#fff4dc", "#20160f", 0.9 * dim]} />
      <directionalLight position={[8, 18, 10]} intensity={1.8 * dim} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-30} shadow-camera-right={30} shadow-camera-top={30} shadow-camera-bottom={-30} />
      <FitCamera w={loc.gridW} h={loc.gridH} />
      <Board location={loc} />
      <Doors walls={walls} loc={loc} revealed={revealed} />
      {auras.map((a) => (
        <AuraMesh key={a.key} aura={a} loc={loc} />
      ))}
      {loot.map((m) => (
        <LootMesh key={m.id} marker={m} loc={loc} />
      ))}
      {views.map((v) => (
        <TokenMesh key={v.token.id} view={v} loc={loc} />
      ))}
      {torches.map((t) => (
        <TorchLight key={t.id} x={t.x} y={t.y} radius={t.radius} loc={loc} />
      ))}
      {fogEntry && <FogLayer key={loc.id} gridW={loc.gridW} gridH={loc.gridH} revealed={revealed} />}
      <BoardEffects effects={placed} />
      <OrbitControls enablePan enableZoom maxPolarAngle={Math.PI / 2.4} minDistance={5} maxDistance={80} />
    </Canvas>
  );
}
