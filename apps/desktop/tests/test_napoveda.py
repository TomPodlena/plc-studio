"""Nápověda (2026-10-12): obsah z jádra (help.ts) přes most, tlačítko ? v záhlaví každého kroku a panel
ke kroku, F1, krok Nápověda s hledáním a kapitolami, úvodní průvodce (Zpět / Další / Přeskočit, zápis do
settings.json), přepnutí jazyka.

Spuštění (z apps/desktop):  python -m unittest tests.test_napoveda -v
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ["PLCSTUDIO_HOME"] = tempfile.mkdtemp(prefix="plcstudio_helptest_")

import tkinter as tk  # noqa: E402
from tkinter import ttk  # noqa: E402

from plc_studio import helppanel  # noqa: E402
from plc_studio.app import STEPS, App  # noqa: E402


def walk(widget):
    for w in widget.winfo_children():
        yield w
        yield from walk(w)


class HelpTest(unittest.TestCase):
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
        helppanel.HelpPanel.close_current()
        if helppanel.Tour.current is not None:
            helppanel.Tour.current.end(None)
        if self.app.lang != "cs":
            self.app.set_language("cs")
        self.assertEqual(self.app.errors, [], "callback okna skončil chybou")

    def goto(self, step):
        self.app.goto(step)
        self.root.update()
        self.assertTrue(self.app.wait_jobs(300))
        self.root.update()

    def ev(self, widget=None):
        return type("E", (), {"widget": widget or self.root})()

    def test_bridge_help_data(self):
        d = helppanel.help_data(self.app)
        ids = [c["id"] for c in d["chapters"]]
        self.assertEqual(len(d["stepIds"]), len(STEPS))
        for sid in d["stepIds"]:
            self.assertIn(sid, ids)
        self.assertIn("simulace", ids, "kapitola jen pro desktop")
        for c in d["chapters"]:
            for x in c["steps"] + c["tips"]:
                self.assertNotEqual(x.get("only"), "web", c["id"])
        self.assertTrue(5 <= len(d["tour"]) <= 7)
        self.assertTrue(d["site"]["kusovnik"].endswith("/napoveda/kusovnik/"))
        self.assertTrue(d["video"].endswith("/video/?v=cs"), d["video"])
        self.assertEqual(d["ui"]["video"], "Videoprůvodce (asi 10 min)")
        hits = helppanel.search(self.app, "kusovnik")
        self.assertEqual(hits[0]["id"], "kusovnik")

    def test_question_button_in_every_step_opens_panel(self):
        self.app.load_sample("small")
        seen = set()
        for i in range(len(STEPS)):
            self.goto(i)
            btn = getattr(self.app, "_step_help_btn", None)
            self.assertIsNotNone(btn, f"krok {i}: tlačítko ?")
            self.assertTrue(btn.winfo_exists(), f"krok {i}: tlačítko ? je na obrazovce")
            self.assertEqual(btn.help_step, i)
            btn.invoke()
            self.root.update()
            p = helppanel.HelpPanel.current
            self.assertIsNotNone(p)
            self.assertEqual(p.cid, helppanel.chapter_for_step(self.app, i))
            body = p.txt.get("1.0", "end")
            self.assertTrue(len(body) > 80, f"krok {i}: obsah kapitoly")
            seen.add(p.cid)
            p.close()
        self.assertEqual(len(seen), len(STEPS))

    def test_f1_toggles_and_follows_step(self):
        self.goto(5)
        self.app._key_help(self.ev())
        p = helppanel.HelpPanel.current
        self.assertEqual(p.cid, "schema")
        self.assertEqual(self.app.step, 5)
        # přechod na jiný krok s otevřeným panelem → kapitola nového kroku
        self.goto(7)
        self.assertEqual(helppanel.HelpPanel.current.cid, "generovat")
        # odkaz na související kapitolu + Zpět
        p = helppanel.HelpPanel.current
        p._see("licence")
        self.assertEqual(p.cid, "licence")
        self.assertIn("back", p.buttons)
        p.buttons["back"].invoke()
        self.assertEqual(p.cid, "generovat")
        with mock.patch("webbrowser.open") as op:
            p.buttons["web"].invoke()
        self.assertTrue(op.call_args[0][0].endswith("/napoveda/generovat/"))
        # F1 podruhé zavře; Esc v panelu zavře
        self.app._key_help(self.ev())
        self.assertIsNone(helppanel.HelpPanel.current)
        self.app._key_help(self.ev())
        helppanel.HelpPanel.current.win.event_generate("<Escape>")
        self.root.update()
        self.assertIsNone(helppanel.HelpPanel.current)

    def test_full_help_from_panel_and_search(self):
        self.goto(9)
        self.app._key_help(self.ev())
        helppanel.HelpPanel.current.buttons["full"].invoke()
        self.root.update()
        self.assertEqual(self.app.step, "help")
        self.assertIsNone(helppanel.HelpPanel.current)
        body = next(w for w in walk(self.app.view) if hasattr(w, "help_text"))
        txt = body.help_text
        content = txt.get("1.0", "end")
        for t in ("Obsah nápovědy", "1 · Projekt", "13 · Oživení", "Živá simulace a scénáře (desktop)",
                  "Škola PLC", "Klávesové zkratky", "Odkazy na dokumentaci platforem"):
            self.assertIn(t, content)
        self.assertIn("ch_kusovnik", txt.mark_names())
        # hledání bez diakritiky, výsledky nad obsahem
        body.help_entry._var.set("hlidaci cas")
        body.help_search()
        self.root.update()
        self.assertTrue(body.help_results.winfo_ismapped())
        self.assertTrue(body.help_hits)
        self.assertIn("program", [h["id"] for h in body.help_hits])
        self.assertTrue(body.help_results.tag_ranges("mark"), "zvýrazněná shoda")
        body.help_entry._var.set("qqqzzz")
        body.help_search()
        self.assertIn("Nic nenalezeno", body.help_results.get("1.0", "end"))
        body.help_entry._var.set("")
        body.help_search()
        self.root.update()
        self.assertFalse(body.help_results.winfo_ismapped())
        # odkaz na kapitolu v obsahu posune text
        body.help_goto("ozivovani")
        self.root.update()
        top = txt.index("@0,0")
        self.assertGreater(float(top), 2.0)

    def test_tour_steps_and_memory(self):
        self.app.settings.pop("tour", None)
        self.app.first_run = True
        self.app.quiet = False
        try:
            helppanel.maybe_start_tour(self.app)
        finally:
            self.app.quiet = True
        t = helppanel.Tour.current
        self.assertIsNotNone(t)
        self.root.update()
        self.assertEqual(str(self.app._step_btns[0].cget("style")), "Tour.TButton")
        t.next()
        self.assertEqual(t.i, 1)
        t.next()
        self.assertEqual(str(self.app._step_btns[1].cget("style")), "Tour.TButton")   # AI návrh / Zařízení
        self.assertNotEqual(str(self.app._step_btns[0].cget("style")), "Tour.TButton", "zvýraznění se vrátí")
        t.prev()
        self.assertEqual(t.i, 1)
        self.assertFalse(t.video.winfo_ismapped(), "odkaz na video jen na konci průvodce")
        while t.i < len(t.stops) - 1:
            t.next()
        self.root.update()
        self.assertTrue(t.video.winfo_ismapped(), "poslední zastavení: odkaz na videoprůvodce")
        self.assertTrue(t.video_url.endswith("/video/?v=cs"))
        while helppanel.Tour.current is not None:
            t.next()
        self.assertEqual(self.app.settings["tour"], "done")
        self.assertTrue(all(str(b.cget("style")) != "Tour.TButton" for b in self.app._step_btns))
        # zapamatováno → při dalším startu se neukáže
        helppanel.maybe_start_tour(self.app)
        self.assertIsNone(helppanel.Tour.current)
        # znovu z kroku Nápověda; Přeskočit
        self.goto("help")
        self.assertTrue(any(isinstance(w, ttk.Button) and str(w.cget("text")) == "▶ Videoprůvodce (asi 10 min) ↗"
                            for w in walk(self.app.view)), "tlačítko videoprůvodce v kroku Nápověda")
        btn = next(w for w in walk(self.app.view) if isinstance(w, ttk.Button) and str(w.cget("text")) == "Spustit průvodce")
        btn.invoke()
        self.root.update()
        self.assertIsNotNone(helppanel.Tour.current)
        helppanel.Tour.current.b_skip.invoke()
        self.assertIsNone(helppanel.Tour.current)
        self.assertEqual(self.app.settings["tour"], "skipped")

    def test_first_run_flag(self):
        # tento proces začal bez state.json → první spuštění
        self.assertTrue(self.app.first_run)

    def test_languages(self):
        for lang in ("en", "de", "es", "zh"):
            self.app.set_language(lang)
            self.root.update()
            self.goto(3)
            self.app._key_help(self.ev())
            p = helppanel.HelpPanel.current
            title = str(p.title.cget("text"))
            self.assertNotEqual(title, "Zařízení", lang)
            body = p.txt.get("1.0", "end")
            self.assertNotRegex(body, "[ěščřžůťď]", lang + ": čeština v panelu")
            p.close()
            self.goto("help")
            body = next(w for w in walk(self.app.view) if hasattr(w, "help_text"))
            self.assertNotIn("Obsah nápovědy", body.help_text.get("1.0", "end"), lang)


if __name__ == "__main__":
    unittest.main()
