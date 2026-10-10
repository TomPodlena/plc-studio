"""Odolnost desktopu proti poškozeným datům (test odolnosti 2026-10-08, apps/site/_shots/robust_desk).

Poškozený stav / nastavení / soubor projektu nesmí zabránit startu ani shodit krok; chyba kroku
nebo callbacku Tk = hláška + log, aplikace žije dál; rozepsané pole se uloží i při zavření okna
křížkem; formulář parametrů zařízení nic tiše nezahazuje. Model projektu normalizuje jádro
(``normalizeProject``) — stejné pravidlo jako web.

Spuštění (z apps/desktop):  python -m unittest tests.test_robust -v
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ["PLCSTUDIO_HOME"] = tempfile.mkdtemp(prefix="plcstudio_test_robust_")

import tkinter as tk  # noqa: E402
from tkinter import ttk  # noqa: E402

from plc_studio import app as appmod  # noqa: E402
from plc_studio.app import App, read_text_any  # noqa: E402
from plc_studio.steps import zarizeni  # noqa: E402

SAMPLE12 = Path(__file__).resolve().parents[3] / "samples" / "12_portalovy_manipulator_PM-12.plcstudio.json"


def walk(widget):
    for w in widget.winfo_children():
        yield w
        yield from walk(w)


class Home:
    """Dočasná složka stavu s předem zapsanými soubory; App nad ní."""

    def __init__(self, files: dict[str, object] | None = None):
        self.dir = Path(tempfile.mkdtemp(prefix="plcstudio_robust_"))
        for name, body in (files or {}).items():
            data = body if isinstance(body, (str, bytes)) else json.dumps(body, ensure_ascii=False)
            (self.dir / name).write_bytes(data if isinstance(data, bytes) else data.encode("utf-8"))
        self.root = tk.Tk()
        self.app = App(self.root, home=self.dir)
        self.root.update()

    def close(self):
        try:
            self.app.close()
        finally:
            shutil.rmtree(self.dir, ignore_errors=True)


def sample12() -> dict:
    d = json.loads(SAMPLE12.read_text(encoding="utf-8"))
    return d.get("prj") or d


class StartupTest(unittest.TestCase):
    def test_state_with_wrong_types_starts_and_drops_items(self):
        prj = sample12()
        di = next(d for d in prj["devices"] if d["cls"] == "DI")
        prj["program"]["estop"] = [di["id"]]
        prj["io"][0]["devId"] = [prj["io"][0]["devId"]]
        prj["program"]["interlocks"] = [{"x": 1}, di["id"]]
        prj["program"]["seq"][1]["dev"] = [prj["program"]["seq"][1]["dev"]]
        prj["platforms"] = ["siemens", ["codesys"]]
        next(d for d in prj["devices"] if d["cls"] == "Axis")["axis"] = "osa"
        h = Home({"state.json": {"prj": prj, "step": 3}})
        try:
            app = h.app
            n = len(sample12()["io"])
            self.assertEqual(app.prj["program"]["estop"], "")
            self.assertEqual(len(app.prj["io"]), n)        # sync doplní signál zahozeného řádku znovu
            self.assertEqual(app.prj["platforms"], ["siemens"])
            self.assertEqual(len(app.prj["program"]["seq"]), len(sample12()["program"]["seq"]) - 1)
            for step in (3, 5, 6):                         # osa bez konfigurace: kroky se vykreslí
                app.goto(step)
                h.root.update()
                app.wait_jobs(300)
            self.assertEqual(app.errors, [])
        finally:
            h.close()

    def test_unreadable_state_is_backed_up_and_app_starts_empty(self):
        h = Home({"state.json": "{nejde o JSON"})
        try:
            self.assertEqual(h.app.prj["devices"], [])
            self.assertTrue((h.dir / "state.json.corrupt").exists())
            self.assertEqual(len(h.app._startup_notes), 1)
        finally:
            h.close()

    def test_state_utf16_and_list(self):
        for body in ("[1, 2]".encode("utf-8"), json.dumps({"prj": "text"}).encode("utf-16")):
            h = Home({"state.json": body})
            try:
                self.assertEqual(h.app.prj["devices"], [])
                self.assertTrue((h.dir / "state.json.corrupt").exists())
            finally:
                h.close()

    def test_bad_settings(self):
        for settings in (["x"], {"geometry": "abc"}, {"geometry": 5}, {"geometry": "100000x5+1+1"},
                         {"lang": ["cs"], "topmost": "ano", "last_dir": 5}):
            h = Home({"settings.json": settings})
            try:
                self.assertIsInstance(h.app.settings, dict)
                self.assertEqual(h.app.errors, [])
            finally:
                h.close()


class RuntimeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.h = Home()
        cls.app = cls.h.app
        cls.root = cls.h.root

    @classmethod
    def tearDownClass(cls):
        cls.h.close()

    def setUp(self):
        self.app.wait_jobs(300)
        self.app.errors.clear()

    def test_render_error_of_step_shows_message(self):
        def boom(_app, _frame):
            raise TypeError("rozbitá data")
        orig = appmod.RENDERERS[3]
        appmod.RENDERERS[3] = boom
        try:
            self.app.goto(3)
            self.root.update()
        finally:
            appmod.RENDERERS[3] = orig
        texts = [str(w.cget("text")) for w in walk(self.app.view) if isinstance(w, ttk.Label)]
        self.assertTrue(any("Krok se nepodařilo vykreslit" in t and "rozbitá data" in t for t in texts), texts)
        self.assertEqual(len(self.app.errors), 1)
        self.app.errors.clear()
        self.app.goto(0)                                    # ostatní kroky fungují dál
        self.root.update()
        self.assertEqual(self.app.errors, [])

    def test_callback_error_is_reported_not_silent(self):
        try:
            raise ValueError("chyba v obsluze")
        except ValueError:
            self.app._on_callback_error(*sys.exc_info())
        self.assertEqual(len(self.app.errors), 1)
        self.assertIn("chyba v obsluze", str(self.app._status.cget("text")))
        log = (self.app.home / "plc_studio.log").read_text(encoding="utf-8")
        self.assertIn("chyba v obsluze", log)
        self.app.errors.clear()

    def test_open_project_encodings(self):
        tmp = Path(tempfile.mkdtemp(prefix="plcstudio_robust_open_"))
        try:
            prj = sample12()
            f16 = tmp / "p16.plcstudio.json"
            f16.write_bytes(json.dumps({"prj": prj}, ensure_ascii=False).encode("utf-16"))
            self.assertEqual(json.loads(read_text_any(f16))["prj"]["meta"]["name"], prj["meta"]["name"])
            with mock.patch.object(appmod.messagebox, "showerror") as err:
                self.assertTrue(self.app.open_project(f16))
                err.assert_not_called()
            png = tmp / "obrazek.png"
            png.write_bytes(b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR" + bytes(range(256)))
            with mock.patch.object(appmod.messagebox, "showerror") as err:
                self.assertFalse(self.app.open_project(png))
                self.assertIn("binární", err.call_args[0][1])
            # role / estop / devId jako seznam: projekt se otevře (vadné položky pryč)
            bad = sample12()
            bad["devices"][0]["role"] = ["run"]
            bad["io"][1]["devId"] = [1]
            fb = tmp / "bad.plcstudio.json"
            fb.write_text(json.dumps({"prj": bad}), encoding="utf-8")
            with mock.patch.object(appmod.messagebox, "showerror") as err:
                self.assertTrue(self.app.open_project(fb))
                err.assert_not_called()
            self.assertEqual(self.app.errors, [])
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_close_commits_focused_field(self):
        ent = ttk.Entry(self.app.view)
        ent.pack()
        got = []
        ent.bind("<FocusOut>", lambda _e: got.append(ent.get()))
        ent.insert(0, "ROZEPSANO")
        with mock.patch.object(self.root, "focus_get", return_value=ent):
            self.app._commit_focused()
        self.assertEqual(got, ["ROZEPSANO"])

    def test_reserved_folder_name(self):
        from plc_studio import datadir
        self.assertEqual(datadir.reserved_part("NUL"), "NUL")
        self.assertEqual(datadir.reserved_part("C:\\data\\com1\\x"), "com1")
        self.assertIsNone(datadir.reserved_part("C:\\data\\Linka"))
        old = dict(self.app.settings)
        try:
            datadir.set_root(self.app, "NUL")
            with mock.patch.object(datadir.messagebox, "askyesnocancel", return_value=True), \
                    mock.patch.object(datadir.messagebox, "showerror") as err:
                self.assertIsNone(datadir.ensure_root(self.app))
                self.assertIn("rezervované", err.call_args[0][1])
        finally:
            self.app.settings.clear()
            self.app.settings.update(old)

    def test_device_params_nothing_dropped_silently(self):
        sv = lambda v: tk.StringVar(master=self.root, value=v)   # noqa: E731
        with self.assertRaises(ValueError) as cm:
            zarizeni.read_params({"records": sv("1 = a @ 0; nesmysl; 1 = b"), "_app": self.app})
        self.assertIn("nesmysl", str(cm.exception))
        self.assertIn("1", str(cm.exception))
        ok = zarizeni.read_params({"records": sv("1 = a @ 0; 2 = b"), "_app": self.app})
        self.assertEqual([r["no"] for r in ok["records"]], [1, 2])
        # meze hodnot kontroluje jádro (deviceParamsProblem — formulář web i desktop)
        for cls, key, val in (("PropValve", "tol", "-1"), ("PropValve", "tolTimeS", "1e9"), ("PosDrive", "selBits", "99"),
                              ("PosDrive", "travelS", "0"), ("Vfd", "rampS", "1e9"), ("AnalogOut", "setpoint", "1e39")):
            params = zarizeni.read_params({key: sv(val), "_app": self.app})
            self.assertTrue(self.app.core("deviceParamsProblem", {"cls": cls}, params), key)
        self.assertEqual(zarizeni.read_params({"selBits": sv("3"), "_app": self.app})["selBits"], 3)

    def test_takt_invalid_is_reported(self):
        self.app.goto(0)
        self.root.update()
        entries = [w for w in walk(self.app.view) if type(w) is ttk.Entry]
        # pole taktu = třetí pole v mřížce (název, číslo, takt)
        takt = entries[2]
        takt.delete(0, "end")
        takt.insert(0, "-5")
        self.root.update()
        self.assertNotIn("takt", self.app.prj["meta"])
        self.assertIn("-5", str(self.app._status.cget("text")))
        takt.delete(0, "end")
        self.root.update()


if __name__ == "__main__":
    unittest.main()
