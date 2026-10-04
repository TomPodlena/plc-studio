"""Krok 8 Generovat — záložka Emulace kódu: ověření vygenerovaného kódu emulátorem překladu
a běhu (jádro ``emu/``; most ``emu.platform`` / ``emu.finish``).

EMULÁTOR NENÍ PŘEKLADAČ VÝROBCE — výhrada je nahoře v záložce i v dokumentu 15 a neodstraňuje se.
Emulace se pouští jen na pokyn, po platformách s průběhem (tlačítko Zastavit platí mezi
platformami). Dokument ``15_emulace_prekladu.md`` se do dokumentace zařadí po ověření všech
platforem projektu a jen pro tu podobu projektu (hlídá most — ``emuGate``).
Výsledek žije v ``app.ui["emu"]``; po změně projektu se ukáže jako zastaralý.
Web: ``apps/web/src/emu_step.js``.
"""

from __future__ import annotations

import time
import tkinter as tk
import webbrowser
from tkinter import ttk

from .. import theme
from ..bridge import BridgeError
from ..i18n import N_, _, _n
from ..widgets import Table, note_box, scrolled_text, set_text, wrap_label

WARNING = N_("Kód se kontroluje parserem IEC 61131-3 a pravidly dialektů podle manuálů výrobců "
             "(zdroje u pravidel). Chování se ověřuje během přeloženého kódu proti modelu stroje "
             "simulace. Skutečný překlad v TIA Portal, CODESYS, TwinCAT, Machine Expert, GX Works3, "
             "Sysmac Studio, Studio 5000 a UniLogic tím NENÍ nahrazen — reálný import a překlad "
             "v IDE je dál nutné ověřit a teprve pak kód nasadit.")
LEVEL = {"error": N_("chyba"), "warn": N_("upozornění"), "info": N_("informace")}


def where(f: dict) -> str:
    if not f.get("file"):
        return "—"
    return f["file"] + (f":{f['line']}" + (f":{f['col']}" if f.get("col") else "") if f.get("line") else "")


def run_emulation(app, plats: list[str], progress=None) -> dict:
    """Emulace vybraných platforem přes most (po platformách); ``progress(i, n, plat)`` mezi nimi.

    Vrací výsledek uložený i do ``app.ui["emu"]``. Zastavení: ``app.ui["emu_run"]["stop"]``."""
    key = app._prj_key()
    run = app.ui["emu_run"] = {"stop": False, "i": 0, "n": len(plats), "plat": plats[0] if plats else ""}
    out = {"key": key, "plats": [], "res": {}, "ms": 0, "doc": False, "stopped": False, "error": ""}
    t0 = time.monotonic()
    try:
        if not app.ui.get("emu_rules"):
            app.ui["emu_rules"] = app.bridge.request("emu.rules")
        for i, pl in enumerate(plats):
            run.update(i=i, plat=pl)
            if progress:
                progress(i, len(plats), pl)     # tady se zpracují události okna (i Zastavit)
            if run["stop"]:
                out["stopped"] = True
                break
            out["res"][pl] = app.bridge.request("emu.platform", prj=app.prj, plat=pl)
            out["plats"].append(pl)
        fin = app.bridge.request("emu.finish", prj=app.prj, plats=out["plats"]) if not out["stopped"] \
            else app.bridge.request("emu.finish", prj=app.prj, plats=[])
        out["doc"], out["file"] = fin["doc"], fin["file"]
    except BridgeError as exc:
        out["error"] = str(exc)
    out["ms"] = round((time.monotonic() - t0) * 1000)
    app.ui["emu"] = out
    app.ui.pop("emu_run", None)
    return out


