import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await mkdir('.qa', { recursive: true });
const report = {};
const numerical = { width: 512, height: 384, cases: {} };

// Observe real canvas commits without adding instrumentation to the app.
await page.addInitScript(() => {
  window.__frames = [];
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (message, ...rest) {
    if (message?.type === 'init' && message.pixels) window.__canonicalInput = Array.from(message.pixels);
    return post.call(this, message, ...rest);
  };
  const original = CanvasRenderingContext2D.prototype.putImageData;
  CanvasRenderingContext2D.prototype.putImageData = function (...args) {
    if (this.canvas.closest('.spatial')) window.__frames.push(performance.now());
    return original.apply(this, args);
  };
});
const button = name => page.getByRole('button', { name, exact: true });
const spectrum = page.locator('.spectrum > canvas');
const snapshot = () => page.locator('.spatial canvas').evaluate(canvas => canvas.toDataURL());
const spectrumSnapshot = () => spectrum.evaluate(canvas => canvas.toDataURL());
async function captureNumerical(name) {
  numerical.cases[name] = await page.evaluate(() => {
    const read = selector => {
      const canvas = document.querySelector(selector);
      const rgba = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      return Array.from({ length: canvas.width * canvas.height }, (_, i) => rgba[i * 4]);
    };
    return { spatial: read('.spatial canvas'), spectrum: read('.spectrum > canvas') };
  });
}
const settle = () => page.waitForTimeout(650);
const tileOpacity = value => page.waitForFunction(expected => getComputedStyle(document.querySelector('.sinusoid-tile')).opacity === expected, value);
async function reset() {
  if (await button('Reset').isEnabled()) { await button('Reset').click(); await settle(); }
}

