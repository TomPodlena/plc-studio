"""Testy fáze 3A (desktop): HMI, emulace kódu, exporty SISTEMA / EPLAN v kroku Generovat,
kontrola aktualizací (síť je nahrazená), ořezávání textu v tabulkách s „…“ a tvary podle čísla.

Spuštění (z apps/desktop):  python -m unittest tests.test_ui3a -v
"""

from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
import zipfile
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("PLCSTUDIO_HOME", tempfile.mkdtemp(prefix="plcstudio_test3a_"))

import tkinter as tk  # noqa: E402
from tkinter import ttk  # noqa: E402

from plc_studio import __version__, i18n, updates  # noqa: E402
from plc_studio.app import App  # noqa: E402
from plc_studio.bridge import CoreBridge, find_node  # noqa: E402
from plc_studio.detail import DevicePanel  # noqa: E402
from plc_studio.svgview import SvgView, parse_svg  # noqa: E402
from plc_studio.widgets import Table  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
EMU_DOC = "15_emulace_prekladu.md"


def walk(widget):
    for w in widget.winfo_children():
        yield w
        yield from walk(w)


# ------------------------------------------------------------------ tvary podle čísla

class PluralTest(unittest.TestCase):
    def tearDown(self):
        i18n.set_catalog("cs", {})

    def test_czech_forms(self):
        i18n.set_catalog("cs", {})
        key = "{n} soubor|{n} soubory|{n} souborů"
        self.assertEqual([i18n._n(n, key) for n in (0, 1, 2, 4, 5, 11, 22)],
                         ["0 souborů", "1 soubor", "2 soubory", "4 soubory", "5 souborů", "11 souborů",
                          "22 souborů"])
        self.assertEqual(i18n._n(1, "z {n} souboru.|ze {n} souborů.|z {n} souborů."), "z 1 souboru.")
        self.assertEqual(i18n._n(3, "z {n} souboru.|ze {n} souborů.|z {n} souborů."), "ze 3 souborů.")
        self.assertEqual(i18n._n(1.5, key), "1.5 souborů")       # desetinné = poslední tvar

    def test_other_languages(self):
        key = "{n} platforma|{n} platformy|{n} platforem"
        i18n.set_catalog("en", {key: "{n} platform|{n} platforms"})
        self.assertEqual([i18n._n(n, key) for n in (0, 1, 3, 8)],
                         ["0 platforms", "1 platform", "3 platforms", "8 platforms"])
        i18n.set_catalog("zh", {key: "{n} 个平台"})
        self.assertEqual(i18n._n(5, key), "5 个平台")
        i18n.set_catalog("de", {})                           # bez překladu = české tvary, nespadne
        self.assertEqual(i18n._n(5, key), "5 platformy")

    def test_catalog_has_all_forms(self):
        """Každý klíč s tvary má v katalozích tolik tvarů, kolik jazyk potřebuje (2 / 1)."""
        b = CoreBridge()
        try:
            for lang, need in (("en", 2), ("de", 2), ("es", 2), ("zh", 1)):
                cat = b.request("init", lang=lang)["I18N"]
                keys = [k for k in cat if k.count("|") == 2 and "{n}" in k]
                self.assertGreater(len(keys), 5)
                for k in keys:
                    self.assertEqual(len(cat[k].split("|")), need, f"{lang}: {k} → {cat[k]}")
        finally:
            b.close()

    @unittest.skipUnless(find_node(), "bez Node.js")
    def test_web_plural_matches_desktop(self):
        """Web (plural.js, trn) vybírá tvar stejně jako desktop."""
        script = ("import { trn, pluralIndex } from './apps/web/src/plural.js';"
                  "import { setLang } from './packages/core/dist/index.js';"
                  "const out = {};"
                  "for (const l of ['cs','en','zh']) { setLang(l); out[l] = [0,1,2,5].map(n => pluralIndex(n)); }"
                  "setLang('en'); out.en1 = trn(1, '{n} platforma|{n} platformy|{n} platforem');"
                  "out.en3 = trn(3, '{n} platforma|{n} platformy|{n} platforem');"
                  "setLang('cs'); out.cs2 = trn(2, '{n} platforma|{n} platformy|{n} platforem');"
                  "console.log(JSON.stringify(out));")
        res = subprocess.run([find_node(), "--input-type=module", "-e", script], cwd=ROOT,
                             capture_output=True, text=True, encoding="utf-8", timeout=60)
        self.assertEqual(res.returncode, 0, res.stderr)
        out = json.loads(res.stdout)
        self.assertEqual(out["cs"], [2, 0, 1, 2])
        self.assertEqual(out["en"], [1, 0, 1, 1])
        self.assertEqual(out["zh"], [0, 0, 0, 0])
        self.assertEqual((out["en1"], out["en3"], out["cs2"]), ("1 platform", "3 platforms", "2 platformy"))
        for lang in ("cs", "en", "zh"):
            self.assertEqual(out[lang], [i18n.plural_index(n, lang) for n in (0, 1, 2, 5)])


