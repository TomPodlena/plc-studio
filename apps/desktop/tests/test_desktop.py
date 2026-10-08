"""Testy desktopové aplikace — most do jádra, vykreslení výkresů a kroky GUI.

GUI testy otevřou skutečné okno a „klikají" na tlačítka (``invoke``); dialogy
a volání AI jsou nahrazené, takže test nic neukládá mimo dočasnou složku
a neposílá žádný dotaz na API.

Spuštění (z apps/desktop):  python -m unittest discover -s tests -v
"""

from __future__ import annotations

import json
import re
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

from plc_studio import ai_client, theme  # noqa: E402
from plc_studio.app import App  # noqa: E402
from plc_studio.bridge import BridgeError, CoreBridge  # noqa: E402
from plc_studio.detail import DevicePanel  # noqa: E402
from plc_studio.mimic import FILL, WIRE_DIM, WIRE_IN, WIRE_OFF, WIRE_OUT, Mimic  # noqa: E402
from plc_studio import importer  # noqa: E402
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


def messages_text(messages) -> str:
    """Všechny textové bloky zpráv Messages API jako jeden text."""
    out = []
    for m in messages:
        c = m["content"]
        out += [c] if isinstance(c, str) else [b.get("text", "") for b in c]
    return "\n".join(out)


class CatalogTest(unittest.TestCase):
    def test_catalogs_cover_every_text_in_sources(self):
        """Každý text z kódu má překlad ve všech jazycích se stejnými zástupnými znaky."""
        import importlib.util
        path = Path(__file__).resolve().parents[3] / "scripts" / "i18n.py"
        spec = importlib.util.spec_from_file_location("i18n_tool", path)
        tool = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(tool)
        keys, _problems = tool.collect()
        self.assertGreater(len(keys), 900)
        self.assertEqual(tool.check(), [])


