"""Testy kontrol 3D modelu kódem (plc_studio/pro3d_tools).

Bez FreeCADu: pravidla (druh dílu, povolené kolize, ISO 13857 tab. 4, kusovník, barvy z FCStd, souhrn), voxely nad
syntetickou teselací (numpy / scipy), ``run_checks`` s podvrženým během FreeCADu. S FreeCADem (vlastní instance přes
run_fc.ps1, slot ``pro3d-test``; vypnutí ``PLCDESK_SKIP_FC=1``): syntetický model ``pro3d_synth_build.py`` → ``vse``.

Spuštění (z apps/desktop):  python -m unittest tests.test_pro3d_tools -v
"""

from __future__ import annotations

import json
import os
import struct
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from plc_studio.pro3d_tools import rules, run  # noqa: E402

try:
    import numpy as np
    from plc_studio.pro3d_tools import voxel
except ImportError:  # pragma: no cover
    np = None

HERE = Path(__file__).resolve().parent


def tmp() -> Path:
    return Path(tempfile.mkdtemp(prefix="p3t_"))


class RulesTest(unittest.TestCase):
    def test_types(self):
        self.assertEqual(rules.typ_dilu({}, "Šroub ISO 4762 M6x20"), "sroub")
        self.assertEqual(rules.typ_dilu({}, "SP_UP_7380_0"), "sroub")
        self.assertEqual(rules.typ_dilu({}, "Matice drážková M6"), "matice")
        self.assertEqual(rules.typ_dilu({}, "Profil 40x40 sloup"), "profil")
        self.assertEqual(rules.typ_dilu({}, "Zona_Lis"), "zona")
        self.assertEqual(rules.typ_dilu({"Konstrukce_Typ": "patka"}, "Cokoli"), "patka")
        self.assertEqual(rules.typ_dilu({"Konstrukce_Zona": "lis"}, "Box"), "zona")
        self.assertEqual(rules.typ_dilu({}, "Blok"), "dil")
        # nálezy ze stroje 01: začátek popisku rozhoduje, „Automatický“ není matice, spojka profilu = spojovací prvek
        self.assertEqual(rules.typ_dilu({}, "Šroub M8×25 DIN 7984 do matice v drážce"), "sroub")
        self.assertEqual(rules.typ_dilu({}, "Matice s pružinou M8 │40│ ALUTEC 210482"), "matice")
        self.assertEqual(rules.typ_dilu({}, "Automatický konektor M8×35 │40│ ALUTEC 340840 #023"), "sroub")
        self.assertEqual(rules.typ_dilu({}, "Záslepka 40×40 PA6 ALUTEC 224040"), "prislusenstvi")
        self.assertEqual(rules.typ_dilu({}, "Šroubení QS-1/4-8 — přívod vzduchu z rozvodu haly (rozhraní)"), "rozhrani")
        self.assertEqual(rules.typ_dilu({}, "Noha A x 150 — 104040 40×40 L755"), "profil")
        self.assertEqual(rules.typ_dilu({"Zona_pro": "P_T1"}, "Zona_T1_45"), "pomocny")
        self.assertEqual(rules.typ_dilu({}, "[zóna] Zdvih válce 160"), "zona")
        self.assertEqual(rules.typ_dilu({}, "[zóna] Obálka otevřených dveří r 500"), "pomocny")
        self.assertEqual(rules.povolena_kolize("profil", "patka"), "dira")
        self.assertEqual(rules.typ_dilu({}, "Víko — podélník x 1205 — 104040L 40×40 L640"), "profil")
        self.assertEqual(rules.typ_dilu({}, "Kryt shozu — sloupek FL — 104040 40×40 L980"), "profil")
        self.assertEqual(rules.typ_dilu({}, "Kryt lisu"), "kryt")
        self.assertEqual(rules.typ_dilu({}, "[zóna] Stanoviště obsluhy — založení"), "pomocny")
        self.assertEqual(rules.typ_dilu({}, "Zóna mezery T1 (ODHAD 50 nad/pod)"), "pomocny")
        self.assertEqual(rules.typ_dilu({}, "Rezerva R1 76 mm = 21 % (zóna)"), "pomocny")
        # žlab = nosný díl (musí být přišroubovaný) — dřív prislusenstvi; skill kabelaz-a-hadice
        self.assertEqual(rules.typ_dilu({}, "Žlab 40×60 svislý vlevo (zástupný)"), "zlab")

    def test_vedeni_types(self):
        """Konvence skillu kabelaz-a-hadice: Konstrukce_Vedeni má přednost před Konstrukce_Typ (fc_trasa.py píše
        žlab = prislusenstvi + zlab, obálka řetězu = pomocny + retez)."""
        self.assertEqual(rules.typ_dilu({"Konstrukce_Typ": "prislusenstvi", "Konstrukce_Vedeni": "zlab"}, "Zlab_Z1"), "zlab")
        self.assertEqual(rules.typ_dilu({"Konstrukce_Typ": "pomocny", "Konstrukce_Vedeni": "retez"},
                                        "Obalka_retezu_E1"), "retez")
        self.assertEqual(rules.typ_dilu({"Konstrukce_Typ": "pomocny"}, "Obálka řetězu E1"), "pomocny")
        self.assertEqual(rules.typ_dilu({"Konstrukce_Typ": "zlab"}, "Cokoli"), "zlab")
        self.assertEqual(rules.typ_dilu({}, "Energetický řetěz igus E2/000"), "retez")
        self.assertEqual(rules.typ_dilu({}, "Šroubení QS-G1/8-6"), "sroubeni")
        self.assertEqual(rules.typ_dilu({}, "Rychlospojka KQ2H06-01AS"), "sroubeni")
        self.assertEqual(rules.typ_dilu({}, "Šroub ISO 4762 M6x20"), "sroub", "šroubení ≠ šroub a naopak")
        self.assertEqual(rules.typ_dilu({}, "Kabelový kanál 40×60"), "zlab")
        self.assertEqual(rules.typ_dilu({"Konstrukce_Typ": "kabel"}, "Kabel_W101"), "kabel")
        self.assertEqual(rules.typ_dilu({}, "Hadice PUN-H 6×1"), "hadice")
        for t in ("zlab", "retez", "sroubeni"):
            self.assertIn(t, rules.TYPES)

    def test_allowed(self):
        self.assertEqual(rules.povolena_kolize("sroub", "dil"), "dira")
        self.assertEqual(rules.povolena_kolize("profil", "sroub"), "dira")
        self.assertEqual(rules.povolena_kolize("matice", "sroub"), "zavit")
        self.assertEqual(rules.povolena_kolize("matice", "profil"), "drazka")
        self.assertIsNone(rules.povolena_kolize("matice", "dil"))
        self.assertIsNone(rules.povolena_kolize("dil", "kryt"))
        self.assertIsNone(rules.povolena_kolize("sroub", "kabel"))
        # vedení kabelů a hadic (skill kabelaz-a-hadice); stávající páry beze změny
        for c in ("kabel", "hadice"):
            for v in ("zlab", "retez"):
                self.assertEqual(rules.povolena_kolize(c, v), "vedeni")
                self.assertEqual(rules.povolena_kolize(v, c), "vedeni")
        self.assertEqual(rules.povolena_kolize("sroubeni", "hadice"), "zasunuti")
        self.assertIsNone(rules.povolena_kolize("sroubeni", "kabel"))
        self.assertEqual(rules.povolena_kolize("sroubeni", "dil"), "dira")     # závit šroubení v portu ventilu
        self.assertIsNone(rules.povolena_kolize("retez", "dil"), "do obálky řetězu nesmí nic zasahovat")
        self.assertIsNone(rules.povolena_kolize("retez", "profil"))
        self.assertIsNone(rules.povolena_kolize("zlab", "profil"), "žlab se rámu jen dotýká")
        self.assertIsNone(rules.povolena_kolize("zlab", "retez"))
        self.assertIsNone(rules.povolena_kolize("kabel", "hadice"))
        self.assertIsNone(rules.povolena_kolize("kabel", "kabel"))
        self.assertEqual(rules.povolena_kolize("sroub", "zlab"), "dira")
        self.assertEqual(rules.povolena_kolize("matice", "profil"), "drazka")

    def test_pohyb(self):
        self.assertEqual(rules.pohyb({"Konstrukce_Pohyb": '{"nazev": "x", "posun": [0, 0, -5]}'})["posun"], [0.0, 0.0, -5.0])
        o = rules.pohyb({"Konstrukce_Pohyb": '{"otoc": {"osa": [0,0,1], "bod": [1,2,3], "uhel": 90}}'})
        self.assertEqual(o["otoc"]["uhel"], 90.0)
        self.assertIn("chyba", rules.pohyb({"Konstrukce_Pohyb": "dveře"}))
        self.assertIsNone(rules.pohyb({}))

    def test_iso13857(self):
        self.assertEqual(rules.iso13857_sr(4), 2)
        self.assertEqual(rules.iso13857_sr(10), 80)
        self.assertEqual(rules.iso13857_sr(10, "ctverec"), 25)
        self.assertEqual(rules.iso13857_sr(25), 850)
        self.assertEqual(rules.iso13857_sr(25, "sterbina", 60), 200)
        self.assertEqual(rules.iso13857_sr(30, "ctverec"), 120)
        self.assertEqual(rules.iso13857_sr(96), 850)
        self.assertIsNone(rules.iso13857_sr(121))
        self.assertEqual(rules.posud_otvor(10, 105, None, 0)["uroven"], "ok")
        self.assertEqual(rules.posud_otvor(30, 85, None, 0, "ctverec", 30)["uroven"], "chyba")
        self.assertEqual(rules.posud_otvor(30, 85, 130, 0, "ctverec", 30)["uroven"], "varovani")
        self.assertEqual(rules.posud_otvor(200, 900, None, 0)["uroven"], "chyba")
        self.assertEqual(rules.posud_otvor(10, 100, None, 3)["sr_pozad"], 120)   # odhad z mřížky: e + krok
        self.assertIn("Troax", rules.ISO13857_SRC)

    def test_kusovnik(self):
        man = {"project": {"guid": "G"}, "parts": [
            {"id": "-M1:motor", "qty": 1, "location": "field", "mount": "floor"},
            {"id": "-K1:contactor", "qty": 2, "location": "cabinet", "mount": "din"},
            {"id": "-W1:cable", "qty": 1, "location": "field", "mount": "none"}]}
        objs = [{"id": "-M1:motor", "inst": "1", "label": "a", "path": "a", "guid": "G"},
                {"id": "-M1:motor", "inst": "1", "label": "b", "path": "b", "guid": "G"},
                {"id": "-X9:neni", "inst": "", "label": "c", "path": "c", "guid": "X"}]
        r = rules.kusovnik(objs, man)
        kody = sorted(f["kod"] for f in r["chyby"])
        self.assertEqual(kody, ["kusovnik-duplicita", "kusovnik-navic", "kusovnik-pocet"])
        self.assertEqual({f["kod"] for f in r["info"]}, {"kusovnik-mimo"})     # cabinet mimo model, -W mount none
        self.assertTrue(rules.kusovnik([], None)["varovani"])

    def test_summary_limit(self):
        rep = {"model_name": "m", "sha256": "ab" * 32, "created": "t", "souhrn": {"stav": "CHYBY", "chyby": 99, "varovani": 0},
               "checks": {"kolize": {"chyby": [{"text": f"chyba {i}", "poloha": [i, 0, 0]} for i in range(99)]}}}
        md = rules.summarize(rep)
        self.assertLessEqual(len(md.splitlines()), 40)
        self.assertIn("… a dalších", md)
        self.assertIn("@ (0, 0, 0)", md)


