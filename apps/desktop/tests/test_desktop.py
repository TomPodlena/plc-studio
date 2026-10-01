"""Testy desktopové aplikace — most do jádra, vykreslení výkresů a kroky GUI.

GUI testy otevřou skutečné okno a „klikají" na tlačítka (``invoke``); dialogy
a volání AI jsou nahrazené, takže test nic neukládá mimo dočasnou složku
a neposílá žádný dotaz na API.

Spuštění (z apps/desktop):  python -m unittest discover -s tests -v
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ["PLCSTUDIO_HOME"] = tempfile.mkdtemp(prefix="plcstudio_test_")

import tkinter as tk  # noqa: E402
from tkinter import ttk  # noqa: E402

from plc_studio import ai_client  # noqa: E402
from plc_studio.app import App  # noqa: E402
from plc_studio.bridge import BridgeError, CoreBridge  # noqa: E402
from plc_studio.steps.zarizeni import ImportDialog  # noqa: E402
from plc_studio.svgview import SvgView, parse_svg  # noqa: E402
from plc_studio.widgets import Table  # noqa: E402

SIMATIC_XML = (
    '<?xml version="1.0"?><Document><SW.Tags.PlcTagTable ID="0"><ObjectList>'
    '<SW.Tags.PlcTag ID="1"><AttributeList><DataTypeName>Bool</DataTypeName>'
    '<LogicalAddress>%I0.0</LogicalAddress><Name>M1_fbkRunning</Name></AttributeList>'
    '<ObjectList><MultilingualText><Text>Čerpadlo &amp; běh</Text></MultilingualText>'
    '</ObjectList></SW.Tags.PlcTag><SW.Tags.PlcTag ID="2"><AttributeList>'
    '<DataTypeName>Bool</DataTypeName><LogicalAddress>%Q0.0</LogicalAddress>'
    '<Name>M1_outRun</Name></AttributeList></SW.Tags.PlcTag>'
    '</SW.Tags.PlcTagTable></Document>')
PLAIN_IO = ("Tag;Adresa;Zařízení;Třída;Komentář\n"
            "M7_fbkRunning;%I0.0;M7;Motor;Dopravník běh\n"
            "M7_outRun;%Q0.0;M7;Motor;Dopravník povel\n"
            "S9_in;%I0.1;S9;DI;Nouzové zastavení (NC)\n")
AI_REPLY = ('Návrh:\n```json\n{"questions":[],"devices":['
            '{"name":"S1","cls":"DI","desc":"Nouzové zastavení (NC)","opt":{}},'
            '{"name":"M1","cls":"Motor","desc":"Čerpadlo","opt":{"fbk":true}},'
            '{"name":"B1","cls":"AnalogIn","desc":"Tlak","opt":{},"unit":"bar","rmin":0,"rmax":250}],'
            '"estop":"S1","seq":[{"dev":"M1","act":"start","cond":"fbk","timeS":3},'
            '{"dev":"","act":"wait","cond":"time","timeS":5}],"note":"Zkušební návrh"}\n```')


class BridgeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.b = CoreBridge()
        cls.init = cls.b.request("init")

    @classmethod
    def tearDownClass(cls):
        cls.b.close()

    def test_init_exposes_core_constants(self):
        self.assertEqual(len(self.init["PLAT"]), 7)
        self.assertIn("Motor", self.init["CLS"])

    def test_sync_keeps_edits_and_returns_mutated_project(self):
        p = self.b.call("sampleSmall")
        p["io"][0]["tag"] = "Muj_tag"
        p["devices"].append({"id": p["nextId"], "name": "M9", "cls": "Motor", "desc": "x",
                             "opt": {"fbk": True}, "unit": "", "rmin": 0, "rmax": 100})
        q = self.b.mutate("syncIO", p)
        self.assertEqual(q["io"][0]["tag"], "Muj_tag")
        self.assertEqual({e["sig"] for e in q["io"] if e["devId"] == p["nextId"]},
                         {"fbkRunning", "outRun"})
        self.assertTrue(all(e["addr"] for e in q["io"]))

    def test_schema_block_has_signal_lines(self):
        # svgBlock páruje kanály identitou objektů — přes JSON by čáry zmizely,
        # kdyby se moduly a schéma nepočítaly v jedné operaci mostu
        p = self.b.call("sampleSmall")
        s = self.b.request("schema", prj=p)
        self.assertEqual(s["block"].count("<line"), len(p["io"]))
        self.assertEqual(len(s["rows"]), len(p["io"]))
        self.assertTrue(s["sheets"][0]["dxf"].startswith("0\nSECTION"))

    def test_xml_import_works_without_browser_domparser(self):
        d = self.b.request("import", text=SIMATIC_XML)
        self.assertIn("SimaticML", d["res"]["fmt"])
        self.assertEqual([t["tag"] for t in d["res"]["tags"]], ["M1_fbkRunning", "M1_outRun"])
        self.assertEqual(d["res"]["tags"][0]["cmt"], "Čerpadlo & běh")
        self.assertEqual([(x["name"], x["cls"]) for x in d["built"]["devices"]], [("M1", "Motor")])

    def test_errors_carry_core_code(self):
        with self.assertRaises(BridgeError) as cm:
            self.b.ai("extractJson", "žádný json")
        self.assertEqual(cm.exception.code, "invalid_json")
        with self.assertRaises(BridgeError):
            self.b.call("neexistuje")

    def test_bridge_restarts_after_process_death(self):
        self.b._proc.kill()
        self.b._proc.wait()
        self.assertEqual(self.b.call("sanitizeTag", "Čerpadlo 1 běh"), "Cerpadlo_1_beh")


class SvgTest(unittest.TestCase):
    def test_parse_resolves_theme_colors(self):
        b = CoreBridge()
        try:
            s = b.request("schema", prj=b.call("sampleSmall"))
        finally:
            b.close()
        for svg in (s["block"], s["sheets"][0]["svg"]):
            doc = parse_svg(svg)
            kinds = {it[0] for it in doc["items"]}
            self.assertTrue({"line", "rect", "text"} <= kinds)
            self.assertGreater(doc["w"], 0)
            for it in doc["items"]:
                for v in it:
                    if isinstance(v, str):
                        self.assertNotIn("var(", v)
                        self.assertNotEqual(v, "currentColor")


def walk(widget):
    for w in widget.winfo_children():
        yield w
        yield from walk(w)


class GuiTest(unittest.TestCase):
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

    def tearDown(self):
        self.assertEqual(self.app.errors, [], "callback okna skončil chybou")

    # --- pomůcky -------------------------------------------------------------------

    def goto(self, step):
        self.app.goto(step)
        self.root.update()

    def find(self, cls, parent=None):
        # Combobox dědí z Entry — vstupní pole se proto hledají přesným typem
        same = (lambda w: type(w) is cls) if cls is ttk.Entry else (lambda w: isinstance(w, cls))
        return [w for w in walk(parent or self.app.view) if same(w)]

    def button(self, text, parent=None):
        for w in self.find(ttk.Button, parent):
            if str(w.cget("text")) == text:
                return w
        self.fail(f"tlačítko {text!r} není na obrazovce")

    def click(self, text, parent=None):
        self.button(text, parent).invoke()
        self.root.update()

    def table(self, index=0):
        return self.find(Table)[index]

    # --- testy -----------------------------------------------------------------------

    def test_sample_project_seeds_ai_conversation(self):
        self.app.load_sample("complex")
        self.root.update()
        self.assertEqual(len(self.app.prj["devices"]), 29)
        self.assertEqual(len(self.app.ai["turns"]), 2)
        self.assertIn("LL-03", self.root.title())

    def test_every_step_renders_for_all_project_states(self):
        for prepare in (lambda: self.app.load_sample("complex"),
                        lambda: self.app.load_sample("small"), self.app.reset_project):
            prepare()
            for step in [*range(9), "help"]:
                self.goto(step)
                self.assertTrue(self.app.view.winfo_children())

    def test_devices_add_edit_delete(self):
        self.app.reset_project()
        self.goto(3)
        combo = self.find(ttk.Combobox)[0]
        entries = self.find(ttk.Entry)
        self.assertEqual(entries[0].get(), "M1")
        entries[1].insert(0, "Čerpadlo hydrauliky")
        self.click("Přidat zařízení")
        d = self.app.prj["devices"][0]
        self.assertEqual((d["name"], d["cls"], d["desc"], d["opt"]),
                         ("M1", "Motor", "Čerpadlo hydrauliky", {"fbk": True, "fault": False}))
        self.assertEqual([e["sig"] for e in self.app.prj["io"]], ["fbkRunning", "outRun"])

        combo = self.find(ttk.Combobox)[0]
        combo.set(self.app.CLS["AnalogIn"]["label"])
        self.root.update()
        entries = self.find(ttk.Entry)
        self.assertEqual(entries[0].get(), "B1")
        entries[1].insert(0, "Tlak")
        entries[2].insert(0, "bar")
        entries[4].delete(0, "end")
        entries[4].insert(0, "250")
        self.click("Přidat zařízení")
        b1 = self.app.prj["devices"][1]
        self.assertEqual((b1["cls"], b1["unit"], b1["rmin"], b1["rmax"]), ("AnalogIn", "bar", 0, 250))
        self.assertEqual(self.app.prj["io"][-1]["addr"], "%IW64")

        tbl = self.table()
        tbl._on_edit(str(d["id"]), "desc", "Nový popis")
        self.assertEqual(self.app.prj["devices"][0]["desc"], "Nový popis")

        self.app.prj["program"]["estop"] = d["id"]
        self.app.prj["program"]["seq"] = [{"dev": d["id"], "act": "start", "cond": "fbk", "timeS": 3}]
        tbl.select(d["id"])
        self.click("Odstranit vybrané")
        self.assertEqual([x["name"] for x in self.app.prj["devices"]], ["B1"])
        self.assertEqual(self.app.prj["program"], {"modes": True, "estop": "", "seq": []})
        self.assertEqual({e["devId"] for e in self.app.prj["io"]}, {b1["id"]})

    def test_platform_cards_toggle(self):
        self.app.reset_project()
        self.goto(2)
        cards = [w for w in walk(self.app.view) if isinstance(w, tk.Frame) and not isinstance(w, ttk.Frame)]
        self.assertEqual(len(cards), 7)
        cards[1].event_generate("<Button-1>", x=5, y=5)
        self.root.update()
        self.assertEqual(self.app.prj["platforms"], ["siemens", "rockwell"])
        cards = [w for w in walk(self.app.view) if isinstance(w, tk.Frame) and not isinstance(w, ttk.Frame)]
        cards[0].event_generate("<Button-1>", x=5, y=5)
        self.root.update()
        self.assertEqual(self.app.prj["platforms"], ["rockwell"])

    def test_io_edit_validation_fix_and_renumber(self):
        self.app.load_sample("small")
        self.goto(4)
        tbl = self.table()
        io = self.app.prj["io"]
        key0, key1 = io[0]["key"], io[1]["key"]
        tbl._on_edit(key0, "tag", "Čerpadlo běh")
        self.assertEqual(self.app.prj["io"][0]["tag"], "Čerpadlo běh")
        self.click("Opravit tagy automaticky (ASCII)")
        self.assertEqual(self.app.prj["io"][0]["tag"], "Cerpadlo_beh")

        tbl._on_edit(key1, "tag", "Cerpadlo_beh")          # duplicitní tag → červeně
        self.assertIn("dup", tbl.tv.item(key0, "tags"))
        self.assertIn("dup", tbl.tv.item(key1, "tags"))
        self.click("Opravit tagy automaticky (ASCII)")
        self.assertEqual(self.app.prj["io"][1]["tag"], "Cerpadlo_beh_2")
        self.assertNotIn("dup", tbl.tv.item(key1, "tags"))

        di = next(e for e in self.app.prj["io"] if e["dir"] == "DI" and not e.get("nc"))
        tbl._on_click(di["key"], "nc")
        self.assertTrue(di["nc"])
        do = next(e for e in self.app.prj["io"] if e["dir"] == "DO")
        tbl._on_click(do["key"], "nc")                     # NC má smysl jen u DI
        self.assertFalse(do.get("nc"))

        tbl._on_edit(key0, "addr", "%I7.7")
        self.click("Přečíslovat adresy od nuly")
        dis = [e["addr"] for e in self.app.prj["io"] if e["dir"] == "DI"]
        self.assertEqual(dis[:2], ["%I0.0", "%I0.1"])

    def test_io_cell_editing_by_mouse(self):
        """Skutečný dvojklik do buňky otevře editor; Enter potvrdí, Esc zahodí,
        klik do sloupce NC přepne zaškrtnutí."""
        self.app.load_sample("small")
        self.goto(4)
        tbl = self.table()
        e = self.app.prj["io"][0]

        def at(col):
            x, y, w, h = tbl.tv.bbox(e["key"], col)
            return {"x": x + w // 2, "y": y + h // 2}

        def dblclick(col):
            # <Double-1> nejde vygenerovat přímo — Tk ho pozná ze dvou stisků po sobě
            for seq in ("<ButtonPress-1>", "<ButtonRelease-1>") * 2:
                tbl.tv.event_generate(seq, **at(col))
            self.root.update()

        dblclick("cmt")
        self.assertEqual(tbl._editor.get(), e["cmt"])
        tbl._editor.delete(0, "end")
        tbl._editor.insert(0, "Nový komentář")
        tbl._editor.event_generate("<Return>")
        self.root.update()
        self.assertIsNone(tbl._editor)
        self.assertEqual(self.app.prj["io"][0]["cmt"], "Nový komentář")
        self.assertEqual(tbl.tv.set(e["key"], "cmt"), "Nový komentář")

        dblclick("tag")
        tbl._editor.insert(0, "zahodit_")
        tbl._editor.event_generate("<Escape>")
        self.root.update()
        self.assertEqual(self.app.prj["io"][0]["tag"], e["tag"])

        dblclick("dir")                                     # směr upravit nejde
        self.assertIsNone(tbl._editor)

        self.assertFalse(e.get("nc"))
        tbl.tv.event_generate("<ButtonRelease-1>", **at("nc"))
        self.root.update()
        self.assertTrue(self.app.prj["io"][0]["nc"])
        self.assertEqual(tbl.tv.set(e["key"], "nc"), "☑")

    def test_schema_draws_on_canvas_and_saves_drawings(self):
        self.app.load_sample("small")
        self.goto(5)
        views = self.find(SvgView)
        self.assertEqual(len(views), 2)
        for v in views:
            self.assertGreater(len(v.canvas.find_all()), 20)
        before = len(views[1].canvas.find_all())
        sheet_combo = self.find(ttk.Combobox)[0]
        sheet_combo.set(sheet_combo.cget("values")[-1])
        self.root.update()
        self.assertNotEqual(len(views[1].canvas.find_all()), before)
        out = tempfile.mkdtemp()
        with mock.patch("tkinter.filedialog.askdirectory", return_value=out):
            self.click("Uložit všechny výkresy do složky…")
        names = sorted(os.listdir(out))
        self.assertIn("00_blokove_schema.svg", names)
        self.assertEqual(sum(n.endswith(".dxf") for n in names), len(sheet_combo.cget("values")))
        self.assertTrue(Path(out, names[1]).read_text(encoding="utf-8").strip())

    def test_program_sequence_editing(self):
        self.app.load_sample("small")
        self.goto(6)
        seq = self.app.prj["program"]["seq"]
        n = len(seq)
        self.click("Přidat krok")
        seq = self.app.prj["program"]["seq"]
        self.assertEqual(len(seq), n + 1)
        self.assertEqual(seq[-1]["cond"], "fbk")
        self.assertNotEqual(seq[-1]["dev"], 0)

        last = dict(seq[-1])
        self.click("↑ Nahoru")                              # nově přidaný krok je vybraný
        self.assertEqual(self.app.prj["program"]["seq"][-2], last)
        self.click("× Odstranit")
        self.assertEqual(len(self.app.prj["program"]["seq"]), n)
        self.assertNotIn(last, self.app.prj["program"]["seq"][n - 1:n])

        dev_combo = self.find(ttk.Combobox)[1]
        dev_combo.set(dev_combo.cget("values")[-1])          # čekání bez zařízení
        self.root.update()
        self.click("Přidat krok")
        self.assertEqual(self.app.prj["program"]["seq"][-1],
                         {"dev": 0, "act": "wait", "cond": "time", "timeS": 3})

        estop = self.find(ttk.Combobox)[0]
        estop.set(estop.cget("values")[0])
        self.assertEqual(self.app.prj["program"]["estop"], "")

    def test_generated_sources_and_documentation_save(self):
        self.app.load_sample("small")
        self.app.prj["platforms"] = ["siemens", "beckhoff"]
        self.goto(7)
        code = self.find(tk.Text)[0]
        self.assertGreater(len(code.get("1.0", "end")), 50)
        out = tempfile.mkdtemp()
        with mock.patch("tkinter.filedialog.askdirectory", return_value=out):
            self.click("Uložit všechny soubory platformy…")
        names = os.listdir(out)
        self.assertTrue(names and all(n.startswith("siemens_") for n in names))
        self.assertIn("FUNCTION_BLOCK", Path(out, "siemens_Gen_Main.scl").read_text(encoding="utf-8"))

        radios = self.find(ttk.Radiobutton)
        radios[1].invoke()                                   # druhá platforma
        self.root.update()
        one = str(Path(tempfile.mkdtemp(), "x.txt"))
        with mock.patch("tkinter.filedialog.asksaveasfilename", return_value=one) as dlg:
            self.click("Uložit zobrazený soubor…")
        self.assertTrue(dlg.call_args.kwargs["initialfile"].startswith("beckhoff_"))
        self.assertEqual(Path(one).read_text(encoding="utf-8"), code.get("1.0", "end-1c"))

        self.goto(8)
        out2 = tempfile.mkdtemp()
        with mock.patch("tkinter.filedialog.askdirectory", return_value=out2):
            self.click("Uložit vše do složky…")
        saved = os.listdir(out2)
        self.assertIn("01_funkcni_specifikace_FDS.md", saved)
        self.assertTrue(any(n.endswith(".dxf") for n in saved))
        self.assertTrue(any(n.startswith("beckhoff_") for n in saved))
        with mock.patch("tkinter.filedialog.askdirectory", return_value=out2), \
                mock.patch("tkinter.messagebox.askyesno", return_value=False) as ask:
            self.click("Uložit vše do složky…")
        ask.assert_called_once()                             # přepis jen po potvrzení

    def test_documentation_preview_switches_between_text_and_drawing(self):
        self.app.load_sample("small")
        self.goto(8)
        lst = self.table()
        files = [lst.tv.item(i, "text") for g in lst.tv.get_children() for i in lst.tv.get_children(g)]
        dxf = next(i for g in lst.tv.get_children() for i in lst.tv.get_children(g)
                   if lst.tv.item(i, "text").endswith(".dxf"))
        self.assertIn("02_io_list.csv", files)
        view = self.find(SvgView)[0]
        self.assertFalse(view.winfo_ismapped())
        lst.select(dxf)
        self.root.update()
        self.assertTrue(view.winfo_ismapped())
        self.assertGreater(len(view.canvas.find_all()), 20)

    def test_project_file_roundtrip(self):
        self.app.load_sample("small")
        self.app.prj["meta"]["name"] = "Zkouška ěščř"
        want = json.loads(json.dumps(self.app.prj))
        path = str(Path(tempfile.mkdtemp(), "p.plcstudio.json"))
        with mock.patch("tkinter.filedialog.asksaveasfilename", return_value=path):
            self.app.save_project_dialog()
        self.assertEqual(set(json.loads(Path(path).read_text(encoding="utf-8"))), {"prj", "ai"})
        self.app.reset_project()
        self.assertTrue(self.app.open_project(path))
        self.assertEqual(self.app.prj, want)
        self.assertEqual(len(self.app.ai["turns"]), 2)

        bad = Path(tempfile.mkdtemp(), "bad.json")
        bad.write_text("{nic", encoding="utf-8")
        with mock.patch("tkinter.messagebox.showerror") as err:
            self.assertFalse(self.app.open_project(bad))
        err.assert_called_once()
        self.assertEqual(self.app.prj, want)                 # vadný soubor návrh nezničí

    def test_state_survives_restart(self):
        self.app.load_sample("small")
        self.app.prj["meta"]["name"] = "Trvalý stav"
        self.app.step = 4
        self.app._flush()
        state = json.loads((self.app.home / "state.json").read_text(encoding="utf-8"))
        self.assertEqual((state["prj"]["meta"]["name"], state["step"]), ("Trvalý stav", 4))
        self.app.prj, self.app.step = self.app.core("blankProject"), 0
        self.app._load_state()
        self.assertEqual((self.app.prj["meta"]["name"], self.app.step), ("Trvalý stav", 4))

    def test_import_dialog_preview_and_apply(self):
        self.app.load_sample("small")
        self.goto(3)
        dlg = ImportDialog(self.app)
        try:
            dlg.txt.insert("1.0", "tohle není export")
            dlg._analyze()
            self.assertIsNone(dlg.built)
            dlg.txt.delete("1.0", "end")
            dlg.txt.insert("1.0", PLAIN_IO)
            dlg._analyze()
            self.assertEqual([d["name"] for d in dlg.built["devices"]], ["M7", "S9"])
            self.assertEqual(len(self.app.prj["devices"]), 7)  # náhled nic nepřepsal
            with mock.patch("tkinter.messagebox.askyesno", return_value=True):
                dlg._apply()
        finally:
            if dlg.win.winfo_exists():
                dlg.win.destroy()
        self.root.update()
        self.assertEqual([d["name"] for d in self.app.prj["devices"]], ["M7", "S9"])
        self.assertEqual(self.app.prj["program"]["seq"], [])
        self.assertTrue(all(e["addr"] for e in self.app.prj["io"]))

    def _wait_ai(self):
        deadline = time.time() + 5
        while self.app.ui["ai"]["busy"] and time.time() < deadline:
            self.root.update()
            time.sleep(0.02)
        self.root.update()
        self.assertFalse(self.app.ui["ai"]["busy"])

    def test_ai_flow_with_mocked_api(self):
        self.app.reset_project()
        self.app.settings["ai_key"] = "test-key"
        self.goto(1)
        self.click("Navrhnout zařízení")                    # prázdný vstup → nic se neodešle
        self.assertEqual(self.app.ai["turns"], [])

        seen = {}

        def fake(key, model, messages, timeout=120):
            seen.update(key=key, model=model, messages=messages)
            return AI_REPLY

        with mock.patch.object(ai_client, "call", fake):
            self.find(tk.Text)[0].insert("1.0", "Stanice s čerpadlem a měřením tlaku")
            self.click("Navrhnout zařízení")
            self._wait_ai()
        self.assertEqual(seen["key"], "test-key")
        self.assertEqual(seen["model"], ai_client.DEFAULT_MODEL)
        self.assertIn("PLC Studio", seen["messages"][0]["content"])
        self.assertEqual(seen["messages"][-1]["content"], "Stanice s čerpadlem a měřením tlaku")
        self.assertEqual([t["role"] for t in self.app.ai["turns"]], ["user", "assistant"])
        self.assertEqual(len(self.app.ai["last"]["devices"]), 3)

        self.click("Převzít návrh (nahradí zařízení)")
        prj = self.app.prj
        self.assertEqual(self.app.step, 3)
        self.assertEqual([d["name"] for d in prj["devices"]], ["S1", "M1", "B1"])
        self.assertEqual(prj["program"]["estop"], prj["devices"][0]["id"])
        self.assertEqual(prj["program"]["seq"],
                         [{"dev": prj["devices"][1]["id"], "act": "start", "cond": "fbk", "timeS": 3},
                          {"dev": 0, "act": "wait", "cond": "time", "timeS": 5}])
        self.assertTrue(next(e for e in prj["io"] if e["tag"] == "S1_in")["nc"])

    def test_ai_error_restores_draft(self):
        self.app.reset_project()
        self.app.settings["ai_key"] = "test-key"
        self.goto(1)

        def fake(*_a, **_k):
            raise ai_client.AiError("bad_key", "invalid x-api-key")

        with mock.patch.object(ai_client, "call", fake):
            self.find(tk.Text)[0].insert("1.0", "Popis stroje")
            self.click("Navrhnout zařízení")
            self._wait_ai()
        self.assertEqual(self.app.ai["turns"], [])
        self.assertEqual(self.app.ai["draft"], "Popis stroje")
        labels = [str(w.cget("text")) for w in self.find(ttk.Label)]
        self.assertIn("API klíč byl odmítnut (401).", labels)

    def test_ai_without_key_sends_nothing(self):
        self.app.reset_project()
        self.app.settings["ai_key"] = ""
        self.goto(1)
        with mock.patch.object(ai_client, "call", side_effect=AssertionError("nesmí se volat")):
            self.find(tk.Text)[0].insert("1.0", "Popis stroje")
            self.click("Navrhnout zařízení")
        self.assertEqual(self.app.ai["turns"], [])
        self.assertFalse(self.app.ui["ai"]["busy"])


if __name__ == "__main__":
    unittest.main()
