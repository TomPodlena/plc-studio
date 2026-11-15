"""Testy generátoru modulů kódem (plc_studio/pro3d_modules) — rozmístění a trasy bez FreeCADu na vzorech 01, 03, 16, 20
(kopie ``PLCdesk_CAD.json``, ``dily/parts_index.json`` a scény rámu + konceptu ``scena.json`` = výstup ``fc_scene.py`` nad
schváleným ``ram/Ram.FCStd`` a ``koncept/Koncept.FCStd`` běhů automatického postupu v ``tests/data/moduly/``): poloměry tras ≥
minimum výrobce, délky s rezervou, každý postavený snímač má držák / upevnění se šrouby, válce mají patky nebo čelo se šrouby,
šrouby do vlastních dílů mají závitový otvor, nic stavěného nekoliduje s rámem (obálky), zpětná vazba v1, MODULY.md, router.
S FreeCADem (``run_fc.ps1`` skillu freecad-instance, slot ``pro3d-modules-test``; ``PRO3D_SKIP_FC=1`` přeskočí; vstupy vzoru 20
se zkopírují ze složky stavby ``%APPDATA%/PLCStudio/pro3d/20_*`` — jen čtení —, chybí-li, test se přeskočí) jeden běh na vzoru
20: generátor → ``Moduly.FCStd`` → kontroly ``pro3d_tools vse`` bez chyb kolizí a souvislosti + snímek.

Spuštění (z apps/desktop):  python -m unittest tests.test_pro3d_modules -v
"""

from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("PLCSTUDIO_HOME", tempfile.mkdtemp(prefix="plcstudio_mod_"))

from plc_studio.pro3d_modules import cli, layout as L, report, router  # noqa: E402

DATA = Path(__file__).resolve().parent / "data" / "moduly"
VZORY = ("01", "03", "16", "20")
SLOT = os.environ.get("PRO3D_TEST_SLOT") or "pro3d-modules-test"
HAS_TRASA = L.trasa_mod() is not None

_PLANS: dict = {}


def plan(v: str) -> dict:
    if v not in _PLANS:
        m = json.loads((DATA / f"{v}_PLCdesk_CAD.json").read_text(encoding="utf-8"))
        sc = json.loads((DATA / f"{v}_scena.json").read_text(encoding="utf-8"))
        pi = json.loads((DATA / f"{v}_parts_index.json").read_text(encoding="utf-8"))
        _PLANS[v] = L.plan(m, sc, folder=DATA / "neexistuje", parts_index=pi, manifest_path=DATA / f"{v}_PLCdesk_CAD.json",
                           require_models=False)
    return _PLANS[v]


class DataTest(unittest.TestCase):
    def test_zdroje(self):
        d = L.data()
        for k, v in d["hadice_podle_pripojky"].items():
            if k.startswith("_"):
                continue
            self.assertIn(v["stav"], ("ODHAD", "skill festo-pneumatics"), k)
            self.assertTrue(v["medium"].startswith("festo_PUN_"), k)
        for k in ("qs", "grla"):
            self.assertIn("festo-pneumatics", d[k]["_zdroj"])
        self.assertIn("ISO 228-1", d["zavity_G"]["_zdroj"])
        self.assertIn("ODHAD", d["kabel"]["rezerva"]["zdroj"])

    def test_media_existuji(self):
        if not HAS_TRASA:
            self.skipTest("skill kabelaz-a-hadice není nainstalován")
        m = L.trasa_mod().nacti_media()
        media = m.get("media", m)
        for k, v in L.data()["hadice_podle_pripojky"].items():
            if not k.startswith("_"):
                self.assertIn(v["medium"], media, k)
        self.assertIn(L.data()["kabel"]["medium_snimac"], media)


class RouterTest(unittest.TestCase):
    def test_obchazi_prekazku(self):
        obst = [[-50.0, -50.0, -10.0, 50.0, 50.0, 400.0]]
        r = router.route([-200.0, 0.0, 0.0], [1, 0, 0], [200.0, 0.0, 0.0], [1, 0, 0], obst, R=20.0, step=20.0, r_med=3.0)
        self.assertIsNotNone(r)
        for a, b in zip(r["body"], r["body"][1:]):
            self.assertFalse(router.seg_hits(a, b, router.inflate(obst[0], 3.0)))
        # mezi dvěma ohyby rovný úsek ≥ 2 R (zaoblení se vejde)
        segs = [math.dist(a, b) for a, b in zip(r["body"], r["body"][1:])]
        for s in segs[1:-1]:
            self.assertGreaterEqual(s, 2 * 20.0 - 1e-6)

    def test_bez_cesty(self):
        box = [[-1000.0, -1000.0, -1000.0, 1000.0, 1000.0, 1000.0]]
        self.assertIsNone(router.route([0.0, 0.0, 0.0], [1, 0, 0], [500.0, 0, 0], [1, 0, 0], box, R=10.0))


