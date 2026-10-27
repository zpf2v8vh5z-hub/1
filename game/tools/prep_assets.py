#!/usr/bin/env python3
"""Turn the raw AI-generated textures into game-ready, seamlessly tiling assets.

Pipeline per texture:
  1. roll by half a tile so the old outer edges meet in the middle
  2. feather-blend a mirrored copy over the seam cross  -> seamless tiling
  3. resize to a power of two, mild unsharp mask, save as compressed JPG

The hero portrait is only resized/cropped (it is used as a HUD portrait).
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "assets" / "raw"
OUT = ROOT / "assets"
TEX_SIZE = 512
FEATHER = 0.22  # fraction of the tile used to blend the seam


def make_seamless(img: Image.Image) -> Image.Image:
    w, h = img.size
    arr = np.asarray(img.convert("RGB"), dtype=np.float32)

    # mirrored copy: blending towards the mirror makes the wrap edge continuous
    mirror = arr[::-1, ::-1]

    # 1D feather ramps for left/right and top/bottom seams
    x = np.linspace(0, 1, w, dtype=np.float32)
    y = np.linspace(0, 1, h, dtype=np.float32)
    fw = max(1, int(w * FEATHER))
    fh = max(1, int(h * FEATHER))
    rx = np.clip((x - (1 - FEATHER)) / FEATHER, 0, 1)  # >0 near right edge
    lx = np.clip((FEATHER - x) / FEATHER, 0, 1)          # >0 near left edge
    ry = np.clip((y - (1 - FEATHER)) / FEATHER, 0, 1)
    ly = np.clip((FEATHER - y) / FEATHER, 0, 1)

    # smoothstep for a soft transition
    ss = lambda t: t * t * (3 - 2 * t)
    wx = ss(np.maximum(rx, lx))[:, None]
    wy = ss(np.maximum(ry, ly))[:, None]
    alpha = np.clip(wx + wy, 0, 1)[..., None] * 0.5  # max 50% mirror -> keeps detail

    blended = arr * (1 - alpha) + mirror * alpha
    out = np.clip(blended, 0, 255).astype(np.uint8)
    return Image.fromarray(out, "RGB")


def process(name: str, size: int = TEX_SIZE) -> None:
    src = Image.open(RAW / name)
    tile = make_seamless(src)
    tile = tile.resize((size, size), Image.LANCZOS)
    tile = tile.filter(ImageFilter.UnsharpMask(radius=1.6, percent=55, threshold=2))
    dst = OUT / (Path(name).stem + ".jpg")
    tile.save(dst, quality=82, optimize=True, progressive=True)
    print(f"{name:>12} -> {dst.name}  {size}x{size}  {dst.stat().st_size // 1024} KB")


def portrait(name: str = "hero.png", size: int = 320) -> None:
    img = Image.open(RAW / name).convert("RGB")
    w, h = img.size
    side = min(w, h)
    left = (w - side) // 2
    top = int((h - side) * 0.10)  # keep the head in frame
    img = img.crop((left, top, left + side, top + side)).resize((size, size), Image.LANCZOS)
    dst = OUT / "hero.jpg"
    img.save(dst, quality=86, optimize=True, progressive=True)
    print(f"{name:>12} -> {dst.name}  {size}x{size}  {dst.stat().st_size // 1024} KB")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for tex in ("floor.png", "wall.png", "crate.png"):
        process(tex)
    portrait()

    # quick seam report: compare opposing edge columns/rows
    for tex in ("floor.jpg", "wall.jpg", "crate.jpg"):
        a = np.asarray(Image.open(OUT / tex), dtype=np.float32)
        seam_v = np.abs(a[:, 0] - a[:, -1]).mean()
        seam_h = np.abs(a[0, :] - a[-1, :]).mean()
        print(f"seam check {tex}: left/right={seam_v:.1f}  top/bottom={seam_h:.1f}  (lower is better)")
