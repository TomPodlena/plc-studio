"""Krok 8 Generovat — záložka HMI: náhledy obrazovek, tagy, alarmy a exporty pro panely.

Vše počítá jádro (``hmi.ts`` / ``hmi_view.ts`` / ``hmi_export.ts``) přes most (``bridge_out.mjs``:
``hmi``, ``hmi.files``, ``hmi.web``). Náhled obrazovky je klikací jako schémata: prvek se
zařízením (data-dev) otevře vpravo panel zařízení s odkazy na I/O, schéma a program.
Web: ``apps/web/src/hmi_step.js``.
"""

from __future__ import annotations

import base64
import tkinter as tk
import webbrowser
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from .. import theme
from ..detail import DevicePanel
from ..i18n import N_, _, _n
from ..svgview import SvgView
from ..widgets import (FlowFrame, Table, file_prefix, note_box, save_file, save_many, scrolled_text,
                       set_text, wrap_label)

SUB_SCREENS, SUB_TAGS, SUB_ALARMS, SUB_EXPORT = range(4)
GROUPS = {"ctrl": N_("řízení stroje"), "dev": N_("blok zařízení"), "seq": N_("sekvence"),
          "ana": N_("analog"), "io": N_("signál I/O"), "par": N_("parametr")}
STATUS_FG = {"unverified": theme.WARN, "reference": theme.DIM, "stub": theme.ERR}


def trigger_text(tg: dict | None) -> str:
    if not tg:
        return ""
    v = "TRUE" if tg["kind"] == "bit" else "FALSE" if tg["kind"] == "bitOff" else str(tg.get("value"))
    return f"{tg['tag']} = {v}"


def save_bytes(app, name: str, data: bytes) -> bool:
    """Dialog „Uložit jako“ pro binární soubor (sešit .xlsx); nad limitem Free zamčeno (licence)."""
    from ..widgets import _initial_dir, license_filter
    if license_filter(app, name, data) is None:
        return False
    ext = name.rsplit(".", 1)[-1]
    path = filedialog.asksaveasfilename(
        parent=app.root, title=_("Uložit soubor"), initialfile=name,
        initialdir=_initial_dir(app, "hmi"), defaultextension="." + ext,
        filetypes=[("Excel", "*.xlsx"), (_("Všechny soubory"), "*.*")])
    if not path:
        return False
    try:
        Path(path).write_bytes(data)
    except OSError as exc:
        messagebox.showerror(_("Uložení se nezdařilo"), str(exc), parent=app.root)
        return False
    app.settings["last_dir"] = str(Path(path).parent)
    app.set_status(_("Uloženo: {path}", path=path))
    return True


def web_hmi_path(app) -> Path:
    """Soubor webového HMI ve složce aplikace (otevře se v prohlížeči)."""
    html = app.bridge.request("hmi.web", prj=app.prj)["html"]
    folder = Path(app.home) / "hmi"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / "hmi_web.html"
    path.write_text(html, encoding="utf-8")
    return path


def open_web_hmi(app) -> Path:
    path = web_hmi_path(app)
    webbrowser.open(path.as_uri())
    app.set_status(_("Webové HMI otevřeno v prohlížeči: {path}", path=path))
    return path


