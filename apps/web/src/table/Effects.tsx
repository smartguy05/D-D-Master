import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { BoardEffect } from "@dm/shared";
import { playEffectSound } from "../dice/sound";
import { DART_STAGGER_MS, type EffectPlan, type Visual } from "./effectPlan";

/**
 * Short 3D effects on the board: particle bursts, expanding fire spheres, lightning tubes, slash
 * arcs, shockwave rings and flash lights, plus travels from the attacker (melee swing, arrow, spell
 * orbs) and area rings. Every effect is self-timed from its mount (travel < 1 s, then the impact
 * < ~1.8 s); TablePage drops it from the list afterwards. effectPlan.ts picks what plays when.
 */

export interface PlacedEffect {
  effect: BoardEffect;
  /** World position of the target (token base or cell center). */
  at: THREE.Vector3;
  /** World position of the source, if any (travels fly from here). */
  from?: THREE.Vector3;
  /** Timing and recipe choice (effectPlan.ts), decided once when the effect arrives. */
  plan: EffectPlan;
}

/** How long TablePage keeps an effect mounted: the longest travel (~0.9 s) plus the slowest impact (~1.8 s). */
export const EFFECT_LIFETIME_MS = 2800;
/** Particle sizes are tuned for a whole-map TV view. */
const SIZE_SCALE = 1.7;

export { flashColor, visualFor } from "./effectPlan";

let dotTexture: THREE.Texture | null = null;
function softDot(): THREE.Texture {
  if (dotTexture) return dotTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.85)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  dotTexture = new THREE.CanvasTexture(c);
  return dotTexture;
}

/** Seconds since this component mounted, advanced by the render loop. */
function useAge() {
  const age = useRef(0);
  useFrame((_, dt) => void (age.current += Math.min(dt, 0.1)));
  return age;
}

const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

// ---------- building blocks ----------

interface ParticleSpec {
  count: number;
  life: number;
  size: number;
  colors: string[];
  gravity?: number;
  drag?: number;
  additive?: boolean;
  delay?: number;
  init: (i: number, pos: THREE.Vector3, vel: THREE.Vector3) => void;
}

