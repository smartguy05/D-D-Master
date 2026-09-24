import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { cellKey } from "@dm/shared";

/**
 * Fog of war as a real 3D layer: a finely subdivided plane over the board whose vertices are
 * pushed up into a rolling, slowly drifting smoke blanket wherever a cell is unrevealed. A
 * per-cell DataTexture (linear filtered, so edges are soft) holds the fog amount; values ease
 * toward their target every frame, so revealed cells sink and fade out smoothly.
 * It renders first among transparent objects (renderOrder -1, no depth write), so tokens and
 * effects inside the shroud still glow through it.
 */

const SUBDIV = 4; // vertices per cell edge
const FADE_PER_SEC = 2.2;

const vertexShader = /* glsl */ `
  uniform sampler2D uFog;
  uniform float uTime;
  varying float vFog;
  varying vec3 vWorld;
  varying float vH;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) { return noise(p) * 0.6 + noise(p * 2.1 + 3.7) * 0.3 + noise(p * 4.3 - 1.3) * 0.1; }

  void main() {
    float fog = texture2D(uFog, uv).r;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    float n = fbm(wp.xz * 0.45 + vec2(uTime * 0.05, uTime * 0.03));
    float h = smoothstep(0.0, 1.0, fog) * (0.35 + 0.75 * n);
    // the plane lies in XY before its -90deg X rotation: local +Z becomes world +Y
    vec3 p = position + vec3(0.0, 0.0, h);
    wp = modelMatrix * vec4(p, 1.0);
    vFog = fog;
    vWorld = wp.xyz;
    vH = h;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  varying float vFog;
  varying vec3 vWorld;
  varying float vH;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }

  void main() {
    if (vFog < 0.01) discard;
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    if (n.y < 0.0) n = -n;
    float light = clamp(dot(n, normalize(vec3(0.35, 1.0, 0.45))), 0.0, 1.0);
    float swirl = noise(vWorld.xz * 1.3 - vec2(uTime * 0.08, uTime * 0.05)) * 0.6
                + noise(vWorld.xz * 3.1 + vec2(uTime * 0.11, -uTime * 0.07)) * 0.4;
    vec3 deep = vec3(0.018, 0.016, 0.026);
    vec3 top = vec3(0.13, 0.12, 0.16);
    vec3 col = mix(deep, top, clamp(vH * 0.8 * light + swirl * 0.18, 0.0, 1.0));
    float alpha = smoothstep(0.0, 0.55, vFog) * (0.9 + 0.1 * swirl);
    gl_FragColor = vec4(col, alpha);
  }
`;

export function FogLayer({ gridW, gridH, revealed }: { gridW: number; gridH: number; revealed: Set<string> | null }) {
  const current = useRef<Float32Array>(new Float32Array(0));
  const target = useMemo(() => {
    const t = new Float32Array(gridW * gridH);
    for (let y = 0; y < gridH; y++)
      for (let x = 0; x < gridW; x++) {
        // data row 0 is the bottom of the texture = the grid row nearest the viewer (max y)
        t[(gridH - 1 - y) * gridW + x] = revealed && !revealed.has(cellKey(x, y)) ? 1 : 0;
      }
    return t;
  }, [gridW, gridH, revealed]);

  const { texture, data } = useMemo(() => {
    const data = new Uint8Array(gridW * gridH * 4);
    const texture = new THREE.DataTexture(data, gridW, gridH, THREE.RGBAFormat);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    return { texture, data };
  }, [gridW, gridH]);

  // A new map starts fully at its target (no fade-in of a whole new board).
  useEffect(() => {
    current.current = Float32Array.from(target);
    for (let i = 0; i < target.length; i++) data[i * 4] = Math.round(target[i] * 255);
    texture.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texture]);

  useEffect(() => () => texture.dispose(), [texture]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uFog: { value: texture }, uTime: { value: 0 } },
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
      }),
    [texture],
  );
  useEffect(() => () => material.dispose(), [material]);

  const geometry = useMemo(() => new THREE.PlaneGeometry(gridW, gridH, gridW * SUBDIV, gridH * SUBDIV), [gridW, gridH]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((state, dt) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
    const cur = current.current;
    if (cur.length !== target.length) return;
    const step = Math.min(1, dt * FADE_PER_SEC);
    let changed = false;
    for (let i = 0; i < cur.length; i++) {
      const d = target[i] - cur[i];
      if (d === 0) continue;
      cur[i] = Math.abs(d) < 0.01 ? target[i] : cur[i] + d * step;
      data[i * 4] = Math.round(cur[i] * 255);
      changed = true;
    }
    if (changed) texture.needsUpdate = true;
  });

  return <mesh geometry={geometry} material={material} rotation-x={-Math.PI / 2} position={[0, 0.02, 0]} renderOrder={-1} />;
}