def render(app, parent) -> None:
    data = app.bridge.request("hmi", prj=app.prj)
    app.prj = data["prj"]
    ui = app.ui.setdefault("hmi", {})
    screens, tags, alarms = data["screens"], data["tags"], data["alarms"]

    top = ttk.Frame(parent)
    top.pack(fill="x")
    wrap_label(top, _("Návrh obsluhy z téhož modelu jako program: tagy ukazují na proměnné, "
                      "které program deklaruje, alarmy mají stejné kódy a texty jako seznam "
                      "alarmů. Návrh k revizi — neověřeno na cílovém HMI."))
    row = ttk.Frame(top)
    row.pack(fill="x", pady=(6, 8))
    for text in (_n(len(screens), N_("{n} obrazovka|{n} obrazovky|{n} obrazovek")),
                 _n(len(tags), N_("{n} tag|{n} tagy|{n} tagů")),
                 _n(len(alarms), N_("{n} alarm|{n} alarmy|{n} alarmů"))):
        tk.Label(row, text=text, bg=theme.TREE_SEL, fg=theme.PRIMARY, font=theme.FONT_DIM,
                 padx=8, pady=2).pack(side="left", padx=(0, 6))
    ttk.Button(row, text=_("Otevřít webové HMI"), style="Accent.TButton",
               command=lambda: open_web_hmi(app)).pack(side="left", padx=(10, 0))
    ttk.Button(row, text=_("Uložit webové HMI…"),
               command=lambda: save_file(app, "hmi_web.html",
                                         app.bridge.request("hmi.web", prj=app.prj)["html"], "hmi")
               ).pack(side="left", padx=(6, 0))

    note_box(parent, _("Dokument {file} a soubory HMI jsou i v kroku Dokumentace. Webové HMI "
                       "běží v prohlížeči v režimu demo; připojení k PLC přes bránu OPC UA / "
                       "WebSocket je kostra k doplnění.", file=data["file"]), side="bottom")

    nb = ttk.Notebook(parent)
    nb.pack(fill="both", expand=True)
    frames = []
    for title in (_("Obrazovky"), _n(len(tags), N_("{n} tag|{n} tagy|{n} tagů")),
                  _n(len(alarms), N_("{n} alarm|{n} alarmy|{n} alarmů")), _("Export pro panel")):
        f = ttk.Frame(nb, padding=8)
        nb.add(f, text=title)
        frames.append(f)
    _screens(app, frames[SUB_SCREENS], screens, ui)
    _tags(app, frames[SUB_TAGS], tags, ui)
    _alarms(frames[SUB_ALARMS], alarms)
    _export(app, frames[SUB_EXPORT], data, ui)
    nb.select(ui.get("sub", SUB_SCREENS))
    nb.bind("<<NotebookTabChanged>>", lambda _e: ui.update(sub=nb.index("current")))
    parent.hmi_notebook = nb          # testy


def _screens(app, parent, screens: list, ui: dict) -> None:
    if ui.get("screen", 0) >= len(screens):
        ui["screen"] = 0
    var = tk.IntVar(value=ui.get("screen", 0))
    parent._var = var
    tabs = FlowFrame(parent)                        # velký stroj = hodně obrazovek: zalamovat
    tabs.pack(fill="x", pady=(0, 6))
    for i, s in enumerate(screens):
        title = s["title"] + (f" {s['page']}/{s['pages']}" if s["pages"] > 1 else "")
        ttk.Radiobutton(tabs, text=title, value=i, variable=var, style="Tab.Toolbutton")
    tabs.schedule()
    bar = ttk.Frame(parent)
    bar.pack(side="bottom", fill="x", pady=(8, 0))
    ttk.Button(bar, text=_("Uložit SVG…"),
               command=lambda: save_file(app, f"hmi_{screens[var.get()]['id']}.svg",
                                         screens[var.get()]["raw"], "hmi")).pack(side="left")
    wrap_label(bar, _("Klik na motor, ventil, měření nebo řádek ručního režimu = zařízení vpravo."),
               side="left", padx=10, expand=True)
    terms = app.terminals()
    panel = DevicePanel(parent, app, terms, here="hmi",
                        empty=_("Klikni na prvek obrazovky se zařízením — zobrazí se jeho popis, "
                                "signály a kroky programu."))
    panel.pack(side="right", fill="y", padx=(12, 0))

    def click(meta: dict) -> None:
        if "dev" in meta:
            ui["dev"] = meta["dev"]
            panel.show(meta["dev"])
            view.refresh()

    view = SvgView(parent, on_click=click,
                   marker=lambda m: "sel" if ui.get("dev") is not None and m.get("dev") == ui.get("dev") else None)
    view.pack(fill="both", expand=True)
    parent.svg_view, parent.panel = view, panel       # testy

    def show(*_a) -> None:
        ui["screen"] = var.get()
        view.show(screens[var.get()]["svg"])

    var.trace_add("write", show)
    show()
    if app.dev_by_id(ui.get("dev")) is not None:
        panel.show(ui["dev"])
    else:
        ui["dev"] = None


