import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Billboard, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { activeFog, lightRadiusOf, visibilityOf, type BoardEffect, type GameState, type Location, type Token } from "@dm/shared";
import { FogLayer } from "./FogLayer";
import { BoardEffects, flashColor, type PlacedEffect } from "./Effects";

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
  /** Latest effect that landed on this token (drives the shake + color flash). */
  hit?: { at: number; color: string; heal: boolean };
}

const HIT_MS = 550;

function cellToWorld(x: number, y: number, loc: { gridW: number; gridH: number }) {
  return new THREE.Vector3(x - loc.gridW / 2 + 0.5, 0, y - loc.gridH / 2 + 0.5);
}

function TokenMesh({ view, loc }: { view: TokenView; loc: { gridW: number; gridH: number } }) {
  const group = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const body = useRef<THREE.Group>(null);
  const standeeMat = useRef<THREE.MeshStandardMaterial>(null);
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
    const d = g.position.distanceTo(target);
    g.position.lerp(target, Math.min(1, dt * 6));
    g.position.y = d > 0.05 ? Math.sin(Math.min(d, 1) * Math.PI) * 0.35 : 0; // hop while moving
    if (ring.current) {
      const pulse = view.isTurn || view.isSpeaker ? 1 + Math.sin(state.clock.elapsedTime * 5) * 0.08 : 1;
      ring.current.scale.setScalar(pulse);
    }
    // Hit reaction: a quick decaying shake plus a color flash on the standee.
    const age = view.hit ? performance.now() - view.hit.at : Infinity;
    const k = age < HIT_MS ? 1 - age / HIT_MS : 0;
    if (body.current) {
      body.current.position.x = view.hit && !view.hit.heal ? Math.sin(age * 0.09) * 0.09 * k : 0;
      body.current.position.y = view.hit?.heal ? Math.sin(Math.min(1, age / HIT_MS) * Math.PI) * 0.12 : 0;
    }
    if (standeeMat.current) {
      standeeMat.current.emissive.copy(flash);
      standeeMat.current.emissiveIntensity = k * 1.4;
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
      <group ref={body}>
      <Billboard position={[0, h / 2 + 0.08, 0]}>
        <mesh castShadow>
          <planeGeometry args={[h * 0.9, h]} />
          <meshStandardMaterial ref={standeeMat} map={standee} emissiveMap={standee} transparent alphaTest={0.2} side={THREE.DoubleSide} opacity={view.down ? 0.45 : 1} />
        </mesh>
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
        {tex ? <meshStandardMaterial map={tex} roughness={0.95} /> : <meshStandardMaterial color="#3b3024" roughness={1} />}
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

export function MapBoard({
  state,
  location,
  speakerPlayerId,
  effects = [],
}: {
  state: GameState;
  location?: Location;
  speakerPlayerId?: string;
  effects?: ReceivedEffect[];
}) {
  const loc: Location = location ?? { id: "none", name: "", description: "", mapPrompt: "", gridW: 20, gridH: 12 };
  const current = state.combat.active ? state.combat.order[state.combat.turnIndex]?.entityId : undefined;
  const speakerCharacter = state.players.find((p) => p.id === speakerPlayerId)?.characterId;
  const fog = activeFog(state);
  const fogEntry = state.locationId ? state.fog?.[state.locationId] : undefined;
  const revealed = useMemo(() => (fog ? new Set(fog.revealed) : null), [fog]);
  const canSee = visibilityOf(state);
  const lastHit = new Map<string, TokenView["hit"]>();
  for (const { effect, receivedAt } of effects)
    if (effect.targetId) lastHit.set(effect.targetId, { at: receivedAt, color: flashColor(effect.kind, effect.element), heal: effect.kind === "heal" });
  const views: TokenView[] = state.tokens.flatMap((t): TokenView[] => {
    const hit = lastHit.get(t.entityId);
    const c = state.characters.find((x) => x.id === t.entityId);
    if (c)
      return [{ token: t, name: c.name, color: c.color, spriteUrl: c.spriteUrl, hpFrac: c.maxHp ? c.hp / c.maxHp : 0, down: c.hp <= 0, isTurn: current === c.id, isSpeaker: speakerCharacter === c.id, monster: false, hit }];
    const m = state.monsters.find((x) => x.id === t.entityId);
    // Monsters standing in unexplored fog stay hidden from the table.
    if (m && !m.hidden && canSee(t.x, t.y))
      return [{ token: t, name: m.name, color: "#c0392b", spriteUrl: m.spriteUrl, hpFrac: m.maxHp ? m.hp / m.maxHp : 0, down: m.hp <= 0, isTurn: current === m.id, isSpeaker: false, monster: true, hit }];
    return [];
  });
  const placed: PlacedEffect[] = effects.flatMap(({ effect }): PlacedEffect[] => {
    const tokenPos = (id?: string) => {
      const t = id ? state.tokens.find((x) => x.entityId === id) : undefined;
      return t ? { x: t.x, y: t.y } : undefined;
    };
    const cell = tokenPos(effect.targetId) ?? (effect.x !== undefined && effect.y !== undefined ? { x: effect.x, y: effect.y } : undefined);
    if (!cell || !canSee(cell.x, cell.y)) return [];
    const src = tokenPos(effect.sourceId);
    return [{ effect, at: cellToWorld(cell.x, cell.y, loc), from: src ? cellToWorld(src.x, src.y, loc) : undefined }];
  });
  const torches = fog
    ? state.characters.flatMap((c) => {
        const t = state.tokens.find((x) => x.entityId === c.id);
        return t ? [{ id: c.id, x: t.x, y: t.y, radius: lightRadiusOf(c) }] : [];
      })
    : [];
  const dim = fog ? 0.6 : 1;

  return (
    <Canvas shadows camera={{ fov: 40, position: [0, 20, 12] }} dpr={[1, 2]}>
      <color attach="background" args={["#120d0a"]} />
      <fog attach="fog" args={["#120d0a", 40, 90]} />
      <hemisphereLight args={["#fff4dc", "#20160f", 0.9 * dim]} />
      <directionalLight position={[8, 18, 10]} intensity={1.8 * dim} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-30} shadow-camera-right={30} shadow-camera-top={30} shadow-camera-bottom={-30} />
      <FitCamera w={loc.gridW} h={loc.gridH} />
      <Board location={loc} />
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
