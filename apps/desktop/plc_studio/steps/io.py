"""Krok 5 — I/O mapování: tagy, adresy, NC, komentáře + kontrola návrhu."""

from __future__ import annotations

from collections import Counter

from tkinter import ttk

from .. import theme
from ..widgets import Table, card, link, scrolled_text, set_text

NC_ON, NC_OFF = "☑", "☐"


def render(app, parent) -> None:
    app.sync()
    body = card(parent, "05", "I/O mapování")
    stats = ttk.Frame(body)
    stats.pack(fill="x", pady=(0, 8))

    # --- zdola: kontrola návrhu a nástroje ---
    check = ttk.Frame(body)
    check.pack(side="bottom", fill="x", pady=(8, 0))
    check_head = ttk.Frame(check)
    check_head.pack(fill="x")
    check_lbl = ttk.Label(check_head, text="")
    check_lbl.pack(side="left")
    b_fix = ttk.Button(check_head, text="Opravit tagy automaticky (ASCII)")
    issues_frm, issues_txt = scrolled_text(check, height=5, readonly=True, bg=theme.WARN_BG)
    issues_txt.tag_configure("error", foreground=theme.ERR)
    issues_txt.tag_configure("warn", foreground=theme.WARN)

    tools = ttk.Frame(body)
    tools.pack(side="bottom", fill="x", pady=(6, 0))

    def by_key(key: str) -> dict | None:
        return next((e for e in app.prj["io"] if e["key"] == key), None)

    def edit(iid: str, col: str, value: str) -> None:
        e = by_key(iid)
        if e is not None:
            e[col] = value.strip()
            app.save()
            refresh(keep=iid)

    def click(iid: str, col: str) -> None:
        e = by_key(iid)
        if col == "nc" and e is not None and e["dir"] == "DI":
            e["nc"] = not e.get("nc")
            app.save()
            refresh(keep=iid)

    tbl = Table(body, [("dev", "Zařízení", 80, False), ("dir", "Směr", 55, False),
                       ("tag", "Tag", 210, True), ("addr", "Adresa", 90, False),
                       ("nc", "NC", 45, False), ("cmt", "Komentář", 380, True)],
                height=10, editable=("tag", "addr", "cmt"), on_edit=edit, on_click=click)
    tbl.pack(fill="both", expand=True)
    tbl.tv.column("nc", anchor="center")

    def renumber() -> None:
        for e in app.prj["io"]:
            e["addr"] = ""
        app.prj = app.bridge.mutate("autoAddr", app.prj, True)
        app.save()
        refresh()

    def fix_tags() -> None:
        used = set()
        for e in app.prj["io"]:
            base = tag = app.core("sanitizeTag", e["tag"])
            n = 2
            while tag in used:
                tag = f"{base}_{n}"
                n += 1
            used.add(tag)
            e["tag"] = tag
        app.save()
        refresh()

    def with_row(action) -> None:
        e = by_key(tbl.selected() or "")
        if e is None:
            app.set_status("Nejdřív vyber signál v tabulce.")
        else:
            action(e)

    b_fix.configure(command=fix_tags)
    ttk.Button(tools, text="Přečíslovat adresy od nuly", command=renumber).pack(side="left")
    ttk.Label(tools, text="Vybraný signál:", style="Dim.TLabel").pack(side="left", padx=(16, 0))
    link(tools, "Zařízení ↗", lambda: with_row(lambda e: app.open_device(e["devId"]))
         ).pack(side="left", padx=(8, 0))
    link(tools, "Zapojení ↗", lambda: with_row(lambda e: app.open_wiring(e["key"]))
         ).pack(side="left", padx=(12, 0))
    link(tools, "Blokové schéma ↗", lambda: with_row(lambda e: app.open_block(e["devId"]))
         ).pack(side="left", padx=(12, 0))
    ttk.Label(tools, style="Dim.TLabel",
              text="Úprava dvojklikem do buňky, NC kliknutím. Adresy v Siemens notaci. "
                   "Duplicity červeně.").pack(side="right")

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
            tbl.add("empty", ("", "", "žádná zařízení", "", "", ""), tags=("dim",))
        tbl.tv.yview_moveto(top)
        if keep:
            tbl.select(keep)

        for w in stats.winfo_children():
            w.destroy()
        dirs = Counter(e["dir"] for e in io)
        for label, n in [("tagů", len(io))] + [(k, dirs[k]) for k in ("DI", "DO", "AI", "AO")]:
            ttk.Label(stats, text=f"{label}  {n}", style="Stat.TLabel").pack(side="left", padx=(0, 6))

        issues = app.core("validateProject", app.prj)
        if issues:
            check_lbl.configure(text=f"Kontrola návrhu — nálezů: {len(issues)}", style="Err.TLabel")
            b_fix.pack(side="right")
            issues_frm.pack(fill="x", pady=(4, 0))
            issues_txt.configure(state="normal")
            set_text(issues_txt, "")
            for i in issues[:60]:
                issues_txt.insert("end", f"{i['where']} — {i['msg']}\n", i["level"])
            if len(issues) > 60:
                issues_txt.insert("end", f"… a dalších {len(issues) - 60}\n")
            issues_txt.configure(state="disabled")
        else:
            check_lbl.configure(text="Kontrola návrhu: bez nálezů ✓", style="Ok.TLabel")
            b_fix.pack_forget()
            issues_frm.pack_forget()

    tbl.tv.bind("<<TreeviewSelect>>",
                lambda _e: app.ui.__setitem__("io_sel", tbl.selected()))
    refresh(keep=app.ui.get("io_sel"))      # odkaz odjinud vybere svůj signál
