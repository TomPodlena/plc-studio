"""PLCdesk PRO — generátory normalizovaných dílů (``plc_studio/pro3d_parts``).

Bez FreeCADu: rozbor typů, tabulky (zdroj u každé řady, kladné rozměry, vazby mezi rozměry), mapování manifestů vzorů
01 / 03 / 11 / 17 / 20 (pokrytí), CLI ``gen --no-fc`` a napojení do postupu (pokyn stavitele, PREHLED.md).
S FreeCADem (``run_fc.ps1`` skillu freecad-instance, vlastní slot ``pro3d-parts``; ``PRO3D_SKIP_FC=1`` přeskočí):
vzorek z každé kategorie (platná tělesa, obálka = tabulkový rozměr ± 0,1) a porovnání obálky s modely výrobců na disku
(jen čtení, pokud existují).
"""

from __future__ import annotations

import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("PLCSTUDIO_HOME", tempfile.mkdtemp(prefix="plcstudio_parts_"))

from plc_studio import pro_pipeline as pp  # noqa: E402
from plc_studio.pro3d_parts import catalog_map as cm  # noqa: E402
from plc_studio.pro3d_parts import gen  # noqa: E402
from plc_studio.pro3d_parts import typy  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
SAMPLES = {"01": "01_pasovy_dopravnik_vyhazovac", "03": "03_nytovaci_lis_NL-1", "11": "11_podavaci_lisovaci_stanice_PS-11",
           "17": "17_odberovy_manipulator_vstrikovaci_lis_OM-17", "20": "20_zkusebni_stanice_tesnosti_ZT-20"}
MFR_MODELS = {   # model výrobce na disku (jen čtení) → požadavek generátoru
    "ISO15552 32x100": [ROOT / ".claude" / "stroj01" / "02_Vykresy" / "3D" / "modely" / "1376426_DSBC-32-100-PPVA-N3.stp",
                        Path(r"C:\CLAUDE\plcdesk_freecad\pilot\11\models\3dfindit\Y1_cylinder.stp")],
    "IFS204": [Path(r"C:\CLAUDE\plcdesk_freecad\pilot\11\models\3dfindit\S4_sensor_inductive.stp")],
    "5SL6110-7": [Path(r"C:\CLAUDE\plcdesk_freecad\pilot\11\models\3dfindit\Q1_mcb.stp")],
    "6EP3334-7SB00-3AX0": [Path(r"C:\CLAUDE\plcdesk_freecad\pilot\11\models\3dfindit\T1_power_supply_24v.stp")],
    "6SL3210-5BE17-5UV0": [Path(r"C:\CLAUDE\plcdesk_freecad\pilot\11\models\3dfindit\TA1_vfd.stp")],
    "2002-1201": [Path(r"C:\CLAUDE\plcdesk_freecad\pilot\11\models\3dfindit\X1_terminal_block.stp")],
}
_MAN_CACHE: dict = {}


def manifest(num: str) -> dict:
    """``cadManifestJson`` vzoru přes jádro (node + packages/core/dist)."""
    if num in _MAN_CACHE:
        return _MAN_CACHE[num]
    dist = (ROOT / "packages" / "core" / "dist" / "index.js").as_uri()
    sample = ROOT / "samples" / f"{SAMPLES[num]}.plcstudio.json"
    code = (f"import fs from 'fs'; const c = await import({json.dumps(dist)});"
            f"const j = JSON.parse(fs.readFileSync({json.dumps(str(sample))}, 'utf8'));"
            "process.stdout.write(c.cadManifestJson(c.normalizeProject(j.prj || j)));")
    r = subprocess.run(["node", "--input-type=module", "-e", code], capture_output=True, text=True, encoding="utf-8",
                       timeout=180)
    if r.returncode != 0:
        raise unittest.SkipTest("node / jádro nedostupné: " + r.stderr[-300:])
    _MAN_CACHE[num] = json.loads(r.stdout)
    return _MAN_CACHE[num]


def tmpdir() -> Path:
    return Path(tempfile.mkdtemp(prefix="p3parts_"))


