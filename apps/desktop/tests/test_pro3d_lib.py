"""Knihovna spojek V4 / V2 a modul S1 (pro3d_lib): bez FreeCADu výpočty a plán, s FreeCADem zkušební deska + kontroly.

FreeCAD část běží jen s run_fc.ps1 (skill freecad-instance) a bez PRO3D_SKIP_FC; slot pro3d-s1-test."""

import json
import math
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from plc_studio.pro3d_lib import bench, modul_snimac, modul_valec, spojky_el, spojky_mech, spojky_pneu
from plc_studio.pro3d_tools import rules


class SpojkyMechTest(unittest.TestCase):
    def test_iso273(self):
        self.assertEqual(spojky_mech.otvor_vule("M6"), 6.6)
        self.assertLess(spojky_mech.otvor_vule("M6", "f"), spojky_mech.otvor_vule("M6", "c"))

    def test_podelny_otvor(self):
        po = spojky_mech.podelny_otvor("M6", 5)
        self.assertAlmostEqual(po["delka"] - po["sirka"], 10.0)
        self.assertEqual(po["sirka"], 6.6)

    def test_delka_do_drazky_splni_zasunuti_a_dno(self):
        dz = spojky_mech.drazka("40/8")
        for m in ("M4", "M5", "M6", "M8"):
            for t in (3.0, 4.0, 5.0, 8.0):
                r = spojky_mech.delka_do_drazky_auto(m, t)
                if not r["ok"]:
                    continue
                mt = spojky_mech.matice_t(m)
                d = float(m[1:])
                # požadavek kontroly zasunuti (rules.posud_sroub, druh matice) — stejný vzorec
                need = min(mt["H"], max(d, rules.ZASROUB_MIN_MM))
                self.assertGreaterEqual(r["v_matici"] + 1e-9, need, (m, t, r))
                self.assertLessEqual(r["hloubka_konce"], dz["hloubka"] - 0.5 + 1e-9, (m, t, r))
                self.assertIn(r["l"], spojky_mech.delky())
        self.assertTrue(spojky_mech.delka_do_drazky_auto("M6", 4.0)["ok"])

    def test_matice_t_se_vejde_do_drazky(self):
        for m in ("M4", "M5", "M6", "M8"):
            mt = spojky_mech.matice_t(m)
            self.assertEqual(mt["problemy"], [], m)
            # šířka matice v každé hloubce < dutina drážky
            for y, z in mt["body"]["add"][0]["prism_x"]["pts"]:
                h = 4.0 - z                       # hloubka pod povrchem (horní plocha matice = spodek rtu 4 mm)
                self.assertLessEqual(abs(y) * 2, spojky_mech.sirka_dutiny("40/8", h) + 1e-6, (m, y, z))

    def test_zavit_podle_materialu(self):
        self.assertTrue(spojky_mech.delka_do_zavitu("M4", 15.6, 4.0, "ocel")["ok"])
        self.assertFalse(spojky_mech.delka_do_zavitu("M4", 15.6, 4.0, "hlinik")["ok"])   # Al 1,5·d = 6 > 4
        r = spojky_mech.delka_do_zavitu("M6", 4.0, 10.0, "hlinik")
        self.assertTrue(r["ok"])
        self.assertGreaterEqual(r["v_zavitu"], rules.min_zasroubovani(6, "hlinik") - rules.ZASROUB_TOL)

    def test_spec_sroubu_z_normalie(self):
        s = spojky_mech.spec_sroub("M6", 16)
        self.assertEqual(s["gen"], "sroub_4762")
        self.assertEqual(s["params"]["dk"], 10)
        self.assertEqual(s["typ"], "sroub")


class SpojkyElTest(unittest.TestCase):
    def test_evc002_ze_zdroje(self):
        k = spojky_el.konektor_data("EVC002")
        self.assertEqual((k["D"], k["L"], k["kabel_D"]), (15.5, 45.0, 4.3))
        self.assertTrue(k["zdroj"].startswith("https://"))
        self.assertEqual(spojky_el.polomer_ohybu("EVC002"), 43.0)

    def test_kodovani(self):
        self.assertIn(4, spojky_el.kodovani("A")["piny"])
        self.assertEqual(spojky_el.kodovani("D")["piny"], [4])

    def test_prostor_a_kabel(self):
        k = spojky_el.konektor("EVC002", [0, 0, 0], [0, -1, 0], [-1, 0, 0])
        self.assertGreater(k["zona_r"], 15.5 / 2)
        self.assertGreater(k["zona_h"], 45.0)
        self.assertAlmostEqual(spojky_el.ohyb_z_cesty(k["kabel"]["path"]), 43.0, places=3)
        # rovný úsek za zásuvkou před obloukem
        a, b = k["kabel"]["path"][0]["line"]
        self.assertGreaterEqual(math.dist(a, b), 3 * 4.3 - 1e-9)