function Particles({ spec }: { spec: ParticleSpec }) {
  const age = useAge();
  const { geometry, vel } = useMemo(() => {
    const pos = new Float32Array(spec.count * 3);
    const col = new Float32Array(spec.count * 3);
    const vel: THREE.Vector3[] = [];
    const p = new THREE.Vector3();
    const c = new THREE.Color();
    for (let i = 0; i < spec.count; i++) {
      const v = new THREE.Vector3();
      p.set(0, 0, 0);
      spec.init(i, p, v);
      pos.set([p.x, p.y, p.z], i * 3);
      c.set(spec.colors[i % spec.colors.length]);
      col.set([c.r, c.g, c.b], i * 3);
      vel.push(v);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return { geometry: g, vel };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const mat = useRef<THREE.PointsMaterial>(null);
  useFrame((_, dt) => {
    const t = age.current - (spec.delay ?? 0);
    if (!mat.current) return;
    if (t < 0) {
      mat.current.opacity = 0;
      return;
    }
    const d = Math.min(dt, 0.05);
    const attr = geometry.getAttribute("position") as THREE.BufferAttribute;
    const drag = Math.pow(1 - (spec.drag ?? 0.8), d);
    for (let i = 0; i < spec.count; i++) {
      const v = vel[i];
      v.y -= (spec.gravity ?? 0) * d;
      v.multiplyScalar(drag);
      attr.setXYZ(i, attr.getX(i) + v.x * d, attr.getY(i) + v.y * d, attr.getZ(i) + v.z * d);
    }
    attr.needsUpdate = true;
    const k = t / spec.life;
    mat.current.opacity = k >= 1 ? 0 : Math.min(1, (1 - k) * 1.6);
    mat.current.size = spec.size * SIZE_SCALE * (1 - k * 0.5);
  });
  return (
    <points geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        ref={mat}
        map={softDot()}
        size={spec.size * SIZE_SCALE}
        vertexColors
        transparent
        depthWrite={false}
        blending={spec.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending}
        toneMapped={false}
      />
    </points>
  );
}

function Flash({ color, peak, dur, y = 1.2, distance = 8 }: { color: string; peak: number; dur: number; y?: number; distance?: number }) {
  const age = useAge();
  const light = useRef<THREE.PointLight>(null);
  useFrame(() => {
    if (!light.current) return;
    const k = age.current / dur;
    light.current.intensity = k >= 1 ? 0 : peak * (k < 0.1 ? k / 0.1 : 1 - ease((k - 0.1) / 0.9)) * (0.85 + Math.random() * 0.3);
  });
  return <pointLight ref={light} position={[0, y, 0]} color={color} intensity={0} distance={distance} decay={1.6} />;
}

function Shockwave({ color, radius, dur, delay = 0, y = 0.05, thickness = 0.12 }: { color: string; radius: number; dur: number; delay?: number; y?: number; thickness?: number }) {
  const age = useAge();
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    const k = (age.current - delay) / dur;
    if (!mesh.current || !mat.current) return;
    mesh.current.visible = k > 0 && k < 1;
    mesh.current.scale.setScalar(0.05 + ease(k) * radius);
    mat.current.opacity = (1 - k) * 0.9;
  });
  return (
    <mesh ref={mesh} rotation-x={-Math.PI / 2} position={[0, y, 0]} visible={false}>
      <ringGeometry args={[1 - thickness, 1, 64]} />
      <meshBasicMaterial ref={mat} color={color} transparent depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
  );
}

function Sphere({ colors, radius, grow, dur, y = 0.6 }: { colors: [string, string]; radius: number; grow: number; dur: number; y?: number }) {
  const age = useAge();
  const outer = useRef<THREE.Mesh>(null);
  const inner = useRef<THREE.Mesh>(null);
  const mo = useRef<THREE.MeshBasicMaterial>(null);
  const mi = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    const t = age.current;
    const s = ease(t / grow) * radius;
    const fade = t < grow ? 1 : Math.max(0, 1 - (t - grow) / (dur - grow));
    outer.current?.scale.setScalar(Math.max(0.01, s));
    inner.current?.scale.setScalar(Math.max(0.01, s * 0.7));
    if (outer.current) outer.current.rotation.y = t * 2;
    if (mo.current) mo.current.opacity = 0.55 * fade;
    if (mi.current) mi.current.opacity = 0.9 * fade * fade;
  });
  return (
    <group position={[0, y, 0]}>
      <mesh ref={outer}>
        <icosahedronGeometry args={[1, 3]} />
        <meshBasicMaterial ref={mo} color={colors[0]} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh ref={inner}>
        <icosahedronGeometry args={[1, 2]} />
        <meshBasicMaterial ref={mi} color={colors[1]} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
    </group>
  );
}

function SlashArc({ color, scale = 1, delay = 0, tilt = 0.6 }: { color: string; scale?: number; delay?: number; tilt?: number }) {
  const age = useAge();
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    const k = (age.current - delay) / 0.45;
    if (!mesh.current || !mat.current) return;
    mesh.current.visible = k > 0 && k < 1;
    mesh.current.rotation.z = -1.2 + ease(k) * 2.6;
    mat.current.opacity = k < 0.3 ? 1 : 1 - (k - 0.3) / 0.7;
  });
  return (
    <group position={[0, 0.8, 0.15]} rotation={[0, 0, tilt]} scale={scale}>
      <mesh ref={mesh} visible={false}>
        <torusGeometry args={[0.85, 0.08, 6, 40, Math.PI * 0.8]} />
        <meshBasicMaterial ref={mat} color={color} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
    </group>
  );
}

function jagged(from: THREE.Vector3, to: THREE.Vector3, segments: number, jitter: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const p = from.clone().lerp(to, i / segments);
    p.y += Math.sin((i / segments) * Math.PI) * from.distanceTo(to) * 0.12; // arc over the fog
    if (i > 0 && i < segments) p.add(new THREE.Vector3((Math.random() - 0.5) * jitter, (Math.random() - 0.5) * jitter, (Math.random() - 0.5) * jitter));
    pts.push(p);
  }
  return pts;
}