try {
  await page.goto(process.env.PREVIEW_URL || 'http://127.0.0.1:5174/');
  await button('Low-pass').waitFor();
  await page.waitForFunction(() => document.querySelector('.site-shell.is-ready'));
  await settle();
  const original = await snapshot(), originalSpectrum = await spectrumSnapshot();
  // Capture the actual worker input: CPU and GPU image resamplers can differ.
  numerical.input = await page.evaluate(() => window.__canonicalInput);
  await captureNumerical('original');
  await page.screenshot({ path: '.qa/desktop.png' });
  assert.equal(await button('Undo').isDisabled(), true);
  assert.equal(await button('Reset').isDisabled(), true);
  assert.equal(await page.locator('h1').innerText(), '2D Discrete Fourier Transform');
  assert.equal(await page.locator('.subtitle').innerText(), 'One image. Two representations.');
  assert.equal(await page.locator('button').count(), 5);

  const box = await spectrum.boundingBox();
  const x = box.x + box.width * .53, y = box.y + box.height * .52;
  await page.mouse.move(x, y);
  await page.waitForTimeout(150);
  await tileOpacity('1');
  const tile = await page.locator('.sinusoid-tile canvas').evaluate(canvas => canvas.toDataURL());
  await page.mouse.move(x + 15, y + 20);
  await page.waitForTimeout(150);
  assert.notEqual(await page.locator('.sinusoid-tile canvas').evaluate(canvas => canvas.toDataURL()), tile);
  await page.screenshot({ path: '.qa/hover.png' });
  numerical.preview = await page.evaluate(() => {
    const canvas = document.querySelector('.sinusoid-tile canvas');
    const rgba = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const halo = document.querySelector('.halos circle');
    return { width: canvas.width, height: canvas.height,
      shiftedX: Number(halo.getAttribute('cx')) + 512 - .5,
      shiftedY: Number(halo.getAttribute('cy')) + 384 - .5,
      pixels: Array.from({ length: canvas.width * canvas.height }, (_, i) => rgba[i * 4]) };
  });
  const tileBounds = await page.locator('.sinusoid-tile').boundingBox();
  assert.ok(tileBounds.x >= 0 && tileBounds.y >= 0 && tileBounds.x + tileBounds.width <= 1440);

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(130);
  await tileOpacity('0');
  await page.mouse.move(x + 45, y + 18, { steps: 12 });
  await page.waitForTimeout(150);
  await page.mouse.up(); await settle();
  assert.notEqual(await snapshot(), original);
  assert.notEqual(await spectrumSnapshot(), originalSpectrum);
  await tileOpacity('1');
  await button('Undo').click(); await settle();
  assert.equal(await snapshot(), original);
  assert.equal(await spectrumSnapshot(), originalSpectrum);
  assert.equal(await button('Undo').isDisabled(), true);

  for (const name of ['Low-pass', 'Band-pass', 'High-pass']) {
    await page.evaluate(() => { window.__frames = []; });
    await button(name).click(); await settle();
    const frames = await page.evaluate(() => window.__frames);
    report[name] = { frames: frames.length, span: frames.at(-1) - frames[0], fps: (frames.length - 1) * 1000 / (frames.at(-1) - frames[0]) };
    assert.ok(frames.length >= 3, `${name} should visibly animate`);
    assert.notEqual(await snapshot(), original);
    await captureNumerical(name);
    await page.screenshot({ path: `.qa/${name.toLowerCase()}.png` });
  }
  await reset(); assert.equal(await snapshot(), original);
  await button('Undo').click(); await settle(); assert.notEqual(await snapshot(), original);
  await reset();

  // Diameter changes resize both halos without editing the image or consuming undo.
  const diameter = page.getByRole('slider', { name: 'Brush diameter' });
  const beforeDiameter = await snapshot();
  const undoBeforeDiameter = await button('Undo').isEnabled();
  await diameter.focus(); await page.keyboard.press('End'); await settle();
  assert.equal(await diameter.inputValue(), '80');
  assert.equal(await snapshot(), beforeDiameter);
  assert.equal(await button('Undo').isEnabled(), undoBeforeDiameter);
  await page.mouse.move(x, y); await page.waitForTimeout(150);
  assert.equal(await page.locator('.halos circle').first().getAttribute('r'), '40');
  await diameter.focus(); await page.keyboard.press('Home'); await settle();
  assert.equal(await diameter.inputValue(), '5');
  await page.mouse.move(x + 1, y); await page.waitForTimeout(150);
  assert.equal(await page.locator('.halos circle').first().getAttribute('r'), '2.5');
  await diameter.fill('20'); await settle();

  // New presets replace previous filters and brushing.
  await button('Band-pass').click(); await settle(); const band = await snapshot();
  await button('High-pass').click(); await settle(); await button('Band-pass').click(); await settle();
  assert.equal(await snapshot(), band);
  await button('Low-pass').click(); await page.waitForTimeout(90); await button('High-pass').click(); await settle();
  const interrupted = await snapshot();
  await reset(); await button('High-pass').click(); await settle(); assert.equal(await snapshot(), interrupted);

  await reset();
  await spectrum.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowUp');
  await page.keyboard.down('Space'); await page.waitForTimeout(250); await page.keyboard.up('Space'); await settle();
  assert.notEqual(await snapshot(), original);
  await button('Undo').click(); await settle(); assert.equal(await snapshot(), original);

  // Measure continuous brush commits after initialization and compare mirrored erasure.
  await page.mouse.move(x, y); await page.waitForTimeout(150);
  await page.evaluate(() => { window.__frames = []; });
  await page.mouse.down(); await page.waitForTimeout(850); await page.mouse.up(); await settle();
  const brushFrames = await page.evaluate(() => window.__frames);
  report.brush = { frames: brushFrames.length, fps: (brushFrames.length - 1) * 1000 / (brushFrames.at(-1) - brushFrames[0]) };
  const symmetry = await spectrum.evaluate(canvas => {
    const w = canvas.width, h = canvas.height;
    const pixels = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    let error = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      error = Math.max(error, Math.abs(pixels[(y * w + x) * 4] - pixels[(((h - y) % h) * w + (w - x) % w) * 4]));
    }
    return error;
  });
  assert.ok(symmetry <= 1, 'Rendered spectrum must remain conjugate-symmetric');
  await page.screenshot({ path: '.qa/harder-brush.png' });
  await reset();

  // Reduced motion: exactly one committed filter frame, with no animation.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.mouse.move(10, 10); await settle(); await page.evaluate(() => { window.__frames = []; });
  await button('Low-pass').click(); await settle();
  report.reducedMotionFrames = await page.evaluate(() => window.__frames.length);
  assert.equal(report.reducedMotionFrames, 1);
  await reset(); await page.emulateMedia({ reducedMotion: 'no-preference' });

  await page.setViewportSize({ width: 390, height: 844 }); await settle();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: '.qa/mobile.png', fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const panels = await page.locator('.visual').evaluateAll(els => els.map(el => {
    const rect = el.getBoundingClientRect(); return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
  }));
  assert.ok(panels[1].y > panels[0].y + panels[0].h);
  for (const panel of panels) assert.ok(Math.abs(panel.w / panel.h - 4 / 3) < .01);
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await page.screenshot({ path: '.qa/enlarged-text.png', fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });

  const session = await page.context().newCDPSession(page);
  const touchBox = await spectrum.boundingBox();
  const touchX = touchBox.x + touchBox.width / 2, touchY = touchBox.y + touchBox.height / 2;
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchX, y: touchY }] });
  await page.waitForTimeout(250);
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchX + 25, y: touchY - 10 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await settle(); assert.notEqual(await snapshot(), original);
  await reset();

  // Leaving with capture and releasing outside must stop the stroke and hide the tile.
  await page.setViewportSize({ width: 1440, height: 1000 }); await settle();
  const bounds = await spectrum.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down(); await page.mouse.move(10, 10, { steps: 5 }); await page.mouse.up(); await settle();
  const released = await snapshot(); await page.waitForTimeout(250); assert.equal(await snapshot(), released);
  assert.equal(await page.locator('.sinusoid-tile').evaluate(el => getComputedStyle(el).opacity), '0');
  await reset();
  // The fixed magnified patch resolves even the finest DFT modes at both
  // standard and Retina density, and keeps equal padding around the tile.
  report.previewSampling = [];
  for (const dpr of [1, 2]) {
    const previewPage = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: dpr });
    await previewPage.goto(process.env.PREVIEW_URL || 'http://127.0.0.1:5174/');
    await previewPage.waitForSelector('.site-shell.is-ready');
    for (const viewportWidth of [1440, 390]) {
      await previewPage.setViewportSize({ width: viewportWidth, height: 1000 });
      await previewPage.locator('.spectrum > canvas').scrollIntoViewIfNeeded();
      for (const [u, v] of [[12, -7], [250, 0], [0, 185], [240, 180]]) {
        const rect = await previewPage.locator('.spectrum > canvas').boundingBox();
        await previewPage.mouse.move(rect.x + (256 + u + .5) / 512 * rect.width, rect.y + (192 + v + .5) / 384 * rect.height);
        await previewPage.waitForTimeout(400);
        const result = await previewPage.locator('.sinusoid-tile canvas').evaluate(canvas => {
          const bounds = canvas.getBoundingClientRect(), frame = canvas.parentElement.getBoundingClientRect();
          const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
          let min = 255, max = 0;
          for (let i = 0; i < pixels.length; i += 4) { min = Math.min(min, pixels[i]); max = Math.max(max, pixels[i]); }
          return { width: canvas.width, height: canvas.height, displayWidth: bounds.width * devicePixelRatio, min, max,
            gaps: [bounds.left - frame.left, bounds.top - frame.top, frame.right - bounds.right, frame.bottom - bounds.bottom] };
        });
        assert.equal(result.width / result.height, 4 / 3);
        assert.ok(result.width <= result.displayWidth && result.displayWidth - result.width < 4);
        for (const gap of result.gaps) assert.ok(Math.abs(gap - 6) < .1);
        assert.ok(result.max - result.min > 230);
        report.previewSampling.push({ dpr, viewportWidth, u, v, ...result });
      }
    }
    await previewPage.close();
  }
  report.consoleErrors = errors;
  assert.deepEqual(errors, []);
  await writeFile('.qa/browser-report.json', JSON.stringify(report, null, 2));
  await writeFile('.qa/numerical-cases.json', JSON.stringify(numerical));
  console.log(JSON.stringify(report, null, 2));
  console.log('Browser acceptance checks passed.');
} finally {
  await browser.close();
}