def _fcstd(path: Path, objs: list[tuple], colors: dict, overrides: dict | None = None) -> Path:
    """Minimální FCStd: Document.xml (typ, jméno, vlastnosti) + GuiDocument.xml se ShapeAppearance."""
    doc = ['<?xml version="1.0" encoding="utf-8"?>\n<Document><Objects>']
    doc += [f'<Object type="{t}" name="{n}" id="{i}"/>' for i, (t, n, _l, _p) in enumerate(objs)]
    doc.append("</Objects><ObjectData>")
    for t, n, label, props in objs:
        body = f'<Property name="Label" type="App::PropertyString"><String value="{label}"/></Property>'
        for k, v in props.items():
            if k == "LinkedObject":
                f, _, nm = v.rpartition("#")
                body += f'<Property name="LinkedObject" type="App::PropertyXLink"><XLink file="{f}" name="{nm}"/></Property>'
            else:
                body += f'<Property name="{k}" type="App::PropertyString"><String value="{v}"/></Property>'
        doc.append(f'<Object name="{n}"><Properties>{body}</Properties></Object>')
    doc.append("</ObjectData></Document>")
    gui = ['<?xml version="1.0" encoding="utf-8"?>\n<Document><ViewProviderData>']
    files = {}
    for n, rgb in colors.items():
        fn = f"ShapeAppearance{len(files)}"
        packed = (rgb[0] << 24) | (rgb[1] << 16) | (rgb[2] << 8) | 255
        files[fn] = struct.pack("<III", 1, 0x555555FF, packed) + b"\0" * 28
        gui.append(f'<ViewProvider name="{n}"><Properties><Property name="ShapeAppearance" type="App::PropertyMaterialList">'
                   f'<MaterialList file="{fn}" version="3"/></Property></Properties></ViewProvider>')
    for n, rgb in (overrides or {}).items():
        packed = (rgb[0] << 24) | (rgb[1] << 16) | (rgb[2] << 8) | 255
        gui.append(f'<ViewProvider name="{n}"><Properties><Property name="OverrideMaterial" type="App::PropertyBool">'
                   f'<Bool value="true"/></Property><Property name="ShapeMaterial" type="App::PropertyMaterial">'
                   f'<PropertyMaterial diffuseColor="{packed}"/></Property></Properties></ViewProvider>')
    gui.append("</ViewProviderData></Document>")
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("Document.xml", "".join(doc))
        z.writestr("GuiDocument.xml", "".join(gui))
        for fn, b in files.items():
            z.writestr(fn, b)
    return path


