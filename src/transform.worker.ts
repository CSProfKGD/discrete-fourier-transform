import { WIDTH as W, HEIGHT as H, BRUSH_DIAMETER, Fourier2D, EditHistory, BrushStroke, displayValue, presetMask } from './fourier';
import type { Command, WorkerInput, WorkerOutput } from './protocol';

const port = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerInput>) => void) | null;
  postMessage: (message: WorkerOutput, transfer?: Transferable[]) => void;
};
const N = W * H;
const fft = new Fourier2D(W, H);
const edits = new EditHistory(N);
const real = new Float64Array(N), imaginary = new Float64Array(N);
const filteredRe = new Float64Array(N), filteredIm = new Float64Array(N);
const magnitude = new Float64Array(N);
let logMaximum = 1;
let initialized = false;
let dirty = true;
let stroke: BrushStroke | null = null;
let brushDiameter: number = BRUSH_DIAMETER.initial;

function apply(command: Command) {
  if (command.type === 'diameter') {
    brushDiameter = Math.max(BRUSH_DIAMETER.min, Math.min(BRUSH_DIAMETER.max, command.diameter));
  } else if (command.type === 'begin') {
    edits.begin(); stroke = new BrushStroke(edits.mask, W, H, command.point, command.time, brushDiameter); dirty = true;
  } else if (command.type === 'move') {
    stroke?.move(command.point, command.time); dirty = true;
  } else if (command.type === 'end') {
    stroke?.end(command.time); stroke = null; dirty = true;
  } else {
    stroke = null;
    if (command.type === 'undo') edits.undo(command.time, command.reduced);
    else edits.transition(command.type === 'reset' ? new Float64Array(N).fill(1) : presetMask(command.preset, W, H), command.time, command.reduced);
    dirty = true;
  }
}

port.onmessage = ({ data }) => {
  try {
    if (data.type === 'init') {
      const result = fft.transform(data.pixels, new Float64Array(N));
      real.set(result.re); imaginary.set(result.im);
      let maximum = 0;
      for (let i = 0; i < N; i++) {
        magnitude[i] = Math.hypot(real[i], imaginary[i]);
        maximum = Math.max(maximum, magnitude[i]);
      }
      logMaximum = Math.log1p(maximum) || 1;
      initialized = true;
      const reCopy = real.slice(), imCopy = imaginary.slice();
      port.postMessage({ type: 'ready', real: reCopy, imaginary: imCopy }, [reCopy.buffer, imCopy.buffer]);
      return;
    }
    if (!initialized) return;
    for (const command of data.commands) apply(command);
    if (stroke) { stroke.hold(data.time); dirty = true; }
    dirty = edits.advance(data.time) || dirty;
    const response: Extract<WorkerOutput, { type: 'frame' }> = {
      type: 'frame', sequence: data.sequence, changed: dirty,
      canUndo: !!edits.previous, modified: edits.mask.some(value => value < 1 - 1e-12),
      active: !!stroke || !!edits.animation, hover: data.hover, hoverGain: data.hover === null ? 0 : edits.mask[data.hover],
    };
    // Return recycled buffers even on idle ticks; keep just one frame in flight.
    const transfer: ArrayBuffer[] = [];
    if (dirty) {
      const spatial = new Uint8ClampedArray(data.spatial ?? new ArrayBuffer(N * 4));
      const spectrum = new Uint8ClampedArray(data.spectrum ?? new ArrayBuffer(N * 4));
      for (let i = 0; i < N; i++) {
        filteredRe[i] = real[i] * edits.mask[i]; filteredIm[i] = imaginary[i] * edits.mask[i];
        const x = (i % W + W / 2) % W;
        const y = (Math.floor(i / W) + H / 2) % H;
        const pixel = (y * W + x) * 4;
        const gray = Math.round(255 * Math.log1p(magnitude[i] * edits.mask[i]) / logMaximum);
        spectrum[pixel] = spectrum[pixel + 1] = spectrum[pixel + 2] = gray;
        spectrum[pixel + 3] = 255;
      }
      const result = fft.transform(filteredRe, filteredIm, true);
      for (let i = 0; i < N; i++) {
        const gray = Math.round(255 * displayValue(result.re[i], edits.mask[0]));
        const pixel = i * 4;
        spatial[pixel] = spatial[pixel + 1] = spatial[pixel + 2] = gray;
        spatial[pixel + 3] = 255;
      }
      response.spatial = spatial.buffer; response.spectrum = spectrum.buffer;
      transfer.push(spatial.buffer, spectrum.buffer);
      dirty = false;
    } else {
      if (data.spatial) { response.spatial = data.spatial; transfer.push(data.spatial); }
      if (data.spectrum) { response.spectrum = data.spectrum; transfer.push(data.spectrum); }
    }
    port.postMessage(response, transfer);
  } catch (error) {
    port.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Transform failed' });
  }
};
