#!/usr/bin/env python3
"""Stamp a build id + cache-busting version into index.html.

The browser caches ES modules aggressively; without a fresh URL a fixed file
can silently keep running as the old version. This writes
    window.LH_BUILD = "v12 · 5b5a0e7"
    src/main.js?v=<hash>
    vendor/three.module.js?v=<hash>
so the page always pulls the current code and the badge tells us which build is
actually live.

Usage:  python3 tools/stamp_build.py [--check]
        --check exits 1 when a placeholder is still present (CI friendly)
"""
import hashlib
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"
PLACEHOLDERS = ("__BUILD__", "__VER__")


def source_hash() -> str:
    h = hashlib.sha1()
    files = sorted(
        [p for p in (ROOT / "src").glob("*.js")]
        + [ROOT / "index.html", ROOT / "style.css"]
    )
    for f in files:
        if f.name == "index.html":
            # hash without the previous stamp so the value is stable
            text = re.sub(r'__VER__|v\d+ · [0-9a-f]{7}', "", f.read_text())
            h.update(f.name.encode() + text.encode())
        else:
            h.update(f.name.encode() + f.read_bytes())
    return h.hexdigest()[:7]


def git_rev() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, stderr=subprocess.DEVNULL
        ).decode().strip()
    except Exception:
        return "dev"


IMPORT_RE = re.compile(r'(from\s+"\./[\w-]+\.js)(\?v=[0-9a-f]+)?(")')


def stamp_modules(digest: str) -> int:
    """Version every relative import inside src/ so a warm browser cache can
    never serve a stale module. Idempotent: bumps an existing ?v= value."""
    changed = 0
    for f in sorted((ROOT / "src").glob("*.js")):
        text = f.read_text()
        new = IMPORT_RE.sub(lambda m: f"{m.group(1)}?v={digest}{m.group(3)}", text)
        if new != text:
            f.write_text(new)
            changed += 1
    return changed


def main() -> int:
    text = INDEX.read_text()
    if "--check" in sys.argv:
        left = [p for p in PLACEHOLDERS if p in text]
        if left:
            print(f"unstamped placeholders in index.html: {left}")
            return 1
        print("index.html is stamped")
        return 0

    digest = source_hash()
    build = f"v{digest} · {git_rev()}"
    # keep the version stable per source state, so caching works in our favour
    text = re.sub(r'__VER__|v[0-9a-f]{7}(?=")', digest, text)
    text = re.sub(r'__BUILD__|v[0-9a-f]{7} · [0-9a-f]{7}(?=")', build, text)
    INDEX.write_text(text)
    modules = stamp_modules(digest)
    print(f"stamped index.html: {build} (ver {digest})")
    print(f"versioned imports in {modules} module file(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
