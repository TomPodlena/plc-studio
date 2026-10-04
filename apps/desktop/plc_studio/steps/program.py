"""Krok 7 — Logika programu: centrální uvolnění (E-stop) a automatická sekvence."""

from __future__ import annotations

import tkinter as tk
from tkinter import ttk

from .. import theme
from ..detail import step_text
from ..i18n import N_, _
from ..project import parse_num
from ..widgets import Table, card, link, note_box, wrap_label
from . import simulace, ziva

# Popisky voleb — jen označené k překladu; přeloží se až při stavbě widgetů.
# Zvolená akce a přechod se mapují zpět na klíč přes pořadí v seznamu, ne přes text.
NO_ESTOP = N_("— žádný (doplníš ručně) —")
WAIT = N_("— čekání (bez zařízení) —")
ACT_LABEL = {"start": N_("start"), "stop": N_("stop"), "open": N_("otevřít"),
             "close": N_("zavřít"), "wait": N_("čekat"),
             "waitOn": N_("čekat na TRUE"), "waitOff": N_("čekat na FALSE"),
             # pohony fáze 2a
             "home": N_("referenční jízda"), "posRecord": N_("jízda na záznam"),
             "setPressure": N_("nastavit tlak"), "setFlow": N_("nastavit průtok"),
             # servoosa (fáze 2b)
             "moveAbs": N_("najet na polohu"), "moveRel": N_("posun o dráhu"),
             "velocity": N_("jízda rychlostí"), "halt": N_("zastavit osu"),
             "waitInPos": N_("čekat na dojetí osy")}
MOTION_CLS = ("Vfd", "PosDrive", "PropValve")
BY_NUMBER = N_("— zadat číslem —")
COND_LABEL = {"fbk": N_("přechod: zpětné hlášení"), "time": N_("přechod: čas")}
LOCK_ROWS = 4          # víc řádků blokovacích vstupů → posuvné okno
HINTS_MIN_H = 560      # nižší záložka Logika schová vysvětlující texty (tabulka má přednost)


def _dev_label(d: dict) -> str:
    return f"{d['name']} – {d['desc']}" if d["desc"] else d["name"]


def render(app, parent) -> None:
    card_body = card(parent, "07", _("Logika programu"))
    nb = ttk.Notebook(card_body)
    nb.pack(fill="both", expand=True)
    t_logic = ttk.Frame(nb, padding=10)
    nb.add(t_logic, text=_("Logika a sekvence"))
    t_live = ttk.Frame(nb, padding=10)
    nb.add(t_live, text=_("Živá simulace"))
    t_sim = ttk.Frame(nb, padding=10)
    nb.add(t_sim, text=_("Scénáře a ověření"))
    _logic(app, t_logic)
    ziva.build(app, t_live)
    simulace.build(app, t_sim)
    nb.select(min(app.ui.get("prog_tab", 0), 2))
    nb.bind("<<NotebookTabChanged>>",
            lambda e: app.ui.__setitem__("prog_tab", nb.index(nb.select()))
            if e.widget is nb else None)


