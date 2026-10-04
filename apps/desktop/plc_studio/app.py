"""PLCdesk — hlavní okno: stav, navigace mezi kroky, ukládání.

Odpovídá ``apps/web/src/app.js``; kroky jsou v balíku ``steps``. Stav
(projekt, AI konverzace, aktuální krok) se průběžně ukládá do složky
uživatele, takže po spuštění aplikace pokračuje tam, kde skončila.
"""

from __future__ import annotations

import json
import os
import re
import traceback
from datetime import datetime
from pathlib import Path

import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from tkinter import font as tkfont

from . import i18n, project, theme
from .bridge import BridgeError, CoreBridge
from .i18n import N_, _
from .steps import RENDERERS, render_help

STEPS = [N_("Projekt"), N_("AI návrh"), N_("Platformy"), N_("Zařízení"), N_("I/O"),
         N_("Schéma"), N_("Program"), N_("Generovat"), N_("Dokumentace"), N_("Kusovník"),
         N_("Bezpečnost"), N_("Schválení"), N_("Oživení")]
STEP_SAFETY, STEP_APPROVAL, STEP_COMMISSION = 10, 11, 12
# zkrácení popisků neaktivních kroků, když se lišta nevejde (None = celé, 0 = jen číslo)
NAV_LEVELS = (None, *range(24, 2, -1), 0)
PROJECT_EXT = ".plcstudio.json"
SAMPLE_NOTE = {
    "small": N_("Ukázkový návrh malé stanice — předvyplněno jako příklad práce AI návrháře."),
    "complex": N_("Ukázkový návrh složité linky — předvyplněno jako příklad práce AI návrháře."),
}


def state_dir() -> Path:
    """Složka se stavem a nastavením (``PLCSTUDIO_HOME`` ji přesměruje)."""
    env = os.environ.get("PLCSTUDIO_HOME")
    base = Path(env) if env else Path(os.environ.get("APPDATA") or Path.home()) / "PLCStudio"
    base.mkdir(parents=True, exist_ok=True)
    return base


def new_ai() -> dict:
    return {"turns": [], "last": None, "draft": ""}


