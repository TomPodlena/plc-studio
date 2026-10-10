"""Krok 13 — Oživení: plán po fázích a protokol s výsledky.

Plán navrhuje jádro (``commission.ts`` přes operaci mostu ``commission``): rozvaděč,
smyčkový test každého I/O, pohony, analogy, E-stop a blokování (jen jako signály
standardního programu), ruční režim, sekvence, poruchové stavy, takt a bezpečnostní
validace. Výsledky kroků (OK / NOK / N/A, kdo, kdy, naměřeno, poznámka) se zapisují
přes ``setCommissionResult`` do ``prj["commissioning"]`` — drží se v projektu.
"""

from __future__ import annotations

import tkinter as tk
from tkinter import ttk

from .. import theme
from ..bridge import BridgeError
from ..i18n import N_, _
from ..widgets import Table, card, note_box, save_file, wrap_label
from .schvaleni import GREY, _file_name, approver, name_bar, when

RESULTS = {"ok": N_("OK"), "nok": N_("Nevyhovuje"), "na": N_("N/A")}
RESULT_SHORT = {"ok": "OK", "nok": "NOK", "na": "N/A"}
RESULT_COLOR = {"ok": theme.OK, "nok": theme.ERR, "na": GREY}
FILTERS = {"all": N_("vše ({n})"), "open": N_("bez výsledku ({n})"),
           "nok": N_("nevyhovuje ({n})")}
TEXT_MAX = 300


def _visible(step: dict, results: dict, flt: str) -> bool:
    r = results.get(step["id"])
    if flt == "open":
        return r is None
    if flt == "nok":
        return r is not None and r["result"] == "nok"
    return True


