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
}

export const SIM_HZ = 60;
const MAX_FRAMES = SIM_HZ * 6;
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

  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -40, 0), allowSleep: true });
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
  let still = 0;
  for (let f = 0; f < MAX_FRAMES; f++) {
    world.step(1 / SIM_HZ);
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
    return { ...d, labels: forceLabel(defaultLabels(shape), top, d.target), frames: Float32Array.from(frames[i]) };
  });
}
