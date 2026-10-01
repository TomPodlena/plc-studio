"""Sdílené stavební prvky kroků: karta, zalamovaný popisek, tabulka
s úpravou buněk, textové pole s posuvníky a ukládání souborů."""

from __future__ import annotations

from pathlib import Path

import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from tkinter import font as tkfont

from . import theme


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
    """

    def __init__(self, parent, columns, *, height: int = 8, editable=(),
                 on_edit=None, on_click=None, tree: bool = False):
        super().__init__(parent)
        self._keys = [c[0] for c in columns]
        self._editable = set(editable)
        self._on_edit = on_edit
        self._on_click = on_click
        self._editor: tk.Entry | None = None
        self.rowconfigure(0, weight=1)
        self.columnconfigure(0, weight=1)
        self.tv = ttk.Treeview(self, columns=self._keys, height=height,
                               show="tree headings" if tree else "headings",
                               selectmode="browse")
        for key, title, width, stretch in columns:
            self.tv.heading(key, text=title, anchor="w")
            self.tv.column(key, width=width, minwidth=40, stretch=stretch, anchor="w")
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

    # --- data --------------------------------------------------------------------

    def clear(self) -> None:
        self._cancel_edit()
        self.tv.delete(*self.tv.get_children())

    def add(self, iid, values, tags=(), parent: str = "", text: str = "", open_: bool = True):
        return self.tv.insert(parent, "end", iid=str(iid), values=values, tags=tags,
                              text=text, open=open_)

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
        ed.insert(0, self.tv.set(iid, key))
        ed.select_range(0, "end")
        ed.place(x=x, y=y, width=w, height=h)
        ed.focus_set()
        self._editor = ed

        def commit(_e=None):
            if self._editor is not ed:
                return
            value = ed.get()
            self._cancel_edit()
            if value != self.tv.set(iid, key) and self._on_edit:
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
    "svg": ("Výkres SVG", "*.svg"), "dxf": ("Výkres DXF", "*.dxf"),
    "csv": ("Tabulka CSV", "*.csv"), "md": ("Markdown", "*.md"),
    "xml": ("XML", "*.xml"), "json": ("JSON", "*.json"), "scl": ("SCL zdroj", "*.scl"),
    "st": ("Structured Text", "*.st"), "txt": ("Text", "*.txt"), "tsv": ("Tabulka TSV", "*.tsv"),
}


def write_text(path: str | Path, body: str) -> None:
    # newline="" — obsah z jádra si konce řádků nese sám (CSV/DXF beze změny)
    with open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(body)


def save_file(app, name: str, body: str) -> bool:
    """Dialog „Uložit jako" pro jeden soubor; vrací, zda se uložilo."""
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    types = [_FILETYPES[ext]] if ext in _FILETYPES else []
    path = filedialog.asksaveasfilename(
        parent=app.root, title="Uložit soubor", initialfile=name,
        initialdir=app.settings.get("last_dir") or None,
        defaultextension="." + ext if ext else "",
        filetypes=types + [("Všechny soubory", "*.*")])
    if not path:
        return False
    try:
        write_text(path, body)
    except OSError as exc:
        messagebox.showerror("Uložení se nezdařilo", str(exc), parent=app.root)
        return False
    app.settings["last_dir"] = str(Path(path).parent)
    app.set_status(f"Uloženo: {path}")
    return True


def save_many(app, files: list[tuple[str, str]], what: str = "soubory") -> bool:
    """Uloží víc souborů do zvolené složky; na přepis existujících se zeptá."""
    folder = filedialog.askdirectory(
        parent=app.root, title=f"Složka pro {what}", mustexist=True,
        initialdir=app.settings.get("last_dir") or None)
    if not folder:
        return False
    target = Path(folder)
    existing = [n for n, _ in files if (target / n).exists()]
    if existing and not messagebox.askyesno(
            "Přepsat soubory?",
            f"Ve složce už existuje {len(existing)} z {len(files)} souborů "
            f"(např. {existing[0]}).\nPřepsat je?", parent=app.root):
        return False
    try:
        for name, body in files:
            write_text(target / name, body)
    except OSError as exc:
        messagebox.showerror("Uložení se nezdařilo", str(exc), parent=app.root)
        return False
    app.settings["last_dir"] = str(target)
    app.set_status(f"Uloženo {len(files)} souborů do {target}")
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
