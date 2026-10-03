"""Vizuální standard okna PLC Studia — paleta, ttk styly, chrome okna.

Paleta i idiomy jsou převzaté ze sdíleného ``theme.py`` nástrojů PearTec
(Report Studio, Simulation Hub): bílé pozadí, tmavě zelené nadpisy, zelené
akcenty, ttk „clam", Segoe UI. Barvy neopisuj do kroků — importuj je odsud.
"""

from __future__ import annotations

import os
from pathlib import Path

import tkinter as tk
from tkinter import ttk

# --- Paleta (jediný zdroj pravdy) -----------------------------------------
BG = "#FFFFFF"          # pozadí okna
FG = "#22322A"          # text (zelenočerná)
PRIMARY = "#1F482A"     # nadpisy (tmavě zelená)
ACCENT = "#008639"      # brandová zelená (akcenty, tlačítka)
ACCENT_ACTIVE = "#00A346"
ACCENT_FG = "#FFFFFF"
FIELD = "#F1F5F2"       # pole/vstupy, karty
BORDER = "#CFE0D5"
DIM = "#8B8C8E"         # tlumené popisky
BTN = "#E6EDE8"
BTN_ACTIVE = "#D5E3DA"
LOG_BG = "#F4F7F5"      # pozadí kódu/logu
TREE_SEL = "#D6EADF"
DISABLED_BG = "#E9EDEA"
ERR = "#B3261E"         # chyby, duplicity
WARN = "#B45309"        # varování, potenciál L+
WARN_BG = "#FFF6E0"
DANGER_BG = "#F6DFDC"

# --- Písmo ----------------------------------------------------------------
FONT_UI = ("Segoe UI", 10)
FONT_HEADER = ("Segoe UI", 13, "bold")
FONT_CARD = ("Segoe UI", 12, "bold")
FONT_DIM = ("Segoe UI", 9)
FONT_ACCENT = ("Segoe UI", 10, "bold")
FONT_MONO = ("Consolas", 10)

ASSETS_DIR = Path(__file__).resolve().parent / "assets"
ICON_FILE = ASSETS_DIR / "plc_studio.ico"
APP_ID = "PearTec.PLCStudio"

_logo_cache: dict[int, tk.PhotoImage] = {}


def set_app_id() -> None:
    """Vlastní AppUserModelID — volat PŘED ``tk.Tk()``, jinak Windows okno na
    hlavním panelu seskupí s ostatními pythonw aplikacemi (cizí ikona/název)."""
    if os.name != "nt":
        return
    try:
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(APP_ID)
    except Exception:
        pass


def setup_window(win, title: str | None = None, *, topmost: bool = False) -> None:
    """Titulek, ikona okna/taskbaru a „nad okny" — společné chrome."""
    if title:
        win.title(title)
    win.configure(bg=BG)
    try:
        win.iconbitmap(str(ICON_FILE))
    except tk.TclError:
        pass  # .ico nemusí existovat
    win.attributes("-topmost", topmost)


