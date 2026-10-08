"""Projektová složka — jen desktop.

**Kořenový adresář projektů** je nastavení aplikace (``settings.json`` → ``projects_root``, společný pro
všechny projekty); projekt může mít vlastní kořen ``prj["meta"]["dataDir"]`` (přepíše nastavení —
např. projekt jiného zákazníka na sdíleném disku). **Projektová složka** = ``<kořen>/<číslo>_<Název>``
(core ``projectFolderName``: bez diakritiky, mezery → _, jen [A-Za-z0-9_-]; bez čísla jen název).

Uvnitř je struktura jádra (core ``PROJECT_DIRS``, ``projectFileFolder``): ``01_Dokumentace``,
``02_Vykresy/SVG|DXF``, ``03_Program_PLC/<Platforma>``, ``04_HMI``, ``05_Bezpecnost``, ``06_Kusovnik``,
``07_Oziveni_a_FAT``, ``08_Schvaleni_a_revize``, ``09_Exporty``, ``99_Interni`` — každý soubor s předponou
čísla projektu. Dialogy „Uložit…“ začínají v podsložce, kam soubor patří (``initial_dir``), a „Uložit
vše do složky projektu“ (``save_all``) zapíše celou složku: obsah počítá pracovní proces jádra (operace
``datadir``, licence se uplatní tam), okno nezamrzne; tady se jen zapisuje.

Kořen se nikdy nevytváří bez potvrzení: projekt z jiného počítače má cestu, která tu neexistuje —
pak hláška a nabídka vybrat jinou (``check_missing``, ``ensure_root``). Projektová složka a podsložky
pod existujícím kořenem se zakládají podle potřeby.

Nový projekt dostane návrh dalšího čísla letošní řady podle názvů projektových složek v kořeni
(``suggest_number`` → core ``nextProjectNumber``: ``RRNNNN_*`` max + 1, po RR9999 přetoková řada RR+50).
"""

from __future__ import annotations

import base64
import datetime as dt
import os
from pathlib import Path

import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from .i18n import _, _n, N_

# popisky podsložek v přehledu po uložení (názvy = core PROJECT_DIRS, packages/core/src/project_folder.ts)
DIR_LABELS = {
    "01_Dokumentace": N_("dokumentace"), "02_Vykresy": N_("výkresy"), "03_Program_PLC": N_("kód PLC"),
    "04_HMI": N_("HMI"), "05_Bezpecnost": N_("bezpečnost"), "06_Kusovnik": N_("kusovník"),
    "07_Oziveni_a_FAT": N_("oživení a FAT"), "08_Schvaleni_a_revize": N_("schválení a revize"),
    "09_Exporty": N_("exporty (EPLAN)"), "99_Interni": N_("interní — nepředávat zákazníkovi"),
}


# --- kořen ------------------------------------------------------------------------------------

def settings_root(app) -> str:
    """Kořenový adresář projektů z nastavení aplikace ("" = nenastaven)."""
    v = app.settings.get("projects_root")
    return v.strip() if isinstance(v, str) else ""


def own_root(app) -> str:
    """Vlastní kořen projektu (``meta.dataDir``, přepíše nastavení); "" = žádný."""
    v = (app.prj.get("meta") or {}).get("dataDir")
    return v.strip() if isinstance(v, str) else ""


def raw_root(app) -> str:
    """Platný kořen (i neexistující): vlastní kořen projektu, jinak nastavení aplikace."""
    return own_root(app) or settings_root(app)


def _dir(raw: str) -> Path | None:
    if not raw:
        return None
    try:
        p = Path(raw)
        return p if p.is_dir() else None
    except (OSError, ValueError):
        return None


def existing_root(app) -> Path | None:
    """Kořen, pokud je nastavený a na tomto počítači existuje."""
    return _dir(raw_root(app))


def folder_name(app) -> str:
    """Název projektové složky „<číslo>_<Název>“ (core projectFolderName)."""
    try:
        return app.core("projectFolderName", {"meta": app.prj.get("meta") or {}}) or "plc-projekt"
    except Exception:                                  # noqa: BLE001 — bez mostu (testy)
        return "plc-projekt"


def project_dir(app) -> Path | None:
    """Projektová složka pod existujícím kořenem (nemusí ještě existovat); bez kořene None."""
    root = existing_root(app)
    return root / folder_name(app) if root is not None else None


def place(app, name: str, sub: str | None) -> tuple[str | None, str]:
    """Výchozí složka a jméno dialogu „Uložit…“ pro soubor ``name`` druhu ``sub`` (``kod/siemens``,
    ``vykresy``, ``dokumentace``…): podsložka projektové složky (založí se — kořen musí existovat),
    jinak naposledy použitá složka; jméno s předponou čísla projektu (core withFilePrefix)."""
    last = app.settings.get("last_dir") or None
    try:
        r = app.bridge.request("folder.place", prj={"meta": app.prj.get("meta") or {}}, name=name,
                               hint=sub or "")
    except Exception:                                  # noqa: BLE001 — bez mostu (testy)
        return last, name
    pdir = project_dir(app)
    if pdir is None:
        return last, r["name"]
    d = pdir.joinpath(*r["dir"].split("/"))
    try:
        d.mkdir(parents=True, exist_ok=True)
        return str(d), r["name"]
    except OSError:
        return last, r["name"]