class TypyTest(unittest.TestCase):
    def test_cylinders(self):
        c = typy.parse_cylinder("DSBC-32-100-PPVA-N3 — ISO 15552, Ø32, zdvih 100 mm", "1376426")
        self.assertEqual((c["norma"], c["rada"], c["prumer"], c["zdvih"]), ("ISO 15552", "DSBC", 32, 100))
        self.assertEqual(typy.parse_cylinder("DSNU-20-50-PPV-A")["norma"], "ISO 6432")
        self.assertEqual(typy.parse_cylinder("DSNU-20-50-PPV-A")["zdvih"], 50)
        for t, exp in (("CP96SDB40-50C", ("CP96", 40, 50)), ("C96SB32-25", ("C96", 32, 25)), ("C85N20-50", ("C85", 20, 50)),
                       ("CDJ2B10-45", ("CJ2", 10, 45))):
            c = typy.parse_cylinder(t)
            self.assertEqual((c["rada"], c["prumer"], c["zdvih"]), exp, t)
        self.assertIsNone(typy.parse_cylinder("CJ2B10-45")["norma"])        # mini válec — rozměry v tabulce nejsou
        c = typy.parse_cylinder("Válec ISO 15552, Ø50, zdvih 200 mm")
        self.assertEqual((c["norma"], c["prumer"], c["zdvih"]), ("ISO 15552", 50, 200))
        self.assertIsNone(typy.parse_cylinder("SIMOGEAR 2KJ3"))
        for t, c in ((t, typy.parse_cylinder(t)) for t in ("DSBC-50-80", "C85N16-10")):
            self.assertTrue(c["zdroj"], t)

    def test_threads_and_requests(self):
        self.assertEqual(typy.parse_thread("M10x1.25"), (10.0, 1.25))
        self.assertEqual(typy.parse_thread("M6"), (6.0, None))
        self.assertIsNone(typy.parse_thread("G1/8"))
        self.assertEqual(typy.parse_part_request("ISO4762 M6x20"), ("ISO4762", "M6x20"))
        self.assertEqual(typy.parse_part_request("ts35 7.5x500"), ("TS35", "7.5x500"))
        self.assertIsNone(typy.parse_part_request("DSBC-32-100"))


def _num_ok(tc, row, where):
    for k, v in row.items():
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            tc.assertGreater(v, 0, f"{where}.{k}")


class TablesTest(unittest.TestCase):
    def test_every_row_has_source_and_positive_dims(self):
        v = cm.load("valce")
        for key in ("iso15552", "iso6432"):
            self.assertTrue(v[key]["zdroj"].startswith("https://"), key)
            for b, row in v[key]["rady"].items():
                _num_ok(self, row, f"{key}.{b}")
        for code, it in cm.load("katalog")["polozky"].items():
            self.assertTrue(it["zdroj"].startswith("https://"), code)
            self.assertIn(it["detail"], ("tvar", "obálka"), code)
            self.assertIn(it["gen"], _GENS, code)
            _num_ok(self, {k: x for k, x in it.items() if k != "holes"}, code)
        for kind, t in cm.load("normalie").items():
            if kind.startswith("_"):
                continue
            self.assertTrue(t["zdroj"].startswith("https://"), kind)
            for size, row in t["rady"].items():
                _num_ok(self, row, f"{kind}.{size}")
                if "zdroj" in row:
                    self.assertTrue(row["zdroj"].startswith("https://"))

    def test_consistency(self):
        for b, r in cm.load("valce")["iso15552"]["rady"].items():
            self.assertEqual(r["H"], r["WH"] + r["A"], b)                    # vyložení = WH + délka závitu
            self.assertEqual(r["ZZ"], r["H"] + r["L8"] + r["VA"], b)         # celková délka katalogu
            self.assertLess(r["R"], r["E"], b)
            self.assertLess(r["D"], r["B"], b)
        for b, r in cm.load("valce")["iso6432"]["rady"].items():
            self.assertEqual(r["ZZ"], r["H"] + r["S"] + r["F"], b)
            self.assertLess(r["NA"], r["D"], b)                              # plochy víka < průměr přes rohy
            self.assertLess(r["C"], r["ND"], b)
        n = cm.load("normalie")
        for s, r in n["ISO4762"]["rady"].items():
            d = float(s[1:])
            self.assertTrue(d < r["dk"] and r["s"] < r["dk"] and r["t"] < r["k"], s)
        for s, r in n["ISO10642"]["rady"].items():                           # 90° hlava: k = (dk − d) / 2
            self.assertAlmostEqual(r["k"], (r["dk"] - float(s[1:])) / 2, delta=0.01, msg=s)
        for s, r in n["ISO4032"]["rady"].items():
            self.assertLess(r["s"], r["e"], s)
            self.assertLessEqual(r["e"], r["s"] / 0.866 + 1e-6, s)           # e min ≤ teoretické přes rohy
        for s, r in n["ISO7089"]["rady"].items():
            self.assertTrue(float(s[1:]) < r["d1"] < r["d2"], s)

    def test_no_source_no_model(self):
        s, why = cm.spec_for_part({"category": "cylinder_switch", "brand": "Festo", "orderCode": "574334",
                                   "type": "SMT-8M-A-PS-24V-E-0,3-M8D — PNP"})
        self.assertIsNone(s)
        self.assertIn("není v tabulkách", why)
        self.assertIsNone(cm.spec_for_request("ISO4762 M7x20")[0])
        self.assertIsNone(cm.spec_for_request("ISO15552 20x50")[0])          # Ø20 není řada ISO 15552
        self.assertIsNone(cm.spec_for_part({"category": "cylinder", "type": "CJ2B10-45"})[0])
        s, _ = cm.spec_for_part({"category": "cylinder", "type": "DSBC-32-100-PPVA-N3 — ISO 15552", "orderCode": "1376426"})
        self.assertEqual((s["key"], s["typ"], s["detail"]), ("ISO15552_32x100", "dil", "tvar"))
        self.assertTrue(all(u.startswith(("https://", "data/")) for u in s["zdroj"]))
        self.assertEqual(cm.spec_for_request("ISO4762 M6x20")[0]["typ"], "sroub")
        self.assertEqual(cm.spec_for_request("ISO4032 M6")[0]["typ"], "matice")
        self.assertEqual(cm.spec_for_request("ISO7089 M6")[0]["typ"], "podlozka")


