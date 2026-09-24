import * as CANNON from "cannon-es";
import * as THREE from "three";
import type { DieRoll } from "@dm/shared";
import { defaultLabels, dieShape, forceLabel, kindForSides, topIndex, type DieKind, type LabelStyle } from "./shapes";

export interface VisualDie {
  kind: DieKind;
  /** Face value that must end up on top. */
  target: number;
  style: LabelStyle;
  dropped: boolean;
}

export interface SimulatedDie extends VisualDie {
  labels: number[];
  /** Per-frame position (x,y,z) and quaternion (x,y,z,w). */
  frames: Float32Array;
  /** Collisions recorded during the simulation, for clatter sounds on playback. */
  impacts: DiceImpact[];
}

/** One recorded collision: the frame it happened on, how hard (0..1) and what the die hit. */
export interface DiceImpact {
  frame: number;
  strength: number;
  surface: "table" | "die";
}

/** Velocity change (beyond gravity) that counts as a collision, in units/s. */
const IMPACT_MIN_DV = 1.5;
/** Velocity change that maps to full strength. */
const IMPACT_FULL_DV = 22;
/** Frames during which the same die does not record another impact. */
const IMPACT_GAP = 3;

export const SIM_HZ = 60;
const MAX_FRAMES = SIM_HZ * 6;
const GRAVITY = -40;
export const TRAY = { halfW: 9, halfD: 5 };

/** Convert server dice results into dice to throw (d100 becomes a percentile + a d10). */
export function toVisualDice(dice: DieRoll[], limit = 12): VisualDie[] {
  const out: VisualDie[] = [];
  for (const d of dice) {
    if (d.sides === 100) {
      const ones = d.value % 10;
      const tens = Math.floor(d.value / 10) % 10;
      out.push({ kind: "d10", target: tens === 0 ? 10 : tens, style: "percentile", dropped: !!d.dropped });
      out.push({ kind: "d10", target: ones === 0 ? 10 : ones, style: "d10", dropped: !!d.dropped });
      continue;
    }
    const kind = kindForSides(d.sides);
    if (kind) out.push({ kind, target: d.value, style: kind === "d10" ? "d10" : "plain", dropped: !!d.dropped });
  }
  return out.slice(0, limit);
}

function bodyFor(kind: DieKind) {
  const s = dieShape(kind);
  const shape = new CANNON.ConvexPolyhedron({
    vertices: s.vertices.map((v) => new CANNON.Vec3(v.x, v.y, v.z)),
    faces: s.faces,
  });
  const body = new CANNON.Body({ mass: 1, shape, allowSleep: true, sleepSpeedLimit: 0.15, sleepTimeLimit: 0.4 });
  body.linearDamping = 0.1;
  body.angularDamping = 0.1;
  return body;
}

/**
 * Throw the dice in an offline physics world, record every frame, then relabel each die so
 * the face that physically landed on top shows the server's result. Playback is therefore
 * real physics that always agrees with the authoritative roll.
 */
