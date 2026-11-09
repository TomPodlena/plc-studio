"""Moduly P2 / P3 / P4 (pro3d_lib.modul_ostrov): úprava vzduchu, rozváděče na liště, hadice ostrov ↔ válce.
FreeCAD část běží jen s run_fc.ps1 (skill freecad-instance) a bez PRO3D_SKIP_FC; slot pro-p234."""

import json
import math
import os
import tempfile
import unittest
from pathlib import Path

from plc_studio.pro3d_lib import bench, modul_ostrov as mo, spojky_pneu
from plc_studio.pro3d_tools import rules

HERE = Path(__file__).resolve().parent
MAN20 = HERE / "data" / "moduly" / "20_PLCdesk_CAD.json"


def _bez_odhadu_ma_zdroj(d, path=""):
    """Každý slovník s rozměry: buď příznak odhad, nebo zdroj."""
    out = []
    if isinstance(d, dict):
        if "obalka" in d and isinstance(d["obalka"], dict) and not d["obalka"].get("odhad"):
            out.append(path + ".obalka bez příznaku odhad")
        for k, v in d.items():
            out += _bez_odhadu_ma_zdroj(v, f"{path}.{k}")
    return out


class DataTest(unittest.TestCase):
    def test_zdroje_jsou_url(self):
        for k, v in mo.D["zdroje"].items():
            self.assertTrue(v.startswith("https://"), k)
        for v in mo.D["ventily"].values():
            self.assertIn(v["zdroj"], mo.D["zdroje"])
        for j in mo.D["uprava"]["jednotky"]:
            self.assertIn(j["zdroj"], mo.D["zdroje"])

    def test_obrysy_jsou_odhad(self):
        self.assertEqual(_bez_odhadu_ma_zdroj(mo.D), [])

    def test_uzaver_uzamceni_nedolozeno(self):
        em = mo.D["uprava"]["jednotky"][0]
        self.assertIsNone(em["uzamykatelny"])
        self.assertIn("NEDOLOŽENA", em["uzamykatelny_pozn"])


class OstrovTest(unittest.TestCase):
    def setUp(self):
        self.m = mo.ostrov("-VI1", [{"tag": "-Y1", "valec": "-Y2"}, {"tag": "-Y2", "valec": "-Y1"}, {"tag": "-Y3"}], 100.0)
        self.r = self.m["rozhrani"]

    def test_porty(self):
        p = self.r["pripojky"]
        self.assertEqual(len(p), 6)
        for q in p:
            self.assertEqual(q["cil"], "zadni" if q["port"] == "4" else "predni")
            self.assertEqual(q["thread"], "G1/8")
            self.assertAlmostEqual(q["zasun"], spojky_pneu.sroubeni("QS-G1/8-6")["zasun"])
        xs = sorted({round(q["seat"][0], 3) for q in p})
        self.assertEqual([round(b - a, 3) for a, b in zip(xs, xs[1:])], [16.0, 16.0])

    def test_zona_prstu_polovina_roztece(self):
        z = [t for t in self.m["telesa"] if t["props"].get("Konstrukce_Zona") == "konektor"]
        self.assertEqual(len(z), 3)
        for t in z:
            self.assertLessEqual(t["body"]["add"][0]["cyl"]["r"], 8.0 + 1e-9)
            self.assertTrue(t["vyjimka"])

    def test_zony_druhy(self):
        for t in self.m["telesa"]:
            if t["props"].get("Konstrukce_Typ") == "pomocny":
                self.assertIn(t["props"]["Konstrukce_Zona"], rules.POMOCNE_ZONY)

    def test_rozhrani(self):
        for k in ("ventily", "lista", "napajeni", "odfuky", "pripojky", "elektro", "kotveni", "obalka", "odhady", "zdroje"):
            self.assertIn(k, self.r)
        self.assertEqual(self.r["napajeni"]["thread"], "G1/4")
        self.assertEqual(len(self.r["elektro"]), 3)


class UpravaTest(unittest.TestCase):
    def setUp(self):
        self.m = mo.uprava("-P2", 20.0)
        self.r = self.m["rozhrani"]

    def test_bezpecnost_jen_navrh(self):
        self.assertIn("NÁVRH", self.r["bezpecnost"]["stav"])
        self.assertIn("13849", self.r["bezpecnost"]["text"])
        self.assertTrue(self.m["varovani"])

    def test_rastr_a_porty(self):
        g = mo.D["uprava"]["rastr"]
        self.assertEqual(g, 62.0)
        self.assertEqual(self.r["privod"]["thread"], "G1/2")
        self.assertEqual(self.r["vystup_P"]["fitting"], "QS-G1/4-10")
        self.assertAlmostEqual(self.r["vystup_P"]["seat"][0], 20.0 + 3 * g + mo.D["uprava"]["redukce"]["delka"])

    def test_zony_ovladani(self):
        z = [t for t in self.m["telesa"] if t["props"].get("Konstrukce_Zona") == "ovladani"]
        self.assertEqual(len(z), 3)
        self.assertIn("ovladani", rules.POMOCNE_ZONY)

    def test_nadobka_nad_konzolou(self):
        lfr = mo.D["uprava"]["jednotky"][1]["obalka"]
        z_ax = self.m["kontrola"]["z_osa"]
        dno = z_ax - lfr["pod"] - lfr["nadobka_h"] - mo.D["prostor"]["ovladani_kondenzat"]["h"]
        self.assertGreater(dno, 40.0 + mo.D["uprava"]["konzola"]["t"])


class HadiceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plan = mo.lavice_p234()
        cls.p4 = cls.plan["moduly"][-1]

    def test_polomery_a_delky(self):
        for h in self.p4["rozhrani"]["hadice"]:
            self.assertGreaterEqual(h["R"], h["R_min"])
            self.assertGreater(h["delka_s_rezervou_mm"], h["delka_mm"])
        self.assertEqual(len(self.p4["rozhrani"]["hadice"]), 5)

    def test_konce_v_sroubeni(self):
        p3 = self.plan["moduly"][1]["rozhrani"]
        konce = {q["id"]: mo._konec(q) for q in p3["pripojky"]}
        starts = [k["path"][0]["line"][0] for k in self.p4["kabely"]]
        for kid, pt in konce.items():
            self.assertTrue(any(math.dist(pt, s) < 1e-6 for s in starts), kid)

    def test_p1_bez_zacatku_hadic(self):
        for m in self.plan["moduly"][2:4]:
            self.assertFalse([k for k in m["kabely"] if k["props"]["Konstrukce_Typ"] == "hadice"])

    def test_kusovnik(self):
        k = {x["hadice"]: x for x in self.p4["rozhrani"]["kusovnik"]}
        self.assertEqual(k["Festo PUN-6x1"]["kusu"], 4)
        self.assertEqual(k["Festo PUN-10x1,5"]["kusu"], 1)


@unittest.skipUnless(MAN20.is_file(), "chybí manifest vzoru 20")
class ManifestTest(unittest.TestCase):
    def test_vzor_20(self):
        man = json.loads(MAN20.read_text(encoding="utf-8"))
        zm = mo.z_manifestu(man)
        self.assertEqual(len(zm["ventily"]), 7)
        self.assertEqual(zm["nepodporovane"], [])
        for v in zm["ventily"]:
            self.assertEqual(v["valec"], v["tag"])
        ids = {p["id"] for p in man["parts"]}
        fb = mo.zpetna_vazba(man)
        self.assertEqual(fb["format"], "plcdesk-cad-feedback")
        kinds = {i["id"] for i in fb["issues"]}
        for i in fb["issues"]:
            self.assertTrue(set(i["parts"]) <= ids)
            self.assertTrue(i["measured"]["source"])
        # bezpečnostní ventil -YS1:safety_valve kusovník vzoru 20 už má (modul bezpečnosti) → zpětná vazba ho nenavrhuje
        self.assertIn("safety_valve", {p["category"] for p in man["parts"]})
        self.assertNotIn("p2-sv-1", kinds)
        self.assertIn("p3-lista-1", kinds)
        # starší manifest bez řádků úpravy vzduchu: uzávěr a filtr-regulátor ano; bez modulu bezpečnosti SV ne
        m2 = dict(man, safety=None, parts=[p for p in man["parts"] if p["category"] != "safety_valve"])
        k2 = {i["id"] for i in mo.zpetna_vazba(m2)["issues"]}
        self.assertTrue({"p2-em1-1", "p2-lfr-1"} <= k2)
        self.assertNotIn("p2-sv-1", k2)
        # nový kusovník jádra (lišta -WP1, uzávěr -QM1, filtr-regulátor -HQ1) → žádná zpětná vazba P2 / P3
        m3 = dict(man, parts=man["parts"] + [{"id": i, "category": c} for i, c in
                                              (("-WP1:valve_manifold", "valve_manifold"), ("-QM1:air_shutoff", "air_shutoff"),
                                               ("-HQ1:air_prep", "air_prep"))])
        self.assertEqual([i["id"] for i in mo.zpetna_vazba(m3)["issues"]], [])

    def test_uprava_bez_sv(self):
        a = mo.uprava("-P2", 0.0, 0.0)
        b = mo.uprava("-P2", 0.0, 0.0, sv=False, ids={"EM1": "-QM1:air_shutoff", "LFR": "-HQ1:air_prep"})
        pids = [i["props"].get("PLCdesk_Id") for i in b["instance"] if (i.get("props") or {}).get("PLCdesk_Id")]
        self.assertEqual(pids, ["-QM1:air_shutoff", "-HQ1:air_prep"])
        self.assertLess(b["rozhrani"]["vystup_P"]["usti"][0], a["rozhrani"]["vystup_P"]["usti"][0])   # o jeden rastr 62 kratší
        self.assertAlmostEqual(a["rozhrani"]["vystup_P"]["usti"][0] - b["rozhrani"]["vystup_P"]["usti"][0], 62.0, 3)
        self.assertIsNone(b["rozhrani"]["bezpecnost"]["zarizeni"])
        self.assertNotIn("Konstrukce_Bezpecnost", b["props"])
        self.assertEqual(b["rozhrani"]["elektro"], [])


@unittest.skipIf(os.environ.get("PRO3D_SKIP_FC") or not bench.available(), "FreeCAD (run_fc.ps1) není k dispozici")
class LaviceP234FreeCADTest(unittest.TestCase):
    def test_lavice_kontroly(self):
        with tempfile.TemporaryDirectory() as d:
            res = bench.build_and_check(mo.lavice_p234(), Path(d), slot="pro-p234")
            s = res.get("souhrn") or {}
            self.assertEqual(s.get("chyb"), 0, json.dumps(s, ensure_ascii=False)[:2000])
            self.assertFalse(s.get("selhalo"))


if __name__ == "__main__":
    unittest.main()