def _aabb(body):
    """AABB popisu tělesa (jen add; box / cyl osově rovnoběžné)."""
    lo, hi = [1e9] * 3, [-1e9] * 3
    for p in body["add"]:
        if "box" in p:
            b = p["box"]
            pl, ph = [b[0], b[2], b[4]], [b[1], b[3], b[5]]
        elif "cyl" in p or "cone" in p:
            c = p.get("cyl") or p["cone"]
            r = c.get("r", max(c.get("r1", 0), c.get("r2", 0)))
            e = [c["p"][i] + c["d"][i] * c["h"] for i in range(3)]
            pl = [min(c["p"][i], e[i]) - (r if abs(c["d"][i]) < 0.5 else 0) for i in range(3)]
            ph = [max(c["p"][i], e[i]) + (r if abs(c["d"][i]) < 0.5 else 0) for i in range(3)]
        else:
            continue
        lo = [min(lo[i], pl[i]) for i in range(3)]
        hi = [max(hi[i], ph[i]) for i in range(3)]
    return lo, hi


def _overlap(a, b, tol=0.01):
    return all(a[0][i] < b[1][i] - tol and b[0][i] < a[1][i] - tol for i in range(3))


class ModulS1Test(unittest.TestCase):
    def setUp(self):
        self.plan = modul_snimac.lavice_s1()

    def test_tri_varianty(self):
        self.assertEqual([m["typ"] for m in self.plan["moduly"]], ["IFS204", "CM18", "WL12"])
        self.assertEqual(len({d["key"] for d in self.plan["dily"]}), len(self.plan["dily"]))
        for m in self.plan["moduly"]:
            self.assertEqual(m["varovani"], [], m["nazev"])

    def test_zona_snimani_miri_na_cil(self):
        for m in self.plan["moduly"]:
            k = m["kontrola"]
            v = [k["cil"][i] - k["celo"][i] for i in range(3)]
            L = math.sqrt(sum(x * x for x in v))
            self.assertAlmostEqual(L, k["vzdalenost"], places=6)
            cr = [v[1] * k["osa"][2] - v[2] * k["osa"][1], v[2] * k["osa"][0] - v[0] * k["osa"][2],
                  v[0] * k["osa"][1] - v[1] * k["osa"][0]]
            self.assertLess(math.sqrt(sum(x * x for x in cr)), 1e-6, m["nazev"])     # cíl na ose
            if "Sa" in k:
                self.assertLessEqual(k["vzdalenost"], k["Sa"])                       # v zajištěné vzdálenosti
            else:
                self.assertLessEqual(k["vzdalenost"], k["dosah"])

    def test_serizeni_5mm(self):
        for m in self.plan["moduly"]:
            self.assertGreaterEqual(m["kontrola"]["serizeni"]["podelne"], 5.0)
            ax = m["kontrola"]["serizeni"].get("axialne")
            if ax:
                self.assertGreaterEqual(min(ax), 5.0, m["nazev"])
            drz = next(t for t in m["telesa"] if t["name"] == "Drzak")
            slots = [p["slot"] for p in drz["body"]["cut"] if "slot" in p]
            self.assertEqual(len(slots), 2)
            for s in slots:
                self.assertAlmostEqual(math.dist(s["p1"], s["p2"]), 10.0)

    def test_prostor_konektoru_volny(self):
        for m in self.plan["moduly"]:
            z = next(t for t in m["telesa"] if t["name"] == "Prostor_konektoru")
            zb = _aabb(z["body"])
            for p in next(t for t in m["telesa"] if t["name"] == "Drzak")["body"]["add"]:     # deska / stojna zvlášť
                self.assertFalse(_overlap(zb, _aabb({"add": [p]})), (m["nazev"], p))
            prof = ([0, -20, 0], [300, 20, 40])
            self.assertFalse(_overlap(zb, prof), m["nazev"])

    def test_kabel_polomer(self):
        for m in self.plan["moduly"]:
            self.assertAlmostEqual(m["kontrola"]["kabel_R_cesta"], m["kontrola"]["kabel_R"], places=3)
            self.assertGreaterEqual(m["kontrola"]["kabel_R"], 10 * 4.3)

    def test_cil_moc_blizko(self):
        with self.assertRaises(ValueError):
            modul_snimac.modul("IFS204", (50, 5, 72))

    def test_nizky_cil_varuje(self):
        m = modul_snimac.modul("IFS204", (50, 45, 50))
        self.assertTrue(m["varovani"])
        self.assertGreater(m["kontrola"]["celo"][2], 50)


