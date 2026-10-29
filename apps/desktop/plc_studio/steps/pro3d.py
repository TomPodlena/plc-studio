"""Krok „3D agent (PRO)“ — náhled PLCdesk PRO (jen se zapnutým ``pro_preview``, viz ``App.pro_enabled``).

Automatický postup (``plc_studio/pro_pipeline.py``): pruh fází ① Vstupy z PLCdesk → ② Koncept → ③ Stavba se stavem
každé fáze, Spustit celý postup / Spustit od fáze… / Zastavit, zaškrtávátko TEST (bezpečnost považovat za schválenou),
rozbalitelné výchozí pokyny fází (šablony, uložené per projekt) s doplňujícím pokynem, celkový ukazatel (fáze × kolo)
a ukazatel běžícího agenta (PRŮBĚH k/N). Stav složky stroje (verdikt K5, STAV.md, FCStd, snímky), Otevřít ve FreeCADu
a zpětná vazba z CAD jako dřív. Postup běží ve vlákně (``app.pro_pipe`` / ``app.pro_thread``), Tk jen z hlavního
vlákna: log a stav se dokreslují přes ``after`` ze stavu postupu.
"""

from __future__ import annotations

import json
import math
import os
import threading
from pathlib import Path

import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from .. import pro_agent, pro_pipeline, theme
from ..i18n import N_, _
from ..pro3d_download import listing as dl
from ..widgets import card, note_box, scrolled_text, tooltip, wrap_label

THUMB = 200          # nejdelší strana náhledu snímku (px)
LOG_TAGS = {"text": theme.FG, "tool": theme.PRIMARY, "result": theme.DIM, "error": theme.ERR,
            "info": theme.DIM, "done": theme.PRIMARY}
PHASE_NUM = "①②③"


def _key(app) -> str:
    return str(app.prj.get("guid") or (app.prj.get("meta") or {}).get("name") or "")


def default_folder(app) -> Path | None:
    """Složka 3D stroje bez zadávání: 02_Vykresy/3D vedle otevřeného souboru projektu, jinak
    v projektové složce, jinak pracovní složka aplikace ``<home>/pro3d/<číslo>_<Název>/02_Vykresy/3D``."""
    from ..datadir import folder_name, project_dir
    pf = getattr(app, "_project_file", None)
    if isinstance(pf, tuple) and len(pf) == 2 and pf[0] == app.prj.get("guid") and pf[1]:
        side = Path(pf[1]).parent / "02_Vykresy" / "3D"
        if side.is_dir():
            return side
    try:
        pdir = project_dir(app)
    except Exception:  # noqa: BLE001 — bez kořene projektů
        pdir = None
    if pdir is not None:
        return pdir / "02_Vykresy" / "3D"
    home = getattr(app, "home", None)
    return Path(home) / "pro3d" / folder_name(app) / "02_Vykresy" / "3D" if home else None


def machine_folder(app) -> Path | None:
    """Složka 3D stroje: volba pro projekt (``settings.pro3d_dirs``), jinak 02_Vykresy/3D projektové složky."""
    dirs = app.settings.get("pro3d_dirs")
    v = dirs.get(_key(app)) if isinstance(dirs, dict) else None
    return Path(v) if isinstance(v, str) and v else default_folder(app)


def set_folder(app, path: str) -> None:
    dirs = app.settings.get("pro3d_dirs")
    if not isinstance(dirs, dict):
        dirs = app.settings["pro3d_dirs"] = {}
    dirs[_key(app)] = str(path)
    app.save_settings()


def _per_project(app, name: str) -> dict:
    """Slovník ``settings[name][klíč projektu]`` (upravené výchozí pokyny / doplňující pokyny fází)."""
    allp = app.settings.get(name)
    if not isinstance(allp, dict):
        allp = app.settings[name] = {}
    cur = allp.get(_key(app))
    if not isinstance(cur, dict):
        cur = allp[_key(app)] = {}
    return cur


def busy(app) -> bool:
    t = getattr(app, "pro_thread", None)
    return t is not None and t.is_alive()


MODEL_ROLES = tuple((r, dict(pro_agent.ROLES)[r]) for r in ("concept", "builder", "k5"))   # popisky N_ v pro_agent


def role_models(app) -> dict:
    """Model každé role: volba projektu (``settings.pro3d_models``), jinak výchozí z nastavení (``pro_models``),
    jinak ``pro_agent.ROLE_MODELS`` (koncept Opus, stavba a kontrola Sonnet)."""
    glob = app.settings.get("pro_models") if isinstance(app.settings.get("pro_models"), dict) else {}
    own = _per_project(app, "pro3d_models")
    return {r: str(own.get(r) or glob.get(r) or d) for r, d in pro_agent.ROLE_MODELS.items()}


def save_models(app) -> dict:
    """Uloží volbu modelů z polí kroku pro projekt i jako výchozí; vrací {role: model}."""
    vars_ = getattr(app, "pro_role_vars", {}) or {}
    models = {r: (v.get().split(" ")[0].strip() or pro_agent.ROLE_MODELS[r]) for r, v in vars_.items()}
    if models:
        _per_project(app, "pro3d_models").update(models)
        app.settings["pro_models"] = dict(models)
    return models or role_models(app)


