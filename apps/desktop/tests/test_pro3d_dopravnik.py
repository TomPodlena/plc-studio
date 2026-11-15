"""Modul D1 pásový dopravník (pro3d_lib.modul_dopravnik): vstup z manifestu, výpočet skillu dopravniky, plán, smlouva
bez FreeCADu; s FreeCADem zkušební sestava N1 + D1 + S1 + P1 + kontroly ``vse`` (slot pro-d1, jen s run_fc.ps1, skillem
dopravniky a bez PRO3D_SKIP_FC)."""

import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from plc_studio.pro3d_lib import bench, modul_dopravnik as md, modul_ram, spojky_mech
from plc_studio.pro3d_tools import rules

ROOT = Path(__file__).resolve().parents[3]
MAN = ROOT / ".claude" / "p3p" / "all"
SKILL_OK = (md.SKILL / "scripts" / "dopravnik_calc.py").is_file()


def _man(n):
    p = MAN / f"man_{n}.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.is_file() else None


@unittest.skipUnless(SKILL_OK, "skill dopravniky není nainstalován")
class DopravnikPlanTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.vst = md.vzor_01()
        cls.plan = md.sestava(cls.vst)
        cls.roz = cls.plan["rozhrani"]
        cls.d1 = cls.plan["moduly"][1]

    def test_vstup_vzor_01(self):
        if _man("01") is None:
            self.skipTest("manifest vzoru 01 chybí")
        v = self.vst
        self.assertEqual(v["id"], "M1")
        self.assertEqual(v["pohon_PLCdesk_Id"], "-M1:gearmotor")
        self.assertEqual([s["typ"] for s in v["snimace"]], ["WL12"])
        self.assertEqual(v["vyhazovace"][0]["prumer"], 32)
        self.assertEqual(v["vyhazovace"][0]["zdvih"], 100)

    def test_vstup_13_16(self):
        for n in ("13", "16"):
            m = _man(n)
            if m is None:
                continue
            v = md.vstup_z_manifestu(m)
            self.assertIn(v["cls"], ("Motor", "Vfd"))

    def test_parse_popis(self):
        p = md.parse_popis("Pás délka 2 m, šířka 400 mm, rychlost 0,3 m/s, zboží 25 kg, výška 850")
        self.assertEqual(p, {"L": 2000.0, "b0": 400.0, "v": 0.3, "m_kg": 25.0, "H": 850.0})
        self.assertEqual(md.parse_popis("Pásový dopravník (motor s převodovkou)"), {})

    def test_zadani_pasu_z_manifestu(self):
        """``devices[].conveyor`` (PLCdesk krok Zařízení) má přednost před rozměry z popisu; nezadané pole = z popisu."""
        man = {"devices": [{"name": "M1", "cls": "Motor", "desc": "Pás délka 2 m, šířka 400 mm",
                            "conveyor": {"length": 2500, "width": None, "speed": 0.25, "load": None, "height": 800}}],
               "parts": []}
        v = md.vstup_z_manifestu(man)
        self.assertEqual(v["popis"], {"L": 2500.0, "b0": 400.0, "v": 0.25, "H": 800.0})
        man["devices"][0]["desc"] = "Hlavní pohon"           # bez slova „pás“: zadání dopravníku stačí
        man["devices"].insert(0, {"name": "M0", "cls": "Motor", "desc": "Čerpadlo"})
        self.assertEqual(md.vstup_z_manifestu(man)["id"], "M1")

    def test_vypocet_skillu(self):
        calc = md._calc_module()
        r = calc.vypocet({"L_m": 1.5, "b0_mm": 300, "v_m_s": 0.2, "m_kg": 10, "pas": md.VYCHOZI["pas"], "rozpeti_noh_mm": 1050})
        v = self.roz["vypocet"]
        self.assertAlmostEqual(v["FU_N"], round(r["FU_N"], 1))
        self.assertEqual(v["motor_kW"], r["vykon"]["motor_kW"])
        self.assertTrue(v["kontrola_pasu"]["vyhovuje"])
        self.assertTrue(v["buben"]["vyhovuje"])
        self.assertGreaterEqual(self.roz["bubny"]["D"], v["buben"]["D_zvoleny_mm"])

    def test_bez_chyb(self):
        self.assertEqual(self.plan["kontrola"]["chyby"], [])
        self.assertNotIn("blokováno", {k["stav"] for k in self.roz["klic"]})

    def test_link_a_dedup(self):
        keys = [d["key"] for d in self.plan["dily"]]
        self.assertEqual(len(keys), len(set(keys)))
        inst = self.d1["instance"]
        by = {}
        for i in inst:
            by.setdefault(i["model"], 0)
            by[i["model"]] += 1
        self.assertEqual(by["D1_UCF204_obalka"], 4)
        self.assertEqual(max(v for k, v in by.items() if k.startswith("D1_Buben")), 2)
        # vlastní tělesa (Part::Feature) jen jedinečná: kryt, zóny, distanční deska
        names = [t["name"] for t in self.d1["telesa"]]
        self.assertEqual(len(names), len(set(names)))
        self.assertLessEqual(len(names), 4)

    def test_lozisko_dle_dokumentace(self):
        by = {d["key"]: d for d in self.plan["dily"]}
        u = by["D1_UCF204_obalka"]
        self.assertFalse(u["zastupny"])
        self.assertFalse(u["vlastni"])
        self.assertIn("nsk.com", u["zdroj"][0])
        for k in ("D1_Prevodovka_140x110x140_d20", "D1_Motor_D110x200"):
            self.assertTrue(by[k]["zastupny"], k)

    def test_srouby(self):
        need10 = rules.min_zasroubovani(10, "ocel")
        for s in self.plan["kontrola"]["srouby"]:
            if "text" in s:
                self.assertTrue("v matici" in s["text"] or "matice ISO 4032" in s["text"], s)
            if "zaber_mm" in s:
                self.assertGreaterEqual(s["zaber_mm"], rules.min_zasroubovani(8, "hlinik"), s)
        m10 = [s for s in self.plan["kontrola"]["srouby"] if "M10" in s["sroub"]]
        self.assertEqual(len(m10), 16)                       # 4 ložiska × 4 šrouby s maticí
        self.assertTrue(spojky_mech.delka_s_matici("M10", 11 + md.VYCHOZI["deska_t"] + 2)["ok"])
        self.assertGreater(need10, 0)

    def test_smlouva(self):
        r = self.roz
        for k in ("pas", "bubny", "vypocet", "plochy", "kotveni", "sily_do_ramu", "nebezpecna_mista", "kabel_motoru", "odhady",
                  "zdroje", "rezaci_seznam"):
            self.assertIn(k, r)
        self.assertEqual(r["modul"], "D1")
        self.assertAlmostEqual(r["pas"]["H_horni_plocha"], 900.0)
        kde = {p["kde"] for p in r["plochy"]}
        self.assertTrue(any(k.startswith("horní") for k in kde))
        self.assertTrue(any(k.startswith("vnější") for k in kde))
        for p in r["plochy"]:
            for a, b in p["volne_useky_mm"]:
                self.assertGreaterEqual(b - a, 30)
        self.assertEqual(len(r["nebezpecna_mista"]), 2)
        self.assertTrue(all(z["nazev"].startswith("Zona_") for z in r["nebezpecna_mista"]))
        self.assertEqual(r["kabel_motoru"]["PLCdesk_Id"], "-M1:gearmotor")
        self.assertGreater(r["sily_do_ramu"]["na_stojinu_svisle_N"], 0)
        self.assertTrue(any("ODHAD" in o for o in r["odhady"]))

    def test_kotveni_na_n1(self):
        r = self.roz
        n1 = self.plan["rozhrani_N1"]
        z_n1 = n1["rozmery"]["z_horni_lic_ramu"]
        self.assertAlmostEqual(r["kotveni"]["pozadavek_N1"]["z_horni_lic_nosniku"], z_n1, delta=0.01)
        top = [p for p in n1["plochy"] if p["profil80"] and p["normala"] == [0, 0, 1]]
        xs = {round(p["osa_od"][0], 1) for p in top}
        for k in r["kotveni"]["stojiny"]:
            self.assertIn(k["drazka_x"], xs)                # stojina v ose horní drážky nosníku N1

    def test_vyhazovac_a_snimac(self):
        tags = [m.get("tag") for m in self.plan["moduly"][2:]]
        self.assertIn("-Y1", tags)
        vy = self.roz["vyhazovac"]
        self.assertGreater(vy["osa_z"], self.roz["pas"]["H_horni_plocha"])
        self.assertGreater(vy["zdvih_potreba"], vy["zdvih"])      # zdvih 100 na pás 300 nestačí → zpětná vazba
        fb = self.plan["zpetna_vazba"]
        self.assertEqual(fb["format"], "plcdesk-cad-feedback")
        self.assertEqual(fb["issues"][0]["parts"], ["-Y1:cylinder"])
        sn = self.roz["snimac"]
        self.assertEqual(sn["typ"], "WL12")
        self.assertGreater(sn["paprsek_z"], self.roz["pas"]["H_horni_plocha"] + 10)

    def test_nohy(self):
        d = md.dopravnik(self.vst, kotveni="nohy", s_moduly=False)
        self.assertEqual(d.chyby, [])
        self.assertTrue(any(i["druh"] == "patka" for i in d.inst))
        self.assertIsNone(d.rozhrani()["kotveni"]["pozadavek_N1"])


@unittest.skipIf(os.environ.get("PRO3D_SKIP_FC") or not bench.available() or not SKILL_OK,
                 "FreeCAD (run_fc.ps1) nebo skill dopravniky není k dispozici")
class DopravnikFreeCADTest(unittest.TestCase):
    def test_sestava_kontroly(self):
        d = Path(tempfile.mkdtemp(prefix="d1_"))
        try:
            res = modul_ram.build_fc(md.sestava(md.vzor_01()), d, slot=md.SLOT)
            self.assertEqual(res["souhrn"]["chyb"], 0, res["souhrn"])
            self.assertEqual(res["souhrn"]["selhalo"], [])
        finally:
            shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
