"""Krok 11 — Bezpečnost: nebezpečí, bezpečnostní funkce, schvalování a bezpečnostní program.

Návrh dělá jádro (``safety.ts``: funkce, PLr z grafu rizik, architektura, výpočet PL,
bezpečná vzdálenost ISO 13855; ``safety_prog.ts``: program; ``safety_docs.ts``: výkres
okruhu). Pohled skládá ``apps/web/src/safety_view.js`` — stejný jako ve webu — a most ho
vrací operací ``safety``. Úpravy (``prj["safety"]``) jdou přes ``safety.edit``,
rozhodnutí přes ``approve`` / ``reject`` / ``resetApproval`` / ``approval.many``.
Pravidlo: navrhovat vše, platí jen schválené — nic se neschvaluje samo. Výpočet PL je
zjednodušený (ověřit v SISTEMA), program neověřený v cílovém IDE, validaci dělá člověk.
"""

from __future__ import annotations

import tkinter as tk
from tkinter import font as tkfont
from tkinter import messagebox, ttk

from .. import theme
from ..bridge import BridgeError
from ..i18n import _
from ..svgview import SvgView
from ..widgets import Table, card, note_box, save_file, save_many, scrolled_text, set_text, wrap_label
from .schvaleni import GREY, STATUS_COLOR, _file_name, approver, name_bar, when

TAB_FNS, TAB_HAZ, TAB_SET, TAB_PROG, TAB_SHEET = range(5)
PLS = ("a", "b", "c", "d", "e")
CATS = ("B", "1", "2", "3", "4")
DEFAULT_CCF = ("separation", "overload", "welltried", "emc", "environment")
PANEL_W = 500


# --- most ------------------------------------------------------------------------------

def safety_data(app, target: str | None = None) -> dict:
    """Pohled kroku (funkce, položky ke schválení, program, výkres); projekt z mostu převezme I/O."""
    data = app.fetch("safety", prj=app.prj, target=target)
    app.prj = data["prj"]
    return data["view"]


def safety_edit(app, fn: str, *args):
    """Úprava ``prj["safety"]`` funkcí sdíleného pohledu; vrací výsledek (odkaz nové funkce)."""
    r = app.bridge.request("safety.edit", prj=app.prj, fn=fn, args=list(args))
    app.prj = r["prj"]
    app.save()
    return r["result"]


def _rank(pl) -> int:
    return PLS.index(pl) if pl in PLS else -1


def _pl_color(pl, plr) -> str:
    if not plr:
        return GREY
    if not pl:
        return theme.ERR
    return theme.OK if _rank(pl) >= _rank(plr) else theme.ERR


def _num(v) -> str:
    return "" if v is None else (str(int(v)) if isinstance(v, float) and v.is_integer() else str(v))


def _redraw_later(app) -> None:
    """Překreslení až po dokončení obsluhy události (ne vnořeně při rušení widgetů)."""
    if not getattr(app, "_safety_redraw", None):
        def run() -> None:
            app._safety_redraw = None
            app.render()
        app._safety_redraw = app.root.after_idle(run)


def _scroll_frame(parent, on_scroll=None) -> tuple[ttk.Frame, ttk.Frame, tk.Canvas]:
    """Svisle posuvný rámec (detail funkce): vrací (obal, vnitřek, plátno).

    ``on_scroll(top)`` dostává horní okraj výřezu (0–1) — pozice přežije překreslení."""
    outer = ttk.Frame(parent)
    canvas = tk.Canvas(outer, bg=theme.BG, highlightthickness=0, borderwidth=0)
    ys = ttk.Scrollbar(outer, orient="vertical", command=canvas.yview)

    def moved(a, b) -> None:
        ys.set(a, b)
        if on_scroll:
            on_scroll(float(a))
    canvas.configure(yscrollcommand=moved)
    ys.pack(side="right", fill="y")
    canvas.pack(side="left", fill="both", expand=True)
    inner = ttk.Frame(canvas, padding=(0, 0, 10, 0))
    win = canvas.create_window(0, 0, window=inner, anchor="nw")
    inner.bind("<Configure>", lambda _e: canvas.configure(scrollregion=canvas.bbox("all")))
    canvas.bind("<Configure>", lambda e: canvas.itemconfigure(win, width=e.width))
    return outer, inner, canvas


def _wheel(canvas: tk.Canvas, root) -> None:
    """Kolečko myši nad kterýmkoli prvkem detailu posouvá detail."""
    def on(e):
        canvas.yview_scroll(-1 if e.delta > 0 else 1, "units")
        return "break"

    def bind(w):
        if not isinstance(w, (tk.Text, ttk.Combobox)):
            w.bind("<MouseWheel>", on, add="+")
        for c in w.winfo_children():
            bind(c)
    bind(root)


# --- schvalování -------------------------------------------------------------------------

def _decide(app, ui: dict, it: dict, action: str, note: str) -> None:
    name = approver(app)
    if action != "reset" and not name:
        app.set_status(_("Zadej jméno schvalující osoby."))
        return
    if action == "reject" and not note:
        app.set_status(_("Zamítnutí potřebuje důvod — napiš ho do poznámky."))
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