def _model_rows(app, parent) -> None:
    """Model pro každou roli: známé modely (shodně s AI návrhářem) + vlastní ID, poznámka o relativní ceně."""
    known = pro_agent.known_models()
    cur = role_models(app)
    row = ttk.Frame(parent)
    row.pack(fill="x", pady=(8, 0))
    ttk.Label(row, text=_("Model AI podle role")).grid(row=0, column=0, columnspan=3, sticky="w")
    app.pro_role_vars = {}
    for i, (role, label) in enumerate(MODEL_ROLES, 1):
        ttk.Label(row, text=_(label)).grid(row=i, column=0, sticky="w", padx=(0, 8))
        var = tk.StringVar(value=cur[role])
        app.pro_role_vars[role] = var
        cb = ttk.Combobox(row, textvariable=var, values=list(known), width=max(26, max(len(k) for k in known) + 2))
        cb.grid(row=i, column=1, sticky="w", pady=1)
        note = ttk.Label(row, style="Dim.TLabel")
        note.grid(row=i, column=2, sticky="w", padx=(8, 0))

        def upd(_e=None, v=var, n=note):
            desc = known.get(v.get().strip())
            n.configure(text=_(desc) if desc else _("vlastní ID modelu — cenu ukáže přehled po běhu"))

        upd()
        cb.bind("<<ComboboxSelected>>", upd)
        cb.bind("<KeyRelease>", upd)
        tooltip(cb, _("Limit kol agenta: {n} (pipeline.json, maxTurns). Skutečnou cenu každého běhu zapíše PREHLED.md.",
                      n=pro_agent.ROLE_TURNS[role]))
    wrap_label(parent, _("Kontroly modelu (kolize, souvislost, otvory, kusovník, zástupné díly, STEP) počítá kód — agent je "
                         "jen spouští a posuzuje, co kód neumí."), pady=(4, 0))


def start_pipeline(app, from_unit: str | None = None, *, confirm=None, runner=None, thread: bool = True,
                   model: str = "", budget: float | None = None, models: dict | None = None) -> pro_pipeline.Pipeline | None:
    """Spustí automatický postup (``from_unit`` = od kroku znovu, jinak navázání od posledního hotového kroku)
    po potvrzení — agenti spotřebují kredity tarifu Claude. Postup běží ve vlákně; vrací ``Pipeline`` nebo None."""
    folder = machine_folder(app)
    if folder is None or busy(app):
        return None
    if runner is None and pro_agent.find_claude() is None:
        return None
    ask = confirm or (lambda: messagebox.askyesno(
        _("Spustit 3D agenta"),
        _("Postup spouští agenty přes Claude Code a spotřebuje kredity tvého tarifu Claude "
          "(každá část až {n} kol stavitel + kontrolor). Pokračovat?",
          n=max(pro_pipeline.MAX_ROUNDS, *pro_pipeline.UNIT_ROUNDS.values())),
        parent=app.root))
    if not ask():
        return None
    folder.mkdir(parents=True, exist_ok=True)
    pipe = pro_pipeline.Pipeline(
        folder, json.loads(json.dumps(app.prj)), test_safety=bool(app.ui.get("pro_test")),
        prompts=dict(_per_project(app, "pro3d_prompts")), extras=dict(_per_project(app, "pro3d_extra")),
        runner=runner or pro_pipeline.agent_runner(model=model, budget=budget),
        models=models or role_models(app))
    app.pro_pipe = pipe
    if thread:
        app.pro_thread = threading.Thread(target=pipe.run, args=(from_unit,), daemon=True)
        app.pro_thread.start()
    else:
        app.pro_thread = None
        pipe.run(from_unit)
    return pipe


