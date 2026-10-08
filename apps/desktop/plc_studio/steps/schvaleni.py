"""Krok 12 — Schválení: aplikace navrhuje, odpovědná osoba schvaluje.

Položky, jejich otisky a stavy počítá jádro (``approval.ts`` přes operaci mostu
``approval``); tady se jen zobrazují a zapisují rozhodnutí (``approve`` / ``reject`` /
``resetApproval``) do ``prj["approvals"]``. Schválení platí pro obsah v okamžiku
schválení — po změně obsahu je položka „změněno po schválení“ a schvaluje se znovu.
Jméno schvalujícího se zadá jednou a drží v ``settings.json`` (sdílí ho i krok Oživení).
"""

from __future__ import annotations

import tkinter as tk
from tkinter import messagebox, ttk

from .. import theme
from ..bridge import BridgeError
from ..i18n import _
from ..widgets import Table, card, note_box, save_file, wrap_label

NAME_MAX = 60
GREY = "#6B6C6E"            # „čeká“ — tmavší než DIM, ať jde řádek přečíst
STATUS_COLOR = {"approved": theme.OK, "stale": theme.WARN, "rejected": theme.ERR,
                "missing": GREY, "proposed": GREY, "unverified": GREY}


# --- sdílené s kroky Bezpečnost a Oživení ------------------------------------------

def approver(app) -> str:
    """Jméno odpovědné osoby (prázdné = nezadáno)."""
    return str(app.settings.get("approver") or "").strip()


def name_bar(parent, app, label: str, on_change=None) -> ttk.Entry:
    """Pole se jménem odpovědné osoby; mění ``settings.json`` průběžně."""
    ttk.Label(parent, text=label).pack(side="left")
    var = tk.StringVar(value=approver(app))
    from .knihovna import approver_names              # schvalovatelé z firemní knihovny projektu
    names = approver_names(app)
    if names:            # výběr ze jmen knihovny, ale dá se napsat i jiné jméno
        ent = ttk.Combobox(parent, textvariable=var, values=names, width=26)
    else:
        ent = ttk.Entry(parent, textvariable=var, width=26)
    ent._var = var                                     # držet proměnnou naživu (GC)
    ent.pack(side="left", padx=(6, 0))

    def changed(*_a) -> None:
        v = var.get()
        if len(v) > NAME_MAX:                          # delší jméno neprojde
            var.set(v[:NAME_MAX])
            return
        if v.strip() != approver(app):
            app.settings["approver"] = v.strip()
            app.save_settings()
        if on_change:
            on_change()

    var.trace_add("write", changed)
    return ent


def approval_data(app) -> dict:
    """Položky ke schválení se stavy (projekt z mostu převezme srovnané I/O)."""
    data = app.fetch("approval", prj=app.prj)
    app.prj = data["prj"]
    return data


def when(rec: dict | None) -> str:
    """Kdo a kdy: „Jan Novák, 2026-10-03 14:05“."""
    if not rec:
        return ""
    at = str(rec.get("at") or "")
    return f"{rec.get('by', '')}, {at[:10]} {at[11:16]}".strip(", ")


def status_label(parent, item: dict, **kw) -> tk.Label:
    """Stav položky barevně (schváleno zeleně, změněno oranžově, zamítnuto červeně, čeká šedě)."""
    return tk.Label(parent, text=item["statusLabel"], bg=kw.pop("bg", theme.BG),
                    fg=STATUS_COLOR.get(item["status"], GREY), font=theme.FONT_ACCENT, **kw)


