"""Generátor ikony aplikace — ``assets/plc_studio.ico`` (multi-rozlišení).

Motiv = symbol značky PLCdesk (``brand/``): rámeček výkresu s razítkem v pravém dolním
rohu. Geometrie je opsaná z SVG (viewBox 64 × 64) a rasterizuje se tady (Pillow,
supersampling) — bez knihovny na SVG:

- 32 px a víc: ``plcdesk-symbol.svg`` (tah 4, dvě linky v razítku),
- pod 32 px: ``plcdesk-favicon.svg`` (tah 6, razítko bez linek) — README značky
  ji předepisuje pod 24 px, pro 24 px ikonu se drobné linky už slévají.

Ikona Windows se nepřepíná podle režimu jako favicon, a tmavý inkoust by na tmavém
hlavním panelu zmizel — symbol proto leží na světlé zaoblené dlaždici (bg značky).

Spuštění:  python -m plc_studio.make_icon   (vyžaduje Pillow)
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ASSETS = Path(__file__).resolve().parent / "assets"
ICO_FILE = ASSETS / "plc_studio.ico"

INK = (0x11, 0x1A, 0x2E, 255)
ACCENT = (0x24, 0x57, 0xC5, 255)
WHITE = (255, 255, 255, 255)
TILE = (0xF5, 0xF6, 0xF9, 255)
TILE_EDGE = (0xD6, 0xDC, 0xE6, 255)
SS = 8       # supersampling kvůli hladkým hranám
SIZES = [16, 24, 32, 48, 64, 128, 256]


def build(size: int) -> Image.Image:
    S = size * SS
    k = S / 64                                  # jednotka viewBoxu → pixely
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    edge = max(SS, round(k * 1))
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=round(k * 12), fill=TILE_EDGE)
    d.rounded_rectangle([edge, edge, S - 1 - edge, S - 1 - edge],
                        radius=round(k * 12) - edge, fill=TILE)

    def rect(x, y, w, h, fill):
        d.rectangle([round(x * k), round(y * k), round((x + w) * k) - 1,
                     round((y + h) * k) - 1], fill=fill)

    if size < 32:          # favicon: rámeček 6..58 × 11..53 tahem 6, razítko bez linek
        x0, y0, x1, y1, t = 6, 11, 58, 53, 6
        sx, sy, sw, sh, lines = 34, 34, 21, 16, ()
    else:                  # symbol: rámeček 7..57 × 11..53 tahem 4, dvě linky v razítku
        x0, y0, x1, y1, t = 7, 11, 57, 53, 4
        sx, sy, sw, sh, lines = 36, 36, 19, 15, ((38, 40, 15, 2), (38, 45, 15, 2))
    h = t / 2              # tah SVG leží na středu obrysu
    rect(x0 - h, y0 - h, x1 - x0 + t, t, INK)
    rect(x0 - h, y1 - h, x1 - x0 + t, t, INK)
    rect(x0 - h, y0 - h, t, y1 - y0 + t, INK)
    rect(x1 - h, y0 - h, t, y1 - y0 + t, INK)
    rect(sx, sy, sw, sh, ACCENT)
    for ln in lines:
        rect(*ln, WHITE)
    return im.resize((size, size), Image.LANCZOS)


def main() -> int:
    ASSETS.mkdir(parents=True, exist_ok=True)
    frames = [build(s) for s in SIZES]
    frames[-1].save(ICO_FILE, format="ICO", sizes=[(s, s) for s in SIZES],
                    append_images=frames[:-1])
    print(f"Ikona uložena: {ICO_FILE}  (sizes {SIZES})")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
