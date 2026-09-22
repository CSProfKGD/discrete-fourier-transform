/** Forward: sum f(x,y) exp(-i 2π(ux/W + vy/H)); inverse: opposite sign / WH. */
export const WIDTH = 512;
export const HEIGHT = 384;
export const BRUSH_DIAMETER = { min: 5, max: 80, initial: 20 } as const;
export type Preset = 'low' | 'band' | 'high';
export type Point = { x: number; y: number };
const TAU = 2 * Math.PI;

/** Reusable mixed-radix Cooley–Tukey plan. All working lengths factor into 2 and 3. */
class FFTPlan {
  readonly n: number;
  readonly radix: number;
  readonly child: FFTPlan | null;
  readonly cos: Float64Array;
  readonly sin: Float64Array;
  readonly tempRe: Float64Array;
  readonly tempIm: Float64Array;

  constructor(n: number) {
    if (!Number.isInteger(n) || n < 1) throw new Error('Invalid FFT length');
    this.n = n;
    this.radix = n === 1 ? 1 : n % 2 === 0 ? 2 : n % 3 === 0 ? 3 : 0;
    if (!this.radix) throw new Error('FFT length must factor into 2 and 3');
    this.child = n > 1 ? new FFTPlan(n / this.radix) : null;
    this.cos = Float64Array.from({ length: n }, (_, k) => Math.cos(TAU * k / n));
    this.sin = Float64Array.from({ length: n }, (_, k) => Math.sin(TAU * k / n));
    this.tempRe = new Float64Array(n);
    this.tempIm = new Float64Array(n);
  }

  run(re: Float64Array, im: Float64Array, start: number, stride: number,
    outRe: Float64Array, outIm: Float64Array, offset: number, inverse: boolean) {
    const n = this.n;
    if (n === 1) { outRe[offset] = re[start]; outIm[offset] = im[start]; return; }
    const r = this.radix;
    const m = n / r;
    for (let j = 0; j < r; j++) {
      this.child!.run(re, im, start + j * stride, stride * r, outRe, outIm, offset + j * m, inverse);
    }
    const sign = inverse ? 1 : -1;
    if (r === 2) {
      for (let k = 0; k < m; k++) {
        const a = offset + k, b = a + m;
        const c = this.cos[k], s = sign * this.sin[k];
        const br = outRe[b] * c - outIm[b] * s;
        const bi = outRe[b] * s + outIm[b] * c;
        this.tempRe[k] = outRe[a] + br;
        this.tempIm[k] = outIm[a] + bi;
        this.tempRe[k + m] = outRe[a] - br;
        this.tempIm[k + m] = outIm[a] - bi;
      }
    } else {
      for (let k = 0; k < n; k++) {
        let real = 0, imag = 0;
        for (let j = 0; j < r; j++) {
          const index = offset + j * m + k % m;
          const twiddle = j * k % n;
          const c = this.cos[twiddle], s = sign * this.sin[twiddle];
          real += outRe[index] * c - outIm[index] * s;
          imag += outRe[index] * s + outIm[index] * c;
        }
        this.tempRe[k] = real;
        this.tempIm[k] = imag;
      }
    }
    outRe.set(this.tempRe, offset);
    outIm.set(this.tempIm, offset);
  }
}

export class Fourier2D {
  readonly width: number;
  readonly height: number;
  readonly re: Float64Array;
  readonly im: Float64Array;
  private readonly row: FFTPlan;
  private readonly column: FFTPlan;
  private readonly stageRe: Float64Array;
  private readonly stageIm: Float64Array;
  private readonly columnRe: Float64Array;
  private readonly columnIm: Float64Array;

  constructor(width: number, height: number) {
    this.width = width; this.height = height;
    this.row = new FFTPlan(width); this.column = new FFTPlan(height);
    this.re = new Float64Array(width * height); this.im = new Float64Array(width * height);
    this.stageRe = new Float64Array(width * height); this.stageIm = new Float64Array(width * height);
    this.columnRe = new Float64Array(height); this.columnIm = new Float64Array(height);
  }

