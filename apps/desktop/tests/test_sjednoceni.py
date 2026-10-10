"""Sjednocení web × desktop (2026-10-10): chyby návrhu v kroku Generovat, kontrola zařízení pod
tabulkou, varování o neuloženém stavu, servoosa na kartách platforem, takt návrhu AI, převzetí
návrhu AI a přidání / parametry / odebrání zařízení přes jádro, potvrzení nahrazení projektu
a klávesové zkratky (Ctrl+S, Ctrl+O, Alt+← / →, F1).

Spuštění (z apps/desktop):  python -m unittest tests.test_sjednoceni -v
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ["PLCSTUDIO_HOME"] = tempfile.mkdtemp(prefix="plcstudio_aligntest_")

import tkinter as tk  # noqa: E402
from tkinter import ttk  # noqa: E402

from plc_studio import app as app_mod  # noqa: E402
from plc_studio.app import App  # noqa: E402
from plc_studio.widgets import Table  # noqa: E402

SAMPLES = Path(__file__).resolve().parents[3] / "samples"


def walk(widget):
    for w in widget.winfo_children():
        yield w
        yield from walk(w)


class AlignTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = tk.Tk()
        cls.app = App(cls.root)
        cls.root.update()

    @classmethod
    def tearDownClass(cls):
        cls.app.close()

    def setUp(self):
        self.app.wait_jobs(300)
        self.app.errors.clear()
        self.app.ui.clear()

    def tearDown(self):
        self.assertEqual(self.app.errors, [], "callback okna skončil chybou")

    # --- pomůcky -------------------------------------------------------------------

    def goto(self, step):
        self.app.goto(step)
        self.root.update()
        self.assertTrue(self.app.wait_jobs(300))

    def texts(self, parent=None):
        out = []
        for w in walk(parent or self.app.view):
            try:
                out.append(str(w.cget("text")))
            except tk.TclError:
                pass
        return out

    def click(self, text):
        for w in walk(self.app.view):
            if isinstance(w, ttk.Button) and str(w.cget("text")) == text:
                w.invoke()
                self.root.update()
                return
        self.fail(f"tlačítko {text!r} není na obrazovce")

    def status(self) -> str:
        return str(self.app._status.cget("text"))

    def dev(self, name):
        return next(d for d in self.app.prj["devices"] if d["name"] == name)

    def ev(self, widget=None):
        return SimpleNamespace(widget=widget or self.app.view)

    # --- krok 8 Generovat: chyby návrhu ---------------------------------------------------

    def test_generate_shows_design_errors_with_links(self):
        self.app.load_sample("small")
        self.app.gen_errors = None
        self.goto(7)
        self.assertIsNone(self.app.gen_errors)                     # vzor bez chyb: žádné upozornění
        self.app.prj["program"]["seq"][0]["timeS"] = 1e9          # čas kroku nad 24 h = chyba návrhu
        self.goto(7)
        box = self.app.gen_errors
        self.assertTrue(box.winfo_exists())
        joined = " ".join(self.texts(box))
        self.assertIn("Návrh obsahuje chyby", joined)
        self.assertIn("Otevřít krok Program →", joined)
        link = next(w for w in walk(box) if getattr(w, "invoke", None) and "Program" in str(w.cget("text")))
        link.invoke()
        self.root.update()
        self.assertEqual(self.app.step, 6)

    # --- krok 4 Zařízení ----------------------------------------------------------------

    def test_device_issues_below_table(self):
        self.app.load_sample("small")
        b1 = self.dev("B1")
        b1["limHi"], b1["limLo"] = 1, 5                               # meze obráceně → nález kontroly
        self.goto(3)
        rows = [w for w in walk(self.app.view) if hasattr(w, "issues")]
        self.assertTrue(rows and any(i["where"] == "B1" for i in rows[0].issues))
        self.assertTrue(any("B1 —" in t for t in self.texts()))

    def test_add_device_checks_in_core(self):
        self.app.reset_project()
        self.goto(3)
        var_cls = next(w for w in walk(self.app.view) if isinstance(w, ttk.Combobox))
        var_cls.set(self.app.CLS["AnalogIn"]["label"])
        var_cls.event_generate("<<ComboboxSelected>>")
        self.root.update()
        # mez min ≥ mez max: zařízení se nepřidá, hláška z jádra
        entries = [w for w in walk(self.app.view) if type(w) is ttk.Entry]
        lim = [e for e in entries if e.get() == ""][-2:]      # pole mez min / mez max (prázdná)
        lim[0].insert(0, "8")
        lim[1].insert(0, "2")
        self.click("Přidat zařízení")
        self.assertEqual(self.app.prj["devices"], [])
        self.assertIn("Mez min musí být menší", self.status())
        lim[1].delete(0, "end")
        lim[1].insert(0, "9")
        self.click("Přidat zařízení")
        d = self.app.prj["devices"][0]
        self.assertEqual((d["cls"], d["limLo"], d["limHi"]), ("AnalogIn", 8, 9))
        self.assertTrue(d.get("guid"))
        self.assertTrue(any(e["devId"] == d["id"] for e in self.app.prj["io"]))

    def test_params_rejected_by_core(self):
        self.app.load_sample("small")
        b1 = self.dev("B1")
        res = self.app.edit("setDeviceParams", b1["id"], {"limLo": 99, "limHi": 1})
        self.assertFalse(res["ok"])
        self.assertIsNone(self.dev("B1").get("limLo"))
        res = self.app.edit("setDeviceParams", b1["id"], {"limLo": 1, "limHi": 99})
        self.assertTrue(res["ok"], res)
        self.assertEqual((self.dev("B1")["limLo"], self.dev("B1")["limHi"]), (1, 99))

    def test_delete_used_device_asks_and_removes_steps(self):
        self.app.load_sample("small")
        self.goto(3)
        m1 = self.dev("M1")
        tbl = next(w for w in walk(self.app.view) if isinstance(w, Table))
        tbl.select(m1["id"])
        self.root.update()
        with mock.patch("tkinter.messagebox.askyesno", return_value=False) as ask:
            self.click("Odstranit vybrané")
        ask.assert_called_once()
        self.assertIn("2 kroky sekvence", ask.call_args[0][1])
        self.assertIsNotNone(self.app.dev_by_id(m1["id"]))
        tbl = next(w for w in walk(self.app.view) if isinstance(w, Table))
        tbl.select(m1["id"])
        with mock.patch("tkinter.messagebox.askyesno", return_value=True):
            self.click("Odstranit vybrané")
        self.assertIsNone(self.app.dev_by_id(m1["id"]))
        self.assertFalse(any(s["dev"] == m1["id"] for s in self.app.prj["program"]["seq"]))

    # --- stav na disku --------------------------------------------------------------------

    def test_failed_state_save_shows_persistent_warning(self):
        self.goto(0)
        with mock.patch.object(self.app, "_write_json", return_value="disk je plný"):
            self.app._flush()
            self.root.update()
            self.assertTrue(self.app._save_warn.winfo_ismapped())
            self.assertIn("disk je plný", str(self.app._save_warn.cget("text")))
            self.goto(1)                                           # varování přežije překreslení kroku
            self.assertTrue(self.app._save_warn.winfo_ismapped())
        self.app._flush()                                          # uložení zase funguje → varování zmizí
        self.root.update()
        self.assertFalse(self.app._save_warn.winfo_ismapped())

    # --- krok 3 Platformy a 2 AI návrh -----------------------------------------------------

    def test_axis_warning_on_platform_cards(self):
        self.assertTrue(self.app.open_project(SAMPLES / "12_portalovy_manipulator_PM-12.plcstudio.json"))
        self.goto(2)
        warns = [w for w in walk(self.app.view) if getattr(w, "axis_warning", False)]
        unsupported = [k for k in self.app.PLAT if not self.app.core("axisSupport", self.app.prj, k)["ok"]]
        self.assertEqual(len(warns), len(unsupported))
        self.assertIn("mitsubishi", unsupported)
        self.assertTrue(all(w.tip_text for w in warns))
        self.app.load_sample("small")                              # bez osy žádné varování
        self.goto(2)
        self.assertFalse([w for w in walk(self.app.view) if getattr(w, "axis_warning", False)])

    def test_ai_proposal_takt_and_apply_via_core(self):
        self.app.reset_project()
        last = self.app.bridge.ai("aiNorm", {
            "devices": [{"name": "M1", "cls": "Motor", "desc": "pás"}, {"name": "m1", "cls": "Motor", "desc": "druhý"},
                        {"name": "S1", "cls": "DI", "desc": "E-stop"}],
            "estop": "S1", "seq": [{"dev": "m1", "act": "start", "cond": "fbk", "timeS": 3}], "takt": 12})
        self.app.ai = {"turns": [{"role": "user", "content": "pás"}], "last": last, "draft": ""}
        self.goto(1)
        self.assertIn("Takt: 12 s", self.texts())
        self.click("Převzít návrh (nahradí zařízení)")
        names = [d["name"] for d in self.app.prj["devices"]]
        self.assertEqual(names, ["M1", "M2", "S1"])                 # m1 = duplicita M1 → další volné
        self.assertEqual(self.app.step, 3)
        self.assertEqual(self.app.prj["meta"]["takt"], 12)
        self.assertEqual(self.app.prj["program"]["seq"][0]["dev"], self.dev("M2")["id"])
        self.assertIn("m1 → M2", self.status())

    # --- potvrzení nahrazení projektu -------------------------------------------------------

    def test_confirm_replace_only_for_non_empty_project(self):
        self.app.reset_project()
        with mock.patch("tkinter.messagebox.askyesno", return_value=False) as ask:
            self.assertTrue(self.app.confirm_replace("Příklad"))    # prázdný (i s navrženým číslem)
            ask.assert_not_called()
            self.app.ai["draft"] = "rozepsaný popis stroje"
            self.assertFalse(self.app.confirm_replace("Příklad"))
            ask.assert_called_once()
        self.app.ai["draft"] = ""
        self.app.prj["meta"]["name"] = "Lis"
        with mock.patch("tkinter.messagebox.askyesno", return_value=True) as ask:
            self.assertTrue(self.app.confirm_replace("Příklad"))
            self.assertIn("Lis", ask.call_args[0][1])
        self.app.ui["ai"] = {"busy": True, "token": 0, "status": ""}   # během odpovědi AI ne
        with mock.patch("tkinter.messagebox.showwarning") as warn:
            self.assertFalse(self.app.confirm_replace("Příklad"))
            warn.assert_called_once()
        self.app.ui.clear()
        # Nový prázdný projekt: prázdný se neptá
        self.app.reset_project()
        self.goto(0)
        with mock.patch("tkinter.messagebox.askyesno") as ask:
            self.click("Nový prázdný projekt")
            ask.assert_not_called()
        # otevření souboru se ptá (neprázdný návrh) ještě před výběrem souboru
        self.app.load_sample("small")
        with mock.patch("tkinter.messagebox.askyesno", return_value=False) as ask, \
                mock.patch.object(app_mod.filedialog, "askopenfilename") as pick:
            self.app.open_project_dialog()
            ask.assert_called_once()
            pick.assert_not_called()

    # --- klávesové zkratky -------------------------------------------------------------------

    def test_shortcuts_steps_and_help(self):
        self.goto(0)
        self.assertEqual(self.app._key_step(self.ev(), 1), "break")
        self.assertEqual(self.app.step, 1)
        self.app._key_step(self.ev(), -1)
        self.assertEqual(self.app.step, 0)
        self.app._key_step(self.ev(), -1)                        # před prvním krokem nic
        self.assertEqual(self.app.step, 0)
        self.goto(4)
        self.app._key_help(self.ev())
        self.assertEqual(self.app.step, "help")
        self.app._key_step(self.ev(), -1)                        # z Nápovědy zpět do kroku
        self.assertEqual(self.app.step, 4)
        # v dialogovém okně zkratky nepracují
        top = tk.Toplevel(self.root)
        try:
            self.app._key_step(self.ev(top), 1)
            self.assertEqual(self.app.step, 4)
        finally:
            top.destroy()
        # vazby: Ctrl+S / Ctrl+O / Alt+šipky / F1 na celé aplikaci, Ctrl+O v poli Text přebitá
        for seq in ("<Control-s>", "<Control-o>", "<Alt-Left>", "<Alt-Right>", "<F1>"):
            self.assertTrue(self.root.bind_all(seq), seq)
        self.assertTrue(self.root.bind_class("Text", "<Control-o>"))
        # zkratky popisuje Nápověda
        self.goto("help")
        txt = next(w for w in walk(self.app.view) if isinstance(w, tk.Text))
        self.assertIn("Klávesové zkratky", txt.get("1.0", "end"))
        self.assertIn("Ctrl+S", txt.get("1.0", "end"))

    def test_ctrl_s_saves_and_ctrl_o_opens(self):
        self.app.load_sample("small")
        self.goto(0)
        path = Path(tempfile.mkdtemp(prefix="plcdesk_ctrls_")) / "projekt.plcstudio.json"
        with mock.patch.object(app_mod.filedialog, "asksaveasfilename", return_value=str(path)) as dlg:
            self.app._key_save(self.ev())
            dlg.assert_called_once()
            self.assertTrue(path.exists())
            # rozepsané pole se před uložením uloží (název projektu), podruhé bez dialogu do téhož souboru
            ent = next(w for w in walk(self.app.view) if type(w) is ttk.Entry)
            ent.delete(0, "end")
            ent.insert(0, "Přejmenovaná stanice")
            self.root.update()
            self.app._key_save(self.ev(ent))
            dlg.assert_called_once()
        saved = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(saved["prj"]["meta"]["name"], "Přejmenovaná stanice")
        self.assertIn(str(path), self.status())
        # Ctrl+O: neprázdný návrh se zeptá, pak otevře soubor; Ctrl+S pak ukládá do něj
        other = SAMPLES / "01_pasovy_dopravnik_vyhazovac.plcstudio.json"
        with mock.patch("tkinter.messagebox.askyesno", return_value=True) as ask, \
                mock.patch.object(app_mod.filedialog, "askopenfilename", return_value=str(other)):
            self.assertEqual(self.app._key_open(self.ev()), "break")
            ask.assert_called_once()
        data = json.loads(other.read_text(encoding="utf-8"))
        self.assertEqual(self.app.prj["meta"]["name"], (data.get("prj") or data)["meta"]["name"])
        self.assertEqual(self.app._project_file[1], str(other))
        self.app._project_file = None                 # další testy nesmí uložit do příkladu v repozitáři


if __name__ == "__main__":
    unittest.main()
