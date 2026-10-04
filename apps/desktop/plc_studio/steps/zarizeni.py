"""Krok 4 — Návrh zařízení stroje (+ vedlejší volba Import stávajícího zařízení)."""

from __future__ import annotations

import tkinter as tk
from tkinter import ttk

from .. import theme
from ..detail import DevicePanel
from ..i18n import N_, _
from ..project import parse_num
from ..widgets import Table, card, field, note_box, wrap_label

DEFAULT_ON = ("fbk", "fbkOpen")  # volby zapnuté už při založení zařízení
RANGE_CLS = ("AnalogIn", "AnalogOut", "Vfd", "PropValve")   # třídy s rozsahem a jednotkou
MOTION_CLS = ("Vfd", "PosDrive", "PropValve")              # pohony fáze 2a (přes běžné I/O)


def _opts_text(app, d: dict) -> str:
    cls = app.CLS[d["cls"]]
    txt = ", ".join(cls["opts"].get(k, k) for k, v in (d.get("opt") or {}).items() if v)
    if d["cls"] in RANGE_CLS:
        unit = f" {d['unit']}" if d.get("unit") else ""
        txt = f"{txt}{unit} {d['rmin']:g}–{d['rmax']:g}".strip()
    extra = []
    if d.get("limLo") is not None:
        extra.append(_("min {v}", v=f"{d['limLo']:g}"))
    if d.get("limHi") is not None:
        extra.append(_("max {v}", v=f"{d['limHi']:g}"))
    if d.get("setpoint") is not None:
        extra.append(_("žádaná {v}", v=f"{d['setpoint']:g}"))
    if d.get("role"):
        extra.append(app.DO_ROLES.get(d["role"], d["role"]))
    if d["cls"] in ("Vfd", "PropValve") and (d.get("rampS") or 0) > 0:
        extra.append(_("rampa {t} s", t=f"{d['rampS']:g}"))
    if d["cls"] == "PropValve" and d.get("tol") is not None:
        extra.append(_("tolerance ± {v}", v=f"{d['tol']:g}"))
    if d["cls"] == "PosDrive":
        extra.append(_("záznamy 1–{max}", max=(1 << int(d.get("selBits") or 3)) - 1))
    if extra:
        txt = (txt + " · " if txt else "") + ", ".join(extra)
    return txt or "—"


PARAM_LABEL = {"limLo": N_("mez min"), "limHi": N_("mez max"), "setpoint": N_("žádaná hodnota"),
               "rampS": N_("rampa [s]"), "tol": N_("tolerance ±"), "tolTimeS": N_("doba odchylky [s]"),
               "selBits": N_("bity výběru záznamu"), "travelS": N_("doba jízdy (model) [s]")}


def _opt_num(value: str, key: str = ""):
    """Volitelné číslo z pole (prázdné = nezadáno); neplatné → ``ValueError`` s popiskem pole."""
    if not value.strip():
        return None
    v = parse_num(value)
    if v is None:
        raise ValueError(_(PARAM_LABEL.get(key, key)))
    return v


def param_fields(app, parent, cls: str, d: dict | None = None) -> dict:
    """Pole pro meze (AnalogIn), žádanou hodnotu (AnalogOut) a roli výstupu (DO).
    Vrací proměnné; `read(vars)` z nich udělá slovník parametrů."""
    out: dict = {}
    d = d or {}

    def num_field(key: str, label: str) -> None:
        ttk.Label(parent, text=label).pack(side="left")
        var = tk.StringVar(value="" if d.get(key) is None else f"{d[key]:g}")
        ttk.Entry(parent, textvariable=var, width=8).pack(side="left", padx=(6, 14))
        out[key] = var

    if cls == "AnalogIn":
        num_field("limLo", _(PARAM_LABEL["limLo"]))
        num_field("limHi", _(PARAM_LABEL["limHi"]))
    elif cls == "AnalogOut":
        num_field("setpoint", _(PARAM_LABEL["setpoint"]))
    elif cls in ("Vfd", "PropValve"):
        # pohony fáze 2a: výchozí žádaná, rampa v PLC, u ventilu tolerance a doba odchylky
        for key in ("setpoint", "rampS") + (("tol", "tolTimeS") if cls == "PropValve" else ()):
            num_field(key, _(PARAM_LABEL[key]))
    elif cls == "PosDrive":
        num_field("selBits", _(PARAM_LABEL["selBits"]))
        num_field("travelS", _(PARAM_LABEL["travelS"]))
        ttk.Label(parent, text=_("záznamy")).pack(side="left")
        rec_var = tk.StringVar(value=app.core("recordsText", d.get("records") or []))
        ent = ttk.Entry(parent, textvariable=rec_var, width=34)
        ent.pack(side="left", padx=(6, 14))
        out["records"] = rec_var
        out["_app"] = app
    elif cls == "DO":
        ttk.Label(parent, text=_("vazba na stav stroje")).pack(side="left")
        keys = ["", *app.DO_ROLES]
        names = [_("— bez vazby —"), *app.DO_ROLES.values()]
        cb = ttk.Combobox(parent, values=names, state="readonly", width=max(len(n) for n in names) + 1)
        cb.current(keys.index(d.get("role") or "") if (d.get("role") or "") in keys else 0)
        cb.pack(side="left", padx=(6, 14))
        out["role"] = (cb, keys)
    return out