# ------------------------------------------------------------------ kontrola aktualizací

class UpdatesTest(unittest.TestCase):
    def test_versions(self):
        self.assertEqual(updates.parse_version("v0.10.2-beta"), (0, 10, 2))
        self.assertTrue(updates.is_newer("0.2.0", "0.1.0"))
        self.assertTrue(updates.is_newer("0.1.1", "0.1"))
        self.assertTrue(updates.is_newer("0.10.0", "0.9.9"))
        self.assertFalse(updates.is_newer("0.1.0", "0.1.0"))
        self.assertFalse(updates.is_newer("0.0.0", "0.1.0"))          # Worker bez verze
        self.assertFalse(updates.is_newer("nesmysl", "0.1.0"))
        self.assertTrue(updates.__version__ == __version__ and updates.parse_version(__version__))

    def test_single_url_constant(self):
        self.assertTrue(updates.CONFIG_URL.startswith(updates.UPDATE_BASE))
        self.assertTrue(updates.RELEASE_URL.startswith(updates.UPDATE_BASE))
        self.assertEqual(updates.download_page("cs"), updates.UPDATE_BASE + "/stazeni/")
        self.assertEqual(updates.download_page("de"), updates.UPDATE_BASE + "/de/stazeni/")
        self.assertEqual(updates.download_page("zh"), updates.UPDATE_BASE + "/en/stazeni/")

    def test_latest_release_with_mocked_network(self):
        calls = []

        def fetch_cfg_without_version(url):
            calls.append(url)
            if url == updates.CONFIG_URL:          # dnešní Worker: /api/config verzi nevrací
                return {"free_io_limit": 64, "site": "https://example.test", "payment_provider": None}
            return {"version": "0.2.0", "assets": {}}

        # cizí host ze serveru se nepoužije (forenzní test L1) — jen https na hostu UPDATE_BASE
        self.assertEqual(updates.latest_release(fetch_cfg_without_version),
                         {"version": "0.2.0", "site": updates.UPDATE_BASE})
        self.assertEqual(calls, [updates.CONFIG_URL, updates.RELEASE_URL])

        calls.clear()
        self.assertEqual(updates.latest_release(lambda u: calls.append(u) or {"version": "0.3.1"}),
                         {"version": "0.3.1", "site": updates.UPDATE_BASE})
        self.assertEqual(calls, [updates.CONFIG_URL])     # verze z /api/config — manifest netřeba

        def offline(url):
            raise OSError("bez sítě")

        self.assertIsNone(updates.latest_release(offline))
        self.assertIsNone(updates.latest_release(lambda u: {"version": "0.0.0"} if u == updates.RELEASE_URL else {}))

    def test_server_site_and_version_are_checked(self):
        """Forenzní test L1: ``site`` ze serveru jen https na očekávaném hostu, obří verze nic neshodí."""
        base = updates.UPDATE_BASE
        for bad in ("javascript:alert(1)", "file:///C:/Windows/System32/calc.exe#", "http://" + base[8:],
                    "https://evil.example", "https://user@" + base[8:], "https://" + base[8:] + ":99999", None, 5):
            self.assertEqual(updates.safe_site(bad), base, bad)
        self.assertEqual(updates.safe_site(base + "/cs/"), base)
        self.assertEqual(updates.parse_version("9" * 5000), ())
        self.assertFalse(updates.is_newer("1" * 5000))
        self.assertIsNone(updates.latest_release(lambda u: {"version": "9" * 5000}))
        self.assertEqual(updates.latest_release(lambda u: {"version": "1.2.3", "site": "javascript:x"}),
                         {"version": "1.2.3", "site": base})

    def test_due_once_a_day_and_switch(self):
        now = 1_000_000.0
        self.assertTrue(updates.due({}, now))
        self.assertFalse(updates.due({"update_check": False}, now))
        self.assertFalse(updates.due({"update_checked_at": now - 3600}, now))
        self.assertTrue(updates.due({"update_checked_at": now - 25 * 3600}, now))
        self.assertTrue(updates.due({"update_checked_at": now + 3600}, now))    # posunuté hodiny


class UpdatesGuiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = tk.Tk()
        cls.app = App(cls.root)
        cls.root.update()

    @classmethod
    def tearDownClass(cls):
        cls.app.close()

    def wait(self, cond, timeout=5.0):
        end = time.time() + timeout
        while time.time() < end and not cond():
            self.root.update()
            time.sleep(0.05)
        self.root.update()

    def setUp(self):
        for k in ("update_checked_at", "update_dismissed", "update_check"):
            self.app.settings.pop(k, None)
        bar = getattr(self.app, "_update_bar", None)
        if bar is not None and bar.winfo_exists():
            bar.destroy()

    def test_notice_in_footer_and_dismiss(self):
        newer = updates.parse_version(__version__)
        remote = ".".join(str(x) for x in (*newer[:-1], newer[-1] + 1))
        with mock.patch("webbrowser.open") as wb:
            self.assertTrue(updates.start_check(self.app, fetch=lambda u: {"version": remote}))
            self.wait(lambda: getattr(self.app, "_update_bar", None) is not None)
            bar = self.app._update_bar
            self.assertTrue(bar.winfo_exists())
            texts = " ".join(str(w.cget("text")) for w in walk(bar))
            self.assertIn(remote, texts)
            self.assertIn(__version__, texts)
            links = [w for w in walk(bar) if hasattr(w, "invoke")]
            links[0].invoke()
            wb.assert_called_once()
            self.assertIn("/stazeni/", wb.call_args[0][0])
            links[1].invoke()                                # Skrýt → verze se zapamatuje
        self.assertEqual(self.app.settings["update_dismissed"], remote)
        self.assertFalse(bar.winfo_exists())
        self.assertIsInstance(self.app.settings["update_checked_at"], float)
        # tentýž den se znovu nekontroluje; skrytá verze se znovu neukáže
        self.assertFalse(updates.start_check(self.app, fetch=lambda u: {"version": remote}))
        self.app.settings.pop("update_checked_at")
        self.assertTrue(updates.start_check(self.app, fetch=lambda u: {"version": remote}))
        self.wait(lambda: False, 0.8)
        self.assertFalse(self.app._update_bar.winfo_exists())

    def test_offline_and_same_version_silent(self):
        def offline(url):
            raise OSError("bez sítě")

        for fetch in (offline, lambda u: {"version": __version__}):
            self.app.settings.pop("update_checked_at", None)
            self.app._update_bar = None
            done = []
            self.assertTrue(updates.start_check(self.app, fetch=fetch, on_done=lambda n, i: done.append((n, i))))
            self.wait(lambda: bool(done))
            self.assertEqual(done[0][0], None)
            self.assertIsNone(self.app._update_bar)
        self.app.settings["update_check"] = False
        self.app.settings.pop("update_checked_at", None)
        self.assertFalse(updates.start_check(self.app, fetch=offline))     # vypnuto v nastavení

    def test_about_bar_in_help(self):
        self.app.goto("help")
        self.root.update()
        checks = [w for w in walk(self.app.view) if isinstance(w, ttk.Checkbutton)]
        self.assertTrue(any("aktualizace" in str(w.cget("text")) for w in checks))
        chk = next(w for w in checks if "aktualizace" in str(w.cget("text")))
        chk.invoke()
        self.assertIs(self.app.settings["update_check"], False)
        chk.invoke()
        self.assertIs(self.app.settings["update_check"], True)
        labels = " ".join(str(w.cget("text")) for w in walk(self.app.view) if isinstance(w, ttk.Label))
        self.assertIn(__version__, labels)


