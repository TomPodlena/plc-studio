"""Krok 10 — Kusovník komponent: položky z návrhu, značky / typy / dodavatelé z katalogu.

Kusovník počítá jádro (``buildBom`` přes operaci mostu ``bom``); tady se jen zobrazuje
a ukládají volby uživatele do ``prj["bom"]`` (platforma, značka pro kategorii nebo řádek,
vlastní typ, kód, dodavatel, množství, poznámka). Navazuje na něj stavba v CADu (verze PRO).
"""

from __future__ import annotations

import re
import tkinter as tk
import webbrowser
from tkinter import ttk

from ..i18n import _
from ..project import finite, parse_num
from ..widgets import Table, card, note_box, save_file, wrap_label

CUSTOM = "custom"


def _cfg(app) -> dict:
    return app.prj.setdefault("bom", {})


def _line_cfg(app, lid: str) -> dict:
    return _cfg(app).setdefault("lines", {}).setdefault(lid, {})


def _line_cfg_peek(app, lid: str) -> dict:
    """Volby řádku bez zakládání prázdných záznamů."""
    return ((app.prj.get("bom") or {}).get("lines") or {}).get(lid) or {}


def _changed(app) -> None:
    bom = app.prj.get("bom") or {}
    lines = {k: v for k, v in (bom.get("lines") or {}).items() if v}
    if lines:
        bom["lines"] = lines
    else:
        bom.pop("lines", None)
    if not bom.get("brand"):
        bom.pop("brand", None)
    if not bom:
        app.prj.pop("bom", None)
    app.save()
    app.render()


