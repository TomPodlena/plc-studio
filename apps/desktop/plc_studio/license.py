"""Licence v desktopu (tarif Free / Pro / Firma) — úložiště, síť a UI; logika je v jádře.

Ověření podpisu (Ed25519, zabudovaný veřejný klíč), stav licence s tolerancí 30 dní, tarify a brána
projektu (limit I/O, DXF, patička, firemní knihovna) počítá jádro (``packages/core/src/license.ts``)
přes most (operace ``license.verify`` / ``license.state`` / ``license.file``). Tady je jen:

- ``license.json`` ve složce stavu (``PLCSTUDIO_HOME``, jinak ``%APPDATA%\\PLCStudio``):
  ``text`` (podepsaný licenční soubor), ``key``, ``remote`` (poslední odpověď kontroly), ``checked_at``,
  ``io_limit`` (``/api/config`` free_io_limit),
- otisk počítače: SHA-256 z MachineGuid Windows (jinak z názvu počítače a MAC) se solí aplikace —
  stabilní, nevratný, bez osobních údajů; serveru se posílá jen otisk a popis „Windows 11“,
- síť (HTTPS, urllib) jen při vložení klíče a na pozadí nejvýš jednou denně; vždy ve vlákně, výsledek
  převezme hlavní vlákno přes ``after`` — okno nikdy nečeká; chyba sítě nic nemění (offline běží dál),
- brány ukládání (``filter_file`` volá ``widgets.save_file`` / ``save_many`` a HMI), pás nad kroky
  Generovat / Dokumentace / Kusovník a okno Licence.

Odemčení prvního projektu nad limit: server ho bere jen s ověřením Turnstile (``POST /api/unlock``),
proto aplikace otevře stránku Kontakt webu a text žádosti s ID projektu dá do schránky; odemčení
přijde jako licenční klíč (tarif „free-unlock“) e-mailem.
"""

from __future__ import annotations

import hashlib
import json
import os
import platform
import queue
import threading
import time
import urllib.error
import urllib.request
import uuid
import webbrowser

import tkinter as tk
from tkinter import messagebox, ttk

from . import __version__, theme
from .i18n import _

API_BASE = "https://plcdesk.podlena-t.workers.dev"
CHECK_EVERY_S = 24 * 3600
TIMEOUT_S = 8
FREE_IO_LIMIT = 64
FILE_NAME = "license.json"
LANG_SITE = {"cs": "", "de": "de/"}          # web má cs / en / de, ostatní anglicky


# --------------------------------------------------------------------------- otisk počítače

def machine_id() -> str:
    """Identifikátor instalace Windows (MachineGuid), jinak název počítače + MAC."""
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Cryptography", 0,
                            winreg.KEY_READ | getattr(winreg, "KEY_WOW64_64KEY", 0)) as k:
            v, _t = winreg.QueryValueEx(k, "MachineGuid")
            if v:
                return "guid:" + str(v)
    except (OSError, ImportError):
        pass
    return "host:" + platform.node() + ":" + format(uuid.getnode(), "x")


def device_hash() -> str:
    """Otisk počítače pro aktivaci — SHA-256 se solí aplikace (z otisku nejde nic zjistit)."""
    return hashlib.sha256(("plcdesk-device|" + machine_id()).encode("utf-8")).hexdigest()


def device_label() -> str:
    return f"{platform.system()} {platform.release()}".strip() or "PC"


def site_url(page: str, lang: str, site: str = API_BASE) -> str:
    """Stránka webu v jazyce okna (``page`` = cenik | kontakt | stazeni)."""
    pre = LANG_SITE.get(lang, "en/")
    return f"{(site or API_BASE).rstrip('/')}/{pre}{page}/"


# --------------------------------------------------------------------------- síť