_GENS = {"skrinka", "skrinka_din", "hmi_panel", "panel_22", "snimac_valec", "snimac_tlak", "snimac_kvadr", "valec_obalka"}


class CoverageTest(unittest.TestCase):
    def test_samples(self):
        rows = []
        for num in SAMPLES:
            mp = cm.map_manifest(manifest(num))
            c = cm.coverage(mp)
            rows.append(f"vzor {num}: {c['dle_dokumentace']}/{c['radku']} řádků dle dokumentace ({c['pokryti_pct']} %), "
                        f"kusů {c['kusu_dle_dokumentace']}/{c['kusu']}, modelů {c['modelu']}")
            self.assertGreaterEqual(c["pokryti_pct"], 50.0, num)
            for pid, r in mp["parts"].items():
                if r["category"] in ("cylinder",) and "DSBC" in r["type"]:
                    self.assertEqual(r["stav"], cm.STAV_DOK, pid)
                if r["stav"] == cm.STAV_ZAST:
                    self.assertTrue(r["duvod"], pid)
                if r["category"] == "terminal_block":
                    self.assertEqual(r["stav"], cm.STAV_DOK, pid)
        print("\n" + "\n".join(rows))


class GenCliTest(unittest.TestCase):
    def test_gen_no_fc_and_pipeline(self):
        d = tmpdir()
        mf = d / "PLCdesk_CAD.json"
        mf.write_text(json.dumps(manifest("01"), ensure_ascii=False), encoding="utf-8")
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = gen.main(["gen", str(mf), str(d / "dily"), "--no-fc"])
        self.assertEqual(code, 0, buf.getvalue())
        idx = json.loads((d / "dily" / "parts_index.json").read_text(encoding="utf-8"))
        self.assertEqual(idx["format"], "plcdesk-pro3d-parts")
        self.assertEqual(set(idx["parts"]), {p["id"] for p in manifest("01")["parts"]})
        # bez FreeCADu žádný model nevznikl → všechny díly zůstanou zástupné (index nic nepředstírá)
        self.assertTrue(all(r["stav"] == cm.STAV_ZAST for r in idx["parts"].values()))
        self.assertTrue((d / "dily" / "DILY.md").is_file())
        # postup: pokyn stavitele části stavby obsahuje povinné použití dílů, koncept ne
        p = pp.builder_prompt(d, "modules", 1)
        self.assertIn("parts_index.json", p)
        self.assertIn("App::Link", p)
        self.assertIn("pro3d_parts.ps1", p)
        self.assertNotIn("parts_index.json", pp.builder_prompt(d, "concept", 1))
        self.assertIn("parts_index.json", pp.k5_prompt(d, "frame", 1))
        # PREHLED.md: souhrn dílů
        fake = dict(idx, souhrn={"radku": 20, "dle_dokumentace": 14, "zastupne": 6, "pokryti_pct": 70.0, "kusu": 34,
                                 "kusu_dle_dokumentace": 23, "modelu": 13})
        (d / "dily" / "parts_index.json").write_text(json.dumps(fake), encoding="utf-8")
        st = pp.blank_state("X")
        txt = pp.write_summary(d, st).read_text(encoding="utf-8")
        self.assertIn("dle dokumentace 14", txt)
        self.assertIn("70.0 %", txt)
        # barvy: pokyn stavitele (žlutá = dle dokumentace, nepřebarvovat) a legenda v PREHLED.md
        self.assertIn("255,215,0", p)
        self.assertIn("nepřebarvuj", p)
        self.assertIn("## Barvy v modelu", txt)
        self.assertIn("**žlutá** RGB 255,215,0", txt)
        self.assertIn("**oranžová** RGB 255,140,0", txt)
        self.assertIn("žlutá", (d / "dily" / "DILY.md").read_text(encoding="utf-8"))

    def test_generate_colors_in_gui(self):
        """Po stavbě se nové modely a starší bez barvy obarví v GUI (barva v indexu); selhání = chyba."""
        d = tmpdir()
        specs = {k: {"key": k, "gen": "matice", "params": {}} for k in ("A", "B", "C")}
        calls = []

        def fake_run(todo, work, slot, timeout):
            for t in todo:
                Path(t["out"]).parent.mkdir(parents=True, exist_ok=True)
                Path(t["out"]).write_bytes(b"x")
            return {"modely": {t["key"]: {"ok": True} for t in todo}}

        def fake_color(files, work, slot, timeout):
            calls.append(sorted(Path(f).stem for f in files))
            return {"soubory": {f: {"ok": Path(f).stem != "C", "chyba": "x" if Path(f).stem == "C" else ""} for f in files}}

        old_r, old_c = gen.run_freecad, gen.color_freecad
        gen.run_freecad, gen.color_freecad = fake_run, fake_color
        try:
            state, err = gen.generate(specs, d, slot="s")
            self.assertEqual(calls, [["A", "B", "C"]])
            self.assertTrue(state["A"]["barva"] and not state["C"]["barva"])
            self.assertIn("barvy neuloženy (1)", err)
            old = {"modely": state}
            calls.clear()
            state2, err2 = gen.generate(specs, d, slot="s", old=old)       # A, B hotové a žluté → jen C znovu
            self.assertEqual(calls, [["C"]])
            calls.clear()
            gen.generate(specs, d, slot="s", no_fc=True, old={"modely": state2})
            self.assertEqual(calls, [])
        finally:
            gen.run_freecad, gen.color_freecad = old_r, old_c

    def test_pipeline_calls_parts_once_before_build(self):
        calls = []

        def parts_fn(folder, log=print):
            calls.append(Path(folder))
            return {"souhrn": {"radku": 3, "dle_dokumentace": 2, "zastupne": 1}, "chyba": ""}

        import importlib.util
        spec = importlib.util.spec_from_file_location("pp_helpers", Path(__file__).with_name("test_pro_pipeline.py"))
        helpers = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helpers)              # úplný protokol K5 podle skillu (brána K5 projde)

        def runner(pipe, role, prompt, extra, log_path):
            unit = next(k for k in pp.AI_UNITS if f"_{k}_kolo" in log_path.name)
            if role == "k5":
                f = pp.k5_file(pipe.folder, unit, 1)
                f.parent.mkdir(parents=True, exist_ok=True)
                f.write_text(helpers.full_protocol(pipe.folder, unit, 1), encoding="utf-8")
                (f.parent / "k5_kolo1").mkdir(exist_ok=True)
                (f.parent / "k5_kolo1" / "kontroly.json").write_text('{"souhrn": {"stav": "OK"}}', encoding="utf-8")
            return {"state": "done"}

        d = tmpdir()
        p = pp.Pipeline(d, {"meta": {"name": "X"}}, runner=runner, parts_fn=parts_fn,
                        inputs_fn=lambda f, prj, log=print: [])
        self.assertEqual(p.run(), "done")
        self.assertEqual(len(calls), 1)
        self.assertEqual(p.state["parts"]["souhrn"]["dle_dokumentace"], 2)
        calls.clear()
        p2 = pp.Pipeline(tmpdir(), {"meta": {"name": "X"}}, ai=False, parts_fn=parts_fn, inputs_fn=lambda f, prj, log=print: [])
        p2.run()
        self.assertEqual(calls, [])                                           # bez AI a bez --parts se negeneruje


