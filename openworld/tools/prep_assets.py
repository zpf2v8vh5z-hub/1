#!/usr/bin/env python3
"""Turn AI-generated source images into game-ready PBR assets.

For every texture:
  1. feather-blend a mirrored copy over the borders -> seamless tiling
  2. Lanczos resize to a power of two, mild unsharp mask
  3. derive a tangent-space normal map from the luminance (Sobel)
  4. save albedo as JPEG and normal map as PNG

Usage:  python3 tools/prep_assets.py
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "assets" / "raw"
OUT = ROOT / "assets" / "tex"
SIZE = 512
FEATHER = 0.20
NORMAL_STRENGTH = 2.4


def make_seamless(img: Image.Image, feather: float = FEATHER) -> Image.Image:
    """Blend towards a 180°-rotated copy near the borders so edges wrap."""
    w, h = img.size
    arr = np.asarray(img.convert("RGB"), dtype=np.float32)
    mirror = arr[::-1, ::-1]

    x = np.linspace(0, 1, w, dtype=np.float32)
    y = np.linspace(0, 1, h, dtype=np.float32)
    ss = lambda t: t * t * (3 - 2 * t)
    rx = ss(np.clip((x - (1 - feather)) / feather, 0, 1))
    lx = ss(np.clip((feather - x) / feather, 0, 1))
    ry = ss(np.clip((y - (1 - feather)) / feather, 0, 1))
    ly = ss(np.clip((feather - y) / feather, 0, 1))

    alpha = np.clip(np.maximum(rx, lx)[:, None] + np.maximum(ry, ly)[None, :], 0, 1)[..., None] * 0.5
    out = np.clip(arr * (1 - alpha) + mirror * alpha, 0, 255).astype(np.uint8)
    return Image.fromarray(out, "RGB")


def normal_map(img: Image.Image, strength: float = NORMAL_STRENGTH) -> Image.Image:
    """Convert luminance to a tangent-space normal map (wrapping Sobel)."""
    g = np.asarray(img.convert("L"), dtype=np.float32) / 255.0
    # blur first: pixel-level noise makes terrible normals
    g = np.asarray(
        Image.fromarray((g * 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(radius=1.2)
        ),
        dtype=np.float32,
    ) / 255.0

    sx = (np.roll(g, -1, axis=1) - np.roll(g, 1, axis=1)) * 0.5
    sy = (np.roll(g, -1, axis=0) - np.roll(g, 1, axis=0)) * 0.5

    nx = -sx * strength
    ny = -sy * strength
    nz = np.ones_like(g)
    length = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx, ny, nz = nx / length, ny / length, nz / length

    rgb = np.stack([(nx * 0.5 + 0.5) * 255, (ny * 0.5 + 0.5) * 255, (nz * 0.5 + 0.5) * 255], axis=-1)
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def process(name: str, size: int = SIZE, normal_strength: float = NORMAL_STRENGTH) -> None:
    src = RAW / name
    if not src.exists():
        print(f"!! missing {name}")
        return
    tile = make_seamless(Image.open(src))
    tile = tile.resize((size, size), Image.LANCZOS)
    tile = tile.filter(ImageFilter.UnsharpMask(radius=1.4, percent=50, threshold=2))

    stem = Path(name).stem
    albedo = OUT / f"{stem}.jpg"
    tile.save(albedo, quality=84, optimize=True, progressive=True)

    nm = normal_map(tile, normal_strength)
    normal = OUT / f"{stem}_n.png"
    nm.save(normal, optimize=True)

    a = np.asarray(tile, dtype=np.float32)
    seam_v = np.abs(a[:, 0] - a[:, -1]).mean()
    seam_h = np.abs(a[0, :] - a[-1, :]).mean()
    print(
        f"{stem:>16}  {albedo.stat().st_size // 1024:>4} KB + {normal.stat().st_size // 1024:>4} KB normals"
        f"   seam {seam_v:5.1f}/{seam_h:5.1f}"
    )


TEXTURES = [
    ("asphalt.jpg", 512, 1.6),
    ("sidewalk.jpg", 512, 2.6),
    ("facade-glass.jpg", 512, 2.2),
    ("facade-concrete.jpg", 512, 2.4),
    ("facade-brick.jpg", 512, 2.8),
    ("grass.jpg", 512, 1.8),
]

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, size, strength in TEXTURES:
        process(name, size, strength)
    print(f"\nwrote {len(list(OUT.glob('*')))} files to {OUT.relative_to(ROOT)}")
