"""register_manual.py (převzato ze stagingu plcdesk_freecad) — seznam ke stažení a registrace ručních modelů
(bez sítě, bez FreeCADu: měření je mock). Původní testy pytest, spouštěné adaptérem unittest na konci souboru."""
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from plc_studio.pro3d_download import models_index as MI  # noqa: E402
from plc_studio.pro3d_download import register_manual as RM  # noqa: E402


STEP = ("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((''),'2;1');\nFILE_NAME('x','2026-10-14',(''),(''),'','','');\n"
        "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n")


def manifest():
    P = lambda i, cat, brand, code, **k: dict({"id": i, "tag": i.split(":")[0], "category": cat, "brand": brand,
                                               "orderCode": code, "label": cat, "type": f"{code} typ", "qty": 1}, **k)
    return {"project": {"guid": "g", "name": "Test"}, "parts": [
        P("-Y1:valve_solenoid", "valve_solenoid", "Festo", "574371"),
        P("-Y3:valve_solenoid", "valve_solenoid", "Festo", "574371"),
        P("+1:cabinet", "cabinet", "Rittal", "1050.000"),
        P("-TA1:vfd", "vfd", "Siemens", "6SL3210-5BE17-5UV0"),
        P("-M1:gearmotor", "gearmotor", "Siemens", ""),
        P("-W1xx:cable_sensor", "cable_sensor", "ifm electronic", "EVC002"),
    ]}


LINKS = {("festo", "574371"): {"url": "https://www.3dfindit.com/en/digitaltwin/?path=festo%2Fvuvg.prj", "lineId": 1350,
                               "typecode": "VUVG", "src": "t"},
         ("rittal", "1050000"): {"url": "https://www.3dfindit.com/en/digitaltwin/?path=rittal%2Fae.prj", "lineId": 180,
                                 "typecode": "", "src": "t"}}


def fake_measure(calls, ok=True):
    def m(files):
        calls.append([str(f) for f in files])
        return {str(f): ({"ok": True, "solids": 1, "volume_mm3": 1234.5, "bbox_mm": [10, 20, 30]} if ok
                         else {"ok": False, "solids": 0, "volume_mm3": 0}) for f in files}
    return m


def test_plan_groups_priority_and_sources(tmp_path):
    rows = RM.plan_project(manifest(), tmp_path / "models", LINKS)
    ids = [r["partId"] for r in rows]
    assert ids[0] == "+1:cabinet"                                  # rozvaděč první
    assert "-W1xx:cable_sensor" not in sum((r["partIds"] for r in rows), [])   # kabel bez modelu
    v = next(r for r in rows if r["partId"] == "-Y1:valve_solenoid")
    assert v["partIds"] == ["-Y1:valve_solenoid", "-Y3:valve_solenoid"]          # stejný kód = jeden soubor
    assert v["file"] == "Y1_valve_solenoid.stp" and v["where"] == "3dfindit" and v["source"] == "manual-3dfindit"
    s = next(r for r in rows if r["partId"] == "-TA1:vfd")
    assert s["where"] == "siemens" and s["source"] == "manual-siemens"           # Siemens přes SiePortal
    assert "6SL3210-5BE17-5UV0" in s["vendorUrl"]
    g = next(r for r in rows if r["partId"] == "-M1:gearmotor")
    assert g["where"] == "doplnit kód" and g["status"] == "chybí — bez kódu" and "{" not in g["vendorUrl"]
    assert all(r["status"].startswith("chybí") for r in rows)


def test_days_cap():
    rows = [{"where": "3dfindit", "status": "chybí"} for _ in range(50)] + [{"where": "siemens", "status": "chybí"}]
    n = RM.assign_days([("11", rows)], cap=45)
    assert n == 50 and rows[44]["day"] == 1 and rows[45]["day"] == 2 and rows[50]["day"] is None


def test_register_replaces_placeholder_and_shares(tmp_path):
    md = tmp_path / "models"
    (md / "placeholders").mkdir(parents=True)
    (md / "placeholders" / "Y1_valve_solenoid.stp").write_text(STEP)
    idx = MI.load(md, {"guid": "g"})
    idx["parts"]["-Y1:valve_solenoid"] = {"source": "placeholder", "file": "placeholders/Y1_valve_solenoid.stp"}
    MI.save(md, idx)
    (md / "manual").mkdir()
    (md / "manual" / "Y1_valve_solenoid.stp").write_text(STEP)
    (md / "manual" / "TA1_vfd@3dfindit.STEP").write_text(STEP)       # přípona zdroje + velká písmena
    (md / "manual" / "neco_jineho.stp").write_text(STEP)
    calls = []
    rep = RM.register(manifest(), md, "Tester", links=LINKS, measure=fake_measure(calls), now="2026-10-14T12:00:00")
    assert len(calls) == 1 and len(calls[0]) == 2                     # jeden běh FreeCADu pro všechny soubory
    idx = json.loads((md / "index.json").read_text(encoding="utf-8"))
    e1, e3 = idx["parts"]["-Y1:valve_solenoid"], idx["parts"]["-Y3:valve_solenoid"]
    assert e1["source"] == "manual-3dfindit" and e1["file"] == "manual/Y1_valve_solenoid.stp"
    assert e1["replaced"] == {"source": "placeholder", "file": "placeholders/Y1_valve_solenoid.stp"}
    assert e1["by"] == "Tester" and e1["downloaded"] == "2026-10-14" and e1["format"] == "STEP AP214"
    assert e1["check"]["volume_mm3"] > 0 and e1["lineId"] == 1350 and len(e1["sha256"]) == 64
    assert e3["file"] == e1["file"]                                    # sdílený model téhož kódu
    assert idx["parts"]["-TA1:vfd"]["source"] == "manual-3dfindit"     # z přípony @3dfindit
    assert rep["unmatched"] == ["neco_jineho.stp"]
    assert any(m["partId"] == "+1:cabinet" for m in rep["missing"])
    assert MI.has_vendor_model(md, idx, "-Y3:valve_solenoid")
    # podruhé beze změny: FreeCAD se nevolá, index stejný
    calls2 = []
    rep2 = RM.register(manifest(), md, "Tester", links=LINKS, measure=fake_measure(calls2))
    assert calls2 == [] and not rep2["registered"] and "-Y1:valve_solenoid" in rep2["unchanged"]
    # seznam teď ukazuje staženo
    rows = RM.plan_project(manifest(), md, LINKS)
    assert next(r for r in rows if r["partId"] == "-Y1:valve_solenoid")["status"] == "staženo, zaevidováno"


