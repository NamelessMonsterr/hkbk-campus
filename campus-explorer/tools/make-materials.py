#!/usr/bin/env python3
"""
Generates assets/textures/*.png — the PBR map set used by
assets/models/main-block.glb.

WHY PROCEDURAL
--------------
The model had PBR *values* (base colour, roughness, metalness) but no
*maps*, so every surface was perfectly uniform. Uniformity is the single
most reliable tell that a surface is CG: real concrete varies in tone and
roughness across a wall, catches dirt where water runs, and is darker in
corners. None of that needs an artist — it is noise, and noise is
computable.

What is generated:

  concrete_albedo.png     tonal variation, aggregate speckle, streaking
  concrete_normal.png     surface relief: pitting, aggregate, form-board
                          seams
  concrete_orm.png        packed R=ambient occlusion, G=roughness,
                          B=metalness (the glTF convention)

  glass_normal.png        very subtle panel waviness — real curtain-wall
                          glass is never optically flat, and the slight
                          distortion of reflections is most of what makes
                          it read as glass rather than a mirror
  glass_orm.png           roughness variation from smudging and edge
                          sealant

HONEST SCOPE
------------
These are *procedural approximations*, not scanned material data. They
carry no photographic detail: no real aggregate, no real staining pattern,
no weathering that corresponds to how this particular building actually
ages. They will make surfaces read as plausibly non-uniform, not as
photographically correct. A scanned set from a source like Poly Haven or
AmbientCG would be better and is a drop-in replacement.

All maps are tileable (generated with wrapped noise) and are applied with
REPEAT sampling at a fixed texel density, so a 2 m wall and a 34 m wall
show the same grain size.

Run:  python3 tools/make-materials.py
"""

import os
import numpy as np
from PIL import Image

SIZE = 512
RNG = np.random.default_rng(20260805)


# ------------------------------------------------------------ noise utils

def _wrapped_smooth(size, cells, rng):
    """Value noise that tiles: sample a small lattice and resize with
    wraparound, so the left edge continues into the right."""
    lattice = rng.random((cells, cells))
    tiled = np.tile(lattice, (2, 2))
    img = Image.fromarray((tiled * 255).astype(np.uint8)).resize(
        (size * 2, size * 2), Image.BICUBIC)
    arr = np.asarray(img, dtype=np.float64) / 255.0
    return arr[:size, :size]


def fbm(size, octaves=5, base_cells=4, persistence=0.5, rng=RNG):
    total = np.zeros((size, size))
    amp, norm, cells = 1.0, 0.0, base_cells
    for _ in range(octaves):
        total += _wrapped_smooth(size, cells, rng) * amp
        norm += amp
        amp *= persistence
        cells *= 2
    return total / norm


def normalize(a):
    lo, hi = a.min(), a.max()
    return (a - lo) / (hi - lo) if hi > lo else np.zeros_like(a)


def height_to_normal(height, strength=2.0):
    """Sobel-ish gradient to tangent-space normal map. np.roll keeps it
    tileable at the seams."""
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * strength
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * strength
    nz = np.ones_like(height)
    length = np.sqrt(dx * dx + dy * dy + nz * nz)
    n = np.stack([-dx / length, -dy / length, nz / length], axis=-1)
    return ((n * 0.5 + 0.5) * 255).astype(np.uint8)


def save(arr_u8, path):
    Image.fromarray(arr_u8).save(path, optimize=True)
    return os.path.getsize(path)


# -------------------------------------------------------------- concrete

