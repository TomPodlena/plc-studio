"""Živá simulace (záložka kroku Program): systém ovládaný tlačítky.

Simulátor běží v jádře (``Simulator`` v ``sim.ts``) a drží ho proces mostu;
tady se jen krokuje v reálném čase, posílá stav tlačítek a kreslí odezva.
Dva pohledy na totéž: grafické schéma systému (``mimic.py`` — symboly zařízení
propojené vodiči s moduly PLC, animovaná funkce) a bloky zařízení se signály.

Tlačítka odpovídají proměnným generovaného programu: ``modeAuto``,
``cmdAutoStart``, ``cmdAck``, centrální uvolnění a ruční povely
``manRun_*`` / ``manOpen_*``. Zásahy do zařízení (zamrzlé hlášení, vstup
poruchy, volný vstup, analogová hodnota) simulují stroj, ne program.
Vstupy se ovládají i přímo ve schématu: tlačítko na každém digitálním vstupu
vnutí hodnotu bez ohledu na stroj (``controls["force"]``), potenciometr
analogového snímače nastaví jeho hodnotu (``controls["ai"]``).
"""

from __future__ import annotations

import tkinter as tk
from tkinter import font as tkfont
from tkinter import ttk

from .. import theme
from ..bridge import BridgeError
from ..i18n import _
from ..mimic import Mimic, dev_mark
from ..svgview import SvgView
from ..widgets import link, scrolled_text, set_text, wrap_label

TICK_MS = 50
SPEEDS = {"0,5×": 0.5, "1×": 1.0, "2×": 2.0, "5×": 5.0, "10×": 10.0}
ON, OFF = "●", "○"
STATE_KEYS = ("frame", "events", "stepTitle", "stepCount", "cycles", "lastCycleTime", "outputsOn")


