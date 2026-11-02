"""Testy generátoru rozvaděče kódem (plc_studio/pro3d_cabinet) — rozmístění bez FreeCADu na manifestech vzorů 01, 03, 16, 20
(kopie ``PLCdesk_CAD.json`` a ``dily/parts_index.json`` z běhů automatického postupu v ``tests/data/rozvadec/``), data se
zdrojem, spojovací materiál, ROZVADEC.md, CLI ``--no-fc``; s FreeCADem (``run_fc.ps1`` skillu freecad-instance, vlastní slot
``pro3d-cabinet-test2``; ``PRO3D_SKIP_FC=1`` přeskočí) jeden běh na vzoru 20: normalizované díly ``pro3d_parts gen`` → rozvaděč
→ kontroly ``pro3d_tools vse`` bez chyb (kolize, souvislost, kusovník, zástupné díly) + snímek.

Spuštění (z apps/desktop):  python -m unittest tests.test_pro3d_cabinet -v
"""

from __future__ import annotations

import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("PLCSTUDIO_HOME", tempfile.mkdtemp(prefix="plcstudio_cab_"))

from plc_studio.pro3d_cabinet import cli, layout as L, report  # noqa: E402

DATA = Path(__file__).resolve().parent / "data" / "rozvadec"
VZORY = ("01", "03", "16", "20")
SLOT = os.environ.get("PRO3D_TEST_SLOT") or "pro3d-cabinet-test2"


def load(v: str):
    m = json.loads((DATA / f"{v}_PLCdesk_CAD.json").read_text(encoding="utf-8"))
    pi = json.loads((DATA / f"{v}_parts_index.json").read_text(encoding="utf-8"))
    return m, pi


def overlap(a, b, eps=1e-6):
    return all(a[2 * k] < b[2 * k + 1] - eps and b[2 * k] < a[2 * k + 1] - eps for k in range(3))


_PLANS: dict = {}


def plan(v: str) -> dict:
    if v not in _PLANS:
        m, pi = load(v)
        _PLANS[v] = L.plan(m, parts_index=pi)
    return _PLANS[v]


class DataTest(unittest.TestCase):
    def test_ztraty_zdroj(self):
        for code, it in L.load("ztraty")["polozky"].items():
            self.assertIn(it["stav"], ("doloženo", "výtah", "chybí"), code)
            if it["W"] is None:
                self.assertEqual(it["stav"], "chybí", code)
                continue
            self.assertGreater(it["W"], 0, code)
            z = it["zdroj"]
            self.assertTrue(z and z.get("url", "").startswith("http") and z.get("dokument"), code)
        met = L.load("ztraty")["metoda"]
        self.assertEqual(met["k_ocel"], 5.5)
        self.assertTrue(met["k_zdroj"]["url"].startswith("https://"))

    def test_mezery_zdroj(self):
        m = L.load("mezery")
        for k, it in list(m["polozky"].items()) + list(m["rady"].items()):
            self.assertIn(it["stav"], ("doloženo", "doloženo (skill)", "výtah"), k)
            z = it.get("zdroj") or m["rady"].get(it.get("ref") or "", {}).get("zdroj")
            self.assertTrue(z and z.get("dokument"), k)
        self.assertEqual(L.clear_of("6EP3334-7SB00-3AX0")["nad"], 45)
        self.assertEqual(L.clear_of("6ES7221-1BH50-0XB0")["bok"], 25)          # řada S7-1200 G2
        self.assertEqual(L.clear_of("6ES7214-1AF40-0XB0")["stav"], "doloženo (skill)")   # klasická S7-1200 F ≠ řada G2
        self.assertEqual(L.clear_of("XYZ")["stav"], "ODHAD")

    def test_skrine(self):
        cab = L.cabinets()
        self.assertGreaterEqual(len(cab), 5)
        areas = [c["plateW"] * c["plateH"] for c in cab]
        self.assertEqual(areas, sorted(areas))
        self.assertTrue(all(c["src"].startswith("https://") for c in cab))


