"""Průvodce „Import stávajícího zařízení“ — podklady → rozpoznáno → AI → revize.

Logika je v jádře a v AI vrstvě webu (volané přes most):

    import.extract   extractFiles + inferProject (přesné zpracování, nic se neodesílá)
    import.estimate  odhad tokenů a ceny AI části
    import.messages  zprávy jednoho dotazu (PDF / obrázky jako bloky)
    import.norm      odpověď AI → ImportProposal, sloučená s přesným návrhem

Tady je jen okno a volání API (``ai_client.call_full`` v pracovním vlákně; most se volá
jen z hlavního vlákna). Stav průvodce žije v ``app.ui["import"]``, takže volby přežijí
překreslení i zavření okna — mění se jen tehdy, když se změní podklady.
"""

from __future__ import annotations

import copy
import queue
import threading
from pathlib import Path

import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from . import ai_client, theme
from .bridge import BridgeError
from .i18n import N_, _, _n
from .widgets import Table, note_box, scrolled_text, set_text, wrap_label

PAGES = [N_("Podklady"), N_("Rozpoznáno"), N_("Analýza AI"), N_("Kontrola a převzetí")]
PASTE_NAME = "vlozeny_text.txt"      # vložený text = další soubor podkladů (cituje se jménem)

CONF_LABEL = {"sure": N_("jisté"), "guess": N_("odhad"), "missing": N_("chybí doklad")}
CONF_BG = {"sure": theme.OK_BG, "guess": theme.WARN_BG, "missing": theme.DANGER_BG}
CONF_FG = {"sure": theme.OK, "guess": theme.WARN, "missing": theme.ERR}

ERRORS = {
    "no_key": N_("Chybí API klíč — zadej ho v kroku AI návrh."),
    "bad_key": N_("API klíč byl odmítnut (401)."),
    "rate_limited": N_("Příliš mnoho dotazů — zkus to za chvíli."),
    "too_large": N_("Dotaz je pro API příliš velký (413) — rozděl podklady na menší soubory."),
    "truncated": N_("Odpověď se nevešla do limitu — rozděl podklady na menší celky nebo "
                    "vypni posílání programů."),
    "refusal": N_("Model odmítl dotaz zpracovat."),
    "bad_request": N_("Podklad má formát, který API nepřijme — převeď ho do PDF, PNG/JPEG "
                      "nebo textu."),
    "invalid_json": N_("Odpověď AI se nepodařilo přečíst — zkus to znovu."),
}

_FILETYPES = "*.xml *.l5x *.csv *.tsv *.txt *.st *.scl *.awl *.gvl *.TcGVL *.TcPOU *.json *.md"


def open_wizard(app) -> "ImportWizard":
    """Otevře průvodce (nebo vrátí už otevřený)."""
    wiz = getattr(app, "_import_wiz", None)
    if wiz is not None and wiz.win.winfo_exists():
        wiz.win.deiconify()
        wiz.win.lift()
        return wiz
    app._import_wiz = ImportWizard(app)
    return app._import_wiz


def new_state() -> dict:
    return {"page": 0, "files": [], "paste": "", "sig": None, "ex": None, "exact": None,
            "ai": None, "merged": None, "est": None, "est_key": None, "code": True,
            "model": "", "skip": set(), "busy": False, "token": 0, "part": 0, "parts": 0,
            "prev": None, "usage": None, "partial": None, "msg": ("", ""), "tab": 0, "sel": None}


def _size(n: int) -> str:
    if n >= 1024 * 1024:
        return f"{n / 1048576:.1f} MB"
    if n < 1024:
        return f"{n} B"
    return f"{n / 1024:.1f} kB"


def _num(n) -> str:
    return f"{int(n):,}".replace(",", " ")


def _usd(v: float) -> str:
    return f"{v:.2f}" if v >= 0.1 else f"{v:.3f}"


def _kind(f: dict) -> str:
    """Druh souboru podkladů pro uživatele."""
    if f.get("mime") == ai_client.PDF_TYPE:
        return _("PDF (zpracuje AI)")
    if f.get("mime") in ai_client.IMAGE_TYPES.values():
        return _("obrázek (zpracuje AI)")
    if "text" in f:
        return _("text / export PLC")
    return _("nepodporovaný formát")


def _src_short(src: list) -> str:
    """Zdroj do buňky tabulky: soubor:strana/řádek (+ počet dalších)."""
    if not src:
        return "—"
    s = src[0]
    out = s.get("file", "")
    if s.get("page"):
        out += ":" + _("s. {n}", n=s["page"])
    elif s.get("line"):
        out += ":" + str(s["line"])
    if len(src) > 1:
        out += f" (+{len(src) - 1})"
    return out