def apply_styles(root: tk.Tk) -> ttk.Style:
    style = ttk.Style()
    try:
        style.theme_use("clam")
    except tk.TclError:
        pass

    style.configure(".", font=FONT_UI)
    style.configure("TFrame", background=BG)
    style.configure("Card.TFrame", background=FIELD)
    style.configure("TLabel", background=BG, foreground=FG, font=FONT_UI)
    style.configure("Dim.TLabel", background=BG, foreground=DIM, font=FONT_DIM)
    style.configure("Header.TLabel", background=BG, foreground=PRIMARY, font=FONT_HEADER)
    style.configure("Section.TLabel", background=BG, foreground=ACCENT, font=FONT_ACCENT)
    style.configure("CardTitle.TLabel", background=BG, foreground=PRIMARY, font=FONT_CARD)
    style.configure("CardNum.TLabel", background=PRIMARY, foreground="#FFFFFF",
                    font=("Consolas", 10, "bold"), padding=(6, 1))
    style.configure("Err.TLabel", background=BG, foreground=ERR, font=FONT_UI)
    style.configure("Ok.TLabel", background=BG, foreground=ACCENT, font=FONT_UI)
    style.configure("Link.TLabel", background=BG, foreground=ACCENT, font=FONT_UI + ("underline",))
    style.configure("Stat.TLabel", background=FIELD, foreground=FG, font=FONT_UI,
                    padding=(8, 3))

    style.configure("TButton", background=BTN, foreground=FG, bordercolor=BORDER,
                    lightcolor=BTN, darkcolor=BTN, padding=(10, 4))
    style.map("TButton", background=[("disabled", DISABLED_BG), ("active", BTN_ACTIVE)],
              foreground=[("disabled", DIM)])
    style.configure("Accent.TButton", background=ACCENT, foreground=ACCENT_FG,
                    bordercolor=ACCENT, lightcolor=ACCENT, darkcolor=ACCENT,
                    font=FONT_ACCENT)
    style.map("Accent.TButton",
              background=[("disabled", DISABLED_BG), ("active", ACCENT_ACTIVE)],
              foreground=[("disabled", DIM)],
              bordercolor=[("disabled", BORDER)], lightcolor=[("disabled", DISABLED_BG)],
              darkcolor=[("disabled", DISABLED_BG)])
    style.configure("Danger.TButton", background=DANGER_BG, foreground=ERR,
                    bordercolor="#E7B9B4", lightcolor=DANGER_BG, darkcolor=DANGER_BG)
    style.map("Danger.TButton", background=[("active", "#EFC8C3")])

    # Lišta kroků: běžný / hotový / aktuální krok. Vodorovná vycpávka je úzká, ať se
    # lišta (9 kroků + Nápověda) vejde i do nejmenšího okna 1100 px v němčině.
    style.configure("Step.TButton", background=BG, foreground=FG, bordercolor=BORDER,
                    lightcolor=BG, darkcolor=BG, padding=(6, 5))
    style.map("Step.TButton", background=[("active", FIELD)])
    style.configure("StepDone.TButton", background=TREE_SEL, foreground=PRIMARY,
                    bordercolor=BORDER, lightcolor=TREE_SEL, darkcolor=TREE_SEL,
                    padding=(6, 5))
    style.map("StepDone.TButton", background=[("active", "#C6E0D1")])
    style.configure("StepOn.TButton", background=PRIMARY, foreground="#FFFFFF",
                    bordercolor=PRIMARY, lightcolor=PRIMARY, darkcolor=PRIMARY,
                    font=FONT_ACCENT, padding=(6, 5))
    style.map("StepOn.TButton", background=[("active", PRIMARY)])
    # štítek aktivního filtru (klik = zrušit)
    style.configure("Chip.TButton", background=TREE_SEL, foreground=PRIMARY, bordercolor=BORDER,
                    lightcolor=TREE_SEL, darkcolor=TREE_SEL, font=FONT_DIM, padding=(6, 1))
    style.map("Chip.TButton", background=[("active", "#C6E0D1")])

    # Přepínače záložek (platforma / soubor) — Radiobutton ve stylu tlačítka.
    style.configure("Tab.Toolbutton", background=BTN, foreground=FG, padding=(10, 4),
                    bordercolor=BORDER, font=FONT_UI)
    style.map("Tab.Toolbutton",
              background=[("selected", ACCENT), ("active", BTN_ACTIVE)],
              foreground=[("selected", ACCENT_FG)])

    # Úzký přepínač v řádku tabulky (vstupy živé simulace): „stroj" zeleně, vnucená
    # hodnota 0 / 1 oranžově, ať je na první pohled vidět, co neřídí stroj.
    for name, sel in (("Seg.Toolbutton", ACCENT), ("SegForce.Toolbutton", WARN)):
        style.configure(name, background=BTN, foreground=FG, padding=(6, 1),
                        bordercolor=BORDER, font=FONT_DIM)
        style.map(name, background=[("selected", sel), ("active", BTN_ACTIVE)],
                  foreground=[("selected", ACCENT_FG)])

    style.configure("TCheckbutton", background=BG, foreground=FG)
    style.map("TCheckbutton", background=[("active", BG)],
              foreground=[("disabled", DIM), ("active", FG)])
    # zalamovaný přepínač pro úzké panely (živá simulace — zásahy do zařízení)
    style.configure("Wrap.TCheckbutton", background=BG, foreground=FG, wraplength=290)
    style.map("Wrap.TCheckbutton", background=[("active", BG)],
              foreground=[("disabled", DIM), ("active", FG)])

    style.configure("TEntry", fieldbackground=FIELD, foreground=FG, bordercolor=BORDER,
                    lightcolor=BORDER, darkcolor=BORDER, insertcolor=FG, padding=3)
    style.map("TEntry", bordercolor=[("focus", ACCENT)], lightcolor=[("focus", ACCENT)])
    style.configure("TSpinbox", fieldbackground=FIELD, foreground=FG, bordercolor=BORDER,
                    arrowcolor=FG, padding=3)

    # Combobox: bez map() zůstává v readonly stavu nečitelný — nastav všechny stavy.
    style.configure("TCombobox", fieldbackground=FIELD, background=FIELD, foreground=FG,
                    arrowcolor=FG, selectbackground=FIELD, selectforeground=FG,
                    bordercolor=BORDER, padding=3)
    style.map("TCombobox",
              fieldbackground=[("readonly", FIELD), ("disabled", DISABLED_BG)],
              foreground=[("readonly", FG), ("disabled", DIM)],
              selectbackground=[("readonly", FIELD)],
              selectforeground=[("readonly", FG)],
              arrowcolor=[("disabled", DIM)])
    root.option_add("*TCombobox*Listbox.background", FIELD)
    root.option_add("*TCombobox*Listbox.foreground", FG)
    root.option_add("*TCombobox*Listbox.selectBackground", ACCENT)
    root.option_add("*TCombobox*Listbox.selectForeground", ACCENT_FG)
    root.option_add("*TCombobox*Listbox.font", FONT_UI)

    style.configure("Treeview", background="#FFFFFF", fieldbackground="#FFFFFF",
                    foreground=FG, rowheight=24, borderwidth=0, font=FONT_UI)
    style.map("Treeview", background=[("selected", TREE_SEL)],
              foreground=[("selected", PRIMARY)])
    style.configure("Treeview.Heading", background=FIELD, foreground=DIM,
                    font=FONT_DIM, relief="flat", padding=(6, 4))

    style.configure("TNotebook", background=BG, bordercolor=BORDER, tabmargins=(0, 4, 0, 0))
    style.configure("TNotebook.Tab", background=BTN, foreground=FG, padding=(14, 5),
                    bordercolor=BORDER)
    style.map("TNotebook.Tab", background=[("selected", BG)],
              foreground=[("selected", PRIMARY)])
    # úzké záložky pro okna s mnoha záložkami (revize importu: 7 záložek v 1100 px, němčina)
    style.configure("Compact.TNotebook", background=BG, bordercolor=BORDER, tabmargins=(0, 4, 0, 0))
    style.configure("Compact.TNotebook.Tab", background=BTN, foreground=FG, padding=(8, 4),
                    bordercolor=BORDER)
    style.map("Compact.TNotebook.Tab", background=[("selected", BG)],
              foreground=[("selected", PRIMARY)])

    # jezdec posuvníku musí být vidět i na bílém pozadí (BTN na bílé téměř splývá)
    style.configure("TScrollbar", background=BORDER, troughcolor=FIELD, bordercolor=BORDER,
                    lightcolor=BORDER, darkcolor=BORDER, gripcount=0, arrowcolor=DIM)
    style.map("TScrollbar", background=[("active", "#B5CCBD"), ("pressed", "#B5CCBD")])
    style.configure("TSeparator", background=BORDER)
    style.configure("Horizontal.TProgressbar", background=ACCENT, troughcolor=FIELD,
                    bordercolor=BORDER, lightcolor=ACCENT, darkcolor=ACCENT)
    return style