def render(app, parent) -> None:
    body = card(parent, "10", _("Kusovník komponent"))
    if not app.prj["devices"]:
        wrap_label(body, _("Nejdřív navrhni zařízení (kroky 2–4)."))
        return
    data = app.bridge.request("bom", prj=app.prj)
    lines: list[dict] = data["lines"]
    options: dict = data["options"]
    ui = app.ui.setdefault("bom", {})

    wrap_label(body, _(
        "Z návrhu vznikne kusovník: PLC a I/O moduly zvolené platformy, ke každému zařízení "
        "jeho komponenty (motor → jistič motoru a stykač, válec → rozváděč a snímače polohy…) "
        "a rozvaděč. Značky, typy a dodavatele nabízí katalog PLCdesk (stav k {date}); "
        "u řádku nebo celé kategorie je můžeš změnit nebo zadat vlastní.", date=data["date"]))
    note_box(body, _(
        "Kusovník je podklad k poptávce, ne projekt elektro: dimenzování (výkony, jištění, "
        "průřezy) a volbu bezpečnostních prvků podle posouzení rizik (EN ISO 13849) ověří "
        "projektant — návrh k revizi. Ceny a dostupnost ověř u dodavatele."), warn=True,
        side="bottom")

    # --- lišta: platforma, export --------------------------------------------------
    bar = ttk.Frame(body)
    bar.pack(fill="x", pady=(8, 6))
    ttk.Label(bar, text=_("Platforma řízení:")).pack(side="left")
    plat_keys = list(app.PLAT)
    plat_names = [app.PLAT[k]["name"] for k in plat_keys]
    var_plat = tk.StringVar(value=app.PLAT[data["plat"]]["name"])
    cb_plat = ttk.Combobox(bar, textvariable=var_plat, values=plat_names, state="readonly",
                           width=max(len(n) for n in plat_names) + 2)
    cb_plat.pack(side="left", padx=(6, 14))
    cb_plat._var = var_plat                              # držet proměnnou naživu (GC)

    def on_plat(_e=None) -> None:
        _cfg(app)["plat"] = plat_keys[cb_plat.current()]
        _changed(app)

    cb_plat.bind("<<ComboboxSelected>>", on_plat)

    def tsv() -> str:
        cols = [_("Pozice"), _("Označení"), _("Položka"), _("Popis"), _("Množství"), _("Výrobce"),
                _("Typ"), _("Objednací kód"), _("Dodavatel"), _("Poznámka")]
        rows = [[str(ln["pos"]), ln["tag"], ln["item"], ln["desc"], str(ln["qty"]), ln["brand"],
                 ln["type"], ln["orderCode"], ln["supplier"], ln["note"]] for ln in lines]
        return "\n".join("\t".join(c.replace("\t", " ").replace("\n", " ") for c in r)
                         for r in [cols, *rows])

    name = re.sub(r'[<>:"/\\|?*]+', "_", app.prj["meta"]["name"] or "plc-projekt").strip() or "plc-projekt"
    ttk.Button(bar, text=_("Uložit CSV…"), style="Accent.TButton",
               command=lambda: save_file(app, name + "_kusovnik.csv", data["csv"])).pack(side="left")
    ttk.Button(bar, text=_("Kopírovat jako tabulku"), command=lambda: app.copy(tsv())
               ).pack(side="left", padx=(6, 0))

    def reset() -> None:
        bom = app.prj.get("bom") or {}
        app.prj["bom"] = {"plat": bom["plat"]} if bom.get("plat") else {}
        _changed(app)

    ttk.Button(bar, text=_("Obnovit výchozí volby"), command=reset).pack(side="left", padx=(6, 0))
    ttk.Label(bar, text=_("{n} položek · {c} s objednacím kódem", n=len(lines),
                          c=sum(1 for ln in lines if ln["orderCode"])),
              style="Dim.TLabel").pack(side="left", padx=(14, 0))

    # --- záložky: položky / dodavatelé ---------------------------------------------
    nb = ttk.Notebook(body)
    nb.pack(fill="both", expand=True)
    t_items = ttk.Frame(nb, padding=(0, 6, 0, 0))
    t_sup = ttk.Frame(nb, padding=(0, 6, 0, 0))
    nb.add(t_items, text=_("Položky ({n})", n=len(lines)))
    nb.add(t_sup, text=_("Dodavatelé ({n})", n=len(data["suppliers"])))
    nb.bind("<<NotebookTabChanged>>", lambda _e: ui.update(tab=nb.index("current")))

    # --- tabulka -----------------------------------------------------------------
    by_id = {ln["id"]: ln for ln in lines}
    edit_keys = {"qty": "qty", "type": "type", "code": "orderCode", "sup": "supplier", "note": "note"}

    def on_edit(iid: str, key: str, value: str) -> None:
        ln = by_id.get(iid)
        if ln is None or key not in edit_keys:
            return
        lc = _line_cfg(app, iid)
        if key == "qty":
            v = parse_num(value)
            if v is None or not finite(v) or v < 0 or v > 100000:
                app.set_status(_("Množství zadej jako číslo 0 až 100000."))
                return
            lc["qty"] = int(v) if float(v).is_integer() else v
        else:
            value = value.strip()
            if value:
                lc[edit_keys[key]] = value
            else:
                lc.pop(edit_keys[key], None)       # prázdné = zpět na hodnotu z katalogu
        _changed(app)

    cols = [("pos", "#", 36, False), ("tag", _("Označení"), 64, False),
            ("item", _("Položka"), 150, True), ("desc", _("Popis"), 160, True),
            ("qty", _("Ks"), 40, False), ("brand", _("Výrobce"), 110, True),
            ("type", _("Typ"), 220, True), ("code", _("Objednací kód"), 130, True),
            ("sup", _("Dodavatel"), 140, True)]
    titles = {k: t for k, t, *_ in cols}

    def cells(ln: dict) -> tuple:
        return (ln["pos"], ln["tag"], ln["item"] + (" ⚠" if ln.get("safety") else ""), ln["desc"],
                ln["qty"], ln["brand"], ln["type"], ln["orderCode"], ln["supplier"])

    # --- filtry a řazení (jen pohled; volby uživatele se nemění) ----------------------
    filters: dict = ui.setdefault("filters", {})        # klíč sloupce → hledaný text
    sort: list = ui.setdefault("sort", [])              # [klíč sloupce, sestupně]
    fbar = ttk.Frame(t_items)
    fbar.pack(fill="x", pady=(0, 6))
    ttk.Label(fbar, text=_("Filtr:")).pack(side="left")
    keys = [k for k, *_ in cols]
    var_fcol = tk.StringVar(value=titles[ui.get("fcol", "brand")])
    cb_fcol = ttk.Combobox(fbar, textvariable=var_fcol, values=[titles[k] for k in keys],
                           state="readonly", width=max(len(titles[k]) for k in keys) + 2)
    cb_fcol._var = var_fcol
    cb_fcol.pack(side="left", padx=(6, 4))
    var_ftext = tk.StringVar()
    ent_f = ttk.Entry(fbar, textvariable=var_ftext, width=22)
    ent_f._var = var_ftext
    ent_f.pack(side="left")
    chips = ttk.Frame(fbar)
    shown = ttk.Label(fbar, text="", style="Dim.TLabel")

    def add_filter(_e=None) -> None:
        k = keys[max(cb_fcol.current(), 0)]
        ui["fcol"] = k
        text = var_ftext.get().strip()
        if text:
            filters[k] = text
        else:
            filters.pop(k, None)
        var_ftext.set("")
        refill()

    def clear_filters() -> None:
        filters.clear()
        refill()

    ttk.Button(fbar, text=_("Přidat filtr"), command=add_filter).pack(side="left", padx=(4, 0))
    ent_f.bind("<Return>", add_filter)
    chips.pack(side="left", padx=(10, 0))
    shown.pack(side="right")

    def value(ln: dict, k: str):
        v = cells(ln)[keys.index(k)]
        return v if isinstance(v, (int, float)) else str(v)

    def visible() -> list[dict]:
        out = [ln for ln in lines
               if all(f.lower() in str(value(ln, k)).lower() for k, f in filters.items() if k in keys)]
        if sort and sort[0] in keys:
            k, desc = sort[0], bool(sort[1])
            num = k in ("pos", "qty")
            out.sort(key=lambda ln: (value(ln, k) if num else str(value(ln, k)).lower()), reverse=desc)
        return out

    def on_sort(k: str) -> None:
        if sort and sort[0] == k:
            if sort[1]:
                sort.clear()                               # třetí klik = původní pořadí
            else:
                sort[1] = True
        else:
            sort[:] = [k, False]
        refill()

    tbl = Table(t_items, cols, height=7, editable=tuple(k for k in edit_keys if k != "note"),
                on_edit=on_edit)
    tbl.pack(fill="both", expand=True)
    tbl.tv.tag_configure("safety", foreground="#B45309")
    for k in keys:
        tbl.tv.heading(k, command=lambda k=k: on_sort(k))

    def refill() -> None:
        for k in keys:                                     # šipka řazení v záhlaví
            mark = (" ▼" if sort[1] else " ▲") if sort and sort[0] == k else ""
            tbl.tv.heading(k, text=titles[k] + mark)
        for w in chips.winfo_children():
            w.destroy()
        for k, f in filters.items():
            if k in titles:
                ttk.Button(chips, text=f"{titles[k]}: {f}  ✕", style="Chip.TButton",
                           command=lambda k=k: (filters.pop(k, None), refill())).pack(side="left", padx=(0, 4))
        if filters:
            ttk.Button(chips, text=_("Zrušit filtry"), command=clear_filters).pack(side="left")
        rows = visible()
        sel = tbl.selected()
        tbl.clear()
        for ln in rows:
            tbl.add(ln["id"], cells(ln),
                    tags=("dim",) if ln.get("excluded") else ("safety",) if ln.get("safety") else ())
        shown.configure(text=_("zobrazeno {n} z {m}", n=len(rows), m=len(lines)) if filters else "")
        if sel and tbl.tv.exists(sel):
            tbl.select(sel)

    refill()
    wrap_label(t_items, _("Dvojklik na Ks, Typ, Objednací kód nebo Dodavatele = úprava řádku "
                       "(prázdná hodnota vrátí katalog). Výrobce a typ z katalogu a poznámku "
                       "změníš dole u vybraného řádku."), pady=(4, 0))

    # --- volba z katalogu u vybraného řádku -----------------------------------------
    ttk.Label(t_items, text=_("Vybraný řádek"), style="Section.TLabel").pack(anchor="w", pady=(10, 2))
    pick = ttk.Frame(t_items)
    pick.pack(fill="x")
    info = ttk.Label(pick, text=_("Vyber řádek v tabulce."), style="Dim.TLabel")
    info.grid(row=0, column=0, columnspan=4, sticky="w")
    ttk.Label(pick, text=_("Výrobce / typ:")).grid(row=1, column=0, sticky="w", pady=(6, 0))
    var_opt = tk.StringVar()
    cb_opt = ttk.Combobox(pick, textvariable=var_opt, state="readonly", width=70)
    cb_opt.grid(row=1, column=1, sticky="we", padx=(6, 6), pady=(6, 0))
    cb_opt._var = var_opt
    var_custom = tk.StringVar()
    ent_custom = ttk.Entry(pick, textvariable=var_custom, width=24)
    ent_custom._var = var_custom
    var_all = tk.BooleanVar(value=ui.get("all", True))
    chk_all = ttk.Checkbutton(pick, text=_("použít pro všechny řádky této kategorie"),
                              variable=var_all, command=lambda: ui.update(all=var_all.get()))
    chk_all._var = var_all
    chk_all.grid(row=2, column=1, sticky="w", padx=(6, 0), pady=(4, 0))
    ttk.Label(pick, text=_("Poznámka:")).grid(row=3, column=0, sticky="w", pady=(6, 0))
    var_note = tk.StringVar()
    ent_note = ttk.Entry(pick, textvariable=var_note)
    ent_note._var = var_note
    ent_note.grid(row=3, column=1, sticky="we", padx=(6, 6), pady=(6, 0))
    src_lbl = ttk.Label(pick, text="", style="Link.TLabel", cursor="hand2")
    src_lbl.grid(row=1, column=3, sticky="w")
    pick.columnconfigure(1, weight=1)
    state: dict = {"opts": [], "line": None}

    def fill(lid: str | None) -> None:
        ln = by_id.get(lid or "")
        state["line"] = ln
        ent_custom.grid_forget()
        src_lbl.configure(text="")
        if ln is None:
            cb_opt.configure(values=[])
            var_opt.set("")
            return
        opts = options.get(ln["key"], [])
        state["opts"] = opts
        labels = [o["brand"] + " — " + (o["typical"] or " / ".join(o["series"]))
                  + (f"  [{o['orderCode']}]" if o["orderCode"] else "") for o in opts]
        labels.append(_("vlastní výrobce / typ…"))
        cb_opt.configure(values=labels)
        info.configure(text=f"{ln['tag']} · {ln['item']} · {ln['desc']}")
        var_note.set(_line_cfg_peek(app, ln["id"]).get("note", ""))
        cur = next((i for i, o in enumerate(opts) if o["brand"] == ln["brand"]
                    and (o["typical"] == ln["type"] or not o["typical"])), None)
        if cur is None:
            var_opt.set(labels[-1])
            var_custom.set(ln["brand"])
            ent_custom.grid(row=1, column=2, sticky="w")
        else:
            var_opt.set(labels[cur])
            src = opts[cur]["src"]
            src_lbl.configure(text=_("zdroj ↗") if src else "")
            src_lbl.bind("<Button-1>", lambda _e, u=src: webbrowser.open(u) if u else None)

    def store_brand(value: str) -> None:
        ln = state["line"]
        if ln is None:
            return
        lc = _line_cfg(app, ln["id"])
        for k in ("type", "orderCode", "supplier"):      # nová volba = údaje z katalogu
            lc.pop(k, None)
        if var_all.get():
            lc.pop("brand", None)
            _cfg(app).setdefault("brand", {})[ln["key"]] = value
            for other in lines:                          # jednotlivé volby kategorie přebije
                if other["key"] == ln["key"]:
                    _line_cfg(app, other["id"]).pop("brand", None)
        else:
            lc["brand"] = value
        ui["sel"] = ln["id"]
        _changed(app)

    def on_opt(_e=None) -> None:
        i = cb_opt.current()
        if i < 0:
            return
        if i < len(state["opts"]):
            store_brand(state["opts"][i]["id"])
        else:
            ent_custom.grid(row=1, column=2, sticky="w")
            ent_custom.focus_set()

    def on_custom(_e=None) -> None:
        v = var_custom.get().strip()
        if v:
            store_brand(v)

    def on_note(_e=None) -> None:
        ln = state["line"]
        if ln is None:
            return
        v = var_note.get().strip()
        if v == _line_cfg_peek(app, ln["id"]).get("note", ""):
            return
        lc = _line_cfg(app, ln["id"])
        if v:
            lc["note"] = v
        else:
            lc.pop("note", None)
        ui["sel"] = ln["id"]
        _changed(app)

    ent_note.bind("<Return>", on_note)
    ent_note.bind("<FocusOut>", on_note)
    cb_opt.bind("<<ComboboxSelected>>", on_opt)
    ent_custom.bind("<Return>", on_custom)
    ent_custom.bind("<FocusOut>", on_custom)

    def on_select(_e=None) -> None:
        iid = tbl.selected()
        if iid:
            ui["sel"] = iid
        fill(iid)

    tbl.tv.bind("<<TreeviewSelect>>", on_select)

    # --- dodavatelé -----------------------------------------------------------------
    wrap_label(t_sup, _("Dodavatelé z katalogu pro kategorie tohoto kusovníku — výrobci "
                        "s pobočkou v ČR, distributoři a e-shopy. Dvojklik otevře web."))
    if data["suppliers"]:
        sup = ttk.Frame(t_sup)
        sup.pack(fill="both", expand=True, pady=(6, 0))
        st = Table(sup, [("name", _("Dodavatel"), 220, False), ("kind", _("Druh"), 110, False),
                         ("url", _("Web"), 260, True), ("note", _("Poznámka"), 260, True)],
                   height=12)
        st.pack(fill="both", expand=True)
        for i, s in enumerate(sorted(data["suppliers"], key=lambda s: s["name"].lower())):
            st.add(i, (s["name"], s.get("kind", ""), s.get("url", ""), s.get("note", "")))

        def open_url(_e=None) -> None:
            iid = st.selected()
            url = st.tv.set(iid, "url") if iid else ""
            if url.startswith("http"):
                webbrowser.open(url)

        st.tv.bind("<Double-1>", open_url)

    if ui.get("tab"):
        nb.select(ui["tab"])
    sel = ui.get("sel")
    if sel in by_id:
        tbl.select(sel)
        fill(sel)
