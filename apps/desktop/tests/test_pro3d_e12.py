"""Moduly E1 (konzola / stojan rozvaděče) a E2 (kabelové vedení) PLCdesk PRO — plán bez FreeCADu."""

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from plc_studio.pro3d_lib import modul_ostrov, modul_ram  # noqa: E402
from plc_studio.pro3d_lib import modul_stojan_rozvadece as e1m  # noqa: E402
from plc_studio.pro3d_lib import modul_vedeni as e2m  # noqa: E402

DATA = ROOT / "tests" / "data" / "rozvadec" / "01_PLCdesk_CAD.json"


def _kabelaz():
    try:
        modul_ostrov.trasa_mod()
        return True
    except RuntimeError:
        return False


class _Layout(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from plc_studio.pro3d_cabinet import cli
        cls.tmp = Path(tempfile.mkdtemp(prefix="e12_"))
        r = cli.generate(DATA, cls.tmp, no_fc=True)
        cls.layout = Path(r["layout"])
        cls.sk = e1m.nacti_skrin(cls.layout)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)


class E1Test(_Layout):
    def n1(self):
        return modul_ram.Ram(D=800, W=600, H=800, deska=False, podpory="patky", zatizeni_kg=20.0, ident="N1").build().rozhrani()

    def test_skrin_z_layoutu(self):
        sk = self.sk
        self.assertEqual((sk["w"], sk["h"], sk["d"]), (500.0, 700.0, 250.0))      # vzor 01: AX 1057.000 (1050 se nevejde)
        self.assertEqual(len(sk["glands"]), 3)
        self.assertIsNotNone(sk["z_vypinac"])

    def test_konzola(self):
        r = e1m.konzola_n1(self.sk, self.n1())
        roz = r["rozhrani"]
        self.assertEqual(roz["chyby"], [])
        self.assertTrue(all(v["ok"] for v in roz["vysky"]), roz["vysky"])
        b = roz["poloha_skrine"]["box"]
        self.assertGreaterEqual(b[1], 640.0 - 1e-6)                                 # skříň za konzolou (rám y 0…600 + 40)
        self.assertEqual(len(roz["vstupy_kabelu"]), 3)
        self.assertTrue(all(v["bod"][2] < b[2] for v in roz["vstupy_kabelu"]))      # vývodky ve dně
        self.assertEqual(len(roz["kotveni"]["skrin"]), 4)
        self.assertEqual(len(roz["kotveni"]["na_ram"]), 4)                           # 2 sloupky × (podélník + spodní příčka)
        self.assertEqual(len(r["otvory_skrine"]), 4)
        nl = roz["nosna_lista"]
        self.assertLess(nl["osa_od"][2], b[2] - e1m.GLAND_DROP)                     # příčka C0 pod skříní
        kinds = {i["druh"] for i in r["modul"]["instance"]}
        self.assertTrue({"profil", "uhelnik", "sroub", "matice", "zaslepka"} <= kinds)
        self.assertTrue(any("ODHAD" in o for o in roz["odhady"]))
        self.assertIn("F_tah_horni_sroub_skrine_N", roz["sily"])

    def test_konzola_obsazena_drazka(self):
        with self.assertRaises(ValueError):
            e1m.konzola_n1(self.sk, self.n1(), xc=100.0)                             # sloupek by šel přes roh rámu

    def test_vysky(self):
        k = e1m.vyska_kontrola(self.sk, 100.0)
        self.assertFalse(all(v["ok"] for v in k))                                    # přístroje pod 0,4 m
        z, k2 = e1m.vyska_skrine(self.sk, 0.0, 43.0)
        self.assertTrue(all(v["ok"] for v in k2))
        self.assertGreaterEqual(z, 400.0 - self.sk["z_pristroje"][0])

    def test_stojan(self):
        r = e1m.stojan(self.sk, pos=(1000.0, 0.0))
        roz = r["rozhrani"]
        self.assertEqual(roz["chyby"], [])
        self.assertTrue(any("kotvit" in v for v in roz["varovani"]))
        self.assertEqual(len(roz["kotveni"]["skrin"]), 4)
        self.assertEqual(r["modul"]["placement"]["pos"][0], 1000.0)

    def test_upravit_skrin_bez_fc(self):
        lp = self.tmp / "kopie_layout.json"
        shutil.copy(self.layout, lp)
        r = e1m.konzola_n1(self.sk, self.n1())
        e1m.upravit_skrin(lp, r["otvory_skrine"], stavet=False)
        L = json.loads(lp.read_text(encoding="utf-8"))
        self.assertEqual(len(L["hw"]["rear_holes"]), 4)
        self.assertEqual(L["hw"]["floor_holes"], [])


