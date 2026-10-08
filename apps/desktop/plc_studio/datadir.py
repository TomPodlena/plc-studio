"""Složka dat projektu (``prj["meta"]["dataDir"]``) — jen desktop.

Kořenová složka na disku, pod kterou se ukládají výstupy projektu po druzích (podsložky
``PROJECT_DIRS`` jádra: ``kod/<platforma>``, ``dokumentace``, ``vykresy``, ``kusovnik``, ``hmi``,
``exporty``). Dialogy „Uložit…“ v ní začínají (``initial_dir``) a „Uložit vše do složky projektu“
(``save_all``) do ní zapíše celou sadu: obsah počítá pracovní proces jádra (operace ``datadir``,
licence se uplatní tam), okno nezamrzne; tady se jen zapisuje.

Kořen se nikdy nevytváří bez potvrzení: projekt z jiného počítače má cestu, která tu neexistuje —
pak hláška a nabídka vybrat jinou (``check_missing``, ``ensure_root``). Podsložky pod existujícím
kořenem se zakládají podle potřeby.
"""

from __future__ import annotations

import base64
import os
from pathlib import Path

import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from .i18n import _, _n, N_

# podsložky (musí odpovídat PROJECT_DIRS v packages/core/src/project_folder.ts)
DIRS = {"code": "kod", "docs": "dokumentace", "drawings": "vykresy", "bom": "kusovnik",
        "hmi": "hmi", "exports": "exporty"}
# popisky podsložek v přehledu po uložení
DIR_LABELS = {"kod": N_("kód PLC"), "dokumentace": N_("dokumentace"), "vykresy": N_("výkresy"),
              "kusovnik": N_("kusovník"), "hmi": N_("HMI"), "exporty": N_("exporty (EPLAN, SISTEMA)")}


def raw_root(app) -> str:
    """Uložená cesta (i neexistující); bez nastavení ""."""
    v = (app.prj.get("meta") or {}).get("dataDir")
    return v.strip() if isinstance(v, str) else ""


def existing_root(app) -> Path | None:
    """Kořen, pokud je nastavený a na tomto počítači existuje."""
    raw = raw_root(app)
    if not raw:
        return None
    try:
        p = Path(raw)
        return p if p.is_dir() else None
    except (OSError, ValueError):
        return None


def initial_dir(app, sub: str | None = None) -> str | None:
    """Výchozí složka dialogu „Uložit…“: podsložka ``sub`` složky projektu (založí se, kořen
    musí existovat), jinak naposledy použitá složka."""
    root = existing_root(app)
    if root is None:
        return app.settings.get("last_dir") or None
    if not sub:
        return str(root)
    d = root.joinpath(*sub.split("/"))
    try:
        d.mkdir(parents=True, exist_ok=True)
        return str(d)
    except OSError:
        return str(root)


def set_root(app, path: str) -> None:
    meta = app.prj.setdefault("meta", {})
    if path:
        meta["dataDir"] = str(Path(path))
    else:
        meta.pop("dataDir", None)
    app.save()


def choose(app, *, parent=None) -> bool:
    """Dialog výběru složky dat projektu; vrací, zda se nastavila."""
    start = existing_root(app)
    path = filedialog.askdirectory(
        parent=parent or app.root, title=_("Složka dat projektu"), mustexist=True,
        initialdir=str(start) if start else (app.settings.get("last_dir") or None))
    if not path:
        return False
    set_root(app, path)
    app.set_status(_("Složka dat projektu: {path}", path=Path(path)))
    return True


def check_missing(app) -> None:
    """Po otevření projektu: uložená složka tu neexistuje → hláška a nabídka vybrat jinou.
    Nic se nevytváří; bez nové volby dialogy začínají v naposledy použité složce."""
    raw = raw_root(app)
    if not raw or existing_root(app) is not None:
        return
    if messagebox.askyesno(
            _("Složka dat projektu neexistuje"),
            _("Složka dat projektu {path} na tomto počítači neexistuje (projekt možná pochází "
              "z jiného počítače).", path=raw) + "\n\n" + _("Vybrat jinou složku?"),
            parent=app.root):
        choose(app)


def ensure_root(app) -> Path | None:
    """Kořen pro uložení: nenastavený → výběr; neexistující → vytvořit (jen po potvrzení),
    nebo vybrat jinou. ``None`` = uživatel to zrušil."""
    raw = raw_root(app)
    if not raw:
        if not messagebox.askyesno(_("Složka dat projektu"), _(
                "Složka dat projektu není nastavená. Vybrat ji teď?"), parent=app.root):
            return None
        return existing_root(app) if choose(app) else None
    root = existing_root(app)
    if root is not None:
        return root
    ans = messagebox.askyesnocancel(
        _("Složka dat projektu neexistuje"),
        _("Složka dat projektu {path} na tomto počítači neexistuje (projekt možná pochází "
          "z jiného počítače).", path=raw) + "\n\n"
        + _("Ano = vytvořit ji, Ne = vybrat jinou, Storno = nic neukládat."), parent=app.root)
    if ans is None:
        return None
    if ans is False:
        return existing_root(app) if choose(app) else None
    try:
        Path(raw).mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        messagebox.showerror(_("Složku nejde vytvořit"), str(exc), parent=app.root)
        return None
    return existing_root(app)


def plan(root: Path, data: dict) -> list[tuple[Path, object]]:
    """Seznam ``(cíl, obsah)`` z odpovědi operace ``datadir`` (bez zamčených souborů)."""
    out: list[tuple[Path, object]] = []
    for f in data["files"]:
        if "body" in f:
            out.append((root.joinpath(*f["path"].split("/")), f["body"]))
    for f in data.get("bins", []):
        if "b64" in f:
            out.append((root.joinpath(*f["path"].split("/")), base64.b64decode(f["b64"])))
    return out


