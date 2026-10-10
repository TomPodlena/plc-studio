"""Nabídka — záložka kroku Kusovník (interní podklad).

Kusovník oceněný podle ceníku uživatele a odhad hodin × sazby uživatele počítá jádro
(``quote.ts``); pohled skládá ``apps/web/src/biz_view.js`` (stejný jako ve webu), desktop ho
dostane přes operace mostu ``quote.*``. Ceny se nevymýšlí: bez ceníku, sazby nebo kurzu zůstane
pole prázdné a položka je v seznamu bez ceny.
"""

from __future__ import annotations

import tkinter as tk
from pathlib import Path
from tkinter import filedialog, ttk

from .. import theme
from ..bridge import BridgeError
from ..i18n import _
from ..project import parse_num
from ..widgets import Table, read_text_file, save_file, wrap_label

CURRENCIES = ["CZK", "EUR", "USD", "GBP", "CHF", "PLN", "HUF", "CNY"]
TONE = {"ok": theme.OK, "info": theme.ACCENT, "warn": theme.WARN, "err": theme.ERR}


def _num_text(v) -> str:
    if v is None:
        return ""
    return f"{v:g}"


def build_tab(app, nb: ttk.Notebook, ui: dict) -> ttk.Frame:
    """Přidá do notebooku kusovníku záložku „Nabídka“ a vrátí ji. Obsah se postaví, až když
    se záložka zobrazí (nabídka počítá kusovník, bezpečnost a ceny — zbytečně při každém kroku)."""
    tab = ttk.Frame(nb, padding=(0, 6, 0, 0))
    nb.add(tab, text=_("Nabídka"))

    def on_tab(_e=None) -> None:
        if not getattr(tab, "_built", False) and nb.select() == str(tab):
            tab._built = True
            _fill(app, tab)

    nb.bind("<<NotebookTabChanged>>", on_tab, add="+")
    tab._fill = on_tab
    return tab