def render(app, parent) -> None:
    ui = app.ui.setdefault("emu_view", {})
    # výhrada nahoře, výrazně (neodstraňovat — viz CLAUDE.md, Emulace)
    box = tk.Frame(parent, bg=theme.WARN_BG, padx=12, pady=8, highlightthickness=1,
                   highlightbackground="#F0D9A0")
    box.pack(fill="x")
    tk.Label(box, text="⚠ " + _("UPOZORNĚNÍ: Emulátor NENÍ překladač výrobce."), bg=theme.WARN_BG,
             fg=theme.WARN, font=theme.FONT_ACCENT, anchor="w").pack(fill="x")
    warn = tk.Label(box, text=_(WARNING), bg=theme.WARN_BG, fg=theme.FG, font=theme.FONT_DIM,
                    justify="left", anchor="w")
    warn.pack(fill="x")
    warn.bind("<Configure>", lambda e: warn.configure(wraplength=max(200, e.width - 4)))
    parent.warning = box
    if not app.prj["platforms"]:
        wrap_label(parent, _("Vyber aspoň jednu platformu (krok 3)."), pady=(10, 0))
        return

    sel = ui.setdefault("sel", list(app.prj["platforms"]))
    sel[:] = [p for p in sel if p in app.prj["platforms"]] or list(app.prj["platforms"])
    row = ttk.Frame(parent)
    row.pack(fill="x", pady=(10, 0))
    vars_ = {}
    for pl in app.prj["platforms"]:
        v = tk.BooleanVar(value=pl in sel)
        vars_[pl] = v
        ttk.Checkbutton(row, text=app.PLAT[pl]["name"], variable=v,
                        command=lambda: (sel.clear(), sel.extend(p for p, x in vars_.items() if x.get()),
                                         btn_run.state(["!disabled"] if sel else ["disabled"]))
                        ).pack(side="left", padx=(0, 12))
    parent._vars = vars_
    ctl = ttk.Frame(parent)
    ctl.pack(fill="x", pady=(8, 0))
    btn_run = ttk.Button(ctl, text=_("Ověřit kód emulací"), style="Accent.TButton")
    btn_run.pack(side="left")
    btn_stop = ttk.Button(ctl, text=_("Zastavit"))
    bar = ttk.Progressbar(ctl, length=200, mode="determinate")
    status = ttk.Label(ctl, text="", style="Dim.TLabel")
    scope_full = len(app.prj["program"]["seq"]) <= 40
    wrap_label(parent, _("Rozsah běhu: všechny scénáře ověření včetně celé matice stavů.") if scope_full else
               _("Rozsah běhu: rychlá sada (běžný a druhý cyklus, výpadky hlášení, poruchy, E-stop, "
                 "blokování, kvitace, ruční režim) — projekt má přes 40 kroků; celou matici stavů "
                 "spustí emulateAll(prj)."), pady=(6, 0))
    result = ttk.Frame(parent)
    result.pack(fill="both", expand=True, pady=(8, 0))
    parent.run_button, parent.result = btn_run, result     # testy

    def progress(i: int, n: int, pl: str) -> None:
        if status.winfo_exists():
            bar.configure(maximum=n, value=i)
            status.configure(text=f"{app.PLAT[pl]['name']}: " + _("překlad a běh kódu proti návrhu")
                             + f" ({i + 1}/{n})")
        app.root.update()                 # průběh vidět; Zastavit funguje mezi platformami

    def start() -> None:
        if app.ui.get("emu_run") or not sel:
            return
        btn_run.state(["disabled"])
        btn_stop.state(["!disabled"])
        btn_stop.pack(side="left", padx=(6, 0))
        bar.pack(side="left", padx=(12, 0))
        status.pack(side="left", padx=(10, 0))
        plats = [p for p in app.prj["platforms"] if p in sel]
        run_emulation(app, plats, progress)
        if app.step == 7 and app.ui.get("gen_tab") == 2:
            app.render()

    def stop() -> None:
        if app.ui.get("emu_run"):
            app.ui["emu_run"]["stop"] = True
            btn_stop.state(["disabled"])
            status.configure(text=_("Zastavuji po dokončení platformy…"))

    btn_run.configure(command=start)
    btn_stop.configure(command=stop)
    parent.start, parent.stop = start, stop
    if not sel:
        btn_run.state(["disabled"])
    if app.ui.get("emu_run"):             # běží z dřívějšího vykreslení záložky
        btn_run.state(["disabled"])
        status.configure(text=_("Probíhá emulace…"))
        status.pack(side="left", padx=(10, 0))
        return
    _result(app, result, ui)


