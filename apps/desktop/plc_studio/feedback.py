"""Zpětná vazba z desktopu do správy webu PLCdesk (``POST <web>/api/feedback``, správa ``#/feedback``).

- okno Zpětná vazba: typ (chyba / námět / dotaz), text (max. 5000 znaků), e-mail pro odpověď (předvyplněný
  z licence, dá se smazat — bez e-mailu anonymně), zaškrtávátko „Přiložit aktuální projekt“ (výchozí NE,
  limit 512 kB), náhled toho, co se odešle (kontext), Odeslat / Zrušit, výsledek,
- kontext: verze aplikace, klient desktop, jazyk, krok, systém / Python / Tk stručně, tarif licence —
  NIKDY licenční klíč ani otisk počítače,
- síť (HTTPS, urllib) jen ve vlákně, výsledek převezme hlavní vlákno přes ``after`` (okno nikdy nečeká);
  bez sítě hláška + Kopírovat text / Otevřít e-mail (mailto na kontaktní adresu webu s předvyplněným textem),
- rozepsaný text se neztratí: koncept ``feedback_draft.json`` ve složce stavu (typ, text, e-mail) se zapisuje
  při každé změně a smaže se až po úspěšném odeslání; zaškrtnutí projektu se neukládá (pokaždé výchozí NE).

Adresu API jde pro lokální test přepnout proměnnou ``PLCDESK_FEEDBACK_SITE`` — jen na localhost.
Volání: ``FeedbackDialog.open(app)`` (``App.open_feedback``; krok Nápověda může volat totéž).
"""

from __future__ import annotations

import json
import os
import platform
import queue
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

import tkinter as tk
from tkinter import ttk

from . import __version__, theme
from .i18n import N_, _
from .license import API_BASE

DRAFT_FILE = "feedback_draft.json"
FEEDBACK_MAIL = "podlena.t@gmail.com"          # kontakt webu (apps/site/content/site.json → email)
TEXT_MAX = 5000
PROJECT_MAX = 512 * 1024
TIMEOUT_S = 15
KINDS = ("bug", "idea", "question")
KIND_LABEL = {"bug": N_("Chyba"), "idea": N_("Námět"), "question": N_("Dotaz")}


def site() -> str:
    """Web PLCdesk; ``PLCDESK_FEEDBACK_SITE`` platí jen pro localhost (test proti lokálnímu serveru)."""
    o = os.environ.get("PLCDESK_FEEDBACK_SITE", "").strip()
    if o:
        u = urllib.parse.urlsplit(o)
        if u.scheme in ("http", "https") and u.hostname in ("localhost", "127.0.0.1"):
            return f"{u.scheme}://{u.netloc}"
    return API_BASE


