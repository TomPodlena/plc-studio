"""Krok 8 Generovat — záložka SISTEMA a EPLAN: exporty pro kontrolu PL v SISTEMA (IFA)
a pro EPLAN Electric P8 (AutomationML AR APC + seznamy + skript .cs).

Obsah počítá jádro (``sistema.ts``, ``eplan.ts``; most ``exports``). Oba exporty jsou
„neověřeno importem“ — stav je u každého souboru i v rámečku nahoře, postup je krátce
v záložce a celý v 19_sistema.md / README_EPLAN.txt. Web: ``apps/web/src/exports_step.js``.
"""

from __future__ import annotations

import tkinter as tk
from tkinter import ttk

from .. import theme
from ..i18n import N_, _, _n
from ..widgets import Table, note_box, save_file, save_many, scrolled_text, set_text


def _files_table(parent, files: list[dict], unverified: str) -> Table:
    tbl = Table(parent, [("name", _("Soubor"), 280, True), ("status", _("Stav ověření"), 160, False)],
                height=min(max(len(files), 1), 6), ellipsis=True)
    tbl.tv.tag_configure("u", foreground=theme.WARN)
    for i, f in enumerate(files):
        tbl.add(i, (f["name"], unverified), tags=("u",))
    return tbl


INFO_W = 540        # šířka levého sloupce (stav, soubory, postup); vpravo náhled souboru


def _para(parent, text: str, **pack) -> ttk.Label:
    """Odstavec s pevným zalomením — wrap_label by sloupec roztáhl na délku textu."""
    lbl = ttk.Label(parent, text=text, style="Dim.TLabel", justify="left", wraplength=INFO_W)
    lbl.pack(**({"anchor": "w"} | pack))
    return lbl


def _status(parent, text: str) -> tk.Label:
    box = note_box(parent, text, warn=True)
    box.configure(wraplength=INFO_W - 24)
    return box


def _scroll_column(parent) -> tuple[ttk.Frame, ttk.Frame]:
    """Sloupec s posuvníkem (dlouhé německé texty se do výšky okna nevejdou).
    Vrací ``(vnější rámec k umístění, vnitřní rámec pro obsah)``."""
    outer = ttk.Frame(parent)
    canvas = tk.Canvas(outer, bg=theme.BG, highlightthickness=0, width=INFO_W + 4)
    bar = ttk.Scrollbar(outer, orient="vertical", command=canvas.yview)
    canvas.configure(yscrollcommand=bar.set)
    canvas.pack(side="left", fill="both", expand=True)
    inner = ttk.Frame(canvas)
    canvas.create_window(0, 0, window=inner, anchor="nw")

    def layout(_e=None) -> None:
        need = inner.winfo_reqheight()
        canvas.configure(scrollregion=(0, 0, INFO_W, need))
        if need > canvas.winfo_height() > 1:
            if not bar.winfo_ismapped():
                bar.pack(side="right", fill="y")
        else:
            bar.pack_forget()
            canvas.yview_moveto(0)

    def wheel(e) -> None:
        if bar.winfo_ismapped():
            canvas.yview_scroll(-1 if e.delta > 0 else 1, "units")

    inner.bind("<Configure>", layout)
    canvas.bind("<Configure>", layout)
    outer.bind_all_wheel = lambda: [w.bind("<MouseWheel>", wheel) for w in [canvas, inner, *_all(inner)]
                                    if not isinstance(w, ttk.Treeview)]   # tabulka roluje sama
    return outer, inner


def _all(w):
    for c in w.winfo_children():
        yield c
        yield from _all(c)


def _steps(parent, lines: list[str]) -> None:
    for i, text in enumerate(lines):
        tk.Label(parent, text=f"{i + 1}. {text}", bg=theme.BG, fg=theme.FG, font=theme.FONT_DIM,
                 justify="left", anchor="w", wraplength=INFO_W).pack(anchor="w", pady=(1, 0))