def read_params(vars_: dict) -> dict:
    """Parametry z polí; neplatné číslo nebo min ≥ max → ``ValueError`` (text pro uživatele)."""
    res: dict = {}
    for key, v in vars_.items():
        if key == "_app":
            continue
        if key == "records":         # „1 = převzetí @ 0; 2 = lis @ 180“ → tabulka záznamů
            res["records"] = vars_["_app"].core("parseRecords", v.get())
            continue
        if key == "role":
            cb, keys = v
            res["role"] = keys[max(cb.current(), 0)] or None
        else:
            try:
                res[key] = _opt_num(v.get(), key)
            except ValueError as exc:
                raise ValueError(_("Neplatné číslo v poli „{field}“.", field=exc)) from exc
    if res.get("limLo") is not None and res.get("limHi") is not None \
            and res["limLo"] >= res["limHi"]:
        raise ValueError(_("Mez min musí být menší než mez max."))
    if res.get("selBits") is not None:
        res["selBits"] = min(6, max(1, int(round(res["selBits"]))))
    if res.get("rampS") is not None and res["rampS"] < 0:
        raise ValueError(_("Rampa musí být 0 (bez rampy) nebo kladný čas v sekundách."))
    return res


def apply_params(d: dict, params: dict) -> None:
    for key, v in params.items():
        if v is None:
            d.pop(key, None)
        else:
            d[key] = v


def _num(value: str, default: float) -> float:
    v = parse_num(value)
    return default if v is None else v


