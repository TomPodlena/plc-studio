"""Modul T1 (pro3d_lib.modul_pripravek): role válců z popisu, osy na díl, zóny zdvihu, napojení na celek vzoru 20 (bez FreeCADu)."""

import json
import unittest
from pathlib import Path

from plc_studio.pro3d_lib import celek, modul_pripravek as mp

DATA = Path(__file__).resolve().parent / "data"
MAN20 = DATA / "moduly" / "20_PLCdesk_CAD.json"


def _box_hit(a, b, tol=1e-6):
    """Průnik kvádrů [x0, y0, z0, x1, y1, z1] s kladným objemem."""
    return all(min(a[i + 3], b[i + 3]) - max(a[i], b[i]) > tol for i in range(3))


class RoleTest(unittest.TestCase):
    def test_role_z_popisu(self):
        self.assertEqual(mp.role_valce("Upínka dílu 1"), mp.ROLE_UPIN)
        self.assertEqual(mp.role_valce("Clamp cylinder"), mp.ROLE_UPIN)
        self.assertEqual(mp.role_valce("Spannzylinder Teil"), mp.ROLE_UPIN)
        self.assertEqual(mp.role_valce("Těsnicí trn zkušebního otvoru přisunout"), mp.ROLE_TESN)
        self.assertEqual(mp.role_valce("Seal head"), mp.ROLE_TESN)
        self.assertEqual(mp.role_valce("Dichtkopf vorfahren"), mp.ROLE_TESN)
        self.assertEqual(mp.role_valce("Zdvih stolu"), mp.ROLE_ZDVIH)
        self.assertEqual(mp.role_valce("Lift unit"), mp.ROLE_ZDVIH)
        self.assertEqual(mp.role_valce("Hub Einheit"), mp.ROLE_ZDVIH)
        self.assertEqual(mp.role_valce("Přístroj zkoušky těsnosti — start měření"), mp.ROLE_OST)
        self.assertEqual(mp.role_valce("Razidlo značení dobrého dílu"), mp.ROLE_OST)

    def test_dil_vychozi(self):
        self.assertEqual(mp.dil_obalka(), {"L": 200.0, "W": 150.0, "H": 80.0})
        self.assertEqual(mp.dil_obalka({"L": 300})["L"], 300.0)


@unittest.skipUnless(MAN20.is_file(), "chybí manifest vzoru 20")
class Celek20Test(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.man = json.loads(MAN20.read_text(encoding="utf-8"))
        cls.stul = celek.StulBezDopravniku(cls.man, (0.0, 0.0, 0.0), 900.0, 15.0)
        cls.t1 = cls.stul.t1

    def test_pouzije_t1_a_role(self):
        self.assertIsNotNone(self.t1)
        r = self.t1["rozhrani"]
        self.assertEqual(r["modul"], "T1")
        rc = r["role_celkem"]
        self.assertEqual(rc[mp.ROLE_UPIN], 2)
        self.assertEqual(rc[mp.ROLE_TESN], 1)
        self.assertEqual(rc[mp.ROLE_OST], 4)
        self.assertTrue(r["dil"]["odhad"])

    def test_osy_miri_na_dil(self):
        db = self.t1["dilbox"]
        cx, cy = (db[0] + db[1]) / 2, (db[2] + db[3]) / 2
        for v in self.t1["rozhrani"]["valce"]:
            ox, oy, _z = v["pocatek"]
            d = v["osa"]
            # vektor z počátku k ose dílu je rovnoběžný se směrem pístnice a míří dopředu
            if d[0]:
                self.assertGreater((cx - ox) * d[0], 0)
                self.assertLess(abs(oy - cy), 1.0)
            else:
                self.assertGreater((cy - oy) * d[1], 0)
                self.assertLess(abs(ox - cx), 1.0)

    def test_zony_zdvihu_nekoliduji_s_dilem(self):
        db = self.t1["dilbox"]
        dil = [db[0], db[2], db[4], db[1], db[3], db[5]]
        for v in self.t1["rozhrani"]["valce"]:
            self.assertFalse(_box_hit(v["zona_zdvihu"], dil), v["tag"])
        for m in self.t1["moduly"]:
            for z in m["rozhrani"]["zony"]:
                self.assertFalse(_box_hit(z["bbox"], dil), m["tag"])

    def test_zdvih_konci_u_plochy(self):
        db = self.t1["dilbox"]
        for v in self.t1["rozhrani"]["valce"]:
            zb = v["zona_zdvihu"]
            d = v["osa"]
            lim = (zb[3] if d[0] > 0 else zb[0] if d[0] < 0 else zb[4] if d[1] > 0 else zb[1])
            face = (db[0] if d[0] > 0 else db[1] if d[0] < 0 else db[2] if d[1] > 0 else db[3])
            self.assertAlmostEqual(abs(face - lim), mp.MEZERA, delta=0.2)

    def test_smlouva_a_nepostaveno(self):
        r = self.stul.rozhrani()
        self.assertEqual(r["T1"]["modul"], "T1")
        self.assertTrue(r["T1"]["pozadavky_na_N1"])
        self.assertEqual(len(self.stul.cyl_tags), 7)

    def test_ostatni_mimo_pripravek(self):
        ob = self.t1["obalka"]
        ost = [m for m in self.stul.moduly_ext if m not in self.t1["moduly"]]
        self.assertEqual(len(ost), 4)
        for m in ost:
            ob_m = m["rozhrani"]["obalka"]
            self.assertFalse(_box_hit([ob_m[0], ob_m[1], ob_m[2], ob_m[3], ob_m[4], ob_m[5]], [ob[0], ob[1], ob[2], ob[3], ob[4], ob[5]]), m["tag"])

    def test_plan_celku_vzoru_20(self):
        c = celek.plan_celku(self.man, s_hadicemi=False, s_kabely=False)["celek"]
        self.assertTrue(c["smlouvy"].get("T1"))
        self.assertEqual(c["smlouvy"]["T1"]["role_celkem"][mp.ROLE_UPIN], 2)


    def test_snimace_podle_manifestu(self):
        """Počet snímačů polohy každého válce T1 = množství řádku cylinder_switch v manifestu (žádný navíc)."""
        for m in self.t1["moduly"]:
            tag = m["tag"]
            n_mod = len((m.get("kontrola") or {}).get("snimace") or [])
            self.assertEqual(n_mod, celek.pocet_snimacu(self.man, tag), tag)

    def test_sonda_valce_je_spicka_pistnice(self):
        """Čelist navazuje na špičku pístnice, ne na obálku modulu (ta je o 5 mm dál)."""
        tip, _ = mp.sonda_valce("ISO 15552", 32, 100)
        from plc_studio.pro3d_lib import modul_valec
        m = modul_valec.modul("-T", "ISO 15552", 32, 100, "patky", "nic", "deska", pos=[0.0, 0.0, 100.0], rot=modul_valec.RZ90, profil=40)
        self.assertAlmostEqual(tip, m["kontrola"]["konec"], places=6)
        self.assertLess(tip, m["rozhrani"]["obalka"][4])

    def test_kolize_kabelu_pomucka(self):
        from plc_studio.pro3d_lib import modul_vedeni
        self.assertTrue(modul_vedeni._kolize_kabelu([(0, 0, 0, 10, 10, 10)], [(5, 5, 5, 15, 15, 15)]))
        self.assertFalse(modul_vedeni._kolize_kabelu([(0, 0, 0, 10, 10, 10)], [(10, 0, 0, 20, 10, 10)]))


if __name__ == "__main__":
    unittest.main()
