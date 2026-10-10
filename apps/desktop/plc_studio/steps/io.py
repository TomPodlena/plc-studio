"""Krok 5 — I/O mapování: tagy, adresy, NC, komentáře + kontrola návrhu."""

from __future__ import annotations

from collections import Counter

from tkinter import ttk

from .. import theme
from ..i18n import _
from ..widgets import Table, card, link, scrolled_text, set_text, wrap_label

NC_ON, NC_OFF = "☑", "☐"


def render(app, parent) -> None:
    app.sync()
    body = card(parent, "05", _("I/O mapování"))
    stats = ttk.Frame(body)
    stats.pack(fill="x", pady=(0, 8))

    # --- zdola: kontrola návrhu a nástroje ---
    check = ttk.Frame(body)
    check.pack(side="bottom", fill="x", pady=(8, 0))
    check_head = ttk.Frame(check)
    check_head.pack(fill="x")
    check_lbl = ttk.Label(check_head, text="")
    check_lbl.pack(side="left")
    b_fix = ttk.Button(check_head, text=_("Opravit tagy automaticky (ASCII)"))
    issues_frm, issues_txt = scrolled_text(check, height=5, readonly=True, bg=theme.WARN_BG)
    issues_txt.tag_configure("error", foreground=theme.ERR)
    issues_txt.tag_configure("warn", foreground=theme.WARN)
    issues_txt.tag_configure("info", foreground=theme.DIM)     # způsob řešení, nic k opravě

    # nápověda pod nástroji na vlastním řádku — vedle odkazů se v užším okně nevejde
    wrap_label(body, _("Úprava dvojklikem do buňky, NC kliknutím. Adresy přiděluje sestava hardwaru "
                       "(ruční adresa kanál připne). Duplicity červeně.") + " " + _(
                   "Prázdný tag nebo komentář = výchozí, prázdná adresa = přidělit automaticky; adresu "
                   "zapiš v Siemens notaci (%I0.0, %QW64) nebo v notaci platformy hardwaru."),
               side="bottom", pady=(4, 0))
    tools = ttk.Frame(body)
    tools.pack(side="bottom", fill="x", pady=(6, 0))

    def by_key(key: str) -> dict | None:
        return next((e for e in app.prj["io"] if e["key"] == key), None)

    def edit(iid: str, col: str, value: str) -> None:
        """Úprava buňky přes jádro (edit.ts): prázdný tag / komentář = výchozí, neplatná nebo
        obsazená adresa se neuloží (hláška ve stavovém řádku, buňka se vrátí)."""
        if by_key(iid) is None:
            return
        fn = {"tag": "setIoTag", "addr": "setIoAddr", "cmt": "setIoCmt"}[col]
        res = app.edit(fn, iid, value)
        if not res.get("ok"):
            app.set_status("⚠ " + (res.get("error") or ""), keep=True)
        refresh(keep=iid)

    def click(iid: str, col: str) -> None:
        e = by_key(iid)
        if col == "nc" and e is not None and e["dir"] == "DI":
            e["nc"] = not e.get("nc")
            app.save()
            refresh(keep=iid)

    tbl = Table(body, [("dev", _("Zařízení"), 80, False), ("dir", _("Směr"), 55, False),
                       ("tag", _("Tag"), 210, True), ("addr", _("Adresa"), 90, False),
                       ("nc", "NC", 45, False), ("cmt", _("Komentář"), 380, True)],
                height=10, editable=("tag", "addr", "cmt"), on_edit=edit, on_click=click)
    tbl.pack(fill="both", expand=True)
    tbl.tv.column("nc", anchor="center")

    # přečíslování a oprava tagů v jádře (edit.ts renumberIo / fixIoTags — jako web)
    def renumber() -> None:
        res = app.edit("renumberIo")
        refresh()
        app.set_status(_("Adresy přečíslovány od nuly ({n} signálů).", n=res.get("count", 0)))

    def fix_tags() -> None:
        res = app.edit("fixIoTags")
        refresh()
        app.set_status(_("Opraveno tagů: {n}", n=res.get("count", 0)))      # odezva i když není co opravit

    def with_row(action) -> None:
        e = by_key(tbl.selected() or "")
        if e is None:
            app.set_status(_("Nejdřív vyber signál v tabulce."))
        else:
            action(e)

    b_fix.configure(command=fix_tags)
    ttk.Button(tools, text=_("Přečíslovat adresy od nuly"), command=renumber).pack(side="left")
    ttk.Label(tools, text=_("Vybraný signál:"), style="Dim.TLabel").pack(side="left", padx=(16, 0))
    link(tools, _("Zařízení ↗"), lambda: with_row(lambda e: app.open_device(e["devId"]))
         ).pack(side="left", padx=(8, 0))
    link(tools, _("Zapojení ↗"), lambda: with_row(lambda e: app.open_wiring(e["key"]))
         ).pack(side="left", padx=(12, 0))
    link(tools, _("Blokové schéma ↗"), lambda: with_row(lambda e: app.open_block(e["devId"]))
         ).pack(side="left", padx=(12, 0))

    def refresh(keep: str | None = None) -> None:
        """Překreslí tabulku, statistiky a kontrolu (bez překreslení celého kroku)."""
        io = app.prj["io"]
        top = tbl.tv.yview()[0]
        tbl.clear()
        tags = Counter(e["tag"] for e in io)
        addrs = Counter(e["addr"] for e in io if e["addr"])
        for e in io:
            d = app.dev_by_id(e["devId"])
            dup = tags[e["tag"]] > 1 or (e["addr"] and addrs[e["addr"]] > 1)
            nc = (NC_ON if e.get("nc") else NC_OFF) if e["dir"] == "DI" else "—"
            tbl.add(e["key"], (d["name"] if d else "?", e["dir"], e["tag"], e["addr"], nc,
                               e["cmt"]), tags=("dup",) if dup else ())
        if not io:
            tbl.add("empty", ("", "", _("žádná zařízení"), "", "", ""), tags=("dim",))
        tbl.tv.yview_moveto(top)
        if keep:
            tbl.select(keep)

        for w in stats.winfo_children():
            w.destroy()
        dirs = Counter(e["dir"] for e in io)
        for label, n in [(_("tagů"), len(io))] + [(k, dirs[k]) for k in ("DI", "DO", "AI", "AO")]:
            ttk.Label(stats, text=f"{label}  {n}", style="Stat.TLabel").pack(side="left", padx=(0, 6))

        issues = app.core("validateProject", app.prj)
        if issues:
            check_lbl.configure(text=_("Kontrola návrhu — nálezů: {n}", n=len(issues)),
                                style="Err.TLabel")
            b_fix.pack(side="right")
            issues_frm.pack(fill="x", pady=(4, 0))
            issues_txt.configure(state="normal")
            set_text(issues_txt, "")
            for i in issues[:60]:
                issues_txt.insert("end", f"{i['where']} — {i['msg']}\n", i["level"])
            if len(issues) > 60:
                issues_txt.insert("end", _("… a dalších {n}", n=len(issues) - 60) + "\n")
            issues_txt.configure(state="disabled")
        else:
            check_lbl.configure(text=_("Kontrola návrhu: bez nálezů ✓"), style="Ok.TLabel")
            b_fix.pack_forget()
            issues_frm.pack_forget()

    tbl.tv.bind("<<TreeviewSelect>>",
                lambda _e: app.ui.__setitem__("io_sel", tbl.selected()))
    refresh(keep=app.ui.get("io_sel"))      # odkaz odjinud vybere svůj signál
