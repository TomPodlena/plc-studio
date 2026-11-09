"""PLCdesk PRO — časy odezvy a zastavení pro S = K·T + C (ISO 13855): ``plc_studio/pro3d_parts/bezpecnost_casy``.

Data: každá položka doložená se zdrojem (url, dokument, strana, datum čtení) nebo se stavem „chybí“ a poznámkou.
Výpočet: řešené příklady KEYENCE (položka ``iso13855.priklad``, doložený zdroj) přepočtené z doby odezvy z tabulky
GL-R, tabulky SICK / Festo, vzorce výrobců, ODHAD u členů bez zdroje, CLI.
"""

from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("PLCSTUDIO_HOME", tempfile.mkdtemp(prefix="plcstudio_casy_"))

from plc_studio.pro3d_parts import bezpecnost_casy as bc  # noqa: E402

DATA = bc.load()


def S(**kw):
    terms = {k: v for k, v in kw.items() if k in bc.ROLES}
    opts = {k: v for k, v in kw.items() if k not in bc.ROLES}
    return bc.compute(DATA, terms, **opts)


class DataTest(unittest.TestCase):
    def test_kontrola_dat(self):
        self.assertEqual(bc.check_data(DATA), [])

    def test_kazda_hodnota_ma_zdroj_nebo_chybi(self):
        for it in DATA["polozky"]:
            with self.subTest(it["id"]):
                self.assertIn(it["stav"], bc.STATES)
                if it["stav"] == "doloženo":
                    z = it["zdroj"]
                    self.assertTrue(z["url"].startswith("http"))
                    self.assertTrue(z["dokument"] and z["strana"] and z["cteno"])
                    self.assertTrue(it.get("hodnota") is not None or it.get("tabulka") or it.get("vzorec"))
                else:
                    self.assertTrue(it.get("poznamka"), "chybí bez poznámky")
                    self.assertIsNone(it.get("hodnota"), "chybějící položka nesmí nést číslo")

    def test_kategorie_rozsahu(self):
        kats = {it["kategorie"] for it in DATA["polozky"] if it["stav"] == "doloženo"}
        for k in ("aopd", "skener", "logika", "vstup", "vystup", "rele", "ventil", "pohon", "brzda", "iso13855"):
            self.assertIn(k, kats)
        for i in ("iso13855.K_2000", "iso13855.K_1600", "iso13855.C_8d14", "iso13855.C_850", "iso13855.S_min_100",
                  "iso13855.S_500", "iso13855.priklad", "iso13855.2024_zmeny"):
            self.assertEqual(bc.by_id(DATA, i)["stav"], "doloženo", i)

    def test_vzorce_py_vyhodnotitelne(self):
        for it in DATA["polozky"]:
            vz = it.get("vzorec") or {}
            if vz.get("py"):
                with self.subTest(it["id"]):
                    bc._compile_expr(vz["py"])

    def test_casove_sloupce_cisla(self):
        for it in DATA["polozky"]:
            for r in it.get("tabulka") or []:
                for k, v in r.items():
                    if k in ("t_ms", "t_s_porucha", "t_s_normal"):
                        self.assertIsInstance(v, (int, float, type(None)), f"{it['id']} {k}={v!r}")