def _plat_box(app, parent, ui: dict, key: str, on_change) -> tk.StringVar:
    """Výběr platformy (platformy projektu napřed); šířka z nejdelšího názvu."""
    plats = list(app.prj["platforms"]) + [k for k in app.PLAT if k not in app.prj["platforms"]]
    names = [app.PLAT[k]["name"] + ("" if k in app.prj["platforms"] else " · " + _("mimo projekt"))
             for k in plats]
    cur = ui.get(key) if ui.get(key) in plats else (app.prj["platforms"] or ["siemens"])[0]
    ui[key] = cur
    var = tk.StringVar(value=names[plats.index(cur)])
    box = ttk.Combobox(parent, textvariable=var, values=names, state="readonly",
                       width=max(len(n) for n in names) + 2)
    box._var = var

    def changed(_e=None) -> None:
        ui[key] = plats[box.current()]
        on_change(ui[key])

    box.bind("<<ComboboxSelected>>", changed)
    box.plats = plats
    return box


def _tags(app, parent, tags: list, ui: dict) -> None:
    row = ttk.Frame(parent)
    row.pack(fill="x", pady=(0, 6))
    ttk.Label(row, text=_("Cesta v PLC pro platformu"), style="Dim.TLabel").pack(side="left")
    tbl = Table(parent, [("name", _("Tag"), 170, False), ("type", _("Typ"), 60, False),
                         ("access", _("Přístup"), 90, False), ("group", _("Skupina"), 110, False),
                         ("dev", _("Zařízení"), 70, False), ("desc", _("Popis"), 260, True),
                         ("path", _("Cesta v PLC"), 220, True)], height=14, ellipsis=True)

    def fill(plat: str) -> None:
        tbl.clear()
        for i, t in enumerate(tags):
            acc = t["access"] + (" · " + (_("tlačítko") if t["cmd"] == "momentary" else _("přepínač"))
                                 if t.get("cmd") else "")
            tbl.add(i, (t["name"], t["type"], acc, _(GROUPS.get(t["group"], t["group"])), t.get("dev") or "",
                        t["desc"] + (f" [{t['unit']}]" if t.get("unit") else ""), t["paths"][plat]))

    box = _plat_box(app, row, ui, "tag_plat", fill)
    box.pack(side="left", padx=(8, 0))
    tbl.pack(fill="both", expand=True)
    fill(ui["tag_plat"])
    parent.table, parent.plat_box = tbl, box          # testy


def _alarms(parent, alarms: list) -> None:
    tbl = Table(parent, [("id", "#", 40, False), ("name", _("Alarm"), 150, False),
                         ("dev", _("Zařízení"), 70, False), ("text", _("Text"), 300, True),
                         ("cls", _("Třída"), 150, False), ("trig", _("Spouští"), 200, False),
                         ("ack", _("Kvitace"), 160, True)], height=14, ellipsis=True)
    tbl.tv.tag_configure("fault", foreground=theme.ERR)
    tbl.tv.tag_configure("stop", foreground=theme.WARN)
    for a in alarms:
        tbl.add(a["id"], (a["id"], a["name"], a["dev"], a["text"] + (" — " + a["cause"] if a.get("cause") else ""),
                          a["clsLabel"], trigger_text(a.get("trigger")), a["ack"]), tags=(a["cls"],))
    tbl.pack(fill="both", expand=True)
    parent.table = tbl