def test_register_rejects_bad_files(tmp_path):
    md = tmp_path / "models"
    (md / "manual").mkdir(parents=True)
    (md / "manual" / "1_cabinet.stp").write_bytes(b"PK\x03\x04zip")          # ZIP uložený jako .stp
    (md / "manual" / "Y1_valve_solenoid.stp").write_text(STEP)
    calls = []
    rep = RM.register(manifest(), md, "T", links=LINKS, measure=fake_measure(calls, ok=False))
    why = {r["file"]: r["why"] for r in rep["rejected"]}
    assert "ZIP" in why["1_cabinet.stp"] and "objem" in why["Y1_valve_solenoid.stp"]
    assert calls == [[str(md / "manual" / "Y1_valve_solenoid.stp")]]       # ZIP do FreeCADu nejde
    assert not (md / "index.json").exists()                                  # nic se nezapsalo


def test_dry_run_and_source_cli(tmp_path):
    md = tmp_path / "models"
    (md / "manual").mkdir(parents=True)
    (md / "manual" / "1_cabinet.stp").write_text(STEP)
    rep = RM.register(manifest(), md, "T", links=LINKS, measure=fake_measure([]), dry_run=True, cli_source="rittal")
    assert rep["registered"][0]["source"] == "manual-rittal" and not (md / "index.json").exists()


def test_measure_fc_uses_run_fc(monkeypatch, tmp_path):
    """FreeCAD jen přes run_fc.ps1 s vlastním slotem a timeoutem; po timeoutu cleanup jen vlastního slotu."""
    seen = []
    monkeypatch.setattr(RM, "RUN_FC", tmp_path / "run_fc.ps1")
    (tmp_path / "run_fc.ps1").write_text("#")

    class R:
        def __init__(self, out):
            self.stdout = out

    def fake_run(cmd, **kw):
        seen.append(cmd)
        if "run" in cmd:
            out = cmd[cmd.index(str(RM.HERE / "check_step.py")) + 1]
            open(out, "w", encoding="utf-8").write(json.dumps({"a.stp": {"ok": True, "volume_mm3": 1}}))
            return R(b'log\n{"ok": true, "timed_out": false, "leftover": []}\n')
        return R(b"{}")

    monkeypatch.setattr(RM.subprocess, "run", fake_run)
    res = RM.measure_fc([tmp_path / "a.stp"], 120, "muj_slot")
    assert res == {"a.stp": {"ok": True, "volume_mm3": 1}}
    c = seen[0]
    assert str(tmp_path / "run_fc.ps1") in c and c[c.index("--slot") + 1] == "muj_slot" and c[c.index("--timeout") + 1] == "120"
    assert len(seen) == 1                                                     # bez úklidu, když nic nezůstalo


def test_vendor_source_helpers():
    assert MI.is_vendor_model({"source": "manual-siemens"}) and MI.is_vendor_model({"source": "3dfindit"})
    assert not MI.is_vendor_model({"source": "placeholder"}) and not MI.is_vendor_model(None)
    assert RM.source_for("Siemens", "manual-3dfindit", None) == "manual-siemens"
    assert RM.source_for("", "manual-3dfindit", "festo") == "manual-festo"
    assert RM.vendor_key("Siemens / Innomotics") == "siemens" and RM.vendor_key("ifm electronic") == "ifm"


class _MonkeyPatch:
    def __init__(self):
        self.undo = []

    def setattr(self, obj, name, value):
        self.undo.append((obj, name, getattr(obj, name)))
        setattr(obj, name, value)

    def restore(self):
        for obj, name, value in reversed(self.undo):
            setattr(obj, name, value)


class RegisterManualTest(unittest.TestCase):
    def tmp(self) -> Path:
        d = tempfile.mkdtemp(prefix="regman_")
        self.addCleanup(shutil.rmtree, d, True)
        return Path(d)

    def test_plan_groups_priority_and_sources(self):
        test_plan_groups_priority_and_sources(self.tmp())

    def test_days_cap(self):
        test_days_cap()

    def test_register_replaces_placeholder_and_shares(self):
        test_register_replaces_placeholder_and_shares(self.tmp())

    def test_register_rejects_bad_files(self):
        test_register_rejects_bad_files(self.tmp())

    def test_dry_run_and_source_cli(self):
        test_dry_run_and_source_cli(self.tmp())

    def test_measure_fc_uses_run_fc(self):
        mp = _MonkeyPatch()
        self.addCleanup(mp.restore)
        test_measure_fc_uses_run_fc(mp, self.tmp())

    def test_vendor_source_helpers(self):
        test_vendor_source_helpers()


if __name__ == "__main__":
    unittest.main()