  /** Returned arrays belong to the plan and are overwritten by the next transform. */
  transform(re: Float64Array, im: Float64Array, inverse = false) {
    const w = this.width, h = this.height;
    if (re.length !== w * h || im.length !== w * h) throw new Error('Incorrect image dimensions');
    for (let y = 0; y < h; y++) this.row.run(re, im, y * w, 1, this.stageRe, this.stageIm, y * w, inverse);
    const scale = inverse ? 1 / (w * h) : 1;
    for (let x = 0; x < w; x++) {
      this.column.run(this.stageRe, this.stageIm, x, w, this.columnRe, this.columnIm, 0, inverse);
      for (let y = 0; y < h; y++) {
        this.re[y * w + x] = this.columnRe[y] * scale;
        this.im[y * w + x] = this.columnIm[y] * scale;
      }
    }
    return { re: this.re, im: this.im };
  }
}

export function conjugateIndex(index: number, width: number, height: number) {
  return ((height - Math.floor(index / width)) % height) * width + (width - index % width) % width;
}

export function signedBin(bin: number, size: number) { return bin < size / 2 ? bin : bin - size; }

export function presetMask(preset: Preset, width: number, height: number) {
  // A displayed bin has the same pixel size in both axes. Normalize both axes
  // by the shorter dimension so radial masks are circles on the 4:3 stage.
  const radiusScale = Math.min(width, height);
  return Float64Array.from({ length: width * height }, (_, index) => {
    const r2 = (signedBin(index % width, width) / radiusScale) ** 2 +
      (signedBin(Math.floor(index / width), height) / radiusScale) ** 2;
    const low = (sigma: number) => Math.exp(-r2 / (2 * sigma * sigma));
    if (preset === 'band') {
      const radius = Math.sqrt(r2);
      const ramp = (from: number, to: number) => {
        const t = Math.max(0, Math.min(1, (radius - from) / (to - from)));
        return .5 - .5 * Math.cos(Math.PI * t);
      };
      return ramp(.035, .055) * (1 - ramp(.14, .18));
    }
    return preset === 'low' ? low(.055) : 1 - low(.085);
  });
}

function wrappedDistance(a: number, b: number, size: number) {
  const d = Math.abs(a - b) % size;
  return Math.min(d, size - d);
}

const brushScratch = new WeakMap<Float64Array, { visited: Uint32Array; generation: number }>();

/** Apply each unordered conjugate pair exactly once, using the union (max) of the two footprints. */
export function attenuate(mask: Float64Array, width: number, height: number, point: Point, seconds: number, diameter: number = BRUSH_DIAMETER.initial) {
  if (seconds <= 0) return;
  const scale = diameter / 4;
  const extent = diameter * .75;
  const cx = (width - point.x) % width, cy = (height - point.y) % height;
  let scratch = brushScratch.get(mask);
  if (!scratch) { scratch = { visited: new Uint32Array(mask.length), generation: 0 }; brushScratch.set(mask, scratch); }
  scratch.generation = (scratch.generation + 1) >>> 0;
  if (scratch.generation === 0) { scratch.visited.fill(0); scratch.generation = 1; }
  // Visit only the bounded footprints, not the entire image for every stroke sample.
  // Generation tags deduplicate overlapping footprints and small periodic domains.
  for (const center of [point, { x: cx, y: cy }]) {
    for (let py = Math.ceil(center.y - extent); py <= Math.floor(center.y + extent); py++) {
      const y = ((py % height) + height) % height;
      for (let px = Math.ceil(center.x - extent); px <= Math.floor(center.x + extent); px++) {
        const x = ((px % width) + width) % width;
        const i = y * width + x, pair = conjugateIndex(i, width, height);
        if (i > pair || scratch.visited[i] === scratch.generation) continue;
        scratch.visited[i] = scratch.generation;
        const d1 = wrappedDistance(x, point.x, width) ** 2 + wrappedDistance(y, point.y, height) ** 2;
        const d2 = wrappedDistance(x, cx, width) ** 2 + wrappedDistance(y, cy, height) ** 2;
        const d2min = Math.min(d1, d2);
        if (d2min > extent * extent) continue;
        // A super-Gaussian retains a soft edge but gives the brush a firmer center.
        const footprint = Math.exp(-.5 * (d2min / (scale * scale)) ** 2);
        const gain = Math.exp(-18 * seconds * footprint);
        mask[i] *= gain;
        mask[pair] = mask[i];
      }
    }
  }
}