def text_widget(parent, *, mono: bool = False, **kw) -> tk.Text:
    """``tk.Text`` v brandových barvách (pole pro psaní nebo kód)."""
    opts = dict(bg=LOG_BG if mono else FIELD, fg=FG, insertbackground=FG,
                relief="flat", font=FONT_MONO if mono else FONT_UI,
                wrap="none" if mono else "word", highlightthickness=1,
                highlightbackground=BORDER, highlightcolor=ACCENT,
                padx=8, pady=6, selectbackground=TREE_SEL, selectforeground=FG)
    opts.update(kw)
    return tk.Text(parent, **opts)


def _logo_candidates() -> list[Path]:
    """Logo PEARTEC se do repa nepřikládá — hledá se lokálně (volitelné)."""
    out = []
    env = os.environ.get("PEARTEC_LOGO")
    if env:
        out.append(Path(env))
    out.append(ASSETS_DIR / "peartec_logo_color.png")
    out.append(Path(r"C:\CLAUDE\moldex_report\moldex_report\assets\peartec_logo_color.png"))
    return out


def load_logo(height: int = 34):
    """Malé barevné logo do hlavičky; ``None``, když není k dispozici."""
    if height in _logo_cache:
        return _logo_cache[height]
    try:
        from PIL import Image, ImageTk
        src = next(p for p in _logo_candidates() if p.exists())
        with Image.open(src) as im:
            im = im.convert("RGBA")
            w = max(1, round(height * im.width / im.height))
            img = ImageTk.PhotoImage(im.resize((w, height), Image.LANCZOS))
        _logo_cache[height] = img
        return img
    except Exception:
        return None
