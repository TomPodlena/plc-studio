"""Revize a změnové řízení (krok Projekt, záložka „Revize a změny“) + odznak revize v hlavičce.

Revize, rozdíly, zneplatněná schválení a rozsah opakovaných zkoušek počítá jádro
(``revision.ts``); pohled skládá ``apps/web/src/biz_view.js`` (stejný jako ve webu) a desktop
ho dostane přes operace mostu ``revision.*``. Revize nic neschvaluje — zaznamená, co platilo.
"""

from __future__ import annotations

import re
import tkinter as tk
from tkinter import messagebox, ttk

from .. import theme
from ..bridge import BridgeError
from ..i18n import _
from ..widgets import Table, save_file, wrap_label

TONE = {"ok": theme.OK, "warn": theme.WARN, "err": theme.ERR, "wait": theme.DIM, "info": theme.ACCENT}
CLASS_COLOR = {"cosmetic": theme.OK, "functional": theme.WARN, "safety": theme.ERR}


# --- odznak v hlavičce --------------------------------------------------------------

def header_badge(app, parent) -> tk.Label:
    """Štítek „Rev. B“ / „Rev. B*“ v hlavičce okna; klik = krok Projekt, záložka revizí."""
    lbl = tk.Label(parent, text="", font=theme.FONT_ACCENT, cursor="hand2", padx=8, pady=3,
                   bg=theme.ACCENT_BG, fg=theme.ACCENT)

    def go(_e=None):
        app.ui.setdefault("projekt", {})["tab"] = 0
        app.goto(0)

    lbl.bind("<Button-1>", go)
    lbl.invoke = go
    return lbl


def update_badge(app, lbl: tk.Label | None, before=None) -> None:
    """Obnoví štítek revize (skrytý bez revize)."""
    if lbl is None or not lbl.winfo_exists():
        return
    try:
        b = app.bridge.request("revision.badge", prj=app.prj) if app.prj.get("revisions") else {"label": ""}
    except BridgeError:
        b = {"label": ""}
    if not b.get("label"):
        lbl.pack_forget()
        return
    lbl.configure(text=_("Rev. {rev}", rev=b["label"]),
                  bg=theme.WARN_BG if b.get("modified") else theme.ACCENT_BG,
                  fg=theme.WARN if b.get("modified") else theme.ACCENT)
    lbl.tip = b.get("title", "")
    if not lbl.winfo_ismapped():
        if before is not None and before.winfo_exists():
            lbl.pack(side="right", padx=(0, 10), before=before)
        else:
            lbl.pack(side="right", padx=(0, 10))


# --- záložka ----------------------------------------------------------------------

def _file_name(app, base: str) -> str:
    name = re.sub(r'[<>:"/\\|?*]+', "_", app.prj["meta"]["name"] or "").strip(" ._")
    return f"{name}_{base}" if name else base


