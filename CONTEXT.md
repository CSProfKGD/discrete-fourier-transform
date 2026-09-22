# Discrete Fourier Transform — context

## Product brief and resolved decisions

A direct-manipulation teaching page showing a photograph and its discrete Fourier transform on a pure-black Apple Keynote-style stage. The visual reference is the separate Aliasing project. Its files are reference material only. After completing the local visualization, the user explicitly authorized creating its GitHub repository and webpage, committing, and pushing.

Exact hero copy:

- `Discrete Fourier transform`
- `One image. Two representations.`

The user selected grayscale input, presets that start from the original photograph, a display that reveals both signs of filtered signals, and a local project with browser preview. The page has no visible explanatory paragraphs, panel labels, axes, or extra modes. After reviewing the live page, the user requested a harder brush, a brush-diameter slider beneath the buttons, analytical verification, consistent erasure, and eased Undo/Reset transitions. Those refinements supersede the original no-sliders and immediate-undo assumptions.

## Input and model

`public/toronto.png` is an unchanged copy of the 1448×1086 supplied image, originally attached as `codex-clipboard-9c2dbcd9-eec7-49cc-9d6c-097f735b0622.png`. The browser resamples it without cropping to 512×384 and computes normalized grayscale intensity with Rec.709 luma weights on RGB code values. This is an image-intensity DFT, not a radiometric linear-light simulation.

The separable mixed-radix FFT uses factors 2 and 3, supports the rectangular dimensions directly, and does not pad or stretch the image. Forward exponent is negative; inverse exponent is positive with normalization by `512×384`. Original complex coefficients remain immutable. The real attenuation mask is shared by each conjugate pair, preserving phase and real-valued reconstruction.

Spectrum display is `log(1+|F|)` divided by the original log maximum and shifted to center DC. Spatial display is `clamp(inverseReal + .5*(1-maskDC),0,1)`. The display offset changes only the view: signed mathematical values remain intact. Neither view has adaptive contrast normalization.

## Interactions

The sinusoid tile represents the selected pair's real inverse contribution, with contrast normalized for visibility. Its phase comes from the complex coefficient, and attenuation never changes that phase. A self-conjugate bin contributes once, not twice. Zero coefficients are neutral gray. The full 512×384 sinusoid field is rendered into a canvas and downsampled by the browser for the tile. The user refined its entrance to a more gradual 320ms opacity ease-in on hover or release over the spectrum. Press fades it away over 220ms with ease-out; pointer position remains immediate. Reduced motion disables both transitions.

The harder brush uses a super-Gaussian footprint `exp(-.5*(r/s)^4)`, where `s=diameter/4`, and peak decay 18/s (originally Gaussian, 6/s): a firmer center, faster attenuation, and a compact soft edge. The diameter slider spans 5–80 spectrum pixels, default 20; the halo radius is half the selected diameter. Resizing changes neither existing edits nor undo history, and Reset preserves brush size. The footprint uses toroidal distances and the maximum of conjugate footprints; contributions beyond `3s` are negligible and skipped.

To keep erasure consistent, moving strokes use persistent arc-length spacing `diameter/8` and `.035s` exposure per stamp, including an initial stamp and a weighted endpoint remainder. Thus moving the same path at different speeds or event rates produces the same mask. Coalesced pointer samples preserve intermediate path geometry. Holding still adds continuous exposure after an 80ms dwell threshold, independent of frame partitioning. Each gesture remains one undoable action.

Presets replace the current mask, referencing original coefficients. The user requested circular footprints for all three filters. Radius is therefore defined in the displayed bin grid as `r=hypot(signedU,signedV)/min(W,H)`, with `Lσ=exp(-r²/(2σ²))`:

| Preset | Mask |
| --- | --- |
| Low-pass | `L₀.₀₅₅` |
| Band-pass | Raised-cosine annulus: stop ≤.035 and ≥.18; pass .055–.14; smooth tapers between |
| High-pass | `1−L₀.₀₈₅` |

