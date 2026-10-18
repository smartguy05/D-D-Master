import { cellsInRect } from "./fog.js";
import type { Location, MapFeature } from "./schemas.js";

/**
 * Map features: landmarks read off a painted map image, in grid cells. The map texture is
 * stretched exactly over the grid, so a fraction of the image is the same fraction of the board.
 */

/** How far (in cells) a lit feature's glow reaches through fog. */
export const LIT_FEATURE_RADIUS = 2;

/** A feature as the vision model reports it: a box in image fractions [x0, y0, x1, y1] (0..1). */
export interface FeatureBox {
  name: string;
  kind: MapFeature["kind"];
  lit: boolean;
  box: [number, number, number, number];
}

type Grid = Pick<Location, "gridW" | "gridH" | "features">;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function featureFromBox(b: FeatureBox, gridW: number, gridH: number): MapFeature {
  const [ax, ay, bx, by] = b.box;
  const x0 = clamp(Math.floor(Math.min(ax, bx) * gridW), 0, gridW - 1);
  const y0 = clamp(Math.floor(Math.min(ay, by) * gridH), 0, gridH - 1);
  const x1 = clamp(Math.ceil(Math.max(ax, bx) * gridW) - 1, x0, gridW - 1);
  const y1 = clamp(Math.ceil(Math.max(ay, by) * gridH) - 1, y0, gridH - 1);
  return { name: b.name, kind: b.kind, lit: b.lit, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function featureCenter(f: MapFeature): { x: number; y: number } {
  return { x: f.x + Math.floor((f.w - 1) / 2), y: f.y + Math.floor((f.h - 1) / 2) };
}

/** Where the party arrives: the entrance, stepped one cell in from the board edge (default: left edge, middle row). */
export function entryCell(loc: Grid): { x: number; y: number } {
  const door = loc.features.find((f) => f.kind === "entrance");
  if (!door) return { x: 1, y: Math.floor(loc.gridH / 2) };
  const c = featureCenter(door);
  return { x: clamp(c.x, 1, loc.gridW - 2), y: clamp(c.y, 1, loc.gridH - 2) };
}

/** Default monster spawn: the focal feature (default: toward the right edge, middle row). */
export function spawnCell(loc: Grid): { x: number; y: number } {
  const focal = loc.features.find((f) => f.kind === "focal");
  return focal ? featureCenter(focal) : { x: loc.gridW - 3, y: Math.floor(loc.gridH / 2) };
}

/** Cells lit by `lit` features (their box grown by LIT_FEATURE_RADIUS), clipped to the grid. */
export function litFeatureCells(loc: Grid): string[] {
  const r = LIT_FEATURE_RADIUS;
  return loc.features.filter((f) => f.lit).flatMap((f) => cellsInRect(f.x - r, f.y - r, f.w + 2 * r, f.h + 2 * r, loc.gridW, loc.gridH));
}

/** One line per feature for the DM's instructions, e.g. "- altar (focal, lit): x 11-15, y 1-5". */
export function describeFeatures(features: MapFeature[]): string {
  const span = (a: number, n: number) => (n > 1 ? `${a}-${a + n - 1}` : `${a}`);
  return features
    .map((f) => {
      const tags = [f.kind !== "feature" ? f.kind : "", f.lit ? "lit" : ""].filter(Boolean).join(", ");
      return `- ${f.name}${tags ? ` (${tags})` : ""}: x ${span(f.x, f.w)}, y ${span(f.y, f.h)}`;
    })
    .join("\n");
}
