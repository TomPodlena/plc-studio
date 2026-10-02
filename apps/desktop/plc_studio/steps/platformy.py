"""Krok 3 — Cílové platformy: výběr jedné nebo více platforem (klikací karty)."""

from __future__ import annotations

import tkinter as tk
from tkinter import ttk

from .. import theme
from ..i18n import _
from ..widgets import card, wrap_label

COLS = 3


def render(app, parent) -> None:
    body = card(parent, "03", _("Cílové platformy"))
    wrap_label(body, _(
        "Vyber jednu nebo víc platforem — program se vygeneruje pro každou zvlášť. "
        "Logika je stejná (IEC 61131-3 ST), liší se dialekt, soubor s tagy a postup importu."))

    grid = ttk.Frame(body)
    grid.pack(fill="x", pady=(10, 0))
    for c in range(COLS):
        grid.columnconfigure(c, weight=1, uniform="plat")

    def toggle(key: str) -> None:
        plats = app.prj["platforms"]
        if key in plats:
            plats.remove(key)
        else:
            plats.append(key)
        app.save()
        app.render()

    for i, (key, pf) in enumerate(app.PLAT.items()):
        on = key in app.prj["platforms"]
        bg = theme.TREE_SEL if on else theme.FIELD
        box = tk.Frame(grid, bg=bg, cursor="hand2", highlightthickness=2 if on else 1,
                       highlightbackground=theme.ACCENT if on else theme.BORDER)
        box.grid(row=i // COLS, column=i % COLS, sticky="nsew", padx=5, pady=5)
        parts = [
            tk.Label(box, text=("✔ " if on else "") + pf["name"], bg=bg, anchor="w",
                     fg=theme.PRIMARY, font=("Segoe UI", 11, "bold")),
            tk.Label(box, text=f"{pf['ide']} · {pf['cpu']}", bg=bg, fg=theme.FG, anchor="w",
                     font=theme.FONT_DIM, justify="left"),
            tk.Label(box, text=f"{pf['lang']} · {pf['imp']}", bg=bg, fg=theme.DIM, anchor="w",
                     font=theme.FONT_DIM, justify="left"),
        ]
        for lbl in parts[1:]:            # zalamovat podle šířky karty, ne pevně
            lbl.bind("<Configure>", lambda e: e.widget.configure(wraplength=max(150, e.width - 4)))
        parts[0].pack(fill="x", padx=12, pady=(10, 2))
        parts[1].pack(fill="x", padx=12)
        parts[2].pack(fill="x", padx=12, pady=(2, 10))
        for w in (box, *parts):
            w.bind("<Button-1>", lambda _e, k=key: toggle(k))

    n = len(app.prj["platforms"])
    ttk.Label(body, style="Dim.TLabel" if n else "Err.TLabel",
              text=_("Vybráno platforem: {n}", n=n) if n else
              _("Není vybraná žádná platforma — bez ní se nevygeneruje žádný kód.")
              ).pack(anchor="w", pady=(10, 0))
