"""Simulace procesu a ověření programu (záložka kroku Program).

Simulátor je v jádře (``packages/core/src/sim.ts``) a provádí stejnou logiku,
jakou generuje kód; tady se výsledek jen přehrává: aktivní krok na funkčním
diagramu, stavy zařízení, časový diagram a protokol nálezů z ověření.
"""

from __future__ import annotations

import bisect
import json

import tkinter as tk
from tkinter import font as tkfont
from tkinter import ttk

from .. import theme
from ..i18n import N_, _
from ..project import parse_num
from ..svgview import SvgView
from ..widgets import Table, link, note_box, save_file, scrolled_text, set_text, wrap_label

SPEEDS = {"0,5×": 0.5, "1×": 1.0, "2×": 2.0, "5×": 5.0, "10×": 10.0}
LEVEL = {"ok": (N_("✔ v pořádku"), "lv_ok"), "info": (N_("ℹ informace"), "lv_info"),
         "warn": (N_("⚠ upozornění"), "lv_warn"), "error": (N_("✖ chyba"), "lv_err")}
TICK_MS = 40
ON, OFF = "●", "○"
SIG = {"fbkRunning": N_("běh"), "fault": N_("porucha"), "fbkOpen": N_("otevřeno"),
       "fbkClosed": N_("zavřeno")}


def _fault_step(run: dict) -> int | None:
    """Krok, ve kterém vznikla porucha stroje: krok s vypršelým časem, jinak
    krok, který běžel v okamžiku chyby bloku."""
    if run["faultStep"] is not None:
        return run["faultStep"]
    live = [r["i"] for r in run["steps"] if r["tStart"] <= run["faultT"] + 1e-9]
    return live[-1] if live else None


def _num(text: str, default: float) -> float:
    v = parse_num(text)                   # „inf“ / „nan“ by projekt rozbily (JSON)
    return default if v is None else min(600.0, max(0.05, v))