export function brushSegment(mask: Float64Array, width: number, height: number, from: Point, to: Point, seconds: number, diameter: number = BRUSH_DIAMETER.initial) {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / (diameter / 8)));
  for (let step = 1; step <= steps; step++) {
    const t = (step - .5) / steps;
    attenuate(mask, width, height, { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, seconds / steps, diameter);
  }
}

/** Arc-length spaced stamps make moving strokes independent of event and frame rates. */
export class BrushStroke {
  private readonly mask: Float64Array;
  private readonly width: number;
  private readonly height: number;
  readonly diameter: number;
  private point: Point;
  private remainder = 0;
  private lastMove: number;
  private lastHold: number;
  private readonly dose = .035;

  constructor(mask: Float64Array, width: number, height: number, point: Point, time: number, diameter: number) {
    this.mask = mask; this.width = width; this.height = height; this.point = point;
    this.lastMove = time; this.lastHold = time; this.diameter = diameter;
    this.stamp(point, this.dose);
  }
  private stamp(point: Point, seconds: number) {
    attenuate(this.mask, this.width, this.height, point, seconds, this.diameter);
  }
  move(to: Point, time: number) {
    const from = this.point;
    const dx = to.x - from.x, dy = to.y - from.y, distance = Math.hypot(dx, dy);
    if (distance === 0) return;
    const spacing = this.diameter / 8;
    let along = spacing - this.remainder;
    while (along <= distance + 1e-10) {
      const t = Math.min(1, along / distance);
      this.stamp({ x: from.x + t * dx, y: from.y + t * dy }, this.dose);
      along += spacing;
    }
    this.remainder = Math.max(0, distance - (along - spacing));
    this.point = to; this.lastMove = time; this.lastHold = time;
  }
  hold(time: number) {
    // Brief gaps between pointer events are still part of a moving stroke.
    // Only deliberate dwelling adds time-based exposure; frame partitioning cancels.
    const elapsed = Math.max(0, (time - Math.max(this.lastHold, this.lastMove + 80)) / 1000);
    if (elapsed > 0) this.stamp(this.point, elapsed);
    this.lastHold = Math.max(time, this.lastHold);
  }
  end(time: number) {
    this.hold(time);
    if (this.remainder > 1e-10) this.stamp(this.point, this.dose * this.remainder / (this.diameter / 8));
    this.remainder = 0;
  }
}

export function pairValue(re: number, im: number, u: number, v: number, x: number, y: number, width: number, height: number) {
  const i = v * width + u;
  const factor = conjugateIndex(i, width, height) === i ? 1 : 2;
  const angle = TAU * (signedBin(u, width) * x / width + signedBin(v, height) * y / height);
  return factor * (re * Math.cos(angle) - im * Math.sin(angle)) / (width * height);
}

export function displayValue(value: number, dcGain: number) {
  return Math.max(0, Math.min(1, value + .5 * (1 - dcGain)));
}

export class EditHistory {
  mask: Float64Array;
  previous: Float64Array | null = null;
  animation: { from: Float64Array; to: Float64Array; start: number } | null = null;
  constructor(size: number) { this.mask = new Float64Array(size).fill(1); }
  begin() { this.animation = null; this.previous = this.mask.slice(); }
  transition(target: Float64Array, now: number, reducedMotion: boolean) {
    this.begin();
    if (reducedMotion) this.mask.set(target);
    else this.animation = { from: this.mask.slice(), to: target, start: now };
  }
  advance(now: number) {
    if (!this.animation) return false;
    const { from, to, start } = this.animation;
    const t = Math.max(0, Math.min(1, (now - start) / 400));
    const mix = t * t * (3 - 2 * t);
    for (let i = 0; i < this.mask.length; i++) this.mask[i] = from[i] + (to[i] - from[i]) * mix;
    if (t === 1) this.animation = null;
    return true;
  }
  undo(now = 0, reducedMotion = true) {
    if (!this.previous) return;
    const target = this.previous;
    this.previous = null;
    if (reducedMotion) { this.animation = null; this.mask.set(target); }
    else this.animation = { from: this.mask.slice(), to: target, start: now };
  }
}
