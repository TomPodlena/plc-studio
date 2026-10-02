"""Krok 9 — Dokumentace projektu: úplná sada souborů k prohlédnutí a uložení."""

from __future__ import annotations

from tkinter import ttk

from ..i18n import _
from ..svgview import SvgView
from ..widgets import Table, card, note_box, save_file, save_many, scrolled_text, set_text, wrap_label


def render(app, parent) -> None:
    body = card(parent, "09", _("Dokumentace projektu"))
    if not app.prj["devices"]:
        wrap_label(body, _("Nejdřív navrhni zařízení (kroky 2–4)."))
        return
    # sada obsahuje protokol ověření simulací — u velké linky se poprvé počítá desítky
    # sekund; bez zprávy by okno vypadalo zamrzle se starým obsahem
    wait = ttk.Label(body, text=_("Připravuji dokumentaci — u velkého stroje trvá první "
                                  "ověření simulací i desítky sekund…"), style="Dim.TLabel")
    wait.pack(anchor="w")
    app.root.update_idletasks()
    data = app.bridge.request("files", prj=app.prj)
    wait.destroy()
    app.prj = data["prj"]
    files: list[dict] = data["files"]

    wrap_label(body, _(
        "Z návrhu se generuje dokumentace běžného automatizačního projektu: FDS, "
        "I/O list, svorkovnice, seznam alarmů, FAT protokol, návod k obsluze, SW "
        "dokumentace, schémata (SVG + DXF) a zdrojové kódy platforem. Vyber soubor "
        "vlevo, prohlédni a ulož, kam potřebuješ."))
    note_box(body, _(
        "Soubory platforem se ukládají s předponou platformy (např. "
        "siemens_Gen_Main.scl), ať se v jedné složce nepletou. „Uložit vše“ zapíše "
        "celou sadu do zvolené složky."), side="bottom")

    main = ttk.Frame(body)
    main.pack(fill="both", expand=True, pady=(8, 0))
    main.columnconfigure(1, weight=1)
    main.rowconfigure(0, weight=1)

    # --- seznam souborů po skupinách ---
    lst = Table(main, [], height=14, tree=True)
    lst.tv.heading("#0", text=_("Soubory projektu"), anchor="w")
    lst.tv.column("#0", width=290, stretch=False)
    lst.grid(row=0, column=0, sticky="ns", padx=(0, 12))
    groups: dict[str, str] = {}
    for i, f in enumerate(files):
        if f["group"] not in groups:
            groups[f["group"]] = lst.add(f"g{len(groups)}", (), text=f["group"], tags=("group",))
        lst.add(i, (), parent=groups[f["group"]], text=f["name"])

    # --- náhled ---
    right = ttk.Frame(main)
    right.grid(row=0, column=1, sticky="nsew")
    bar = ttk.Frame(right)
    bar.pack(fill="x", pady=(0, 8))
    name_lbl = ttk.Label(bar, text="", style="Dim.TLabel", font=("Consolas", 9))
    hint = ttk.Label(right, text=_("Náhled výkresu — uloží se jako DXF pro EPLAN / AutoCAD / "
                                   "LibreCAD."), style="Dim.TLabel")
    text_frm, text = scrolled_text(right, mono=True, readonly=True, height=14)
    view = SvgView(right)

    def cur() -> dict:
        return files[min(app.ui.get("doc_sel", 0), len(files) - 1)]

    def show() -> None:
        f = cur()
        name_lbl.configure(text="→ " + f["save"])
        for w in (hint, text_frm, view):
            w.pack_forget()
        if f["kind"] == "text":
            text_frm.pack(fill="both", expand=True)
            set_text(text, f["body"])
        else:
            if f["kind"] == "dxf":
                hint.pack(anchor="w", pady=(0, 6))
            view.pack(fill="both", expand=True)
            view.show(f["prev"] if f["kind"] == "dxf" else f["body"])

    def on_select(_e=None) -> None:
        iid = lst.selected()
        if iid is not None and iid.isdigit():
            app.ui["doc_sel"] = int(iid)
            show()

    ttk.Button(bar, text=_("Uložit soubor…"), style="Accent.TButton",
               command=lambda: save_file(app, cur()["save"], cur()["body"])).pack(side="left")
    ttk.Button(bar, text=_("Uložit vše do složky…"),
               command=lambda: save_many(app, [(f["save"], f["body"]) for f in files],
                                         _("dokumentaci projektu"))).pack(side="left", padx=(6, 0))
    ttk.Button(bar, text=_("Kopírovat"), command=lambda: app.copy(cur()["body"])
               ).pack(side="left", padx=(6, 0))
    name_lbl.pack(side="left", padx=10)

    lst.tv.bind("<<TreeviewSelect>>", on_select)
    # první soubor se do výřezu neposouvá — see() by nadpis jeho skupiny odroloval pryč
    lst.select(min(app.ui.get("doc_sel", 0), len(files) - 1), reveal=bool(app.ui.get("doc_sel")))
    show()
