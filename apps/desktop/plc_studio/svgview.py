"""Náhled výkresů: SVG z jádra vykreslené nativně na ``tk.Canvas``.

Jádro (``drawing.ts``, ``flow.ts``) generuje jen čáry, kružnice, obdélníky
a texty, takže není potřeba knihovna na rasterizaci — prvky se překreslí
přímo na plátno a jdou zoomovat a posouvat. Barvy ``var(--…)``
a ``currentColor`` z webového tématu se mapují na paletu aplikace.

Prvky nesou odkazy z atributů ``data-dev`` / ``data-mod`` / ``data-io`` /
``data-step`` (i zděděné ze skupiny ``<g>``) a popis z ``<title>``. Nad nimi
je postavená interaktivita: zvýraznění při najetí, bublina s popisem, klik
(``on_click``) a značky stavu (``marker``) — vybraný blok, aktivní krok…
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET

import tkinter as tk
from tkinter import ttk

from . import theme
from .i18n import _

# CSS proměnné webového tématu → paleta desktopu
_VARS = {
    "line": "#9FB0A6",
    "muted": "#6B7A8C",
    "warn": theme.WARN,
    "chip": theme.FIELD,
    "accent": theme.ACCENT,
    "err": theme.ERR,
}
_DESCENT = 0.22  # podíl výšky písma pod účařím (Consolas) — SVG kotví text na účaří
_META_KEYS = ("dev", "mod", "step")           # celočíselné odkazy
_PAPER = "#FFFFFF"

# Značky: (obrys, tloušťka, výplň prázdných bloků)
MARKS = {
    "hot": (theme.ACCENT, 2, "#EEF6F1"),
    "sel": (theme.ACCENT, 2, theme.TREE_SEL),
    "active": (theme.WARN, 2, "#FFEFC2"),
    "done": (theme.ACCENT, 1, "#E3F1E8"),
    "err": (theme.ERR, 2, theme.DANGER_BG),
    "on": (theme.ACCENT, 2, "#D5EFE0"),        # živá simulace: běží / otevřeno / signál TRUE
    "off": ("#9FB0A6", 1, "#ECEFED"),          # blokováno (enable = FALSE)
}


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


def _own_meta(el) -> dict:
    """Odkazy z atributů data-* jednoho prvku."""
    meta = {}
    for k in _META_KEYS:
        v = el.get("data-" + k)
        if v is not None:
            try:
                meta[k] = int(v)
            except ValueError:
                pass
    for k in ("io", "side"):
        if el.get("data-" + k) is not None:
            meta[k] = el.get("data-" + k)
    return meta


def parse_svg(svg: str) -> dict:
    """SVG text → ``{"w", "h", "items", "metas"}``.

    ``items`` jsou n-tice připravené k vykreslení, poslední prvek je index do
    ``metas`` (nebo -1, když prvek žádný odkaz nenese)."""
    root = ET.fromstring(svg)
    vb = (root.get("viewBox") or "0 0 980 600").split()
    items: list[tuple] = []
    metas: list[dict] = []
    seen: dict[tuple, int] = {}     # prvky se stejnými odkazy sdílejí jedno meta
    f = lambda el, name, d=0.0: float(el.get(name) or d)  # noqa: E731

    def walk(el, inherited: dict, idx: int) -> None:
        own = _own_meta(el)
        if own:
            meta = {**inherited, **own}
            title = next((c for c in el if c.tag.rsplit("}", 1)[-1] == "title"), None)
            if title is not None and title.text:
                meta["title"] = title.text
            key = tuple(sorted(meta.items()))
            if key not in seen:
                seen[key] = len(metas)
                metas.append(meta)
            inherited, idx = metas[seen[key]], seen[key]
        tag = el.tag.rsplit("}", 1)[-1]
        if tag == "line":
            items.append(("line", f(el, "x1"), f(el, "y1"), f(el, "x2"), f(el, "y2"),
                          _color(el.get("stroke"), theme.FG), f(el, "stroke-width", 1), idx))
        elif tag == "circle":
            items.append(("circle", f(el, "cx"), f(el, "cy"), f(el, "r"),
                          _color(el.get("stroke"), theme.FG), _color(el.get("fill")),
                          f(el, "stroke-width", 1), idx))
        elif tag == "rect":
            items.append(("rect", f(el, "x"), f(el, "y"), f(el, "width"), f(el, "height"),
                          _color(el.get("stroke")), _color(el.get("fill")),
                          f(el, "stroke-width", 1), idx))
        elif tag == "text":
            st = _style(el)
            size = float(re.sub(r"[^\d.]", "", st.get("font-size", "11")) or 11)
            bold = st.get("font-weight", "") in ("600", "700", "bold")
            items.append(("text", f(el, "x"), f(el, "y"), "".join(el.itertext()),
                          size, bold, el.get("text-anchor") or "start",
                          _color(st.get("fill"), theme.FG), idx))
        if tag != "text":
            for child in el:
                walk(child, inherited, idx)

    walk(root, {}, -1)
    plot = [float(v) for v in (root.get("data-plot") or "").split()]
    return {"w": float(vb[2]), "h": float(vb[3]), "items": items, "metas": metas,
            "plot": plot if len(plot) == 3 else None}


def related(a: dict, b: dict) -> bool:
    """Patří prvek ``b`` ke stejnému celku jako ``a``? (krok / signál / zařízení / modul)"""
    if "step" in a:
        return b.get("step") == a["step"]
    if "io" in a and "dev" not in a:
        return b.get("io") == a["io"]
    if "dev" in a:
        return b.get("dev") == a["dev"]
    if "mod" in a:
        return b.get("mod") == a["mod"]
    return False


class SvgView(ttk.Frame):
    """Plátno s výkresem: posuvníky, zoom, tažení myší, klikací prvky.

    ``on_click(meta)`` — klik na prvek s odkazem; ``marker(meta)`` vrací jméno
    značky z ``MARKS`` (nebo None); ``band=True`` podloží vybrané signály pruhem
    (listy zapojení); ``overlay(canvas, scale)`` dokreslí vlastní prvky."""

    def __init__(self, parent, *, height: int = 320, on_click=None, marker=None,
                 band: bool = False, overlay=None):
        super().__init__(parent)
        self._doc: dict | None = None
        self._scale = 1.0
        self._fit = True  # dokud uživatel nezoomuje, drží výkres na šířku okna
        self.on_click = on_click
        self.marker = marker
        self.overlay = overlay
        self._band = band
        self._hover = -1
        self._see = None
        self._press: tuple[int, int] | None = None
        self._dragging = False
        self._tip: tk.Toplevel | None = None
        self._tip_job = None

        bar = ttk.Frame(self)
        bar.pack(fill="x", pady=(0, 4))
        ttk.Button(bar, text="−", width=3, command=lambda: self.zoom(1 / 1.2)).pack(side="left")
        ttk.Button(bar, text="+", width=3, command=lambda: self.zoom(1.2)).pack(side="left", padx=(4, 0))
        ttk.Button(bar, text=_("Na šířku"), command=self.fit_width).pack(side="left", padx=(4, 0))
        ttk.Button(bar, text="100 %", command=lambda: self.set_scale(1.0)).pack(side="left", padx=(4, 0))
        self._zoom_lbl = ttk.Label(bar, text="", style="Dim.TLabel")
        self._zoom_lbl.pack(side="left", padx=10)
        hint = ttk.Label(bar, text=(_("klik = odkaz") + " · " if on_click else "")
                         + _("Ctrl+kolečko = zoom"), style="Dim.TLabel")
        hint.pack(side="right")

        def fit_hint(e) -> None:
            """V úzkém panelu nápovědu schovat celou, ať nevisí useknutá."""
            need = sum(w.winfo_reqwidth() + 10 for w in bar.winfo_children())
            if need > e.width:
                hint.pack_forget()
            elif not hint.winfo_manager():
                hint.pack(side="right")

        bar.bind("<Configure>", fit_hint)

        body = ttk.Frame(self)
        body.pack(fill="both", expand=True)
        body.rowconfigure(0, weight=1)
        body.columnconfigure(0, weight=1)
        self.canvas = tk.Canvas(body, bg=_PAPER, height=height, highlightthickness=1,
                                highlightbackground=theme.BORDER)
        c = self.canvas

        def scroll(view, *args):
            self._user_scrolled()
            view(*args)

        ys = ttk.Scrollbar(body, orient="vertical", command=lambda *a: scroll(c.yview, *a))
        xs = ttk.Scrollbar(body, orient="horizontal", command=lambda *a: scroll(c.xview, *a))
        c.configure(yscrollcommand=ys.set, xscrollcommand=xs.set)
        c.grid(row=0, column=0, sticky="nsew")
        ys.grid(row=0, column=1, sticky="ns")
        xs.grid(row=1, column=0, sticky="ew")

        c.bind("<Configure>", self._on_resize)
        c.bind("<MouseWheel>", lambda e: scroll(c.yview_scroll, -1 if e.delta > 0 else 1, "units"))
        c.bind("<Shift-MouseWheel>",
               lambda e: scroll(c.xview_scroll, -1 if e.delta > 0 else 1, "units"))
        c.bind("<Control-MouseWheel>", lambda e: self.zoom(1.2 if e.delta > 0 else 1 / 1.2))
        c.bind("<ButtonPress-1>", self._on_press)
        c.bind("<B1-Motion>", self._on_drag)
        c.bind("<ButtonRelease-1>", self._on_release)
        c.bind("<Motion>", self._on_motion)
        c.bind("<Leave>", lambda _e: self._set_hover(-1))
        c.bind("<Destroy>", lambda _e: self._hide_tip())

    # --- obsah -----------------------------------------------------------------

    def show(self, svg: str) -> None:
        try:
            self._doc = parse_svg(svg) if svg else None
        except ET.ParseError:
            self._doc = None
        self._hover = -1
        self._see = None
        self._fit = True
        self._apply_fit()
        self._draw()

    def refresh(self) -> None:
        """Překreslí se stejným obsahem (po změně značek)."""
        self._draw()

    def metas(self) -> list[dict]:
        return self._doc["metas"] if self._doc else []

    def time_x(self, t: float) -> float | None:
        """Souřadnice x na plátně pro čas ``t`` (jen u časového diagramu)."""
        plot = self._doc.get("plot") if self._doc else None
        if not plot:
            return None
        x0, x1, t_end = plot
        return (x0 + (x1 - x0) * min(max(t, 0.0), t_end) / t_end) * self._scale

    def height_px(self) -> float:
        return self._doc["h"] * self._scale if self._doc else 0.0

    def see(self, pred) -> None:
        """Posune výřez tak, aby byl vidět první prvek, jehož meta splní ``pred``.

        Cíl si pamatuje: dokud uživatel sám neposune výřez, drží ho na očích
        i po změně velikosti okna (první rozvržení přichází až po vykreslení)."""
        self._see = pred
        self._apply_see()

    def _apply_see(self) -> None:
        if self._see is None or self._doc is None:
            return
        for i, meta in enumerate(self.metas()):
            if self._see(meta):
                box = self.canvas.bbox(f"m{i}")
                if not box:
                    return
                total = self._doc["h"] * self._scale
                view_h = self.canvas.winfo_height()
                top = self.canvas.canvasy(0)
                if box[1] < top + 10 or box[3] > top + view_h - 10:
                    self.canvas.yview_moveto(max(0.0, (box[1] - view_h / 3) / max(total, 1)))
                return

    def _user_scrolled(self) -> None:
        self._see = None

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
        self._apply_see()

    # --- myš: klik, tažení, najetí ---------------------------------------------------

    def _meta_at(self, x: int, y: int) -> int:
        """Index meta nejvýše položeného prvku s odkazem pod kurzorem (-1 = nic)."""
        c = self.canvas
        cx, cy = c.canvasx(x), c.canvasy(y)
        for item in reversed(c.find_overlapping(cx - 2, cy - 2, cx + 2, cy + 2)):
            for tag in c.gettags(item):
                if tag[:1] == "m" and tag[1:].isdigit():
                    return int(tag[1:])
        if self._band:
            # list zapojení: kanál je řádek čar a textů — stačí kliknout kamkoli do řádku
            # (popisky sousedních řádků se překrývají, proto vyhrává nejbližší střed)
            best, dist = -1, 0.0
            for i, meta in enumerate(self.metas()):
                box = c.bbox(f"m{i}") if "io" in meta else None
                if box and box[0] <= cx <= box[2] and box[1] <= cy <= box[3]:
                    d = abs(cy - (box[1] + box[3]) / 2)
                    if best < 0 or d < dist:
                        best, dist = i, d
            return best
        return -1

    def _on_press(self, e) -> None:
        self._press = (e.x, e.y)
        self._dragging = False
        self._hide_tip()
        self.canvas.scan_mark(e.x, e.y)

    def _on_drag(self, e) -> None:
        if self._press and (abs(e.x - self._press[0]) > 4 or abs(e.y - self._press[1]) > 4):
            self._dragging = True
        if self._dragging:
            self._user_scrolled()
            self.canvas.scan_dragto(e.x, e.y, gain=1)

    def _on_release(self, e) -> None:
        was_drag, self._press, self._dragging = self._dragging, None, False
        if was_drag or self.on_click is None:
            return
        idx = self._meta_at(e.x, e.y)
        if idx >= 0:
            self.on_click(self.metas()[idx])

    def _on_motion(self, e) -> None:
        if self._press is not None:
            return
        idx = self._meta_at(e.x, e.y)
        self._set_hover(idx)
        if idx >= 0 and self.metas()[idx].get("title"):
            self._schedule_tip(e.x_root, e.y_root, self.metas()[idx]["title"])

    def _set_hover(self, idx: int) -> None:
        if idx == self._hover:
            return
        self._hover = idx
        self._hide_tip()
        self.canvas.configure(cursor="hand2" if idx >= 0 and self.on_click else "")
        self._draw()

    # --- bublina s popisem -------------------------------------------------------------

    def _schedule_tip(self, x: int, y: int, text: str) -> None:
        if self._tip is not None:
            return
        if self._tip_job is not None:
            self.after_cancel(self._tip_job)
        self._tip_job = self.after(450, lambda: self._show_tip(x, y, text))

    def _show_tip(self, x: int, y: int, text: str) -> None:
        self._tip_job = None
        if self._hover < 0 or not self.winfo_exists():
            return
        tip = self._tip = tk.Toplevel(self)
        tip.wm_overrideredirect(True)
        tip.attributes("-topmost", True)
        tk.Label(tip, text=text, justify="left", bg="#FFFFE8", fg=theme.FG, font=theme.FONT_DIM,
                 padx=8, pady=5, highlightthickness=1, highlightbackground=theme.BORDER
                 ).pack()
        tip.wm_geometry(f"+{x + 14}+{y + 16}")

    def _hide_tip(self) -> None:
        if self._tip_job is not None:
            try:
                self.after_cancel(self._tip_job)
            except tk.TclError:
                pass
            self._tip_job = None
        tip, self._tip = self._tip, None
        if tip is not None:
            try:
                tip.destroy()
            except tk.TclError:
                pass

    # --- kreslení ----------------------------------------------------------------

    def _marks(self) -> list[str | None]:
        """Značka pro každé meta: stav z ``marker``, jinak zvýraznění při najetí."""
        metas = self.metas()
        hover = metas[self._hover] if 0 <= self._hover < len(metas) else None
        out = []
        for meta in metas:
            mark = self.marker(meta) if self.marker else None
            if mark is None and hover is not None and related(hover, meta):
                mark = "hot"
            out.append(mark)
        return out

    def _draw(self) -> None:
        c, s = self.canvas, self._scale
        c.delete("all")
        self._zoom_lbl.configure(text=f"{round(s * 100)} %")
        if self._doc is None:
            c.configure(scrollregion=(0, 0, 0, 0))
            return
        marks = self._marks()
        for it in self._doc["items"]:
            kind, idx = it[0], it[-1]
            mark = MARKS.get(marks[idx]) if idx >= 0 and marks[idx] else None
            tags = (f"m{idx}",) if idx >= 0 else ()
            if kind == "line":
                _k, x1, y1, x2, y2, stroke, width, _i = it
                if mark:
                    stroke, width = mark[0], max(width, mark[1])
                c.create_line(x1 * s, y1 * s, x2 * s, y2 * s, fill=stroke,
                              width=max(1, round(width * s)), tags=tags)
            elif kind == "circle":
                _k, cx, cy, r, stroke, fill, width, _i = it
                if mark:
                    stroke = mark[0]
                    if marks[idx] == "on":
                        fill = mark[0]                  # kontrolka svítí plnou barvou
                c.create_oval((cx - r) * s, (cy - r) * s, (cx + r) * s, (cy + r) * s,
                              outline=stroke, fill=fill, width=max(1, round(width * s)), tags=tags)
            elif kind == "rect":
                _k, x, y, w, h, stroke, fill, width, _i = it
                hollow = fill in ("", theme.FIELD)
                if mark and hollow:
                    stroke, width, fill = mark[0], max(width, mark[1]), mark[2]
                elif mark:
                    stroke, width = mark[0], max(width, 1)      # plný pruh: jen obrys
                elif idx >= 0 and not fill:
                    fill = _PAPER                               # ať jde kliknout i dovnitř bloku
                c.create_rectangle(x * s, y * s, (x + w) * s, (y + h) * s, outline=stroke,
                                   fill=fill, width=max(1, round(width * s)) if stroke else 0,
                                   tags=tags)
            else:
                _k, x, y, txt, size, bold, anchor, fill, _i = it
                px = max(5, round(size * s))
                font = ("Consolas", -px, "bold") if bold else ("Consolas", -px)
                tk_anchor = {"start": "sw", "middle": "s", "end": "se"}.get(anchor, "sw")
                c.create_text(x * s, (y + size * _DESCENT) * s, text=txt, font=font,
                              fill=fill, anchor=tk_anchor, tags=tags)
        if self._band:
            for i, mark in enumerate(marks):
                if mark in ("sel", "hot") and "io" in self._doc["metas"][i]:
                    box = c.bbox(f"m{i}")
                    if box:
                        band = c.create_rectangle(box[0] - 6, box[1] - 3, box[2] + 6, box[3] + 3,
                                                  outline="", fill=MARKS[mark][2])
                        c.tag_lower(band)
        if self.overlay:
            self.overlay(c, s)
        c.configure(scrollregion=(0, 0, self._doc["w"] * s, self._doc["h"] * s))
