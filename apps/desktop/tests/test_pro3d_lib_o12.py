"""Moduly O2 (signální věž) a O1 (pult obsluhy) knihovny pro3d_lib: plán bez FreeCADu, s FreeCADem zkušební desky
+ kontroly pro3d_tools. FreeCAD část jen s run_fc.ps1 (skill freecad-instance) a bez PRO3D_SKIP_FC; slot z PRO3D_S1_SLOT."""

import copy
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from plc_studio.pro3d_lib import bench, modul_majak, modul_pult, spojky_el, spojky_mech
from plc_studio.pro3d_tools import rules


class SpojkyO12Test(unittest.TestCase):
    def test_rot_z_na(self):
        for v in ([0, 0, 1], [0, -1, 0], [1, 0, 0], [0.3, -0.4, 0.86]):
            R = spojky_mech.rot_z_na(v)
            n = sum(x * x for x in v) ** 0.5
            for i in range(3):
                self.assertAlmostEqual(R[i][2], v[i] / n)
            det = (R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1]) - R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0])
                   + R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]))
            self.assertAlmostEqual(det, 1.0)

    def test_sroub_s_matici_projde_celou_matici(self):
        for m, t in (("M4", 5.8), ("M5", 7.5), ("M6", 10.0)):
            r = spojky_mech.delka_s_matici(m, t)
            self.assertTrue(r["ok"], r)
            row = spojky_mech.NORM["ISO4032"]["rady"][m]
            self.assertGreaterEqual(r["l"] - t, row["m"])              # celá výška matice (rules.posud_sroub)
            self.assertLessEqual(r["prechod"], row["P"] + 3.0 + 1e-9)

    def test_bocni_drazka(self):
        r = spojky_mech.sroub_do_drazky_r("M6", [100, 20, 20], spojky_mech.R_BOK_PLUS_Y, 5.0)
        self.assertTrue(r["ok"])
        s = next(i for i in r["instance"] if i["druh"] == "sroub")
        self.assertGreater(s["pos"][1], 20.0)                      # hlava vně boční plochy
        self.assertAlmostEqual(s["rot"][1][2], 1.0)                 # osa Z modelu (hlava) → +Y

    def test_kabel_vyvod(self):
        k = spojky_el.kabel_vyvod([0, 0, 100], [0, 0, -1], [0, 1, 0], 5.0, 25.0)
        self.assertAlmostEqual(spojky_el.ohyb_z_cesty(k["path"]), 25.0, places=3)