# ------------------------------------------------------------------ most: HMI, emulace, exporty

class BridgeOutputsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.b = CoreBridge()
        cls.b.request("init")

    @classmethod
    def tearDownClass(cls):
        cls.b.close()

    def prj(self, plats=("siemens",)):
        p = self.b.call("sampleSmall")
        p["platforms"] = list(plats)
        return self.b.mutate("syncIO", p)

    def test_hmi_screens_tags_and_specs(self):
        p = self.prj()
        d = self.b.request("hmi", prj=p)
        self.assertGreaterEqual(len(d["screens"]), 4)
        ids = {dev["id"] for dev in p["devices"]}
        doc = parse_svg(d["screens"][0]["svg"])
        devs = {m["dev"] for m in doc["metas"] if "dev" in m}
        self.assertTrue(devs and devs <= ids, devs)            # data-dev = id zařízení (klik → panel)
        self.assertIn('data-dev="', d["screens"][0]["raw"])    # surové SVG ke stažení beze změny
        self.assertTrue(any(it[0] == "poly" for s in d["screens"] for it in parse_svg(s["svg"])["items"]))
        t = d["tags"][0]
        self.assertEqual(set(t["paths"]), set(self.b.request("init")["PLAT"]))
        self.assertIsNone(d["specs"]["unitronics"])
        self.assertTrue(all(f["status"] in ("unverified", "reference", "stub") for s in d["specs"].values() if s
                            for f in s["files"]))
        self.assertTrue(d["alarms"] and d["alarms"][0]["clsLabel"])

    def test_hmi_files_and_siemens_workbook(self):
        p = self.prj()
        r = self.b.request("hmi.files", prj=p, plat="siemens")
        self.assertIn("HMI_Tags_Openness.xml", r["files"])
        data = base64.b64decode(r["xlsx"])
        with zipfile.ZipFile(BytesIO(data)) as z:
            names = z.namelist()
        self.assertIn("xl/workbook.xml", names)
        self.assertEqual(r["xlsxName"], "hmi_siemens.xlsx")
        self.assertIsNone(self.b.request("hmi.files", prj=p, plat="rockwell")["xlsx"])
        self.assertEqual(self.b.request("hmi.files", prj=p, plat="unitronics")["files"], {})
        html = self.b.request("hmi.web", prj=p)["html"]
        self.assertIn("<svg", html)

    def test_files_include_hmi_documents(self):
        names = [f["name"] for f in self.b.request("files", prj=self.prj())["files"]]
        self.assertIn("16_hmi.md", names)
        self.assertIn("hmi_web.html", names)

    def test_emulation_document_only_after_run_and_for_same_project(self):
        p = self.prj(("siemens", "codesys"))
        names = lambda prj: [f["name"] for f in self.b.request("files", prj=prj)["files"]]   # noqa: E731
        self.assertNotIn(EMU_DOC, names(p))                   # bez emulace dokument není
        r = self.b.request("emu.platform", prj=p, plat="siemens")
        self.assertTrue(r["compile"]["ok"] and r["run"]["ok"], r["compile"]["findings"][:3])
        self.assertIn("Gen_Main.scl", r["files"])
        self.assertTrue(r["label"].startswith("Siemens"))
        fin = self.b.request("emu.finish", prj=p, plats=["siemens"])
        self.assertFalse(fin["doc"])                          # codesys neověřen → dokument ne
        self.assertNotIn(EMU_DOC, names(p))
        self.b.request("emu.platform", prj=p, plat="codesys")
        self.assertTrue(self.b.request("emu.finish", prj=p, plats=["siemens", "codesys"])["doc"])
        t0 = time.time()
        files = self.b.request("files", prj=p)["files"]
        doc = next(f for f in files if f["name"] == EMU_DOC)
        self.assertIn("NENÍ překladač výrobce", doc["body"])
        self.assertLess(time.time() - t0, 30)
        changed = {**p, "meta": {**p["meta"], "name": "Jiný stroj"}}
        self.assertNotIn(EMU_DOC, names(changed))             # změna projektu → dokument pryč
        self.assertFalse(self.b.request("emu.state", prj=p)["doc"])
        rules = self.b.request("emu.rules")
        self.assertIn("undeclared", rules)

    def test_exports(self):
        p = self.b.call("sampleComplex")
        p = self.b.mutate("syncIO", p)
        d = self.b.request("exports", prj=p)
        self.assertTrue(d["sistema"]["fns"] > 0)
        self.assertTrue(any(f["name"].endswith(".ssm") for f in d["sistema"]["files"]))
        self.assertTrue(d["sistema"]["doc"]["body"].startswith("#"))
        self.assertIn("SISTEMA", d["sistema"]["verified"])
        names = [f["name"] for f in d["eplan"]["files"]]
        self.assertIn("README_EPLAN.txt", names)
        self.assertIn("PLCdesk_ImportAML.cs", names)
        self.assertTrue(any(n.endswith(".aml") for n in names))
        self.assertIn("EPLAN", d["eplan"]["verified"])
        self.assertTrue(all(f["save"].startswith("eplan_") for f in d["eplan"]["files"]))
        empty = self.b.request("exports", prj=self.b.call("blankProject"))
        self.assertEqual(empty["eplan"]["files"], [])
        self.assertEqual(empty["sistema"]["fns"], 0)