def render(app, parent) -> None:
    data = app.bridge.request("exports", prj=app.prj)
    app.prj = data["prj"]
    sx, ep = data["sistema"], data["eplan"]
    unverified = _("neověřeno importem")
    ui = app.ui.setdefault("exports", {})

    note_box(parent, _("Soubory jsou i v kroku Dokumentace (skupiny SISTEMA a EPLAN). Licenci EPLAN "
                       "PLCdesk nemá — export je kontrolovaný vlastní strukturální kontrolou "
                       "a schématy, skutečný import je potřeba vyzkoušet."), side="bottom")
    # dvě záložky (SISTEMA / EPLAN): vlevo stav, soubory a postup, vpravo náhled souboru
    nb = ttk.Notebook(parent)
    nb.pack(fill="both", expand=True)
    panes = []
    for title in (_("SISTEMA (IFA) — kontrola PL"), _("EPLAN Electric P8")):
        tab = ttk.Frame(nb, padding=10)
        nb.add(tab, text=title)
        tab.columnconfigure(0, weight=0, minsize=INFO_W + 20)
        tab.columnconfigure(1, weight=1)
        tab.rowconfigure(0, weight=1)
        col, info = _scroll_column(tab)
        col.grid(row=0, column=0, sticky="nsew", padx=(0, 14))
        info.column = col
        side = ttk.Frame(tab)
        side.grid(row=0, column=1, sticky="nsew")
        lbl = ttk.Label(side, text="", style="Dim.TLabel")
        lbl.pack(anchor="w", pady=(0, 4))
        frm, txt = scrolled_text(side, mono=True, readonly=True, height=8)
        frm.pack(fill="both", expand=True)
        panes.append((info, lbl, txt))
    nb.select(ui.get("tab", 0))
    nb.bind("<<NotebookTabChanged>>", lambda _e: ui.update(tab=nb.index("current")))
    (left, s_lbl, s_txt), (right, e_lbl, e_txt) = panes

    def shower(lbl, txt):
        def show(f: dict | None) -> None:
            lbl.configure(text=("→ " + f["name"]) if f else "")
            set_text(txt, f["body"] if f else "")
        return show

    s_show, e_show = shower(s_lbl, s_txt), shower(e_lbl, e_txt)
    parent.notebook, parent.prev = nb, (s_txt, e_txt)           # testy

    # ------------------------------------------------------------ SISTEMA
    _para(left, _("Výpočet PL v PLCdesk je zjednodušený (sloupcový graf ISO 13849-1, bez PFHd). "
                       "Tento export předá funkce, subsystémy, kanály a bloky do SISTEMA, kde se PL "
                       "a PFHd spočítá metodou IFA. Platí výsledek ze SISTEMA po kontrole odpovědnou "
                       "osobou."), pady=(4, 0))
    left.verified = _status(left, _("Stav ověření: {state}.", state=sx["verified"]))
    if not sx["fns"]:
        _para(left, _("Projekt nemá bezpečnostní funkce s PLr — není co exportovat."), pady=(6, 0))
        ttk.Button(left, text=_("Bezpečnost") + " ↗", command=lambda: app.goto(10)).pack(anchor="w", pady=(4, 0))
    else:
        ttk.Label(left, text=_n(sx["fns"], N_("{n} bezpečnostní funkce|{n} bezpečnostní funkce|"
                                              "{n} bezpečnostních funkcí")) + " · "
                  + (_("bezpečnostní funkce schváleny") if sx["approved"] else _("NESCHVÁLENO")),
                  style="Ok.TLabel" if sx["approved"] else "Err.TLabel").pack(anchor="w", pady=(6, 4))
        st = _files_table(left, sx["files"], unverified)
        st.pack(fill="x")
        b = ttk.Frame(left)
        b.pack(fill="x", pady=(4, 0))

        def s_cur() -> dict | None:
            i = st.selected()
            return sx["files"][int(i)] if i is not None else None

        ttk.Button(b, text=_("Uložit vybraný soubor…"),
                   command=lambda: s_cur() and save_file(app, s_cur()["save"], s_cur()["body"])).pack(side="left")
        ttk.Button(b, text=_("Uložit soubory pro SISTEMA…"), style="Accent.TButton",
                   command=lambda: save_many(app, [(f["save"], f["body"]) for f in sx["files"]],
                                             _("soubory pro SISTEMA"))).pack(side="left", padx=(6, 0))
        ttk.Button(left, text=_("Celý postup a předpis ({file})", file=sx["doc"]["name"]),
                   command=lambda: s_show(sx["doc"])).pack(anchor="w", pady=(4, 0))
        st.tv.bind("<<TreeviewSelect>>", lambda _e: s_show(s_cur()))
        ttk.Label(left, text=_("Postup v SISTEMA"), style="Section.TLabel").pack(anchor="w", pady=(10, 2))
        _steps(left, [
            _("Stáhni SISTEMA zdarma ze stránek IFA (bez registrace) a nainstaluj."),
            _("Soubor → Otevřít → `{file}`. Pokud SISTEMA nabídne převod na novější vydání normy, "
              "potvrď ho.", file=sx["ssm"]).replace("`", ""),
            _("U každého subsystému zkontroluj kategorii a potvrď požadavky kategorie a podmínky PL "
              "(záložky Kategorie a PL) — export je záměrně nevyplňuje."),
            _("U bloků ověř B10d / MTTFd a DC podle datasheetů konkrétních variant; u přístrojů s PL "
              "doplň PFHd z prohlášení výrobce (zástupné hodnoty jsou označené)."),
            _("Výsledné PL a PFHd zapiš do tabulky v kap. 4 a rozdíly vyřeš; protokol SISTEMA přilož "
              "k technické dokumentaci."),
        ])
        left.table = st
        s_show(sx["doc"])

    # ------------------------------------------------------------ EPLAN
    if not ep["files"]:
        _para(right, _("Projekt zatím nemá signály I/O — export do EPLAN vznikne z tabulky I/O."),
                   pady=(6, 0))
    else:
        _para(right, _("AutomationML (AR APC 1.4.0) se stanicí PLC, kartami a symbolickými "
                            "adresami, seznam zařízení z kusovníku, svorky a vodiče shodné s výkresy "
                            "a skript pro EPLAN, který import spustí jedním krokem."), pady=(4, 0))
        right.verified = _status(right, _("Stav ověření: {state}.", state=ep["verified"]))
        ttk.Label(right, text=_("kontrola exportu: {e} chyb, {w} upozornění", e=ep["errors"], w=ep["warnings"]),
                  style="Err.TLabel" if ep["errors"] else "Ok.TLabel").pack(anchor="w", pady=(6, 0))
        for line in ep["issues"]:
            ttk.Label(right, text=line, style="Dim.TLabel", wraplength=INFO_W).pack(anchor="w")
        et = _files_table(right, ep["files"], unverified)
        et.pack(fill="x", pady=(4, 0))
        b = ttk.Frame(right)
        b.pack(fill="x", pady=(4, 0))

        def e_cur() -> dict | None:
            i = et.selected()
            return ep["files"][int(i)] if i is not None else None

        readme = next((f for f in ep["files"] if f["name"] == "README_EPLAN.txt"), None)
        ttk.Button(b, text=_("Uložit vybraný soubor…"),
                   command=lambda: e_cur() and save_file(app, e_cur()["save"], e_cur()["body"])).pack(side="left")
        ttk.Button(b, text=_("Uložit soubory pro EPLAN…"), style="Accent.TButton",
                   command=lambda: save_many(app, [(f["save"], f["body"]) for f in ep["files"]],
                                             _("soubory pro EPLAN"))).pack(side="left", padx=(6, 0))
        if readme:
            ttk.Button(right, text=_("Zobrazit README_EPLAN.txt"), command=lambda: e_show(readme)
                       ).pack(anchor="w", pady=(4, 0))
        et.tv.bind("<<TreeviewSelect>>", lambda _e: e_show(e_cur()))
        ttk.Label(right, text=_("Postup v EPLAN"), style="Section.TLabel").pack(anchor="w", pady=(10, 2))
        _steps(right, [
            _("Otevři cílový projekt EPLAN (firemní šablona s kmenovými daty)."),
            _("Projektová data → PLC → Import PLC dat: soubor {file}, konvertor {conv}, porovnání "
              "objektů podle ID — nebo spusť skript {script} (Soubor → Extras → Skripty → Spustit).",
              file=ep["aml"], conv=ep["conv"], script=ep["script"]),
            _("Seznam zařízení načti importem zařízení (eplan_zarizeni.csv), svorky a vodiče jsou "
              "podklad pro svorkovnice a označení spojů."),
            _("První import zkontroluj a nálezy zapiš — podrobnosti a omezení jsou v README_EPLAN.txt."),
        ])
        right.table = et
        if readme:
            e_show(readme)
    parent.left, parent.right = left, right
    for f in (left, right):
        f.column.bind_all_wheel()                 # kolečko posouvá sloupec i nad texty a tabulkou