class StavTest(unittest.TestCase):
    def test_colors_and_props(self):
        p = _fcstd(tmp() / "m.FCStd", [
            ("Part::Feature", "A", "Motor (zástupný)", {"PLCdesk_ModelStatus": "placeholder"}),
            ("Part::Feature", "B", "Ventil zástupný", {"Placeholder": "true"}),
            ("Part::Feature", "C", "Kryt", {}),
            ("Part::Feature", "SRC", "zdroj", {}),
            ("App::Link", "L", "Odkaz (zástupný)", {"PLCdesk_ModelStatus": "placeholder", "LinkedObject": "SRC"}),
        ], {"A": (255, 140, 0), "B": (200, 200, 200), "C": (255, 141, 1), "SRC": (255, 140, 0)})
        self.assertEqual(rules.fcstd_colors(str(p))["A"], (255, 140, 0))
        r = run.check_stav(p)
        self.assertEqual([f["objekty"] for f in r["chyby"]], [["B"]])                   # zástupný bez oranžové
        self.assertEqual(sorted(f["objekty"][0] for f in r["varovani"]), ["C", "SRC"])   # oranžové bez vlastnosti
        self.assertEqual(r["data"]["zastupnych"], 3)                                     # odkaz převzal barvu zdroje

    def test_dle_dokumentace_yellow(self):
        """Díl z generátorů = žlutý 255,215,0; jiná barva = chyba, žlutý bez vlastnosti = varování; odkaz do jiného
        dokumentu se ověří v cílovém FCStd a nesmí cíl přebarvit."""
        self.assertTrue(rules.je_zluta((255, 213, 2)) and not rules.je_zluta(rules.ORANGE))
        self.assertTrue(rules.je_dle_dokumentace({"Konstrukce_ModelStav": "dle dokumentace"}))
        self.assertFalse(rules.je_dle_dokumentace({"Konstrukce_ModelStav": "zástupný"}))
        d = tmp()
        dd = {"Konstrukce_ModelStav": "dle dokumentace"}
        ok = _fcstd(d / "ok.FCStd", [("App::Part", "Dil", "Šroub", dd), ("Part::Feature", "S", "Sroub", dd)],
                    {"S": rules.YELLOW})
        bad = _fcstd(d / "bad.FCStd", [("App::Part", "Dil", "Válec", dd), ("Part::Feature", "T", "Teleso", dd)],
                     {"T": (204, 204, 204)})
        self.assertEqual(run.check_stav(ok)["chyby"], [])
        self.assertEqual([f["objekty"] for f in run.check_stav(bad)["chyby"]], [["T"]])
        asm = _fcstd(d / "asm.FCStd", [
            ("App::Link", "L1", "Šroub -X1", {"PLCdesk_Id": "a", "LinkedObject": "ok.FCStd#Dil"}),
            ("App::Link", "L2", "Válec -MM1", {"PLCdesk_Id": "b", "LinkedObject": "bad.FCStd#Dil"}),
            ("App::Link", "L3", "Šroub přebarvený", {"LinkedObject": "ok.FCStd#Dil"}),
            ("Part::Feature", "K", "Konzola", {}),
        ], {"K": rules.YELLOW}, overrides={"L3": (0, 0, 255)})
        r = run.check_stav(asm)
        self.assertEqual(sorted(f["objekty"][0] for f in r["chyby"]), ["L2", "L3"])
        self.assertEqual([f["objekty"][0] for f in r["varovani"]], ["K"])          # žlutá jen pro generované díly
        self.assertEqual(r["data"]["dle_dokumentace"], 3)