# ------------------------------------------------------------------ GUI

class GuiOutputsTest(unittest.TestCase):
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

    def tearDown(self):
        self.assertEqual(self.app.errors, [], "callback okna skončil chybou")

    def gen_tab(self, i):
        self.app.ui["gen_tab"] = i
        self.app.goto(7)
        self.root.update()
        nb = self.app.gen_notebook
        self.assertEqual(nb.index("current"), i)
        return nb.nametowidget(nb.select())

    def find(self, cls, parent):
        return [w for w in walk(parent) if isinstance(w, cls)]

    def test_subtitle_counts_selected_platforms(self):
        self.app.render()
        self.assertTrue(str(self.app._sub_lbl.cget("text")).endswith("· 2 platformy"))
        self.app.prj["platforms"] = ["siemens"]
        self.app.render()
        self.assertTrue(str(self.app._sub_lbl.cget("text")).endswith("· 1 platforma"))
        self.app.prj["platforms"] = list(self.app.PLAT)[:5]
        self.app.render()
        self.assertTrue(str(self.app._sub_lbl.cget("text")).endswith("· 5 platforem"))

    def test_gen_tabs_and_code_tab(self):
        frame = self.gen_tab(0)
        self.assertTrue(any(str(b.cget("text")) == "Uložit zobrazený soubor…" for b in self.find(ttk.Button, frame)))
        nb = self.app.gen_notebook
        self.assertEqual([str(nb.tab(t, "text")) for t in nb.tabs()], ["Kód", "HMI", "Emulace kódu", "SISTEMA a EPLAN"])
        nb.select(3)
        self.root.update()
        self.assertEqual(self.app.ui["gen_tab"], 3)          # záložka se pamatuje
        self.assertTrue(self.find(ttk.Notebook, nb.nametowidget(nb.select())))

    def test_hmi_preview_click_opens_device_panel(self):
        frame = self.gen_tab(1)
        sub = frame.hmi_notebook
        screens = sub.nametowidget(sub.tabs()[0])
        view, panel = screens.svg_view, screens.panel
        self.assertIsInstance(view, SvgView)
        self.assertIsInstance(panel, DevicePanel)
        meta = next(m for m in view.metas() if "dev" in m)
        view.on_click(meta)
        self.root.update()
        self.assertEqual(panel.dev_id, meta["dev"])
        dev = self.app.dev_by_id(meta["dev"])
        texts = [str(w.cget("text")) for w in walk(panel.body) if isinstance(w, (ttk.Label, tk.Label))]
        self.assertTrue(any(dev["name"] in t for t in texts))
        self.assertEqual(self.app.ui["hmi"]["dev"], meta["dev"])
        # obrazovky se přepínají
        radios = self.find(ttk.Radiobutton, screens)
        self.assertGreaterEqual(len(radios), 4)
        radios[1].invoke()
        self.root.update()
        self.assertEqual(self.app.ui["hmi"]["screen"], 1)

    def test_hmi_tags_alarms_and_export(self):
        frame = self.gen_tab(1)
        sub = frame.hmi_notebook
        tags = sub.nametowidget(sub.tabs()[1])
        self.assertGreater(len(tags.table.tv.get_children()), 10)
        box = tags.plat_box
        box.current(box.plats.index("rockwell"))
        box.event_generate("<<ComboboxSelected>>")
        self.root.update()
        paths = [tags.table.full(i, "path") for i in tags.table.tv.get_children()]
        self.assertTrue(any(p.startswith("Program:") for p in paths))
        alarms = sub.nametowidget(sub.tabs()[2])
        self.assertTrue(alarms.table.tv.get_children())
        export = sub.nametowidget(sub.tabs()[3])
        st = export.state
        self.assertEqual(st["plat"], "siemens")
        rows = st["table"].tv.get_children()
        self.assertIn("hmi_siemens.xlsx", rows)
        self.assertIn("neověřeno importem", [st["table"].full(r, "status") for r in rows])
        # uložení sešitu .xlsx binárně
        out = Path(tempfile.mkdtemp(prefix="hmi_xlsx_")) / "hmi_siemens.xlsx"
        st["table"].select("hmi_siemens.xlsx")
        self.root.update()
        with mock.patch("tkinter.filedialog.asksaveasfilename", return_value=str(out)):
            next(b for b in self.find(ttk.Button, export) if str(b.cget("text")) == "Uložit vybraný soubor…").invoke()
        self.assertTrue(zipfile.is_zipfile(out))
        # všechny soubory do složky (i sešit)
        folder = tempfile.mkdtemp(prefix="hmi_all_")
        with mock.patch("tkinter.filedialog.askdirectory", return_value=folder):
            next(b for b in self.find(ttk.Button, export) if str(b.cget("text")) == "Uložit všechny soubory exportu…").invoke()
        saved = sorted(os.listdir(folder))
        self.assertIn("hmi_siemens.xlsx", saved)
        self.assertIn("hmi_siemens_HMI_Tags_Openness.xml", saved)
        # Unitronics: bez exportu, upozornění
        box = export.plat_box
        box.current(box.plats.index("unitronics"))
        box.event_generate("<<ComboboxSelected>>")
        self.root.update()
        self.assertIsNone(export.state["table"])

    def test_web_hmi_opens_in_browser(self):
        self.gen_tab(1)
        with mock.patch("webbrowser.open") as wb:
            btn = next(b for b in self.find(ttk.Button, self.app.view) if str(b.cget("text")) == "Otevřít webové HMI")
            btn.invoke()
        url = wb.call_args[0][0]
        self.assertTrue(url.startswith("file:"))
        path = Path(self.app.home) / "hmi" / "hmi_web.html"
        self.assertIn("<svg", path.read_text(encoding="utf-8"))

    def test_emulation_results_preview_and_stale(self):
        frame = self.gen_tab(2)
        self.assertIn("NENÍ překladač výrobce", " ".join(str(w.cget("text")) for w in walk(frame.warning)))
        progress = []
        with mock.patch.object(self.app.root, "update", side_effect=lambda: progress.append(1)):
            frame.start()
        self.assertGreaterEqual(len(progress), 2)              # průběh po platformách
        res = self.app.ui["emu"]
        self.assertEqual(res["plats"], ["siemens", "codesys"])
        self.assertTrue(res["doc"])
        self.root.update()
        frame = self.app.gen_notebook.nametowidget(self.app.gen_notebook.select())
        result = frame.result
        self.assertEqual(list(result.summary.tv.get_children()), ["siemens", "codesys"])
        detail = result.detail
        # náhled kódu se zvýrazněným řádkem (nález s polohou)
        f = {"file": "Gen_Main.scl", "line": 5, "col": 3, "rule": "undeclared", "msg": "x"}
        detail.show_code(f)
        self.assertEqual(detail.code.show_line, 5)
        self.assertTrue(detail.code.tag_ranges("hit"))
        self.assertIn("Gen_Main.scl:5:3", str(detail.code_label.cget("text")))
        # dokument 15 je v dokumentaci; po změně projektu zmizí a výsledek je zastaralý
        files = self.app.bridge.request("files", prj=self.app.prj)["files"]
        self.assertIn(EMU_DOC, [x["name"] for x in files])
        self.app.prj["meta"]["name"] = "Změněno po emulaci"
        frame = self.gen_tab(2)
        self.assertTrue(getattr(frame.result, "stale", False))
        files = self.app.bridge.request("files", prj=self.app.prj)["files"]
        self.assertNotIn(EMU_DOC, [x["name"] for x in files])

    def test_emulation_stop_between_platforms(self):
        frame = self.gen_tab(2)

        def stop_after_first():
            if self.app.ui.get("emu_run") and self.app.ui["emu_run"]["i"] == 1:
                frame.stop()

        with mock.patch.object(self.app.root, "update", side_effect=stop_after_first):
            frame.start()
        res = self.app.ui["emu"]
        self.assertTrue(res["stopped"])
        self.assertEqual(res["plats"], ["siemens"])
        self.assertFalse(res["doc"])

    def test_exports_tab(self):
        self.app.load_sample("complex")
        frame = self.gen_tab(3)
        left, right = frame.left, frame.right
        self.assertIn("neověřeno importem", str(left.verified.cget("text")))
        self.assertIn("neověřeno importem", str(right.verified.cget("text")))
        st, et = left.table, right.table
        self.assertEqual(st.full(st.tv.get_children()[0], "status"), "neověřeno importem")
        names = [et.full(i, "name") for i in et.tv.get_children()]
        self.assertIn("README_EPLAN.txt", names)
        s_txt, e_txt = frame.prev
        self.assertIn("EPLAN", e_txt.get("1.0", "end"))                 # README ukázaný hned
        self.assertTrue(s_txt.get("1.0", "end").startswith("#"))        # 19_sistema.md
        folder = tempfile.mkdtemp(prefix="eplan_")
        with mock.patch("tkinter.filedialog.askdirectory", return_value=folder):
            next(b for b in walk(right) if isinstance(b, ttk.Button)
                 and str(b.cget("text")) == "Uložit soubory pro EPLAN…").invoke()
        # původní jména jako v projektové složce 09_Exporty/EPLAN (README_EPLAN na ně odkazuje)
        self.assertIn("README_EPLAN.txt", os.listdir(folder))
        self.assertIn("PLCdesk_ImportAML.cs", os.listdir(folder))

    def test_import_wizard_plural_message(self):
        from plc_studio import importer
        self.app.ui.pop("import", None)
        wiz = importer.open_wizard(self.app)
        self.addCleanup(lambda: wiz.win.winfo_exists() and wiz.close())
        wiz.paste_text.insert("1.0", "Tag;Adresa;Zařízení;Třída;Komentář\nM7_outRun;%Q0.0;M7;Motor;Dopravník\n")
        self.assertTrue(wiz.extract())
        self.assertTrue(wiz.S["msg"][1].endswith("z 1 souboru."), wiz.S["msg"][1])


