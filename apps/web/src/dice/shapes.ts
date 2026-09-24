import * as THREE from "three";

/**
 * Polyhedral dice: shared geometry data for rendering (three.js) and physics (cannon-es).
 * A shape is a convex polyhedron with polygon faces wound CCW when seen from outside.
 */
export type DieKind = "d4" | "d6" | "d8" | "d10" | "d12" | "d20";

export interface DieShape {
  kind: DieKind;
  vertices: THREE.Vector3[];
  faces: number[][];
  normals: THREE.Vector3[];
  /** d4 is read from the top vertex, every other die from the top face. */
  readVertex: boolean;
}

const RADIUS: Record<DieKind, number> = { d4: 1.2, d6: 0.95, d8: 1.05, d10: 1.0, d12: 1.05, d20: 1.1 };

function key(v: THREE.Vector3) {
  return `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
}

function sortCCW(verts: THREE.Vector3[], idx: number[], normal: THREE.Vector3): number[] {
  const c = new THREE.Vector3();
  idx.forEach((i) => c.add(verts[i]));
  c.divideScalar(idx.length);
  const u = verts[idx[0]].clone().sub(c).normalize();
  const w = new THREE.Vector3().crossVectors(normal, u);
  return [...idx].sort((a, b) => {
    const pa = verts[a].clone().sub(c);
    const pb = verts[b].clone().sub(c);
    return Math.atan2(pa.dot(w), pa.dot(u)) - Math.atan2(pb.dot(w), pb.dot(u));
  });
}

function faceNormal(verts: THREE.Vector3[], face: number[]): THREE.Vector3 {
  const [a, b, c] = face.map((i) => verts[i]);
  return new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
}

/** Build a shape from any three.js polyhedron geometry by merging coplanar triangles. */
function fromGeometry(kind: DieKind, geo: THREE.BufferGeometry): DieShape {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.getAttribute("position");
  const verts: THREE.Vector3[] = [];
  const lookup = new Map<string, number>();
  const idxOf = (v: THREE.Vector3) => {
    const k = key(v);
    let i = lookup.get(k);
    if (i === undefined) {
      i = verts.length;
      verts.push(v.clone());
      lookup.set(k, i);
    }
    return i;
  };
  const groups: { normal: THREE.Vector3; idx: Set<number> }[] = [];
  for (let t = 0; t < pos.count; t += 3) {
    const tri = [0, 1, 2].map((j) => new THREE.Vector3().fromBufferAttribute(pos, t + j));
    const n = new THREE.Vector3().subVectors(tri[1], tri[0]).cross(new THREE.Vector3().subVectors(tri[2], tri[0])).normalize();
    let grp = groups.find((gr) => gr.normal.dot(n) > 0.999);
    if (!grp) {
      grp = { normal: n, idx: new Set() };
      groups.push(grp);
    }
    tri.forEach((v) => grp!.idx.add(idxOf(v)));
  }
  const faces = groups.map((gr) => sortCCW(verts, [...gr.idx], gr.normal));
  return finish(kind, verts, faces);
}

/** Pentagonal trapezohedron (d10): kites are planar when ringY = h * (1 - cos36) / (1 + cos36). */
function d10(): DieShape {
  const h = 1.15;
  const cos36 = Math.cos(Math.PI / 5);
  const ringY = (h * (1 - cos36)) / (1 + cos36);
  const verts = [new THREE.Vector3(0, h, 0), new THREE.Vector3(0, -h, 0)];
  for (let k = 0; k < 10; k++) {
    const a = (k * Math.PI) / 5;
    verts.push(new THREE.Vector3(Math.cos(a), k % 2 === 0 ? ringY : -ringY, Math.sin(a)));
  }
  const ring = (k: number) => 2 + (((k % 10) + 10) % 10);
  const faces: number[][] = [];
  for (let j = 0; j < 5; j++) {
    faces.push([0, ring(2 * j), ring(2 * j + 1), ring(2 * j + 2)]);
    faces.push([1, ring(2 * j + 1), ring(2 * j + 2), ring(2 * j + 3)]);
  }
  const oriented = faces.map((f) => {
    const c = new THREE.Vector3();
    f.forEach((i) => c.add(verts[i]));
    return sortCCW(verts, f, c.normalize());
  });
  return finish("d10", verts, oriented);
}

function finish(kind: DieKind, verts: THREE.Vector3[], faces: number[][]): DieShape {
  const maxR = Math.max(...verts.map((v) => v.length()));
  const scale = RADIUS[kind] / maxR;
  const scaled = verts.map((v) => v.clone().multiplyScalar(scale));
  // Guarantee outward winding.
  const fixed = faces.map((f) => {
    const n = faceNormal(scaled, f);
    const c = new THREE.Vector3();
    f.forEach((i) => c.add(scaled[i]));
    return n.dot(c) < 0 ? [...f].reverse() : f;
  });
  return { kind, vertices: scaled, faces: fixed, normals: fixed.map((f) => faceNormal(scaled, f)), readVertex: kind === "d4" };
}

const cache = new Map<DieKind, DieShape>();
export function dieShape(kind: DieKind): DieShape {
  let s = cache.get(kind);
  if (!s) {
    s =
      kind === "d4"
        ? fromGeometry(kind, new THREE.TetrahedronGeometry(1))
        : kind === "d6"
          ? fromGeometry(kind, new THREE.BoxGeometry(1, 1, 1))
          : kind === "d8"
            ? fromGeometry(kind, new THREE.OctahedronGeometry(1))
            : kind === "d10"
              ? d10()
              : kind === "d12"
                ? fromGeometry(kind, new THREE.DodecahedronGeometry(1))
                : fromGeometry(kind, new THREE.IcosahedronGeometry(1));
    cache.set(kind, s);
  }
  return s;
}

export function faceCount(kind: DieKind) {
  return parseInt(kind.slice(1), 10);
}

/**
 * Default labels (value per face, or per vertex for d4): opposite faces sum to n+1 where a
 * direct opposite exists, like real dice.
 */
export function defaultLabels(shape: DieShape): number[] {
  const n = faceCount(shape.kind);
  if (shape.readVertex) return shape.vertices.map((_, i) => i + 1);
  const labels = new Array<number>(shape.faces.length).fill(0);
  let next = 1;
  for (let i = 0; i < shape.faces.length; i++) {
    if (labels[i]) continue;
    labels[i] = next;
    let opp = -1;
    let best = -0.99;
    shape.normals.forEach((nrm, j) => {
      if (j !== i && !labels[j] && nrm.dot(shape.normals[i]) < best) {
        best = nrm.dot(shape.normals[i]);
        opp = j;
      }
    });
    if (opp >= 0 && n + 1 - next !== next) labels[opp] = n + 1 - next;
    next++;
    while (labels.includes(next)) next++;
  }
  // Fill any face left unlabelled (odd pairings).
  for (let i = 0; i < labels.length; i++) if (!labels[i]) labels[i] = [...Array(n)].map((_, k) => k + 1).find((v) => !labels.includes(v))!;
  return labels;
}

/** Index of the face (or d4 vertex) that ended up on top for a body orientation. */
export function topIndex(shape: DieShape, q: THREE.Quaternion): number {
  const up = new THREE.Vector3(0, 1, 0);
  let best = -Infinity;
  let idx = 0;
  const list = shape.readVertex ? shape.vertices : shape.normals;
  list.forEach((v, i) => {
    const y = v.clone().applyQuaternion(q).dot(up) / (shape.readVertex ? v.length() : 1);
    if (y > best) {
      best = y;
      idx = i;
    }
  });
  return idx;
}

/** Swap labels so `value` sits on the given index (the one that lands up). */
export function forceLabel(labels: number[], topIdx: number, value: number): number[] {
  const out = [...labels];
  const j = out.indexOf(value);
  if (j < 0 || j === topIdx) return out;
  [out[j], out[topIdx]] = [out[topIdx], out[j]];
  return out;
}

export type LabelStyle = "plain" | "d10" | "percentile";

export function labelText(value: number, style: LabelStyle): string {
  if (style === "d10") return String(value % 10);
  if (style === "percentile") return value % 10 === 0 ? "00" : String((value % 10) * 10);
  return String(value);
}

function drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, rot = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.font = `800 ${size}px Cinzel, Georgia, serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = size * 0.08;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = "#fbf6e6";
  ctx.fillText(text, 0, 0);
  if (text === "6" || text === "9") ctx.fillRect(-size * 0.22, size * 0.42, size * 0.44, size * 0.07);
  ctx.restore();
}