@unittest.skipIf(np is None, "numpy chybí")
class VoxelTest(unittest.TestCase):
    @staticmethod
    def _box(x0, x1, y0, y1, z0, z1):
        P = np.array([[x, y, z] for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)], np.float32)
        F = np.array([[0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5], [0, 4, 5], [0, 5, 1], [2, 3, 7], [2, 7, 6],
                      [0, 2, 6], [0, 6, 4], [1, 5, 7], [1, 7, 3]], np.int64)
        return P, F

    def _scene(self, slot: bool):
        boxes = [(0, 300, 0, 300, 0, 5), (0, 300, 0, 300, 295, 300), (0, 5, 0, 300, 0, 300), (295, 300, 0, 300, 0, 300),
                 (0, 300, 295, 300, 0, 300)]
        if slot:   # stěna y 0..5 se štěrbinou x 145..155, z 100..200
            boxes += [(0, 145, 0, 5, 0, 300), (155, 300, 0, 5, 0, 300), (145, 155, 0, 5, 0, 100), (145, 155, 0, 5, 200, 300)]
        else:
            boxes += [(0, 300, 0, 5, 0, 300)]
        zone = (100, 200, 100, 200, 100, 200)
        vs, fs, fo, zf = [], [], [0], []
        n = 0
        for b, z in [(b, 0) for b in boxes] + [(zone, 1)]:
            P, F = self._box(*b)
            vs.append(P)
            fs.append(F + n)
            n += len(P)
            fo.append(fo[-1] + len(F))
            zf.append(z)
        return np.concatenate(vs), np.concatenate(fs), np.array(fo), np.array(zf, bool), [0, 300, 0, 300, 0, 300]

    def test_closed_box_unreachable(self):
        v, f, fo, z, bb = self._scene(False)
        r = voxel.reach_grid(v, f, fo, z, bb, 5.0)
        self.assertEqual(r["paths"], [])

    def test_slot_found(self):
        v, f, fo, z, bb = self._scene(True)
        r = voxel.reach_grid(v, f, fo, z, bb, 4.0)
        self.assertEqual(len(r["paths"]), 1)                 # celá štěrbina ucpána → druhá cesta není
        p = r["paths"][0]
        self.assertTrue(145 <= p["nejuzsi"][0] <= 155, p["nejuzsi"])
        self.assertLessEqual(p["e"], 18.0)
        self.assertGreaterEqual(p["sr_primka"], 85.0)       # rovina štěrbiny y 0..5 → zóna y 100
        self.assertTrue(p["body"])


