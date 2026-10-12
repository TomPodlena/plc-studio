"""Nápověda ke kroku a úvodní průvodce (desktop).

Obsah je jen v jádře (``packages/core/src/help.ts``) — most ho vrátí operací ``help`` (kapitoly,
průvodce, popisky UI, adresy na webu PLCdesk) a hledá přes ``searchHelp``. Tady se jen vykresluje:

* ``HelpPanel`` — nemodální okno vpravo vedle hlavního okna s kapitolou aktuálního kroku
  (tlačítko **?** v záhlaví kroku, klávesa F1; Esc zavře),
* ``insert_chapter`` — vykreslení kapitoly do ``tk.Text`` (sdílí panel i krok Nápověda),
* ``Tour`` — úvodní průvodce: okno s textem a zvýrazněné tlačítko kroku v liště
  (pamatuje se v ``settings.json`` pod klíčem ``tour``).
"""

from __future__ import annotations

import webbrowser

import tkinter as tk
from tkinter import ttk

from . import theme

_CACHE: dict[str, dict] = {}


def help_data(app) -> dict:
    """Nápověda z jádra v jazyce aplikace (cache podle jazyka)."""
    d = _CACHE.get(app.lang)
    if d is None:
        d = _CACHE[app.lang] = app.bridge.request("help", lang=app.lang)
    return d


def chapter(app, cid: str) -> dict | None:
    return next((c for c in help_data(app)["chapters"] if c["id"] == cid), None)


def chapter_for_step(app, step) -> str:
    ids = help_data(app)["stepIds"]
    return ids[step] if isinstance(step, int) and 0 <= step < len(ids) else "start"


def search(app, query: str) -> list[dict]:
    if not query.strip():
        return []
    return app.core("searchHelp", query, app.lang, "desktop") or []


# --- vykreslení do tk.Text ---------------------------------------------------------------

def setup_tags(txt: tk.Text) -> None:
    txt.tag_configure("h", foreground=theme.PRIMARY, font=theme.FONT_CARD, spacing1=14, spacing3=6)
    txt.tag_configure("h4", foreground=theme.DIM, font=theme.FONT_ACCENT, spacing1=10, spacing3=2)
    txt.tag_configure("p", lmargin1=4, lmargin2=4)
    txt.tag_configure("li", lmargin1=16, lmargin2=34)
    txt.tag_configure("dt", lmargin1=16, lmargin2=16, font=theme.FONT_ACCENT, spacing1=4)
    txt.tag_configure("dd", lmargin1=30, lmargin2=30)
    txt.tag_configure("b", font=theme.FONT_ACCENT)
    txt.tag_configure("dim", foreground=theme.DIM, font=theme.FONT_DIM)
    txt.tag_configure("chip", foreground=theme.DIM, background=theme.BTN, font=theme.FONT_DIM)
    txt.tag_configure("mark", background=theme.WARN_BG)
    # odkazy mezi kapitolami mají vlastní značku „hlink“ (značku „link“ mají odkazy na weby výrobců)
    txt.tag_configure("hlink", foreground=theme.ACCENT, underline=True)
    txt.tag_bind("hlink", "<Enter>", lambda _e: txt.configure(cursor="hand2"))
    txt.tag_bind("hlink", "<Leave>", lambda _e: txt.configure(cursor=""))


def insert_rich(txt: tk.Text, text: str, base: str, *, end: str = "\n") -> None:
    """Odstavec; úseky mezi ** ** tučně."""
    for i, part in enumerate(text.split("**")):
        if part:
            txt.insert("end", part, (base, "b") if i % 2 else (base,))
    if end:
        txt.insert("end", end, (base,))


def insert_link(txt: tk.Text, text: str, command, base: str = "p") -> None:
    tag = f"lnk{txt.index('end')}{len(text)}".replace(".", "_")
    txt.insert("end", text, (base, "hlink", tag))
    txt.tag_bind(tag, "<Button-1>", lambda _e: command())


