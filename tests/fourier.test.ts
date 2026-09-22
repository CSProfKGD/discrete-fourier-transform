import test from 'node:test';
import assert from 'node:assert/strict';
import { Fourier2D, conjugateIndex, attenuate, brushSegment, BrushStroke, pairValue, presetMask, EditHistory, displayValue } from '../src/fourier.ts';

function close(actual: number, expected: number, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);
}
function symmetric(mask: Float64Array, w: number, h: number) {
  for (let i = 0; i < mask.length; i++) close(mask[i], mask[conjugateIndex(i, w, h)], 1e-14);
}

test('mixed-radix rectangular transforms agree with an independent direct complex DFT', () => {
  for (const [w, h] of [[2, 3], [8, 6], [9, 4], [16, 12]]) {
    const n = w * h;
    const re = Float64Array.from({ length: n }, (_, i) => Math.sin(i * 1.317) + .2);
    const im = Float64Array.from({ length: n }, (_, i) => Math.cos(i * .735));
    const fft = new Fourier2D(w, h);
    const result = fft.transform(re, im);
    for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) {
      let real = 0, imag = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x, a = -2 * Math.PI * (u * x / w + v * y / h);
        real += re[i] * Math.cos(a) - im[i] * Math.sin(a);
        imag += re[i] * Math.sin(a) + im[i] * Math.cos(a);
      }
      close(result.re[v * w + u], real); close(result.im[v * w + u], imag);
    }
    const back = fft.transform(result.re.slice(), result.im.slice(), true);
    for (let i = 0; i < n; i++) { close(back.re[i], re[i]); close(back.im[i], im[i]); }
  }
});

test('production-size real transform round trips and has conjugate symmetry', () => {
  const w = 512, h = 384, n = w * h;
  const source = Float64Array.from({ length: n }, (_, i) => .5 + .2 * Math.sin(i * .071) + .1 * Math.cos(i * .337));
  const fft = new Fourier2D(w, h), result = fft.transform(source, new Float64Array(n));
  const re = result.re.slice(), im = result.im.slice();
  for (let i = 0; i < n; i++) {
    const j = conjugateIndex(i, w, h); close(re[i], re[j], 1e-8); close(im[i], -im[j], 1e-8);
  }
  const back = fft.transform(re, im, true);
  for (let i = 0; i < n; i++) { close(back.re[i], source[i]); close(back.im[i], 0); }
});

test('phase-aware pair preview reproduces a known sinusoid, including sign and spatial origin', () => {
  const w = 16, h = 12, n = w * h, u = 3, v = 2, phase = .73;
  const source = Float64Array.from({ length: n }, (_, i) => .7 * Math.cos(2 * Math.PI * (u * (i % w) / w + v * Math.floor(i / w) / h) + phase));
  const result = new Fourier2D(w, h).transform(source, new Float64Array(n));
  const index = v * w + u, mate = conjugateIndex(index, w, h);
  for (let i = 0; i < n; i++) {
    close(pairValue(result.re[index], result.im[index], u, v, i % w, Math.floor(i / w), w, h), source[i]);
    close(pairValue(result.re[mate], result.im[mate], mate % w, Math.floor(mate / w), i % w, Math.floor(i / w), w, h), source[i]);
  }
});

test('DC and self-conjugate Nyquist contributions are not doubled', () => {
  const w = 16, h = 12, n = w * h;
  for (const [u, v] of [[0, 0], [w / 2, 0], [0, h / 2], [w / 2, h / 2]]) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      close(pairValue(.3 * n, 0, u, v, x, y, w, h), .3 * Math.cos(2 * Math.PI * (u * x / w + v * y / h)));
    }
  }
  close(pairValue(0, 0, 2, 3, 4, 5, w, h), 0);
});

test('brush is symmetric, wraps at boundaries, and does not double self-overlap', () => {
  const w = 64, h = 48, mask = new Float64Array(w * h).fill(1);
  attenuate(mask, w, h, { x: 0, y: 0 }, .1);
  close(mask[0], Math.exp(-1.8)); close(mask[1], mask[w - 1]); symmetric(mask, w, h);
  assert.ok(mask[2] < .18, 'The brush has a firm center');
  assert.ok(mask[10] > .999, 'The brush keeps a compact, soft outer edge');
  const a = mask.slice(), b = mask.slice();
  attenuate(a, w, h, { x: 12, y: -7 }, .1);
  for (let i = 0; i < 10; i++) attenuate(b, w, h, { x: 12, y: -7 }, .01);
  for (let i = 0; i < a.length; i++) close(a[i], b[i]);
  brushSegment(mask, w, h, { x: -20, y: 15 }, { x: 22, y: -12 }, .15);
  symmetric(mask, w, h);
  assert.ok(mask.every(value => value > 0 && value <= 1));
});

test('all presets preserve symmetry and phase, and produce a real inverse', () => {
  const w = 32, h = 24, n = w * h;
  const source = Float64Array.from({ length: n }, (_, i) => .4 + .2 * Math.sin(i * .73));
  const fft = new Fourier2D(w, h), original = fft.transform(source, new Float64Array(n));
  const re = original.re.slice(), im = original.im.slice();
  for (const preset of ['low', 'band', 'high'] as const) {
    const mask = presetMask(preset, w, h); symmetric(mask, w, h);
    close(mask[0], preset === 'low' ? 1 : 0);
    assert.ok(mask.every(value => value >= 0 && value <= 1));
    const fr = re.map((value, i) => value * mask[i]), fi = im.map((value, i) => value * mask[i]);
    for (let i = 0; i < n; i++) close(fr[i] * im[i] - fi[i] * re[i], 0);
    const back = fft.transform(fr, fi, true);
    for (const imaginary of back.im) close(imaginary, 0);
  }
  close(displayValue(.3, 1), .3); close(displayValue(-.2, 0), .3); close(displayValue(.2, 0), .7);
});

