"""Testy automatického postupu PLCdesk PRO (plc_studio/pro_pipeline.py) — bez volání AI.

Fáze ① (vstupy z PLCdesk) běží naostro přes most jádra na vzoru 01; běhy agentů jsou podvržené (runner zapíše
protokol K5 s verdiktem podle scénáře), CLI ``--no-ai``.

Spuštění (z apps/desktop):  python -m unittest tests.test_pro_pipeline -v
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
os.environ.setdefault("PLCSTUDIO_HOME", tempfile.mkdtemp(prefix="plcstudio_pptest_"))

from plc_studio import pro_pipeline as pp  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
SAMPLE01 = ROOT / "samples" / "01_pasovy_dopravnik_vyhazovac.plcstudio.json"
PRJ01 = json.loads(SAMPLE01.read_text(encoding="utf-8"))["prj"]


def fake_inputs(folder, prj, log=print):
    (Path(folder) / "PLCdesk_CAD.json").write_text("{}", encoding="utf-8")
    return ["PLCdesk_CAD.json"]


def write_checks(folder, unit, rnd, stav="OK"):
    out = Path(folder) / pp.UNIT[unit]["sub"] / f"k5_kolo{rnd}"
    out.mkdir(parents=True, exist_ok=True)
    (out / "kontroly.json").write_text(json.dumps({"souhrn": {"stav": stav, "chyby": 0, "varovani": 0}}),
                                       encoding="utf-8")


class FakeRunner:
    """Podvržený běh agenta: stavitel nic nedělá, K5 zapíše protokol s verdiktem ze seznamu ``verdicts[unit]``."""

    def __init__(self, verdicts: dict, fail_at: tuple | None = None, touch_model: tuple | None = None,
                 checks: bool = True):
        self.verdicts = {k: list(v) for k, v in verdicts.items()}
        self.calls: list[tuple] = []
        self.fail_at = fail_at
        self.touch_model = touch_model
        self.checks = checks       # K5 zapíše k5_kolo<N>/kontroly.json se stavem OK

    def __call__(self, pipe, role, prompt, extra, log_path):
        unit = next(k for k in pp.AI_UNITS if f"_{k}_kolo" in log_path.name)
        rnd = int(log_path.name.split("_kolo")[1].split("_")[0])
        self.calls.append((unit, role, rnd))
        log_path.write_text(prompt, encoding="utf-8")
        if self.fail_at == (unit, role, rnd):
            return {"state": "failed"}
        if role == "k5":
            v = self.verdicts.get(unit, ["ok"]).pop(0) if self.verdicts.get(unit) else "ok"
            f = pp.k5_file(pipe.folder, unit, rnd)
            f.parent.mkdir(parents=True, exist_ok=True)
            word = {"ok": "**SCHVÁLENO**", "back": "**VRÁCENO** staviteli", "none": "nevím"}[v]
            f.write_text(f"# K5 {unit}\n\n## Verdikt: {word}\n", encoding="utf-8")
            if self.checks:
                write_checks(pipe.folder, unit, rnd)
            if self.touch_model == (unit, rnd):
                (pipe.folder / "x.FCStd").write_bytes(os.urandom(8))
        else:
            sub = pipe.folder / pp.UNIT[unit]["sub"]
            (sub / "ZPRAVA.md").write_text(f"ODHAD: výška {unit} 900 mm\n", encoding="utf-8")
        return {"state": "done", "cost": 0.5, "tin": 100, "tout": 10, "turns": 2}


def tmpdir() -> Path:
    return Path(tempfile.mkdtemp(prefix="pp_"))


class VerdictTest(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(pp.parse_verdict("# x\n## Verdikt: **SCHVÁLENO** k předložení\n"), "ok")
        self.assertEqual(pp.parse_verdict("**Verdikt: VRÁCENO.** body"), "back")
        self.assertEqual(pp.parse_verdict("## Verdikt: **VRÁCENO** staviteli (1 bod)"), "back")
        self.assertEqual(pp.parse_verdict("bez verdiktu"), "")
        self.assertEqual(pp.parse_verdict(""), "")

    def test_prompts(self):
        d = Path("C:/stroj")
        p = pp.builder_prompt(d, "frame", 2, "", "Profil 40×40.", "Stroj", test_safety=True)
        self.assertIn("ram/KONTROLA_K5_ram_kolo1.md", p)
        self.assertIn("Profil 40×40.", p)
        self.assertIn(pp.TEST_MARK, p)
        self.assertIn("{x}", pp.builder_prompt(d, "frame", 1, "vlastní {sub} {x}"))   # neznámé závorky zůstanou
        self.assertIn("vlastní ram", pp.builder_prompt(d, "frame", 1, "vlastní {sub} {x}"))
        k = pp.k5_prompt(d, "concept", 3)
        self.assertIn("koncept/KONTROLA_K5_koncept_kolo3.md", k)
        self.assertIn("NEMĚNÍŠ", k)
        self.assertIn("SHA-256", k)
        self.assertIn("ne proti", k)
        ex = pp.system_extra("cabinet", False)
        for must in ("ODHAD", "PLCdesk_CAD_feedback_rozvadec.json", "NEPOUŽIJE", "App::Link", "ISO 13857",
                     "255,140,0", "plm scan", "3Dfindit", "vlastní slot", "graf souvislosti", "rozvadec-3d"):
            self.assertIn(must, ex)
        self.assertNotIn("TEST", ex)
        self.assertIn(pp.TEST_MARK, pp.system_extra("cabinet", True))
        for k in pp.AI_UNITS:
            self.assertNotIn("01", pp.default_prompt(k), "šablony bez specifik stroje 01")


class AutomatonTest(unittest.TestCase):
    def pipe(self, folder, runner, **kw):
        return pp.Pipeline(folder, PRJ01, runner=runner, inputs_fn=fake_inputs, **kw)

    def test_all_approved_with_rounds(self):
        d = tmpdir()
        r = FakeRunner({"concept": ["back", "ok"], "frame": ["back", "back", "back"], "modules": ["none", "ok"]})
        p = self.pipe(d, r, test_safety=True)
        self.assertEqual(p.run(), "done")
        u = p.state["units"]
        self.assertEqual(u["inputs"]["state"], "done")
        self.assertEqual((u["concept"]["state"], len(u["concept"]["rounds"])), ("approved", 2))
        self.assertEqual((u["frame"]["state"], len(u["frame"]["rounds"])), ("rejected", 3), "max 3 kola")
        self.assertEqual(u["assembly"]["state"], "approved", "neschválená část — pokračuje se další")
        self.assertEqual(u["modules"]["rounds"][0]["verdict"], "none")
        # 1. kolo konceptu = role Koncept, opravy = Stavitel
        self.assertEqual(r.calls[:4], [("concept", "concept", 1), ("concept", "k5", 1), ("concept", "builder", 2),
                                       ("concept", "k5", 2)])
        st = json.loads((d / pp.STATE_FILE).read_text(encoding="utf-8"))
        self.assertEqual(st["status"], "done")
        self.assertTrue((d / "logy" / "01_concept_kolo1_concept.log").is_file())
        prehled = (d / pp.SUMMARY_FILE).read_text(encoding="utf-8")
        for must in (pp.TEST_MARK, "neschváleno", "VRÁCENO", "SCHVÁLENO", "ram/KONTROLA_K5_ram_kolo3.md",
                     "ODHAD: výška frame", "NEPOUŽITA", "Celkem:** 9.00 USD"):
            self.assertIn(must, prehled)
        self.assertEqual(pp.phase_state(p.state, "build"), ("rejected", 3))
        self.assertEqual(pp.phase_state(p.state, "concept")[0], "approved")
        self.assertEqual(pp.progress(p.state), 1.0)

    def test_concept_rejected_stops(self):
        d = tmpdir()
        r = FakeRunner({"concept": ["back"] * 5})
        p = self.pipe(d, r, max_rounds=2)
        self.assertEqual(p.run(), "rejected")
        self.assertEqual(len(p.state["units"]["concept"]["rounds"]), 2)
        self.assertEqual(p.state["units"]["cabinet"]["state"], "waiting", "stavba nad neschváleným konceptem ne")
        self.assertFalse(any(c[0] != "concept" for c in r.calls))

    def test_failure_and_resume(self):
        d = tmpdir()
        r = FakeRunner({}, fail_at=("cabinet", "k5", 1))
        p = self.pipe(d, r)
        self.assertEqual(p.run(), "failed")
        self.assertEqual(p.state["units"]["cabinet"]["state"], "failed")
        # navázání z pipeline.json: vstupy a koncept se neopakují, stavitel kola 1 hotový → jen K5
        r2 = FakeRunner({})
        p2 = self.pipe(d, r2)
        self.assertEqual(p2.state["units"]["concept"]["state"], "approved")
        self.assertEqual(p2.run(), "done")
        self.assertEqual(r2.calls[0], ("cabinet", "k5", 1))
        self.assertNotIn("concept", {c[0] for c in r2.calls})
        # Spustit od fáze: krok a další znovu, historie zůstane
        r3 = FakeRunner({})
        p3 = self.pipe(d, r3)
        self.assertEqual(p3.run("build"), "done")
        self.assertEqual(r3.calls[0], ("cabinet", "builder", 1))
        self.assertTrue(p3.state["units"]["cabinet"]["history"])

    def test_stop(self):
        d = tmpdir()

        class Stopper(FakeRunner):
            def __call__(self, pipe, role, prompt, extra, log_path):
                pipe.stop()
                return {"state": "stopped"}

        p = self.pipe(d, Stopper({}))
        self.assertEqual(p.run(), "stopped")
        self.assertEqual(p.state["units"]["concept"]["state"], "stopped")
        self.assertEqual(pp.phase_state(p.state, "concept")[0], "stopped")

    def test_k5_must_not_change_model(self):
        d = tmpdir()
        r = FakeRunner({"concept": ["ok", "ok"]}, touch_model=("concept", 1))
        p = self.pipe(d, r)
        p.run()
        c = p.state["units"]["concept"]
        self.assertEqual(c["rounds"][0]["verdict"], "none", "změna FCStd kontrolorem = verdikt neplatí")
        self.assertEqual(c["rounds"][0]["k5Modified"], ["x.FCStd"])
        self.assertEqual(c["state"], "approved")
        self.assertIn("verdikt neplatí", (d / pp.SUMMARY_FILE).read_text(encoding="utf-8"))

    def test_no_ai(self):
        p = self.pipe(tmpdir(), None, ai=False)
        self.assertEqual(p.run(), "noai")
        self.assertEqual({p.state["units"][k]["state"] for k in pp.AI_UNITS}, {"skipped"})


class InputsTest(unittest.TestCase):
    def test_inputs_sample01_and_cli(self):
        d = tmpdir() / "stroj"
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = pp.main(["--sample", str(SAMPLE01), "--out", str(d), "--no-ai"])
        self.assertEqual(code, 0, buf.getvalue())
        for f in ("PLCdesk_CAD.json", "projekt.plcstudio.json", "ROZBOR.md", "KUSOVNIK.csv", "PROGRAM.md", "STAV.md",
                  pp.STATE_FILE, pp.SUMMARY_FILE):
            self.assertTrue((d / f).is_file(), f)
        man = json.loads((d / "PLCdesk_CAD.json").read_text(encoding="utf-8"))
        self.assertEqual(man.get("format"), "plcdesk-cad")
        self.assertTrue(list((d / "program").rglob("*.scl")) or list((d / "program").rglob("*.st")))
        prog = (d / "PROGRAM.md").read_text(encoding="utf-8")
        self.assertIn("Emulace překladu", prog)
        self.assertIn("Emulace běhu", prog)
        self.assertIn("Fáze 1", buf.getvalue())
        st = json.loads((d / pp.STATE_FILE).read_text(encoding="utf-8"))
        self.assertEqual(st["status"], "noai")
        self.assertEqual(st["units"]["inputs"]["state"], "done")


class ModelsAndChecksTest(unittest.TestCase):
    """Model a limit kol podle role, kontroly kódem v pokynech, K5 verdikt × kontroly.json, přehled."""

    def test_defaults_command_and_persist(self):
        from plc_studio import pro_agent as pa
        d = tmpdir()
        p = pp.Pipeline(d, PRJ01, inputs_fn=fake_inputs, runner=FakeRunner({}))
        self.assertEqual(p.model_for("concept"), "claude-opus-5-5")
        self.assertEqual(p.model_for("builder"), "claude-sonnet-5-5")
        self.assertEqual(p.model_for("k5"), "claude-sonnet-5-5")
        self.assertEqual((p.turns_for("builder"), p.turns_for("k5"), p.turns_for("concept")), (60, 40, 60))
        cmd = p.command("C:/x/claude.exe", "k5", "extra")
        self.assertEqual(cmd[cmd.index("--model") + 1], "claude-sonnet-5-5")
        self.assertEqual(cmd[cmd.index("--max-turns") + 1], "40")
        self.assertIn(str(pp.TOOLS_DIR), [cmd[i + 1] for i, x in enumerate(cmd) if x == "--add-dir"])
        self.assertIn("Bash(powershell *)", cmd[cmd.index("--allowedTools") + 1])
        p2 = pp.Pipeline(d, PRJ01, inputs_fn=fake_inputs, runner=FakeRunner({}),
                         models={"builder": "claude-haiku-4-5-20251001"}, turns={"k5": 25})
        p2.save()
        p3 = pp.Pipeline(d, PRJ01, inputs_fn=fake_inputs, runner=FakeRunner({}))    # navázání z pipeline.json
        self.assertEqual(p3.model_for("builder"), "claude-haiku-4-5-20251001")
        self.assertEqual(p3.turns_for("k5"), 25)
        self.assertEqual(p3.model_for("concept"), "claude-opus-5-5")
        self.assertIn("claude-opus-5-5", pa.known_models())

    def test_prompts_run_tools(self):
        d = Path("C:/stroj")
        b = pp.builder_prompt(d, "frame", 1)
        self.assertIn("pro3d.ps1", b)
        self.assertIn("--out ram", b)
        self.assertIn("Konstrukce_Typ", b)
        k = pp.k5_prompt(d, "frame", 2)
        self.assertIn("--out ram/k5_kolo2", k)
        self.assertIn("pro3d-k5", k)
        self.assertIn("SELHALO = VRÁCENO", k)

    def test_k5_approved_with_failed_checks_is_returned(self):
        class R(FakeRunner):
            def __call__(self, pipe, role, prompt, extra, log_path):
                res = super().__call__(pipe, role, prompt, extra, log_path)
                unit, _r, rnd = self.calls[-1]
                if role == "k5":
                    out = pipe.folder / pp.UNIT[unit]["sub"] / f"k5_kolo{rnd}"
                    out.mkdir(parents=True, exist_ok=True)
                    st = "CHYBY" if (unit, rnd) == ("concept", 1) else "OK"
                    (out / "kontroly.json").write_text(json.dumps({"souhrn": {"stav": st, "chyby": int(st != "OK"),
                                                                              "varovani": 0}}), encoding="utf-8")
                return dict(res, model=pipe.model_for(role), maxTurns=pipe.turns_for(role))

        d = tmpdir()
        p = pp.Pipeline(d, PRJ01, inputs_fn=fake_inputs, runner=R({}))
        self.assertEqual(p.run(), "done")
        rc = p.state["units"]["concept"]["rounds"]
        self.assertEqual([r["verdict"] for r in rc], ["back", "ok"])
        self.assertEqual(rc[0]["k5ChecksOverride"], "CHYBY")
        self.assertEqual(rc[0]["checks"]["file"], "koncept/k5_kolo1/kontroly.json")
        summ = (d / pp.SUMMARY_FILE).read_text(encoding="utf-8")
        self.assertIn("`claude-opus-5-5`", summ)
        self.assertIn("`claude-sonnet-5-5`", summ)
        self.assertIn("Běhy agentů", summ)
        self.assertIn("verdikt SCHVÁLENO zneplatněn", summ)
        self.assertIn("2 / 60", summ)

    def test_reset_from_archives_outputs(self):
        d = tmpdir()
        p = pp.Pipeline(d, PRJ01, inputs_fn=fake_inputs, runner=FakeRunner({}))
        self.assertEqual(p.run(), "done")
        (d / "rozvadec" / "Rozvadec.FCStd").write_bytes(b"old")
        r = FakeRunner({})
        p2 = pp.Pipeline(d, PRJ01, inputs_fn=fake_inputs, runner=r)
        self.assertEqual(p2.run("cabinet"), "done")
        arch = p2.state["archives"]
        self.assertEqual(len(arch), 1)
        a = d / arch[0]["dir"]
        self.assertTrue(arch[0]["dir"].startswith("_archiv/"))
        self.assertTrue((a / "rozvadec" / "Rozvadec.FCStd").is_file(), "nic se nemaže, jen přesune")
        self.assertTrue((a / "ram" / "ZPRAVA.md").is_file())
        self.assertFalse((a / "koncept").exists(), "koncept se neresetuje")
        self.assertTrue((a / "logy" / "02_cabinet_kolo1_builder.log").is_file())
        self.assertFalse((d / "rozvadec" / "Rozvadec.FCStd").exists())
        self.assertEqual(arch[0]["units"], ["cabinet", "frame", "modules", "assembly"])
        prompt = (d / "logy" / "02_cabinet_kolo1_builder.log").read_text(encoding="utf-8")
        self.assertIn("STAVBA ZNOVU", prompt)
        self.assertIn(f"{arch[0]['dir']}/rozvadec", prompt)
        self.assertIn("App::Link", prompt)
        self.assertNotIn("STAVBA ZNOVU", pp.builder_prompt(d, "cabinet", 1))
        summ = (d / pp.SUMMARY_FILE).read_text(encoding="utf-8")
        self.assertIn("Archiv dřívějších výstupů", summ)
        self.assertIn(arch[0]["dir"], summ)
        self.assertNotIn("_archiv", "".join(pp.collect_estimates(d)))

    def test_k5_without_checks_is_returned(self):
        d = tmpdir()
        r = FakeRunner({}, checks=False)
        p = pp.Pipeline(d, PRJ01, inputs_fn=fake_inputs, runner=r, max_rounds=2)
        self.assertEqual(p.run(), "rejected", "SCHVÁLENO bez kontrol skriptem neplatí")
        r0 = p.state["units"]["concept"]["rounds"][0]
        self.assertEqual(r0["verdict"], "back")
        self.assertEqual(r0["verdictText"], "VRÁCENO (bez kontrol skriptem)")
        self.assertEqual(r0["k5NoChecks"], "missing")
        self.assertIn("pro3d_tools vse", r0["autoPoints"][0])
        prot = pp.k5_file(d, "concept", 1).read_text(encoding="utf-8")
        self.assertIn("Automatický bod PLCdesk", prot)
        self.assertIn("pro3d_tools vse", prot)
        st = json.loads((d / pp.STATE_FILE).read_text(encoding="utf-8"))
        self.assertEqual(st["units"]["concept"]["rounds"][0]["verdictText"], "VRÁCENO (bez kontrol skriptem)")
        self.assertIn("bez kontrol skriptem", (d / pp.SUMMARY_FILE).read_text(encoding="utf-8"))
        # SELHALO = také VRÁCENO

        class R(FakeRunner):
            def __call__(self, pipe, role, prompt, extra, log_path):
                res = super().__call__(pipe, role, prompt, extra, log_path)
                if role == "k5":
                    write_checks(pipe.folder, *self.calls[-1][::2], stav="SELHALO")
                return res

        p2 = pp.Pipeline(tmpdir(), PRJ01, inputs_fn=fake_inputs, runner=R({}), max_rounds=1)
        self.assertEqual(p2.run(), "rejected")
        self.assertEqual(p2.state["units"]["concept"]["rounds"][0]["k5NoChecks"], "SELHALO")

    def test_k5_max_turns_continues_once(self):
        class R(FakeRunner):
            def __init__(self, fails):
                super().__init__({})
                self.fails = fails

            def __call__(self, pipe, role, prompt, extra, log_path):
                self.prompts = getattr(self, "prompts", []) + [(role, log_path.name, prompt)]
                if role == "k5" and self.fails > 0:
                    self.fails -= 1
                    self.calls.append(("x", role, 0))
                    return {"state": "failed", "subtype": "error_max_turns", "cost": 1.0, "turns": 40}
                return super().__call__(pipe, role, prompt, extra, log_path)

        d = tmpdir()
        r = R(1)
        p = pp.Pipeline(d, PRJ01, inputs_fn=fake_inputs, runner=r)
        self.assertEqual(p.run(), "done")
        k = p.state["units"]["concept"]["rounds"][0]["k5"]
        self.assertEqual((k["state"], k["continued"]), ("done", 1))
        self.assertAlmostEqual(k["cost"], 1.5)
        self.assertEqual(k["turns"], 42)
        cont = [x for x in r.prompts if x[1].endswith("_k5_pokracovani.log")]
        self.assertEqual(len(cont), 1)
        self.assertIn("POKRAČOVÁNÍ KONTROLY", cont[0][2])
        self.assertIn("koncept/KONTROLA_K5_koncept_kolo1.md", cont[0][2])
        # druhé selhání = failed
        p2 = pp.Pipeline(tmpdir(), PRJ01, inputs_fn=fake_inputs, runner=R(2))
        self.assertEqual(p2.run(), "failed")
        k2 = p2.state["units"]["concept"]["rounds"][0]["k5"]
        self.assertEqual((k2["state"], k2["continued"]), ("failed", 1))

    def test_cli_models(self):
        seen = {}
        orig = pp.Pipeline

        class P(orig):
            def __init__(self, *a, **kw):
                super().__init__(*a, **kw)
                seen.update(self.state["models"], turns=self.state["maxTurns"])

            def run(self, from_unit=None):
                return "noai"

        pp.Pipeline = P
        try:
            with redirect_stdout(io.StringIO()):
                pp.main(["--sample", str(SAMPLE01), "--out", str(tmpdir()), "--no-ai", "--model-build", "claude-opus-5-5",
                         "--turns-check", "30"])
        finally:
            pp.Pipeline = orig
        self.assertEqual(seen["builder"], "claude-opus-5-5")
        self.assertEqual(seen["concept"], "claude-opus-5-5")
        self.assertEqual(seen["k5"], "claude-sonnet-5-5")
        self.assertEqual(seen["turns"]["k5"], 30)


if __name__ == "__main__":
    unittest.main()