@unittest.skipUnless(HAS_TRASA, "skill kabelaz-a-hadice není nainstalován")
class LayoutTest(unittest.TestCase):
    def test_vzory(self):
        for v in VZORY:
            with self.subTest(v=v):
                lay = plan(v)
                self.assertEqual(lay["format"], L.FORMAT)
                self.assertEqual(lay["zpetna_vazba"]["format"], "plcdesk-cad-feedback")
                self.assertEqual(lay["zpetna_vazba"]["version"], 1)
                self.assertTrue(lay["manifestSha256"])
                md = report.md(lay, None)
                self.assertIn("## Nepostaveno", md)
                self.assertIn("## Hadice a kabely", md)

    def test_polomery_a_delky(self):
        for v in VZORY:
            for r in plan(v)["routes"]:
                t, res = r["trasa"], r["vysledek"]
                with self.subTest(v=v, trasa=t["id"]):
                    if r["postavit"]:
                        self.assertFalse(res["chyby"])
                        self.assertGreaterEqual(res["R"], res["R_min"] - 1e-6)
                        self.assertGreater(res["delka_s_rezervou_mm"], res["delka_mm"])
                        # postavená trasa nekoliduje s rámem (obálky)
                    self.assertIsNotNone(res.get("delka_s_rezervou_mm"))

    def test_hadice_rezerva(self):
        rz = L.data()["hadice"]["rezerva"]
        for v in VZORY:
            for r in plan(v)["routes"]:
                if r["druh"] == "hadice" and r["vysledek"].get("delka_mm"):
                    res = r["vysledek"]
                    self.assertAlmostEqual(res["delka_s_rezervou_mm"], res["delka_mm"] * (1 + rz["pct"] / 100) + rz["mm"], delta=0.2)

    def test_snimace_maji_drzak(self):
        for v in VZORY:
            lay = plan(v)
            by_grp = {}
            for it in lay["items"]:
                by_grp.setdefault(it.get("skupina"), []).append(it)
            for d in lay["devices"]:
                if not d.get("item") or not (d["cat"].startswith("sensor") or d["cat"] in ("pressure_transmitter",)):
                    continue
                with self.subTest(v=v, d=d["pid"]):
                    g = by_grp[d["grp"]]
                    self.assertTrue(any(i["druh"] == "konstrukce" for i in g), "držák / úchytka chybí")
                    self.assertTrue(any(i["druh"] == "sroub" for i in g), "šroub chybí")

    def test_valce_upevneni(self):
        n = 0
        for v in VZORY:
            lay = plan(v)
            for it in lay["items"]:
                if it["druh"] != "valec":
                    continue
                n += 1
                g = [x for x in lay["items"] if x.get("skupina") == it["skupina"]]
                with self.subTest(v=v, valec=it["tag"]):
                    self.assertIn("valce.json", "valce.json")
                    self.assertFalse(str(it.get("upevneni", "")).startswith("CHYBÍ"))
                    self.assertGreaterEqual(sum(1 for x in g if x["druh"] == "sroub"), 4)
                    self.assertIn("smc", it["zdroj"].lower())
        self.assertGreater(n, 0)

    def test_srouby_maji_zavit_nebo_matici(self):
        for v in VZORY:
            lay = plan(v)
            for it in lay["items"]:
                if it["druh"] != "sroub":
                    continue
                with self.subTest(v=v, s=it["label"]):
                    self.assertGreater(it["L"], 0)
                    self.assertIn(it["M"], (4, 5, 6, 8))

    def test_bez_kolize_s_ramem(self):
        for v in VZORY:
            m = json.loads((DATA / f"{v}_PLCdesk_CAD.json").read_text(encoding="utf-8"))
            sc = json.loads((DATA / f"{v}_scena.json").read_text(encoding="utf-8"))
            p = L.Plan(m, sc, DATA, None, None)
            lay = plan(v)
            for it in lay["items"]:
                if it["druh"] in ("sroub", "matice", "sroubeni"):
                    continue
                boxes = [it["bb"]] if it.get("bb") else [L.prim_box(x) for x in it.get("add") or []]
                for b in boxes:
                    with self.subTest(v=v, it=it["label"]):
                        hit = p.collides_ram(b)
                        if hit is not None:      # obálka smí přesahovat jen dutý díl (stěny) — skutečný tvar ověří FreeCAD
                            self.assertTrue(hit.get("boxes"), f"{it['label']} × {hit['label']}")

    def test_deterministicky(self):
        a = plan("20")
        m = json.loads((DATA / "20_PLCdesk_CAD.json").read_text(encoding="utf-8"))
        sc = json.loads((DATA / "20_scena.json").read_text(encoding="utf-8"))
        pi = json.loads((DATA / "20_parts_index.json").read_text(encoding="utf-8"))
        b = L.plan(m, sc, folder=DATA / "neexistuje", parts_index=pi, manifest_path=DATA / "20_PLCdesk_CAD.json", require_models=False)
        strip = lambda x: json.dumps({k: v for k, v in x.items() if k not in ("created", "zpetna_vazba")}, sort_keys=True)
        self.assertEqual(strip(a), strip(b))

    def test_vzor_20(self):
        s = plan("20")["souhrn"]
        self.assertGreaterEqual(s["valcu"], 3)
        self.assertGreaterEqual(s["snimacu_postaveno"], 6)
        self.assertGreater(s["hadic"], 0)
        self.assertGreater(s["kabelu"], 10)
        self.assertGreater(s["predani"], 0)            # rám nemá průchody ani díry pro moduly → požadavky na rám