def render(app, parent) -> None:
    body = card(parent, "13", _("Oživení"))
    if not app.prj["devices"]:
        wrap_label(body, _("Nejdřív navrhni zařízení (kroky 2–4)."))
        return
    data = app.fetch("commission", prj=app.prj)
    app.prj = data["prj"]
    plan: list[dict] = data["plan"]
    by_id = {s["id"]: s for s in plan}
    results: dict = app.prj.get("commissioning") or {}
    s = data["summary"]
    ui = app.ui.setdefault("com", {})
    flt = ui.get("filter") if ui.get("filter") in FILTERS else "all"

    wrap_label(body, _(
        "Plán oživení navrhl PLCdesk z projektu. U každého kroku je, co udělat a co se "
        "má stát; zapiš výsledek OK / Nevyhovuje / N/A, naměřenou hodnotu a poznámku. "
        "Oživení je hotové, když jsou všechny kroky OK nebo N/A — uzavření pak schválí "
        "odpovědná osoba v kroku Schválení."))
    note_box(body, _(
        "Fáze 5 zkouší E-stop a blokování jen jako signály standardního programu. "
        "Bezpečnostní funkce se validují ve fázi 10 podle posouzení rizik — bez validace "
        "stroj nepředávat."), warn=True, side="bottom")

    # --- lišta: jméno, filtr, export ------------------------------------------------------
    bar = ttk.Frame(body)
    bar.pack(fill="x", pady=(8, 4))
    ttk.Button(bar, text=_("Uložit CSV…"),
               command=lambda: save_file(app, _file_name(app, data["files"]["csv"]), data["csv"], "dokumentace")
               ).pack(side="right")
    ttk.Button(bar, text=_("Uložit protokol…"), style="Accent.TButton",
               command=lambda: save_file(app, _file_name(app, data["files"]["md"]), data["md"], "dokumentace")
               ).pack(side="right", padx=(0, 6))
    nm = ttk.Frame(bar)
    nm.pack(side="left")
    fbar = ttk.Frame(bar)
    fbar.pack(side="left", padx=(16, 0))
    counts = {"all": len(plan), "open": s["open"], "nok": s["nok"]}
    var_f = tk.StringVar(value=flt)
    fbar._var = var_f                                   # držet proměnnou naživu (GC)

    def set_filter() -> None:
        ui["filter"] = var_f.get()
        app.render()

    ttk.Label(fbar, text=_("Zobrazit:")).pack(side="left", padx=(0, 6))
    for k, label in FILTERS.items():
        ttk.Radiobutton(fbar, text=_(label, n=counts[k]), value=k, variable=var_f,
                        style="Tab.Toolbutton", command=set_filter).pack(side="left", padx=(0, 3))

    sumrow = ttk.Frame(body)
    sumrow.pack(fill="x", pady=(2, 6))
    for text, color in ((f"{s['ok']} OK", theme.OK), (f"{s['nok']} NOK", theme.ERR),
                        (f"{s['na']} N/A", GREY),
                        (_("{n} bez výsledku", n=s["open"]), theme.FG)):
        tk.Label(sumrow, text=text, bg=theme.FIELD, fg=color, font=theme.FONT_ACCENT,
                 padx=8, pady=2).pack(side="left", padx=(0, 6))
    tk.Label(sumrow, text=("✔ " + _("Všechny kroky jsou OK nebo N/A — oživení lze uzavřít."))
             if s["done"] else _("celkem {n} kroků", n=s["total"]), bg=theme.BG,
             fg=theme.OK if s["done"] else theme.DIM, font=theme.FONT_UI
             ).pack(side="left", padx=(8, 0))

    # --- plán po fázích -----------------------------------------------------------------------
    main = ttk.Frame(body)
    main.pack(fill="both", expand=True)
    main.columnconfigure(0, weight=1)
    main.rowconfigure(0, weight=1)
    tbl = Table(main, [("res", _("Výsledek"), 80, False), ("who", _("Kdo a kdy"), 150, False),
                       ("meas", _("Naměřeno"), 120, True)], height=10, tree=True)
    tbl.tv.heading("#0", text=_("Krok"), anchor="w")
    tbl.tv.column("#0", width=330, stretch=True)
    tbl.grid(row=0, column=0, sticky="nsew")
    for k, color in RESULT_COLOR.items():
        tbl.tv.tag_configure(k, foreground=color)
    order: list[str] = []                               # viditelné kroky v pořadí
    for ph, label in data["phases"].items():
        steps = [st for st in plan if str(st["phase"]) == str(ph)]
        shown = [st for st in steps if _visible(st, results, flt)]
        if not shown:
            continue
        done = sum(1 for st in steps if st["id"] in results and results[st["id"]]["result"] != "nok")
        gid = tbl.add("ph:" + str(ph), ("", "", ""), text=f"{ph}. {label}  ({done}/{len(steps)})",
                      tags=("group",), open_=ui.get("closed", {}).get(str(ph)) is not True)
        for st in shown:
            r = results.get(st["id"])
            tbl.add(st["id"], (RESULT_SHORT[r["result"]] if r else "—", when(r),
                               (r or {}).get("measured", "")),
                    parent=gid, text=st["title"], tags=(r["result"],) if r else ())
            order.append(st["id"])
    if not order:
        ttk.Label(main, text=_("Filtru neodpovídá žádný krok."), style="Dim.TLabel"
                  ).grid(row=1, column=0, sticky="w", pady=(6, 0))

    def on_toggle(opened: bool):
        def h(_e=None):
            iid = tbl.tv.focus()
            if iid.startswith("ph:"):
                ui.setdefault("closed", {})[iid[3:]] = not opened
        return h

    tbl.tv.bind("<<TreeviewOpen>>", on_toggle(True))
    tbl.tv.bind("<<TreeviewClose>>", on_toggle(False))

    # --- panel kroku ----------------------------------------------------------------------------
    side = ttk.Frame(main, width=380)
    side.grid(row=0, column=1, rowspan=2, sticky="nsew", padx=(12, 0))
    side.grid_propagate(False)
    side.pack_propagate(False)
    name_holder = nm
    title = ttk.Label(side, text="", style="Section.TLabel", wraplength=360, justify="left")
    title.pack(anchor="w")
    info = tk.Text(side, height=6, wrap="word", bg=theme.BG, fg=theme.FG, relief="flat",
                   font=theme.FONT_UI, highlightthickness=0, padx=0, pady=2, cursor="arrow")
    info.tag_configure("h", foreground=theme.DIM, font=theme.FONT_DIM)
    info.tag_configure("sig", font=theme.FONT_MONO, foreground=theme.PRIMARY)
    # spodní část panelu se balí od spodu — popis kroku dostane, co zbude (malé okno)
    hint = ttk.Label(side, text="", style="Dim.TLabel", wraplength=360, justify="left")
    hint.pack(side="bottom", anchor="w", pady=(6, 0))
    btns = ttk.Frame(side)
    btns.pack(side="bottom", fill="x", pady=(8, 0))
    # šířka podle textu (nejmenší 6 znaků) — čtyři tlačítka se vejdou i v němčině
    res_btns = {k: ttk.Button(btns, text=_(label), width=-6, style="Accent.TButton"
                              if k == "ok" else "Danger.TButton" if k == "nok" else "TButton")
                for k, label in RESULTS.items()}
    for b in res_btns.values():
        b.pack(side="left", padx=(0, 6))
    b_clear = ttk.Button(btns, text=_("Zrušit výsledek"), width=-6)
    b_clear.pack(side="left")
    form = ttk.Frame(side)
    form.pack(side="bottom", fill="x", pady=(4, 0))
    form.columnconfigure(1, weight=1)
    ttk.Label(form, text=_("Naměřeno:"), style="Dim.TLabel").grid(row=0, column=0, sticky="w")
    var_meas = tk.StringVar()
    ent_meas = ttk.Entry(form, textvariable=var_meas)
    ent_meas._var = var_meas
    ent_meas.grid(row=0, column=1, sticky="ew", padx=(6, 0), pady=(0, 4))
    ttk.Label(form, text=_("Poznámka:"), style="Dim.TLabel").grid(row=1, column=0, sticky="w")
    var_note = tk.StringVar()
    ent_note = ttk.Entry(form, textvariable=var_note)
    ent_note._var = var_note
    ent_note.grid(row=1, column=1, sticky="ew", padx=(6, 0))
    rec_lbl = ttk.Label(side, text="", style="Dim.TLabel", wraplength=360, justify="left")
    rec_lbl.pack(side="bottom", anchor="w")
    info.pack(fill="both", expand=True, pady=(2, 4))
    drafts: dict = ui.setdefault("drafts", {})          # rozepsané texty kroků bez výsledku

    def cur() -> dict | None:
        return by_id.get(ui.get("sel") or "")

    def rec(sid: str) -> dict | None:
        """Aktuální záznam kroku (ztráta fokusu zapisuje i bez překreslení)."""
        return (app.prj.get("commissioning") or {}).get(sid)

    def update_buttons() -> None:
        st = cur()
        ok = st is not None and bool(approver(app))
        for b in res_btns.values():
            b.state(["!disabled"] if ok else ["disabled"])
        b_clear.state(["!disabled"] if st is not None and rec(st["id"]) else ["disabled"])
        hint.configure(text="" if approver(app) else _("Bez jména nelze zapsat výsledek — "
                                                       "zadej ho nahoře."))

    name_bar(name_holder, app, _("Oživuje:"), update_buttons)

    def show() -> None:
        st = cur()
        info.configure(state="normal")
        info.delete("1.0", "end")
        if st is None:
            title.configure(text="")
            info.insert("end", _("Vyber krok v plánu."), ("h",))
            rec_lbl.configure(text="")
            var_meas.set("")
            var_note.set("")
        else:
            title.configure(text=st["title"])
            info.insert("end", _("Co udělat") + "\n", ("h",))
            info.insert("end", st["how"] + "\n")
            info.insert("end", _("Co se má stát") + "\n", ("h",))
            info.insert("end", st["expect"] + "\n")
            if st["signals"]:
                info.insert("end", _("Signály") + "\n", ("h",))
                info.insert("end", ", ".join(st["signals"]), ("sig",))
            r = rec(st["id"])
            d = drafts.get(st["id"], {})
            rec_lbl.configure(text=_("{res} · {who}", res=_(RESULTS[r["result"]]), who=when(r))
                              if r else _("Bez výsledku."))
            var_meas.set(r.get("measured", "") if r else d.get("measured", ""))
            var_note.set(r.get("note", "") if r else d.get("note", ""))
        info.configure(state="disabled")
        update_buttons()

    def write(result: str | None, *, advance: bool) -> None:
        st = cur()
        if st is None:
            return
        meas, note = var_meas.get().strip()[:TEXT_MAX], var_note.get().strip()[:TEXT_MAX]
        try:
            if result is None:
                app.prj = app.bridge.mutate("clearCommissionResult", app.prj, st["id"])
                drafts.pop(st["id"], None)
                msg = _("Výsledek zrušen: {title}", title=st["title"])
            else:
                if not approver(app):
                    app.set_status(_("Zadej jméno toho, kdo oživuje."))
                    return
                opts = {k: v for k, v in (("measured", meas), ("note", note)) if v}
                app.prj = app.bridge.mutate("setCommissionResult", app.prj, st["id"], result,
                                            approver(app), opts)
                drafts.pop(st["id"], None)
                msg = _("{res}: {title}", res=_(RESULTS[result]), title=st["title"])
        except BridgeError as exc:
            app.set_status("⚠ " + str(exc))
            return
        if advance and st["id"] in order:              # další krok plánu v pohledu
            i = order.index(st["id"])
            rest = [x for x in order[i + 1:] if x != st["id"]]
            if rest:
                ui["sel"] = rest[0]
        app.save()
        app.render()
        app.set_status(msg)

    for k, b in res_btns.items():
        b.configure(command=lambda k=k: write(k, advance=True))
    b_clear.configure(command=lambda: write(None, advance=False))

    def keep_text(_e=None, *, redraw: bool = False) -> None:
        """Naměřeno / poznámka: u kroku s výsledkem se zapíše, jinak zůstane rozepsané.

        Při ztrátě fokusu se jen zapíše do projektu bez překreslení — fokus se ztrácí
        i při rušení widgetů během překreslení a vnořené překreslení by obsah zdvojilo."""
        st = cur()
        if st is None:
            return
        r = rec(st["id"])
        meas, note = var_meas.get().strip()[:TEXT_MAX], var_note.get().strip()[:TEXT_MAX]
        if r is None:
            drafts[st["id"]] = {"measured": meas, "note": note}
            return
        if (meas, note) == (r.get("measured", ""), r.get("note", "")) or not approver(app):
            return
        if redraw:
            write(r["result"], advance=False)
            return
        opts = {k: v for k, v in (("measured", meas), ("note", note)) if v}
        try:
            app.prj = app.bridge.mutate("setCommissionResult", app.prj, st["id"], r["result"],
                                        approver(app), opts)
        except BridgeError as exc:
            app.set_status("⚠ " + str(exc))
            return
        app.save()

    for ent in (ent_meas, ent_note):
        ent.bind("<Return>", lambda _e: keep_text(redraw=True))
        ent.bind("<FocusOut>", keep_text)

    def on_select(_e=None) -> None:
        iid = tbl.selected()
        if iid and iid in by_id and iid != ui.get("sel"):
            keep_text()
            ui["sel"] = iid
            show()

    tbl.tv.bind("<<TreeviewSelect>>", on_select)
    if ui.get("sel") in by_id and tbl.tv.exists(ui["sel"]):
        tbl.select(ui["sel"])
    elif ui.get("sel") not in by_id:
        ui.pop("sel", None)
    show()