def initial_dir(app, sub: str | None = None, name: str = "") -> str | None:
    """Výchozí složka dialogu: bez ``sub`` / ``name`` projektová složka (soubor projektu), jinak
    podsložka podle druhu souboru; bez kořene naposledy použitá složka."""
    if not sub and not name:
        pdir = project_dir(app)
        if pdir is None:
            return app.settings.get("last_dir") or None
        try:
            pdir.mkdir(parents=True, exist_ok=True)
            return str(pdir)
        except OSError:
            return app.settings.get("last_dir") or None
    return place(app, name or "x", sub)[0]


def set_root(app, path: str) -> None:
    """Kořenový adresář projektů do nastavení aplikace (všechny projekty)."""
    if path:
        app.settings["projects_root"] = str(Path(path))
    else:
        app.settings.pop("projects_root", None)
    app.save_settings()


def set_own_root(app, path: str) -> None:
    """Vlastní kořen projektu (``meta.dataDir``); prázdné = podle nastavení aplikace."""
    meta = app.prj.setdefault("meta", {})
    if path:
        meta["dataDir"] = str(Path(path))
    else:
        meta.pop("dataDir", None)
    app.save()


def choose(app, *, parent=None, own: bool = False) -> bool:
    """Dialog výběru kořenového adresáře (``own`` = vlastní kořen projektu); vrací, zda se nastavil."""
    start = existing_root(app)
    path = filedialog.askdirectory(
        parent=parent or app.root, title=_("Kořenový adresář projektů"), mustexist=True,
        initialdir=str(start) if start else (app.settings.get("last_dir") or None))
    if not path:
        return False
    (set_own_root if own else set_root)(app, path)
    app.set_status(_("Kořenový adresář projektů: {path}", path=Path(path)))
    return True


def check_missing(app) -> None:
    """Po otevření projektu: jeho vlastní kořen tu neexistuje → hláška a nabídka vybrat jiný.
    Nic se nevytváří; bez nové volby platí kořen z nastavení aplikace."""
    raw = own_root(app)
    if not raw or _dir(raw) is not None:
        return
    if messagebox.askyesno(
            _("Kořenový adresář neexistuje"),
            _("Kořenový adresář {path} na tomto počítači neexistuje (projekt možná pochází "
              "z jiného počítače).", path=raw) + "\n\n" + _("Vybrat jiný?"),
            parent=app.root):
        choose(app, own=True)


def ensure_root(app) -> Path | None:
    """Kořen pro uložení: nenastavený → výběr; neexistující → vytvořit (jen po potvrzení),
    nebo vybrat jiný. ``None`` = uživatel to zrušil."""
    raw = raw_root(app)
    own = bool(own_root(app))
    if not raw:
        if not messagebox.askyesno(_("Kořenový adresář projektů"), _(
                "Kořenový adresář projektů není nastavený. Vybrat ho teď?"), parent=app.root):
            return None
        return existing_root(app) if choose(app) else None
    root = existing_root(app)
    if root is not None:
        return root
    ans = messagebox.askyesnocancel(
        _("Kořenový adresář neexistuje"),
        _("Kořenový adresář {path} na tomto počítači neexistuje (projekt možná pochází "
          "z jiného počítače).", path=raw) + "\n\n"
        + _("Ano = vytvořit ho, Ne = vybrat jiný, Storno = nic neukládat."), parent=app.root)
    if ans is None:
        return None
    if ans is False:
        return existing_root(app) if choose(app, own=own) else None
    try:
        Path(raw).mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        messagebox.showerror(_("Složku nejde vytvořit"), str(exc), parent=app.root)
        return None
    return existing_root(app)


def suggest_number(app, year: int | None = None) -> str:
    """Návrh čísla nového projektu: další volné letošní řady podle projektových složek v kořeni
    z nastavení (``RRNNNN_*``); bez kořene / složek RR0001 (core nextProjectNumber)."""
    names: list[str] = []
    root = _dir(settings_root(app))
    if root is not None:
        try:
            names = [p.name for p in root.iterdir() if p.is_dir()]
        except OSError:
            names = []
    try:
        return app.core("nextProjectNumber", names, year or dt.date.today().year) or ""
    except Exception:                                  # noqa: BLE001 — bez mostu (testy)
        return ""


# --- Uložit vše --------------------------------------------------------------------------------

