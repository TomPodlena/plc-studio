"""Knihovna spojek V4 / V2 a modul S1 (pro3d_lib): bez FreeCADu výpočty a plán, s FreeCADem zkušební deska + kontroly.

FreeCAD část běží jen s run_fc.ps1 (skill freecad-instance) a bez PRO3D_SKIP_FC; slot pro3d-s1-test."""

import math
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from plc_studio.pro3d_lib import bench, modul_snimac, spojky_el, spojky_mech
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
