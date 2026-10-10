"""Ruční úpravy v krocích 4–7 (Zařízení, I/O, Schéma, Program) — desktop nad jádrem edit.ts.

Přejmenování a volby zařízení, jednotka / rozsah, parametry Enterem, úprava / vložení / duplikace
kroku sekvence, tag a adresa signálu v I/O a úpravy v panelu klikacího schématu. Logiku úprav
dělá jádro (most ``edit``), test ověřuje, že ji okno správně volá a ukáže výsledek.

Spuštění (z apps/desktop):  python -m unittest tests.test_edit -v
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ["PLCSTUDIO_HOME"] = tempfile.mkdtemp(prefix="plcstudio_edittest_")

import tkinter as tk  # noqa: E402
from tkinter import ttk  # noqa: E402

from plc_studio.app import App  # noqa: E402
from plc_studio.detail import DevicePanel  # noqa: E402
from plc_studio.widgets import Table  # noqa: E402

SAMPLES = Path(__file__).resolve().parents[3] / "samples"


def walk(widget):
    for w in widget.winfo_children():
        yield w
        yield from walk(w)


class EditTest(unittest.TestCase):
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

    def find(self, cls, parent=None):
        same = (lambda w: type(w) is cls) if cls is ttk.Entry else (lambda w: isinstance(w, cls))
        return [w for w in walk(parent or self.app.view) if same(w)]

    def entry(self, value, parent=None):
        for w in self.find(ttk.Entry, parent):
            if w.get() == value:
                return w
        self.fail(f"pole s hodnotou {value!r} není na obrazovce")

    def click(self, text, parent=None):
        for w in self.find(ttk.Button, parent):
            if str(w.cget("text")) == text:
                w.invoke()
                self.root.update()
                return
        self.fail(f"tlačítko {text!r} není na obrazovce")

    def type_in(self, widget, text, key="<Return>"):
        widget.delete(0, "end")
        widget.insert(0, text)
        widget.focus_force()
        self.root.update()
        widget.event_generate(key)
        self.root.update()

    def status(self) -> str:
        return str(self.app._status.cget("text"))

    def dev(self, name):
        return next(d for d in self.app.prj["devices"] if d["name"] == name)

    def io(self, key):
        return next(e for e in self.app.prj["io"] if e["key"] == key)

    # --- krok 4 Zařízení -------------------------------------------------------------

    def test_rename_device_in_table_and_row(self):
        self.app.load_sample("small")
        m1 = self.dev("M1")
        guid, steps = m1["guid"], [dict(s) for s in self.app.prj["program"]["seq"]]
        addrs = {e["key"]: e["addr"] for e in self.app.prj["io"]}
        self.io("1:fault")["tag"] = "Jistic_Q1"                  # ruční tag zůstane
        self.goto(3)
        tbl = self.find(Table)[0]
        tbl._on_edit(str(m1["id"]), "name", "P1")
        self.root.update()
        p1 = self.dev("P1")
        self.assertEqual((p1["id"], p1["guid"]), (m1["id"], guid))
        self.assertEqual(self.io("1:fbkRunning")["tag"], "P1_fbkRunning")
        self.assertEqual(self.io("1:fault")["tag"], "Jistic_Q1")
        self.assertIn("Jistic_Q1", self.status())
        self.assertEqual(tbl.tv.set(str(m1["id"]), "name"), "P1")
        self.assertEqual(self.app.prj["program"]["seq"], steps)
        self.assertEqual({e["key"]: e["addr"] for e in self.app.prj["io"]}, addrs)
        # neplatné / duplicitní označení se odmítne s hláškou
        for bad in ("y1", "1P", "P__1"):
            tbl._on_edit(str(m1["id"]), "name", bad)
            self.assertTrue(self.status().startswith("⚠"), bad)
            self.assertEqual(self.app.dev_by_id(m1["id"])["name"], "P1")
        # řádek úprav pod tabulkou: označení i popis Enterem
        tbl.select(m1["id"])
        self.root.update()
        self.type_in(self.entry("P1"), "P2")
        self.assertEqual(self.app.dev_by_id(m1["id"])["name"], "P2")
        self.assertEqual(self.io("1:outRun")["tag"], "P2_outRun")
        self.type_in(self.entry("Čerpadlo hydrauliky"), "Hlavní čerpadlo")
        self.assertEqual(self.app.dev_by_id(m1["id"])["desc"], "Hlavní čerpadlo")
        self.assertEqual(self.io("1:outRun")["cmt"], "Hlavní čerpadlo – povel chod")
        self.assertEqual(tbl.tv.set(str(m1["id"]), "desc"), "Hlavní čerpadlo")
        self.app.render()                                     # GC: pole řádku nesmí zbělat
        self.root.update()
        import gc
        gc.collect()
        self.root.update()
        self.assertEqual(self.entry("P2").get(), "P2")

    def test_device_options_range_and_params_by_enter(self):
        self.app.load_sample("small")
        m1 = self.dev("M1")
        self.goto(3)
        tbl = self.find(Table)[0]
        tbl.select(m1["id"])
        self.root.update()
        fault = [c for c in self.find(ttk.Checkbutton) if str(c.cget("text")) == self.app.CLS["Motor"]["opts"]["fault"]][-1]
        fault.invoke()
        self.root.update()
        self.assertFalse(any(e["key"] == "1:fault" for e in self.app.prj["io"]))
        self.assertIn("M1_fault", self.status())
        self.assertFalse(self.app.dev_by_id(m1["id"])["opt"]["fault"])
        fault = [c for c in self.find(ttk.Checkbutton) if str(c.cget("text")) == self.app.CLS["Motor"]["opts"]["fault"]][-1]
        fault.invoke()                                       # zpět: nový signál s volným kanálem
        self.root.update()
        e = self.io("1:fault")
        self.assertRegex(e["addr"], r"^%I\d+\.[0-7]$")
        self.assertEqual(len({x["addr"] for x in self.app.prj["io"]}), len(self.app.prj["io"]))

        b1 = self.dev("B1")
        self.find(Table)[0].select(b1["id"])
        self.root.update()
        self.type_in(self.entry("bar"), "MPa")
        b1 = self.dev("B1")
        self.assertEqual(b1["unit"], "MPa")
        self.assertEqual(self.io(f"{b1['id']}:raw")["cmt"], "Tlak hydrauliky – MPa")
        hi = self.entry(f"{b1['rmax']:g}")
        self.type_in(hi, "-5")                               # max < min → odmítnuto, hodnota zpět
        self.assertTrue(self.status().startswith("⚠"))
        self.assertEqual(self.dev("B1")["rmax"], b1["rmax"])
        # parametry (meze) se ukládají i Enterem, bez tlačítka
        row = next(w for w in self.find(ttk.Button) if str(w.cget("text")) == "Uložit parametry").master
        lo, _hi = [w for w in row.winfo_children() if type(w) is ttk.Entry]
        self.type_in(lo, "5")
        self.assertEqual(self.dev("B1").get("limLo"), 5)

    # --- krok 5 I/O -----------------------------------------------------------------

    def test_io_empty_tag_and_invalid_address(self):
        self.app.load_sample("small")
        self.goto(4)
        tbl = self.find(Table)[0]
        tbl._on_edit("1:outRun", "tag", "  ")
        self.assertEqual(self.io("1:outRun")["tag"], "M1_outRun")
        before = self.io("1:fbkRunning")["addr"]
        for bad in ("%Q0.5", "%IW64", "nesmysl"):
            tbl._on_edit("1:fbkRunning", "addr", bad)
            self.assertTrue(self.status().startswith("⚠"), bad)
            self.assertIn("%I0.0", self.status())
            self.assertEqual(self.io("1:fbkRunning")["addr"], before)
            self.assertEqual(tbl.tv.set("1:fbkRunning", "addr"), before)
        tbl._on_edit("1:fbkRunning", "addr", self.io("1:fault")["addr"])   # obsazená
        self.assertIn("M1_fault", self.status())
        tbl._on_edit("1:fbkRunning", "addr", "i7.7")
        self.assertEqual(self.io("1:fbkRunning")["addr"], "%I7.7")
        tbl._on_edit("1:fbkRunning", "cmt", "")
        self.assertEqual(self.io("1:fbkRunning")["cmt"], "Čerpadlo hydrauliky – běh")

    # --- krok 6 Schéma ---------------------------------------------------------------

    def test_schema_panel_edits_device_and_signal(self):
        self.app.load_sample("small")
        m1 = self.dev("M1")
        self.app.ui.update(schema_tab=0, block_sel=m1["id"], panel_io="1:outRun")
        self.goto(5)
        panel = self.find(DevicePanel)[0]
        desc = self.entry("Čerpadlo hydrauliky", panel)
        desc.delete(0, "end")
        desc.insert(0, "Čerpadlo HA")
        tag = self.entry("M1_outRun", panel)
        buttons = [w for w in self.find(ttk.Button, panel) if str(w.cget("text")) == "Uložit"]
        self.assertEqual(len(buttons), 2)                   # zařízení + vybraný signál
        buttons[0].invoke()
        self.root.update()
        self.assertEqual(self.dev("M1")["desc"], "Čerpadlo HA")
        self.assertEqual(self.io("1:outRun")["cmt"], "Čerpadlo HA – povel chod")
        # po uložení se schéma překreslí, panel zůstane na zařízení a signálu
        panel = self.find(DevicePanel)[0]
        self.assertEqual((panel.dev_id, panel.io_key), (m1["id"], "1:outRun"))
        tag = self.entry("M1_outRun", panel)
        tag.delete(0, "end")
        tag.insert(0, "K1_chod")
        addr = self.entry("%Q0.0", panel)
        addr.delete(0, "end")
        addr.insert(0, "%I0.0")                              # vstupní adresa u výstupu → chyba
        buttons = [w for w in self.find(ttk.Button, panel) if str(w.cget("text")) == "Uložit"]
        buttons[1].invoke()
        self.root.update()
        self.assertTrue(self.status().startswith("⚠"))
        self.assertEqual(self.io("1:outRun")["tag"], "K1_chod")    # tag se uložil před chybou adresy
        self.assertEqual(self.io("1:outRun")["addr"], "%Q0.0")
        self.app.render()
        self.root.update()
        data = self.app.bridge.request("schema", prj=self.app.prj)
        self.assertTrue(any("K1_chod" in s["svg"] for s in data["sheets"]))
        self.assertIn('data-io="1:outRun"', data["sheets"][0]["svg"] + "".join(s["svg"] for s in data["sheets"]))

    def schema_tab(self):
        nb = self.find(ttk.Notebook)[0]
        return nb.index(nb.select())

    def test_schema_terminals_table_edits_tag_addr_cmt(self):
        """Svorkovnice: dvojklik do Tag / Adresa / Komentář = úprava přes jádro, výběr řádku zůstane."""
        self.app.load_sample("small")
        self.app.ui["schema_tab"] = 3
        self.goto(5)
        key = "1:outRun"

        def table():
            return next(t for t in self.find(Table) if "wire" in t._keys)

        def dblclick(col):
            tbl = table()
            tbl.select(key)
            self.root.update()
            x, y, w, h = tbl.tv.bbox(key, col)
            # Tk pozná dvojklik ze dvou stisků; na svorce druhý stisk rovnou otevře list zapojení
            for seq in ("<ButtonPress-1>", "<ButtonRelease-1>", "<ButtonPress-1>", "<ButtonRelease-1>"):
                if not tbl.tv.winfo_exists():
                    break
                tbl.tv.event_generate(seq, x=x + w // 2, y=y + h // 2)
            self.root.update()
            return tbl

        tbl = dblclick("tag")
        self.assertEqual(tbl._editor.get(), "M1_outRun")
        self.type_in(tbl._editor, "K1_chod")
        self.assertEqual(self.io(key)["tag"], "K1_chod")
        self.assertIn("K1_chod", self.status())
        self.assertEqual(self.schema_tab(), 3)                      # překresleno, záložka i řádek zůstaly
        self.assertEqual(table().selected(), key)
        self.assertEqual(table().tv.set(key, "tag"), "K1_chod")
        # adresa: editor nese uloženou adresu (Siemens), neplatná se neuloží
        tbl = dblclick("addr")
        self.assertEqual(tbl._editor.get(), self.io(key)["addr"])
        before = self.io(key)["addr"]
        self.type_in(tbl._editor, "%I0.0")
        self.assertTrue(self.status().startswith("⚠"))
        self.assertEqual(self.io(key)["addr"], before)
        self.type_in(dblclick("addr")._editor, "%Q7.7")
        self.assertEqual(self.io(key)["addr"], "%Q7.7")
        self.assertEqual(table().tv.set(key, "addr"), "%Q7.7")
        # komentář má vlastní sloupec (zařízení zvlášť), prázdný = výchozí
        tbl = dblclick("cmt")
        self.assertEqual(tbl._editor.get(), "Čerpadlo hydrauliky – povel chod")
        self.type_in(tbl._editor, "Chod čerpadla")
        self.assertEqual(self.io(key)["cmt"], "Chod čerpadla")
        self.assertEqual((table().tv.set(key, "dev"), table().tv.set(key, "cmt")), ("M1", "Chod čerpadla"))
        self.type_in(dblclick("cmt")._editor, "")
        self.assertEqual(self.io(key)["cmt"], "Čerpadlo hydrauliky – povel chod")
        # dvojklik na svorku = list zapojení s tímto signálem
        dblclick("svorka")
        self.assertEqual((self.schema_tab(), self.app.ui["wire_sel"]), (2, key))

    def test_schema_wiring_sheet_signal_editor(self):
        """Elektrické zapojení: klik na kanál = editor signálu pod listem, uložení zůstane na kanálu."""
        self.app.load_sample("small")
        key = "1:outRun"
        self.app.ui.update(schema_tab=2, wire_sel=key)
        self.goto(5)
        self.assertNotIn("✎ Upravit signál", [str(w.cget("text")) for w in walk(self.app.view)
                                              if isinstance(w, tk.Label)])
        tag = self.entry("M1_outRun")
        self.type_in(tag, "K1_chod")                                # Enter uloží
        self.assertEqual(self.io(key)["tag"], "K1_chod")
        self.assertEqual((self.schema_tab(), self.app.ui["wire_sel"]), (2, key))
        self.entry("K1_chod")                                        # editor zůstal na kanálu
        data = self.app.bridge.request("schema", prj=self.app.prj)
        self.assertTrue(any("K1_chod" in s["svg"] for s in data["sheets"]))
        # neplatná adresa: hláška, nic se neuloží; komentář a Uložit tlačítkem
        before = self.io(key)["addr"]
        self.type_in(self.entry(before), "%I0.0")
        self.assertTrue(self.status().startswith("⚠"))
        self.assertEqual(self.io(key)["addr"], before)
        self.app.render()
        self.root.update()
        cmt = self.entry("Čerpadlo hydrauliky – povel chod")
        cmt.delete(0, "end")
        cmt.insert(0, "Chod čerpadla")
        self.click("Uložit")
        self.assertEqual(self.io(key)["cmt"], "Chod čerpadla")
        self.assertEqual(self.schema_tab(), 2)
        # Esc vrátí rozepsané hodnoty
        tag = self.entry("K1_chod")
        tag.insert("end", "_x")
        tag.focus_force()
        self.root.update()
        tag.event_generate("<Escape>")
        self.root.update()
        self.assertEqual(tag.get(), "K1_chod")

    def test_schema_panel_editor_scrolls_into_view_enter_esc(self):
        """Panel u blokového schématu: po ✎ je editor signálu vidět i v malém okně, Enter uloží, Esc zavře."""
        self.assertTrue(self.app.open_project(SAMPLES / "11_podavaci_lisovaci_stanice_PS-11.plcstudio.json"))
        dev = max(self.app.prj["devices"],
                  key=lambda d: sum(e["devId"] == d["id"] for e in self.app.prj["io"]))
        key = [e["key"] for e in self.app.prj["io"] if e["devId"] == dev["id"]][-1]   # poslední signál
        for size in ("1240x820", "1100x680"):
            self.root.geometry(size)
            self.app.ui.update(schema_tab=0, block_sel=dev["id"], panel_io=key)
            self.goto(5)
            self.root.update()
            panel = self.find(DevicePanel)[0]
            self.assertEqual(panel.io_key, key)
            save = [w for w in self.find(ttk.Button, panel._editor) if str(w.cget("text")) == "Uložit"][0]
            c = panel._canvas
            top, bottom = c.winfo_rooty(), c.winfo_rooty() + c.winfo_height()
            self.assertTrue(top <= save.winfo_rooty() and save.winfo_rooty() + save.winfo_height() <= bottom,
                            f"{size}: Uložit mimo výřez panelu")
            self.assertTrue(top <= panel._editor.first_entry.winfo_rooty(), size)
        tag = self.io(key)["tag"]
        self.type_in(panel._editor.first_entry, tag + "X")
        self.assertEqual(self.io(key)["tag"], tag + "X")
        panel = self.find(DevicePanel)[0]
        self.assertEqual(panel.io_key, key)                        # po překreslení editor zůstal
        panel._editor.first_entry.focus_force()
        self.root.update()
        panel._editor.first_entry.event_generate("<Escape>")
        self.root.update()
        self.assertIsNone(panel.io_key)
        self.assertEqual(self.io(key)["tag"], tag + "X")

    # --- krok 7 Program ---------------------------------------------------------------

    def test_program_edit_insert_duplicate_cancel(self):
        self.app.load_sample("small")
        self.app.ui["prog_tab"] = 0
        self.goto(6)
        seq = self.app.prj["program"]["seq"]
        n = len(seq)
        tbl = self.find(Table)[0]
        tbl.select(1)                                        # M1 start
        self.root.update()
        spin = self.find(ttk.Spinbox)[0]
        self.assertEqual(spin.get(), "3")
        self.assertTrue(self.find(ttk.Combobox)[1].get().startswith("M1"))
        spin.set("8")
        self.click("Uložit změny kroku")
        self.assertEqual(self.app.prj["program"]["seq"][1], {"dev": 1, "act": "start", "cond": "fbk", "timeS": 8})
        self.assertEqual(len(self.app.prj["program"]["seq"]), n)
        self.click("Duplikovat")
        seq = self.app.prj["program"]["seq"]
        self.assertEqual(len(seq), n + 1)
        self.assertEqual(seq[2], seq[1])
        self.find(ttk.Spinbox)[0].set("4")
        self.click("Vložit za vybraný")                       # za kopii (vybraný krok 3)
        seq = self.app.prj["program"]["seq"]
        self.assertEqual((len(seq), seq[3]["timeS"]), (n + 2, 4))
        # neplatný čas: nic se nezmění
        self.find(ttk.Spinbox)[0].set("0")
        self.click("Uložit změny kroku")
        self.assertIn("3600", self.status())
        self.assertEqual(self.app.prj["program"]["seq"], seq)
        # akce jiného zařízení: Y1 → zavřít, uloží se do upravovaného kroku
        dev, act = self.find(ttk.Combobox)[1:3]
        dev.set(next(v for v in dev.cget("values") if v.startswith("Y1")))
        self.root.update()
        act.current(1)
        self.find(ttk.Spinbox)[0].set("6")
        self.click("Uložit změny kroku")
        self.assertEqual(self.app.prj["program"]["seq"][3], {"dev": 2, "act": "close", "cond": "fbk", "timeS": 6})
        self.click("Zrušit výběr")
        self.assertIsNone(self.app.ui.get("seq_edit"))
        self.assertEqual(self.find(ttk.Spinbox)[0].get(), "3")
        self.click("Uložit změny kroku")                     # bez výběru nic
        self.assertEqual(len(self.app.prj["program"]["seq"]), n + 2)
        # dvojklik na krok = upravit
        tbl = self.find(Table)[0]
        tbl.select(0)
        self.root.update()
        x, y, w, h = tbl.tv.bbox("0", "txt")
        for seq in ("<ButtonPress-1>", "<ButtonRelease-1>") * 2:     # Tk pozná dvojklik ze dvou stisků
            tbl.tv.event_generate(seq, x=x + 5, y=y + h // 2)
        self.root.update()
        self.assertEqual(self.app.ui.get("seq_edit"), 0)
        self.assertIn("Krok 1", self.status())

    def test_program_edit_axis_and_drive_steps(self):
        self.assertTrue(self.app.open_project(SAMPLES / "12_portalovy_manipulator_PM-12.plcstudio.json"))
        self.app.ui["prog_tab"] = 0
        self.goto(6)
        seq = self.app.prj["program"]["seq"]
        i = next(k for k, s in enumerate(seq) if s["act"] == "moveAbs")
        before = dict(seq[i])
        self.find(Table)[0].select(i)
        self.root.update()
        self.click("Uložit změny kroku")                     # beze změny formuláře = stejný krok
        self.assertEqual(self.app.prj["program"]["seq"][i], before)
        self.assertTrue(self.app.open_project(SAMPLES / "11_podavaci_lisovaci_stanice_PS-11.plcstudio.json"))
        self.goto(6)
        seq = self.app.prj["program"]["seq"]
        for k, s in enumerate(seq):
            if s["act"] in ("posRecord", "start") and s["dev"]:
                self.find(Table)[0].select(k)
                self.root.update()
                self.click("Uložit změny kroku")
                self.assertEqual(self.app.prj["program"]["seq"][k], s, k)


if __name__ == "__main__":
    unittest.main()