def insert_chapter(app, txt: tk.Text, ch: dict, on_see, *, title: bool = True) -> None:
    """Kapitola: (nadpis), shrnutí, postup, tipy, chyby, související."""
    ui = help_data(app)["ui"]
    if title:
        num = f"{ch['step'] + 1} · " if isinstance(ch.get("step"), int) else ""
        txt.insert("end", num + ch["title"] + "\n", ("h",))
    insert_rich(txt, ch["summary"], "p")
    faq = ch["id"] == "faq"
    if ch["steps"]:
        txt.insert("end", ui["steps"] + "\n", ("h4",))
        numbered = ch["id"] != "zkratky"
        for i, x in enumerate(ch["steps"]):
            insert_rich(txt, (f"{i + 1}. " if numbered else "• ") + x["text"], "li", end="")
            _only(txt, x, ui)
    if ch["tips"]:
        txt.insert("end", ui["tips"] + "\n", ("h4",))
        for x in ch["tips"]:
            insert_rich(txt, "• " + x["text"], "li", end="")
            _only(txt, x, ui)
    if ch["issues"]:
        txt.insert("end", (ui["faq"] if faq else ui["issues"]) + "\n", ("h4",))
        for x in ch["issues"]:
            insert_rich(txt, x["problem"], "dt")
            insert_rich(txt, x["fix"], "dd")
    if ch["see"]:
        txt.insert("end", ui["see"] + ": ", ("p", "b"))
        for i, sid in enumerate(ch["see"]):
            c = chapter(app, sid)
            if c is None:
                continue
            if i:
                txt.insert("end", " · ", ("p",))
            insert_link(txt, c["title"], lambda s=sid: on_see(s))
        txt.insert("end", "\n", ("p",))


def _only(txt: tk.Text, x: dict, ui: dict) -> None:
    if x.get("only"):
        txt.insert("end", "  ", ("li",))
        txt.insert("end", " " + (ui["only_web"] if x["only"] == "web" else ui["only_desktop"]) + " ", ("li", "chip"))
    txt.insert("end", "\n", ("li",))


# --- panel ke kroku ----------------------------------------------------------------------------

