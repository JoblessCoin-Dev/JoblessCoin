// Turns the JoblessCoin mark (01-Icon SVG) into particle targets. All coordinates are in the
// SVG's own 1024 x 1024 space; the shader converts them to world space.

export const RING_PATH =
  "M754.52,351.46 A336.76,336.76 0 1 1 579.21,255.12 L560.9,328.53 A261.19,261.19 0 1 0 731.55,443.61 Z";
export const J_PATH =
  "M774.52,121.86 L659.84,581.82 C636.32,676.17 540.76,752.66 446.41,752.66 C352.05,752.66 294.64,676.17 318.16,581.82 L443.01,581.82 C436.67,607.22 452.13,627.81 477.53,627.81 C502.94,627.81 528.66,607.22 535,581.82 L649.68,121.86 Z";

const OUTER_R = 336.76;
const INNER_R = 261.19;

type P = [number, number];

/** Center of the circle of radius r through a and b that is also `innerR` away from c. */
function ringCenter(a: P, b: P, r: number, c: P, innerR: number): P {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const half = Math.hypot(dx, dy) / 2;
  const d = Math.sqrt(r * r - half * half);
  const nx = -dy / (2 * half), ny = dx / (2 * half);
  const candidates: P[] = [[mx + nx * d, my + ny * d], [mx - nx * d, my - ny * d]];
  const err = (p: P) => Math.abs(Math.hypot(c[0] - p[0], c[1] - p[1]) - innerR);
  return err(candidates[0]) < err(candidates[1]) ? candidates[0] : candidates[1];
}

const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export interface LogoGeometry {
  center: P;
  innerR: number;
  outerR: number;
  gapAngle: number; // center of the opening the J breaks through
  gapHalf: number;
  jCentroid: P;
  /** ring particles: polar (angle, radius) around center, on a closed ring */
  ring: Float32Array;
  /** J particles: target x, y in SVG space */
  j: Float32Array;
}

let seed = 1337;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

export function buildLogo(ringCount: number, jCount: number): LogoGeometry {
  const center = ringCenter([754.52, 351.46], [579.21, 255.12], OUTER_R, [560.9, 328.53], INNER_R);
  const a1 = Math.atan2(351.46 - center[1], 754.52 - center[0]);
  const a2 = Math.atan2(255.12 - center[1], 579.21 - center[0]);
  const gapHalf = Math.abs(angDiff(a1, a2)) / 2;
  const gapAngle = a2 + angDiff(a1, a2) / 2;

  // Closed ring: the loop before anything breaks it. Area-uniform radius.
  const ring = new Float32Array(ringCount * 2);
  for (let i = 0; i < ringCount; i++) {
    const t = rand();
    ring[i * 2] = rand() * Math.PI * 2;
    ring[i * 2 + 1] = Math.sqrt(INNER_R * INNER_R + t * (OUTER_R * OUTER_R - INNER_R * INNER_R));
  }

  // J: rejection sampling inside the real J outline.
  const ctx = document.createElement("canvas").getContext("2d")!;
  const jPath = new Path2D(J_PATH);
  const j = new Float32Array(jCount * 2);
  let sx = 0, sy = 0;
  for (let i = 0, guard = 0; i < jCount && guard < jCount * 60; guard++) {
    const x = 300 + rand() * 480, y = 110 + rand() * 650;
    if (!ctx.isPointInPath(jPath, x, y)) continue;
    j[i * 2] = x;
    j[i * 2 + 1] = y;
    sx += x;
    sy += y;
    i++;
  }
  return {
    center, innerR: INNER_R, outerR: OUTER_R, gapAngle, gapHalf,
    jCentroid: [sx / jCount, sy / jCount], ring, j,
  };
}
