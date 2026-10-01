"""Simulace procesu a ověření programu (záložka kroku Program).

Simulátor je v jádře (``packages/core/src/sim.ts``) a provádí stejnou logiku,
jakou generuje kód; tady se výsledek jen přehrává: aktivní krok na funkčním
diagramu, stavy zařízení, časový diagram a protokol nálezů z ověření.
"""

from __future__ import annotations

import bisect
import json

import tkinter as tk
from tkinter import ttk

from .. import theme
from ..svgview import SvgView
from ..widgets import Table, link, note_box, save_file, scrolled_text, set_text, wrap_label

SPEEDS = {"0,5×": 0.5, "1×": 1.0, "2×": 2.0, "5×": 5.0, "10×": 10.0}
LEVEL = {"ok": ("✔ v pořádku", "lv_ok"), "info": ("ℹ informace", "lv_info"),
         "warn": ("⚠ upozornění", "lv_warn"), "error": ("✖ chyba", "lv_err")}
TICK_MS = 40
ON, OFF = "●", "○"
SIG = {"fbkRunning": "běh", "fault": "porucha", "fbkOpen": "otevřeno", "fbkClosed": "zavřeno"}


def _num(text: str, default: float) -> float:
    try:
        return max(0.05, float(text.replace(",", ".")))
    except ValueError:
        return default