def _approval_box(app, parent, ui: dict, it: dict | None, var_note: tk.StringVar,
                  buttons: list) -> None:
    """Položka ke schválení: stav barevně, kdo a kdy, proč zatím ne, tlačítka."""
    if not it:
        return
    box = tk.Frame(parent, bg=theme.FIELD, highlightthickness=1, highlightbackground=theme.BORDER)
    box.pack(fill="x", pady=(0, 6))
    head = tk.Frame(box, bg=theme.FIELD)
    head.pack(fill="x", padx=8, pady=(6, 0))
    tk.Label(head, text=it["statusLabel"], bg=theme.FIELD, font=theme.FONT_ACCENT,
             fg=STATUS_COLOR.get(it["status"], GREY)).pack(side="left")
    if it["rec"]:
        tk.Label(head, text=when(it["rec"]), bg=theme.FIELD, fg=theme.DIM,
                 font=theme.FONT_DIM).pack(side="left", padx=(10, 0))
    tk.Label(box, text=it["title"], bg=theme.FIELD, fg=theme.PRIMARY, font=theme.FONT_UI,
             justify="left", anchor="w", wraplength=PANEL_W - 60).pack(fill="x", padx=8)
    if it["rec"] and it["rec"].get("note"):
        tk.Label(box, text=_("Poznámka: {note}", note=it["rec"]["note"]), bg=theme.FIELD,
                 fg=theme.DIM, font=theme.FONT_DIM, justify="left", anchor="w",
                 wraplength=PANEL_W - 60).pack(fill="x", padx=8)
    for b in it["blockers"]:
        tk.Label(box, text="⚠ " + b, bg=theme.FIELD, fg=theme.WARN, font=theme.FONT_DIM,
                 justify="left", anchor="w", wraplength=PANEL_W - 60).pack(fill="x", padx=8)
    row = tk.Frame(box, bg=theme.FIELD)
    row.pack(fill="x", padx=8, pady=(4, 8))
    b_ok = ttk.Button(row, text=_("Schválit"), style="Accent.TButton", width=-6,
                      command=lambda: _decide(app, ui, it, "approve", var_note.get().strip()))
    b_no = ttk.Button(row, text=_("Zamítnout"), width=-6,
                      command=lambda: _decide(app, ui, it, "reject", var_note.get().strip()))
    b_ok.pack(side="left", padx=(0, 6))
    b_no.pack(side="left", padx=(0, 6))
    if it["rec"]:
        ttk.Button(row, text=_("Zrušit rozhodnutí"), width=-6,
                   command=lambda: _decide(app, ui, it, "reset", "")).pack(side="left")
    b_ok._approve_key = it["key"]
    buttons.append((b_ok, b_no, it))


def _sync_buttons(app, buttons: list) -> None:
    name = bool(approver(app))
    for b_ok, b_no, it in buttons:
        b_ok.state(["!disabled"] if name and it["canApprove"] else ["disabled"])
        b_no.state(["!disabled"] if name and it["status"] != "rejected" else ["disabled"])


# --- krok --------------------------------------------------------------------------------

def render(app, parent) -> None:
    body = card(parent, "11", _("Bezpečnost"))
    if not app.prj["devices"]:
        wrap_label(body, _("Nejdřív navrhni zařízení (kroky 2–4)."))
        return
    ui = app.ui.setdefault("safety", {})
    v = safety_data(app, ui.get("target"))
    fns: list[dict] = v["fns"]
    by_ref = {f["ref"]: f for f in fns}
    if ui.get("sel") not in by_ref:
        ui["sel"] = fns[0]["ref"] if fns else None
    buttons: list = []                                 # (schválit, zamítnout, položka)
    var_note = tk.StringVar(value=ui.get("note", ""))
    body._var_note = var_note                          # držet proměnnou naživu (GC)
    var_note.trace_add("write", lambda *_a: ui.update(note=var_note.get()))

    wrap_label(body, _(
        "PLCdesk navrhuje bezpečnostní funkce z návrhu stroje: nebezpečí, požadovanou "
        "úroveň vlastností (PLr) z grafu rizik, architekturu, komponenty a výpočet dosaženého "
        "PL, bezpečnou vzdálenost a zkoušky pro validaci. Každou položku schvaluje odpovědná "
        "osoba; bezpečnostní program vzniká až po schválení funkcí. Platí jen schválené."))
    note_box(body, "\n".join("• " + t for t in (
        _("Výpočet PL je zjednodušený (sloupcový graf ISO 13849-1, typické hodnoty komponent) "
          "— ověř v SISTEMA nebo obdobném nástroji."),
        _("L5X GuardLogix a F-program Siemens nejsou ověřené importem a překladem v cílovém IDE."),
        _("Validaci bezpečnostních funkcí na stroji (ISO 13849-2) provádí a podepisuje člověk; "
          "aplikace ji jen plánuje (krok Oživení, fáze 10)."),
        _("Standardní program čte E-stop a blokování jen jako stavové signály (enable, "
          "kvitace) — bezpečnostní logika patří do bezpečnostního PLC / relé."))),
        warn=True, side="bottom")

    # --- lišta: jméno, souhrn, hromadné schválení ------------------------------------------
    bar = ttk.Frame(body)
    bar.pack(fill="x", pady=(8, 4))
    nm = ttk.Frame(bar)
    nm.pack(side="left")
    acts = ttk.Frame(bar)                          # tlačítka vpravo; v úzkém okně pod jméno
    acts.pack(side="right")
    c = v["counts"]
    b_all = ttk.Button(acts, text=_("Schválit vše připravené ({n})", n=c["ready"]), width=-6)
    ttk.Button(acts, text=_("Plán oživení (validace)") + " →", width=-6,
               command=lambda: app.goto(12)).pack(side="right")
    ttk.Button(acts, text=_("Krok Schválení") + " →", width=-6,
               command=lambda: app.goto(11)).pack(side="right", padx=(0, 6))
    b_all.pack(side="right", padx=(0, 6))

    def fit_bar(e) -> None:
        # německé popisky jsou dlouhé: nevejde-li se jméno + tlačítka do řádku, tlačítka
        # jdou na vlastní řádek (dřív se oříznul text „Alles Bereite freigeben“)
        stacked = e.width < nm.winfo_reqwidth() + acts.winfo_reqwidth() + 12
        if stacked != getattr(bar, "_stacked", False):
            bar._stacked = stacked
            acts.pack_forget()
            acts.pack(**({"side": "top", "anchor": "e", "pady": (6, 0)} if stacked else {"side": "right"}))
            nm.pack_configure(**({"side": "top", "anchor": "w"} if stacked else {"side": "left"}))

    bar.bind("<Configure>", fit_bar, add="+")

    def sync() -> None:
        _sync_buttons(app, buttons)
        b_all.state(["!disabled"] if approver(app) and c["ready"] else ["disabled"])

    name_bar(nm, app, _("Schvaluje:"), sync)
    ttk.Label(nm, text=_("Poznámka:"), style="Dim.TLabel").pack(side="left", padx=(12, 4))
    ent_note = ttk.Entry(nm, textvariable=var_note, width=28)
    ent_note._var = var_note
    ent_note.pack(side="left")

    def approve_all() -> None:
        keys, name = [i["key"] for i in v["items"] if i["canApprove"]], approver(app)
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

    b_all.configure(command=approve_all)

    sumrow = ttk.Frame(body)
    sumrow.pack(fill="x", pady=(2, 6))
    chips = [(_("funkcí {n}", n=c["fns"]), theme.FG),
             (_("PL < PLr: {n}", n=c["low"]), theme.ERR if c["low"] else GREY),
             (_("schváleno {n} z {m}", n=c["approved"], m=c["total"]), theme.OK)]
    if c["off"]:
        chips.insert(1, (_("vyřazeno {n}", n=c["off"]), GREY))
    for text, color in chips:
        tk.Label(sumrow, text=text, bg=theme.FIELD, fg=color, font=theme.FONT_ACCENT,
                 padx=8, pady=2).pack(side="left", padx=(0, 6))
    logic = tk.Label(sumrow, text=_("logika: {l}", l=v["logic"]["label"]), bg=theme.BG, fg=theme.DIM,
                     font=theme.FONT_DIM, justify="left", anchor="w")
    logic.pack(side="left", padx=(8, 0), fill="x", expand=True)
    # dlouhý název bezpečnostní logiky (es, úzké okno) se zalomí místo uříznutí
    logic.bind("<Configure>", lambda e: logic.configure(wraplength=max(150, e.width - 4)))

    nb = ttk.Notebook(body)
    nb.pack(fill="both", expand=True)
    tabs = {}
    for key, title in ((TAB_FNS, _("Funkce ({n})", n=len(fns))),
                       (TAB_HAZ, _("Nebezpečí ({n})", n=len(v["hazards"]))),
                       (TAB_SET, _("Nastavení")),
                       (TAB_PROG, _("Bezpečnostní program")),
                       (TAB_SHEET, _("Výkres okruhu"))):
        tabs[key] = ttk.Frame(nb, padding=(0, 6, 0, 0))
        nb.add(tabs[key], text=title)

    _render_functions(app, tabs[TAB_FNS], v, ui, var_note, buttons)
    _render_hazards(app, tabs[TAB_HAZ], v, ui, var_note, buttons)
    _render_settings(app, tabs[TAB_SET], v)
    _render_program(app, tabs[TAB_PROG], v, ui, var_note, buttons)
    _render_sheet(app, tabs[TAB_SHEET], v)

    nb.select(min(ui.get("tab", 0), TAB_SHEET))
    nb.bind("<<NotebookTabChanged>>", lambda _e: ui.update(tab=nb.index("current")))
    sync()