def render(app, parent) -> None:
    head = card(parent, "3D", _("3D agent (PRO)"), expand=False)
    note_box(head, _("Náhled PLCdesk PRO: AI agenti (Claude Code) postaví a zkontrolují 3D model stroje ve FreeCADu "
                     "automatickým postupem — vstupy z PLCdesk, koncept, stavba po částech; každou část kontroluje "
                     "jiná role (K5). Kusovník zůstává v PLCdesk — neshody se vracejí jako zpětná vazba z CAD."),
             pady=(0, 6))
    exe, fc = pro_agent.find_claude(), pro_agent.find_freecad()
    if exe is None:
        note_box(head, _("Claude Code nenalezen. Nainstaluj Claude Code, přihlas se (claude.exe v PATH nebo "
                         "v %USERPROFILE%\\.local\\bin), případně nastav proměnnou PLCDESK_CLAUDE, a otevři krok znovu."),
                 warn=True)
    if fc is None or pro_agent.find_run_fc() is None:
        note_box(head, _("FreeCAD 1.1 nebo spouštěč vlastní instance (run_fc.ps1 skillu freecad-instance) nenalezen — "
                         "Otevřít ve FreeCADu nefunguje; agent může běžet, ale model neotevře."), warn=True)

    # --- složka a stav ---
    row = ttk.Frame(head)
    row.pack(fill="x", pady=(8, 0))
    ttk.Label(row, text=_("Složka 3D stroje")).pack(side="left")
    folder = machine_folder(app)
    var = tk.StringVar(value=str(folder) if folder else "")
    app.pro_folder_var = var                       # živá proměnná (GC) + testy
    ent = ttk.Entry(row, textvariable=var)
    ent.pack(side="left", fill="x", expand=True, padx=(8, 6))

    def commit(_e=None) -> None:
        v = var.get().strip()
        if v and v != str(machine_folder(app) or ""):
            set_folder(app, v)
            app.render()

    ent.bind("<Return>", commit)
    ent.bind("<FocusOut>", commit)

    def choose() -> None:
        p = filedialog.askdirectory(parent=app.root, title=_("Složka 3D stroje"),
                                    initialdir=var.get() or app.settings.get("last_dir") or None)
        if p:
            set_folder(app, p)
            app.render()

    ttk.Button(row, text=_("Vybrat…"), command=choose).pack(side="left")
    if folder is None:
        wrap_label(head, _("Projekt nemá projektovou složku (kořen projektů není nastavený) — vyber složku stroje."),
                   pady=(4, 0))
        st = {"exists": False, "models": [], "shots": []}
    else:
        st = pro_agent.machine_state(folder)
    app.pro_state = st
    _state_view(app, head, folder, st)

    # --- postup ---
    body = card(parent, "AI", _("Automatický postup"), expand=False)
    pipe = getattr(app, "pro_pipe", None)
    running = busy(app)
    pst = (pipe.state if pipe is not None and folder is not None and Path(pipe.folder) == folder else None) or \
        (pro_pipeline.load_state(folder) if folder is not None else None) or pro_pipeline.blank_state()
    app.pro_pstate = pst
    strip = ttk.Frame(body)
    strip.pack(fill="x")
    app.pro_phase_labels = {}
    for i, (ph, label) in enumerate(pro_pipeline.PHASES):
        state, rnd = pro_pipeline.phase_state(pst, ph)
        cell = ttk.Frame(strip, padding=(0, 0, 22, 0))
        cell.pack(side="left")
        ttk.Label(cell, text=PHASE_NUM[i] + " " + _(label)).pack(anchor="w")
        style = {"approved": "Ok.TLabel", "done": "Ok.TLabel", "rejected": "Err.TLabel",
                 "failed": "Err.TLabel"}.get(state, "Dim.TLabel")
        lbl = ttk.Label(cell, text=pro_pipeline.state_label(state, rnd), style=style)
        lbl.pack(anchor="w")
        app.pro_phase_labels[ph] = lbl
        if i < len(pro_pipeline.PHASES) - 1:
            ttk.Label(strip, text="→", style="Dim.TLabel").pack(side="left", padx=(0, 22))
    if pst.get("testSafety"):
        ttk.Label(body, text=pro_pipeline.TEST_MARK, style="Err.TLabel").pack(anchor="w", pady=(4, 0))

    opts = ttk.Frame(body)
    opts.pack(fill="x", pady=(8, 0))
    tvar = tk.BooleanVar(value=bool(app.ui.get("pro_test")))
    app.pro_test_var = tvar
    cb_test = ttk.Checkbutton(opts, text=_("TEST: bezpečnostní prvky považovat za schválené"), variable=tvar,
                              command=lambda: app.ui.__setitem__("pro_test", tvar.get()))
    cb_test.pack(side="left")
    tooltip(cb_test, _("Jen pro zkoušku postupu: výstupy pak nesou „{mark}“.", mark=pro_pipeline.TEST_MARK))
    ttk.Label(opts, text=_("Limit ceny USD na běh agenta (volitelně)")).pack(side="left", padx=(18, 0))
    bvar = tk.StringVar(value=app.ui.get("pro_budget") or "")
    app.pro_budget_var = bvar
    ttk.Entry(opts, textvariable=bvar, width=8).pack(side="left", padx=(6, 0))
    _model_rows(app, body)

    btns = ttk.Frame(body)
    btns.pack(fill="x", pady=(8, 0))
    units = [(k, _(pro_pipeline.UNIT[k]["label"])) for k in pro_pipeline.UNIT_KEYS]
    fvar = tk.StringVar(value=dict(units).get(app.ui.get("pro_from") or "concept") or units[1][1])
    app.pro_from_var = fvar

    def go(from_unit: str | None) -> None:
        try:
            budget = float(bvar.get().replace(",", ".")) if bvar.get().strip() else None
        except ValueError:
            messagebox.showerror(_("Spustit 3D agenta"), _("Limit ceny musí být číslo (USD)."), parent=app.root)
            return
        app.ui["pro_budget"] = bvar.get()
        models = save_models(app)
        if start_pipeline(app, from_unit, budget=budget, models=models):
            app.render()

    def from_sel() -> str:
        k = next((k for k, lbl in units if lbl == fvar.get()), "concept")
        app.ui["pro_from"] = k
        return k

    b_all = ttk.Button(btns, text=_("Spustit celý postup"), style="Accent.TButton", command=lambda: go(None))
    b_all.pack(side="left")
    tooltip(b_all, _("Naváže od posledního hotového kroku (pipeline.json ve složce stroje)."))
    b_from = ttk.Button(btns, text=_("Spustit od fáze…"), command=lambda: go(from_sel()))
    b_from.pack(side="left", padx=(6, 0))
    tooltip(b_from, _("Zvolený krok a všechny další znovu (předchozí kola zůstanou v historii pipeline.json)."))
    ttk.Combobox(btns, textvariable=fvar, state="readonly", width=max(24, max(len(lbl) for _k, lbl in units) + 2),
                 values=[lbl for _k, lbl in units]).pack(side="left", padx=(6, 0))

    def do_stop() -> None:
        p = getattr(app, "pro_pipe", None)
        if p is not None:
            p.stop()
            app.set_status(_("Zastavuji postup (jen vlastní proces agenta)…"), keep=True)

    b_stop = ttk.Button(btns, text=_("Zastavit"), command=do_stop)
    b_stop.pack(side="left", padx=(6, 0))
    for b in (b_all, b_from):
        if running or exe is None or folder is None:
            b.state(["disabled"])
    if not running:
        b_stop.state(["disabled"])
    app.pro_buttons = {"all": b_all, "from": b_from, "stop": b_stop}

    obar = ttk.Progressbar(body, mode="determinate", maximum=100, value=round(100 * pro_pipeline.progress(pst)))
    obar.pack(fill="x", pady=(8, 0))
    app._pro_obar = obar
    ostatus = ttk.Label(body, text=overall_text(pst), style="Dim.TLabel")
    ostatus.pack(anchor="w")

    models = st.get("models") or []
    row2 = ttk.Frame(body)
    row2.pack(fill="x", pady=(8, 0))
    sel = tk.StringVar(value=Path(models[0]).name if models else "")
    app.pro_model_sel = sel
    if models:
        ttk.Combobox(row2, textvariable=sel, state="readonly", width=34, values=[Path(m).name for m in models]
                     ).pack(side="left", padx=(0, 6))

    def do_open() -> None:
        name = sel.get()
        path = next((m for m in models if Path(m).name == name), None)
        if not path:
            return
        app.set_status(_("Otevírám {name} ve FreeCADu (vlastní instance)…", name=name), keep=True)

        def done(ok: bool, text: str) -> None:            # z vlákna → hlavní vlákno
            msg = (_("Model je otevřený ve FreeCADu (slot {slot}).", slot=pro_agent.FC_SLOT) if ok
                   else _("FreeCAD hlásí chybu: {text}", text=text[-300:]))
            try:
                app.root.after(0, lambda: app.set_status(msg, keep=True))
            except (tk.TclError, RuntimeError):
                pass

        if pro_agent.open_in_freecad(path, done) is None:
            app.set_status(_("Spouštěč FreeCADu (run_fc.ps1) nenalezen."), keep=True)

    b_fc = ttk.Button(row2, text=_("Otevřít ve FreeCADu"), command=do_open)
    b_fc.pack(side="left")
    if not models or pro_agent.find_run_fc() is None:
        b_fc.state(["disabled"])
    tooltip(b_fc, _("Vlastní instance FreeCADu (slot {slot}); po 4 h se sama zavře — ukládej průběžně.",
                    slot=pro_agent.FC_SLOT))
    if folder is not None and (folder / pro_pipeline.SUMMARY_FILE).is_file():
        ttk.Button(row2, text=_("Přehled postupu"),
                   command=lambda: _open_file(str(folder / pro_pipeline.SUMMARY_FILE))).pack(side="left", padx=(6, 0))

    def do_fb() -> None:
        from .kusovnik import load_cad_feedback
        load_cad_feedback(app)

    ttk.Button(row2, text=_("Načíst zpětnou vazbu z CAD…"), command=do_fb).pack(side="right")

    _prompts_view(app, parent, running)
    _downloads_view(app, parent, folder)

    # --- log ---
    logc = card(parent, "LOG", _("Průběh"))
    run = pipe.current if pipe is not None and running else None
    bar = ttk.Progressbar(logc, mode="determinate", maximum=100)
    bar.pack(fill="x", pady=(0, 4))
    app._pro_bar = bar
    status = ttk.Label(logc, text=_status_text(run), style="Dim.TLabel")
    status.pack(anchor="w")
    _update_bar(bar, run)
    lfrm, log = scrolled_text(logc, height=14, readonly=True)
    lfrm.pack(fill="both", expand=True, pady=(4, 0))
    for k, c in LOG_TAGS.items():
        log.tag_configure(k, foreground=c)
    log.tag_configure("tool", foreground=theme.PRIMARY, font=theme.FONT_ACCENT)
    log.tag_configure("phase", foreground=theme.PRIMARY, font=theme.FONT_ACCENT)
    app.pro_log = log
    if pipe is not None:
        seen = {"ev": len(pipe.events), "run": run, "n": 0}
        _append(log, [("phase", e) for e in pipe.events])
        if run is not None:
            seen["n"] = len(run.lines)
            _append(log, list(run.lines))
        if running:
            app.root.after(300, lambda: _poll(app, pipe, log, status, ostatus, seen, _snapshot(pipe)))


