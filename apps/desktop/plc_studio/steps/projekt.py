"""Krok 1 — Projekt: název, číslo, zákazník, datum zahájení, popis, složka dat projektu,
otevření / uložení návrhu a příklady ze složky samples/."""

from __future__ import annotations

import json
from pathlib import Path

import tkinter as tk
from tkinter import messagebox, ttk

from .. import datadir, theme
from ..i18n import _, get_lang
from ..project import parse_num
from ..widgets import card, field, note_box, tooltip


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

    meta = p["meta"]
    var_name = tk.StringVar(value=meta["name"])
    var_number = tk.StringVar(value=meta.get("number") or "")
    var_customer = tk.StringVar(value=meta.get("customer") or "")
    takt = meta.get("takt")
    var_takt = tk.StringVar(value=f"{takt:g}" if takt else "")
    field(grid, _("Název projektu / stroje (např. Temperační stanice TS-02)"),
          lambda b: ttk.Entry(b, textvariable=var_name), col=0)
    field(grid, _("Číslo projektu (RRNNNN: rok a pořadí, např. 260705)"),
          lambda b: ttk.Entry(b, textvariable=var_number), col=1)
    field(grid, _("Požadovaný takt [s] (ověří simulace)"),
          lambda b: ttk.Entry(b, textvariable=var_takt), col=2)
    field(grid, _("Zákazník"), lambda b: ttk.Entry(b, textvariable=var_customer), row=1, col=0)
    date_box = field(grid, _("Datum zahájení projektu"), lambda b: ttk.Frame(b), row=1, col=1)
    _date_field(app, date_box)
    # proměnné drží pole naživu (bez reference je uklidí GC a pole zbělá)
    grid._vars = (var_name, var_number, var_customer, var_takt)
    # tvar čísla RRNNNN (core projectNumberProblem): jiný tvar jen varuje, číslo se použije, jak je
    num_warn = ttk.Label(body, text="", style="Err.TLabel", wraplength=900, justify="left")

    def check_number() -> None:
        try:
            msg = app.core("projectNumberProblem", var_number.get())
        except Exception:                              # noqa: BLE001 — bez mostu
            msg = ""
        num_warn.configure(text=("⚠ " + msg) if msg else "")
        if msg:
            num_warn.pack(anchor="w", pady=(0, 6), after=grid)
        else:
            num_warn.pack_forget()
        app.ui.setdefault("projekt", {})["number_warning"] = msg      # testy

    check_number()

    def refresh_folder() -> None:
        f = app.ui.get("projekt", {}).get("refresh_folder")
        if f:
            f()

    # popis: víc řádků a odstavců (do dokumentace jdou jako odstavce Markdownu)
    dbox = ttk.Frame(body)
    dbox.pack(fill="x", pady=(0, 4))
    ttk.Label(dbox, text=_("Popis (co stroj dělá, pro koho) — víc řádků a odstavců jde do dokumentace"),
              style="Dim.TLabel").pack(anchor="w")
    dfrm = ttk.Frame(dbox)
    dfrm.pack(fill="x", pady=(2, 0))
    dfrm.columnconfigure(0, weight=1)
    desc = theme.text_widget(dfrm, height=4, undo=True)
    ys = ttk.Scrollbar(dfrm, orient="vertical", command=desc.yview)
    desc.configure(yscrollcommand=ys.set)
    desc.grid(row=0, column=0, sticky="ew")
    ys.grid(row=0, column=1, sticky="ns")
    desc.insert("1.0", meta.get("desc") or "")
    desc.edit_modified(False)
    desc.edit_reset()

    def on_desc(_e=None) -> None:
        """Změna textu (i při opuštění pole): popis do projektu, uložení se sloučí (app.save)."""
        if not desc.winfo_exists():
            return
        text = desc.get("1.0", "end-1c")
        if text != app.prj["meta"].get("desc", ""):
            app.prj["meta"]["desc"] = text
            app.save()
        desc.edit_modified(False)

    desc.bind("<<Modified>>", lambda _e: desc.edit_modified() and on_desc())
    desc.bind("<FocusOut>", on_desc)
    app.ui.setdefault("projekt", {})["desc_widget"] = desc          # testy

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
        refresh_folder()

    def on_ref(key: str, var: tk.StringVar):
        def cb(*_a):
            v = var.get()
            if v.strip():
                app.prj["meta"][key] = v
            else:
                app.prj["meta"].pop(key, None)       # prázdné pole se neukládá (výstup beze změny)
            app.save()
            app.update_title()
            if key == "number":
                check_number()
                refresh_folder()
        return cb

    var_name.trace_add("write", on_name)
    var_number.trace_add("write", on_ref("number", var_number))
    var_customer.trace_add("write", on_ref("customer", var_customer))

    def reset() -> None:
        if messagebox.askyesno(_("Nový projekt"), _("Zahodit aktuální návrh a začít s prázdným "
                                                    "projektem?"), parent=app.root):
            app.reset_project()

    row = ttk.Frame(body)
    row.pack(fill="x", pady=(4, 0))
    ttk.Button(row, text=_("Otevřít projekt (JSON)…"), command=app.open_project_dialog
               ).pack(side="left")
    ttk.Button(row, text=_("Uložit projekt (JSON)…"), command=app.save_project_dialog
               ).pack(side="left", padx=(6, 0))
    ttk.Button(row, text=_("Kopírovat JSON"), command=lambda: app.copy(app.project_payload())
               ).pack(side="left", padx=(6, 0))
    ttk.Button(row, text=_("Nový prázdný projekt"), style="Danger.TButton", command=reset
               ).pack(side="left", padx=(18, 0))

    _data_dir_row(app, body)

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
    app.deferred(t_rev, lambda: revize.build(app, t_rev))
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


