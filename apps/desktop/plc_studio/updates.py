"""Kontrola aktualizací — nenásilná, na pozadí, nejvýš jednou denně.

Při startu aplikace se (je-li volba zapnutá a od poslední kontroly uplynul den) ve vlákně
zeptá webu PLCdesk na poslední verzi. Novější verze = upozornění v patičce okna s odkazem
na stránku ke stažení; bez sítě, s chybou nebo se stejnou verzí se neděje nic. Volba je
v nápovědě (O aplikaci) a ukládá se do ``settings.json``:

    update_check       False = nekontrolovat (výchozí zapnuto)
    update_checked_at  čas poslední kontroly (Unix s)
    update_dismissed   verze, jejíž upozornění uživatel skryl

Adresa webu je jen v ``UPDATE_BASE``. Worker (apps/site/worker/index.js) dnes vrací verzi
v ``GET /api/release/latest`` (RELEASE_VERSION); ``/api/config`` ji zatím nevrací — klient
se ptá nejdřív tam (``version`` / ``latest_version`` / ``download_url``, až je Worker doplní)
a jinak vezme manifest vydání.
"""

from __future__ import annotations

import json
import queue
import re
import threading
import time
import urllib.request
import webbrowser

import tkinter as tk
from tkinter import ttk

from . import __version__, theme
from .i18n import _
from .widgets import link

UPDATE_BASE = "https://plcdesk.podlena-t.workers.dev"
CONFIG_URL = UPDATE_BASE + "/api/config"
RELEASE_URL = UPDATE_BASE + "/api/release/latest"
CHECK_EVERY_S = 24 * 3600
TIMEOUT_S = 6
VERSION_MAX = 32                         # delší „verze“ ze serveru = nesmysl (forenzní test L1)


def safe_site(site) -> str:
    """Adresa webu ze serveru jen jako https na hostu ``UPDATE_BASE`` — odkaz ``javascript:`` /
    ``file:`` / cizí host by otevřel prohlížeč nebo program (forenzní test L1); jinak ``UPDATE_BASE``."""
    from urllib.parse import urlsplit
    try:
        u = urlsplit(str(site or "").strip())
        ok = (u.scheme == "https" and u.hostname == urlsplit(UPDATE_BASE).hostname
              and not u.username and not u.password and u.port in (None, 443))
    except ValueError:                     # neplatný port / adresa
        return UPDATE_BASE
    return f"https://{u.hostname}" if ok else UPDATE_BASE


def parse_version(v) -> tuple[int, ...]:
    """„0.10.2“ → (0, 10, 2); přípona (-beta) a neplatné části se ignorují."""
    text = str(v or "")
    if len(text) > VERSION_MAX:
        return ()
    m = re.match(r"\s*v?(\d{1,9}(?:\.\d{1,9})*)", text)
    return tuple(int(x) for x in m.group(1).split(".")) if m else ()


def is_newer(remote, local: str = __version__) -> bool:
    r, l = parse_version(remote), parse_version(local)
    if not r or not any(r):
        return False                       # „0.0.0“ = Worker bez nastavené verze
    n = max(len(r), len(l))
    return r + (0,) * (n - len(r)) > l + (0,) * (n - len(l))


def download_page(lang: str, site: str = UPDATE_BASE) -> str:
    """Stránka ke stažení v jazyce okna (web má cs / en / de; ostatní anglicky)."""
    site = (site or UPDATE_BASE).rstrip("/")
    return site + "/stazeni/" if lang == "cs" else f"{site}/{lang if lang in ('en', 'de') else 'en'}/stazeni/"