def _snapshot(pipe) -> tuple:
    st = pipe.state
    return (st.get("status"),) + tuple((st["units"][k]["state"], len(st["units"][k].get("rounds") or []))
                                       for k in pro_pipeline.UNIT_KEYS)


def overall_text(st: dict) -> str:
    """Celkový ukazatel: fáze × kolo běžícího kroku, jinak stav postupu."""
    for k in pro_pipeline.UNIT_KEYS:
        u = st["units"][k]
        if u["state"] in ("running", "review"):
            pi = [p for p, _l in pro_pipeline.PHASES].index(pro_pipeline.UNIT[k]["phase"]) + 1
            if k == "inputs":
                return _("Fáze {p}/3 · {part}", p=pi, part=_(pro_pipeline.UNIT[k]["label"]))
            role = _("Kontrolor K5") if u["state"] == "review" else _("Stavitel")
            return _("Fáze {p}/3 · {part} · kolo {n}/{m} · {role}", p=pi, part=_(pro_pipeline.UNIT[k]["label"]),
                     n=max(1, len(u.get("rounds") or [])),
                     m=(st.get("unitRounds") or {}).get(k) or st.get("maxRounds") or pro_pipeline.MAX_ROUNDS, role=role)
    status = st.get("status") or "new"
    return {"new": _("Postup zatím neběžel."), "running": _("Postup běží…"), "done": _("Postup dokončen."),
            "noai": _("Vstupy připravené (bez AI)."), "stopped": _("Postup zastaven — Spustit celý postup naváže."),
            "failed": _("Postup skončil chybou — viz log a pipeline.json."),
            "rejected": _("Koncept neschválen — postup zastaven, viz PREHLED.md.")}.get(status, status)


