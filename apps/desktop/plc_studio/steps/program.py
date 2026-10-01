"""Krok 7 — Logika programu: centrální uvolnění (E-stop) a automatická sekvence."""

from __future__ import annotations

import tkinter as tk
from tkinter import ttk

from ..widgets import Table, card, note_box, wrap_label

NO_ESTOP = "— žádný (doplníš ručně) —"
WAIT = "— čekání (bez zařízení) —"
ACT_LABEL = {"start": "start", "stop": "stop", "open": "otevřít", "close": "zavřít",
             "wait": "čekat"}
COND_LABEL = {"fbk": "přechod: zpětné hlášení", "time": "přechod: čas"}


def _dev_label(d: dict) -> str:
    return f"{d['name']} – {d['desc']}" if d["desc"] else d["name"]


def step_text(app, s: dict) -> str:
    if s["act"] == "wait":
        return f"výdrž {s['timeS']:g} s"
    d = app.dev_by_id(s["dev"])
    how = f"čas {s['timeS']:g} s" if s["cond"] == "time" else "zpětné hlášení"
    return f"{d['name'] if d else '?'} {ACT_LABEL.get(s['act'], s['act'])} → {how}"


def render(app, parent) -> None:
    p = app.prj
    prog = p["program"]
    di = [d for d in p["devices"] if d["cls"] == "DI"]
    act = [d for d in p["devices"] if d["cls"] in ("Motor", "Ventil")]
    body = card(parent, "07", "Logika programu")

    # --- centrální uvolnění ---
    top = ttk.Frame(body)
    top.pack(fill="x")
    ttk.Label(top, text="Centrální uvolnění (E-stop / bezpečnostní vstup):").pack(side="left")
    estop = {_dev_label(d): d["id"] for d in di}
    current = next((k for k, v in estop.items() if v == prog["estop"]), NO_ESTOP)
    var_estop = tk.StringVar(value=current)
    ttk.Combobox(top, textvariable=var_estop, values=[NO_ESTOP, *estop], state="readonly",
                 width=44).pack(side="left", padx=(8, 0))

    def on_estop(*_):
        app.prj["program"]["estop"] = estop.get(var_estop.get(), "")
        app.save()

    var_estop.trace_add("write", on_estop)
    note_box(body, "Signál se zapojí do enable všech bloků. Skutečnou bezpečnost řeší safety "
             "technika (bezpečnostní relé / safety PLC dle posouzení rizik), ne program — "
             "E-stop je v programu jen informativní signál. Viz Nápověda.", warn=True)

    ttk.Label(body, text="Automatická sekvence (volitelné)", style="Section.TLabel"
              ).pack(anchor="w", pady=(14, 0))
    wrap_label(body, "Kroky se provedou po řadě v režimu AUTO; generuje se z nich stavový "
               "automat (CASE). Přechod = zpětné hlášení, nebo čas.")

    # --- přidání kroku (zdola) ---
    add = ttk.Frame(body)
    add.pack(side="bottom", fill="x", pady=(8, 0))
    devs = {_dev_label(d): d for d in act}
    var_dev = tk.StringVar(value=next(iter(devs), WAIT))
    var_act = tk.StringVar()
    var_cond = tk.StringVar(value=COND_LABEL["fbk"])
    var_time = tk.StringVar(value="3")
    ttk.Combobox(add, textvariable=var_dev, values=[*devs, WAIT], state="readonly", width=36
                 ).pack(side="left")
    cb_act = ttk.Combobox(add, textvariable=var_act, state="readonly", width=10)
    cb_act.pack(side="left", padx=(6, 0))
    cb_cond = ttk.Combobox(add, textvariable=var_cond, values=list(COND_LABEL.values()),
                           state="readonly", width=24)
    cb_cond.pack(side="left", padx=(6, 0))
    ttk.Spinbox(add, textvariable=var_time, from_=1, to=3600, width=6).pack(side="left", padx=(6, 2))
    ttk.Label(add, text="s").pack(side="left")

    def refresh_acts(*_):
        d = devs.get(var_dev.get())
        keys = ["wait"] if d is None else ["start", "stop"] if d["cls"] == "Motor" else ["open", "close"]
        cb_act.configure(values=[ACT_LABEL[k] for k in keys])
        var_act.set(ACT_LABEL[keys[0]])
        cb_cond.state(["disabled"] if d is None else ["!disabled"])

    var_dev.trace_add("write", refresh_acts)
    refresh_acts()

    def add_step() -> None:
        d = devs.get(var_dev.get())
        try:
            time_s = max(1.0, float(var_time.get().replace(",", ".")))
        except ValueError:
            time_s = 1.0
        act_key = next(k for k, v in ACT_LABEL.items() if v == var_act.get())
        cond = next(k for k, v in COND_LABEL.items() if v == var_cond.get())
        seq = app.prj["program"]["seq"]
        seq.append({"dev": d["id"] if d else 0, "act": act_key if d else "wait",
                    "cond": cond if d else "time",
                    "timeS": int(time_s) if time_s.is_integer() else time_s})
        app.ui["seq_sel"] = len(seq) - 1
        app.save()
        app.render()

    ttk.Button(add, text="Přidat krok", style="Accent.TButton", command=add_step
               ).pack(side="left", padx=(10, 0))

    # --- seznam kroků ---
    mid = ttk.Frame(body)
    mid.pack(fill="both", expand=True, pady=(6, 0))
    side = ttk.Frame(mid)
    side.pack(side="right", fill="y", padx=(8, 0))
    tbl = Table(mid, [("n", "Krok", 70, False), ("txt", "Akce a přechod", 600, True)], height=8)
    tbl.pack(side="left", fill="both", expand=True)
    seq = prog["seq"]
    for i, s in enumerate(seq):
        tbl.add(i, (f"Krok {i + 1}", step_text(app, s)))
    if not seq:
        tbl.add("empty", ("", "Bez sekvence se vygenerují jen instance zařízení s TODO povely "
                          "pro ruční režim."), tags=("dim",))
    tbl.select(app.ui.get("seq_sel"))

    def sel() -> int | None:
        iid = tbl.selected()
        return int(iid) if iid is not None and iid.isdigit() else None

    def move(delta: int) -> None:
        i, steps = sel(), app.prj["program"]["seq"]
        if i is None or not 0 <= i + delta < len(steps):
            return
        steps[i], steps[i + delta] = steps[i + delta], steps[i]
        app.ui["seq_sel"] = i + delta
        app.save()
        app.render()

    def remove() -> None:
        i = sel()
        if i is None:
            app.set_status("Nejdřív vyber krok v tabulce.")
            return
        del app.prj["program"]["seq"][i]
        app.ui["seq_sel"] = min(i, len(app.prj["program"]["seq"]) - 1)
        app.save()
        app.render()

    ttk.Button(side, text="↑ Nahoru", command=lambda: move(-1)).pack(fill="x")
    ttk.Button(side, text="↓ Dolů", command=lambda: move(1)).pack(fill="x", pady=(4, 0))
    ttk.Button(side, text="× Odstranit", style="Danger.TButton", command=remove
               ).pack(fill="x", pady=(12, 0))
    tbl.tv.bind("<Delete>", lambda _e: remove())
