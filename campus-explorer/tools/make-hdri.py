#!/usr/bin/env python3
"""
Generates assets/hdr/campus-sky.hdr - the vendored environment map used by
js/3d/campus/campus-app.js for image-based lighting.

WHY THIS EXISTS
---------------
The campus explorer needs an HDRI for physically-plausible reflections on
glass and metal. Downloading one (Poly Haven etc.) would either add a
runtime CDN dependency - which the project has explicitly ruled out for
assets - or require committing a 20-50 MB photographic .hdr.

So this writes a *synthetic* analytic sky instead: a Preetham-style
gradient, a real high-dynamic-range sun disc with atmospheric glow, warm
horizon haze and a dim bounce-lit ground hemisphere. It is a genuine
32-bit radiance file (values well above 1.0 in the sun), so PBR materials
behave correctly - glass picks up a real sun highlight, metal reflects a
real gradient.

HONEST LIMITATION: it is not a photograph of a real sky, so it has no
clouds, no buildings, no ground detail to reflect. Reflections read as
"clean studio sky", not "Bangalore afternoon". Replacing this file with a
real captured or downloaded .hdr of the same name is a drop-in upgrade -
no code change - and is the recommended step before publication.

Run:  python3 tools/make-hdri.py
"""

import numpy as np
import os
import struct

W, H = 1024, 512

# Sun placement, matched to the directional light in campus-app.js
# (sun.position roughly +x, high, +z) so the IBL highlight and the shadow
# casting light agree with each other.
SUN_AZIMUTH = np.radians(58.0)    # 0 = -z, increasing toward +x
SUN_ELEVATION = np.radians(34.0)

ZENITH = np.array([0.055, 0.11, 0.26])      # deep blue overhead
HORIZON = np.array([0.62, 0.66, 0.72])      # pale haze at eye level
GROUND = np.array([0.055, 0.052, 0.046])    # dim bounce from earth/asphalt
SUN_TINT = np.array([1.0, 0.94, 0.82])      # slightly warm sunlight

SUN_RADIUS = np.radians(1.6)                # disc, a touch wider than real
SUN_INTENSITY = 420.0                       # peak radiance of the disc
GLOW_FALLOFF = 26.0                         # atmospheric scattering halo


def direction_grid(width, height):
    """Equirectangular pixel -> unit direction vector, matching the
    layout three.js RGBELoader + EquirectangularReflectionMapping expects."""
    u = (np.arange(width) + 0.5) / width
    v = (np.arange(height) + 0.5) / height
    uu, vv = np.meshgrid(u, v)
    phi = (uu * 2.0 - 1.0) * np.pi     # longitude
    theta = vv * np.pi                 # 0 at top (zenith), pi at bottom
    sin_t = np.sin(theta)
    x = sin_t * np.sin(phi)
    y = np.cos(theta)
    z = -sin_t * np.cos(phi)
    return x, y, z


def build_sky():
    x, y, z = direction_grid(W, H)

    sx = np.cos(SUN_ELEVATION) * np.sin(SUN_AZIMUTH)
    sy = np.sin(SUN_ELEVATION)
    sz = -np.cos(SUN_ELEVATION) * np.cos(SUN_AZIMUTH)

    # Sky gradient: blend zenith -> horizon by elevation, with a tightened
    # curve so the haze band sits close to the horizon rather than smearing
    # halfway up the dome.
    up = np.clip(y, 0.0, 1.0)
    t = up ** 0.42
    sky = (ZENITH[None, None, :] * t[..., None]
           + HORIZON[None, None, :] * (1.0 - t)[..., None])

    # Ground hemisphere: dark, desaturated, with a soft terminator so the
    # PMREM blur doesn't produce a hard seam at the horizon line.
    down = np.clip(-y, 0.0, 1.0)
    ground_blend = np.clip(down * 6.0, 0.0, 1.0)[..., None]
    sky = sky * (1.0 - ground_blend) + GROUND[None, None, :] * ground_blend

    # Sun: angular distance to the sun direction drives both the hard disc
    # and the wide scattering glow around it.
    cos_angle = np.clip(x * sx + y * sy + z * sz, -1.0, 1.0)
    angle = np.arccos(cos_angle)

    glow = np.exp(-angle * GLOW_FALLOFF) * 6.5
    horizon_warmth = np.exp(-np.abs(y) * 5.0) * 0.35
    sky += (SUN_TINT[None, None, :] * (glow + horizon_warmth)[..., None])

    disc = np.clip(1.0 - (angle / SUN_RADIUS) ** 2, 0.0, 1.0) ** 0.35
    sky += SUN_TINT[None, None, :] * (disc * SUN_INTENSITY)[..., None]

    return np.clip(sky, 0.0, None).astype(np.float64)


def to_rgbe(rgb):
    """Float RGB -> 4-byte RGBE, the Radiance shared-exponent encoding."""
    peak = rgb.max(axis=2)
    out = np.zeros(rgb.shape[:2] + (4,), dtype=np.uint8)
    lit = peak > 1e-32
    mant, expo = np.frexp(np.where(lit, peak, 1.0))
    scale = np.where(lit, mant * 256.0 / np.where(peak > 0, peak, 1.0), 0.0)
    for c in range(3):
        out[:, :, c] = np.clip(rgb[:, :, c] * scale, 0, 255).astype(np.uint8)
    out[:, :, 3] = np.where(lit, np.clip(expo + 128, 0, 255), 0).astype(np.uint8)
    return out


def write_hdr(path, rgbe):
    h, w = rgbe.shape[:2]
    # Flat (non-RLE) scanlines. RGBELoader detects RLE by a 2,2 marker in
    # the first pixel of a scanline and falls back to flat reads otherwise,
    # so guard against a pixel accidentally looking like that marker.
    bad = (rgbe[:, 0, 0] == 2) & (rgbe[:, 0, 1] == 2) & (rgbe[:, 0, 2] < 0x80)
    rgbe[bad, 0, 0] = 3
    header = b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\nSOFTWARE=hkbk tools/make-hdri.py\n\n"
    header += ("-Y %d +X %d\n" % (h, w)).encode("ascii")
    with open(path, "wb") as f:
        f.write(header)
        f.write(rgbe.tobytes())


if __name__ == "__main__":
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.path.join(here, "assets", "hdr")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "campus-sky.hdr")
    sky = build_sky()
    write_hdr(out_path, to_rgbe(sky))
    size = os.path.getsize(out_path)
    print("wrote %s  (%d x %d, %.1f MB)" % (out_path, W, H, size / 1048576.0))
    print("peak radiance: %.1f   mean: %.3f" % (sky.max(), sky.mean()))