# --- datum zahájení projektu ---------------------------------------------------------------

def _date_field(app, box) -> None:
    """Pole data (zápis podle jazyka okna nebo ISO; kontrola formátu jádrem) + výběr z kalendáře.
    V projektu se ukládá ISO YYYY-MM-DD (``meta.startDate``)."""
    iso = app.prj["meta"].get("startDate") or ""
    shown = app.core("formatIsoDate", iso) if iso else ""
    var = tk.StringVar(value=shown)
    ent = ttk.Entry(box, textvariable=var, width=14)
    ent.pack(side="left")
    ent._var = var
    msg = ttk.Label(box, text="", style="Err.TLabel")

    def commit(_e=None) -> None:
        text = var.get().strip()
        meta = app.prj["meta"]
        if not text:
            if meta.pop("startDate", None) is not None:
                app.save()
            msg.pack_forget()
            return
        val = app.core("parseUserDate", text)
        if not val:
            msg.configure(text=_("Neplatné datum — např. {example}",
                                 example=app.core("formatIsoDate", "2026-10-08")))
            msg.pack(side="left", padx=(8, 0))
            return
        msg.pack_forget()
        var.set(app.core("formatIsoDate", val))
        if meta.get("startDate") != val:
            meta["startDate"] = val
            app.save()

    ent.bind("<FocusOut>", commit)
    ent.bind("<Return>", commit)

    def pick() -> None:
        def chosen(val: str) -> None:
            var.set(app.core("formatIsoDate", val) if val else "")
            commit()
        open_calendar(app, ent, app.prj["meta"].get("startDate") or "", chosen)

    btn = ttk.Button(box, text="…", width=3, command=pick)
    btn.pack(side="left", padx=(4, 0))
    tooltip(btn, _("Vybrat datum v kalendáři"))
    app.ui.setdefault("projekt", {})["date_entry"] = (ent, commit)      # testy


def open_calendar(app, anchor, iso: str, on_pick) -> tk.Toplevel:
    """Malý kalendář (měsíc, dny od pondělí; názvy podle jazyka z jádra) — bez dalších závislostí."""
    import calendar
    import datetime as dt
    labels = app.core("calendarLabels")
    today = dt.date.today()
    try:
        cur = dt.date.fromisoformat(iso) if iso else today
    except ValueError:
        cur = today
    state = {"y": cur.year, "m": cur.month}
    win = tk.Toplevel(app.root)
    win.title(_("Datum zahájení projektu"))
    win.transient(app.root)
    win.resizable(False, False)
    win.geometry(f"+{anchor.winfo_rootx()}+{anchor.winfo_rooty() + anchor.winfo_height() + 2}")
    frm = ttk.Frame(win, padding=8)
    frm.pack(fill="both", expand=True)
    head = ttk.Frame(frm)
    head.pack(fill="x")
    title = ttk.Label(head, text="", anchor="center", style="Section.TLabel")
    days = ttk.Frame(frm)
    days.pack(pady=(6, 0))

    def pick(day: dt.date | None) -> None:
        win.destroy()
        on_pick(day.isoformat() if day else "")

    def draw() -> None:
        for w in days.winfo_children():
            w.destroy()
        title.configure(text=f"{labels['months'][state['m'] - 1]} {state['y']}")
        for i, wd in enumerate(labels["weekdays"]):
            ttk.Label(days, text=wd, style="Dim.TLabel", anchor="center", width=4).grid(row=0, column=i)
        for r, week in enumerate(calendar.Calendar(0).monthdatescalendar(state["y"], state["m"]), start=1):
            for c, day in enumerate(week):
                if day.month != state["m"]:
                    continue
                style = "Accent.TButton" if day.isoformat() == iso else "TButton"
                ttk.Button(days, text=str(day.day), width=3, style=style,
                           command=lambda d=day: pick(d)).grid(row=r, column=c, padx=1, pady=1)

    def shift(n: int) -> None:
        m = state["m"] - 1 + n
        state["y"] += m // 12
        state["m"] = m % 12 + 1
        draw()

    ttk.Button(head, text="‹", width=3, command=lambda: shift(-1)).pack(side="left")
    ttk.Button(head, text="›", width=3, command=lambda: shift(1)).pack(side="right")
    title.pack(side="left", fill="x", expand=True)
    foot = ttk.Frame(frm)
    foot.pack(fill="x", pady=(6, 0))
    ttk.Button(foot, text=_("Dnes"), command=lambda: pick(today)).pack(side="left")
    ttk.Button(foot, text=_("Bez data"), command=lambda: pick(None)).pack(side="left", padx=(6, 0))
    ttk.Button(foot, text=_("Zavřít"), command=win.destroy).pack(side="right")
    win.bind("<Escape>", lambda _e: win.destroy())
    draw()
    win.focus_set()
    return win