def build(app, parent) -> None:
    data = app.bridge.request("scenarios", prj=app.prj)
    app.prj = data["prj"]
    scenarios: list[dict] = data["scenarios"]
    seq = app.prj["program"]["seq"]
    if not seq:
        wrap_label(parent, _(
            "Projekt nemá automatickou sekvenci — není co simulovat. Přidej kroky "
            "v záložce Logika; simulace pak ověří, že cyklus doběhne, a zkusí poruchy."))
        return
    ui = app.ui
    by_label = {s["label"]: s for s in scenarios}
    by_id = {s["id"]: s for s in scenarios}
    st = {"run": None, "t": 0.0, "frame": -1, "playing": False, "job": None, "log_n": 0,
          "times": [], "cursor": None}
    fbs = [d for d in app.prj["devices"] if d["cls"] in ("Motor", "Ventil")]
    estop = app.dev_by_id(app.prj["program"]["estop"])
    enable_src = " AND ".join(d["name"] for d in app.prj["devices"]
                              if (estop and d["id"] == estop["id"])
                              or (d["cls"] == "DI" and d["id"] in (app.prj["program"].get("interlocks") or [])))

    # ---------------------------------------------------------------- ovládání
    bar = ttk.Frame(parent)
    bar.pack(fill="x")
    ttk.Label(bar, text=_("Scénář:")).pack(side="left")
    start = by_id.get(ui.get("sim_scenario"), scenarios[0])
    var_sc = tk.StringVar(value=start["label"])
    cb_sc = ttk.Combobox(bar, textvariable=var_sc, values=list(by_label), state="readonly",
                         width=40)
    cb_sc.pack(side="left", padx=(6, 10))
    b_play = ttk.Button(bar, text=_("▶ Spustit"), style="Accent.TButton",
                        width=max(11, len(_("▶ Spustit")) + 2, len(_("⏸ Pauza")) + 2))
    b_play.pack(side="left")
    ttk.Button(bar, text="⏮", width=3, command=lambda: (pause(), seek(0.0))
               ).pack(side="left", padx=(4, 0))
    ttk.Button(bar, text="⏭", width=3, command=lambda: (pause(), seek(st["run"]["tEnd"]))
               ).pack(side="left", padx=(4, 0))
    ttk.Label(bar, text=_("Rychlost:")).pack(side="left", padx=(12, 0))
    var_speed = tk.StringVar(value=ui.get("sim_speed", "2×"))
    ttk.Combobox(bar, textvariable=var_speed, values=list(SPEEDS), state="readonly", width=5
                 ).pack(side="left", padx=(6, 0))
    var_speed.trace_add("write", lambda *_a: ui.__setitem__("sim_speed", var_speed.get()))

    # model stroje — ukládá se do projektu, takže platí i pro protokol v dokumentaci;
    # stojí v řádku s časovou osou (v liště scénáře se v užším okně nevejde)
    trow = ttk.Frame(parent)
    trow.pack(fill="x", pady=(6, 2))
    model = app.prj.get("sim") or {}
    var_motor = tk.StringVar(value=f"{model.get('motorDelay', 0.5):g}")
    var_valve = tk.StringVar(value=f"{model.get('valveTravel', 1.0):g}")
    ttk.Label(trow, text="s").pack(side="right")
    e_valve = ttk.Entry(trow, textvariable=var_valve, width=5)
    e_valve.pack(side="right", padx=4)
    ttk.Label(trow, text="s, " + _("přestavení ventilu")).pack(side="right")
    e_motor = ttk.Entry(trow, textvariable=var_motor, width=5)
    e_motor.pack(side="right", padx=4)
    ttk.Label(trow, text=_("Model stroje: rozběh motoru")).pack(side="right", padx=(16, 0))

    def apply_model(_e=None) -> None:
        old = {"motorDelay": model.get("motorDelay", 0.5), "valveTravel": model.get("valveTravel", 1.0)}
        # neplatný text = beze změny (dřív se tiše vrátil výchozí čas, ne ten zadaný)
        new = {"motorDelay": _num(var_motor.get(), old["motorDelay"]),
               "valveTravel": _num(var_valve.get(), old["valveTravel"])}
        if new == old:
            var_motor.set(f"{old['motorDelay']:g}")
            var_valve.set(f"{old['valveTravel']:g}")
        else:
            app.prj["sim"] = new
            ui.pop("verify", None)
            app.save()
            app.render()                      # scénáře závisí na časech běžného cyklu

    for e in (e_motor, e_valve):
        e.bind("<Return>", apply_model)
        e.bind("<FocusOut>", apply_model)

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
    nb.add(t_run, text=_("Průběh cyklu"))
    right = ttk.Frame(t_run, width=430)
    right.pack(side="right", fill="y", padx=(10, 0))
    right.pack_propagate(False)
    ttk.Label(right, text=_("Stav zařízení"), style="Section.TLabel").pack(anchor="w")
    states = Table(right, [("name", _("Zařízení"), 70, False),
                           ("state", _("Stav bloku"), 110, False),
                           ("out", _("Výstup"), 60, False),
                           ("fbk", _("Zpětná hlášení"), 170, True)],
                   height=min(9, len(fbs) + 1))
    states.pack(fill="x", pady=(2, 8))
    states.tv.tag_configure("err", foreground=theme.ERR)
    states.tv.tag_configure("on", foreground=theme.STATE_ON)
    states.tv.tag_configure("off", foreground=theme.DIM)
    states.add("enable", ("enable", "", "", ""))
    for d in fbs:
        states.add(d["id"], (d["name"], "", "", ""))
    states.tv.bind("<Double-1>", lambda _e: (
        app.open_device(int(states.selected())) if (states.selected() or "").isdigit() else None))
    ttk.Label(right, text=_("Události"), style="Section.TLabel").pack(anchor="w")
    log_frm, log = scrolled_text(right, readonly=True, height=8, font=("Consolas", 9))
    log_frm.pack(fill="both", expand=True, pady=(2, 0))
    log.tag_configure("err", foreground=theme.ERR)
    log.tag_configure("seq", foreground=theme.PRIMARY, font=("Consolas", 9, "bold"))
    log.tag_configure("dev", foreground=theme.FG)
    log.tag_configure("info", foreground=theme.DIM)
    hang = tkfont.Font(font=("Consolas", 9)).measure("0" * 11)   # zalomený řádek pod text,
    for tag in ("err", "seq", "dev", "info"):                     # ne pod sloupec času
        log.tag_configure(tag, lmargin2=hang)

    def frame() -> dict | None:
        run = st["run"]
        return run["frames"][st["frame"]] if run and st["frame"] >= 0 else None

    def mark_flow(meta: dict) -> str | None:
        fr = frame()
        if fr is None or "step" not in meta:
            return None
        i = meta["step"]
        run = st["run"]
        if run["faulted"] and st["t"] >= run["faultT"] - 1e-9 and i == _fault_step(run):
            return "err"                      # krok, ve kterém vznikla porucha stroje
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
    nb.add(t_time, text=_("Časový diagram"))

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
    wrap_label(t_time, _("Klik na signál = řádek v I/O, klik na krok = skok v čase. Svislá čára = "
                         "aktuální čas přehrávání."), side="bottom", pady=(6, 0))
    view_time.pack(fill="both", expand=True)       # až po nápovědě (ta má přednost)

    # ---------------------------------------------------------------- ověření
    t_ver = ttk.Frame(nb, padding=8)
    nb.add(t_ver, text=_("Ověření programu"))
    vbar = ttk.Frame(t_ver)
    vbar.pack(fill="x")
    b_verify = ttk.Button(vbar, text=_("Ověřit program"), style="Accent.TButton")
    b_verify.pack(side="left")
    ttk.Button(vbar, text=_("Uložit protokol (MD)…"),
               command=lambda: save_file(app, "08_overeni_simulaci.md",
                                         app.core("docVerifyMd", app.prj))
               ).pack(side="left", padx=(6, 0))
    summary = ttk.Label(vbar, text=_("Spustí běžný cyklus a všechny poruchové scénáře."),
                        style="Dim.TLabel")
    summary.pack(side="left", padx=12)
    note_box(t_ver, _(
        "Simulace ověřuje návrh proti modelu generovaných bloků (stavové automaty "
        "a timeouty shodné s Gen_Library) a zjednodušenému modelu stroje. Neověřuje kód "
        "přeložený v cílovém IDE, HW konfiguraci ani bezpečnostní funkce — nenahrazuje "
        "test v simulátoru platformy a FAT."), warn=True, side="bottom")
    ver_nb = ttk.Notebook(t_ver)                  # nálezy | matice stavů
    ver_nb.pack(fill="both", expand=True, pady=(8, 0))
    t_checks = ttk.Frame(ver_nb, padding=4)
    ver_nb.add(t_checks, text=_("Nálezy"))
    t_matrix = ttk.Frame(ver_nb, padding=4)
    ver_nb.add(t_matrix, text=_("Matice stavů"))
    ver_nb.select(min(ui.get("ver_tab", 0), 1))   # otevřená matice přežije překreslení
    ver_nb.bind("<<NotebookTabChanged>>",
                lambda _e: ui.__setitem__("ver_tab", ver_nb.index(ver_nb.select())))
    # detail vybraného nálezu patří k nálezům — v záložce matice by jen bral místo
    det = ttk.Frame(t_checks)
    det.pack(side="bottom", fill="x", pady=(8, 0))
    det_txt = ttk.Label(det, text="", justify="left")
    det_txt.pack(anchor="w", fill="x")
    det_txt.bind("<Configure>", lambda e: det_txt.configure(wraplength=max(200, e.width - 8)))
    det_links = ttk.Frame(det)
    det_links.pack(anchor="w", pady=(4, 0))
    checks_tbl = Table(t_checks, [("lvl", _("Výsledek"), 110, False),
                                  ("title", _("Nález"), 700, True)], height=8)
    checks_tbl.pack(fill="both", expand=True)
    matrix_hint = ttk.Label(t_matrix, style="Dim.TLabel", justify="left", text=_(
        "V klidu a v každém kroku se vyzkouší každý zásah. ✔ = reakce odpovídá konceptu "
        "(stroj zastaven, porucha vyhlášena, nový start zablokovaný), ✖ = neodpovídá, "
        "— = kombinace nedává smysl. Dvojklik na buňku přehraje kombinaci."))
    matrix_hint.pack(fill="x", pady=(0, 4))
    matrix_hint.bind("<Configure>", lambda e: matrix_hint.configure(wraplength=max(200, e.width - 8)))

    def fit_matrix(e) -> None:
        """Nízké okno: vysvětlivku matice schovat, ať zbude místo na řádky."""
        if e.height < 220 and matrix_hint.winfo_manager():
            matrix_hint.pack_forget()
        elif e.height >= 220 and not matrix_hint.winfo_manager():
            matrix_hint.pack(fill="x", pady=(0, 4), before=matrix_box)

    t_matrix.bind("<Configure>", fit_matrix)
    matrix_box = ttk.Frame(t_matrix)
    matrix_box.pack(fill="both", expand=True)
    mx: dict = {"tbl": None, "data": None}
    for _text, tag in LEVEL.values():
        checks_tbl.tv.tag_configure(tag, foreground={
            "lv_ok": theme.OK, "lv_info": theme.DIM, "lv_warn": theme.WARN,
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
            link(det_links, _("Přehrát scénář ↗"), lambda: play_scenario(c["scenario"])
                 ).pack(side="left", padx=(0, 14))
        if c.get("dev") is not None:
            link(det_links, _("Zařízení ↗"), lambda: app.open_device(c["dev"])
                 ).pack(side="left", padx=(0, 14))
        if c.get("step") is not None:
            link(det_links, _("Krok v programu ↗"), lambda: app.open_program(c["step"])
                 ).pack(side="left")

    def fill_checks(res: dict) -> None:
        checks[:] = res["checks"]
        checks_tbl.clear()
        for i, c in enumerate(checks):
            text, tag = LEVEL[c["level"]]
            checks_tbl.add(i, (_(text), c["title"]), tags=(tag,))
        n = {k: sum(c["level"] == k for c in checks) for k in LEVEL}
        summary.configure(
            style="Ok.TLabel" if res["ok"] else "Err.TLabel",
            text=(_("Výsledek: bez chyb") if res["ok"] else _("Výsledek: NALEZENY CHYBY"))
            + " — " + _("{ok} v pořádku, {warn} upozornění, {err} chyb",
                        ok=n["ok"], warn=n["warn"], err=n["error"]))
        if checks:
            checks_tbl.select(0)
        show_check()
        fill_matrix(res["matrix"])
        for sc in res["scenarios"]:                 # scénáře z nálezů matice jdou přehrát
            add_scenario(sc)

    def fill_matrix(m: dict) -> None:
        for w in matrix_box.winfo_children():
            w.destroy()
        mx["data"] = m
        cols = [("state", _("Stav"), 220, False)] + [
            (c["id"], c["label"], max(70, 8 * len(c["label"])), True) for c in m["cols"]]
        tbl = mx["tbl"] = Table(matrix_box, cols, height=8)
        tbl.pack(fill="both", expand=True)
        tbl.tv.tag_configure("bad", foreground=theme.ERR)
        for i, r in enumerate(m["rows"]):
            cells = [r["cells"].get(c["id"], {"text": "—"})["text"] for c in m["cols"]]
            bad = any(r["cells"].get(c["id"], {}).get("ok") is False for c in m["cols"])
            tbl.add(i, (r["title"], *cells), tags=("bad",) if bad else ())
        tbl.tv.bind("<Double-1>", play_cell)

    def play_cell(e) -> None:
        tbl, m = mx["tbl"], mx["data"]
        row, col = tbl.tv.identify_row(e.y), tbl.tv.identify_column(e.x)
        if not row.isdigit() or not col.startswith("#"):
            return
        k = int(col[1:]) - 2                       # #1 = sloupec stavu
        if 0 <= k < len(m["cols"]):
            cell = m["rows"][int(row)]["cells"].get(m["cols"][k]["id"]) or {}
            if cell.get("scenario"):
                add_scenario(cell["scenario"])
                play_scenario(cell["scenario"]["id"])

    def verify(manual: bool = False) -> None:
        key = json.dumps(app.prj, sort_keys=True)
        cached = ui.get("verify")
        if manual and cached and cached[0] == key:
            # tlačítko jinak nedá žádnou odezvu (výsledek se nezměnil)
            app.set_status(_("Ověření je aktuální — návrh se od posledního ověření nezměnil."))
        if not cached or cached[0] != key:
            summary.configure(text=_("Ověřuji…"), style="Dim.TLabel")
            parent.update_idletasks()
            cached = ui["verify"] = (key, app.bridge.request("verify", prj=app.prj))
        fill_checks(cached[1])

    def add_scenario(sc: dict) -> None:
        """Doplní scénář (např. z matice stavů) do nabídky přehrávače."""
        if sc["id"] not in by_id:
            by_id[sc["id"]] = by_label[sc["label"]] = sc
            cb_sc.configure(values=list(by_label))

    def play_scenario(sc_id: str) -> None:
        if sc_id in by_id:
            var_sc.set(by_id[sc_id]["label"])
            nb.select(0)
            play()

    b_verify.configure(command=lambda: verify(manual=True))
    checks_tbl.tv.bind("<<TreeviewSelect>>", show_check)
    checks_tbl.tv.bind("<Double-1>", lambda _e: (
        play_scenario(checks[int(checks_tbl.selected())].get("scenario") or "")
        if (checks_tbl.selected() or "").isdigit() else None))

    # ---------------------------------------------------------------- přehrávání
    def update_states(fr: dict) -> None:
        io = fr["io"]
        ok = fr["enable"] and not fr["fault"]
        states.tv.item("enable", values=(
            _("stroj"),
            _("E-STOP") if not fr["enable"] else _("PORUCHA") if fr["fault"] else _("uvolněno"),
            ON if fr["enable"] else OFF,
            "enable: " + (enable_src or _("trvale TRUE"))),
            tags=() if ok else ("err",))
        for d in fbs:
            s = fr["dev"][str(d["id"])]
            mine = [e for e in app.prj["io"] if e["devId"] == d["id"]]
            out = next((e for e in mine if e["dir"] == "DO"), None)
            on = bool(out and io.get(out["key"]))
            fb = "  ".join(f"{_(SIG[e['sig']]) if e['sig'] in SIG else e['sig']} "
                           f"{ON if io.get(e['key']) else OFF}"
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
        b_play.configure(text=_("▶ Spustit"))

    def play() -> None:
        if st["t"] >= st["run"]["tEnd"] - 1e-9:
            seek(0.0)
        st["playing"] = True
        b_play.configure(text=_("⏸ Pauza"))
        if st["job"] is None:
            st["job"] = parent.after(TICK_MS, tick)

    def verdict_text(run: dict) -> tuple[str, str]:
        names = sorted({app.dev_by_id(e["dev"])["name"] for e in run["errors"]})
        tags = {e["key"]: e["tag"] for e in app.prj["io"]}
        left = ", ".join(tags.get(k, k) for k in run["outputsOn"])
        on = " " + (_("Sepnuté výstupy na konci: {tags}.", tags=left) if left
                    else _("Na konci jsou všechny výstupy vypnuté."))
        if run["ok"]:
            return (_("✔ Cyklus doběhl do konce za {t} s.", t=f"{run['cycleTime']:g}") + on,
                    "Ok.TLabel")
        kinds = {f["kind"] for f in run["opts"]["faults"]}
        stop = ("estop" in kinds and _("■ Cyklus přerušen nouzovým zastavením.")
                or "interlock" in kinds and _("■ Cyklus přerušen rozpojením blokování.")
                or "manual" in kinds and _("■ Cyklus přerušen vypnutím režimu AUTO."))
        if stop and not run["faulted"]:
            # přerušení zásahem je záměr scénáře, ne chyba — podstatné je, co zůstalo sepnuté
            return stop + on, "Err.TLabel" if left else "Section.TLabel"
        if run["faulted"]:
            text = _("✖ Porucha stroje v čase {t} s: {cause}.", t=f"{run['faultT']:g}",
                     cause=run["faultCause"])
            if run["finished"] and not run["fault"]:
                # scénář s kvitací: porucha byla zrušena a cyklus znovu proběhl
                return (text + " " + _("Po kvitaci nový cyklus doběhl za {t} s.",
                                       t=f"{run['cycleTime']:g}") + on, "Ok.TLabel")
            return (text + " " + _("Sekvence se vrátila do klidu a čeká na kvitaci.") + on,
                    "Err.TLabel")
        parts = []
        if run["stalledStep"] is not None:
            parts.append(_("sekvence stojí v kroku {n}", n=run["stalledStep"] + 1))
        elif run["finished"]:
            parts.append(_("cyklus doběhl za {t} s", t=f"{run['cycleTime']:g}"))
        else:
            parts.append(_("cyklus se nedokončil"))
        if names:
            parts.append(_("porucha bloku: {names}", names=", ".join(names)))
        return "✖ " + "; ".join(parts) + "." + on, "Err.TLabel"

    def load(*_a) -> None:
        pause()
        sc = by_label[var_sc.get()]
        ui["sim_scenario"] = sc["id"]
        res = app.bridge.request("simulate", prj=app.prj, opts=sc["opts"])
        run = st["run"] = res["run"]
        st.update(t=0.0, frame=-1, log_n=0, times=[f["t"] for f in run["frames"]])
        set_text(log, "")
        scale.configure(to=max(run["tEnd"], 0.1))
        text, style = verdict_text(run)
        verdict.configure(text=_("Scénář: {purpose}.", purpose=sc["purpose"]) + "  " + text,
                          style=style)
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
