"""Krok 3 — Cílové platformy: výběr jedné nebo více platforem (klikací karty)."""

from __future__ import annotations

import tkinter as tk
from tkinter import ttk

from .. import theme
from ..i18n import _
from ..widgets import card, tooltip, wrap_label

COLS = 3
# barva štítku ověření podle stavu (jako web: ověřeno = OK, jazyk = akcent, beta = varování)
VERIF_FG = {"verified": theme.OK, "lang": theme.ACCENT, "beta": theme.WARN, "unsupported": theme.ERR}


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

    # nejdřív základní platformy, pod nadpisem profily CODESYS dalších výrobců (PLAT[k].base)
    own = [(k, pf) for k, pf in app.PLAT.items() if not pf.get("base")]
    prof = [(k, pf) for k, pf in app.PLAT.items() if pf.get("base")]
    cells = []
    for i, item in enumerate(own):
        cells.append((i // COLS, i % COLS, item))
    head_row = (len(own) + COLS - 1) // COLS
    if prof:
        ttk.Label(grid, style="Dim.TLabel", text=_(
            "Další řídicí systémy na bázi CODESYS — stejný kód jako CODESYS, postup importu, "
            "I/O a kusovník podle výrobce:")).grid(row=head_row, column=0, columnspan=COLS, sticky="w", padx=5, pady=(10, 0))
    for i, item in enumerate(prof):
        cells.append((head_row + 1 + i // COLS, i % COLS, item))
    for row, col, (key, pf) in cells:
        on = key in app.prj["platforms"]
        bg = theme.TREE_SEL if on else theme.FIELD
        box = tk.Frame(grid, bg=bg, cursor="hand2", highlightthickness=2 if on else 1,
                       highlightbackground=theme.ACCENT if on else theme.BORDER)
        box.grid(row=row, column=col, sticky="nsew", padx=5, pady=5)
        box.columnconfigure(0, weight=1)
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
        parts[0].grid(row=0, column=0, sticky="ew", padx=(12, 4), pady=(10, 2))
        parts[1].grid(row=1, column=0, columnspan=2, sticky="ew", padx=12)
        parts[2].grid(row=2, column=0, columnspan=2, sticky="ew", padx=12, pady=(2, 10))
        # štítek ověření (data/verification.json) + bublina: význam, co ověřeno, kde, co neověřeno
        ver = app.VERIF.get(key)
        if ver:
            fg = VERIF_FG.get(ver["state"], theme.DIM)
            chip = tk.Label(box, text=ver["label"], bg=bg, fg=fg, font=("Segoe UI", 8), padx=6, pady=0,
                            highlightthickness=1, highlightbackground=fg, cursor="question_arrow")
            chip.grid(row=0, column=1, sticky="ne", padx=(0, 10), pady=(12, 0))
            chip.verif_state = ver["state"]          # pro testy
            tooltip(chip, ver["tip"])
            parts.append(chip)
        for w in (box, *parts):
            w.bind("<Button-1>", lambda _e, k=key: toggle(k), add="+")

    wrap_label(body, _(
        "Štítek u platformy říká, jak je výstup ověřený: ověřeno v IDE (import a překlad ve skutečném "
        "vývojovém prostředí), jazyk ověřen (překladačem, ne v IDE výrobce), beta (jen emulátor PLCdesk). "
        "Co ověřené není, ukáže bublina nad štítkem."), pady=(8, 0))
    n = len(app.prj["platforms"])
    ttk.Label(body, style="Dim.TLabel" if n else "Err.TLabel",
              text=_("Vybráno platforem: {n}", n=n) if n else
              _("Není vybraná žádná platforma — bez ní se nevygeneruje žádný kód.")
              ).pack(anchor="w", pady=(10, 0))
    code_style(app, body)


def code_style(app, body) -> None:
    """Styl kódu Klasický / OOP — jen když je vybraná platforma, která OOP umí (rodina CODESYS)."""
    oop_plats = [k for k in app.prj["platforms"] if (app.PLAT.get(k) or {}).get("oop")]
    if not oop_plats:
        return
    box = ttk.LabelFrame(body, text=_("Styl kódu"), padding=(10, 6))
    box.pack(fill="x", pady=(12, 0))
    # Tk proměnnou držet živou (bez reference ji GC uklidí a přepínač zbělá)
    app._code_style_var = var = tk.StringVar(value="oop" if app.prj.get("codeStyle") == "oop" else "classic")

    def changed() -> None:
        if var.get() == "oop":
            app.prj["codeStyle"] = "oop"
        else:
            app.prj.pop("codeStyle", None)
        app.save()
        app.render()

    row = ttk.Frame(box)
    row.pack(anchor="w")
    ttk.Radiobutton(row, text=_("Klasický (doporučeno)"), value="classic", variable=var,
                    command=changed).pack(side="left", padx=(0, 18))
    ttk.Radiobutton(row, text=_("OOP"), value="oop", variable=var, command=changed).pack(side="left")
    wrap_label(box, _(
        "OOP: rozhraní I_Device, abstraktní základ FB_DeviceBase, třídy zařízení s metodami a "
        "vlastnostmi, sekvence ve FB_Sequence. Chování je stejné jako u klasického stylu (ověřuje "
        "emulátor), mění se jen zápis. Platí pro: {list}; ostatní platformy dostanou klasický kód.",
        list=", ".join(app.PLAT[k]["name"] for k in oop_plats)))