class LayoutTest(unittest.TestCase):
    def test_vzory(self):
        for v in VZORY:
            with self.subTest(vzor=v):
                r = plan(v)
                m, _pi = load(v)
                self.assertTrue(r["ok"], r.get("chyba"))
                # rezerva ≥ 20 % na každé liště / desce
                for rl in r["rails"]:
                    self.assertGreaterEqual(rl["rezerva_pct"], 20.0, rl["name"])
                self.assertTrue(r["verdikt"]["rezerva_ok"])
                # obsah = manifest location cabinet (bez skříně), počty = qty
                want = {p["id"]: int(p["qty"]) for p in m["parts"] if p["location"] == "cabinet" and p["category"] != "cabinet"}
                got: dict = {}
                for d in r["devices"] + r["door"]["items"]:
                    if d["kind"] != "zarazka":
                        got[d["pid"]] = got.get(d["pid"], 0) + 1
                self.assertEqual(got, want)
                # pořadí modulů PLC = sloty stanice
                for st in m["plc"]["stations"]:
                    seq = [d["pid"] for d in r["devices"] if d.get("station") == st["index"]]
                    exp = [st["head"]] + [x["partId"] for x in sorted(st["modules"], key=lambda x: x["slot"])]
                    self.assertEqual(seq, exp)
                    xs = [d["box"][0] for d in r["devices"] if d.get("station") == st["index"]]
                    self.assertEqual(xs, sorted(xs, reverse=True), "zepředu zleva doprava (x klesá)")
                # tělesa bez průniku, uvnitř desky a hloubky skříně
                boxes = [d["box"] for d in r["devices"]]
                for i in range(len(boxes)):
                    for j in range(i + 1, len(boxes)):
                        self.assertFalse(overlap(boxes[i], boxes[j]), f"{r['devices'][i]['tag']} × {r['devices'][j]['tag']}")
                pl = r["plate"]
                for d in r["devices"]:
                    b = d["box"]
                    self.assertTrue(pl["x0"] <= b[0] and b[1] <= pl["x1"] and pl["z0"] <= b[4] and b[5] <= pl["z1"], d["tag"])
                    self.assertLessEqual(b[3] + float(d["mezery"].get("pred") or 0), r["yd"] + 1e-6, d["tag"])
                # zóny mezer bez cizích těles, dveřní přístroje mimo zóny
                self.assertEqual(r["konflikty_zon"], [])
                for d in r["door"]["items"]:
                    for z in r["zones"]:
                        self.assertFalse(overlap(d["box"], z["box"]), f"{d['tag']} × {z['name']}")
                # výška desky stačí
                self.assertLessEqual(r["vyska"]["potreba"], r["cabinet"]["plateH"])

    def test_vyber_skrine(self):
        for v in VZORY:
            with self.subTest(vzor=v):
                r = plan(v)
                p = r["pokusy"]
                self.assertTrue(p[-1]["ok"])
                self.assertTrue(all(not x["ok"] and x["proc"] for x in p[:-1]))
                # pokusy: skříň manifestu, pak od nejmenší — žádná menší vyhovující nezůstala nevyzkoušená
                tried = {x["skrin"].split()[-1] for x in p}
                ch = r["cabinet"]
                area = ch["plateW"] * ch["plateH"]
                for c in L.cabinets():
                    if c["plateW"] * c["plateH"] < area:
                        self.assertIn(c["orderCode"], tried)
        r20 = plan("20")
        self.assertEqual(r20["pokusy"][0]["skrin"], "Rittal 1050.000")
        self.assertIn("výška desky", r20["pokusy"][0]["proc"][0])
        self.assertTrue(r20["cabinet"]["zmena"])
        self.assertTrue(any(f["kind"] == "cabinet_too_small" for f in r20["zpetna_vazba"]))

    def test_bilance(self):
        for v in VZORY:
            with self.subTest(vzor=v):
                b = plan(v)["bilance"]
                self.assertGreater(b["Qv"], 0)
                self.assertGreater(b["A"], 0)
                self.assertEqual(b["k"], 5.5)
                self.assertIn(b["verdikt"], ("vyhovuje", "nevyhovuje", "nelze rozhodnout"))
                self.assertAlmostEqual(b["Qs"], round(5.5 * b["A"] * b["dT"], 2), places=1)
                # Qv = součet doložených ztrát řádků (nic se nedopočítává)
                self.assertAlmostEqual(b["Qv"], sum(x["W"] for x in b["radky"] if x["W"] is not None), places=1)
                self.assertTrue(all(x["W"] is None for x in b["radky"] if x["stav"] == "chybí"))
                self.assertLessEqual(b["ti"], 40.0)
                if b["verdikt"] == "nevyhovuje":
                    self.assertTrue(b["opatreni"])
        b20 = plan("20")["bilance"]
        self.assertEqual(b20["tdev"]["tag"], "-A1")            # S7-1200 G2 40 °C při plné specifikaci
        self.assertIn("2002-1201", " ".join(b20["chybi"]))

    def test_mezery_v_layoutu(self):
        r = plan("20")
        t1 = next(d for d in r["devices"] if d["tag"] == "-T1")
        z = next(z for z in r["zones"] if z["pro"] == "-T1")
        self.assertEqual((z["nad"], z["pod"]), (45.0, 45.0))
        self.assertAlmostEqual(z["box"][5] - t1["box"][5], 45.0, places=2)
        duct_bottoms = [d["z0"] for d in r["ducts"] if d["orient"] == "h" and d["z0"] >= t1["box"][5]]
        self.assertGreaterEqual(min(duct_bottoms) - t1["box"][5], 45.0 - 1e-6)

    def test_sdileny_pas_16(self):
        r = plan("16")
        sil = next(x for x in r["rails"] if x["label"].startswith("Napájení"))
        poh = next(x for x in r["rails"] if x["label"].startswith("Pohony"))
        self.assertEqual(sil["pas"], poh["pas"])
        self.assertGreaterEqual(sil["rezerva_pct"], 20.0)
        self.assertGreaterEqual(poh["rezerva_pct"], 20.0)

    def test_hardware(self):
        r = plan("20")
        hw = r["hw"]
        devs = [d for d in r["devices"] if d["kind"] != "zarazka"]
        self.assertEqual(len(hw["studs"]), 4)
        self.assertTrue(all(s["norma"] == "ISO 4762" and s["l"] > 0 for s in hw["screws"]))
        rails = [x for x in r["rails"] if x["kind"] == "din"]
        for rl in rails:
            self.assertGreaterEqual(len(hw["rail_holes"][str(rl["n"])]), 2)
        for d in r["ducts"]:
            self.assertGreaterEqual(len(hw["duct_holes"][d["name"]]), 1)
        self.assertEqual(len(hw["endstops"]), sum(1 for d in r["devices"] if d["kind"] == "zarazka"))
        self.assertEqual(len([c for c in hw["door_cutouts"] if c["tag"] == "-P1"]), 1)   # MTP700 ve dveřích
        self.assertEqual(hw["door_axis"]["uhel"], -95.0)
        # hlavy šroubů na desce nezasahují do přístrojů (obálka hlavy × obálka přístroje)
        for s in hw["screws"]:
            if s["dir"] != [0.0, -1.0, 0.0]:
                continue
            x, y, z = s["head"]
            hb = [x - s["dk"] / 2, x + s["dk"] / 2, y, y + s["k"], z - s["dk"] / 2, z + s["dk"] / 2]
            for d in devs:
                if "ve dveřích" in s["ucel"]:
                    continue
                self.assertFalse(overlap(hb, d["box"], 0.01), f"{s['name']} × {d['tag']}")

    def test_bez_skrinovych_dilu(self):
        r = L.plan({"parts": [], "plc": {"stations": []}})
        self.assertFalse(r["ok"])
        self.assertIn("cabinet", r["chyba"])


