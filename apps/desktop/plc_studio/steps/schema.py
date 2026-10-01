"""Krok 6 — Schéma: blokové schéma, elektrické zapojení I/O, svorkovnice."""

from __future__ import annotations

import tkinter as tk
from tkinter import ttk

from ..svgview import SvgView
from ..widgets import Table, card, note_box, save_file, save_many, wrap_label


def render(app, parent) -> None:
    data = app.bridge.request("schema", prj=app.prj)
    app.prj = data["prj"]
    body = card(parent, "06", "Schéma")
    if not app.prj["io"]:
        wrap_label(body, "Nejdřív přidej zařízení (krok 4), nebo si je nech navrhnout "
                   "v kroku AI návrh.")
        return
    sheets = data["sheets"]

    nb = ttk.Notebook(body)
    nb.pack(fill="both", expand=True)

    # --- blokové schéma ---
    t1 = ttk.Frame(nb, padding=10)
    nb.add(t1, text="Blokové schéma systému")
    row = ttk.Frame(t1)
    row.pack(side="bottom", fill="x", pady=(8, 0))
    ttk.Button(row, text="Uložit SVG…",
               command=lambda: save_file(app, "00_blokove_schema.svg", data["block"])
               ).pack(side="left")
    ttk.Button(row, text="Kopírovat SVG", command=lambda: app.copy(data["block"])
               ).pack(side="left", padx=(6, 0))
    ttk.Label(row, style="Dim.TLabel",
              text="Zdroje signálů → moduly PLC → akční členy; moduly navrženy z počtu I/O "
                   "(DI16 / DO16 / AI8 / AO4).").pack(side="left", padx=10)
    view_block = SvgView(t1)
    view_block.pack(fill="both", expand=True)
    view_block.show(data["block"])

    # --- elektrické zapojení ---
    t2 = ttk.Frame(nb, padding=10)
    nb.add(t2, text="Elektrické zapojení I/O")
    top = ttk.Frame(t2)
    top.pack(fill="x", pady=(0, 6))
    ttk.Label(top, text="List:").pack(side="left")
    titles = [s["title"] for s in sheets]
    var_sheet = tk.StringVar(value=titles[min(app.ui.get("sheet", 0), len(titles) - 1)])
    ttk.Combobox(top, textvariable=var_sheet, values=titles, state="readonly", width=30
                 ).pack(side="left", padx=(6, 12))
    cur = lambda: sheets[titles.index(var_sheet.get())]  # noqa: E731
    ttk.Button(top, text="Uložit SVG…",
               command=lambda: save_file(app, cur()["base"] + ".svg", cur()["svg"])
               ).pack(side="left")
    ttk.Button(top, text="Uložit DXF…",
               command=lambda: save_file(app, cur()["base"] + ".dxf", cur()["dxf"])
               ).pack(side="left", padx=(6, 0))

    def save_all() -> None:
        files = [("00_blokove_schema.svg", data["block"])]
        for s in sheets:
            files += [(s["base"] + ".svg", s["svg"]), (s["base"] + ".dxf", s["dxf"])]
        save_many(app, files, "výkresy")

    ttk.Button(top, text="Uložit všechny výkresy do složky…", command=save_all
               ).pack(side="left", padx=(6, 0))
    note_box(t2, "Pozor: NC/NO kontakty dle sloupce NC v kroku I/O; čísla vodičů -W1xx dle "
             "potenciálových řad. Jištění, průřezy, relé na výstupech s větší zátěží a stínění "
             "analogů doplní projektant elektro — toto je podklad, ne výrobní dokumentace. "
             "DXF otevře EPLAN / AutoCAD / LibreCAD.", warn=True, side="bottom")
    view_sheet = SvgView(t2)
    view_sheet.pack(fill="both", expand=True)

    def show_sheet(*_) -> None:
        app.ui["sheet"] = titles.index(var_sheet.get())
        view_sheet.show(cur()["svg"])

    var_sheet.trace_add("write", show_sheet)
    show_sheet()

    # --- svorkovnice ---
    t3 = ttk.Frame(nb, padding=10)
    nb.add(t3, text="Svorkovnice")
    row3 = ttk.Frame(t3)
    row3.pack(side="bottom", fill="x", pady=(8, 0))
    ttk.Button(row3, text="Uložit svorkovnici (CSV)…",
               command=lambda: save_file(app, "03_svorkovnice.csv", data["csv"])).pack(side="left")
    ttk.Label(row3, text="Podklad pro projektanta elektro.", style="Dim.TLabel"
              ).pack(side="left", padx=10)
    tbl = Table(t3, [("svorka", "Svorka", 80, False), ("modul", "Modul", 70, False),
                     ("kanal", "Kanál", 60, False), ("addr", "Adresa", 90, False),
                     ("tag", "Tag", 220, True), ("cmt", "Zařízení / komentář", 420, True)],
                height=12)
    tbl.pack(fill="both", expand=True)
    for i, r in enumerate(data["rows"]):
        tbl.add(i, (r["svorka"], r["modul"], r["kanal"], r["addr"], r["tag"], r["cmt"]))

    # zapamatuj si otevřenou záložku mezi překresleními
    nb.select(min(app.ui.get("schema_tab", 0), 2))
    nb.bind("<<NotebookTabChanged>>",
            lambda _e: app.ui.__setitem__("schema_tab", nb.index(nb.select())))
