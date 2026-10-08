"""Sdílené stavební prvky kroků: karta, zalamovaný popisek, tabulka
s úpravou buněk, textové pole s posuvníky a ukládání souborů."""

from __future__ import annotations

import time
from pathlib import Path

import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from tkinter import font as tkfont

from . import theme
from .i18n import N_, _


def card(parent, num: str, title: str, *, expand: bool = True) -> ttk.Frame:
    """Karta kroku: číslo + nadpis, pod ním tělo (vrací tělo)."""
    outer = ttk.Frame(parent)
    outer.pack(fill="both", expand=expand, pady=(0, 10))
    head = ttk.Frame(outer)
    head.pack(fill="x", pady=(0, 8))
    ttk.Label(head, text=num, style="CardNum.TLabel").pack(side="left")
    ttk.Label(head, text=title, style="CardTitle.TLabel").pack(side="left", padx=(8, 0))
    body = ttk.Frame(outer)
    body.pack(fill="both", expand=True)
    return body


def scroll_area(parent) -> tuple[ttk.Frame, ttk.Frame]:
    """Svisle posuvná oblast celé šířky: vrací ``(obal, vnitřek)``. Obal si umísti sám,
    obsah dej do vnitřku. Posuvník se ukáže, jen když se obsah do výšky nevejde;
    kolečko myši posouvá nad kterýmkoli prvkem oblasti (po naplnění zavolej
    ``obal.bind_wheel()``, ať dostanou vazbu i nově vytvořené prvky)."""
    outer = ttk.Frame(parent)
    canvas = tk.Canvas(outer, bg=theme.BG, highlightthickness=0, borderwidth=0)
    bar = ttk.Scrollbar(outer, orient="vertical", command=canvas.yview)
    canvas.configure(yscrollcommand=bar.set)
    bar.pack(side="right", fill="y")
    canvas.pack(side="left", fill="both", expand=True)
    inner = ttk.Frame(canvas)
    win = canvas.create_window(0, 0, window=inner, anchor="nw")

    def layout(_e=None) -> None:
        if not canvas.winfo_exists():
            return
        # výška okna v plátně = přirozená výška obsahu (jinak by se změna reqheight
        # — zalomení popisků po změně šířky — neprojevila událostí <Configure>)
        need = inner.winfo_reqheight()
        have = canvas.winfo_height()
        canvas.itemconfigure(win, width=canvas.winfo_width())
        canvas.configure(scrollregion=(0, 0, canvas.winfo_width(), max(need, have)))
        if need <= have:
            canvas.yview_moveto(0)
        elif outer.restore_y is not None:
            # obnovit polohu (v pixelech) po překreslení; obsah se ještě dorovnává
            # (zalomení), proto se poloha nastavuje při každém přepočtu krátce po vzniku
            canvas.yview_moveto(outer.restore_y / max(need, 1))
            if time.monotonic() - born > 1.5:
                outer.restore_y = None

    def wheel(e) -> str | None:
        if inner.winfo_reqheight() > canvas.winfo_height() > 1:
            canvas.yview_scroll(-1 if e.delta > 0 else 1, "units")
            return "break"
        return None

    def bind_wheel() -> None:
        stack = [canvas, inner]
        while stack:
            w = stack.pop()
            # pole a tabulky rolují samy
            if not isinstance(w, (tk.Text, ttk.Treeview, ttk.Combobox, tk.Listbox)):
                w.bind("<MouseWheel>", wheel, add="+")
            stack += w.winfo_children()

    born = time.monotonic()
    outer.restore_y = None           # horní okraj výřezu v pixelech k obnovení po překreslení
    inner.bind("<Configure>", layout, add="+")
    canvas.bind("<Configure>", layout, add="+")
    outer.bind_wheel = bind_wheel
    outer.canvas = canvas            # testy (posun výřezu)
    return outer, inner


