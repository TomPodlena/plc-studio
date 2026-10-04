"""Testy fáze 3B — revize, nabídka a firemní knihovna v desktopu (most + kroky GUI).

Spuštění (z apps/desktop):  python -m unittest tests.test_biz -v
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
os.environ.setdefault("PLCSTUDIO_HOME", tempfile.mkdtemp(prefix="plcstudio_biz_"))

import tkinter as tk  # noqa: E402
from tkinter import ttk  # noqa: E402

from plc_studio.app import App  # noqa: E402
from plc_studio.bridge import CoreBridge  # noqa: E402
from plc_studio.widgets import Table  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
CSV = REPO / "packages" / "core" / "test-data" / "quote" / "cenik_ukazka.csv"


def acme_lib(bridge: CoreBridge, broken: bool = False) -> dict:
    """Knihovna jako v library.test.ts: vlastní FB_Motor (ST), čerpadlo s díly kusovníku, schvalovatelé."""
    motor = bridge.call("builtinTemplate", "Motor", "st").replace("T#3S", "T#5S")
    lib = {
        "format": "plcdesk-library", "schema": 1, "name": "ACME standard", "version": "2.1.0", "updated": "2026-10-04",
        "company": {"name": "ACME Automation s.r.o.", "logoText": "ACME", "address": "Brno",
                    "approvers": [{"name": "Ing. Novák", "role": "vedoucí elektro"}, {"name": "Petr Dvořák"}]},
        "deviceTypes": [{"id": "PumpVfd", "label": "Čerpadlo s měničem", "cls": "Motor", "prefix": "P",
                         "opt": {"fbk": True, "fault": True}, "stepTimeS": 8,
                         "bom": [{"cat": "pump", "brand": "Grundfos", "type": "CR 5-4", "orderCode": "96516000"},
                                 {"cat": "vfd", "tagPrefix": "-U", "brand": "Danfoss", "type": "FC 51",
                                  "orderCode": "132F0018"}]},
                        {"id": "TempPt100", "label": "Teplota Pt100", "cls": "AnalogIn", "unit": "°C",
                         "rmin": 0, "rmax": 150, "limHi": 95}],
        "fbTemplates": [{"id": "AcmeMotor", "cls": "Motor", "dialect": "st", "source": motor}],
        "platformDefaults": {"platforms": ["codesys"], "bomPlat": "codesys"},
    }
    if broken:
        lib["deviceTypes"].append({"id": "pumpvfd", "label": "dup", "cls": "Motor"})
    return lib


class BizBridgeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.b = CoreBridge()
        cls.b.request("init", lang="cs")

    @classmethod
    def tearDownClass(cls):
        cls.b.close()

    def sample(self) -> dict:
        return self.b.mutate("syncIO", self.b.call("sampleSmall"))

    def test_revision_change_diff_retest(self):
        """Vydání revize → schválení → revize B → změna: rozdíl, zneplatněné schválení a rozsah zkoušek."""
        p = self.sample()
        with self.assertRaises(Exception):
            self.b.request("revision.create", prj=p, by="  ", note="")
        r = self.b.request("revision.create", prj=p, by="Jan Novák", note="první vydání")
        p = r["prj"]
        self.assertEqual(r["rec"]["id"], "A")
        self.assertEqual(self.b.request("revision.badge", prj=p)["label"], "A")
        items = {it["key"]: it for it in self.b.request("approval", prj=p)["items"]}
        p = self.b.mutate("approve", p, "seq", "Jan Novák", None)
        self.assertTrue(items["seq"])
        p = self.b.request("revision.create", prj=p, by="Jan Novák", note="schválená sekvence")["prj"]
        self.assertTrue(p["revisions"][1]["approvalsAt"]["seq"]["valid"])
        p["program"]["seq"][0]["timeS"] = 99
        p["devices"][0]["desc"] = "Jiný popis"
        badge = self.b.request("revision.badge", prj=p)
        self.assertEqual((badge["label"], badge["modified"]), ("B*", True))
        v = self.b.request("revision.view", prj=p)["view"]
        self.assertEqual((v["from"], v["to"], v["next"]), ("B", "current", "C"))
        d = v["diff"]
        classes = {c["cls"] for c in d["changes"]}
        self.assertTrue({"cosmetic", "functional"} <= classes, classes)
        self.assertIn("99", " ".join(c["detail"] for c in d["changes"]))
        self.assertIn("seq", [i["key"] for i in d["invalidates"]])
        self.assertEqual(next(i for i in d["invalidates"] if i["key"] == "seq")["by"], "Jan Novák")
        rt = v["retest"]
        self.assertTrue(rt["commissioning"] and rt["fat"] and rt["notes"])
        self.assertTrue(any(s["id"].startswith("seq:1:") for s in rt["commissioning"]))
        # A → B (jen schválení, obsah stejný) a výběr stejné revize na obou stranách
        v2 = self.b.request("revision.view", prj=p, **{"from": "A", "to": "B"})["view"]
        self.assertTrue(v2["diff"]["empty"])
        v3 = self.b.request("revision.view", prj=p, **{"from": "B", "to": "B"})["view"]
        self.assertEqual((v3["from"], v3["to"]), ("A", "B"))
        md = self.b.request("revision.md", prj=p)
        self.assertEqual(md["file"], "17_zmeny.md")
        self.assertIn("revize B", md["md"])
        self.assertIn("seq", self.b.request("revision.affected", prj=p)["invalid"])
        docs = [f["name"] for f in self.b.request("files", prj=p)["files"]]
        self.assertTrue(any("17_zmeny.md" in n for n in docs), docs[:5])

    def test_quote_import_and_totals(self):
        """Ceník z test-data → párování, varování, nepoužité řádky; součty = jádro; bez sazby bez ceny."""
        p = self.sample()
        v = self.b.request("quote.view", prj=p)["view"]
        self.assertTrue(all(m["match"] == "none" for m in v["material"]))
        self.assertFalse(v["totals"]["complete"])
        r = self.b.request("quote.import", prj=p, text=CSV.read_text(encoding="utf-8"))
        p = r["prj"]
        self.assertEqual(r["count"], 8)
        self.assertTrue(any("na dotaz" in w for w in r["warnings"]))
        for path, val in (("rates.prog", 950), ("rates.elec", 850), ("rates.comm", 1000), ("fx.EUR", 24.5),
                          ("marginPct", 10), ("params.hoursPerDevice.Motor", 2)):
            p = self.b.request("quote.set", prj=p, path=path, value=val)["prj"]
        self.assertEqual(p["quote"]["params"]["hoursPerDevice"]["Motor"], 2)
        v = self.b.request("quote.view", prj=p)["view"]
        self.assertEqual(len(v["unused"]), len([u for u in v["unused"] if u["row"]]))
        self.assertTrue(v["unused"])
        self.assertTrue(any(m["match"] == "code" for m in v["material"]))
        q = self.b.call("buildQuote", p)
        money = lambda x: self.b.call("fmtMoney", x, "CZK")  # noqa: E731
        t = v["totals"]
        self.assertEqual(t["gross"], money(q["totals"]["gross"]))
        self.assertEqual(t["net"], money(q["totals"]["net"]))
        self.assertAlmostEqual(q["totals"]["net"], q["totals"]["materialCost"] + q["totals"]["margin"] + q["totals"]["labor"], 2)
        self.assertAlmostEqual(q["totals"]["gross"], round(q["totals"]["net"] * 1.21, 2), 2)
        # sazba nezadána → práce bez ceny (nevymýšlí se)
        p = self.b.request("quote.set", prj=p, path="rates.elec", value=None)["prj"]
        v = self.b.request("quote.view", prj=p)["view"]
        self.assertTrue(any(u["kind"] == "labor" for u in v["unpriced"]))
        self.assertNotIn("elec", p["quote"]["rates"])
        f = self.b.request("quote.files", prj=p)
        self.assertIn("Celkem s DPH", f["csv"])
        self.assertEqual(f["mdName"], "18_nabidka.md")
        names = lambda pr: [x["name"] for x in self.b.request("files", prj=pr)["files"]]  # noqa: E731
        self.assertFalse(any("18_nabidka" in n for n in names(p)))
        p = self.b.request("quote.set", prj=p, path="inDocs", value=True)["prj"]
        self.assertTrue(any("18_nabidka" in n for n in names(p)))

    def test_library_load_validate_add(self):
        """Knihovna: načíst, ověřit (chyba = nejde připojit), připojit, přidat zařízení, schvalovatelé."""
        p = self.sample()
        bad = self.b.request("library.load", text="{nope")
        self.assertIsNone(bad["lib"])
        dup = self.b.request("library.load", text=json.dumps(acme_lib(self.b, broken=True)), prj=p)
        self.assertGreater(dup["view"]["errors"], 0)
        r = self.b.request("library.load", text=json.dumps(acme_lib(self.b)), prj=p)
        self.assertEqual(r["view"]["errors"], 0)
        self.assertEqual(len(r["view"]["deviceTypes"]), 2)
        self.assertEqual(r["view"]["fbTemplates"][0]["status"], "unverified")
        p = self.b.request("library.attach", prj=p, lib=r["lib"])["prj"]
        self.assertEqual(p["library"]["name"], "ACME standard")
        t = self.b.request("library.types", prj=p)
        self.assertEqual([x["id"] for x in t["types"]], ["PumpVfd", "TempPt100"])
        self.assertEqual(t["approvers"], ["Ing. Novák", "Petr Dvořák"])
        a = self.b.request("library.add", prj=p, typeId="PumpVfd")
        p = a["prj"]
        self.assertEqual(a["dev"]["name"], "P1")
        self.assertEqual(p["bom"]["lines"]["-U1:vfd"]["orderCode"], "132F0018")
        with self.assertRaises(Exception):
            self.b.request("library.add", prj=p, typeId="PumpVfd", name="p1")
        p["platforms"] = ["codesys", "siemens"]
        use = self.b.request("library.view", prj=p)["view"]["usage"]
        self.assertTrue(any(u["plat"] == "codesys" and u["used"] for u in use), use)
        saved = self.b.request("library.save", lib=p["library"])
        self.assertTrue(saved["name"].endswith(".plcdesk-library.json"))
        self.assertEqual(json.loads(saved["text"])["format"], "plcdesk-library")
        tpl = self.b.request("library.template")
        self.assertEqual(self.b.request("library.load", text=tpl["text"])["issues"][:0], [])
        self.assertIsNotNone(self.b.request("library.load", text=tpl["text"])["lib"])
        p = self.b.request("library.detach", prj=p)["prj"]
        self.assertNotIn("library", p)


def walk(widget):
    for w in widget.winfo_children():
        yield w
        yield from walk(w)


class BizGuiTest(unittest.TestCase):
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

    def goto(self, step):
        self.app.goto(step)
        self.root.update()

    def buttons(self, prefix):
        return [w for w in walk(self.app.view) if isinstance(w, ttk.Button) and str(w.cget("text")).startswith(prefix)]

    def tab_texts(self):
        return [str(nb.tab(t, "text")) for nb in walk(self.app.view) if isinstance(nb, ttk.Notebook) for t in nb.tabs()]

    def test_revision_tab_badge_and_approval_highlight(self):
        self.app.load_sample("small")
        self.app.settings["approver"] = "Jan Novák"
        self.goto(0)
        self.assertIn("Revize a změny", self.tab_texts())
        self.assertFalse(self.app._rev_lbl.winfo_ismapped())
        self.buttons("Vydat revizi A")[0].invoke()
        self.root.update()
        self.assertEqual(self.app.prj["revisions"][0]["id"], "A")
        self.assertEqual(str(self.app._rev_lbl.cget("text")), "Rev. A")
        self.app.prj = self.app.bridge.mutate("approve", self.app.prj, "seq", "Jan Novák", None)
        with mock.patch("plc_studio.steps.revize.messagebox.askyesno", return_value=True):
            self.app.render()
            self.root.update()
            self.buttons("Vydat revizi B")[0].invoke()
            self.root.update()
        self.app.prj["program"]["seq"][0]["timeS"] = 99
        self.app.render()
        self.root.update()
        self.assertEqual(str(self.app._rev_lbl.cget("text")), "Rev. B*")
        tabs = self.tab_texts()
        self.assertTrue(any(t.startswith("Změny (") and t != "Změny (0)" for t in tabs), tabs)
        self.assertTrue(any(t.startswith("Zneplatněná schválení (1") for t in tabs), tabs)
        tables = [w for w in walk(self.app.view) if isinstance(w, Table)]
        self.assertTrue(any(w.tv.exists("com:seq:dry") or any(c.startswith("com:") for g in w.tv.get_children()
                                                               for c in w.tv.get_children(g)) for w in tables))
        # proklik do Schválení: položka vybraná a podbarvená
        self.buttons("Otevřít krok Schválení")[0].invoke()
        self.root.update()
        self.assertEqual(self.app.step, 11)
        tv = next(w.tv for w in walk(self.app.view) if isinstance(w, Table) and w.tv.exists("seq"))
        self.assertIn("revchg", tv.item("seq", "tags"))
        self.assertEqual(tv.selection(), ("seq",))
        # odznak → krok Projekt
        self.app._rev_lbl.invoke()
        self.root.update()
        self.assertEqual(self.app.step, 0)

    def test_quote_tab(self):
        from plc_studio.steps import nabidka
        self.app.load_sample("small")
        self.app.prj.pop("quote", None)
        self.goto(9)
        self.assertIn("Nabídka", self.tab_texts())
        nabidka.import_file(self.app, CSV)
        self.app.ui.setdefault("bom", {})["tab"] = 2
        self.app.render()
        self.root.update()
        tabs = self.tab_texts()
        self.assertIn("Ceník (8)", tabs)
        tab = next(w for w in walk(self.app.view) if hasattr(w, "_entries"))
        e = tab._entries["rates.prog"]
        e._var.set("950")
        tab._commit("rates.prog", e)          # = Enter / opuštění pole
        self.root.update()
        self.assertEqual(self.app.prj["quote"]["rates"]["prog"], 950)
        tab = next(w for w in walk(self.app.view) if hasattr(w, "_entries"))
        tab._params._commit("p:hoursBase", "12,5")
        self.root.update()
        self.assertEqual(self.app.prj["quote"]["params"]["hoursBase"], 12.5)
        texts = [str(w.cget("text")) for w in walk(self.app.view) if isinstance(w, tk.Label)]
        self.assertTrue(any("CZK" in t for t in texts))

    def test_library_tab_add_device_and_approver_choice(self):
        from plc_studio.steps import knihovna
        self.app.load_sample("small")
        path = Path(os.environ["PLCSTUDIO_HOME"]) / "acme.plcdesk-library.json"
        path.write_text(json.dumps(acme_lib(self.app.bridge)), encoding="utf-8")
        self.app.ui.setdefault("projekt", {})["tab"] = 1
        self.assertTrue(knihovna.load_file(self.app, path))
        self.goto(0)
        self.buttons("Připojit k projektu")[0].invoke()
        self.root.update()
        self.assertEqual(self.app.prj["library"]["name"], "ACME standard")
        self.assertTrue(any(t.startswith("Typy zařízení (2)") for t in self.tab_texts()))
        self.goto(3)
        cb = next(w for w in walk(self.app.view) if hasattr(w, "_add"))
        cb._add()
        self.root.update()
        self.assertTrue(any(d.get("libType") == "PumpVfd" for d in self.app.prj["devices"]))
        self.goto(11)
        combos = [w for w in walk(self.app.view) if isinstance(w, ttk.Combobox) and "Ing. Novák" in w.cget("values")]
        self.assertTrue(combos, "výběr schvalovatele z knihovny")
        (self.app.home / knihovna.LIB_FILE).unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