class DvereTest(unittest.TestCase):
    """Dveře, kabeláž ke dveřím, oddělení tras, PE / N a ventilátor (pro3d_cabinet/dvere.py) na vzorech 16 a 20."""

    def test_vrtaci_obrazce(self):
        for v in ("16", "20"):
            with self.subTest(vzor=v):
                r = plan(v)
                dv, hw = r["dvere"], r["hw"]
                self.assertEqual(dv["chyby"], [])
                q0 = next(d for d in r["door"]["items"] if d["tag"] == "-Q0")
                xc, zc = (q0["box"][0] + q0["box"][1]) / 2, (q0["box"][4] + q0["box"][5]) / 2
                holes = [h for h in hw["door_holes"] if h.get("tag") == "-Q0"]
                four = sorted((round(h["x"] - xc, 3), round(h["z"] - zc, 3)) for h in holes if h["d"] == 5.0)
                self.assertEqual(four, [(-24.0, -24.0), (-24.0, 24.0), (24.0, -24.0), (24.0, 24.0)])   # 48 × 48, Ø5 (3LD2 str. 5)
                self.assertEqual(len([s for s in hw["screws"] if s["name"].startswith("Šroub -Q0")]), 4)
                fb = next(f for f in dv["front_blocks"] if f["tag"] == "-Q0")
                self.assertAlmostEqual(fb["box"][1] - fb["box"][0], 66.0)
                self.assertAlmostEqual(fb["box"][3] - fb["box"][2], 39.0)
                p1 = next(d for d in r["door"]["items"] if d["tag"] == "-P1")
                cut = next(c for c in hw["door_cutouts"] if c["tag"] == "-P1")
                self.assertAlmostEqual(cut["x1"] - cut["x0"], 197.0)
                self.assertAlmostEqual(cut["z1"] - cut["z0"], 141.0)
                clips = [c["box"] for c in dv["clips"] if "-P1" in c["name"]]
                self.assertEqual(len(clips), 6)
                b = p1["box"]
                top = [c for c in clips if abs(c[4] - b[5]) < 1e-6]
                bot = [c for c in clips if abs(c[5] - b[4]) < 1e-6]
                side = [c for c in clips if abs(c[0] - b[1]) < 1e-6 or abs(c[1] - b[0]) < 1e-6]
                self.assertEqual((len(top), len(bot), len(side)), (2, 2, 2))
                # přístroje na dveřích (vnitřní obálka) bez průniku s přístroji a žlaby na desce a navzájem
                inner = [d["box"] for d in r["door"]["items"]] + [c for c in clips]
                for a in inner:
                    for d in r["devices"]:
                        if d["kind"] != "zarazka":
                            self.assertFalse(overlap(a, d["box"]), d["tag"])
                    for dct in r["ducts"]:
                        self.assertFalse(overlap(a, [dct["x0"], dct["x1"], dct["y0"], dct["y1"], dct["z0"], dct["z1"]]), dct["name"])

    def test_kabelaz_ke_dverim(self):
        from plc_studio.pro3d_cabinet import dvere as DV
        rr = DV.radius_rule()
        self.assertGreaterEqual(rr["pohyblive"], 10.0)                    # dveře = pohyblivě (skill kabelaz-a-hadice)
        for v in ("16", "20"):
            with self.subTest(vzor=v):
                r = plan(v)
                kd = r["kabelaz_dvere"]
                self.assertEqual(set(kd), {"silovy", "signal"})
                for k, b in kd.items():
                    self.assertEqual(b["chyby"], [], k)
                    fr = b["volny"]
                    self.assertTrue(fr["ok"])
                    self.assertGreaterEqual(fr["delka"], fr["potreba"] * 1.10 - 1e-6)    # ≥ potřeba v 95° + rezerva 10 %
                    self.assertEqual(fr["potreba_uhel"], 95.0)
                    self.assertGreaterEqual(fr["R"], b["R_pohyb"] - 1e-6)
                    for t in b["tubes"]:
                        arcs = [e for e in t["prvky"] if e[0] == "oblouk"]
                        rmin = b["R_pohyb"] if t["ulozeni"] == "pohyblive" else min(x.get("R", 1e9) for x in b["vetve"] + [{"R": b["R_pevne"]}])
                        for e in arcs:
                            self.assertGreaterEqual(e[5], rmin - 1e-6, t["name"])
                    # nezávislý přepočet potřeby délky v 95°
                    ctx = DV.Door(r)
                    pd = (b["x_kmen"], b["y_kmen"], b["D"] / 2)
                    need, ang = DV._need_len(ctx, pd, (b["x_kmen"], b["y_kmen"]), b["z_upinka_dvere"] - b["z_upinka_bok"])
                    self.assertAlmostEqual(need, fr["potreba"], delta=0.2)
                    self.assertGreater(need, abs(b["z_upinka_dvere"] - b["z_upinka_bok"]))   # otevření dráhu prodlouží
                    # dveřní části se pohybují s dveřmi, volný a pevný úsek ve skříni
                    self.assertEqual({t["part"] for t in b["tubes"]}, {"door", "fixed"})
                    self.assertTrue(b["door_clamps"] and b["cab_clamps"])
                pohyb = r["hw"]["door_axis"]
                self.assertEqual(pohyb["uhel"], -95.0)

    def test_oddeleni(self):
        for v in ("16", "20"):
            with self.subTest(vzor=v):
                r = plan(v)
                od = r["oddeleni"]
                self.assertEqual(od["min_mm"], 250.0)
                self.assertTrue(od["tabulka"])
                self.assertTrue(all(x["ok"] for x in od["tabulka"]), od["tabulka"])
                self.assertTrue(r["verdikt"]["oddeleni_ok"])
                mixed = [d["name"] for d in od["ducts"] if d["druh"] == "smiseny"]
                self.assertTrue(mixed)
                self.assertEqual(sorted(p["zlab"] for p in od["prepazky"]), sorted(mixed))     # smíšený žlab = přepážka
                for p in r["hw"]["partitions"]:
                    self.assertTrue(p["screws"])                                                # uzemnění šrouby do desky
                ok_pairs = [x for x in od["tabulka"] if x["vzdalenost"] < 250.0]
                self.assertTrue(all(x["prepazka"] for x in ok_pairs))
        pls = plan("20")["oddeleni"]["delici_plechy"]
        self.assertEqual(len(pls), 2)                                       # u pantu blíž než 250 mm → dělicí plechy

    def test_pe_n(self):
        for v in ("16", "20"):
            with self.subTest(vzor=v):
                r = plan(v)
                hw, pr = r["hw"], r["pripojnice"]
                bb = hw["busbars"]
                y_plate = r["plate"]["y1"]
                self.assertAlmostEqual(bb["PE"]["box"][2], y_plate)                       # PE na desce
                pe_scr = [s for s in hw["screws"] if s["name"].startswith("Šroub PE")]
                n_scr = [s for s in hw["screws"] if s["name"].startswith("Šroub N")]
                self.assertEqual((len(pe_scr), len(n_scr)), (2, 2))
                for s in pe_scr:
                    self.assertLess(s["head"][1] - s["l"], y_plate)                       # do závitu desky (vodivě)
                iz = pr["izolator"]
                self.assertGreater(bb["N"]["box"][2] - y_plate, 0)                        # N nad deskou na izolátorech
                for s in n_scr:
                    tip = s["head"][1] - s["l"]
                    self.assertGreater(tip, y_plate + float(iz["hloubka"]))                # šroub N nekončí v desce ani u závrtného
                    self.assertGreaterEqual(tip, y_plate + float(iz["h"]) - float(iz["hloubka"]) - 1e-6)
                for st in bb["studs"]:
                    self.assertLessEqual(st["y1"], y_plate + float(iz["hloubka"]) + 1e-6)
                    self.assertTrue(all(st["y1"] < s["head"][1] - s["l"] for s in n_scr))  # kov N × kov desky se nedotýká
                for b_ in (bb["PE"]["box"], bb["N"]["box"]):
                    for d in r["devices"]:
                        self.assertFalse(overlap(b_, d["box"]), d["tag"])

    def test_ventilator(self):
        for v in ("16", "20"):
            with self.subTest(vzor=v):
                b = plan(v)["bilance"]
                f = b["ventilator"]
                self.assertEqual(f["verdikt"], "vyhovuje")
                t = f["typ"]
                self.assertTrue(t["zdroj"]["url"].startswith("https://www.rittal.com/"))
                self.assertAlmostEqual(f["Q"], b["Qv"] + t["P"], places=2)                  # vlastní příkon ventilátoru v Q
                self.assertAlmostEqual(f["ti_s"], b["tamb"] + b["f"] * f["Q"] / t["V_filtr"], places=1)
                self.assertAlmostEqual(f["rezerva_K"], b["ti"] - f["ti_s"], places=1)
                self.assertEqual(f["rezerva_ok"], f["rezerva_K"] >= 2.0)
                if not f["rezerva_ok"]:
                    self.assertTrue(any("rezerva" in w for w in f["varovani"]))
        self.assertTrue(plan("20")["bilance"]["ventilator"]["rezerva_ok"])
        self.assertFalse(plan("16")["bilance"]["ventilator"]["rezerva_ok"])           # 0,4 K < 2 K → varování
        hw = plan("20")["hw"]
        self.assertEqual(sorted(round(c["x1"] - c["x0"]) for c in hw["door_cutouts"]), [177, 177, 197])

    def test_report_dvere(self):
        t = report.md(plan("20"))
        for s in ("## Tepelná bilance s filtračním ventilátorem", "## Dveře — výřezy, vrtací obrazce", "## Kabeláž ke dveřím",
                  "## Oddělení silových a signálových tras", "## PE a N přípojnice", "SK 3239.124", "3LD2103", "A5E52645531",
                  "kabelaz-a-hadice", "G120C"):
            self.assertIn(s, t)


