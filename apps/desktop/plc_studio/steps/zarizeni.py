"""Krok 4 — Návrh zařízení stroje (+ vedlejší volba Import stávajícího zařízení)."""

from __future__ import annotations

import re

import tkinter as tk
from tkinter import messagebox, ttk

from .. import theme
from ..bridge import BridgeError
from ..detail import DevicePanel
from ..i18n import N_, _, _n
from ..project import parse_num
from ..widgets import trace
from ..widgets import Table, card, field, issue_box, note_box, wrap_label

DEFAULT_ON = ("fbk", "fbkOpen")  # volby zapnuté už při založení zařízení
RANGE_CLS = ("AnalogIn", "AnalogOut", "Vfd", "PropValve")   # třídy s rozsahem a jednotkou
MOTION_CLS = ("Vfd", "PosDrive", "PropValve")              # pohony fáze 2a (přes běžné I/O)
# servoosa (fáze 2b): konfigurační list osy — klíč AxisCfg, popisek (shodně s AXIS_FIELDS v jádře)
AXIS_FIELDS = (("vMax", N_("max. rychlost")), ("aMax", N_("max. zrychlení")), ("dMax", N_("max. zpomalení")),
               ("vDef", N_("výchozí rychlost")), ("limNeg", N_("SW limit −")), ("limPos", N_("SW limit +")),
               ("homePos", N_("poloha reference")), ("posTol", N_("okno v poloze")),
               ("followMax", N_("max. chyba sledování")), ("jogVel", N_("rychlost ručního pojezdu")),
               ("startPos", N_("poloha po zapnutí (model)")))


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
    if d["cls"] == "Axis":
        ax = d.get("axis") or {}
        extra.append(_("max. {v} {unit}/s, {n} poloh", v=f"{ax.get('vMax', 500):g}", unit=d.get("unit") or "",
                       n=len(ax.get("positions") or [])))
    if extra:
        txt = (txt + " · " if txt else "") + ", ".join(extra)
    return txt or "—"


