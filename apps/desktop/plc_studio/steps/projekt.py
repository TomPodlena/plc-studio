"""Krok 1 — Projekt: název, popis, ukázky, otevření/uložení návrhu."""

from __future__ import annotations

import json
from pathlib import Path

import tkinter as tk
from tkinter import messagebox, ttk

from ..i18n import _, get_lang
from ..project import parse_num
from ..widgets import card, field, note_box


SAMPLES_DIR = Path(__file__).resolve().parents[4] / "samples"
_cache: dict = {}


def list_samples() -> list[dict]:
    """Příklady ze složky samples/: cesta a popisek „název (N zařízení, M kroků)"."""
    if not SAMPLES_DIR.is_dir():
        return []
    files = sorted(SAMPLES_DIR.glob("*.plcstudio.json"))
    key = (get_lang(), tuple((f.name, f.stat().st_mtime) for f in files))
    if _cache.get("key") != key:
        out = []
        for f in files:
            try:
                d = json.loads(f.read_text(encoding="utf-8-sig"))
                prj = d.get("prj") or d
                out.append({"path": f, "name": prj["meta"]["name"], "n": len(prj["devices"]),
                            "s": len(prj["program"]["seq"]), "label": _(
                    "{name} ({n} zařízení, {s} kroků)", name=prj["meta"]["name"] or f.stem,
                    n=len(prj["devices"]), s=len(prj["program"]["seq"]))})
            except (OSError, ValueError, KeyError, TypeError):
                continue
        _cache.update(key=key, items=out)
    return _cache["items"]


def _open_import(app) -> None:
    from ..importer import open_wizard      # líně: importer sahá na moduly kroků
    open_wizard(app)


