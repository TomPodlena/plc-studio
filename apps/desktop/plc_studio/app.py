"""PLC Studio — hlavní okno: stav, navigace mezi kroky, ukládání.

Odpovídá ``apps/web/src/app.js``; kroky jsou v balíku ``steps``. Stav
(projekt, AI konverzace, aktuální krok) se průběžně ukládá do složky
uživatele, takže po spuštění aplikace pokračuje tam, kde skončila.
"""

from __future__ import annotations

import json
import os
import traceback
from datetime import datetime
from pathlib import Path

import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from . import theme
from .bridge import BridgeError, CoreBridge
from .steps import RENDERERS, render_help

STEPS = ["Projekt", "AI návrh", "Platformy", "Zařízení", "I/O", "Schéma",
         "Program", "Generovat", "Dokumentace"]
PROJECT_EXT = ".plcstudio.json"
SAMPLE_NOTE = {
    "small": "Ukázkový návrh malé stanice — předvyplněno jako příklad práce AI návrháře.",
    "complex": "Ukázkový návrh složité linky — předvyplněno jako příklad práce AI návrháře.",
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
        self.ui: dict = {}               # stav UI kroků, který má přežít překreslení

        self.settings = self._read_json("settings.json", {})
        self.bridge = CoreBridge(log_file=self.home / "bridge.log")
        consts = self.bridge.request("init")
        self.PLAT: dict = consts["PLAT"]
        self.CLS: dict = consts["CLS"]
        self.SAMPLE_DESC: dict = consts["SAMPLE_DESC"]
        self.AI_EXAMPLE: str = consts["AI_EXAMPLE"]

        self.prj: dict = self.core("blankProject")
        self.ai: dict = new_ai()
        self.step: int | str = 0
        self._load_state()
        if not self.prj["devices"] and not self.prj["meta"]["name"]:
            self.load_sample("complex", render=False)   # první spuštění = ukázka

        theme.setup_window(root, "PLC Studio", topmost=bool(self.settings.get("topmost")))
        root.geometry(self.settings.get("geometry") or "1240x820")
        root.minsize(1100, 680)
        theme.apply_styles(root)
        root.report_callback_exception = self._on_callback_error
        root.protocol("WM_DELETE_WINDOW", self.close)
        self._build_chrome()
        self.render()

    # --- jádro -----------------------------------------------------------------

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
        self.set_project(d.get("prj") or {}, d.get("ai"))
        step = d.get("step", 0)
        self.step = step if step == "help" or (isinstance(step, int) and 0 <= step < len(STEPS)) else 0

    def set_project(self, prj: dict, ai: dict | None = None) -> None:
        """Nahradí projekt; chybějící části doplní z prázdného projektu."""
        base = self.core("blankProject")
        base.update(prj if isinstance(prj, dict) else {})
        self.prj = base
        self.ai = ai if isinstance(ai, dict) and "turns" in ai else new_ai()
        self.ai.setdefault("last", None)
        self.ai.setdefault("draft", "")

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
        titles = ttk.Frame(head)
        titles.pack(side="left")
        line = ttk.Frame(titles)
        line.pack(anchor="w")
        ttk.Label(line, text="PLC STUDIO", style="Header.TLabel").pack(side="left")
        self._proj_lbl = ttk.Label(line, text="", style="Section.TLabel")
        self._proj_lbl.pack(side="left", padx=(10, 0))
        ttk.Label(titles, text="AI návrh · schéma · kód · dokumentace · 7 platforem",
                  style="Dim.TLabel").pack(anchor="w")

        logo = theme.load_logo(36)
        if logo is not None:
            ttk.Label(head, image=logo).pack(side="right", padx=(10, 0))
        self._var_topmost = tk.BooleanVar(value=bool(self.settings.get("topmost")))
        ttk.Checkbutton(head, text="nad okny", variable=self._var_topmost,
                        command=self._toggle_topmost).pack(side="right", padx=(8, 0))
        ttk.Button(head, text="Uložit projekt…", command=self.save_project_dialog
                   ).pack(side="right", padx=(6, 0))
        ttk.Button(head, text="Otevřít projekt…", command=self.open_project_dialog
                   ).pack(side="right")

        ttk.Separator(frm, orient="horizontal").pack(fill="x", pady=(10, 8))

        # lišta kroků
        nav = ttk.Frame(frm)
        nav.pack(fill="x")
        self._step_btns = []
        for i, name in enumerate(STEPS):
            b = ttk.Button(nav, text=f"{i + 1} · {name}", style="Step.TButton",
                           command=lambda i=i: self.goto(i))
            b.pack(side="left", padx=(0, 4))
            self._step_btns.append(b)
        self._help_btn = ttk.Button(nav, text="? Nápověda", style="Step.TButton",
                                    command=lambda: self.goto("help"))
        self._help_btn.pack(side="right")

        # patička (pack před obsahem, ať ji obsah nevytlačí z okna)
        foot = ttk.Frame(frm)
        foot.pack(side="bottom", fill="x")
        ttk.Separator(frm, orient="horizontal").pack(side="bottom", fill="x", pady=(8, 8))
        self._status = ttk.Label(foot, text="", style="Dim.TLabel")
        self._status.pack(side="left")
        self._next_btn = ttk.Button(foot, text="Pokračovat →", style="Accent.TButton",
                                    command=lambda: self.goto(self.step + 1))
        self._next_btn.pack(side="right")
        self._prev_btn = ttk.Button(foot, text="← Zpět",
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

    def open_sim(self, scenario: str = "nominal") -> None:
        self.ui.update(prog_tab=1, sim_scenario=scenario)
        self.goto(6)

    def update_title(self) -> None:
        name = self.prj["meta"]["name"]
        self._proj_lbl.configure(text=f"— {name}" if name else "")
        self.root.title(f"PLC Studio — {name}" if name else "PLC Studio")

    def render(self) -> None:
        """Překreslí lištu kroků a obsah aktuálního kroku."""
        for i, b in enumerate(self._step_btns):
            done = self._step_done(i)
            b.configure(style="StepOn.TButton" if i == self.step
                        else "StepDone.TButton" if done else "Step.TButton",
                        text=f"{'✔ ' if done and i != self.step else ''}{i + 1} · {STEPS[i]}")
        self._help_btn.configure(style="StepOn.TButton" if self.step == "help" else "Step.TButton")
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
            self._report(f"Jádro hlásí chybu: {exc}", traceback.format_exc())
            ttk.Label(self.view, text=f"⚠ Krok se nepodařilo vykreslit: {exc}",
                      style="Err.TLabel").pack(anchor="w")

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
        self.set_status("Zkopírováno do schránky.")

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
        self._report(f"Chyba: {exc}  (podrobnosti v {self.home / 'plc_studio.log'})", detail)

    # --- projekt: ukázky, otevření, uložení -------------------------------------------------

    def confirm_replace(self, what: str) -> bool:
        """Před zahozením rozpracovaného návrhu se zeptá."""
        if not self.prj["devices"]:
            return True
        return messagebox.askyesno(
            "Nahradit návrh?", f"{what} nahradí aktuální návrh "
            f"({len(self.prj['devices'])} zařízení). Pokračovat?", parent=self.root)

    def load_sample(self, kind: str, *, render: bool = True) -> None:
        self.prj = self.core("sampleSmall" if kind == "small" else "sampleComplex")
        self.ai = self.bridge.ai("seedFromProject", self.prj, self.SAMPLE_DESC[kind],
                                 SAMPLE_NOTE[kind])
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
        name = (self.prj["meta"]["name"] or "plc-projekt") + PROJECT_EXT
        path = filedialog.asksaveasfilename(
            parent=self.root, title="Uložit projekt", initialfile=name,
            initialdir=self.settings.get("last_dir") or None, defaultextension=".json",
            filetypes=[("Projekt PLC Studio", "*" + PROJECT_EXT), ("JSON", "*.json")])
        if not path:
            return
        try:
            Path(path).write_text(self.project_payload(), encoding="utf-8")
        except OSError as exc:
            messagebox.showerror("Uložení se nezdařilo", str(exc), parent=self.root)
            return
        self.settings["last_dir"] = str(Path(path).parent)
        self.set_status(f"Projekt uložen: {path}")

    def open_project_dialog(self) -> None:
        path = filedialog.askopenfilename(
            parent=self.root, title="Otevřít projekt",
            initialdir=self.settings.get("last_dir") or None,
            filetypes=[("Projekt PLC Studio", "*" + PROJECT_EXT), ("JSON", "*.json"),
                       ("Všechny soubory", "*.*")])
        if path:
            self.open_project(path)

    def open_project(self, path: str | Path) -> bool:
        try:
            d = json.loads(Path(path).read_text(encoding="utf-8-sig"))
            if not isinstance(d, dict):
                raise ValueError("soubor neobsahuje objekt návrhu")
            prj = d.get("prj") or d
            if "devices" not in prj or "meta" not in prj:
                raise ValueError("chybí části návrhu (meta, devices)")
        except (OSError, ValueError) as exc:
            messagebox.showerror("Projekt nejde otevřít", f"Neplatný soubor návrhu:\n{exc}",
                                 parent=self.root)
            return False
        self.set_project(prj, d.get("ai"))
        self.settings["last_dir"] = str(Path(path).parent)
        self.step = 0
        self.save()
        self.render()
        self.set_status(f"Projekt načten: {path}")
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
