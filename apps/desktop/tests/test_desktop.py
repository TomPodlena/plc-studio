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
from plc_studio.detail import DevicePanel  # noqa: E402
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

    def test_simulation_and_verification_through_bridge(self):
        p = self.b.call("sampleSmall")
        scen = self.b.request("scenarios", prj=p)["scenarios"]
        self.assertEqual(scen[0]["id"], "nominal")
        self.assertIn("estop", [s["id"] for s in scen])
        res = self.b.request("simulate", prj=p, opts=scen[0]["opts"])
        self.assertTrue(res["run"]["ok"])
        self.assertEqual([s["i"] for s in res["run"]["steps"]], [0, 1, 2, 3, 4])
        self.assertIn('data-step="4"', res["flow"])
        self.assertIn("data-plot=", res["timing"])
        ver = self.b.request("verify", prj=p)
        self.assertTrue(ver["ok"])
        self.assertTrue(all(c["scenario"] in {s["id"] for s in ver["scenarios"]}
                            for c in ver["checks"] if c.get("scenario")))
        terms = self.b.request("terminals", prj=p)["map"]
        self.assertEqual(set(terms), {e["key"] for e in p["io"]})
        self.assertEqual(terms[p["io"][0]["key"]]["svorka"], "X1:1")

    def test_bridge_restarts_after_process_death(self):
        self.b._proc.kill()
        self.b._proc.wait()
        self.assertEqual(self.b.call("sanitizeTag", "Čerpadlo 1 běh"), "Cerpadlo_1_beh")