def summary_row(parent, s: dict) -> ttk.Frame:
    """Souhrn: počty podle stavů a povinné položky bez platného schválení."""
    row = ttk.Frame(parent)
    for text, color in ((_("{n} schváleno", n=s["approved"]), theme.OK),
                        (_("{n} změněno po schválení", n=s["stale"]), theme.WARN),
                        (_("{n} zamítnuto", n=s["rejected"]), theme.ERR),
                        (_("{n} čeká", n=s["pending"]), GREY)):
        tk.Label(row, text=text, bg=theme.FIELD, fg=color, font=theme.FONT_ACCENT,
                 padx=8, pady=2).pack(side="left", padx=(0, 6))
    if s["blocking"]:
        tk.Label(row, text=_("Povinné bez platného schválení: {n}", n=len(s["blocking"])),
                 bg=theme.BG, fg=theme.WARN, font=theme.FONT_UI).pack(side="left", padx=(8, 0))
    else:
        tk.Label(row, text="✔ " + _("Všechny povinné položky jsou schválené."), bg=theme.BG,
                 fg=theme.OK, font=theme.FONT_UI).pack(side="left", padx=(8, 0))
    return row


def _file_name(app, base: str) -> str:
    import re
    name = re.sub(r'[<>:"/\\|?*]+', "_", app.prj["meta"]["name"] or "").strip(" ._")
    return f"{name}_{base}" if name else base


# --- krok ----------------------------------------------------------------------------

