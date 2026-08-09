"""Regenerate web/favicon.ico, web/apple-touch-icon.png and web/favicon-32.png.

    python tools/make-icons.py          (from the repository root; needs Pillow)

`web/favicon.svg` is the source of truth for the mark. This script exists so
the raster sizes are not unreproducible binaries sitting in the tree — if the
SVG changes, change the geometry below to match and run this again.

It draws the shapes rather than rasterising the SVG: there is no SVG renderer
in this toolchain, and pulling one in for four rectangles would be silly.
"""

import io
import struct

from PIL import Image, ImageDraw

# ── geometry, mirroring web/favicon.svg on its 64×64 grid ────────────────
PLATE = (10, 12, 14, 255)  # #0a0c0e — the app ground
BARS = [
    (6, 36, 10, 16, (122, 90, 62, 255)),     # #7a5a3e
    (20, 28, 10, 24, (140, 103, 74, 255)),   # #8c674a
    (34, 20, 10, 32, (189, 138, 107, 255)),  # #bd8a6b
    (48, 12, 10, 40, (242, 180, 151, 255)),  # #f2b497
]
GRID = 64
RADIUS = 14
BAR_RADIUS = 2.5


def render(size, supersample=8):
    """Draw at N× and downsample — Pillow has no antialiased vector fill."""
    s = size * supersample
    k = s / GRID
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=RADIUS * k, fill=PLATE)
    for x, y, w, h, colour in BARS:
        d.rounded_rectangle(
            [x * k, y * k, (x + w) * k - 1, (y + h) * k - 1],
            radius=BAR_RADIUS * k,
            fill=colour,
        )
    return img.resize((size, size), Image.LANCZOS)


def write_ico(path, sizes):
    """Write the container by hand.

    Pillow's ICO plugin takes `append_images`, which is a GIF/TIFF idea: it
    silently keeps one frame, so the file claims to be multi-size and is not.
    The format is a header, one 16-byte directory entry per image, then the
    payloads — and PNG payloads are accepted by every browser that matters.
    Doing it this way also means each size is its own LANCZOS render rather
    than a downsample of a downsample.
    """
    payloads = []
    for s in sizes:
        buf = io.BytesIO()
        render(s).save(buf, format="PNG")
        payloads.append(buf.getvalue())

    header = struct.pack("<HHH", 0, 1, len(sizes))
    offset = len(header) + 16 * len(sizes)
    entries = b""
    for s, data in zip(sizes, payloads):
        entries += struct.pack(
            "<BBBBHHII", s % 256, s % 256, 0, 0, 1, 32, len(data), offset
        )
        offset += len(data)

    with open(path, "wb") as f:
        f.write(header + entries + b"".join(payloads))


if __name__ == "__main__":
    write_ico("web/favicon.ico", [16, 32, 48, 64])
    # Apple applies its own mask, so this one is opaque and unpadded.
    render(180).convert("RGB").save("web/apple-touch-icon.png", format="PNG")
    render(32).save("web/favicon-32.png", format="PNG")
    print("written: web/favicon.ico (16/32/48/64), web/apple-touch-icon.png, web/favicon-32.png")