The user requested making Band-pass more apparent in the magnitude domain. The original Gaussian-difference band left long, visible spectral tails under logarithmic scaling, so it was replaced with the compact annulus above. Each taper uses `.5-.5*cos(πt)` with `t` clamped to [0,1]. The black center and exterior represent actual zeroed coefficients; display normalization is unchanged. A subsequent request made all presets circular on the rectangular spectrum: both bin axes use the same normalization. This is circular filtering in bin space, not isotropic filtering in cycles per image pixel; horizontal and vertical bin spacings in those physical units differ. The transform and conjugate symmetry are unaffected.

Presets, Undo and Reset interpolate masks for 400ms using smoothstep (slow start and finish). Reduced motion skips interpolation. A new action interrupts the current transition. A complete stroke, preset or reset stores one undo snapshot; Undo consumes it without creating redo. Reset restores the original photograph. Each animated frame recomputes the inverse and spectrum from the same interpolated mask.

## Architecture and access

React, TypeScript and Vite power a single static page. The pure Fourier module contains the transform, conjugacy, filters, brush and edit history. A Web Worker owns original coefficients, masks and inverse computation. The main thread handles controls, hover rendering and presentation. Only one worker frame is in flight; the two transferred RGBA buffers are recycled and committed together. Sequence numbers prevent older responses replacing newer frames.

The canvases have accessible descriptions. The spectrum is keyboard-focusable: arrows select bins, holding Space paints. Pointer events support mouse, pen and touch. Cancellation, lost capture, blur and visibility changes terminate strokes. Small screens stack the two visuals; enlarged text can wrap controls.

## Final visual refinement

The user's final polish request preserves the composition and functionality. The subtitle was changed from `Two sides of the same image` to `One image. Two representations.` while keeping header typography unchanged. Desktop visuals are approximately 4% larger; the source image has a 7px corner radius, and the spectrum remains borderless with square corners. Controls move approximately 18px upward, accounting for the larger visuals. Undo and Reset are about 20% dimmer; the brush value is neutral gray and closer to the cyan slider. Decorative halo glows and floating-tile shadows/translucency were removed. The user then flagged the line beside Undo as an odd edge; that separator was removed entirely.

The original 1448×1086 asset remains unchanged. The displayed reconstruction uses all 512×384 computed samples with its 4:3 aspect ratio intact and no sharpening. Increasing its actual detail beyond that would require changing the canonical image sampling or reconstruction pipeline, which the user explicitly excluded from this visual-only pass.

The user subsequently requested removing the turquoise focus outline around the entire spectrum and adding a bottom-right `Magnitude Spectrum` overlay (correcting the supplied spelling). The label is small, neutral gray, and ignores pointer events so painting works beneath it. Keyboard focus makes the label slightly brighter without drawing a frame around the spectrum. The user explicitly requested removing its underline, so it remains plain text in every state. These requests supersede the earlier prohibition on visible panel labels for this one overlay.

The user then requested more space between the spectrum and buttons. The control cluster's top margin was increased by 12px: at least 24px on desktop and 20px on narrow screens, retaining the centered alignment and existing spacing within the controls.

The latest refinement supersedes the temporary label and square spectrum corners: the label is removed entirely, and both visuals share the existing 7px source-image radius. The three filter pills remain separate, with minimum height reduced from 44px to 41px, horizontal padding reduced 5%, inactive fill darkened from `#141416` to `#121214`, and slightly quieter borders. Typography, gaps, and selected teal styling are unchanged. Small compensating space around the preset group retains its footprint and keeps Undo/Reset in place. The desktop slider value shifts 8px toward the track without resizing the track; the mobile value remains in its existing row. Header, visualization dimensions, control-cluster placement, and all computation/interactions are untouched.