class FlowFrame(ttk.Frame):
    """Rámec, který řadí potomky zleva doprava a zalamuje je do dalších řádků podle
    šířky (řada přepínačů platforem / souborů se nikdy neuřízne za oknem).
    Potomky jen vytvoř s rodičem ``self`` — rozmístí se sami (``place``)."""

    def __init__(self, parent, *, padx: int = 4, pady: int = 4, **kw) -> None:
        super().__init__(parent, **kw)
        self._padx, self._pady = padx, pady
        self._job = None
        self.bind("<Configure>", lambda _e: self.relayout(), add="+")
        self.bind("<Map>", lambda _e: self.relayout(), add="+")

    def schedule(self) -> None:
        """Přepočítat po dokončení změn (např. po vytvoření nových potomků)."""
        if self._job is None:
            self._job = self.after_idle(self.relayout)

    def relayout(self) -> None:
        if self._job is not None:
            try:
                self.after_cancel(self._job)
            except tk.TclError:
                pass
            self._job = None
        if not self.winfo_exists():
            return
        width = self.winfo_width()
        if width <= 1:                     # ještě nezobrazeno: šířka rodiče
            width = max(self.master.winfo_width(), 200)
        x = y = row_h = 0
        for w in self.winfo_children():
            rw, rh = w.winfo_reqwidth(), w.winfo_reqheight()
            if x > 0 and x + rw > width:
                x, y, row_h = 0, y + row_h + self._pady, 0
            w.place(x=x, y=y)
            x += rw + self._padx
            row_h = max(row_h, rh)
        total = y + row_h
        if int(str(self.cget("height")) or 0) != total:
            self.configure(height=max(total, 1))


def wrap_label(parent, text: str, style: str = "Dim.TLabel", **pack) -> ttk.Label:
    """Popisek, který se zalamuje podle šířky rodiče."""
    lbl = ttk.Label(parent, text=text, style=style, justify="left", anchor="w")
    lbl.pack(**({"fill": "x", "anchor": "w"} | pack))
    lbl.bind("<Configure>", lambda e: lbl.configure(wraplength=max(200, e.width - 4)))
    return lbl


def link(parent, text: str, command, *, bg: str = theme.BG, font=theme.FONT_UI) -> tk.Label:
    """Odkaz — text v barvě akcentu, po najetí podtržený; klik zavolá ``command``."""
    base = tkfont.Font(font=font)
    under = tkfont.Font(font=font)
    under.configure(underline=True)
    lbl = tk.Label(parent, text=text, bg=bg, fg=theme.ACCENT, font=base, cursor="hand2",
                   anchor="w", justify="left")
    lbl._fonts = (base, under)   # reference, ať je Tk neuklidí
    lbl.bind("<Enter>", lambda _e: lbl.configure(font=under))
    lbl.bind("<Leave>", lambda _e: lbl.configure(font=base))
    lbl.bind("<Button-1>", lambda _e: command())
    lbl.invoke = command         # stejné rozhraní jako tlačítko (testy, klávesnice)
    return lbl


def tooltip(widget, text: str, *, delay: int = 400) -> None:
    """Bublina s textem po najetí myší (zmizí při odjetí / kliknutí). Text je i v ``widget.tip_text`` (testy)."""
    state: dict = {"job": None, "tip": None}
    widget.tip_text = text

    def hide(_e=None) -> None:
        if state["job"] is not None:
            try:
                widget.after_cancel(state["job"])
            except tk.TclError:
                pass
            state["job"] = None
        if state["tip"] is not None:
            try:
                state["tip"].destroy()
            except tk.TclError:
                pass
            state["tip"] = None

    def show() -> None:
        state["job"] = None
        if not widget.winfo_exists():
            return
        tip = tk.Toplevel(widget)
        tip.wm_overrideredirect(True)
        tip.attributes("-topmost", True)
        tk.Label(tip, text=text, bg="#FFFFFF", fg=theme.FG, font=theme.FONT_DIM, justify="left",
                 wraplength=420, padx=8, pady=5, highlightthickness=1,
                 highlightbackground=theme.BORDER).pack()
        x, y = widget.winfo_pointerxy()
        tip.wm_geometry(f"+{x + 14}+{y + 16}")
        state["tip"] = tip

    def enter(_e=None) -> None:
        hide()
        state["job"] = widget.after(delay, show)

    widget.bind("<Enter>", enter, add="+")
    widget.bind("<Leave>", hide, add="+")
    widget.bind("<ButtonPress>", hide, add="+")
    widget.bind("<Destroy>", hide, add="+")


