import test from 'node:test';
import assert from 'node:assert/strict';
import { previewContrast, renderPreview } from '../src/preview.ts';
import { Fourier2D } from '../src/fourier.ts';

function render(u: number, v: number, phase: number, width = 188, height = 141, zero = false) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  renderPreview(pixels, width, height, u, v, phase, zero, new Float64Array(width), new Float64Array(width));
  return pixels;
}

test('fixed spatial patch preserves phase, spatial origin and physical frequency', () => {
  const w = 188, h = 141, u = 11, v = -7, phase = .83;
  const pixels = render(u, v, phase, w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const expected = Math.round(127.5 + 119 * Math.cos(2 * Math.PI * (u / 512 * 64 * x / w + v / 384 * 48 * y / h) + phase));
    assert.ok(Math.abs(pixels[(y * w + x) * 4] - expected) <= 1);
  }
  assert.deepEqual(pixels, render(-u, -v, -phase));
});

test('finest horizontal, vertical, diagonal and Nyquist modes remain resolved at all tile sizes', () => {
  for (const [w, h] of [[132, 99], [188, 141], [376, 282]]) {
    for (const [u, v] of [[255, 0], [0, 191], [255, 191], [-256, 0], [0, -192], [-256, -192]]) {
      assert.equal(previewContrast(u, v, w, h), 1);
      const pixels = render(u, v, 1.2, w, h);
      let min = 255, max = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const actual = pixels[(y * w + x) * 4];
        const expected = Math.round(127.5 + 119 * Math.cos(2 * Math.PI * (u * x / (8 * w) + v * y / (8 * h)) + 1.2));
        assert.ok(Math.abs(actual - expected) <= 1);
        min = Math.min(min, actual); max = Math.max(max, actual);
      }
      assert.ok(max - min > 230);
    }
  }
});

test('high-frequency patch has only the intended frequency pair, without folded spectral peaks', () => {
  const w = 144, h = 108, pixels = render(248, 176, .73, w, h);
  const real = Float64Array.from({ length: w * h }, (_, i) => pixels[4 * i] - 127.5);
  const { re, im } = new Fourier2D(w, h).transform(real, new Float64Array(w * h));
  let total = 0, expected = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, energy = re[i] ** 2 + im[i] ** 2;
    total += energy;
    if ((x === 31 && y === 22) || (x === w - 31 && y === h - 22)) expected += energy;
  }
  assert.ok(expected / total > .9999); // Remaining energy is 8-bit quantization.
});

test('safety filter smoothly suppresses unresolved patterns if a tile is ever made much smaller', () => {
  assert.equal(previewContrast(256, 0, 64, 48), 0);
  assert.equal(previewContrast(256, 0, 132, 99), 1);
  let previous = 1;
  for (let u = 0; u <= 256; u += .1) {
    const gain = previewContrast(u, 0, 64, 48);
    assert.ok(gain <= previous + 1e-14 && previous - gain < .006);
    assert.equal(gain, previewContrast(-u, 0, 64, 48));
    previous = gain;
  }
  assert.ok(Math.abs(previewContrast(192, 0, 64, 48) - .5) < 1e-14);
  assert.equal(render(192, 0, 0, 64, 48)[0], 187);
  const unresolved = render(256, 0, 0, 64, 48);
  for (let i = 0; i < unresolved.length; i += 4) assert.equal(unresolved[i], 128);
});

test('DC and zero coefficients remain constant', () => {
  for (const [phase, zero, expected] of [[0, false, 247], [Math.PI, false, 9], [.7, true, 128]] as const) {
    const pixels = render(0, 0, phase, 188, 141, zero);
    for (let i = 0; i < pixels.length; i += 4) assert.equal(pixels[i], expected);
  }
});