@unittest.skipUnless(_kabelaz(), "skill kabelaz-a-hadice není nainstalován")
class E2Test(_Layout):
    def test_zlab_geometrie(self):
        n1 = modul_ram.Ram(D=800, W=600, H=800, deska=False, ident="N1").build().rozhrani()
        p = next(x for x in n1["plochy"] if x["prvek"] == "podélník přední" and [round(v) for v in x["normala"]] == [0, 1, 0])
        z = e2m.Zlab(p, 90.0, 710.0)
        b = z.box()
        self.assertAlmostEqual(b[1], 40.0, places=3)
        self.assertAlmostEqual(b[4], 77.7, places=3)
        self.assertAlmostEqual(b[2], 760.0, places=3)
        self.assertGreaterEqual(len(z.holes), 3)
        self.assertEqual(len(z.pruhy([4.3, 4.3, 4.3])), 3)
        sp = e2m.spec_zlabu(z.typ, z.L, z.holes)
        self.assertEqual(sp["typ"], "zlab")
        self.assertFalse(sp["zastupny"])

    def test_zkusebni_sestava(self):
        res = e2m.zkusebni_sestava(self.layout)
        e2 = res["E2"]["rozhrani"]
        self.assertEqual(e2["nepostaveno"], [])
        self.assertEqual(len(e2["trasy"]), 3)
        for t in e2["trasy"]:
            self.assertGreaterEqual(t["R"], t["R_min"] - 1e-6)
            self.assertGreater(t["delka_s_rezervou_mm"], t["delka_mm"])
            self.assertIsNotNone(t["delka_katalog_m"])
        self.assertEqual(e2["uchytky"]["kusu"], 3)
        self.assertEqual(e2["zlaby"][0]["vylomeni_prstu"], 6)
        mod = res["E2"]["modul"]
        zl = [i for i in mod["instance"] if i["druh"] == "zlab"]
        self.assertEqual(zl[0]["props"]["Konstrukce_Vedeni"], "zlab")
        self.assertTrue(any(i["druh"] == "sroub" for i in mod["instance"]))           # žlab přišroubovaný k rámu
        self.assertTrue(all(i.get("mount") == "drazka" for i in mod["instance"] if i["druh"] == "uchyt"))
        self.assertTrue(all(k["props"]["Konstrukce_Typ"] == "kabel" for k in mod["kabely"]))
        fb = res["E2"]["zpetna_vazba"]
        self.assertTrue(any("svíracím rozsahem" in i["message"] for i in fb))        # EVC002 Ø4,3 < SKINTOP M20 6–13
        names = [m["typ"] for m in res["plan"]["moduly"]]
        self.assertIn("E1 konzola rozvaděče", names)
        self.assertIn("E2 kabelové vedení", names)
        out = Path(self.tmp) / "e12"
        files = e2m.write_outputs(res, out)
        self.assertTrue(all(Path(f).is_file() for f in files))
        self.assertIn("| kabel |", e2m.report_md(res))

    def test_vic_kabelu_nez_vyvodek(self):
        n1 = modul_ram.Ram(D=800, W=600, H=800, deska=False, ident="N1").build().rozhrani()
        e1 = e1m.konzola_n1(self.sk, n1)
        p = next(x for x in n1["plochy"] if x["prvek"] == "podélník přední" and [round(v) for v in x["normala"]] == [0, 1, 0])
        z = e2m.Zlab(p, 90.0, 710.0)
        kab = [{"id": f"W{i}", "od": f"z{i}", "start": [150.0 + 120 * i, 150.0, 850.0], "smer": [0, 0, 1], "medium": "ifm_EVC002"} for i in range(4)]
        r = e2m.modul(kab, z, e1["rozhrani"], e1["boxes"])
        self.assertEqual(len(r["rozhrani"]["nepostaveno"]), 1)
        self.assertTrue(any("vývodek" in i["message"] for i in r["zpetna_vazba"]))

    def test_celek_e1_e2(self):
        n1 = modul_ram.Ram(D=1200, W=700, H=900, deska=True, ident="N1").build().rozhrani()
        starts = [("W-S1", None, "snímač S1", [300.0, 350.0, 960.0], 4.3), ("W-S2", None, "snímač S2", [800.0, 350.0, 960.0], 4.3)]
        deska = [0.0, 0.0, 900.0 - n1["rozmery"]["deska_t"], 1200.0, 700.0, 900.0]
        r = e2m.celek_e1_e2(n1, starts, [], self.layout, plates=[deska])
        self.assertEqual(len(r["moduly"]), 2)
        self.assertEqual(len(r["smlouvy"]["E2"]["trasy"]), 2, r["nepostaveno"])
        self.assertTrue(any(p.get("kind") == "pruchod" for p in r["pozadavky_N1"]))  # kabel deskou → požadavek na N1


if __name__ == "__main__":
    unittest.main()