def build(app, parent) -> None:
    data = app.bridge.request("scenarios", prj=app.prj)
    app.prj = data["prj"]
    scenarios: list[dict] = data["scenarios"]
    seq = app.prj["program"]["seq"]
    if not seq:
        wrap_label(parent, "Projekt nemá automatickou sekvenci — není co simulovat. Přidej kroky "
                   "v záložce Logika; simulace pak ověří, že cyklus doběhne, a zkusí poruchy.")
        return
    ui = app.ui
    by_label = {s["label"]: s for s in scenarios}
    by_id = {s["id"]: s for s in scenarios}
    st = {"run": None, "t": 0.0, "frame": -1, "playing": False, "job": None, "log_n": 0,
          "times": [], "cursor": None}
    fbs = [d for d in app.prj["devices"] if d["cls"] in ("Motor", "Ventil")]
    estop = app.dev_by_id(app.prj["program"]["estop"])

    # ---------------------------------------------------------------- ovládání
    bar = ttk.Frame(parent)
    bar.pack(fill="x")
    ttk.Label(bar, text="Scénář:").pack(side="left")
    start = by_id.get(ui.get("sim_scenario"), scenarios[0])
    var_sc = tk.StringVar(value=start["label"])
    ttk.Combobox(bar, textvariable=var_sc, values=list(by_label), state="readonly", width=40
                 ).pack(side="left", padx=(6, 10))
    b_play = ttk.Button(bar, text="▶ Spustit", style="Accent.TButton", width=11)
    b_play.pack(side="left")
    ttk.Button(bar, text="⏮", width=3, command=lambda: (pause(), seek(0.0))
               ).pack(side="left", padx=(4, 0))
    ttk.Button(bar, text="⏭", width=3, command=lambda: (pause(), seek(st["run"]["tEnd"]))
               ).pack(side="left", padx=(4, 0))
    ttk.Label(bar, text="Rychlost:").pack(side="left", padx=(12, 0))
    var_speed = tk.StringVar(value=ui.get("sim_speed", "2×"))
    ttk.Combobox(bar, textvariable=var_speed, values=list(SPEEDS), state="readonly", width=5
                 ).pack(side="left", padx=(6, 0))
    var_speed.trace_add("write", lambda *_: ui.__setitem__("sim_speed", var_speed.get()))

    # model stroje — ukládá se do projektu, takže platí i pro protokol v dokumentaci
    model = app.prj.get("sim") or {}
    var_motor = tk.StringVar(value=f"{model.get('motorDelay', 0.5):g}")
    var_valve = tk.StringVar(value=f"{model.get('valveTravel', 1.0):g}")
    ttk.Label(bar, text="s").pack(side="right")
    e_valve = ttk.Entry(bar, textvariable=var_valve, width=5)
    e_valve.pack(side="right", padx=4)
    ttk.Label(bar, text="s, přestavení ventilu").pack(side="right")
    e_motor = ttk.Entry(bar, textvariable=var_motor, width=5)
    e_motor.pack(side="right", padx=4)
    ttk.Label(bar, text="Model stroje: rozběh motoru").pack(side="right")

    def apply_model(_e=None) -> None:
        new = {"motorDelay": _num(var_motor.get(), 0.5), "valveTravel": _num(var_valve.get(), 1.0)}
        if new != {"motorDelay": model.get("motorDelay", 0.5), "valveTravel": model.get("valveTravel", 1.0)}:
            app.prj["sim"] = new
            ui.pop("verify", None)
            app.save()
            app.render()                      # scénáře závisí na časech běžného cyklu

    for e in (e_motor, e_valve):
        e.bind("<Return>", apply_model)
        e.bind("<FocusOut>", apply_model)

    trow = ttk.Frame(parent)
    trow.pack(fill="x", pady=(6, 2))
    time_lbl = ttk.Label(trow, text="", font=("Consolas", 10))
    time_lbl.pack(side="right", padx=(10, 0))
    var_t = tk.DoubleVar(value=0.0)
    scale = ttk.Scale(trow, from_=0.0, to=1.0, variable=var_t)
    scale.pack(side="left", fill="x", expand=True)
    verdict = ttk.Label(parent, text="", justify="left")
    verdict.pack(fill="x", pady=(0, 6))
    verdict.bind("<Configure>", lambda e: verdict.configure(wraplength=max(300, e.width - 8)))

    nb = ttk.Notebook(parent)
    nb.pack(fill="both", expand=True)

    # ---------------------------------------------------------------- průběh cyklu
    t_run = ttk.Frame(nb, padding=8)
    nb.add(t_run, text="Průběh cyklu")
    right = ttk.Frame(t_run, width=430)
    right.pack(side="right", fill="y", padx=(10, 0))
    right.pack_propagate(False)
    ttk.Label(right, text="Stav zařízení", style="Section.TLabel").pack(anchor="w")
    states = Table(right, [("name", "Zařízení", 70, False), ("state", "Stav bloku", 110, False),
                           ("out", "Výstup", 60, False), ("fbk", "Zpětná hlášení", 170, True)],
                   height=min(9, len(fbs) + 1))
    states.pack(fill="x", pady=(2, 8))
    states.tv.tag_configure("err", foreground=theme.ERR)
    states.tv.tag_configure("on", foreground=theme.ACCENT)
    states.tv.tag_configure("off", foreground=theme.DIM)
    states.add("enable", ("enable", "", "", ""))
    for d in fbs:
        states.add(d["id"], (d["name"], "", "", ""))
    states.tv.bind("<Double-1>", lambda _e: (
        app.open_device(int(states.selected())) if (states.selected() or "").isdigit() else None))
    ttk.Label(right, text="Události", style="Section.TLabel").pack(anchor="w")
    log_frm, log = scrolled_text(right, readonly=True, height=8, font=("Consolas", 9))
    log_frm.pack(fill="both", expand=True, pady=(2, 0))
    log.tag_configure("err", foreground=theme.ERR)
    log.tag_configure("seq", foreground=theme.PRIMARY, font=("Consolas", 9, "bold"))
    log.tag_configure("dev", foreground=theme.FG)
    log.tag_configure("info", foreground=theme.DIM)

    def frame() -> dict | None:
        run = st["run"]
        return run["frames"][st["frame"]] if run and st["frame"] >= 0 else None

    def mark_flow(meta: dict) -> str | None:
        fr = frame()
        if fr is None or "step" not in meta:
            return None
        i = meta["step"]
        if i == fr["step"]:
            dev = seq[i]["dev"] if i >= 0 else None
            bad = dev and fr["dev"].get(str(dev), {}).get("error")
            return "err" if bad else "active"
        done = [r for r in st["run"]["steps"] if r["i"] == i and r["tEnd"] is not None
                and r["tEnd"] <= st["t"] + 1e-9]
        return "done" if done else None

    view_flow = SvgView(t_run, marker=mark_flow,
                        on_click=lambda m: app.open_flow(m["step"]) if "step" in m else None)
    view_flow.pack(fill="both", expand=True)

    # ---------------------------------------------------------------- časový diagram
    t_time = ttk.Frame(nb, padding=8)
    nb.add(t_time, text="Časový diagram")

    def draw_cursor(canvas, _scale) -> None:
        x = view_time.time_x(st["t"])
        st["cursor"] = None if x is None else canvas.create_line(
            x, 0, x, view_time.height_px(), fill=theme.WARN, width=2)

    def click_time(meta: dict) -> None:
        if "io" in meta:
            app.open_io(meta["io"])
        elif "step" in meta:
            run = next(r for r in st["run"]["steps"] if r["i"] == meta["step"])
            pause()
            seek(run["tStart"])

    view_time = SvgView(t_time, overlay=draw_cursor, on_click=click_time)
    view_time.pack(fill="both", expand=True)
    ttk.Label(t_time, style="Dim.TLabel",
              text="Klik na signál = řádek v I/O, klik na krok = skok v čase. Svislá čára = "
                   "aktuální čas přehrávání.").pack(anchor="w", pady=(6, 0))

    # ---------------------------------------------------------------- ověření
    t_ver = ttk.Frame(nb, padding=8)
    nb.add(t_ver, text="Ověření programu")
    vbar = ttk.Frame(t_ver)
    vbar.pack(fill="x")
    b_verify = ttk.Button(vbar, text="Ověřit program", style="Accent.TButton")
    b_verify.pack(side="left")
    ttk.Button(vbar, text="Uložit protokol (MD)…",
               command=lambda: save_file(app, "08_overeni_simulaci.md",
                                         app.core("docVerifyMd", app.prj))
               ).pack(side="left", padx=(6, 0))
    summary = ttk.Label(vbar, text="Spustí běžný cyklus a všechny poruchové scénáře.",
                        style="Dim.TLabel")
    summary.pack(side="left", padx=12)
    note_box(t_ver, "Simulace ověřuje návrh proti modelu generovaných bloků (stavové automaty "
             "a timeouty shodné s Gen_Library) a zjednodušenému modelu stroje. Neověřuje kód "
             "přeložený v cílovém IDE, HW konfiguraci ani bezpečnostní funkce — nenahrazuje "
             "test v simulátoru platformy a FAT.", warn=True, side="bottom")
    det = ttk.Frame(t_ver)
    det.pack(side="bottom", fill="x", pady=(8, 0))
    det_txt = ttk.Label(det, text="", justify="left")
    det_txt.pack(anchor="w", fill="x")
    det_txt.bind("<Configure>", lambda e: det_txt.configure(wraplength=max(200, e.width - 8)))
    det_links = ttk.Frame(det)
    det_links.pack(anchor="w", pady=(4, 0))
    checks_tbl = Table(t_ver, [("lvl", "Výsledek", 110, False), ("title", "Nález", 700, True)],
                       height=8)
    checks_tbl.pack(fill="both", expand=True, pady=(8, 0))
    for _text, tag in LEVEL.values():
        checks_tbl.tv.tag_configure(tag, foreground={
            "lv_ok": theme.ACCENT, "lv_info": theme.DIM, "lv_warn": theme.WARN,
            "lv_err": theme.ERR}[tag])
    checks: list[dict] = []

    def show_check(_e=None) -> None:
        for w in det_links.winfo_children():
            w.destroy()
        iid = checks_tbl.selected()
        if iid is None or not iid.isdigit():
            det_txt.configure(text="")
            return
        c = checks[int(iid)]
        det_txt.configure(text=c["detail"])
        if c.get("scenario"):
            link(det_links, "Přehrát scénář ↗", lambda: play_scenario(c["scenario"])
                 ).pack(side="left", padx=(0, 14))
        if c.get("dev") is not None:
            link(det_links, "Zařízení ↗", lambda: app.open_device(c["dev"])
                 ).pack(side="left", padx=(0, 14))
        if c.get("step") is not None:
            link(det_links, "Krok v programu ↗", lambda: app.open_program(c["step"])
                 ).pack(side="left")

    def fill_checks(res: dict) -> None:
        checks[:] = res["checks"]
        checks_tbl.clear()
        for i, c in enumerate(checks):
            text, tag = LEVEL[c["level"]]
            checks_tbl.add(i, (text, c["title"]), tags=(tag,))
        n = {k: sum(c["level"] == k for c in checks) for k in LEVEL}
        summary.configure(
            style="Ok.TLabel" if res["ok"] else "Err.TLabel",
            text=("Výsledek: bez chyb" if res["ok"] else "Výsledek: NALEZENY CHYBY")
            + f" — {n['ok']} v pořádku, {n['warn']} upozornění, {n['error']} chyb")
        if checks:
            checks_tbl.select(0)
        show_check()

    def verify() -> None:
        key = json.dumps(app.prj, sort_keys=True)
        cached = ui.get("verify")
        if not cached or cached[0] != key:
            summary.configure(text="Ověřuji…", style="Dim.TLabel")
            parent.update_idletasks()
            cached = ui["verify"] = (key, app.bridge.request("verify", prj=app.prj))
        fill_checks(cached[1])

    def play_scenario(sc_id: str) -> None:
        if sc_id in by_id:
            var_sc.set(by_id[sc_id]["label"])
            nb.select(0)
            play()

    b_verify.configure(command=verify)
    checks_tbl.tv.bind("<<TreeviewSelect>>", show_check)
    checks_tbl.tv.bind("<Double-1>", lambda _e: (
        play_scenario(checks[int(checks_tbl.selected())].get("scenario") or "")
        if (checks_tbl.selected() or "").isdigit() else None))

    # ---------------------------------------------------------------- přehrávání
    def update_states(fr: dict) -> None:
        io = fr["io"]
        states.tv.item("enable", values=("enable", "uvolněno" if fr["enable"] else "E-STOP",
                                         ON if fr["enable"] else OFF,
                                         estop["name"] if estop else "trvale TRUE"),
                       tags=() if fr["enable"] else ("err",))
        for d in fbs:
            s = fr["dev"][str(d["id"])]
            mine = [e for e in app.prj["io"] if e["devId"] == d["id"]]
            out = next((e for e in mine if e["dir"] == "DO"), None)
            on = bool(out and io.get(out["key"]))
            fb = "  ".join(f"{SIG.get(e['sig'], e['sig'])} {ON if io.get(e['key']) else OFF}"
                           for e in mine if e["dir"] == "DI")
            states.tv.item(str(d["id"]), values=(d["name"], s["label"], ON if on else OFF, fb),
                           tags=("err",) if s["error"] else ("on",) if on else ("off",))

    def update_log(t: float) -> None:
        events = st["run"]["events"]
        n = bisect.bisect_right([e["t"] for e in events], t + 1e-9)
        if n == st["log_n"]:
            return
        log.configure(state="normal")
        if n < st["log_n"]:
            log.delete("1.0", "end")
            st["log_n"] = 0
        for e in events[st["log_n"]:n]:
            log.insert("end", f"{e['t']:7.2f} s  {e['msg']}\n", e["kind"])
        log.configure(state="disabled")
        log.see("end")
        st["log_n"] = n

    def seek(t: float) -> None:
        run = st["run"]
        t = min(max(t, 0.0), run["tEnd"])
        st["t"] = t
        var_t.set(t)
        time_lbl.configure(text=f"t = {t:6.2f} s / {run['tEnd']:.2f} s")
        idx = max(0, bisect.bisect_right(st["times"], t + 1e-9) - 1)
        if idx != st["frame"]:
            st["frame"] = idx
            fr = run["frames"][idx]
            update_states(fr)
            view_flow.refresh()
            view_flow.see(lambda m: m.get("step") == fr["step"])
        update_log(t)
        x = view_time.time_x(t)
        if st["cursor"] is not None and x is not None:
            view_time.canvas.coords(st["cursor"], x, 0, x, view_time.height_px())

    def tick() -> None:
        st["job"] = None
        if not st["playing"] or not parent.winfo_exists():
            return
        seek(st["t"] + TICK_MS / 1000 * SPEEDS.get(var_speed.get(), 1.0))
        if st["t"] >= st["run"]["tEnd"] - 1e-9:
            pause()
        else:
            st["job"] = parent.after(TICK_MS, tick)

    def pause() -> None:
        st["playing"] = False
        if st["job"] is not None:
            parent.after_cancel(st["job"])
            st["job"] = None
        b_play.configure(text="▶ Spustit")

    def play() -> None:
        if st["t"] >= st["run"]["tEnd"] - 1e-9:
            seek(0.0)
        st["playing"] = True
        b_play.configure(text="⏸ Pauza")
        if st["job"] is None:
            st["job"] = parent.after(TICK_MS, tick)

    def verdict_text(run: dict) -> tuple[str, str]:
        names = sorted({app.dev_by_id(e["dev"])["name"] for e in run["errors"]})
        tags = {e["key"]: e["tag"] for e in app.prj["io"]}
        left = ", ".join(tags.get(k, k) for k in run["outputsOn"])
        on = f" Sepnuté výstupy na konci: {left}." if left else " Na konci jsou všechny výstupy vypnuté."
        if run["ok"]:
            return f"✔ Cyklus doběhl do konce za {run['cycleTime']:g} s.{on}", "Ok.TLabel"
        if any(f["kind"] == "estop" for f in run["opts"]["faults"]):
            # přerušení E-stopem je záměr scénáře, ne chyba — podstatné je, co zůstalo sepnuté
            return (f"■ Cyklus přerušen nouzovým zastavením.{on}",
                    "Err.TLabel" if left else "Section.TLabel")
        parts = []
        if run["stalledStep"] is not None:
            parts.append(f"sekvence stojí v kroku {run['stalledStep'] + 1}")
        elif run["finished"]:
            parts.append(f"cyklus doběhl za {run['cycleTime']:g} s")
        else:
            parts.append("cyklus se nedokončil")
        if names:
            parts.append("porucha bloku: " + ", ".join(names))
        return "✖ " + "; ".join(parts) + "." + on, "Err.TLabel"

    def load(*_) -> None:
        pause()
        sc = by_label[var_sc.get()]
        ui["sim_scenario"] = sc["id"]
        res = app.bridge.request("simulate", prj=app.prj, opts=sc["opts"])
        run = st["run"] = res["run"]
        st.update(t=0.0, frame=-1, log_n=0, times=[f["t"] for f in run["frames"]])
        set_text(log, "")
        scale.configure(to=max(run["tEnd"], 0.1))
        text, style = verdict_text(run)
        verdict.configure(text=f"Scénář: {sc['purpose']}.  {text}", style=style)
        view_flow.show(res["flow"])
        view_time.show(res["timing"])
        seek(0.0)

    b_play.configure(command=lambda: pause() if st["playing"] else play())
    scale.configure(command=lambda v: (pause(), seek(float(v))))
    var_sc.trace_add("write", load)
    load()
    seek(st["run"]["tEnd"])                     # výchozí pohled = výsledek scénáře

    def on_tab(_e=None) -> None:
        ui["sim_tab"] = nb.index(nb.select())
        if ui["sim_tab"] == 2 and not checks:
            verify()                            # ověření se počítá, až když je potřeba

    nb.bind("<<NotebookTabChanged>>", on_tab)
    nb.select(min(ui.get("sim_tab", 0), 2))