class ZonyRulesTest(unittest.TestCase):
    def test_pomocne_zony(self):
        self.assertEqual(rules.typ_dilu({"Konstrukce_Zona": "konektor"}), "pomocny")
        self.assertEqual(rules.typ_dilu({"Konstrukce_Zona": "zdvih"}), "zona")
        self.assertEqual(rules.pomocna_zona({"Konstrukce_Zona": "Hadice"}), "hadice")
        self.assertIsNone(rules.pomocna_zona({"Konstrukce_Zona": "zdvih"}))
        self.assertEqual(rules.zona_vyjimky({"Konstrukce_ZonaVyjimka": "M1_snimac_4, M1_Vidlice"}), {"M1_snimac_4", "M1_Vidlice"})

    def test_s1_zony_nesou_druh_a_vyjimky(self):
        for m in modul_snimac.lavice_s1()["moduly"]:
            z = [t for t in m["telesa"] if t["props"].get("Konstrukce_Zona")]
            self.assertEqual(len(z), 2, m["nazev"])
            for t in z:
                self.assertIn(t["props"]["Konstrukce_Zona"], rules.POMOCNE_ZONY)
                self.assertTrue(t["vyjimka"])
                for ref in t["vyjimka"]:
                    kind, _s, key = ref.partition(":")
                    if kind == "inst":
                        self.assertLess(int(key), len(m["instance"]))


class SpojkyPneuTest(unittest.TestCase):
    def test_volba_a_data(self):
        v = spojky_pneu.volba_pro_valec("G1/8", grla=True)
        self.assertEqual(v["fitting"], "GRLA-1/8-QS-6-RS-D")
        self.assertEqual(spojky_pneu.volba_pro_valec("G1/4")["fitting"], "QS-G1/4-8")
        self.assertEqual(spojky_pneu.volba_pro_valec("M5x0.8")["hose"], "festo_PUN_4x0.75")
        self.assertEqual(spojky_pneu.sroubeni("QS-G1/8-6")["zasun"], 17)
        self.assertEqual(spojky_pneu.hadice(6)["R_prutok"], 26.5)

    def test_port_hadice_zasunuta_a_polomer(self):
        for fit, hose, tower in (("QS-G1/8-6", "festo_PUN_6x1", [0, -1, 0]), ("GRLA-1/8-QS-6-RS-D", "festo_PUN_6x1", [0, -1, 0]),
                                 ("QSM-M5-4", "festo_PUN_4x0.75", [1, 0, 0])):
            w = [0, 0, 1] if fit.startswith("GRLA") else tower
            r = spojky_pneu.port({"seat": [0, 0, 0], "n": [0, 0, 1], "fitting": fit, "hose": hose, "tower": tower, "w": w})
            h = r["hadice"]
            a, b = h["path"][0]["line"]
            self.assertAlmostEqual(math.dist(a, h["usti"]), h["zasun"], places=6)          # čelo hadice = hloubka zasunutí
            self.assertLessEqual(h["zasun"], rules.ZASUN_MAX)
            self.assertAlmostEqual(spojky_pneu.ohyb_z_cesty(h["path"]), h["R"], places=3)
            self.assertGreaterEqual(h["R"], h["R_min"])
            self.assertTrue(r["dil"]["zastupny"])
            self.assertEqual(r["dil"]["typ"], "sroubeni")

    def test_frame(self):
        R = spojky_pneu.frame([0, 0, 1], [0, -1, 0])
        self.assertEqual([R[i][2] for i in range(3)], [0, 0, 1])
        self.assertEqual([R[i][0] for i in range(3)], [0, -1, 0])