class HelpPanel:
    """Nemodální okno s nápovědou ke kroku, umístěné vpravo vedle (nebo přes pravý okraj) hlavního okna."""

    current: "HelpPanel | None" = None

    @classmethod
    def toggle(cls, app, cid: str) -> "HelpPanel | None":
        p = cls.current
        if p is not None and p.alive() and p.cid == cid:
            p.close()
            return None
        return cls.open(app, cid)

    @classmethod
    def open(cls, app, cid: str) -> "HelpPanel":
        p = cls.current
        if p is None or not p.alive() or p.lang != app.lang:
            if p is not None:
                p.close()
            p = cls.current = cls(app)
        p.hist.clear()
        p.show(cid)
        p.win.deiconify()
        p.win.lift()
        p.txt.focus_set()
        return p

    @classmethod
    def close_current(cls) -> None:
        if cls.current is not None:
            cls.current.close()

    def __init__(self, app):
        self.app = app
        self.lang = app.lang
        self.cid: str | None = None
        self.hist: list[str] = []
        ui = help_data(app)["ui"]
        win = self.win = tk.Toplevel(app.root)
        theme.setup_window(win, ui["panelTitle"] + " — PLCdesk", topmost=bool(app.settings.get("topmost")))
        win.transient(app.root)
        s = getattr(app, "ui_scale", 1.0)
        w, h = int(440 * s), max(int(520 * s), app.root.winfo_height() - 40)
        rx, ry, rw = app.root.winfo_rootx(), app.root.winfo_rooty(), app.root.winfo_width()
        sw = app.root.winfo_screenwidth()
        x = rx + rw + 8 if rx + rw + 8 + w <= sw else max(0, rx + rw - w - 16)   # vedle okna, jinak přes jeho pravý okraj
        win.geometry(f"{w}x{h}+{x}+{max(0, ry)}")
        win.minsize(int(340 * s), int(360 * s))
        win.protocol("WM_DELETE_WINDOW", self.close)
        win.bind("<Escape>", lambda _e: self.close())
        win.bind("<F1>", lambda _e: (self.close(), "break")[1])
        frm = ttk.Frame(win, padding=12)
        frm.pack(fill="both", expand=True)
        head = ttk.Frame(frm)
        head.pack(fill="x")
        self.kicker = ttk.Label(head, text=ui["panelTitle"], style="Dim.TLabel")
        self.kicker.pack(side="left")
        ttk.Button(head, text="×", width=3, command=self.close).pack(side="right")
        self.title = ttk.Label(frm, text="", style="CardTitle.TLabel", justify="left", anchor="w")
        self.title.pack(fill="x", pady=(6, 4))
        self.title.bind("<Configure>", lambda e: self.title.configure(wraplength=max(200, e.width - 4)))
        foot = ttk.Frame(frm)
        foot.pack(side="bottom", fill="x", pady=(8, 0))
        self.foot = foot
        from .widgets import scrolled_text
        tf, self.txt = scrolled_text(frm, height=10, bg=theme.BG, spacing1=2, spacing3=3, wrap="word")
        tf.pack(fill="both", expand=True)
        setup_tags(self.txt)

    def alive(self) -> bool:
        try:
            return bool(self.win.winfo_exists())
        except tk.TclError:
            return False

    def show(self, cid: str) -> None:
        app = self.app
        ch = chapter(app, cid) or chapter(app, "start")
        self.cid = ch["id"]
        ui = help_data(app)["ui"]
        self.title.configure(text=ch["title"])
        txt = self.txt
        txt.configure(state="normal")
        txt.delete("1.0", "end")
        insert_chapter(app, txt, ch, self._see, title=False)
        txt.configure(state="disabled")
        txt.yview_moveto(0)
        for w in self.foot.winfo_children():
            w.destroy()
        self.buttons: dict[str, ttk.Button] = {}

        def btn(key: str, text: str, cmd) -> None:
            b = ttk.Button(self.foot, text=text, command=cmd)
            b.pack(side="left", padx=(0, 6), pady=(0, 4))
            self.buttons[key] = b
        if self.hist:
            btn("back", "← " + ui["tourPrev"], self._back)
        if isinstance(ch.get("step"), int) and ch["step"] != app.step:
            btn("step", f"{ui['goStep']} {ch['step'] + 1} →", lambda s=ch["step"]: (self.close(), app.goto(s)))
        btn("full", ui["full"], self._full)
        btn("web", ui["web"] + " ↗", lambda: webbrowser.open(help_data(app)["site"].get(self.cid) or help_data(app)["site"][""]))

    def _see(self, cid: str) -> None:
        if self.cid:
            self.hist.append(self.cid)
        self.show(cid)

    def _back(self) -> None:
        if self.hist:
            self.show(self.hist.pop())

    def _full(self) -> None:
        cid = self.cid
        self.close()
        self.app.ui["help_focus"] = cid
        self.app.goto("help")

    def close(self) -> None:
        if self.alive():
            self.win.destroy()
        if HelpPanel.current is self:
            HelpPanel.current = None
        try:
            self.app.root.focus_set()
        except tk.TclError:
            pass


def step_help_button(app, head, step) -> None:
    """Tlačítko ? do záhlaví karty kroku (``widgets.card``) → panel nápovědy k tomuto kroku."""
    ui = help_data(app)["ui"]
    b = ttk.Button(head, text="?", width=3, command=lambda: HelpPanel.open(app, chapter_for_step(app, step)))
    b.pack(side="right")
    b.help_step = step
    from .widgets import tooltip
    tooltip(b, ui["open"])
    app._step_help_btn = b


# --- úvodní průvodce ----------------------------------------------------------------------