def render(app, parent) -> None:
    body = card(parent, "12", _("Schválení"))
    if not app.prj["devices"]:
        wrap_label(body, _("Nejdřív navrhni zařízení (kroky 2–4)."))
        return
    wait = ttk.Label(body, text=_("Počítám stav položek — u velkého stroje první ověření "
                                  "simulací chvíli trvá…"), style="Dim.TLabel")
    wait.pack(anchor="w")
    app.root.update_idletasks()
    data = approval_data(app)
    wait.destroy()
    ui = app.ui.setdefault("appr", {})
    items: list[dict] = data["items"]
    by_key = {it["key"]: it for it in items}
    s = data["summary"]

    wrap_label(body, _(
        "PLCdesk navrhuje, odpovědná osoba schvaluje. Každá položka se schvaluje jménem, "
        "datem a poznámkou a schválení platí pro obsah v okamžiku schválení — když se obsah "
        "změní, položka je „změněno po schválení“ a je potřeba ji schválit znovu. Nic se "
        "neschvaluje automaticky; platí jen schválené."))

    row = summary_row(body, s)
    row.pack(fill="x", pady=(8, 6))
    ttk.Button(row, text=_("Uložit {file}…", file=data["file"]),
               command=lambda: save_file(app, _file_name(app, data["file"]), data["md"], "dokumentace")
               ).pack(side="right")

    nb = ttk.Notebook(body)
    nb.pack(fill="both", expand=True)
    t_items = ttk.Frame(nb, padding=(0, 6, 0, 0))
    t_tune = ttk.Frame(nb, padding=(0, 6, 0, 0))
    nb.add(t_items, text=_("Položky ({n})", n=len(items)))
    nb.add(t_tune, text=_("Návrhy ladění ({n})", n=len(data["tuning"])))
    t_orph = None
    if data["orphans"]:
        t_orph = ttk.Frame(nb, padding=(0, 6, 0, 0))
        nb.add(t_orph, text=_("Záznamy bez položky ({n})", n=len(data["orphans"])))
    nb.bind("<<NotebookTabChanged>>", lambda _e: ui.update(tab=nb.index("current")))

    # --- položky po skupinách -----------------------------------------------------------
    main = ttk.Frame(t_items)
    main.pack(fill="both", expand=True)
    main.columnconfigure(0, weight=1)
    main.rowconfigure(0, weight=1)
    tbl = Table(main, [("status", _("Stav"), 150, False), ("who", _("Kdo a kdy"), 150, False),
                       ("sum", _("Co se schvaluje"), 260, True)], height=10, tree=True,
                ellipsis=True)
    tbl.tv.heading("#0", text=_("Položka"), anchor="w")
    tbl.tv.column("#0", width=300, stretch=True)
    tbl.tv.configure(selectmode="extended")             # hromadné schválení vybraných (Ctrl/Shift)
    tbl.grid(row=0, column=0, sticky="nsew")
    for st, color in STATUS_COLOR.items():
        tbl.tv.tag_configure(st, foreground=color)
    # položky dotčené změnou od poslední revize (revision.ts) — podbarvit
    from .revize import affected
    aff = affected(app)
    rev_inv = set(aff["invalid"])
    tbl.tv.tag_configure("revchg", background=theme.WARN_BG)
    for g, label in data["groups"].items():
        its = [it for it in items if it["group"] == g]
        if not its:
            continue
        open_ = ui.get("closed", {}).get(g) is not True
        gid = tbl.add("g:" + g, ("", "", ""), text=f"{label} ({len(its)})", tags=("group",),
                      open_=open_)
        for it in its:
            tbl.add(it["key"], (it["statusLabel"], when(it["rec"]), it["summary"]), parent=gid,
                    text=it["title"], tags=(it["status"], *(("revchg",) if it["key"] in rev_inv else ())))
    if rev_inv:
        tk.Label(t_items, text=_("Podbarvené položky: změna od revize {rev} se dotýká {n} položek, které byly při "
                                 "vydání revize platně schválené — znovu posoudit a schválit. Přehled změn je "
                                 "v kroku Projekt.", rev=aff["rev"], n=len(rev_inv)),
                 bg=theme.WARN_BG, fg=theme.FG, font=theme.FONT_DIM, anchor="w", justify="left", padx=8, pady=4,
                 wraplength=1000).pack(fill="x", before=main)

    def on_toggle(opened: bool):
        def h(_e=None):
            iid = tbl.tv.focus()
            if iid.startswith("g:"):
                ui.setdefault("closed", {})[iid[2:]] = not opened
        return h

    tbl.tv.bind("<<TreeviewOpen>>", on_toggle(True))
    tbl.tv.bind("<<TreeviewClose>>", on_toggle(False))

    # --- panel vybrané položky ----------------------------------------------------------
    side = ttk.Frame(main, width=360)
    side.grid(row=0, column=1, sticky="nsew", padx=(12, 0))
    side.grid_propagate(False)
    side.pack_propagate(False)
    nm = ttk.Frame(side)
    nm.pack(fill="x")
    title = ttk.Label(side, text="", style="Section.TLabel", wraplength=340, justify="left")
    title.pack(anchor="w", pady=(10, 2))
    stat = tk.Label(side, text="", bg=theme.BG, font=theme.FONT_ACCENT, anchor="w")
    stat.pack(anchor="w")
    summ = ttk.Label(side, text=_("Vyber položku v seznamu."), style="Dim.TLabel",
                     wraplength=340, justify="left")
    summ.pack(anchor="w", pady=(2, 6))
    rec_lbl = ttk.Label(side, text="", wraplength=340, justify="left")
    rec_lbl.pack(anchor="w")
    ready_lbl = ttk.Label(side, text="", style="Err.TLabel", wraplength=340, justify="left")
    ttk.Label(side, text=_("Poznámka (u zamítnutí důvod):"), style="Dim.TLabel"
              ).pack(anchor="w", pady=(8, 0))
    var_note = tk.StringVar(value=ui.get("note", ""))
    ent_note = ttk.Entry(side, textvariable=var_note)
    ent_note._var = var_note
    ent_note.pack(fill="x", pady=(2, 6))
    var_note.trace_add("write", lambda *_a: ui.update(note=var_note.get()))
    btns = ttk.Frame(side)
    btns.pack(fill="x")
    # šířka podle textu (nejmenší 6 znaků) — tři tlačítka se vejdou i v němčině
    b_ok = ttk.Button(btns, text=_("Schválit"), style="Accent.TButton", width=-6)
    b_no = ttk.Button(btns, text=_("Zamítnout"), width=-6)
    b_reset = ttk.Button(btns, text=_("Zrušit rozhodnutí"), width=-6)
    for b in (b_ok, b_no, b_reset):
        b.pack(side="left", padx=(0, 6))
    bulk = ttk.Frame(side)
    bulk.pack(fill="x", pady=(6, 0))
    b_sel = ttk.Button(bulk, text=_("Schválit vybrané"), width=-6)
    b_grp = ttk.Button(bulk, text=_("Schválit celou skupinu"), width=-6)
    for b in (b_sel, b_grp):
        b.pack(side="left", padx=(0, 6))
    hint = ttk.Label(side, text="", style="Dim.TLabel", wraplength=340, justify="left")
    hint.pack(anchor="w", pady=(6, 0))

    def cur() -> dict | None:
        return by_key.get(ui.get("sel") or "")

    def update_buttons() -> None:
        it = cur()
        name = approver(app)
        can = it is not None and bool(name)
        b_ok.state(["!disabled"] if can and it.get("ready") is not False else ["disabled"])
        b_no.state(["!disabled"] if can else ["disabled"])
        b_reset.state(["!disabled"] if it is not None and it["rec"] else ["disabled"])
        b_sel.state(["!disabled"] if name and bulk_keys("sel") else ["disabled"])
        b_grp.state(["!disabled"] if name and bulk_keys("group") else ["disabled"])
        hint.configure(text="" if name else _("Bez jména schvalující osoby nelze schválit ani "
                                              "zamítnout — zadej ho nahoře."))

    name_bar(nm, app, _("Schvaluje:"), update_buttons)

    def show() -> None:
        it = cur()
        ready_lbl.pack_forget()
        if it is None:
            title.configure(text="")
            stat.configure(text="")
            summ.configure(text=_("Vyber položku v seznamu."))
            rec_lbl.configure(text="")
        else:
            title.configure(text=it["title"])
            stat.configure(text=it["statusLabel"] + ("" if it["required"] else
                                                      "  · " + _("nepovinná")),
                           fg=STATUS_COLOR.get(it["status"], GREY))
            summ.configure(text=it["summary"] + ("\n⚠ " + _("dotčeno změnou od revize {rev}", rev=aff["rev"])
                                                 if it["key"] in rev_inv else ""))
            rec = it["rec"]
            lines = []
            if rec:
                lines.append(_("Rozhodl(a): {who}", who=when(rec)))
                if rec.get("note"):
                    lines.append(_("Poznámka: {note}", note=rec["note"]))
            rec_lbl.configure(text="\n".join(lines))
            if it.get("ready") is False:
                ready_lbl.configure(text="⚠ " + (it.get("notReady") or _("Položku zatím nelze schválit.")))
                ready_lbl.pack(anchor="w", pady=(4, 0), after=rec_lbl)
        update_buttons()

    def decide(action: str) -> None:
        it = cur()
        if it is None:
            return
        name, note = approver(app), var_note.get().strip()
        if action != "reset" and not name:
            app.set_status(_("Zadej jméno schvalující osoby."))
            return
        if action == "reject" and not note:
            app.set_status(_("Zamítnutí potřebuje důvod — napiš ho do poznámky."))
            ent_note.focus_set()
            return
        try:
            if action == "approve":
                app.prj = app.bridge.mutate("approve", app.prj, it["key"], name, note or None)
                msg = _("Schváleno: {title}", title=it["title"])
            elif action == "reject":
                app.prj = app.bridge.mutate("reject", app.prj, it["key"], name, note)
                msg = _("Zamítnuto: {title}", title=it["title"])
            else:
                app.prj = app.bridge.mutate("resetApproval", app.prj, it["key"])
                msg = _("Rozhodnutí zrušeno: {title}", title=it["title"])
        except BridgeError as exc:
            app.set_status("⚠ " + str(exc))
            return
        ui["note"] = ""
        app.save()
        app.render()
        app.set_status(msg)

    def bulk_keys(which: str) -> list[str]:
        """Neschválené položky, které jde schválit: vybrané řádky, nebo celá skupina výběru."""
        sel = list(tbl.tv.selection())
        if which == "sel":
            keys = [k for k in sel if k in by_key]
        else:
            g = next((k[2:] for k in sel if k.startswith("g:")), None)                 or (by_key[sel[0]]["group"] if sel and sel[0] in by_key else None)
            keys = [it["key"] for it in items if it["group"] == g]
        return [k for k in keys if by_key[k]["status"] != "approved" and by_key[k].get("ready") is not False]

    def decide_many(which: str) -> None:
        keys, name = bulk_keys(which), approver(app)
        if not keys or not name:
            return
        if not messagebox.askyesno(
                _("Schválit hromadně?"),
                _("Schválit {n} položek jménem {name}? Každá dostane vlastní záznam se svým "
                  "otiskem a dnešním datem; nic dalšího se neschválí.", n=len(keys), name=name),
                parent=app.root):
            return
        try:
            r = app.bridge.request("approval.many", prj=app.prj, keys=keys, by=name,
                                   note=var_note.get().strip())
        except BridgeError as exc:
            app.set_status("⚠ " + str(exc))
            return
        app.prj = r["prj"]
        ui["note"] = ""
        app.save()
        app.render()
        msg = _("Schváleno položek: {n}", n=len(r["approved"]))
        if r["skipped"]:
            msg += " · " + _("přeskočeno: {n}", n=len(r["skipped"]))
        app.set_status(msg)

    b_sel.configure(command=lambda: decide_many("sel"))
    b_grp.configure(command=lambda: decide_many("group"))
    b_ok.configure(command=lambda: decide("approve"))
    b_no.configure(command=lambda: decide("reject"))
    b_reset.configure(command=lambda: decide("reset"))

    def on_select(_e=None) -> None:
        iid = tbl.selected()
        if iid and iid in by_key:
            if iid != ui.get("sel"):
                var_note.set("")
            ui["sel"] = iid
            show()
        else:
            update_buttons()                              # skupina: jen hromadná tlačítka

    tbl.tv.bind("<<TreeviewSelect>>", on_select)

    _render_tuning(app, t_tune, data, ui)
    if t_orph is not None:
        _render_orphans(app, t_orph, data)

    if ui.get("tab") and ui["tab"] < len(nb.tabs()):
        nb.select(ui["tab"])
    if ui.get("sel") in by_key:
        tbl.select(ui["sel"])
    show()