class ModulP1Test(unittest.TestCase):
    def setUp(self):
        self.plan = modul_valec.lavice_p1()

    def test_tri_varianty_bez_varovani(self):
        self.assertEqual([m["tag"] for m in self.plan["moduly"]], ["-Y1", "-Y2", "-Y3"])
        self.assertEqual(len({d["key"] for d in self.plan["dily"]}), len(self.plan["dily"]))
        for m in self.plan["moduly"]:
            self.assertEqual(m["varovani"], [], m["nazev"])

    def test_sily(self):
        A, B, C = self.plan["moduly"]
        self.assertAlmostEqual(A["rozhrani"]["sily"]["F_ven_10bar_N"], round(math.pi * 32 ** 2 / 4, 1))
        self.assertAlmostEqual(A["rozhrani"]["sily"]["F_zpet_10bar_N"], round(math.pi * (32 ** 2 - 12 ** 2) / 4, 1))
        self.assertAlmostEqual(B["rozhrani"]["sily"]["F_ven_6bar_N"], round(math.pi * 50 ** 2 / 4 * 0.6, 1))
        self.assertAlmostEqual(A["rozhrani"]["sily"]["M_kotveni_10bar_Nm"], round(math.pi * 32 ** 2 / 4 * 32 / 1000, 2))
        self.assertEqual(C["rozhrani"]["sily"]["rameno_mm"], 20)

    def test_zdvih_a_pohyb(self):
        for m in self.plan["moduly"]:
            k = m["kontrola"]
            pm = json.loads(m["skupiny"][0]["props"]["Konstrukce_Pohyb"])
            self.assertEqual(pm, {"nazev": "pístnice vysunuta", "posun": [float(k["zdvih"]), 0.0, 0.0]})
            acc = [i for i in m["instance"] if i.get("skupina") == "Pistnice"]
            for i in acc:
                self.assertAlmostEqual(i["pos"][0], k["x_osazeni"])
            z = next(t for t in m["telesa"] if t["name"] == "Zona_zdvihu")["body"]["add"][0]["box"]
            self.assertGreaterEqual(z[1], k["konec"] + k["zdvih"])                      # zóna pokryje vysunutou polohu

    def test_srouby_zasroubovani(self):
        for m in self.plan["moduly"]:
            for t in m["kontrola"]["srouby"]:
                self.assertIn("≥", t, t)
            for s in m["dily"]:
                if s.get("gen") == "sroub_4762":
                    self.assertIn(int(s["params"]["l"]), spojky_mech.delky())
        # víko válce ISO 15552 (hliník, BG 16): M6 / M8 zašroubování ≥ 1,5·d a dřík nesmí na dno závitu
        for d, m_ in ((32, "M6"), (50, "M8")):
            p, _ = modul_valec.catalog_map.cylinder_spec("ISO 15552", d, 50)
            r = spojky_mech.delka_do_zavitu(m_, 4.5 if d == 32 else 5.5, p["params"]["BG"], "hlinik", pruchozi=False)
            self.assertTrue(r["ok"])
            self.assertGreaterEqual(r["v_zavitu"], rules.min_zasroubovani(float(m_[1:]), "hlinik") - rules.ZASROUB_TOL)
            self.assertLessEqual(r["v_zavitu"], p["params"]["BG"])

    def test_snimace_v_koncovych_polohach(self):
        for m in self.plan["moduly"]:
            k = m["kontrola"]
            B, A = k["snimace"]
            self.assertEqual((B["nazev"], B["poloha_pistu"], A["nazev"], A["poloha_pistu"]), ("B", "zasunuto", "A", "vysunuto"))
            self.assertLess(B["x"][1], k["L"] / 2)                    # B u zadního víka
            self.assertGreater(A["x"][0], k["L"] / 2)                 # A u předního víka
            self.assertGreaterEqual(B["x"][0], 0)
            self.assertLessEqual(A["x"][1], k["L"])
            for R, Rc in k["kabel_R"]:
                self.assertAlmostEqual(R, Rc, places=2)

    def test_hadice_polomery(self):
        for m in self.plan["moduly"]:
            self.assertEqual(len(m["kontrola"]["porty"]), 2)
            for R, Rc in m["kontrola"]["hadice_R"]:
                self.assertAlmostEqual(R, Rc, places=2)
            for q in m["kontrola"]["porty"]:
                self.assertGreaterEqual(q["R"], q["R_min"])

    def test_rozhrani_uplne(self):
        for m in self.plan["moduly"]:
            r = m["rozhrani"]
            for k in ("kotveni", "pripojky", "elektro", "signaly", "zony", "obalka", "obalka_vysunuto", "hmotnost_kg", "sily",
                      "odhady", "zdroje"):
                self.assertIn(k, r)
            self.assertTrue(r["kotveni"] and r["pripojky"] and r["elektro"] and r["odhady"])
            for z in r["zdroje"]:
                self.assertTrue(z.startswith("http") or "SMC" in z or "ODHAD" in z, z)
        # kotvení do drážky profilu leží na drážce (y = 0, z = 40) i u natočeného válce C
        for m in self.plan["moduly"]:
            for k in m["rozhrani"]["kotveni"]:
                self.assertAlmostEqual(k["pos"][1], 0.0, places=6)
                self.assertAlmostEqual(k["pos"][2], 40.0, places=6)

    def test_nepodporovane(self):
        with self.assertRaises(ValueError):
            modul_valec.modul("-Y9", "ISO 15552", 32, 100, "oko")
        with self.assertRaises(ValueError):
            modul_valec.modul("-Y9", "ISO 15552", 33, 100, "patky")