def build(app, parent) -> None:
    ui = app.ui
    data = app.bridge.request("live.start", prj=app.prj)
    app.prj = data["prj"]
    prj = app.prj
    estop = app.dev_by_id(prj["program"]["estop"])
    has_seq = bool(data["stepCount"])
    io_of = {d["id"]: [e for e in prj["io"] if e["devId"] == d["id"]] for d in prj["devices"]}
    # vstupy centrálního uvolnění (E-stop + blokování) — jejich FALSE zastaví stroj
    locks = {i for i in prj["program"].get("interlocks") or []
             if (app.dev_by_id(i) or {}).get("cls") == "DI" and i != prj["program"]["estop"]}
    stop_devs = [d for d in prj["devices"] if d["id"] in locks or (estop and d["id"] == estop["id"])]
    stop_key = {d["id"]: io_of[d["id"]][0]["key"] for d in stop_devs if io_of[d["id"]]}
    stop_devs = [d for d in stop_devs if d["id"] in stop_key]
    st = {"res": {k: data[k] for k in STATE_KEYS}, "running": True, "job": None, "key": None,
          "start": False, "ack": False,
          "sel": ui.get("live_sel") if app.dev_by_id(ui.get("live_sel")) else None}
    controls = {"modeAuto": True, "estop": False, "frozen": [], "fault": [], "di": {},
                "man": {}, "ai": {}, "force": {}}

    # ---------------------------------------------------------------- ovládací lišta
    bar = ttk.Frame(parent)
    bar.pack(fill="x")
    var_auto = tk.BooleanVar(value=True)
    c_auto = ttk.Checkbutton(bar, text=_("režim AUTO"), variable=var_auto,
                             command=lambda: push(modeAuto=var_auto.get()))
    c_auto.pack(side="left")
    b_start = ttk.Button(bar, text=_("▶ START cyklu"), style="Accent.TButton")
    b_start.pack(side="left", padx=(10, 0))
    b_estop = ttk.Button(bar, text=_("⛔ E-STOP"), style="Danger.TButton")
    b_estop.pack(side="left", padx=(6, 0))
    b_ack = ttk.Button(bar, text=_("✔ Kvitace poruchy"))
    b_ack.pack(side="left", padx=(6, 0))
    if estop is None:
        b_estop.state(["disabled"])
    if not has_seq:
        b_start.state(["disabled"])       # bez sekvence není co startovat
        c_auto.state(["disabled"])        # a režimy se negenerují — platí jen ruční povely

    var_speed = tk.StringVar(value=ui.get("live_speed", "1×"))
    ttk.Combobox(bar, textvariable=var_speed, values=list(SPEEDS), state="readonly", width=5
                 ).pack(side="right")     # rychlost běhu času (1× = reálný čas)
    ttk.Button(bar, text=_("↺ Reset"), width=max(8, len(_("↺ Reset")) + 1), command=lambda: reset()
               ).pack(side="right", padx=(0, 6))
    ttk.Button(bar, text=_("+0,1 s"), width=max(6, len(_("+0,1 s")) + 1), command=lambda: advance(0.1)).pack(side="right", padx=(0, 4))
    # šířka podle delšího z obou přepínaných textů, ať tlačítko při přepnutí neskáče
    b_run = ttk.Button(bar, text=_("⏸ Zastavit čas"),
                       width=max(13, len(_("⏸ Zastavit čas")) - 1, len(_("▶ Pustit čas")) - 1))
    b_run.pack(side="right", padx=(0, 4))
    var_speed.trace_add("write", lambda *_a: ui.__setitem__("live_speed", var_speed.get()))

    info = ttk.Frame(parent)
    info.pack(fill="x", pady=(6, 6))
    lbl_seq = ttk.Label(info, text="", font=theme.FONT_ACCENT)
    lbl_seq.pack(side="left")
    lbl_state = ttk.Label(info, text="", style="Dim.TLabel")
    lbl_state.pack(side="right")

    wrap_label(parent, _("Porucha stroje (chyba bloku / vypršení hlídacího času kroku) zastaví "
                         "sekvenci a čeká na kvitaci") + " · "
               + _("ruční povely zařízení platí při vypnutém režimu AUTO"),
               side="bottom", pady=(6, 0))

    # ---------------------------------------------------------------- pravý panel
    side = ttk.Frame(parent, width=330)
    side.pack(side="right", fill="y", padx=(12, 0))
    side.pack_propagate(False)
    # zařízení se balí první (má přednost — zásahy nesmí v nízkém okně zmizet), log dostane zbytek
    ttk.Label(side, text=_("Vybrané zařízení"), style="Section.TLabel").pack(anchor="w")
    dev_box = ttk.Frame(side)
    dev_box.pack(fill="x", pady=(2, 0))
    ttk.Label(side, text=_("Události"), style="Section.TLabel").pack(anchor="w", pady=(8, 0))
    log_frm, log = scrolled_text(side, readonly=True, height=5, font=("Consolas", 9))
    log_frm.pack(fill="both", expand=True, pady=(2, 0))
    dev_state = {"label": None, "ai": None}
    log.tag_configure("err", foreground=theme.ERR)
    log.tag_configure("seq", foreground=theme.PRIMARY, font=("Consolas", 9, "bold"))
    log.tag_configure("dev", foreground=theme.FG)
    log.tag_configure("info", foreground=theme.DIM)
    hang = tkfont.Font(font=("Consolas", 9)).measure("0" * 11)   # zalomený řádek pod text,
    for tag in ("err", "seq", "dev", "info"):                     # ne pod sloupec času
        log.tag_configure(tag, lmargin2=hang)

    # ---------------------------------------------------------------- pohledy
    def frame() -> dict:
        return st["res"]["frame"]

    def mark(meta: dict) -> str | None:
        fr = frame()
        if "io" in meta:
            return "on" if fr["io"].get(meta["io"]) is True else None
        d = app.dev_by_id(meta.get("dev"))
        return dev_mark(d, fr, io_of[d["id"]]) if d is not None else None

    def outline_selected(canvas, _scale) -> None:
        """Rámeček kolem vybraného bloku (značky stavu zůstávají vidět)."""
        if st["sel"] is None:
            return
        for i, meta in enumerate(blocks.metas()):
            if meta.get("dev") == st["sel"] and "io" not in meta:
                box = canvas.bbox(f"m{i}")
                if box:
                    canvas.create_rectangle(box[0] - 4, box[1] - 4, box[2] + 4, box[3] + 4,
                                            outline=theme.PRIMARY, width=2, dash=(5, 3))
                return

    def select(dev_id: int) -> None:
        st["sel"] = ui["live_sel"] = dev_id
        show_device()
        mimic.select(dev_id)
        blocks.refresh()

    # ---------------------------------------------------------------- vstupy PLC
    def set_force(key: str | None, value: bool | None) -> None:
        """Vnutí vstupu hodnotu; ``value`` None = zpět na stroj, ``key`` None = uvolnit vše."""
        force = {} if key is None else {k: v for k, v in controls["force"].items() if k != key}
        if key is not None and value is not None:
            force[key] = value
        push(force=force)


    views = ttk.Notebook(parent)
    views.pack(fill="both", expand=True)
    t_mimic = ttk.Frame(views, padding=6)
    views.add(t_mimic, text=_("Schéma systému"))
    t_blocks = ttk.Frame(views, padding=6)
    views.add(t_blocks, text=_("Bloky zařízení"))
    mimic = Mimic(t_mimic, app, data["mods"], on_select=select, on_force=set_force,
                  on_analog=lambda key, raw: push(ai={**controls["ai"], key: raw}))
    mimic.pack(fill="both", expand=True)
    blocks = SvgView(t_blocks, on_click=lambda m: select(m["dev"]) if "dev" in m else None,
                     marker=mark, overlay=outline_selected)
    blocks.pack(fill="both", expand=True)
    blocks.show(data["machine"])
    views.select(min(ui.get("live_view", 0), 1))
    views.bind("<<NotebookTabChanged>>",
               lambda _e: (ui.__setitem__("live_view", views.index(views.select())),
                           blocks.refresh()))

    # ---------------------------------------------------------------- zásahy do zařízení
    def toggle(listname: str, dev_id: int, on: bool) -> None:
        items = [x for x in controls[listname] if x != dev_id] + ([dev_id] if on else [])
        push(**{listname: items})

    def show_device() -> None:
        for w in dev_box.winfo_children():
            w.destroy()
        dev_state["label"] = dev_state["ai"] = None
        d = app.dev_by_id(st["sel"])
        if d is None:
            ttk.Label(dev_box, text=_("Klikni na zařízení ve schématu."), style="Dim.TLabel"
                      ).pack(anchor="w")
            return
        wrap = 300
        ttk.Label(dev_box, text=f"{d['name']} · {app.CLS[d['cls']]['label']}",
                  font=theme.FONT_ACCENT).pack(anchor="w")
        ttk.Label(dev_box, text=d["desc"] or _("(bez popisu)"), style="Dim.TLabel",
                  wraplength=wrap, justify="left").pack(anchor="w")
        dev_state["label"] = ttk.Label(dev_box, text="", justify="left", wraplength=wrap)
        dev_state["label"].pack(anchor="w", pady=(4, 2))
        sigs = {e["sig"]: e for e in io_of[d["id"]]}

        def check(text: str, value: bool, command) -> tk.BooleanVar:
            var = tk.BooleanVar(value=value)
            ttk.Checkbutton(dev_box, text=text, variable=var, style="Wrap.TCheckbutton",
                            command=lambda: command(var.get())).pack(anchor="w")
            return var

        if d["cls"] in ("Motor", "Ventil", "Vfd", "PosDrive", "PropValve"):
            what = {"Motor": _("Ruční chod"), "Vfd": _("Ruční chod"), "PosDrive": _("Ruční referenční jízda"),
                    "PropValve": _("Ruční zapnutí (výchozí žádaná)")}.get(d["cls"], _("Ruční otevření"))
            var = {"Motor": "manRun_", "Vfd": "manRun_", "PosDrive": "manHome_", "PropValve": "manOn_"}.get(d["cls"], "manOpen_")
            check(f"{what} ({var}{d['name']})", bool(controls["man"].get(str(d["id"]))),
                  lambda on: push(man={**controls["man"], str(d["id"]): on}))
            if has_seq:
                ttk.Label(dev_box, text=_("platí jen při vypnutém režimu AUTO"),
                          style="Dim.TLabel").pack(anchor="w", padx=(20, 0))
            ttk.Label(dev_box, text=_("Závady stroje:"), style="Dim.TLabel"
                      ).pack(anchor="w", pady=(6, 0))
        if d["cls"] == "Motor":
            if "fbkRunning" in sigs:
                check(_("Zamrazit zpětné hlášení (snímač / stykač)"),
                      d["id"] in controls["frozen"], lambda on: toggle("frozen", d["id"], on))
            if "fault" in sigs:
                check(_("Vstup poruchy aktivní (vybavený jistič)"), d["id"] in controls["fault"],
                      lambda on: toggle("fault", d["id"], on))
            if not {"fbkRunning", "fault"} & set(sigs):
                ttk.Label(dev_box, text=_("motor nemá zpětné hlášení ani vstup poruchy"),
                          style="Dim.TLabel").pack(anchor="w")
        elif d["cls"] == "Ventil":
            if {"fbkOpen", "fbkClosed"} & set(sigs):
                check(_("Zaseknout pohyb (koncové snímače nezmění stav)"),
                      d["id"] in controls["frozen"], lambda on: toggle("frozen", d["id"], on))
            else:
                ttk.Label(dev_box, text=_("ventil nemá koncové snímače"), style="Dim.TLabel"
                          ).pack(anchor="w")
        elif d["cls"] in ("Vfd", "PosDrive", "PropValve"):
            # pohony fáze 2a: zaseknutá mechanika (otáčky / poloha / tlak se nemění), porucha řadiče
            check({"Vfd": _("Zaseknout pohon (otáčky se nemění)"), "PosDrive": _("Zaseknout osu (jízda nedojede)"),
                   "PropValve": _("Zaseknout ventil (skutečná hodnota se nemění)")}[d["cls"]],
                  d["id"] in controls["frozen"], lambda on: toggle("frozen", d["id"], on))
            if "fault" in sigs:
                check(_("Vstup poruchy aktivní (porucha řadiče)"), d["id"] in controls["fault"],
                      lambda on: toggle("fault", d["id"], on))
        elif d["cls"] == "DI":
            e = io_of[d["id"]][0] if io_of[d["id"]] else None
            if estop is not None and d["id"] == estop["id"]:
                ttk.Label(dev_box,
                          text=_("Centrální uvolnění — ovládá ho tlačítko E-STOP nahoře."),
                          style="Dim.TLabel", wraplength=wrap, justify="left").pack(anchor="w")
            elif e is not None:
                check(_("Vstup sepnut (TRUE)"), frame()["io"].get(e["key"]) is True,
                      lambda on: push(di={**controls["di"], e["key"]: on}))
                ttk.Label(dev_box,
                          text=_("Blokovací vstup — FALSE zastaví stroj (je v enable).")
                          if d["id"] in locks else
                          _("Volný signál — program ho zatím nečte (vlastní logika)."),
                          style="Dim.TLabel", wraplength=wrap, justify="left").pack(anchor="w")
        elif d["cls"] == "AnalogIn" and "raw" in sigs:
            key = sigs["raw"]["key"]
            var = tk.DoubleVar(value=float(frame()["io"].get(key) or 0) / 27648 * 100)
            ttk.Label(dev_box, text=_("Hodnota snímače (0–100 % rozsahu):"), style="Dim.TLabel"
                      ).pack(anchor="w")
            ttk.Scale(dev_box, from_=0, to=100, variable=var, command=lambda v: push(
                ai={**controls["ai"], key: round(float(v) / 100 * 27648)})).pack(fill="x")
            dev_state["ai"] = (var, key)          # posuvník drží krok s tím v záložce Vstupy
        else:
            ttk.Label(dev_box, text=_("Bez zásahu — hodnotu řídí program."), style="Dim.TLabel"
                      ).pack(anchor="w")
        link(dev_box, _("Zařízení ↗"), lambda: app.open_device(d["id"])
             ).pack(anchor="w", pady=(4, 0))
        update_device()

    def update_device() -> None:
        lbl, d = dev_state["label"], app.dev_by_id(st["sel"])
        if lbl is None or d is None:
            return
        fr = frame()
        parts = []
        state = fr["dev"].get(str(d["id"]))
        if state is not None:
            parts.append(_("Stav bloku: {label}", label=state["label"]))
        for e in io_of[d["id"]]:
            val = fr["io"].get(e["key"])
            parts.append(f"{e['tag']} = " + (f"{ON} TRUE" if val is True else f"{OFF} FALSE"
                                               if val is False else str(val))
                         + (" " + _("(vnuceno)") if e["key"] in controls["force"] else ""))
        lbl.configure(text="\n".join(parts), foreground=theme.ERR if state and state["error"]
                      else theme.FG)
        if dev_state["ai"] is not None:
            var, key = dev_state["ai"]
            pct = float(fr["io"].get(key) or 0) / 27648 * 100
            if abs(var.get() - pct) > 0.05:
                var.set(pct)

    # ---------------------------------------------------------------- krokování
    def apply(res: dict, dt: float = 0.0) -> None:
        st["res"] = res
        fr = res["frame"]
        for e in res["events"]:
            log.configure(state="normal")
            log.insert("end", f"{e['t']:7.2f} s  {e['msg']}\n", e["kind"])
            log.configure(state="disabled")
            log.see("end")
        if fr["fault"]:
            lbl_seq.configure(
                text=_("PORUCHA STROJE v kroku {n} — čeká na kvitaci", n=fr["faultStep"] + 1)
                if fr["faultStep"] is not None else _("PORUCHA STROJE — čeká na kvitaci"),
                foreground=theme.ERR)
        elif fr["step"] >= 0:
            lbl_seq.configure(text=_("Krok {i}/{n}: {title}", i=fr["step"] + 1,
                                     n=res["stepCount"], title=res["stepTitle"]),
                              foreground=theme.PRIMARY)
        elif not has_seq:
            lbl_seq.configure(text=_("Projekt nemá automatickou sekvenci — jen ruční povely."),
                              foreground=theme.FG)
        else:
            lbl_seq.configure(text=_("Klid — čeká na START") if var_auto.get()
                              else _("Klid — ruční režim (AUTO vypnuto)"), foreground=theme.FG)
        cyc = (_("cyklů {n} (poslední {t} s)", n=res["cycles"], t=f"{res['lastCycleTime']:g}")
               if res["lastCycleTime"] is not None else _("cyklů {n}", n=res["cycles"]))
        force = controls["force"]
        state = [f"t = {fr['t']:.2f} s", f"enable {ON if fr['enable'] else OFF}", cyc,
                 _("sepnuté výstupy: {n}", n=len(res["outputsOn"]))]
        if force:
            state.append(_("vnucené vstupy: {n}", n=len(force)))
        if not fr["enable"]:                           # proč stroj stojí: E-stop / blokování
            why = [d["name"] for d in stop_devs if fr["io"].get(stop_key[d["id"]]) is not True]
            if why:
                state.append(_("stojí: {list}", list=", ".join(why)))
        lbl_state.configure(text=" · ".join(state),
                            style="Dim.TLabel" if fr["enable"] else "Err.TLabel")
        mimic.update({**res, "modeAuto": controls["modeAuto"] and has_seq,
                      "force": dict(force)}, dt)
        key = (fr["step"], fr["enable"], fr["fault"],
               tuple((k, v["step"]) for k, v in sorted(fr["dev"].items())),
               tuple(sorted(fr["io"].items())), tuple(sorted(force.items())))
        if key != st["key"]:                           # bloky překreslit jen při změně stavu
            st["key"] = key
            if views.index(views.select()) == 1:
                blocks.refresh()
            update_device()

    def request(ms: float, **flags) -> None:
        try:
            apply(app.bridge.request("live.step", ms=ms, controls=controls, **flags), ms / 1000)
        except BridgeError as exc:
            if exc.code != "no_live":
                raise
            reset()                                    # most se restartoval — začni znovu

    def push(**changes) -> None:
        """Změna tlačítka: pošle se hned (i při zastaveném čase), projeví se dalším scanem."""
        controls.update(changes)
        request(0)

    def advance(seconds: float) -> None:
        flags = {k: True for k in ("start", "ack") if st[k]}
        st["start"] = st["ack"] = False
        request(seconds * 1000, **flags)

    def tick() -> None:
        st["job"] = None
        if not parent.winfo_exists():
            return
        if st["running"] and parent.winfo_ismapped():
            advance(TICK_MS / 1000 * SPEEDS.get(var_speed.get(), 1.0))
        st["job"] = parent.after(TICK_MS, tick)

    def toggle_run() -> None:
        st["running"] = not st["running"]
        b_run.configure(text=_("⏸ Zastavit čas") if st["running"] else _("▶ Pustit čas"))

    def press(name: str) -> None:
        """Tlačítko start / kvitace: stisk se předá s dalším krokem času."""
        st[name] = True
        if not st["running"]:
            advance(0.01)

    def toggle_estop() -> None:
        pressed = not controls["estop"]
        b_estop.configure(text=_("✔ Uvolnit E-STOP") if pressed else _("⛔ E-STOP"))
        push(estop=pressed)

    def reset() -> None:
        controls.update(modeAuto=var_auto.get(), estop=False, frozen=[], fault=[], di={},
                        man={}, ai={}, force={})
        b_estop.configure(text=_("⛔ E-STOP"))
        res = app.bridge.request("live.start", prj=app.prj)
        st["key"] = None
        set_text(log, "")
        apply({k: res[k] for k in STATE_KEYS})
        show_device()

    b_start.configure(command=lambda: press("start"))
    b_ack.configure(command=lambda: press("ack"))
    b_estop.configure(command=toggle_estop)
    b_run.configure(command=toggle_run)
    show_device()
    mimic.select(st["sel"])
    apply(st["res"])
    if st["sel"] is not None:
        mimic.after_idle(lambda: mimic.see(st["sel"]))
    st["job"] = parent.after(TICK_MS, tick)
