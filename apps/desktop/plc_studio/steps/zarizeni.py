"""Krok 4 — Návrh zařízení stroje (+ vedlejší volba Import existujícího projektu)."""

from __future__ import annotations

import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from .. import theme
from ..detail import DevicePanel
from ..widgets import (Table, card, field, note_box, read_text_file, scrolled_text,
                       wrap_label)

DEFAULT_ON = ("fbk", "fbkOpen")  # volby zapnuté už při založení zařízení


def _opts_text(app, d: dict) -> str:
    cls = app.CLS[d["cls"]]
    txt = ", ".join(cls["opts"].get(k, k) for k, v in (d.get("opt") or {}).items() if v)
    if d["cls"].startswith("Analog"):
        unit = f" {d['unit']}" if d.get("unit") else ""
        txt = f"{txt}{unit} {d['rmin']:g}–{d['rmax']:g}".strip()
    return txt or "—"


def _num(value: str, default: float) -> float:
    try:
        return float(value.replace(",", "."))
    except ValueError:
        return default


def render(app, parent) -> None:
    terms = app.terminals()          # srovná I/O se zařízeními a vrátí svorky signálů
    p = app.prj
    labels = {v["label"]: k for k, v in app.CLS.items()}
    body = card(parent, "04", "Návrh zařízení stroje")

    # --- formulář nového zařízení ---
    form = ttk.Frame(body)
    form.pack(fill="x")
    for c in (0, 1, 2):
        form.columnconfigure(c, weight=(1, 1, 2)[c])
    var_cls = tk.StringVar(value=app.CLS["Motor"]["label"])
    var_name = tk.StringVar(value=app.core("nextName", p, "Motor"))
    var_desc = tk.StringVar()
    field(form, "Třída", lambda b: ttk.Combobox(b, textvariable=var_cls, state="readonly",
                                                 values=list(labels)), col=0)
    field(form, "Označení", lambda b: ttk.Entry(b, textvariable=var_name), col=1)
    ent_desc = field(form, "Popis (např. Čerpadlo hydrauliky)",
                     lambda b: ttk.Entry(b, textvariable=var_desc), col=2)

    opt_row = ttk.Frame(body)
    opt_row.pack(fill="x")
    opt_vars: dict[str, tk.BooleanVar] = {}
    var_unit, var_min, var_max = tk.StringVar(), tk.StringVar(value="0"), tk.StringVar(value="100")

    def render_opts() -> None:
        for w in opt_row.winfo_children():
            w.destroy()
        opt_vars.clear()
        key = labels[var_cls.get()]
        for ok, olabel in app.CLS[key]["opts"].items():
            opt_vars[ok] = tk.BooleanVar(value=ok in DEFAULT_ON)
            ttk.Checkbutton(opt_row, text=olabel, variable=opt_vars[ok]).pack(side="left", padx=(0, 14))
        if key.startswith("Analog"):
            ttk.Label(opt_row, text="jednotka").pack(side="left")
            ttk.Entry(opt_row, textvariable=var_unit, width=8).pack(side="left", padx=(6, 14))
            ttk.Label(opt_row, text="rozsah").pack(side="left")
            ttk.Entry(opt_row, textvariable=var_min, width=8).pack(side="left", padx=6)
            ttk.Label(opt_row, text="až").pack(side="left")
            ttk.Entry(opt_row, textvariable=var_max, width=8).pack(side="left", padx=6)
        elif not opt_vars:
            ttk.Label(opt_row, text="— bez voleb", style="Dim.TLabel").pack(side="left")

    def on_cls(_e=None) -> None:
        var_name.set(app.core("nextName", app.prj, labels[var_cls.get()]))
        render_opts()

    var_cls.trace_add("write", lambda *_: on_cls())
    render_opts()

    def add() -> None:
        prj = app.prj
        key = labels[var_cls.get()]
        analog = key.startswith("Analog")
        prj["devices"].append({
            "id": prj["nextId"],
            "name": var_name.get().strip() or app.core("nextName", prj, key),
            "cls": key, "desc": var_desc.get().strip(),
            "opt": {k: v.get() for k, v in opt_vars.items()},
            "unit": var_unit.get().strip() if analog else "",
            "rmin": _num(var_min.get(), 0) if analog else 0,
            "rmax": _num(var_max.get(), 100) if analog else 100,
        })
        prj["nextId"] += 1
        app.sync()
        app.save()
        app.ui["dev_cls"] = var_cls.get()
        app.render()

    add_row = ttk.Frame(body)
    add_row.pack(fill="x", pady=(8, 10))
    ttk.Button(add_row, text="Přidat zařízení", style="Accent.TButton", command=add).pack(side="left")
    ent_desc.bind("<Return>", lambda _e: add())
    if app.ui.get("dev_cls") in labels:      # po přidání zůstaň u stejné třídy
        var_cls.set(app.ui["dev_cls"])

    # --- spodní část (pack zdola, ať tabulku nevytlačí) ---
    note_box(body, "Třídy Motor / Ventil / Analog dostanou hotový funkční blok (stavový automat, "
             "timeouty, status). Třídy DI/DO jsou volné signály pro vlastní logiku. "
             "Popis upravíš dvojklikem do buňky.", side="bottom")
    tools = ttk.Frame(body)
    tools.pack(side="bottom", fill="x", pady=(6, 0))

    # --- seznam zařízení ---
    def edit(iid: str, _key: str, value: str) -> None:
        d = app.dev_by_id(int(iid)) if iid.isdigit() else None
        if d is not None:
            d["desc"] = value.strip()
            app.sync()
            app.save()
            tbl.tv.set(iid, "desc", d["desc"])
            if panel.dev_id == d["id"]:
                panel.show(d["id"])

    def delete(_e=None) -> None:
        iid = tbl.selected()
        if iid is None or not iid.isdigit():
            app.set_status("Nejdřív vyber zařízení v tabulce.")
            return
        prj = app.prj
        prj["devices"] = [d for d in prj["devices"] if d["id"] != int(iid)]
        ids = {d["id"] for d in prj["devices"]}
        prog = prj["program"]
        prog["seq"] = [s for s in prog["seq"] if s["act"] == "wait" or s["dev"] in ids]
        if prog["estop"] and prog["estop"] not in ids:
            prog["estop"] = ""
        app.sync()
        app.save()
        app.render()

    if not p["devices"]:
        wrap_label(body, "Zatím žádná zařízení — přidej je výše, načti ukázku v kroku Projekt, "
                   "nech si je navrhnout v kroku AI návrh, nebo použij Import vpravo dole.",
                   pady=(0, 6))
    mid = ttk.Frame(body)
    mid.pack(fill="both", expand=True)
    panel = DevicePanel(mid, app, terms, here="zarizeni",
                        empty="Vyber zařízení v tabulce — zobrazí se jeho vstupy a výstupy "
                              "s odkazy do kroku I/O, na list zapojení a do programu.")
    panel.pack(side="right", fill="y", padx=(12, 0))
    tbl = Table(mid, [("name", "Označení", 80, False), ("cls", "Třída", 170, False),
                      ("desc", "Popis", 260, True), ("opt", "Volby", 200, True)],
                height=8, editable=("desc",), on_edit=edit)
    tbl.pack(side="left", fill="both", expand=True)
    for d in p["devices"]:
        tbl.add(d["id"], (d["name"], app.CLS[d["cls"]]["label"], d["desc"], _opts_text(app, d)))
    tbl.tv.bind("<Delete>", delete)

    def on_select(_e=None) -> None:
        iid = tbl.selected()
        if iid is not None and iid.isdigit():
            app.ui["dev_sel"] = int(iid)
            panel.show(int(iid))

    tbl.tv.bind("<<TreeviewSelect>>", on_select)
    if app.dev_by_id(app.ui.get("dev_sel")) is not None:
        tbl.select(app.ui["dev_sel"])
        panel.show(app.ui["dev_sel"])

    ttk.Button(tools, text="Odstranit vybrané", style="Danger.TButton", command=delete
               ).pack(side="left")
    ttk.Label(tools, text=f"zařízení: {len(p['devices'])}", style="Dim.TLabel"
              ).pack(side="left", padx=10)
    ttk.Button(tools, text="Import existujícího projektu…",
               command=lambda: ImportDialog(app)).pack(side="right")