class MajakTest(unittest.TestCase):
    def test_stary_tvar_jedna_vez(self):
        vv = modul_majak.veze_z_manifestu(modul_majak.vzor_03())
        self.assertEqual(len(vv), 1)
        v = vv[0]
        self.assertEqual([p["device"] for p in v["patra"]], ["H2", "H1"])          # shora červená, zelená
        self.assertEqual([p["barva"] for p in v["patra"]], ["R", "G"])
        self.assertTrue(any("M-02" in x for x in v["zpetna_vazba"]))
        self.assertEqual(modul_majak.volba_veze(v["patra"])["kod"], "64924005")

    def test_novy_tvar_patra_z_roli(self):
        v = modul_majak.veze_z_manifestu(modul_majak.vzor_novy())[0]
        self.assertEqual([(p["device"], p["barva"]) for p in v["patra"]], [("H2", "R"), ("H1", "G"), ("H3", "W")])
        h3 = next(p for p in v["patra"] if p["device"] == "H3")                         # ready → bílá = výchozí PLCdesk
        self.assertFalse(h3["odhad"])
        self.assertIn("výchozí PLCdesk", h3["zdroj_barvy"])
        for role, kod in (("run", "G"), ("fault", "R"), ("ready", "W"), ("stopped", "Y"), ("lock", "B"), ("auto", "W")):
            self.assertEqual(modul_majak.barva_z_role(role), (kod, False), role)
        self.assertFalse(any("M-02" in x for x in v["zpetna_vazba"]))
        self.assertEqual(modul_majak.volba_veze(v["patra"])["druh"], "stavebnice")       # bílá není v GN / YE / RD

    def test_popis_ma_prednost_pred_roli(self):
        man = modul_majak.vzor_novy()
        man["devices"][2]["desc"] = "Maják žlutá — připraven"
        v = modul_majak.veze_z_manifestu(man)[0]
        self.assertEqual(next(p for p in v["patra"] if p["device"] == "H3")["barva"], "Y")
        self.assertEqual(modul_majak.volba_veze(v["patra"])["kod"], "64924005")

    def test_konflikt_barev_a_maximum(self):
        man = modul_majak.vzor_03()
        man["devices"][1]["desc"] = "Maják zelená — porucha"
        v = modul_majak.veze_z_manifestu(man)[0]
        self.assertTrue(any("konflikt" in x for x in v["zpetna_vazba"]))
        self.assertEqual(modul_majak.volba_veze(v["patra"])["druh"], "stavebnice")
        with self.assertRaises(ValueError):
            modul_majak.volba_veze([{"barva": "W"}] * 6)

    def test_lavice_plan(self):
        plan = modul_majak.lavice_o2()
        self.assertEqual(len(plan["moduly"]), 3)
        for m in plan["moduly"]:
            k = m["kontrola"]
            self.assertEqual(k["otvory_patky"], {"n": 4, "d": 5.5, "roztec": 54.0})
            self.assertEqual(spojky_mech.otvor_vule("M5"), 5.5)
            self.assertAlmostEqual(k["kabel_R_cesta"], k["kabel_R"], places=3)
            self.assertLessEqual(k["kabel_D"], k["kabel_max_d"])
            self.assertGreaterEqual(k["kabel_R"], 5 * k["kabel_D"] - 1e-9)
            # barvy pater shora v pořadí R, Y, B, G, W
            bb = [p["barva"] for p in k["patra"]]
            self.assertEqual(bb, sorted(bb, key=modul_majak.PORADI.index))
            # patra (pomocná) nesou barvu, šrouby patky mají matici a podložku
            pp = [t for t in m["telesa"] if t["name"].startswith("Patro_")]
            self.assertEqual(len(pp), len(k["patra"]))
            self.assertTrue(all(t["props"]["Konstrukce_Typ"] == "pomocny" and t["props"]["Konstrukce_Barva_RGB"] for t in pp))
            dr = [i["druh"] for i in m["instance"]]
            self.assertEqual(dr.count("sroub"), 6)               # 4 × patka + 2 × V4
            self.assertGreaterEqual(dr.count("matice"), 6)
            # žádná barva patra se nesmí plést se žlutou „dle dokumentace“ (kontrola stav)
            for t in pp:
                rgb = [int(x) for x in t["props"]["Konstrukce_Barva_RGB"].split(",")]
                self.assertTrue(any(abs(a - b) > rules.COLOR_TOL for a, b in zip(rgb, rules.YELLOW)), t["label"])
        c = plan["moduly"][2]["kontrola"]
        self.assertEqual(c["vrchol"] - c["z_montaz"], 299.0)          # hotová věž = výška z katalogu
        self.assertEqual([p["device"] for p in c["patra"]], ["H2", None, "H1"])
        self.assertIn("nevyužito", " ".join(plan["moduly"][2]["zpetna_vazba"]))

    def test_vyska_varuje_ve_stroji(self):
        v = modul_majak.veze_z_manifestu(modul_majak.vzor_03())[0]
        m = modul_majak.modul(v, "deska", 100.0, z_podlaha=800.0)
        self.assertTrue(any("1800" in x for x in m["varovani"]))
        m = modul_majak.modul(copy.deepcopy(v), "uhelnik", 100.0, z_podlaha=1700.0)
        self.assertGreater(m["kontrola"]["spodni_sviceni"], 1800)

    def test_md(self):
        t = modul_majak.report_md(modul_majak.lavice_o2())
        self.assertIn("ODHADY", t)
        self.assertIn("64924005", t)


