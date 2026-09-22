import { StrictMode, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { WIDTH as W, HEIGHT as H, BRUSH_DIAMETER, conjugateIndex, signedBin } from './fourier';
import type { Point, Preset } from './fourier';
import type { Command, WorkerInput, WorkerOutput } from './protocol';
import { renderPreview } from './preview';
import './styles.css';

type Selection = { x: number; y: number; clientX: number; clientY: number; index: number };
type Controller = {
  commands: Command[]; selection: Selection | null; pointer: number | null; keyboard: boolean;
  ready: boolean; busy: boolean; disposed: boolean; revision: number; painted: number;
  real: Float64Array | null; imaginary: Float64Array | null;
  spatial?: ArrayBuffer; spectrum?: ArrayBuffer;
  hoverGain: number; hoverIndex: number | null; previewIndex: number | null; previewZero: boolean;
  diameter: number;
};

function App() {
  const spatialRef = useRef<HTMLCanvasElement>(null);
  const spectrumRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const tileRef = useRef<HTMLDivElement>(null);
  const tileCanvasRef = useRef<HTMLCanvasElement>(null);
  const controller = useRef<Controller | null>(null);
  const updateHalos = useRef<() => void>(() => {});
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [modified, setModified] = useState(false);
  const [preset, setPreset] = useState<Preset | null>(null);
  const [diameter, setDiameter] = useState<number>(BRUSH_DIAMETER.initial);

  useEffect(() => {
    const state: Controller = {
      commands: [], selection: null, pointer: null, keyboard: false, ready: false, busy: false,
      disposed: false, revision: 0, painted: -1, real: null, imaginary: null,
      hoverGain: 1, hoverIndex: null, previewIndex: null, previewZero: false,
      diameter: BRUSH_DIAMETER.initial,
    };
    controller.current = state;
    const worker = new Worker(new URL('./transform.worker.ts', import.meta.url), { type: 'module' });
    const send = (message: WorkerInput, transfer: Transferable[] = []) => worker.postMessage(message, transfer);
    const spatialContext = spatialRef.current!.getContext('2d')!;
    const spectrumContext = spectrumRef.current!.getContext('2d')!;
    const previewCanvas = tileCanvasRef.current!;
    const previewContext = previewCanvas.getContext('2d')!;
    let previewData = previewContext.createImageData(W, H);
    let cosX = new Float64Array(W), sinX = new Float64Array(W);
    let animationFrame = 0;
    let initializedImage = false;
    let active = true;
    let lastHover: number | null = null;
    let tileSide = 0;
    let tileOffset = 0;
    let tilePlacementTime = 0;
    let tileWasVisible = false;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const haloCircles = overlayRef.current!.querySelectorAll('circle');
    let haloIndex: number | null = null;
    let haloDiameter = 0;
    updateHalos.current = () => {
      const selection = state.selection;
      const overlay = overlayRef.current!;
      if (!selection || !state.ready) { overlay.style.opacity = '0'; haloIndex = null; return; }
      overlay.style.opacity = '1';
      if (haloIndex === selection.index && haloDiameter === state.diameter) return;
      haloIndex = selection.index; haloDiameter = state.diameter;
      const mate = conjugateIndex(selection.index, W, H);
      const mx = (mate % W + W / 2) % W;
      const my = (Math.floor(mate / W) + H / 2) % H;
      let circleIndex = 0;
      for (const point of [{ x: selection.x, y: selection.y }, { x: mx, y: my }]) {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const circle = haloCircles[circleIndex++];
          circle.setAttribute('cx', String(point.x + .5 + dx * W));
          circle.setAttribute('cy', String(point.y + .5 + dy * H));
          circle.setAttribute('r', String(state.diameter / 2));
          circle.style.opacity = circleIndex > 9 && mate === selection.index ? '0' : '1';
        }
      }
    };

    function fail(error: unknown) {
      if (state.disposed) return;
      console.error('Fourier image initialization or rendering failed', error);
      setError(true); setReady(false); state.ready = false;
    }

    worker.onerror = fail;
    worker.onmessage = ({ data }: MessageEvent<WorkerOutput>) => {
      if (state.disposed) return;
      if (data.type === 'error') { fail(data.message); return; }
      if (data.type === 'ready') {
        state.real = data.real; state.imaginary = data.imaginary;
        state.ready = true;
        return;
      }
      state.busy = false;
      if (data.sequence <= state.painted) return;
      state.painted = data.sequence;
      if (data.spatial && data.spectrum) {
        // Hover-only replies recycle buffers without uploading two unchanged images.
        if (data.changed || !initializedImage) {
          spatialContext.putImageData(new ImageData(new Uint8ClampedArray(data.spatial), W, H), 0, 0);
          spectrumContext.putImageData(new ImageData(new Uint8ClampedArray(data.spectrum), W, H), 0, 0);
        }
        state.spatial = data.spatial; state.spectrum = data.spectrum;
        if (!initializedImage) { initializedImage = true; setReady(true); }
      }
      state.hoverIndex = data.hover; state.hoverGain = data.hoverGain;
      active = data.active;
      setCanUndo(data.canUndo); setModified(data.modified);
    };

    const photograph = new Image();
    photograph.onload = () => {
      if (state.disposed) return;
      try {
        const source = document.createElement('canvas'); source.width = W; source.height = H;
        const context = source.getContext('2d', { willReadFrequently: true })!;
        context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
        context.drawImage(photograph, 0, 0, W, H);
        const rgba = context.getImageData(0, 0, W, H).data;
        const pixels = Float64Array.from({ length: W * H }, (_, i) =>
          (.2126 * rgba[i * 4] + .7152 * rgba[i * 4 + 1] + .0722 * rgba[i * 4 + 2]) / 255);
        send({ type: 'init', pixels }, [pixels.buffer]);
      } catch (error) { fail(error); }
    };
    photograph.onerror = fail;
    photograph.src = `${import.meta.env.BASE_URL}toronto.png`;

    function renderHover() {
      const selection = state.selection;
      const tile = tileRef.current!;
      updateHalos.current();
      const showTile = !!selection && state.ready && state.pointer === null && !state.keyboard;
      const entering = showTile && !tileWasVisible;
      tileWasVisible = showTile;
      tile.dataset.visible = String(showTile);
      tile.style.opacity = showTile ? '1' : '0';
      if (!selection || !state.real || !state.imaginary) return;
      const bounds = tile.getBoundingClientRect();
      const spectrumBounds = spectrumRef.current!.getBoundingClientRect();
      const rightLimit = Math.min(spectrumBounds.right - 12, window.innerWidth - 12);
      const rightEdge = selection.clientX + 23 + bounds.width;
      if (entering) tileSide = rightEdge > rightLimit ? 1 : 0;
      else if (tileSide === 0 && rightEdge > rightLimit) tileSide = 1;
      else if (tileSide === 1 && rightEdge < rightLimit - 24) tileSide = 0;
      const now = performance.now();
      const targetOffset = tileSide * (bounds.width + 46);
      // Ease only the side-switch offset; ordinary pointer tracking stays immediate.
      if (entering || reducedMotion.matches) tileOffset = targetOffset;
      else tileOffset += (targetOffset - tileOffset) * (1 - Math.exp(-(now - tilePlacementTime) / 70));
      tilePlacementTime = now;
      const left = Math.max(12, Math.min(window.innerWidth - bounds.width - 12, selection.clientX + 23 - tileOffset));
      const top = Math.max(12, Math.min(window.innerHeight - bounds.height - 12, selection.clientY - bounds.height - 22));
      tile.style.transform = `translate3d(${left}px, ${top}px, 0)`;
      if (state.pointer !== null || state.keyboard) return;
      const real = state.real[selection.index], imag = state.imaginary[selection.index];
      const gain = state.hoverIndex === selection.index ? state.hoverGain : 1;
      const amplitude = Math.hypot(real, imag);
      const zero = amplitude * gain < 1e-12;
      // Match the actual display grid, keeping an exact 4:3 intrinsic ratio.
      // Rounding down avoids a second downsampling step in the compositor.
      const previewWidth = Math.max(4, 4 * Math.floor(previewCanvas.getBoundingClientRect().width * window.devicePixelRatio / 4));
      const previewHeight = previewWidth * 3 / 4;
      if (previewCanvas.width !== previewWidth || previewCanvas.height !== previewHeight) {
        previewCanvas.width = previewWidth; previewCanvas.height = previewHeight;
        previewData = previewContext.createImageData(previewWidth, previewHeight);
        cosX = new Float64Array(previewWidth); sinX = new Float64Array(previewWidth);
        state.previewIndex = null;
      }
      if (state.previewIndex === selection.index && state.previewZero === zero) return;
      state.previewIndex = selection.index; state.previewZero = zero;
      const u = signedBin(selection.index % W, W), v = signedBin(Math.floor(selection.index / W), H);
      // The contrast-normalized pair is Re(F exp(iθ))/|F|. The self-pair's
      // non-doubled amplitude cancels under this same normalization.
      const phase = Math.atan2(imag, real);
      renderPreview(previewData.data, previewWidth, previewHeight, u, v, phase, zero, cosX, sinX);
      previewContext.putImageData(previewData, 0, 0);
    }

    function tick(time: number) {
      if (state.disposed) return;
      renderHover();
      const hover = state.selection?.index ?? null;
      if (state.ready && !state.busy && (active || state.commands.length || hover !== lastHover || !initializedImage)) {
        state.busy = true; lastHover = hover;
        const transfer = [state.spatial, state.spectrum].filter((buffer): buffer is ArrayBuffer => !!buffer);
        send({ type: 'frame', sequence: ++state.revision, time, commands: state.commands.splice(0), hover,
          spatial: state.spatial, spectrum: state.spectrum }, transfer);
        state.spatial = undefined; state.spectrum = undefined;
      }
      animationFrame = requestAnimationFrame(tick);
    }
    animationFrame = requestAnimationFrame(tick);
    const stop = () => {
      if (state.pointer !== null || state.keyboard) state.commands.push({ type: 'end', time: performance.now() });
      state.pointer = null; state.keyboard = false; state.selection = null;
    };
    window.addEventListener('blur', stop);
    const visibility = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      state.disposed = true; worker.terminate(); cancelAnimationFrame(animationFrame);
      window.removeEventListener('blur', stop); document.removeEventListener('visibilitychange', visibility);
    };
  }, []);

  function select(clientX: number, clientY: number, paintHalo = true) {
    const rect = spectrumRef.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(W - 1, Math.floor((clientX - rect.left) / rect.width * W)));
    const y = Math.max(0, Math.min(H - 1, Math.floor((clientY - rect.top) / rect.height * H)));
    const index = ((y + H / 2) % H) * W + (x + W / 2) % W;
    const selection = { x, y, index, clientX, clientY };
    controller.current!.selection = selection;
    if (paintHalo) updateHalos.current();
    return selection;
  }
  const point = (selection: Selection): Point => ({ x: selection.x - W / 2, y: selection.y - H / 2 });

  function action(type: 'reset' | 'undo' | Preset) {
    const state = controller.current!;
    if (!ready) return;
    state.pointer = null; state.keyboard = false;
    const time = performance.now(), reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (type === 'undo') state.commands.push({ type, time, reduced });
    else if (type === 'reset') state.commands.push({ type, time, reduced });
    else state.commands.push({ type: 'preset', preset: type, time, reduced });
    setPreset(type === 'reset' || type === 'undo' ? null : type);
  }

  function endPointer(event: React.PointerEvent<HTMLCanvasElement>) {
    const state = controller.current!;
    if (state.pointer !== event.pointerId) return;
    state.commands.push({ type: 'end', time: performance.now() }); state.pointer = null;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.type !== 'pointerup' || event.pointerType === 'touch' || event.clientX < rect.left || event.clientX >= rect.right || event.clientY < rect.top || event.clientY >= rect.bottom) state.selection = null;
    else select(event.clientX, event.clientY);
  }

  return (
    <main className={`site-shell${ready ? ' is-ready' : ''}`}>
      <header className="hero">
        <h1>2D Discrete Fourier Transform</h1>
        <div className="subtitle">One image. Two representations.</div>
      </header>
      <section className="experiment" aria-label="Interactive Fourier transform">
        <div className="visuals">
          <div className="visual spatial">
            <canvas ref={spatialRef} width={W} height={H} role="img" aria-label="Current spatial reconstruction. Signed filtered values are shown around middle gray as average brightness is removed." />
          </div>
          <div className="visual spectrum">
            <canvas ref={spectrumRef} width={W} height={H} tabIndex={ready ? 0 : -1} role="application"
              aria-label="Centered Fourier magnitude spectrum" aria-describedby="spectrum-help"
              onContextMenu={event => event.preventDefault()}
              onPointerMove={event => {
                const state = controller.current!; if (!ready || (state.pointer !== null && state.pointer !== event.pointerId)) return;
                const painting = state.pointer === event.pointerId;
                const samples = painting ? event.nativeEvent.getCoalescedEvents?.() ?? [] : [];
                for (const sample of samples) {
                  const selected = select(sample.clientX, sample.clientY, false);
                  state.commands.push({ type: 'move', point: point(selected), time: sample.timeStamp });
                }
                // Draw the cursor from the freshest event immediately, not from the
                // older coalesced stroke samples or the next preview animation frame.
                const selected = select(event.clientX, event.clientY);
                const last = samples.at(-1);
                if (painting && (!last || last.clientX !== event.clientX || last.clientY !== event.clientY))
                  state.commands.push({ type: 'move', point: point(selected), time: event.timeStamp });
              }}
              onPointerDown={event => {
                const state = controller.current!; if (!ready || event.button !== 0 || state.pointer !== null) return;
                event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId);
                const selected = select(event.clientX, event.clientY);
                state.pointer = event.pointerId; state.keyboard = false;
                state.commands.push({ type: 'begin', point: point(selected), time: performance.now() }); setPreset(null);
              }}
              onPointerUp={endPointer} onPointerCancel={endPointer} onLostPointerCapture={endPointer}
              onPointerLeave={() => { const state = controller.current!; if (state.pointer === null) state.selection = null; }}
              onFocus={() => {
                const state = controller.current!; if (!state.selection) {
                  const rect = spectrumRef.current!.getBoundingClientRect(); select(rect.left + rect.width / 2, rect.top + rect.height / 2);
                }
              }}
              onBlur={() => {
                const state = controller.current!;
                if (state.keyboard) state.commands.push({ type: 'end', time: performance.now() });
                state.keyboard = false; if (state.pointer === null) state.selection = null;
              }}
              onKeyDown={event => {
                const state = controller.current!; if (!ready || state.pointer !== null) return;
                if (event.key === ' ' && !event.repeat && state.selection) {
                  event.preventDefault(); state.keyboard = true;
                  state.commands.push({ type: 'begin', point: point(state.selection), time: performance.now() }); setPreset(null);
                } else if (event.key === ' ') event.preventDefault();
                else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
                  event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect();
                  const previous = state.selection ?? { x: W / 2, y: H / 2 };
                  const x = (previous.x + (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0) + W) % W;
                  const y = (previous.y + (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0) + H) % H;
                  const selected = select(rect.left + (x + .5) / W * rect.width, rect.top + (y + .5) / H * rect.height);
                  if (state.keyboard) state.commands.push({ type: 'move', point: point(selected), time: performance.now() });
                }
              }}
              onKeyUp={event => {
                if (event.key === ' ' && controller.current!.keyboard) {
                  event.preventDefault(); controller.current!.keyboard = false;
                  controller.current!.commands.push({ type: 'end', time: performance.now() });
                }
              }} />
            <svg className="halos" ref={overlayRef} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
              {Array.from({ length: 18 }, (_, i) => <circle key={i} cx="0" cy="0" r="10" />)}
            </svg>
            <span className="spectrum-label" aria-hidden="true">Magnitude Spectrum</span>
          </div>
        </div>
        <div className="control-dock" role="group" aria-label="Frequency filters and history">
          <div className="presets">
            {([['low', 'Low-pass'], ['band', 'Band-pass'], ['high', 'High-pass']] as const).map(([key, label]) =>
              <button key={key} disabled={!ready} aria-pressed={preset === key} onClick={() => action(key)}>{label}</button>)}
          </div>
          <div className="history">
            <button disabled={!ready || !canUndo} onClick={() => action('undo')}>Undo</button>
            <button disabled={!ready || !modified} onClick={() => action('reset')}>Reset</button>
          </div>
        </div>
        <div className="brush-control">
          <label htmlFor="brush-diameter">Brush diameter</label>
          <input id="brush-diameter" type="range" min={BRUSH_DIAMETER.min} max={BRUSH_DIAMETER.max} step="1"
            value={diameter} disabled={!ready} aria-valuetext={`${diameter} spectrum pixels`}
            style={{ '--slider-progress': `${(diameter - BRUSH_DIAMETER.min) / (BRUSH_DIAMETER.max - BRUSH_DIAMETER.min) * 100}%` } as CSSProperties}
            onChange={event => {
              const value = Number(event.currentTarget.value); setDiameter(value);
              const state = controller.current!; state.diameter = value;
              state.commands.push({ type: 'diameter', diameter: value, time: performance.now() });
            }} />
          <output htmlFor="brush-diameter"><span>{diameter}</span><span className="unit">px</span></output>
        </div>
        {!ready && <div className="status" role="status">{error ? 'Image unavailable. Reload to retry.' : 'Preparing image…'}</div>}
        <span id="spectrum-help" className="sr-only">Hover to preview a conjugate sinusoid pair. Drag to soften frequencies. Use arrow keys to select a frequency and hold Space to apply the brush. The preview shows a fixed magnified 64 by 48 pixel spatial patch with normalized contrast. Undo reverses one action.</span>
      </section>
      <div className="sinusoid-tile" ref={tileRef} aria-hidden="true"><canvas ref={tileCanvasRef} width={W} height={H} /></div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
