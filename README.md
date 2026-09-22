# Discrete Fourier transform

An interactive image Fourier transform demo. Project requirements and maintenance rules are in `AGENTS.md`; mathematical conventions and design decisions are in `CONTEXT.md`.

- Website: https://csprofkgd.github.io/discrete-fourier-transform/
- Repository: https://github.com/CSProfKGD/discrete-fourier-transform

GitHub Pages is deployed by `.github/workflows/pages.yml`. Pushes to `main` run the mathematical tests and type-checked production build before publishing `dist/`. The workflow sets `VITE_BASE_PATH` to the repository subpath; local development retains relative asset paths.

Use Node.js 22.18+ and pnpm:

```sh
pnpm install
pnpm dev
```

Open http://127.0.0.1:5174/. Hover over the spectrum to inspect a conjugate sinusoid pair; drag to attenuate frequencies. Arrow keys and holding Space provide keyboard access.

```sh
pnpm typecheck
pnpm test
pnpm build
```

The optional `pnpm test:browser` check requires a running preview and Playwright. Set `PLAYWRIGHT_MODULE` to an absolute Playwright module path when using an external runtime, and `CHROME_PATH` if Chrome is not at its standard macOS location. It writes local screenshots, measurements, and numerical captures into ignored `.qa/`.

After that browser check, `python3 tests/independent_fourier.py` (requires NumPy) independently checks every displayed image/spectrum pixel against NumPy's FFT for the original and all presets, verifies the phase-aware hover tile, and checks real-valued reconstruction and Parseval's energy identity. Python and NumPy are only verification tools; the page runs entirely in the browser.

The supplied photograph is included locally; the app makes no external service requests and has no server-side processing or persistence.