def build(app, parent) -> None:
    """Obsah záložky „Revize a změny“ (``parent`` = rámec záložky)."""
    ui = app.ui.setdefault("rev", {})
    from .schvaleni import approver
    try:
        data = app.bridge.request("revision.view", prj=app.prj, **{
            "from": ui.get("from", ""), "to": ui.get("to", ""), "exact": bool(ui.get("exact"))})
    except BridgeError as exc:
        ttk.Label(parent, text="⚠ " + str(exc), style="Err.TLabel").pack(anchor="w")
        return
    app.prj = data["prj"]
    v = data["view"]
    revs, d, rt = v["revisions"], v["diff"], v["retest"]
    # výchozí porovnání se nepamatuje (po změně projektu se má přepočítat) — jen volba uživatele

    # --- vydání revize ---------------------------------------------------------------
    # stav revize: bez revize celou větou nad formulářem, jinak krátce na začátku řádku formuláře
    # (místo v kroku Projekt je vzácné — tabulky změn mají dostat co nejvíc řádků)
    form = ttk.Frame(parent)
    if not revs:
        tk.Label(parent, text=_("Projekt zatím nemá žádnou revizi."), bg=theme.BG, fg=theme.DIM,
                 font=theme.FONT_ACCENT).pack(anchor="w")
    else:
        state = _("{rev} — rozpracováno", rev=v["label"]) if v["modified"] else _("{rev} — beze změny", rev=v["label"])
        tk.Label(form, text=state, bg=theme.BG, fg=theme.WARN if v["modified"] else theme.OK,
                 font=theme.FONT_ACCENT).pack(side="left", padx=(0, 14))
    form.pack(fill="x", pady=(4, 4))
    ttk.Label(form, text=_("Vydává:")).pack(side="left")
    var_by = tk.StringVar(value=ui.get("by", approver(app)))
    e_by = ttk.Entry(form, textvariable=var_by, width=22)
    e_by._var = var_by
    e_by.pack(side="left", padx=(6, 12))
    ttk.Label(form, text=_("Popis změny:")).pack(side="left")
    var_note = tk.StringVar(value=ui.get("note", ""))
    e_note = ttk.Entry(form, textvariable=var_note, width=40)
    e_note._var = var_note
    e_note.pack(side="left", padx=(6, 12), fill="x", expand=True)
    var_by.trace_add("write", lambda *_a: ui.update(by=var_by.get()))
    var_note.trace_add("write", lambda *_a: ui.update(note=var_note.get()))

    def issue() -> None:
        by, note = var_by.get().strip(), var_note.get().strip()
        if not by:
            app.set_status(_("Zadej jméno osoby, která revizi vydává."))
            e_by.focus_set()
            return
        if revs and not v["modified"] and not messagebox.askyesno(
                _("Vydat revizi"), _("Obsah se od revize {rev} nezměnil. Vydat přesto novou revizi?",
                                     rev=v["last"]), parent=app.root):
            return
        try:
            r = app.bridge.request("revision.create", prj=app.prj, by=by, note=note)
        except BridgeError as exc:
            app.set_status(str(exc))
            return
        app.prj = r["prj"]
        ui.update(note="", **{"from": "", "to": ""})
        app.save()
        app.render()
        app.set_status(_("Vydána revize {rev} ({date}, {by}).", rev=r["rec"]["id"], date=r["rec"]["date"],
                         by=r["rec"]["by"]))

    ttk.Button(form, text=_("Vydat revizi {rev}", rev=v["next"]), style="Accent.TButton",
               command=issue).pack(side="left")

    if not revs:
        wrap_label(parent, _(
            "Revize zmrazí stav návrhu a schválení (označení A, B, C…). Potom ukáže, co se od "
            "revize změnilo, která schválení změna zneplatní a co je potřeba znovu vyzkoušet. "
            "Revize nic neschvaluje — jen zaznamená, co v tu chvíli platilo; výkresy nesou "
            "označení revize v popisovém poli."), pady=(8, 0))
        return

    # --- porovnání ---------------------------------------------------------------------
    cmp_row = ttk.Frame(parent)
    cmp_row.pack(fill="x", pady=(2, 4))
    ids = [r["id"] for r in revs]
    ttk.Label(cmp_row, text=_("Změny od")).pack(side="left")
    cb_from = ttk.Combobox(cmp_row, values=ids, state="readonly", width=max(4, max(len(i) for i in ids) + 2))
    cb_from.set(v["from"])
    cb_from.pack(side="left", padx=(6, 8))
    ttk.Label(cmp_row, text=_("do")).pack(side="left")
    to_keys = ["current", *ids]
    to_names = [_("aktuální stav (neuvolněno)"), *[_("revize {rev}", rev=i) for i in ids]]
    cb_to = ttk.Combobox(cmp_row, values=to_names, state="readonly", width=max(len(n) for n in to_names) + 1)
    cb_to.current(to_keys.index(v["to"]) if v["to"] in to_keys else 0)
    cb_to.pack(side="left", padx=(6, 10))

    def on_cmp(_e=None) -> None:
        ui["from"] = cb_from.get()
        ui["to"] = to_keys[max(cb_to.current(), 0)]
        app.render()

    cb_from.bind("<<ComboboxSelected>>", on_cmp)
    cb_to.bind("<<ComboboxSelected>>", on_cmp)
    var_exact = tk.BooleanVar(value=bool(ui.get("exact")))
    ttk.Checkbutton(cmp_row, text=_("přesně (s ověřením simulací)"), variable=var_exact,
                    command=lambda: (ui.update(exact=var_exact.get()), app.render())).pack(side="left")
    cmp_row._var = var_exact

    def save_md() -> None:
        r = app.bridge.request("revision.md", prj=app.prj, exact=bool(ui.get("exact")),
                               **{"from": v["from"], "to": v["to"]})
        save_file(app, _file_name(app, r["file"]), r["md"])

    ttk.Button(cmp_row, text=_("Uložit {file}…", file=v["file"]), command=save_md).pack(side="right")
    if d["empty"]:
        summ = _("Beze změny.")
    else:
        c = d["counts"]
        summ = _("Klasifikace: {cls} — {n} změn ({c} kosmetických, {f} funkčních, {s} bezpečnostních)",
                 cls=d["clsLabel"], n=len(d["changes"]), c=c["cosmetic"], f=c["functional"], s=c["safety"])
    tk.Label(parent, text=summ, bg=theme.BG, fg=TONE.get(d["tone"], theme.FG), font=theme.FONT_ACCENT,
             anchor="w").pack(fill="x")

    nb = ttk.Notebook(parent, style="Compact.TNotebook")
    nb.pack(fill="both", expand=True, pady=(4, 0))
    tabs = []

    def tab(text):
        f = ttk.Frame(nb, padding=(0, 6, 0, 0))
        nb.add(f, text=text)
        tabs.append(f)
        return f

    t_ch = tab(_("Změny ({n})", n=len(d["changes"])))
    t_inv = tab(_("Zneplatněná schválení ({n})", n=len(d["invalidates"])))
    t_rt = tab(_("Opakované zkoušky ({n})", n=len(rt["commissioning"]) + len(rt["fat"]) + len(rt["safety"])))
    t_revs = tab(_("Revize ({n})", n=len(revs)))
    nb.bind("<<NotebookTabChanged>>", lambda _e: ui.update(tab=nb.index("current")))

    # změny
    tbl = Table(t_ch, [("n", "#", 36, False), ("area", _("Oblast"), 110, False), ("what", _("Položka"), 170, False),
                       ("detail", _("Změna (před → po)"), 300, True), ("cls", _("Třída"), 100, False),
                       ("appr", _("Dotčená schválení"), 220, True)], height=6)
    tbl.pack(fill="both", expand=True)
    for k, col in CLASS_COLOR.items():
        tbl.tv.tag_configure(k, foreground=col)
    for c in d["changes"]:
        appr = ", ".join([a["title"] for a in c["affects"]] + [a["title"] + " ?" for a in c["maybe"]]) or "—"
        tbl.add(f"c{c['n']}", (c["n"], c["areaLabel"], c["what"], c["detail"], c["clsLabel"], appr), tags=(c["cls"],))
    notes = []
    if d.get("unattributed"):
        notes.append(_("Odvozené změny bez přímé vazby na položku návrhu (ovlivňují klasifikaci celku): {list}.",
                       list=", ".join(a["title"] for a in d["unattributed"])))
    if d["maybe"]:
        notes.append(_("„?“ = položka závisí na ověření simulací, které se pro tento přehled nespouštělo — "
                       "změní se, pokud změna ovlivní výsledek ověření. Přesný výsledek dá volba „přesně“."))
    if notes:
        wrap_label(t_ch, "\n".join(notes), pady=(4, 0))

    # zneplatněná schválení
    ti = Table(t_inv, [("title", _("Položka"), 260, True), ("who", _("Schválil"), 200, False)], height=5)
    ti.pack(fill="both", expand=True)
    for i in d["invalidates"]:
        who = f"{i['by']}, {i['at']}" if i["by"] else ""
        if i.get("maybe"):
            who += "  (" + _("možná — závisí na ověření simulací") + ")"
        ti.add(i["key"], (i["title"], who))
    bar = ttk.Frame(t_inv)
    bar.pack(fill="x", pady=(4, 0))
    if d["added"]:
        ttk.Label(bar, text=_("Nové povinné položky ke schválení: {list}.", list=", ".join(a["title"] for a in d["added"])),
                  style="Dim.TLabel").pack(side="left")
    if not d["invalidates"]:
        ttk.Label(bar, text=_("Změna nezneplatňuje žádné platné schválení."), style="Dim.TLabel").pack(side="left")

    def to_approval() -> None:
        keys = [i["key"] for i in d["invalidates"]] + [a["key"] for a in d["added"]]
        if keys:
            app.ui.setdefault("appr", {})["sel"] = keys[0]
        app.goto(11)
        app.set_status(_("Položky dotčené změnou: {n} — označené ve Schválení.", n=len(keys)))

    ttk.Button(bar, text=_("Otevřít krok Schválení") + " →", command=to_approval).pack(side="right")

    # opakované zkoušky
    wrap_label(t_rt, "\n".join(rt["notes"]), style="TLabel")
    tr_ = Table(t_rt, [("id", "ID", 150, False), ("what", _("Krok / bod"), 320, True), ("phase", _("Fáze"), 200, False)],
                height=5, tree=True)
    tr_.tv.heading("#0", text=_("Oddíl"), anchor="w")
    tr_.tv.column("#0", width=210, stretch=False)
    tr_.pack(fill="both", expand=True, pady=(4, 0))
    if rt["fat"]:
        g = tr_.add("g:fat", ("", "", ""), text=_("Body FAT"), tags=("group",))
        for k, f in enumerate(rt["fat"]):
            tr_.add(f"fat{k}", (f["ref"], f["text"], f["section"]), parent=g)
    if rt["commissioning"]:
        g = tr_.add("g:com", ("", "", ""), text=_("Kroky oživení ({n})", n=len(rt["commissioning"])), tags=("group",))
        for s in rt["commissioning"]:
            tr_.add("com:" + s["id"], (s["id"], s["title"], s["phaseLabel"]), parent=g)
    if rt["safety"]:
        g = tr_.add("g:sf", ("", "", ""), text=_("Validace bezpečnostních funkcí"), tags=("group",))
        for k, s in enumerate(rt["safety"]):
            tr_.add(f"sf{k}", (s["sf"], s["title"] + " — " + s["text"], ""), parent=g)
    rbar = ttk.Frame(t_rt)
    rbar.pack(fill="x", pady=(4, 0))
    ttk.Label(rbar, text=_("Rozsah opakovaných zkoušek je návrh — potvrzuje ho odpovědná osoba."),
              style="Dim.TLabel").pack(side="left")

    def to_commission() -> None:
        if rt["commissioning"]:
            app.ui.setdefault("com", {})["sel"] = rt["commissioning"][0]["id"]
        app.goto(12)
        app.set_status(_("Kroky oživení k opakování: {n} (první je vybraný).", n=len(rt["commissioning"])))

    if rt["commissioning"]:
        ttk.Button(rbar, text=_("Otevřít krok Oživení") + " →", command=to_commission).pack(side="right")

    # revize
    tv = Table(t_revs, [("id", _("Rev"), 50, False), ("date", _("Datum"), 130, False), ("by", _("Vydal"), 140, False),
                        ("note", _("Popis změny"), 260, True), ("cls", _("Změny proti předchozí"), 160, False),
                        ("ok", _("Schváleno"), 90, False)], height=5)
    tv.pack(fill="both", expand=True)
    for t, col in TONE.items():
        tv.tv.tag_configure(t, foreground=col)
    for r in revs:
        tv.add("r:" + r["id"], (r["id"], r["date"], r["by"], r["note"] or "—", r["clsLabel"], r["approved"]), tags=(r["tone"],))
    if v["modified"]:
        tv.add("r:*", (v["label"], "", "—", _("rozpracováno — obsah se od poslední revize změnil"), "", ""), tags=("warn",))

    if isinstance(ui.get("tab"), int) and ui["tab"] < len(tabs):
        nb.select(ui["tab"])


def affected(app) -> dict:
    """Položky ke schválení dotčené změnou od poslední revize (zvýraznění v kroku Schválení)."""
    if not app.prj.get("revisions"):
        return {"rev": "", "invalid": [], "added": []}
    try:
        return app.bridge.request("revision.affected", prj=app.prj)
    except BridgeError:
        return {"rev": "", "invalid": [], "added": []}