def _result(app, parent, ui: dict) -> None:
    res = app.ui.get("emu")
    if not res:
        wrap_label(parent, _("Emulace zatím neproběhla. Vyber platformy a spusť ověření — výsledek "
                             "se zapíše i do dokumentu {file} v kroku Dokumentace.",
                             file="15_emulace_prekladu.md"))
        return
    file = res.get("file") or "15_emulace_prekladu.md"
    if res["key"] != app._prj_key():
        note_box(parent, _("Projekt se od emulace změnil — výsledek níže patří k dřívější podobě "
                           "a dokument {file} se do dokumentace nezařadí. Spusť ověření znovu.",
                           file=file), warn=True, pady=(0, 6))
        parent.stale = True
    elif res["doc"]:
        ttk.Label(parent, text="✔ " + _("Výsledek je v dokumentu {file} (krok Dokumentace).", file=file),
                  style="Ok.TLabel").pack(anchor="w")
    else:
        ttk.Label(parent, text=_("Dokument {file} vznikne po ověření všech platforem projektu.", file=file),
                  style="Dim.TLabel").pack(anchor="w")
    if res.get("error"):
        ttk.Label(parent, text="✖ " + _("Emulace skončila chybou: {err}", err=res["error"]),
                  style="Err.TLabel").pack(anchor="w")
    if res.get("stopped"):
        note_box(parent, _("Emulace byla zastavena — výsledek je jen pro dokončené platformy."), warn=True)
    if not res["plats"]:
        return

    summary = Table(parent, [("plat", _("Platforma"), 170, False), ("comp", _("Překlad"), 70, False),
                             ("err", _("Chyby"), 60, False), ("warn", _("Počet upozornění"), 110, False),
                             ("sc", _("Běh: scénáře"), 100, False), ("diff", _("Rozdíly kód ↔ návrh"), 160, False),
                             ("ok", _("Výsledek"), 120, True)], height=min(len(res["plats"]), 6))
    summary.tv.tag_configure("bad", foreground=theme.ERR)
    summary.tv.tag_configure("good", foreground=theme.OK)
    for pl in res["plats"]:
        r = res["res"][pl]
        c, run = r["compile"], r["run"]
        e = sum(f["level"] == "error" for f in c["findings"])
        w = sum(f["level"] == "warn" for f in c["findings"])
        rt = sum(f.get("level") == "error" for f in run.get("runtime") or [])
        ok = c["ok"] and run["ok"]
        summary.add(pl, (app.PLAT[pl]["name"], "✔" if c["ok"] else "✖", e, w,
                         "—" if run.get("skipped") else len(run["scenarios"]),
                         "—" if run.get("skipped") else str(len(run["diffs"])) + (
                             " + " + _n(rt, N_("{n} běhová chyba|{n} běhové chyby|{n} běhových chyb")) if rt else ""),
                         "✔ " + _("bez nálezu") if ok else "✖ " + _("nálezy")),
                    tags=("good" if ok else "bad",))
    summary.pack(fill="x")
    ttk.Label(parent, text=_("Celková doba emulace {s} s.", s=f"{res['ms'] / 1000:.1f}"),
              style="Dim.TLabel").pack(anchor="w", pady=(2, 6))
    detail = ttk.Frame(parent)
    detail.pack(fill="both", expand=True)
    parent.summary, parent.detail = summary, detail

    def show(_e=None) -> None:
        pl = summary.selected()
        if pl:
            ui["plat"] = pl
            _detail(app, detail, res, pl, ui)

    summary.tv.bind("<<TreeviewSelect>>", show)
    summary.select(ui.get("plat") if ui.get("plat") in res["plats"] else res["plats"][0])
    show()