class RunChecksFakeTest(unittest.TestCase):
    def test_compose(self):
        d = tmp()
        model = _fcstd(d / "m.FCStd", [("Part::Feature", "A", "a", {})], {})
        (d / "PLCdesk_CAD.json").write_text(json.dumps({"parts": [{"id": "-M1:motor", "qty": 1, "location": "field"}]}),
                                            encoding="utf-8")

        def fake(script, args, slot, timeout):
            out = Path(args[1])
            out.write_text(json.dumps({"pruchod": {"listu": 1}, "checks": {
                "kolize": {"chyby": [{"kod": "kolize", "text": "A × B", "poloha": [1, 2, 3]}], "varovani": [], "info": []},
                "souvislost": {"selhalo": "Traceback…"},
                "otvory": {"teles": 1, "zon": 1, "zony": [], "grids": [{"vox": 5.0, "grid": [1, 1, 1], "paths": [
                    {"vox": 5.0, "e": 8.0, "sr_primka": 50.0, "sr_draha": 60.0, "nejuzsi": [0, 0, 0], "vstup": [0, -9, 0],
                     "e_mer": 10.0, "sr_mer": 100.0, "sr_draha_mer": 110.0, "bod_mer": [0, 0, 0], "tvar": "sterbina",
                     "delka_mer": 100.0}]}]},
                "kusovnik": {"objekty": [{"id": "-M1:motor", "inst": "1", "label": "m", "path": "m"}]},
                "step": {"chyby": [], "varovani": [], "info": [], "data": {}}}}), encoding="utf-8")
            return {"ok": True}

        rep = run.run_checks(model, run.ALL, fc_runner=fake, slot="x")
        self.assertEqual(rep["souhrn"]["stav"], "SELHALO")
        self.assertEqual(rep["souhrn"]["selhalo"], ["souvislost"])
        self.assertEqual(len(rep["checks"]["kolize"]["chyby"]), 1)
        self.assertEqual(rep["checks"]["otvory"]["info"][0]["sr_pozad"], 80.0)          # změřené e 10 → 80 ≤ 100
        self.assertEqual(rep["checks"]["kusovnik"]["chyby"], [])
        self.assertTrue((d / "kontroly.json").is_file())
        md = (d / "KONTROLY.md").read_text(encoding="utf-8")
        self.assertIn("SELHALO", md)
        self.assertIn("A × B", md)