def note_box(parent, text: str, *, warn: bool = False, **pack) -> tk.Label:
    """Poznámka v rámečku (běžná = zelenošedá, varování = žlutá)."""
    bg = theme.WARN_BG if warn else theme.FIELD
    lbl = tk.Label(parent, text=text, bg=bg, fg=theme.FG, font=theme.FONT_DIM,
                   justify="left", anchor="w", padx=10, pady=7, highlightthickness=1,
                   highlightbackground="#F0D9A0" if warn else theme.BORDER)
    lbl.pack(**({"fill": "x", "pady": (8, 0)} | pack))
    lbl.bind("<Configure>", lambda e: lbl.configure(wraplength=max(200, e.width - 24)))
    return lbl


def field(parent, label: str, widget_factory, *, row: int = 0, col: int = 0,
          colspan: int = 1):
    """Popisek nad vstupem v mřížce; vrací vytvořený vstup."""
    box = ttk.Frame(parent)
    box.grid(row=row, column=col, columnspan=colspan, sticky="ew", padx=(0, 12), pady=(0, 8))
    ttk.Label(box, text=label, style="Dim.TLabel").pack(anchor="w")
    w = widget_factory(box)
    w.pack(fill="x", pady=(2, 0))
    return w


def scrolled_text(parent, *, mono: bool = False, readonly: bool = False, **kw):
    """Text s posuvníky. Vrací ``(rámec, text)``; rámec si umísti sám."""
    frm = ttk.Frame(parent)
    frm.rowconfigure(0, weight=1)
    frm.columnconfigure(0, weight=1)
    txt = theme.text_widget(frm, mono=mono, **kw)
    ys = ttk.Scrollbar(frm, orient="vertical", command=txt.yview)
    txt.configure(yscrollcommand=ys.set)
    txt.grid(row=0, column=0, sticky="nsew")
    ys.grid(row=0, column=1, sticky="ns")
    if mono:
        xs = ttk.Scrollbar(frm, orient="horizontal", command=txt.xview)
        txt.configure(xscrollcommand=xs.set)
        xs.grid(row=1, column=0, sticky="ew")
    if readonly:
        txt.configure(state="disabled")
    return frm, txt


def set_text(txt: tk.Text, content: str) -> None:
    """Přepíše obsah textu (funguje i pro pole jen ke čtení)."""
    state = str(txt.cget("state"))
    txt.configure(state="normal")
    txt.delete("1.0", "end")
    txt.insert("1.0", content)
    txt.configure(state=state)