class Tour:
    """Průvodce po zastaveních z jádra (``helpTour``): okno s textem, Zpět / Další / Přeskočit,
    zvýrazněné tlačítko cílového kroku v liště. Projekt nemění; výsledek do ``settings['tour']``."""

    current: "Tour | None" = None

    @classmethod
    def start(cls, app) -> "Tour":
        if cls.current is not None:
            cls.current.end(None)
        HelpPanel.close_current()
        cls.current = cls(app)
        return cls.current

    def __init__(self, app):
        self.app = app
        data = help_data(app)
        self.stops, self.ui = data["tour"], data["ui"]
        self.i = 0
        self._hi = None
        win = self.win = tk.Toplevel(app.root)
        tour_ch = chapter(app, "tour")
        theme.setup_window(win, (tour_ch["title"] if tour_ch else "PLCdesk") + " — PLCdesk",
                           topmost=bool(app.settings.get("topmost")))
        win.transient(app.root)
        win.resizable(False, False)
        win.protocol("WM_DELETE_WINDOW", lambda: self.end("skipped"))
        win.bind("<Escape>", lambda _e: self.end("skipped"))
        win.bind("<Right>", lambda _e: self.next())
        win.bind("<Left>", lambda _e: self.prev())
        s = getattr(app, "ui_scale", 1.0)
        frm = ttk.Frame(win, padding=16)
        frm.pack(fill="both", expand=True)
        self.prog = ttk.Label(frm, text="", style="Dim.TLabel")
        self.prog.pack(anchor="w")
        self.title = ttk.Label(frm, text="", style="CardTitle.TLabel")
        self.title.pack(anchor="w", pady=(4, 6))
        self.text = ttk.Label(frm, text="", justify="left", anchor="w", wraplength=int(380 * s))
        self.text.pack(fill="x")
        row = ttk.Frame(frm)
        row.pack(fill="x", pady=(14, 0))
        self.b_skip = ttk.Button(row, text=self.ui["tourSkip"], command=lambda: self.end("skipped"))
        self.b_skip.pack(side="left")
        self.b_next = ttk.Button(row, text="", style="Accent.TButton", command=self.next)
        self.b_next.pack(side="right")
        self.b_prev = ttk.Button(row, text="← " + self.ui["tourPrev"], command=self.prev)
        self.b_prev.pack(side="right", padx=(0, 6))
        self.draw()
        self.b_next.focus_set()

    def target(self):
        t = self.stops[self.i]["target"]
        app = self.app
        if t == "help":
            return getattr(app, "_help_btn", None)
        if t == "samples":
            t = 0
        btns = getattr(app, "_step_btns", [])
        return btns[t] if isinstance(t, int) and 0 <= t < len(btns) else None

    def _unhighlight(self) -> None:
        if self._hi is not None:
            w, style = self._hi
            try:
                w.configure(style=style)
            except tk.TclError:
                pass
            self._hi = None

    def rehighlight(self) -> None:
        """Lišta kroků se překreslila (styly z App._refresh_nav) — zvýraznit cíl znovu."""
        w = self.target()
        if w is None or not w.winfo_exists():
            return
        cur = str(w.cget("style"))
        if cur != "Tour.TButton":
            self._hi = (w, cur or "Step.TButton")
            w.configure(style="Tour.TButton")

    def draw(self) -> None:
        st = self.stops[self.i]
        n = len(self.stops)
        self.prog.configure(text=self.ui["tourOf"].replace("{n}", str(self.i + 1)).replace("{m}", str(n)))
        self.title.configure(text=st["title"])
        self.text.configure(text=st["text"])
        self.b_prev.state(["disabled"] if self.i == 0 else ["!disabled"])
        self.b_next.configure(text=self.ui["tourDone"] if self.i == n - 1 else self.ui["tourNext"] + " →")
        self._unhighlight()
        w = self.target()
        win = self.win
        win.update_idletasks()
        if w is not None and w.winfo_exists():
            self._hi = (w, str(w.cget("style")) or "Step.TButton")
            w.configure(style="Tour.TButton")
            x = min(max(0, w.winfo_rootx() - 20), w.winfo_screenwidth() - win.winfo_reqwidth() - 8)
            y = w.winfo_rooty() + w.winfo_height() + 10
        else:
            r = self.app.root
            x = r.winfo_rootx() + (r.winfo_width() - win.winfo_reqwidth()) // 2
            y = r.winfo_rooty() + 120
        win.geometry(f"+{max(0, x)}+{max(0, y)}")

    def next(self) -> None:
        if self.i < len(self.stops) - 1:
            self.i += 1
            self.draw()
        else:
            self.end("done")

    def prev(self) -> None:
        if self.i > 0:
            self.i -= 1
            self.draw()

    def end(self, how: str | None) -> None:
        self._unhighlight()
        if how:
            self.app.settings["tour"] = how
            self.app.save_settings()
        try:
            if self.win.winfo_exists():
                self.win.destroy()
        except tk.TclError:
            pass
        if Tour.current is self:
            Tour.current = None


def maybe_start_tour(app) -> None:
    """Průvodce při prvním spuštění (bez uloženého stavu a bez záznamu ``tour`` v settings.json)."""
    if app.settings.get("tour") or not getattr(app, "first_run", False) or app.quiet:
        return
    Tour.start(app)