def _render_tuning(app, parent, data: dict, ui: dict) -> None:
    """Návrhy ladění: důvod, „Použít“ (změní projekt, nic neschvaluje)."""
    tuning: list[dict] = data["tuning"]
    wrap_label(parent, _(
        "Návrhy úprav z ověření simulací a kontroly konceptu. „Použít“ změní projekt podle "
        "návrhu — nic se tím neschvaluje; dotčené položky pak schval znovu. Návrhy bez "
        "„Použít“ jsou jen popis: rozhodni ručně, nebo návrh schval v seznamu položek."))
    if not tuning:
        ttk.Label(parent, text="✔ " + _("Žádné návrhy ladění — ověření nenašlo co upravit."),
                  style="Ok.TLabel").pack(anchor="w", pady=(10, 0))
        return
    main = ttk.Frame(parent)
    main.pack(fill="both", expand=True, pady=(6, 0))
    main.columnconfigure(0, weight=1)
    main.rowconfigure(0, weight=1)
    tbl = Table(main, [("title", _("Návrh"), 320, True), ("kind", _("Úprava"), 110, False)],
                height=8)
    tbl.grid(row=0, column=0, sticky="nsew")
    by_id = {t["id"]: t for t in tuning}
    for t in tuning:
        tbl.add(t["id"], (t["title"], _("automaticky") if t["canApply"] else _("jen popis")),
                tags=() if t["canApply"] else ("dim",))
    side = ttk.Frame(main, width=360)
    side.grid(row=0, column=1, sticky="nsew", padx=(12, 0))
    side.grid_propagate(False)
    side.pack_propagate(False)
    title = ttk.Label(side, text="", style="Section.TLabel", wraplength=340, justify="left")
    title.pack(anchor="w")
    why = ttk.Label(side, text=_("Vyber návrh v seznamu."), wraplength=340, justify="left")
    why.pack(anchor="w", pady=(4, 8))
    b_apply = ttk.Button(side, text=_("Použít"), style="Accent.TButton")
    b_apply.pack(anchor="w")
    last = ttk.Label(side, text=ui.get("tuned", ""), style="Dim.TLabel", wraplength=340,
                     justify="left")
    last.pack(anchor="w", pady=(8, 0))

    def show() -> None:
        t = by_id.get(ui.get("tune_sel") or "")
        title.configure(text=t["title"] if t else "")
        why.configure(text=t["why"] if t else _("Vyber návrh v seznamu."))
        b_apply.state(["!disabled"] if t and t["canApply"] else ["disabled"])

    def apply() -> None:
        t = by_id.get(ui.get("tune_sel") or "")
        if not t or not t["canApply"]:
            return
        titles = {it["key"]: it["title"] for it in data["items"]}
        try:
            r = app.bridge.request("approval.tune", prj=app.prj, id=t["id"])
        except BridgeError as exc:
            app.set_status("⚠ " + str(exc))
            return
        app.prj = r["prj"]
        msg = _("Použito: {title}.", title=t["title"])
        if r["changes"]:
            msg += " " + "; ".join(f"{c['note']}: {_none(c['before'])} → {_none(c['after'])}"
                                   for c in r["changes"]) + "."
        changed = [titles[k] for k in r["affects"] if k in titles]
        if changed:
            msg += " " + _("Změněné položky ke schválení: {list}.", list=", ".join(changed))
        ui["tuned"] = msg
        ui.pop("tune_sel", None)
        app.save()
        app.render()
        app.set_status(msg)

    b_apply.configure(command=apply)

    def on_select(_e=None) -> None:
        iid = tbl.selected()
        if iid:
            ui["tune_sel"] = iid
            show()

    tbl.tv.bind("<<TreeviewSelect>>", on_select)
    if ui.get("tune_sel") in by_id:
        tbl.select(ui["tune_sel"])
    show()