def _detail(app, parent, res: dict, pl: str, ui: dict) -> None:
    for w in parent.winfo_children():
        w.destroy()
    r = res["res"][pl]
    c, run, files = r["compile"], r["run"], r["files"]
    rules = app.ui.get("emu_rules") or {}
    nb = ttk.Notebook(parent)
    nb.pack(fill="both", expand=True)
    t1, t2 = ttk.Frame(nb, padding=8), ttk.Frame(nb, padding=8)
    shown = [f for f in c["findings"] if ui.get("info") or f["level"] != "info"]
    n_info = sum(f["level"] == "info" for f in c["findings"])
    nb.add(t1, text=_("Nálezy překladu") + f" ({len(shown)})")
    nb.add(t2, text=_("Běh kódu proti návrhu") + ("" if run.get("skipped") else f" ({len(run['diffs'])})"))
    parent.notebook = nb

    # --- nálezy překladu + náhled kódu ---
    head = ttk.Frame(t1)
    head.pack(fill="x")
    ttk.Label(head, text=f"{app.PLAT[pl]['name']} — {r['label']}", style="Section.TLabel").pack(side="left")
    if n_info:
        var = tk.BooleanVar(value=bool(ui.get("info")))
        head._var = var
        ttk.Checkbutton(head, text=_n(n_info, N_("zobrazit i {n} informaci|zobrazit i {n} informace|"
                                                "zobrazit i {n} informací")), variable=var,
                        command=lambda: (ui.update(info=var.get()), _detail(app, parent, res, pl, ui))
                        ).pack(side="right")
    wrap_label(t1, _("Ověřené soubory: {files}", files=", ".join(f for f in c["files"] if f != "README.txt")))
    if not shown:
        ttk.Label(t1, text="✔ " + _("Bez nálezů."), style="Ok.TLabel").pack(anchor="w", pady=(6, 0))
    tbl = Table(t1, [("lvl", _("Úroveň"), 110, False), ("loc", _("Místo"), 200, False),
                     ("rule", _("Pravidlo"), 120, False), ("msg", _("Nález"), 360, True)],
                height=min(max(len(shown), 1), 7), ellipsis=True)
    tbl.tv.tag_configure("error", foreground=theme.ERR)
    tbl.tv.tag_configure("warn", foreground=theme.WARN)
    tbl.tv.tag_configure("info", foreground=theme.DIM)
    for i, f in enumerate(shown[:300]):
        tbl.add(i, (("✖ " if f["level"] == "error" else "⚠ " if f["level"] == "warn" else "") + _(LEVEL[f["level"]]),
                    where(f), f["rule"], f["msg"]), tags=(f["level"],))
    if shown:
        tbl.pack(fill="x", pady=(6, 0))
    rule_lbl = ttk.Label(t1, text="", style="Dim.TLabel")
    rule_lbl.pack(anchor="w", pady=(4, 0))
    btns = ttk.Frame(t1)
    btns.pack(fill="x", pady=(2, 0))
    src_btn = ttk.Button(btns, text=_("Zdroj pravidla ↗"))
    code_lbl = ttk.Label(t1, text="", style="Section.TLabel")
    code_frm, code = scrolled_text(t1, mono=True, readonly=True, height=10)
    if shown:                                   # náhled kódu jen když je co ukázat
        code_lbl.pack(anchor="w", pady=(6, 2))
        code_frm.pack(fill="both", expand=True)
    code.tag_configure("hit", background="#F8D7D3")
    code.tag_configure("lineno", foreground=theme.DIM)
    parent.findings, parent.code, parent.code_label = tbl, code, code_lbl      # testy

    def show_finding(_e=None) -> None:
        iid = tbl.selected()
        if iid is None:
            return
        f = shown[int(iid)]
        ui["loc"] = int(iid)
        rule_lbl.configure(text=f"{f['rule']}: {rules.get(f['rule'], '')}")
        if f.get("source"):
            src_btn.configure(command=lambda: webbrowser.open(f["source"]))
            src_btn.pack(side="left")
        else:
            src_btn.pack_forget()
        show_code(f)

    def show_code(f: dict) -> None:
        body = files.get(f.get("file") or "")
        if body is None:
            code_lbl.configure(text="")
            set_text(code, "")
            return
        lines = body.splitlines()
        code_lbl.configure(text=_("Náhled kódu: {file}", file=f["file"]) + f" · {where(f)}")
        w = len(str(len(lines)))
        set_text(code, "\n".join(f"{i + 1:>{w}}  {ln}" for i, ln in enumerate(lines)))
        line = int(f.get("line") or 0)
        if line:
            code.tag_add("hit", f"{line}.0", f"{line}.end")
            code.see(f"{min(len(lines), line + 6)}.0")
            code.see(f"{max(1, line - 6)}.0")
        code.show_line = line              # testy

    tbl.tv.bind("<<TreeviewSelect>>", show_finding)
    parent.show_code = show_code
    if shown:
        tbl.select(ui.get("loc") if isinstance(ui.get("loc"), int) and ui["loc"] < len(shown) else 0)
        show_finding()

    # --- běh proti návrhu ---
    if run.get("skipped"):
        note_box(t2, run["skipped"], warn=True)
        return
    wrap_label(t2, _("{n} scénářů, {scans} scanů kódu ({skip} scanů klidu přeskočeno), {d} rozdílů.",
                     n=len(run["scenarios"]), scans=run["scans"], skip=run.get("skippedScans") or 0,
                     d=len(run["diffs"])))
    if run["diffs"]:
        dt = Table(t2, [("sc", _("Scénář"), 260, True), ("t", _("Čas [s]"), 70, False),
                        ("sig", _("Signál"), 200, False), ("des", _("Návrh (simulace)"), 120, False),
                        ("code", _("Kód"), 80, False)], height=10, ellipsis=True)
        for i, d in enumerate(run["diffs"][:200]):
            dt.add(i, (d["label"], d["t"], d["signal"], d["design"], d["code"]))
        dt.pack(fill="both", expand=True, pady=(6, 0))
    else:
        ttk.Label(t2, text="✔ " + _("Kód se ve všech scénářích chová stejně jako návrh."),
                  style="Ok.TLabel").pack(anchor="w", pady=(6, 0))
    for f in run.get("runtime") or []:
        ttk.Label(t2, text="✖ " + f["msg"], style="Err.TLabel", wraplength=900).pack(anchor="w")