class ReportCliTest(unittest.TestCase):
    def test_md(self):
        t = report.md(plan("20"), {"ok": True, "objektu": 10, "odkazu": 5, "zastupnych": 1, "sroubu": 3})
        for s in ("## Souhrn", "## Lišty a pásy", "## Mezery výrobců", "## Tepelná bilance", "CHYBÍ ztráta", "ODHAD:",
                  "## Zpětná vazba pro PLCdesk", "cabinet_too_small", "docs.rs-online.com"):
            self.assertIn(s, t)

    def test_cli_no_fc(self):
        d = Path(tempfile.mkdtemp(prefix="cab_cli_"))
        (d / "dily").mkdir()
        shutil.copy(DATA / "20_PLCdesk_CAD.json", d / "PLCdesk_CAD.json")
        shutil.copy(DATA / "20_parts_index.json", d / "dily" / "parts_index.json")
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = cli.main([str(d / "PLCdesk_CAD.json"), str(d), "--no-fc"])
        s = json.loads(buf.getvalue().strip().splitlines()[-1])
        self.assertEqual(rc, 1)                                  # tepelná bilance nevyhovuje
        self.assertEqual(s["skrin"], "Rittal 1076.000")
        self.assertTrue((d / "rozvadec" / "layout.json").is_file())
        self.assertIn("Tepelná bilance", (d / "rozvadec" / "ROZVADEC.md").read_text(encoding="utf-8"))
        bad = Path(tempfile.mkdtemp(prefix="cab_bad_"))
        (bad / "PLCdesk_CAD.json").write_text("{}", encoding="utf-8")
        with redirect_stdout(io.StringIO()):
            self.assertEqual(cli.main([str(bad / "PLCdesk_CAD.json"), str(bad), "--no-fc"]), 2)


