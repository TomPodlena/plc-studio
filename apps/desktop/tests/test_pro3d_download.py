"""PLCdesk PRO — řízené ruční stahování modelů (``plc_studio/pro3d_download``).

Bez sítě: seznam na vzorech 01 / 03 / 20 (díly „dle dokumentace“ vyloučené, odkaz u každého řádku, unikátní názvy
souborů), tabulka výrobců, párování podle názvu / hlavičky STEP / ZIP, knihovna jen ``library_ok``, registrace nahradí
zástupný v indexu, napojení do postupu a kroku. S FreeCADem (``run_fc.ps1`` skillu freecad-instance, vlastní slot
``pro3d-dl``; ``PRO3D_SKIP_FC=1`` přeskočí) jeden headless běh: syntetický STEP → registrace → App::Link v modelu stroje.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("PLCSTUDIO_HOME", tempfile.mkdtemp(prefix="plcstudio_dl_"))

from plc_studio import pro_pipeline as pp  # noqa: E402
from plc_studio.pro3d_download import listing as dl  # noqa: E402
from plc_studio.pro3d_download import models_index as MI  # noqa: E402
from plc_studio.pro3d_download import register_manual as RM  # noqa: E402
from plc_studio.pro3d_parts import catalog_map as cm  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
SAMPLES = {"01": "01_pasovy_dopravnik_vyhazovac", "03": "03_nytovaci_lis_NL-1", "20": "20_zkusebni_stanice_tesnosti_ZT-20"}
_MAN: dict = {}

STEP = ("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((''),'2;1');\nFILE_NAME('{name}','2026-10-24',(''),(''),'','','');\n"
        "FILE_SCHEMA(('AUTOMOTIVE_DESIGN {{ 1 0 10303 214 1 1 1 1 }}'));\nENDSEC;\nDATA;\n"
        "#1=PRODUCT('{prod}','{prod}','',(#2));\nENDSEC;\nEND-ISO-10303-21;\n")


def step(name: str = "x", prod: str = "dil") -> str:
    return STEP.format(name=name, prod=prod)


def manifest(num: str) -> dict:
    if num in _MAN:
        return _MAN[num]
    dist = (ROOT / "packages" / "core" / "dist" / "index.js").as_uri()
    sample = ROOT / "samples" / f"{SAMPLES[num]}.plcstudio.json"
    code = (f"import fs from 'fs'; const c = await import({json.dumps(dist)});"
            f"const j = JSON.parse(fs.readFileSync({json.dumps(str(sample))}, 'utf8'));"
            "process.stdout.write(c.cadManifestJson(c.normalizeProject(j.prj || j)));")
    r = subprocess.run(["node", "--input-type=module", "-e", code], capture_output=True, text=True, encoding="utf-8",
                       timeout=180)
    if r.returncode != 0:
        raise unittest.SkipTest("node / jádro nedostupné: " + r.stderr[-300:])
    _MAN[num] = json.loads(r.stdout)
    return _MAN[num]


def mini_manifest() -> dict:
    P = lambda i, cat, brand, code, typ, **k: dict({"id": i, "tag": i.split(":")[0], "category": cat, "brand": brand,  # noqa: E731
                                                   "orderCode": code, "label": cat, "type": typ, "qty": 1}, **k)
    return {"project": {"guid": "g", "name": "Test"}, "parts": [
        P("-Y1:valve_solenoid", "valve_solenoid", "Festo", "574371", "VUVG-L14-M52-MT-G18-1P3 – 5/2"),
        P("-Y3:valve_solenoid", "valve_solenoid", "Festo", "574371", "VUVG-L14-M52-MT-G18-1P3 – 5/2"),
        P("-Y1:cylinder_switch", "cylinder_switch", "Festo", "574334", "SMT-8M-A-PS-24V-E-0,3-M8D – PNP"),
        P("+1:cabinet", "cabinet", "Rittal", "1050.000", "AX 1050.000 – ocelová kompaktní skříň 500×500×210 mm"),
        P("-S2:safety_switch", "safety_switch", "Siemens", "3SE5232-0QV40", "3SE5232-0QV40 – bezpečnostní spínač"),
        P("-B2:load_cell", "load_cell", "LUKAS TENZO (CZ)", "", "Tenzometrický siloměr S-51"),
        P("-X9:widget", "widget", "Acme Neznámá", "AC-12345", "AC-12345 – něco"),
        P("-W1xx:cable_sensor", "cable_sensor", "ifm electronic", "EVC002", "EVC002 – kabel"),
    ]}


class SamplesTest(unittest.TestCase):
    def test_list_on_samples(self):
        for num in SAMPLES:
            m = manifest(num)
            with self.subTest(vzor=num), tempfile.TemporaryDirectory() as td:
                rows = dl.download_list(m, None, Path(td) / "models")
                doc = {pid for pid, r in cm.map_manifest(m)["parts"].items() if r["stav"] == cm.STAV_DOK}
                listed = [pid for r in rows for pid in r["partIds"]]
                self.assertTrue(rows)
                self.assertFalse(doc & set(listed), "díl dle dokumentace v seznamu")
                self.assertEqual(len(listed), len(set(listed)))
                want = {p["id"] for p in m["parts"] if p["id"] not in doc and not p["category"].startswith("cable")}
                self.assertEqual(set(listed), want)                       # každý ostatní díl právě jednou
                files = [r["file"] for r in rows]
                self.assertEqual(len(files), len(set(f.lower() for f in files)), files)
                for r in rows:
                    self.assertTrue(r["url"].startswith("https://"), r)
                    self.assertNotIn("{", r["url"])
                    self.assertTrue(r["file"].endswith(".stp") and r["dir"] == "models/manual")
                    self.assertIn("STEP", r["format"])
                    self.assertIn(r["status"], dl.STATUS_CS)
                c = dl.counts(rows, m, None)
                self.assertEqual(c[dl.ST_DOC], len(doc))
                self.assertEqual(c["files"], len(rows))
                out = dl.write_lists(td, m, None)
                md = (Path(td) / dl.LIST_MD).read_text(encoding="utf-8")
                ht = (Path(td) / dl.LIST_HTML).read_text(encoding="utf-8")
                for r in out["rows"]:
                    self.assertIn(r["file"], md)
                    self.assertIn('href="' + r["url"].replace("&", "&amp;"), ht)
                    # odkazy ke stažení: stránka výrobce + náhradní hledání, bez nevyplněných vzorů a duplicit
                    urls = [o["url"] for o in r["links"]]
                    self.assertEqual(urls[0], r["url"])
                    self.assertEqual(len(urls), len(set(urls)))
                    self.assertTrue(any("traceparts" in u for u in urls), r)
                    for u in urls:
                        self.assertTrue(u.startswith("https://") and "{" not in u, u)
                        self.assertIn('href="' + u.replace("&", "&amp;"), ht)
                    if r["vendor"] == "siemens":
                        self.assertIn("https://www.siemens.com/cax", urls)
                    if r["orderCode"]:
                        self.assertIn(f'data-copy="{r["orderCode"]}"', ht)
                self.assertIn("<title>", ht)
                self.assertIn("models", ht)

    def test_parts_index_excludes_doc(self):
        m = manifest("01")
        mapped = cm.map_manifest(m)
        doc = next(pid for pid, r in mapped["parts"].items() if r["stav"] == cm.STAV_DOK)
        idx = {"parts": {pid: dict(r, stav=cm.STAV_ZAST) if pid == doc else r for pid, r in mapped["parts"].items()}}
        with tempfile.TemporaryDirectory() as td:          # model nevznikl → díl zůstal zástupný → patří do seznamu
            rows = dl.download_list(m, idx, Path(td))
        self.assertIn(doc, [pid for r in rows for pid in r["partIds"]])


class VendorsTest(unittest.TestCase):
    def test_table(self):
        V = dl.vendors()
        for k in ("festo", "smc", "siemens", "rittal", "phoenix", "wago", "ifm", "sick", "pepperl", "weidmueller",
                  "lapp", "schmersal", "werma", "alutec"):
            v = V["vendors"][k]
            for f in ("name", "url", "kind", "verified", "verify_note", "registration", "format", "library_ok", "terms"):
                self.assertIn(f, v, (k, f))
            self.assertTrue(v["url"].startswith("https://"))
            if v["library_ok"]:
                self.assertTrue(v["terms_src"].startswith("https://"), k)    # knihovna jen s citací podmínek
        for k in ("festo", "smc", "rittal", "wago"):                          # CADENAS = jen k projektu
            self.assertFalse(V["vendors"][k]["library_ok"], k)
        self.assertFalse(V["fallback"]["library_ok"])
        self.assertEqual(dl.vendor_for("Siemens / Innomotics")[0], "siemens")
        self.assertEqual(dl.vendor_for("ifm electronic")[0], "ifm")
        k, e = dl.vendor_for("Acme Neznámá")
        self.assertEqual(e["kind"], "fallback")
        self.assertIn("traceparts", dl.build_url(e, "AC-12345", ""))
        self.assertIn("1050000", dl.build_url({"url": "https://x/{code_alnum}"}, "1050.000", ""))

    def test_rows_status_and_links(self):
        with tempfile.TemporaryDirectory() as td:
            rows = {r["partId"]: r for r in dl.download_list(mini_manifest(), {"parts": {}}, Path(td))}
        self.assertNotIn("-W1xx:cable_sensor", rows)
        self.assertEqual(rows["-Y1:valve_solenoid"]["partIds"], ["-Y1:valve_solenoid", "-Y3:valve_solenoid"])
        self.assertEqual(rows["-B2:load_cell"]["status"], dl.ST_PLACEHOLDER)          # bez kódu / bez CAD
        self.assertEqual(rows["-Y1:valve_solenoid"]["status"], dl.ST_MISSING)
        self.assertEqual(list(rows)[0], "+1:cabinet")                                 # rozvaděč první
        self.assertEqual(rows["+1:cabinet"]["expectedDims"], [210.0, 500.0, 500.0])
        self.assertIn("574371", rows["-Y1:valve_solenoid"]["url"])
        self.assertIn("traceparts", rows["-X9:widget"]["url"])


class MatchTest(unittest.TestCase):
    def test_names_header_zip(self):
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            md, dls = td / "models", td / "Downloads"
            (md / "manual").mkdir(parents=True)
            dls.mkdir()
            (md / "manual" / "1_cabinet.stp").write_text(step())                       # přesné jméno → jisté
            (dls / "VUVG-L14-M52-MT-G18-1P3_v2.step").write_text(step())               # typ v názvu
            (dls / "model_123.stp").write_text(step("cad", "574334 SMT-8M"))           # kód v hlavičce STEP
            with zipfile.ZipFile(dls / "CAx.zip", "w") as z:                           # ZIP SiePortal
                z.writestr("3D/3SE5232-0QV40.stp", step())
                z.writestr("3SE5232-0QV40.pdf", "pdf")
            (dls / "nesouvisi.stp").write_text(step("x", "zzz"))
            m = mini_manifest()
            rows = dl.download_list(m, {"parts": {}}, md)
            self.assertEqual(next(r for r in rows if r["partId"] == "+1:cabinet")["status"], dl.ST_DOWNLOADED)
            props = {p["partId"]: p for p in dl.find_downloads(m, rows, md, [dls])}
            self.assertEqual(props["+1:cabinet"]["how"], "name")
            self.assertTrue(props["+1:cabinet"]["sure"])
            self.assertEqual(props["-Y1:valve_solenoid"]["how"], "type_name")
            self.assertEqual(props["-Y1:cylinder_switch"]["how"], "code_header")
            self.assertEqual(props["-S2:safety_switch"]["how"], "code_name")
            self.assertEqual(props["-S2:safety_switch"]["member"], "3D/3SE5232-0QV40.stp")
            self.assertFalse(any(not p["sure"] for p in props.values() if p["how"] == "name"))
            self.assertNotIn("nesouvisi.stp", [Path(p["file"]).name for p in props.values()])
            written = dl.accept(list(props.values()), md)
            self.assertEqual(sorted(Path(w).name for w in written),
                             sorted(["1_cabinet.stp", "Y1_valve_solenoid.stp", "Y1_cylinder_switch.stp", "S2_safety_switch.stp"]))
            self.assertIn("ISO-10303-21", (md / "manual" / "S2_safety_switch.stp").read_text())
            self.assertTrue((dls / "model_123.stp").is_file())                         # originál zůstává


class LibraryTest(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp()
        self.old = os.environ.get("PLCSTUDIO_HOME")
        os.environ["PLCSTUDIO_HOME"] = self.home

    def tearDown(self):
        os.environ["PLCSTUDIO_HOME"] = self.old or ""
        shutil.rmtree(self.home, ignore_errors=True)

    def test_only_library_ok(self):
        src = Path(self.home) / "a.stp"
        src.write_text(step())
        self.assertIsNone(dl.library_add("festo", "574371", src))                     # CADENAS → ne
        self.assertIsNone(dl.library_add("acme", "AC-1", src))                         # neznámý → ne
        p = dl.library_add("siemens", "3SE5232-0QV40", src)
        self.assertTrue(p and p.is_file() and str(p).startswith(str(dl.library_dir())))
        meta = json.loads(p.with_suffix(".json").read_text(encoding="utf-8"))
        self.assertIn("interne Zwecke", meta["terms"])
        with tempfile.TemporaryDirectory() as td:
            rows = {r["partId"]: r for r in dl.download_list(mini_manifest(), {"parts": {}}, Path(td))}
            self.assertEqual(rows["-S2:safety_switch"]["status"], dl.ST_LIBRARY)
            self.assertEqual(rows["-Y1:valve_solenoid"]["status"], dl.ST_MISSING)
            dl.take_from_library(list(rows.values()), Path(td))
            self.assertTrue((Path(td) / "manual" / "S2_safety_switch.stp").is_file())
        # soubor festo vložený do knihovny ručně se nenabízí (podmínky)
        (dl.library_dir() / "festo").mkdir(parents=True)
        (dl.library_dir() / "festo" / "574371.stp").write_text(step())
        self.assertIsNone(dl.library_lookup("festo", "574371"))


def fake_measure(calls, bbox=(10, 20, 30)):
    def m(files):
        calls.append([str(f) for f in files])
        return {str(f): {"ok": True, "solids": 1, "volume_mm3": 1234.5, "bbox_mm": list(bbox)} for f in files}
    return m


class RegisterTest(unittest.TestCase):
    def test_register_replaces_placeholder_in_index(self):
        home = tempfile.mkdtemp()
        old = os.environ.get("PLCSTUDIO_HOME")
        os.environ["PLCSTUDIO_HOME"] = home
        try:
            with tempfile.TemporaryDirectory() as td:
                folder = Path(td)
                md = folder / "models"
                (md / "placeholders").mkdir(parents=True)
                (md / "placeholders" / "Y1_valve_solenoid.stp").write_text(step())
                idx = MI.load(md, {"guid": "g"})
                idx["parts"]["-Y1:valve_solenoid"] = {"source": "placeholder", "file": "placeholders/Y1_valve_solenoid.stp"}
                MI.save(md, idx)
                (md / "manual").mkdir()
                (md / "manual" / "Y1_valve_solenoid.stp").write_text(step())
                (md / "manual" / "1_cabinet.stp").write_text(step())
                (md / "manual" / "S2_safety_switch.stp").write_text(step())
                (folder / "celek").mkdir()
                with zipfile.ZipFile(folder / "celek" / "Celek.FCStd", "w") as z:     # model stroje se zástupným
                    z.writestr("Document.xml", '<Property name="PLCdesk_Id"><String value="-Y1:valve_solenoid"/>')
                calls, runs = [], []

                def fake_replace(job, res):
                    j = json.loads(Path(job).read_text(encoding="utf-8"))
                    runs.append(j)
                    return {"replaced": [{"partId": "-Y1:valve_solenoid"}],
                            "models": {pid: {"ok": True, "fcstd": str(Path(s).with_suffix(".FCStd"))}
                                       for pid, s in j["models"].items()}}

                rep = dl.register_downloads(folder, mini_manifest(), "Tester", parts_index={"parts": {}},
                                            measure=fake_measure(calls), replace_run=fake_replace)
                self.assertEqual(len(calls), 1)
                idx = json.loads((md / "index.json").read_text(encoding="utf-8"))
                e = idx["parts"]["-Y1:valve_solenoid"]
                self.assertEqual(e["source"], "manual-festo")
                self.assertEqual(e["file"], "manual/Y1_valve_solenoid.stp")
                self.assertEqual(e["replaced"]["source"], "placeholder")
                self.assertEqual(e["fcstd"], "manual/Y1_valve_solenoid.FCStd")
                self.assertTrue(e["url"].startswith("https://www.festo.com/"))
                self.assertEqual(idx["parts"]["-Y3:valve_solenoid"]["file"], e["file"])  # sdílený model
                # rozvaděč 500×500×210, obálka 10×20×30 → varování
                self.assertTrue(any(w["partId"] == "+1:cabinet" for w in rep["warnings"]))
                self.assertEqual(len(runs), 1)
                self.assertTrue(runs[0]["docs"][0].endswith("Celek.FCStd"))
                self.assertTrue((folder / "celek" / "Celek.FCStd.bak").is_file())
                self.assertEqual(rep["library"], [str(dl.library_path("siemens", "3SE5232-0QV40"))])   # jen Siemens
                rows = {r["partId"]: r for r in dl.download_list(mini_manifest(), {"parts": {}}, md)}
                self.assertEqual(rows["-Y1:valve_solenoid"]["status"], dl.ST_REGISTERED)
                self.assertIn("staženo", (folder / dl.LIST_MD).read_text(encoding="utf-8"))
        finally:
            os.environ["PLCSTUDIO_HOME"] = old or ""
            shutil.rmtree(home, ignore_errors=True)

    def test_no_machine_model_index_only(self):
        with tempfile.TemporaryDirectory() as td:
            folder = Path(td)
            (folder / "models" / "manual").mkdir(parents=True)
            (folder / "models" / "manual" / "Y1_cylinder_switch.stp").write_text(step())
            runs = []
            rep = dl.register_downloads(folder, mini_manifest(), "T", parts_index={"parts": {}},
                                        measure=fake_measure([]), replace_run=lambda j, r: runs.append(j) or {})
            self.assertEqual(runs, [])                                                # FreeCAD se nespouští
            self.assertIn("skipped", rep["replace"])
            self.assertTrue(MI.has_vendor_model(folder / "models", MI.load(folder / "models"), "-Y1:cylinder_switch"))


class PipelineTest(unittest.TestCase):
    def test_inputs_and_prompt(self):
        with tempfile.TemporaryDirectory() as td:
            (Path(td) / "PLCdesk_CAD.json").write_text(json.dumps(mini_manifest(), ensure_ascii=False), encoding="utf-8")
            files = pp.write_download_list(td, log=lambda *_: None)
            self.assertEqual(files, [dl.LIST_MD, dl.LIST_HTML])
            self.assertTrue((Path(td) / "models" / "manual").is_dir())
            p = pp.builder_prompt(Path(td), "cabinet", 1)
            self.assertIn("models/index.json", p)
            self.assertIn("STAHNOUT.md", p)
            self.assertEqual(pp.write_download_list(Path(td) / "neni", log=lambda *_: None), [])


def run_fc() -> Path | None:
    p = RM.RUN_FC
    return p if p.is_file() and not os.environ.get("PRO3D_SKIP_FC") else None


@unittest.skipIf(run_fc() is None, "FreeCAD / run_fc.ps1 nedostupný nebo PRO3D_SKIP_FC")
class FreeCadTest(unittest.TestCase):
    def test_headless_register_and_link(self):
        with tempfile.TemporaryDirectory() as td:
            folder = Path(td)
            md = folder / "models"
            (md / "manual").mkdir(parents=True)
            (folder / "celek").mkdir()
            stp = md / "manual" / "Y1_valve_solenoid.stp"
            mach = folder / "celek" / "Celek.FCStd"
            r = subprocess.run([RM._powershell(), "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(RM.RUN_FC),
                                "run", "--slot", dl.DL_SLOT, "--timeout", "300",
                                str(Path(__file__).resolve().parent / "pro3d_dl_synth.py"), str(stp), str(mach)],
                               capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=480)
            self.assertTrue(stp.is_file() and mach.is_file(), r.stdout[-800:] + r.stderr[-400:])
            man = {"project": {"name": "T"}, "parts": [mini_manifest()["parts"][0]]}
            rep = dl.register_downloads(folder, man, "Test", parts_index={"parts": {}}, to_library=False, timeout=300)
            self.assertFalse(rep["rejected"], rep)
            e = MI.load(md)["parts"]["-Y1:valve_solenoid"]
            self.assertGreater(e["check"]["volume_mm3"], 5900)                        # 10 × 20 × 30 = 6000
            self.assertEqual(sorted(e["check"]["bbox_mm"]), [10, 20, 30])
            self.assertEqual(len(rep["replace"].get("replaced") or []), 1, rep["replace"])
            self.assertTrue((md / "manual" / "Y1_valve_solenoid.FCStd").is_file())
            self.assertEqual(e["fcstd"], "manual/Y1_valve_solenoid.FCStd")
            with zipfile.ZipFile(mach) as z:
                xml = z.read("Document.xml").decode("utf-8", "replace")
            self.assertIn("App::Link", xml)
            self.assertNotIn('value="placeholder"', xml)
            self.assertIn("Y1_valve_solenoid.FCStd", xml)                              # odkaz na model výrobce


if __name__ == "__main__":
    unittest.main()