def post_feedback(body: dict, base: str | None = None, timeout: float = TIMEOUT_S) -> tuple[int, dict]:
    """POST /api/feedback → ``(status, json)``; chyba sítě = výjimka (OSError)."""
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request((base or site()).rstrip("/") + "/api/feedback", data=data, method="POST",
                                 headers={"Accept": "application/json", "Content-Type": "application/json",
                                          "X-PLCdesk-Client": "desktop", "User-Agent": f"PLCdesk/{__version__}"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:      # noqa: S310 (pevná adresa webu)
            status, raw = resp.status, resp.read()
    except urllib.error.HTTPError as exc:                               # 4xx/5xx s tělem JSON
        status, raw = exc.code, exc.read()
    try:
        out = json.loads(raw.decode("utf-8") or "{}")
    except ValueError:
        out = {}
    return status, out if isinstance(out, dict) else {}


def env_brief() -> str:
    """Systém, Python a Tk stručně (bez názvu počítače a uživatele)."""
    try:
        tkv = str(tk.TkVersion)
    except Exception:  # noqa: BLE001
        tkv = "?"
    return f"{platform.system()} {platform.release()}, Python {sys.version_info.major}.{sys.version_info.minor}, Tk {tkv}"


def step_text(app) -> str:
    """Krok aplikace pro kontext („8: Dokumentace“ — český název kroku, nepřekládá se)."""
    from .app import STEPS
    s = getattr(app, "step", 0)
    if s == "help":
        return "help: Nápověda"
    return f"{s + 1}: {STEPS[s]}" if isinstance(s, int) and 0 <= s < len(STEPS) else str(s)


def context(app) -> dict:
    """Kontext, který se odešle (bez textu, e-mailu a projektu) — totéž ukazuje náhled."""
    lic = getattr(app, "lic", None)
    plan = (lic.state.get("plan") if lic is not None else None) or None
    return {"client": "desktop", "app_version": __version__, "lang": app.lang, "step": step_text(app),
            "env": env_brief(), "plan": plan}


def project_json(app) -> str:
    prj = getattr(app, "prj", None)
    if not prj:
        return ""
    try:
        return json.dumps(prj, ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError):
        return ""


def read_draft(app) -> dict:
    d = app._read_json(DRAFT_FILE, {})
    if not isinstance(d, dict):
        return {}
    out = {}
    if d.get("kind") in KINDS:
        out["kind"] = d["kind"]
    if isinstance(d.get("text"), str):
        out["text"] = d["text"][:TEXT_MAX]
    if isinstance(d.get("email"), str):
        out["email"] = d["email"][:254]
    return out


def clear_draft(app) -> None:
    try:
        (app.home / DRAFT_FILE).unlink(missing_ok=True)
    except OSError:
        pass


def plain_text(kind: str, text: str, ctx: dict) -> str:
    """Text pro schránku / e-mail (bez sítě): typ, text a kontext."""
    return (_("Zpětná vazba PLCdesk") + " — " + _(KIND_LABEL[kind]) + "\n\n" + text + "\n\n---\n"
            + _("Verze {v}, {client}, jazyk {lang}, krok {step}, {env}, tarif {plan}", v=ctx["app_version"],
                client=ctx["client"], lang=ctx["lang"], step=ctx["step"] or "—", env=ctx["env"],
                plan=ctx["plan"] or "—"))


def mailto_url(kind: str, text: str, ctx: dict) -> str:
    body = plain_text(kind, text, ctx)
    if len(body) > 1800:                      # délku adresy omezují klienti pošty
        body = body[:1800] + "…"
    return ("mailto:" + FEEDBACK_MAIL + "?subject=" + urllib.parse.quote(_("Zpětná vazba PLCdesk"))
            + "&body=" + urllib.parse.quote(body))


def field_message(field: str | None, status: int) -> str:
    if status == 429:
        return _("Příliš mnoho zpráv za hodinu. Zkus to prosím později, nebo použij e-mail.")
    if field == "text":
        return _("Napiš text zpětné vazby (nejvýš 5000 znaků).")
    if field == "email":
        return _("E-mail pro odpověď není platný — oprav ho, nebo pole nech prázdné.")
    if field == "kind":
        return _("Vyber typ zpětné vazby.")
    if field == "project":
        return _("Projekt je větší než 512 kB — odešli zprávu bez něj, nebo ho pošli e-mailem.")
    return _("Odeslání se nezdařilo (HTTP {status}).", status=status)


class FeedbackDialog:
    """Okno Zpětná vazba (jedno na aplikaci)."""

    current: "FeedbackDialog | None" = None

    @classmethod
    def open(cls, app, *, post=None) -> "FeedbackDialog":
        if cls.current is not None and cls.current.win.winfo_exists():
            cls.current.win.lift()
            cls.current.text.focus_set()
            return cls.current
        cls.current = cls(app, post=post)
        return cls.current

    def __init__(self, app, *, post=None):
        from .widgets import scrolled_text, wrap_label
        self.app = app
        self.post = post or post_feedback               # testy podvrhnou síť
        self.sending = False
        self.result: tuple[str, str] | None = None      # ("ok" | "err" | "offline", zpráva) — pro testy
        win = self.win = tk.Toplevel(app.root)
        theme.setup_window(win, _("Zpětná vazba"), topmost=bool(app.settings.get("topmost")))
        win.transient(app.root)
        win.geometry("680x800")
        win.minsize(580, 640)
        win.protocol("WM_DELETE_WINDOW", self.close)
        win.bind("<Escape>", lambda _e: self.close())
        frm = ttk.Frame(win, padding=16)
        frm.pack(fill="both", expand=True)

        draft = read_draft(app)
        lic_email = (getattr(app, "lic", None).state.get("email") if getattr(app, "lic", None) else "") or ""
        self.pj = project_json(app)
        self.psize = len(self.pj.encode("utf-8")) if self.pj else 0
        too_big = self.psize > PROJECT_MAX

        # tlačítka dole (pack před obsahem, ať je obsah nevytlačí)
        foot = ttk.Frame(frm)
        foot.pack(side="bottom", fill="x", pady=(10, 0))
        ttk.Label(foot, text=_("Odesílá se na {site}", site=site().split("://", 1)[-1]), style="Dim.TLabel"
                  ).pack(side="left")
        self.send_btn = ttk.Button(foot, text=_("Odeslat"), style="Accent.TButton", command=self.send)
        self.send_btn.pack(side="right")
        self.cancel_btn = ttk.Button(foot, text=_("Zrušit"), command=self.close)
        self.cancel_btn.pack(side="right", padx=(0, 6))

        wrap_label(frm, _("Napiš nám, co nefunguje, co ti chybí, nebo se zeptej. Zpráva jde přímo autorům PLCdesk."))
        row = ttk.Frame(frm)
        row.pack(fill="x", pady=(8, 4))
        ttk.Label(row, text=_("Typ"), style="Section.TLabel").pack(side="left", padx=(0, 12))
        self.var_kind = tk.StringVar(value=draft.get("kind", "bug"))
        st = ttk.Style(win)                              # přepínač typu na bílém pozadí okna (jako TCheckbutton)
        st.configure("Fb.TRadiobutton", background=theme.BG, foreground=theme.FG)
        st.map("Fb.TRadiobutton", background=[("active", theme.BG)])
        for k in KINDS:
            ttk.Radiobutton(row, text=_(KIND_LABEL[k]), value=k, variable=self.var_kind,
                            command=self.changed, style="Fb.TRadiobutton").pack(side="left", padx=(0, 12))

        ttk.Label(frm, text=_("Text"), style="Section.TLabel").pack(anchor="w", pady=(6, 2))
        tfrm, self.text = scrolled_text(frm, height=6)
        tfrm.pack(fill="both", expand=True)
        self.text.insert("1.0", draft.get("text", ""))
        self.text.edit_modified(False)
        self.text.bind("<<Modified>>", self._on_modified)
        self.count = ttk.Label(frm, text="", style="Dim.TLabel")
        self.count.pack(anchor="e")

        ttk.Label(frm, text=_("E-mail pro odpověď (nepovinné)"), style="Section.TLabel").pack(anchor="w", pady=(6, 2))
        erow = ttk.Frame(frm)
        erow.pack(fill="x")
        self.var_email = tk.StringVar(value=draft["email"] if "email" in draft else lic_email)
        self.email = ttk.Entry(erow, textvariable=self.var_email)
        self.email.pack(side="left", fill="x", expand=True)
        ttk.Button(erow, text=_("Smazat e-mail"), command=self.clear_email).pack(side="left", padx=(6, 0))
        self.email.bind("<KeyRelease>", lambda _e: self.changed())
        wrap_label(frm, _("Bez e-mailu se zpráva odešle anonymně a nemůžeme odpovědět."))

        self.var_attach = tk.BooleanVar(value=False)
        self.attach = ttk.Checkbutton(frm, text=_("Přiložit aktuální projekt (může obsahovat údaje zákazníka)"),
                                      variable=self.var_attach, command=self.changed)
        self.attach.pack(anchor="w", pady=(10, 0))
        prj = getattr(app, "prj", None) or {}
        if not self.pj:
            hint = _("Žádný projekt není otevřený.")
        elif too_big:
            hint = _("Projekt má {k} kB — víc než limit 512 kB, přiložit ho nejde.", k=self._kb(self.psize))
        else:
            hint = _("Projekt „{name}“, {k} kB. Přikládej ho jen tehdy, když to smíš — uvidí ho jen provozovatel PLCdesk.",
                     name=(prj.get("meta") or {}).get("name") or _("(bez názvu)"), k=self._kb(self.psize))
        if not self.pj or too_big:
            self.attach.state(["disabled"])
        wrap_label(frm, hint)

        ttk.Label(frm, text=_("Co se odešle"), style="Section.TLabel").pack(anchor="w", pady=(10, 2))
        pfrm, self.preview = scrolled_text(frm, mono=True, readonly=True, height=6)
        pfrm.pack(fill="x")
        self.out = ttk.Label(frm, text="", style="Dim.TLabel")
        self.out.pack(fill="x", pady=(8, 0))
        self.out.bind("<Configure>", lambda e: self.out.configure(wraplength=max(300, e.width)))
        self.offline_row = ttk.Frame(frm)
        self.changed(save=False)
        self.text.focus_set()

    # --- stav ---------------------------------------------------------------------------

    @staticmethod
    def _kb(n: int) -> int:
        return max(1, round(n / 1024))

    def body_text(self) -> str:
        return self.text.get("1.0", "end-1c")

    def _on_modified(self, _e=None) -> None:
        if not self.text.edit_modified():
            return
        t = self.body_text()
        if len(t) > TEXT_MAX:                        # limit délky jako maxlength ve webu
            self.text.delete(f"1.0+{TEXT_MAX}c", "end-1c")
        self.text.edit_modified(False)
        self.changed()

    def save_draft(self) -> None:
        self.app._write_json(DRAFT_FILE, {"kind": self.var_kind.get(), "text": self.body_text(),
                                          "email": self.var_email.get()})

    def changed(self, *, save: bool = True) -> None:
        if save:
            self.save_draft()
        ctx = context(self.app)
        show = {"kind": self.var_kind.get(), "text": _("({n} znaků)", n=len(self.body_text().strip())),
                "email": self.var_email.get().strip() or _("(anonymně)"), **ctx,
                "project": _("ano, {k} kB", k=self._kb(self.psize)) if self.var_attach.get() else _("ne")}
        from .widgets import set_text
        set_text(self.preview, json.dumps(show, ensure_ascii=False, indent=2))
        self.count.configure(text=_("{n} / {max} znaků", n=len(self.body_text()), max=TEXT_MAX))

    def clear_email(self) -> None:
        self.var_email.set("")
        self.changed()
        self.email.focus_set()

    def close(self) -> None:
        if self.win.winfo_exists():
            self.save_draft()                       # rozepsaný text zůstane do příštího otevření
            self.win.destroy()
        if FeedbackDialog.current is self:
            FeedbackDialog.current = None

    def _say(self, kind: str, text: str) -> None:
        self.result = (kind, text)
        style = {"ok": "TLabel", "err": "Err.TLabel", "offline": "Err.TLabel"}.get(kind, "Dim.TLabel")
        self.out.configure(text=text, style=style)

    # --- odeslání -----------------------------------------------------------------------

    def build_body(self) -> dict:
        body = {"kind": self.var_kind.get(), "text": self.body_text().strip(), **context(self.app)}
        email = self.var_email.get().strip()
        if email:
            body["email"] = email
        if self.var_attach.get() and self.pj and self.psize <= PROJECT_MAX:
            body["attach_project"] = True
            body["project"] = json.loads(self.pj)
        return body

    def send(self) -> None:
        if self.sending:
            return
        body = self.build_body()
        if not body["text"]:
            self._say("err", field_message("text", 400))
            self.text.focus_set()
            return
        self.sending = True
        self.send_btn.state(["disabled"])
        self.offline_row.pack_forget()
        self._say("busy", _("Odesílám…"))
        post = self.post
        out: queue.Queue = queue.Queue()

        def work() -> None:
            try:
                out.put(post(body))
            except Exception as exc:                 # noqa: BLE001 — chyba sítě = výsledek
                out.put(exc)
        threading.Thread(target=work, daemon=True).start()

        def poll() -> None:
            try:
                res = out.get_nowait()
            except queue.Empty:
                try:
                    self.win.after(100, poll)
                except tk.TclError:
                    pass
                return
            self.done(res, body)
        self.win.after(100, poll)

    def done(self, res, body: dict) -> None:
        self.sending = False
        if not self.win.winfo_exists():
            return
        self.send_btn.state(["!disabled"])
        if isinstance(res, Exception):
            self.offline(body)
            return
        status, data = res
        if 200 <= status < 300 and data.get("ok"):
            clear_draft(self.app)
            self.text.delete("1.0", "end")
            self.text.edit_modified(False)
            self.var_attach.set(False)
            self.changed(save=False)
            self._say("ok", "✓ " + _("Děkujeme, zpětná vazba je odeslaná (číslo {ref}).", ref=data.get("ref") or "—"))
            self.send_btn.pack_forget()
            self.cancel_btn.configure(text=_("Zavřít"))
            return
        if status >= 500 and not data.get("field"):
            self.offline(body)
            return
        self._say("err", field_message(data.get("field"), status))

    def offline(self, body: dict) -> None:
        """Bez sítě: hláška + Kopírovat text / Otevřít e-mail; koncept zůstává uložený."""
        self._say("offline", _("Server PLCdesk se nepodařilo zastihnout (bez internetu nebo blokováno). Text můžeš "
                               "zkopírovat, nebo ho poslat e-mailem — rozepsaná zpráva zůstává uložená."))
        ctx = {k: body.get(k) for k in ("client", "app_version", "lang", "step", "env", "plan")}
        text = plain_text(body["kind"], body["text"], ctx)
        for w in self.offline_row.winfo_children():
            w.destroy()

        def copy() -> None:
            try:
                self.win.clipboard_clear()
                self.win.clipboard_append(text)
                copy_btn.configure(text="✓ " + _("Zkopírováno"))
            except tk.TclError:
                pass
        copy_btn = ttk.Button(self.offline_row, text=_("Kopírovat text"), command=copy)
        copy_btn.pack(side="left")
        ttk.Button(self.offline_row, text=_("Otevřít e-mail"),
                   command=lambda: webbrowser.open(mailto_url(body["kind"], body["text"], ctx))
                   ).pack(side="left", padx=(6, 0))
        self.offline_row.pack(anchor="w", pady=(6, 0), after=self.out)