def write_all(root: Path, data: dict, project_text: str) -> dict:
    """Zapíše sadu do ``root``; vrací přehled ``{"dirs": {podsložka: počet}, "blocked": [...],
    "project": cesta, "total": n}``. Chyba zápisu = ``OSError`` (co se zapsalo, zůstává)."""
    from .widgets import write_text
    dirs: dict[str, int] = {}
    total = 0
    for path, body in plan(root, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(body, bytes):
            path.write_bytes(body)
        else:
            write_text(path, body)
        top = path.relative_to(root).parts[0]
        dirs[top] = dirs.get(top, 0) + 1
        total += 1
    proj = root / data["project"]
    proj.write_text(project_text, encoding="utf-8")
    blocked = sorted({f["blocked"] for f in [*data["files"], *data.get("bins", [])] if f.get("blocked")})
    nblocked = sum(1 for f in [*data["files"], *data.get("bins", [])] if f.get("blocked"))
    return {"dirs": dirs, "blocked": blocked, "nblocked": nblocked, "project": proj, "total": total + 1}


def summary_text(root: Path, s: dict) -> str:
    lines = [_n(s["total"], N_("Uložen {n} soubor do {path}.|Uloženy {n} soubory do {path}."
                               "|Uloženo {n} souborů do {path}."), path=root), ""]
    for d in ("kod", "dokumentace", "vykresy", "kusovnik", "hmi", "exporty"):
        if s["dirs"].get(d):
            lines.append(f"  {d}\\  —  {_(DIR_LABELS[d])}: {s['dirs'][d]}")
    lines.append(f"  {s['project'].name}  —  " + _("projekt"))
    if s["nblocked"]:
        lines += ["", _n(s["nblocked"], N_("Neuloženo podle licence: {n} soubor.|Neuloženo podle "
                                           "licence: {n} soubory.|Neuloženo podle licence: "
                                           "{n} souborů.")) + " " + " ".join(s["blocked"])]
    return "\n".join(lines)


def payload(app) -> dict:
    """Parametry operace ``datadir``: projekt, volby generátoru a brána licence."""
    lic = getattr(app, "lic", None)
    return {"prj": app.prj, "lic": lic.gen_opts() if lic else None, "gate": lic.gate() if lic else None}


def save_all(app, *, ask: bool = True, on_done=None):
    """„Uložit vše do složky projektu“: kořen (s potvrzením), výpočet v pracovním procesu
    s průběhem a Zrušit, zápis, přehled. ``on_done(přehled | None)`` po skončení (testy).
    ``ask=False`` = bez dotazu na přepsání a bez okna s přehledem (testy). Vrací ``Job`` / ``None``."""
    root = ensure_root(app)
    if root is None:
        return None
    job = app.bridge.submit("datadir", payload(app), preemptible=False)

    win = tk.Toplevel(app.root)
    win.title(_("Uložit vše do složky projektu"))
    win.transient(app.root)
    win.resizable(False, False)
    frm = ttk.Frame(win, padding=16)
    frm.pack(fill="both", expand=True)
    ttk.Label(frm, text=_("Připravuji kód, dokumentaci, výkresy, kusovník a HMI — u velkého stroje "
                          "to trvá i desítky sekund…"), wraplength=420, justify="left").pack(anchor="w")
    bar = ttk.Progressbar(frm, mode="indeterminate", length=420)
    bar.pack(fill="x", pady=(10, 6))
    bar.start(15)
    ttk.Label(frm, text=str(root), style="Dim.TLabel").pack(anchor="w")
    ttk.Button(frm, text=_("Zrušit"), command=lambda: app.bridge.cancel(job)).pack(anchor="e", pady=(10, 0))
    win.protocol("WM_DELETE_WINDOW", lambda: app.bridge.cancel(job))

    def finish(result) -> None:
        if win.winfo_exists():
            win.destroy()
        if on_done:
            on_done(result)

    def done(j) -> None:
        if j.state != "done":
            if j.state == "error":
                messagebox.showerror(_("Uložení se nezdařilo"), str(j.error), parent=app.root)
            else:
                app.set_status(_("Ukládání do složky projektu zrušeno."))
            finish(None)
            return
        data = j.result()
        targets = plan(root, data)
        existing = [p for p, _b in targets if p.exists()]
        if ask and existing and not messagebox.askyesno(
                _("Přepsat soubory?"),
                _("Ve složce už existuje {n} z {total} souborů (např. {name}).",
                  n=len(existing), total=len(targets), name=existing[0].relative_to(root))
                + "\n" + _("Přepsat je?"), parent=win if win.winfo_exists() else app.root):
            finish(None)
            return
        try:
            s = write_all(root, data, app.project_payload())
        except OSError as exc:
            messagebox.showerror(_("Uložení se nezdařilo"), str(exc), parent=app.root)
            finish(None)
            return
        app.settings["last_dir"] = str(root)
        app.set_status(_n(s["total"], N_("Uložen {n} soubor do {path}|Uloženy {n} soubory do {path}"
                                         "|Uloženo {n} souborů do {path}"), path=root))
        if win.winfo_exists():
            win.destroy()
        if ask:
            if messagebox.askyesno(_("Uloženo do složky projektu"),
                                   summary_text(root, s) + "\n\n" + _("Otevřít složku?"),
                                   parent=app.root):
                try:
                    os.startfile(root)              # noqa: S606 — Průzkumník Windows
                except (OSError, AttributeError):
                    pass
            if s["nblocked"] and getattr(app, "lic", None):
                app.lic.blocked(s["blocked"][0])
        finish(s)

    app.on_job(job, done, owner=win)
    return job