class Iso13855Test(unittest.TestCase):
    """Řešené příklady KEYENCE (iso13855.priklad): t1 z tabulky GL-R, t2 = 0,1 s doba zastavení zadání."""

    def priklad(self, n):
        return bc.by_id(DATA, "iso13855.priklad")["tabulka"][n]

    def test_priklad_1_1_kolmo_d25(self):
        p = self.priklad(0)
        r = S(aopd=["GL-R60H sloupec=t_ms_opt_kanal_AB"], dobeh=[f"{p['t2_s'] * 1000:g}ms"])
        self.assertAlmostEqual(r["cleny"][0]["t_ms"], p["t1_s"] * 1000, places=6)   # tabulka GL-R = příklad
        self.assertEqual(r["d_mm"], p["d_mm"])
        self.assertEqual(r["C_mm"], p["C_mm"])
        self.assertEqual(r["K_mm_s"], p["K"])
        self.assertAlmostEqual(r["S_mm"], p["S_mm"], places=1)
        self.assertAlmostEqual(r["S_mm"], bc.by_id(DATA, "iso13855.priklad")["hodnota"], places=1)
        self.assertTrue(r["odhad"])   # doběh zadán číslem → ODHAD

    def test_priklad_1_2_kolmo_d45(self):
        p = self.priklad(1)
        r = S(aopd=["GL-R08L sloupec=t_ms_opt_kanal_AB"], dobeh=["100ms"])
        self.assertAlmostEqual(r["cleny"][0]["t_ms"], p["t1_s"] * 1000, places=6)
        self.assertAlmostEqual(r["S_mm"], p["S_mm"], places=2)
        self.assertEqual(r["C_mm"], 850)

    def test_priklad_2_1_rovnobezne(self):
        p = self.priklad(2)
        r = S(aopd=["GL-R30L sloupec=t_ms_opt_kanal_AB"], dobeh=["100ms"], pristup="paralelne", H_mm=p["H_mm"])
        self.assertAlmostEqual(r["C_mm"], p["C_mm"])
        self.assertAlmostEqual(r["S_mm"], p["S_mm"], places=2)

    def test_pravidla_100_a_500(self):
        self.assertEqual(bc.safety_distance(20, 14, DATA)["S_mm"], 100.0)        # 40 mm < 100
        r = bc.safety_distance(300, 14, DATA)                                    # 600 → 1600·0,3 = 480 → 500
        self.assertEqual((r["S_mm"], r["K_mm_s"]), (500.0, 1600.0))
        r = bc.safety_distance(400, 30, DATA)                                    # 928 → 1600·0,4 + 128 = 768
        self.assertAlmostEqual(r["S_mm"], 768.0)
        self.assertIn("S_500", r["pravidla"])
        self.assertTrue(all(c["citace"] != "bez zdroje v datech" for c in r["pravidla"].values()))

    def test_vicepaprsek_a_dvourucni(self):
        self.assertAlmostEqual(bc.safety_distance(200, None, DATA, paprsku=1)["S_mm"], 1520.0)
        self.assertAlmostEqual(bc.safety_distance(200, None, DATA, paprsku=3)["S_mm"], 1170.0)
        self.assertAlmostEqual(bc.safety_distance(100, None, DATA, pristup="dvourucni")["S_mm"], 410.0)
        self.assertAlmostEqual(bc.safety_distance(100, None, DATA, pristup="dvourucni", zakryti=True)["S_mm"], 160.0)
        with self.assertRaises(bc.CasyError):
            bc.safety_distance(100, 90, DATA)
        with self.assertRaises(bc.CasyError):
            bc.safety_distance(100, 45, DATA, pristup="paralelne")


