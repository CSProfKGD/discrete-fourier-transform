"""Validate the actual browser pixels against NumPy's independent FFT implementation.

Run tests/browser.mjs first to capture the canonical input and displayed canvases.
This is an optional audit, not a runtime dependency of the webpage.
"""
import json
from pathlib import Path

import numpy as np

cases = json.loads(Path('.qa/numerical-cases.json').read_text())
w, h = cases['width'], cases['height']
source = np.array(cases['input'], dtype=np.float64).reshape(h, w)
coefficients = np.fft.fft2(source)
u, v = np.meshgrid(np.fft.fftfreq(w)*w/min(w, h), np.fft.fftfreq(h)*h/min(w, h))
radius_squared = u*u + v*v

def low(sigma):
    return np.exp(-radius_squared / (2*sigma*sigma))

def ramp(start, end):
    t = np.clip((np.sqrt(radius_squared)-start)/(end-start), 0, 1)
    return .5-.5*np.cos(np.pi*t)

masks = {
    'original': np.ones((h, w)),
    'Low-pass': low(.055),
    'Band-pass': ramp(.035, .055)*(1-ramp(.14, .18)),
    'High-pass': 1-low(.085),
}
scale = np.log1p(np.abs(coefficients).max())
report = {}
for name, mask in masks.items():
    filtered = coefficients * mask
    inverse = np.fft.ifft2(filtered)
    spatial = np.floor(255*np.clip(inverse.real + .5*(1-mask[0, 0]), 0, 1)+.5)
    spectrum = np.floor(255*np.fft.fftshift(np.log1p(np.abs(filtered))) / scale + .5)
    actual = cases['cases'][name]
    spatial_error = np.abs(spatial - np.array(actual['spatial']).reshape(h, w)).max()
    spectrum_error = np.abs(spectrum - np.array(actual['spectrum']).reshape(h, w)).max()
    imag_residue = np.abs(inverse.imag).max()
    energy_frequency = np.sum(np.abs(filtered)**2)/(w*h)
    energy_spatial = np.sum(np.abs(inverse)**2)
    relative_energy_error = abs(energy_frequency-energy_spatial)/max(1, energy_frequency)
    assert spatial_error <= 1, (name, 'spatial display mismatch', spatial_error)
    assert spectrum_error <= 1, (name, 'spectrum display mismatch', spectrum_error)
    assert imag_residue < 1e-12, (name, 'non-real inverse', imag_residue)
    assert relative_energy_error < 1e-12, (name, 'Parseval mismatch', relative_energy_error)
    report[name] = {
        'max_spatial_pixel_error': int(spatial_error),
        'max_spectrum_pixel_error': int(spectrum_error),
        'max_imaginary_residue': float(imag_residue),
        'relative_energy_error': float(relative_energy_error),
    }

preview = cases['preview']
ku = int(preview['shiftedX'] + w//2) % w
kv = int(preview['shiftedY'] + h//2) % h
pw, ph = preview['width'], preview['height']
xx, yy = np.meshgrid(np.arange(pw), np.arange(ph))
u, v = np.fft.fftfreq(w)[ku]*w, np.fft.fftfreq(h)[kv]*h
angle = 2*np.pi*(u/w*64*xx/pw + v/h*48*yy/ph) + np.angle(coefficients[kv, ku])
t = np.clip((max(2*abs(u)/w*64/pw, 2*abs(v)/h*48/ph)-.6)/.3, 0, 1)
contrast = .5+.5*np.cos(np.pi*t)
expected_preview = np.floor(127.5 + 119*contrast*np.cos(angle) + .5)
preview_error = np.abs(expected_preview - np.array(preview['pixels']).reshape(ph, pw)).max()
assert preview_error <= 1, ('phase-aware preview mismatch', preview_error)
report['phase_aware_preview'] = {'max_pixel_error': int(preview_error), 'coefficient': [ku, kv]}

Path('.qa/independent-fourier-report.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
print('Independent NumPy audit passed for every displayed pixel in all four states.')