def _fill(app, tab: ttk.Frame) -> None:
    qui = app.ui.setdefault("quote", {})
    try:
        data = app.bridge.request("quote.view", prj=app.prj)
    except BridgeError as exc:
        ttk.Label(tab, text="⚠ " + str(exc), style="Err.TLabel").pack(anchor="w")
        return
    app.prj = data["prj"]
    v = data["view"]
    t = v["totals"]

    def set_q(path: str, value) -> None:
        app.prj = app.bridge.request("quote.set", prj=app.prj, path=path, value=value)["prj"]
        app.save()
        app.render()

    # --- souhrn (vždy nahoře) ----------------------------------------------------------
    top = ttk.Frame(tab)
    top.pack(fill="x")
    for label, val, strong in ((_("Materiál (nákup)"), t["materialCost"], False), (t["marginLabel"], t["margin"], False),
                               (_("Práce ({h})", h=t["hours"]), t["labor"], False), (_("Celkem bez DPH"), t["net"], True),
                               (t["vatLabel"], t["vat"], False), (_("Celkem s DPH"), t["gross"], True)):
        box = tk.Frame(top, bg=theme.TREE_SEL if strong else theme.FIELD, padx=8, pady=3)
        box.pack(side="left", padx=(0, 6))
        tk.Label(box, text=label, bg=box["bg"], fg=theme.DIM, font=theme.FONT_DIM).pack(anchor="w")
        tk.Label(box, text=val, bg=box["bg"], fg=theme.ACCENT if strong else theme.FG,
                 font=("Consolas", 10, "bold")).pack(anchor="w")
    exp = ttk.Frame(tab)
    exp.pack(fill="x", pady=(6, 2))

    def files():
        return app.bridge.request("quote.files", prj=app.prj)

    ttk.Button(exp, text=_("Uložit CSV…"), style="Accent.TButton",
               command=lambda: (lambda f: save_file(app, f["csvName"], f["csv"], "interni"))(files())).pack(side="left")
    ttk.Button(exp, text=_("Uložit {file}…", file=v["file"]),
               command=lambda: (lambda f: save_file(app, f["mdName"], f["md"], "interni"))(files())).pack(side="left", padx=(6, 0))
    var_docs = tk.BooleanVar(value=v["inDocs"])
    ttk.Checkbutton(exp, text=_("přidat {file} do dokumentace", file=v["file"]), variable=var_docs,
                    command=lambda: set_q("inDocs", var_docs.get())).pack(side="left", padx=(12, 0))
    exp._var = var_docs
    ttk.Label(exp, text=_("Interní podklad — do dokumentace pro zákazníka jen na výslovnou volbu."),
              style="Dim.TLabel").pack(side="left", padx=(8, 0))
    if not t["complete"]:
        tk.Label(tab, text=_("Součty nejsou úplné: {n} položek bez ceny.", n=len(v["unpriced"])), bg=theme.BG,
                 fg=theme.ERR, font=theme.FONT_ACCENT, anchor="w").pack(fill="x")

    sub = ttk.Notebook(tab, style="Compact.TNotebook")
    sub.pack(fill="both", expand=True, pady=(4, 0))
    t_mat = ttk.Frame(sub, padding=(0, 6, 0, 0))
    t_lab = ttk.Frame(sub, padding=(0, 6, 0, 0))
    t_price = ttk.Frame(sub, padding=(0, 6, 0, 0))
    t_set = ttk.Frame(sub, padding=(0, 6, 0, 0))
    t_un = ttk.Frame(sub, padding=(0, 6, 0, 0))
    sub.add(t_mat, text=_("Materiál ({n})", n=len(v["material"])))
    sub.add(t_lab, text=_("Práce"))
    sub.add(t_price, text=_("Ceník ({n})", n=v["priceCount"]))
    sub.add(t_set, text=_("Sazby a parametry"))
    sub.add(t_un, text=_("Bez ceny ({n})", n=len(v["unpriced"])))
    sub.bind("<<NotebookTabChanged>>", lambda _e: qui.update(tab=sub.index("current")))

    # --- materiál
    tm = Table(t_mat, [("tag", _("Označení"), 70, False), ("item", _("Položka"), 170, True), ("brand", _("Výrobce"), 90, False),
                       ("type", _("Typ"), 180, True), ("code", _("Objednací kód"), 130, False), ("qty", _("Ks"), 40, False),
                       ("unit", _("Cena/ks"), 110, False), ("total", _("Celkem"), 110, False), ("m", _("Párování"), 130, False)],
               height=7)
    tm.pack(fill="both", expand=True)
    for k, col in (("code", theme.FG), ("type", theme.FG), ("cat", theme.WARN), ("none", theme.ERR)):
        tm.tv.tag_configure("q_" + k, foreground=col)
    for m in v["material"]:
        tm.add("m:" + m["id"], (m["tag"], ("⚠ " if m["safety"] else "") + m["item"], m["brand"], m["type"],
                                m["orderCode"] or "—", m["qty"], m["unitPrice"] or "—", m["total"] or "—",
                                m["matchLabel"] + (f" · {m['priceRow']}" if m["priceRow"] else "")),
               tags=("q_" + m["match"],))
    wrap_label(t_mat, _("Párování „kategorie“ = cena podle kategorie, ne podle konkrétního typu — ověř.") + "  "
               + _("Červeně = bez ceny (není v ceníku nebo chybí kurz)."), pady=(4, 0))

    # --- práce
    tl = Table(t_lab, [("label", _("Položka"), 220, True), ("basis", _("Výpočet"), 200, True), ("qty", _("Množství"), 90, False),
                       ("rate", _("Sazba"), 120, False), ("total", _("Celkem"), 120, False)], height=7)
    tl.pack(fill="both", expand=True)
    tl.tv.tag_configure("none", foreground=theme.ERR)
    for l in v["labor"]:
        tl.add("l:" + l["key"], (l["label"], l["basis"], l["qty"], l["rate"] or "—", l["total"] or "—"),
               tags=() if l["total"] else ("none",))
    help_lbl = wrap_label(t_lab, _("Vyber řádek — zobrazí se, co položka zahrnuje."), pady=(4, 0))
    helps = {"l:" + l["key"]: l["help"] for l in v["labor"]}
    tl.tv.bind("<<TreeviewSelect>>", lambda _e: help_lbl.configure(text=helps.get(tl.selected() or "", "")))

    # --- ceník
    pr = ttk.Frame(t_price)
    pr.pack(fill="x")
    var_def = tk.StringVar(value=qui.get("defcur", ""))
    def_names = [_("podle souboru"), *CURRENCIES]

    def do_import() -> None:
        path = filedialog.askopenfilename(
            parent=app.root, title=_("Načíst ceník"), initialdir=app.settings.get("last_dir") or None,
            filetypes=[(_("Ceník CSV / TSV"), "*.csv *.tsv *.txt"), (_("Všechny soubory"), "*.*")])
        if path:
            import_file(app, path, CURRENCIES[cb_def.current() - 1] if cb_def.current() > 0 else "")
            app.settings["last_dir"] = str(Path(path).parent)
            app.render()

    ttk.Button(pr, text=_("Načíst ceník (CSV / TSV)…"), style="Accent.TButton", command=do_import).pack(side="left")
    ttk.Label(pr, text=_("měna řádků bez měny")).pack(side="left", padx=(12, 4))
    cb_def = ttk.Combobox(pr, values=def_names, state="readonly", width=max(len(n) for n in def_names) + 1)
    cb_def.current(def_names.index(var_def.get()) if var_def.get() in def_names else 0)
    cb_def.pack(side="left")
    cb_def.bind("<<ComboboxSelected>>", lambda _e: qui.update(defcur=cb_def.get()))
    if v["priceCount"]:
        ttk.Button(pr, text=_("Odebrat ceník"), style="Danger.TButton",
                   command=lambda: (qui.pop("imp", None), set_q("prices", None))).pack(side="left", padx=(12, 0))
    ttk.Label(pr, text=_("položek ceníku {n}", n=v["priceCount"]) if v["priceCount"] else _("ceník nenačten"),
              style="Dim.TLabel").pack(side="left", padx=(12, 0))
    imp = qui.get("imp")
    if imp:
        ok = imp["count"] > 0
        text = (_("Načteno {n} položek ze souboru {file} (oddělovač: {d}).", n=imp["count"], file=imp["file"], d=imp["delimiter"])
                if ok else _("Ze souboru {file} se nenačetla žádná cena.", file=imp["file"])
                + (" " + _("Stávající ceník zůstává.") if imp.get("kept") else ""))
        tk.Label(t_price, text="\n".join([text, *("• " + w for w in imp["warnings"])]), bg=theme.BG, anchor="w",
                 justify="left", fg=(theme.WARN if imp["warnings"] else theme.OK) if ok else theme.ERR,
                 font=theme.FONT_UI, wraplength=1000).pack(fill="x", pady=(6, 0))
    wrap_label(t_price, _("Ceník z Excelu (středník, desetinná čárka) nebo TSV; sloupce se poznají podle záhlaví "
                          "(objednací kód, typ, výrobce, kategorie, cena, měna, dodavatel, dodací lhůta). Párování: "
                          "objednací kód → typ a výrobce → kategorie."), pady=(6, 0))
    ttk.Label(t_price, text=_("Nepoužité řádky ceníku ({n})", n=len(v["unused"])), style="Section.TLabel").pack(anchor="w", pady=(6, 0))
    tu = Table(t_price, [("row", _("Řádek"), 60, False), ("code", _("Objednací kód"), 140, False), ("type", _("Typ"), 200, True),
                         ("brand", _("Výrobce"), 110, False), ("cat", _("Kategorie"), 120, False), ("price", _("Cena"), 110, False)],
               height=3)
    tu.pack(fill="both", expand=True)
    for u in v["unused"]:
        tu.add(f"u{u['row']}", (u["row"], u["orderCode"] or "—", u["type"] or "—", u["brand"] or "—", u["cat"] or "—", u["price"]))

    # --- sazby a parametry
    form = ttk.Frame(t_set)
    form.pack(fill="x")
    ttk.Label(form, text=_("Měna nabídky")).grid(row=0, column=0, sticky="w")
    cur_vals = list(dict.fromkeys([*CURRENCIES, v["currency"]]))
    cb_cur = ttk.Combobox(form, values=cur_vals, state="readonly", width=6)
    cb_cur.set(v["currency"])
    cb_cur.grid(row=1, column=0, sticky="w", padx=(0, 12))
    cb_cur.bind("<<ComboboxSelected>>", lambda _e: set_q("currency", cb_cur.get()))
    fields = [("vatPct", _("DPH [%]"), app.prj.get("quote", {}).get("vatPct"), "21"),
              ("marginPct", _("Přirážka na materiál [%]"), app.prj.get("quote", {}).get("marginPct"), "0")]
    fields += [("fx." + f["cur"], f["label"], f["value"], _("kurz nezadán")) for f in v["foreign"]]
    fields += [("rates." + r["key"], f"{r['label']} [{r['unit']}]", r["value"], _("nezadáno")) for r in v["rates"]]
    entries = {}
    col = 1
    for path, label, val, ph in fields:
        r0 = 0 if col < 6 else 2
        c = col if col < 6 else col - 5
        ttk.Label(form, text=label, style="Dim.TLabel").grid(row=r0, column=c, sticky="w", padx=(0, 12))
        var = tk.StringVar(value=_num_text(val))
        e = ttk.Entry(form, textvariable=var, width=14)
        e._var = var
        e._ph = ph
        e.grid(row=r0 + 1, column=c, sticky="w", padx=(0, 12), pady=(0, 6))
        entries[path] = e
        col += 1

    def commit_entry(path: str, e) -> None:
        s = e._var.get().strip()
        if not s:
            set_q(path, None)
            return
        n = parse_num(s)
        if n is None or n < 0:
            app.set_status(_("Zadej nezáporné číslo."))
            return
        set_q(path, n)

    for path, e in entries.items():
        e.bind("<Return>", lambda _e, p=path, w=e: commit_entry(p, w))
        e.bind("<FocusOut>", lambda _e, p=path, w=e: commit_entry(p, w) if w._var.get().strip() != _num_text(
            _cur_value(app, p)) else None)
    wrap_label(t_set, _("Sazby nemají výchozí hodnotu — práce bez sazby zůstane bez ceny.") + " "
               + (_("Kurz = kolik jednotek měny nabídky stojí 1 jednotka cizí měny. Bez kurzu zůstanou položky v cizí měně bez ceny.")
                  if v["foreign"] else ""), pady=(2, 4))

    ttk.Label(t_set, text=_("Parametry odhadu hodin") + " — " + _("prázdné = výchozí hodnota / odhad z projektu"),
              style="Section.TLabel").pack(anchor="w")
    tp = Table(t_set, [("label", _("Parametr"), 300, True), ("val", _("Hodnota"), 100, False),
                       ("def", _("Výchozí / odhad"), 110, False), ("unit", _("Jednotka"), 70, False)],
               height=5, editable=("val",), on_edit=lambda iid, _k, value: commit_param(iid, value))
    tp.pack(fill="both", expand=True)
    for x in v["params"]:
        label = x["label"] + (f"  ({_('{n}× v projektu', n=x['count'])})" if x.get("count") else "")
        tp.add("p:" + x["key"], (label, _num_text(x["value"]), x["placeholder"], x["unit"]))
    p_help = wrap_label(t_set, _("Hodnotu změníš dvojklikem do sloupce Hodnota (prázdné = výchozí). Vyber řádek — zobrazí se vysvětlení."),
                        pady=(4, 0))
    phelp = {"p:" + x["key"]: x["help"] for x in v["params"]}
    tp.tv.bind("<<TreeviewSelect>>", lambda _e: p_help.configure(text=phelp.get(tp.selected() or "", "")))

    def commit_param(iid: str, value: str) -> None:
        s = value.strip()
        if not s:
            set_q("params." + iid[2:], None)
            return
        n = parse_num(s)
        if n is None or n < 0:
            app.set_status(_("Zadej nezáporné číslo."))
            return
        set_q("params." + iid[2:], n)

    tp._commit = commit_param   # testy

    # --- bez ceny
    tn = Table(t_un, [("kind", _("Druh"), 90, False), ("label", _("Položka"), 300, True), ("why", _("Důvod"), 260, True)], height=7)
    tn.pack(fill="both", expand=True)
    for k, u in enumerate(sorted(v["unpriced"], key=lambda u: u["kind"] != "labor")):
        tn.add(f"n{k}", (_("práce") if u["kind"] == "labor" else _("materiál"), u["label"], u["reason"]))
    if not v["unpriced"]:
        ttk.Label(t_un, text="✔ " + _("Všechny položky mají cenu."), style="Ok.TLabel").pack(anchor="w")

    if isinstance(qui.get("tab"), int) and qui["tab"] < 5:
        sub.select(qui["tab"])
    tab._entries = entries      # testy
    tab._commit = commit_entry
    tab._params = tp



def _cur_value(app, path: str):
    o = app.prj.get("quote") or {}
    for p in path.split("."):
        o = o.get(p) if isinstance(o, dict) else None
    return o


def import_file(app, path: str | Path, currency: str = "") -> dict:
    """Načte ceník do projektu; výsledek (počet, varování) si pamatuje pro záložku Ceník."""
    text = read_text_file(path)
    r = app.bridge.request("quote.import", prj=app.prj, text=text, currency=currency)
    app.prj = r["prj"]
    app.ui.setdefault("quote", {})["imp"] = {"count": r["count"], "warnings": r["warnings"], "delimiter": r["delimiter"],
                                             "kept": r["kept"], "file": Path(path).name}
    app.save()
    return r
