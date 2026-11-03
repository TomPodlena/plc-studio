"""Modul N1 rám / stůl z profilů ALUTEC (pro3d_lib.modul_ram): plán, nosnost, smlouva rozhraní bez FreeCADu; s FreeCADem
malý stůl + kontroly ``vse`` (slot pro-n1, jen s run_fc.ps1 a bez PRO3D_SKIP_FC)."""

import os
import shutil
import tempfile
import unittest
from pathlib import Path

from plc_studio.pro3d_lib import bench, modul_ram, spojky_mech
from plc_studio.pro3d_tools import rules


def _plan(v):
    return modul_ram.plan_ramu(**modul_ram.VZORY[v])


class RamPlanTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.maly, cls.velky = _plan("maly"), _plan("velky")

    def test_bez_chyb(self):
        for p in (self.maly, self.velky):
            self.assertEqual(p["kontrola"]["chyby"], [], p["nazev"])
            self.assertEqual(p["kontrola"]["varovani"], [], p["nazev"])

    def test_vyber_profilu(self):
        self.assertEqual(self.maly["rozhrani"]["profily"]["venec"], "104040")
        self.assertTrue(self.velky["rozhrani"]["profily"]["venec"].startswith("104080"))   # vodorovná síla válců
        for p in (self.maly, self.velky):
            n = p["rozhrani"]["nosnost"]
            self.assertLessEqual(n["podelnik_svisle"]["f"], n["podelnik_svisle"]["limit"])
            for r in n["podelnik_vodorovne"] or []:
                self.assertTrue(r["vyhovuje"], r)
            self.assertTrue(n["podpory"]["vyhovuje"])
            self.assertGreaterEqual(n["sloupek_vzper"]["bezpecnost"], 3)

    def test_nosnik_vzorec_vyrobce(self):
        # vypocty.md příklad 1: 104545 prostý nosník L 1000, F 500 N uprostřed, Iy 17,38 → f_F = F L³ / (48 E I)
        r = modul_ram.nosnik(1000.0, 17.38, 7.72, 0.0, [(500.0, 500.0)])
        self.assertAlmostEqual(r["f"], 500 * 1000 ** 3 / (48 * 70000 * 17.38e4), delta=0.01)

    def test_dlouhe_srouby_zaber(self):
        need = rules.min_zasroubovani(8, "hlinik")
        dl = [s for p in (self.maly, self.velky) for s in p["kontrola"]["srouby"] if "zaber_mm" in s]
        self.assertTrue(dl)
        for s in dl:
            self.assertGreaterEqual(s["zaber_mm"], need, s)

    def test_srouby_do_drazky(self):
        for p in (self.maly, self.velky):
            for s in p["kontrola"]["srouby"]:
                if "text" in s:
                    self.assertIn("v matici", s["text"])

    def test_klic(self):
        for p in (self.maly, self.velky):
            st = {k["stav"] for k in p["rozhrani"]["klic"]}
            self.assertNotIn("blokováno", st)
        # svislé šrouby podélník → sloupek pod deskou: jen montážní pořadí
        pod = [k for k in self.maly["rozhrani"]["klic"] if k["stav"] == "před montáží desky"]
        self.assertEqual(len(pod), 4)
        self.assertTrue(any("NAKONEC" in m for m in self.maly["rozhrani"]["montazni_poradi"]))

    def test_link_a_dedup(self):
        for p in (self.maly, self.velky):
            keys = [d["key"] for d in p["dily"]]
            self.assertEqual(len(keys), len(set(keys)))
            ram = p["moduly"][0]
            prof = [i for i in ram["instance"] if i["druh"] == "profil"]
            dil_prof = {i["model"] for i in prof}
            self.assertLess(len(dil_prof), len(prof))          # opakované profily = jeden díl, víc odkazů
            self.assertEqual(sum(1 for i in ram["instance"] if i["druh"] == "zaslepka"), 4)
            self.assertEqual(sum(1 for i in ram["instance"] if i["druh"] in ("patka", "kolo")), 4)

    def test_zastupne_a_zdroje(self):
        by = {d["key"]: d for d in self.maly["dily"]}
        for k, d in by.items():
            if k.startswith(("Patka", "Kolo", "Uhelnik", "Zaslepka", "Zatka")):
                self.assertTrue(d["zastupny"], k)
            self.assertTrue(d.get("zdroj"), k)
        self.assertTrue(self.maly["rozhrani"]["odhady"])

    def test_smlouva(self):
        r = self.velky["rozhrani"]
        for k in ("plochy", "nosnost", "pruchody", "montazni_poradi", "rezaci_seznam", "spojovaci_material", "odhady", "zdroje"):
            self.assertIn(k, r)
        p80 = [p for p in r["plochy"] if p["profil80"] and p["normala"] == [0, 0, 1]]
        self.assertEqual(len(p80), 4)                         # 2 nosníky 40×80 naležato × 2 drážky nahoře
        for p in r["plochy"]:
            for a, b in p["volne_useky_mm"]:
                self.assertGreaterEqual(b - a, 30)
        self.assertEqual(sum(x["kusu"] for x in r["rezaci_seznam"] if x["role"] == "sloupek"), 4)

    def test_pruchody(self):
        pr = self.maly["rozhrani"]["pruchody"]
        self.assertEqual(len(pr["prijato"]), 1)
        self.assertEqual(len(pr["odmitnuto"]), 1)
        self.assertIn("nevrtají", pr["odmitnuto"][0]["duvod"])

    def test_p1_na_nosniku(self):
        mods = self.velky["moduly"][1:]
        self.assertEqual([m["tag"] for m in mods], ["-Y1", "-Y2"])
        z_top = self.velky["rozhrani"]["rozmery"]["z_horni_lic_ramu"]
        for m in mods:
            self.assertAlmostEqual(m["rozhrani"]["obalka"][2], z_top, delta=0.01)   # deska modulu leží na nosníku

    def test_uhelnik_sroub_katalog(self):
        # 200820 = M8×20 s podložkou do matice 210482: zvolená tloušťka úhelníku to musí dovolit
        r = spojky_mech.delka_do_drazky("M8", modul_ram.DATA["uhelnik"]["t"], podlozka=True)
        self.assertTrue(r["ok"])
        self.assertEqual(r["l"], 20)


@unittest.skipIf(os.environ.get("PRO3D_SKIP_FC") or not bench.available(), "FreeCAD (run_fc.ps1) není k dispozici")
class RamFreeCADTest(unittest.TestCase):
    def test_maly_stul_kontroly(self):
        d = Path(tempfile.mkdtemp(prefix="n1_"))
        try:
            res = modul_ram.build_fc(_plan("maly"), d, slot=modul_ram.SLOT)
            self.assertEqual(res["souhrn"]["chyb"], 0, res["souhrn"])
            self.assertEqual(res["souhrn"]["selhalo"], [])
            for s in res["souhrn"]["snimky"]:
                self.assertTrue(Path(s).is_file(), s)
        finally:
            shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