def fetch_json(url: str, timeout: float = TIMEOUT_S):
    req = urllib.request.Request(url, headers={"Accept": "application/json",
                                               "User-Agent": f"PLCdesk/{__version__}"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:      # noqa: S310 (pevná https adresa)
        return json.loads(resp.read().decode("utf-8"))


def latest_release(fetch=fetch_json) -> dict | None:
    """Poslední verze z webu: ``{"version", "site"}``; bez sítě / bez verze None."""
    site, version = UPDATE_BASE, None
    try:
        cfg = fetch(CONFIG_URL)
        if isinstance(cfg, dict):
            site = safe_site(cfg.get("site"))
            version = cfg.get("version") or cfg.get("latest_version")
    except Exception:                      # noqa: BLE001 — bez sítě tiše nic
        cfg = None
    if not version:
        try:
            rel = fetch(RELEASE_URL)
            version = rel.get("version") if isinstance(rel, dict) else None
        except Exception:                  # noqa: BLE001
            return None
    if not isinstance(version, (str, int, float)) or not any(parse_version(version)):
        return None                        # „0.0.0“ = verze nenastavena; obří / nesmyslná = nic
    return {"version": str(version), "site": safe_site(site)}


def due(settings: dict, now: float | None = None) -> bool:
    """Má se při startu kontrolovat? (zapnuto a od poslední kontroly aspoň den)"""
    if settings.get("update_check") is False:
        return False
    last = settings.get("update_checked_at")
    now = time.time() if now is None else now
    return not isinstance(last, (int, float)) or now - last >= CHECK_EVERY_S or last > now


def start_check(app, *, force: bool = False, fetch=fetch_json, on_done=None) -> bool:
    """Spustí kontrolu ve vlákně (UI neblokuje); výsledek převezme hlavní vlákno.

    Vrací, zda se kontrola spustila. ``on_done(novější | None, odpověď | None)`` se zavolá
    v hlavním vlákně (novější = informace o vydání, jen když je verze vyšší než tahle)."""
    if not force and not due(app.settings):
        return False
    app.settings["update_checked_at"] = time.time()       # i bez sítě: další pokus až zítra
    app.save_settings()
    out: queue.Queue = queue.Queue()

    def work() -> None:
        try:
            out.put(latest_release(fetch))
        except Exception:                  # noqa: BLE001 — chyba vlákna = jako bez sítě
            out.put(None)
    threading.Thread(target=work, daemon=True).start()

    def poll(tries: int = 0) -> None:
        try:
            info = out.get_nowait()
        except queue.Empty:
            if tries < 4 * (TIMEOUT_S * 2 + 4):            # vlákno má čas na oba dotazy
                app.root.after(250, poll, tries + 1)
            return
        newer = bool(info) and is_newer(info["version"])
        if newer and (force or app.settings.get("update_dismissed") != info["version"]):
            show_notice(app, info)
        if on_done:
            on_done(info if newer else None, info)

    app.root.after(250, poll)
    return True


def show_notice(app, info: dict) -> None:
    """Upozornění v patičce okna: nová verze + odkaz ke stažení + skrýt."""
    foot = app._status.master                           # patička hlavního okna (app.py)
    old = getattr(app, "_update_bar", None)
    if old is not None and old.winfo_exists():
        old.destroy()
    bar = tk.Frame(foot, bg=theme.ACCENT_BG, padx=8, pady=2)
    tk.Label(bar, text="↑ " + _("K dispozici je PLCdesk {v} (máš {cur}).", v=info["version"], cur=__version__),
             bg=theme.ACCENT_BG, fg=theme.FG, font=theme.FONT_DIM).pack(side="left")
    url = download_page(app.lang, safe_site(info.get("site")))
    link(bar, _("Stáhnout"), lambda: webbrowser.open(url), bg=theme.ACCENT_BG,
         font=theme.FONT_DIM).pack(side="left", padx=(8, 0))

    def dismiss() -> None:
        app.settings["update_dismissed"] = info["version"]
        app.save_settings()
        app._update_info = None
        bar.destroy()

    link(bar, _("Skrýt"), dismiss, bg=theme.ACCENT_BG, font=theme.FONT_DIM).pack(side="left", padx=(8, 0))
    bar.pack(side="left", padx=(12, 0))
    bar.url = url
    app._update_bar = bar
    app._update_info = info               # po změně jazyka (nové okno) se upozornění ukáže znovu


def about_bar(app, parent) -> ttk.Frame:
    """Řádek „O aplikaci“ (nápověda): verze, volba kontroly aktualizací, kontrola hned."""
    row = ttk.Frame(parent)
    row.pack(fill="x", pady=(0, 8))
    ttk.Label(row, text=_("PLCdesk verze {v}", v=__version__), style="Section.TLabel").pack(side="left")
    var = tk.BooleanVar(value=app.settings.get("update_check") is not False)
    row._var = var                                       # Tk proměnná musí žít s widgetem

    def toggle() -> None:
        app.settings["update_check"] = bool(var.get())
        app.save_settings()

    ttk.Checkbutton(row, text=_("Kontrolovat aktualizace při spuštění (nejvýš jednou denně)"),
                    variable=var, command=toggle).pack(side="left", padx=(16, 0))
    msg = ttk.Label(row, text="", style="Dim.TLabel")

    def done(newer, info) -> None:
        if not msg.winfo_exists():
            return
        if newer:
            msg.configure(text=_("Nová verze {v} — odkaz ke stažení je v patičce okna.", v=newer["version"]))
        elif info:
            msg.configure(text=_("Máš nejnovější verzi."))
        else:
            msg.configure(text=_("Web PLCdesk není dostupný — zkus to později."))

    def check_now() -> None:
        msg.configure(text=_("Zjišťuji…"))
        start_check(app, force=True, on_done=done)

    ttk.Button(row, text=_("Zkontrolovat teď"), command=check_now).pack(side="left", padx=(12, 0))
    msg.pack(side="left", padx=(10, 0))
    row.check_now = check_now
    return row