function Bolt({ from, color }: { from: THREE.Vector3; color: string }) {
  const age = useAge();
  const core = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Mesh>(null);
  const last = useRef(-1);
  const to = useMemo(() => new THREE.Vector3(0, 0.3, 0), []);
  useFrame(() => {
    const t = age.current;
    const on = t < 0.7 && Math.floor(t * 30) % 3 !== 2;
    if (core.current) core.current.visible = on;
    if (glow.current) glow.current.visible = on;
    const tick = Math.floor(t * 20);
    if (tick === last.current || !core.current || !glow.current) return;
    last.current = tick;
    const curve = new THREE.CatmullRomCurve3(jagged(from, to, 12, 0.9), false, "catmullrom", 0.1);
    core.current.geometry.dispose();
    glow.current.geometry.dispose();
    core.current.geometry = new THREE.TubeGeometry(curve, 48, 0.035, 5, false);
    glow.current.geometry = new THREE.TubeGeometry(curve, 48, 0.16, 6, false);
  });
  return (
    <group>
      <mesh ref={core}>
        <tubeGeometry />
        <meshBasicMaterial color="#ffffff" transparent toneMapped={false} />
      </mesh>
      <mesh ref={glow}>
        <tubeGeometry />
        <meshBasicMaterial color={color} transparent opacity={0.45} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Pillar({ color, radius }: { color: string; radius: number }) {
  const age = useAge();
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    const t = age.current;
    if (!mesh.current || !mat.current) return;
    const s = t < 0.2 ? ease(t / 0.2) : 1 - ease((t - 0.2) / 1.1) * 0.6;
    mesh.current.scale.set(s * radius, 1, s * radius);
    mat.current.opacity = t < 1.3 ? 0.55 * (t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 1.1) : 0;
  });
  return (
    <mesh ref={mesh} position={[0, 1.8, 0]}>
      <cylinderGeometry args={[0.7, 1, 3.6, 32, 1, true]} />
      <meshBasicMaterial ref={mat} color={color} transparent depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
  );
}

function Shards({ color, count, radius }: { color: string; count: number; radius: number }) {
  const age = useAge();
  const group = useRef<THREE.Group>(null);
  const dirs = useMemo(() => Array.from({ length: count }, (_, i) => ({ a: (i / count) * Math.PI * 2 + Math.random() * 0.4, tilt: 0.3 + Math.random() * 0.5, len: 0.4 + Math.random() * 0.5 })), [count]);
  useFrame(() => {
    const t = age.current;
    const g = group.current;
    if (!g) return;
    const grow = ease(t / 0.25);
    const fade = t < 0.9 ? 1 : Math.max(0, 1 - (t - 0.9) / 0.6);
    g.children.forEach((c, i) => {
      const d = dirs[i];
      c.scale.set(fade, grow * fade * d.len * 2.6, fade);
    });
  });
  return (
    <group ref={group}>
      {dirs.map((d, i) => (
        <mesh key={i} position={[Math.cos(d.a) * radius * 0.35, 0, Math.sin(d.a) * radius * 0.35]} rotation={[Math.sin(d.a) * d.tilt, 0, -Math.cos(d.a) * d.tilt]}>
          <coneGeometry args={[0.16, 1, 5]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} transparent opacity={0.85} roughness={0.1} metalness={0.2} />
        </mesh>
      ))}
    </group>
  );
}

// ---------- effect recipes ----------

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
function sphereDir(v: THREE.Vector3, speed: number, upBias = 0) {
  v.set(rnd(-1, 1), rnd(-1, 1) + upBias, rnd(-1, 1)).normalize().multiplyScalar(speed * rnd(0.4, 1));
}