def _fc_available() -> bool:
    return gen.run_fc_path() is not None and os.environ.get("PRO3D_SKIP_FC") != "1"


@unittest.skipUnless(_fc_available(), "FreeCAD (run_fc.ps1 skillu freecad-instance) není k dispozici")
class FreeCadTest(unittest.TestCase):
    REQ = ["ISO15552 32x100", "ISO15552 125x50", "ISO6432 20x50", "ISO4762 M6x20", "ISO7380 M5x10", "ISO10642 M6x16",
           "ISO4032 M6", "ISO7089 M8", "TS35 7.5x200", "TS35 15x100", "SKINTOP M20", "5SL6110-7", "3RT2016-1BB41",
           "6EP3334-7SB00-3AX0", "6SL3210-5BE17-5UV0", "6AV2123-3GB32-0AW0", "3SU1150-1HB20-1CH0", "IFS204", "6020388",
           "PT5404", "1041436", "64924005", "2002-1201"]

    @classmethod
    def setUpClass(cls):
        cls.out = tmpdir()
        cls.specs = {}
        for r in cls.REQ:
            s, why = cm.spec_for_request(r)
            assert s, (r, why)
            cls.specs[r] = s
        cls.state, cls.err = gen.generate({s["key"]: s for s in cls.specs.values()}, cls.out,
                                          slot=os.environ.get("PRO3D_TEST_SLOT") or "pro3d-parts", timeout=900)

    def expected(self, s) -> list[float]:
        """Obálka [dx, dy, dz] z tabulky (konvence os fc_parts.py)."""
        p, g = s["params"], s["gen"]
        if g == "valec_iso15552":
            return [p["ZZ"] + p["zdvih"], p["E"], p["E"]]
        if g == "valec_iso6432":
            return [p["ZZ"] + p["zdvih"], p["NA"], p["NA"]]
        if g == "sroub_4762":
            return [p["dk"], p["dk"], p["l"] + p["k"]]
        if g == "sroub_10642":
            return [p["dk"], p["dk"], p["l"]]
        if g == "matice":
            return [p["s"], p["s"] / 0.8660254, p["m"]]
        if g == "podlozka":
            return [p["d2"], p["d2"], p["h"]]
        if g == "lista_ts35":
            return [p["l"], p["b"], p["h"]]
        if g == "vyvodka":
            return [p["sw"], p["sw"] / 0.8660254, p["C"]]
        if g in ("skrinka", "skrinka_din"):
            return [p["w"], p["d"], p["h"]]
        if g == "hmi_panel":
            return [p["cut_w"], p["depth"], p["cut_h"]]
        if g == "panel_22":
            return [max(p["act_d"], p["rear_w"]), p["front_h"] + p.get("deska_t", 0) + p["rear_d"], max(p["act_d"], p["rear_h"])]
        if g == "snimac_valec":
            nut = p.get("nut_sw", 0) / 0.8660254 if p.get("nut_sw") else p["d"]
            return [p["total"], max(nut, p["d"]), max(p.get("nut_sw", 0), p["d"])]
        if g == "snimac_tlak":
            return [p["body_d"], p["body_d"], p["total"]]
        if g == "snimac_kvadr":
            return [p["d"], p["w"], p["h"]]
        if g == "valec_obalka":
            return [p["d"], p["d"], p["h"]]
        return []

    def test_models_valid_and_envelope(self):
        self.assertEqual(self.err, "")
        for r, s in self.specs.items():
            m = self.state[s["key"]]
            self.assertTrue(m.get("ok"), f"{r}: {m}")
            self.assertGreaterEqual(m["telesa"], 1, r)
            self.assertTrue((self.out / m["file"]).is_file(), r)
            b = m["bbox"]
            dims = [b[1] - b[0], b[3] - b[2], b[5] - b[4]]
            exp = self.expected(s)
            if s["gen"] == "sroub_7380":                    # vrchol hlavy je vybraný šestihranem — kontrola dk a dříku
                self.assertAlmostEqual(dims[0], s["params"]["dk"], delta=0.1, msg=r)
                self.assertAlmostEqual(-b[4], s["params"]["l"], delta=0.1, msg=r)
                continue
            for i, (a, e) in enumerate(zip(dims, exp)):
                self.assertAlmostEqual(a, e, delta=0.1, msg=f"{r} osa {'xyz'[i]}: {dims} × {exp}")

    def test_saved_yellow_from_gui(self):
        """Barvy uloží GUI instance: každý vygenerovaný díl je po uložení žlutý 255,215,0 a projde kontrolou stav."""
        from plc_studio.pro3d_tools import rules, run
        for r, s in self.specs.items():
            m = self.state[s["key"]]
            self.assertTrue(m.get("barva"), r)
            f = self.out / m["file"]
            st = run.check_stav(f)
            self.assertEqual((st["chyby"], st["varovani"]), ([], []), r)
            self.assertGreaterEqual(st["data"]["dle_dokumentace"], 1, r)
            cols = rules.fcstd_colors(str(f))
            self.assertTrue(any(rules.je_zluta(c) for c in cols.values()), r)
        self.assertEqual(list((self.out / "modely").glob("*.FCBak")), [])

    def test_properties_in_fcstd(self):
        import zipfile
        m = self.state[self.specs["ISO15552 32x100"]["key"]]
        with zipfile.ZipFile(self.out / m["file"]) as z:
            xml = z.read("Document.xml").decode("utf-8")
        for must in ("Konstrukce_ModelStav", "dle dokumentace", "Konstrukce_Zdroj", "smcetech.com", "Konstrukce_Pohyb",
                     "Rozmer_L8"):
            self.assertIn(must, xml)
        self.assertNotIn("placeholder", xml.lower())
        m = self.state[self.specs["ISO4762 M6x20"]["key"]]
        with zipfile.ZipFile(self.out / m["file"]) as z:
            self.assertIn('value="sroub"', z.read("Document.xml").decode("utf-8"))

    def test_manufacturer_models(self):
        """Obálka generovaného dílu × model výrobce na disku (jen čtení; seřazené rozměry)."""
        files, pairs = [], []
        for req, cands in MFR_MODELS.items():
            f = next((c for c in cands if c.is_file()), None)
            if f is None:
                continue
            s = self.specs[req]
            pairs.append((req, f, self.state[s["key"]]))
            files.append(str(f))
        if not files:
            self.skipTest("modely výrobců na disku nejsou")
        work = self.out / ".bbox"
        work.mkdir(exist_ok=True)
        rf = gen.run_fc_path()
        res = work / "bbox.json"
        subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(rf), "run", "--slot", "pro3d-parts",
                        "--timeout", "600", "--result", str(res), str(gen.HERE / "fc_bbox.py"), *files],
                       capture_output=True, text=True, timeout=800)
        mfr = json.loads(res.read_text(encoding="utf-8"))["soubory"]
        lines = []
        for req, f, st in pairs:
            b = st["bbox"]
            g = sorted([b[1] - b[0], b[3] - b[2], b[5] - b[4]])
            mm = mfr.get(str(f), {})
            if "rozmery" not in mm:
                lines.append(f"{req}: model výrobce nečitelný ({mm.get('chyba')})")
                continue
            v = sorted(mm["rozmery"])
            diff = [round(a - c, 1) for a, c in zip(g, v)]
            lines.append(f"{req}: generovaný {[round(x, 1) for x in g]} × výrobce {[round(x, 1) for x in v]} ({f.name}) "
                         f"rozdíl {diff}")
            if req == "6SL3210-5BE17-5UV0":                     # shodný datový list
                for a, c in zip(g, v):
                    self.assertAlmostEqual(a, c, delta=1.0, msg=req)
            if req == "IFS204":                                 # délka a přes rohy matic (natočení šestihranu se liší)
                for a, c in zip(g[1:], v[1:]):
                    self.assertAlmostEqual(a, c, delta=1.0, msg=req)
            if req.startswith("ISO15552"):
                self.assertAlmostEqual(g[2], v[2], delta=3.0, msg="délka válce")
        print("\nPorovnání s modely výrobců:\n" + "\n".join(lines))
        (self.out / "porovnani.txt").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