class TermTest(unittest.TestCase):
    def term(self, role, q):
        return bc.resolve_term(DATA, role, q)

    def test_c4c_tabulka_vyska_nahoru(self):
        self.assertEqual(self.term("aopd", "C4C d=14 h=900")["t_ms"], 14)
        self.assertEqual(self.term("aopd", "C4C d=14 h=950")["t_ms"], 15)   # nejbližší vyšší pole 1050 mm
        self.assertEqual(self.term("aopd", "C4C d=30 h=900")["t_ms"], 11)
        with self.assertRaises(bc.CasyError):
            self.term("aopd", "C4C d=14 h=2500")
        with self.assertRaises(bc.CasyError):
            self.term("aopd", "C4C h=900")   # bez d nelze

    def test_citace_zdroje(self):
        t = self.term("aopd", "C4C d=14 h=900")
        self.assertFalse(t["odhad"])
        self.assertIn("8014253", t["citace"])
        self.assertIn("http", t["citace"])

    def test_chybejici_logika(self):
        t = self.term("logika", "1214FC")
        self.assertIsNone(t["t_ms"])
        self.assertEqual(t["stav"], "chybí")
        r = S(aopd=["C4C d=14 h=900"], logika=["1214FC"], dobeh=["0.13"])
        self.assertIsNone(r["S_mm"])
        self.assertEqual(r["chybi"], ["logika"])
        t = self.term("logika", "1214FC t=60")
        self.assertEqual((t["t_ms"], t["odhad"]), (60.0, True))

    def test_cas_bez_jednotky(self):
        self.assertEqual(bc.parse_time("0.13"), 130.0)
        self.assertEqual(bc.parse_time("60"), 60.0)
        self.assertEqual(bc.parse_time("130ms"), 130.0)
        self.assertEqual(bc.parse_time("0,2 s"), 200.0)

    def test_ventil_a_odvzdusneni(self):
        t = self.term("ventil", "MS6-SV-E")
        self.assertEqual((t["polozka"], t["t_ms"]), ("ventil.festo.ms6-sv-e.doba_odezvy", 92.0))
        t = self.term("odvzdusneni", "MS6-SV-E v=10 p=6 p0=0.5")
        self.assertAlmostEqual(t["t_ms"], 1100.0)    # Tab. 15, porucha F (nejhorší)
        self.assertIn("t_s_porucha", t["vypocet"])
        t = self.term("odvzdusneni", "MS6-SV-E v=8 p=5 p0=0.7")   # nahoru 10 l / 6 bar, dolů 0,5 bar
        self.assertAlmostEqual(t["t_ms"], 1100.0)
        t = self.term("ventil", "566466")          # VUVG podle objednacího čísla
        self.assertEqual(t["t_ms"], 17)

    def test_vzorce_vyrobcu(self):
        self.assertEqual(self.term("aopd", "nanoScan3")["t_ms"], 70.0)
        self.assertEqual(self.term("aopd", "nanoScan3 n=3")["t_ms"], 100.0)
        self.assertEqual(self.term("aopd", "microScan3 tS=40")["t_ms"], 90.0)
        with self.assertRaises(bc.CasyError):
            self.term("aopd", "microScan3")          # tS není výchozí
        self.assertEqual(self.term("pohon", "G120 deb=0")["t_ms"], 16.0)
        self.assertEqual(self.term("pohon", "pohon.siemens.s210.sto.profisafe")["t_ms"], 24.0)
        self.assertEqual(self.term("vystup", "6ES7226-6DA32-0XB0")["t_ms"], 20.0)
        self.assertEqual(self.term("rele", "750101")["t_ms"], 40.0)

    def test_osa_kinematika_je_odhad(self):
        t = self.term("osa", "v=500 a=2000 tr=12")
        self.assertAlmostEqual(t["t_ms"], 262.0)
        self.assertAlmostEqual(t["brzdna_draha_mm"], 68.5)
        self.assertTrue(t["odhad"])

    def test_bezpecny_vzorec(self):
        for bad in ("__import__('os')", "a.b", "open('x')", "[1]"):
            with self.assertRaises(bc.CasyError):
                bc.eval_expr(bad, {"a": 1})


class CliTest(unittest.TestCase):
    def run_cli(self, *argv):
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = bc.main(list(argv))
        return code, buf.getvalue()

    def test_json_a_markdown(self):
        code, out = self.run_cli("--format", "json", "--aopd", "C4C d=14 h=900", "--ventil", "MS6-SV-E",
                                 "--doběh", "0.13")
        self.assertEqual(code, 0)
        res = json.loads(out)
        self.assertAlmostEqual(res["T_ms"], 14 + 92 + 130)
        self.assertAlmostEqual(res["S_mm"], 2000 * 0.236)
        code, md = self.run_cli("--format", "md", "--aopd", "C4C d=14 h=900", "--ventil", "MS6-SV-E", "--dobeh", "0.13")
        self.assertIn("**ODHAD**", md)
        self.assertIn("**S = 472 mm**", md)
        self.assertIn("8176552", md)   # citace návodu Festo

    def test_chybi_kod_1(self):
        code, md = self.run_cli("--format", "md", "--aopd", "C4C d=14 h=900", "--logika", "1214FC", "--dobeh", "0.1")
        self.assertEqual(code, 1)
        self.assertIn("**CHYBÍ**", md)

    def test_kontrola_a_hledat(self):
        self.assertEqual(self.run_cli("--kontrola")[0], 0)
        code, out = self.run_cli("--hledat", "PNOZ")
        self.assertIn("rele.pilz.pnoz_s1", out)


if __name__ == "__main__":
    unittest.main()