function Recipe({ visual, radius, from, tint = "#ffcf7a" }: { visual: Visual; radius: number; from?: THREE.Vector3; tint?: string }) {
  switch (visual) {
    case "spark":
      return (
        <>
          <Flash color={tint} peak={25} dur={0.4} y={0.8} />
          <Particles spec={{ count: 22, life: 0.5, size: 0.11, gravity: 6, drag: 0.5, colors: [tint, "#ffffff"], init: (_, p, v) => { p.set(0, 0.8, 0); sphereDir(v, 4, 0.4); } }} />
        </>
      );
    case "area":
      return null; // drawn by AreaRing + the element visual
    case "fireball": {
      const r = Math.max(0.8, radius);
      return (
        <>
          <Sphere colors={["#ff5a14", "#fff0a0"]} radius={r} grow={0.3} dur={1.3} y={0.5} />
          <Flash color="#ff8a2a" peak={120} dur={1.1} distance={r * 4 + 4} />
          <Shockwave color="#ff9a40" radius={r * 1.2} dur={0.7} />
          <Particles spec={{ count: 90, life: 1.3, size: 0.28, gravity: 3, drag: 0.7, colors: ["#ffb347", "#ff6a00", "#ffd27f", "#ff3d00"], init: (_, p, v) => { p.set(0, 0.5, 0); sphereDir(v, 7 * r, 0.4); } }} />
          <Particles spec={{ count: 30, life: 1.6, size: 0.6, drag: 0.9, additive: false, delay: 0.25, colors: ["#2a2420", "#3a302a"], init: (_, p, v) => { p.set(rnd(-0.5, 0.5) * r, 0.4, rnd(-0.5, 0.5) * r); v.set(rnd(-0.3, 0.3), rnd(0.8, 1.8), rnd(-0.3, 0.3)); } }} />
        </>
      );
    }
    case "lightning": {
      const src = from ?? new THREE.Vector3(rnd(-1, 1), 9, rnd(-1, 1));
      return (
        <>
          <Bolt from={src} color="#7fc8ff" />
          <Flash color="#bfe4ff" peak={90} dur={0.7} distance={10} />
          <Shockwave color="#9fd8ff" radius={1.4} dur={0.45} />
          <Particles spec={{ count: 40, life: 0.6, size: 0.14, gravity: 12, drag: 0.5, colors: ["#e6f6ff", "#7fc8ff"], init: (_, p, v) => { p.set(0, 0.3, 0); sphereDir(v, 7, 0.8); } }} />
        </>
      );
    }
    case "frost":
      return (
        <>
          <Shards color="#aeefff" count={11} radius={Math.max(1.6, radius)} />
          <Flash color="#8fe3ff" peak={40} dur={1.0} />
          <Shockwave color="#bdf3ff" radius={Math.max(1, radius) * 1.1} dur={0.6} />
          <Particles spec={{ count: 60, life: 1.4, size: 0.12, gravity: -0.4, drag: 0.8, colors: ["#ffffff", "#bdf3ff"], init: (_, p, v) => { p.set(rnd(-0.6, 0.6), rnd(0, 1.2), rnd(-0.6, 0.6)); sphereDir(v, 1.5, 0.2); } }} />
        </>
      );
    case "poison":
      return (
        <>
          <Particles spec={{ count: 45, life: 1.8, size: 0.9, drag: 0.85, additive: false, colors: ["#4f9a2a", "#79c23b", "#2f6a1a"], init: (_, p, v) => { p.set(rnd(-0.3, 0.3), 0.4, rnd(-0.3, 0.3)); sphereDir(v, 2.2 * Math.max(1, radius), 0.3); v.y = Math.abs(v.y) * 0.4; } }} />
          <Particles spec={{ count: 30, life: 1.5, size: 0.14, gravity: -0.6, colors: ["#b6ff6a"], init: (_, p, v) => { p.set(rnd(-0.8, 0.8), rnd(0.1, 0.8), rnd(-0.8, 0.8)); v.set(0, rnd(0.3, 0.9), 0); } }} />
          <Flash color="#7ddc4a" peak={25} dur={1.4} />
        </>
      );
    case "radiant":
      return (
        <>
          <Pillar color="#fff1a8" radius={Math.max(0.6, radius * 0.6)} />
          <Flash color="#fff1a8" peak={70} dur={1.3} y={2} />
          <Shockwave color="#ffe27a" radius={Math.max(1.2, radius)} dur={0.8} />
          <Particles spec={{ count: 50, life: 1.4, size: 0.16, gravity: -1.5, colors: ["#ffffff", "#ffe27a"], init: (_, p, v) => { p.set(rnd(-0.6, 0.6), rnd(0, 0.5), rnd(-0.6, 0.6)); v.set(0, rnd(1, 3), 0); } }} />
        </>
      );
    case "necrotic":
      return (
        <>
          <Particles spec={{ count: 70, life: 1.3, size: 0.3, drag: 0.4, colors: ["#6a2cff", "#2a0a4a", "#a05cff"], init: (i, p, v) => { const a = (i / 70) * Math.PI * 6; p.set(Math.cos(a) * 1.6, rnd(0.2, 1.4), Math.sin(a) * 1.6); v.set(-Math.cos(a) * 2 - Math.sin(a) * 2, rnd(-0.2, 0.4), -Math.sin(a) * 2 + Math.cos(a) * 2); } }} />
          <Shockwave color="#7b3cff" radius={1.3} dur={0.9} delay={0.2} />
          <Flash color="#8a4dff" peak={30} dur={1.2} />
        </>
      );
    case "thunder":
      return (
        <>
          <Shockwave color="#dfe8ff" radius={Math.max(1.5, radius) * 1.4} dur={0.55} thickness={0.2} />
          <Shockwave color="#9fb4ff" radius={Math.max(1.5, radius) * 1.8} dur={0.75} delay={0.12} />
          <Shockwave color="#9fb4ff" radius={Math.max(1.5, radius)} dur={0.5} delay={0.05} y={0.8} />
          <Flash color="#c9d8ff" peak={50} dur={0.5} />
          <Particles spec={{ count: 40, life: 0.8, size: 0.2, drag: 0.6, additive: false, colors: ["#7a6a5a", "#5a4a3a"], init: (_, p, v) => { p.set(0, 0.1, 0); sphereDir(v, 6, 0); v.y = Math.abs(v.y) * 0.3; } }} />
        </>
      );
    case "arcane":
      return (
        <>
          <Shockwave color="#c77dff" radius={1.2} dur={0.9} />
          <Shockwave color="#7fd4ff" radius={0.8} dur={0.7} delay={0.1} y={0.9} />
          <Sphere colors={["#9b4dff", "#f0d0ff"]} radius={0.55} grow={0.2} dur={0.7} y={0.8} />
          <Flash color="#c77dff" peak={45} dur={0.9} />
          <Particles spec={{ count: 60, life: 1.2, size: 0.13, drag: 0.7, colors: ["#f0d0ff", "#c77dff", "#7fd4ff"], init: (_, p, v) => { p.set(0, 0.8, 0); sphereDir(v, 4, 0.2); } }} />
        </>
      );
    case "heal":
      return (
        <>
          <Shockwave color="#6dff9a" radius={1.1} dur={1.1} thickness={0.25} y={0.12} />
          <Flash color="#6dff9a" peak={35} dur={1.4} />
          <Particles spec={{ count: 60, life: 1.6, size: 0.16, gravity: -2.2, drag: 0.5, colors: ["#b4ffc9", "#6dff9a", "#fff6a8"], init: (i, p, v) => { const a = i * 2.4; const r = rnd(0.55, 0.95); p.set(Math.cos(a) * r, rnd(0.2, 1.4), Math.sin(a) * r); v.set(-Math.sin(a) * 0.8, rnd(0.4, 1.3), Math.cos(a) * 0.8); } }} />
        </>
      );
    case "crit":
      return (
        <>
          <SlashArc color="#ffd75e" scale={1.5} />
          <SlashArc color="#ffffff" scale={1.3} delay={0.12} tilt={-0.7} />
          <Shockwave color="#ffd75e" radius={2} dur={0.6} thickness={0.18} />
          <Flash color="#ffd75e" peak={80} dur={0.9} />
          <Particles spec={{ count: 80, life: 1.1, size: 0.2, gravity: 6, drag: 0.6, colors: ["#fff6c8", "#ffd75e", "#ffae00"], init: (_, p, v) => { p.set(0, 0.8, 0); sphereDir(v, 8, 0.6); } }} />
        </>
      );
    case "miss":
      return (
        <>
          <Shockwave color="#9a9a9a" radius={0.9} dur={0.6} />
          <Particles spec={{ count: 24, life: 0.9, size: 0.35, drag: 0.8, additive: false, colors: ["#8a8378", "#6f685e"], init: (_, p, v) => { p.set(0, 0.1, 0); sphereDir(v, 2.5, 0); v.y = Math.abs(v.y) * 0.3; } }} />
        </>
      );
    case "slash":
    default:
      return (
        <>
          <SlashArc color="#ffffff" />
          <SlashArc color="#ff4a3a" scale={1.15} delay={0.05} />
          <Flash color="#ff4a3a" peak={30} dur={0.5} />
          <Particles spec={{ count: 30, life: 0.7, size: 0.12, gravity: 9, drag: 0.4, colors: ["#ff3b2f", "#b3140c"], init: (_, p, v) => { p.set(0, 0.8, 0.2); sphereDir(v, 4.5, 0.5); } }} />
        </>
      );
  }
}