This pass was checked in Chrome at 1440×1000 and 390×844. Before/after measurements confirmed unchanged header, visual-pair, control-cluster and slider-track geometry; Undo/Reset differ only by 1/64px layout rounding. Pills measure 41px rather than 44px, and the numeric output moved exactly 8px. No mobile overflow occurred. Desktop and mobile screenshots were inspected, and all 13 existing math tests plus the type-checked production build passed.

## Status

The sinusoid thumbnail's frame was corrected after the user reported an uneven/missing bottom border. The outer tile now sizes to its contents, and the inner canvas uses its intrinsic 4:3 aspect ratio with `height: auto`. This avoids percentage-height/intrinsic-size overflow and keeps equal 5px padding plus a 1px border on all four sides. Rounded clipping remains on the outer frame; preview pixels, phase, and animation behavior are unchanged.

Cursor responsiveness was refined after the user noticed halo lag. Halo geometry now updates immediately from the newest pointer event using cached SVG elements, independently of the sinusoid preview's animation frame. Coalesced samples are retained for stroke geometry only; they no longer drive the visible cursor through older positions. Hover-only worker replies recycle their buffers without re-uploading unchanged spatial and spectrum canvases. No Fourier math, brush strength, or tile-easing semantics changed.

The latest follow-up restores the subtle bottom-right `Magnitude Spectrum` label with no underline or pointer interception. The preview now eases its horizontal offset when switching from the pointer's right to its left near the spectrum's right boundary. Exponential easing uses a 70ms time constant (about 95% settled after 210ms), with 24px hysteresis to avoid repeated switching at the boundary. Ordinary pointer tracking remains immediate; initial appearance is positioned correctly before fading in, and reduced motion switches sides immediately.

Implemented and running locally at `http://127.0.0.1:5174/`. `AGENTS.md` and this uppercase `CONTEXT.md` are maintained alongside the app.

Published to the public repository `CSProfKGD/discrete-fourier-transform`, with website `https://csprofkgd.github.io/discrete-fourier-transform/`. The user authorized creating the repository and webpage, committing and pushing. `.github/workflows/pages.yml` installs locked dependencies, runs all mathematical tests, builds with the repository's asset base path, and deploys `dist/` to GitHub Pages on pushes to `main`. Local development remains unchanged. Initial commit `d4c32ab` deployed successfully in GitHub Actions run `35757147875`. The live HTTPS page returned 200; Chrome confirmed that the image and Fourier worker load, Band-pass changes the reconstruction, Reset restores the original, and no browser errors occur.

Verification completed on 2026-09-22:

- Type checking and the production build pass. All 13 mathematical tests pass, covering direct complex DFT comparison, production-size round trips, conjugate symmetry, phase-aware pairs, DC/Nyquist handling, circular radial filters, diameter behavior, event/speed-independent moving strokes, frame-independent stationary exposure, history, interruption and easing.
- Browser acceptance checks passed in Chrome: original image, both live canvases, hover preview, conjugate halos, painting, all presets, interrupted transitions, undo/reset, slider bounds and halo sizing, mouse capture release, touch, keyboard, reduced motion, mobile stacking, 4:3 aspect ratios, and 200% text enlargement. No console errors or horizontal overflow were observed.
- Measured updates were approximately 30fps for all preset animations and continuous brushing. Preset transitions spanned approximately 398–405ms; reduced motion committed one immediate frame.
- An independent NumPy FFT audit of the actual worker input matched every displayed grayscale and spectrum pixel exactly for the original and all three final circular presets. The phase-aware preview also matched every pixel exactly. Maximum imaginary inverse residue was below `3e-16`; relative Parseval energy error was below `2e-16`.
- Desktop, mobile, enlarged-text, hover and preset screenshots were visually inspected. Reports and captures live in ignored `.qa/`. The final 220ms tile-opacity refinement was followed by a successful type-checked production build.

The full browser audit can be rerun with the documented Playwright runner, followed by `python3 tests/independent_fourier.py` using NumPy. Capturing the actual worker input is essential: separate CPU/GPU canvas resampling paths can produce slightly different source samples and should not be confused with Fourier errors.
