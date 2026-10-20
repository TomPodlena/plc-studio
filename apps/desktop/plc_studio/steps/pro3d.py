"""Krok „3D agent (PRO)“ — náhled PLCdesk PRO (jen se zapnutým ``pro_preview``, viz ``App.pro_enabled``).

Složka 3D stroje, stav (verdikt poslední kontroly K5, STAV.md, modely FCStd, poslední snímky), pokyn a role
agenta, Spustit / Zastavit / Otevřít ve FreeCADu / Načíst zpětnou vazbu z CAD a log průběhu. Logika běhu
je v ``plc_studio/pro_agent.py``; běh agenta přežije překreslení kroku (``app.pro_run``), log se dokresluje
z fronty přes ``after`` (Tk jen z hlavního vlákna).
"""

from __future__ import annotations

import math
import os
from pathlib import Path

import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from .. import pro_agent, theme
from ..i18n import _
from ..widgets import card, note_box, scrolled_text, tooltip, wrap_label

THUMB = 200          # nejdelší strana náhledu snímku (px)
LOG_TAGS = {"text": theme.FG, "tool": theme.PRIMARY, "result": theme.DIM, "error": theme.ERR,
            "info": theme.DIM, "done": theme.PRIMARY}


def _key(app) -> str:
    return str(app.prj.get("guid") or (app.prj.get("meta") or {}).get("name") or "")


def default_folder(app) -> Path | None:
    from ..datadir import project_dir
    try:
        pdir = project_dir(app)
    except Exception:  # noqa: BLE001 — bez kořene projektů
        pdir = None
    return pdir / "02_Vykresy" / "3D" if pdir is not None else None


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


def start_agent(app, role: str, instruction: str, *, model: str = "", budget: float | None = None,
                confirm=None, popen=None) -> pro_agent.AgentRun | None:
    """Spustí agenta po potvrzení (spotřebuje kredity tarifu Claude). Vrací běh nebo None."""
    exe = pro_agent.find_claude()
    folder = machine_folder(app)
    if exe is None or folder is None:
        return None
    run = getattr(app, "pro_run", None)
    if run is not None and run.running():
        return None
    ask = confirm or (lambda: messagebox.askyesno(
        _("Spustit 3D agenta"),
        _("Agent poběží přes Claude Code a spotřebuje kredity tvého tarifu Claude. Pokračovat?"),
        parent=app.root))
    if not ask():
        return None
    folder.mkdir(parents=True, exist_ok=True)
    name = (app.prj.get("meta") or {}).get("name") or ""
    run = pro_agent.AgentRun(pro_agent.build_command(exe, role, model=model, budget=budget),
                             pro_agent.build_prompt(role, instruction, folder, name), folder, role=role)
    try:
        run.start(**({"popen": popen} if popen else {}))
    except OSError as exc:
        messagebox.showerror(_("Spustit 3D agenta"), _("Agenta nejde spustit: {exc}", exc=exc), parent=app.root)
        return None
    app.pro_run = run
    return run


