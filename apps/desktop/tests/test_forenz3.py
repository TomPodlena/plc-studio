"""Regrese nálezů forenzního testu desktopu (kolo 2, 2026-10-10) — H1–H4, M1–M8, L1–L10.

Spuštění (z apps/desktop):  python -m unittest tests.test_forenz3 -v
"""

from __future__ import annotations

import gc
import json
import os
import sys
import tempfile
import time
import tkinter as tk
import unittest
from pathlib import Path
from tkinter import font as tkfont
from tkinter import ttk
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("PLCSTUDIO_HOME", tempfile.mkdtemp(prefix="plcstudio_forenz3_"))

from plc_studio import app as appmod, datadir, instance, theme  # noqa: E402
from plc_studio.app import App, parse_json, read_text_any  # noqa: E402
from plc_studio.importer import ImportWizard, open_wizard  # noqa: E402
from plc_studio.license import FREE_IO_LIMIT, License  # noqa: E402
from plc_studio.widgets import Measure, Table  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
SAMPLES = REPO / "samples"
S11 = SAMPLES / "11_podavaci_lisovaci_stanice_PS-11.plcstudio.json"


def tcl_commands(root) -> int:
    return len(root.tk.splitlist(root.tk.call("info", "commands")))


class Forenz3Test(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.home = Path(tempfile.mkdtemp(prefix="plcstudio_forenz3_home_"))
        cls.root = tk.Tk()
        cls.app = App(cls.root, home=cls.home)
        cls.root.update()

    @classmethod
    def tearDownClass(cls):
        cls.app.close()

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="plcstudio_forenz3_"))
        self.app.settings.pop("projects_root", None)

    def walk(self, w=None):
        for c in (w or self.app.view).winfo_children():
            yield c
            yield from self.walk(c)

    # --- H1: nabídka a knihovna přežijí restart i Otevřít projekt ------------------------------

    def test_h1_quote_and_library_survive_open_and_restart(self):
        self.assertTrue(self.app.open_project(S11))
        lib = {"format": "plcdesk-library", "schema": 1, "name": "ACME", "version": "1.0.0", "updated": "2026-10-10",
               "deviceTypes": [], "fbTemplates": []}
        self.app.prj = self.app.bridge.request("library.attach", prj=self.app.prj, lib=lib)["prj"]
        self.app.prj["quote"] = {"currency": "cny", "inDocs": True, "rates": {"prog": 950}, "bogus": 1}
        path = self.tmp / "p.plcstudio.json"
        self.assertTrue(self.app._write_project_file(path))
        self.assertTrue(self.app.open_project(path))
        self.assertEqual(self.app.prj["quote"], {"currency": "CNY", "inDocs": True, "rates": {"prog": 950}})
        self.assertEqual(self.app.prj["library"]["name"], "ACME")
        # restart = stav ze state.json
        self.app._flush()
        state = json.loads((self.home / "state.json").read_text(encoding="utf-8"))
        self.app.set_project(state["prj"], state["ai"])
        self.assertEqual(self.app.prj["quote"]["currency"], "CNY")
        self.assertEqual(self.app.prj["library"]["name"], "ACME")
        # rozbité části se zahodí (jako web normBiz)
        self.app.set_project({**state["prj"], "quote": "x", "library": {"format": "jiny"}})
        self.assertNotIn("quote", self.app.prj)
        self.assertNotIn("library", self.app.prj)

    # --- H2: Uložit vše zapíše projekt ze spuštění, ne z dokončení -------------------------------

    def test_h2_save_all_keeps_project_from_start(self):
        self.assertTrue(self.app.open_project(S11))
        name = self.app.prj["meta"]["name"]
        self.app.settings["projects_root"] = str(self.tmp)
        done = []
        job = datadir.save_all(self.app, ask=False, on_done=done.append)
        self.assertIsNotNone(job)
        self.app.load_sample("small")              # jiný projekt během výpočtu
        self.app.wait_jobs(600)
        self.assertTrue(done and done[0], "uložení se nezdařilo")
        written = json.loads(done[0]["project"].read_text(encoding="utf-8"))
        self.assertEqual(written["prj"]["meta"]["name"], name)
        self.assertIn("long", done[0])

    def test_l8_long_path_warning_text(self):
        self.assertIn("260", datadir.long_path_warning(3, 78))

    # --- H3: překreslení kroků nenechává příkazy Tcl (trace_add) --------------------------------

    def test_h3_redraw_does_not_leak_tcl_commands(self):
        self.assertTrue(self.app.open_project(S11))
        views = [(0, {}), (3, {}), (5, {"schema_tab": 2}), (6, {"prog_tab": 0}), (7, {"gen_tab": 0}),
                 (11, {}), (1, {})]
        for st, ui in views:                     # zahřát (cache, první vykreslení)
            self.app.ui.update(ui)
            self.app.goto(st)
            self.app.wait_jobs(600)
        gc.collect()
        before = tcl_commands(self.root)
        for _ in range(4):
            for st, ui in views:
                self.app.ui.update(ui)
                self.app.goto(st)
                self.app.wait_jobs(600)
        gc.collect()
        self.assertLessEqual(tcl_commands(self.root) - before, 3, "příkazy Tcl přibývají s překreslením")

    def test_h3_trace_helper_unregisters(self):
        from plc_studio.widgets import trace
        f = ttk.Frame(self.root)
        v = tk.StringVar(master=self.root)
        seen = []
        trace(v, lambda *_a: seen.append(v.get()), f)
        v.set("a")
        self.assertEqual(seen, ["a"])
        f.destroy()
        self.root.update()
        self.assertEqual(v.trace_info(), [])
        v.set("b")
        self.assertEqual(seen, ["a"])

    # --- H4 / M7: tabulka nečeká na měření písma -------------------------------------------------

    def test_h4_measure_matches_font_and_clip(self):
        f = tkfont.Font(root=self.root, font=theme.FONT_UI)
        m = Measure(f, theme.FONT_UI)
        for text in ("Pásový dopravník — motor s převodovkou č. 12", "皮带输送机电机带减速器编号十二号的设备说明",
                     "输送机 M1：电机（星三角）, 12 kW", "Förderband Ölpumpe ÄÖÜß", "%IX0.0 → B1_value"):
            self.assertEqual(m.width(text), f.measure(text), text)
            for room in (40, 90, 160):
                # stejný výsledek jako dřívější binární hledání nad font.measure
                lo, hi = 0, len(text)
                while lo < hi:
                    mid = (lo + hi + 1) // 2
                    if f.measure(text[:mid].rstrip() + "…") <= room:
                        lo = mid
                    else:
                        hi = mid - 1
                old = text if f.measure(text) <= room else text[:lo].rstrip() + "…"
                self.assertEqual(m.clip(text, room), old, (text, room))

    def test_h4_table_with_cjk_is_fast(self):
        top = tk.Toplevel(self.root)
        t = Table(top, [("a", "A", 100, True), ("b", "B", 80, False), ("c", "C", 200, True)], ellipsis=True)
        t.pack(fill="both", expand=True)
        self.root.update()
        t0 = time.perf_counter()
        for i in range(1500):
            t.add(i, (f"皮带输送机电机带减速器编号{i}号的设备说明", f"%Q{i}.0", "电机（星三角）减速器 " * 3))
        top.geometry("500x300")
        self.root.update()
        t.fit()
        took = time.perf_counter() - t0
        top.destroy()
        self.assertLess(took, 5.0, f"1 500 řádků čínsky: {took:.1f} s")

    # --- M1: obsah kroku se při malém okně posouvá --------------------------------------------

    def test_m1_small_window_scrolls_to_every_control(self):
        self.assertTrue(self.app.open_project(S11))
        self.root.geometry("1100x680")
        try:
            self.app.goto(0)
            for _ in range(5):
                self.root.update()
                time.sleep(0.1)
            page = self.app._page
            self.assertTrue(page.can_scroll(), "Projekt se do 1100×680 nevejde — musí jít posouvat")
            nb = next(w for w in self.walk() if isinstance(w, ttk.Notebook))   # Revize / Firemní knihovna
            page.canvas.yview_moveto(1.0)
            self.root.update()
            bottom = page.canvas.winfo_rooty() + page.canvas.winfo_height()
            self.assertLess(nb.winfo_rooty() + 20, bottom, "sešit Revize / Firemní knihovna je dosažitelný")
        finally:
            self.root.geometry("1240x820")
            self.root.update()

    # --- M2: velké podklady importu v pracovním procesu, odškrtnutí jen v řádku --------------------

    def test_m2_big_import_runs_in_worker_and_toggle_keeps_page(self):
        self.app.ui.pop("import", None)
        wiz = open_wizard(self.app)
        try:
            rows = ["Tag;Adresa;Zařízení;Třída;Komentář"]
            for i in range(26000):
                rows.append(f"M{i}_run;%Q{i // 8}.{i % 8};M{i};Motor;Pohon {i}")
            text = "\n".join(rows)
            self.assertGreater(len(text), 1_000_000)
            wiz.add_inputs([{"name": "io.csv", "text": text}])
            t0 = time.perf_counter()
            self.assertTrue(wiz.extract())
            self.assertLess(time.perf_counter() - t0, 2.0, "rozpoznání nesmí blokovat okno")
            self.assertIsNotNone(wiz.S["job"])
            wiz.goto(3)                                        # během rozpoznávání nic nepřepne
            self.assertEqual(wiz.S["page"], 0)
            self.assertTrue(self.app.wait_jobs(600))
            self.assertIsNone(wiz.S["job"])
            self.assertEqual(wiz.S["page"], 1)
            self.assertGreater(len(wiz.S["exact"]["prj"]["devices"]), 1000)
            wiz.goto(3)
            self.root.update()
            self.assertLessEqual(len(wiz.dev_table.tv.get_children()), 1000)
            first = wiz.dev_table.tv.get_children()[0]
            name = wiz.dev_table.tv.set(first, "name")
            table = wiz.dev_table
            with mock.patch.object(ImportWizard, "render") as render:
                wiz.dev_table._on_click(first, "take")
            render.assert_not_called()
            self.assertIs(wiz.dev_table, table)
            self.assertEqual(wiz.S["skip"], {name})
            self.assertEqual(table.tv.set(first, "take"), "☐")
        finally:
            wiz.close()

    def test_m2_cancel_big_extract(self):
        self.app.ui.pop("import", None)
        wiz = open_wizard(self.app)
        try:
            text = "Tag;Adresa;Zařízení;Třída;Komentář\n" + "\n".join(
                f"Y{i}_open;%Q{i // 8}.{i % 8};Y{i};Ventil;Ventil {i}" for i in range(30000))
            wiz.add_inputs([{"name": "io2.csv", "text": text}])
            self.assertTrue(wiz.extract())
            wiz.cancel_extract()
            self.assertTrue(self.app.wait_jobs(120))
            self.assertIsNone(wiz.S["job"])
            self.assertEqual(wiz.S["page"], 0)
            self.assertIsNone(wiz.S["ex"])
        finally:
            wiz.close()

    # --- M4 / L5: průvodce importem ---------------------------------------------------------------

    def test_m4_paste_saved_on_focus_out_and_close(self):
        self.app.ui.pop("import", None)
        wiz = open_wizard(self.app)
        wiz.paste_text.insert("1.0", "M1 čerpadlo 5 s")
        wiz.paste_text.event_generate("<FocusOut>")
        self.root.update()
        saved = json.loads((self.home / "import_podklady.json").read_text(encoding="utf-8"))
        self.assertEqual(saved["paste"], "M1 čerpadlo 5 s")
        wiz.paste_text.insert("end", " a víc")
        wiz.persist()                                   # = App.close s otevřeným průvodcem
        saved = json.loads((self.home / "import_podklady.json").read_text(encoding="utf-8"))
        self.assertEqual(saved["paste"], "M1 čerpadlo 5 s a víc")
        wiz.close()

    def test_l5_drop_messages_and_escape(self):
        self.app.ui.pop("import", None)
        wiz = open_wizard(self.app)
        f = self.tmp / "io.csv"
        f.write_text("Tag;Adresa\nA;%I0.0\n", encoding="utf-8")
        wiz._dropped([str(self.tmp)])
        self.assertIn("složku", wiz.S["msg"][1])
        wiz._dropped([str(self.tmp / "neni.csv")])
        self.assertIn("neni.csv", wiz.S["msg"][1])
        wiz._dropped([str(f)])
        self.assertEqual(wiz.S["msg"][0], "ok")
        self.assertNotIn("složku", wiz.S["msg"][1])
        self.assertIsNone(wiz._escape(type("E", (), {"widget": ttk.Entry(wiz.win)})()))   # v poli ne
        self.assertTrue(wiz.win.winfo_exists())
        wiz._escape(type("E", (), {"widget": wiz.win})())
        self.root.update()
        self.assertFalse(wiz.win.winfo_exists())

    # --- M5: otevření z příkazové řádky, jedna instance ------------------------------------------

    def test_m5_open_external_asks_before_replacing(self):
        self.app.load_sample("small")
        with mock.patch.object(appmod.messagebox, "askyesno", return_value=False) as ask:
            self.assertFalse(self.app.open_external(S11))
        ask.assert_called_once()
        self.assertNotEqual(self.app.prj["meta"]["name"], json.loads(S11.read_text(encoding="utf-8"))["prj"]["meta"]["name"])
        with mock.patch.object(appmod.messagebox, "askyesno", return_value=True):
            self.assertTrue(self.app.open_external(S11))
        self.assertEqual(self.app._project_file[1], str(S11))

    def test_m5_single_instance_lock_and_hand_over(self):
        home = self.tmp / "home"
        home.mkdir()
        self.assertTrue(instance.acquire(home))
        self.assertFalse(instance.acquire(home), "druhé spuštění nad stejnou složkou stavu")
        self.assertTrue(instance.acquire(self.tmp / "jina"), "jiná složka stavu = jiná instance")
        self.assertFalse(instance.hand_over(home, str(S11), wait_s=0.3), "nikdo nepřevzal")
        self.assertFalse((home / instance.REQUEST).exists(), "nepřevzatá žádost se uklidí")
        # první instance žádost převezme a soubor otevře
        old_home = self.app.home
        self.app.home = home
        try:
            opened = []
            with mock.patch.object(App, "open_external", lambda _s, p: opened.append(p)):
                instance.watch(self.app)
                import threading
                res = []
                th = threading.Thread(target=lambda: res.append(instance.hand_over(home, str(S11), wait_s=10)))
                th.start()
                end = time.time() + 10
                while th.is_alive() and time.time() < end:
                    self.root.update()
                    time.sleep(0.05)
                for _ in range(5):
                    self.root.update()
                self.assertEqual(res, [True])
                self.assertEqual(opened, [str(S11.resolve())])
        finally:
            self.app.home = old_home

    # --- M6: limit Free jen z podepsaného souboru ---------------------------------------------------

    def test_m6_unsigned_io_limit_ignored(self):
        lic = self.app.lic
        store = lic.store
        try:
            lic.store = {"io_limit": 100000}
            self.assertEqual(lic.io_limit(), FREE_IO_LIMIT)
            lic.store = {"io_limit": 10}                      # zpřísnit smí
            self.assertEqual(lic.io_limit(), 10)
            lic.store = {"io_limit": True}
            self.assertEqual(lic.io_limit(), FREE_IO_LIMIT)
            lic.store = {}
            self.assertEqual(lic.io_limit(), FREE_IO_LIMIT)
        finally:
            lic.store = store
            lic.recompute()

    # --- M8: dotaz AI nad kontext modelu --------------------------------------------------------------

    def test_m8_over_context(self):
        est = {"ctx": 200000, "maxOut": 32000, "parts": [
            {"files": ["a.pdf"], "inputTokens": 7_853_984, "rounds": 8},
            {"files": ["b.txt"], "inputTokens": 100_000, "rounds": 1},
            {"files": [], "inputTokens": 9_000_000, "rounds": 1}]}
        self.assertEqual(ImportWizard.over_context(est), [0])
        self.assertEqual(ImportWizard.over_context({"parts": est["parts"]}), [])
        real = self.app.bridge.request("import.estimate", files=[{"name": "x.txt", "text": "M1 motor"}])
        self.assertGreater(real["ctx"], 0)
        self.assertGreater(real["maxOut"], 0)

    # --- L3 / L2: rezervované jméno a stav po chybě -----------------------------------------------------

    def test_l3_reserved_name_is_error(self):
        self.app.set_status("Projekt uložen: předtím")
        with mock.patch.object(appmod.messagebox, "showerror") as err:
            self.assertFalse(self.app._write_project_file(self.tmp / "NUL"))
            self.assertFalse(self.app._write_project_file(self.tmp / "com1.plcstudio.json"))
        self.assertEqual(err.call_count, 2)
        self.assertTrue(str(self.app._status.cget("text")).startswith("⚠"))

    # --- L4: srozumitelné hlášky souboru projektu ---------------------------------------------------------

    def test_l4_file_encodings_and_nan(self):
        prj = json.loads(S11.read_text(encoding="utf-8"))
        body = json.dumps(prj, ensure_ascii=False)
        f1 = self.tmp / "cp1250.plcstudio.json"
        f1.write_bytes(body.encode("cp1250", errors="replace"))
        self.assertEqual(json.loads(read_text_any(f1))["prj"]["meta"]["name"][:6], prj["prj"]["meta"]["name"][:6])
        for enc in ("utf-16-le", "utf-16-be"):
            f2 = self.tmp / f"{enc}.json"
            f2.write_bytes(body.encode(enc))
            self.assertEqual(json.loads(read_text_any(f2))["prj"]["meta"]["name"], prj["prj"]["meta"]["name"])
        with self.assertRaises(ValueError) as ctx:
            parse_json('{"prj": {"meta": {"takt": NaN}}}')
        self.assertIn("NaN", str(ctx.exception))
        f3 = self.tmp / "nan.plcstudio.json"
        f3.write_text(body[:-1] + ', "x": NaN}', encoding="utf-8")
        with mock.patch.object(appmod.messagebox, "showerror") as err:
            self.assertFalse(self.app.open_project(f3))
        self.assertIn("NaN", err.call_args[0][1])

    def test_l4_approval_of_removed_item(self):
        from plc_studio.bridge import BridgeError
        from plc_studio.steps.schvaleni import approval_error
        self.app.load_sample("small")
        self.app.goto(11)
        approval_error(self.app, BridgeError("approval: unknown item dev:M9"))
        st = str(self.app._status.cget("text"))
        self.assertIn("dev:M9", st)
        self.assertNotIn("approval: unknown", st)

    # --- L6: záznamy pohonu a nastavení bezpečnosti ----------------------------------------------------

    def test_l6_records_decimal_is_error(self):
        from plc_studio.steps.zarizeni import read_params
        v = tk.StringVar(master=self.root, value="4.5047")
        with self.assertRaises(ValueError) as ctx:
            read_params({"records": v, "_app": self.app})
        self.assertIn("4.5047", str(ctx.exception))
        v.set("1 = převzetí @ 0; 2 = lis @ 180")
        self.assertEqual(len(read_params({"records": v, "_app": self.app})["records"]), 2)

    # --- doplněk integrátora: poznámky aiNorm (notes) v kroku AI návrh ---------------------------------

    def test_ai_notes_text_with_and_without_notes(self):
        from plc_studio.steps.ai_navrh import notes_text
        self.assertEqual(notes_text(self.app, {"devices": []}), "")
        self.assertEqual(notes_text(self.app, None), "")
        text = notes_text(self.app, {"devices": [], "notes": ["Krok 3 nepřevzat: neznámé zařízení X9"]})
        self.assertIn("Krok 3 nepřevzat", text)

    def test_sample_names_translated_key(self):
        from plc_studio.steps.projekt import list_samples
        items = list_samples()
        self.assertTrue(items)
        self.assertTrue(all("raw" in s and s["name"] for s in items))

    # --- L7: Alt+→ z Nápovědy ------------------------------------------------------------------------------

    def test_l7_alt_right_from_help(self):
        self.app.goto(4)
        self.app.goto("help")
        ev = type("E", (), {"widget": self.root})()
        self.app._key_step(ev, 1)
        self.assertEqual(self.app.step, 5)
        self.app.goto("help")
        self.app._key_step(ev, -1)
        self.assertEqual(self.app.step, 5)


if __name__ == "__main__":
    unittest.main()