def _fc_available() -> bool:
    return cli.run_fc_path() is not None and os.environ.get("PRO3D_SKIP_FC") != "1"


@unittest.skipUnless(_fc_available(), "FreeCAD (run_fc.ps1 skillu freecad-instance) není k dispozici")
class FreeCADTest(unittest.TestCase):
    """Jeden běh na vzoru 20: díly kódem → rozvaděč → kontroly kódem (kolize, souvislost, kusovník, zástupné díly)."""

    @classmethod
    def setUpClass(cls):
        from plc_studio.pro3d_parts import gen
        from plc_studio.pro3d_tools import run
        cls.d = Path(tempfile.mkdtemp(prefix="cab_fc_"))
        shutil.copy(DATA / "20_PLCdesk_CAD.json", cls.d / "PLCdesk_CAD.json")
        with redirect_stdout(io.StringIO()):
            gen.main(["gen", str(cls.d / "PLCdesk_CAD.json"), str(cls.d / "dily"), "--slot", SLOT, "--timeout", "900"])
            cls.s = cli.generate(cls.d / "PLCdesk_CAD.json", cls.d, slot=SLOT, timeout=900)
        cls.fcstd = cls.d / "rozvadec" / "Rozvadec.FCStd"
        cls.rep = run.run_checks(cls.fcstd, out=cls.d / "rozvadec" / "kontroly", slot=SLOT, timeout=1800) if cls.fcstd.is_file() else {}

    def test_model(self):
        self.assertTrue(self.s["ok"], self.s.get("chyba"))
        self.assertTrue(self.fcstd.is_file())
        fc = self.s["fc"]
        self.assertTrue(fc["ok"], fc.get("chyby"))
        self.assertGreater(fc["odkazu"], 30)                    # přístroje dle dokumentace jako App::Link
        self.assertGreater(fc["sroubu"], 20)

    def test_kontroly(self):
        ch = self.rep.get("checks") or {}
        for k in ("kolize", "souvislost", "kusovnik", "stav", "step"):
            self.assertIn(k, ch)
            self.assertFalse(ch[k].get("selhalo"), k)
            self.assertEqual(ch[k].get("chyby"), [], f"{k}: {ch[k].get('chyby')}")
        sv = ch["souvislost"]["data"]
        self.assertEqual(sv["ve_vzduchu"], 0)
        self.assertEqual(sv["bez_spoje"], 0)
        self.assertEqual(sv["zlab_bez_spoje"], 0)
        self.assertEqual(ch["kolize"]["data"]["polohy"][0]["chyb"], 0)        # dveře otevřené 95° (i svazky a upínky)
        self.assertGreater(ch["kolize"]["data"]["polohy"][0]["dilu"], 15)
        self.assertFalse(any("nemá spojovací prvky" in i["text"] for i in ch["souvislost"].get("info") or []))

    def test_snimek(self):
        from plc_studio import pro_pipeline as pp
        p = self.d / "rozvadec" / "snimky" / "generator_celo.png"
        self.assertTrue(p.is_file())
        self.assertGreater(pp.png_nonwhite_pct(p), 5.0)
        o = self.d / "rozvadec" / "snimky" / "generator_dvere_otevrene.png"     # dveře otevřené 95°
        self.assertTrue(o.is_file())
        self.assertGreater(pp.png_nonwhite_pct(o), 5.0)


if __name__ == "__main__":
    unittest.main()