# --- funkce --------------------------------------------------------------------------------

def _render_functions(app, parent, v: dict, ui: dict, var_note, buttons: list) -> None:
    fns: list[dict] = v["fns"]
    by_ref = {f["ref"]: f for f in fns}
    main = ttk.Frame(parent)
    main.pack(fill="both", expand=True)
    main.columnconfigure(0, weight=1)
    main.rowconfigure(0, weight=1)
    left = ttk.Frame(main)
    left.grid(row=0, column=0, sticky="nsew")
    tbl = Table(left, [("plr", "PLr", 50, False), ("pl", _("PL dosažené"), 70, False),
                       ("fn", _("Funkce (PLr)"), 110, False), ("design", _("Návrh"), 110, False),
                       ("who", _("Kdo a kdy"), 130, True)], height=10, tree=True, ellipsis=True)
    tbl.tv.heading("#0", text=_("Funkce"), anchor="w")
    tbl.tv.column("#0", width=280, stretch=True)
    tbl.pack(fill="both", expand=True)
    tbl.tv.tag_configure("low", foreground=theme.ERR)
    tbl.tv.tag_configure("ok", foreground=theme.FG)
    for f in fns:
        recs = [i["rec"] for i in (f["fnItem"], f["designItem"]) if i and i["rec"]]
        plr = f["risk"]["plr"]
        pl = f["design"]["pl"] if f["design"] else None
        tags = ("dim",) if f["off"] else ("low",) if plr and f["design"] and not f["plOk"] else ("ok",)
        tbl.add(f["ref"], ("—" if f["off"] else plr or "—",
                           "—" if f["off"] or not f["design"] or not plr else pl or "?",
                           f["fnItem"]["statusLabel"] if f["fnItem"] else "—",
                           f["designItem"]["statusLabel"] if f["designItem"] else "—",
                           when(recs[-1]) if recs else ""),
                text=f"{f['id']} — {f['title']}" + (" (" + _("vyřazeno") + ")" if f["off"] else ""),
                tags=tags)
    if not fns:
        wrap_label(left, _("Projekt nemá pohony ani akční členy, které by vyžadovaly "
                           "bezpečnostní funkce."))
    if v["warnings"]:
        note_box(left, "\n".join("⚠ " + w for w in v["warnings"]), warn=True)

    # přidání vlastní funkce
    add = ttk.Frame(left)
    add.pack(fill="x", pady=(8, 0))
    ttk.Label(add, text=_("Přidat vlastní bezpečnostní funkci"), style="Section.TLabel"
              ).grid(row=0, column=0, columnspan=4, sticky="w")
    kinds = v["options"]["kinds"]
    labels = [k["label"] for k in kinds]
    var_kind = tk.StringVar(value=next((k["label"] for k in kinds if k["id"] == ui.get("add_kind")),
                                       labels[1] if len(labels) > 1 else labels[0]))
    var_title, var_inputs = tk.StringVar(), tk.StringVar()
    add._vars = (var_kind, var_title, var_inputs)
    # druh funkce na vlastním řádku přes celou šířku — německé názvy druhů jsou dlouhé a pole
    # pro název by vedle nich nezbylo; šířka z nejdelšího přeloženého popisku v pixelech
    ttk.Label(add, text=_("Druh funkce"), style="Dim.TLabel").grid(row=1, column=0, columnspan=3, sticky="w")
    ui_font = tkfont.Font(font=theme.FONT_UI)
    cb = ttk.Combobox(add, textvariable=var_kind, values=labels, state="readonly",
                      width=min(max(ui_font.measure(x) for x in labels) // ui_font.measure("0") + 4, 64))
    cb.grid(row=2, column=0, columnspan=3, sticky="ew")
    ttk.Label(add, text=_("Název"), style="Dim.TLabel").grid(row=3, column=0, sticky="w", pady=(4, 0))
    ttk.Label(add, text=_("Vstupy (označení)"), style="Dim.TLabel").grid(row=3, column=1, sticky="w",
                                                                      padx=(6, 0), pady=(4, 0))
    ttk.Entry(add, textvariable=var_title, width=22).grid(row=4, column=0, sticky="ew")
    ttk.Entry(add, textvariable=var_inputs, width=18).grid(row=4, column=1, sticky="ew", padx=(6, 0))
    add.columnconfigure(0, weight=1)

    def do_add() -> None:
        kind = kinds[labels.index(var_kind.get())]["id"]
        ui["add_kind"] = kind
        try:
            ref = safety_edit(app, "addSafetyFn", {"kind": kind, "title": var_title.get(),
                                                   "inputs": var_inputs.get()})
        except BridgeError as exc:
            app.set_status("⚠ " + str(exc))
            return
        ui["sel"] = ref
        ui["tab"] = TAB_FNS
        app.render()
        app.set_status(_("Přidána funkce: {kind}", kind=var_kind.get()))

    ttk.Button(add, text=_("Přidat funkci"), width=-6, command=do_add
               ).grid(row=4, column=2, sticky="w", padx=(6, 0))

    # detail vybrané funkce
    side = ttk.Frame(main, width=PANEL_W)
    side.grid(row=0, column=1, sticky="nsew", padx=(12, 0))
    side.grid_propagate(False)
    side.pack_propagate(False)
    outer, inner, canvas = _scroll_frame(side, lambda top: ui.update(detail_y=top))
    outer.pack(fill="both", expand=True)

    def show() -> None:
        for w in inner.winfo_children():
            w.destroy()
        buttons[:] = [b for b in buttons if b[0].winfo_exists()]
        f = by_ref.get(ui.get("sel") or "")
        if f is None:
            ttk.Label(inner, text=_("Vyber funkci v seznamu."), style="Dim.TLabel").pack(anchor="w")
            return
        _detail(app, inner, v, f, ui, var_note, buttons)
        _sync_buttons(app, buttons)
        _wheel(canvas, inner)
        y = ui.get("detail_y", 0.0) if ui.get("detail_ref") == f["ref"] else 0.0
        ui["detail_ref"] = f["ref"]
        canvas.after_idle(lambda: canvas.winfo_exists() and canvas.yview_moveto(y))

    def on_select(_e=None) -> None:
        iid = tbl.selected()
        if iid and iid in by_ref and iid != ui.get("sel"):
            ui["sel"] = iid
            ui["detail_y"] = 0.0
            show()

    tbl.tv.bind("<<TreeviewSelect>>", on_select)
    if ui.get("sel") in by_ref:
        tbl.select(ui["sel"])
    show()


def _detail(app, parent, v: dict, f: dict, ui: dict, var_note, buttons: list) -> None:
    """Detail funkce: schválení, riziko, reakce, architektura, vzdálenost, zkoušky."""
    cfg = f["cfg"]
    ref = f["ref"]
    L = v["options"]["fields"]
    W = PANEL_W - 40
    keep: list = []                                   # Tk proměnné detailu (GC)
    parent._keep = keep

    def label(text, style="Dim.TLabel", **pack):
        lbl = ttk.Label(parent, text=text, style=style, wraplength=W, justify="left")
        lbl.pack(anchor="w", **pack)
        return lbl

    def section(text):
        ttk.Label(parent, text=text, style="Section.TLabel").pack(anchor="w", pady=(12, 2))

    def commit(patch: dict) -> None:
        try:
            safety_edit(app, "setFnCfg", ref, patch)
        except BridgeError as exc:
            app.set_status("⚠ " + str(exc))
            return
        _redraw_later(app)

    def entry(grid, row, col, key, text, value, hint="", colspan=1):
        """Pole s popiskem nad sebou v mřížce; zápis po Enter / opuštění pole."""
        box = ttk.Frame(grid)
        box.grid(row=row, column=col, columnspan=colspan, sticky="ew", padx=(0, 8), pady=(0, 4))
        wrap = W * colspan // 2 - 12
        ttk.Label(box, text=text, style="Dim.TLabel", wraplength=wrap, justify="left"
                  ).pack(anchor="w")
        var = tk.StringVar(value=_num(value))
        keep.append(var)
        ent = ttk.Entry(box, textvariable=var)
        ent.pack(fill="x")
        ent._key = key
        if hint:
            ttk.Label(box, text=hint, style="Dim.TLabel", wraplength=wrap, justify="left"
                      ).pack(anchor="w")
        start = var.get()

        def done(_e=None):
            if var.get().strip() != start.strip():
                commit({key: var.get()})
        ent.bind("<Return>", done)
        ent.bind("<FocusOut>", done)
        return ent

    def combo(grid, row, col, key, text, pairs, current, auto=None, colspan=1, hint=""):
        box = ttk.Frame(grid)
        box.grid(row=row, column=col, columnspan=colspan, sticky="ew", padx=(0, 8), pady=(0, 4))
        ttk.Label(box, text=text, style="Dim.TLabel", wraplength=W - 12, justify="left"
                  ).pack(anchor="w")
        items = ([("", auto)] if auto is not None else []) + [(str(k), lbl) for k, lbl in pairs]
        labels = [lbl for _k, lbl in items]
        cur = "" if current is None else str(current)
        var = tk.StringVar(value=next((lbl for k, lbl in items if k == cur), labels[0]))
        keep.append(var)
        cb = ttk.Combobox(box, textvariable=var, values=labels, state="readonly",
                          width=min(max(len(x) for x in labels) + 1, 30))
        cb.pack(fill="x")
        cb._key = key
        if hint:
            ttk.Label(box, text=hint, style="Dim.TLabel", wraplength=W - 12, justify="left"
                      ).pack(anchor="w")

        def chosen(_e=None):
            k = items[labels.index(var.get())][0]
            if k != cur:
                commit({key: k})
        cb.bind("<<ComboboxSelected>>", chosen)
        return cb

    def grid2():
        g = ttk.Frame(parent)
        g.pack(fill="x")
        g.columnconfigure(0, weight=1, uniform="c")
        g.columnconfigure(1, weight=1, uniform="c")
        return g

    # --- hlavička -------------------------------------------------------------------------
    ttk.Label(parent, text=f"{f['id']} — {f['title']}", style="Section.TLabel", wraplength=W,
              justify="left").pack(anchor="w")
    label(f"{f['catalogName']} · {ref}" + (" · " + _("vlastní funkce") if f["user"] else ""))
    label(_("Spouští: {t}", t=f["trigger"]), style="TLabel", pady=(4, 0))
    label(_("Reakce: {t}", t=f["reaction"]), style="TLabel")
    label(_("Bezpečný stav: {t}", t=f["safeState"]), style="TLabel")
    if f["hazards"]:
        label(_("Nebezpečí: {list}", list="; ".join(f["hazards"])))

    section(_("Schválení funkce a návrhu"))
    _approval_box(app, parent, ui, f["fnItem"], var_note, buttons)
    _approval_box(app, parent, ui, f["designItem"], var_note, buttons)

    # --- riziko -----------------------------------------------------------------------------
    section(_("Riziko a požadovaná úroveň (PLr)"))
    risk = f["risk"]
    R = v["options"]["risk"]
    g = grid2()
    combo(g, 0, 0, "S", _("Závažnost zranění (S)"), R["S"], cfg.get("S") or risk["S"], colspan=2,
          hint=risk["why"]["S"])
    combo(g, 1, 0, "F", _("Četnost a doba vystavení (F)"), R["F"], cfg.get("F") or risk["F"],
          colspan=2, hint=risk["why"]["F"])
    combo(g, 2, 0, "P", _("Možnost vyhnutí se (P)"), R["P"], cfg.get("P") or risk["P"], colspan=2,
          hint=risk["why"]["P"])
    res = tk.Frame(parent, bg=theme.FIELD)
    res.pack(fill="x", pady=(2, 4))
    parts = [_("graf rizik: PLr {pl}", pl=risk["graph"])]
    if risk.get("min"):
        parts.append(_("normová spodní mez: PL {pl}", pl=risk["min"]["pl"]))
    tk.Label(res, text="  ·  ".join(parts), bg=theme.FIELD, fg=theme.DIM, font=theme.FONT_DIM
             ).pack(side="left", padx=8, pady=4)
    plr_lbl = tk.Label(res, text=_("PLr {pl}", pl=risk["plr"] or "—"), bg=theme.FIELD,
                       fg=theme.PRIMARY, font=theme.FONT_ACCENT)
    plr_lbl.pack(side="right", padx=8)
    plr_lbl._plr = risk["plr"]
    if risk.get("min"):
        label(risk["min"]["why"])
    g = grid2()
    entry(g, 0, 0, "reduce", _("Snížení PLr o 1 úroveň — zdůvodnění"), cfg.get("reduce", ""),
          _("prázdné = bez snížení"))
    combo(g, 0, 1, "plr", _("PLr z normy typu C"), [(x, "PL " + x) for x in PLS], cfg.get("plr"),
          auto=_("— podle grafu rizik —"))
    entry(g, 1, 0, "plrSource", _("Zdroj PLr (norma, článek)"), cfg.get("plrSource", ""))
    entry(g, 1, 1, "note", _("Poznámka / zdůvodnění vyřazení"), cfg.get("note", ""))
    var_off = tk.BooleanVar(value=bool(f["off"]))
    keep.append(var_off)
    ttk.Checkbutton(parent, text=_("Vyřadit funkci z návrhu"), variable=var_off,
                    command=lambda: commit({"off": var_off.get()})).pack(anchor="w", pady=(2, 0))
    if f["off"]:
        _detail_buttons(app, parent, f, ui)
        return

    # --- reakce a vstupy ---------------------------------------------------------------------
    section(_("Reakce a vstupy"))
    g = grid2()
    combo(g, 0, 0, "stopCat", _("Kategorie zastavení (IEC 60204-1)"), v["options"]["stop"],
          cfg.get("stopCat", f["stopCat"]), colspan=2, hint=f["stopWhy"])
    entry(g, 1, 0, "demandS", L["demandS"], cfg.get("demandS"), _("návrh: {n} s", n=f["demandS"]))
    if f["stopCat"] == 1:
        entry(g, 1, 1, "ss1DelayMs", L["ss1DelayMs"], cfg.get("ss1DelayMs"), "1000")
    entry(g, 2, 0, "inputs", _("Vstupní zařízení (označení, oddělit čárkou)"),
          ", ".join(f["inputs"]),
          _("Dostupné: {list}", list=", ".join(d["name"] for d in v["options"]["devs"]) or "—"),
          colspan=2)
    if v["groups"]:
        acts = ttk.Frame(parent)
        acts.pack(fill="x", pady=(2, 0))
        ttk.Label(acts, text=_("Výstupy (skupiny)"), style="Dim.TLabel").pack(anchor="w")
        avars = {}
        for grp in v["groups"]:
            var = tk.BooleanVar(value=grp["id"] in f["acts"])
            keep.append(var)
            avars[grp["id"]] = var
            ttk.Checkbutton(acts, text=f"{grp['id']} — {grp['label']}", variable=var,
                            style="Wrap.TCheckbutton",
                            command=lambda: commit({"acts": [k for k, x in avars.items() if x.get()]})
                            ).pack(anchor="w")
    for m in f["missing"]:
        label("⚠ " + _("Chybí: {what}", what=m), style="TLabel").configure(foreground=theme.WARN)

    d = f["design"]
    if d:
        # --- architektura -------------------------------------------------------------------
        section(_("Architektura, komponenty a výpočet PL"))
        g = grid2()
        combo(g, 0, 0, "cat", _("Kategorie"), [(x, _("kategorie {cat}", cat=x)) for x in CATS],
              cfg.get("cat"), auto=_("návrh: kategorie {cat}", cat=d["cat"] or "—"))
        sub_in = next((s for s in d["subs"] if s["role"] == "I"), None)
        sub_out = next((s for s in d["subs"] if s["role"] == "O"), None)
        entry(g, 1, 0, "dcIn", L["dcIn"], cfg.get("dcIn"),
              _("návrh: {n} %", n=sub_in["dc"]) if sub_in else "")
        entry(g, 1, 1, "dcOut", L["dcOut"], cfg.get("dcOut"),
              _("návrh: {n} %", n=sub_out["dc"]) if sub_out else "")
        row = 2
        if f["inOpts"]:
            lbl = next((o["label"] for o in f["inOpts"] if o["id"] == f["compInId"]), f["compInId"] or "—")
            combo(g, row, 0, "compIn", _("Komponenta vstupu"),
                  [(o["id"], o["label"]) for o in f["inOpts"]], cfg.get("compIn"),
                  auto=_("návrh: {c}", c=lbl), colspan=2)
            row += 1
        if f["outOpts"]:
            lbl = next((o["label"] for o in f["outOpts"] if o["id"] == f["compOutId"]), f["compOutId"] or "—")
            combo(g, row, 0, "compOut", _("Komponenta výstupu"),
                  [(o["id"], o["label"]) for o in f["outOpts"]], cfg.get("compOut"),
                  auto=_("návrh: {c}", c=lbl), colspan=2)
            row += 1
        entry(g, row, 0, "b10dIn", L["b10dIn"], cfg.get("b10dIn"))
        entry(g, row, 1, "mttfdIn", L["mttfdIn"], cfg.get("mttfdIn"))
        entry(g, row + 1, 0, "b10dOut", L["b10dOut"], cfg.get("b10dOut"))
        entry(g, row + 1, 1, "mttfdOut", L["mttfdOut"], cfg.get("mttfdOut"))
        label(_("B10d / MTTFd z datasheetu přebíjí typické hodnoty; prázdné = návrh aplikace."))

        ccf = list(cfg["ccf"]) if isinstance(cfg.get("ccf"), list) else list(DEFAULT_CCF)
        ccf_lbl = ttk.Label(parent, text=_("Opatření proti CCF: {p} bodů (min. {min})",
                                           p=d["ccf"]["points"], min=v["options"]["ccfMin"]),
                            style="Ok.TLabel" if d["ccf"]["ok"] else "Err.TLabel")
        ccf_lbl.pack(anchor="w", pady=(6, 0))
        cvars = {}
        for m in v["options"]["ccf"]:
            var = tk.BooleanVar(value=m["id"] in ccf)
            keep.append(var)
            cvars[m["id"]] = var
            ttk.Checkbutton(parent, text=f"{m['label']} ({m['points']})", variable=var,
                            style="Wrap.TCheckbutton",
                            command=lambda: commit({"ccf": [k for k, x in cvars.items() if x.get()]})
                            ).pack(anchor="w")

        # subsystémy a výsledek
        box = tk.Frame(parent, bg=theme.FIELD, highlightthickness=1, highlightbackground=theme.BORDER)
        box.pack(fill="x", pady=(8, 4))
        for s in d["subs"]:
            line = tk.Frame(box, bg=theme.FIELD)
            line.pack(fill="x", padx=8, pady=(4, 0))
            tk.Label(line, text=("PL " + s["pl"]) if s["pl"] else _("PL neurčeno"), bg=theme.FIELD,
                     fg=_pl_color(s["pl"], risk["plr"]), font=theme.FONT_ACCENT, width=12,
                     anchor="w").pack(side="left")
            comp = s.get("comp") or {}
            what = " ".join(x for x in (comp.get("brand"), comp.get("series")) if x) or comp.get("label") or "—"
            facts = [f"{s['role']} {s['label']}", what]
            nums = []
            if s.get("cat"):
                nums.append(_("kat. {cat}", cat=s["cat"]))
            if s.get("mttfd") is not None:
                nums.append(f"MTTFd {s['mttfd']}")
            nums.append(f"DC {s['dc']} %")
            if s.get("nop") is not None:
                nums.append(f"nop {s['nop']}")
            tk.Label(line, text="\n".join(facts + [" · ".join(nums)] + s["notes"]), bg=theme.FIELD,
                     fg=theme.FG, font=theme.FONT_DIM, justify="left", anchor="w",
                     wraplength=W - 120).pack(side="left", fill="x")
        res = tk.Frame(box, bg=theme.FIELD)
        res.pack(fill="x", padx=8, pady=(6, 6))
        pl_lbl = tk.Label(res, text=(_("Dosažené PL {pl}", pl=d["pl"]) if d["pl"] else _("PL neurčeno")),
                          bg=theme.FIELD, fg=_pl_color(d["pl"], risk["plr"]), font=theme.FONT_ACCENT)
        pl_lbl.pack(side="left")
        pl_lbl._pl = d["pl"]
        tk.Label(res, text=_("(kategorie {cat}, {ch} kanál(y), EDM {edm})", cat=d["cat"] or "—",
                             ch=d["channels"], edm=_("ano") if d["edm"] else _("ne")),
                 bg=theme.FIELD, fg=theme.DIM, font=theme.FONT_DIM).pack(side="left", padx=(8, 0))
        if risk["plr"] and not f["plOk"]:
            lim = "; ".join(f["limiting"]) or "—"
            label(_("Dosažené PL {pl} < PLr {plr} — omezuje: {subs}", pl=d["pl"], plr=risk["plr"], subs=lim)
                  if d["pl"] else _("Dosažené PL nelze určit — omezuje: {subs}", subs=lim),
                  style="Err.TLabel")
        for prob in d["problems"]:
            label("⚠ " + prob, style="TLabel").configure(foreground=theme.WARN)
        if d["wiring"]:
            label(_("Zapojení a signály ({n})", n=len(d["signals"])), style="TLabel", pady=(6, 0))
            for w in d["wiring"]:
                label("• " + w)

    # --- bezpečná vzdálenost ---------------------------------------------------------------
    if f["distFields"]:
        section(_("Bezpečná vzdálenost (ISO 13855:{ed})", ed=v["params"]["edition"]))
        g = grid2()
        for i, k in enumerate(f["distFields"]):
            entry(g, i // 2, i % 2, k, L[k], cfg.get(k))
        ds = f["distance"]
        if ds:
            txt = (_("S = {s} mm", s=ds["S"]) if ds["S"] is not None else _("S = —")) \
                + "   (" + _("vzorec: {f}", f=ds["formula"]) + ")"
            dist_lbl = ttk.Label(parent, text=txt, style="Ok.TLabel" if ds["S"] is not None else "Err.TLabel")
            dist_lbl.pack(anchor="w", pady=(2, 0))
            dist_lbl._S = ds["S"]
            for s in ds["steps"]:
                label("• " + s)
            if ds["missing"]:
                label(_("Chybí: {what}", what=", ".join(ds["missing"])), style="Err.TLabel")
            for w in ds["warnings"]:
                label("⚠ " + w)
        elif f["kind"] == "guard":
            label(_("U krytu se vzdálenost počítá, jen když zadáš dosah skrz kryt D_GT."))
        label(_("Bezpečná vzdálenost se počítá jen ze ZMĚŘENÉ doby doběhu stroje (měřič doběhu, "
                "nejhorší případ)."))

    if f["tests"]:
        section(_("Zkoušky pro validaci ({n})", n=len(f["tests"])))
        for t in f["tests"]:
            label("• " + t["name"] + " — " + t["expected"])
    _detail_buttons(app, parent, f, ui)


def _detail_buttons(app, parent, f: dict, ui: dict) -> None:
    row = ttk.Frame(parent)
    row.pack(fill="x", pady=(12, 8))

    def reset() -> None:
        safety_edit(app, "resetFnCfg", f["ref"])
        app.render()
        app.set_status(_("Úpravy funkce {sf} vráceny na návrh aplikace.", sf=f["id"]))

    def remove() -> None:
        if not messagebox.askyesno(_("Odebrat funkci?"),
                                   _("Odebrat vlastní funkci {sf}?", sf=f["id"]), parent=app.root):
            return
        safety_edit(app, "removeSafetyFn", f["ref"])
        ui["sel"] = None
        app.render()

    ttk.Button(row, text=_("Vrátit návrh aplikace"), width=-6, command=reset).pack(side="left")
    if f["user"]:
        ttk.Button(row, text=_("Odebrat funkci"), style="Danger.TButton", width=-6,
                   command=remove).pack(side="left", padx=(6, 0))
    it = f.get("fnItem") or f.get("designItem")
    if it:
        ttk.Button(row, text=_("Ve Schválení →"), width=-6,
                   command=lambda: open_approval(app, it["key"], "safety")).pack(side="right")


# --- nebezpečí -------------------------------------------------------------------------------

def _render_hazards(app, parent, v: dict, ui: dict, var_note, buttons: list) -> None:
    wrap_label(parent, _("Nebezpečí odvozená z návrhu stroje a bezpečnostní funkce, které je "
                         "řeší. Identifikaci nebezpečí a volbu opatření (ISO 12100) potvrzuje "
                         "odpovědná osoba — aplikace nerozhoduje, že je riziko přijatelné."))
    tbl = Table(parent, [("text", _("Nebezpečí"), 360, True), ("devs", _("Zařízení"), 160, False),
                         ("fns", _("Funkce"), 140, False)], height=8, ellipsis=True)
    tbl.pack(fill="both", expand=True, pady=(6, 6))
    tbl.tv.tag_configure("nofn", foreground=theme.ERR)
    for i, h in enumerate(v["hazards"]):
        tbl.add(f"h{i}", (h["text"], ", ".join(h["devs"]) or "—",
                          ", ".join(h["fns"]) or _("bez funkce")),
                tags=() if h["fns"] else ("nofn",))
    hz = v["byKey"].get("safety:hazards")
    holder = ttk.Frame(parent, width=PANEL_W)
    holder.pack(anchor="w", fill="x")
    _approval_box(app, holder, ui, hz, var_note, buttons)


# --- nastavení ---------------------------------------------------------------------------

def _render_settings(app, parent, v: dict) -> None:
    keep: list = []
    parent._keep = keep
    cf, par, L = v["cfg"], v["params"], v["options"]["fields"]
    frm = ttk.Frame(parent)
    frm.pack(fill="x", anchor="w")
    for c in range(3):
        frm.columnconfigure(c, weight=1, uniform="s")

    def set_param(key, value) -> None:
        try:
            safety_edit(app, "setSafetyParam", key, value)
        except BridgeError as exc:
            app.set_status("⚠ " + str(exc))
            return
        _redraw_later(app)

    for i, key in enumerate(("dop", "hop", "missionYears")):
        box = ttk.Frame(frm)
        box.grid(row=0, column=i, sticky="ew", padx=(0, 12), pady=(0, 8))
        ttk.Label(box, text=L[key], style="Dim.TLabel").pack(anchor="w")
        var = tk.StringVar(value=_num(cf.get(key)))
        keep.append(var)
        ent = ttk.Entry(box, textvariable=var)
        ent.pack(fill="x")
        ent._key = key
        ttk.Label(box, text=_("návrh: {n}", n=_num(par[key])), style="Dim.TLabel").pack(anchor="w")
        start = var.get()
        ent.bind("<Return>", lambda _e, k=key, x=var, s=start: x.get().strip() != s and set_param(k, x.get()))
        ent.bind("<FocusOut>", lambda _e, k=key, x=var, s=start: x.get().strip() != s and set_param(k, x.get()))

    def combo(row, col, key, text, pairs, current, colspan=1):
        box = ttk.Frame(frm)
        box.grid(row=row, column=col, columnspan=colspan, sticky="ew", padx=(0, 12), pady=(0, 8))
        ttk.Label(box, text=text, style="Dim.TLabel").pack(anchor="w")
        labels = [lbl for _k, lbl in pairs]
        var = tk.StringVar(value=next((lbl for k, lbl in pairs if k == (current or "")), labels[0]))
        keep.append(var)
        cb = ttk.Combobox(box, textvariable=var, values=labels, state="readonly",
                          width=min(max(len(x) for x in labels) + 1, 70))
        cb.pack(fill="x")
        cb._key = key
        cb.bind("<<ComboboxSelected>>",
                lambda _e: pairs[labels.index(var.get())][0] != (current or "")
                and set_param(key, pairs[labels.index(var.get())][0]))

    combo(1, 0, "iso13855", _("Vydání ISO 13855"),
          [("", _("2010 (harmonizované, výchozí)")), ("2024", _("2024 (podle volných výkladů — ověřit)"))],
          cf.get("iso13855"))
    combo(2, 0, "logic", _("Bezpečnostní logika"),
          [("", _("návrh: {l}", l=v["logic"]["label"]))] + [(o["id"], o["label"]) for o in v["options"]["logic"]],
          cf.get("logic"), colspan=3)
    combo(3, 0, "target", _("Cíl bezpečnostního programu"),
          [("", _("podle logiky: {t}", t=v["targetLabel"]))] + [(o["id"], o["label"]) for o in v["options"]["targets"]],
          cf.get("target"), colspan=2)
    wrap_label(parent, _("Provozní dny a hodiny určují počet vyžádání za rok (nop) a z něj MTTFd "
                         "komponent z B10d. Změna parametrů změní návrh — schválené položky je pak "
                         "potřeba schválit znovu."), pady=(8, 0))


# --- program -----------------------------------------------------------------------------------

def _render_program(app, parent, v: dict, ui: dict, var_note, buttons: list) -> None:
    pr = v["program"]
    top = ttk.Frame(parent)
    top.pack(fill="x")
    ttk.Label(top, text=_("Cíl:")).pack(side="left")
    targets = v["options"]["targets"]
    labels = [t["label"] + (" ✓" if t["id"] == v["target"] else "") for t in targets]
    ids = [t["id"] for t in targets]
    var_t = tk.StringVar(value=labels[ids.index(pr["target"])] if pr["target"] in ids else labels[0])
    top._var = var_t
    cb = ttk.Combobox(top, textvariable=var_t, values=labels, state="readonly",
                      width=max(len(x) for x in labels) + 1)
    cb.pack(side="left", padx=(6, 12))

    def pick(_e=None) -> None:
        t = ids[labels.index(var_t.get())]
        ui["target"] = None if t == v["target"] else t
        ui.pop("file", None)
        app.render()

    cb.bind("<<ComboboxSelected>>", pick)
    state = pr["state"]
    text, color = {"approved": (_("SCHVÁLENO"), theme.OK),
                   "draft": (_("NESCHVÁLENO — návrh"), theme.ERR),
                   "pending": (_("čeká na schválení funkcí"), GREY)}[state]
    st_lbl = tk.Label(top, text=text, bg=theme.WARN_BG if state != "approved" else theme.OK_BG,
                      fg=color, font=theme.FONT_ACCENT, padx=10, pady=3)
    st_lbl.pack(side="left")
    st_lbl._state = state
    if state != "approved":
        note_box(parent, _("NESCHVÁLENO") + " — " + (
            _("bezpečnostní program se generuje až po schválení nebezpečí, funkcí a jejich návrhu.")
            if state == "pending" else
            _("návrh programu k revizi; před nahráním do bezpečnostní logiky ho musí přezkoumat "
              "a schválit odpovědná osoba, potom validace na stroji.")), warn=True)
    if pr["target"] != v["target"]:
        wrap_label(parent, _("Náhled pro jiný cíl, než je zvolený v návrhu ({t}) — schválení "
                             "programu platí jen pro zvolený cíl.", t=v["targetLabel"]), pady=(4, 0))
    if pr["item"]:
        holder = ttk.Frame(parent)
        holder.pack(fill="x", pady=(6, 0))
        _approval_box(app, holder, ui, pr["item"], var_note, buttons)
    files: dict = pr["files"]
    if not files:
        wrap_label(parent, _("Žádná funkce nemá blok v bezpečnostním programu."), pady=(8, 0))
        return
    names = list(files)
    if ui.get("file") not in names:
        ui["file"] = names[0]
    row = ttk.Frame(parent)
    row.pack(fill="x", pady=(8, 4))
    ttk.Label(row, text=_("Soubor:")).pack(side="left")
    var_f = tk.StringVar(value=ui["file"])
    row._var = var_f
    ttk.Combobox(row, textvariable=var_f, values=names, state="readonly",
                 width=max(len(n) for n in names) + 1).pack(side="left", padx=(6, 12))
    ttk.Button(row, text=_("Uložit soubor…"), width=-6,
               command=lambda: save_file(app, _file_name(app, "safety_" + var_f.get()), files[var_f.get()])
               ).pack(side="left")
    ttk.Button(row, text=_("Uložit vše do složky…"), width=-6,
               command=lambda: save_many(app, [("safety_" + n, b) for n, b in files.items()],
                                         _("bezpečnostní program"))).pack(side="left", padx=(6, 0))
    frm, txt = scrolled_text(parent, mono=True, readonly=True, height=14)
    frm.pack(fill="both", expand=True)

    def show(*_a) -> None:
        ui["file"] = var_f.get()
        set_text(txt, files.get(var_f.get(), ""))

    var_f.trace_add("write", show)
    show()


# --- výkres -------------------------------------------------------------------------------------

def _render_sheet(app, parent, v: dict) -> None:
    sh = v["sheet"]
    if not sh:
        wrap_label(parent, _("Výkres vznikne, až bude některá funkce potřebovat bezpečnostní logiku."))
        return
    row = ttk.Frame(parent)
    row.pack(side="bottom", fill="x", pady=(8, 0))
    ttk.Button(row, text=_("Uložit SVG…"),
               command=lambda: save_file(app, "00_bezpecnostni_okruh.svg", sh["svg"])).pack(side="left")
    ttk.Button(row, text=_("Uložit DXF…"),
               command=lambda: save_file(app, "00_bezpecnostni_okruh.dxf", sh["dxf"])
               ).pack(side="left", padx=(6, 0))
    wrap_label(row, _("Návrh k revizi — platí jen po schválení bezpečnostních funkcí; svorky "
                      "podle návodu zvolené logiky."), side="left", padx=10, expand=True)
    view = SvgView(parent)
    view.pack(fill="both", expand=True)
    view.show(sh["svg"])


def open_approval(app, key: str, group: str = "") -> None:
    """Krok Schválení s vybranou položkou."""
    ui = app.ui.setdefault("appr", {})
    ui.update(sel=key, tab=0, note="")
    ui.get("closed", {}).pop(group, None)            # skupina položky rozbalená
    app.goto(11)