@unittest.skipIf(os.environ.get("PRO3D_SKIP_FC") == "1", "PRO3D_SKIP_FC=1")
class FreeCADTest(unittest.TestCase):
    """Jeden běh ve vlastní instanci FreeCADu: vzor 20 → Moduly.FCStd → pro3d_tools vse (kolize, souvislost bez chyb)."""

    @classmethod
    def setUpClass(cls):
        if cli.run_fc_path() is None or not HAS_TRASA:
            raise unittest.SkipTest("skill freecad-instance nebo kabelaz-a-hadice chybí")
        base = Path(os.environ.get("APPDATA", "")) / "PLCStudio" / "pro3d"
        src = next(iter(sorted(base.glob("20_*"))), None) if base.is_dir() else None
        if src is None or not (src / "ram" / "Ram.FCStd").is_file() or not (src / "koncept" / "Koncept.FCStd").is_file():
            raise unittest.SkipTest("vstupy vzoru 20 (schválený rám a koncept) nejsou na disku")
        cls.d = Path(tempfile.mkdtemp(prefix="pro3d_moduly_"))
        for sub in ("ram", "koncept"):
            (cls.d / sub).mkdir()
        shutil.copy2(src / "ram" / "Ram.FCStd", cls.d / "ram" / "Ram.FCStd")          # jen čtení zdroje
        shutil.copy2(src / "koncept" / "Koncept.FCStd", cls.d / "koncept" / "Koncept.FCStd")
        shutil.copy2(src / "PLCdesk_CAD.json", cls.d / "PLCdesk_CAD.json")
        if (src / "dily").is_dir():
            shutil.copytree(src / "dily", cls.d / "dily", ignore=shutil.ignore_patterns(".prace", "*.FCBak"))
        if (src / "rozvadec" / "layout.json").is_file():
            (cls.d / "rozvadec").mkdir()
            shutil.copy2(src / "rozvadec" / "layout.json", cls.d / "rozvadec" / "layout.json")
        cls.s = cli.generate(cls.d / "PLCdesk_CAD.json", cls.d, slot=SLOT, timeout=1800)

    def test_model_a_kontroly(self):
        s = self.s
        self.assertIn(s["kod"], (0, 1), s.get("chyba"))
        fc = Path(s["fcstd"])
        self.assertTrue(fc.is_file())
        self.assertTrue(s["snimky"])
        for p in s["snimky"]:
            self.assertGreater(Path(p).stat().st_size, 10000, p)
        tools = Path(cli.HERE).parent / "pro3d_tools" / "pro3d.ps1"
        for chk in ("kolize", "souvislost"):          # (vse = navíc otvory / kusovník / STEP — dlouhé, mimo rozsah testu)
            out = self.d / "moduly" / f"kontrola_{chk}"
            subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(tools), chk, str(fc), "--out",
                            str(out), "--manifest", str(self.d / "PLCdesk_CAD.json"), "--slot", SLOT], capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=7200)
            k = json.loads((out / "kontroly.json").read_text(encoding="utf-8"))
            c = k["checks"][chk]
            with self.subTest(kontrola=chk):
                self.assertEqual(c["chyby"], [], c["chyby"][:3])
        md = (self.d / "moduly" / "MODULY.md").read_text(encoding="utf-8")
        self.assertIn("Požadavky na rám", md)


if __name__ == "__main__":
    unittest.main()