class Table(ttk.Frame):
    """``Treeview`` s posuvníkem a volitelnou úpravou buněk dvojklikem.

    ``columns`` = seznam ``(klíč, nadpis, šířka, roztáhnout)``. ``editable`` =
    klíče sloupců, které jdou upravit; změnu hlásí ``on_edit(iid, klíč, hodnota)``.
    ``on_click(iid, klíč)`` hlásí jednoduchý klik (např. přepnutí zaškrtnutí).
    ``edit_value(iid, klíč)`` = text do editoru buňky, když se liší od zobrazeného (např. uložená
    adresa místo adresy v notaci platformy).
    ``ellipsis=True``: text, který se do sloupce nevejde, se zkrátí s „…“ (Treeview sám řeže
    uprostřed slova) a celý se ukáže v bublině po najetí myší; celou hodnotu vrací ``full()``.
    """

    def __init__(self, parent, columns, *, height: int = 8, editable=(),
                 on_edit=None, on_click=None, tree: bool = False, ellipsis: bool = False,
                 edit_value=None):
        super().__init__(parent)
        self._ellipsis = ellipsis
        self._full: dict[str, dict[str, str]] = {}    # iid → {sloupec / "#0": celý text}
        self._heads: dict[str, str] = {}               # sloupec → celý nadpis
        self._fit_job = None
        self._tip: tk.Toplevel | None = None
        self._tip_job = None
        self._tip_cell: tuple | None = None
        self.tip_text = ""
        self._keys = [c[0] for c in columns]
        self._editable = set(editable)
        self._on_edit = on_edit
        self._on_click = on_click
        self._edit_value = edit_value
        self._editor: tk.Entry | None = None
        self.rowconfigure(0, weight=1)
        self.columnconfigure(0, weight=1)
        self.tv = ttk.Treeview(self, columns=self._keys, height=height,
                               show="tree headings" if tree else "headings",
                               selectmode="browse")
        # pevné sloupce se rozšíří podle nadpisu a obsahu (delší překlady — němčina),
        # roztahovací dělí zbytek místa
        head_font = tkfont.Font(font=theme.FONT_DIM)
        self._cell_font = tkfont.Font(font=theme.FONT_UI)
        self._fixed: dict[str, int] = {}
        for key, title, width, stretch in columns:
            width = max(width, head_font.measure(title) + 20)
            self.tv.heading(key, text=title, anchor="w")
            self.tv.column(key, width=width, minwidth=40, stretch=stretch, anchor="w")
            if not stretch:
                self._fixed[key] = width
        ys = ttk.Scrollbar(self, orient="vertical", command=self.tv.yview)
        self.tv.configure(yscrollcommand=ys.set)
        self.tv.grid(row=0, column=0, sticky="nsew")
        ys.grid(row=0, column=1, sticky="ns")
        # až po přepočtu rozvržení tabulky (ten běží v idle po <Configure>)
        self.tv.bind("<Configure>", lambda _e: self.tv.after_idle(self._reveal), add="+")
        self.tv.bind("<MouseWheel>", self._forget_reveal, add="+")
        ys.bind("<Button-1>", self._forget_reveal, add="+")
        self.tv.tag_configure("dup", foreground=theme.ERR)
        self.tv.tag_configure("dim", foreground=theme.DIM)
        self.tv.tag_configure("group", foreground=theme.PRIMARY, font=theme.FONT_ACCENT)
        if self._editable:
            self.tv.bind("<Double-1>", self._begin_edit)
        if on_click:
            self.tv.bind("<ButtonRelease-1>", self._click)
        if ellipsis:
            self.tv.bind("<Configure>", lambda _e: self._schedule_fit(), add="+")
            self.tv.bind("<ButtonRelease-1>", self._after_resize, add="+")
            self.tv.bind("<Motion>", self._on_motion, add="+")
            self.tv.bind("<Leave>", lambda _e: self._hide_tip(), add="+")
            self.tv.bind("<Destroy>", lambda _e: self._hide_tip(), add="+")

    # --- data --------------------------------------------------------------------

    def clear(self) -> None:
        self._cancel_edit()
        self._hide_tip()
        self._full.clear()
        self.tv.delete(*self.tv.get_children())

    def add(self, iid, values, tags=(), parent: str = "", text: str = "", open_: bool = True):
        for key, value in zip(self._keys, values):
            if key in self._fixed and value not in ("", None):
                need = min(self._cell_font.measure(str(value)) + 16, 320)
                if need > self._fixed[key]:
                    self._fixed[key] = need
                    self.tv.column(key, width=need)
        out = self.tv.insert(parent, "end", iid=str(iid), values=values, tags=tags,
                             text=text, open=open_)
        if self._ellipsis:
            full = {k: "" if v is None else str(v) for k, v in zip(self._keys, values)}
            full["#0"] = text
            self._full[out] = full
            self._fit_row(out)
        return out

    def full(self, iid, key: str) -> str:
        """Celý text buňky (i zkrácené s „…“); ``key`` "#0" = text stromového sloupce."""
        iid = str(iid)
        if iid in self._full and key in self._full[iid]:
            return self._full[iid][key]
        return self.tv.item(iid, "text") if key == "#0" else self.tv.set(iid, key)

    def set_cell(self, iid, key: str, value) -> None:
        """Změní hodnotu buňky (u ``ellipsis`` i celý text a zkrácení)."""
        iid = str(iid)
        if iid in self._full:
            self._full[iid][key] = "" if value is None else str(value)
            self._fit_row(iid)
        elif key == "#0":
            self.tv.item(iid, text=value)
        else:
            self.tv.set(iid, key, value)

    # --- zkrácení textu s „…“ a bublina s celým textem --------------------------------

    def _clip(self, text: str, room: int) -> str:
        """Nejdelší začátek textu, který se s „…“ vejde do ``room`` px."""
        f = self._cell_font
        if not text or f.measure(text) <= room:
            return text
        lo, hi = 0, len(text)
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if f.measure(text[:mid].rstrip() + "…") <= room:
                lo = mid
            else:
                hi = mid - 1
        return text[:lo].rstrip() + "…"

    def _room(self, iid: str, key: str) -> int:
        width = int(self.tv.column(key, "width"))
        if key != "#0":
            return width - 12
        depth, p = 0, self.tv.parent(iid)
        while p:
            depth, p = depth + 1, self.tv.parent(p)
        return width - 20 * (depth + 1) - 10          # odsazení úrovně + značka rozbalení

    def _fit_row(self, iid: str) -> None:
        full = self._full.get(iid)
        if not full or not self.tv.exists(iid):
            return
        for key, text in full.items():
            shown = self._clip(text, self._room(iid, key))
            if key == "#0":
                if self.tv.item(iid, "text") != shown:
                    self.tv.item(iid, text=shown)
            elif self.tv.set(iid, key) != shown:
                self.tv.set(iid, key, shown)

    def fit(self) -> None:
        """Přepočítá zkrácení všech řádků i nadpisů (po změně šířky sloupců)."""
        self._fit_job = None
        if not self.tv.winfo_exists():
            return
        for iid in list(self._full):
            self._fit_row(iid)
        self._fit_heads()

    def _fit_heads(self) -> None:
        """Nadpisy sloupců také s „…“ (Treeview je jinak usekne uprostřed slova). Nadpis, který
        mezitím přepsal volající (šipka řazení), se bere jako nový celý text."""
        f = tkfont.Font(font=theme.FONT_DIM)
        for key in ("#0", *self._keys):
            cur = str(self.tv.heading(key, "text"))
            full = self._heads.get(key)
            if not (full and cur.endswith("…") and full.startswith(cur[:-1].rstrip())):
                full = cur
            self._heads[key] = full
            room = int(self.tv.column(key, "width")) - 14
            shown = full
            if full and f.measure(full) > room:
                lo, hi = 0, len(full)
                while lo < hi:
                    mid = (lo + hi + 1) // 2
                    if f.measure(full[:mid].rstrip() + "…") <= room:
                        lo = mid
                    else:
                        hi = mid - 1
                shown = full[:lo].rstrip() + "…"
            if shown != cur:
                self.tv.heading(key, text=shown)

    def _schedule_fit(self) -> None:
        if self._fit_job is None:
            self._fit_job = self.tv.after_idle(self.fit)

    def _after_resize(self, event) -> None:
        if self.tv.identify_region(event.x, event.y) in ("separator", "heading"):
            self._schedule_fit()

    def _cell_key(self, col: str) -> str | None:
        if col == "#0":
            return "#0"
        n = col[1:]
        return self._keys[int(n) - 1] if n.isdigit() and 0 < int(n) <= len(self._keys) else None

    def _on_motion(self, event) -> None:
        iid = self.tv.identify_row(event.y)
        key = self._cell_key(self.tv.identify_column(event.x)) if iid else None
        cell = (iid, key) if key else None
        if cell == self._tip_cell:
            return
        self._hide_tip()
        self._tip_cell = cell
        if not cell or iid not in self._full:
            return
        text = self._full[iid].get(key, "")
        shown = self.tv.item(iid, "text") if key == "#0" else self.tv.set(iid, key)
        if text and shown != text:
            self._tip_job = self.tv.after(450, self._show_tip, event.x_root, event.y_root, text)

    def _show_tip(self, x: int, y: int, text: str) -> None:
        self._tip_job = None
        if not self.tv.winfo_exists():
            return
        tip = tk.Toplevel(self.tv)
        tip.wm_overrideredirect(True)
        tip.attributes("-topmost", True)
        tk.Label(tip, text=text, bg="#FFFFFF", fg=theme.FG, font=theme.FONT_DIM, justify="left",
                 wraplength=520, padx=8, pady=5, highlightthickness=1,
                 highlightbackground=theme.BORDER).pack()
        tip.wm_geometry(f"+{x + 14}+{y + 16}")
        self._tip = tip
        self.tip_text = text            # pro testy

    def _hide_tip(self) -> None:
        if self._tip_job is not None:
            try:
                self.tv.after_cancel(self._tip_job)
            except tk.TclError:
                pass
            self._tip_job = None
        if self._tip is not None:
            try:
                self._tip.destroy()
            except tk.TclError:
                pass
            self._tip = None
        self._tip_cell = None

    def selected(self) -> str | None:
        sel = self.tv.selection()
        return sel[0] if sel else None

    def select(self, iid, *, reveal: bool = True) -> None:
        """Vybere řádek; ``reveal`` ho i posune do výřezu."""
        if iid is None or not self.tv.exists(str(iid)):
            return
        self.tv.selection_set(str(iid))
        if not reveal:
            return
        # před prvním rozvržením okna see() neví, kolik řádků se vejde — řádek se proto
        # znovu ukáže, až tabulka dostane skutečnou velikost (viz <Configure> v __init__)
        self._reveal_iid = str(iid)
        self._reveal()

    def _reveal(self, _e=None) -> None:
        iid = getattr(self, "_reveal_iid", None)
        if iid and self.tv.winfo_exists() and self.tv.exists(iid):
            self.tv.see(iid)

    def _forget_reveal(self, _e=None) -> None:
        self._reveal_iid = None      # uživatel roluje sám — výběr už do výřezu nevracet

    # --- úprava buněk --------------------------------------------------------------

    def _cell(self, event):
        iid = self.tv.identify_row(event.y)
        col = self.tv.identify_column(event.x)  # "#1"…
        if not iid or not col or col == "#0":
            return None, None
        return iid, self._keys[int(col[1:]) - 1]

    def _click(self, event) -> None:
        if self.tv.identify_region(event.x, event.y) != "cell":
            return
        iid, key = self._cell(event)
        if iid:
            self._on_click(iid, key)

    def _begin_edit(self, event) -> None:
        iid, key = self._cell(event)
        if not iid or key not in self._editable:
            return
        self._cancel_edit()
        bbox = self.tv.bbox(iid, key)
        if not bbox:
            return
        x, y, w, h = bbox
        ed = tk.Entry(self.tv, bg="#FFFFFF", fg=theme.FG, relief="flat", font=theme.FONT_UI,
                      highlightthickness=1, highlightbackground=theme.ACCENT,
                      highlightcolor=theme.ACCENT, insertbackground=theme.FG)
        start = self._edit_value(iid, key) if self._edit_value else None
        if start is None:
            start = self.full(iid, key)               # celý text, ne zkrácený s „…“
        ed.insert(0, start)
        ed.select_range(0, "end")
        ed.place(x=x, y=y, width=w, height=h)
        ed.focus_set()
        self._editor = ed

        def commit(_e=None):
            if self._editor is not ed:
                return
            value = ed.get()
            self._cancel_edit()
            if value != start and self._on_edit:
                self._on_edit(iid, key, value)

        ed.bind("<Return>", commit)
        ed.bind("<FocusOut>", commit)
        ed.bind("<Escape>", lambda _e: self._cancel_edit())

    def _cancel_edit(self) -> None:
        ed, self._editor = self._editor, None
        if ed is not None:
            ed.destroy()


