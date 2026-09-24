import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { buildDieMesh, dieShape } from "./shapes";
import { impactSchedule, SIM_HZ, simulateThrow, toVisualDice, type SimulatedDie } from "./simulate";
import { playImpact } from "./sound";
import type { RollResult } from "@dm/shared";

function Die({ die, color, clock }: { die: SimulatedDie; color: string; clock: React.MutableRefObject<number> }) {
  const ref = useRef<THREE.Mesh>(null);
  const { geometry, materials } = useMemo(
    () => buildDieMesh(dieShape(die.kind), die.labels, die.dropped ? "#555a66" : color, die.style),
    [die, color],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      materials.forEach((m) => {
        (m as THREE.MeshPhysicalMaterial).map?.dispose();
        m.dispose();
      });
    },
    [geometry, materials],
  );
  const frameCount = die.frames.length / 7;
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const f = Math.min(frameCount - 1, Math.floor(clock.current * SIM_HZ));
    const o = f * 7;
    m.position.set(die.frames[o], die.frames[o + 1], die.frames[o + 2]);
    m.quaternion.set(die.frames[o + 3], die.frames[o + 4], die.frames[o + 5], die.frames[o + 6]);
  });
  return <mesh ref={ref} geometry={geometry} material={materials} castShadow />;
}

function Throw({ dice, color, onSettled }: { dice: SimulatedDie[]; color: string; onSettled: () => void }) {
  const clock = useRef(0);
  const done = useRef(false);
  const duration = Math.max(...dice.map((d) => d.frames.length / 7)) / SIM_HZ;
  const impacts = useMemo(() => impactSchedule(dice), [dice]);
  const nextImpact = useRef(0);
  useFrame((_, dt) => {
    clock.current += Math.min(dt, 0.25);
    // Clatter: play every collision whose frame the playback clock has now passed.
    const frame = clock.current * SIM_HZ;
    while (nextImpact.current < impacts.length && impacts[nextImpact.current].frame <= frame) {
      playImpact(impacts[nextImpact.current++]);
    }
    if (!done.current && clock.current >= duration) {
      done.current = true;
      onSettled();
    }
  });
  return (
    <>
      {dice.map((d, i) => (
        <Die key={i} die={d} color={color} clock={clock} />
      ))}
    </>
  );
}

/**
 * Transparent full-screen overlay that throws physics dice for a roll. The server result is
 * enforced by relabelling faces after an offline simulation (see simulate.ts).
 */
export function DiceTray({ roll, color, onSettled }: { roll: RollResult | null; color: string; onSettled: () => void }) {
  const dice = useMemo(() => (roll && !roll.physical && !roll.secret ? simulateThrow(toVisualDice(roll.dice)) : []), [roll]);
  useEffect(() => {
    if (roll && dice.length === 0) onSettled();
  }, [roll, dice, onSettled]);
  if (!roll || !dice.length) return null;
  return (
    <div className="dice-overlay">
      <Canvas shadows camera={{ position: [0, 21, 8], fov: 38 }} gl={{ alpha: true, antialias: true }} onCreated={({ camera }) => camera.lookAt(0, 0, 0.5)}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[4, 14, 6]} intensity={2.2} castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={8} shadow-camera-bottom={-8} />
        <pointLight position={[-6, 6, -3]} intensity={30} color="#ffd9a0" />
        <mesh rotation-x={-Math.PI / 2} receiveShadow>
          <planeGeometry args={[40, 30]} />
          <shadowMaterial opacity={0.35} />
        </mesh>
        <Throw key={roll.id} dice={dice} color={color} onSettled={onSettled} />
      </Canvas>
    </div>
  );
}