def concrete():
    # Height: broad undulation + fine aggregate pitting
    broad = fbm(SIZE, octaves=4, base_cells=3, persistence=0.55)
    fine = fbm(SIZE, octaves=3, base_cells=48, persistence=0.4)
    pits = (fbm(SIZE, octaves=2, base_cells=96, persistence=0.5) < 0.32).astype(float)

    height = broad * 0.55 + fine * 0.4 - pits * 0.12

    # Form-board seams: horizontal lines every ~1/4 of the tile, the marks
    # left where shuttering panels met. Cheap, and very recognisable.
    yy = np.arange(SIZE)[:, None].repeat(SIZE, axis=1)
    seam = np.exp(-((yy % (SIZE // 4)) ** 2) / 6.0) * 0.5
    seam += np.exp(-(((yy % (SIZE // 4)) - SIZE // 4) ** 2) / 6.0) * 0.5
    height -= seam * 0.16

    normal = height_to_normal(normalize(height), strength=2.4)

    # Albedo: base grey, tonal drift, aggregate speckle, vertical streaking
    tone = normalize(fbm(SIZE, octaves=5, base_cells=2, persistence=0.6))
    speckle = normalize(fbm(SIZE, octaves=2, base_cells=110, persistence=0.5))
    streak_noise = fbm(SIZE, octaves=3, base_cells=6, persistence=0.5)
    streak = np.cumsum(streak_noise - streak_noise.mean(), axis=0)
    streak = normalize(streak)

    grey = 0.80 + (tone - 0.5) * 0.13 + (speckle - 0.5) * 0.07
    grey -= streak * 0.09          # water staining, darker lower down
    grey -= pits * 0.05
    albedo = np.clip(grey, 0, 1)
    albedo_rgb = np.stack([albedo, albedo * 0.995, albedo * 0.975], axis=-1)

    # AO: cavities and seams are darker
    ao = np.clip(1.0 - (1.0 - normalize(height)) * 0.45 - seam * 0.25, 0, 1)

    # Roughness: rougher in the pits and where it is dirty
    rough = np.clip(0.68 + (1 - normalize(height)) * 0.18 + streak * 0.08, 0, 1)

    metal = np.zeros_like(rough)

    orm = np.stack([ao, rough, metal], axis=-1)
    return (
        (albedo_rgb * 255).astype(np.uint8),
        normal,
        (orm * 255).astype(np.uint8),
    )


# ----------------------------------------------------------------- glass

def glass():
    # Panel waviness. Real curtain-wall glass bows slightly between
    # fixings; the wobble in the reflection is what sells it.
    wave = fbm(SIZE, octaves=3, base_cells=3, persistence=0.6)
    panel = np.zeros((SIZE, SIZE))
    step = SIZE // 4
    for gy in range(0, SIZE, step):
        for gx in range(0, SIZE, step):
            yy, xx = np.mgrid[0:step, 0:step]
            bow = np.sin(np.pi * yy / step) * np.sin(np.pi * xx / step)
            panel[gy:gy + step, gx:gx + step] = bow * (0.6 + 0.4 * wave[gy, gx])
    height = panel * 0.35 + wave * 0.1
    normal = height_to_normal(normalize(height), strength=0.55)

    # Roughness: mostly mirror, with smudging and dirtier panel edges
    smudge = normalize(fbm(SIZE, octaves=4, base_cells=8, persistence=0.5))
    edge = np.zeros((SIZE, SIZE))
    for g in range(0, SIZE + 1, step):
        lo, hi = max(0, g - 3), min(SIZE, g + 3)
        edge[lo:hi, :] = 1.0
        edge[:, lo:hi] = 1.0
    rough = np.clip(0.05 + smudge * 0.09 + edge * 0.10, 0, 1)
    ao = np.clip(1.0 - edge * 0.30, 0, 1)
    metal = np.full_like(rough, 0.85)
    metal = np.clip(metal - edge * 0.5, 0, 1)

    orm = np.stack([ao, rough, metal], axis=-1)
    return normal, (orm * 255).astype(np.uint8)


if __name__ == "__main__":
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(here, "assets", "textures")
    os.makedirs(out, exist_ok=True)

    c_albedo, c_normal, c_orm = concrete()
    g_normal, g_orm = glass()

    files = [
        ("concrete_albedo.png", c_albedo),
        ("concrete_normal.png", c_normal),
        ("concrete_orm.png", c_orm),
        ("glass_normal.png", g_normal),
        ("glass_orm.png", g_orm),
    ]
    total = 0
    for name, arr in files:
        n = save(arr, os.path.join(out, name))
        total += n
        print("  %-22s %5.1f KB  %s" % (name, n / 1024.0, "x".join(map(str, arr.shape[:2]))))
    print("total: %.1f KB" % (total / 1024.0))