def _export(app, parent, data: dict, ui: dict) -> None:
    row = ttk.Frame(parent)
    row.pack(fill="x", pady=(0, 6))
    ttk.Label(row, text=_("Platforma exportu"), style="Dim.TLabel").pack(side="left")
    product = ttk.Label(row, text="", style="Section.TLabel")
    body = ttk.Frame(parent)
    state: dict = {}

    def build(plat: str) -> None:
        for w in body.winfo_children():
            w.destroy()
        spec = data["specs"].get(plat)
        res = app.bridge.request("hmi.files", prj=app.prj, plat=plat)
        files: dict = res["files"]
        state.update(plat=plat, files=files, xlsx=res.get("xlsx"), xlsx_name=res.get("xlsxName"))
        product.configure(text=_("HMI: {product}", product=spec["product"]) if spec else "")
        if not spec or not files:
            note_box(body, _("Pro tuto platformu PLCdesk export HMI nemá — panel navrhni v IDE "
                             "výrobce podle dokumentu {file} (tagy a alarmy), nebo použij webové HMI.",
                             file=data["file"]), warn=True)
            state["table"] = None
            return
        tbl = Table(body, [("name", _("Soubor"), 200, False), ("format", _("Formát"), 320, True),
                           ("status", _("Stav ověření"), 170, False), ("src", _("Zdroje formátu"), 110, False)],
                    height=6, ellipsis=True)
        for st, fg in STATUS_FG.items():
            tbl.tv.tag_configure(st, foreground=fg)
        specs = {f["name"]: f for f in spec["files"]}
        for name in files:
            f = specs.get(name) or {"format": "", "status": "unverified", "statusLabel": data["unverified"], "sources": []}
            tbl.add(name, (name, f["format"], f["statusLabel"], str(len(f["sources"])) if f["sources"] else "—"),
                    tags=(f["status"],))
        if state["xlsx"]:
            tbl.add(state["xlsx_name"], (state["xlsx_name"], _("sešit Excel s listy Hmi Tags, DiscreteAlarms "
                                                              "a AnalogAlarms pro import v TIA Portal"),
                                         data["unverified"], "—"), tags=("unverified",))
        tbl.pack(fill="x")
        btns = ttk.Frame(body)
        btns.pack(fill="x", pady=(6, 0))
        prev_frm, prev = scrolled_text(body, mono=True, readonly=True, height=10)

        def cur() -> str | None:
            return tbl.selected()

        def show(_e=None) -> None:
            n = cur()
            set_text(prev, files.get(n, _("Binární soubor — náhled není k dispozici.")) if n else "")

        def save_cur() -> None:
            n = cur()
            if not n:
                return
            if n == state.get("xlsx_name") and state["xlsx"]:
                save_bytes(app, n, base64.b64decode(state["xlsx"]))
            else:
                save_file(app, f"hmi_{plat}_{n}", files[n], "hmi")

        def save_all() -> None:
            if save_many(app, [(f"hmi_{plat}_{n}", b) for n, b in files.items()],
                         _("soubory exportu HMI"), "hmi") and state["xlsx"]:
                (Path(app.settings["last_dir"]) / (file_prefix(app) + state["xlsx_name"])).write_bytes(
                    base64.b64decode(state["xlsx"]))

        def open_src() -> None:
            n = cur()
            f = specs.get(n or "")
            if f and f["sources"]:
                for u in f["sources"]:
                    webbrowser.open(u)

        ttk.Button(btns, text=_("Uložit vybraný soubor…"), style="Accent.TButton", command=save_cur).pack(side="left")
        ttk.Button(btns, text=_("Uložit všechny soubory exportu…"), command=save_all).pack(side="left", padx=(6, 0))
        ttk.Button(btns, text=_("Otevřít zdroje formátu ↗"), command=open_src).pack(side="left", padx=(6, 0))
        note_box(body, _("Stav „neověřeno importem“: formát podle dokumentace a veřejných příkladů "
                         "výrobce, import v IDE zatím nikdo nevyzkoušel — první import zkontroluj "
                         "(postup v README_HMI.txt)."))
        prev_frm.pack(fill="both", expand=True, pady=(8, 0))
        tbl.tv.bind("<<TreeviewSelect>>", show)
        tbl.select(next(iter(files)))
        show()
        state["table"], state["preview"] = tbl, prev

    box = _plat_box(app, row, ui, "exp_plat", build)
    box.pack(side="left", padx=(8, 0))
    product.pack(side="left", padx=(12, 0))
    body.pack(fill="both", expand=True)
    build(ui["exp_plat"])
    parent.state, parent.plat_box = state, box        # testy