PARAM_LABEL = {"limLo": N_("mez min"), "limHi": N_("mez max"), "setpoint": N_("žádaná hodnota"),
               "rampS": N_("rampa [s]"), "tol": N_("tolerance ±"), "tolTimeS": N_("doba odchylky [s]"),
               "selBits": N_("bity výběru záznamu"), "travelS": N_("doba jízdy (model) [s]"),
               **{"ax:" + k: lbl for k, lbl in AXIS_FIELDS}}


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
    elif cls == "Axis":
        # servoosa: mřížka polí konfigurace (prázdné = výchozí z jádra, axisCfgOf), polohy a pohon
        ax = d.get("axis") or {}
        box = ttk.Frame(parent)
        box.pack(side="left", fill="x")
        ttk.Label(box, text=_("jednotka")).grid(row=0, column=0, sticky="w")
        unit_var = tk.StringVar(value=d.get("unit") or "mm")
        ttk.Entry(box, textvariable=unit_var, width=6).grid(row=0, column=1, sticky="w", padx=(6, 14))
        out["unit"] = unit_var
        for i, (key, label) in enumerate(AXIS_FIELDS, start=1):
            r, c = divmod(i, 6)
            ttk.Label(box, text=_(label)).grid(row=r, column=2 * c, sticky="w")
            var = tk.StringVar(value="" if ax.get(key) is None else f"{ax[key]:g}")
            ttk.Entry(box, textvariable=var, width=7).grid(row=r, column=2 * c + 1, sticky="w", padx=(6, 14))
            out["ax:" + key] = var
        ttk.Label(box, text=_("pojmenované polohy")).grid(row=2, column=0, sticky="w")
        pos_var = tk.StringVar(value=app.core("axisPositionsText", ax.get("positions") or []))
        ttk.Entry(box, textvariable=pos_var, width=40).grid(row=2, column=1, columnspan=5, sticky="we", padx=(6, 14))
        ttk.Label(box, text=_("pohon")).grid(row=2, column=6, sticky="w")
        drv_var = tk.StringVar(value=ax.get("drive") or "")
        ttk.Entry(box, textvariable=drv_var, width=30).grid(row=2, column=7, columnspan=5, sticky="we", padx=(6, 14))
        out["axpos"] = pos_var
        out["axdrive"] = drv_var
        out["_ax"] = dict(ax)
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
    """Parametry z polí jako slovník pro jádro (``setDeviceParams`` / ``addDevice``): prázdné pole
    = ``None`` (nezadáno → klíč se odebere), neplatné číslo nebo nesrozumitelné záznamy / polohy →
    ``ValueError`` (text pro uživatele). Meze hodnot (mez min < max, rampa 0–3600 s, bity 1–6, REAL…)
    kontroluje jádro (``deviceParamsProblem``) — stejně jako web."""
    res: dict = {}
    for key, v in vars_.items():
        if key in ("_app", "_ax") or key.startswith("ax"):   # servoosa: složí se níže do ``axis``
            continue
        if key == "unit":
            res["unit"] = v.get().strip() or "mm"
            continue
        if key == "records":         # „1 = převzetí @ 0; 2 = lis @ 180“ → tabulka záznamů
            # samotné desetinné číslo („4.5047“) jádro čte jako „4. 5047“ (záznam 4 jménem 5047) a
            # přepíše jím tabulku — to uživatel nechtěl (forenzní test L6)
            odd = [p.strip() for p in re.split(r"[;\n]", v.get()) if re.fullmatch(r"\s*-?\d+[.,]\d+\s*", p)]
            if odd:
                raise ValueError(_("Záznamy pohonu nejsou uložené — „{part}“ je číslo, ne záznam. Zapiš je "
                                   "ve tvaru „1 = název @ poloha; 2 = …“.", part=odd[0]))
            r = vars_["_app"].core("parseRecordsForm", v.get())
            if r["error"]:           # nic tiše nezahazovat (test odolnosti 2026-10-08)
                raise ValueError(r["error"])
            res["records"] = r["records"]
            continue
        if key == "role":
            cb, keys = v
            res["role"] = keys[max(cb.current(), 0)] or None
        else:
            try:
                res[key] = _opt_num(v.get(), key)
            except ValueError as exc:
                raise ValueError(_("Neplatné číslo v poli „{field}“.", field=exc)) from exc
    if "_ax" in vars_:
        ax: dict = {}
        for key, _label in AXIS_FIELDS:
            try:
                ax[key] = _opt_num(vars_["ax:" + key].get(), "ax:" + key)   # None = výchozí (axisCfgOf)
            except ValueError as exc:
                raise ValueError(_("Neplatné číslo v poli „{field}“.", field=exc)) from exc
        r = vars_["_app"].core("parseAxisPositionsForm", vars_["axpos"].get())
        if r["error"]:
            raise ValueError(r["error"])
        ax["positions"] = r["positions"]
        ax["drive"] = vars_["axdrive"].get().strip() or None
        res["axis"] = ax
    return res