def _contrast(a: str, b: str) -> float:
    """Kontrastní poměr WCAG dvou barev #RRGGBB."""
    def lum(h):
        ch = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
        ch = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in ch]
        return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
    hi, lo = sorted((lum(a), lum(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


class ThemeTest(unittest.TestCase):
    def test_brand_and_state_colors(self):
        """Značka PLCdesk (azur) a stavové barvy: čitelné a navzájem odlišné."""
        self.assertEqual((theme.FG, theme.ACCENT, theme.FIELD, theme.BORDER),
                         ("#111A2E", "#2457C5", "#F5F6F9", "#D6DCE6"))
        for fg, bg in ((theme.FG, theme.BG), (theme.ACCENT, theme.BG),
                       (theme.ACCENT_FG, theme.ACCENT), (theme.OK, theme.BG),
                       (theme.DIM, theme.BG), (theme.ERR, theme.BG)):
            self.assertGreaterEqual(_contrast(fg, bg), 4.5, (fg, bg))
        # stav ≠ značkový akcent: DI modrá, DO zelená, analog fialová, aktivní, porucha
        states = [theme.SIG_IN, theme.SIG_OUT, theme.SIG_AN, theme.WARN, theme.ERR]
        self.assertEqual(len(set(states)), len(states))
        self.assertNotIn(theme.ACCENT, states)
        self.assertEqual(WIRE_IN, theme.SIG_IN)
        self.assertEqual(WIRE_OUT, theme.SIG_OUT)
        self.assertNotEqual(theme.STATE_ON, theme.ACCENT)


class BridgeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.b = CoreBridge()
        cls.init = cls.b.request("init")

    @classmethod
    def tearDownClass(cls):
        cls.b.close()

    def test_init_exposes_core_constants(self):
        self.assertEqual(len(self.init["PLAT"]), 20)   # 8 platforem + profily CODESYS (WAGO, Delta AX + 10 dalších)
        self.assertIn("unitronics", self.init["PLAT"])
        self.assertEqual(self.init["PLAT"]["wago"]["base"], "codesys")
        self.assertTrue(self.init["PLAT"]["delta"]["oop"])
        self.assertIn("Motor", self.init["CLS"])

    def test_unitronics_sources_through_bridge(self):
        p = self.b.call("sampleSmall")
        p["platforms"] = ["unitronics"]
        out = self.b.request("gen", prj=p)["out"]["unitronics"]
        self.assertEqual(list(out), ["Tags.csv", "Machine.st", "README.txt"])
        self.assertNotIn("FUNCTION_BLOCK", out["Machine.st"])
        self.assertTrue(out["Machine.st"].isascii() and out["Tags.csv"].isascii())
        self.assertIn("STAV OVĚŘENÍ: JAZYK OVĚŘEN", out["README.txt"])

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
        self.assertTrue(any(s["id"] == "recover" for s in ver["scenarios"]))
        frozen = next(s for s in scen if s["id"] == "frozen-1")
        run = self.b.request("simulate", prj=p, opts=frozen["opts"])["run"]
        self.assertTrue(run["faulted"] and run["fault"])
        self.assertEqual((run["faultStep"], run["outputsOn"]), (1, []))

        # živá simulace: tlačítka přes most (start, porucha, kvitace, ruční povel)
        live = self.b.request("live.start", prj=p)
        self.assertEqual([m["name"] for m in live["mods"]], ["DI1", "DO1", "AI1"])
        self.assertEqual(sum(len(m["ch"]) for m in live["mods"]), len(p["io"]))
        y1 = next(d for d in p["devices"] if d["name"] == "Y1")
        step = self.b.request("live.step", ms=1500, start=True, controls={"frozen": [y1["id"]]})
        self.assertEqual((step["frame"]["step"], step["stepTitle"]), (0, "Y1 otevřít"))
        step = self.b.request("live.step", ms=5000)
        self.assertTrue(step["frame"]["fault"])
        self.assertEqual(step["frame"]["faultStep"], 0)
        step = self.b.request("live.step", ms=1000, ack=True, controls={"frozen": []})
        self.assertFalse(step["frame"]["fault"])
        step = self.b.request("live.step", ms=2000,
                              controls={"modeAuto": False, "man": {str(y1["id"]): True}})
        self.assertEqual(step["frame"]["dev"][str(y1["id"])]["label"], "otevřeno")
        self.assertEqual(step["frame"]["dev"][str(y1["id"])]["pos"], 1)

        # vnucený vstup: program čte vnucenou hodnotu, po uvolnění zase stav stroje
        closed = next(e["key"] for e in p["io"] if e["tag"] == "Y1_fbkClosed")
        step = self.b.request("live.step", ms=0, controls={"force": {closed: True}})
        self.assertIs(step["frame"]["io"][closed], True)
        self.assertIn("Y1_fbkClosed: vstup vnucen na TRUE", [e["msg"] for e in step["events"]])
        step = self.b.request("live.step", ms=100, controls={"force": {}})
        self.assertIs(step["frame"]["io"][closed], False)

        terms = self.b.request("terminals", prj=p)["map"]
        self.assertEqual(set(terms), {e["key"] for e in p["io"]})
        self.assertEqual(terms[p["io"][0]["key"]]["svorka"], "X1:1")

    def test_import_ai_through_bridge_without_api(self):
        """Import podkladů: jádro → odhad → zprávy s bloky PDF/obrázek → normalizace odpovědi."""
        import base64
        pdf = ("%PDF-1.4\n1 0 obj << /Type /Pages /Count 2 >> endobj\n"
               "2 0 obj << /Type /Page >> endobj\n3 0 obj << /Type /Page >> endobj\n%%EOF")
        png = bytearray(33)
        png[:8] = b"\x89PNG\r\n\x1a\n"
        png[12:16] = b"IHDR"
        png[16:20] = (1600).to_bytes(4, "big")
        png[20:24] = (1200).to_bytes(4, "big")
        with tempfile.TemporaryDirectory() as tmp:
            paths = {"schema.pdf": pdf.encode("latin-1"), "stitek.png": bytes(png),
                     "io.csv": PLAIN_IO.encode("utf-8"), "popis.txt": "Čerpadlo běží 5 s.".encode("cp1250")}
            for n, b in paths.items():
                Path(tmp, n).write_bytes(b)
            files = [ai_client.input_file(Path(tmp, n)) for n in paths]
        by = {f["name"]: f for f in files}
        self.assertEqual(by["schema.pdf"]["mime"], "application/pdf")
        self.assertEqual(base64.b64decode(by["schema.pdf"]["data"]).decode("latin-1"), pdf)
        self.assertEqual(by["stitek.png"]["mime"], "image/png")
        self.assertEqual(by["popis.txt"]["text"], "Čerpadlo běží 5 s.")       # cp1250 → text
        self.assertNotIn("data", by["io.csv"])

        ext = self.b.request("import.extract", files=files)
        ex = ext["ex"]
        for k in ("files", "signals", "pous", "unparsed"):
            self.assertIsInstance(ex[k], list)
        self.assertIn("prj", ext["proposal"])
        # binární obsah do jádra nejde
        self.assertTrue(all("data" not in u for u in ex["unparsed"]))
        self.assertIn("schema.pdf", [u["name"] for u in ex["unparsed"]])

        est = self.b.request("import.estimate", files=files, ex=ex, model="claude-sonnet-5-5")
        self.assertGreater(est["inputTokens"], 2 * 2250)
        self.assertGreater(est["usd"], 0)
        self.assertLess(est["usd"], 1)
        self.assertEqual(est["priceDate"], "2026-10-03")

        msg = self.b.request("import.messages", ex=ex, files=files, model="claude-sonnet-5-5")
        content = msg["messages"][0]["content"]
        doc = next(b for b in content if b["type"] == "document")
        self.assertEqual(doc["source"]["media_type"], "application/pdf")
        self.assertEqual(doc["source"]["data"], by["schema.pdf"]["data"])
        img = next(b for b in content if b["type"] == "image")
        self.assertEqual(img["source"]["media_type"], "image/png")
        self.assertIn("NIC NEVYMÝŠLEJ", content[-1]["text"])
        ai_client._check_content(content)               # bloky projdou kontrolou klienta

        raw = ('```json\n{"devices":[{"name":"-M1","cls":"Motor","desc":"Čerpadlo","opt":{}},'
               '{"name":"-S1","cls":"DI","desc":"Nouzové zastavení (NC)","opt":{}}],"estop":"-S1",'
               '"io":[{"dev":"M1","sig":"outRun","addr":"%Q1.0"},{"dev":"S1","sig":"in","addr":"%I3.0"}],'
               '"evidence":{"dev:-M1":{"conf":"sure","src":[{"file":"schema.pdf","page":2,"quote":"-M1"}]},'
               '"io:M1_outRun":{"conf":"sure","src":[{"file":"schema.pdf","page":2,"quote":"%Q1.0"}]},'
               '"estop":{"conf":"sure","src":[]}},"missing":["Chybí popis cyklu"]}\n```')
        res = self.b.request("import.norm", raw=raw, ex=ex, files=files, exact=ext["proposal"])
        p = res["proposal"]
        # doplněk AI se skládá s přesným návrhem (zařízení z io.csv zůstanou)
        names = [d["name"] for d in p["prj"]["devices"]]
        self.assertEqual(names[-2:], ["M1", "S1"])
        self.assertEqual(names[:-2], [d["name"] for d in ext["proposal"]["prj"]["devices"]])
        self.assertEqual(p["evidence"]["dev:M1"]["src"][0]["page"], 2)
        self.assertIn("estop", p["dropped"])                            # „sure" bez zdroje zahozeno
        if ext["proposal"]["prj"]["program"]["estop"] != "":            # E-stop z přesných dat má přednost
            self.assertEqual(p["prj"]["program"]["estop"], ext["proposal"]["prj"]["program"]["estop"])
        else:
            self.assertEqual(p["evidence"]["estop"]["conf"], "missing")
        addr = {e["tag"]: e["addr"] for e in p["prj"]["io"]}
        self.assertEqual(addr["M1_outRun"], "%Q1.0")              # doložená adresa
        self.assertEqual(addr["S1_in"], "")                       # bez zdroje → doplní jádro
        self.assertEqual(p["evidence"]["io:S1_in"]["conf"], "missing")
        self.assertEqual(p["missing"], ["Chybí popis cyklu"])
        self.assertIsNotNone(res["merged"])
        # navazující odpovědi: doplněk se skládá, "more" řídí pokračování; zprávy pokračování
        comb = self.b.request("import.combine", acc=None, raw=raw)
        self.assertFalse(comb["more"])
        comb = self.b.request("import.combine", acc=comb["acc"],
                              raw='{"devices":[{"name":"-Y1","cls":"Ventil","desc":"Upínání"}],"more":true}')
        self.assertTrue(comb["more"])
        self.assertEqual([d["name"] for d in comb["acc"]["devices"]], ["M1", "S1", "Y1"])
        cont = self.b.request("import.messages", ex=ex, files=files, model="claude-sonnet-5-5",
                              cont=['{"devices":[],"more":true}'])
        self.assertEqual([m["role"] for m in cont["messages"]], ["user", "assistant", "user"])
        self.assertEqual(cont["messages"][0]["content"][-1]["cache_control"], {"type": "ephemeral"})
        for m in cont["messages"]:
            ai_client._check_content(m["content"])
        with self.assertRaises(BridgeError) as cm:
            self.b.request("import.norm", raw="bez json", ex=ex)
        self.assertEqual(cm.exception.code, "invalid_json")

    def test_ai_client_sends_content_blocks(self):
        """Klient API pošle obsah jako seznam bloků; neplatný blok neodejde."""
        sent = {}

        class Resp:
            def __init__(self, body):
                self.body = body

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return json.dumps(self.body).encode("utf-8")

        def fake(req, timeout=0):
            sent["body"] = json.loads(req.data.decode("utf-8"))
            sent["timeout"] = timeout
            return Resp({"content": [{"type": "text", "text": "{}"}], "stop_reason": "end_turn",
                         "usage": {"input_tokens": 5, "output_tokens": 1}})

        blocks = [{"type": "document", "source": {"type": "base64", "media_type": "application/pdf",
                                                   "data": "JVBERi0="}},
                  {"type": "text", "text": "Instrukce"}]
        with mock.patch("urllib.request.urlopen", fake):
            r = ai_client.call_full("k", "claude-sonnet-5-5", [{"role": "user", "content": blocks}],
                                    timeout=ai_client.IMPORT_TIMEOUT, max_tokens=32000)
        self.assertEqual(r["usage"]["input_tokens"], 5)
        self.assertEqual(sent["body"]["messages"][0]["content"][0]["type"], "document")
        self.assertEqual(sent["body"]["max_tokens"], 32000)
        self.assertEqual(sent["timeout"], 600)
        bad = [{"type": "image", "source": {"type": "base64", "media_type": "image/tiff", "data": "x"}}]
        with mock.patch("urllib.request.urlopen", fake) as m:
            with self.assertRaises(ai_client.AiError) as cm:
                ai_client.call_full("k", "m", [{"role": "user", "content": bad}])
        self.assertEqual(cm.exception.code, "bad_request")

        def truncated(req, timeout=0):
            return Resp({"content": [{"type": "text", "text": "{"}], "stop_reason": "max_tokens"})
        with mock.patch("urllib.request.urlopen", truncated):
            with self.assertRaises(ai_client.AiError) as cm:
                ai_client.call_full("k", "m", [{"role": "user", "content": "x"}])
            self.assertEqual(cm.exception.code, "truncated")
            # AI návrhář (call) zůstává tolerantní: vrátí text, chybu ohlásí až extractJson
            self.assertEqual(ai_client.call("k", "m", [{"role": "user", "content": "x"}]), "{")

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


class pro_license:
    """Tarif Pro po dobu bloku (ověření podpisu nahrazené — produkční klíč v repu není; stav a bránu
    počítá skutečné jádro). Free je výchozí stav testů: DXF se neukládá, dokumenty mají patičku."""

    def __init__(self, app):
        self.app = app

    def __enter__(self):
        lic = self.app.lic
        self.saved = lic.check
        lic.check = {"ok": True, "claims": {"v": 1, "key": "PLCD-ABCD-EFGH-JKLM-NPQR", "email": "t@t.cz",
                                            "plan": "pro", "seats": 1, "exp": "2099-01-01T00:00:00.000Z"}}
        lic.recompute()
        return lic

    def __exit__(self, *exc):
        self.app.lic.check = self.saved
        self.app.lic.recompute()


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
        self.app.wait_jobs(300)        # výpočty pracovního procesu z minulého testu doběhnou
        self.app.errors.clear()
        self.app.ui.clear()

    def tearDown(self):
        self.assertEqual(self.app.errors, [], "callback okna skončil chybou")

    # --- pomůcky -------------------------------------------------------------------

    def goto(self, step):
        self.app.goto(step)
        self.root.update()
        self.assertTrue(self.app.wait_jobs(300), "výpočet v pracovním procesu nedoběhl")

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

    def ui_texts(self, parent=None):
        """Všechny texty, které okno ukazuje: popisky, záložky, tabulky, plátna, pole."""
        out = []
        for w in walk(parent or self.root):
            try:
                out.append(str(w.cget("text")))
            except tk.TclError:
                pass
            if isinstance(w, ttk.Notebook):
                out += [str(w.tab(t, "text")) for t in w.tabs()]
            elif isinstance(w, ttk.Treeview):
                out += [str(w.heading(c, "text")) for c in ("#0", *w.cget("columns"))]
                stack = list(w.get_children(""))
                while stack:
                    iid = stack.pop()
                    out += [str(w.item(iid, "text")), *map(str, w.item(iid, "values"))]
                    stack += w.get_children(iid)
            elif isinstance(w, ttk.Combobox):
                out += [str(v) for v in w.cget("values")]
            elif isinstance(w, tk.Canvas):
                out += [w.itemcget(i, "text") for i in w.find_all() if w.type(i) == "text"]
            elif isinstance(w, tk.Text):
                out.append(w.get("1.0", "end"))
        return [t for t in out if t.strip()]

    # --- testy -----------------------------------------------------------------------

    def test_language_switch_translates_window_and_core_outputs(self):
        """Přepnutí jazyka: okno se postaví znovu, texty okna i jádra jsou v daném jazyce
        a nikde nezůstane čeština. Projekt se nepřekládá — ukázka se proto načítá po přepnutí."""
        czech = set("ěščřžůďťňĚŠČŘŽŮĎŤŇ")
        names = list(self.app.LANGS.values())
        try:
            for lang in ("en", "de", "es", "zh"):
                self.app.set_language(lang)
                self.root.update()
                self.assertEqual((self.app.lang, self.app.settings["lang"]), (lang, lang))
                self.app.load_sample("small")
                self.app.prj["platforms"] = list(self.app.PLAT)
                seen = []
                for step in (*range(9), "help"):
                    self.goto(step)
                    if step == 6:                       # Program: i živá simulace a scénáře
                        nb = self.find(ttk.Notebook)[0]
                        for tab in nb.tabs():
                            nb.select(tab)
                            self.root.update()
                    seen += self.ui_texts()
                self.assertGreater(len(seen), 400)
                # názvy příkladů jsou obsah projektů (česky) — nepřekládají se
                from plc_studio.steps.projekt import list_samples
                content = {s["label"] for s in list_samples()}
                # kusovník: vlastní jména dodavatelů (firmy, města) se nepřekládají
                bom = self.app.bridge.request("bom", prj=self.app.prj)
                suppliers = {ln["supplier"] for ln in bom["lines"] if ln["supplier"]}
                suppliers |= {s["name"] for s in bom["suppliers"]}
                content |= suppliers
                bad = sorted({t for t in seen if czech & set(t) and t not in names and t not in content})
                self.assertEqual(bad[:5], [], f"{lang}: nepřeložené texty v okně")
                self.assertNotIn("Otevřít projekt…", seen)
                docs = self.app.bridge.request("files", prj=self.app.prj)["files"]

                def strip_names(body: str) -> str:
                    for s in sorted(suppliers, key=len, reverse=True):
                        body = body.replace(s, "")
                    # vícejazyčné texty AML (EPLAN) nesou češtinu záměrně jako variantu aml-lang=cs-CZ
                    return re.sub(r'<Attribute Name="aml-lang=cs-CZ" AttributeDataType="xs:string">'
                                  r'<Value>[^<]*</Value></Attribute>', "", body)

                self.assertFalse([f["save"] for f in docs if czech & set(strip_names(f["body"]))],
                                 f"{lang}: nepřeložená dokumentace")
            self.assertTrue(any("一" <= ch <= "鿿" for ch in "".join(seen)), "čínské texty")
        finally:
            self.app.set_language("cs")
            self.root.update()
        self.assertEqual(self.app.settings["lang"], "cs")
        self.assertIn("Otevřít projekt…", self.ui_texts())
        self.assertEqual(self.app.CLS["Motor"]["label"], "Motor / čerpadlo")

    def test_bridge_keeps_language_after_restart(self):
        try:
            self.app.set_language("de")
            self.app.bridge._proc.kill()
            self.app.bridge._proc.wait()
            self.assertEqual(self.app.core("getLang"), "de")
        finally:
            self.app.set_language("cs")
            self.root.update()
        self.assertEqual(self.app.core("getLang"), "cs")

    def test_device_params_di_wait_step_and_takt(self):
        """Meze měření, žádaná hodnota, role výstupu, krok čekání na vstup a takt."""
        self.app.load_sample("small")
        self.goto(0)
        # pole taktu podle popisku (v kroku jsou i číslo projektu, zákazník a datum zahájení)
        takt = next(e for e in self.find(ttk.Entry) if any(
            "takt" in str(w.cget("text")) for w in e.master.winfo_children() if isinstance(w, ttk.Label)))
        takt.insert(0, "12")
        self.assertEqual(self.app.prj["meta"]["takt"], 12)

        self.goto(3)
        tbl = self.table()
        b1 = next(d for d in self.app.prj["devices"] if d["name"] == "B1")
        tbl.select(b1["id"])
        self.root.update()
        row = self.button("Uložit parametry").master    # řádek parametrů vybraného zařízení
        lo, hi = [w for w in row.winfo_children() if type(w) is ttk.Entry]
        lo.insert(0, "50")
        hi.insert(0, "200")
        self.click("Uložit parametry")
        self.assertEqual((b1["limLo"], b1["limHi"]), (50, 200))
        self.assertIn("max 200", tbl.tv.set(str(b1["id"]), "opt"))
        h1 = next(d for d in self.app.prj["devices"] if d["name"] == "H1")
        tbl.select(h1["id"])
        self.root.update()
        role = next(c for c in self.find(ttk.Combobox) if "— bez vazby —" in c.cget("values"))
        role.current(list(self.app.DO_ROLES).index("ready") + 1)
        self.click("Uložit parametry")
        self.assertEqual(h1["role"], "ready")

        self.app.ui["prog_tab"] = 0
        self.goto(6)
        s2 = next(d for d in self.app.prj["devices"] if d["name"] == "S2")
        dev_combo = next(c for c in self.find(ttk.Combobox) if "— čekání (bez zařízení) —" in c.cget("values"))
        dev_combo.set(next(v for v in dev_combo.cget("values") if v.startswith("S2")))
        self.root.update()
        self.click("Přidat krok")
        self.assertEqual(self.app.prj["program"]["seq"][-1],
                         {"dev": s2["id"], "act": "waitOn", "cond": "fbk", "timeS": 3})
        main = self.app.bridge.request("gen", prj={**self.app.prj, "platforms": ["codesys"]})["out"]["codesys"]["MAIN.st"]
        self.assertIn("IF GVL_IO.S2_in THEN", main)
        self.assertIn("limitHi := 200.0", main)
        self.assertIn("GVL_IO.H1_out := enable AND NOT machineFault", main)

    def test_project_step_offers_sample_library(self):
        self.app.load_sample("small")
        self.goto(0)
        cb = next(c for c in self.find(ttk.Combobox) if "zařízení" in str(c.cget("values")))
        values = list(cb.cget("values"))
        self.assertGreaterEqual(len(values), 12)
        big = next(i for i, v in enumerate(values) if "125 zařízení" in v)
        cb.current(big)
        with mock.patch("tkinter.messagebox.askyesno", return_value=True):
            self.click("Otevřít příklad")
        self.assertEqual(len(self.app.prj["devices"]), 125)
        self.assertGreater(len(self.app.prj["io"]), 180, "I/O dopočítané")
        self.assertEqual(self.app.step, 0)
        cb = next(c for c in self.find(ttk.Combobox) if "zařízení" in str(c.cget("values")))
        self.assertEqual(cb.current(), big, "výběr ukazuje otevřený příklad, ne první položku")
        cb.current(3)                                       # zvolený, ještě neotevřený příklad
        cb.event_generate("<<ComboboxSelected>>")
        self.app.render()
        self.root.update()
        cb = next(c for c in self.find(ttk.Combobox) if "zařízení" in str(c.cget("values")))
        self.assertEqual(cb.current(), 3, "volba uživatele má po překreslení přednost")
        self.app.prj["meta"]["name"] = "Vlastní stroj"
        self.app.render()
        self.root.update()
        cb = next(c for c in self.find(ttk.Combobox) if "zařízení" in str(c.cget("values")))
        self.assertEqual(cb.current(), 3, "zůstane naposledy zvolený")

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

    def test_device_name_must_be_unique_identifier(self):
        """Formulář Zařízení odmítne duplicitní označení (i jinou velikostí písmen) a označení,
        které není identifikátor — dřív prošlo a rozbilo Dokumentaci, Schválení i Oživení."""
        self.app.reset_project()
        self.goto(3)

        def add(name):
            ent = self.find(ttk.Entry)[0]
            ent.delete(0, "end")
            ent.insert(0, name)
            self.click("Přidat zařízení")
            return [d["name"] for d in self.app.prj["devices"]]

        self.assertEqual(add("M1"), ["M1"])
        for bad in ("M1", "m1", "Čerpadlo1", "M 2", "1M", "_M3", "M__4", "M5_", "M" * 33):
            self.assertEqual(add(bad), ["M1"], f"{bad!r} se nemělo přidat")
            self.assertTrue(str(self.app._status.cget("text")).startswith("⚠"), bad)
        add("m1")
        self.assertIn("M1", str(self.app._status.cget("text")))      # hláška jmenuje kolizi
        self.assertEqual(add("M2_A"), ["M1", "M2_A"])
        self.assertEqual(add("P1"), ["M1", "M2_A", "P1"])
        from plc_studio.steps.zarizeni import name_problem
        prj = self.app.prj
        self.assertIsNone(name_problem(prj, "M1", skip_id=prj["devices"][0]["id"]))  # sám sebe
        self.assertIsNotNone(name_problem(prj, "p1"))
        # Dokumentace se po přidání vykreslí (dřív: duplicate step id io:M1.fbkRunning)
        self.goto(8)
        self.assertNotIn("⚠", " ".join(str(w.cget("text")) for w in self.find(ttk.Label)))

    def test_apply_unchanged_proposal_keeps_project(self):
        """Převzetí návrhu, který AI vrátila beze změny (seed vzoru 16 i po aiNorm), projekt
        nezmění: zařízení se všemi poli (travelS, libType, records, selBits, osa…) i I/O
        s ručními adresami, komentáři, NC a GUID."""
        from plc_studio.steps.ai_navrh import apply_proposal
        path = Path(__file__).resolve().parents[3] / "samples" / "16_paletizacni_bunka_osy_PC-16.plcstudio.json"
        self.assertTrue(self.app.open_project(path))
        prj = self.app.prj
        # ruční úpravy z kroku I/O a pole mimo běžný formulář
        prj["io"][0].update(addr="%I7.7", cmt="ručně upravený komentář", nc=True)
        pd = next(d for d in prj["devices"] if d["cls"] == "PosDrive")
        pd["travelS"] = 2.5
        pd["libType"] = "firemni_typ"
        self.app.sync()
        before = json.loads(json.dumps({k: self.app.prj[k] for k in ("devices", "io", "program")}))
        seed = self.app.bridge.ai("seedFromProject", self.app.prj, "vzor 16", "")
        for last in (seed["last"], self.app.bridge.ai("aiNorm", seed["last"])):
            self.app.ai = {"turns": seed["turns"], "last": last, "draft": ""}
            apply_proposal(self.app)
            self.root.update()
            after = {k: self.app.prj[k] for k in ("devices", "io", "program")}
            self.assertEqual(after["devices"], before["devices"])
            self.assertEqual(after["io"], before["io"])
            self.assertEqual(after["program"], before["program"])

    def test_delete_unused_device_without_dialog(self):
        """Zařízení, které program nepoužívá, se smaže bez dotazu."""
        self.app.reset_project()
        self.goto(3)
        self.click("Přidat zařízení")
        d = self.app.prj["devices"][0]
        self.table().select(d["id"])
        with mock.patch("tkinter.messagebox.askyesno", return_value=False) as ask:
            self.click("Odstranit vybrané")
        ask.assert_not_called()
        self.assertEqual(self.app.prj["devices"], [])

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
        # S7-1200 G2 nemá vestavěné analogy → SM 1231 ve slotu 2 (sestava hardwaru, výchozí adresy TIA)
        self.assertEqual(self.app.prj["io"][-1]["addr"], "%IW96")

        tbl = self.table()
        tbl._on_edit(str(d["id"]), "desc", "Nový popis")
        self.assertEqual(self.app.prj["devices"][0]["desc"], "Nový popis")

        self.app.prj["program"]["estop"] = d["id"]
        self.app.prj["program"]["seq"] = [{"dev": d["id"], "act": "start", "cond": "fbk", "timeS": 3}]
        tbl.select(d["id"])
        # zařízení je v programu (krok, E-stop) → smaže se jen po potvrzení
        with mock.patch("tkinter.messagebox.askyesno", return_value=False) as ask:
            self.click("Odstranit vybrané")
        ask.assert_called_once()
        self.assertIn("1 krok sekvence", ask.call_args[0][1])
        self.assertIn("vstup E-stop", ask.call_args[0][1])
        self.assertEqual(len(self.app.prj["devices"]), 2)
        self.assertEqual(len(self.app.prj["program"]["seq"]), 1)
        self.table().select(d["id"])
        with mock.patch("tkinter.messagebox.askyesno", return_value=True):
            self.click("Odstranit vybrané")
        self.assertEqual([x["name"] for x in self.app.prj["devices"]], ["B1"])
        self.assertEqual(self.app.prj["program"],
                         {"modes": True, "estop": "", "seq": [], "interlocks": []})
        self.assertEqual({e["devId"] for e in self.app.prj["io"]}, {b1["id"]})

    def test_platform_cards_toggle(self):
        self.app.reset_project()
        self.goto(2)
        cards = [w for w in walk(self.app.view) if isinstance(w, tk.Frame) and not isinstance(w, ttk.Frame)]
        self.assertEqual(len(cards), len(self.app.PLAT))
        self.assertIn("Unitronics", "".join(w.cget("text") for w in walk(self.app.view)
                                            if isinstance(w, tk.Label)))
        cards[1].event_generate("<Button-1>", x=5, y=5)
        self.root.update()
        self.assertEqual(self.app.prj["platforms"], ["siemens", "rockwell"])
        cards = [w for w in walk(self.app.view) if isinstance(w, tk.Frame) and not isinstance(w, ttk.Frame)]
        cards[0].event_generate("<Button-1>", x=5, y=5)
        self.root.update()
        self.assertEqual(self.app.prj["platforms"], ["rockwell"])

    def test_platform_cards_verification_chip(self):
        """Každá karta platformy má štítek ověření (data/verification.json) s bublinou, co neověřeno."""
        self.app.reset_project()
        self.goto(2)
        chips = [w for w in walk(self.app.view) if isinstance(w, tk.Label) and hasattr(w, "verif_state")]
        self.assertEqual(len(chips), len(self.app.PLAT))
        states = {self.app.VERIF[k]["state"] for k in self.app.PLAT}
        self.assertEqual({c.verif_state for c in chips}, states)
        self.assertEqual(self.app.VERIF["codesys"]["state"], "verified")
        self.assertEqual(self.app.VERIF["siemens"]["state"], "beta")
        for c in chips:
            self.assertTrue(c.cget("text"))
            self.assertIn("\n", c.tip_text)              # význam, co ověřeno, kde, co neověřeno
        tip = self.app.VERIF["wago"]["tip"]
        self.assertIn(self.app.VERIF["wago"]["notVerified"], tip)

    def test_code_style_only_for_oop_platforms(self):
        """Styl kódu Klasický / OOP: volba jen při platformě s OOP; OOP → rozhraní a třídy v kódu."""
        self.app.reset_project()
        self.app.prj["platforms"] = ["siemens"]
        self.goto(2)
        radios = [w for w in walk(self.app.view) if isinstance(w, ttk.Radiobutton)]
        self.assertEqual(radios, [], "Siemens: volba stylu se nenabízí")
        self.app.prj["platforms"] = ["siemens", "codesys"]
        self.app.render()
        self.root.update()
        radios = {w.cget("value"): w for w in walk(self.app.view) if isinstance(w, ttk.Radiobutton)}
        self.assertEqual(set(radios), {"classic", "oop"})
        self.assertNotIn("codeStyle", self.app.prj)
        radios["oop"].invoke()
        self.root.update()
        self.assertEqual(self.app.prj.get("codeStyle"), "oop")
        self.app.load_sample("small")
        self.app.prj["platforms"] = ["codesys", "siemens"]
        self.app.prj["codeStyle"] = "oop"
        out = self.app.bridge.request("gen", prj=self.app.prj)["out"]
        self.assertIn("INTERFACE I_Device", out["codesys"]["Gen_Library.st"])
        self.assertNotIn("INTERFACE", out["siemens"].get("Gen_Library.scl", ""))
        self.goto(2)
        radios = {w.cget("value"): w for w in walk(self.app.view) if isinstance(w, ttk.Radiobutton)}
        radios["classic"].invoke()
        self.root.update()
        self.assertNotIn("codeStyle", self.app.prj)

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
        free = tempfile.mkdtemp()                    # Free: výkresy SVG ano, DXF ne (licence)
        with mock.patch("tkinter.filedialog.askdirectory", return_value=free):
            self.click("Uložit všechny výkresy do složky…")
        self.assertFalse(any(n.endswith(".dxf") for n in os.listdir(free)))
        self.assertIn("00_blokove_schema.svg", os.listdir(free))
        out = tempfile.mkdtemp()
        with pro_license(self.app), mock.patch("tkinter.filedialog.askdirectory", return_value=out):
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
        self.assertIn("Krok 2: M1 start → zpětné hlášení (do 3 s)", links)
        self.assertIn("Živá simulace ↗", links)

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
        self.assertIn("DO1", self.find(ttk.Combobox)[0].get())    # „-A1 DO1 — svorkovnice X2“
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
        self.assertIn("AI1", self.find(ttk.Combobox)[0].get())

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
        flow = self.find(SvgView)[1]                  # [0] = schéma stroje v živé simulaci
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
        self.assertTrue(any("Porucha stroje v čase" in t and "timeout kroku 2 (M1 start, 3 s)" in t
                            and "čeká na kvitaci" in t and "všechny výstupy vypnuté" in t
                            for t in labels), labels)
        flow = self.find(SvgView)[1]
        marks = dict(zip((m.get("step") for m in flow.metas()), flow._marks()))
        self.assertEqual(marks[1], "err")

        self.open_sim("nominal", tab=2)               # záložka Ověření se spočítá sama
        checks = next(t for t in self.find(Table) if "lvl" in t.tv["columns"])
        rows = [checks.tv.item(i, "values") for i in checks.tv.get_children()]
        self.assertEqual(rows[0], ("✔ v pořádku", "Běžný cyklus doběhne do konce"))
        # reakce programu jsou bez chyb; koncept hlásí, co návrh nepokrývá (signálka H1, kryt S2 bez NC)
        self.assertFalse([r for r in rows if r[0] == "✖ chyba"], rows)
        self.assertTrue(any("výpadek hlášení M1 → porucha stroje po 3 s" in r[1] for r in rows))
        self.assertTrue(any("Po odstranění závady a kvitaci proběhne nový cyklus" in r[1] for r in rows))
        self.assertTrue(any(r == ("⚠ upozornění", "Výstup H1 (Signálka Připraveno) program neovládá") for r in rows))
        self.assertTrue(any(r[1] == "Všechny stavy odpovídají konceptu (31 kombinací)" for r in rows))
        self.assertTrue(any("Výsledek: bez chyb" in str(w.cget("text")) for w in self.find(ttk.Label)))

        # matice stavů: klid + 5 kroků, dvojklik na buňku přehraje kombinaci
        mtx = next(t for t in self.find(Table) if "manual" in t.tv["columns"])
        cols = list(mtx.tv["columns"])
        self.assertEqual(len(mtx.tv.get_children()), 7)          # klid, ruční režim, 5 kroků
        self.assertEqual(mtx.tv.set("0", "state"), "Klid")
        self.assertEqual(mtx.tv.set("3", "fbk"), "✔ 3 s")
        self.assertEqual(mtx.tv.set("0", "fbk"), "—")
        nb = next(w for w in self.find(ttk.Notebook) if "Matice stavů" in [w.tab(t, "text") for t in w.tabs()])
        nb.select(1)
        self.root.update()
        mtx.tv.see("3")
        self.root.update()
        x0, y0, w0, h0 = mtx.tv.bbox("3", "manual")
        for _k in range(2):                            # dvojklik = dva klepy (Double-1 nejde poslat)
            mtx.tv.event_generate("<ButtonPress-1>", x=x0 + 5, y=y0 + 3)
            mtx.tv.event_generate("<ButtonRelease-1>", x=x0 + 5, y=y0 + 3)
        self.root.update()
        self.assertTrue(self.app.ui["sim_scenario"].startswith("m-1-manual"), self.app.ui["sim_scenario"])
        self.assertTrue(any("Cyklus přerušen vypnutím režimu AUTO" in str(w.cget("text"))
                            for w in self.find(ttk.Label)))
        self.assertIn("manual", cols)
        self.open_sim("nominal", tab=2)                   # překreslení → najít tabulku znovu
        checks = next(t for t in self.find(Table) if "lvl" in t.tv["columns"])
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
        self.assertTrue(any("Porucha stroje v čase" in t and "timeout kroku 1 (Y1 otevřít, 5 s)" in t
                            for t in labels), labels)
        self.open_sim("nominal", tab=2)
        self.assertTrue(any("NALEZENY CHYBY" in str(w.cget("text")) for w in self.find(ttk.Label)))

    def test_project_without_sequence_has_nothing_to_simulate(self):
        self.app.load_sample("small")
        self.app.prj["program"]["seq"] = []
        self.open_sim()
        self.assertEqual(len(self.find(SvgView)), 1)  # jen schéma stroje v živé simulaci
        self.assertTrue(any("není co simulovat" in str(w.cget("text")) for w in self.find(ttk.Label)))
        self.assertEqual(len(self.find(Mimic)), 1)

    # --- živá simulace -------------------------------------------------------------

    def open_live(self, speed="10×"):
        """Otevře živou simulaci; vrací (schéma stroje, funkce „počkej na podmínku")."""
        self.app.ui["live_speed"] = speed
        self.app.open_live()
        self.root.update()
        view = self.find(SvgView)[0]

        def wait(cond, seconds=8.0):
            deadline = time.time() + seconds
            while not cond() and time.time() < deadline:
                self.root.update()
                time.sleep(0.005)
            self.root.update()
            self.assertTrue(cond(), "stav simulace nenastal včas")

        return view, wait

    def label_text(self, prefix):
        return next((str(w.cget("text")) for w in self.find(ttk.Label)
                     if str(w.cget("text")).startswith(prefix)), None)

    def marks(self, view):
        """Značky bloků zařízení (bez řádků signálů) a rozsvícené signály."""
        prj = self.app.prj
        name = {d["id"]: d["name"] for d in prj["devices"]}
        tag = {e["key"]: e["tag"] for e in prj["io"]}
        blocks, lit = {}, set()
        for meta, mark in zip(view.metas(), view._marks()):
            if "io" in meta:
                if mark == "on":
                    lit.add(tag[meta["io"]])
            elif "dev" in meta:
                blocks[name[meta["dev"]]] = mark
        return blocks, lit

    def test_live_simulation_buttons_drive_the_machine(self):
        self.app.load_sample("small")
        view, wait = self.open_live()
        self.assertEqual(self.label_text("Klid"), "Klid — čeká na START")
        blocks, lit = self.marks(view)
        self.assertEqual(blocks["M1"], None)
        self.assertEqual(lit, {"S1_in", "S2_in", "Y1_fbkClosed"})  # E-stop OK, kryt zavřen, válec zavřen
        time.sleep(0.3)
        self.root.update()
        self.assertEqual(self.label_text("Klid"), "Klid — čeká na START", "bez startu stroj stojí")

        self.click("▶ START cyklu")
        wait(lambda: (self.label_text("Krok 3/5") or "").endswith("výdrž 5 s"))
        blocks, lit = self.marks(view)
        self.assertEqual((blocks["M1"], blocks["Y1"]), ("on", "on"))
        self.assertTrue({"M1_outRun", "M1_fbkRunning", "Y1_outOpen", "Y1_fbkOpen"} <= lit)
        self.assertNotIn("Y1_fbkClosed", lit)

        self.click("⛔ E-STOP")                        # E-stop: vše dolů, bloky blokované
        wait(lambda: self.label_text("Klid") is not None)
        blocks, lit = self.marks(view)
        self.assertEqual((blocks["M1"], blocks["Y1"]), ("off", "off"))
        self.assertFalse({"M1_outRun", "Y1_outOpen", "S1_in"} & lit)
        self.assertIn("enable ○", self.label_text("t = "))
        self.click("▶ START cyklu")                   # při E-stopu start nezabere
        time.sleep(0.2)
        self.root.update()
        self.assertFalse({"M1_outRun", "Y1_outOpen"} & self.marks(view)[1])

        self.click("✔ Uvolnit E-STOP")                # po uvolnění nový start → celý cyklus
        wait(lambda: "enable ●" in self.label_text("t = "))
        self.click("▶ START cyklu")
        wait(lambda: "cyklů 1 (poslední 8.09 s)" in self.label_text("t = "), 12)
        self.assertEqual(self.label_text("Klid"), "Klid — čeká na START")
        self.assertEqual(self.marks(view)[1], {"S1_in", "S2_in", "Y1_fbkClosed"})
        log = self.find(tk.Text)[0].get("1.0", "end")
        self.assertIn("Stisk nouzového zastavení", log)
        self.assertIn("Cyklus dokončen", log)

    def mimic_click(self, mimic, dev_id):
        """Skutečný klik myší na symbol zařízení v grafickém schématu."""
        x, y, _w, _h, _side = mimic.dev_box[dev_id]
        c, s = mimic.canvas, mimic._scale
        px, py = int((x + 6) * s - c.canvasx(0)), int((y + 6) * s - c.canvasy(0))
        c.event_generate("<ButtonPress-1>", x=px, y=py)
        c.event_generate("<ButtonRelease-1>", x=px, y=py)
        self.root.update()

    def check(self, prefix):
        return next(w for w in self.find(ttk.Checkbutton) if str(w.cget("text")).startswith(prefix))

    def test_live_mimic_highlights_wires_of_selected_device_and_module(self):
        self.app.load_sample("small")
        self.open_live()
        mimic = self.find(Mimic)[0]
        c, s = mimic.canvas, mimic._scale

        def click_at(lx, ly):
            px, py = int(lx * s - c.canvasx(0)), int(ly * s - c.canvasy(0))
            c.event_generate("<ButtonPress-1>", x=px, y=py)
            c.event_generate("<ButtonRelease-1>", x=px, y=py)
            self.root.update()

        def fills():
            return {k: c.itemcget(i, "fill") for k, i in mimic.items["wire"].items()}

        self.assertIsNone(mimic.focus_keys())
        self.assertNotIn(WIRE_DIM, fills().values(), "bez výběru se nic netlumí")

        y1 = next(d for d in self.app.prj["devices"] if d["name"] == "Y1")
        self.mimic_click(mimic, y1["id"])               # zařízení: jeho vodiče, ostatní ztlumené
        mine = {e["key"] for e in self.app.prj["io"] if e["devId"] == y1["id"]}
        self.assertEqual(mimic.focus_keys(), mine)
        f = fills()
        self.assertTrue(all(f[k] != WIRE_DIM for k in mine if k in f))
        self.assertTrue(all(f[k] == WIRE_DIM for k in f if k not in mine))
        self.assertTrue(mimic.items["focus"], "rámeček modulu, do kterého je zařízení zapojeno")

        x, y, _w, _h, m = mimic.mod_box[0]               # modul: všechny jeho kanály
        click_at(x + 8, y + 9)
        self.assertEqual(mimic.focus_keys(), set(m["ch"]))
        devs = {e["devId"] for e in self.app.prj["io"] if e["key"] in m["ch"]}
        self.assertEqual(len(mimic.items["focus"]), len(devs), "rámeček každého zapojeného zařízení")
        f = fills()
        self.assertTrue(all(f[k] == WIRE_DIM for k in f if k not in m["ch"]))
        self.assertEqual(c.itemcget(mimic.items["sel"], "state"), "normal")

        click_at(x + 8, y + 9)                           # opakovaný klik na týž modul = zrušit
        self.assertIsNone(mimic.focus_keys())
        self.mimic_click(mimic, y1["id"])
        click_at(895, mimic.height - 3)                  # klik do prázdna = zrušit
        self.assertIsNone(mimic.focus_keys())
        self.assertNotIn(WIRE_DIM, fills().values())
        self.assertEqual(mimic.items["focus"], [])

    def test_live_simulation_fault_needs_acknowledge_then_cycle_runs_again(self):
        self.app.load_sample("small")
        view, wait = self.open_live()
        mimic = self.find(Mimic)[0]
        y1 = next(d for d in self.app.prj["devices"] if d["name"] == "Y1")
        self.mimic_click(mimic, y1["id"])
        self.assertEqual(self.app.ui["live_sel"], y1["id"])
        stuck = self.check("Zaseknout pohyb")
        stuck.invoke()
        self.click("▶ START cyklu")
        wait(lambda: self.label_text("PORUCHA STROJE") is not None)   # hlídací čas kroku 5 s
        self.assertEqual(self.label_text("PORUCHA STROJE"), "PORUCHA STROJE v kroku 1 — čeká na kvitaci")
        self.assertFalse({"Y1_outOpen", "M1_outRun"} & self.marks(view)[1], "výstupy vypnuty")
        self.assertIn("PORUCHA STROJE: timeout kroku 1", self.find(tk.Text)[0].get("1.0", "end"))

        self.click("▶ START cyklu")                   # bez kvitace start nezabere
        time.sleep(0.2)
        self.root.update()
        self.assertIsNotNone(self.label_text("PORUCHA STROJE"))

        stuck.invoke()                                # závada odstraněna → kvitace → nový cyklus
        self.click("✔ Kvitace poruchy")
        wait(lambda: self.label_text("Klid") == "Klid — čeká na START")
        self.assertIn("Porucha kvitována", self.find(tk.Text)[0].get("1.0", "end"))
        self.click("▶ START cyklu")
        wait(lambda: "cyklů 1" in self.label_text("t = "), 12)

    def test_live_simulation_manual_commands_work_only_outside_auto(self):
        self.app.load_sample("small")
        view, wait = self.open_live()
        mimic = self.find(Mimic)[0]
        y1 = next(d for d in self.app.prj["devices"] if d["name"] == "Y1")
        self.mimic_click(mimic, y1["id"])
        man = self.check("Ruční otevření (manOpen_Y1)")
        man.invoke()                                  # v režimu AUTO je ruční povel neúčinný
        time.sleep(0.3)
        self.root.update()
        self.assertNotIn("Y1_outOpen", self.marks(view)[1])

        self.check("režim AUTO").invoke()             # ruční režim: povel platí
        wait(lambda: "Stav bloku: otevřeno" in self.label_text("Stav bloku"))
        self.assertEqual(self.label_text("Klid"), "Klid — ruční režim (AUTO vypnuto)")
        self.assertTrue({"Y1_outOpen", "Y1_fbkOpen"} <= self.marks(view)[1])
        self.click("▶ START cyklu")                   # start v ručním režimu nezabere
        time.sleep(0.2)
        self.root.update()
        self.assertIsNone(self.label_text("Krok "))
        man.invoke()
        wait(lambda: "Stav bloku: zavřeno" in self.label_text("Stav bloku"))
        self.assertNotIn("Y1_outOpen", self.marks(view)[1])

    def test_live_simulation_without_sequence_has_manual_commands_only(self):
        self.app.load_sample("small")
        self.app.prj["program"]["seq"] = []
        view, wait = self.open_live()
        self.assertEqual(self.label_text("Projekt nemá"),
                         "Projekt nemá automatickou sekvenci — jen ruční povely.")
        self.assertIn("disabled", self.button("▶ START cyklu").state())
        mimic = self.find(Mimic)[0]
        m1 = next(d for d in self.app.prj["devices"] if d["name"] == "M1")
        self.mimic_click(mimic, m1["id"])
        self.check("Ruční chod (manRun_M1)").invoke()
        wait(lambda: "Stav bloku: běží" in self.label_text("Stav bloku"))
        self.assertTrue({"M1_outRun", "M1_fbkRunning"} <= self.marks(view)[1])

    def test_live_simulation_pause_step_reset_and_free_input(self):
        self.app.load_sample("small")
        view, wait = self.open_live(speed="1×")
        mimic = self.find(Mimic)[0]
        self.click("⏸ Zastavit čas")
        t0 = self.label_text("t = ")
        time.sleep(0.25)
        self.root.update()
        self.assertEqual(self.label_text("t = "), t0, "zastavený čas neběží")
        self.click("+0,1 s")
        self.assertNotEqual(self.label_text("t = "), t0)

        s2 = next(d for d in self.app.prj["devices"] if d["name"] == "S2")   # kryt = blokování
        self.mimic_click(mimic, s2["id"])
        self.assertTrue(self.label_text("Blokovací vstup"))
        self.assertIn("S2_in", self.marks(view)[1], "kryt v klidu zavřen (TRUE)")
        self.check("Vstup sepnut (TRUE)").invoke()    # otevřít kryt — projeví se i při zastaveném čase
        self.root.update()
        blocks, lit = self.marks(view)
        self.assertNotIn("S2_in", lit)
        self.click("+0,1 s")                           # program zareaguje dalším scanem
        self.assertIn("enable ○", self.label_text("t = "))
        self.assertIn("stojí: S2", self.label_text("t = "))
        self.assertTrue(mimic.canvas.itemcget(mimic.items["plc"]["fault"], "text").startswith("BLOKOVÁNÍ"))
        self.check("Vstup sepnut (TRUE)").invoke()    # kryt zavřen
        self.click("+0,1 s")
        self.assertIn("enable ●", self.label_text("t = "))

        b1 = next(d for d in self.app.prj["devices"] if d["name"] == "B1")
        self.mimic_click(mimic, b1["id"])             # analogová hodnota posuvníkem
        scale = self.find(ttk.Scale)[0]
        self.root.tk.call(scale.cget("command"), 100.0)
        self.root.update()
        key = next(e["key"] for e in self.app.prj["io"] if e["tag"] == "B1_raw")
        value = mimic.canvas.itemcget(mimic.items["dev"][b1["id"]]["value"], "text")
        self.assertEqual(value, "250 bar")
        self.assertIn(f"B1_raw = 27648", self.label_text("B1_raw"))
        self.assertTrue(key)

        self.click("▶ START cyklu")
        self.click("▶ Pustit čas")
        wait(lambda: self.label_text("Krok ") is not None)
        self.click("⏸ Zastavit čas")                  # ať čas po resetu hned neběží dál
        self.click("↺ Reset")
        self.assertEqual(self.label_text("Klid"), "Klid — čeká na START")
        self.assertTrue(self.label_text("t = ").startswith("t = 0.00 s"))
        self.assertIn("S2_in", self.marks(view)[1], "po resetu je kryt zase zavřený")
        self.assertEqual(self.find(tk.Text)[0].get("1.0", "end").strip(), "")

    def test_live_simulation_inputs_controlled_in_diagram(self):
        """Ovládání vstupů přímo ve schématu: tlačítko na každém digitálním vstupu
        (klik = přepnout a vnutit, ↺ = zpět stroji), potenciometr na analogovém snímači."""
        self.app.load_sample("small")
        view, wait = self.open_live(speed="2×")
        mimic = self.find(Mimic)[0]
        c, prj = mimic.canvas, self.app.prj
        key = {e["tag"]: e["key"] for e in prj["io"]}
        self.assertEqual(set(mimic.items["btn"]), {e["key"] for e in prj["io"] if e["dir"] == "DI"},
                         "tlačítko na každém digitálním vstupu")
        knobs = {t[5:] for i in c.find_all() for t in c.gettags(i) if t.startswith("knob:")}
        self.assertEqual(knobs, {key["B1_raw"], key["B2_raw"]}, "potenciometr na každém AI")

        def at(item):                                  # okenní souřadnice středu prvku plátna
            x0, y0, x1, y1 = c.bbox(item)
            return int((x0 + x1) / 2 - c.canvasx(0)), int((y0 + y1) / 2 - c.canvasy(0))

        def click(item):
            mimic.see_item(item)
            self.root.update()
            x, y = at(item)
            c.event_generate("<ButtonPress-1>", x=x, y=y)
            c.event_generate("<ButtonRelease-1>", x=x, y=y)
            self.root.update()

        def btn(tag):
            return mimic.items["btn"][key[tag]]

        def lit(tag):
            return c.itemcget(btn(tag)["rect"], "fill") == WIRE_IN

        def forced(tag):
            return c.itemcget(btn(tag)["rel"], "state") == "normal"

        self.assertEqual((lit("S1_in"), lit("Y1_fbkClosed"), lit("Y1_fbkOpen")), (True, True, False))
        self.assertFalse(forced("Y1_fbkOpen"), "↺ jen u vnuceného vstupu")
        release = self.button("Uvolnit vše")
        self.assertIn("disabled", release.state())

        click(btn("Y1_fbkOpen")["rect"])               # „otevřeno" vnuceno: krok 1 hned potvrzen
        self.assertTrue(lit("Y1_fbkOpen") and forced("Y1_fbkOpen"))
        self.assertEqual(c.itemcget(btn("Y1_fbkOpen")["rect"], "outline"), theme.WARN)
        self.assertIn("Y1_fbkOpen", self.marks(view)[1])
        self.assertIn("vnucené vstupy: 1", self.label_text("t = "))
        self.assertNotIn("disabled", release.state())
        self.assertIsNone(self.app.ui.get("live_sel"), "klik na tlačítko nevybírá zařízení")
        self.click("⏸ Zastavit čas")
        self.click("▶ START cyklu")
        self.click("+0,1 s")
        self.assertTrue(self.label_text("Krok 2/5"), "program věří vnucenému hlášení")
        y1 = next(d for d in prj["devices"] if d["name"] == "Y1")
        self.assertLess(self.app.bridge.request("live.step", ms=0)["frame"]["dev"][str(y1["id"])]["pos"], 1)
        self.click("▶ Pustit čas")

        wait(lambda: self.label_text("Krok 3/5") is not None)
        self.assertTrue(lit("M1_fbkRunning"))
        click(btn("M1_fbkRunning")["text"])            # klik i na text tlačítka → ztráta hlášení
        wait(lambda: self.label_text("PORUCHA STROJE") is not None)
        self.assertIn("vnucené vstupy: 2", self.label_text("t = "))
        log = self.find(tk.Text)[0].get("1.0", "end")
        self.assertIn("M1_fbkRunning: vstup vnucen na FALSE", log)
        self.assertIn("M1: PORUCHA bloku", log)

        click(btn("Y1_fbkOpen")["rel"])                # ↺ vrátí jeden vstup stroji
        self.assertFalse(forced("Y1_fbkOpen"))
        self.assertIn("vnucené vstupy: 1", self.label_text("t = "))
        self.click("Uvolnit vše")
        self.assertNotIn("vnucené vstupy", self.label_text("t = "))
        self.assertIn("disabled", release.state())
        self.click("✔ Kvitace poruchy")
        wait(lambda: self.label_text("Klid") == "Klid — čeká na START")

        click(btn("S1_in")["rect"])                    # tlačítko vstupu E-stopu rozpojí okruh
        wait(lambda: "enable ○" in self.label_text("t = "))
        click(btn("S1_in")["rel"])
        wait(lambda: "enable ●" in self.label_text("t = "))

        b1 = next(d for d in prj["devices"] if d["name"] == "B1")
        it = mimic.items["dev"][b1["id"]]
        value = lambda: c.itemcget(it["value"], "text")  # noqa: E731
        self.assertEqual(value(), "125 bar")
        mimic.see_item(it["knob"])
        self.root.update()
        x, y = at(it["knob"])                          # potenciometr: táhnutí nahoru = víc
        c.event_generate("<ButtonPress-1>", x=x, y=y)
        c.event_generate("<B1-Motion>", x=x, y=y - 60)
        c.event_generate("<ButtonRelease-1>", x=x, y=y - 60)
        wait(lambda: value() == "200 bar")
        self.assertIsNone(self.app.ui.get("live_sel"), "tažení potenciometru nepohne schématem")
        c.event_generate("<MouseWheel>", x=x, y=y, delta=-120)    # kolečko o 2 % dolů
        wait(lambda: value() == "195 bar")
        mimic.set_knob(key["B1_raw"], 500)             # mimo rozsah se ořízne
        wait(lambda: value() == "250 bar")
        a0 = c.coords(it["ptr"])
        mimic.set_knob(key["B1_raw"], 0)
        wait(lambda: value() == "0 bar")
        self.assertNotEqual(c.coords(it["ptr"]), a0, "ručička potenciometru se otočila")

        click(btn("S2_in")["rect"])
        self.click("↺ Reset")                          # reset vnucení zruší
        self.assertFalse(forced("S2_in"))
        mimic.zoom(1.25)                               # po změně měřítka ovládání funguje dál
        self.root.update()
        click(btn("S2_in")["rect"])
        self.assertTrue(forced("S2_in"))

    def test_opening_guard_or_light_curtain_in_diagram_stops_the_machine(self):
        """Kryt / světelná závora = blokovací vstup: klik ve schématu za chodu stroj zastaví,
        po obnovení stroj stojí do nového startu. Volba blokování v kroku Program."""
        self.app.load_sample("complex")
        view, wait = self.open_live(speed="5×")
        mimic, c = self.find(Mimic)[0], self.find(Mimic)[0].canvas
        key = {e["tag"]: e["key"] for e in self.app.prj["io"]}

        def click(item):
            mimic.see_item(item)
            self.root.update()
            x0, y0, x1, y1 = c.bbox(item)
            x, y = int((x0 + x1) / 2 - c.canvasx(0)), int((y0 + y1) / 2 - c.canvasy(0))
            c.event_generate("<ButtonPress-1>", x=x, y=y)
            c.event_generate("<ButtonRelease-1>", x=x, y=y)
            self.root.update()

        self.click("▶ START cyklu")
        wait(lambda: (self.label_text("Krok 3/18") or "") != "")
        self.assertTrue(self.marks(view)[1] & {"M1_outRun", "M3_outRun"}, "stroj běží")
        click(mimic.items["btn"][key["S4_in"]]["rect"])     # přerušit světelnou závoru
        wait(lambda: "enable ○" in self.label_text("t = "))
        self.assertIn("stojí: S4", self.label_text("t = "))
        # ms=0 jen promítne vstupy; výstupy vypne až scan programu → počkat na běžící čas
        wait(lambda: self.app.bridge.request("live.step", ms=0)["outputsOn"] == [])
        self.assertEqual(self.app.bridge.request("live.step", ms=0)["outputsOn"], [],
                         "všechny výstupy vypnuté")
        self.assertIn("Blokování S4 rozpojeno", self.find(tk.Text)[0].get("1.0", "end"))
        click(mimic.items["btn"][key["S4_in"]]["rel"])      # závora volná
        wait(lambda: "enable ●" in self.label_text("t = "))
        time.sleep(0.3)
        self.root.update()
        self.assertEqual(self.label_text("Klid"), "Klid — čeká na START", "sám se nerozběhne")
        self.assertIn("Blokování S4 obnoveno", self.find(tk.Text)[0].get("1.0", "end"))

        self.app.ui["prog_tab"] = 0                          # volba blokování v kroku Program
        self.goto(6)
        lock = next(w for w in self.find(ttk.Checkbutton) if str(w.cget("text")).startswith("S8"))
        lock.invoke()
        s8 = next(d for d in self.app.prj["devices"] if d["name"] == "S8")
        self.assertIn(s8["id"], self.app.prj["program"]["interlocks"])
        main = self.app.bridge.request("gen", prj={**self.app.prj, "platforms": ["codesys"]})["out"]["codesys"]["MAIN.st"]
        self.assertIn("AND GVL_IO.S8_in", main)
        lock.invoke()
        self.assertNotIn(s8["id"], self.app.prj["program"]["interlocks"])

    def test_mimic_shows_wires_and_animates_function(self):
        """Grafické schéma: vodič na každý signál, barva podle stavu, pohyb pístu, výběr."""
        self.app.load_sample("small")
        view, wait = self.open_live()
        mimic = self.find(Mimic)[0]
        c, prj = mimic.canvas, self.app.prj
        key = {e["tag"]: e["key"] for e in prj["io"]}
        y1 = next(d for d in prj["devices"] if d["name"] == "Y1")
        m1 = next(d for d in prj["devices"] if d["name"] == "M1")
        self.assertEqual(set(mimic.wires), set(key.values()), "vodič pro každý signál")
        self.assertEqual(len(mimic.dev_box), len(prj["devices"]))

        def wire(tag):
            return c.itemcget(mimic.items["wire"][key[tag]], "fill")

        def piston():
            return c.coords(mimic.items["dev"][y1["id"]]["piston"])[0]

        self.assertEqual(wire("S1_in"), WIRE_IN, "E-stop v pořádku svítí")
        self.assertEqual(wire("Y1_outOpen"), WIRE_OFF)
        rest = piston()
        seq_text = lambda: c.itemcget(mimic.items["plc"]["seq"], "text")  # noqa: E731
        self.assertEqual(seq_text(), "sekvence: klid")

        self.click("▶ START cyklu")
        wait(lambda: seq_text().startswith("krok 3/5"))
        self.assertEqual(wire("Y1_outOpen"), WIRE_OUT, "výstup z PLC svítí zeleně")
        self.assertEqual(wire("Y1_fbkOpen"), WIRE_IN, "vstup do PLC svítí modře")
        self.assertEqual(wire("M1_fbkRunning"), WIRE_IN)
        self.assertEqual(wire("H1_out"), WIRE_OFF)
        self.assertEqual(wire("Y1_fbkClosed"), WIRE_OFF)
        self.assertGreater(piston(), rest + 10, "píst válce se vysunul")
        self.assertEqual(c.itemcget(mimic.items["dev"][m1["id"]]["rect"], "fill"), FILL["on"])
        a0 = c.coords(mimic.items["dev"][m1["id"]]["rotor"])
        time.sleep(0.15)
        self.root.update()
        self.assertNotEqual(c.coords(mimic.items["dev"][m1["id"]]["rotor"]), a0, "rotor se točí")

        self.mimic_click(mimic, m1["id"])              # klik na symbol = výběr zařízení
        self.assertEqual(self.app.ui["live_sel"], m1["id"])
        self.assertEqual(c.itemcget(mimic.items["sel"], "state"), "normal")
        self.assertEqual(wire("M1_fbkRunning"), WIRE_IN, "vodiče vybraného zařízení dál svítí")
        self.assertEqual(wire("Y1_outOpen"), WIRE_DIM, "ostatní vodiče se ztlumí")
        mimic.zoom(1.25)                               # změna měřítka stav i výběr zachová
        self.root.update()
        self.assertEqual(wire("Y1_outOpen"), WIRE_DIM)
        mimic.select(None)                             # bez výběru zase plné barvy
        self.assertEqual(wire("Y1_outOpen"), WIRE_OUT)
        self.assertGreater(piston(), rest * 1.25 + 10)

        self.click("⛔ E-STOP")
        wait(lambda: wire("Y1_outOpen") == WIRE_OFF)   # program vypne výstupy dalším scanem
        self.assertTrue(c.itemcget(mimic.items["plc"]["fault"], "text").startswith("E-STOP"))
        self.assertEqual(wire("S1_in"), WIRE_OFF)
        self.assertEqual(c.itemcget(mimic.items["dev"][m1["id"]]["rect"], "fill"), FILL["off"])

    def test_device_panel_links_to_live_simulation(self):
        self.app.load_sample("small")
        m1 = next(d for d in self.app.prj["devices"] if d["name"] == "M1")
        self.app.open_device(m1["id"])
        self.root.update()
        self.links(self.find(DevicePanel)[0])["Živá simulace ↗"].invoke()
        self.root.update()
        self.assertEqual((self.app.step, self.app.ui["prog_tab"], self.app.ui["live_sel"]),
                         (6, 1, m1["id"]))
        self.assertTrue(any(str(w.cget("text")) == "Vstup poruchy aktivní (vybavený jistič)"
                            for w in self.find(ttk.Checkbutton)))

    def test_program_sequence_editing(self):
        self.app.load_sample("small")
        self.goto(6)
        seq = self.app.prj["program"]["seq"]
        n = len(seq)
        import gc
        gc.collect()                                         # výběry nesmí po úklidu zbělat
        self.root.update()
        combos = self.find(ttk.Combobox)
        self.assertTrue(all(c.get() for c in combos[1:4]), [c.get() for c in combos])
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
        self.assertFalse(any(n.endswith(".dxf") for n in saved), "Free: bez DXF")
        self.assertIn("PLCdesk Free", Path(out2, "01_funkcni_specifikace_FDS.md").read_text(encoding="utf-8"))
        out3 = tempfile.mkdtemp()
        with pro_license(self.app), mock.patch("tkinter.filedialog.askdirectory", return_value=out3):
            self.click("Uložit vše do složky…")
        self.assertTrue(any(n.endswith(".dxf") for n in os.listdir(out3)), "Pro: DXF")
        self.assertNotIn("PLCdesk Free", Path(out3, "01_funkcni_specifikace_FDS.md").read_text(encoding="utf-8"))
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

    def test_old_project_gets_guids_once(self):
        """Starý projekt bez GUID: GUID doplní jádro při načtení, uloží se a podruhé se nemění."""
        self.app.load_sample("small")
        old = json.loads(json.dumps(self.app.prj))
        for key in ("guid", "moduleGuids"):
            old.pop(key, None)
        for item in old["devices"] + old["io"]:
            item.pop("guid", None)
        path = Path(tempfile.mkdtemp(), "old.plcstudio.json")
        path.write_text(json.dumps({"prj": old}), encoding="utf-8")
        self.assertTrue(self.app.open_project(path))
        guid = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
        prj = self.app.prj
        self.assertRegex(prj["guid"], guid)
        self.assertTrue(all(guid.match(x.get("guid", "")) for x in prj["devices"] + prj["io"]))
        self.assertTrue(prj["moduleGuids"])
        first = json.loads(json.dumps(prj))
        self.app._flush()
        saved = json.loads((self.app.home / "state.json").read_text(encoding="utf-8"))["prj"]
        self.assertEqual(saved["guid"], first["guid"])        # migrace je uložená
        self.app.set_project(saved)
        self.assertEqual(self.app.prj["guid"], first["guid"])
        self.assertEqual([d["guid"] for d in self.app.prj["devices"]], [d["guid"] for d in first["devices"]])
        self.assertEqual(self.app.prj["moduleGuids"], first["moduleGuids"])

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

    # --- průvodce importem stávajícího zařízení -------------------------------------------

    def _wizard(self) -> importer.ImportWizard:
        self.app.ui.pop("import", None)
        wiz = importer.open_wizard(self.app)
        self.root.update()
        self.addCleanup(lambda: wiz.win.winfo_exists() and wiz.close())
        return wiz

    def _wait_import(self, wiz, timeout=5):
        deadline = time.time() + timeout
        while wiz.S["busy"] and time.time() < deadline:
            self.root.update()
            time.sleep(0.02)
        self.root.update()
        self.assertFalse(wiz.S["busy"])

    def test_import_wizard_entry_points_and_pasted_text(self):
        """Krok Projekt i Zařízení otevřou tentýž průvodce; vložený text funguje jako dřív."""
        self.app.load_sample("small")
        self.goto(0)
        self.click("Načíst stávající zařízení…")
        wiz = self.app._import_wiz
        self.assertIsNotNone(wiz)
        self.assertEqual(wiz.S["page"], 0)
        wiz.close()
        self.goto(3)
        self.click("Import stávajícího zařízení…")
        self.assertIsNot(self.app._import_wiz, wiz)
        wiz = self.app._import_wiz
        self.addCleanup(lambda: wiz.win.winfo_exists() and wiz.close())
        self.assertIs(importer.open_wizard(self.app), wiz)          # druhé otevření = totéž okno

        self.assertFalse(wiz.extract())                               # bez podkladů nic
        self.assertIn("Nejdřív přidej", wiz.S["msg"][1])
        wiz.paste_text.insert("1.0", "tohle není export")
        self.assertTrue(wiz.extract())
        self.assertEqual(wiz.S["ex"]["unparsed"][0]["name"], importer.PASTE_NAME)
        self.assertEqual(wiz.S["exact"]["prj"]["devices"], [])
        wiz.goto(3)
        self.assertIn("disabled", self.button("Převzít jako projekt", wiz.win).state())

        wiz.goto(0)
        wiz.paste_text.delete("1.0", "end")
        wiz.paste_text.insert("1.0", PLAIN_IO)
        self.assertTrue(wiz.extract())
        self.assertEqual(wiz.S["page"], 1)
        self.assertEqual([d["name"] for d in wiz.S["exact"]["prj"]["devices"]], ["M7", "S9"])
        self.assertEqual(len(self.app.prj["devices"]), 7)             # náhled nic nepřepsal
        wiz.goto(3)
        with mock.patch("tkinter.messagebox.askyesno", return_value=False):
            self.assertFalse(wiz.take_over())                         # potvrzení odmítnuto
        self.assertEqual(len(self.app.prj["devices"]), 7)
        with mock.patch("tkinter.messagebox.askyesno", return_value=True) as ask:
            self.assertTrue(wiz.take_over())
        self.assertIn("7", ask.call_args[0][1])                       # kolik zařízení nahradí
        self.root.update()
        self.assertFalse(wiz.win.winfo_exists())
        self.assertEqual([d["name"] for d in self.app.prj["devices"]], ["M7", "S9"])
        self.assertTrue(all(e["addr"] for e in self.app.prj["io"]))
        self.assertEqual(self.app.step, 3)
        self.assertNotIn("import", self.app.ui)                       # příště načisto

    def test_import_wizard_own_code_of_all_platforms(self):
        """Vlastní výstup genFor každé platformy se přes průvodce vrátí jako stejná sestava."""
        self.app.load_sample("complex")
        src = self.app.prj
        names = sorted(d["name"] for d in src["devices"])
        out = self.app.bridge.request("gen", prj={**src, "platforms": list(self.app.PLAT)})["out"]
        self.assertEqual(set(out), set(self.app.PLAT))
        for plat, files in out.items():
            with self.subTest(plat=plat):
                tmp = Path(tempfile.mkdtemp())
                for n, body in files.items():
                    (tmp / n).write_text(body, encoding="utf-8", newline="")
                wiz = self._wizard()
                wiz.add_paths(sorted(str(p) for p in tmp.iterdir()))
                self.assertEqual(len(wiz.files_table.tv.get_children()), len(files))
                self.assertTrue(wiz.extract())
                ex, prj = wiz.S["ex"], wiz.S["exact"]["prj"]
                self.assertTrue(all(f["ok"] for f in ex["files"]), ex["files"])
                self.assertEqual(ex.get("platform"), plat)
                self.assertEqual(len(wiz.found_table.tv.get_children()), len(files))
                self.assertEqual(sorted(d["name"] for d in prj["devices"]), names)
                self.assertEqual(len(prj["program"]["seq"]), len(src["program"]["seq"]))
                wiz.goto(3)
                self.assertEqual(len(wiz.dev_table.tv.get_children()), len(names))
                if plat != "codesys":
                    wiz.close()
                    continue
                with mock.patch("tkinter.messagebox.askyesno", return_value=True):
                    self.assertTrue(wiz.take_over())
                self.root.update()
                p = self.app.prj
                self.assertEqual(sorted(d["name"] for d in p["devices"]), names)
                self.assertEqual(len(p["program"]["seq"]), len(src["program"]["seq"]))
                self.assertEqual(p["platforms"], ["codesys"])
                self.assertIn("chyb", self.app._status.cget("text"))
                # krok AI návrh je předvyplněný importovanou sestavou
                self.assertEqual([d["name"] for d in self.app.ai["last"]["devices"]],
                                 [d["name"] for d in p["devices"]])
                self.assertEqual(self.app.ai["turns"][0]["role"], "user")

    def test_import_wizard_foreign_samples_review_and_skip(self):
        """Cizí vzorky (TIA, Logix, GX Works3, I/O list): revize, zdroje, odškrtnutí, převzetí."""
        self.app.load_sample("small")
        # kořen test-data = podklady importu; podsložky (real/, quote/ …) mají jiný účel
        data = Path(__file__).resolve().parents[3] / "packages" / "core" / "test-data"
        paths = sorted(str(p) for p in data.iterdir() if p.is_file())
        self.assertGreaterEqual(len(paths), 5)
        wiz = self._wizard()
        wiz.add_paths(paths)
        wiz.add_paths(paths[:1])                                     # tentýž soubor podruhé ne
        self.assertEqual(len(wiz.S["files"]), len(paths))
        self.assertTrue(wiz.extract())
        ex = wiz.S["ex"]
        self.assertTrue(all(f["ok"] for f in ex["files"]), ex["files"])
        self.assertTrue(ex.get("platform"))
        self.assertGreater(len(ex["pous"]), 0)                       # L5X rutiny
        prop = wiz.proposal()
        self.assertGreater(len(prop["conflicts"]), 0)                # dvě sady adres se kryjí
        self.assertGreater(len(prop["missing"]), 0)
        wiz.goto(3)
        tabs = [wiz.notebook.tab(t, "text") for t in wiz.notebook.tabs()]
        self.assertIn("Konflikty ({n})".format(n=len(prop["conflicts"])), tabs)
        self.assertIn("Chybí ({n})".format(n=len(prop["missing"])), tabs)
        # klik na řádek ukáže citaci zdroje
        devs = prop["prj"]["devices"]
        d = next(x for x in devs if x["name"] == "Conveyor")
        wiz.dev_table.tv.selection_set(str(d["id"]))
        self.root.update()
        cite = wiz.cite.get("1.0", "end")
        self.assertIn("gxworks3_GlobalLabel.csv", cite)
        self.assertIn("Conveyor contactor", cite)
        # barva jistoty
        self.assertIn(prop["evidence"]["dev:Conveyor"]["conf"],
                      wiz.dev_table.tv.item(str(d["id"]), "tags"))
        # odškrtnutí: klik do sloupce ✓
        wiz.dev_table._on_click(str(d["id"]), "take")
        self.root.update()
        self.assertEqual(wiz.S["skip"], {"Conveyor"})
        self.assertEqual(wiz.dev_table.tv.set(str(d["id"]), "take"), "☐")
        self.assertEqual(wiz.dev_table.selected(), str(d["id"]))       # výběr přežil překreslení
        wiz.goto(1)
        wiz.goto(3)                                                   # volby drží
        self.assertEqual(wiz.S["skip"], {"Conveyor"})
        with mock.patch("tkinter.messagebox.askyesno", return_value=True):
            self.assertTrue(wiz.take_over())
        self.root.update()
        p = self.app.prj
        self.assertEqual(len(p["devices"]), len(devs) - 1)
        self.assertNotIn("Conveyor", [x["name"] for x in p["devices"]])
        self.assertFalse(any(e["tag"].startswith("Conveyor") for e in p["io"]))
        self.assertEqual(self.app.step, 3)

    def test_import_wizard_ai_with_mocked_api(self):
        """AI krok: odhad ceny, potvrzení, úspěch (sloučení), chyby, neplatná odpověď a Stop."""
        import threading
        self.app.load_sample("small")
        tmp = Path(tempfile.mkdtemp())
        pdf = ("%PDF-1.4\n1 0 obj << /Type /Pages /Count 2 >> endobj\n"
               "2 0 obj << /Type /Page >> endobj\n3 0 obj << /Type /Page >> endobj\n%%EOF")
        (tmp / "schema.pdf").write_bytes(pdf.encode("latin-1"))
        (tmp / "io.csv").write_text(PLAIN_IO, encoding="utf-8")
        (tmp / "popis.txt").write_bytes("Čerpadlo M1 běží 5 s.".encode("cp1250"))
        self.app.settings["ai_key"] = ""
        self.addCleanup(self.app.settings.__setitem__, "ai_key", "")
        wiz = self._wizard()
        wiz.add_paths([str(tmp / n) for n in ("schema.pdf", "io.csv", "popis.txt")])
        self.assertTrue(wiz.extract())
        self.assertEqual(sorted(u["name"] for u in wiz.S["ex"]["unparsed"]),
                         ["popis.txt", "schema.pdf"])
        wiz.goto(2)
        texts = " ".join(self.ui_texts(wiz.win))
        self.assertIn("USD", texts)
        self.assertIn("Anthropic API", texts)
        self.assertIn("Bez API klíče", texts)
        self.assertNotIn("Spustit analýzu (placené)", texts)        # bez klíče jen informace
        est = wiz.S["est"]
        self.assertGreater(est["usd"], 0)
        self.assertIn("schema.pdf", est["parts"][0]["files"])

        self.app.settings["ai_key"] = "test-key"
        wiz.render()
        raw = ('```json\n{"devices":[{"name":"-M1","cls":"Motor","desc":"Čerpadlo","opt":{}},'
               '{"name":"-S1","cls":"DI","desc":"Nouzové zastavení (NC)","opt":{}}],"estop":"-S1",'
               '"io":[{"dev":"M1","sig":"outRun","addr":"%Q1.0"}],'
               '"evidence":{"dev:-M1":{"conf":"sure","src":[{"file":"schema.pdf","page":2,'
               '"quote":"-M1 Čerpadlo"}]}},"missing":["Chybí popis cyklu"],'
               '"questions":["Jaký je takt?"],"note":"Ze schématu"}\n```')
        calls = []

        def ok(key, model, messages, timeout=0, max_tokens=0, strict=True):
            calls.append((key, model, messages, timeout, max_tokens))
            return {"text": raw, "usage": {"input_tokens": 12000, "output_tokens": 3000},
                    "stop_reason": "end_turn"}

        with mock.patch.object(ai_client, "call_full", ok):
            with mock.patch("tkinter.messagebox.askyesno", return_value=False) as ask:
                self.click("Spustit analýzu (placené)", wiz.win)
            self.assertIn("USD", ask.call_args[0][1])
            self.assertEqual(calls, [])                               # odmítnuto = nic neodešlo
            with mock.patch("tkinter.messagebox.askyesno", return_value=True):
                self.click("Spustit analýzu (placené)", wiz.win)
            self._wait_import(wiz)
        self.assertEqual(len(calls), 1)
        key, model, messages, timeout, max_tokens = calls[0]
        self.assertEqual((key, timeout, max_tokens), ("test-key", 600, 32000))
        self.assertIn("document", [b["type"] for b in messages[0]["content"]])
        S = wiz.S
        self.assertEqual(S["page"], 3)
        self.assertIsNotNone(S["merged"])
        self.assertIn("USD", S["msg"][1])
        names = [d["name"] for d in S["merged"]["prj"]["devices"]]
        self.assertIn("M1", names)
        self.assertIn("M7", names)                                    # přesná data zůstala
        tabs = [wiz.notebook.tab(t, "text") for t in wiz.notebook.tabs()]
        self.assertIn("Otázky a poznámka AI", tabs)
        m1 = next(d for d in S["merged"]["prj"]["devices"] if d["name"] == "M1")
        wiz.dev_table.tv.selection_set(str(m1["id"]))
        self.root.update()
        cite = wiz.cite.get("1.0", "end")
        self.assertIn("schema.pdf", cite)
        self.assertIn("strana 2", cite)
        self.assertIn("-M1 Čerpadlo", cite)

        # chyby API a neplatná odpověď
        for exc, text in ((ai_client.AiError("too_large"), "příliš velký"),
                          (ai_client.AiError("network", "timeout"), "timeout"),
                          (ai_client.AiError("bad_key"), "401"),
                          (ai_client.AiError("bad_request", "too many PDF pages"), "too many PDF pages")):
            def fail(*_a, exc=exc, **_k):
                raise exc
            wiz.goto(2)
            with mock.patch.object(ai_client, "call_full", fail):
                wiz.start_ai()
                self._wait_import(wiz)
            self.assertEqual(S["msg"][0], "err")
            self.assertIn(text, S["msg"][1])
            self.assertEqual(S["page"], 2)
        with mock.patch.object(ai_client, "call_full", lambda *a, **k: {
                "text": "bez json", "usage": {}, "stop_reason": "end_turn"}):
            wiz.start_ai()
            self._wait_import(wiz)
        self.assertIn("nepodařilo přečíst", S["msg"][1])

        # Stop: běžící dotaz se zahodí, i když odpověď dorazí později
        gate = threading.Event()

        def slow(*_a, **_k):
            gate.wait(5)
            return {"text": raw.replace("Čerpadlo", "Pozdě"), "usage": {}, "stop_reason": "end_turn"}

        before = S["merged"]
        with mock.patch.object(ai_client, "call_full", slow):
            wiz.start_ai()
            self.root.update()
            self.assertTrue(S["busy"])
            self.click("Stop", wiz.win)
            self.assertFalse(S["busy"])
            self.assertIn("zastavena", S["msg"][1])
            gate.set()
            deadline = time.time() + 0.6
            while time.time() < deadline:
                self.root.update()
                time.sleep(0.02)
        self.assertIs(S["merged"], before)
        self.assertEqual(S["page"], 2)

        # převzetí sloučeného návrhu → projekt + předvyplněný AI návrh
        wiz.goto(3)
        with mock.patch("tkinter.messagebox.askyesno", return_value=True):
            self.assertTrue(wiz.take_over())
        self.root.update()
        self.assertIn("M1", [d["name"] for d in self.app.prj["devices"]])
        self.assertIn("Chybí popis cyklu", self.app.ai["last"]["note"])   # body AI se neztratí
        self.assertIn("schema.pdf", self.app.ai["turns"][0]["content"])

    def test_import_wizard_ai_partial_result_after_error(self):
        """Podklady ve více dotazech: chyba v dalším dotazu nabídne výsledek dosavadních."""
        self.app.load_sample("small")
        self.app.settings["ai_key"] = "test-key"
        self.addCleanup(self.app.settings.__setitem__, "ai_key", "")
        tmp = Path(tempfile.mkdtemp())
        prose = "\n".join(f"Krok {i}: obsluha zkontroluje stroj a pokracuje dal podle navodu."
                          for i in range(9000))
        (tmp / "popis.txt").write_text(prose, encoding="utf-8")
        (tmp / "io.csv").write_text(PLAIN_IO, encoding="utf-8")
        wiz = self._wizard()
        wiz.S["model"] = "claude-haiku-4-5-20251001"            # kontext 200k → víc dotazů
        wiz.add_paths([str(tmp / "popis.txt"), str(tmp / "io.csv")])
        self.assertTrue(wiz.extract())
        wiz.goto(2)
        n = len(wiz.S["est"]["parts"])
        self.assertGreater(n, 1)
        raw = ('{"devices":[{"name":"M1","cls":"Motor","desc":"Pohon","opt":{}}],'
               '"evidence":{"dev:M1":{"conf":"guess","src":[{"file":"popis.txt","line":3}]}}}')
        calls = []

        def flaky(key, model, messages, **_k):
            calls.append(messages)
            if len(calls) > 1:
                raise ai_client.AiError("rate_limited")
            return {"text": raw, "usage": {"input_tokens": 1, "output_tokens": 1}}

        with mock.patch.object(ai_client, "call_full", flaky):
            wiz.start_ai()
            self._wait_import(wiz)
        self.assertEqual(len(calls), 2)
        # druhý dotaz dostal výsledek prvního
        self.assertIn('"M1"', messages_text(calls[1]))
        self.assertEqual(wiz.S["page"], 2)
        self.assertIn("Příliš mnoho dotazů", wiz.S["msg"][1])
        self.assertEqual(wiz.S["partial"], (1, n))
        self.click(f"Použít výsledek dosavadních dotazů (1 z {n})", wiz.win)
        self.assertEqual(wiz.S["page"], 3)
        self.assertIn("M1", [d["name"] for d in wiz.S["merged"]["prj"]["devices"]])
        self.assertIn("M7", [d["name"] for d in wiz.S["merged"]["prj"]["devices"]])
        self.assertIn(f"1 z {n}", wiz.S["msg"][1])

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
        self.assertIn("PLCdesk", seen["messages"][0]["content"])
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

    def test_ai_model_selection_lists_available_models(self):
        saved = {k: self.app.settings.get(k) for k in ("ai_key", "ai_model", "ai_models")}
        try:
            self.app.settings.update(ai_key="test-key", ai_model=None, ai_models=None)
            self.goto(1)
            cb = [w for w in self.find(ttk.Combobox) if ai_client.DEFAULT_MODEL in w.cget("values")][0]
            self.assertEqual(cb.get(), ai_client.DEFAULT_MODEL)
            self.assertIn("claude-fable-5-1", cb.cget("values"))
            with mock.patch.object(ai_client, "list_models", return_value=["claude-sonnet-5-5", "claude-novy-9"]), \
                    mock.patch.object(ai_client, "call", side_effect=AssertionError("nesmí se volat")):
                self.click("Načíst dostupné modely")
                deadline = time.time() + 5
                while not self.app.settings.get("ai_models") and time.time() < deadline:
                    self.root.update()
                    time.sleep(0.02)
                self.root.update()
            self.assertEqual(self.app.settings["ai_models"], ["claude-sonnet-5-5", "claude-novy-9"])
            self.assertIn("claude-novy-9", cb.cget("values"))
            cb.set("claude-novy-9")                              # vlastní / načtené ID se uloží
            self.assertEqual(self.app.settings["ai_model"], "claude-novy-9")
        finally:
            self.app.settings.update(saved)

    # --- regrese z proklikání celé aplikace ------------------------------------------

    def status(self) -> str:
        return str(self.app._status.cget("text"))

    def test_broken_project_file_is_completed_or_rejected(self):
        """Neúplný / vadný soubor projektu: buď se doplní a všechny kroky jdou vykreslit,
        nebo se odmítne a rozpracovaný návrh zůstane (dřív KeyError a pády kroků)."""
        self.app.load_sample("small")
        want = json.loads(json.dumps(self.app.prj))
        folder = Path(tempfile.mkdtemp())
        rejected = ('{"prj":{"meta":{"name":"x"},"devices":"ne"}}', "[]", '{"a":1}',
                    '{"meta":{"name":"x"},"devices":[{"id":1}]}',
                    '{"meta":{"name":"x"},"devices":[{"id":1,"cls":"DI"},{"id":1,"cls":"DO"}]}')
        for i, text in enumerate(rejected):
            path = folder / f"r{i}.json"
            path.write_text(text, encoding="utf-8")
            with mock.patch("tkinter.messagebox.showerror") as err:
                self.assertFalse(self.app.open_project(path), text)
            err.assert_called_once()
            self.assertEqual(self.app.prj, want)
        path = folder / "neuplny.json"
        path.write_text(json.dumps({"meta": {"name": "Neúplný", "takt": "x"},
                                    "devices": [{"id": 3, "cls": "Motor", "name": "M1"},
                                                {"id": 5, "cls": "DI"}],
                                    "program": {"estop": 3, "seq": [
                                        {"dev": 3, "act": "start", "cond": "fbk", "timeS": 2},
                                        {"dev": 9, "act": "start", "cond": "fbk", "timeS": 2},
                                        {"act": "wait", "cond": "time", "timeS": None}]},
                                    "nextId": 1, "sim": {"motorDelay": "x"}}), encoding="utf-8")
        self.assertTrue(self.app.open_project(path))
        prj = self.app.prj
        self.assertEqual((prj["meta"]["desc"], prj["nextId"], prj["sim"]), ("", 6, {}))
        self.assertNotIn("takt", prj["meta"])
        self.assertEqual(prj["program"]["estop"], "", "E-stop jen na DI")
        self.assertEqual(len(prj["program"]["seq"]), 1)
        self.assertEqual(prj["devices"][0]["opt"], {})
        self.assertTrue(prj["io"], "I/O dopočítané")
        for step in [*range(9), "help"]:
            self.goto(step)

    def test_invalid_numbers_never_reach_the_project(self):
        """„inf“, „1e999“, text: projekt zůstane platný JSON (dřív most odmítl každý požadavek
        a žádný krok nešel vykreslit) a neplatná mez se tiše nesmaže."""
        self.app.load_sample("small")
        self.goto(0)
        # pole taktu podle popisku (v kroku jsou i číslo projektu, zákazník a datum zahájení)
        takt = next(e for e in self.find(ttk.Entry) if any(
            "takt" in str(w.cget("text")) for w in e.master.winfo_children() if isinstance(w, ttk.Label)))
        for text in ("inf", "1e999", "nan"):
            takt.delete(0, "end")
            takt.insert(0, text)
            self.assertNotIn("takt", self.app.prj["meta"])
        takt.delete(0, "end")

        self.goto(3)
        b1 = next(d for d in self.app.prj["devices"] if d["name"] == "B1")
        self.table().select(b1["id"])
        self.root.update()
        lo, hi = [w for w in self.button("Uložit parametry").master.winfo_children()
                  if type(w) is ttk.Entry]
        hi.insert(0, "200")
        self.click("Uložit parametry")
        hi.delete(0, "end")
        hi.insert(0, "abc")
        self.click("Uložit parametry")
        self.assertEqual(b1.get("limHi"), 200, "neplatné číslo mez nesmaže")
        self.assertIn("mez max", self.status())
        lo.insert(0, "300")
        hi.delete(0, "end")
        hi.insert(0, "200")
        self.click("Uložit parametry")
        self.assertNotIn("limLo", b1)
        self.assertIn("menší", self.status())

        combo = self.find(ttk.Combobox)[0]                   # nové zařízení: rozsah analogu
        combo.set(self.app.CLS["AnalogIn"]["label"])
        self.root.update()
        n = len(self.app.prj["devices"])
        entries = self.find(ttk.Entry)
        entries[4].delete(0, "end")
        entries[4].insert(0, "inf")
        self.click("Přidat zařízení")
        self.assertEqual(len(self.app.prj["devices"]), n)

        self.app.ui["prog_tab"] = 0
        self.goto(6)
        seq_n = len(self.app.prj["program"]["seq"])
        spin = self.find(ttk.Spinbox)[0]
        for text in ("inf", "abc", "-5", "0"):
            spin.delete(0, "end")
            spin.insert(0, text)
            self.click("Přidat krok")
            self.assertEqual(len(self.app.prj["program"]["seq"]), seq_n, text)
        self.assertIn("3600", self.status())

        self.app.prj["sim"] = {"motorDelay": 2.0, "valveTravel": 1.0}
        self.app.ui.update(prog_tab=2, sim_tab=0)
        self.goto(6)
        motor = next(e for e in self.find(ttk.Entry) if e.get() == "2")
        for text in ("inf", "abc"):
            motor.delete(0, "end")
            motor.insert(0, text)
            self.key(motor, "<Return>")
            self.assertEqual(self.app.prj["sim"]["motorDelay"], 2.0, text)
        json.dumps(self.app.prj, allow_nan=False)

    def test_ai_unexpected_client_error_does_not_hang(self):
        self.app.reset_project()
        self.app.settings["ai_key"] = "test-key"
        self.goto(1)
        with mock.patch.object(ai_client, "call", side_effect=KeyError("content")):
            self.find(tk.Text)[0].insert("1.0", "Popis stroje")
            self.click("Navrhnout zařízení")
            self._wait_ai()
        self.assertEqual(self.app.ai["draft"], "Popis stroje")
        self.assertTrue(any("KeyError" in str(w.cget("text")) for w in self.find(ttk.Label)))
        with mock.patch.object(ai_client, "list_models", side_effect=TypeError("x")):
            self.click("Načíst dostupné modely")
            btn = self.button("Načíst dostupné modely")
            deadline = time.time() + 5
            while "disabled" in btn.state() and time.time() < deadline:
                self.root.update()
                time.sleep(0.02)
        self.assertNotIn("disabled", btn.state(), "tlačítko se po chybě zase uvolní")

    def test_choices_survive_step_redraw(self):
        """Třída nového zařízení, rozpracovaný krok sekvence a záložka matice stavů
        drží volbu uživatele i po překreslení kroku."""
        self.app.load_sample("small")
        self.goto(3)
        self.find(ttk.Combobox)[0].set(self.app.CLS["Ventil"]["label"])
        self.app.render()
        self.root.update()
        self.assertEqual(self.find(ttk.Combobox)[0].get(), self.app.CLS["Ventil"]["label"])

        self.app.ui["prog_tab"] = 0
        self.goto(6)
        dev, act = self.find(ttk.Combobox)[1:3]
        y1 = next(v for v in dev.cget("values") if v.startswith("Y1"))
        dev.set(y1)
        act.current(1)                                      # zavřít
        self.find(ttk.Spinbox)[0].set("7")
        self.click("Přidat krok")
        self.assertEqual(self.app.prj["program"]["seq"][-1]["act"], "close")
        dev, act = self.find(ttk.Combobox)[1:3]
        self.assertEqual((dev.get(), act.current(), self.find(ttk.Spinbox)[0].get()), (y1, 1, "7"))

        self.app.ui.update(prog_tab=2, sim_tab=2)
        self.goto(6)
        ver = next(w for w in self.find(ttk.Notebook) if "Matice stavů" in
                   [w.tab(t, "text") for t in w.tabs()])
        ver.select(1)
        self.root.update()
        self.app.render()
        self.root.update()
        ver = next(w for w in self.find(ttk.Notebook) if "Matice stavů" in
                   [w.tab(t, "text") for t in w.tabs()])
        self.assertEqual(ver.index(ver.select()), 1)

    # --- kusovník a odkazy v nápovědě ------------------------------------------------

    def _bom_table(self):
        return next(t for t in self.find(Table) if "code" in t._keys and "pos" in t._keys)

    def _bom_pick(self):
        return next(c for c in self.find(ttk.Combobox)
                    if c.cget("values") and str(c.cget("values")[-1]).startswith("vlastní"))

    def test_bill_of_materials_step_choices_persist_and_export(self):
        self.app.load_sample("complex")
        self.goto(9)
        tv = self._bom_table().tv
        rows = tv.get_children()
        self.assertGreater(len(rows), 50)
        self.assertEqual(tv.set("-A1:plc_cpu", "brand"), "Siemens", "platforma = první zvolená")
        self.assertTrue(tv.set("-K1:contactor", "code"), "stykač s objednacím kódem z katalogu")
        self.assertIn("safety", tv.item("-S1:estop_button", "tags"), "E-stop jako HW s výhradou")
        # značka z katalogu pro celou kategorii; výběr řádku přežije překreslení
        tv.selection_set("-K1:contactor")
        self.root.update()
        pick = self._bom_pick()
        other = next(i for i, v in enumerate(pick.cget("values")[:-1]) if not v.startswith("Siemens"))
        pick.current(other)
        pick.event_generate("<<ComboboxSelected>>")
        self.root.update()
        tv = self._bom_table().tv
        brand = tv.set("-K1:contactor", "brand")
        self.assertNotEqual(brand, "Siemens")
        self.assertEqual(tv.set("-K2:contactor", "brand"), brand, "volba platí pro celou kategorii")
        self.assertEqual(tv.selection(), ("-K1:contactor",))
        # vlastní výrobce jen pro jeden řádek
        self.find(ttk.Checkbutton)[-1].invoke()             # „použít pro všechny…“ vypnout
        pick = self._bom_pick()
        pick.current(len(pick.cget("values")) - 1)
        pick.event_generate("<<ComboboxSelected>>")
        self.root.update()
        ent = next(e for e in self.find(ttk.Entry) if e.winfo_ismapped() and e.grid_info().get("column") == 2)
        ent.insert(0, "Vlastní s.r.o.")
        self.key(ent, "<Return>")      # klávesa jde do okna s fokusem — bez něj se Enter ztratí
        tv = self._bom_table().tv
        self.assertEqual(tv.set("-K1:contactor", "brand"), "Vlastní s.r.o.")
        self.assertEqual(tv.set("-K2:contactor", "brand"), brand)
        # množství s neplatnou hodnotou se nepřijme, platné ano
        tbl = self._bom_table()
        tbl._on_edit("-K1:contactor", "qty", "nesmysl")
        self.assertNotIn("qty", self.app.prj["bom"]["lines"].get("-K1:contactor", {}))
        tbl._on_edit("-K1:contactor", "qty", "3")
        self.root.update()
        self.assertEqual(self._bom_table().tv.set("-K1:contactor", "qty"), "3")
        # platforma kusovníku
        cbp = next(c for c in self.find(ttk.Combobox) if "Rockwell Allen-Bradley" in c.cget("values"))
        cbp.set("Rockwell Allen-Bradley")
        cbp.event_generate("<<ComboboxSelected>>")
        self.root.update()
        self.assertEqual(self.app.prj["bom"]["plat"], "rockwell")
        self.assertEqual(self._bom_table().tv.set("-A1:plc_cpu", "code"), "5069-L306ER")
        # CSV pro Excel se stejným počtem řádků
        saved = {}
        with mock.patch("plc_studio.steps.kusovnik.save_file",
                        side_effect=lambda app, name, body, *_a: saved.update(name=name, body=body)):
            self.click("Uložit CSV…")
        self.assertTrue(saved["name"].endswith("_kusovnik.csv"))
        self.assertEqual(len(saved["body"].strip().splitlines()), len(rows) + 1)
        self.assertIn("Vlastní s.r.o.", saved["body"])
        # neplatné volby v souboru projektu se odfiltrují
        from plc_studio.project import normalize_bom
        self.assertEqual(normalize_bom({"plat": "x", "lines": {"a": {"qty": float("inf"), "brand": 5}}},
                                       self.app.PLAT), {})
        self.click("Obnovit výchozí volby")
        self.assertEqual(self.app.prj.get("bom"), {"plat": "rockwell"})

    def test_bill_of_materials_sort_and_filter_by_columns(self):
        self.app.load_sample("complex")
        self.goto(9)
        tv = self._bom_table().tv
        total = len(tv.get_children())
        self.root.tk.call(tv.heading("brand", "command"))   # klik na záhlaví Výrobce
        self.root.update()
        tv = self._bom_table().tv
        brands = [tv.set(r, "brand").lower() for r in tv.get_children()]
        self.assertEqual(brands, sorted(brands))
        self.assertTrue(tv.heading("brand", "text").endswith("▲"))
        self.root.tk.call(tv.heading("brand", "command"))
        self.root.update()
        brands = [tv.set(r, "brand").lower() for r in tv.get_children()]
        self.assertEqual(brands, sorted(brands, reverse=True), "druhý klik = sestupně")
        # filtry na dva sloupce
        cb = next(c for c in self.find(ttk.Combobox) if "Výrobce" in c.cget("values"))
        ent = next(e for e in cb.master.winfo_children() if type(e) is ttk.Entry)
        add = next(b for b in cb.master.winfo_children() if isinstance(b, ttk.Button))
        cb.set("Výrobce")
        ent.insert(0, "festo")
        add.invoke()
        cb.set("Položka")
        ent.insert(0, "válec")
        add.invoke()
        self.root.update()
        rows = tv.get_children()
        self.assertTrue(0 < len(rows) < total)
        self.assertTrue(all("festo" in tv.set(r, "brand").lower() and "válec" in tv.set(r, "item").lower()
                            for r in rows))
        self.assertTrue(self.label_text("zobrazeno"))
        # po překreslení kroku řazení i filtry zůstanou; volby projektu se nemění
        self.app.render()
        self.root.update()
        tv = self._bom_table().tv
        self.assertEqual(len(tv.get_children()), len(rows))
        self.assertTrue(tv.heading("brand", "text").endswith("▼"))
        self.assertNotIn("bom", self.app.prj, "řazení a filtr nejsou volby projektu")
        self.click("Zrušit filtry")
        self.assertEqual(len(self._bom_table().tv.get_children()), total)

    def test_opened_sample_without_conversation_fills_ai_step(self):
        """Příklad ze samples/ nemá AI konverzaci — krok 2 se předvyplní z projektu."""
        from plc_studio.steps.projekt import list_samples
        path = next(s["path"] for s in list_samples() if "LK-06" in s["label"])
        self.assertTrue(self.app.open_project(path))
        self.assertEqual([t["role"] for t in self.app.ai["turns"]], ["user", "assistant"])
        self.assertEqual(len(self.app.ai["last"]["devices"]), len(self.app.prj["devices"]))
        self.goto(1)
        tbl = next(t for t in self.find(Table) if t.tv.get_children())
        self.assertEqual(len(tbl.tv.get_children()), len(self.app.prj["devices"]))
        self.button("Převzít návrh (nahradí zařízení)")
        chat = "".join(t.get("1.0", "end") for t in self.find(tk.Text))
        self.assertIn(self.app.prj["meta"]["desc"][:30], chat, "zadání = popis stroje v konverzaci")

    def test_help_links_to_platform_documentation(self):
        self.goto("help")
        txt = self.find(tk.Text)[0]
        self.assertEqual(len(txt.tag_ranges("link")) // 2, 124)  # 59 + WAGO (4) + Delta AX (3) + další profily CODESYS (58)
        self.assertIn("Odkazy na dokumentaci platforem", txt.get("1.0", "end"))
        self.assertIn("10. Kusovník", txt.get("1.0", "end"))
        first = txt.tag_ranges("link")[0]
        txt.see(first)
        self.root.update()
        with mock.patch("webbrowser.open") as op:
            x, y, *_ = txt.bbox(first)
            txt.event_generate("<Motion>", x=x + 2, y=y + 2)   # Tk určí odkaz pod kurzorem
            txt.event_generate("<Button-1>", x=x + 2, y=y + 2)
            self.root.update()
        op.assert_called_once()
        self.assertTrue(op.call_args[0][0].startswith("https://"))

    # --- kroky 11–13: bezpečnost, schválení, oživení --------------------------------------

    def entry_by_label(self, label):
        """Vstupní pole za popiskem ``label`` ve stejném rámci."""
        for w in self.find(ttk.Label):
            if str(w.cget("text")) == label:
                kids = w.master.winfo_children()
                return next(e for e in kids[kids.index(w):] if type(e) is ttk.Entry)
        self.fail(f"pole {label!r} není na obrazovce")

    def set_name(self, label, name):
        ent = self.entry_by_label(label)
        ent.delete(0, "end")
        ent.insert(0, name)
        self.root.update()

    def select_row(self, key, index=0):
        tbl = self.table(index)
        tbl.select(key)
        self.root.update()
        return tbl

    def approval_state(self, key):
        data = self.app.bridge.request("approval", prj=self.app.prj)
        return next(i for i in data["items"] if i["key"] == key)

    def test_approval_approve_reject_reset_and_name_required(self):
        self.app.load_sample("small")
        self.app.settings["approver"] = ""
        self.goto(11)
        tbl = self.select_row("seq")
        self.assertTrue(self.button("Schválit").instate(["disabled"]), "bez jména nejde schválit")
        self.assertTrue(self.button("Zamítnout").instate(["disabled"]))
        self.assertIn("Bez jména schvalující osoby nelze schválit ani zamítnout — zadej ho nahoře.",
                      self.ui_texts())
        self.set_name("Schvaluje:", "  Jan Novák ")
        self.assertEqual(self.app.settings["approver"], "Jan Novák")
        stored = json.loads((self.app.home / "settings.json").read_text(encoding="utf-8"))
        self.assertEqual(stored["approver"], "Jan Novák", "jméno se pamatuje v settings.json")
        self.click("Schválit")
        rec = self.app.prj["approvals"]["seq"]
        self.assertEqual((rec["state"], rec["by"]), ("approved", "Jan Novák"))
        tbl = self.table()
        self.assertEqual(tbl.tv.set("seq", "status"), "schváleno")
        self.assertIn("approved", tbl.tv.item("seq", "tags"))
        self.assertTrue(tbl.tv.set("seq", "who").startswith("Jan Novák, "))

        # zamítnutí potřebuje důvod v poznámce
        self.click("Zamítnout")
        self.assertEqual(self.app.prj["approvals"]["seq"]["state"], "approved")
        self.entry_by_label("Poznámka (u zamítnutí důvod):").insert(0, "chybí krok upnutí")
        self.root.update()
        self.click("Zamítnout")
        rec = self.app.prj["approvals"]["seq"]
        self.assertEqual((rec["state"], rec["note"]), ("rejected", "chybí krok upnutí"))
        self.assertEqual(self.table().tv.set("seq", "status"), "zamítnuto")
        self.assertTrue(any("Poznámka: chybí krok upnutí" in t for t in self.ui_texts()))

        self.click("Zrušit rozhodnutí")
        self.assertNotIn("seq", self.app.prj.get("approvals") or {})
        self.assertEqual(self.table().tv.set("seq", "status"), "neschváleno")

        # položka, která ještě není připravená (oživení neuzavřené), schválit nejde
        self.select_row("commission:close")
        self.assertTrue(self.button("Schválit").instate(["disabled"]))
        self.assertTrue(any("kroků není OK ani N/A" in t for t in self.ui_texts()))

        # bez jména nejde schválit ani přes jádro (pojistka)
        with self.assertRaises(BridgeError):
            self.app.bridge.mutate("approve", self.app.prj, "io", "  ")

    def test_approval_becomes_stale_after_change(self):
        self.app.load_sample("small")
        self.app.settings["approver"] = "Jan Novák"
        self.goto(11)
        self.select_row("dev:M1")
        self.click("Schválit")
        self.assertEqual(self.approval_state("dev:M1")["status"], "approved")
        m1 = next(d for d in self.app.prj["devices"] if d["name"] == "M1")
        m1["desc"] = "Jiný popis"                        # popis schválení nezneplatní
        self.assertEqual(self.approval_state("dev:M1")["status"], "approved")
        m1["opt"]["fault"] = not m1["opt"].get("fault")  # změna chování ano
        self.goto(11)
        tbl = self.table()
        self.assertEqual(tbl.tv.set("dev:M1", "status"), "změněno po schválení")
        self.assertIn("stale", tbl.tv.item("dev:M1", "tags"))
        self.assertIn("1 změněno po schválení", self.ui_texts())
        self.app.update_badge()
        self.assertEqual(self.app._badge["stale"], 1)
        # znovu schválit → zase platí
        self.select_row("dev:M1")
        self.click("Schválit")
        self.assertEqual(self.approval_state("dev:M1")["status"], "approved")

    def test_tuning_proposal_apply_changes_project_without_approving(self):
        self.app.load_sample("small")
        self.app.settings["approver"] = "Jan Novák"
        self.app.ui["appr"] = {"tab": 1}
        self.goto(11)
        tune = next(t for t in self.find(Table) if t.tv.exists("limits-B1"))
        self.assertTrue(self.button("Použít").instate(["disabled"]), "bez výběru nic")
        tune.select("limits-B1")
        self.root.update()
        # návrh bez automatické úpravy se jen popisuje
        tune.select("unused-out-H1")
        self.root.update()
        self.assertTrue(self.button("Použít").instate(["disabled"]))
        tune.select("limits-B1")
        self.root.update()
        before = dict(self.app.prj.get("approvals") or {})
        self.click("Použít")
        b1 = next(d for d in self.app.prj["devices"] if d["name"] == "B1")
        self.assertTrue(isinstance(b1.get("limLo"), (int, float)) and b1["limHi"] > b1["limLo"])
        self.assertEqual(self.app.prj.get("approvals") or {}, before, "použití nic neschvaluje")
        status = str(self.app._status.cget("text"))
        self.assertIn("Použito:", status)
        self.assertIn("Zařízení B1", status, "zpráva říká, co se změnilo")
        self.assertFalse(any(t.tv.exists("limits-B1") for t in self.find(Table)), "návrh zmizel")

    def test_approval_bulk_selected_and_group_with_confirmation(self):
        self.app.load_sample("small")
        self.app.settings["approver"] = "Jan Novák"
        self.goto(11)
        tbl = self.table()
        tbl.tv.selection_set(("dev:M1", "dev:Y1"))
        self.root.update()
        with mock.patch("plc_studio.steps.schvaleni.messagebox.askyesno", return_value=False) as ask:
            self.click("Schválit vybrané")
        self.assertIn("2", ask.call_args[0][1], "potvrzení uvádí počet")
        self.assertIn("Jan Novák", ask.call_args[0][1], "a jméno")
        self.assertNotIn("dev:M1", self.app.prj.get("approvals") or {}, "bez potvrzení nic")
        tbl = self.table()
        tbl.tv.selection_set(("dev:M1", "dev:Y1"))
        self.root.update()
        with mock.patch("plc_studio.steps.schvaleni.messagebox.askyesno", return_value=True):
            self.click("Schválit vybrané")
        rec = self.app.prj["approvals"]
        self.assertEqual(sorted(rec), ["dev:M1", "dev:Y1"], "jen vybrané, každá vlastní záznam")
        self.assertTrue(all(r["by"] == "Jan Novák" and r["state"] == "approved" for r in rec.values()))
        # celá skupina podle vybraného řádku skupiny
        tbl = self.table()
        tbl.tv.selection_set(("g:program",))
        self.root.update()
        with mock.patch("plc_studio.steps.schvaleni.messagebox.askyesno", return_value=True):
            self.click("Schválit celou skupinu")
        for k in ("seq", "interlocks", "limits"):
            self.assertEqual(self.approval_state(k)["status"], "approved", k)
        self.assertEqual(self.approval_state("io")["status"], "missing", "jiná skupina zůstala")

    def test_approval_orphans_and_export(self):
        self.app.load_sample("small")
        self.app.settings["approver"] = "Jan Novák"
        prj = self.app.bridge.mutate("approve", self.app.prj, "dev:H1", "Jan Novák")
        prj["devices"] = [d for d in prj["devices"] if d["name"] != "H1"]
        self.app.prj = prj
        self.app.sync()
        self.app.ui["appr"] = {"tab": 2}
        self.goto(11)
        tbl = next(t for t in self.find(Table) if t.tv.exists("dev:H1"))
        self.assertEqual(tbl.tv.set("dev:H1", "state"), "schváleno")
        tbl.select("dev:H1")
        self.root.update()
        self.click("Smazat vybraný")
        self.assertNotIn("dev:H1", self.app.prj.get("approvals") or {})
        with mock.patch("plc_studio.steps.schvaleni.save_file") as sf:
            self.click("Uložit 11_schvaleni.md…")
        name, body = sf.call_args[0][1:3]
        self.assertTrue(name.endswith("11_schvaleni.md"))
        self.assertIn("# Schválení projektu", body)

    def test_commissioning_results_filter_and_export(self):
        self.app.load_sample("small")
        self.app.settings["approver"] = ""
        self.app.ui["com"] = {"sel": "p1:visual"}
        self.goto(12)
        self.assertTrue(self.button("OK").instate(["disabled"]), "bez jména nejde zapsat")
        self.set_name("Oživuje:", "Petr Svoboda")
        self.assertEqual(self.app.settings["approver"], "Petr Svoboda")
        self.click("OK")
        rec = self.app.prj["commissioning"]["p1:visual"]
        self.assertEqual((rec["result"], rec["by"]), ("ok", "Petr Svoboda"))
        self.assertEqual(self.app.ui["com"]["sel"], "p1:pe", "výběr přešel na další krok")
        self.click("N/A")
        self.assertEqual(self.app.prj["commissioning"]["p1:pe"]["result"], "na")
        # 24 V: naměřeno + poznámka, nevyhovuje
        self.assertEqual(self.app.ui["com"]["sel"], "p1:24v")
        self.entry_by_label("Naměřeno:").insert(0, "21,5 V")
        self.entry_by_label("Poznámka:").insert(0, "slabý zdroj")
        self.root.update()
        self.click("Nevyhovuje")
        rec = self.app.prj["commissioning"]["p1:24v"]
        self.assertEqual((rec["result"], rec["measured"], rec["note"]), ("nok", "21,5 V", "slabý zdroj"))
        tbl = self.table()
        self.assertEqual(tbl.tv.set("p1:24v", "res"), "NOK")
        self.assertEqual(tbl.tv.set("p1:24v", "meas"), "21,5 V")
        self.assertIn("1 NOK", self.ui_texts())

        # filtr: jen nevyhovující / bez výsledku
        radio = next(r for r in self.find(ttk.Radiobutton) if str(r.cget("text")).startswith("nevyhovuje"))
        radio.invoke()
        self.root.update()
        steps = [i for g in self.table().tv.get_children() for i in self.table().tv.get_children(g)]
        self.assertEqual(steps, ["p1:24v"])
        radio = next(r for r in self.find(ttk.Radiobutton) if str(r.cget("text")).startswith("bez výsledku"))
        radio.invoke()
        self.root.update()
        tv = self.table().tv
        steps = [i for g in tv.get_children() for i in tv.get_children(g)]
        self.assertNotIn("p1:visual", steps)
        self.assertNotIn("p1:24v", steps)
        self.assertIn("p1:plc", steps)
        self.assertEqual(self.app.ui["com"]["filter"], "open")

        # zrušení výsledku
        self.app.ui["com"].update(filter="all", sel="p1:pe")
        self.goto(12)
        self.click("Zrušit výsledek")
        self.assertNotIn("p1:pe", self.app.prj["commissioning"])

        # export protokolu MD a CSV
        with mock.patch("plc_studio.steps.ozivovani.save_file") as sf:
            self.click("Uložit protokol…")
            self.click("Uložit CSV…")
        (n1, md), (n2, csv) = [c[0][1:3] for c in sf.call_args_list]
        self.assertTrue(n1.endswith("12_protokol_ozivovani.md"))
        self.assertTrue(n2.endswith("12_protokol_ozivovani.csv"))
        self.assertIn("# Protokol oživení", md)
        self.assertIn("**NOK**", md)
        self.assertIn("21,5 V", csv)

    def test_badge_counts_unapproved_and_opens_approval(self):
        self.app.load_sample("small")
        self.goto(0)
        self.app.update_badge()
        data = self.app.bridge.request("approval", prj=self.app.prj)
        n = data["summary"]["pending"] + data["summary"]["stale"]
        lbl = self.app._badge_lbl
        self.assertTrue(lbl.winfo_ismapped())
        self.assertEqual(str(lbl.cget("text")), f"Neschváleno: {n}")
        self.app.prj = self.app.bridge.mutate("approve", self.app.prj, "io", "Jan Novák")
        self.app.render()
        self.app.update_badge()
        self.assertEqual(str(lbl.cget("text")), f"Neschváleno: {n - 1}")
        lbl.event_generate("<Button-1>")
        self.root.update()
        self.assertEqual(self.app.step, 11)
        # prázdný projekt: odznak zmizí
        self.app.reset_project()
        self.app.update_badge()
        self.root.update()
        self.assertFalse(lbl.winfo_ismapped())

    def test_approval_and_commissioning_survive_redraw_and_reload(self):
        self.app.load_sample("small")
        self.app.settings["approver"] = "Jan Novák"
        self.app.prj = self.app.bridge.mutate("approve", self.app.prj, "io", "Jan Novák", "ok")
        self.app.prj = self.app.bridge.mutate("setCommissionResult", self.app.prj, "p1:24v", "nok",
                                              "Jan Novák", {"measured": "22 V"})
        self.app.ui["com"] = {"filter": "nok", "sel": "p1:24v"}
        for _round in range(2):
            self.goto(12)
            self.app.render()
            self.root.update()
            tv = self.table().tv
            self.assertEqual(tv.selection(), ("p1:24v",))
            self.assertEqual(tv.set("p1:24v", "meas"), "22 V")
            radio = next(r for r in self.find(ttk.Radiobutton) if str(r.cget("text")).startswith("nevyhovuje"))
            self.assertEqual(str(radio.cget("value")), radio.getvar(str(radio.cget("variable"))))
        self.app.ui["appr"] = {"sel": "io", "tab": 0}
        self.goto(11)
        self.assertEqual(self.table().tv.selection(), ("io",))
        # uložení a nové načtení projektu (stav aplikace) — záznamy zůstanou, neplatné ne
        self.app._flush()
        saved = json.loads((self.app.home / "state.json").read_text(encoding="utf-8"))["prj"]
        saved["approvals"]["bad"] = {"state": "maybe", "by": "X", "at": "", "hash": ""}
        saved["approvals"]["noname"] = {"state": "approved", "by": " ", "at": "", "hash": "1"}
        saved["commissioning"]["bad"] = {"result": "perfect", "by": "X", "at": ""}
        self.app.set_project(saved, self.app.ai)
        self.assertEqual(set(self.app.prj["approvals"]), {"io"})
        self.assertEqual(self.app.prj["approvals"]["io"]["note"], "ok")
        self.assertEqual(self.app.prj["commissioning"]["p1:24v"]["measured"], "22 V")
        self.assertNotIn("bad", self.app.prj["commissioning"])

    # --- krok Bezpečnost ------------------------------------------------------------------

    def safety_widget(self, cls, attr, value=None):
        """Prvek kroku Bezpečnost podle značky (``_key`` pole, ``_approve_key`` tlačítka…)."""
        for w in walk(self.app.view):
            if isinstance(w, cls) and hasattr(w, attr) and (value is None or getattr(w, attr) == value):
                return w
        self.fail(f"{cls.__name__} s {attr}={value!r} není na obrazovce")

    def test_safety_step_links_to_approval(self):
        """Bezpečnostní modul je zapnutý: položky safety:SFn ve schválení, zástupná položka ne."""
        self.app.load_sample("small")
        self.app.ui["safety"] = {"sel": "estop"}
        self.goto(10)
        texts = self.ui_texts()
        self.assertTrue(any(t.startswith("SF1 — Nouzové zastavení") for t in texts), texts[:40])
        self.assertTrue(any("ověř v SISTEMA" in t for t in texts), "výhrada k výpočtu PL")
        self.assertFalse(any("se připravuje" in t for t in texts))
        self.click("Ve Schválení →")
        self.assertEqual(self.app.step, 11)
        self.assertEqual(self.table().tv.selection(), ("safety:SF1",))
        keys = {it["key"] for it in self.app.bridge.request("approval", prj=self.app.prj)["items"]}
        self.assertNotIn("safety:external", keys)
        self.assertTrue({"safety:hazards", "safety:SF1", "safety:SF1:design", "safety:program"} <= keys)

    def test_safety_step_edit_approve_and_program(self):
        """Editace S/F/P mění PLr, schválení funkce v kroku, program pending → draft → approved."""
        self.app.load_sample("small")
        self.app.settings["approver"] = ""
        self.app.ui["safety"] = {"sel": "estop"}
        self.goto(10)
        plr = self.safety_widget(tk.Label, "_plr")
        self.assertEqual(plr._plr, "d", "E-stop: S2/F1/P2 → PLr d")
        self.assertEqual(self.safety_widget(tk.Label, "_state")._state, "pending")
        b_ok = self.safety_widget(ttk.Button, "_approve_key", "safety:SF1")
        self.assertTrue(b_ok.instate(["disabled"]), "bez jména nejde schválit")

        # S2 → S1: graf dá PL b, ale ISO 13850 drží spodní mez PL c (živý přepočet)
        cb = self.safety_widget(ttk.Combobox, "_key", "S")
        cb.set(next(v for v in cb.cget("values") if str(v).startswith("S1")))
        cb.event_generate("<<ComboboxSelected>>")
        self.root.update()
        self.assertEqual(self.app.prj["safety"]["fn"]["estop"]["S"], "S1")
        self.assertEqual(self.safety_widget(tk.Label, "_plr")._plr, "c")
        self.assertEqual(self.table().tv.set("estop", "plr"), "c")

        # snížení PLr se zdůvodněním (pole se zapíše po Enter)
        ent = self.safety_widget(ttk.Entry, "_key", "reduce")
        ent.insert(0, "nízká pravděpodobnost výskytu")
        self.key(ent, "<Return>")
        self.root.update()
        self.assertEqual(self.app.prj["safety"]["fn"]["estop"]["reduce"], "nízká pravděpodobnost výskytu")
        self.assertEqual(self.safety_widget(tk.Label, "_plr")._plr, "c", "spodní mez normy platí i po snížení")

        # vrátit návrh aplikace
        self.click("Vrátit návrh aplikace")
        self.assertNotIn("safety", self.app.prj)
        self.assertEqual(self.safety_widget(tk.Label, "_plr")._plr, "d")

        # schválení funkce přímo v kroku (se jménem)
        self.app.settings["approver"] = "Jan Novák"
        self.goto(10)
        b_ok = self.safety_widget(ttk.Button, "_approve_key", "safety:SF1")
        self.assertTrue(b_ok.instate(["!disabled"]))
        b_ok.invoke()
        self.root.update()
        rec = self.app.prj["approvals"]["safety:SF1"]
        self.assertEqual((rec["state"], rec["by"]), ("approved", "Jan Novák"))
        self.assertEqual(self.table().tv.set("estop", "fn"), "schváleno")
        # změna po schválení → „změněno po schválení“
        cb = self.safety_widget(ttk.Combobox, "_key", "P")
        cb.set(next(v for v in cb.cget("values") if str(v).startswith("P1")))
        cb.event_generate("<<ComboboxSelected>>")
        self.root.update()
        self.assertEqual(self.table().tv.set("estop", "fn"), "změněno po schválení")
        self.click("Vrátit návrh aplikace")

        # program: pending → po schválení všech funkcí draft (NESCHVÁLENO) → approved
        self.assertEqual(self.safety_widget(tk.Label, "_state")._state, "pending")
        with mock.patch("plc_studio.steps.bezpecnost.messagebox.askyesno", return_value=True):
            self.click(next(str(b.cget("text")) for b in self.find(ttk.Button)
                            if str(b.cget("text")).startswith("Schválit vše připravené")))
        self.assertEqual(self.safety_widget(tk.Label, "_state")._state, "draft")
        texts = self.ui_texts()
        self.assertTrue(any("NESCHVÁLENO" in t for t in texts))
        prog = self.safety_widget(ttk.Button, "_approve_key", "safety:program")
        self.assertTrue(prog.instate(["!disabled"]))
        prog.invoke()
        self.root.update()
        self.assertEqual(self.safety_widget(tk.Label, "_state")._state, "approved")
        self.assertEqual(self.app.prj["approvals"]["safety:program"]["state"], "approved")
        # uložení souboru programu
        nb = self.find(ttk.Notebook)[0]
        nb.select(3)
        self.root.update()
        with mock.patch("plc_studio.steps.bezpecnost.save_file") as sf:
            self.click("Uložit soubor…")
        name, body = sf.call_args[0][1:3]
        self.assertTrue(name.endswith("safety_Konfigurace_relay.md"))
        self.assertIn("SCHVÁLENO", body)
        # výkres okruhu je na plátně
        nb.select(4)
        self.root.update()
        self.assertTrue(self.find(SvgView))

    def test_safety_step_distance_and_custom_function(self):
        """Doběh → bezpečná vzdálenost; vlastní funkce se přidá a odebere."""
        self.app.load_sample("small")
        self.app.ui["safety"] = {"sel": "guard:S2"}
        self.goto(10)
        ent = self.safety_widget(ttk.Entry, "_key", "DGT")
        ent.insert(0, "850")
        self.key(ent, "<Return>")
        self.root.update()
        lbl = self.safety_widget(ttk.Label, "_S")
        self.assertIsNone(lbl._S, "bez změřeného doběhu se S nepočítá")
        ent = self.safety_widget(ttk.Entry, "_key", "tStopMs")
        ent.insert(0, "200")
        self.key(ent, "<Return>")
        self.root.update()
        # S = 1600 · (0,2 + 0,015 + 0,02) + 850 = 1226 mm
        self.assertEqual(self.safety_widget(ttk.Label, "_S")._S, 1226)
        self.assertEqual(self.app.prj["safety"]["fn"]["guard:S2"]["tStopMs"], 200)
        # vlastní funkce
        self.click("Přidat funkci")
        add = self.app.prj["safety"]["add"]
        self.assertEqual(len(add), 1)
        ref = add[0]["ref"]
        self.assertEqual(self.app.ui["safety"]["sel"], ref)
        self.assertIn(ref, self.table().tv.get_children())
        with mock.patch("plc_studio.steps.bezpecnost.messagebox.askyesno", return_value=True):
            self.click("Odebrat funkci")
        self.assertNotIn("add", self.app.prj.get("safety", {}))
        # nastavení: vydání ISO 13855 a provozní hodiny
        cb = self.safety_widget(ttk.Combobox, "_key", "iso13855")
        cb.set(cb.cget("values")[1])
        cb.event_generate("<<ComboboxSelected>>")
        self.root.update()
        self.assertEqual(self.app.prj["safety"]["iso13855"], "2024")
        # neplatná data v uloženém projektu se zahodí
        saved = json.loads(json.dumps(self.app.prj))
        saved["safety"]["fn"]["guard:S2"]["S"] = "S9"
        saved["safety"]["hop"] = "hodně"
        self.app.set_project(saved, self.app.ai)
        self.assertNotIn("S", self.app.prj["safety"]["fn"]["guard:S2"])
        self.assertNotIn("hop", self.app.prj["safety"])
        self.assertEqual(self.app.prj["safety"]["fn"]["guard:S2"]["tStopMs"], 200)

    def test_step_bar_fits_small_window_in_german(self):
        """13 kroků + Nápověda se vejde do 1100 px i v němčině — nic není useknuté."""
        geo = self.root.geometry()
        try:
            self.app.set_language("de")
            for size in ("1100x700", "1400x900"):
                self.root.geometry(size)
                for step in (0, 12):
                    self.goto(step)
                    self.root.update()
                    nav = self.app._nav
                    right = max(b.winfo_x() + b.winfo_width() for b in self.app._step_btns)
                    self.assertLess(right, self.app._help_btn.winfo_x(), size)
                    help_ = self.app._help_btn
                    self.assertGreaterEqual(help_.winfo_width(), help_.winfo_reqwidth())
                    self.assertLessEqual(help_.winfo_x() + help_.winfo_width(), nav.winfo_width())
                    for b in self.app._step_btns:
                        self.assertGreaterEqual(b.winfo_width(), b.winfo_reqwidth(), b.cget("text"))
                    cur = self.app._step_btns[step]
                    self.assertIn(self.app._step_text(step, None).split(" · ")[-1], str(cur.cget("text")),
                                  "aktuální krok má celý název")
        finally:
            self.app.set_language("cs")
            self.root.geometry(geo)
            self.root.update()

    def test_new_steps_are_translated(self):
        czech = set("ěščřžůďťňĚŠČŘŽŮĎŤŇ")
        try:
            for lang in ("en", "de"):
                self.app.set_language(lang)
                self.app.load_sample("small")
                self.app.settings["approver"] = "Jan Novak"
                self.app.prj = self.app.bridge.mutate("approve", self.app.prj, "io", "Jan Novak")
                seen = []
                for step in (10, 11, 12):
                    self.goto(step)
                    if step == 11:
                        nb = self.find(ttk.Notebook)[0]
                        for tab in nb.tabs():
                            nb.select(tab)
                            self.root.update()
                            seen += self.ui_texts()
                    seen += self.ui_texts()
                self.app.update_badge()
                seen.append(str(self.app._badge_lbl.cget("text")))
                content = {d["desc"] for d in self.app.prj["devices"]} | set(self.app.LANGS.values())
                content |= {e["cmt"] for e in self.app.prj["io"]} | {self.app.prj["meta"]["name"]}
                bad = sorted({t for t in seen if czech & set(t)
                              and not any(c and c in t for c in content)})
                self.assertEqual(bad[:5], [], f"{lang}: nepřeložené texty")
        finally:
            self.app.set_language("cs")
            self.root.update()


if __name__ == "__main__":
    unittest.main()
