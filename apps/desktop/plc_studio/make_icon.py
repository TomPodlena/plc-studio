"""Generátor ikony aplikace — ``assets/plc_studio.ico`` (multi-rozlišení).

Motiv: zelená zaoblená dlaždice (stejná jako u ostatních nástrojů PearTec)
s bílou příčkou žebříčkového diagramu — kontakt a cívka mezi dvěma lištami.

Spuštění:  python -m plc_studio.make_icon   (vyžaduje Pillow)
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ASSETS = Path(__file__).resolve().parent / "assets"
ICO_FILE = ASSETS / "plc_studio.ico"

PRIMARY = (0x1F, 0x48, 0x2A)
ACCENT = (0x00, 0x86, 0x39)
WHITE = (255, 255, 255, 255)
SS = 4       # supersampling kvůli hladkým hranám
BASE = 256


def _lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def build(scale: int = BASE) -> Image.Image:
    S = scale * SS
    pad = round(S * 0.05)
    inner = S - 2 * pad
    tile = Image.new("RGB", (inner, inner))
    px = ImageDraw.Draw(tile)
    for y in range(inner):  # svislý přechod tmavá → brandová zelená
        px.line([(0, y), (inner, y)], fill=_lerp(_lerp(PRIMARY, ACCENT, 0.05),
                                                 _lerp(PRIMARY, ACCENT, 0.85), y / (inner - 1)))
    mask = Image.new("L", (inner, inner), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, inner - 1, inner - 1],
                                           radius=round(inner * 0.24), fill=255)
    canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    canvas.paste(tile, (pad, pad), mask)

    d = ImageDraw.Draw(canvas)
    w = max(1, round(inner * 0.055))                 # tloušťka čar
    x0, x1 = pad + inner * 0.20, pad + inner * 0.80  # napájecí lišty
    y_top, y_bot = pad + inner * 0.22, pad + inner * 0.78
    d.line([(x0, y_top), (x0, y_bot)], fill=WHITE, width=w)
    d.line([(x1, y_top), (x1, y_bot)], fill=WHITE, width=w)

    # příčka 1: spínací kontakt  —| |—
    y = pad + inner * 0.38
    cx, gap, bar = pad + inner * 0.50, inner * 0.07, inner * 0.11
    d.line([(x0, y), (cx - gap, y)], fill=WHITE, width=w)
    d.line([(cx + gap, y), (x1, y)], fill=WHITE, width=w)
    d.line([(cx - gap, y - bar), (cx - gap, y + bar)], fill=WHITE, width=w)
    d.line([(cx + gap, y - bar), (cx + gap, y + bar)], fill=WHITE, width=w)

    # příčka 2: cívka  —( )—
    y = pad + inner * 0.63
    r = inner * 0.10
    d.line([(x0, y), (cx - r, y)], fill=WHITE, width=w)
    d.line([(cx + r, y), (x1, y)], fill=WHITE, width=w)
    d.ellipse([cx - r, y - r, cx + r, y + r], outline=WHITE, width=w)

    return canvas.resize((scale, scale), Image.LANCZOS)


def main() -> int:
    ASSETS.mkdir(parents=True, exist_ok=True)
    sizes = [16, 24, 32, 48, 64, 128, 256]
    build(BASE).save(ICO_FILE, format="ICO", sizes=[(s, s) for s in sizes])
    print(f"Ikona uložena: {ICO_FILE}  (sizes {sizes})")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