class SvgTest(unittest.TestCase):
    def test_parse_reads_links_and_descriptions(self):
        b = CoreBridge()
        try:
            p = b.call("sampleSmall")
            s = b.request("schema", prj=p)
        finally:
            b.close()
        doc = parse_svg(s["block"])
        m1 = next(d for d in p["devices"] if d["name"] == "M1")
        boxes = [m for m in doc["metas"] if m.get("dev") == m1["id"] and "side" in m]
        self.assertEqual(sorted(m["side"] for m in boxes), ["in", "out"])
        self.assertTrue(boxes[0]["title"].startswith("M1 — Čerpadlo hydrauliky"))
        self.assertIn("M1_outRun", boxes[0]["title"])
        wires = [m for m in doc["metas"] if "io" in m]
        self.assertEqual(len(wires), len(p["io"]))
        self.assertTrue(all({"dev", "mod"} <= set(m) for m in wires))
        # texty a rámeček bloku sdílejí odkaz skupiny <g>
        idx = doc["metas"].index(boxes[0])
        self.assertEqual(sorted(it[0] for it in doc["items"] if it[-1] == idx),
                         ["rect", "text", "text"])
        sheet = parse_svg(s["sheets"][0]["svg"])
        self.assertEqual(len([m for m in sheet["metas"] if "io" in m]), 6)   # 6 kanálů DI

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

    def key(self, widget, sequence):
        """Stisk klávesy v poli. Fokus se vynucuje — bez něj (zamčená stanice,
        okno na pozadí) Tk klávesy nikam nedoručí."""
        widget.focus_force()
        self.root.update()
        widget.event_generate(sequence)
        self.root.update()

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
        self.key(tbl._editor, "<Return>")
        self.assertIsNone(tbl._editor)
        self.assertEqual(self.app.prj["io"][0]["cmt"], "Nový komentář")
        self.assertEqual(tbl.tv.set(e["key"], "cmt"), "Nový komentář")

        dblclick("tag")
        tbl._editor.insert(0, "zahodit_")
        self.key(tbl._editor, "<Escape>")
        self.assertIsNone(tbl._editor)
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
        self.assertEqual(len(views), 3)              # blokové schéma, funkční diagram, zapojení
        for v in views:
            self.assertGreater(len(v.canvas.find_all()), 20)
        before = len(views[2].canvas.find_all())
        sheet_combo = self.find(ttk.Combobox)[0]
        sheet_combo.set(sheet_combo.cget("values")[-1])
        self.root.update()
        self.assertNotEqual(len(views[2].canvas.find_all()), before)
        out = tempfile.mkdtemp()
        with mock.patch("tkinter.filedialog.askdirectory", return_value=out):
            self.click("Uložit všechny výkresy do složky…")
        names = sorted(os.listdir(out))
        self.assertIn("00_blokove_schema.svg", names)
        self.assertIn("00_funkcni_diagram.svg", names)
        self.assertEqual(sum(n.endswith(".dxf") for n in names), len(sheet_combo.cget("values")))
        self.assertTrue(Path(out, names[1]).read_text(encoding="utf-8").strip())

    # --- interaktivní schémata a odkazy ---------------------------------------------

    def links(self, parent=None):
        """Odkazy (popisky s ``invoke``) podle textu."""
        return {str(w.cget("text")): w for w in walk(parent or self.app.view)
                if isinstance(w, tk.Label) and hasattr(w, "invoke")}

    def canvas_click(self, view, meta_pred, motion_only=False):
        """Skutečný pohyb / klik myší na prvek výkresu, jehož meta splní predikát."""
        idx = next(i for i, m in enumerate(view.metas()) if meta_pred(m))
        c = view.canvas
        x0, y0, x1, y1 = c.bbox(c.find_withtag(f"m{idx}")[0])   # střed prvního prvku celku
        x = int((x0 + x1) / 2 - c.canvasx(0))
        y = int((y0 + y1) / 2 - c.canvasy(0))
        c.event_generate("<Motion>", x=x, y=y)
        if not motion_only:
            c.event_generate("<ButtonPress-1>", x=x, y=y)
            c.event_generate("<ButtonRelease-1>", x=x, y=y)
        self.root.update()
        return idx

    def test_block_diagram_click_opens_device_with_links_to_its_io(self):
        self.app.load_sample("small")
        self.goto(5)
        prj = self.app.prj
        m1 = next(d for d in prj["devices"] if d["name"] == "M1")
        view, panel = self.find(SvgView)[0], self.find(DevicePanel)[0]
        self.assertIsNone(panel.dev_id)

        # najetí myší zvýrazní blok i jeho signálové čáry, klik otevře panel zařízení
        self.canvas_click(view, lambda m: m.get("dev") == m1["id"] and m.get("side") == "out",
                          motion_only=True)
        hot = [m for m, mark in zip(view.metas(), view._marks()) if mark == "hot"]
        self.assertTrue(hot and all(m.get("dev") == m1["id"] for m in hot))
        self.assertEqual(sum("io" in m for m in hot), 3)         # běh, porucha, povel
        self.canvas_click(view, lambda m: m.get("dev") == m1["id"] and m.get("side") == "out")
        self.assertEqual(panel.dev_id, m1["id"])
        self.assertEqual(self.app.ui["block_sel"], m1["id"])
        sel = [m for m, mark in zip(view.metas(), view._marks()) if mark == "sel"]
        self.assertTrue(all(m.get("dev") == m1["id"] for m in sel) and len(sel) >= 5)

        links = self.links(panel)
        for tag in ("M1_fbkRunning", "M1_fault", "M1_outRun"):
            self.assertIn(tag, links)
        self.assertIn("Krok 2: M1 start → zpětné hlášení", links)

        # tag → krok I/O s vybraným řádkem
        key = next(e["key"] for e in prj["io"] if e["tag"] == "M1_fault")
        links["M1_fault"].invoke()
        self.root.update()
        self.assertEqual(self.app.step, 4)
        self.assertEqual(self.table().selected(), key)

        # svorka → list zapojení s tímto signálem (jiný list než výchozí)
        out_key = next(e["key"] for e in prj["io"] if e["tag"] == "M1_outRun")
        self.app.open_block(m1["id"])
        self.root.update()
        panel = self.find(DevicePanel)[0]
        self.assertEqual(panel.dev_id, m1["id"])                  # výběr přežil návrat
        term = next(t for t in self.links(panel) if t.startswith("X2:"))
        self.links(panel)[term].invoke()
        self.root.update()
        self.assertEqual((self.app.step, self.app.ui["schema_tab"]), (5, 2))
        self.assertEqual(self.app.ui["wire_sel"], out_key)
        self.assertTrue(self.find(ttk.Combobox)[0].get().startswith("DO1"))
        sheet = self.find(SvgView)[2]
        marked = [m for m, mark in zip(sheet.metas(), sheet._marks()) if mark == "sel"]
        self.assertEqual([m["io"] for m in marked], [out_key])

        # z listu zapojení zpět na zařízení (odkaz v řádku nad výkresem)
        self.links(sheet.master)["Zařízení ↗"].invoke()
        self.root.update()
        self.assertEqual(self.app.step, 3)
        self.assertEqual(self.table().selected(), str(m1["id"]))
        self.assertEqual(self.find(DevicePanel)[0].dev_id, m1["id"])

    def test_link_target_row_is_scrolled_into_view(self):
        """Odkaz na řádek hluboko v tabulce ho musí i ukázat (ne jen vybrat)."""
        self.app.load_sample("complex")
        h4 = next(d for d in self.app.prj["devices"] if d["name"] == "H4")   # poslední zařízení
        key = next(e["key"] for e in self.app.prj["io"] if e["devId"] == h4["id"])
        self.app.open_io(key)
        self.root.update()
        self.assertEqual(self.table().selected(), key)
        self.assertTrue(self.table().tv.bbox(key), "řádek signálu není ve výřezu")
        self.app.open_device(h4["id"])
        self.root.update()
        self.assertTrue(self.table().tv.bbox(str(h4["id"])), "řádek zařízení není ve výřezu")
        self.app.open_flow(17)                                   # poslední krok dlouhého diagramu
        self.root.update()
        flow = self.find(SvgView)[1]
        idx = next(i for i, m in enumerate(flow.metas()) if m.get("step") == 17)
        top = flow.canvas.canvasy(0)
        box = flow.canvas.bbox(f"m{idx}")
        self.assertTrue(top <= box[1] and box[3] <= top + flow.canvas.winfo_height(),
                        "krok není ve výřezu")

    def test_block_diagram_module_click_opens_its_wiring_sheet(self):
        self.app.load_sample("small")
        self.goto(5)
        view = self.find(SvgView)[0]
        self.canvas_click(view, lambda m: m.get("mod") == 2 and "dev" not in m)
        nb = self.find(ttk.Notebook)[0]
        self.assertEqual(nb.index(nb.select()), 2)
        self.assertTrue(self.find(ttk.Combobox)[0].get().startswith("AI1"))

    def test_flow_diagram_step_click_and_wiring_channel_click(self):
        self.app.load_sample("small")
        self.app.open_flow(None)
        self.root.update()
        flow, panel = self.find(SvgView)[1], self.find(DevicePanel)[1]
        self.assertEqual(sum("step" in m for m in flow.metas()), 6)   # klid + 5 kroků
        self.canvas_click(flow, lambda m: m.get("step") == 1)
        m1 = next(d for d in self.app.prj["devices"] if d["name"] == "M1")
        self.assertEqual((self.app.ui["flow_sel"], panel.dev_id), (1, m1["id"]))
        self.links(panel)["Upravit v programu ↗"].invoke()
        self.root.update()
        self.assertEqual((self.app.step, self.app.ui["seq_sel"]), (6, 1))

        self.app.ui["schema_tab"] = 2
        self.goto(5)
        sheet = self.find(SvgView)[2]
        key = next(m["io"] for m in sheet.metas() if "io" in m)
        self.canvas_click(sheet, lambda m: m.get("io") == key)
        self.assertEqual(self.app.ui["wire_sel"], key)
        # stačí kliknout kamkoli do řádku kanálu, ne přesně na čáru
        other = next(m["io"] for m in sheet.metas() if m.get("io") not in (None, key))
        idx = next(i for i, m in enumerate(sheet.metas()) if m.get("io") == other)
        c = sheet.canvas
        lx0, ly0, lx1, _ly1 = c.bbox(c.find_withtag(f"m{idx}")[0])      # vodič kanálu
        x, y = int(lx1 + 40 - c.canvasx(0)), int(ly0 + 9 - c.canvasy(0))  # prázdné místo pod ním
        self.assertEqual(c.find_overlapping(c.canvasx(x) - 2, c.canvasy(y) - 2,
                                            c.canvasx(x) + 2, c.canvasy(y) + 2), ())
        self.assertEqual(sheet._meta_at(x, y), idx)
        self.links(sheet.master)["I/O ↗"].invoke()
        self.root.update()
        self.assertEqual((self.app.step, self.table().selected()), (4, key))

    def test_canvas_drag_pans_instead_of_clicking(self):
        self.app.load_sample("complex")
        self.goto(5)
        view = self.find(SvgView)[0]
        c = view.canvas
        c.event_generate("<ButtonPress-1>", x=120, y=60)
        c.event_generate("<B1-Motion>", x=120, y=20)
        c.event_generate("<ButtonRelease-1>", x=120, y=20)
        self.root.update()
        self.assertIsNone(self.app.ui.get("block_sel"))
        self.assertGreater(c.canvasy(0), 0)

    # --- simulace a ověření --------------------------------------------------------

    def open_sim(self, scenario="nominal", tab=0):
        self.app.ui["sim_tab"] = tab
        self.app.open_sim(scenario)
        self.root.update()

    def test_simulation_playback_follows_the_cycle(self):
        self.app.load_sample("small")
        self.open_sim()
        labels = [str(w.cget("text")) for w in self.find(ttk.Label)]
        self.assertTrue(any("✔ Cyklus doběhl do konce za 8.09 s. Na konci jsou všechny výstupy "
                            "vypnuté." in t for t in labels), labels)
        flow = self.find(SvgView)[0]
        marks = dict(zip((m.get("step") for m in flow.metas()), flow._marks()))
        self.assertEqual(marks, {-1: "active", 0: "done", 1: "done", 2: "done", 3: "done", 4: "done"})

        # posuvník času doprostřed výdrže: motor běží, ventil je otevřený
        scale = self.find(ttk.Scale)[0]
        self.root.tk.call(scale.cget("command"), 3.0)
        self.root.update()
        marks = dict(zip((m.get("step") for m in flow.metas()), flow._marks()))
        self.assertEqual(marks, {-1: None, 0: "done", 1: "done", 2: "active", 3: None, 4: None})
        states = next(t for t in self.find(Table) if t.tv.exists("enable"))
        m1 = next(d for d in self.app.prj["devices"] if d["name"] == "M1")
        self.assertEqual(states.tv.set(str(m1["id"]), "state"), "běží")
        self.assertEqual(states.tv.set(str(m1["id"]), "out"), "●")

        # přehrávání posouvá čas a na konci se samo zastaví
        def playing() -> bool:
            return any(str(b.cget("text")) == "⏸ Pauza" for b in self.find(ttk.Button))

        next(c for c in self.find(ttk.Combobox) if c.get() == "2×").set("10×")
        self.click("▶ Spustit")
        self.assertTrue(playing())
        deadline = time.time() + 10
        while playing() and time.time() < deadline:
            self.root.update()
            time.sleep(0.01)
        self.assertFalse(playing())
        self.assertAlmostEqual(scale.get(), 9.3, delta=0.05)
        marks = dict(zip((m.get("step") for m in flow.metas()), flow._marks()))
        self.assertEqual(marks[4], "done")

    def test_simulation_fault_scenario_and_verification_report(self):
        self.app.load_sample("small")
        self.open_sim("frozen-1")                     # krok 2: M1 bez zpětného hlášení
        labels = [str(w.cget("text")) for w in self.find(ttk.Label)]
        self.assertTrue(any("sekvence stojí v kroku 2" in t and "porucha bloku: M1" in t
                            and "Y1_outOpen" in t for t in labels), labels)
        flow = self.find(SvgView)[0]
        marks = dict(zip((m.get("step") for m in flow.metas()), flow._marks()))
        self.assertEqual(marks[1], "err")

        self.open_sim("nominal", tab=2)               # záložka Ověření se spočítá sama
        checks = next(t for t in self.find(Table) if "lvl" in t.tv["columns"])
        rows = [checks.tv.item(i, "values") for i in checks.tv.get_children()]
        self.assertEqual(rows[0], ("✔ v pořádku", "Běžný cyklus doběhne do konce"))
        self.assertTrue(any(r[0] == "⚠ upozornění" and "M1 stop" in r[1] for r in rows))
        self.assertTrue(any("Výsledek: bez chyb" in str(w.cget("text")) for w in self.find(ttk.Label)))
        warn = next(i for i in checks.tv.get_children() if "Krok 2" in checks.tv.set(i, "title"))
        checks.select(warn)
        self.root.update()
        self.links()["Přehrát scénář ↗"].invoke()
        self.root.update()
        self.assertEqual(self.app.ui["sim_scenario"], "frozen-1")
        out = str(Path(tempfile.mkdtemp(), "protokol.md"))
        with mock.patch("tkinter.filedialog.asksaveasfilename", return_value=out):
            self.click("Uložit protokol (MD)…")
        self.assertIn("## 2. Běžný cyklus", Path(out).read_text(encoding="utf-8"))

    def test_machine_model_is_saved_in_project_and_can_fail_the_cycle(self):
        self.app.load_sample("small")
        self.open_sim()
        entries = self.find(ttk.Entry)
        valve = next(e for e in entries if e.get() == "1")
        valve.delete(0, "end")
        valve.insert(0, "6")                          # pomalejší válec než timeout bloku (5 s)
        self.key(valve, "<Return>")
        self.assertEqual(self.app.prj["sim"], {"motorDelay": 0.5, "valveTravel": 6.0})
        labels = [str(w.cget("text")) for w in self.find(ttk.Label)]
        self.assertTrue(any("sekvence stojí v kroku 1" in t and "porucha bloku: Y1" in t
                            for t in labels), labels)
        self.open_sim("nominal", tab=2)
        self.assertTrue(any("NALEZENY CHYBY" in str(w.cget("text")) for w in self.find(ttk.Label)))

    def test_project_without_sequence_has_nothing_to_simulate(self):
        self.app.load_sample("small")
        self.app.prj["program"]["seq"] = []
        self.open_sim()
        self.assertEqual(self.find(SvgView), [])
        self.assertTrue(any("není co simulovat" in str(w.cget("text")) for w in self.find(ttk.Label)))

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
