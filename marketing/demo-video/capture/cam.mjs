// Live TV camera moves through the map's OrbitControls: right-drag pans, wheel zooms, left-drag orbits.
import { sleep } from "./recorder.mjs";

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

async function drag(page, button, from, to, ms) {
  const steps = Math.max(2, Math.round(ms / 16));
  await page.mouse.move(...from);
  await page.mouse.down({ button });
  for (let i = 1; i <= steps; i++) {
    const t = ease(i / steps);
    await page.mouse.move(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t);
    await sleep(16);
  }
  await page.mouse.up({ button });
}

/** Drag the map so the point under `from` ends under `to` (screen px). */
export const pan = (page, from, to, ms = 1200) => drag(page, "right", from, to, ms);
/** Orbit by dragging dx/dy px from the board centre. */
export const orbit = (page, dx, dy = 0, ms = 2000) => drag(page, "left", [780, 540], [780 + dx, 540 + dy], ms);
/** Smooth zoom: n wheel notches (negative = in), spread over ms. */
export async function zoom(page, notches, ms = 1200, at = [780, 540]) {
  await page.mouse.move(...at);
  const n = Math.abs(notches) * 4;
  for (let i = 0; i < n; i++) {
    await page.mouse.wheel(0, Math.sign(notches) * 30);
    await sleep(ms / n);
  }
}
