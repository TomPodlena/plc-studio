"""Krok 1 — Projekt: název, popis, ukázky, otevření/uložení návrhu."""

from __future__ import annotations

import tkinter as tk
from tkinter import messagebox, ttk

from ..widgets import card, field, note_box


def render(app, parent) -> None:
    p = app.prj
    body = card(parent, "01", "Projekt")

    grid = ttk.Frame(body)
    grid.pack(fill="x")
    grid.columnconfigure(0, weight=1)
    grid.columnconfigure(1, weight=1)

    var_name = tk.StringVar(value=p["meta"]["name"])
    var_desc = tk.StringVar(value=p["meta"]["desc"])
    field(grid, "Název projektu / stroje (např. Temperační stanice TS-02)",
          lambda b: ttk.Entry(b, textvariable=var_name), col=0)
    field(grid, "Popis (co stroj dělá, pro koho)",
          lambda b: ttk.Entry(b, textvariable=var_desc), col=1)

    def on_name(*_):
        app.prj["meta"]["name"] = var_name.get()
        app.save()
        app.update_title()

    def on_desc(*_):
        app.prj["meta"]["desc"] = var_desc.get()
        app.save()

    var_name.trace_add("write", on_name)
    var_desc.trace_add("write", on_desc)

    def sample(kind: str) -> None:
        if app.confirm_replace("Ukázkový projekt"):
            app.load_sample(kind)

    def reset() -> None:
        if messagebox.askyesno("Nový projekt", "Zahodit aktuální návrh a začít s prázdným "
                               "projektem?", parent=app.root):
            app.reset_project()

    row = ttk.Frame(body)
    row.pack(fill="x", pady=(4, 0))
    ttk.Button(row, text="Ukázka: malá stanice", command=lambda: sample("small")
               ).pack(side="left")
    ttk.Button(row, text="Ukázka: složitá linka", command=lambda: sample("complex")
               ).pack(side="left", padx=(6, 0))
    ttk.Button(row, text="Otevřít projekt (JSON)…", command=app.open_project_dialog
               ).pack(side="left", padx=(18, 0))
    ttk.Button(row, text="Uložit projekt (JSON)…", command=app.save_project_dialog
               ).pack(side="left", padx=(6, 0))
    ttk.Button(row, text="Kopírovat JSON", command=lambda: app.copy(app.project_payload())
               ).pack(side="left", padx=(6, 0))
    ttk.Button(row, text="Nový prázdný projekt", style="Danger.TButton", command=reset
               ).pack(side="left", padx=(18, 0))

    # přehled návrhu — co už v projektu je
    stats = ttk.Frame(body)
    stats.pack(fill="x", pady=(16, 0))
    plats = ", ".join(app.PLAT[k]["name"] for k in p["platforms"]) or "—"
    for label, value in (("zařízení", len(p["devices"])), ("signálů I/O", len(p["io"])),
                         ("kroků sekvence", len(p["program"]["seq"])), ("platformy", plats)):
        ttk.Label(stats, text=f"{label}  {value}", style="Stat.TLabel").pack(side="left", padx=(0, 6))

    note_box(body, "Projdi kroky zleva doprava — návrh se průběžně ukládá a mezi kroky se "
             "můžeš kdykoli vracet a vstupy upřesňovat; výstupy se vždy přepočítají. "
             "Nejrychlejší start: popiš stroj v kroku AI návrh. Existující projekt převezmeš "
             "volbou Import v kroku Zařízení. Pokud s PLC začínáš, otevři Nápovědu "
             "(tlačítko vpravo v liště kroků). Soubor projektu (.plcstudio.json) je "
             "zaměnitelný s exportem z webové verze PLC Studia.", pady=(16, 0))
