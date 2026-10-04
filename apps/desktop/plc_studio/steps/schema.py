"""Krok 6 — Schéma: blokové schéma, funkční diagram cyklu, elektrické
zapojení I/O a svorkovnice. Všechny pohledy jsou klikací a provázané:
blok → zařízení → jeho vstupy a výstupy → I/O tabulka / list zapojení."""

from __future__ import annotations

import tkinter as tk
from tkinter import ttk

from ..detail import DevicePanel
from ..i18n import _
from ..svgview import SvgView
from ..widgets import Table, card, link, note_box, save_file, save_many, wrap_label

TAB_BLOCK, TAB_FLOW, TAB_WIRING, TAB_TERMS = range(4)


def render(app, parent) -> None:
    data = app.bridge.request("schema", prj=app.prj)
    app.prj = data["prj"]
    body = card(parent, "06", _("Schéma"))
    if not app.prj["io"]:
        wrap_label(body, _("Nejdřív přidej zařízení (krok 4), nebo si je nech navrhnout "
                           "v kroku AI návrh."))
        return
    sheets, rows = data["sheets"], data["rows"]
    terms = {r["key"]: r for r in rows}
    ui = app.ui

    nb = ttk.Notebook(body)
    nb.pack(fill="both", expand=True)

    # ------------------------------------------------------------ blokové schéma
    t1 = ttk.Frame(nb, padding=10)
    nb.add(t1, text=_("Blokové schéma systému"))
    row = ttk.Frame(t1)
    row.pack(side="bottom", fill="x", pady=(8, 0))
    ttk.Button(row, text=_("Uložit SVG…"),
               command=lambda: save_file(app, "00_blokove_schema.svg", data["block"])
               ).pack(side="left")
    ttk.Button(row, text=_("Kopírovat SVG"), command=lambda: app.copy(data["block"])
               ).pack(side="left", padx=(6, 0))
    ttk.Button(row, text=_("Živá simulace ↗"),
               command=lambda: app.open_live(ui.get("block_sel"))).pack(side="left", padx=(6, 0))
    wrap_label(row, _("Zdroje signálů → moduly PLC → akční členy. Klik na zařízení = popis "
                      "a odkazy vpravo, klik na modul = jeho list zapojení."),
               side="left", padx=10, expand=True)
    panel_block = DevicePanel(t1, app, terms, here="blok")
    panel_block.pack(side="right", fill="y", padx=(12, 0))

    def mark_block(meta: dict) -> str | None:
        sel = ui.get("block_sel")
        if sel is None:
            return None
        if meta.get("dev") == sel:
            return "sel"
        # moduly, do kterých vybrané zařízení vede
        if "dev" not in meta and "mod" in meta and any(
                r["devId"] == sel and r["sheet"] == meta["mod"] for r in rows):
            return "hot"
        return None

    def click_block(meta: dict) -> None:
        if "dev" in meta:
            ui["block_sel"] = meta["dev"]
            panel_block.show(meta["dev"], io_key=meta.get("io"))
            view_block.refresh()
        elif "mod" in meta:
            show_sheet_index(meta["mod"])
            nb.select(TAB_WIRING)

    view_block = SvgView(t1, on_click=click_block, marker=mark_block)
    view_block.pack(fill="both", expand=True)
    view_block.show(data["block"])
    if app.dev_by_id(ui.get("block_sel")) is not None:
        panel_block.show(ui["block_sel"])
        view_block.after_idle(lambda: view_block.see(lambda m: m.get("dev") == ui.get("block_sel")))
    else:
        ui["block_sel"] = None

    # ------------------------------------------------------------ funkční diagram
    t2 = ttk.Frame(nb, padding=10)
    nb.add(t2, text=_("Funkční diagram cyklu"))
    row2 = ttk.Frame(t2)
    row2.pack(side="bottom", fill="x", pady=(8, 0))
    ttk.Button(row2, text=_("Uložit SVG…"),
               command=lambda: save_file(app, "00_funkcni_diagram.svg", data["flow"])
               ).pack(side="left")
    ttk.Button(row2, text=_("Simulace a ověření ↗"), command=app.open_sim
               ).pack(side="left", padx=(6, 0))
    wrap_label(row2, _("Jak stroj pracuje: kroky automatického cyklu a podmínky přechodu; časy "
                       "jsou z běžného cyklu simulace. Klik na krok = zařízení a odkazy."),
               side="left", padx=10, expand=True)
    panel_flow = DevicePanel(t2, app, terms, here="flow",
                             empty=_("Klikni na krok v diagramu — zobrazí se zařízení, které "
                                     "krok ovládá, s odkazy na jeho signály a na program."))
    panel_flow.pack(side="right", fill="y", padx=(12, 0))

    def click_flow(meta: dict) -> None:
        if "step" in meta:
            ui["flow_sel"] = meta["step"]
            panel_flow.show(meta.get("dev"), step=meta["step"])
            view_flow.refresh()

    view_flow = SvgView(t2, on_click=click_flow,
                        marker=lambda m: "sel" if ui.get("flow_sel") is not None
                        and m.get("step") == ui.get("flow_sel") else None)
    view_flow.pack(fill="both", expand=True)
    view_flow.show(data["flow"])
    seq = app.prj["program"]["seq"]
    if isinstance(ui.get("flow_sel"), int) and ui["flow_sel"] < len(seq):
        i = ui["flow_sel"]
        dev = seq[i]["dev"] if i >= 0 and seq[i]["act"] != "wait" else None
        panel_flow.show(dev or None, step=i)
        view_flow.after_idle(lambda: view_flow.see(lambda m: m.get("step") == i))
    else:
        ui["flow_sel"] = None

    # ------------------------------------------------------------ elektrické zapojení
    t3 = ttk.Frame(nb, padding=10)
    nb.add(t3, text=_("Elektrické zapojení I/O"))
    top = ttk.Frame(t3)
    top.pack(fill="x", pady=(0, 6))
    ttk.Label(top, text=_("List:")).pack(side="left")
    titles = [s["title"] for s in sheets]
    if ui.get("wire_sel") in terms:                       # odkaz na signál → jeho list
        ui["sheet"] = terms[ui["wire_sel"]]["sheet"]
    else:
        ui["wire_sel"] = None
    var_sheet = tk.StringVar(value=titles[min(ui.get("sheet", 0), len(titles) - 1)])
    ttk.Combobox(top, textvariable=var_sheet, values=titles, state="readonly", width=30
                 ).pack(side="left", padx=(6, 12))
    cur = lambda: sheets[titles.index(var_sheet.get())]  # noqa: E731
    ttk.Button(top, text=_("Uložit SVG…"),
               command=lambda: save_file(app, cur()["base"] + ".svg", cur()["svg"])
               ).pack(side="left")
    ttk.Button(top, text=_("Uložit DXF…"),
               command=lambda: save_file(app, cur()["base"] + ".dxf", cur()["dxf"])
               ).pack(side="left", padx=(6, 0))

    def save_all() -> None:
        files = [("00_blokove_schema.svg", data["block"])]
        if seq:
            files.append(("00_funkcni_diagram.svg", data["flow"]))
        for s in sheets:
            files += [(s["base"] + ".svg", s["svg"]), (s["base"] + ".dxf", s["dxf"])]
        save_many(app, files, _("výkresy"))

    ttk.Button(top, text=_("Uložit všechny výkresy do složky…"), command=save_all
               ).pack(side="left", padx=(6, 0))
    info = ttk.Frame(t3)
    info.pack(fill="x", pady=(0, 6))
    note_box(t3, _(
        "Pozor: NC/NO kontakty dle sloupce NC v kroku I/O; čísla vodičů podle "
        "svorkovnice (X1 → -W101…, X2 → -W201…). Jištění, průřezy, relé na výstupech "
        "s větší zátěží a stínění analogů doplní projektant elektro — toto je podklad, ne výrobní dokumentace. "
        "DXF otevře EPLAN / AutoCAD / LibreCAD."), warn=True, side="bottom")

    def show_info() -> None:
        """Řádek s odkazy pro vybraný signál na listu."""
        for w in info.winfo_children():
            w.destroy()
        r = terms.get(ui.get("wire_sel"))
        if r is None:
            ttk.Label(info, text=_("Klik na kanál = odkazy na zařízení a řádek v I/O."),
                      style="Dim.TLabel").pack(side="left")
            return
        ttk.Label(info, text=f"{r['svorka']} · {r['tag']} · {r['addr']} — {r['cmt']}",
                  style="Section.TLabel").pack(side="left")
        link(info, _("Zařízení ↗"), lambda: app.open_device(r["devId"])
             ).pack(side="left", padx=(14, 0))
        link(info, _("I/O ↗"), lambda: app.open_io(r["key"])).pack(side="left", padx=(12, 0))
        link(info, _("Blokové schéma ↗"), lambda: app.open_block(r["devId"])
             ).pack(side="left", padx=(12, 0))

    def click_wire(meta: dict) -> None:
        if "io" in meta:
            ui["wire_sel"] = meta["io"]
            show_info()
            view_sheet.refresh()

    view_sheet = SvgView(t3, on_click=click_wire, band=True,
                         marker=lambda m: "sel" if m.get("io") is not None
                         and m.get("io") == ui.get("wire_sel") else None)
    view_sheet.pack(fill="both", expand=True)

    def show_sheet(*_a) -> None:
        ui["sheet"] = titles.index(var_sheet.get())
        view_sheet.show(cur()["svg"])
        show_info()
        if ui.get("wire_sel"):
            view_sheet.after_idle(lambda: view_sheet.see(lambda m: m.get("io") == ui.get("wire_sel")))

    def show_sheet_index(index: int) -> None:
        var_sheet.set(titles[max(0, min(index, len(titles) - 1))])

    var_sheet.trace_add("write", show_sheet)
    show_sheet()

    # ------------------------------------------------------------ svorkovnice
    t4 = ttk.Frame(nb, padding=10)
    nb.add(t4, text=_("Svorkovnice"))
    row4 = ttk.Frame(t4)
    row4.pack(side="bottom", fill="x", pady=(8, 0))
    ttk.Button(row4, text=_("Uložit svorkovnici (CSV)…"),
               command=lambda: save_file(app, "03_svorkovnice.csv", data["csv"])).pack(side="left")
    tbl = Table(t4, [("svorka", _("Svorka"), 80, False), ("modul", _("Modul"), 70, False),
                     ("kanal", _("Kanál"), 60, False), ("addr", _("Adresa"), 90, False),
                     ("tag", _("Tag"), 220, True), ("wire", _("Vodič"), 70, False),
                     ("cmt", _("Zařízení / komentář"), 420, True)],
                height=12)
    tbl.pack(fill="both", expand=True)
    for r in rows:
        tbl.add(r["key"], (r["svorka"], r["modul"], r["kanal"], r["addr"], r["tag"], r["wire"],
                           r["cmt"]))

    def with_row(action) -> None:
        r = terms.get(tbl.selected())
        if r is None:
            app.set_status(_("Nejdřív vyber svorku v tabulce."))
        else:
            action(r)

    ttk.Label(row4, text=_("Vybraná svorka:"), style="Dim.TLabel").pack(side="left", padx=(16, 0))
    link(row4, _("Zapojení ↗"), lambda: with_row(lambda r: app.open_wiring(r["key"]))
         ).pack(side="left", padx=(8, 0))
    link(row4, _("I/O ↗"), lambda: with_row(lambda r: app.open_io(r["key"]))
         ).pack(side="left", padx=(12, 0))
    link(row4, _("Zařízení ↗"), lambda: with_row(lambda r: app.open_device(r["devId"]))
         ).pack(side="left", padx=(12, 0))
    tbl.tv.bind("<Double-1>", lambda _e: with_row(lambda r: app.open_wiring(r["key"])))

    # zapamatuj si otevřenou záložku mezi překresleními
    nb.select(min(ui.get("schema_tab", 0), TAB_TERMS))
    nb.bind("<<NotebookTabChanged>>",
            lambda _e: ui.__setitem__("schema_tab", nb.index(nb.select())))
