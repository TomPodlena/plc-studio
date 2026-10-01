"""Náhled výkresů: SVG z jádra vykreslené nativně na ``tk.Canvas``.

Jádro (``drawing.ts``) generuje jen čáry, kružnice, obdélníky a texty, takže
není potřeba žádná knihovna na rasterizaci — prvky se překreslí přímo na
plátno a jdou zoomovat a posouvat. Barvy ``var(--…)`` a ``currentColor``
z webového tématu se mapují na paletu aplikace.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET

import tkinter as tk
from tkinter import ttk

from . import theme

# CSS proměnné webového tématu → paleta desktopu
_VARS = {
    "line": "#9FB0A6",
    "muted": "#6B7A8C",
    "warn": theme.WARN,
    "chip": theme.FIELD,
    "accent": theme.ACCENT,
}
_DESCENT = 0.22  # podíl výšky písma pod účařím (Consolas) — SVG kotví text na účaří


def _color(value: str | None, default: str = "") -> str:
    """Barva SVG → barva Tk ('' = bez barvy)."""
    if not value:
        return default
    v = value.strip()
    if v == "none":
        return ""
    if v == "currentColor":
        return theme.FG
    m = re.match(r"var\(--([\w-]+)(?:,\s*([^)]+))?\)", v)
    if m:
        return _VARS.get(m.group(1)) or (m.group(2) or default).strip()
    return v


def _style(el) -> dict:
    out = {}
    for part in (el.get("style") or "").split(";"):
        if ":" in part:
            k, v = part.split(":", 1)
            out[k.strip()] = v.strip()
    return out


def parse_svg(svg: str) -> dict:
    """SVG text → ``{"w", "h", "items"}``; items jsou n-tice připravené k vykreslení."""
    root = ET.fromstring(svg)
    vb = (root.get("viewBox") or "0 0 980 600").split()
    width, height = float(vb[2]), float(vb[3])
    items = []
    f = lambda el, name, d=0.0: float(el.get(name) or d)  # noqa: E731
    for el in root.iter():
        tag = el.tag.rsplit("}", 1)[-1]
        if tag == "line":
            items.append(("line", f(el, "x1"), f(el, "y1"), f(el, "x2"), f(el, "y2"),
                          _color(el.get("stroke"), theme.FG), f(el, "stroke-width", 1)))
        elif tag == "circle":
            items.append(("circle", f(el, "cx"), f(el, "cy"), f(el, "r"),
                          _color(el.get("stroke"), theme.FG), _color(el.get("fill")),
                          f(el, "stroke-width", 1)))
        elif tag == "rect":
            items.append(("rect", f(el, "x"), f(el, "y"), f(el, "width"), f(el, "height"),
                          _color(el.get("stroke")), _color(el.get("fill")),
                          f(el, "stroke-width", 1)))
        elif tag == "text":
            st = _style(el)
            size = float(re.sub(r"[^\d.]", "", st.get("font-size", "11")) or 11)
            bold = st.get("font-weight", "") in ("600", "700", "bold")
            items.append(("text", f(el, "x"), f(el, "y"), "".join(el.itertext()),
                          size, bold, el.get("text-anchor") or "start",
                          _color(st.get("fill"), theme.FG)))
    return {"w": width, "h": height, "items": items}


class SvgView(ttk.Frame):
    """Plátno s výkresem: posuvníky, zoom (tlačítka, Ctrl+kolečko), tažení myší."""

    def __init__(self, parent, *, height: int = 320):
        super().__init__(parent)
        self._doc: dict | None = None
        self._scale = 1.0
        self._fit = True  # dokud uživatel nezoomuje, drží výkres na šířku okna

        bar = ttk.Frame(self)
        bar.pack(fill="x", pady=(0, 4))
        ttk.Button(bar, text="−", width=3, command=lambda: self.zoom(1 / 1.2)).pack(side="left")
        ttk.Button(bar, text="+", width=3, command=lambda: self.zoom(1.2)).pack(side="left", padx=(4, 0))
        ttk.Button(bar, text="Na šířku", command=self.fit_width).pack(side="left", padx=(4, 0))
        ttk.Button(bar, text="100 %", command=lambda: self.set_scale(1.0)).pack(side="left", padx=(4, 0))
        self._zoom_lbl = ttk.Label(bar, text="", style="Dim.TLabel")
        self._zoom_lbl.pack(side="left", padx=10)
        ttk.Label(bar, text="kolečko = posun · Ctrl+kolečko = zoom · tažením posun",
                  style="Dim.TLabel").pack(side="right")

        body = ttk.Frame(self)
        body.pack(fill="both", expand=True)
        body.rowconfigure(0, weight=1)
        body.columnconfigure(0, weight=1)
        self.canvas = tk.Canvas(body, bg="#FFFFFF", height=height, highlightthickness=1,
                                highlightbackground=theme.BORDER)
        ys = ttk.Scrollbar(body, orient="vertical", command=self.canvas.yview)
        xs = ttk.Scrollbar(body, orient="horizontal", command=self.canvas.xview)
        self.canvas.configure(yscrollcommand=ys.set, xscrollcommand=xs.set)
        self.canvas.grid(row=0, column=0, sticky="nsew")
        ys.grid(row=0, column=1, sticky="ns")
        xs.grid(row=1, column=0, sticky="ew")

        c = self.canvas
        c.bind("<Configure>", self._on_resize)
        c.bind("<MouseWheel>", lambda e: c.yview_scroll(-1 if e.delta > 0 else 1, "units"))
        c.bind("<Shift-MouseWheel>", lambda e: c.xview_scroll(-1 if e.delta > 0 else 1, "units"))
        c.bind("<Control-MouseWheel>", lambda e: self.zoom(1.2 if e.delta > 0 else 1 / 1.2))
        c.bind("<ButtonPress-1>", lambda e: c.scan_mark(e.x, e.y))
        c.bind("<B1-Motion>", lambda e: c.scan_dragto(e.x, e.y, gain=1))

    # --- obsah -----------------------------------------------------------------

    def show(self, svg: str) -> None:
        try:
            self._doc = parse_svg(svg) if svg else None
        except ET.ParseError:
            self._doc = None
        self._fit = True
        self._apply_fit()
        self._draw()

    # --- zoom --------------------------------------------------------------------

    def set_scale(self, scale: float) -> None:
        self._fit = False
        self._scale = min(4.0, max(0.25, scale))
        self._draw()

    def zoom(self, factor: float) -> None:
        self.set_scale(self._scale * factor)

    def fit_width(self) -> None:
        self._fit = True
        self._apply_fit()
        self._draw()

    def _apply_fit(self) -> None:
        if self._doc is None:
            return
        avail = self.canvas.winfo_width() - 8
        if avail > 50:
            self._scale = min(4.0, max(0.25, avail / self._doc["w"]))

    def _on_resize(self, _event) -> None:
        if self._fit and self._doc is not None:
            old = self._scale
            self._apply_fit()
            if abs(old - self._scale) > 0.005:
                self._draw()

    # --- kreslení ----------------------------------------------------------------

    def _draw(self) -> None:
        c, s = self.canvas, self._scale
        c.delete("all")
        self._zoom_lbl.configure(text=f"{round(s * 100)} %")
        if self._doc is None:
            c.configure(scrollregion=(0, 0, 0, 0))
            return
        for it in self._doc["items"]:
            kind = it[0]
            if kind == "line":
                _, x1, y1, x2, y2, stroke, width = it
                c.create_line(x1 * s, y1 * s, x2 * s, y2 * s, fill=stroke,
                              width=max(1, round(width * s)))
            elif kind == "circle":
                _, cx, cy, r, stroke, fill, width = it
                c.create_oval((cx - r) * s, (cy - r) * s, (cx + r) * s, (cy + r) * s,
                              outline=stroke, fill=fill, width=max(1, round(width * s)))
            elif kind == "rect":
                _, x, y, w, h, stroke, fill, width = it
                c.create_rectangle(x * s, y * s, (x + w) * s, (y + h) * s, outline=stroke,
                                   fill=fill, width=max(1, round(width * s)) if stroke else 0)
            else:
                _, x, y, txt, size, bold, anchor, fill = it
                px = max(5, round(size * s))
                font = ("Consolas", -px, "bold") if bold else ("Consolas", -px)
                tk_anchor = {"start": "sw", "middle": "s", "end": "se"}.get(anchor, "sw")
                c.create_text(x * s, (y + size * _DESCENT) * s, text=txt, font=font,
                              fill=fill, anchor=tk_anchor)
        c.configure(scrollregion=(0, 0, self._doc["w"] * s, self._doc["h"] * s))