@unittest.skipIf(os.environ.get("PRO3D_SKIP_FC") or not bench.available(), "FreeCAD (run_fc.ps1) není k dispozici")
class LaviceP1FreeCADTest(unittest.TestCase):
    def test_lavice_p1_kontroly(self):
        d = Path(tempfile.mkdtemp(prefix="p1_lavice_"))
        try:
            res = bench.build_and_check(modul_valec.lavice_p1(), d, slot="pro3d-p1-test", vysunuto=True)
            s = res["souhrn"]
            self.assertEqual(s["selhalo"], [], s)
            for k in ("kolize", "souvislost", "zasunuti", "kopie", "zony", "stav", "step"):
                self.assertEqual(s["kontroly"][k]["chyby"], 0, (k, s))
            ch = res["kontroly"]["checks"]
            self.assertTrue(any(p["poloha"] == "pístnice vysunuta" for p in ch["kolize"]["data"]["polohy"]))
            self.assertGreaterEqual(ch["zony"]["data"]["zon"], 6)
            zas = ch["zasunuti"]["data"]["sroubu"]
            self.assertTrue(all(x["posudek"]["uroven"] == "ok" for x in zas), [x["posudek"] for x in zas if x["posudek"]["uroven"] != "ok"])
            for p in s["snimky"]:
                self.assertTrue(Path(p).is_file() and Path(p).stat().st_size > 10000, p)
        finally:
            if not os.environ.get("PRO3D_KEEP"):
                shutil.rmtree(d, ignore_errors=True)


@unittest.skipIf(os.environ.get("PRO3D_SKIP_FC") or not bench.available(), "FreeCAD (run_fc.ps1) není k dispozici")
class LaviceFreeCADTest(unittest.TestCase):
    def test_lavice_kontroly(self):
        d = Path(tempfile.mkdtemp(prefix="s1_lavice_"))
        try:
            res = bench.build_and_check(modul_snimac.lavice_s1(), d)
            s = res["souhrn"]
            self.assertEqual(s["selhalo"], [], s)
            for k in ("kolize", "souvislost", "zasunuti", "kopie", "stav", "step"):
                self.assertEqual(s["kontroly"][k]["chyby"], 0, (k, s))
            zas = res["kontroly"]["checks"]["zasunuti"]["data"]["sroubu"]
            self.assertEqual(len(zas), 8)                    # 3 × 2 šrouby do matic T + 2 × M4 do desky WL12
            self.assertTrue(all(x["posudek"]["uroven"] == "ok" for x in zas))
            for p in s["snimky"]:
                self.assertTrue(Path(p).is_file() and Path(p).stat().st_size > 10000, p)
        finally:
            if not os.environ.get("PRO3D_KEEP"):
                shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