def render(app, parent) -> None:
    terms = app.terminals()          # srovná I/O se zařízeními a vrátí svorky signálů
    p = app.prj
    labels = {v["label"]: k for k, v in app.CLS.items()}
    body = card(parent, "04", _("Návrh zařízení stroje"))

    # --- formulář nového zařízení ---
    form = ttk.Frame(body)
    form.pack(fill="x")
    for c in (0, 1, 2):
        form.columnconfigure(c, weight=(1, 1, 2)[c])
    var_cls = tk.StringVar(value=app.CLS["Motor"]["label"])
    var_name = tk.StringVar(value=app.core("nextName", p, "Motor"))
    var_desc = tk.StringVar()
    field(form, _("Třída"), lambda b: ttk.Combobox(b, textvariable=var_cls, state="readonly",
                                                    values=list(labels)), col=0)
    field(form, _("Označení"), lambda b: ttk.Entry(b, textvariable=var_name), col=1)
    ent_desc = field(form, _("Popis (např. Čerpadlo hydrauliky)"),
                     lambda b: ttk.Entry(b, textvariable=var_desc), col=2)

    opt_row = ttk.Frame(body)
    opt_row.pack(fill="x")
    opt_vars: dict[str, tk.BooleanVar] = {}
    var_unit, var_min, var_max = tk.StringVar(), tk.StringVar(value="0"), tk.StringVar(value="100")
    new_params: dict = {}

    def render_opts() -> None:
        for w in opt_row.winfo_children():
            w.destroy()
        opt_vars.clear()
        key = labels[var_cls.get()]
        dflt = app.core("devDefaults", key) if key in MOTION_CLS else {}
        for ok, olabel in app.CLS[key]["opts"].items():
            on = (dflt.get("opt") or {}).get(ok, ok in DEFAULT_ON)
            opt_vars[ok] = tk.BooleanVar(value=bool(on))
            ttk.Checkbutton(opt_row, text=olabel, variable=opt_vars[ok]).pack(side="left", padx=(0, 14))
        if key in MOTION_CLS:          # výchozí jednotka a rozsah měniče / ventilu
            var_unit.set(dflt.get("unit", ""))
            var_min.set(f"{dflt.get('rmin', 0):g}")
            var_max.set(f"{dflt.get('rmax', 100):g}")
        if key in RANGE_CLS:
            ttk.Label(opt_row, text=_("jednotka")).pack(side="left")
            ttk.Entry(opt_row, textvariable=var_unit, width=8).pack(side="left", padx=(6, 14))
            ttk.Label(opt_row, text=_("rozsah")).pack(side="left")
            ttk.Entry(opt_row, textvariable=var_min, width=8).pack(side="left", padx=6)
            ttk.Label(opt_row, text=_("až")).pack(side="left")
            ttk.Entry(opt_row, textvariable=var_max, width=8).pack(side="left", padx=(6, 14))
        new_params.clear()
        new_params.update(param_fields(app, opt_row, key, dflt))
        if not opt_vars and key not in RANGE_CLS and not new_params:
            ttk.Label(opt_row, text=_("— bez voleb"), style="Dim.TLabel").pack(side="left")

    def on_cls(_e=None) -> None:
        app.ui["dev_cls"] = labels[var_cls.get()]       # zvolená třída přežije překreslení
        var_name.set(app.core("nextName", app.prj, labels[var_cls.get()]))
        render_opts()

    var_cls.trace_add("write", lambda *_a: on_cls())
    render_opts()

    def add() -> None:
        prj = app.prj
        key = labels[var_cls.get()]
        analog = key in RANGE_CLS
        rmin = _num(var_min.get(), 0) if analog else 0
        rmax = _num(var_max.get(), 100) if analog else 100
        try:
            if analog and (parse_num(var_min.get()) is None or parse_num(var_max.get()) is None):
                raise ValueError(_("Neplatné číslo v poli „{field}“.", field=_("rozsah")))
            if rmax <= rmin:
                raise ValueError(_("Rozsah měření: horní mez musí být větší než dolní."))
            params = read_params(new_params)
        except ValueError as exc:
            app.set_status(str(exc))
            return
        prj["devices"].append({
            "id": prj["nextId"],
            "name": var_name.get().strip() or app.core("nextName", prj, key),
            "cls": key, "desc": var_desc.get().strip(),
            "opt": {k: v.get() for k, v in opt_vars.items()},
            "unit": var_unit.get().strip() if analog else "",
            "rmin": rmin, "rmax": rmax,
        })
        apply_params(prj["devices"][-1], params)
        prj["nextId"] += 1
        app.sync()
        app.save()
        app.ui["dev_cls"] = key              # klíč třídy, ne popisek (ten závisí na jazyce)
        app.render()

    add_row = ttk.Frame(body)
    add_row.pack(fill="x", pady=(8, 10))
    ttk.Button(add_row, text=_("Přidat zařízení"), style="Accent.TButton", command=add
               ).pack(side="left")
    ent_desc.bind("<Return>", lambda _e: add())
    from .knihovna import add_controls               # „Přidat z knihovny“ (jen s připojenou knihovnou)
    add_controls(app, add_row)
    if app.ui.get("dev_cls") in app.CLS:     # po přidání zůstaň u stejné třídy
        var_cls.set(app.CLS[app.ui["dev_cls"]]["label"])

    # --- spodní část (pack zdola, ať tabulku nevytlačí) ---
    note_box(body, _(
        "Třídy Motor / Ventil / Analog dostanou hotový funkční blok (stavový automat, "
        "timeouty, status). Třídy DI/DO jsou volné signály pro vlastní logiku. "
        "Popis upravíš dvojklikem do buňky.") + " " + _(
        "Měnič, polohovací pohon a proporcionální ventil se ovládají přes běžné I/O "
        "(DO, DI, analog) — fungují na všech platformách; parametry pohonu (rampy, záznamy) "
        "se nastavují v pohonu, README je vypíše."), side="bottom")
    tools = ttk.Frame(body)
    tools.pack(side="bottom", fill="x", pady=(6, 0))
    params_row = ttk.Frame(body)                    # parametry vybraného zařízení
    params_row.pack(side="bottom", fill="x", pady=(6, 0))

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
            app.set_status(_("Nejdřív vyber zařízení v tabulce."))
            return
        prj = app.prj
        prj["devices"] = [d for d in prj["devices"] if d["id"] != int(iid)]
        ids = {d["id"] for d in prj["devices"]}
        prog = prj["program"]
        prog["seq"] = [s for s in prog["seq"] if s["act"] == "wait" or s["dev"] in ids]
        prog["interlocks"] = [i for i in prog.get("interlocks") or [] if i in ids]
        if prog["estop"] and prog["estop"] not in ids:
            prog["estop"] = ""
        app.sync()
        app.save()
        app.render()

    if not p["devices"]:
        wrap_label(body, _("Zatím žádná zařízení — přidej je výše, načti ukázku v kroku Projekt, "
                           "nech si je navrhnout v kroku AI návrh, nebo použij Import vpravo "
                           "dole."), pady=(0, 6))
    mid = ttk.Frame(body)
    mid.pack(fill="both", expand=True)
    panel = DevicePanel(mid, app, terms, here="zarizeni",
                        empty=_("Vyber zařízení v tabulce — zobrazí se jeho vstupy a výstupy "
                                "s odkazy do kroku I/O, na list zapojení a do programu."))
    panel.pack(side="right", fill="y", padx=(12, 0))
    tbl = Table(mid, [("name", _("Označení"), 80, False), ("cls", _("Třída"), 170, False),
                      ("desc", _("Popis"), 260, True), ("opt", _("Volby"), 200, True)],
                height=8, editable=("desc",), on_edit=edit)
    tbl.pack(side="left", fill="both", expand=True)
    for d in p["devices"]:
        tbl.add(d["id"], (d["name"], app.CLS[d["cls"]]["label"], d["desc"], _opts_text(app, d)))
    tbl.tv.bind("<Delete>", delete)

    def show_params(d: dict | None) -> None:
        for w in params_row.winfo_children():
            w.destroy()
        if d is None or d["cls"] not in ("AnalogIn", "AnalogOut", "DO", *MOTION_CLS):
            return
        ttk.Label(params_row, text=_("{dev}:", dev=d["name"]), font=theme.FONT_ACCENT).pack(side="left", padx=(0, 8))
        vars_ = param_fields(app, params_row, d["cls"], d)

        def save_params() -> None:
            try:
                params = read_params(vars_)
            except ValueError as exc:       # neplatné číslo mez dřív tiše smazalo
                app.set_status(str(exc))
                return
            bits = d.get("selBits")
            apply_params(d, params)
            if d["cls"] == "PosDrive" and d.get("selBits") != bits:   # jiný počet bitů = jiné signály
                app.sync()
                app.save()
                app.render()
                return
            app.save()
            tbl.tv.set(str(d["id"]), "opt", _opts_text(app, d))
            app.set_status(_("Parametry {dev} uloženy.", dev=d["name"]))

        ttk.Button(params_row, text=_("Uložit parametry"), command=save_params).pack(side="left")

    def on_select(_e=None) -> None:
        iid = tbl.selected()
        if iid is not None and iid.isdigit():
            app.ui["dev_sel"] = int(iid)
            panel.show(int(iid))
            show_params(app.dev_by_id(int(iid)))

    tbl.tv.bind("<<TreeviewSelect>>", on_select)
    if app.dev_by_id(app.ui.get("dev_sel")) is not None:
        tbl.select(app.ui["dev_sel"])
        panel.show(app.ui["dev_sel"])
        show_params(app.dev_by_id(app.ui["dev_sel"]))

    ttk.Button(tools, text=_("Odstranit vybrané"), style="Danger.TButton", command=delete
               ).pack(side="left")
    ttk.Label(tools, text=_("zařízení: {n}", n=len(p["devices"])), style="Dim.TLabel"
              ).pack(side="left", padx=10)
    ttk.Button(tools, text=_("Import stávajícího zařízení…"),
               command=lambda: _open_import(app)).pack(side="right")


def _open_import(app) -> None:
    """Vedlejší volba: průvodce importem stávajícího zařízení (i vložení textu exportu)."""
    from ..importer import open_wizard      # líně: importer sahá na moduly kroků
    open_wizard(app)

