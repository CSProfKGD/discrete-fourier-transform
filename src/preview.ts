import { WIDTH, HEIGHT } from './fourier.ts';

// Fixed spatial extent, anchored at the image origin. Never zoom with frequency:
// relative stripe spacing must remain meaningful across all selected bins.
export const PREVIEW_EXTENT = { width: 64, height: 48 } as const;

// Analytic safety filter for any future display smaller than the current tile.
// The fixed patch resolves every valid DFT mode even at the minimum tile size.
export function previewContrast(u: number, v: number, width: number, height: number): number {
  const nyquistFraction = Math.max(
    2 * Math.abs(u) * PREVIEW_EXTENT.width / WIDTH / width,
    2 * Math.abs(v) * PREVIEW_EXTENT.height / HEIGHT / height,
  );
  const t = Math.max(0, Math.min(1, (nyquistFraction - .6) / .3));
  return .5 + .5 * Math.cos(Math.PI * t);
}

export function renderPreview(
  pixels: Uint8ClampedArray, width: number, height: number,
  u: number, v: number, phase: number, zero: boolean,
  cosX: Float64Array, sinX: Float64Array,
) {
  // Normalize the pair's amplitude first, then apply the display low-pass.
  // Never renormalize after filtering: unresolved stripes must become gray.
  const contrast = zero ? 0 : 119 * previewContrast(u, v, width, height);
  for (let x = 0; x < width; x++) {
    const angle = 2 * Math.PI * u / WIDTH * (PREVIEW_EXTENT.width * x / width) + phase;
    cosX[x] = Math.cos(angle); sinX[x] = Math.sin(angle);
  }
  for (let y = 0; y < height; y++) {
    const angle = 2 * Math.PI * v / HEIGHT * (PREVIEW_EXTENT.height * y / height);
    const c = Math.cos(angle), s = Math.sin(angle);
    for (let x = 0; x < width; x++) {
      const value = Math.round(127.5 + contrast * (cosX[x] * c - sinX[x] * s));
      const i = (y * width + x) * 4;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = value;
      pixels[i + 3] = 255;
    }
  }
}