# --- složka dat projektu -------------------------------------------------------------------

def _data_dir_row(app, body) -> None:
    """Kořenový adresář projektů (nastavení aplikace), volitelný vlastní kořen projektu a projektová
    složka ``<kořen>\\<číslo>_<Název>`` + „Uložit vše do složky projektu“ (jen desktop, datadir.py).

    Tlačítko je tady (ne v kroku Generovat / Dokumentace): ukládá výstupy všech kroků — kód všech
    platforem, dokumentaci, výkresy, kusovník, HMI, exporty i projekt — a patří k nastavení složky.
    Stejné tlačítko má i krok Dokumentace (tam, kde je celá sada vidět)."""
    box = ttk.Frame(body)
    box.pack(fill="x", pady=(10, 0))
    box.columnconfigure(1, weight=1)

    def path_row(row: int, label: str, value: str, on_commit, on_choose) -> None:
        ttk.Label(box, text=label).grid(row=row, column=0, sticky="w", pady=2)
        var = tk.StringVar(value=value)
        ent = ttk.Entry(box, textvariable=var)
        ent.grid(row=row, column=1, sticky="ew", padx=(8, 4), pady=2)
        ent._var = var                         # držet proměnnou naživu (GC)

        def commit(_e=None) -> None:
            on_commit(var.get().strip())

        ent.bind("<FocusOut>", commit)
        ent.bind("<Return>", commit)
        ttk.Button(box, text=_("Vybrat…"), command=on_choose).grid(row=row, column=2, sticky="w", pady=2)

    def set_root(v: str) -> None:
        if v != datadir.settings_root(app):
            datadir.set_root(app, v)
            app.render()

    def set_own(v: str) -> None:
        if v != datadir.own_root(app):
            datadir.set_own_root(app, v)
            app.render()

    def choose(own: bool = False) -> None:
        if datadir.choose(app, own=own):
            app.render()

    path_row(0, _("Kořenový adresář projektů:"), datadir.settings_root(app), set_root, lambda: choose())
    path_row(1, _("Vlastní kořen tohoto projektu (přepíše):"), datadir.own_root(app), set_own,
             lambda: choose(own=True))

    raw = datadir.raw_root(app)
    root = datadir.existing_root(app)
    prow = ttk.Frame(body)
    prow.pack(fill="x", pady=(6, 0))
    ttk.Label(prow, text=_("Projektová složka:")).pack(side="left")
    def folder_text() -> str:
        return str(root / datadir.folder_name(app)) if root else (
            (raw.rstrip("\\/") + "\\" if raw else "…\\") + datadir.folder_name(app))

    shown = folder_text()
    lbl = ttk.Label(prow, text=shown, style="Section.TLabel")
    lbl.pack(side="left", padx=(8, 8))

    def refresh() -> None:
        """Po změně čísla / názvu: cesta projektové složky (bez překreslení kroku — fokus zůstane)."""
        if lbl.winfo_exists():
            t = folder_text()
            lbl.configure(text=t)
            app.ui.setdefault("projekt", {})["folder_label"] = t

    app.ui.setdefault("projekt", {})["refresh_folder"] = refresh
    ttk.Button(prow, text=_("Uložit vše do složky projektu"), style="Accent.TButton",
               command=lambda: datadir.save_all(app)).pack(side="left")
    pdir = datadir.project_dir(app)
    if pdir is not None and pdir.is_dir():
        ttk.Button(prow, text=_("Otevřít složku"), command=lambda: datadir.open_folder(pdir)
                   ).pack(side="left", padx=(6, 0))
    app.ui.setdefault("projekt", {})["folder_label"] = shown          # testy
    if raw and root is None:
        warn = ttk.Frame(body)
        warn.pack(fill="x", pady=(4, 0))
        ttk.Label(warn, text="⚠ " + _("Kořenový adresář {path} na tomto počítači neexistuje — dialogy "
                                      "začnou v naposledy použité složce. Vyber jiný, nebo ho vytvoří "
                                      "„Uložit vše do složky projektu“ (po potvrzení).", path=raw),
                  style="Err.TLabel", wraplength=900, justify="left").pack(side="left")
        ttk.Button(warn, text=_("Vybrat jiný…"), command=lambda: choose(own=bool(datadir.own_root(app)))
                   ).pack(side="left", padx=(8, 0))
    elif not raw:
        ttk.Label(body, text=_("Výstupy pak půjdou do projektové složky <číslo>_<Název> s podsložkami "
                               "01_Dokumentace, 02_Vykresy, 03_Program_PLC … 99_Interni a s číslem "
                               "projektu na začátku názvu každého souboru; dialogy Uložit v nich začínají."),
                  style="Dim.TLabel", wraplength=900, justify="left").pack(anchor="w", pady=(2, 0))