class ImportWizard:
    """Modální okno průvodce; ``S`` = stav v ``app.ui["import"]``."""

    def __init__(self, app):
        self.app = app
        S = app.ui.get("import")
        if not isinstance(S, dict):
            S = app.ui["import"] = new_state()
        self.S = S
        if not S["model"]:
            S["model"] = app.settings.get("ai_model") or ai_client.DEFAULT_MODEL
        self._price: dict = {}
        win = self.win = tk.Toplevel(app.root)
        theme.setup_window(win, _("Import stávajícího zařízení"),
                           topmost=bool(app.settings.get("topmost")))
        win.transient(app.root)
        app.root.update_idletasks()
        rw, rh = app.root.winfo_width(), app.root.winfo_height()
        w, h = min(1180, max(900, rw - 60)), min(820, max(600, rh - 40))
        x = app.root.winfo_rootx() + max(0, (rw - w) // 2)
        y = app.root.winfo_rooty() + max(0, (rh - h) // 3)
        win.geometry(f"{w}x{h}+{x}+{y}")
        win.minsize(860, 580)
        win.protocol("WM_DELETE_WINDOW", self.close)

        frm = ttk.Frame(win)
        frm.pack(fill="both", expand=True, padx=16, pady=12)
        head = ttk.Frame(frm)
        head.pack(fill="x")
        ttk.Label(head, text=_("Import stávajícího zařízení"), style="Header.TLabel"
                  ).pack(side="left")
        self._steps = ttk.Frame(head)
        self._steps.pack(side="right")
        ttk.Separator(frm, orient="horizontal").pack(fill="x", pady=(10, 8))
        self._foot = ttk.Frame(frm)
        self._foot.pack(side="bottom", fill="x")
        ttk.Separator(frm, orient="horizontal").pack(side="bottom", fill="x", pady=(8, 8))
        self.body = ttk.Frame(frm)
        self.body.pack(fill="both", expand=True)
        self.render()
        win.grab_set()

    # --- obecné ------------------------------------------------------------------------

    def close(self) -> None:
        S = self.S
        if S["busy"]:                        # rozběhnutý dotaz zahodit (výsledek se nepoužije)
            S["token"] += 1
            S["busy"] = False
            S["msg"] = ("err", _("Analýza zastavena zavřením okna."))
        try:
            self.win.grab_release()
        except tk.TclError:
            pass
        self.win.destroy()
        if getattr(self.app, "_import_wiz", None) is self:
            self.app._import_wiz = None

    def bridge(self, op: str, **kw):
        return self.app.bridge.request(op, **kw)

    def set_msg(self, kind: str, text: str) -> None:
        """Zpráva v patičce průvodce (``ok`` / ``err`` / ``""``)."""
        self.S["msg"] = (kind, text)
        if hasattr(self, "_msg") and self._msg.winfo_exists():
            self._msg.configure(text=text, style={"ok": "Ok.TLabel", "err": "Err.TLabel"}
                                .get(kind, "Dim.TLabel"))

    def proposal(self) -> dict | None:
        """Návrh k revizi: sloučený s AI, jinak přesný."""
        return self.S["merged"] or self.S["exact"]

    def missing(self) -> list[str]:
        """Co v podkladech chybí: návrh + body AI (``mergeProposals`` je přepočítá a ztratí)."""
        out = list((self.proposal() or {}).get("missing") or [])
        if self.S["merged"] and self.S["ai"]:
            out += [m for m in self.S["ai"].get("missing") or [] if m not in out]
        return out

    def goto(self, page: int) -> None:
        if self.S["busy"] or not 0 <= page < len(PAGES):
            return
        if page > 0 and self.S["ex"] is None:
            return
        self.S["page"] = page
        self.S["sel"] = None
        self.render()

    def render(self) -> None:
        if not self.win.winfo_exists():
            return
        S = self.S
        for w in self._steps.winfo_children():
            w.destroy()
        for i, name in enumerate(PAGES):
            ok = i == 0 or S["ex"] is not None
            b = ttk.Button(self._steps, text=f"{i + 1} · {_(name)}",
                           style="StepOn.TButton" if i == S["page"] else
                           "StepDone.TButton" if ok and i < S["page"] else "Step.TButton",
                           command=lambda i=i: self.goto(i))
            if not ok or S["busy"]:
                b.state(["disabled"])
            b.pack(side="left", padx=(3, 0))
        for w in (*self.body.winfo_children(), *self._foot.winfo_children()):
            w.destroy()
        [self._page_files, self._page_found, self._page_ai, self._page_review][S["page"]]()
        kind, text = S["msg"]
        self._msg = ttk.Label(self._foot, text=text, style={"ok": "Ok.TLabel", "err": "Err.TLabel"}
                              .get(kind, "Dim.TLabel"))
        self._msg.pack(side="left", fill="x", expand=True)
        self._msg.bind("<Configure>", lambda e: self._msg.configure(wraplength=max(200, e.width)))

    def _foot_btn(self, text: str, command, *, accent: bool = False, disabled: bool = False):
        b = ttk.Button(self._foot, text=text, command=command,
                       style="Accent.TButton" if accent else "TButton")
        b.pack(side="right", padx=(6, 0))
        if disabled:
            b.state(["disabled"])
        return b

    # --- 1. podklady ---------------------------------------------------------------------

    def add_paths(self, paths) -> None:
        """Přidá soubory z disku (stejné jméno z jiné složky dostane příponu)."""
        S = self.S
        for path in paths:
            p = Path(path)
            if any(f.get("path") == str(p) for f in S["files"]):
                continue
            try:
                f = ai_client.input_file(p)
            except OSError as exc:
                messagebox.showerror(_("Soubor nejde načíst"), f"{p}\n{exc}", parent=self.win)
                continue
            self.add_inputs([f], path=str(p))
        if paths:
            self.app.settings["last_dir"] = str(Path(paths[-1]).parent)

    def add_inputs(self, inputs: list[dict], path: str = "") -> None:
        """Přidá hotové vstupní soubory (``ai_client.input_file`` nebo text v paměti)."""
        names = {f["file"]["name"] for f in self.S["files"]} | {PASTE_NAME}
        for f in inputs:
            f = dict(f)
            name, k = f["name"], 2
            while name in names:
                stem, dot, ext = f["name"].rpartition(".")
                name = f"{stem} ({k}).{ext}" if dot else f"{f['name']} ({k})"
                k += 1
            f["name"] = name
            names.add(name)
            f.setdefault("size", len(f.get("text") or "") or len(f.get("data") or "") * 3 // 4)
            self.S["files"].append({"path": path, "file": f})
        if self.S["page"] == 0:
            self.render()

    def remove(self, index: int | None = None) -> None:
        if index is None:
            self.S["files"].clear()
        elif 0 <= index < len(self.S["files"]):
            del self.S["files"][index]
        self.render()

    def inputs(self) -> list[dict]:
        out = [f["file"] for f in self.S["files"]]
        if self.S["paste"].strip():
            out.append({"name": PASTE_NAME, "text": self.S["paste"],
                        "size": len(self.S["paste"].encode("utf-8"))})
        return out

    def _pick(self) -> None:
        paths = filedialog.askopenfilenames(
            parent=self.win, title=_("Podklady stávajícího zařízení"),
            initialdir=self.app.settings.get("last_dir") or None,
            filetypes=[(_("Všechny podklady"), _FILETYPES + " *.pdf *.png *.jpg *.jpeg *.webp *.gif"),
                       (_("Exporty a programy PLC"), _FILETYPES),
                       (_("Schémata a fotky (PDF, obrázky)"), "*.pdf *.png *.jpg *.jpeg *.webp *.gif"),
                       (_("Všechny soubory"), "*.*")])
        if paths:
            self.add_paths(list(paths))

    def _page_files(self) -> None:
        S, body = self.S, self.body
        wrap_label(body, _(
            "Přidej podklady stávajícího stroje: exporty a programy z PLC (TIA Portal, "
            "Studio 5000, CODESYS, GX Works…), I/O listy, elektroschémata v PDF, fotky štítků "
            "a rozvaděče, popis funkce. Exporty se zpracují přesně přímo v počítači; "
            "schémata, fotky a volný text může volitelně doplnit AI."), pady=(0, 8))
        row = ttk.Frame(body)
        row.pack(fill="x")
        ttk.Button(row, text=_("Přidat soubory…"), style="Accent.TButton", command=self._pick
                   ).pack(side="left")

        def remove_sel():
            iid = tbl.selected()
            if iid is not None:
                self.remove(int(iid))

        ttk.Button(row, text=_("Odebrat vybraný"), command=remove_sel).pack(side="left", padx=(6, 0))
        ttk.Button(row, text=_("Odebrat vše"), style="Danger.TButton",
                   command=lambda: self.remove(None)).pack(side="left", padx=(6, 0))
        ttk.Label(row, text=_("souborů: {n}", n=len(S["files"])), style="Dim.TLabel"
                  ).pack(side="left", padx=10)

        note_box(body, _(
            "Nejlépe poslouží exporty tabulek tagů a zdroje programů (SimaticML XML, SCL, "
            "L5X, CSV tagů, PLCopen XML, GVL/ST), I/O list Tag;Adresa;Zařízení;Třída;Komentář "
            "a elektroschéma. Bezpečnostní okruhy se nepřebírají — E-stop a kryty jen jako "
            "signály."), side="bottom")
        paste = ttk.Frame(body)
        paste.pack(side="bottom", fill="both", expand=True, pady=(10, 0))
        ttk.Label(paste, text=_("Vložený text (export ze schránky, I/O list nebo popis funkce stroje)"),
                  style="Section.TLabel").pack(anchor="w")
        t_frm, txt = scrolled_text(paste, mono=True, height=5)
        t_frm.pack(fill="both", expand=True, pady=(4, 0))
        txt.insert("1.0", S["paste"])
        self.paste_text = txt

        def on_paste(_e=None):
            S["paste"] = txt.get("1.0", "end-1c")

        txt.bind("<KeyRelease>", on_paste)
        txt.bind("<<Paste>>", lambda _e: txt.after_idle(on_paste), add="+")

        tbl = Table(body, [("name", _("Soubor"), 280, True), ("kind", _("Druh"), 180, False),
                           ("size", _("Velikost"), 90, False)], height=6)
        tbl.pack(fill="both", expand=True, pady=(8, 0))
        for i, f in enumerate(S["files"]):
            tbl.add(i, (f["file"]["name"], _kind(f["file"]), _size(f["file"].get("size") or 0)),
                    tags=() if "text" in f["file"] or f["file"].get("mime") else ("dup",))
        tbl.tv.bind("<Delete>", lambda _e: remove_sel())
        self.files_table = tbl

        self._foot_btn(_("Zavřít"), self.close)
        self._foot_btn(_("Rozpoznat") + " →", self.extract, accent=True)

    def extract(self) -> bool:
        """Přesné zpracování podkladů (jádro); nic se neodesílá."""
        S = self.S
        if hasattr(self, "paste_text") and self.paste_text.winfo_exists():
            S["paste"] = self.paste_text.get("1.0", "end-1c")
        inputs = self.inputs()
        if not inputs:
            self.set_msg("err", _("Nejdřív přidej soubory nebo vlož text."))
            return False
        sig = [(f["name"], f.get("size"), len(f.get("text") or f.get("data") or "")) for f in inputs]
        if sig != S["sig"] or S["ex"] is None:
            try:
                res = self.bridge("import.extract", files=inputs)
            except BridgeError as exc:
                self.set_msg("err", _("Jádro hlásí chybu: {exc}", exc=exc))
                return False
            S.update(sig=sig, ex=res["ex"], exact=res["proposal"], ai=None, merged=None,
                     est=None, est_key=None, skip=set(), tab=0)
            n = len(res["proposal"]["prj"]["devices"])
            # tvar podle čísla (z 1 souboru / ze 2 souborů…; angl. 1 device / 2 devices)
            S["msg"] = ("ok", _n(n, N_("Rozpoznáno: {n} zařízení|Rozpoznáno: {n} zařízení|"
                                       "Rozpoznáno: {n} zařízení")) + " "
                        + _n(len(inputs), N_("z {n} souboru.|ze {n} souborů.|z {n} souborů.")))
        S["page"] = 1
        self.render()
        return True

    # --- 2. rozpoznáno -------------------------------------------------------------------

    def _page_found(self) -> None:
        S, body, app = self.S, self.body, self.app
        ex, prj = S["ex"], S["exact"]["prj"]
        stats = ttk.Frame(body)
        stats.pack(fill="x")
        plat = app.PLAT.get(ex.get("platform") or "", {}).get("name") or _("nerozpoznána")
        for label, value in ((_("platforma (odhad)"), plat),
                             (_("zařízení"), len(prj["devices"])),
                             (_("signálů I/O"), len(prj["io"])),
                             (_("kroků sekvence"), len(prj["program"]["seq"])),
                             (_("programů (POU)"), len(ex["pous"]))):
            ttk.Label(stats, text=f"{label}  {value}", style="Stat.TLabel"
                      ).pack(side="left", padx=(0, 6))
        if (ex.get("meta") or {}).get("name"):
            ttk.Label(body, text=_("Název z podkladů: {name}", name=ex["meta"]["name"]),
                      style="Dim.TLabel").pack(anchor="w", pady=(6, 0))

        unparsed = [u["name"] for u in ex["unparsed"]]
        notes = []
        if unparsed:
            notes.append(_("Přesné zpracování nerozumí: {files} — tyto podklady může přečíst AI "
                           "(další krok).", files=", ".join(unparsed)))
        if ex["pous"]:
            notes.append(_("Programy PLC ({n}) prošlo přesné zpracování; AI z nich může doplnit "
                           "popisy, sekvenci a časy.", n=len(ex["pous"])))
        if not prj["devices"]:
            notes.append(_("Z přesně zpracovaných podkladů nevzniklo žádné zařízení."))
        if notes:
            note_box(body, "\n".join(notes), warn=bool(unparsed) or not prj["devices"],
                     side="bottom")

        tbl = Table(body, [("name", _("Soubor"), 200, True), ("fmt", _("Formát"), 330, True),
                           ("ok", _("Stav"), 120, False), ("sig", _("Signály"), 70, False),
                           ("pou", _("Programy"), 80, False), ("note", _("Poznámka"), 120, True)],
                    height=8)
        tbl.pack(fill="both", expand=True, pady=(10, 0))
        for i, f in enumerate(ex["files"]):
            state = _("✔ zpracováno") if f["ok"] else _("→ AI / nerozpoznáno")
            tbl.add(i, (f["name"], f["fmt"], state, f["signals"] or "", f["pous"] or "",
                        f.get("note") or ""), tags=() if f["ok"] else ("dim",))
        self.found_table = tbl

        self._foot_btn(_("Na revizi") + " →", lambda: self.goto(3), accent=not unparsed)
        self._foot_btn(_("Analýza AI") + " →", lambda: self.goto(2), accent=bool(unparsed))
        self._foot_btn("← " + _("Zpět"), lambda: self.goto(0))

    # --- 3. analýza AI ---------------------------------------------------------------------

    def estimate(self) -> dict:
        S = self.S
        key = (S["model"], S["code"])
        if S["est"] is None or S["est_key"] != key:
            S["est"] = self.bridge("import.estimate", files=self.inputs(), model=S["model"],
                                   ex=S["ex"], prj=S["exact"]["prj"], code=S["code"])
            S["est_key"] = key
        return S["est"]

    def _page_ai(self) -> None:
        S, body, app = self.S, self.body, self.app
        key = app.settings.get("ai_key", "")
        wrap_label(body, _(
            "AI přečte podklady, kterým přesné zpracování nerozumí (schémata PDF, fotky, popis "
            "funkce), a doplní zařízení, popisy, meze a sekvenci. Ke každé položce uvede zdroj "
            "a jistotu; přesně zjištěné údaje nemění, rozpory zapíše. Krok je volitelný."),
            pady=(0, 8))

        cfg = ttk.Frame(body)
        cfg.pack(fill="x")
        ttk.Label(cfg, text=_("Model:")).pack(side="left")
        models = ai_client.MODELS + [m for m in app.settings.get("ai_models") or []
                                     if m not in ai_client.MODELS]
        var_model = tk.StringVar(value=S["model"])
        cb = ttk.Combobox(cfg, textvariable=var_model, values=models,
                          width=max(len(m) for m in models) + 2)
        cb.pack(side="left", padx=(6, 14))
        cb._var = var_model

        def on_model(_e=None):
            m = var_model.get().strip() or ai_client.DEFAULT_MODEL
            if m != S["model"] and not S["busy"]:
                S["model"] = m
                self.render()

        cb.bind("<<ComboboxSelected>>", on_model)
        cb.bind("<Return>", on_model)
        cb.bind("<FocusOut>", on_model)
        if S["ex"]["pous"]:
            var_code = tk.BooleanVar(value=S["code"])

            def on_code():
                S["code"] = var_code.get()
                self.render()

            chk = ttk.Checkbutton(cfg, text=_("poslat i programy PLC ({n})", n=len(S["ex"]["pous"])),
                                  variable=var_code, command=on_code)
            chk.pack(side="left")
            chk._var = var_code
            if S["busy"]:
                chk.state(["disabled"])
        if S["busy"]:
            cb.state(["disabled"])

        try:
            est = self.estimate()
        except BridgeError as exc:
            ttk.Label(body, text=_("Odhad se nepodařilo spočítat: {exc}", exc=exc),
                      style="Err.TLabel").pack(anchor="w", pady=(8, 0))
            self._foot_btn(_("Na revizi") + " →", lambda: self.goto(3))
            self._foot_btn("← " + _("Zpět"), lambda: self.goto(1))
            return
        nothing = not any(p["files"] for p in est["parts"])

        # zdola: upozornění na odeslání dat, varování odhadu
        if not key:
            note_box(body, _("Bez API klíče je analýza AI nedostupná — klíč zadáš v kroku "
                             "AI návrh (ukládá se jen na tomto počítači). Na revizi můžeš "
                             "pokračovat s přesně rozpoznanými údaji."), warn=True, side="bottom")
        note_box(body, _(
            "Podklady uvedené v tabulce se odešlou do Anthropic API (Claude) pod tvým klíčem "
            "a dotaz se účtuje podle skutečné spotřeby tokenů. Neodesílej, co nesmí opustit "
            "firmu. Výsledek je návrh k revizi, ne ověřená dokumentace."), warn=True, side="bottom")
        if est["warnings"]:
            note_box(body, "\n".join("• " + w for w in est["warnings"]), warn=True, side="bottom")

        stats = ttk.Frame(body)
        stats.pack(fill="x", pady=(10, 0))
        if nothing:
            ttk.Label(stats, text=_("Není co analyzovat — všechny podklady zpracovalo přesné "
                                    "zpracování."), style="Ok.TLabel").pack(side="left")
        else:
            for text in (_("dotazů: {n}", n=len(est["parts"])),
                         _("vstup ≈ {n} tokenů", n=_num(est["inputTokens"])),
                         _("výstup ≈ {n} tokenů", n=_num(est["outputTokens"])),
                         _("odhad ceny ≈ {usd} USD", usd=_usd(est["usd"]))):
                ttk.Label(stats, text=text, style="Stat.TLabel").pack(side="left", padx=(0, 6))
            ttk.Label(body, text=_("Ceník Anthropic k {date}; skutečnou spotřebu ukáže odpověď "
                                   "API. Odhad, ne závazná cena.", date=est["priceDate"]),
                      style="Dim.TLabel").pack(anchor="w", pady=(4, 0))

        if S["busy"]:
            prog = ttk.Frame(body)
            prog.pack(fill="x", pady=(10, 0))
            ttk.Label(prog, text=_("Dotaz {i} z {n} — čekám na odpověď API…", i=S["part"] + 1,
                                   n=max(S["parts"], 1)), style="Section.TLabel").pack(side="left")
            if S["parts"] > 1:
                bar = ttk.Progressbar(prog, mode="determinate", maximum=S["parts"],
                                      value=S["part"], length=220)
            else:                        # jeden dotaz: průběh API neznáme — jen „běží“
                bar = ttk.Progressbar(prog, mode="indeterminate", length=220)
                bar.start(20)
            bar.pack(side="left", padx=12)

        tbl = Table(body, [("part", _("Dotaz"), 60, False), ("files", _("Podklady"), 360, True),
                           ("in", _("Vstup [tokeny]"), 110, False),
                           ("out", _("Výstup [tokeny]"), 110, False)], height=4)
        tbl.pack(fill="both", expand=True, pady=(8, 0))
        for i, p in enumerate(est["parts"]):
            if p["files"]:
                tbl.add(i, (i + 1, ", ".join(p["files"]), _num(p["inputTokens"]),
                            _num(p["outputTokens"])))

        if S["partial"] and not S["busy"]:
            done, total = S["partial"]
            prow = ttk.Frame(body)
            prow.pack(fill="x", pady=(8, 0), before=tbl)
            ttk.Button(prow, text=_("Použít výsledek dosavadních dotazů ({k} z {n})", k=done,
                                    n=total), style="Accent.TButton", command=self.use_partial
                       ).pack(side="left")
            ttk.Label(prow, text=_("AI zpracovala jen část podkladů; zbytek můžeš zkusit znovu."),
                      style="Dim.TLabel").pack(side="left", padx=10)
        if S["busy"]:
            self._foot_btn(_("Stop"), self.stop_ai)
        else:
            self._foot_btn(_("Na revizi") + " →", lambda: self.goto(3),
                           accent=nothing or not key or S["merged"] is not None)
            if key and not nothing:
                self._foot_btn(_("Spustit analýzu (placené)"), self.confirm_ai,
                               accent=S["merged"] is None)
            self._foot_btn("← " + _("Zpět"), lambda: self.goto(1))

    def confirm_ai(self) -> None:
        est = self.estimate()
        if not messagebox.askyesno(
                _("Spustit analýzu AI?"),
                _("Odešle se {n} dotazů do Anthropic API (model {model}). Odhad ceny "
                  "≈ {usd} USD, účtuje se skutečná spotřeba. Pokračovat?",
                  n=len(est["parts"]), model=self.S["model"], usd=_usd(est["usd"])),
                parent=self.win):
            return
        self.start_ai()

    def start_ai(self) -> None:
        S = self.S
        if S["busy"]:
            return
        if not self.app.settings.get("ai_key", ""):
            self.set_msg("err", _(ERRORS["no_key"]))
            return
        S.update(busy=True, part=0, parts=0, prev=None, partial=None,
                 usage={"input_tokens": 0, "output_tokens": 0}, msg=("", ""))
        S["token"] += 1
        self._send_part(S["token"])

    def stop_ai(self) -> None:
        S = self.S
        if not S["busy"]:
            return
        S["token"] += 1
        S["busy"] = False
        self._keep_partial()
        S["msg"] = ("err", _("Analýza zastavena. Dotaz, který už běžel, mohl být naúčtován."))
        self.render()

    def _keep_partial(self) -> None:
        """Po chybě / Stopu v dalším dotazu zůstane nabídka výsledku dosavadních dotazů."""
        S = self.S
        S["partial"] = (S["part"], S["parts"]) if S["part"] > 0 and S["prev"] is not None else None

    def use_partial(self) -> None:
        """Výsledek dokončených dotazů (poslední úspěšný JSON) → sloučený návrh k revizi."""
        S = self.S
        if S["busy"] or not S["partial"] or S["prev"] is None:
            return
        done, total = S["partial"]
        try:
            res = self.bridge("import.norm", raw=S["prev"], ex=S["ex"], files=self.inputs(),
                              exact=S["exact"])
        except BridgeError as exc:
            self.set_msg("err", _("Jádro hlásí chybu: {exc}", exc=exc))
            return
        S.update(ai=res["proposal"], merged=res["merged"], page=3, tab=0, sel=None, skip=set(),
                 partial=None)
        S["msg"] = ("ok", _("Použit výsledek {k} z {n} dotazů — zbylé podklady AI nezpracovala.",
                            k=done, n=total))
        self.render()

    def _send_part(self, token: int) -> None:
        """Zprávy dalšího dotazu (most, hlavní vlákno) → API v pracovním vlákně."""
        S = self.S
        try:
            msg = self.bridge("import.messages", ex=S["ex"], files=self.inputs(), part=S["part"],
                              prev=S["prev"], prj=S["exact"]["prj"], model=S["model"],
                              code=S["code"])
        except BridgeError as exc:
            self._fail(_("Jádro hlásí chybu: {exc}", exc=exc))
            return
        S["parts"] = msg["parts"]
        key, model = self.app.settings.get("ai_key", ""), S["model"]
        box: queue.Queue = queue.Queue()

        def work():
            try:
                box.put(("ok", ai_client.call_full(key, model, msg["messages"],
                                                   timeout=ai_client.IMPORT_TIMEOUT,
                                                   max_tokens=ai_client.IMPORT_MAX_TOKENS)))
            except ai_client.AiError as exc:
                box.put(("err", exc))
            except Exception as exc:  # noqa: BLE001 — jinak by průvodce navždy „čekal“
                box.put(("err", ai_client.AiError("api_error", f"{type(exc).__name__}: {exc}")))

        threading.Thread(target=work, daemon=True).start()
        self.render()
        self.win.after(100, lambda: self._poll(token, box))

    def _poll(self, token: int, box: queue.Queue) -> None:
        S = self.S
        if S["token"] != token:
            return                       # zastaveno
        try:
            kind, value = box.get_nowait()
        except queue.Empty:
            if self.win.winfo_exists():
                self.win.after(150, lambda: self._poll(token, box))
            return
        if kind == "err":
            self._fail(self._err_text(value))
            return
        try:
            S["prev"] = self.app.bridge.ai("extractJson", value["text"])
        except BridgeError as exc:
            self._fail(_(ERRORS["invalid_json"]) if exc.code == "invalid_json"
                       else _("Jádro hlásí chybu: {exc}", exc=exc))
            return
        for k in ("input_tokens", "output_tokens"):
            S["usage"][k] += int((value.get("usage") or {}).get(k) or 0)
        S["part"] += 1
        if S["part"] < S["parts"]:
            self._send_part(token)
            return
        try:
            res = self.bridge("import.norm", raw=S["prev"], ex=S["ex"], files=self.inputs(),
                              exact=S["exact"])
        except BridgeError as exc:
            self._fail(_("Jádro hlásí chybu: {exc}", exc=exc))
            return
        S.update(ai=res["proposal"], merged=res["merged"], busy=False, page=3, tab=0, sel=None,
                 skip=set())
        u = S["usage"]
        price = self.price(S["model"])
        usd = (u["input_tokens"] * price.get("in", 0) + u["output_tokens"] * price.get("out", 0)) / 1e6
        S["msg"] = ("ok", _("Analýza AI hotová: {n} zařízení v návrhu · spotřeba {i} + {o} tokenů "
                            "≈ {usd} USD.", n=len(res["merged"]["prj"]["devices"]),
                            i=_num(u["input_tokens"]), o=_num(u["output_tokens"]), usd=_usd(usd)))
        self.render()

    def price(self, model: str) -> dict:
        if model not in self._price:
            try:
                self._price[model] = self.bridge("import.model", model=model)
            except BridgeError:
                self._price[model] = {}
        return self._price[model]

    def _err_text(self, exc: ai_client.AiError) -> str:
        if exc.code == "bad_request" and exc.detail and exc.detail not in ("content", "text",
                                                                          "image", "document"):
            return _("API odmítlo dotaz jako neplatný (400) — často kvůli formátu nebo velikosti "
                     "podkladu: {detail}", detail=exc.detail)
        if exc.code in ERRORS:
            return _(ERRORS[exc.code])
        if exc.code == "network":
            return _("Nepodařilo se spojit s API — zkontroluj připojení: {detail}",
                     detail=exc.detail or exc.code)
        return _("Nepodařilo se získat odpověď: {detail}", detail=exc.detail or exc.code)

    def _fail(self, text: str) -> None:
        S = self.S
        S["token"] += 1
        S["busy"] = False
        self._keep_partial()
        S["msg"] = ("err", text)
        self.render()

    # --- 4. revize ----------------------------------------------------------------------------

    def toggle(self, name: str) -> None:
        """Zařízení převzít / nepřevzít."""
        skip = self.S["skip"]
        skip.symmetric_difference_update({name})
        self.render()

    def _evidence(self, key: str) -> dict | None:
        return (self.proposal() or {}).get("evidence", {}).get(key)

    def _conf(self, key: str) -> str:
        ev = self._evidence(key)
        return ev["conf"] if ev else ""

    def _page_review(self) -> None:
        S, body, app = self.S, self.body, self.app
        prop = self.proposal()
        prj = prop["prj"]
        devs = prj["devices"]
        by_id = {d["id"]: d for d in devs}
        skip_ids = {d["id"] for d in devs if d["name"] in S["skip"]}
        from .steps.program import ACT_LABEL, COND_LABEL
        from .steps.zarizeni import _opts_text

        top = ttk.Frame(body)
        top.pack(fill="x")
        src = _("přesné zpracování + AI") if S["merged"] else _("přesné zpracování")
        ttk.Label(top, text=_("Zdroj návrhu: {src}", src=src), style="Section.TLabel"
                  ).pack(side="left")
        legend = ttk.Frame(top)
        legend.pack(side="right")
        ttk.Label(legend, text=_("jistota:"), style="Dim.TLabel").pack(side="left", padx=(0, 4))
        for c in ("sure", "guess", "missing"):
            tk.Label(legend, text=_(CONF_LABEL[c]), bg=CONF_BG[c], fg=CONF_FG[c],
                     font=theme.FONT_DIM, padx=6, pady=1).pack(side="left", padx=(0, 4))

        # patička revize: převzetí
        take = len(devs) - len(skip_ids)
        self._foot_btn(_("Převzít jako projekt"), self.take_over, accent=True, disabled=not take)
        self._foot_btn("← " + _("Zpět"), lambda: self.goto(2 if S["ex"]["unparsed"] or S["ai"]
                                                               else 1))

        mid = ttk.Frame(body)
        mid.pack(fill="both", expand=True, pady=(8, 0))
        # panel zdroje pod tabulkami — záložky i sloupce tak mají celou šířku okna
        side = ttk.Frame(mid)
        side.pack(side="bottom", fill="x", pady=(8, 0))
        ttk.Label(side, text=_("Zdroj vybrané položky"), style="Section.TLabel").pack(anchor="w")
        s_frm, cite = scrolled_text(side, readonly=True, height=5)
        s_frm.pack(fill="x", pady=(2, 0))
        mid.bind("<Configure>", lambda e: cite.configure(height=5 if e.height >= 420 else 3),
                 add="+")
        cite.tag_configure("h", foreground=theme.PRIMARY, font=theme.FONT_ACCENT)
        cite.tag_configure("dim", foreground=theme.DIM, font=theme.FONT_DIM)
        cite.tag_configure("q", foreground=theme.FG, font=theme.FONT_MONO)
        for c in CONF_FG:
            cite.tag_configure(c, foreground=CONF_FG[c], font=theme.FONT_ACCENT)
        self.cite = cite

        def show(title: str, ev: dict | None, extra: str = "", hint: bool = False) -> None:
            cite.configure(state="normal")
            cite.delete("1.0", "end")
            cite.insert("end", title, "h")
            if ev and ev.get("conf") in CONF_LABEL:
                cite.insert("end", "   " + _("jistota: {c}", c=_(CONF_LABEL[ev["conf"]])), ev["conf"])
            if extra:
                cite.insert("end", "   " + extra, "dim")
            cite.insert("end", "\n")
            if hint:
                pass
            elif not ev:
                cite.insert("end", _("Bez záznamu o zdroji.") + "\n", "dim")
            else:
                if ev.get("note"):
                    cite.insert("end", ev["note"] + "\n", "dim")
                for s in ev.get("src") or []:
                    where = s.get("file", "")
                    if s.get("page"):
                        where += " · " + _("strana {n}", n=s["page"])
                    if s.get("line"):
                        where += " · " + _("řádek {n}", n=s["line"])
                    cite.insert("end", where, "dim")
                    if s.get("quote"):
                        cite.insert("end", "   „" + s["quote"] + "“", "q")
                    cite.insert("end", "\n")
            cite.configure(state="disabled")

        show(_("Vyber řádek v tabulce."), None, _("U každé položky se tu ukáže soubor, strana "
                                                  "nebo řádek a citace z podkladu."), hint=True)

        nb = ttk.Notebook(mid, style="Compact.TNotebook")
        nb.pack(side="top", fill="both", expand=True)
        rows: dict[str, dict] = {}       # iid → (titulek, evidence, doplněk) pro panel zdroje

        def tab(title: str) -> ttk.Frame:
            f = ttk.Frame(nb, padding=(0, 6, 0, 0))
            nb.add(f, text=title)
            return f

        def conf_tags(c: str, off: bool = False) -> tuple:
            return tuple(t for t in (c if c in CONF_BG else "", "dim" if off else "") if t)

        def make_table(parent, cols, key_prefix, **kw) -> Table:
            t = Table(parent, cols, height=8, **kw)
            t.pack(fill="both", expand=True)
            for c in CONF_BG:
                t.tv.tag_configure(c, background=CONF_BG[c])

            def on_sel(_e=None):
                iid = t.selected()
                if iid is not None and f"{key_prefix}{iid}" in rows:
                    S["sel"] = f"{key_prefix}{iid}"
                    show(*rows[S["sel"]])

            t.tv.bind("<<TreeviewSelect>>", on_sel, add="+")
            return t

        def conf_txt(c: str) -> str:
            return _(CONF_LABEL[c]) if c in CONF_LABEL else "—"

        # zařízení
        f_dev = tab(_("Zařízení ({n})", n=len(devs)))
        brow = ttk.Frame(f_dev)
        brow.pack(side="bottom", fill="x", pady=(6, 0))

        def set_all(on: bool) -> None:
            S["skip"] = set() if on else {d["name"] for d in devs}
            self.render()

        ttk.Button(brow, text=_("Převzít vše"), command=lambda: set_all(True)).pack(side="left")
        ttk.Button(brow, text=_("Nepřevzít nic"), command=lambda: set_all(False)
                   ).pack(side="left", padx=(6, 0))
        ttk.Label(brow, text=_("Převezme se {k} z {n} zařízení · klik do sloupce ✓ = převzít / "
                               "nepřevzít", k=take, n=len(devs)), style="Dim.TLabel"
                  ).pack(side="left", padx=10)

        def on_click(iid: str, key: str) -> None:
            if key == "take" and iid.isdigit() and int(iid) in by_id:
                S["sel"] = f"d{iid}"
                self.toggle(by_id[int(iid)]["name"])

        t_dev = make_table(f_dev, [("take", "✓", 34, False), ("name", _("Označení"), 90, False),
                                   ("cls", _("Třída"), 130, False), ("desc", _("Popis"), 200, True),
                                   ("opt", _("Volby"), 160, True), ("conf", _("Jistota"), 90, False),
                                   ("src", _("Zdroj"), 170, True)], "d", on_click=on_click)
        for d in devs:
            k = "dev:" + d["name"]
            c, off = self._conf(k), d["id"] in skip_ids
            cls = app.CLS.get(d["cls"], {}).get("label", d["cls"])
            t_dev.add(d["id"], ("☐" if off else "☑", d["name"], cls, d["desc"], _opts_text(app, d),
                                conf_txt(c), _src_short((self._evidence(k) or {}).get("src") or [])),
                      tags=conf_tags(c, off))
            rows[f"d{d['id']}"] = (f"{d['name']} — {cls}", self._evidence(k),
                                   _("nepřevezme se") if off else "")
        self.dev_table = t_dev

        # I/O
        f_io = tab(_("I/O ({n})", n=len(prj["io"])))
        t_io = make_table(f_io, [("tag", _("Tag"), 150, True), ("addr", _("Adresa"), 80, False),
                                 ("dir", _("Směr"), 50, False), ("dev", _("Zařízení"), 90, False),
                                 ("cmt", _("Komentář"), 200, True), ("conf", _("Jistota"), 90, False),
                                 ("src", _("Zdroj"), 170, True)], "i")
        for i, e in enumerate(prj["io"]):
            d = by_id.get(e["devId"], {})
            k = "io:" + e["tag"]
            ev = self._evidence(k) or self._evidence("dev:" + d.get("name", ""))
            c = self._conf(k)
            t_io.add(i, (e["tag"], e["addr"], e["dir"], d.get("name", ""), e.get("cmt", ""),
                         conf_txt(c), _src_short((ev or {}).get("src") or [])),
                     tags=conf_tags(c, e["devId"] in skip_ids))
            rows[f"i{i}"] = (f"{e['tag']}  {e['addr']}", ev,
                             "" if self._evidence(k) else _("zdroj podle zařízení"))

        # sekvence
        seq = prj["program"]["seq"]
        f_seq = tab(_("Sekvence ({n})", n=len(seq)))
        t_seq = make_table(f_seq, [("n", _("Krok"), 50, False), ("act", _("Akce"), 200, True),
                                   ("cond", _("Podmínka"), 170, False), ("t", _("Čas [s]"), 70, False),
                                   ("conf", _("Jistota"), 90, False), ("src", _("Zdroj"), 170, True)],
                           "s")
        for i, s in enumerate(seq):
            d = by_id.get(s["dev"], {})
            act = _(ACT_LABEL[s["act"]]) if s["act"] in ACT_LABEL else s["act"]
            text = act if s["act"] == "wait" else f"{d.get('name', '?')} {act}"
            k = f"seq:{i}"
            c = self._conf(k)
            cond = _(COND_LABEL[s["cond"]]) if s["cond"] in COND_LABEL else s["cond"]
            t_seq.add(i, (i + 1, text, cond, f"{s['timeS']:g}", conf_txt(c),
                          _src_short((self._evidence(k) or {}).get("src") or [])),
                      tags=conf_tags(c, s["dev"] in skip_ids))
            rows[f"s{i}"] = (_("Krok {n}: {title}", n=i + 1, title=text), self._evidence(k), "")
        if not seq:
            ttk.Label(f_seq, text=_("Podklady sekvenci nepopisují — doplníš ji v kroku Program "
                                    "nebo s AI návrhářem."), style="Dim.TLabel").pack(anchor="w")

        # E-stop a blokování
        prog = prj["program"]
        f_lock = tab(_("E-stop a blokování"))
        wrap_label(f_lock, _("E-stop a kryty se převezmou jen jako informativní signály "
                             "programu — bezpečnostní funkce PLCdesk negeneruje."),
                   side="bottom", pady=(6, 0))
        t_lock = make_table(f_lock, [("kind", _("Funkce"), 120, False), ("dev", _("Zařízení"), 90, False),
                                     ("desc", _("Popis"), 220, True), ("conf", _("Jistota"), 90, False),
                                     ("src", _("Zdroj"), 170, True)], "l")
        lock_rows = []
        if prog["estop"] != "" and prog["estop"] in by_id:
            lock_rows.append((_("E-stop"), by_id[prog["estop"]], "estop"))
        for lid in prog.get("interlocks") or []:
            if lid in by_id:
                lock_rows.append((_("blokování"), by_id[lid], "lock:" + by_id[lid]["name"]))
        if prog["estop"] == "":
            ttk.Label(f_lock, text=_("E-stop v podkladech nenalezen."), style="Err.TLabel"
                      ).pack(anchor="w", before=t_lock)
        for i, (kind, d, k) in enumerate(lock_rows):
            c = self._conf(k)
            t_lock.add(i, (kind, d["name"], d["desc"], conf_txt(c),
                           _src_short((self._evidence(k) or {}).get("src") or [])),
                       tags=conf_tags(c, d["id"] in skip_ids))
            rows[f"l{i}"] = (f"{kind}: {d['name']}", self._evidence(k), "")

        # konflikty
        conflicts = prop.get("conflicts") or []
        f_con = tab(_("Konflikty ({n})", n=len(conflicts)))
        t_con = make_table(f_con, [("what", _("Položka"), 140, False), ("note", _("Rozpor"), 360, True),
                                   ("src", _("Zdroj"), 170, True)], "c")
        for i, c in enumerate(conflicts):
            t_con.add(i, (c["what"], c["note"], _src_short(c.get("src") or [])), tags=("guess",))
            rows[f"c{i}"] = (c["what"], {"src": c.get("src") or [], "note": c["note"]}, "")
        if not conflicts:
            ttk.Label(f_con, text=_("Podklady si neodporují."), style="Ok.TLabel"
                      ).pack(anchor="w", before=t_con)

        # chybí
        missing = self.missing()
        f_mis = tab(_("Chybí ({n})", n=len(missing)))
        t_mis = make_table(f_mis, [("what", _("Co v podkladech chybí"), 500, True)], "m")
        for i, m in enumerate(missing):
            t_mis.add(i, (m,), tags=("missing",))

        # otázky a poznámka AI
        if S["ai"]:
            f_ai = tab(_("Otázky a poznámka AI"))
            a_frm, a_txt = scrolled_text(f_ai, readonly=True, height=8)
            a_frm.pack(fill="both", expand=True)
            a_txt.tag_configure("h", foreground=theme.PRIMARY, font=theme.FONT_ACCENT)
            parts = []
            if S["ai"].get("questions"):
                parts.append(_("Otázky AI:") + "\n" + "\n".join("• " + q for q in S["ai"]["questions"]))
            if S["ai"].get("note"):
                parts.append(_("Poznámka AI:") + "\n" + S["ai"]["note"])
            if S["ai"].get("dropped"):
                parts.append(_("Zahozené záznamy bez platného zdroje: {n}", n=len(S["ai"]["dropped"])))
            set_text(a_txt, "\n\n".join(parts) or _("AI nic nedoplnila."))

        tabs = nb.tabs()
        nb.select(tabs[min(S["tab"], len(tabs) - 1)])
        def on_tab(_e=None):
            if S["tab"] != nb.index("current"):
                S.update(tab=nb.index("current"), sel=None)
                show(_("Vyber řádek v tabulce."), None, hint=True)

        nb.bind("<<NotebookTabChanged>>", on_tab, add="+")
        self.notebook = nb
        # výběr po překreslení (odškrtnutí zařízení)
        sel = S.get("sel")
        if sel and sel in rows and sel[0] == "d":
            t_dev.select(sel[1:])
            show(*rows[sel])

    def take_over(self) -> bool:
        """Převezme návrh jako projekt (bez odškrtnutých zařízení) a předvyplní AI návrh."""
        S, app = self.S, self.app
        prop = self.proposal()
        if not prop:
            return False
        prj = copy.deepcopy(prop["prj"])
        skip_ids = {d["id"] for d in prj["devices"] if d["name"] in S["skip"]}
        n_take = len(prj["devices"]) - len(skip_ids)
        if not n_take:
            self.set_msg("err", _("Není co převzít — vyber aspoň jedno zařízení."))
            return False
        if not messagebox.askyesno(
                _("Převzít jako projekt?"),
                _("Import nahradí aktuální návrh ({n} zařízení) novým projektem s {k} zařízeními. "
                  "Pokračovat?", n=len(app.prj["devices"]), k=n_take), parent=self.win):
            return False
        prj["devices"] = [d for d in prj["devices"] if d["id"] not in skip_ids]
        prj["io"] = [e for e in prj["io"] if e["devId"] not in skip_ids]
        prog = prj["program"]
        prog["seq"] = [s for s in prog["seq"] if s["act"] == "wait" or s["dev"] not in skip_ids]
        prog["interlocks"] = [i for i in prog.get("interlocks") or [] if i not in skip_ids]
        if prog.get("estop") in skip_ids:
            prog["estop"] = ""
        meta = prj["meta"]
        if not meta.get("name"):
            meta["name"] = (S["ex"].get("meta") or {}).get("name") or _("Převzaté zařízení")
        names = [f["name"] for f in self.inputs()]
        old = (app.prj, app.ai)
        try:
            app.set_project(prj, None)
            app.sync()
            # signály bez doložené adresy (AI ji nevymýšlí) dostanou volnou adresu
            app.prj = app.bridge.mutate("autoAddr", app.prj, False)
            popis = meta.get("desc") or _("Stávající stroj „{name}“ převzatý z podkladů: {files}.",
                                          name=meta["name"], files=", ".join(names))
            note = _("Návrh převzatý z importu stávajícího zařízení — položky s jistotou "
                     "„odhad“ nebo „chybí doklad“ ověř podle podkladů. Napiš, co upravit; AI zná "
                     "celou aktuální sestavu.")
            missing = self.missing()
            if missing:
                more = f" (+{len(missing) - 8})" if len(missing) > 8 else ""
                note += " " + _("V podkladech chybí: {items}", items="; ".join(missing[:8]) + more)
            ai = app.bridge.ai("seedFromProject", app.prj, popis, note)
            ai.setdefault("last", None)
            ai.setdefault("draft", "")
            app.ai = ai
            issues = app.core("validateProject", app.prj)
        except (ValueError, BridgeError) as exc:
            app.prj, app.ai = old
            messagebox.showerror(_("Import nejde převzít"), str(exc), parent=self.win)
            return False
        errs = sum(1 for i in issues if i["level"] == "error")
        warns = len(issues) - errs
        app.step = 3
        app.save()
        self.close()
        app.render()
        app.set_status(_("Import převzat: {n} zařízení, {io} signálů I/O, {s} kroků · kontrola "
                         "projektu: {e} chyb, {w} varování.", n=len(app.prj["devices"]),
                         io=len(app.prj["io"]), s=len(app.prj["program"]["seq"]), e=errs, w=warns),
                       keep=True)
        app.ui.pop("import", None)       # průvodce příště začne načisto
        return True