# --- soubory -----------------------------------------------------------------

_FILETYPES = {
    "svg": (N_("Výkres SVG"), "*.svg"), "dxf": (N_("Výkres DXF"), "*.dxf"),
    "csv": (N_("Tabulka CSV"), "*.csv"), "md": ("Markdown", "*.md"),
    "xml": ("XML", "*.xml"), "json": ("JSON", "*.json"), "scl": (N_("SCL zdroj"), "*.scl"),
    "st": ("Structured Text", "*.st"), "txt": (N_("Text"), "*.txt"),
    "tsv": (N_("Tabulka TSV"), "*.tsv"),
}


def write_text(path: str | Path, body: str) -> None:
    # newline="" — obsah z jádra si konce řádků nese sám (CSV/DXF beze změny)
    with open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(body)


def license_filter(app, name: str, body):
    """Obsah souboru podle licence (patička Free) — None, když je uložení zamčené (pak vysvětlí)."""
    lic = getattr(app, "lic", None)
    if lic is None:
        return body
    out, why = lic.filter_file(name, body)
    if out is None:
        lic.blocked(why)
    return out


def save_file(app, name: str, body: str) -> bool:
    """Dialog „Uložit jako" pro jeden soubor; vrací, zda se uložilo.

    Licence: nad limitem Free a DXF ve Free se neuloží (okno Licence s důvodem), dokumenty a README
    dostanou ve Free patičku PLCdesk; projekt a firemní knihovna se ukládají vždy."""
    body = license_filter(app, name, body)
    if body is None:
        return False
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    # popis typu se překládá až tady (tabulka vzniká při importu, kdy jazyk ještě není znám)
    types = [(_(_FILETYPES[ext][0]), _FILETYPES[ext][1])] if ext in _FILETYPES else []
    path = filedialog.asksaveasfilename(
        parent=app.root, title=_("Uložit soubor"), initialfile=name,
        initialdir=app.settings.get("last_dir") or None,
        defaultextension="." + ext if ext else "",
        filetypes=types + [(_("Všechny soubory"), "*.*")])
    if not path:
        return False
    try:
        write_text(path, body)
    except OSError as exc:
        messagebox.showerror(_("Uložení se nezdařilo"), str(exc), parent=app.root)
        return False
    app.settings["last_dir"] = str(Path(path).parent)
    app.set_status(_("Uloženo: {path}", path=path))
    return True