class PultTest(unittest.TestCase):
    def setUp(self):
        self.pr = modul_pult.pristroje_z_manifestu(modul_pult.vzor_lavice())
        self.m = modul_pult.modul(self.pr)
        self.k = self.m["kontrola"]

    def test_vstup(self):
        d = {p["tag"]: p for p in self.pr["pristroje"]}
        self.assertEqual(d["-S1"]["druh"], "estop")
        self.assertEqual((d["-S2"]["funkce"], d["-S2"]["barva"]), ("start", "bílá"))
        self.assertEqual((d["-S3"]["funkce"], d["-S3"]["barva"]), ("stop", "černá"))
        self.assertEqual((d["-S0R"]["funkce"], d["-S0R"]["barva"]), ("reset", "modrá"))
        self.assertEqual(d["-S5"]["druh"], "volic")
        self.assertTrue(d["-S5"]["zastupny"])
        self.assertEqual(self.pr["hmi"]["kod"], "6AV2123-3GB32-0AW0")

    def test_jmena_kategorii_dvere_a_dvouruc(self):
        man = modul_pult.vzor_lavice()
        man["parts"][0]["category"] = "emergency_stop"
        man["parts"][1]["category"] = "push_button"
        man["devices"].append({"name": "S9", "cls": "DI", "desc": "Dvouruční ovládání — levé"})
        man["parts"].append({"id": "-S9:pushbutton", "category": "pushbutton", "device": "S9", "orderCode": "", "brand": "Siemens"})
        pr = modul_pult.pristroje_z_manifestu(man)
        self.assertEqual(len(pr["pristroje"]), 5)
        self.assertTrue(pr["vynechano"])

    def test_vyrezy_a_drazka(self):
        self.assertTrue(all(v["d"] == 22.3 and not v["drazka"] for v in self.k["vyrezy"]))     # Siemens 3SU1 bez drážky
        man = modul_pult.vzor_lavice()
        for p in man["parts"][:5]:
            p["brand"], p["orderCode"] = "Schneider Electric", "XB5AA31"
        k = modul_pult.modul(modul_pult.pristroje_z_manifestu(man))["kontrola"]
        v = {x["tag"]: x for x in k["vyrezy"]}
        self.assertAlmostEqual(v["-S2"]["d"], 22.5)
        self.assertFalse(v["-S2"]["drazka"])
        self.assertTrue(v["-S1"]["drazka"] and v["-S5"]["drazka"])

    def test_roztece_a_deska(self):
        self.assertEqual(self.k["roztece_chyby"], [])
        pol = copy.deepcopy(self.k["pristroje"])
        pol[1]["x"] = pol[0]["x"] + 25.0
        self.assertTrue(modul_pult.kontrola_rozteci(pol))
        lo, hi = modul_pult.SG["deska_t"]
        self.assertTrue(lo <= self.k["deska_t"] <= hi)

    def test_hmi_okoli_a_estop(self):
        h = self.k["hmi"]
        for s, v in h["okoli"].items():
            self.assertGreaterEqual(v, h["okoli_min"][s], s)
        self.assertLessEqual(self.k["estop_hmi"], modul_pult.DOSAH_ESTOP_HMI)
        self.assertEqual(sum(1 for i in self.m["instance"] if i["druh"] == "upinka"), 6)

    def test_pristup_montaze(self):
        p = self.k["pristup"]
        self.assertTrue(p["viko_snimatelne"] and p["po_sejmuti_mimo_telo"])
        self.assertGreaterEqual(p["rezerva_vodice"], 30.0)
        sk = self.m["skupiny"][0]
        self.assertIn("posun", json.loads(sk["props"]["Konstrukce_Pohyb"]))
        # přístroje, HMI, upínky a šrouby víka jdou s víkem; matice zůstávají na přírubách těla
        for i in self.m["instance"]:
            if i["druh"] in ("estop", "tlacitko", "volic", "signalka", "hmi", "hmi_celo", "upinka"):
                self.assertEqual(i.get("skupina"), "Viko", i)
        mat_viko = [i for i in self.m["instance"] if i["druh"] == "matice" and i["model"].startswith("ISO4032_M4")]
        self.assertEqual(len(mat_viko), 8)
        self.assertTrue(all(not i.get("skupina") for i in mat_viko))

    def test_hmi_misto_jedno_rozhodnuti(self):
        from plc_studio.pro3d_cabinet import dvere, layout
        man = modul_pult.vzor_lavice()
        self.assertEqual(dvere.hmi_misto(man)["misto"], "pult")
        self.assertEqual(dvere.hmi_misto({})["misto"], "dvere")                          # výchozí = dveře (jako dosud)
        self.assertEqual(dvere.hmi_misto({"brief": {"concept": {"hmi": "Panel HMI ve dveřích rozvaděče"}}})["misto"], "dvere")
        self.assertEqual(dvere.hmi_misto({"brief": {"desc": "Stroj s HMI na otočném rameni u stroje."}})["misto"], "pult")
        self.assertEqual(dvere.hmi_misto({"brief": {"concept": {"hmi": "Tlačítka na pultu"}}})["misto"], "dvere")  # bez HMI
        # bez konceptu: HMI do pultu nejde, zůstane rozvaděči
        bez = dict(man, brief={})
        pr = modul_pult.pristroje_z_manifestu(bez)
        self.assertIsNone(pr["hmi"])
        self.assertTrue(any("HMI ve dveřích" in v for v in pr["vynechano"]))
        # rozvaděč: HMI s location cabinet jen když není v pultu
        hmi_row = dict(man["parts"][-1], location="cabinet", mount="panel", qty=1)
        items_p, _c, notes = layout.expand({"brief": man["brief"], "parts": [hmi_row]}, None)
        self.assertEqual(items_p, [])
        self.assertTrue(any("pultu" in n for n in notes))
        items_d, _c, _n = layout.expand({"brief": {}, "parts": [hmi_row]}, None)
        self.assertEqual([i["cat"] for i in items_d], ["plc_hmi"])

    def test_kotveni_uhelniky(self):
        uh = [i for i in self.m["instance"] if i["druh"] == "uhelnik"]
        self.assertEqual(len(uh), 2)
        mods = [i["model"] for i in self.m["instance"]]
        self.assertEqual(mods.count("MaticeT_40-8_M6"), 2)                 # boční drážka profilu
        self.assertEqual(mods.count("ISO4032_M6"), 2)                      # pod vodorovným ramenem
        self.assertIn("úhelník → profil", self.k["spojka_V4"])
        sp = next(s for s in self.m["dily"] if s["key"].startswith("O1_uhelnik"))
        self.assertTrue(sp.get("vlastni"))
        # přístroje z katalogu = model pro3d_parts panel_22 s tloušťkou desky
        p22 = [s for s in self.m["dily"] if s.get("gen") == "panel_22"]
        self.assertTrue(p22)
        self.assertTrue(all(s["params"]["deska_t"] == modul_pult.T_VIKO for s in p22))

    def test_bez_estopu_zpetna_vazba(self):
        man = modul_pult.vzor_lavice()
        man["parts"] = man["parts"][1:]
        pr = modul_pult.pristroje_z_manifestu(man)
        self.assertTrue(any("P-03" in x for x in pr["zpetna_vazba"]))

    def test_kabel(self):
        self.assertAlmostEqual(self.k["kabel_R_cesta"], self.k["kabel_R"], places=3)
        self.assertIn("ODHADY", modul_pult.report_md(modul_pult.lavice_o1()))


