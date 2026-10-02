"""Krok 8 — Generované zdroje: kód po platformách a souborech."""

from __future__ import annotations

import tkinter as tk
from tkinter import ttk

from ..i18n import _
from ..widgets import card, note_box, save_file, save_many, scrolled_text, set_text, wrap_label


def _tsv_tabs(widget, text: str) -> tuple:
    """Zarážky tabulátoru podle nejširšího textu ve sloupcích — tabulka tagů (TSV)
    se pak v náhledu čte jako tabulka, ne jako rozsypané řádky."""
    from tkinter import font as tkfont
    rows = [line.split("\t") for line in text.splitlines()[:2000]]
    ncol = max((len(r) for r in rows), default=0)
    if ncol < 2:
        return ()
    ch = tkfont.Font(font=widget.cget("font")).measure("0")
    stops, x = [], 0
    for c in range(ncol - 1):
        x += (max(len(r[c]) for r in rows if len(r) > c) + 2) * ch
        stops.append(x)
    return tuple(stops)


def render(app, parent) -> None:
    body = card(parent, "08", _("Generované zdroje"))
    if not app.prj["devices"]:
        wrap_label(body, _("Nejdřív přidej zařízení (krok 4), nech si je navrhnout v kroku "
                           "AI návrh, nebo použij volbu Import."))
        return
    if not app.prj["platforms"]:
        wrap_label(body, _("Vyber aspoň jednu platformu (krok 3)."))
        return
    data = app.bridge.request("gen", prj=app.prj)
    app.prj = data["prj"]
    out: dict = data["out"]
    plats = list(out)

    var_plat = tk.StringVar(value=app.ui.get("gen_plat") if app.ui.get("gen_plat") in plats
                            else plats[0])
    var_file = tk.StringVar()

    tabs_p = ttk.Frame(body)
    tabs_p.pack(fill="x")
    for pl in plats:
        ttk.Radiobutton(tabs_p, text=app.PLAT[pl]["name"], value=pl, variable=var_plat,
                        style="Tab.Toolbutton").pack(side="left", padx=(0, 4))
    tabs_f = ttk.Frame(body)
    tabs_f.pack(fill="x", pady=(8, 6))

    # zdola: poznámka a tlačítka
    note_box(body, _(
        "Postup importu pro danou platformu je v souboru README.txt. Výstup je "
        "výchozí kostra — TODO komentáře označují místa k doplnění. Generovaný kód je "
        "návrh k revizi; bezpečnostní funkce řeší certifikovaná safety technika."),
        side="bottom")
    btns = ttk.Frame(body)
    btns.pack(side="bottom", fill="x", pady=(8, 0))

    code_frm, code = scrolled_text(body, mono=True, readonly=True, height=14)
    code_frm.pack(fill="both", expand=True)

    def cur() -> tuple[str, str]:
        return var_file.get(), out[var_plat.get()][var_file.get()]

    def show_file(*_a) -> None:
        if var_file.get() in out[var_plat.get()]:
            app.ui["gen_file"] = var_file.get()
            name, text = cur()
            code.configure(tabs=_tsv_tabs(code, text) if name.lower().endswith(".tsv") else "")
            set_text(code, text)

    def show_plat(*_a) -> None:
        app.ui["gen_plat"] = var_plat.get()
        for w in tabs_f.winfo_children():
            w.destroy()
        files = list(out[var_plat.get()])
        for name in files:
            ttk.Radiobutton(tabs_f, text=name, value=name, variable=var_file,
                            style="Tab.Toolbutton").pack(side="left", padx=(0, 4))
        var_file.set(app.ui.get("gen_file") if app.ui.get("gen_file") in files else files[0])

    var_file.trace_add("write", show_file)
    var_plat.trace_add("write", show_plat)
    show_plat()

    def save_all() -> None:
        pl = var_plat.get()
        save_many(app, [(f"{pl}_{n}", b) for n, b in out[pl].items()],
                  _("soubory platformy {name}", name=app.PLAT[pl]["name"]))

    ttk.Button(btns, text=_("Uložit zobrazený soubor…"), style="Accent.TButton",
               command=lambda: save_file(app, f"{var_plat.get()}_{cur()[0]}", cur()[1])
               ).pack(side="left")
    ttk.Button(btns, text=_("Uložit všechny soubory platformy…"), command=save_all
               ).pack(side="left", padx=(6, 0))
    ttk.Button(btns, text=_("Kopírovat"), command=lambda: app.copy(cur()[1])
               ).pack(side="left", padx=(6, 0))