export function simulateThrow(dice: VisualDie[], seed = Math.random()): SimulatedDie[] {
  let r = seed * 2147483647 || 1;
  const rand = () => ((r = (r * 16807) % 2147483647) - 1) / 2147483646;

  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, GRAVITY, 0), allowSleep: true });
  world.broadphase = new CANNON.NaiveBroadphase();
  const diceMat = new CANNON.Material("dice");
  const floorMat = new CANNON.Material("floor");
  world.addContactMaterial(new CANNON.ContactMaterial(diceMat, floorMat, { friction: 0.35, restitution: 0.45 }));
  world.addContactMaterial(new CANNON.ContactMaterial(diceMat, diceMat, { friction: 0.2, restitution: 0.4 }));

  const addPlane = (pos: CANNON.Vec3, euler: [number, number, number]) => {
    const b = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), material: floorMat });
    b.position.copy(pos);
    b.quaternion.setFromEuler(...euler);
    world.addBody(b);
  };
  addPlane(new CANNON.Vec3(0, 0, 0), [-Math.PI / 2, 0, 0]);
  addPlane(new CANNON.Vec3(-TRAY.halfW, 0, 0), [0, Math.PI / 2, 0]);
  addPlane(new CANNON.Vec3(TRAY.halfW, 0, 0), [0, -Math.PI / 2, 0]);
  addPlane(new CANNON.Vec3(0, 0, -TRAY.halfD), [0, 0, 0]);
  addPlane(new CANNON.Vec3(0, 0, TRAY.halfD), [0, Math.PI, 0]);

  const bodies = dice.map((d, i) => {
    const b = bodyFor(d.kind);
    b.material = diceMat;
    const row = i % 4;
    const col = Math.floor(i / 4);
    b.position.set(-TRAY.halfW + 1.5 + col * 1.6, 3 + rand() * 2, -2.4 + row * 1.6 + rand() * 0.4);
    b.quaternion.setFromEuler(rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI * 2);
    b.velocity.set(14 + rand() * 8, 2 + rand() * 3, (rand() - 0.5) * 8);
    b.angularVelocity.set((rand() - 0.5) * 30, (rand() - 0.5) * 30, (rand() - 0.5) * 30);
    world.addBody(b);
    return b;
  });

  const frames: number[][] = dice.map(() => []);
  const impacts: DiceImpact[][] = dice.map(() => []);
  const lastImpact = dice.map(() => -IMPACT_GAP);
  const prevVel = bodies.map((b) => b.velocity.clone());
  let still = 0;
  for (let f = 0; f < MAX_FRAMES; f++) {
    bodies.forEach((b, i) => prevVel[i].copy(b.velocity));
    world.step(1 / SIM_HZ);
    recordImpacts(bodies, prevVel, f, impacts, lastImpact);
    bodies.forEach((b, i) => frames[i].push(b.position.x, b.position.y, b.position.z, b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w));
    const resting = bodies.every((b) => b.sleepState === CANNON.Body.SLEEPING || (b.velocity.length() < 0.08 && b.angularVelocity.length() < 0.15));
    still = resting ? still + 1 : 0;
    if (f > 30 && still >= 12) break;
  }

  return dice.map((d, i) => {
    const b = bodies[i];
    const q = new THREE.Quaternion(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    const shape = dieShape(d.kind);
    const top = topIndex(shape, q);
    return { ...d, labels: forceLabel(defaultLabels(shape), top, d.target), frames: Float32Array.from(frames[i]), impacts: impacts[i] };
  });
}

/**
 * A die collided this step if its velocity changed by more than gravity alone explains. The
 * surface is "die" when another die that also changed velocity is touching distance away.
 */
function recordImpacts(bodies: CANNON.Body[], prevVel: CANNON.Vec3[], frame: number, impacts: DiceImpact[][], lastImpact: number[]) {
  const dvs = bodies.map((b, i) => {
    const dx = b.velocity.x - prevVel[i].x;
    const dy = b.velocity.y - prevVel[i].y - GRAVITY / SIM_HZ;
    const dz = b.velocity.z - prevVel[i].z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  });
  bodies.forEach((b, i) => {
    if (dvs[i] < IMPACT_MIN_DV || frame - lastImpact[i] < IMPACT_GAP) return;
    const hitDie = bodies.some((o, j) => j !== i && dvs[j] >= IMPACT_MIN_DV && o.position.distanceTo(b.position) < 1.6);
    lastImpact[i] = frame;
    impacts[i].push({ frame, strength: Math.min(1, dvs[i] / IMPACT_FULL_DV), surface: hitDie ? "die" : "table" });
  });
}

/**
 * Merge every die's impacts into one playback schedule sorted by frame, keeping at most
 * `maxPerFrame` of the strongest per frame so a big handful of dice does not clip the audio.
 */
export function impactSchedule(dice: Pick<SimulatedDie, "impacts">[], maxPerFrame = 3): DiceImpact[] {
  const byFrame = new Map<number, DiceImpact[]>();
  for (const d of dice) for (const imp of d.impacts) byFrame.set(imp.frame, [...(byFrame.get(imp.frame) ?? []), imp]);
  return [...byFrame.keys()]
    .sort((a, b) => a - b)
    .flatMap((f) => byFrame.get(f)!.sort((a, b) => b.strength - a.strength).slice(0, maxPerFrame));
}