@unittest.skipIf(os.environ.get("PRO3D_SKIP_FC") or not bench.available(), "FreeCAD (run_fc.ps1) není k dispozici")
class LaviceO12FreeCADTest(unittest.TestCase):
    def _run(self, plan, n_sroubu):
        d = Path(tempfile.mkdtemp(prefix="o12_lavice_"))
        try:
            res = bench.build_and_check(plan, d)
            s = res["souhrn"]
            self.assertEqual(s["selhalo"], [], s)
            for k in ("kolize", "souvislost", "zasunuti", "kopie", "stav", "step"):
                self.assertEqual(s["kontroly"][k]["chyby"], 0, (k, s))
            zas = res["kontroly"]["checks"]["zasunuti"]["data"]["sroubu"]
            self.assertEqual(len(zas), n_sroubu)
            self.assertTrue(all(x["posudek"]["uroven"] == "ok" for x in zas))
            for p in s["snimky"]:
                self.assertTrue(Path(p).is_file() and Path(p).stat().st_size > 10000, p)
        finally:
            if not os.environ.get("PRO3D_KEEP"):
                shutil.rmtree(d, ignore_errors=True)

    def test_o2(self):
        self._run(modul_majak.lavice_o2(), 18)          # 3 věže × (4 patka + 2 V4)

    def test_o1(self):
        self._run(modul_pult.lavice_o1(), 10)           # 8 × víko + 2 × V4


if __name__ == "__main__":
    unittest.main()