def params_unchanged(d: dict, params: dict) -> bool:
    """Parametry z polí jsou stejné jako v zařízení (opuštění pole beze změny nic neukládá)."""
    for key, v in params.items():
        if key == "axis":
            ax = d.get("axis") or {}
            if any(ax.get(k) != val for k, val in v.items()):     # None = pole chybí (výchozí)
                return False
        elif d.get(key) != v:
            return False
    return True


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
        dflt = app.core("devDefaults", key) if key in MOTION_CLS or key == "Axis" else {}
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

    trace(var_cls, lambda *_a: on_cls(), opt_row)
    render_opts()

    def add() -> None:
        key = labels[var_cls.get()]
        analog = key in RANGE_CLS
        try:
            if analog and (parse_num(var_min.get()) is None or parse_num(var_max.get()) is None):
                raise ValueError(_("Neplatné číslo v poli „{field}“.", field=_("rozsah")))
            params = read_params(new_params)
        except ValueError as exc:
            app.set_status("⚠ " + str(exc), keep=True)
            return
        dev = {"cls": key, "name": var_name.get().strip(), "desc": var_desc.get(),
               "opt": {k: v.get() for k, v in opt_vars.items()},
               "unit": var_unit.get().strip() if analog else "",
               "rmin": _num(var_min.get(), 0) if analog else 0, "rmax": _num(var_max.get(), 100) if analog else 100}
        dev.update({k: v for k, v in params.items() if v is not None})
        # jádro (edit.ts addDevice, stejně jako web): označení (identifikátor, jedinečné bez ohledu na
        # velikost písmen), rozsah a parametry se zkontrolují — chybné zařízení se nepřidá
        res = app.edit("addDevice", dev)
        if not res.get("ok"):
            app.set_status("⚠ " + (res.get("error") or ""), keep=True)
            return
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
        "Označení, popis, volby, jednotku a rozsah vybraného zařízení změníš v řádku pod tabulkou "
        "(uloží se Enterem nebo opuštěním pole).") + " " + _(
        "Měnič, polohovací pohon a proporcionální ventil se ovládají přes běžné I/O "
        "(DO, DI, analog) — fungují na všech platformách; parametry pohonu (rampy, záznamy) "
        "se nastavují v pohonu, README je vypíše.") + " " + _(
        "Servoosa se řídí po síti bloky PLCopen Motion Control (Siemens, Beckhoff, CODESYS, WAGO, "
        "Delta, Omron, Rockwell); osu samotnou (technologický objekt, osa NC / SoftMotion) "
        "nastavíš v IDE podle konfiguračního listu v README."), side="bottom")
    tools = ttk.Frame(body)
    tools.pack(side="bottom", fill="x", pady=(6, 0))
    params_row = ttk.Frame(body)                    # parametry vybraného zařízení
    params_row.pack(side="bottom", fill="x", pady=(6, 0))
    dev_row = ttk.Frame(body)                       # označení, popis, volby, rozsah vybraného zařízení
    dev_row.pack(side="bottom", fill="x", pady=(6, 0))
    issues_row = ttk.Frame(body)                    # kontrola zařízení přímo pod tabulkou (jako web)
    issues_row.pack(side="bottom", fill="x")

    def refresh_issues() -> None:
        """Nálezy kontroly návrhu, které se týkají zařízení (označení, meze, rozsah, parametry)."""
        for w in issues_row.winfo_children():
            w.destroy()
        names = {d["name"] for d in app.prj["devices"]}
        if not names:
            return
        try:
            issues = [i for i in app.core("validateProject", app.prj) if i.get("where") in names]
        except BridgeError:
            return
        if issues:
            issue_box(issues_row, issues, limit=6, pady=(6, 0))
        issues_row.issues = issues                   # testy

    # --- seznam zařízení ---
    def refresh_row(dev_id: int) -> None:
        """Po úpravě v jádře (nový objekt projektu) přepíše řádek tabulky, panel a nadpisy řádků."""
        d = app.dev_by_id(dev_id)
        if d is None:
            return
        iid = str(dev_id)
        if tbl.tv.exists(iid):
            for key, val in (("name", d["name"]), ("desc", d["desc"]), ("opt", _opts_text(app, d))):
                tbl.tv.set(iid, key, val)
        if panel.dev_id == dev_id:
            panel.show(dev_id)
        for lbl in (getattr(dev_row, "_title", None), getattr(params_row, "_title", None)):
            if lbl is not None and lbl.winfo_exists():
                lbl.configure(text=_("{dev}:", dev=d["name"]))
        refresh_issues()

    def rename(dev_id: int, value: str) -> bool:
        """Přejmenování v jádře (renameDevice): výchozí tagy s ním, ruční zůstanou (hláška)."""
        d = app.dev_by_id(dev_id)
        if d is None or value.strip() == d["name"]:
            return True
        old = d["name"]
        res = app.edit("renameDevice", dev_id, value.strip())
        if not res.get("ok"):
            app.set_status("⚠ " + (res.get("error") or ""), keep=True)
            return False
        new = app.dev_by_id(dev_id)["name"]
        msg = _("Zařízení {old} přejmenováno na {new}.", old=old, new=new)
        if res.get("keptTags"):
            msg += " " + _("Ručně změněné tagy zůstaly beze změny: {tags}.", tags=", ".join(res["keptTags"]))
        app.set_status(msg, keep=bool(res.get("keptTags")))
        refresh_row(dev_id)
        return True

    def set_desc(dev_id: int, value: str) -> None:
        """Popis v jádře (setDeviceDesc): výchozí komentáře signálů s ním, ruční zůstanou."""
        d = app.dev_by_id(dev_id)
        if d is None or value.strip() == d["desc"]:
            return
        app.edit("setDeviceDesc", dev_id, value)
        refresh_row(dev_id)

    def edit(iid: str, key: str, value: str) -> None:
        if not iid.isdigit() or app.dev_by_id(int(iid)) is None:
            return
        if key == "name":
            rename(int(iid), value)
        else:
            set_desc(int(iid), value)
        if app.ui.get("dev_sel") == int(iid):
            show_device_row(app.dev_by_id(int(iid)))

    def delete(_e=None) -> None:
        iid = tbl.selected()
        if iid is None or not iid.isdigit():
            app.set_status(_("Nejdřív vyber zařízení v tabulce."))
            return
        dev = app.dev_by_id(int(iid))
        if dev is None:
            return
        use = app.core("deviceUsage", app.prj, dev["id"])     # jádro — stejně jako web
        appr_key = "dev:" + dev["name"]                       # položka schválení zařízení (approval.ts)
        has_appr = appr_key in (app.prj.get("approvals") or {})
        # potvrzení vždy (forenzní test M3: Delete smazal zařízení mimo program bez dotazu a bez zpět)
        if use["used"]:
            # zařízení v programu: smazání zahodí i jeho kroky sekvence
            parts = []
            if use["steps"]:
                parts.append(_n(use["steps"], N_("{n} krok sekvence|{n} kroky sekvence|{n} kroků sekvence")))
            if use["estop"]:
                parts.append(_("vstup E-stop"))
            if use["lock"]:
                parts.append(_("blokovací vstup"))
            msg = _("Zařízení {name} používá program: {what}. Odstraněním se z programu odebere "
                    "i toto. Pokračovat?", name=dev["name"], what=", ".join(parts))
        else:
            msg = _("Odstranit zařízení {name} ({cls})? Odstranění nejde vrátit — jeho signály zmizí "
                    "z tabulky I/O, výkresů i kusovníku.", name=dev["name"],
                    cls=app.CLS.get(dev["cls"], {}).get("label", dev["cls"]))
        if has_appr:
            msg += "\n\n" + _("Smaže se i záznam schválení tohoto zařízení.")
        if not messagebox.askyesno(_("Odstranit zařízení?"), msg, icon="warning", parent=app.root):
            return
        res = app.edit("deleteDevice", dev["id"])    # i kroky, E-stop a blokování (jádro edit.ts)
        if res.get("ok") and has_appr and app.dev_by_name(dev["name"]) is None:
            # schválení smazaného zařízení by zůstalo jako sirotek v kroku Schválení
            (app.prj.get("approvals") or {}).pop(appr_key, None)
            app.save()
        app.render()
        app.set_status(_("Zařízení {name} odstraněno.", name=dev["name"]))

    if not p["devices"]:
        wrap_label(body, _("Zatím žádná zařízení — přidej je výše, otevři příklad stroje v kroku Projekt "
                           "(Příklady strojů), nech si je navrhnout v kroku AI návrh, nebo použij Import "
                           "vpravo dole."), pady=(0, 6))
    mid = ttk.Frame(body)
    mid.pack(fill="both", expand=True)
    panel = DevicePanel(mid, app, terms, here="zarizeni",
                        empty=_("Vyber zařízení v tabulce — zobrazí se jeho vstupy a výstupy "
                                "s odkazy do kroku I/O, na list zapojení a do programu."))
    panel.pack(side="right", fill="y", padx=(12, 0))
    tbl = Table(mid, [("name", _("Označení"), 80, False), ("cls", _("Třída"), 170, False),
                      ("desc", _("Popis"), 260, True), ("opt", _("Volby"), 200, True)],
                height=8, editable=("name", "desc"), on_edit=edit)
    tbl.pack(side="left", fill="both", expand=True)
    for d in p["devices"]:
        tbl.add(d["id"], (d["name"], app.CLS[d["cls"]]["label"], d["desc"], _opts_text(app, d)))
    tbl.tv.bind("<Delete>", delete)
    refresh_issues()

    def on_commit(widget, fn) -> None:
        """Uložení pole Enterem i opuštěním (FocusOut) — ne jen tlačítkem."""
        widget.bind("<Return>", lambda _e: fn(), add="+")
        widget.bind("<FocusOut>", lambda _e: fn(), add="+")

    def show_device_row(d: dict | None) -> None:
        """Řádek úprav vybraného zařízení: označení, popis, volby (Checkbutton), jednotka a rozsah."""
        for w in dev_row.winfo_children():
            w.destroy()
        dev_row._title = None
        if d is None:
            return
        dev_id = d["id"]
        # 1. řádek: označení, popis, jednotka a rozsah; 2. řádek: volby (v němčině by se nevešly vedle)
        line = ttk.Frame(dev_row)
        line.pack(fill="x")
        opt_line = ttk.Frame(dev_row)
        if app.CLS[d["cls"]]["opts"]:
            opt_line.pack(fill="x", pady=(4, 0))
        dev_row._title = ttk.Label(line, text=_("{dev}:", dev=d["name"]), font=theme.FONT_ACCENT)
        dev_row._title.pack(side="left", padx=(0, 8))
        var_n, var_d = tk.StringVar(value=d["name"]), tk.StringVar(value=d["desc"])
        ttk.Label(line, text=_("Označení")).pack(side="left")
        ent_n = ttk.Entry(line, textvariable=var_n, width=max(10, len(d["name"]) + 2))
        ent_n.pack(side="left", padx=(6, 14))
        ttk.Label(line, text=_("Popis")).pack(side="left")
        ent_d = ttk.Entry(line, textvariable=var_d, width=28)
        ent_d.pack(side="left", padx=(6, 14))

        def commit_name() -> None:
            cur = app.dev_by_id(dev_id)
            if cur is not None and var_n.get().strip() != cur["name"] and not rename(dev_id, var_n.get()):
                var_n.set(cur["name"])

        on_commit(ent_n, commit_name)
        on_commit(ent_d, lambda: set_desc(dev_id, var_d.get()))
        keep = [var_n, var_d]

        def set_opt(key: str, var: tk.BooleanVar) -> None:
            res = app.edit("setDeviceOpts", dev_id, {key: var.get()})
            if not res.get("ok"):
                app.set_status("⚠ " + (res.get("error") or ""), keep=True)
                return
            parts = []
            if res.get("added"):
                parts.append(_("přidány signály: {tags}", tags=", ".join(res["added"])))
            if res.get("removed"):
                parts.append(_("odebrány signály: {tags}", tags=", ".join(res["removed"])))
            if res.get("affectedSteps"):
                parts.append(_("zkontroluj kroky {steps} — čekaly na odebrané hlášení",
                               steps=", ".join(str(i + 1) for i in res["affectedSteps"])))
            more = "; ".join(parts)
            app.set_status(_("Volby {dev} uloženy.", dev=app.dev_by_id(dev_id)["name"])
                           + (" " + more[:1].upper() + more[1:] + "." if more else ""),
                           keep=bool(res.get("affectedSteps")))
            app.render()

        state = app.core("deviceOpts", d) if app.CLS[d["cls"]]["opts"] else {}
        for ok, olabel in app.CLS[d["cls"]]["opts"].items():
            var = tk.BooleanVar(value=bool(state.get(ok)))
            keep.append(var)
            ttk.Checkbutton(opt_line, text=olabel, variable=var,
                            command=lambda k=ok, v=var: set_opt(k, v)).pack(side="left", padx=(0, 10))
        if d["cls"] in RANGE_CLS:
            var_u = tk.StringVar(value=d.get("unit") or "")
            var_lo, var_hi = tk.StringVar(value=f"{d['rmin']:g}"), tk.StringVar(value=f"{d['rmax']:g}")
            keep += [var_u, var_lo, var_hi]
            ttk.Label(line, text=_("jednotka")).pack(side="left", padx=(4, 0))
            ent_u = ttk.Entry(line, textvariable=var_u, width=7)
            ent_u.pack(side="left", padx=(6, 12))
            ttk.Label(line, text=_("rozsah")).pack(side="left")
            ent_lo = ttk.Entry(line, textvariable=var_lo, width=7)
            ent_lo.pack(side="left", padx=6)
            ttk.Label(line, text=_("až")).pack(side="left")
            ent_hi = ttk.Entry(line, textvariable=var_hi, width=7)
            ent_hi.pack(side="left", padx=(6, 0))

            def reset_range(cur: dict) -> None:
                var_u.set(cur.get("unit") or "")
                var_lo.set(f"{cur['rmin']:g}")
                var_hi.set(f"{cur['rmax']:g}")

            def commit_range() -> None:
                cur = app.dev_by_id(dev_id)
                if cur is None:
                    return
                lo, hi = parse_num(var_lo.get()), parse_num(var_hi.get())
                if lo is None or hi is None:
                    app.set_status(_("Neplatné číslo v poli „{field}“.", field=_("rozsah")))
                    reset_range(cur)
                    return
                if (var_u.get().strip(), lo, hi) == ((cur.get("unit") or ""), cur["rmin"], cur["rmax"]):
                    return
                res = app.edit("setDeviceRange", dev_id, {"unit": var_u.get(), "rmin": lo, "rmax": hi})
                if not res.get("ok"):
                    app.set_status("⚠ " + (res.get("error") or ""), keep=True)
                    reset_range(cur)
                    return
                app.set_status(_("Rozsah {dev} uložen.", dev=cur["name"]))
                refresh_row(dev_id)

            for ent in (ent_u, ent_lo, ent_hi):
                on_commit(ent, commit_range)
        dev_row._vars = keep                       # proměnné naživu (GC)

    def show_params(d: dict | None) -> None:
        for w in params_row.winfo_children():
            w.destroy()
        params_row._title = None
        if d is None or d["cls"] not in ("AnalogIn", "AnalogOut", "DO", "Axis", *MOTION_CLS):
            return
        dev_id = d["id"]
        params_row._title = ttk.Label(params_row, text=_("{dev}:", dev=d["name"]), font=theme.FONT_ACCENT)
        params_row._title.pack(side="left", padx=(0, 8))
        vars_ = param_fields(app, params_row, d["cls"], d)

        def save_params(quiet: bool = False) -> None:
            d = app.dev_by_id(dev_id)       # projekt mohl být mezitím nahrazen (úpravy v jádře)
            if d is None:
                return
            try:
                params = read_params(vars_)
            except ValueError as exc:       # neplatné číslo mez dřív tiše smazalo
                app.set_status("⚠ " + str(exc), keep=True)
                return
            if quiet and params_unchanged(d, params):
                return                      # opuštění pole beze změny: nic neukládat ani nehlásit
            # jádro (edit.ts setDeviceParams, stejně jako web): mez min ≥ max, záporná rampa, bity mimo
            # 1–6… se neuloží a hláška řekne proč
            res = app.edit("setDeviceParams", dev_id, params)
            if not res.get("ok"):
                app.set_status("⚠ " + (res.get("error") or ""), keep=True)
                return
            d = app.dev_by_id(dev_id)
            if res.get("added") or res.get("removed"):   # jiný počet bitů výběru záznamu = jiné signály
                app.render()
                app.set_status(_("Parametry {dev} uloženy.", dev=d["name"]))
                return
            tbl.tv.set(str(d["id"]), "opt", _opts_text(app, d))
            if panel.dev_id == dev_id:
                panel.show(dev_id)
            refresh_issues()
            app.set_status(_("Parametry {dev} uloženy.", dev=d["name"]))

        ttk.Button(params_row, text=_("Uložit parametry"), command=save_params).pack(side="left")
        # uložení i Enterem / opuštěním pole (servoosa má pole v mřížce o úroveň níž)
        widgets = list(params_row.winfo_children())
        widgets += [c for f in widgets if type(f) is ttk.Frame for c in f.winfo_children()]
        for w in widgets:
            if type(w) is ttk.Entry:
                on_commit(w, lambda: save_params(quiet=True))
            elif isinstance(w, ttk.Combobox):
                w.bind("<<ComboboxSelected>>", lambda _e: save_params(quiet=True), add="+")

    def on_select(_e=None) -> None:
        iid = tbl.selected()
        if iid is not None and iid.isdigit():
            app.ui["dev_sel"] = int(iid)
            panel.show(int(iid))
            show_device_row(app.dev_by_id(int(iid)))
            show_params(app.dev_by_id(int(iid)))

    tbl.tv.bind("<<TreeviewSelect>>", on_select)
    if app.dev_by_id(app.ui.get("dev_sel")) is not None:
        tbl.select(app.ui["dev_sel"])
        panel.show(app.ui["dev_sel"])
        show_device_row(app.dev_by_id(app.ui["dev_sel"]))
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

