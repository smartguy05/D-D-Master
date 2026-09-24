import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { BoardEffect, EffectKind } from "@dm/shared";

/**
 * Short 3D effects on the board: particle bursts, expanding fire spheres, lightning tubes, slash
 * arcs, shockwave rings and flash lights. Every effect is self-timed from its mount and lasts
 * under ~1.8 s; TablePage drops it from the list afterwards.
 */

export interface PlacedEffect {
  effect: BoardEffect;
  /** World position of the target (token base or cell center). */
  at: THREE.Vector3;
  /** World position of the source, if any (bolts fly from here). */
  from?: THREE.Vector3;
}

export const EFFECT_LIFETIME_MS = 2200;
/** Particle sizes are tuned for a whole-map TV view. */
const SIZE_SCALE = 1.7;

type Visual = "slash" | "fireball" | "lightning" | "frost" | "poison" | "radiant" | "necrotic" | "thunder" | "arcane" | "heal" | "crit" | "miss";

/** Map a board effect to a visual. Plain hits use their damage type when it has a look of its own. */
export function visualFor(kind: EffectKind, element?: string): Visual {
  if (kind !== "hit") return kind as Visual;
  const e = (element ?? "").toLowerCase();
  if (e.includes("fire")) return "fireball";
  if (e.includes("lightning")) return "lightning";
  if (e.includes("cold")) return "frost";
  if (e.includes("poison") || e.includes("acid")) return "poison";
  if (e.includes("radiant")) return "radiant";
  if (e.includes("necrotic")) return "necrotic";
  if (e.includes("thunder")) return "thunder";
  if (e.includes("force") || e.includes("psychic")) return "arcane";
  return "slash";
}

/** Tint used for the token flash when an effect lands. */
export function flashColor(kind: EffectKind, element?: string): string {
  const v = visualFor(kind, element);
  return (
    { slash: "#ff3b2f", crit: "#ffd75e", fireball: "#ff7a1a", lightning: "#9fd8ff", frost: "#8fe3ff", poison: "#7ddc4a", radiant: "#fff1a8", necrotic: "#a05cff", thunder: "#c9d8ff", arcane: "#c77dff", heal: "#6dff9a", miss: "#9a9a9a" } as Record<Visual, string>
  )[v];
}

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

function Recipe({ visual, radius, from }: { visual: Visual; radius: number; from?: THREE.Vector3 }) {
  switch (visual) {
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

export function BoardEffects({ effects }: { effects: PlacedEffect[] }) {
  return (
    <>
      {effects.map(({ effect, at, from }) => {
        const visual = visualFor(effect.kind, effect.element);
        const local = from ? from.clone().sub(at).setY(from.y - at.y + 1.0) : undefined;
        return (
          <group key={effect.id} position={at}>
            <Recipe visual={visual} radius={effect.radius ?? 0} from={local} />
          </group>
        );
      })}
    </>
  );
}