def render(app, parent) -> None:
    head = card(parent, "3D", _("3D agent (PRO)"), expand=False)
    note_box(head, _("Náhled PLCdesk PRO: AI agent (Claude Code) staví a kontroluje 3D model stroje ve FreeCADu podle "
                     "tvého pokynu. Kusovník zůstává v PLCdesk — neshody se vracejí jako zpětná vazba z CAD."),
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

    # --- pokyn ---
    body = card(parent, "AI", _("Pokyn pro agenta"), expand=False)
    roles = ttk.Frame(body)
    roles.pack(fill="x")
    ttk.Label(roles, text=_("Role")).pack(side="left", padx=(0, 8))
    role = tk.StringVar(value=app.ui.get("pro_role") or "builder")
    app.pro_role_var = role
    for key, label in pro_agent.ROLES:
        rb = ttk.Radiobutton(roles, text=_(label), value=key, variable=role,
                             command=lambda: app.ui.__setitem__("pro_role", role.get()))
        rb.pack(side="left", padx=(0, 10))
        tooltip(rb, _(pro_agent.ROLE_TIPS[key]))
    frm, txt = scrolled_text(body, height=5)
    frm.pack(fill="x", pady=(6, 0))
    txt.insert("1.0", app.ui.get("pro_text") or "")
    app.pro_text = txt
    txt.bind("<KeyRelease>", lambda _e: app.ui.__setitem__("pro_text", txt.get("1.0", "end-1c")))
    opts = ttk.Frame(body)
    opts.pack(fill="x", pady=(6, 0))
    ttk.Label(opts, text=_("Model (volitelně)")).pack(side="left")
    mvar = tk.StringVar(value=app.settings.get("pro_model") or "")
    app.pro_model_var = mvar
    ttk.Entry(opts, textvariable=mvar, width=22).pack(side="left", padx=(6, 14))
    ttk.Label(opts, text=_("Limit ceny USD (volitelně)")).pack(side="left")
    bvar = tk.StringVar(value=app.ui.get("pro_budget") or "")
    app.pro_budget_var = bvar
    ttk.Entry(opts, textvariable=bvar, width=8).pack(side="left", padx=(6, 0))

    btns = ttk.Frame(body)
    btns.pack(fill="x", pady=(8, 0))
    run = getattr(app, "pro_run", None)
    busy = run is not None and run.running()

    def do_start() -> None:
        try:
            budget = float(bvar.get().replace(",", ".")) if bvar.get().strip() else None
        except ValueError:
            messagebox.showerror(_("Spustit 3D agenta"), _("Limit ceny musí být číslo (USD)."), parent=app.root)
            return
        app.ui["pro_budget"] = bvar.get()
        app.settings["pro_model"] = mvar.get().strip()
        if start_agent(app, role.get(), txt.get("1.0", "end-1c"), model=mvar.get(), budget=budget):
            app.render()

    def do_stop() -> None:
        r = getattr(app, "pro_run", None)
        if r is not None:
            r.stop()
            app.render()

    b_start = ttk.Button(btns, text=_("Spustit"), style="Accent.TButton", command=do_start)
    b_start.pack(side="left")
    if busy or exe is None or folder is None:
        b_start.state(["disabled"])
    b_stop = ttk.Button(btns, text=_("Zastavit"), command=do_stop)
    b_stop.pack(side="left", padx=(6, 0))
    if not busy:
        b_stop.state(["disabled"])
    app.pro_buttons = {"start": b_start, "stop": b_stop}

    models = st.get("models") or []
    sel = tk.StringVar(value=Path(models[0]).name if models else "")
    app.pro_model_sel = sel
    if models:
        cb = ttk.Combobox(btns, textvariable=sel, state="readonly", width=34,
                          values=[Path(m).name for m in models])
        cb.pack(side="left", padx=(18, 6))

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

    b_fc = ttk.Button(btns, text=_("Otevřít ve FreeCADu"), command=do_open)
    b_fc.pack(side="left")
    if not models or pro_agent.find_run_fc() is None:
        b_fc.state(["disabled"])
    tooltip(b_fc, _("Vlastní instance FreeCADu (slot {slot}); po 4 h se sama zavře — ukládej průběžně.",
                    slot=pro_agent.FC_SLOT))

    def do_fb() -> None:
        from .kusovnik import load_cad_feedback
        load_cad_feedback(app)

    ttk.Button(btns, text=_("Načíst zpětnou vazbu z CAD…"), command=do_fb).pack(side="right")

    # --- log ---
    logc = card(parent, "LOG", _("Průběh"))
    status = ttk.Label(logc, text=_status_text(run), style="Dim.TLabel")
    status.pack(anchor="w")
    lfrm, log = scrolled_text(logc, height=14, readonly=True)
    lfrm.pack(fill="both", expand=True, pady=(4, 0))
    for k, c in LOG_TAGS.items():
        log.tag_configure(k, foreground=c)
    log.tag_configure("tool", foreground=theme.PRIMARY, font=theme.FONT_ACCENT)
    app.pro_log = log
    if run is not None:
        run.drain()
        _append(log, run.lines)
        if run.running():
            _poll(app, run, log, status)


def _status_text(run) -> str:
    if run is None:
        return _("Agent neběží.")
    if run.state == "running":
        return _("Agent běží (PID {pid})…", pid=getattr(run.proc, "pid", "?"))
    return {"done": _("Agent skončil."), "stopped": _("Agent zastaven."),
            "failed": _("Agent skončil s chybou.")}.get(run.state, "")


def _append(log: tk.Text, items) -> None:
    prefix = {"tool": "▸ ", "result": "   ", "error": "✖ ", "info": "· ", "done": "✔ ", "text": ""}
    log.configure(state="normal")
    for kind, text in items:
        if kind == "end":
            continue
        log.insert("end", prefix.get(kind, "") + text + "\n", kind)
    log.configure(state="disabled")
    log.see("end")


def _poll(app, run, log: tk.Text, status) -> None:
    """Dokreslení logu z fronty běhu (hlavní vlákno, každých 250 ms, dokud log existuje)."""
    try:
        if not log.winfo_exists():
            return
    except tk.TclError:
        return
    new = run.drain()
    if new:
        _append(log, new)
    if any(k == "end" for k, _t in new) or not run.running():
        app.render()                                  # konec běhu: tlačítka a stav znovu
        return
    status.configure(text=_status_text(run))
    app.root.after(250, lambda: _poll(app, run, log, status))


def _state_view(app, parent, folder: Path | None, st: dict) -> None:
    box = ttk.Frame(parent)
    box.pack(fill="x", pady=(8, 0))
    if folder is not None and not st["exists"]:
        wrap_label(box, _("Složka zatím neexistuje — agent ji při prvním spuštění založí."))
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


def _open_file(p: str) -> None:
    try:
        os.startfile(p)                                  # noqa: S606 — snímek otevře prohlížeč obrázků
    except (OSError, AttributeError):
        pass
