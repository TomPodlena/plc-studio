"""Firemní knihovna (krok Projekt, záložka „Firemní knihovna“; krok Zařízení „Přidat z knihovny“).

Knihovnu čte, ověřuje a připojuje jádro (``library.ts``) přes operace mostu ``library.*``;
pohled skládá ``apps/web/src/biz_view.js`` (stejný jako ve webu). Načtená knihovna se pamatuje
v ``library.json`` ve složce uživatele (nastavení), projekt nese kopii (``prj["library"]``).
"""

from __future__ import annotations

import json
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from .. import theme
from ..bridge import BridgeError
from ..i18n import _
from ..widgets import Table, read_text_file, save_file, wrap_label

LIB_FILE = "library.json"


def loaded_library(app) -> dict | None:
    """Knihovna načtená ze souboru (nastavení aplikace), nebo None."""
    try:
        d = json.loads((app.home / LIB_FILE).read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else None
    except (OSError, ValueError):
        return None


def _store(app, lib: dict | None) -> None:
    path = app.home / LIB_FILE
    try:
        if lib is None:
            path.unlink(missing_ok=True)
        else:
            path.write_text(json.dumps(lib, ensure_ascii=False, indent=1), encoding="utf-8")
    except OSError:
        pass


def _same(a, b) -> bool:
    if not a or not b:
        return False
    return json.dumps({**a, "updated": ""}, sort_keys=True) == json.dumps({**b, "updated": ""}, sort_keys=True)


def approver_names(app) -> list[str]:
    """Jména schvalovatelů z knihovny projektu (výběr v krocích Schválení, Bezpečnost, Oživení)."""
    lib = app.prj.get("library") or {}
    return [a["name"] for a in ((lib.get("company") or {}).get("approvers") or [])
            if isinstance(a, dict) and isinstance(a.get("name"), str) and a["name"].strip()]


def load_file(app, path: str | Path) -> bool:
    """Načte soubor knihovny; chyby ukáže. Vrací, zda se knihovna dá použít."""
    try:
        text = read_text_file(path)
    except OSError as exc:
        messagebox.showerror(_("Knihovnu nejde načíst"), str(exc), parent=app.root)
        return False
    r = app.bridge.request("library.load", text=text, prj=app.prj)
    ui = app.ui.setdefault("lib", {})
    if not r["lib"]:
        why = " ".join(i["msg"] for i in r["issues"] if i["level"] == "error")
        ui["msg"] = ("err", _("Knihovnu nejde použít: {why}", why=why))
        return False
    _store(app, r["lib"])
    errs = sum(1 for i in r["issues"] if i["level"] == "error")
    ui["msg"] = ("warn" if errs else "ok",
                 _("Načtena knihovna {name} {v} ze souboru {file}.", name=r["lib"].get("name") or "—",
                   v=r["lib"].get("version") or "", file=Path(path).name)
                 + (" " + _("Kontrola našla {n} chyb — oprav soubor a načti ho znovu.", n=errs) if errs else ""))
    return True


def build(app, parent) -> None:
    """Obsah záložky „Firemní knihovna“."""
    ui = app.ui.setdefault("lib", {})
    loaded, own = loaded_library(app), app.prj.get("library")
    cur = loaded or own
    view = None
    if cur:
        try:
            view = app.bridge.request("library.view", lib=cur, prj=app.prj)["view"]
        except BridgeError as exc:
            ui["msg"] = ("err", str(exc))

    head = ttk.Frame(parent)
    head.pack(fill="x")
    txt = (_("Knihovna projektu: {name} {v}", name=own.get("name") or "—", v=own.get("version") or "")
           if own else _("K projektu není připojena žádná knihovna."))
    if loaded and not _same(loaded, own):
        txt += "   ·   " + _("Načtená knihovna: {name} {v} — k projektu zatím nepřipojena.",
                             name=loaded.get("name") or "—", v=loaded.get("version") or "")
    ttk.Label(head, text=txt, style="Section.TLabel").pack(side="left")

    bar = ttk.Frame(parent)
    bar.pack(fill="x", pady=(6, 4))

    def do_load() -> None:
        path = filedialog.askopenfilename(
            parent=app.root, title=_("Načíst soubor knihovny"), initialdir=app.settings.get("last_dir") or None,
            filetypes=[(_("Knihovna PLCdesk"), "*.plcdesk-library.json"), ("JSON", "*.json"), (_("Všechny soubory"), "*.*")])
        if path:
            load_file(app, path)
            app.settings["last_dir"] = str(Path(path).parent)
            app.render()

    def do_save() -> None:
        if cur:
            r = app.bridge.request("library.save", lib=cur)
            save_file(app, r["name"], r["text"])

    def do_check() -> None:
        if view:
            ui["msg"] = ("err" if view["errors"] else "warn" if view["warns"] else "ok",
                         _("Ověřeno: {e} chyb, {w} upozornění.", e=view["errors"], w=view["warns"]))
            app.render()

    def do_attach() -> None:
        try:
            app.prj = app.bridge.request("library.attach", prj=app.prj, lib=loaded)["prj"]
        except BridgeError as exc:
            ui["msg"] = ("err", str(exc))
        else:
            ui["msg"] = ("ok", _("Knihovna {name} připojena k projektu. Výchozí volby se převzaly jen tam, "
                                 "kde projekt ještě nic nezvolil.", name=loaded.get("name") or "—"))
            app.save()
        app.render()

    def do_detach() -> None:
        if not messagebox.askyesno(_("Odpojit knihovnu"), _(
                "Odpojit knihovnu od projektu? Zařízení z ní zůstanou; generátor pak použije vestavěné "
                "bloky a kusovník bez dílů knihovny."), parent=app.root):
            return
        app.prj = app.bridge.request("library.detach", prj=app.prj)["prj"]
        ui["msg"] = ("ok", _("Knihovna odpojena od projektu."))
        app.save()
        app.render()

    def do_tpl() -> None:
        r = app.bridge.request("library.template")
        save_file(app, r["name"], r["text"])

    ttk.Button(bar, text=_("Načíst soubor knihovny…"), command=do_load).pack(side="left")
    b_save = ttk.Button(bar, text=_("Uložit knihovnu…"), command=do_save)
    b_check = ttk.Button(bar, text=_("Ověřit"), command=do_check)
    b_att = ttk.Button(bar, text=_("Připojit k projektu"), style="Accent.TButton", command=do_attach)
    b_det = ttk.Button(bar, text=_("Odpojit od projektu"), style="Danger.TButton", command=do_detach)
    for b in (b_save, b_check, b_att, b_det):
        b.pack(side="left", padx=(6, 0))
    ttk.Button(bar, text=_("Vzor knihovny…"), command=do_tpl).pack(side="left", padx=(6, 0))
    if not cur:
        b_save.state(["disabled"])
        b_check.state(["disabled"])
    if not (loaded and view and not view["errors"] and not _same(loaded, own)):
        b_att.state(["disabled"])
    if not own:
        b_det.state(["disabled"])

    msg = ui.get("msg")
    if msg:
        tk.Label(parent, text=msg[1], bg=theme.BG, fg={"ok": theme.OK, "warn": theme.WARN}.get(msg[0], theme.ERR),
                 font=theme.FONT_UI, anchor="w", justify="left", wraplength=1000).pack(fill="x")

    if not view:
        wrap_label(parent, _(
            "Firemní knihovna = vlastní typy zařízení (s díly kusovníku a časy kroků), vlastní šablony "
            "bloků FB se stejným rozhraním jako vestavěné, firemní hlavička kódu a schvalovatelé. Soubor "
            "knihovny (.plcdesk-library.json) sdílí celá firma; projekt si nese kopii, aby šel otevřít "
            "i bez souboru."), pady=(8, 0))
        return

    co = view["company"]
    info = ttk.Frame(parent)
    info.pack(fill="x", pady=(4, 2))
    left = [f"{view['name'] or '—'}  ·  " + _("verze {v}", v=view["version"]) + (f"  ·  {view['updated']}" if view["updated"] else "")]
    if co["name"]:
        left.append(co["name"] + (f" · {co['logoText']}" if co["logoText"] and co["logoText"] != co["name"] else "")
                    + (f" — {co['address']}" if co["address"] else ""))
    if co["approvers"]:
        left.append(_("Schvalovatelé: {list}", list=", ".join(a["name"] + (f" ({a['role']})" if a["role"] else "")
                                                             for a in co["approvers"])))
    ttk.Label(info, text="\n".join(left), justify="left").pack(side="left", anchor="w")
    stat = (_("chyb {n}", n=view["errors"]) + "  " if view["errors"] else "") + \
           (_("upozornění {n}", n=view["warns"]) if view["warns"] else "")
    tk.Label(info, text=stat or "✔ " + _("kontrola bez nálezů"), bg=theme.BG, font=theme.FONT_ACCENT,
             fg=theme.ERR if view["errors"] else theme.WARN if view["warns"] else theme.OK).pack(side="right", anchor="n")

    nb = ttk.Notebook(parent, style="Compact.TNotebook")
    nb.pack(fill="both", expand=True, pady=(4, 0))
    t_types = ttk.Frame(nb, padding=(0, 6, 0, 0))
    t_tpl = ttk.Frame(nb, padding=(0, 6, 0, 0))
    t_iss = ttk.Frame(nb, padding=(0, 6, 0, 0))
    nb.add(t_types, text=_("Typy zařízení ({n})", n=len(view["deviceTypes"])))
    nb.add(t_tpl, text=_("Šablony bloků ({n})", n=len(view["fbTemplates"])))
    nb.add(t_iss, text=_("Nálezy kontroly ({n})", n=len(view["issues"])))
    nb.bind("<<NotebookTabChanged>>", lambda _e: ui.update(tab=nb.index("current")))

    tt = Table(t_types, [("id", "ID", 100, False), ("label", _("Popisek"), 200, True), ("cls", _("Třída"), 150, False),
                         ("pre", _("Předpona"), 70, False), ("opts", _("Volby"), 220, True),
                         ("bom", _("Díly kusovníku"), 90, False), ("t", _("Hlídací čas kroku"), 110, False)], height=4)
    tt.pack(fill="both", expand=True)
    for t in view["deviceTypes"]:
        tt.add("t:" + t["id"], (t["id"], t["label"], t["clsLabel"], t["prefix"],
                                " · ".join(x for x in (t["opts"], t["range"]) if x) or "—", t["bom"],
                                f"{t['stepTimeS']:g} s" if t["stepTimeS"] is not None else "—"))

    tp = Table(t_tpl, [("id", "ID", 110, False), ("cls", _("Blok"), 110, False), ("dia", _("Dialekt"), 70, False),
                       ("plat", _("Platformy"), 200, True), ("st", _("Stav"), 180, False)], height=3)
    tp.pack(fill="both", expand=True)
    tp.tv.tag_configure("error", foreground=theme.ERR)
    tp.tv.tag_configure("unverified", foreground=theme.WARN)
    for t in view["fbTemplates"]:
        tp.add("p:" + t["id"], (t["id"], "FB_" + t["cls"], t["dialect"].upper(), t["platforms"], t["statusLabel"]),
               tags=(t["status"],))
    if view["usage"]:
        lines = [f"{u['platName']} · {u['cls']}: {u['text']}" + (f" — {u['why']}" if u["why"] else "") for u in view["usage"]]
        wrap_label(t_tpl, _("Šablony na platformách projektu") + ":\n" + "\n".join(lines), style="TLabel", pady=(4, 0))
    wrap_label(t_tpl, _("Vlastní blok simulace neověřuje — simulace a ověření zrcadlí vestavěnou šablonu. "
                        "Překlad vlastní šablony kontroluje emulátor; odladit v cílovém IDE."), pady=(4, 0))

    ti = Table(t_iss, [("lvl", _("Úroveň"), 90, False), ("where", _("Kde"), 150, False), ("msg", _("Nález"), 420, True)],
               height=4)
    ti.pack(fill="both", expand=True)
    ti.tv.tag_configure("error", foreground=theme.ERR)
    ti.tv.tag_configure("warn", foreground=theme.WARN)
    for k, i in enumerate(view["issues"]):
        ti.add(f"i{k}", (_("chyba") if i["level"] == "error" else _("upozornění"), i["where"], i["msg"]), tags=(i["level"],))

    if isinstance(ui.get("tab"), int) and ui["tab"] < 3:
        nb.select(ui["tab"])


def add_controls(app, parent) -> None:
    """„Přidat z knihovny“ do řádku pod formulářem zařízení (jen s připojenou knihovnou)."""
    lib = app.prj.get("library") or {}
    types = [t for t in (lib.get("deviceTypes") or []) if isinstance(t, dict) and t.get("cls") in app.CLS]
    if not types:
        return
    ttk.Separator(parent, orient="vertical").pack(side="left", fill="y", padx=14)
    ttk.Label(parent, text=_("Přidat z knihovny")).pack(side="left")
    names = [f"{t.get('label') or t['id']} — {app.CLS[t['cls']]['label']}" for t in types]
    cb = ttk.Combobox(parent, values=names, state="readonly", width=min(44, max(len(n) for n in names) + 1))
    cb.current(0)
    cb.pack(side="left", padx=(6, 6))
    ttk.Label(parent, text=_("označení (prázdné = auto)"), style="Dim.TLabel").pack(side="left")
    var_name = tk.StringVar()
    ent = ttk.Entry(parent, textvariable=var_name, width=7)
    ent._var = var_name
    ent.pack(side="left")

    def add() -> None:
        t = types[max(cb.current(), 0)]
        try:
            r = app.bridge.request("library.add", prj=app.prj, typeId=t["id"], name=var_name.get().strip())
        except BridgeError as exc:
            app.set_status(str(exc))
            return
        app.prj = r["prj"]
        app.ui["dev_sel"] = r["dev"]["id"]
        app.save()
        app.render()
        app.set_status(_("Přidáno zařízení {name} z knihovny.", name=r["dev"]["name"]))

    ttk.Button(parent, text=_("Přidat"), command=add).pack(side="left", padx=(6, 0))
    cb._add = add          # testy