/**
 * Build a BufferGeometry with one material group per face and per-face UVs mapping the
 * polygon into [0,1]^2, plus matching canvas-texture materials showing the labels.
 */
export function buildDieMesh(shape: DieShape, labels: number[], color: string, style: LabelStyle) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  const geo = new THREE.BufferGeometry();
  const materials: THREE.Material[] = [];
  const TEX = 256;

  shape.faces.forEach((face, fi) => {
    const n = shape.normals[fi];
    const center = new THREE.Vector3();
    face.forEach((i) => center.add(shape.vertices[i]));
    center.divideScalar(face.length);
    const u = shape.vertices[face[0]].clone().sub(center).normalize();
    const w = new THREE.Vector3().crossVectors(n, u);
    const proj = face.map((i) => {
      const p = shape.vertices[i].clone().sub(center);
      return [p.dot(u), p.dot(w)] as const;
    });
    const r = Math.max(...proj.map(([a, b]) => Math.hypot(a, b)));
    const uv = proj.map(([a, b]) => [0.5 + (a / r) * 0.5, 0.5 + (b / r) * 0.5] as const);

    const start = positions.length / 3;
    for (let k = 1; k < face.length - 1; k++) {
      for (const idx of [0, k, k + 1]) {
        const v = shape.vertices[face[idx]];
        positions.push(v.x, v.y, v.z);
        normals.push(n.x, n.y, n.z);
        uvs.push(uv[idx][0], uv[idx][1]);
      }
    }
    geo.addGroup(start, positions.length / 3 - start, fi);

    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = TEX;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, TEX, TEX);
    if (shape.readVertex) {
      // d4: each face shows the numbers of its three corners, pointing at their corner.
      face.forEach((vi, k) => {
        const [cu, cv] = uv[k];
        const x = (0.5 + (cu - 0.5) * 0.55) * TEX;
        const y = (1 - (0.5 + (cv - 0.5) * 0.55)) * TEX;
        const rot = Math.atan2(cu - 0.5, cv - 0.5);
        drawLabel(ctx, String(labels[vi]), x, y, TEX * 0.2, rot);
      });
    } else {
      const size = face.length >= 5 ? 0.34 : face.length === 4 && shape.kind !== "d10" ? 0.45 : shape.kind === "d20" ? 0.26 : 0.32;
      drawLabel(ctx, labelText(labels[fi], style), TEX / 2, TEX / 2, TEX * size * (style === "percentile" ? 0.8 : 1));
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    materials.push(new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.35, metalness: 0.05, clearcoat: 0.8, clearcoatRoughness: 0.2 }));
  });

  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  return { geometry: geo, materials };
}

export function kindForSides(sides: number): DieKind | undefined {
  return ({ 4: "d4", 6: "d6", 8: "d8", 10: "d10", 12: "d12", 20: "d20" } as Record<number, DieKind>)[sides];
}