def _logic(app, body) -> None:
    p = app.prj
    prog = p["program"]
    di = [d for d in p["devices"] if d["cls"] == "DI"]
    act = [d for d in p["devices"] if d["cls"] in ("Motor", "Ventil", "Axis", *MOTION_CLS)]

    # --- centrální uvolnění ---
    top = ttk.Frame(body)
    top.pack(fill="x")
    ttk.Label(top, text=_("Centrální uvolnění (E-stop / bezpečnostní vstup):")).pack(side="left")
    no_estop = _(NO_ESTOP)
    estop = {_dev_label(d): d["id"] for d in di}
    current = next((k for k, v in estop.items() if v == prog["estop"]), no_estop)
    var_estop = tk.StringVar(value=current)
    ttk.Combobox(top, textvariable=var_estop, values=[no_estop, *estop], state="readonly",
                 width=44).pack(side="left", padx=(8, 0))

    def on_estop(*_a):
        prog_now = app.prj["program"]
        prog_now["estop"] = estop.get(var_estop.get(), "")
        prog_now["interlocks"] = [i for i in prog_now.get("interlocks") or []
                                  if i != prog_now["estop"]]
        app.save()
        app.root.after_idle(app.render)           # E-stop nemůže být zároveň blokováním

    var_estop.trace_add("write", on_estop)
    note_box(body, _(
        "Signál se zapojí do enable všech bloků. Skutečnou bezpečnost řeší safety "
        "technika (bezpečnostní relé / safety PLC dle posouzení rizik), ne program — "
        "E-stop je v programu jen informativní signál. Viz Nápověda."), warn=True)

    # --- blokovací vstupy (kryty, závory…) ---
    ttk.Label(body, text=_("Blokovací vstupy (kryty, závory…)"), style="Section.TLabel"
              ).pack(anchor="w", pady=(12, 0))
    lock_hint = wrap_label(body, _(
        "Zaškrtnuté vstupy jsou spolu s E-stopem v enable: FALSE kteréhokoli zastaví stroj "
        "(výstupy vypnout, sekvence do klidu, po obnovení nový start). Vstup má mít TRUE = "
        "v pořádku (kryt zavřen, závora volná)."))
    candidates = [d for d in di if d["id"] != prog["estop"]]
    lock_rows = -(-len(candidates) // 3)
    if lock_rows > LOCK_ROWS:
        # velký stroj (desítky vstupů): seznam v posuvném okně, ať nevytlačí sekvenci
        lock_box = ttk.Frame(body)
        lock_box.pack(fill="x", pady=(2, 0))
        lock_cv = tk.Canvas(lock_box, bg=theme.BG, highlightthickness=0, height=1)
        lock_sb = ttk.Scrollbar(lock_box, orient="vertical", command=lock_cv.yview)
        lock_cv.configure(yscrollcommand=lock_sb.set)
        lock_sb.pack(side="right", fill="y")
        lock_cv.pack(side="left", fill="x", expand=True)
        locks = ttk.Frame(lock_cv)
        lock_cv.create_window(0, 0, window=locks, anchor="nw")
        locks.bind("<Configure>", lambda _e: lock_cv.configure(scrollregion=lock_cv.bbox("all")))
    else:
        lock_cv = None
        locks = ttk.Frame(body)
        locks.pack(fill="x", pady=(2, 0))
    locks._vars = []                               # držet proměnné naživu (GC)

    def on_lock(dev_id: int, on: bool) -> None:
        cur = set(app.prj["program"].get("interlocks") or [])
        cur.add(dev_id) if on else cur.discard(dev_id)
        app.prj["program"]["interlocks"] = [d["id"] for d in app.prj["devices"] if d["id"] in cur]
        app.save()

    for i, d in enumerate(candidates):
        var = tk.BooleanVar(value=d["id"] in (prog.get("interlocks") or []))
        locks._vars.append(var)
        ttk.Checkbutton(locks, text=_dev_label(d), variable=var,
                        command=lambda i=d["id"], v=var: on_lock(i, v.get())
                        ).grid(row=i // 3, column=i % 3, sticky="w", padx=(0, 18))
    if not candidates:
        ttk.Label(locks, text=_("Projekt nemá další digitální vstupy."), style="Dim.TLabel"
                  ).grid(row=0, column=0, sticky="w")
    if lock_cv is not None:
        row_h = max(w.winfo_reqheight() for w in locks.winfo_children())
        lock_cv.configure(height=LOCK_ROWS * row_h, yscrollincrement=row_h)

        def wheel(e) -> str:
            lock_cv.yview_scroll(-1 if e.delta > 0 else 1, "units")
            return "break"

        for w in (lock_cv, locks, *locks.winfo_children()):
            w.bind("<MouseWheel>", wheel)

    ttk.Label(body, text=_("Automatická sekvence (volitelné)"), style="Section.TLabel"
              ).pack(anchor="w", pady=(14, 0))
    seq_hint = wrap_label(body, _(
        "Kroky se provedou po řadě v režimu AUTO; generuje se z nich stavový "
        "automat (CASE). Přechod = zpětné hlášení, nebo čas. U přechodu na zpětné hlášení "
        "je zadaný čas hlídací: nepřijde-li hlášení včas, program vyhlásí poruchu stroje, "
        "zastaví sekvenci a čeká na kvitaci. Mimo AUTO se zařízení ovládají ručními "
        "povely z HMI."))

    # --- přidání kroku (zdola) ---
    add = ttk.Frame(body)
    add.pack(side="bottom", fill="x", pady=(8, 0))

    def fit_hints(e) -> None:
        """Nízké okno: vysvětlující texty pryč, ať tabulka kroků a její tlačítka nezmizí."""
        small = e.height < HINTS_MIN_H
        for hint, before in ((lock_hint, lock_box if lock_cv is not None else locks),
                             (seq_hint, add)):
            if small and hint.winfo_manager():
                hint.pack_forget()
            elif not small and not hint.winfo_manager():
                hint.pack(fill="x", anchor="w", before=before)

    body.bind("<Configure>", fit_hints, add="+")
    wait = _(WAIT)
    devs = {_dev_label(d): d for d in act}
    devs.update({_dev_label(d): d for d in di})          # čekání na snímač / tlačítko
    conds = list(COND_LABEL)             # klíče přechodů v pořadí nabídky
    acts: list[str] = []                 # klíče akcí v pořadí nabídky (podle zařízení)
    var_dev = tk.StringVar(value=next(iter(devs), wait))
    var_act = tk.StringVar()
    var_cond = tk.StringVar(value=_(COND_LABEL["fbk"]))
    var_time = tk.StringVar(value="3")
    ttk.Combobox(add, textvariable=var_dev, values=[*devs, wait], state="readonly", width=36
                 ).pack(side="left")
    cb_act = ttk.Combobox(add, textvariable=var_act, state="readonly",
                          width=max(10, *(len(_(v)) + 1 for v in ACT_LABEL.values())))
    cb_act.pack(side="left", padx=(6, 0))
    cb_cond = ttk.Combobox(add, textvariable=var_cond, values=[_(COND_LABEL[k]) for k in conds],
                           state="readonly",
                           width=max(24, *(len(_(v)) + 1 for v in COND_LABEL.values())))
    cb_cond._var = var_cond              # držet proměnnou naživu (jinak ji GC uklidí a pole zbělá)
    cb_cond.pack(side="left", padx=(6, 0))
    ttk.Spinbox(add, textvariable=var_time, from_=1, to=3600, width=6).pack(side="left", padx=(6, 2))
    ttk.Label(add, text=_("s (čas / hlídací čas)")).pack(side="left")
    # parametr kroku pohonu: otáčky měniče (+ směr), číslo záznamu pohonu, žádaná ventilu
    par = ttk.Frame(add)
    par.pack(side="left", padx=(8, 0))
    var_par, var_rev = tk.StringVar(), tk.BooleanVar(value=False)
    par._vars = (var_par, var_rev)                 # proměnné naživu (GC)
    # parametry kroku servoosy (vlastní řádek nad přidáním): cíl / dráha / rychlost, dynamika nepovinně
    ax_row = ttk.Frame(body)
    ax_row.pack(side="bottom", fill="x", pady=(6, 0))
    ax_vars = {k: tk.StringVar() for k in ("ref", "pos", "vel", "acc", "dec")}
    ax_row._vars = ax_vars

    def refresh_axis(d, a) -> None:
        for w in ax_row.winfo_children():
            w.destroy()
        if d is None or d["cls"] != "Axis" or a not in ("moveAbs", "moveRel", "velocity"):
            return
        cfg = app.core("axisCfgOf", d)
        u = d.get("unit") or ""
        ttk.Label(ax_row, text=_("{dev}:", dev=d["name"]), font=theme.FONT_ACCENT).pack(side="left", padx=(0, 8))

        def num(key: str, label: str) -> None:
            ttk.Label(ax_row, text=label).pack(side="left")
            ttk.Entry(ax_row, textvariable=ax_vars[key], width=8).pack(side="left", padx=(4, 12))

        if a == "moveAbs":
            refs = [_(BY_NUMBER)] + [f"{x['name']} ({x['pos']:g})" for x in cfg["positions"]]
            ttk.Label(ax_row, text=_("poloha")).pack(side="left")
            cb = ttk.Combobox(ax_row, textvariable=ax_vars["ref"], values=refs, state="readonly",
                              width=max(len(r) for r in refs) + 1)
            cb.pack(side="left", padx=(4, 12))
            cb._refs = cfg["positions"]
            ax_row._ref_cb = cb
            if ax_vars["ref"].get() not in refs:
                ax_vars["ref"].set(refs[1] if len(refs) > 1 else refs[0])
            num("pos", _("cíl") + (f" [{u}]" if u else ""))
        elif a == "moveRel":
            num("pos", _("dráha") + (f" [{u}]" if u else ""))
        num("vel", (_("rychlost (± = směr)") if a == "velocity" else _("rychlost")) + (f" [{u}/s]" if u else ""))
        num("acc", _("zrychlení") + (f" [{u}/s²]" if u else ""))
        num("dec", _("zpomalení") + (f" [{u}/s²]" if u else ""))
        ttk.Label(ax_row, text=_("prázdné = výchozí z konfigurace osy (rychlost {v})", v=f"{cfg['vDef']:g}"),
                  style="Dim.TLabel").pack(side="left")

    def refresh_par(*_a):
        for w in par.winfo_children():
            w.destroy()
        d = devs.get(var_dev.get())
        a = acts[max(cb_act.current(), 0)] if acts else ""
        refresh_axis(d, a)
        if d is None or d["cls"] not in MOTION_CLS or (d["cls"] == "Vfd" and a != "start") \
                or (d["cls"] == "PosDrive" and a != "posRecord"):
            return
        unit = f" [{d['unit']}]" if d.get("unit") else ""
        if d["cls"] == "PosDrive":
            n_max = (1 << int(d.get("selBits") or 3)) - 1
            names = {r["no"]: r.get("name") or "" for r in d.get("records") or []}
            vals = [f"{n} – {names[n]}" if names.get(n) else str(n) for n in range(1, n_max + 1)]
            ttk.Label(par, text=_("záznam")).pack(side="left")
            cb = ttk.Combobox(par, textvariable=var_par, values=vals, state="readonly",
                              width=max(6, *(len(v) + 1 for v in vals)))
            cb.pack(side="left", padx=(4, 0))
            if var_par.get() not in vals:
                var_par.set(vals[0])
        else:
            ttk.Label(par, text=(_("otáčky") if d["cls"] == "Vfd" else _("žádaná")) + unit).pack(side="left")
            if parse_num(var_par.get()) is None:
                var_par.set("" if d.get("setpoint") is None else f"{d['setpoint']:g}")
            ttk.Entry(par, textvariable=var_par, width=7).pack(side="left", padx=(4, 0))
            if d["cls"] == "Vfd" and (d.get("opt") or {}).get("rev"):
                ttk.Checkbutton(par, text=_("vzad"), variable=var_rev).pack(side="left", padx=(6, 0))

    def refresh_acts(*_a):
        d = devs.get(var_dev.get())
        acts[:] = (["wait"] if d is None else ["waitOn", "waitOff"] if d["cls"] == "DI"
                   else list(app.ACTS_FOR.get(d["cls"]) or (["start", "stop"] if d["cls"] == "Motor" else ["open", "close"])))
        cb_act.configure(values=[_(ACT_LABEL[k]) for k in acts])
        var_act.set(_(ACT_LABEL[acts[0]]))
        var_par.set("")
        refresh_par()
        # čekání na vstup: přechod je vždy na vstup, čas je hlídací
        if d is not None and d["cls"] == "DI":
            cb_cond.current(conds.index("fbk"))
        elif d is None:                  # výdrž bez zařízení se ukládá vždy jako přechod časem
            cb_cond.current(conds.index("time"))
        cb_cond.state(["disabled"] if d is None or d["cls"] == "DI" else ["!disabled"])

    var_dev.trace_add("write", refresh_acts)
    var_act.trace_add("write", refresh_par)
    refresh_acts()

    # rozpracovaný krok (zařízení, akce, přechod, čas) přežije překreslení — např. po
    # „Přidat krok“ se další krok téhož zařízení zadá bez nového výběru
    keep = app.ui.get("seq_add") or {}
    label_of = {d["id"]: lbl for lbl, d in devs.items()}
    if keep.get("dev") in label_of or keep.get("dev") == 0:
        var_dev.set(label_of.get(keep["dev"], wait))
        if keep.get("act") in acts:
            cb_act.current(acts.index(keep["act"]))
        if keep.get("cond") in conds and "disabled" not in cb_cond.state():
            cb_cond.current(conds.index(keep["cond"]))
    if keep.get("time"):
        var_time.set(keep["time"])

    def remember(*_a):
        d = devs.get(var_dev.get())
        app.ui["seq_add"] = {"dev": d["id"] if d else 0,
                             "act": acts[max(cb_act.current(), 0)],
                             "cond": conds[max(cb_cond.current(), 0)], "time": var_time.get()}

    for var in (var_dev, var_act, var_cond, var_time):
        var.trace_add("write", remember)
    add._vars = (var_dev, var_act, var_time)      # proměnné naživu (GC)

    def add_step() -> None:
        d = devs.get(var_dev.get())
        time_s = parse_num(var_time.get())
        if time_s is None or not 0 < time_s <= 3600:
            # dřív se neplatný čas tiše nahradil 1 s (a „inf“ rozbil projekt)
            app.set_status(_("Čas kroku zadej v sekundách: 1 až 3600."))
            return
        time_s = max(1.0, time_s)
        act_key = acts[max(cb_act.current(), 0)]
        cond = conds[max(cb_cond.current(), 0)]
        seq = app.prj["program"]["seq"]
        step = {"dev": d["id"] if d else 0, "act": act_key if d else "wait",
                "cond": cond if d else "time",
                "timeS": int(time_s) if time_s.is_integer() else time_s}
        if d is not None and d["cls"] in MOTION_CLS:     # otáčky / žádaná, záznam, směr
            if d["cls"] == "PosDrive" and act_key == "posRecord":
                step["rec"] = int(var_par.get().split(" ")[0] or 1)
            elif d["cls"] == "PropValve" or act_key == "start":
                sp = parse_num(var_par.get())
                if sp is not None:
                    step["sp"] = int(sp) if sp.is_integer() else sp
                if d["cls"] == "Vfd" and var_rev.get():
                    step["rev"] = True
        if d is not None and d["cls"] == "Axis" and act_key in ("moveAbs", "moveRel", "velocity"):
            cb = getattr(ax_row, "_ref_cb", None)
            if act_key == "moveAbs" and cb is not None and cb.winfo_exists() and cb.current() > 0:
                step["posRef"] = cb._refs[cb.current() - 1]["name"]
            vals = {}
            for key in ("pos", "vel", "acc", "dec"):
                txt = ax_vars[key].get().strip()
                if not txt:
                    continue
                v = parse_num(txt)
                if v is None:
                    app.set_status(_("Neplatné číslo v poli „{field}“.", field=key))
                    return
                vals[key] = int(v) if float(v).is_integer() else v
            if act_key in ("moveAbs", "moveRel") and "posRef" not in step:
                if "pos" not in vals:
                    app.set_status(_("Zadej cílovou polohu / dráhu osy."))
                    return
                step["pos"] = vals["pos"]
            for key in ("vel", "acc", "dec"):
                if key in vals:
                    step[key] = vals[key]
        seq.append(step)
        app.ui["seq_sel"] = len(seq) - 1
        app.save()
        app.render()

    ttk.Button(add, text=_("Přidat krok"), style="Accent.TButton", command=add_step
               ).pack(side="left", padx=(10, 0))

    # --- seznam kroků ---
    mid = ttk.Frame(body)
    mid.pack(fill="both", expand=True, pady=(6, 0))
    side = ttk.Frame(mid)
    side.pack(side="right", fill="y", padx=(8, 0))
    tbl = Table(mid, [("n", _("Krok"), 70, False), ("txt", _("Akce a přechod"), 600, True)],
                height=8)
    tbl.pack(side="left", fill="both", expand=True)
    seq = prog["seq"]
    for i, s in enumerate(seq):
        tbl.add(i, (_("Krok {n}", n=i + 1), step_text(app, s)))
    if not seq:
        tbl.add("empty", ("", _("Bez sekvence se vygenerují jen instance zařízení s ručními "
                                "povely z HMI (manRun_* / manOpen_*).")), tags=("dim",))
    tbl.select(app.ui.get("seq_sel"))

    def sel() -> int | None:
        iid = tbl.selected()
        return int(iid) if iid is not None and iid.isdigit() else None

    def move(delta: int) -> None:
        i, steps = sel(), app.prj["program"]["seq"]
        if i is None:
            app.set_status(_("Nejdřív vyber krok v tabulce."))
            return
        if not 0 <= i + delta < len(steps):
            return
        steps[i], steps[i + delta] = steps[i + delta], steps[i]
        app.ui["seq_sel"] = i + delta
        app.save()
        app.render()

    def remove() -> None:
        i = sel()
        if i is None:
            app.set_status(_("Nejdřív vyber krok v tabulce."))
            return
        del app.prj["program"]["seq"][i]
        app.ui["seq_sel"] = min(i, len(app.prj["program"]["seq"]) - 1)
        app.save()
        app.render()

    def to_device() -> None:
        i = sel()
        steps = app.prj["program"]["seq"]
        if i is None or steps[i]["act"] == "wait":
            app.set_status(_("Vyber krok, který ovládá zařízení."))
        else:
            app.open_device(steps[i]["dev"])

    updown = ttk.Frame(side)               # vedle sebe — v nízkém okně se pak vejdou i odkazy
    updown.pack(fill="x")
    updown.columnconfigure((0, 1), weight=1, uniform="ud")
    ttk.Button(updown, text=_("↑ Nahoru"), command=lambda: move(-1)
               ).grid(row=0, column=0, sticky="ew", padx=(0, 2))
    ttk.Button(updown, text=_("↓ Dolů"), command=lambda: move(1)
               ).grid(row=0, column=1, sticky="ew", padx=(2, 0))
    ttk.Button(side, text=_("× Odstranit"), style="Danger.TButton", command=remove
               ).pack(fill="x", pady=(8, 0))
    ttk.Label(side, text=_("Vybraný krok:"), style="Dim.TLabel").pack(anchor="w", pady=(10, 2))
    link(side, _("Zařízení ↗"), to_device).pack(anchor="w")
    link(side, _("Funkční diagram ↗"), lambda: app.open_flow(sel())).pack(anchor="w", pady=(2, 0))
    tbl.tv.bind("<Delete>", lambda _e: remove())
    tbl.tv.bind("<<TreeviewSelect>>", lambda _e: app.ui.__setitem__("seq_sel", sel()))