# ------------------------------------------------------------------ tabulka: zkrácení s „…“

class TableEllipsisTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = tk.Tk()
        cls.root.geometry("500x300")

    @classmethod
    def tearDownClass(cls):
        cls.root.destroy()

    def test_clip_full_text_tooltip_and_edit(self):
        long = "Blokování pohyblivého ochranného krytu se zámkem a sledováním polohy"
        edited = []
        tbl = Table(self.root, [("a", "A", 120, False), ("b", "B", 120, True)], tree=True,
                    ellipsis=True, editable=("b",), on_edit=lambda i, k, v: edited.append(v))
        tbl.pack(fill="both", expand=True)
        tbl.tv.column("#0", width=150)
        tbl.add("r1", ("krátké", long), text=long)
        self.root.update()
        tbl.tv.column("b", width=140)
        tbl.fit()
        shown_b, shown_0 = tbl.tv.set("r1", "b"), tbl.tv.item("r1", "text")
        self.assertTrue(shown_b.endswith("…") and len(shown_b) < len(long), shown_b)
        self.assertTrue(shown_0.endswith("…"), shown_0)
        self.assertFalse(shown_b[:-1].endswith(" "))                  # bez mezery před „…“
        self.assertEqual(tbl.tv.set("r1", "a"), "krátké")             # co se vejde, zůstává
        self.assertEqual(tbl.full("r1", "b"), long)
        self.assertEqual(tbl.full("r1", "#0"), long)
        # širší sloupec → víc textu
        tbl.tv.column("b", width=900)
        tbl.fit()
        self.assertEqual(tbl.tv.set("r1", "b"), long)
        tbl.tv.column("b", width=140)
        tbl.fit()
        # bublina s celým textem po najetí
        x, y, w, h = tbl.tv.bbox("r1", "b")
        ev = SimpleNamespace(x=x + 5, y=y + h // 2, x_root=100, y_root=100)
        tbl._on_motion(ev)
        self.assertIsNotNone(tbl._tip_job)
        end = time.time() + 2
        while tbl._tip is None and time.time() < end:
            self.root.update()
            time.sleep(0.05)
        self.assertEqual(tbl.tip_text, long)
        tbl._hide_tip()
        # úprava buňky nabídne celý text, ne zkrácený
        self.root.update()
        x, y, w, h = tbl.tv.bbox("r1", "b")             # po rozvržení se roztahovací sloupec posunul
        tbl._begin_edit(SimpleNamespace(x=x + 5, y=y + h // 2))
        self.assertEqual(tbl._editor.get(), long)
        tbl._editor.delete(0, "end")
        tbl._editor.insert(0, "nová hodnota")
        tbl._editor.focus_force()                       # bez fokusu Tk klávesu nedoručí
        self.root.update()
        tbl._editor.event_generate("<Return>")
        self.root.update()
        self.assertEqual(edited, ["nová hodnota"])
        # set_cell a clear
        tbl.set_cell("r1", "b", "jiný")
        self.assertEqual((tbl.tv.set("r1", "b"), tbl.full("r1", "b")), ("jiný", "jiný"))
        tbl.clear()
        self.assertEqual(tbl._full, {})
        tbl.destroy()

    def test_without_ellipsis_unchanged(self):
        tbl = Table(self.root, [("a", "A", 60, True)])
        tbl.add("x", ("velmi dlouhý text, který se nevejde",))
        self.assertEqual(tbl.tv.set("x", "a"), "velmi dlouhý text, který se nevejde")
        self.assertEqual(tbl.full("x", "a"), "velmi dlouhý text, který se nevejde")
        tbl.destroy()


if __name__ == "__main__":
    unittest.main()
