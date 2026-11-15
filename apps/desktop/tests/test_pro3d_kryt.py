"""Modul O3 ochranný kryt s dveřmi a blokovacím spínačem (pro3d_lib.modul_kryt): plán, smlouva, požadavky na rám N1,
ISO 13857 / 14119 bez FreeCADu; s FreeCADem celá zkušební sestava N1 + O3 + P1 a kontroly ``vse`` VČETNĚ ``otvory``
(desítky minut — jen s ``PRO3D_O3_FC=1``, slot pro-o3)."""

import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from plc_studio.pro3d_lib import bench, modul_kryt, modul_ram
from plc_studio.pro3d_tools import rules

MOD = Path(__file__).resolve().parent / "data" / "moduly"


def _man(n):
    return json.loads((MOD / f"{n}_PLCdesk_CAD.json").read_text(encoding="utf-8"))


class KrytPlanTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.r = modul_kryt.zkusebni_sestava()
        cls.ro = cls.r["o3"]["rozhrani"]
        cls.mod = cls.r["o3"]["modul"]

    def test_bez_chyb(self):
        self.assertEqual(self.ro["chyby"], [])
        self.assertEqual(self.ro["varovani"], [])
        self.assertEqual(self.r["n1"]["kontrola"]["chyby"], [])

    def test_pozadavky_na_ram_prijaty(self):
        pr = self.r["n1"]["rozhrani"]["pruchody"]
        self.assertEqual(pr["odmitnuto"], [])
        self.assertEqual(len(pr["prijato"]), len(self.r["pozadavky"]))
        for q in self.ro["pozadavky_na_ram"]:
            if q.get("bod"):
                self.assertIn("zahloubeni", q)
        # deska N1 má otvory se zahloubením (díl desky se změnil proti rámu bez krytu)
        deska = [d for d in self.r["plan"]["dily"] if d["key"].startswith("Deska_")]
        self.assertEqual(len(deska), 1)
        self.assertGreaterEqual(len(deska[0]["body"]["cut"]), 2 * len(self.r["pozadavky"]))

    def test_srouby_maji_delku(self):
        txt = " ".join(json.dumps(m) for m in self.mod["instance"])
        self.assertIn("sroub", txt)
        self.assertFalse(any("žádná normalizovaná" in c for c in self.ro["chyby"]))

    def test_zona_uvnitr_a_volba_vyplne(self):
        z = self.ro["zony_nebezpeci"][0]["bbox"]
        ob = self.ro["obalka"]
        for i in range(3):
            self.assertGreater(z[i], ob[i])
            self.assertLess(z[i + 3], ob[i + 3])
        sr_p = rules.iso13857_sr(30.0, "ctverec")
        for v in self.ro["volba_vyplne"]:
            self.assertEqual(v["pletivo_pripustne"], v["vzdalenost_k_zone_mm"] >= sr_p, v)
            self.assertEqual(v["zvoleno"], "pc4")
        self.assertFalse(next(v for v in self.ro["volba_vyplne"] if v["stena"] == "pravý bok")["pletivo_pripustne"])
        self.assertEqual(self.ro["mezery"]["Sr_pozad_mm"], rules.iso13857_sr(modul_kryt.DATA["dvere"]["mezera"]))

    def test_dvere_pohyb_a_zony(self):
        sk = self.mod["skupiny"][0]
        pm = rules.pohyb(sk["props"])
        self.assertIn("otoc", pm)
        self.assertEqual(pm["otoc"]["uhel"], -modul_kryt.DATA["dvere"]["uhel"])
        dvere = [i for i in self.mod["instance"] if i.get("skupina") == "Dvere"]
        druhy = {i["druh"] for i in dvere}
        for d in ("profil", "vypln", "pant_dvere", "madlo", "ovladac", "zaslepka", "tesneni"):
            self.assertIn(d, druhy)
        pevne = {i["druh"] for i in self.mod["instance"] if i.get("skupina") != "Dvere"}
        self.assertIn("pant_pevny", pevne)
        self.assertIn("spinac", pevne)
        self.assertNotIn("ovladac", pevne)
        zony = {t["props"]["Konstrukce_Zona"]: t for t in self.mod["telesa"]}
        self.assertEqual(set(zony), {"dvere", "spinac"})
        for z in zony.values():
            self.assertTrue(rules.pomocna_zona(z["props"]), z["props"])   # pomocná, ne nebezpečí
        n = len(self.mod["instance"])
        idx = {int(x.split(":")[1]) for x in zony["dvere"]["vyjimka"]}
        self.assertEqual(idx, {j for j in range(n) if self.mod["instance"][j].get("skupina") == "Dvere"})

    def test_zastupne_a_zdroje(self):
        by = {d["key"]: d for d in self.r["plan"]["dily"]}
        for k, d in by.items():
            if k.startswith(("Pant", "Madlo", "Doraz", "Spinac", "Ovladac", "Tesneni", "Zaslepka")):
                self.assertTrue(d["zastupny"], k)
            self.assertTrue(d.get("zdroj"), k)
        self.assertTrue(any("31" in z and "104" in z for z in self.ro["zdroje"]))     # 3SE5232 šířka × délka doloženy
        self.assertTrue(self.ro["odhady"])

    def test_spinac_a_bezpecnost_navrh(self):
        b = self.ro["blokovani"]
        self.assertEqual(len(b), 1)
        self.assertEqual(b[0]["typ"], "3SE5232-0QV40")
        self.assertEqual(b[0]["smer_najezdu"], [0, 1, 0])
        self.assertIn("NÁVRH", self.ro["bezpecnost"]["stav"])
        sp = next(i for i in self.mod["instance"] if i["druh"] == "spinac")
        self.assertEqual(sp["props"]["PLCdesk_Id"], "-S2:safety_switch")
        self.assertIn("Konstrukce_Obchazeni", sp["props"])

    def test_manifest_01_blokovani(self):
        bl = modul_kryt.blokovani(_man("01"))
        self.assertEqual([b["device"] for b in bl], ["S2"])
        self.assertEqual(bl[0]["fn"]["kind"], "guard")
        self.assertIsNone(bl[0]["zamek"])

    def test_manifest_16_zamek_zpetna_vazba(self):
        man = _man("16")
        bl = modul_kryt.blokovani(man)
        self.assertEqual([b["device"] for b in bl], ["S2"])          # S3 = světelná závora (modul O4), ne kryt
        self.assertEqual(bl[0]["zamek"]["device"], "H4")
        r = modul_kryt.zkusebni_sestava(man)
        ro = r["o3"]["rozhrani"]
        self.assertEqual(ro["blokovani"][0]["typ"], "AZM201Z-SK-T-1P2PW-A")   # 3SE5232 nemá jištění → zámek + zpětná vazba
        self.assertTrue(ro["zpetna_vazba"])
        self.assertTrue(ro["varovani"])
        self.assertEqual(ro["chyby"], [])
        self.assertEqual(ro["bezpecnost"]["funkce"][0]["PLr_navrh"], "d")

    def test_manifest_16_jisteny_zamek_z_kusovniku(self):
        """PLCdesk od 2026-11-04: DO zámku = ``guard_lock`` (jištěné blokovací zařízení), S2 „zavřeno a zamčeno“ = jen
        kontakt zámku (guard_lock_contact) → O3 staví zámek bez zpětné vazby o chybějícím jištění."""
        man = _man("16")
        parts = man["parts"]
        for p in parts:
            if p.get("device") == "S2" and p.get("category") == "safety_switch":
                p.update(id="-S2:guard_lock_contact", category="guard_lock_contact", brand="", orderCode="")
            if p.get("device") == "H4":
                p.update(id="-H4:guard_lock", category="guard_lock", brand="Schmersal", orderCode="103013908")
        man["parts"] = parts
        bl = modul_kryt.blokovani(man)
        self.assertEqual([b["device"] for b in bl], ["S2"])
        self.assertTrue(bl[0]["zamek"]["jisteni"])
        ro = modul_kryt.zkusebni_sestava(man)["o3"]["rozhrani"]
        self.assertEqual(ro["blokovani"][0]["typ"], "AZM201Z-SK-T-1P2PW-A")
        self.assertFalse([f for f in ro["zpetna_vazba"] if f.get("kind") == "safety_part"])
        self.assertEqual(ro["chyby"], [])

    def test_bez_desky_chyba(self):
        n1 = modul_ram.plan_ramu(**modul_ram.VZORY["velky"])["rozhrani"]
        with self.assertRaises(ValueError):
            modul_kryt.kryt(n1, [])


@unittest.skipIf(not os.environ.get("PRO3D_O3_FC") or os.environ.get("PRO3D_SKIP_FC") or not bench.available(),
                 "FreeCAD sestava O3 + otvory (desítky minut) jen s PRO3D_O3_FC=1")
class KrytFreeCADTest(unittest.TestCase):
    def test_sestava_kontroly(self):
        d = Path(tempfile.mkdtemp(prefix="o3_"))
        try:
            res = modul_kryt.build_fc(modul_kryt.zkusebni_sestava(), d, slot=modul_kryt.SLOT)
            self.assertEqual(res["souhrn"]["chyb"], 0, res["souhrn"])
            self.assertEqual(res["souhrn"]["selhalo"], [])
            for s in res["souhrn"]["snimky"]:
                self.assertTrue(Path(s).is_file(), s)
        finally:
            shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
