"""Krok 8 — Generované zdroje: záložky Kód (po platformách a souborech), HMI, Emulace kódu
a SISTEMA a EPLAN (moduly ``hmi``, ``emulace``, ``exporty``; web má totéž v gen_tabs.js).
Záložka se vykreslí až při prvním zobrazení — HMI ani exporty se zbytečně nepočítají."""

from __future__ import annotations

import tkinter as tk
from tkinter import ttk

from ..i18n import N_, _
from ..widgets import FlowFrame, card, note_box, save_file, save_many, scrolled_text, set_text, wrap_label


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


TAB_CODE, TAB_HMI, TAB_EMU, TAB_EXPORTS = range(4)
TABS = [N_("Kód"), N_("HMI"), N_("Emulace kódu"), N_("SISTEMA a EPLAN")]


def render(app, parent) -> None:
    from . import emulace, exporty, hmi          # kroky-záložky (import až tady: cyklus balíku)
    body = card(parent, "08", _("Generované zdroje"))
    if not app.prj["devices"]:
        wrap_label(body, _("Nejdřív přidej zařízení (krok 4), nech si je navrhnout v kroku "
                           "AI návrh, nebo použij volbu Import."))
        return
    nb = ttk.Notebook(body)
    nb.pack(fill="both", expand=True)
    renderers = [render_code, hmi.render, emulace.render, exporty.render]
    frames = []
    for title in TABS:
        f = ttk.Frame(nb, padding=10)
        nb.add(f, text=_(title))
        frames.append(f)
    done: set[int] = set()

    def show(_e=None) -> None:
        i = nb.index("current")
        app.ui["gen_tab"] = i
        if i not in done:
            done.add(i)
            renderers[i](app, frames[i])

    sel = app.ui.get("gen_tab", TAB_CODE)
    nb.select(sel if isinstance(sel, int) and 0 <= sel < len(TABS) else TAB_CODE)
    show()
    nb.bind("<<NotebookTabChanged>>", show)
    app.gen_notebook = nb             # testy a odkazy (app.ui["gen_tab"] vybere záložku)


def render_code(app, body) -> None:
    """Záložka Kód: soubory platforem s náhledem a ukládáním."""
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

    # řady přepínačů se zalamují podle šířky okna — u 20 platforem / 12 souborů OOP by
    # řada v jednom řádku skončila za okrajem a zbytek by nešel vybrat
    tabs_p = FlowFrame(body)
    tabs_p.pack(fill="x")
    for pl in plats:
        ttk.Radiobutton(tabs_p, text=app.PLAT[pl]["name"], value=pl, variable=var_plat,
                        style="Tab.Toolbutton")
    tabs_p.schedule()
    tabs_f = FlowFrame(body)
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
                            style="Tab.Toolbutton")
        tabs_f.schedule()
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