// ---------- travels (attacker → target) and area rings ----------

/** Mounts its children `ms` after its own mount (frame time, like every recipe). */
function Delayed({ ms, children }: { ms: number; children: ReactNode }) {
  const age = useAge();
  const [on, setOn] = useState(ms <= 0);
  useFrame(() => {
    if (!on && age.current * 1000 >= ms) setOn(true);
  });
  return on ? <>{children}</> : null;
}

const UP_Z = new THREE.Vector3(0, 0, 1);
/** Missed shots end beside and past the target. */
function missPoint(from: THREE.Vector3, y: number): THREE.Vector3 {
  const dir = new THREE.Vector3(-from.x, 0, -from.z).normalize();
  const side = new THREE.Vector3(-dir.z, 0, dir.x);
  return dir.multiplyScalar(1.1).add(side.multiplyScalar(0.7)).setY(y);
}
/** A point on a lifted arc from `a` to `b`, pushed sideways by `side` at the middle. */
function arcPoint(a: THREE.Vector3, b: THREE.Vector3, k: number, lift: number, side: number, out: THREE.Vector3) {
  out.copy(a).lerp(b, k);
  const bump = Math.sin(k * Math.PI);
  out.y += bump * lift;
  if (side) {
    const d = b.clone().sub(a).setY(0).normalize();
    out.x += -d.z * side * bump;
    out.z += d.x * side * bump;
  }
  return out;
}

