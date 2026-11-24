"""Witness 3D's app icon: the letter W of the Tiny5 font (SIL Open Font License, Stefan
Schmidt) in the accent colour on the app's ground, as the brand mark in the top bar shows it.

Tiny5 draws W on a five by five pixel grid; the grid is written out below (read off the font once)
so this script needs only Pillow. It writes the desktop app's icon.png (512 px) and icon.ico
(16 to 256 px), and prints the SVG used as the web and desktop favicon.

    python3 tools/brand/make_icons.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

W = ["#.#.#",
     "#.#.#",
     "#.#.#",
     ".#.#.",
     ".#.#."]
GROUND = (15, 15, 17, 255)   # --bg
ACCENT = (255, 77, 0, 255)   # --accent

ICONS = Path(__file__).resolve().parents[2] / "apps/desktop/src-tauri/icons"


def icon(size: int) -> Image.Image:
    """The mark at `size` pixels: each font pixel a whole number of pixels, centred."""
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=max(2, size // 6), fill=GROUND)
    unit = max(2, round(size * 0.12))
    off = (size - 5 * unit) // 2
    for y, row in enumerate(W):
        for x, on in enumerate(row):
            if on == "#":
                d.rectangle((off + x * unit, off + y * unit, off + (x + 1) * unit - 1, off + (y + 1) * unit - 1), fill=ACCENT)
    return im


def svg() -> str:
    cells = "".join(f'<rect x="{6 + 4 * x}" y="{6 + 4 * y}" width="4" height="4"/>'
                    for y, row in enumerate(W) for x, on in enumerate(row) if on == "#")
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
            '<rect width="32" height="32" rx="6" fill="#0f0f11"/>'
            f'<g fill="#ff4d00">{cells}</g></svg>')


if __name__ == "__main__":
    icon(512).save(ICONS / "icon.png")
    sizes = [16, 24, 32, 48, 64, 128, 256]
    icon(256).save(ICONS / "icon.ico", sizes=[(s, s) for s in sizes], append_images=[icon(s) for s in sizes])
    print(svg())