@unittest.skipIf(os.environ.get("PLCDESK_SKIP_FC") == "1" or run.run_fc_path() is None or run.freecad_bin() is None,
                 "FreeCAD / run_fc.ps1 není (nebo PLCDESK_SKIP_FC=1)")
class FreeCADSynthTest(unittest.TestCase):
    """Syntetický model se známými nálezy (pro3d_synth_build.py) — FreeCAD jen ve vlastní instanci (slot pro3d-test)."""

    def test_vse(self):
        d = tmp()
        model = d / "Synth.FCStd"
        s = run.fc_run(HERE / "pro3d_synth_build.py", [model], "pro3d-test", 300)
        self.assertTrue(s.get("ok"), s)
        (d / "PLCdesk_CAD.json").write_text(json.dumps({"project": {"guid": ""}, "parts": [
            {"id": "-M1:motor", "qty": 1, "location": "field", "mount": "floor"},
            {"id": "-Q1:mcb", "qty": 1, "location": "cabinet", "mount": "din"}]}), encoding="utf-8")
        rep = run.run_checks(model, run.ALL, slot="pro3d-test", timeout=900, grids=(5.0, 3.0))
        c = rep["checks"]
        self.assertTrue(c["kolize"]["data"]["kalibrace"]["ok"])
        kol = sorted(f["text"].split(":")[0] for f in c["kolize"]["chyby"])
        self.assertEqual(kol, ["Deska × Kolidujici blok", "[dveře dolů] Deska × Dvere [dveře dolů]"])
        self.assertTrue(any("Šroub" in f["text"] and "souosá díra" in f["text"] for f in c["kolize"]["info"]))
        air = [f for f in c["souvislost"]["chyby"] if f["kod"] == "ve-vzduchu"]
        self.assertEqual(len(air), 1)
        self.assertIn("Volny dil", air[0]["text"])
        self.assertTrue(any(f["kod"] == "volne-celo" for f in c["souvislost"]["varovani"]))
        otv = c["otvory"]
        self.assertEqual(len(otv["chyby"]), 1)                  # čtverec 30 × 30, Sr 85 < 120
        self.assertAlmostEqual(otv["chyby"][0]["e"], 30.0, delta=1.0)
        self.assertEqual(otv["chyby"][0]["sr_pozad"], 120.0)
        ok = [f for f in otv["info"] if f["kod"] == "otvor"]
        self.assertEqual(len(ok), 1)                             # štěrbina 10 × 100, Sr ≥ 80
        self.assertAlmostEqual(ok[0]["e"], 10.0, delta=0.5)
        self.assertEqual(sorted(f["kod"] for f in c["kusovnik"]["chyby"]), ["kusovnik-duplicita", "kusovnik-pocet"])
        self.assertEqual(c["step"]["chyby"], [])
        self.assertEqual(c["step"]["data"]["teles_model"], c["step"]["data"]["teles_step"])
        self.assertEqual(rep["souhrn"]["stav"], "CHYBY")
        self.assertLessEqual(len((d / "KONTROLY.md").read_text(encoding="utf-8").splitlines()), 40)


    def test_vedeni(self):
        """Vedení kabelů a hadic (pro3d_synth_vedeni.py): žlab bez šroubu = chyba, kabel ve žlabu / obálce řetězu
        a hadice zasunutá do šroubení povolené, hadice skrz šroubení a díl v dráze řetězu = kolize."""
        d = tmp()
        model = d / "SynthVedeni.FCStd"
        s = run.fc_run(HERE / "pro3d_synth_vedeni.py", [model], "pro3d-test", 300)
        self.assertTrue(s.get("ok"), s)
        rep = run.run_checks(model, ("kolize", "souvislost"), slot="pro3d-test", timeout=600)
        c = rep["checks"]
        self.assertTrue(c["kolize"]["data"]["kalibrace"]["ok"])
        kol = sorted(" × ".join(sorted(f["text"].split(":")[0].split(" × "))) for f in c["kolize"]["chyby"])
        self.assertEqual(kol, ["Hadice PUN-H 6 skrz šroubení × Šroubení QS-G1/8-6 druhé",
                               "Obálka řetězu E1 × Snímač -B9 v dráze řetězu"], c["kolize"]["chyby"])
        allowed = {frozenset(f["text"].split(":")[0].split(" × ")): f["text"] for f in c["kolize"]["info"]}
        for pair, why in ((("Kabel -W101 ve žlabu", "Žlab přišroubovaný k profilu"), "ve vedení"),
                          (("Kabel -W102 v řetězu", "Obálka řetězu E1"), "ve vedení"),
                          (("Hadice PUN-H 6 zasunutá", "Šroubení QS-G1/8-6"), "hadice zasunutá do šroubení"),
                          (("Profil 40x40 sloup", "Šroub ISO 4762 M6x20"), "souosá díra")):
            self.assertIn(why, allowed.get(frozenset(pair), ""), (pair, list(allowed.values())))
        tray = [f for f in c["souvislost"]["chyby"] if f["kod"] == "zlab-bez-spoje"]
        self.assertEqual([f["text"].split(":")[0] for f in tray], ["Žlab 40×60 bez šroubu"])
        self.assertEqual(c["souvislost"]["data"]["zlab_bez_spoje"], 1)
        self.assertFalse([f for f in c["souvislost"]["chyby"] if f["kod"] == "ve-vzduchu"], c["souvislost"]["chyby"])


if __name__ == "__main__":
    unittest.main()