def _prompts_view(app, parent, running: bool) -> None:
    """Pokyny fází: rozbalitelný výchozí pokyn (šablona, editovatelná, uložená per projekt) + doplňující pokyn."""
    box = card(parent, "✎", _("Pokyny fází"), expand=False)
    prompts, extras = _per_project(app, "pro3d_prompts"), _per_project(app, "pro3d_extra")
    app.pro_prompt_texts = {}
    for k in pro_pipeline.AI_UNITS:
        u = pro_pipeline.UNIT[k]
        row = ttk.Frame(box)
        row.pack(fill="x", pady=(2, 0))
        is_open = k in (app.ui.get("pro_open") or [])

        def toggle(k=k) -> None:
            lst = list(app.ui.get("pro_open") or [])
            if k in lst:
                lst.remove(k)
            else:
                lst.append(k)
            app.ui["pro_open"] = lst
            app.render()

        ph = dict(pro_pipeline.PHASES)[u["phase"]]
        ttk.Button(row, text=("▾ " if is_open else "▸ ") + _(ph) + " · " + _(u["label"]),
                   command=toggle).pack(side="left")
        if (prompts.get(k) or "").strip():
            ttk.Label(row, text=_("upravený pokyn"), style="Dim.TLabel").pack(side="left", padx=(8, 0))
        if (extras.get(k) or "").strip():
            ttk.Label(row, text=_("+ doplňující pokyn"), style="Dim.TLabel").pack(side="left", padx=(8, 0))
        if not is_open:
            continue
        ttk.Label(box, text=_("Výchozí pokyn (šablona)"), style="Dim.TLabel").pack(anchor="w", pady=(4, 0))
        frm, txt = scrolled_text(box, height=7)
        frm.pack(fill="x")
        txt.insert("1.0", prompts.get(k) or pro_pipeline.default_prompt(k))
        ttk.Label(box, text=_("Doplňující pokyn"), style="Dim.TLabel").pack(anchor="w", pady=(4, 0))
        frm2, ext = scrolled_text(box, height=2)
        frm2.pack(fill="x")
        ext.insert("1.0", extras.get(k) or "")
        app.pro_prompt_texts[k] = (txt, ext)

        def save(_e=None, k=k, txt=txt, ext=ext) -> None:
            t = txt.get("1.0", "end-1c")
            if t.strip() == pro_pipeline.default_prompt(k).strip():
                prompts.pop(k, None)
            else:
                prompts[k] = t
            extras[k] = ext.get("1.0", "end-1c")
            app.save_settings()

        for w in (txt, ext):
            w.bind("<FocusOut>", save)
            if running:
                w.configure(state="disabled")

        def reset(k=k) -> None:
            prompts.pop(k, None)
            app.save_settings()
            app.render()

        ttk.Button(box, text=_("Obnovit výchozí pokyn"), command=reset).pack(anchor="w", pady=(4, 6))


def _update_bar(bar, run) -> None:
    """Ukazatel běžícího agenta: krok k/N z řádků „PRŮBĚH k/N“, bez plánu neurčitý pruh, po konci plný / prázdný."""
    try:
        k, n, _lbl = getattr(run, "step", (0, 0, "")) if run is not None else (0, 0, "")
        if run is not None and run.state == "running" and not n:
            if str(bar.cget("mode")) != "indeterminate":
                bar.configure(mode="indeterminate")
                bar.start(15)
            return
        if str(bar.cget("mode")) == "indeterminate":
            bar.stop()
            bar.configure(mode="determinate")
        if run is None:
            bar.configure(value=0)
        elif run.state == "done":
            bar.configure(value=100)
        else:
            bar.configure(value=round(100 * min(k, n) / n) if n else 0)
    except tk.TclError:
        pass