test('brush diameter changes only spatial footprint, preserving symmetry and peak strength', () => {
  const w = 128, h = 96;
  const small = new Float64Array(w * h).fill(1), large = small.slice();
  attenuate(small, w, h, { x: 0, y: 0 }, .1, 5);
  attenuate(large, w, h, { x: 0, y: 0 }, .1, 80);
  close(small[0], large[0]);
  assert.ok(small[8] > .999);
  assert.ok(large[8] < .2);
  symmetric(small, w, h); symmetric(large, w, h);
});

test('band-pass has a visible, smoothly tapered annulus with exact stop bands', () => {
  const w = 512, h = 384, mask = presetMask('band', w, h);
  for (let x = 0; x < w / 2; x++) {
    const frequency = x / Math.min(w, h);
    if (frequency <= .035 || frequency >= .18) close(mask[x], 0);
    if (frequency >= .055 && frequency <= .14) close(mask[x], 1);
    if (frequency > .035 && frequency < .055) assert.ok(mask[x] > 0 && mask[x] < 1);
    if (frequency > .14 && frequency < .18) assert.ok(mask[x] > 0 && mask[x] < 1);
  }
  symmetric(mask, w, h);
});

test('every radial preset is circular on a rectangular frequency-bin display', () => {
  const w = 512, h = 384;
  for (const preset of ['low', 'band', 'high'] as const) {
    const mask = presetMask(preset, w, h);
    for (let r = 0; r < h / 2; r++) close(mask[r], mask[r * w]);
    // Equal radii in different directions: 3²+4² = 5².
    for (let scale = 1; scale < 30; scale++) close(mask[scale * 5], mask[scale * 4 * w + scale * 3]);
    symmetric(mask, w, h);
  }
});

test('moving brush is invariant to pointer speed, event partitioning and frame timing', () => {
  const w = 128, h = 96;
  const paint = (steps: number, milliseconds: number) => {
    const mask = new Float64Array(w * h).fill(1);
    const stroke = new BrushStroke(mask, w, h, { x: -35, y: -10 }, 0, 20);
    for (let i = 1; i <= steps; i++) {
      stroke.move({ x: -35 + 70 * i / steps, y: -10 + 20 * i / steps }, milliseconds * i / steps);
      stroke.hold(milliseconds * i / steps + 5);
    }
    stroke.end(milliseconds + 5);
    return mask;
  };
  const baseline = paint(1, 20);
  for (const [steps, duration] of [[7, 140], [37, 500], [120, 1500]]) {
    const result = paint(steps, duration);
    for (let i = 0; i < result.length; i++) close(result[i], baseline[i], 1e-12);
    symmetric(result, w, h);
  }
});

test('stationary exposure is invariant to frame rate and each click immediately paints', () => {
  const w = 64, h = 48;
  const paint = (steps: number) => {
    const mask = new Float64Array(w * h).fill(1);
    const stroke = new BrushStroke(mask, w, h, { x: 0, y: 0 }, 0, 20);
    assert.ok(mask[0] < .6);
    for (let i = 1; i <= steps; i++) stroke.hold(i * 500 / steps);
    stroke.end(500);
    return mask;
  };
  const baseline = paint(1);
  for (const steps of [15, 30, 60]) {
    const result = paint(steps);
    for (let i = 0; i < result.length; i++) close(result[i], baseline[i], 1e-12);
  }
});

test('preset transitions, interruptions, reset and single-level undo use actual current masks', () => {
  const state = new EditHistory(8);
  const target = new Float64Array(8).fill(.2);
  state.transition(target, 100, false); state.advance(300); close(state.mask[0], .6);
  state.transition(new Float64Array(8).fill(.8), 300, false);
  close(state.previous![0], .6); state.advance(700); close(state.mask[0], .8); assert.equal(state.animation, null);
  state.undo(); close(state.mask[0], .6); assert.equal(state.previous, null);
  state.undo(); close(state.mask[0], .6);
  state.transition(new Float64Array(8).fill(1), 800, true); close(state.mask[0], 1);
  state.undo(); close(state.mask[0], .6);
  state.transition(target, 900, true); close(state.mask[0], .2); assert.equal(state.animation, null);
  state.transition(new Float64Array(8).fill(.7), 1000, false); state.advance(1100);
  const interrupted = state.mask.slice(); state.begin(); assert.equal(state.animation, null);
  assert.deepEqual(state.previous, interrupted);
});

test('undo and reset ease from the current mask with exact endpoints and no extra undo level', () => {
  const state = new EditHistory(4);
  state.transition(new Float64Array(4).fill(.2), 0, true);
  state.undo(100, false);
  assert.equal(state.previous, null); close(state.mask[0], .2);
  state.advance(140); close(state.mask[0], .2 + .8 * .028);
  state.advance(300); close(state.mask[0], .6);
  state.advance(500); close(state.mask[0], 1); assert.equal(state.animation, null);
  state.transition(new Float64Array(4).fill(.2), 600, true);
  state.transition(new Float64Array(4).fill(1), 700, false);
  state.advance(740); close(state.mask[0], .2 + .8 * .028);
  state.advance(1100); close(state.mask[0], 1);
  state.undo(1200, true); close(state.mask[0], .2); assert.equal(state.animation, null);
});