/** Melee: a blade arc sweeping across the target from the attacker's side. */
function Swing({ from, color, dur }: { from: THREE.Vector3; color: string; dur: number }) {
  const age = useAge();
  const sweep = useRef<THREE.Group>(null);
  const mats = [useRef<THREE.MeshBasicMaterial>(null), useRef<THREE.MeshBasicMaterial>(null)];
  const { yaw, pos } = useMemo(() => {
    const dir = new THREE.Vector3(-from.x, 0, -from.z);
    const dist = dir.length() || 1;
    dir.normalize();
    return { yaw: Math.atan2(dir.x, dir.z), pos: dir.clone().multiplyScalar(-Math.min(0.75, dist * 0.45)).setY(0.9) };
  }, [from]);
  useFrame(() => {
    const k = age.current / (dur * 1.8);
    if (sweep.current) {
      sweep.current.visible = k < 1;
      sweep.current.rotation.y = -1.1 + ease(age.current / dur) * 2.2;
    }
    for (const m of mats) if (m.current) m.current.opacity = k < 0.4 ? 1 : Math.max(0, 1 - (k - 0.4) / 0.6);
  });
  return (
    <group position={pos} rotation={[0, yaw, 0.35]}>
      <group ref={sweep}>
        <mesh rotation-x={Math.PI / 2} rotation-z={-Math.PI * 0.45}>
          <torusGeometry args={[0.7, 0.06, 6, 40, Math.PI * 0.9]} />
          <meshBasicMaterial ref={mats[0]} color="#ffffff" transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </mesh>
        <mesh rotation-x={Math.PI / 2} rotation-z={-Math.PI * 0.45} scale={1.12}>
          <torusGeometry args={[0.7, 0.1, 6, 40, Math.PI * 0.9]} />
          <meshBasicMaterial ref={mats[1]} color={color} transparent opacity={0.6} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

/** Ranged weapon: an arrow/bolt flying on a shallow arc, nose first. */
function Arrow({ from, dur, miss }: { from: THREE.Vector3; dur: number; miss: boolean }) {
  const age = useAge();
  const g = useRef<THREE.Group>(null);
  const { a, b, lift } = useMemo(() => {
    const a = from.clone().setY(0.9);
    const b = miss ? missPoint(from, 0.5) : new THREE.Vector3(0, 0.8, 0);
    return { a, b, lift: Math.min(1.5, a.distanceTo(b) * 0.08) };
  }, [from, miss]);
  const p = useMemo(() => new THREE.Vector3(), []);
  const q = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const k = age.current / dur;
    const grp = g.current;
    if (!grp) return;
    grp.visible = k < 1;
    if (k >= 1) return;
    arcPoint(a, b, k, lift, 0, p);
    arcPoint(a, b, Math.min(1, k + 0.02), lift, 0, q);
    grp.position.copy(p);
    grp.quaternion.setFromUnitVectors(UP_Z, q.sub(p).normalize());
  });
  return (
    <group ref={g} visible={false}>
      <mesh rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.025, 0.025, 0.75, 6]} />
        <meshStandardMaterial color="#8a6a44" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0, 0.42]} rotation-x={Math.PI / 2}>
        <coneGeometry args={[0.06, 0.16, 8]} />
        <meshStandardMaterial color="#d8dde3" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0, -0.33]}>
        <boxGeometry args={[0.16, 0.01, 0.14]} />
        <meshBasicMaterial color="#f2f2f2" />
      </mesh>
      <mesh position={[0, 0, -0.6]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.01, 0.04, 0.5, 6]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.35} depthWrite={false} />
      </mesh>
    </group>
  );
}