def _status_text(run) -> str:
    if run is None:
        return _("Agent neběží.")
    if run.state == "running":
        k, n, lbl = getattr(run, "step", (0, 0, ""))
        mins, secs = divmod(int(run.elapsed()) if hasattr(run, "elapsed") else 0, 60)
        head = (_("Krok {k}/{n}: {label}", k=k, n=n, label=lbl) if n
                else _("Agent připravuje plán…"))
        tail = _("{m}:{s} · akcí {tools}", m=mins, s=f"{secs:02d}", tools=getattr(run, "tools", 0))
        last = getattr(run, "last", "")
        return head + " · " + tail + ((" · " + _("poslední: {what}", what=last[:80])) if last else "")
    return {"done": _("Agent skončil."), "stopped": _("Agent zastaven."),
            "failed": _("Agent skončil s chybou.")}.get(run.state, "")


def _append(log: tk.Text, items) -> None:
    prefix = {"tool": "▸ ", "result": "   ", "error": "✖ ", "info": "· ", "done": "✔ ", "text": "",
              "progress": "◆ ", "phase": "■ "}
    log.configure(state="normal")
    for kind, text in items:
        if kind == "end":
            continue
        log.insert("end", prefix.get(kind, "") + text + "\n", kind)
    log.configure(state="disabled")
    log.see("end")


def _poll(app, pipe, log: tk.Text, status, ostatus, seen: dict, snap: tuple) -> None:
    """Dokreslení logu a ukazatelů ze stavu postupu (hlavní vlákno, každých 300 ms, dokud log existuje).
    Vlákno postupu frontu běhu vybírá samo — tady se jen čtou řádky (``run.lines``) a události (``pipe.events``)."""
    try:
        if not log.winfo_exists():
            return
    except tk.TclError:
        return
    ev = pipe.events
    if len(ev) > seen["ev"]:
        _append(log, [("phase", e) for e in ev[seen["ev"]:]])
        seen["ev"] = len(ev)
    run = pipe.current
    if run is not seen["run"]:
        seen["run"], seen["n"] = run, 0
    if run is not None and len(run.lines) > seen["n"]:
        lines = list(run.lines)
        _append(log, lines[seen["n"]:])
        seen["n"] = len(lines)
    if not busy(app) or _snapshot(pipe) != snap:
        app.render()                                  # změna fáze / kola / konec: pruh fází a tlačítka znovu
        return
    status.configure(text=_status_text(run))
    ostatus.configure(text=overall_text(pipe.state))
    bar = getattr(app, "_pro_bar", None)
    if bar is not None:
        _update_bar(bar, run)
    obar = getattr(app, "_pro_obar", None)
    if obar is not None:
        try:
            obar.configure(value=round(100 * pro_pipeline.progress(pipe.state)))
        except tk.TclError:
            pass
    app.root.after(300, lambda: _poll(app, pipe, log, status, ostatus, seen, snap))


def _state_view(app, parent, folder: Path | None, st: dict) -> None:
    box = ttk.Frame(parent)
    box.pack(fill="x", pady=(8, 0))
    if folder is not None and not st["exists"]:
        wrap_label(box, _("Složka zatím neexistuje — postup ji při prvním spuštění založí."))
        return
    if folder is None:
        return
    v = st.get("verdict") or ""
    kind = pro_agent.verdict_kind(v)
    if v:
        style = "Ok.TLabel" if kind == "ok" else "Err.TLabel" if kind == "back" else "TLabel"
        ttk.Label(box, text=_("Poslední kontrola K5: {verdict} ({file})", verdict=v,
                              file=Path(st["verdictFile"]).name), style=style).pack(anchor="w")
    else:
        ttk.Label(box, text=_("Kontrola K5 zatím není."), style="Dim.TLabel").pack(anchor="w")
    if st.get("stav"):
        ttk.Label(box, text=_("Stav ({file}):", file=Path(st["stavFile"]).name), style="Dim.TLabel"
                  ).pack(anchor="w", pady=(6, 0))
        wrap_label(box, st["stav"], style="TLabel")
    models = st.get("models") or []
    ttk.Label(box, text=_("Modely FCStd: {names}", names=", ".join(Path(m).name for m in models[:8])
                          + (" …" if len(models) > 8 else "")) if models else _("Modely FCStd: žádné"),
              style="Dim.TLabel").pack(anchor="w", pady=(6, 0))
    shots = st.get("shots") or []
    if not shots:
        return
    strip = ttk.Frame(box)
    strip.pack(fill="x", pady=(6, 0))
    imgs = []
    for p in shots:
        try:
            img = tk.PhotoImage(file=p)
            f = max(1, math.ceil(max(img.width(), img.height()) / THUMB))
            if f > 1:
                img = img.subsample(f, f)
        except tk.TclError:
            continue
        imgs.append(img)
        cell = ttk.Frame(strip)
        cell.pack(side="left", padx=(0, 6))
        lbl = tk.Label(cell, image=img, bg=theme.BG, cursor="hand2", bd=1, relief="solid")
        lbl.pack()
        lbl.bind("<Button-1>", lambda _e, p=p: _open_file(p))
        ttk.Label(cell, text=Path(p).name[:30], style="Dim.TLabel").pack()
    app.pro_thumbs = imgs                               # reference (GC) — jinak obrázky zmizí