def plan(pdir: Path, data: dict) -> list[tuple[Path, object]]:
    """Seznam ``(cíl, obsah)`` z odpovědi operace ``datadir`` (bez zamčených souborů)."""
    out: list[tuple[Path, object]] = []
    for f in data["files"]:
        if "body" in f:
            out.append((pdir.joinpath(*f["path"].split("/")), f["body"]))
    for f in data.get("bins", []):
        if "b64" in f:
            out.append((pdir.joinpath(*f["path"].split("/")), base64.b64decode(f["b64"])))
    return out


def write_all(pdir: Path, data: dict, project_text: str) -> dict:
    """Zapíše projektovou složku ``pdir``; vrací přehled ``{"dirs": {podsložka: počet}, "blocked": [...],
    "project": cesta, "total": n}``. Chyba zápisu = ``OSError`` (co se zapsalo, zůstává)."""
    from .widgets import write_text
    dirs: dict[str, int] = {}
    total = 0
    for path, body in plan(pdir, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(body, bytes):
            path.write_bytes(body)
        else:
            write_text(path, body)
        top = path.relative_to(pdir).parts[0]
        dirs[top] = dirs.get(top, 0) + 1
        total += 1
    pdir.mkdir(parents=True, exist_ok=True)
    proj = pdir / data["project"]
    proj.write_text(project_text, encoding="utf-8")
    every = [*data["files"], *data.get("bins", [])]
    blocked = sorted({f["blocked"] for f in every if f.get("blocked")})
    nblocked = sum(1 for f in every if f.get("blocked"))
    return {"dirs": dirs, "blocked": blocked, "nblocked": nblocked, "project": proj, "total": total + 1}


def summary_text(pdir: Path, s: dict) -> str:
    lines = [_n(s["total"], N_("Uložen {n} soubor do {path}.|Uloženy {n} soubory do {path}."
                               "|Uloženo {n} souborů do {path}."), path=pdir), ""]
    for d in sorted(s["dirs"]):
        label = _(DIR_LABELS[d]) if d in DIR_LABELS else ""
        lines.append(f"  {d}\\  —  {label + ': ' if label else ''}{s['dirs'][d]}")
    lines.append(f"  {s['project'].name}  —  " + _("projekt"))
    if s["nblocked"]:
        lines += ["", _n(s["nblocked"], N_("Neuloženo podle licence: {n} soubor.|Neuloženo podle "
                                           "licence: {n} soubory.|Neuloženo podle licence: "
                                           "{n} souborů.")) + " " + " ".join(s["blocked"])]
    return "\n".join(lines)


def payload(app) -> dict:
    """Parametry operace ``datadir``: projekt a brána licence (knihovna bloků je v ní)."""
    lic = getattr(app, "lic", None)
    return {"prj": app.prj, "gate": lic.gate() if lic else None}


def save_all(app, *, ask: bool = True, on_done=None):
    """„Uložit vše do složky projektu“: kořen (s potvrzením), výpočet v pracovním procesu
    s průběhem a Zrušit, zápis do ``<kořen>/<číslo>_<Název>``, přehled. ``on_done(přehled | None)``
    po skončení (testy). ``ask=False`` = bez dotazu na přepsání a bez okna s přehledem (testy).
    Vrací ``Job`` / ``None``."""
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
    ttk.Label(frm, text=str(root / folder_name(app)), style="Dim.TLabel").pack(anchor="w")
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
        pdir = root / data["folder"]
        targets = plan(pdir, data)
        existing = [p for p, _b in targets if p.exists()]
        if ask and existing and not messagebox.askyesno(
                _("Přepsat soubory?"),
                _("Ve složce už existuje {n} z {total} souborů (např. {name}).",
                  n=len(existing), total=len(targets), name=existing[0].relative_to(pdir))
                + "\n" + _("Přepsat je?"), parent=win if win.winfo_exists() else app.root):
            finish(None)
            return
        try:
            s = write_all(pdir, data, app.project_payload())
        except OSError as exc:
            messagebox.showerror(_("Uložení se nezdařilo"), str(exc), parent=app.root)
            finish(None)
            return
        app.settings["last_dir"] = str(pdir)
        s["folder"] = pdir
        app.set_status(_n(s["total"], N_("Uložen {n} soubor do {path}|Uloženy {n} soubory do {path}"
                                         "|Uloženo {n} souborů do {path}"), path=pdir))
        if win.winfo_exists():
            win.destroy()
        if ask:
            if messagebox.askyesno(_("Uloženo do složky projektu"),
                                   summary_text(pdir, s) + "\n\n" + _("Otevřít složku?"),
                                   parent=app.root):
                open_folder(pdir)
            if s["nblocked"] and getattr(app, "lic", None):
                app.lic.blocked(s["blocked"][0])
        finish(s)

    app.on_job(job, done, owner=win)
    return job


def open_folder(path: Path) -> None:
    try:
        os.startfile(path)              # noqa: S606 — Průzkumník Windows
    except (OSError, AttributeError):
        pass