const TRAIL = 7;
/** Spell: element-coloured orbs with a fading trail; several darts curve apart (Magic Missile). */
function Orbs({ from, color, dur, count, miss, lob = false }: { from: THREE.Vector3; color: string; dur: number; count: number; miss: boolean; lob?: boolean }) {
  const age = useAge();
  const group = useRef<THREE.Group>(null);
  const { a, b, lift } = useMemo(() => {
    const a = from.clone().setY(1.1);
    const b = miss ? missPoint(from, 0.6) : new THREE.Vector3(0, lob ? 0.4 : 0.8, 0);
    return { a, b, lift: lob ? Math.min(4, a.distanceTo(b) * 0.3) : Math.min(1.2, a.distanceTo(b) * 0.06) };
  }, [from, miss, lob]);
  const p = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const grp = group.current;
    if (!grp) return;
    grp.children.forEach((dart, i) => {
      const t = age.current - (i * DART_STAGGER_MS) / 1000;
      const side = count > 1 ? (i - (count - 1) / 2) * 1.1 : 0;
      dart.children.forEach((m, idx) => {
        const j = idx === TRAIL ? 0 : idx; // the last child is the head's glow
        const k = (t - j * 0.025) / dur;
        m.visible = k > 0 && k < 1;
        if (!m.visible) return;
        m.position.copy(arcPoint(a, b, k, lift, side, p));
        m.scale.setScalar(j === 0 ? 1 : 1 - j / TRAIL);
      });
    });
  });
  return (
    <group ref={group}>
      {Array.from({ length: count }, (_, i) => (
        <group key={i}>
          {Array.from({ length: TRAIL }, (_, j) => (
            <mesh key={j} visible={false}>
              <sphereGeometry args={[j === 0 ? 0.2 : 0.14, 12, 8]} />
              <meshBasicMaterial color={j === 0 ? "#ffffff" : color} transparent opacity={j === 0 ? 0.95 : 0.55 * (1 - j / TRAIL)} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
            </mesh>
          ))}
          <mesh visible={false}>
            <sphereGeometry args={[0.34, 12, 8]} />
            <meshBasicMaterial color={color} transparent opacity={0.35} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Area: a ring at the exact radius (cells) with a fading dome, so the table sees what is caught. */
function AreaRing({ radius, color }: { radius: number; color: string }) {
  const age = useAge();
  const ring = useRef<THREE.Mesh>(null);
  const dome = useRef<THREE.Mesh>(null);
  const disc = useRef<THREE.Mesh>(null);
  const mats = { ring: useRef<THREE.MeshBasicMaterial>(null), dome: useRef<THREE.MeshBasicMaterial>(null), disc: useRef<THREE.MeshBasicMaterial>(null) };
  const r = Math.max(0.5, radius);
  useFrame(() => {
    const t = age.current;
    const grow = ease(t / 0.3);
    const fade = t < 0.6 ? 1 : Math.max(0, 1 - (t - 0.6) / 0.5);
    ring.current?.scale.setScalar(Math.max(0.01, grow * r));
    disc.current?.scale.setScalar(Math.max(0.01, grow * r));
    dome.current?.scale.set(Math.max(0.01, grow * r), Math.max(0.01, grow * Math.min(r, 3)), Math.max(0.01, grow * r));
    if (mats.ring.current) mats.ring.current.opacity = 0.95 * fade;
    if (mats.dome.current) mats.dome.current.opacity = 0.28 * fade * fade;
    if (mats.disc.current) mats.disc.current.opacity = 0.18 * fade;
  });
  return (
    <group>
      <mesh ref={ring} rotation-x={-Math.PI / 2} position={[0, 0.06, 0]}>
        <ringGeometry args={[0.94, 1, 96]} />
        <meshBasicMaterial ref={mats.ring} color={color} transparent depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <mesh ref={disc} rotation-x={-Math.PI / 2} position={[0, 0.04, 0]}>
        <circleGeometry args={[1, 64]} />
        <meshBasicMaterial ref={mats.disc} color={color} transparent depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <mesh ref={dome}>
        <sphereGeometry args={[1, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshBasicMaterial ref={mats.dome} color={color} transparent depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <Flash color={color} peak={60} dur={0.8} distance={r * 3 + 4} />
    </group>
  );
}

/** Effect ids whose sounds already played (StrictMode mounts twice; re-renders must not replay). */
const sounded = new Set<string>();

function EffectSounds({ id, sounds }: { id: string; sounds: EffectPlan["sounds"] }) {
  useEffect(() => {
    if (sounded.has(id)) return;
    sounded.add(id);
    if (sounded.size > 200) sounded.delete(sounded.values().next().value!);
    for (const s of sounds) playEffectSound(s.name, s.atMs / 1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return null;
}

function PlacedRecipe({ effect, from, plan }: PlacedEffect & { from?: THREE.Vector3 }) {
  const dur = plan.travelMs / 1000;
  const miss = plan.reaction === "miss";
  const radius = effect.radius ?? 0;
  // Lightning travels as the bolt itself (the impact recipe draws it from the source).
  const boltFrom = from ? from.clone().setY(from.y + 1.0) : undefined;
  return (
    <>
      <EffectSounds id={effect.id} sounds={plan.sounds} />
      {from && plan.travel === "swing" && <Swing from={from} color={plan.color} dur={dur} />}
      {from && plan.travel === "arrow" && <Arrow from={from} dur={dur} miss={miss} />}
      {from && plan.travel === "orb" && <Orbs from={from} color={plan.color} dur={dur} count={plan.count} miss={miss} lob={effect.kind === "area"} />}
      {from && plan.travel === "bolt" && <Recipe visual="lightning" radius={0} from={boltFrom} />}
      {plan.impact && (
        <Delayed ms={plan.impactAtMs}>
          {plan.impact === "area" ? (
            <>
              <AreaRing radius={plan.areaRadius ?? radius} color={plan.color} />
              {plan.areaVisual && <Recipe visual={plan.areaVisual} radius={plan.areaRadius ?? radius} />}
            </>
          ) : (
            <Recipe visual={plan.impact} radius={radius} from={plan.travel ? undefined : boltFrom} tint={plan.color} />
          )}
        </Delayed>
      )}
    </>
  );
}

export function BoardEffects({ effects }: { effects: PlacedEffect[] }) {
  return (
    <>
      {effects.map(({ effect, at, from, plan }) => (
        <group key={effect.id} position={at}>
          <PlacedRecipe effect={effect} at={at} plan={plan} from={from ? from.clone().sub(at) : undefined} />
        </group>
      ))}
    </>
  );
}