def save_many(app, files: list[tuple[str, str]], what: str | None = None) -> bool:
    """Uloží víc souborů do zvolené složky; na přepis existujících se zeptá.

    ``what`` (4. pád, např. „výkresy") předává volající už přeložené. Licence jako ``save_file``:
    zamčené soubory (DXF ve Free) se přeskočí a důvod se ukáže jednou; nad limitem nic."""
    lic = getattr(app, "lic", None)
    if lic is not None:
        kept, why = [], ""
        for name, body in files:
            out, reason = lic.filter_file(name, body)
            if out is None:
                why = why or reason
            else:
                kept.append((name, out))
        if why and not kept:
            lic.blocked(why)
            return False
        files = kept
    else:
        why = ""
    folder = filedialog.askdirectory(
        parent=app.root, title=_("Složka pro {what}", what=what or _("soubory")), mustexist=True,
        initialdir=app.settings.get("last_dir") or None)
    if not folder:
        return False
    target = Path(folder)
    existing = [n for n, _body in files if (target / n).exists()]
    if existing and not messagebox.askyesno(
            _("Přepsat soubory?"),
            _("Ve složce už existuje {n} z {total} souborů (např. {name}).",
              n=len(existing), total=len(files), name=existing[0])
            + "\n" + _("Přepsat je?"), parent=app.root):
        return False
    try:
        for name, body in files:
            write_text(target / name, body)
    except OSError as exc:
        messagebox.showerror(_("Uložení se nezdařilo"), str(exc), parent=app.root)
        return False
    app.settings["last_dir"] = str(target)
    app.set_status(_("Uloženo {n} souborů do {target}", n=len(files), target=target))
    if why:
        lic.blocked(why)
    return True


def read_text_file(path: str | Path) -> str:
    """Načte textový export — UTF-8 (i s BOM), UTF-16, jinak cp1250."""
    data = Path(path).read_bytes()
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return data.decode("utf-16", errors="replace")
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return data.decode("cp1250", errors="replace")