def http_json(path: str, body: dict | None = None, timeout: float = TIMEOUT_S) -> tuple[int, dict]:
    """GET / POST na API PLCdesk → ``(status, json)``; chyba sítě = výjimka (OSError)."""
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(API_BASE + path, data=data, method="GET" if body is None else "POST",
                                 headers={"Accept": "application/json", "Content-Type": "application/json",
                                          "User-Agent": f"PLCdesk/{__version__}"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:      # noqa: S310 (pevná https adresa)
            status, raw = resp.status, resp.read()
    except urllib.error.HTTPError as exc:                               # 4xx/5xx s tělem JSON
        status, raw = exc.code, exc.read()
    try:
        out = json.loads(raw.decode("utf-8") or "{}")
    except ValueError:
        out = {}
    return status, out if isinstance(out, dict) else {}


def is_license_file(text: str) -> bool:
    t = (text or "").strip()
    parts = t.split(".")
    ok = all(c.isalnum() or c in "-_" for c in t.replace(".", ""))
    return len(parts) == 2 and len(parts[0]) >= 20 and len(parts[1]) >= 40 and ok


def is_license_key(text: str) -> bool:
    import re
    return bool(re.fullmatch(r"PLCD-[A-Z2-9]{4}(-[A-Z2-9]{4}){3}", (text or "").strip().upper()))


# --------------------------------------------------------------------------- správce licence

class License:
    """Licence aplikace: stav (z jádra), brána projektu, aktivace a kontrola na pozadí."""

    def __init__(self, app, *, http=http_json):
        self.app = app
        self.http = http                       # testy podvrhnou síť
        self.store: dict = app._read_json(FILE_NAME, {}) or {}
        if not isinstance(self.store, dict):
            self.store = {}
        self.check: dict | None = None         # výsledek license.verify
        self.state: dict = {}
        self._gate_cache: tuple[str, dict] | None = None
        self.verify()

    # --- stav -------------------------------------------------------------------------

    def io_limit(self) -> int:
        v = self.store.get("io_limit")
        return v if isinstance(v, int) and v > 0 else FREE_IO_LIMIT

    def verify(self) -> None:
        """Ověří uložený licenční soubor (podpis v jádře) a přepočítá stav."""
        text = self.store.get("text")
        self.check = self.app.bridge.request("license.verify", text=text) if text else None
        self.recompute()

    def recompute(self) -> None:
        res = self.app.bridge.request("license.state", check=self.check, remote=self.store.get("remote"),
                                      ioLimit=self.io_limit())
        self.state = res["state"]
        self._gate_cache = None

    def save(self) -> None:
        self.app._write_json(FILE_NAME, self.store)

    def gate(self, prj: dict | None = None) -> dict | None:
        """Brána projektu (core projectGate) — co je pro projekt povolené."""
        prj = self.app.prj if prj is None else prj
        if not prj:
            return None
        key = json.dumps([prj.get("devices", []), prj.get("guid"), self.state.get("plan"),
                          self.state.get("state")], sort_keys=True, default=str)
        if self._gate_cache and self._gate_cache[0] == key:
            return self._gate_cache[1]
        res = self.app.bridge.request("license.state", check=self.check, remote=self.store.get("remote"),
                                      ioLimit=self.io_limit(), prj=prj)
        self._gate_cache = (key, res["gate"])
        return res["gate"]

    def gen_opts(self) -> dict:
        """Parametr ``lic`` operací ``gen`` / ``files`` (knihovna bloků jen ve Firmě)."""
        return {"library": bool(self.state.get("ent", {}).get("library"))}

    def filter_file(self, name: str, body) -> tuple[object | None, str]:
        """Soubor k uložení podle licence: ``(obsah, "")`` nebo ``(None, důvod)``.

        Text dostane ve Free patičku (dokumenty, README); bajty (xlsx) jen bránu."""
        g = self.gate()
        if not isinstance(body, str):
            return (None, g["reason"]) if g and g.get("over") else (body, "")
        r = self.app.bridge.request("license.file", name=name, body=body, gate=g)
        if r.get("blocked"):
            return None, r["blocked"]
        return r.get("body", body), ""

    def blocked(self, reason: str) -> None:
        """Uložení zamčené: vysvětlení a okno Licence."""
        self.app.set_status("🔒 " + reason, keep=True)
        LicenseDialog.open(self.app, reason=reason)

    # --- síť ----------------------------------------------------------------------------

    def _run(self, work, done) -> None:
        """``work()`` ve vlákně, ``done(výsledek | výjimka)`` v hlavním vlákně (okno nečeká)."""
        out: queue.Queue = queue.Queue()

        def target() -> None:
            try:
                out.put(work())
            except Exception as exc:                    # noqa: BLE001 — chyba sítě = výsledek
                out.put(exc)
        threading.Thread(target=target, daemon=True).start()

        def poll() -> None:
            try:
                res = out.get_nowait()
            except queue.Empty:
                try:
                    self.app.root.after(100, poll)
                except tk.TclError:
                    pass
                return
            done(res)
        self.app.root.after(100, poll)

    def due(self, now: float | None = None) -> bool:
        last = self.store.get("checked_at")
        now = time.time() if now is None else now
        return not isinstance(last, (int, float)) or now - last >= CHECK_EVERY_S or last > now

    def background_check(self, *, force: bool = False, on_done=None) -> bool:
        """Kontrola na pozadí (nejvýš 1× denně): limit Free, stav předplatného, obnovení souboru."""
        if not force and not self.due():
            return False
        self.store["checked_at"] = time.time()
        self.save()
        text = self.store.get("text") or ""
        claims = (self.check or {}).get("claims") or {}
        key, dev, http = claims.get("key") or self.store.get("key"), device_hash(), self.http

        def work() -> dict:
            res: dict = {}
            try:
                st, cfg = http("/api/config")
                if st == 200 and isinstance(cfg.get("free_io_limit"), int) and cfg["free_io_limit"] > 0:
                    res["io_limit"] = cfg["free_io_limit"]
            except (OSError, ValueError):
                pass
            if text and key:
                try:
                    st, chk = http("/api/license/check", {"key": key, "device_hash": dev})
                    if st == 200 and chk.get("status"):
                        res["remote"] = {"status": str(chk["status"]), "plan": chk.get("plan"),
                                         "valid_until": chk.get("valid_until")}
                        vu, exp = chk.get("valid_until") or "", claims.get("exp") or ""
                        # uvolněný počítač (správa) se sám znovu neaktivuje; soubor platí do exp
                        if chk["status"] == "active" and vu[:19] > exp[:19] and chk.get("device") != "revoked":
                            st, act = http("/api/license/activate", {"key": key, "device_hash": dev,
                                                                    "device_label": device_label(),
                                                                    "locale": self.app.lang})
                            if st == 200 and act.get("license"):
                                res["text"] = act["license"]
                except (OSError, ValueError):
                    pass
            return res

        def done(res) -> None:
            if isinstance(res, dict):
                before = (self.state.get("state"), self.state.get("plan"))
                if res.get("io_limit"):
                    self.store["io_limit"] = res["io_limit"]
                if res.get("remote"):
                    self.store["remote"] = res["remote"]
                if res.get("text"):
                    chk = self.app.bridge.request("license.verify", text=res["text"])
                    if chk.get("ok"):
                        self.store["text"] = res["text"]
                        self.check = chk
                self.save()
                self.recompute()
                self.app.update_license_badge()
                if before != (self.state.get("state"), self.state.get("plan")):
                    self.app.render()
            if on_done:
                on_done(res)

        self._run(work, done)
        return True

    def insert(self, text: str, on_done) -> None:
        """Vloží licenci: soubor se ověří hned (offline), klíč se aktivuje přes internet ve vlákně.
        ``on_done(ok, zpráva)`` v hlavním vlákně."""
        t = (text or "").strip()
        if is_license_file(t):
            chk = self.app.bridge.request("license.verify", text=t)
            if not chk.get("ok"):
                st = self.app.bridge.request("license.state", check=chk)["state"]
                on_done(False, st["message"])
                return
            self.store.update(text=t, key=(chk.get("claims") or {}).get("key"), remote=None)
            self.check = chk
            self.save()
            self.recompute()
            self._changed()
            on_done(True, self.state["message"])
            return
        if not is_license_key(t):
            on_done(False, _("Vlož licenční klíč (PLCD-XXXX-XXXX-XXXX-XXXX) nebo celý licenční soubor z e-mailu."))
            return
        key, http = t.upper(), self.http
        body = {"key": key, "device_hash": device_hash(), "device_label": device_label(), "locale": self.app.lang}

        def done(res) -> None:
            if isinstance(res, Exception):
                on_done(False, _("Server licencí se nepodařilo zastihnout. Bez internetu vlož místo "
                                 "klíče licenční soubor z e-mailu (dlouhý řádek s tečkou uprostřed)."))
                return
            st, data = res
            if st != 200 or not data.get("license"):
                on_done(False, str(data.get("error") or _("Aktivace se nezdařila (HTTP {status}).", status=st)))
                return
            chk = self.app.bridge.request("license.verify", text=data["license"])
            if not chk.get("ok"):
                on_done(False, self.app.bridge.request("license.state", check=chk)["state"]["message"])
                return
            self.store.update(text=data["license"], key=key, remote=None, checked_at=time.time())
            self.check = chk
            self.save()
            self.recompute()
            self._changed()
            on_done(True, self.state["message"])

        self._run(lambda: http("/api/license/activate", body), done)

    def remove(self) -> None:
        self.store = {"io_limit": self.store.get("io_limit")} if self.store.get("io_limit") else {}
        self.check = None
        self.save()
        self.recompute()
        self._changed()

    def _changed(self) -> None:
        self.app.update_license_badge()
        self.app.render()

    def unlock_text(self) -> str:
        prj = self.app.prj
        g = self.gate() or {}
        return _("Dobrý den, prosím o odemčení prvního projektu nad limit: {name}, {io} I/O, ID projektu {id}.",
                 name=prj["meta"].get("name") or _("(bez názvu)"), io=g.get("io", 0), id=prj.get("guid") or "?")


# --------------------------------------------------------------------------- UI

def badge_text(app) -> str:
    st = app.lic.state
    return _("Licence: {plan}", plan=st.get("planLabel", "Free")) + (
        " · " + _("tolerance") if st.get("state") == "grace" else "")


def banner(app, parent) -> tk.Frame | None:
    """Pás nad kroky s výstupy: nad limitem Free výrazně (s tlačítky), ve Free stručně."""
    g = app.lic.gate()
    if not g:
        return None
    if g.get("over"):
        bar = tk.Frame(parent, bg=theme.DANGER_BG, highlightthickness=1, highlightbackground=theme.ERR,
                       padx=10, pady=8)
        bar.pack(fill="x", pady=(0, 10))
        msg = tk.Label(bar, text=_("Ukládání výstupů je zamčené — projekt je nad limitem tarifu Free.") + " "
                       + g["reason"], bg=theme.DANGER_BG, fg=theme.FG, font=theme.FONT_UI,
                       justify="left", anchor="w")
        msg.pack(fill="x")
        msg.bind("<Configure>", lambda e: msg.configure(wraplength=max(300, e.width - 10)))
        row = tk.Frame(bar, bg=theme.DANGER_BG)
        row.pack(fill="x", pady=(6, 0))
        ttk.Button(row, text=_("Vložit licenci…"), style="Accent.TButton",
                   command=lambda: LicenseDialog.open(app)).pack(side="left")
        ttk.Button(row, text=_("Odemknout první projekt zdarma…"),
                   command=lambda: LicenseDialog.open(app, focus="unlock")).pack(side="left", padx=(6, 0))
        ttk.Button(row, text=_("Ceník"), command=lambda: webbrowser.open(site_url("cenik", app.lang))
                   ).pack(side="left", padx=(6, 0))
        bar.over = True
        return bar
    if g.get("plan") == "free":
        bar = tk.Frame(parent, bg=theme.FIELD, highlightthickness=1, highlightbackground=theme.BORDER,
                       padx=10, pady=5)
        bar.pack(fill="x", pady=(0, 10))
        tk.Label(bar, text=_("Tarif Free: projekt má {io} z {n} I/O. Dokumenty a README se uloží s patičkou "
                             "PLCdesk, DXF je v tarifu Pro.", io=g["io"], n=g.get("limit") or "∞"),
                 bg=theme.FIELD, fg=theme.FG, font=theme.FONT_DIM).pack(side="left")
        ttk.Button(bar, text=_("Licence…"), command=lambda: LicenseDialog.open(app)).pack(side="right")
        bar.over = False
        return bar
    return None


class LicenseDialog:
    """Okno Licence: stav, vložení klíče / souboru, odebrání, ceník, odemčení projektu."""

    current: "LicenseDialog | None" = None

    @classmethod
    def open(cls, app, *, reason: str = "", focus: str = "") -> "LicenseDialog":
        if cls.current is not None and cls.current.win.winfo_exists():
            cls.current.win.destroy()
        cls.current = cls(app, reason=reason, focus=focus)
        return cls.current

    def __init__(self, app, *, reason: str = "", focus: str = ""):
        self.app = app
        win = self.win = tk.Toplevel(app.root)
        theme.setup_window(win, _("Licence PLCdesk"), topmost=bool(app.settings.get("topmost")))
        win.transient(app.root)
        win.geometry(f"640x{600 if app.lic.state.get('ent', {}).get('ioLimit') else 470}")
        win.minsize(560, 420)
        win.protocol("WM_DELETE_WINDOW", self.close)
        win.bind("<Escape>", lambda _e: self.close())
        frm = ttk.Frame(win, padding=16)
        frm.pack(fill="both", expand=True)
        self.body = frm
        self.reason, self.focus = reason, focus
        self.var_in = tk.StringVar()
        self.render()

    def close(self) -> None:
        if self.win.winfo_exists():
            self.win.destroy()
        if LicenseDialog.current is self:
            LicenseDialog.current = None

    def render(self, out: tuple[str, str] | None = None) -> None:
        from .widgets import note_box, wrap_label
        app, st = self.app, self.app.lic.state
        for w in self.body.winfo_children():
            w.destroy()
        if self.reason:
            note_box(self.body, self.reason, warn=True, pady=(0, 10))
        ttk.Label(self.body, text=_("Tarif: {plan}", plan=st.get("planLabel", "Free")), style="Section.TLabel"
                  ).pack(anchor="w")
        self.msg = wrap_label(self.body, st.get("message", ""), style="TLabel")
        if st.get("key"):
            grid = ttk.Frame(self.body)
            grid.pack(anchor="w", pady=(6, 0))
            rows = [(_("Klíč"), st["key"]), (_("E-mail"), st.get("email") or ""),
                    (_("Počet počítačů"), str(st.get("seats", 1)))]
            if st.get("exp"):
                rows.append((_("Platí do"), st["exp"][:10]))
            for i, (k, v) in enumerate(rows):
                ttk.Label(grid, text=k, style="Dim.TLabel").grid(row=i, column=0, sticky="w", padx=(0, 14))
                ttk.Label(grid, text=v, font=theme.FONT_MONO).grid(row=i, column=1, sticky="w")

        ttk.Label(self.body, text=_("Vložit licenci"), style="Section.TLabel").pack(anchor="w", pady=(14, 0))
        wrap_label(self.body, _("Licenční klíč (PLCD-…) se aktivuje přes internet. Bez internetu vlož celý "
                                "licenční soubor z e-mailu — ověří se v aplikaci podpisem."))
        self.entry = ttk.Entry(self.body, textvariable=self.var_in, font=theme.FONT_MONO)
        self.entry.pack(fill="x", pady=(6, 0))
        row = ttk.Frame(self.body)
        row.pack(fill="x", pady=(8, 0))
        self.go = ttk.Button(row, text=_("Aktivovat"), style="Accent.TButton", command=self.activate)
        self.go.pack(side="left")
        if st.get("key") or app.lic.store.get("text"):
            ttk.Button(row, text=_("Odebrat licenci"), command=self.remove).pack(side="left", padx=(6, 0))
        ttk.Button(row, text=_("Ceník"), command=lambda: webbrowser.open(site_url("cenik", app.lang))
                   ).pack(side="left", padx=(6, 0))
        self.out = ttk.Label(self.body, text=out[1] if out else "",
                             style=("Err.TLabel" if out and out[0] == "err" else "Dim.TLabel"))
        self.out.pack(anchor="w", pady=(6, 0))
        self.out.bind("<Configure>", lambda e: self.out.configure(wraplength=max(300, e.width)))

        if st.get("ent", {}).get("ioLimit"):
            ttk.Label(self.body, text=_("Odemknout první projekt zdarma"), style="Section.TLabel"
                      ).pack(anchor="w", pady=(14, 0))
            wrap_label(self.body, _("Narazíš na limit u reálného stroje? První projekt nad limit odemkneme "
                                    "zdarma. Pošli nám žádost přes stránku Kontakt — text s ID projektu se "
                                    "zkopíruje do schránky; odemčení přijde jako licenční klíč e-mailem."))
            g = app.lic.gate() or {}
            wrap_label(self.body, _("Tento projekt: {io} I/O (limit Free {n}), ID {id}", io=g.get("io", 0),
                                    n=st["ent"]["ioLimit"], id=app.prj.get("guid") or "?"))
            self.unlock_btn = ttk.Button(self.body, text=_("Odemknout první projekt zdarma"), command=self.unlock)
            self.unlock_btn.pack(anchor="w", pady=(6, 0))
            self.unlock_out = wrap_label(self.body, "")
        ttk.Button(self.body, text=_("Zavřít"), command=self.close).pack(side="bottom", anchor="e")
        if self.focus != "unlock":
            self.entry.focus_set()

    def activate(self) -> None:
        self.go.state(["disabled"])
        self.out.configure(text=_("Ověřuji…"), style="Dim.TLabel")

        def done(ok: bool, msg: str) -> None:
            if not self.win.winfo_exists():
                return
            if ok:
                self.var_in.set("")
                self.reason = ""
                self.render(("ok", "✓ " + msg))
            else:
                self.go.state(["!disabled"])
                self.out.configure(text=msg, style="Err.TLabel")
        self.app.lic.insert(self.var_in.get(), done)

    def remove(self) -> None:
        if messagebox.askyesno(_("Odebrat licenci?"), _("Odebrat licenci z tohoto počítače? Aplikace pak poběží "
                                                         "v tarifu Free."), parent=self.win):
            self.app.lic.remove()
            self.render()

    def unlock(self) -> None:
        t = self.app.lic.unlock_text()
        try:
            self.win.clipboard_clear()
            self.win.clipboard_append(t)
        except tk.TclError:
            pass
        webbrowser.open(site_url("kontakt", self.app.lang))
        self.unlock_out.configure(text=_("Text žádosti je ve schránce: {text}", text=t))