def _none(v) -> str:
    return "—" if v is None else str(v)


def _render_orphans(app, parent, data: dict) -> None:
    """Záznamy schválení, ke kterým položka už není (smazané zařízení, uplatněný návrh)."""
    wrap_label(parent, _("Záznamy schválení, ke kterým už položka neexistuje — zařízení bylo "
                         "smazáno nebo přejmenováno, návrh ladění uplatněn. V dokumentu "
                         "zůstávají jako historie, dokud je nesmažeš."))
    tbl = Table(parent, [("key", _("Klíč"), 220, True), ("state", _("Stav"), 120, False),
                         ("who", _("Kdo a kdy"), 160, False), ("note", _("Poznámka"), 200, True)],
                height=6, ellipsis=True)
    tbl.pack(fill="both", expand=True, pady=(6, 6))
    for o in data["orphans"]:
        rec = o["rec"] or {}
        tbl.add(o["key"], (o["key"], o["statusLabel"], when(rec), rec.get("note", "")))
    bar = ttk.Frame(parent)
    bar.pack(fill="x")

    def delete(keys: list[str]) -> None:
        if not keys:
            app.set_status(_("Vyber záznam v seznamu."))
            return
        for k in keys:
            app.prj = app.bridge.mutate("resetApproval", app.prj, k)
        app.save()
        app.render()
        app.set_status(_("Smazáno záznamů: {n}", n=len(keys)))

    ttk.Button(bar, text=_("Smazat vybraný"),
               command=lambda: delete([tbl.selected()] if tbl.selected() else [])
               ).pack(side="left")
    ttk.Button(bar, text=_("Smazat vše"), style="Danger.TButton",
               command=lambda: delete([o["key"] for o in data["orphans"]])
               ).pack(side="left", padx=(6, 0))