DL_STATUS = {dl.ST_REGISTERED: N_("staženo"), dl.ST_DOWNLOADED: N_("staženo — nezaevidováno"),
             dl.ST_LIBRARY: N_("v knihovně"), dl.ST_MISSING: N_("chybí"), dl.ST_PLACEHOLDER: N_("zástupný")}
DL_HOW = {"name": N_("název souboru"), "code_name": N_("objednací kód v názvu"), "code_header": N_("objednací kód v hlavičce STEP"),
          "type_name": N_("typ v názvu"), "type_header": N_("typ v hlavičce STEP")}


def _dl_manifest(app, folder: Path) -> dict | None:
    """Manifest aktuálního projektu (most ``cad``), jinak PLCdesk_CAD.json ze složky stroje."""
    try:
        return json.loads(app.bridge.request("cad", prj=app.prj)["json"])
    except Exception:  # noqa: BLE001 — most nedostupný → soubor
        try:
            return json.loads((folder / "PLCdesk_CAD.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None


def confirm_pairs(app, props: list[dict]) -> list[dict]:
    """Dialog: návrhy párování stažených souborů (uživatel potvrdí). ``app.pro_dl_confirm`` = podvržení v testech."""
    hook = getattr(app, "pro_dl_confirm", None)
    if hook is not None:
        return hook(props)
    win = tk.Toplevel(app.root)
    win.title(_("Párování stažených souborů"))
    win.transient(app.root)
    wrap_label(win, _("Tyto soubory odpovídají dílům podle objednacího kódu nebo typu. Potvrzené se zkopírují do "
                      "models/manual pod přesným názvem a zaevidují."), pady=(8, 4))
    vars_ = []
    for p in props:
        v = tk.BooleanVar(value=p["how"].startswith("code") or p["how"] == "name")
        vars_.append(v)
        ttk.Checkbutton(win, variable=v, text=f"{p['shown']}  →  {p['partId']}  ({_(DL_HOW.get(p['how'], p['how']))})"
                        ).pack(anchor="w", padx=10)
    out: list[dict] = []

    def ok() -> None:
        out.extend(p for p, v in zip(props, vars_) if v.get())
        win.destroy()

    row = ttk.Frame(win)
    row.pack(fill="x", padx=10, pady=8)
    ttk.Button(row, text=_("Převzít vybrané"), command=ok).pack(side="right")
    ttk.Button(row, text=_("Zrušit"), command=win.destroy).pack(side="right", padx=(0, 6))
    win.app_vars = vars_                                # Tk proměnné živé (GC)
    win.grab_set()
    app.root.wait_window(win)
    return out


def load_downloads(app, folder: Path, man: dict, rows: list[dict], *, thread: bool = True) -> str:
    """„Načíst stažené“: návrhy párování (models/manual + volitelně Stažené soubory) → potvrzení → registrace
    (FreeCAD ve vlastní instanci, vlákno) → výsledek v kartě. Vrací ``started`` / ``nothing``."""
    md = folder / dl.MODELS_SUB
    extra = [dl.downloads_dir()] if app.settings.get("pro3d_downloads", True) else []
    props = dl.find_downloads(man, rows, md, [d for d in extra if d])
    sure = [p for p in props if p["sure"]]
    rest = [p for p in props if not p["sure"]]
    chosen = confirm_pairs(app, rest) if rest else []
    dl.accept(sure + chosen, md)
    if not sure and not chosen:
        app.set_status(_("Žádný nový stažený model k zaevidování."), keep=True)
        return "nothing"
    by = app.settings.get("approver") or ""
    app.pro_dl_busy = True
    app.set_status(_("Ověřuji a eviduji stažené modely (FreeCAD, vlastní instance)…"), keep=True)

    def work() -> None:
        try:
            rep = dl.register_downloads(folder, man, by)
        except Exception as exc:  # noqa: BLE001 — chyba se ukáže v kartě
            rep = {"error": str(exc), "registered": [], "rejected": [], "unmatched": [], "warnings": []}

        def done() -> None:
            app.pro_dl_report = rep
            app.pro_dl_busy = False
            app.render()

        try:
            app.root.after(0, done)
        except (tk.TclError, RuntimeError):
            pass

    if thread:
        threading.Thread(target=work, daemon=True).start()
    else:
        work()
    return "started"


def _dl_report_text(rep: dict) -> str:
    if rep.get("error"):
        return _("Registrace selhala: {exc}", exc=rep["error"])
    rp = rep.get("replace") or {}
    txt = _("Zaevidováno {a}, odmítnuto {r}, nespárováno {u}; v modelu stroje nahrazeno zástupných {n}.",
            a=len(rep.get("registered") or []), r=len(rep.get("rejected") or []), u=len(rep.get("unmatched") or []),
            n=len(rp.get("replaced") or []))
    for x in rep.get("rejected") or []:
        txt += "\n" + _("Odmítnuto {file}: {why}", file=x["file"], why=x["why"])
    for w in rep.get("warnings") or []:
        txt += "\n" + _("Pozor {part}: {why}", part=w["partId"], why=w["why"])
    if rp.get("error"):
        txt += "\n" + _("Náhrada v modelu: {exc}", exc=rp["error"])
    return txt


def _downloads_view(app, parent, folder: Path | None) -> None:
    box = card(parent, "⬇", _("Modely ke stažení"), expand=False)
    note_box(box, _("Modely výrobců stahuješ ty v prohlížeči — podmínky 3Dfindit / CADENAS, TraceParts i portálů "
                    "výrobců automatické stahování nedovolují. Ulož soubor STEP pod přesným názvem do models/manual "
                    "(nebo ho nech ve Stažených souborech) a klikni Načíst stažené."), pady=(0, 6))
    man = _dl_manifest(app, folder) if folder is not None else None
    if folder is None or man is None:
        wrap_label(box, _("Seznam vznikne, až bude složka stroje a manifest pro CAD."))
        return
    pidx = dl.load_parts_index(folder)
    md = folder / dl.MODELS_SUB
    rows = dl.download_list(man, pidx, md)
    c = dl.counts(rows, man, pidx)
    app.pro_dl_rows = rows
    ttk.Label(box, text=_("Dle dokumentace {d} · staženo {s} · zbývá {r} · zástupné {z}", d=c[dl.ST_DOC],
                          s=c[dl.ST_REGISTERED], r=c["remaining"], z=c[dl.ST_PLACEHOLDER])).pack(anchor="w")
    cols = (("part", _("Díl"), 150), ("vendor", _("Výrobce"), 110), ("code", _("Obj. kód"), 130),
            ("file", _("Soubor"), 190), ("status", _("Stav"), 150))
    tree = ttk.Treeview(box, columns=[k for k, _t, _w in cols], show="headings", height=min(10, max(3, len(rows))),
                        selectmode="browse")
    for k, t, w in cols:
        tree.heading(k, text=t)
        tree.column(k, width=w, anchor="w")
    for i, r in enumerate(rows):
        tree.insert("", "end", iid=str(i), values=(r["partId"], r["vendorName"], r["orderCode"] or "—", r["file"],
                                                    _(DL_STATUS[r["status"]])))
    tree.pack(fill="x", pady=(4, 0))
    app.pro_dl_tree = tree
    info = ttk.Label(box, text="", style="Dim.TLabel", wraplength=760, justify="left")
    info.pack(anchor="w", pady=(2, 0))

    def sel() -> dict | None:
        s = tree.selection()
        return rows[int(s[0])] if s else None

    def show(_e=None) -> None:
        r = sel()
        if r:
            info.configure(text=(r["note"] + ("" if r["urlVerified"] else "  " + _("(vzor odkazu neověřen)"))
                                 + "\n" + r["url"]))

    tree.bind("<<TreeviewSelect>>", show)
    tree.bind("<Double-1>", lambda _e: do_open())

    def do_open() -> None:
        r = sel()
        if r:
            import webbrowser
            webbrowser.open(r["url"])

    def open_dir() -> None:
        p = md / dl.MANUAL_SUB
        p.mkdir(parents=True, exist_ok=True)
        _open_file(str(p))

    def open_html() -> None:
        dl.write_lists(folder, man, pidx)
        _open_file(str(folder / dl.LIST_HTML))

    def from_lib() -> None:
        dl.take_from_library(rows, md)
        load_downloads(app, folder, man, dl.download_list(man, pidx, md))

    row = ttk.Frame(box)
    row.pack(fill="x", pady=(6, 0))
    ttk.Button(row, text=_("Otevřít"), command=do_open).pack(side="left")
    ttk.Button(row, text=_("Otevřít složku"), command=open_dir).pack(side="left", padx=(6, 0))
    b_load = ttk.Button(row, text=_("Načíst stažené"), command=lambda: load_downloads(app, folder, man, rows))
    b_load.pack(side="left", padx=(6, 0))
    tooltip(b_load, _("Najde soubory v models/manual (a ve Stažených souborech), nabídne párování, ověří STEP ve "
                      "FreeCADu (vlastní instance) a zaeviduje je; zástupné díly v modelu stroje nahradí."))
    if getattr(app, "pro_dl_busy", False):
        b_load.state(["disabled"])
    if c[dl.ST_LIBRARY]:
        ttk.Button(row, text=_("Převzít z knihovny ({n})", n=c[dl.ST_LIBRARY]), command=from_lib
                   ).pack(side="left", padx=(6, 0))
    ttk.Button(row, text=_("Seznam STAHNOUT.html"), command=open_html).pack(side="left", padx=(6, 0))
    var = tk.BooleanVar(value=bool(app.settings.get("pro3d_downloads", True)))
    app.pro_dl_var = var

    def toggle() -> None:
        app.settings["pro3d_downloads"] = bool(var.get())
        app.save_settings()

    ttk.Checkbutton(row, text=_("Hledat i ve Stažených souborech"), variable=var, command=toggle).pack(side="right")
    rep = getattr(app, "pro_dl_report", None)
    if rep:
        wrap_label(box, _dl_report_text(rep), pady=(6, 0))


def _open_file(p: str) -> None:
    try:
        os.startfile(p)                                  # noqa: S606 — snímek / přehled otevře výchozí aplikace
    except (OSError, AttributeError):
        pass
