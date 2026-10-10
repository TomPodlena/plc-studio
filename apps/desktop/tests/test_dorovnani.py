"""Dorovnání web × desktop (2026-10-10), druhá část: kusovník (tabulka ke kopírování z jádra,
množství, dodavatelé, hvězdička platforem projektu), filtr Schválení, filtr Oživení „otevřené“,
model stroje přes jádro, názvy odkazů v Nápovědě, průvodce importem (podklady mezi spuštěními,
API klíč v průvodci, přetažení souborů).

Spuštění (z apps/desktop):  python -m unittest tests.test_dorovnani -v
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ["PLCSTUDIO_HOME"] = tempfile.mkdtemp(prefix="plcstudio_dorovnani_")

import tkinter as tk  # noqa: E402
from tkinter import ttk  # noqa: E402

from plc_studio import dropfiles, importer  # noqa: E402
from plc_studio.app import STEP_APPROVAL, STEP_BOM, STEP_COMMISSION, App  # noqa: E402
from plc_studio.widgets import Table  # noqa: E402


def walk(widget):
    for w in widget.winfo_children():
        yield w
        yield from walk(w)


class DorovnaniTest(unittest.TestCase):
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
        self.app.load_sample("small")
        self.root.update()

    def tearDown(self):
        self.assertEqual(self.app.errors, [], "callback okna skončil chybou")

    # --- pomůcky -------------------------------------------------------------------

    def goto(self, step):
        self.app.goto(step)
        self.root.update()
        self.assertTrue(self.app.wait_jobs(300))
        self.root.update()

    def texts(self, parent=None):
        out = []
        for w in walk(parent or self.app.view):
            try:
                out.append(str(w.cget("text")))
            except tk.TclError:
                pass
        return out

    def tables(self):
        return [w for w in walk(self.app.view) if isinstance(w, Table)]

    def status(self) -> str:
        return str(self.app._status.cget("text"))

    # --- kusovník ------------------------------------------------------------------

    def test_bom_copy_table_from_core_and_same_columns_as_web(self):
        self.goto(STEP_BOM)
        core_tsv = self.app.bridge.request("call", fn="bomTableText", args=[self.app.prj])["result"]
        with mock.patch.object(self.app, "copy") as copy:
            next(w for w in walk(self.app.view) if isinstance(w, ttk.Button)
                 and str(w.cget("text")) == "Kopírovat jako tabulku").invoke()
        text = copy.call_args[0][0]
        self.assertEqual(text, core_tsv)
        head = text.split("\n")[0].split("\t")
        self.assertEqual(head, ["Pozice", "Označení", "Položka", "Popis", "Množství", "Jednotka", "Výrobce",
                                "Typ", "Objednací kód", "Dodavatel", "Poznámka"])

    def test_bom_star_for_project_platforms(self):
        self.goto(STEP_BOM)
        combo = next(w for w in walk(self.app.view) if isinstance(w, ttk.Combobox)
                     and any("★" in v for v in w.cget("values")))
        starred = [v for v in combo.cget("values") if v.endswith(" ★")]
        self.assertEqual(len(starred), len(self.app.prj["platforms"]))
        self.assertTrue(combo.get().endswith(" ★"))            # výchozí platforma = první z projektu
        self.assertIn("★ = platforma zvolená v projektu.", self.texts())
        combo.current(next(i for i, v in enumerate(combo.cget("values")) if not v.endswith("★")))
        combo.event_generate("<<ComboboxSelected>>")
        self.root.update()
        self.app.wait_jobs(300)
        self.assertNotIn(self.app.prj["bom"]["plat"], self.app.prj["platforms"])

    def test_bom_quantity_rule_from_core(self):
        self.goto(STEP_BOM)
        tbl = next(t for t in self.tables() if "qty" in t._keys)
        lid = tbl.tv.get_children()[0]
        for bad in ("-1", "100001", "2,5", "abc"):
            tbl._on_edit(lid, "qty", bad)
            self.root.update()
            self.assertIn("celé číslo 0 až 100000", self.status(), bad)
            self.assertNotIn(lid, (self.app.prj.get("bom") or {}).get("lines") or {})
        tbl._on_edit(lid, "qty", "0")                             # 0 = vyřadit, řádek zůstane šedě
        self.app.wait_jobs(300)
        self.root.update()
        self.assertEqual(self.app.prj["bom"]["lines"][lid]["qty"], 0)
        tbl = next(t for t in self.tables() if "qty" in t._keys)
        self.assertIn("dim", tbl.tv.item(lid, "tags"))
        tbl._on_edit(lid, "qty", "")                              # prázdné = zpět na návrh
        self.app.wait_jobs(300)
        self.assertNotIn("bom", self.app.prj)

    def test_bom_suppliers_used_with_rows_and_row_combobox(self):
        self.goto(STEP_BOM)
        data = self.app.bridge.request("bom", prj=self.app.prj)
        used = {ln["supplier"] for ln in data["lines"] if ln["supplier"] and not ln.get("excluded")}
        self.assertEqual({s["name"] for s in data["suppliers"]}, used)
        st = next(t for t in self.tables() if "rows" in t._keys)
        self.assertEqual(len(st.tv.get_children()), len(used))
        # výběr dodavatele u vybraného řádku (nabídka značky + kategorie, jako web)
        tbl = next(t for t in self.tables() if "qty" in t._keys)
        lid = tbl.tv.get_children()[0]
        tbl.select(lid)
        self.root.update()
        cb = next(w for w in walk(self.app.view) if isinstance(w, ttk.Combobox) and w.cget("state") != "readonly"
                  and w.get() == next(ln for ln in data["lines"] if ln["id"] == lid)["supplier"])
        self.assertTrue(cb.cget("values"))
        cb.set("Elektro Novák s.r.o.")
        cb.focus_force()
        self.root.update()
        cb.event_generate("<Return>")
        self.root.update()
        self.app.wait_jobs(300)
        self.assertEqual(self.app.prj["bom"]["lines"][lid]["supplier"], "Elektro Novák s.r.o.")
        self.root.update()
        st = next(t for t in self.tables() if "rows" in t._keys)
        names = [st.tv.set(i, "name") for i in st.tv.get_children()]
        self.assertIn("Elektro Novák s.r.o.", names)
        row = next(i for i in st.tv.get_children() if st.tv.set(i, "name") == "Elektro Novák s.r.o.")
        self.assertEqual(st.tv.set(row, "kind"), "vlastní")

    # --- schválení a oživení ------------------------------------------------------------

    def test_approval_filter_like_web(self):
        self.goto(STEP_APPROVAL)
        combo = next(w for w in walk(self.app.view) if isinstance(w, ttk.Combobox)
                     and "vše" in w.cget("values"))
        self.assertEqual(list(combo.cget("values")), ["vše", "k rozhodnutí (čeká, změněno po schválení)",
                                                      "změněno po schválení", "zamítnuto", "schváleno"])
        tbl = next(t for t in self.tables() if t.tv.get_children())
        n_all = sum(len(tbl.tv.get_children(g)) for g in tbl.tv.get_children())
        combo.current(4)                                            # schváleno — nic schváleno není
        combo.event_generate("<<ComboboxSelected>>")
        self.root.update()
        self.app.wait_jobs(300)
        self.root.update()
        self.assertEqual(self.app.ui["appr"]["filter"], "approved")
        tbl = next(t for t in self.tables() if t._keys[:2] == ["status", "who"])
        self.assertEqual(tbl.tv.get_children(), ())
        self.assertIn("Žádná položka neodpovídá filtru.", self.texts())
        self.app.ui["appr"]["filter"] = "open"
        self.app.render()
        self.app.wait_jobs(300)
        self.root.update()
        tbl = next(t for t in self.tables() if t._keys[:2] == ["status", "who"])
        n_open = sum(len(tbl.tv.get_children(g)) for g in tbl.tv.get_children())
        self.assertEqual(n_open, n_all)                               # bez rozhodnutí = vše k rozhodnutí
        self.assertTrue(any(t.startswith("zobrazeno ") for t in self.texts()))

    def test_commission_open_filter_includes_failed(self):
        plan = self.app.bridge.request("commission", prj=self.app.prj)["plan"]
        a, b = plan[0]["id"], plan[1]["id"]
        self.app.prj["commissioning"] = {
            a: {"result": "ok", "by": "Test", "at": "2026-10-10T10:00:00Z"},
            b: {"result": "nok", "by": "Test", "at": "2026-10-10T10:00:00Z"}}
        self.app.ui["com"] = {"filter": "open"}
        self.goto(STEP_COMMISSION)
        tbl = next(t for t in self.tables() if "res" in t._keys)
        shown = [c for g in tbl.tv.get_children() for c in tbl.tv.get_children(g)]
        self.assertIn(b, shown)                                        # nevyhovuje = otevřený
        self.assertNotIn(a, shown)                                     # OK = hotový
        self.assertEqual(len(shown), len(plan) - 1)
        self.assertTrue(any(t.startswith("otevřené (bez výsledku nebo nevyhovuje)") for t in self.texts()))

    # --- model stroje, nápověda -----------------------------------------------------------

    def test_machine_model_validated_by_core(self):
        res = self.app.edit("setSimModel", {"motorDelay": "700"})
        self.assertFalse(res["ok"])
        self.assertIn("600", res["error"])
        res = self.app.edit("setSimModel", {"motorDelay": "1,5"})
        self.assertTrue(res["ok"])
        self.assertEqual(self.app.prj["sim"]["motorDelay"], 1.5)

    def test_help_reference_kinds_match_web(self):
        self.goto("help")
        txt = next(w for w in walk(self.app.view) if isinstance(w, tk.Text))
        body = txt.get("1.0", "end")
        for kind in ("Produkt: ", "Příručky: ", "Import a export: ", "Zastoupení v ČR: "):
            self.assertIn(kind, body)
        for old in ("manuál: ", "import zdrojů: ", "Česko: "):
            self.assertNotIn(old, body)

    # --- průvodce importem -------------------------------------------------------------------

    def _wizard(self):
        self.app.ui.pop("import", None)
        wiz = importer.open_wizard(self.app)
        self.root.update()
        self.addCleanup(lambda: wiz.win.winfo_exists() and wiz.close())
        return wiz

    def test_import_sources_survive_restart(self):
        src = Path(tempfile.mkdtemp()) / "tagy.csv"
        src.write_text("Tag;Adresa;Zařízení;Třída;Komentář\nM7_outRun;%Q0.0;M7;Motor;Dopravník\n",
                       encoding="utf-8")
        self.app._import_restored = True                  # tato instance už podklady načetla
        wiz = self._wizard()
        wiz.add_paths([str(src)])
        wiz.paste_text.insert("1.0", "popis stroje")
        wiz.close()
        saved = json.loads((Path(self.app.home) / importer.SOURCES_FILE).read_text(encoding="utf-8"))
        self.assertEqual([f["file"]["name"] for f in saved["files"]], ["tagy.csv"])
        self.assertEqual(saved["paste"], "popis stroje")

        self.app._import_restored = False                 # = nové spuštění aplikace
        wiz = self._wizard()
        self.assertEqual([f["file"]["name"] for f in wiz.S["files"]], ["tagy.csv"])
        self.assertEqual(wiz.paste_text.get("1.0", "end-1c"), "popis stroje")
        self.assertIn("Podklady z minulého spuštění: 1 soubor.", wiz.S["msg"][1])
        self.assertTrue(wiz.extract())
        wiz.close()
        wiz = self._wizard()                              # podruhé v témže spuštění: načisto
        self.assertEqual(wiz.S["files"], [])
        wiz.remove(None)                                  # „Odebrat vše“ = záznam smazat
        wiz.close()
        self.assertFalse((Path(self.app.home) / importer.SOURCES_FILE).exists())

    def test_import_sources_size_limit_and_corrupt_file(self):
        home = Path(self.app.home)
        (home / importer.SOURCES_FILE).write_text("{ rozbité", encoding="utf-8")
        self.assertEqual(importer.load_sources(self.app), ([], ""))
        (home / importer.SOURCES_FILE).write_text(json.dumps(
            {"files": [{"path": 1, "file": {"name": "a.txt", "text": "x", "size": -5}},
                       {"file": {"name": "", "text": "y"}}, {"file": {"name": "b.pdf"}}, "nic"],
             "paste": 3}), encoding="utf-8")
        files, paste = importer.load_sources(self.app)
        self.assertEqual([f["file"]["name"] for f in files], ["a.txt"])
        self.assertEqual((files[0]["path"], files[0]["file"]["size"], paste), ("", 1, ""))
        with mock.patch.object(importer, "SOURCES_MAX", 300):
            big = {"name": "velky.pdf", "data": "A" * 1000, "mime": "application/pdf", "size": 750}
            small = {"name": "maly.txt", "text": "ok", "size": 2}
            skipped = importer.save_sources(self.app, {"files": [{"path": "", "file": big},
                                                                 {"path": "", "file": small}], "paste": ""})
        self.assertEqual(skipped, ["velky.pdf"])
        files, _p = importer.load_sources(self.app)
        self.assertEqual([f["file"]["name"] for f in files], ["maly.txt"])
        importer.clear_sources(self.app)
        self.assertFalse((home / importer.SOURCES_FILE).exists())

    def test_import_takeover_clears_saved_sources(self):
        self.app._import_restored = True
        wiz = self._wizard()
        wiz.paste_text.insert("1.0", "Tag;Adresa;Zařízení;Třída;Komentář\nM7_outRun;%Q0.0;M7;Motor;Dopravník\n")
        self.assertTrue(wiz.extract())
        self.assertTrue((Path(self.app.home) / importer.SOURCES_FILE).exists())
        wiz.goto(3)
        with mock.patch("tkinter.messagebox.askyesno", return_value=True):
            self.assertTrue(wiz.take_over())
        self.assertFalse((Path(self.app.home) / importer.SOURCES_FILE).exists())

    def test_import_api_key_field_in_wizard(self):
        self.app.settings["ai_key"] = ""
        self.app._import_restored = True
        wiz = self._wizard()
        wiz.paste_text.insert("1.0", "popis funkce stroje bez exportu")
        self.assertTrue(wiz.extract())
        wiz.goto(2)
        self.root.update()
        self.assertIn("Uložit klíč", self.texts(wiz.win))
        wiz.key_entry.insert(0, "sk-ant-test")
        next(w for w in walk(wiz.win) if isinstance(w, ttk.Button) and str(w.cget("text")) == "Uložit klíč").invoke()
        self.root.update()
        self.assertEqual(self.app.settings["ai_key"], "sk-ant-test")
        self.assertNotIn("Uložit klíč", self.texts(wiz.win))
        self.assertIn("Spustit analýzu (placené)", self.texts(wiz.win))
        self.app.settings["ai_key"] = ""

    @unittest.skipUnless(sys.platform == "win32", "přetažení souborů jen ve Windows")
    def test_import_drop_files(self):
        self.app._import_restored = True
        wiz = self._wizard()
        self.assertIsNotNone(wiz._drop)
        self.assertIn("Soubory můžeš do okna i přetáhnout z Průzkumníka.", self.texts(wiz.win))
        folder = Path(tempfile.mkdtemp())
        a, b = folder / "tagy.csv", folder / "popis.txt"
        a.write_text("Tag;Adresa\nX;%I0.0\n", encoding="utf-8")
        b.write_text("popis", encoding="utf-8")
        dropfiles.simulate_drop(wiz._drop, [str(a), str(b), str(folder)])   # skutečná zpráva WM_DROPFILES
        for _ in range(20):
            self.root.update()
            if wiz.S["files"]:
                break
            self.root.after(20)
        self.assertEqual(sorted(f["file"]["name"] for f in wiz.S["files"]), ["popis.txt", "tagy.csv"])
        dropfiles.simulate_drop(wiz._drop, [str(folder)])
        for _ in range(10):
            self.root.update()
            self.root.after(20)
        self.assertIn("ne složku", wiz.S["msg"][1])
        wiz.close()


if __name__ == "__main__":
    unittest.main()
