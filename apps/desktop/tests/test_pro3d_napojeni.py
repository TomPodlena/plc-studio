"""Napojení schválených modulů N1 (rám) a P2 / P3 / P4 (pneumatika) do automatického postupu PLCdesk PRO — bez FreeCADu
a bez AI: rám kódem z konceptu (``pro3d_lib.ram_gen``), smlouva N1 v generátoru modulů (``pro3d_modules.pneu``: drážky,
deska, průchody), ostrov a úprava vzduchu na rámu podle smlouvy, MS6-SV-E jen se ``safety``, krok ``frame`` v postupu."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "plc_studio" / "pro3d_modules"))

from plc_studio import pro_pipeline as pp  # noqa: E402
from plc_studio.pro3d_lib import modul_ram, ram_gen  # noqa: E402
import layout as L  # noqa: E402
import pneu  # noqa: E402

D = HERE / "data" / "moduly"


def scene_with_frame(n: str):
    """Scéna vzoru: koncept z testovacích dat + rám N1 z plánu (obálky profilů a desky) — jako fc_scene nad Ram.FCStd."""
    man = json.loads((D / f"{n}_PLCdesk_CAD.json").read_text(encoding="utf-8"))
    scene = json.loads((D / f"{n}_scena.json").read_text(encoding="utf-8"))
    pr = ram_gen.params(man, scene)
    r = modul_ram.Ram(**pr["kw"]).build()
    roz = r.rozhrani()
    roz["rozmery"]["umisteni"] = pr["umisteni"]
    roz["_soubor"] = "ram/N1_N1.json"
    o = pr["umisteni"]
    objs = [x for x in scene["objects"] if x["doc"] == "koncept"]
    sh = lambda b: [b[0] + o[0], b[1] + o[1], b[2], b[3] + o[0], b[4] + o[1], b[5]]  # noqa: E731
    for i, m in enumerate(r.members):
        objs.append({"doc": "ram", "name": f"P{i}", "label": m["nazev"], "typ": "profil", "pid": "", "pid_inh": "", "pkey": "",
                     "zona": "", "kontext": False, "bb": sh(m["box"])})
    for k, (nm, b) in enumerate(r.boxes_extra):
        objs.append({"doc": "ram", "name": f"X{k}", "label": nm, "typ": "dil", "pid": "", "pid_inh": "", "pkey": "",
                     "zona": "", "kontext": False, "bb": sh(b)})
    return man, {"objects": objs, "files": {"ram": "", "koncept": ""}, "ram_roots": []}, roz, pr


class RamGenTest(unittest.TestCase):
    def test_rozmery_z_konceptu_vzor_20(self):
        man = json.loads((D / "20_PLCdesk_CAD.json").read_text(encoding="utf-8"))
        scene = json.loads((D / "20_scena.json").read_text(encoding="utf-8"))
        pr = ram_gen.params(man, scene)
        kw = pr["kw"]
        self.assertEqual((kw["D"], kw["W"], kw["H"]), (1950.0, 1250.0, 900.0))     # deska + nohy stolu konceptu
        self.assertTrue(kw["deska"])                                                # výchozí pracovní deska (schváleno)
        self.assertEqual(kw["podpory"], "patky")
        self.assertIn("koncept", pr["zdroj"])

    def test_bez_konceptu_odhad_a_kola(self):
        man = {"brief": {"desc": "Pojízdný přípravek na kolečkách"}, "parts": [{"id": "-Y1:cylinder", "category": "cylinder"}]}
        pr = ram_gen.params(man, None)
        self.assertEqual(pr["kw"]["podpory"], "kola")
        self.assertTrue(any("ODHAD" in x for x in pr["odhady"]))
        plan = modul_ram.plan_ramu(**pr["kw"])
        notes = ram_gen.decisions(plan, pr["kw"], man)
        self.assertTrue(any("diagonál" in x and "MKP" in x for x in notes))         # kola + válce = doporučení
        self.assertTrue(any("dlouhý šroub" in x and "ODHAD" in x for x in notes))

    def test_cli_no_fc_smlouva_a_umisteni(self):
        with tempfile.TemporaryDirectory() as d:
            s = ram_gen.generate(D / "20_PLCdesk_CAD.json", d, scene_path=D / "20_scena.json", no_fc=True)
            self.assertTrue(s["ok"], s)
            roz = json.loads(Path(s["rozhrani"]).read_text(encoding="utf-8"))
            self.assertEqual(roz["modul"], "N1")
            self.assertEqual(roz["rozmery"]["umisteni"], [0.0, 0.0, 0.0])
            self.assertTrue(roz["plochy"] and roz["deska"])
            self.assertTrue((Path(d) / "ram" / "RAM.md").is_file())

    def test_posun_planu(self):
        plan = modul_ram.plan_ramu(D=800, W=600, H=900)
        ram_gen.shift_plan(plan, [100.0, -50.0, 0.0])
        self.assertEqual(plan["moduly"][0]["placement"]["pos"], [100.0, -50.0, 0.0])


class SmlouvaN1Test(unittest.TestCase):
    def test_snap_na_volny_usek(self):
        _m, _s, roz, _p = scene_with_frame("20")
        f = pneu.faces(roz, [0, 0, 1])
        self.assertTrue(f)
        a, b = f[0]["free"][0]
        p = pneu._add(f[0]["p0"], f[0]["dir"], (a + b) / 2)
        head = [p[0] + 7.0 * abs(f[0]["dir"][1]), p[1] + 7.0 * abs(f[0]["dir"][0]), p[2] + 8.0]     # 7 mm vedle osy, díl 8 mm
        sn = pneu.snap(roz, head, [0, 0, -1])
        self.assertTrue(sn and sn["ok"], sn)
        self.assertAlmostEqual(math_dist(sn["p"], p), 0.0, 1)

    def test_pozadavky_formatu_n1(self):
        pr = pneu.pozadavky_n1([{"co": "průchod Ø15 v „deska“ (na pravoúhlé spojnici — poloha ODHAD)", "bod": [1, 2, 3], "proc": "x"},
                                {"co": "závit M6×9 v „deska“", "bod": [0, 0, 0]}])
        self.assertEqual(pr, [{"co": pr[0]["co"], "bod": [1, 2, 3], "d": 15.0, "proc": "x"}])


def math_dist(a, b):
    return sum((a[i] - b[i]) ** 2 for i in range(3)) ** 0.5


class PneumatikaTest(unittest.TestCase):
    def plan20(self, safety=True):
        man, sc, roz, _pr = scene_with_frame("20")
        if not safety:
            man = dict(man, safety=None, parts=[p for p in man["parts"] if p["category"] != "safety_valve"])
        pidx = json.loads((D / "20_parts_index.json").read_text(encoding="utf-8"))
        return L.plan(man, sc, folder=D, parts_index=pidx, require_models=False, n1=roz)

    def test_ostrov_na_ramu_podle_smlouvy(self):
        lay = self.plan20()
        pn = lay["pneu"]
        self.assertTrue(pn, "ostrov P3 + P2 postaven")
        self.assertEqual(len(pn["ventily"]), 7)
        self.assertTrue(pn["sv"])
        it = next(i for i in lay["items"] if i["id"] == pn["item"])
        self.assertEqual(it["model"], "moduly/Pneumatika.FCStd")
        self.assertIn("smlouva N1", it["upevneni"])
        # rozváděče jsou v ostrově — zástupné z konceptu se nestaví, hadice A / B vedou z portů ostrova
        self.assertTrue(all(d["src"] == "ostrov" for d in lay["devices"] if d["cat"] == "valve_solenoid"))
        hz = [r for r in lay["routes"] if r["druh"] == "hadice"]
        self.assertTrue(hz)
        self.assertTrue(all(r["trasa"]["od"].split(".")[0] in pn["ventily"] for r in hz))
        self.assertTrue(any(r["postavit"] for r in hz))
        mods = pn["plan"]["moduly"]
        self.assertEqual(mods[0]["props"]["Konstrukce_Modul"], "P2")
        pids = {i["props"].get("PLCdesk_Id") for m in mods for i in m["instance"] if (i.get("props") or {}).get("PLCdesk_Id")}
        self.assertTrue({"-Y1:valve_solenoid", "-YS1:safety_valve"} <= pids, pids)
        self.assertIsNotNone(lay["smlouva_n1"])

    def test_bez_modulu_bezpecnosti_bez_sv(self):
        lay = self.plan20(safety=False)
        pn = lay["pneu"]
        self.assertFalse(pn["sv"])
        mods = pn["plan"]["moduly"]
        self.assertFalse(any("MS6_SV" in i["model"] for i in mods[0]["instance"]))
        self.assertNotIn("Konstrukce_Bezpecnost", mods[0]["props"])

    def test_bez_smlouvy_postaru(self):
        man, sc, _roz, _pr = scene_with_frame("20")
        pidx = json.loads((D / "20_parts_index.json").read_text(encoding="utf-8"))
        lay = L.plan(man, sc, folder=D, parts_index=pidx, require_models=False)
        self.assertIsNone(lay["pneu"])
        self.assertIsNone(lay["smlouva_n1"])


class PipelineFrameTest(unittest.TestCase):
    def test_frame_gen_pred_stavitelem_a_prehled(self):
        calls = []

        def runner(pipe, role, prompt, extra, path):
            calls.append((path.name, prompt))
            unit = path.name.split("_")[1]
            n = int(path.name.split("kolo")[1].split("_")[0])
            if role == "k5":
                f = pp.k5_file(pipe.folder, unit, n)
                f.parent.mkdir(parents=True, exist_ok=True)
                f.write_text("Verdikt: VRÁCENO\n", encoding="utf-8")
            return {"state": "done", "cost": 0.0}

        gen = {"ok": True, "kod": 0, "rozhrani": "x/ram/N1_N1.json", "rozmery": {"D": 1950, "W": 1250, "H": 900, "podpory": "patky"},
               "venec": "104080", "hmotnost_kg": 224, "chyb_kontrol": 0, "zdroj": "koncept", "poznamky": ["spoj rámu = dlouhý šroub"]}
        with tempfile.TemporaryDirectory() as d:
            pipe = pp.Pipeline(d, {"meta": {"name": "T"}}, runner=runner, inputs_fn=lambda *a, **k: [], parts=True, max_rounds=1,
                               parts_fn=lambda *a, **k: {"souhrn": None, "chyba": ""},
                               cabinet_fn=lambda *a, **k: {"ok": False, "chyba": "test"},
                               frame_fn=lambda *a, **k: dict(gen), modules_fn=lambda *a, **k: {"ok": False, "chyba": "test"})
            pipe.state["units"]["concept"]["state"] = "approved"
            pipe.run()
            self.assertTrue(pipe.state["units"]["frame"]["generated"]["ok"])
            fp = [p for n, p in calls if n.startswith(f"{pp.UNIT_KEYS.index('frame'):02d}_frame_kolo1_builder")]
            self.assertTrue(fp and "VYGENEROVANÝ KÓDEM (pro3d_lib.ram_gen" in fp[0] and "N1_N1.json" in fp[0])
            md = (Path(d) / pp.SUMMARY_FILE).read_text(encoding="utf-8")
            self.assertIn("## Rám kódem", md)

    def test_bez_ai_s_generatory(self):
        seen = []
        with tempfile.TemporaryDirectory() as d:
            pipe = pp.Pipeline(d, {"meta": {"name": "T"}}, ai=False, generators=True, parts=True, inputs_fn=lambda *a, **k: [],
                               parts_fn=lambda *a, **k: {"souhrn": None, "chyba": ""},
                               cabinet_fn=lambda *a, **k: seen.append("cabinet") or {"ok": False},
                               frame_fn=lambda *a, **k: seen.append("frame") or {"ok": False},
                               modules_fn=lambda *a, **k: seen.append("modules") or {"ok": False})
            self.assertEqual(pipe.run(), "noai")
        self.assertEqual(seen, ["cabinet", "frame", "modules"])


if __name__ == "__main__":
    unittest.main()
