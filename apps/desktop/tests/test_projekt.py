"""Krok 1 Projekt: číslo projektu, zákazník, datum zahájení, víceřádkový popis, složka dat projektu
a „Uložit vše do složky projektu“ (datadir.py) — do dočasné složky, bez volání API.

Spuštění (z apps/desktop):  python -m unittest tests.test_projekt -v
"""

from __future__ import annotations

import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ["PLCSTUDIO_HOME"] = tempfile.mkdtemp(prefix="plcstudio_test_projekt_")

import tkinter as tk  # noqa: E402
from tkinter import ttk  # noqa: E402

from plc_studio import datadir, project  # noqa: E402
from plc_studio.app import App  # noqa: E402
from plc_studio.widgets import file_prefix  # noqa: E402


def walk(widget):
    for w in widget.winfo_children():
        yield w
        yield from walk(w)


class NormalizeTest(unittest.TestCase):
    def test_meta_fields(self):
        blank = {"meta": {"name": "", "desc": ""}, "platforms": [], "devices": [], "io": [],
                 "program": {"seq": []}, "nextId": 1}
        raw = {"meta": {"name": "A", "desc": "a\nb", "number": "2610705", "customer": "ACME",
                        "startDate": "2026-10-08", "dataDir": "D:\\Projekty\\2610705"}, "devices": []}
        out = project.normalize(raw, blank, {}, {})
        for k in ("number", "customer", "startDate", "dataDir"):
            self.assertEqual(out["meta"][k], raw["meta"][k])
        self.assertEqual(out["meta"]["desc"], "a\nb")
        bad = {"meta": {"name": "A", "desc": "", "number": "  ", "customer": 5,
                        "startDate": "2026-02-30", "dataDir": ""}, "devices": []}
        out = project.normalize(bad, blank, {}, {})
        for k in ("number", "customer", "startDate", "dataDir"):
            self.assertNotIn(k, out["meta"])


class ProjektStepTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = tk.Tk()
        cls.app = App(cls.root)
        cls.root.update()

    @classmethod
    def tearDownClass(cls):
        cls.app.close()

    def setUp(self):
        self.app.errors.clear()
        self.app.ui.clear()
        self.app.load_sample("small")
        self.app.prj["platforms"] = ["siemens", "codesys"]
        self.tmp = Path(tempfile.mkdtemp(prefix="plcdesk_datadir_"))

    def tearDown(self):
        self.app.wait_jobs(300)
        shutil.rmtree(self.tmp, ignore_errors=True)
        self.assertEqual(self.app.errors, [], "callback okna skončil chybou")

    def show(self):
        self.app.goto(0)
        self.root.update()

    def texts(self, cls):
        return [str(w.cget("text")) for w in walk(self.app.root) if isinstance(w, cls)]

    def test_no_sample_buttons_and_title(self):
        self.show()
        btns = self.texts(ttk.Button)
        self.assertFalse([t for t in btns if "Ukázka" in t], btns)
        self.assertIn("Uložit vše do složky projektu", btns)
        self.assertIn("Vybrat…", btns)
        self.app.prj["meta"].update(number="2610705", customer="ACME")
        self.app.update_title()
        self.assertEqual(self.root.title(), "PLCdesk — 2610705 · " + self.app.prj["meta"]["name"] + " · ACME")
        del self.app.prj["meta"]["number"], self.app.prj["meta"]["customer"]
        self.app.update_title()
        self.assertEqual(self.root.title(), "PLCdesk — " + self.app.prj["meta"]["name"])

    def test_multiline_desc_saved(self):
        self.show()
        desc = self.app.ui["projekt"]["desc_widget"]
        desc.delete("1.0", "end")
        desc.insert("1.0", "První řádek\nDruhý řádek\n\nOdstavec")
        self.root.update()
        desc.event_generate("<FocusOut>")
        self.root.update()
        self.assertEqual(self.app.prj["meta"]["desc"], "První řádek\nDruhý řádek\n\nOdstavec")
        self.assertTrue(any(isinstance(w, ttk.Scrollbar) for w in walk(desc.master)))

    def test_start_date_parse(self):
        self.show()
        ent, commit = self.app.ui["projekt"]["date_entry"]
        ent.delete(0, "end")
        ent.insert(0, "8. 10. 2026")
        commit()
        self.assertEqual(self.app.prj["meta"]["startDate"], "2026-10-08")
        self.assertEqual(ent.get(), "8. 10. 2026")
        ent.delete(0, "end")
        ent.insert(0, "31. 2. 2026")
        commit()
        self.assertEqual(self.app.prj["meta"]["startDate"], "2026-10-08", "neplatné datum nic nezmění")
        ent.delete(0, "end")
        commit()
        self.assertNotIn("startDate", self.app.prj["meta"])

    def test_initial_dir_and_prefix(self):
        self.app.prj["meta"]["dataDir"] = str(self.tmp)
        d = datadir.initial_dir(self.app, "kod/siemens")
        self.assertEqual(Path(d), self.tmp / "kod" / "siemens")
        self.assertTrue(Path(d).is_dir())
        missing = self.tmp / "neni" / "tu"
        self.app.prj["meta"]["dataDir"] = str(missing)
        self.app.settings["last_dir"] = str(self.tmp)
        self.assertEqual(datadir.initial_dir(self.app, "vykresy"), str(self.tmp))
        self.assertFalse(missing.exists(), "neexistující kořen se nevytváří")
        self.assertEqual(file_prefix(self.app), "")
        self.app.prj["meta"]["number"] = "26/107"
        self.assertEqual(file_prefix(self.app), "26_107_")

    def test_missing_root_needs_confirmation(self):
        missing = self.tmp / "z_jineho_pc"
        self.app.prj["meta"]["dataDir"] = str(missing)
        with mock.patch("plc_studio.datadir.messagebox.askyesnocancel", return_value=None):
            self.assertIsNone(datadir.ensure_root(self.app))
        self.assertFalse(missing.exists())
        with mock.patch("plc_studio.datadir.messagebox.askyesnocancel", return_value=True):
            self.assertEqual(datadir.ensure_root(self.app), missing)
        self.assertTrue(missing.is_dir())
        self.show()                                  # varování v kroku se vykreslí bez chyby

    def test_save_all_to_project_folder(self):
        meta = self.app.prj["meta"]
        meta.update(number="2610705", customer="ACME", startDate="2026-10-05", dataDir=str(self.tmp),
                    desc="Linka\nDruhý řádek")
        done = []
        job = datadir.save_all(self.app, ask=False, on_done=done.append)
        self.assertIsNotNone(job)
        self.app.wait_jobs(600)
        self.assertEqual(len(done), 1)
        s = done[0]
        self.assertIsNotNone(s, "uložení se nezdařilo")
        root = self.tmp
        readme = (root / "kod" / "siemens" / "README.txt").read_text(encoding="utf-8")
        self.assertIn("2610705", readme)
        self.assertIn("ACME", readme)
        self.assertTrue((root / "kod" / "codesys" / "PLCopen_Import.xml").exists())
        docs = list((root / "dokumentace").glob("*.md"))
        self.assertTrue(docs)
        self.assertIn("**Číslo projektu:** 2610705", docs[0].read_text(encoding="utf-8"))
        self.assertTrue(list((root / "vykresy").glob("*.svg")))
        self.assertTrue((root / "kusovnik" / "09_kusovnik.csv").exists())
        self.assertTrue((root / "hmi" / "hmi_siemens.xlsx").exists())
        proj = root / ("2610705_" + meta["name"] + ".plcstudio.json")
        self.assertTrue(proj.exists(), sorted(p.name for p in root.iterdir()))
        # DXF podle licence: Free je zamyká (přehled je hlásí), Pro / Firma je uloží
        gate = self.app.lic.gate()
        dxf = list((root / "vykresy").glob("*.dxf"))
        if gate and not gate.get("canDxf"):
            self.assertFalse(dxf)
            self.assertGreater(s["nblocked"], 0)
        else:
            self.assertTrue(dxf)
        for d in ("kod", "dokumentace", "vykresy", "kusovnik", "hmi"):
            self.assertGreater(s["dirs"].get(d, 0), 0, d)
        self.assertEqual(sum(s["dirs"].values()) + 1, s["total"])


if __name__ == "__main__":
    unittest.main()