class ImportDialog:
    """Vedlejší volba: reverse engineering existujícího projektu z exportů."""

    def __init__(self, app):
        self.app = app
        self.built: dict | None = None
        win = self.win = tk.Toplevel(app.root)
        theme.setup_window(win, "Import existujícího projektu",
                           topmost=bool(app.settings.get("topmost")))
        win.transient(app.root)
        win.geometry("860x680")
        win.minsize(700, 520)
        frm = ttk.Frame(win)
        frm.pack(fill="both", expand=True, padx=16, pady=14)

        ttk.Label(frm, text="Import existujícího projektu (reverse engineering)",
                  style="Header.TLabel").pack(anchor="w")
        wrap_label(frm, "Vlož export z existujícího projektu a PLC Studio z něj zpětně sestaví "
                   "zařízení a I/O — klidně pro migraci na jinou platformu. Formáty se poznají "
                   "automaticky: SimaticML XML, Rockwell L5X/CSV, GVL/ST, tabulky labelů "
                   "(CSV/tab), prostý I/O list  Tag;Adresa;Zařízení;Třída;Komentář.",
                   pady=(2, 8))

        row = ttk.Frame(frm)
        row.pack(fill="x")
        ttk.Button(row, text="Načíst soubory…", command=self._pick).pack(side="left")
        ttk.Button(row, text="Analyzovat", style="Accent.TButton", command=self._analyze
                   ).pack(side="left", padx=(6, 0))
        ttk.Label(row, text="Analýza nic nepřepíše — nejdřív uvidíš náhled.",
                  style="Dim.TLabel").pack(side="left", padx=10)

        # zdola: varování, tlačítka, náhled
        note_box(frm, "Co se přenese: tagy, adresy, komentáře, odhad zařízení a tříd. "
                 "Co ne: logika bloků (jen inventář), HW konfigurace, safety a komunikace — "
                 "logiku generuje PLC Studio znovu ze šablon.", warn=True, side="bottom")
        btns = ttk.Frame(frm)
        btns.pack(side="bottom", fill="x", pady=(8, 0))
        self.b_apply = ttk.Button(btns, text="Převzít do návrhu (nahradí současná zařízení)",
                                  style="Accent.TButton", command=self._apply)
        self.b_apply.pack(side="left")
        self.b_apply.state(["disabled"])
        ttk.Button(btns, text="Zavřít", command=win.destroy).pack(side="right")

        self.tbl = Table(frm, [("name", "Zařízení", 100, False), ("cls", "Třída", 110, False),
                               ("tags", "Tagy", 520, True)], height=7)
        self.tbl.pack(side="bottom", fill="x", pady=(4, 0))
        self.info = ttk.Label(frm, text="", style="Dim.TLabel", justify="left")
        self.info.pack(side="bottom", anchor="w", pady=(8, 0))
        self.info.bind("<Configure>", lambda e: self.info.configure(wraplength=max(200, e.width)))

        t_frm, self.txt = scrolled_text(frm, mono=True, height=8)
        t_frm.pack(fill="both", expand=True, pady=(8, 0))
        win.grab_set()

    def _pick(self) -> None:
        paths = filedialog.askopenfilenames(
            parent=self.win, title="Exporty z PLC projektu",
            initialdir=self.app.settings.get("last_dir") or None,
            filetypes=[("Exporty PLC", "*.xml *.l5x *.csv *.tsv *.txt *.st *.scl *.gvl *.TcGVL"),
                       ("Všechny soubory", "*.*")])
        if not paths:
            return
        chunks = []
        for path in paths:
            try:
                chunks.append(read_text_file(path))
            except OSError as exc:
                messagebox.showerror("Soubor nejde načíst", f"{path}\n{exc}", parent=self.win)
        self.txt.delete("1.0", "end")
        self.txt.insert("1.0", "\n".join(chunks))

    def _analyze(self) -> None:
        data = self.app.bridge.request("import", text=self.txt.get("1.0", "end-1c"))
        res, built = data["res"], data["built"]
        self.tbl.clear()
        self.built = None
        self.b_apply.state(["disabled"])
        if not res["tags"] and not res["blocks"]:
            self.info.configure(style="Err.TLabel", text="Formát se nepodařilo rozpoznat "
                                "nebo neobsahuje žádné tagy.")
            return
        text = (f"Rozpoznaný formát: {res['fmt']} · {len(res['tags'])} tagů · "
                f"{len(built['devices'])} zařízení")
        if res["blocks"]:
            more = " …" if len(res["blocks"]) > 12 else ""
            text += "\nNalezené bloky (jen inventář): " + ", ".join(res["blocks"][:12]) + more
        self.info.configure(style="Ok.TLabel", text=text)
        for d in built["devices"]:
            tags = ", ".join(e["tag"] for e in built["io"] if e["devId"] == d["id"])
            self.tbl.add(d["id"], (d["name"], d["cls"], tags))
        if built["devices"]:
            self.built = built
            self.b_apply.state(["!disabled"])

    def _apply(self) -> None:
        app, built = self.app, self.built
        if not built or not app.confirm_replace("Import"):
            return
        prj = app.prj
        prj["devices"], prj["io"], prj["nextId"] = built["devices"], built["io"], built["nextId"]
        # zařízení jsou nová (id od 1) — stará sekvence a E-stop by mířily jinam
        prj["program"]["seq"], prj["program"]["estop"] = [], ""
        app.prj = app.bridge.mutate("autoAddr", prj, False)
        app.save()
        self.win.destroy()
        app.render()
        app.set_status(f"Import převzat: {len(built['devices'])} zařízení.")
