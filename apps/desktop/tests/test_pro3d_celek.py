"""Celek E3 (pro3d_lib.celek): vzor 01 složený z modulů kódem — plán bez FreeCADu (pořadí D1 → O3 → O1 / P2 / P3 → N1,
otvory přijaté rámem, hadice P4 routerem, kabely E2 jako ODHAD, smlouvy, zpětná vazba, determinismus, napojení na ram_gen);
s FreeCADem (jen PRO3D_CELEK_FC=1 — stavba celku trvá minuty) model + kolize."""

import json
import math
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from plc_studio.pro3d_lib import bench, celek, modul_dopravnik as md, ram_gen

DATA = Path(__file__).resolve().parent / "data"
MAN01 = DATA / "celek" / "01_PLCdesk_CAD.json"
SKILL_OK = (md.SKILL / "scripts" / "dopravnik_calc.py").is_file()
try:
    from plc_studio.pro3d_lib import modul_ostrov
    modul_ostrov.trasa_mod()
    TRASA_OK = True
except Exception:  # noqa: BLE001
    TRASA_OK = False


def _load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def _inside(inner, outer, tol=0.5):
    return all(outer[i] - tol <= inner[i] for i in range(3)) and all(inner[i] <= outer[i] + tol for i in range(3, 6))


@unittest.skipUnless(SKILL_OK and TRASA_OK, "skill dopravniky nebo kabelaz-a-hadice není nainstalován")
class CelekPlanTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.man = _load(MAN01)
        cls.res = celek.plan_celku(cls.man, model="Celek_01")
        cls.c = cls.res["celek"]
        cls.plan = cls.res["plan"]

    def test_poradi_moduly_urci_ram(self):
        p = self.c["poradi"]
        self.assertTrue(p[0].startswith("D1") and p[1].startswith("O3") and p[3].startswith("N1"), p)
        typy = [m.get("props", {}).get("Konstrukce_Modul") for m in self.plan["moduly"]]
        for t in ("N1", "D1", "P1", "S1", "O3", "N2", "O1", "P2", "P3", "P4"):
            self.assertIn(t, typy)

    def test_vyska_desky_pod_pohonem(self):
        d1 = self.c["smlouvy"]["D1"]
        H = self.c["rozmery"]["N1"]["H"]
        pre = celek.d1_obalka(celek.d1_build(md.vstup_z_manifestu(self.man), (0, 0, 0)))
        self.assertAlmostEqual(H, pre["pohon_dno"] - celek.VULE_POHON, places=1)
        self.assertAlmostEqual(d1["kotveni"]["pozadavek_N1"]["z_horni_lic_nosniku"], H, places=1)
        self.assertEqual(d1["pas"]["H_horni_plocha"], 900.0)

    def test_n1_prijal_vsechny_otvory(self):
        pr = self.c["pruchody_N1"]
        self.assertEqual(pr["odmitnuto"], [], pr["odmitnuto"])
        kinds = " ".join(p["co"] for p in pr["prijato"])
        for co in ("O3:", "D1:", "nosný profil obsluhy", "průchod"):
            self.assertIn(co, kinds)
        self.assertFalse([n for n in self.c["nepostaveno"] if n["id"] == "N1 otvor"])
        self.assertEqual(sorted(self.res["n1_params"]["kw"]["nosniky"]),
                         sorted(self.c["smlouvy"]["D1"]["kotveni"]["pozadavek_N1"]["nosniky_x"]))

    def test_kryt_obklopuje_moduly(self):
        X0, Y0, X1, Y1 = self.c["rozmery"]["O3"]["obrys"]
        o3 = self.c["smlouvy"]["O3"]
        self.assertEqual(o3["chyby"], [])
        inner = [X0 + 40, Y0 + 40, o3["obalka"][2], X1 - 40, Y1 - 40, o3["obalka"][5] - 40]
        d1 = self.c["smlouvy"]["D1"]
        for z in d1["nebezpecna_mista"]:
            self.assertTrue(_inside(z["bbox"], inner), z)
        for r in self.c["smlouvy"]["P1"]:
            self.assertTrue(_inside(r["obalka"], inner), r["obalka"])
        N = self.c["rozmery"]["N1"]
        self.assertLessEqual(X1 + 80, N["D"] + 0.1)
        self.assertLessEqual(Y1 + 40, N["W"] + 0.1)

    def test_pas_obsluhy_mimo_kryt_a_dvere(self):
        X0, Y0 = self.c["rozmery"]["O3"]["obrys"][:2]
        zd = self.c["smlouvy"]["O3"]["dvere"]["zona_drahy"]
        for m in self.plan["moduly"]:
            if m.get("props", {}).get("Konstrukce_Modul") in ("O1", "P2", "P3"):
                self.assertIn("placement", m)
        for nm, b in [(n, b) for n, b in celek.pas_obsluhy(self.man, self.c["rozmery"]["N1"]["H"], 15.0, Y0 + 60)["obalky"]]:
            self.assertLess(b[3], X0, nm)                     # celé vlevo od krytu
            self.assertGreater(b[1], zd["osa"][1], nm)        # za rovinou pantů (dráha dveří je před krytem)
            self.assertGreaterEqual(b[0], 0.0, nm)

    def test_hadice_p4_routerem(self):
        hs = self.c["hadice"]
        self.assertEqual(len(hs), 2)
        for h in hs:
            self.assertGreaterEqual(h["R"], h["R_min"])
            self.assertGreater(h["delka_s_rezervou_mm"], h["delka_mm"])
        p4 = next(m for m in self.plan["moduly"] if m.get("tag") == "-P4")
        self.assertEqual(len(p4["kabely"]), 2)
        p1 = next(m for m in self.plan["moduly"] if m.get("props", {}).get("Konstrukce_Modul") == "P1")
        self.assertFalse([k for k in p1["kabely"] if k["props"].get("Konstrukce_Typ") == "hadice"], "začátky hadic P1 staví P4")

    def test_kabely_e2_odhad(self):
        ks = self.c["kabely"]
        self.assertGreaterEqual(len(ks), 6)
        for k in ks:
            self.assertFalse(k["postaveno"])
            self.assertIn("ODHAD", k["stav"])
            self.assertGreater(k["delka_mm"], 0)
        self.assertTrue(any(n["id"] == "E1" for n in self.c["nepostaveno"]))
        self.assertTrue(any(n["id"] == "E2" for n in self.c["nepostaveno"]))

    def test_zpetna_vazba_zdvih(self):
        fb = self.res["zpetna_vazba"]
        self.assertEqual(fb["format"], "plcdesk-cad-feedback")
        self.assertTrue(any("zdvih" in i["message"] for i in fb["issues"]))

    def test_plan_dily_a_determinismus(self):
        keys = [s["key"] for s in self.plan["dily"]]
        self.assertEqual(len(keys), len(set(keys)))
        used = {i["model"] for m in self.plan["moduly"] for i in m["instance"]}
        self.assertLessEqual(used, set(keys))
        res2 = celek.plan_celku(self.man, model="Celek_01")
        self.assertEqual(json.dumps(self.plan, sort_keys=True), json.dumps(res2["plan"], sort_keys=True))

    def test_bez_dopravniku(self):
        m20 = _load(DATA / "moduly" / "20_PLCdesk_CAD.json")
        self.assertIsNone(celek.n1_params(m20))
        with self.assertRaises(ValueError):
            celek.plan_celku(m20)

    def test_ram_gen_z_celku(self):
        d = Path(tempfile.mkdtemp())
        try:
            s = ram_gen.generate(MAN01, d, no_fc=True)
            self.assertTrue(s["ok"], s)
            self.assertTrue(s["zdroj"].startswith("celek E3"), s["zdroj"])
            self.assertEqual(s["rozmery"]["D"], self.c["rozmery"]["N1"]["D"])
            self.assertEqual(s["umisteni"], [0.0, 0.0, 0.0])
            s2 = ram_gen.generate(MAN01, d, no_fc=True, celek=False)
            self.assertFalse(s2["zdroj"].startswith("celek"))
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_cli_no_fc(self):
        d = Path(tempfile.mkdtemp())
        try:
            self.assertEqual(celek.main([str(MAN01), str(d), "--model", "Celek_01", "--no-fc"]), 0)
            out = d / "celek"
            for f in ("CELEK.md", "celek.json", "D1_M1.json", "N1_N1.json", "O3_O3.json", "P1_Y1.json", "PLCdesk_CAD_feedback_celek.json"):
                self.assertTrue((out / f).is_file(), f)
            md_ = (out / "CELEK.md").read_text(encoding="utf-8")
            self.assertIn("Nepostaveno", md_)
            self.assertIn("ODHAD", md_)
        finally:
            shutil.rmtree(d, ignore_errors=True)


@unittest.skipUnless(os.environ.get("PRO3D_CELEK_FC") and not os.environ.get("PRO3D_SKIP_FC") and bench.available() and SKILL_OK
                     and TRASA_OK, "FreeCAD test celku jen s PRO3D_CELEK_FC=1 (stavba trvá minuty)")
class CelekFreeCADTest(unittest.TestCase):
    def test_model_a_kolize(self):
        d = Path(tempfile.mkdtemp())
        try:
            s = celek.generate(MAN01, d, model="Celek_01", slot="pro-e3-test", checks=["kolize"], shots=False)
            self.assertTrue(Path(s["fcstd"]).is_file(), s)
            self.assertEqual(s["chyb_kontrol"], 0, s.get("kontroly"))
        finally:
            shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