def render(app, parent) -> None:
    p = app.prj
    body = card(parent, "01", _("Projekt"))

    grid = ttk.Frame(body)
    grid.pack(fill="x")
    grid.columnconfigure(0, weight=2)
    grid.columnconfigure(1, weight=2)
    grid.columnconfigure(2, weight=1)

    var_name = tk.StringVar(value=p["meta"]["name"])
    var_desc = tk.StringVar(value=p["meta"]["desc"])
    takt = p["meta"].get("takt")
    var_takt = tk.StringVar(value=f"{takt:g}" if takt else "")
    field(grid, _("Název projektu / stroje (např. Temperační stanice TS-02)"),
          lambda b: ttk.Entry(b, textvariable=var_name), col=0)
    field(grid, _("Popis (co stroj dělá, pro koho)"),
          lambda b: ttk.Entry(b, textvariable=var_desc), col=1)
    field(grid, _("Požadovaný takt [s] (ověří simulace)"),
          lambda b: ttk.Entry(b, textvariable=var_takt), col=2)

    def on_takt(*_a):
        v = parse_num(var_takt.get())          # „inf“ / „1e999“ by projekt rozbily (JSON)
        if v is not None and v > 0:
            app.prj["meta"]["takt"] = v
        else:
            app.prj["meta"].pop("takt", None)
        app.save()

    var_takt.trace_add("write", on_takt)

    def on_name(*_a):
        app.prj["meta"]["name"] = var_name.get()
        app.save()
        app.update_title()

    def on_desc(*_a):
        app.prj["meta"]["desc"] = var_desc.get()
        app.save()

    var_name.trace_add("write", on_name)
    var_desc.trace_add("write", on_desc)

    def sample(kind: str) -> None:
        if app.confirm_replace(_("Ukázkový projekt")):
            app.load_sample(kind)

    def reset() -> None:
        if messagebox.askyesno(_("Nový projekt"), _("Zahodit aktuální návrh a začít s prázdným "
                                                    "projektem?"), parent=app.root):
            app.reset_project()

    row = ttk.Frame(body)
    row.pack(fill="x", pady=(4, 0))
    ttk.Button(row, text=_("Ukázka: malá stanice"), command=lambda: sample("small")
               ).pack(side="left")
    ttk.Button(row, text=_("Ukázka: složitá linka"), command=lambda: sample("complex")
               ).pack(side="left", padx=(6, 0))
    ttk.Button(row, text=_("Otevřít projekt (JSON)…"), command=app.open_project_dialog
               ).pack(side="left", padx=(18, 0))
    ttk.Button(row, text=_("Uložit projekt (JSON)…"), command=app.save_project_dialog
               ).pack(side="left", padx=(6, 0))
    ttk.Button(row, text=_("Kopírovat JSON"), command=lambda: app.copy(app.project_payload())
               ).pack(side="left", padx=(6, 0))
    ttk.Button(row, text=_("Nový prázdný projekt"), style="Danger.TButton", command=reset
               ).pack(side="left", padx=(18, 0))

    # stávající stroj → projekt (průvodce importu: exporty PLC, I/O listy, schémata, fotky)
    irow = ttk.Frame(body)
    irow.pack(fill="x", pady=(12, 0))
    ttk.Button(irow, text=_("Načíst stávající zařízení…"), command=lambda: _open_import(app)
               ).pack(side="left")
    ttk.Label(irow, text=_("převezme stávající stroj z exportů PLC, I/O listů, schémat a fotek"),
              style="Dim.TLabel").pack(side="left", padx=10)

    # knihovna příkladů (samples/ v kořeni repozitáře) — od jednoduchých po velké linky
    samples = list_samples()
    if samples:
        srow = ttk.Frame(body)
        srow.pack(fill="x", pady=(12, 0))
        ttk.Label(srow, text=_("Příklady strojů:")).pack(side="left")
        labels = [s["label"] for s in samples]
        # volba uživatele má po překreslení přednost; dokud nic nezvolil, ukazuje otevřený
        # příklad (název + počet zařízení a kroků — vestavěná ukázka může mít stejný název),
        # jinak první položku. Otevření příkladu volbu nastaví na něj.
        ui = app.ui.setdefault("projekt", {})
        cur = ui.get("sample")
        if not (isinstance(cur, int) and 0 <= cur < len(samples)):
            cur = next((i for i, s in enumerate(samples) if s["name"] == p["meta"]["name"]
                        and s["n"] == len(p["devices"])
                        and s["s"] == len(p["program"]["seq"])), 0)
        var_s = tk.StringVar(value=labels[cur])
        cb = ttk.Combobox(srow, textvariable=var_s, values=labels, state="readonly",
                          width=max(len(x) for x in labels) + 2,
                          height=min(len(labels), 15))   # rozbalit celý seznam bez rolování
        cb.pack(side="left", padx=(8, 6))
        cb._var = var_s                            # držet proměnnou naživu (GC)
        cb.bind("<<ComboboxSelected>>", lambda _e: ui.update(sample=cb.current()))

        def open_sample() -> None:
            i = max(cb.current(), 0)
            ui["sample"] = i
            s = samples[i]
            if app.confirm_replace(_("Příklad")) and app.open_project(s["path"]):
                app.sync()                         # příklady nesou jen zařízení — I/O dopočítat
                app.save()
                app.render()

        ttk.Button(srow, text=_("Otevřít příklad"), command=open_sample).pack(side="left")

    # přehled návrhu — co už v projektu je
    stats = ttk.Frame(body)
    stats.pack(fill="x", pady=(16, 0))
    plats = ", ".join(app.PLAT[k]["name"] for k in p["platforms"]) or "—"
    for label, value in ((_("zařízení"), len(p["devices"])), (_("signálů I/O"), len(p["io"])),
                         (_("kroků sekvence"), len(p["program"]["seq"])),
                         (_("platformy"), plats)):
        ttk.Label(stats, text=f"{label}  {value}", style="Stat.TLabel").pack(side="left", padx=(0, 6))

    # revize a změnové řízení + firemní knihovna (fáze 3B — revize.py, knihovna.py)
    from . import knihovna, revize
    pui = app.ui.setdefault("projekt", {})
    nb = ttk.Notebook(body)
    nb.pack(fill="both", expand=True, pady=(12, 0))
    t_rev = ttk.Frame(nb, padding=(0, 6, 0, 0))
    t_lib = ttk.Frame(nb, padding=(0, 6, 0, 0))
    nb.add(t_rev, text=_("Revize a změny"))
    nb.add(t_lib, text=_("Firemní knihovna"))
    revize.build(app, t_rev)
    knihovna.build(app, t_lib)
    if pui.get("tab") in (0, 1):
        nb.select(pui["tab"])
    nb.bind("<<NotebookTabChanged>>", lambda _e: pui.update(tab=nb.index("current")))

    note_box(body, _(
        "Projdi kroky zleva doprava — návrh se průběžně ukládá a mezi kroky se "
        "můžeš kdykoli vracet a vstupy upřesňovat; výstupy se vždy přepočítají. "
        "Nejrychlejší start: popiš stroj v kroku AI návrh. Stávající stroj převezmeš "
        "z exportů PLC, I/O listů a schémat tlačítkem Načíst stávající zařízení. "
        "Pokud s PLC začínáš, otevři Nápovědu "
        "(tlačítko vpravo v liště kroků). Soubor projektu (.plcstudio.json) je "
        "zaměnitelný s exportem z webové verze PLCdesk."), pady=(16, 0))