class App:
    def __init__(self, root: tk.Tk, home: Path | None = None):
        self.root = root
        self.home = home or state_dir()
        self.errors: list[str] = []      # zachycené chyby callbacků (pro --smoke)
        self._save_job = None
        self._status_job = None
        self._badge_job = None
        self._badge: dict | None = None      # stav schválení pro odznak a lištu kroků
        self._badge_key: str | None = None   # projekt, ke kterému stav patří
        self._nav_level = None
        self._nav_extra: int | None = None
        self._badge_cur: dict | None = None
        self.ui: dict = {}               # stav UI kroků, který má přežít překreslení

        self.settings = self._read_json("settings.json", {})
        self.bridge = CoreBridge(log_file=self.home / "bridge.log")
        self._load_core(self.settings.get("lang") or "cs")

        self.prj: dict = self.core("blankProject")
        self.ai: dict = new_ai()
        self.step: int | str = 0
        self._load_state()
        if not self.prj["devices"] and not self.prj["meta"]["name"]:
            self.load_sample("complex", render=False)   # první spuštění = ukázka

        theme.setup_window(root, "PLCdesk", topmost=bool(self.settings.get("topmost")))
        root.geometry(self.settings.get("geometry") or "1240x820")
        root.minsize(1100, 680)
        theme.apply_styles(root)
        root.report_callback_exception = self._on_callback_error
        root.protocol("WM_DELETE_WINDOW", self.close)
        self._build_chrome()
        self.render()

    # --- jádro -----------------------------------------------------------------

    def _load_core(self, lang: str) -> None:
        """Nastaví jazyk jádra i okna a načte konstanty jádra v tomto jazyce."""
        consts = self.bridge.request("init", lang=lang)
        self.lang: str = consts["LANG"]
        self.LANGS: dict = consts["LANGS"]
        i18n.set_catalog(self.lang, consts["I18N"])
        self.PLAT: dict = consts["PLAT"]
        self.CLS: dict = consts["CLS"]
        self.DO_ROLES: dict = consts["DO_ROLES"]
        self.SAMPLE_DESC: dict = consts["SAMPLE_DESC"]
        self.AI_EXAMPLE: str = consts["AI_EXAMPLE"]

    def set_language(self, lang: str) -> None:
        """Přepne jazyk okna i výstupů jádra a okno postaví znovu. Obsah projektu
        (názvy, popisy, komentáře I/O) se nepřekládá — je to práce uživatele."""
        if lang == self.lang or lang not in self.LANGS:
            return
        self._load_core(lang)
        self.settings["lang"] = self.lang
        self.save_settings()
        for child in self.root.winfo_children():
            child.destroy()
        self._status_job = None
        self._build_chrome()
        self.render()

    def core(self, fn: str, *args):
        """Zavolá funkci jádra a vrátí výsledek."""
        return self.bridge.call(fn, *args)

    def sync(self) -> None:
        """``syncIO`` — srovná tabulku I/O se zařízeními (edity zachová)."""
        self.prj = self.bridge.mutate("syncIO", self.prj)

    def dev_by_id(self, dev_id) -> dict | None:
        return next((d for d in self.prj["devices"] if d["id"] == dev_id), None)

    # --- stav na disku -------------------------------------------------------------

    def _read_json(self, name: str, default):
        try:
            return json.loads((self.home / name).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return default

    def _write_json(self, name: str, data) -> None:
        try:
            tmp = self.home / (name + ".tmp")
            tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
            tmp.replace(self.home / name)
        except OSError:
            pass  # stav je pohodlí, ne důvod aplikaci shodit

    def _load_state(self) -> None:
        d = self._read_json("state.json", None)
        if not isinstance(d, dict):
            return
        try:
            self.set_project(d.get("prj") or {}, d.get("ai"))
        except ValueError:
            return                              # poškozený stav — začni ukázkou
        step = d.get("step", 0)
        self.step = step if step == "help" or (isinstance(step, int) and 0 <= step < len(STEPS)) else 0

    def set_project(self, prj: dict, ai: dict | None = None) -> None:
        """Nahradí projekt; chybějící části doplní z prázdného projektu.

        ``ValueError``, když se projekt použít nedá (pak zůstane původní)."""
        self.prj = project.normalize(prj, self.core("blankProject"), self.CLS, self.PLAT)
        # GUID objektů (export EPLAN podle nich páruje): starý projekt bez nich doplnit jádrem
        # a označit jako změněný (uložit) — export je nikdy negeneruje
        res = self.bridge.request("call", fn="ensureGuids", args=[self.prj])
        self.prj = res["args"][0]
        if res["result"] or not isinstance(prj.get("guid"), str):
            self.save()
        self.ai = self._normalize_ai(ai)

    def _normalize_ai(self, ai) -> dict:
        """AI konverzace ze souboru: jen platné zprávy, návrh znovu přes ``aiNorm``."""
        out = new_ai()
        if not isinstance(ai, dict):
            return out
        turns = ai.get("turns") if isinstance(ai.get("turns"), list) else []
        out["turns"] = [{"role": t["role"], "content": t["content"]} for t in turns
                        if isinstance(t, dict) and t.get("role") in ("user", "assistant")
                        and isinstance(t.get("content"), str)]
        out["draft"] = ai["draft"] if isinstance(ai.get("draft"), str) else ""
        if isinstance(ai.get("last"), dict):
            try:
                last = self.bridge.ai("aiNorm", ai["last"])
                out["last"] = last if last.get("devices") else None
            except BridgeError:
                pass
        return out

    def save(self) -> None:
        """Naplánuje uložení stavu (sloučí rychle po sobě jdoucí změny)."""
        if self._save_job is None:
            self._save_job = self.root.after(400, self._flush)

    def _flush(self) -> None:
        if self._save_job is not None:
            self.root.after_cancel(self._save_job)
            self._save_job = None
        self._write_json("state.json", {"prj": self.prj, "ai": self.ai, "step": self.step})

    def save_settings(self) -> None:
        self._write_json("settings.json", self.settings)

    # --- chrome okna -----------------------------------------------------------------

    def _build_chrome(self) -> None:
        frm = ttk.Frame(self.root)
        frm.pack(fill="both", expand=True, padx=16, pady=12)

        # hlavička
        head = ttk.Frame(frm)
        head.pack(fill="x")
        titles = ttk.Frame(head)         # balí se až po tlačítkách vpravo — dlouhý název
        line = ttk.Frame(titles)         # projektu je pak nevytlačí (zkrátí se sám)
        line.pack(anchor="w")
        # logotyp PLCdesk = symbol + „PLC" tučně a „desk" normálně (brand/README.md);
        # název produktu se nepřekládá
        theme.brand_symbol(line).pack(side="left", padx=(0, 8))
        for text, font in (("PLC", theme.FONT_HEADER), ("desk", theme.FONT_HEADER[:2])):
            tk.Label(line, text=text, font=font, bg=theme.BG, fg=theme.PRIMARY,
                     padx=0, pady=0, bd=0).pack(side="left")
        self._proj_lbl = ttk.Label(line, text="", style="Section.TLabel")
        self._proj_lbl.pack(side="left", padx=(10, 0))
        ttk.Label(titles, text=_("AI návrh · schéma · kód · dokumentace · {n} platforem",
                                 n=len(self.PLAT)),
                  style="Dim.TLabel").pack(anchor="w")

        # logo v hlavičce zatím ne (rozhodnutí uživatele 2026-10-02); theme.load_logo() zůstává
        # jazyk okna i generovaných výstupů
        names = list(self.LANGS.values())
        self._lang_box = ttk.Combobox(head, values=names, state="readonly",
                                      width=max(len(n) for n in names) + 1)
        self._lang_box.set(self.LANGS[self.lang])
        self._lang_box.bind("<<ComboboxSelected>>", lambda _e: self.root.after_idle(
            self.set_language, list(self.LANGS)[self._lang_box.current()]))
        self._lang_box.pack(side="right", padx=(10, 0))
        self._var_topmost = tk.BooleanVar(value=bool(self.settings.get("topmost")))
        ttk.Checkbutton(head, text=_("nad okny"), variable=self._var_topmost,
                        command=self._toggle_topmost).pack(side="right", padx=(8, 0))
        ttk.Button(head, text=_("Uložit projekt…"), command=self.save_project_dialog
                   ).pack(side="right", padx=(6, 0))
        ttk.Button(head, text=_("Otevřít projekt…"), command=self.open_project_dialog
                   ).pack(side="right")
        # odznak neschválených položek → krok Schválení (počítá se až po vykreslení kroku)
        self._badge_lbl = tk.Label(head, text="", font=theme.FONT_ACCENT, cursor="hand2",
                                   padx=8, pady=3, bg=theme.WARN_BG, fg=theme.WARN)
        self._badge_lbl.bind("<Button-1>", lambda _e: self.goto(STEP_APPROVAL))
        self._badge_lbl.invoke = lambda: self.goto(STEP_APPROVAL)
        titles.pack(side="left", fill="x", expand=True)
        self._titles = titles
        titles.bind("<Configure>", lambda _e: self.update_title())

        ttk.Separator(frm, orient="horizontal").pack(fill="x", pady=(10, 8))

        # lišta kroků
        nav = ttk.Frame(frm)
        nav.pack(fill="x")
        self._nav = nav
        self._step_btns = []
        for i, name in enumerate(STEPS):
            b = ttk.Button(nav, text=f"{i + 1} · {_(name)}", style="Step.TButton",
                           command=lambda i=i: self.goto(i))
            b.pack(side="left", padx=(0, 3))
            self._step_btns.append(b)
        self._help_btn = ttk.Button(nav, text="? " + _("Nápověda"), style="Step.TButton",
                                    command=lambda: self.goto("help"))
        self._help_btn.pack(side="right")
        nav.bind("<Configure>", lambda _e: self._fit_nav())

        # patička (pack před obsahem, ať ji obsah nevytlačí z okna)
        foot = ttk.Frame(frm)
        foot.pack(side="bottom", fill="x")
        ttk.Separator(frm, orient="horizontal").pack(side="bottom", fill="x", pady=(8, 8))
        self._status = ttk.Label(foot, text="", style="Dim.TLabel")
        self._status.pack(side="left")
        self._next_btn = ttk.Button(foot, text=_("Pokračovat") + " →", style="Accent.TButton",
                                    command=lambda: self.goto(self.step + 1))
        self._next_btn.pack(side="right")
        self._prev_btn = ttk.Button(foot, text="← " + _("Zpět"),
                                    command=lambda: self.goto(self.step - 1))
        self._prev_btn.pack(side="right", padx=(0, 6))

        self.view = ttk.Frame(frm)
        self.view.pack(fill="both", expand=True, pady=(12, 0))

    def _toggle_topmost(self) -> None:
        on = self._var_topmost.get()
        self.settings["topmost"] = on
        self.root.attributes("-topmost", on)

    # --- navigace a vykreslení ---------------------------------------------------------

    def _step_done(self, i: int) -> bool:
        if i == 0:
            return bool(self.prj["meta"]["name"])
        if i == 2:
            return bool(self.prj["platforms"])
        if i == 3:
            return bool(self.prj["devices"])
        b = self._badge_cur
        if b and i == STEP_SAFETY:
            return b["safetyOk"]
        if b and i == STEP_APPROVAL:
            return b["ok"]
        if b and i == STEP_COMMISSION:
            return b["commissionDone"]
        return False

    def goto(self, step) -> None:
        if isinstance(step, int) and not 0 <= step < len(STEPS):
            return
        self.step = step
        self.save()
        self.render()

    # --- odkazy mezi kroky -----------------------------------------------------------
    # Krok si cíl vyzvedne z ``self.ui`` při vykreslení (výběr řádku, záložka…).

    def terminals(self) -> dict:
        """Svorky signálů: klíč I/O → svorka, modul, kanál, index listu zapojení."""
        data = self.bridge.request("terminals", prj=self.prj)
        self.prj = data["prj"]
        return data["map"]

    def open_device(self, dev_id: int) -> None:
        self.ui["dev_sel"] = dev_id
        self.goto(3)

    def open_io(self, key: str) -> None:
        self.ui["io_sel"] = key
        self.goto(4)

    def open_block(self, dev_id: int | None = None) -> None:
        self.ui.update(schema_tab=0, block_sel=dev_id)
        self.goto(5)

    def open_flow(self, step: int | None = None) -> None:
        self.ui.update(schema_tab=1, flow_sel=step)
        self.goto(5)

    def open_wiring(self, key: str) -> None:
        self.ui.update(schema_tab=2, wire_sel=key)
        self.goto(5)

    def open_program(self, step: int | None = None) -> None:
        self.ui.update(prog_tab=0, seq_sel=step)
        self.goto(6)

    def open_live(self, dev_id: int | None = None) -> None:
        """Živá simulace (blokové schéma stroje s tlačítky), případně s vybraným zařízením."""
        self.ui.update(prog_tab=1, live_sel=dev_id)
        self.goto(6)

    def open_sim(self, scenario: str = "nominal") -> None:
        self.ui.update(prog_tab=2, sim_scenario=scenario)
        self.goto(6)

    def update_title(self) -> None:
        name = self.prj["meta"]["name"]
        text = f"— {name}" if name else ""
        # název se zkrátí na místo, které hlavičce zbude (celý je v titulku okna)
        room = self._titles.winfo_width() - self._proj_lbl.winfo_x() - 8
        if text and room > 50:
            font = tkfont.Font(font=theme.FONT_ACCENT)
            if font.measure(text) > room:
                while len(text) > 3 and font.measure(text + "…") > room:
                    text = text[:-1]
                text = text.rstrip() + "…"
        self._proj_lbl.configure(text=text)
        self.root.title(f"PLCdesk — {name}" if name else "PLCdesk")

    # --- lišta kroků ------------------------------------------------------------------

    def _step_text(self, i: int, level) -> str:
        """Popisek kroku; ``level`` = nejvýš tolik znaků názvu neaktivního kroku."""
        done = self._step_done(i) and i != self.step
        name = _(STEPS[i])
        if level is not None and i != self.step:
            name = "" if level == 0 else name if len(name) <= level                 else name[:level - 1].rstrip(" -") + "…"
        sep = " · " if level is None else " "             # zkrácená lišta šetří místo
        return f"{'✔ ' if done else ''}{i + 1}" + (sep + name if name else "")

    def _fit_nav(self) -> None:
        """Popisky kroků zkrátí tak, aby se lišta vešla do šířky okna (němčina, 1100 px):
        aktuální krok zůstává celý, ostatní se krátí, v krajním případě na číslo."""
        width = self._nav.winfo_width()
        if width <= 1:
            return
        room = width - self._help_btn.winfo_reqwidth() - 12
        fonts = (tkfont.Font(font=theme.FONT_UI), tkfont.Font(font=theme.FONT_ACCENT))
        if self._nav_extra is None:
            # vycpávka stylu a rámeček změřené na tlačítkách (medián — po změně popisku
            # je požadovaná šířka do vykreslení stará) + mezera mezi tlačítky
            diffs = sorted(b.winfo_reqwidth() - fonts[i == self.step].measure(str(b.cget("text")))
                           for i, b in enumerate(self._step_btns))
            self._nav_extra = diffs[len(diffs) // 2] + 3
        extra = self._nav_extra
        level = NAV_LEVELS[-1]
        for lv in NAV_LEVELS:
            need = sum(fonts[i == self.step].measure(self._step_text(i, lv)) + extra
                       for i in range(len(STEPS)))
            if need <= room:
                level = lv
                break
        self._nav_level = level
        for i, b in enumerate(self._step_btns):
            text = self._step_text(i, level)
            if str(b.cget("text")) != text:
                b.configure(text=text)

    def _refresh_nav(self) -> None:
        # značky kroků 11–13 jen ze stavu, který patří k aktuálnímu projektu
        self._badge_cur = self._badge if self._badge_key == self._prj_key() else None
        for i, b in enumerate(self._step_btns):
            done = self._step_done(i)
            b.configure(style="StepOn.TButton" if i == self.step
                        else "StepDone.TButton" if done else "Step.TButton",
                        text=self._step_text(i, self._nav_level))
        self._help_btn.configure(style="StepOn.TButton" if self.step == "help" else "Step.TButton")
        self._fit_nav()

    # --- odznak schválení ----------------------------------------------------------------

    def _prj_key(self) -> str:
        return json.dumps(self.prj, sort_keys=True, ensure_ascii=False)

    def schedule_badge(self, delay: int = 300) -> None:
        """Přepočítá odznak „Neschváleno: N“ chvíli po změně (ověření simulací něco stojí)."""
        if self._badge_job is not None:
            self.root.after_cancel(self._badge_job)
        self._badge_job = self.root.after(delay, self.update_badge)

    def update_badge(self) -> None:
        self._badge_job = None
        key = self._prj_key()
        if key != self._badge_key:
            try:
                self._badge = self.bridge.request("approval.badge", prj=self.prj)                     if self.prj["devices"] else None
            except BridgeError:
                self._badge = None
            self._badge_key = key
        b = self._badge
        if not self._badge_lbl.winfo_exists():
            return
        if b is None:
            self._badge_lbl.pack_forget()
        else:
            # „čeká na ověření“ (velký stroj, ověření simulací ještě neproběhlo) se počítá
            # mezi neschválené; počet je pak jen dolní odhad → „?“
            n = b["pending"] + b["stale"] + b.get("unverified", 0)
            if n:
                self._badge_lbl.configure(text=_("Neschváleno: {n}", n=n)
                                          + (" ?" if b.get("partial") else ""),
                                          bg=theme.WARN_BG, fg=theme.WARN)
            else:
                self._badge_lbl.configure(text="✔ " + _("Vše schváleno"), bg=theme.TREE_SEL,
                                          fg=theme.PRIMARY)
            if not self._badge_lbl.winfo_ismapped():
                self._badge_lbl.pack(side="right", padx=(0, 10), before=self._titles)
        self._refresh_nav()

    def render(self) -> None:
        """Překreslí lištu kroků a obsah aktuálního kroku."""
        self._refresh_nav()
        self.update_title()
        num = isinstance(self.step, int)
        self._prev_btn.state(["!disabled"] if num and self.step > 0 else ["disabled"])
        self._next_btn.state(["!disabled"] if num and self.step < len(STEPS) - 1 else ["disabled"])

        for child in self.view.winfo_children():
            child.destroy()
        renderer = render_help if self.step == "help" else RENDERERS[self.step]
        try:
            renderer(self, self.view)
        except BridgeError as exc:
            self._report(_("Jádro hlásí chybu: {exc}", exc=exc), traceback.format_exc())
            ttk.Label(self.view, text="⚠ " + _("Krok se nepodařilo vykreslit: {exc}", exc=exc),
                      style="Err.TLabel").pack(anchor="w")
        self.schedule_badge()

    # --- stavový řádek, schránka, chyby ---------------------------------------------------

    def set_status(self, text: str, *, keep: bool = False) -> None:
        self._status.configure(text=text)
        if self._status_job is not None:
            self.root.after_cancel(self._status_job)
            self._status_job = None
        if text and not keep:
            self._status_job = self.root.after(6000, lambda: self._status.configure(text=""))

    def copy(self, text: str) -> None:
        self.root.clipboard_clear()
        self.root.clipboard_append(text)
        self.set_status(_("Zkopírováno do schránky."))

    def _report(self, summary: str, detail: str) -> None:
        self.errors.append(detail)
        try:
            with open(self.home / "plc_studio.log", "a", encoding="utf-8") as fh:
                fh.write(f"\n===== {datetime.now():%Y-%m-%d %H:%M:%S} =====\n{detail}\n")
        except OSError:
            pass
        self.set_status(f"⚠ {summary}", keep=True)

    def _on_callback_error(self, exc_type, exc, tb) -> None:
        detail = "".join(traceback.format_exception(exc_type, exc, tb))
        self._report(_("Chyba: {exc}  (podrobnosti v {path})", exc=exc,
                       path=self.home / "plc_studio.log"), detail)

    # --- projekt: ukázky, otevření, uložení -------------------------------------------------

    def confirm_replace(self, what: str) -> bool:
        """Před zahozením rozpracovaného návrhu se zeptá."""
        if not self.prj["devices"]:
            return True
        return messagebox.askyesno(
            _("Nahradit návrh?"),
            _("{what} nahradí aktuální návrh ({n} zařízení). Pokračovat?", what=what,
              n=len(self.prj["devices"])), parent=self.root)

    def load_sample(self, kind: str, *, render: bool = True) -> None:
        self.prj = self.core("sampleSmall" if kind == "small" else "sampleComplex")
        self.ai = self.bridge.ai("seedFromProject", self.prj, self.SAMPLE_DESC[kind],
                                 _(SAMPLE_NOTE[kind]))
        self.step = 0
        if render:
            self.save()
            self.render()

    def reset_project(self) -> None:
        self.prj = self.core("blankProject")
        self.ai = new_ai()
        self.save()
        self.render()

    def project_payload(self) -> str:
        """Stejný formát jako „Export návrhu (JSON)" ve webové aplikaci."""
        return json.dumps({"prj": self.prj, "ai": self.ai}, ensure_ascii=False, indent=1)

    def save_project_dialog(self) -> None:
        # znaky, které Windows v názvu souboru nedovolí („Linka A/B“, „TS: 02“)
        base = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", self.prj["meta"]["name"]).strip(" .")
        name = (base or "plc-projekt") + PROJECT_EXT
        path = filedialog.asksaveasfilename(
            parent=self.root, title=_("Uložit projekt"), initialfile=name,
            initialdir=self.settings.get("last_dir") or None, defaultextension=".json",
            filetypes=[(_("Projekt PLCdesk"), "*" + PROJECT_EXT), ("JSON", "*.json")])
        if not path:
            return
        try:
            Path(path).write_text(self.project_payload(), encoding="utf-8")
        except OSError as exc:
            messagebox.showerror(_("Uložení se nezdařilo"), str(exc), parent=self.root)
            return
        self.settings["last_dir"] = str(Path(path).parent)
        self.set_status(_("Projekt uložen: {path}", path=path))

    def seed_ai(self) -> dict:
        """AI konverzace předvyplněná z projektu: popis stroje = zadání, sestava = návrh."""
        meta = self.prj["meta"]
        ai = self.bridge.ai("seedFromProject", self.prj, meta.get("desc") or meta.get("name") or "",
                            _("Návrh převzatý z otevřeného projektu — pokračuj úpravami: napiš, "
                              "co změnit, a AI zná celou aktuální sestavu."))
        ai.setdefault("last", None)
        ai.setdefault("draft", "")
        return ai

    def open_project_dialog(self) -> None:
        path = filedialog.askopenfilename(
            parent=self.root, title=_("Otevřít projekt"),
            initialdir=self.settings.get("last_dir") or None,
            filetypes=[(_("Projekt PLCdesk"), "*" + PROJECT_EXT), ("JSON", "*.json"),
                       (_("Všechny soubory"), "*.*")])
        if path:
            self.open_project(path)

    def open_project(self, path: str | Path) -> bool:
        try:
            d = json.loads(Path(path).read_text(encoding="utf-8-sig"))
            if not isinstance(d, dict):
                raise ValueError(_("soubor neobsahuje objekt návrhu"))
            old = (self.prj, self.ai)
            self.set_project(d.get("prj") or d, d.get("ai"))
            try:
                self.sync()                    # I/O ze zařízení; jádro tím projekt i ověří
                if not self.ai.get("turns") and self.prj["devices"]:
                    self.ai = self.seed_ai()   # příklad / soubor bez konverzace → krok 2 není prázdný
            except BridgeError as exc:
                self.prj, self.ai = old
                raise ValueError(str(exc)) from exc
        except (OSError, ValueError) as exc:
            messagebox.showerror(_("Projekt nejde otevřít"),
                                 _("Neplatný soubor návrhu:") + f"\n{exc}", parent=self.root)
            return False
        self.settings["last_dir"] = str(Path(path).parent)
        self.step = 0
        self.save()
        self.render()
        self.set_status(_("Projekt načten: {path}", path=path))
        return True

    # --- konec ---------------------------------------------------------------------------

    def close(self) -> None:
        try:
            self.settings["geometry"] = self.root.geometry()
            self._flush()
            self._write_json("settings.json", self.settings)
        finally:
            self.bridge.close()
            self.root.destroy()
