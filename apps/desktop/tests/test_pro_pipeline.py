"""Testy automatického postupu PLCdesk PRO (plc_studio/pro_pipeline.py) — bez volání AI.

Fáze ① (vstupy z PLCdesk) běží naostro přes most jádra na vzoru 01; běhy agentů jsou podvržené (runner zapíše
protokol K5 s verdiktem podle scénáře), CLI ``--no-ai``.

Spuštění (z apps/desktop):  python -m unittest tests.test_pro_pipeline -v
"""

from __future__ import annotations

import io
import json
import os
import re
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("PLCSTUDIO_HOME", tempfile.mkdtemp(prefix="plcstudio_pptest_"))

from plc_studio import pro_agent  # noqa: E402
from plc_studio import pro_pipeline as pp  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
SAMPLE01 = ROOT / "samples" / "01_pasovy_dopravnik_vyhazovac.plcstudio.json"
PRJ01 = json.loads(SAMPLE01.read_text(encoding="utf-8"))["prj"]
KALIBRACE = Path(__file__).resolve().parent / "data" / "k5_kalibrace"
# skilly stroj-stavitel / stroj-kontrolor ve stagingu (mimo repo; uživatel je instaluje do ~/.claude/skills sám)
STAGING = next((p / ".claude" / "skills_staging" for p in Path(__file__).resolve().parents
                if (p / ".claude" / "skills_staging" / "stroj-kontrolor").is_dir()), None)
# testy nezávislé na tom, co je v ~/.claude/skills: výchozí = skilly nenainstalované (vestavěný seznam)
NO_SKILLS = Path(tempfile.mkdtemp(prefix="pp_noskills_"))
_ORIG_SKILLS = pro_agent.SKILLS_DIR


def setUpModule():
    pro_agent.SKILLS_DIR = NO_SKILLS


def tearDownModule():
    pro_agent.SKILLS_DIR = _ORIG_SKILLS


def png_bytes(w: int, h: int, pixel, filters=(0,)) -> bytes:
    """PNG RGB 8 bit (jen zlib); řádky filtrované postupně ``filters`` (0 None, 1 Sub, 2 Up, 3 Average, 4 Paeth)."""
    import struct
    import zlib
    raw, prev = bytearray(), bytes(3 * w)
    for y in range(h):
        row = bytes(c for x in range(w) for c in pixel(x, y))
        f = filters[y % len(filters)]
        out = bytearray()
        for i, v in enumerate(row):
            a = row[i - 3] if i >= 3 else 0
            b = prev[i]
            c = prev[i - 3] if i >= 3 else 0
            if f == 1:
                v -= a
            elif f == 2:
                v -= b
            elif f == 3:
                v -= (a + b) >> 1
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                v -= a if pa <= pb and pa <= pc else (b if pb <= pc else c)
            out.append(v & 255)
        raw += bytes([f]) + out
        prev = row

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(raw))) + chunk(b"IEND", b""))


def shot(path: Path, blank: bool = False) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png_bytes(24, 16, lambda x, y: (255, 255, 255) if blank or x < 12 else (40, 90, 160)))
    return path


def full_protocol(folder: Path, unit: str, rnd: int, verdict: str = "SCHVÁLENO", *, drop: str = "",
                  result: dict | None = None, proof: str = "k5_kolo/kontroly.json souhrn", blank_shot: bool = False,
                  shots: int | None = None, extra: str = "", points: str = "Povinných bodů: 0 (blokující 0, závažné 0).") -> str:
    """Protokol K5 podle šablony stroj-kontrolor/references/protokol.md, který brána K5 pustí (minima, snímky)."""
    ids, _src = pp.k5_ids()
    sec = pp.K5_SECTION[unit]
    mk, ms, mc = pp.K5_MIN[unit]
    sub = pp.UNIT[unit]["sub"]
    names = []
    for i in range(ms if shots is None else shots):
        p = shot(Path(folder) / sub / f"k5_kolo{rnd}" / f"k5_kolo{rnd}_{i}.png", blank=blank_shot and i == 0)
        names.append(p.relative_to(folder).as_posix())
    res = result or {}
    rows = [f"| {i} | položka {i} | {proof} | {res.get(i, 'SPLNĚNO')} |" for i in ids["V"] + ids[sec] if i != drop]
    L = [f"# Kontrola K5 — {unit}, kolo {rnd}", "", f"## Verdikt: **{verdict}**", "", points, "",
         "## 2. Kontrolní seznam", "", "| ID | položka | důkaz | výsledek |", "|---|---|---|---|", *rows, "",
         "## 3. Vlastní měření", "", "### 3.1 Zóny nebezpečí (V3)", "| zařízení | zdvih | zóna | výsledek |",
         "|---|---|---|---|", "| -Y1 | 100 | Zona_Y1 | OK |", "", "### 3.2 Kóty proti zadání (V7)",
         "| # | co | naměřeno |", "|---|---|---|", *[f"| {i} | kóta {i} | {100 + i} mm |" for i in range(mk)], "",
         "### 3.5 Tvrzení stavitele (V9)", "| tvrzení | moje hodnota | shoda |", "|---|---|---|",
         *[f"| t{i} | {i} | ano |" for i in range(mc)], "", "## 4. Kontroly kódem", "", "data.bez_spoje posouzeno.", "",
         "## 5. Snímky (prohlédnuté)", "", "| soubor | pohled | co je vidět | rozpor |", "|---|---|---|---|",
         *[f"| `{n}` | iso | rám | ne |" for n in names], "", "## 6. Integrita", "", extra]
    return "\n".join(L) + "\n"


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
            word = {"back": "**VRÁCENO** staviteli", "none": "nevím", "bare": "**SCHVÁLENO**"}.get(v, "")
            if v == "ok":                       # úplný protokol podle skillu (brána K5 projde)
                f.write_text(full_protocol(pipe.folder, unit, rnd), encoding="utf-8")
            else:                               # „bare“ = SCHVÁLENO starým stylem bez seznamu (brána vrátí)
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
        r = FakeRunner({"concept": ["back", "ok"], "frame": ["back"] * 5, "modules": ["none", "ok"]})
        p = self.pipe(d, r, test_safety=True)
        self.assertEqual(p.run(), "done")
        u = p.state["units"]
        self.assertEqual(u["inputs"]["state"], "done")
        self.assertEqual((u["concept"]["state"], len(u["concept"]["rounds"])), ("approved", 2))
        self.assertEqual((u["frame"]["state"], len(u["frame"]["rounds"])), ("rejected", 5), "rám a kryty max 5 kol (UNIT_ROUNDS)")
        self.assertEqual(u["assembly"]["state"], "approved", "neschválená část — pokračuje se další")
        self.assertEqual(u["modules"]["rounds"][0]["verdict"], "none")
        # 1. kolo konceptu = role Koncept, opravy = Stavitel
        self.assertEqual(r.calls[:4], [("concept", "concept", 1), ("concept", "k5", 1), ("concept", "builder", 2),
                                       ("concept", "k5", 2)])
        st = json.loads((d / pp.STATE_FILE).read_text(encoding="utf-8"))
        self.assertEqual(st["status"], "done")
        self.assertTrue((d / "logy" / "01_concept_kolo1_concept.log").is_file())
        prehled = (d / pp.SUMMARY_FILE).read_text(encoding="utf-8")
        for must in (pp.TEST_MARK, "neschváleno", "VRÁCENO", "SCHVÁLENO", "ram/KONTROLA_K5_ram_kolo5.md",
                     "ODHAD: výška frame", "NEPOUŽITA", "odhad podle ceníku API 11.00 USD"):
            self.assertIn(must, prehled)
        self.assertEqual(pp.phase_state(p.state, "build"), ("rejected", 5))
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
        self.assertEqual((p.turns_for("builder"), p.turns_for("k5"), p.turns_for("concept")), (60, 80, 60))
        cmd = p.command("C:/x/claude.exe", "k5", "extra")
        self.assertEqual(cmd[cmd.index("--model") + 1], "claude-sonnet-5-5")
        self.assertEqual(cmd[cmd.index("--max-turns") + 1], "80")
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


def fake_skills(names=("stroj-stavitel", "stroj-kontrolor")) -> Path:
    """Složka skillů jako ~/.claude/skills (ze stagingu, jinak jen SKILL.md a kontrolní seznam z vestavěného)."""
    d = Path(tempfile.mkdtemp(prefix="pp_skills_"))
    for n in names:
        (d / n / "references").mkdir(parents=True, exist_ok=True)
        src = STAGING / n if STAGING else None
        (d / n / "SKILL.md").write_text((src / "SKILL.md").read_text(encoding="utf-8") if src else f"---\nname: {n}\n---\n",
                                        encoding="utf-8")
        if n == "stroj-kontrolor":
            ks = src / "references" / "kontrolni-seznam.md" if src else None
            text = ks.read_text(encoding="utf-8") if ks and ks.is_file() else \
                "\n".join(f"| {i} | {t} | M |" for i, t in pp.K5_ITEMS.items())
            (d / n / "references" / "kontrolni-seznam.md").write_text(text, encoding="utf-8")
    return d


class SkillPromptsTest(unittest.TestCase):
    """Pokyny se skilly stroj-stavitel / stroj-kontrolor (kap. 3 návrhu) i bez nich (vestavěné znění a seznam)."""

    UNFILLED = re.compile(r"\{(cmd|sub|section|round|checks|k5file|approved|label|conventions|checklist|min_\w+|items|"
                          r"model_rules|feedback|test|parts|archive|last_k5)\}")

    def tearDown(self):
        pro_agent.SKILLS_DIR = NO_SKILLS

    def check_prompts(self, skills: bool):
        d = Path("C:/stroj")
        for unit in pp.AI_UNITS:
            for rnd in (1, 2):
                b = pp.builder_prompt(d, unit, rnd)
                k = pp.k5_prompt(d, unit, rnd, approved="Rozvaděč: rozvadec/KONTROLA_K5_rozvadec_kolo1.md")
                for t in (b, k, pp.system_extra(unit, True, "builder"), pp.system_extra(unit, False, "k5")):
                    self.assertIsNone(self.UNFILLED.search(t), (unit, rnd, self.UNFILLED.search(t)))
                sec = pp.K5_SECTION[unit]
                self.assertIn(f"oddíl V a {sec}", b)
                self.assertIn("stroj-kontrolor", k)
                self.assertIn(f"oddíl V a {sec}", k)
                self.assertIn(f"{pp.K5_MIN[unit][0]} vlastních kót", k)
                self.assertIn("PRÁVĚ JEDEN řádek", k)
                self.assertIn("Rozvaděč: rozvadec/KONTROLA_K5_rozvadec_kolo1.md", k)
                if rnd == 2:
                    self.assertIn("PŘED → PO", b)
                if skills:
                    self.assertIn("Postupuj podle skillu stroj-stavitel", b)
                    self.assertIn("pravidla-modelu.md", b)
                    self.assertNotIn("NENÍ nainstalován", k)
                else:
                    self.assertIn(f"- {sec}1:", k, "bez skillu vestavěný seznam v pokynu kontrolora")
                    self.assertIn("NENÍ nainstalován", k)
                    self.assertIn("- V15:", b, "sebekontrola stavitele podle vestavěného seznamu")
                    self.assertIn("Konstrukce_Vedeni", b)
            ex_b, ex_k = pp.system_extra(unit, False, "builder"), pp.system_extra(unit, False, "k5")
            self.assertTrue(ex_k.split("Skilly této části: ")[1].startswith("stroj-kontrolor"), ex_k[-200:])
            self.assertNotIn("stroj-stavitel,", ex_k.split("Skilly této části: ")[1])
            self.assertTrue(ex_b.split("Skilly této části: ")[1].startswith("stroj-stavitel"))
            if skills:
                self.assertIn("skill stroj-stavitel (references/pravidla-modelu.md)", ex_b)
                self.assertNotIn("255,140,0", ex_b, "pravidla modelu jsou ve skillu, prompt kratší")
            else:
                for must in ("App::Link", "ISO 13857", "255,140,0", "graf souvislosti", "hadice zasunutá do šroubení"):
                    self.assertIn(must, ex_b)
            for must in ("ODHAD", "NEPOUŽIJE", "plm scan", "3Dfindit", "vlastní slot", "Start-Sleep"):
                self.assertIn(must, ex_b)

    def test_without_skills(self):
        self.check_prompts(False)
        ids, src = pp.k5_ids()
        self.assertEqual(src, "vestavěný seznam")
        self.assertEqual(len(ids["V"]), 15)
        self.assertEqual(len(ids["F"]), 15)

    def test_with_skills(self):
        pro_agent.SKILLS_DIR = fake_skills()
        self.check_prompts(True)
        ids, src = pp.k5_ids()
        self.assertTrue(src.endswith("kontrolni-seznam.md"))
        self.assertEqual(sum(len(v) for v in ids.values()), len(pp.K5_ITEMS))

    def test_test_rule(self):
        self.assertIn("nevynechává ani nekontroluje mírněji", pp.TEST_RULE)
        self.assertIn("jen podpis", pp.TEST_RULE)
        self.assertIn(pp.TEST_MARK, pp.k5_prompt(Path("C:/s"), "frame", 1, test_safety=True))

    def test_role_rules(self):
        self.assertIn("stroj-kontrolor", pro_agent.system_prompt("k5"))
        self.assertIn("stroj-stavitel", pro_agent.system_prompt("builder"))
        self.assertEqual(pro_agent.ROLE_TURNS["k5"], 80)
        self.assertIn("stroj-stavitel", pro_agent.SKILL_REFS)
        self.assertIn("prázdný snímek = nepořízený", pro_agent.system_prompt("builder"))


@unittest.skipIf(STAGING is None, "staging skillů (.claude/skills_staging) není")
class SkillFilesTest(unittest.TestCase):
    """Skilly ve stagingu: frontmatter, odkazy na reference, jedinečná ID, vestavěný seznam = seznam skillu."""

    def test_frontmatter_and_refs(self):
        for n in ("stroj-stavitel", "stroj-kontrolor"):
            text = (STAGING / n / "SKILL.md").read_text(encoding="utf-8")
            m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
            self.assertTrue(m, n)
            self.assertIn(f"name: {n}", m.group(1))
            self.assertRegex(m.group(1), r"description: \S")
            # vlastní reference (seznam „- `references/x.md`“) a odkazy do skillů stroj-* (`stroj-…/references/…`)
            own = re.findall(r"^- `(references/[\w-]+\.md)`", text, re.M)
            self.assertTrue(own, n)
            for ref in own:
                self.assertTrue((STAGING / n / ref).is_file(), f"{n}: {ref}")
            for owner, ref in re.findall(r"`(stroj-[\w-]+)/(references/[\w-]+\.md)", text):
                self.assertTrue((STAGING / owner / ref).is_file(), f"{n}: {owner}/{ref}")

    def test_checklist_ids(self):
        text = (STAGING / "stroj-kontrolor" / "references" / "kontrolni-seznam.md").read_text(encoding="utf-8")
        ids = re.findall(r"^\|\s*([VKRFMC]\d+)\s*\|", text, re.M)
        self.assertEqual(len(ids), len(set(ids)), "ID seznamu jedinečná")
        self.assertEqual(ids, list(pp.K5_ITEMS), "vestavěný seznam = seznam skillu (změna seznamu = změna brány)")

    def test_protocol_template_parses(self):
        """Šablona protokol.md je kompatibilní s parse_verdict (SCHVÁLENO → ok, VRÁCENO → back)."""
        text = (STAGING / "stroj-kontrolor" / "references" / "protokol.md").read_text(encoding="utf-8")
        tpl = re.search(r"```markdown\n(.*?)```", text, re.S).group(1)
        self.assertEqual(pp.parse_verdict(tpl), "back")
        self.assertEqual(pp.parse_verdict(tpl.replace("**VRÁCENO**", "**SCHVÁLENO**", 1)), "ok")


class VerdictCompatTest(unittest.TestCase):
    """parse_verdict: staré protokoly beze změny + pasti, které šablona skillu zakazuje."""

    def test_old_and_new(self):
        self.assertEqual(pp.parse_verdict("# x\n## Verdikt: **SCHVÁLENO** k předložení\n"), "ok")
        self.assertEqual(pp.parse_verdict("# x\n## Verdikt: **VRÁCENO** staviteli\n"), "back")
        self.assertEqual(pp.parse_verdict(full_protocol(tmpdir(), "frame", 1)), "ok")
        self.assertEqual(pp.parse_verdict(full_protocol(tmpdir(), "frame", 1, "VRÁCENO")), "back")
        for f in sorted(KALIBRACE.rglob("KONTROLA_K5_*.md")):
            self.assertIn(pp.parse_verdict(f.read_text(encoding="utf-8")), ("ok", "back"), f)

    def test_traps(self):
        # „SCHVÁLENO, nic nevráceno“ parser přečte jako vráceno → šablona slovo VRÁCENO na řádku SCHVÁLENO zakazuje
        self.assertEqual(pp.parse_verdict("## Verdikt: **SCHVÁLENO**, nic nevráceno\n"), "back")
        # řádek „**Verdikt opírám o …**“ nad verdiktem → parser vezme ten (proto „žádný jiný řádek nezačíná Verdikt“)
        trap = "# K5\n**Verdikt opírám o kontroly.json**\n\n## Verdikt: **SCHVÁLENO**\n"
        self.assertNotEqual(pp.parse_verdict(trap), "ok")
        self.assertIn("řádky začínající „Verdikt“", " ".join(pp.k5_audit(tmpdir(), "frame", 1, trap)))


class GateTest(unittest.TestCase):
    """Brána K5 (k5_audit): jen vrací — úplný protokol projde, každá formální vada vrátí."""

    def audit(self, unit="frame", chk=None, **kw):
        d = tmpdir()
        return pp.k5_audit(d, unit, 1, full_protocol(d, unit, 1, **kw), chk)

    def test_full_passes(self):
        for unit in pp.AI_UNITS:
            self.assertEqual(self.audit(unit, {"bezSpoje": 3}), [], unit)

    def test_defects(self):
        self.assertIn("chybí řádky F7", " ".join(self.audit(drop="F7")))
        self.assertIn("nesplněnými položkami V3", " ".join(self.audit(result={"V3": "NESPLNĚNO → bod 1"})))
        self.assertIn("bez důkazu", " ".join(self.audit(proof="—")))
        self.assertIn("bez výsledku", " ".join(self.audit(result={"F2": "vypadá dobře"})))
        self.assertIn("prázdné snímky", " ".join(self.audit(blank_shot=True)))
        self.assertIn("snímky (kap. 5): 3, minimum 8", " ".join(self.audit(shots=3)))
        self.assertIn("povinnými body (2)", " ".join(self.audit(points="Povinných bodů: 2 (blokující 1, závažné 1).")))
        self.assertEqual(self.audit(chk={"bezSpoje": 44}), [], "protokol bez_spoje posuzuje")
        d = tmpdir()
        t = full_protocol(d, "frame", 1).replace("data.bez_spoje posouzeno.", "")
        self.assertIn("data.bez_spoje = 44", " ".join(pp.k5_audit(d, "frame", 1, t, {"bezSpoje": 44})))
        self.assertEqual(pp.k5_audit(d, "frame", 1, t, {"bezSpoje": 15}), [], "do 15 jsou všechny ve varováních")
        t2 = t + "\nkontrola dílů bez spoje\n"
        self.assertIn("neposouzeno", " ".join(pp.k5_audit(d, "frame", 1, t2, {"vynechano": ["… kontrola vynechána"]})))
        self.assertIn("V3 přesto SPLNĚNO", " ".join(self.audit(chk={"bezZon": True})))
        self.assertEqual(self.audit("cabinet", {"bezZon": True}), [], "rozvaděč nemusí mít zóny nebezpečí")
        d = tmpdir()
        t = full_protocol(d, "modules", 1).replace("k5_kolo1_0.png", "neexistuje.png")
        self.assertIn("neexistují: neexistuje.png", " ".join(pp.k5_audit(d, "modules", 1, t)))
        # automatický bod PLCdesk připsaný za protokol bránu nemate
        self.assertEqual(pp.k5_audit(d, "modules", 1, full_protocol(d, "modules", 1)
                                     + f"\n{pp.AUTO_HEAD}\n\nVerdikt: **VRÁCENO**\n"), [])

    def test_png(self):
        d = tmpdir()
        for flt in ((0,), (1,), (2,), (3,), (4,), (0, 1, 2, 3, 4)):
            p = d / f"p{''.join(map(str, flt))}.png"
            p.write_bytes(png_bytes(20, 10, lambda x, y: (255, 255, 255) if x >= 5 else (x * 40, y * 20, 7), flt))
            self.assertAlmostEqual(pp.png_nonwhite_pct(p), 25.0, places=6, msg=flt)
        p = d / "white.png"
        p.write_bytes(png_bytes(30, 30, lambda x, y: (255, 255, 255), (4, 2)))
        self.assertEqual(pp.png_nonwhite_pct(p), 0.0)
        (d / "x.png").write_bytes(b"not png")
        self.assertIsNone(pp.png_nonwhite_pct(d / "x.png"))

    def test_calibration_real_protocols(self):
        """Skutečné protokoly K5 kola 1 (příklady 01 a 03, 2026-10-24 / 10-29): všech 7 SCHVÁLENO bránou neprojde
        (chybí kontrolní seznam s důkazy a minima; 01 celek a 03 rozvaděč navíc data.bez_spoje 44 / 42 > 15)."""
        sub2unit = {v["sub"]: k for k, v in pp.UNIT.items() if v["sub"]}
        approved = []
        for f in sorted(KALIBRACE.rglob("KONTROLA_K5_*_kolo1.md")):
            ex, unit = f.parent.parent, sub2unit[f.parent.name]
            text = f.read_text(encoding="utf-8")
            if pp.parse_verdict(text) != "ok":
                continue
            chk = pp.k5_checks(ex, unit, 1)
            self.assertIsNotNone(chk, f)
            self.assertEqual(chk["stav"], "OK", f)
            pts = pp.k5_audit(ex, unit, 1, text, chk)
            approved.append((ex.name, f.parent.name, pts))
            self.assertTrue(pts, f"{f}: SCHVÁLENO prošlo bránou")
            self.assertIn("kontrolní seznam", pts[0])
            self.assertTrue(any("(3.2)" in p for p in pts), f)
        self.assertEqual(len(approved), 7, [a[:2] for a in approved])
        bs = {(a, b) for a, b, pts in approved if any("data.bez_spoje" in p for p in pts)}
        self.assertEqual(bs, {("01", "celek"), ("03", "rozvadec")})


class GateAutomatonTest(unittest.TestCase):
    """Brána, approvedSha a max. kol podle části v automatu (podvržený runner, bez AI)."""

    def test_bare_approved_returned_then_full(self):
        d = tmpdir()
        r = FakeRunner({"concept": ["bare", "ok"]})
        p = pp.Pipeline(d, PRJ01, inputs_fn=fake_inputs, runner=r)
        self.assertEqual(p.run(), "done")
        rc = p.state["units"]["concept"]["rounds"]
        self.assertEqual([x["verdict"] for x in rc], ["back", "ok"])
        self.assertEqual(rc[0]["verdictText"], "VRÁCENO (brána K5)")
        self.assertTrue(rc[0]["k5Audit"])
        self.assertEqual(rc[0]["autoPoints"], rc[0]["k5Audit"])
        self.assertEqual(rc[1]["k5Audit"], [])
        self.assertEqual(rc[1]["points"], {"n": 0, "b": 0, "z": 0})
        prot = pp.k5_file(d, "concept", 1).read_text(encoding="utf-8")
        self.assertIn(pp.AUTO_HEAD, prot)
        self.assertIn("VRÁCENO (brána K5)", prot)
        self.assertEqual(pp.parse_verdict(prot), "ok", "parser bere první řádek kontrolora, postup ho přepsal")
        summ = (d / pp.SUMMARY_FILE).read_text(encoding="utf-8")
        self.assertIn("Kontrola K5 — brána a povinné body", summ)
        self.assertIn("Koncept kolo 1: brána K5: SCHVÁLENO neplatí", summ)
        self.assertIn("Koncept kolo 2: brána K5: prošla; povinných bodů 0 (blokující 0, závažné 0)", summ)
        self.assertIn("(brána K5)", summ)

    def test_unit_rounds(self):
        d = tmpdir()
        p = pp.Pipeline(d, PRJ01, inputs_fn=fake_inputs, runner=FakeRunner({}))
        self.assertEqual({k: p.rounds_for(k) for k in pp.AI_UNITS},
                         {"concept": 3, "cabinet": 3, "frame": 5, "modules": 3, "assembly": 3})
        p.state["unitRounds"]["modules"] = 4
        p.save()
        self.assertEqual(pp.Pipeline(d, PRJ01, inputs_fn=fake_inputs).rounds_for("modules"), 4, "pipeline.json")
        p2 = pp.Pipeline(d, PRJ01, inputs_fn=fake_inputs, max_rounds=2)
        self.assertEqual({p2.rounds_for(k) for k in pp.AI_UNITS}, {2}, "volba max_rounds platí všem částem")
        self.assertIn("max. kol 3 (Rám a kryty 5)", pp.write_summary(tmpdir(), pp.blank_state()).read_text(encoding="utf-8"))

    def test_approved_sha_changed(self):
        """Stavitel rámu změní schválený model rozvaděče → K5 rámu dostane upozornění a verdikt je VRÁCENO."""
        class R(FakeRunner):
            def __call__(self, pipe, role, prompt, extra, log_path):
                unit = next(k for k in pp.AI_UNITS if f"_{k}_kolo" in log_path.name)
                if role == "builder" and unit == "cabinet":
                    (pipe.folder / "rozvadec" / "Rozvadec.FCStd").write_bytes(b"v1")
                if role == "builder" and unit == "frame" and "_kolo1_" in log_path.name:
                    (pipe.folder / "rozvadec" / "Rozvadec.FCStd").write_bytes(b"v2 zmeneno stavitelem ramu")
                self.prompts = getattr(self, "prompts", []) + [(unit, role, prompt)]
                return super().__call__(pipe, role, prompt, extra, log_path)

        d = tmpdir()
        r = R({})
        p = pp.Pipeline(d, PRJ01, inputs_fn=fake_inputs, runner=r)
        self.assertEqual(p.run(), "done")
        cab = p.state["units"]["cabinet"]["rounds"][-1]
        self.assertEqual(list(cab["approvedSha"]), ["rozvadec/Rozvadec.FCStd"])
        fr = p.state["units"]["frame"]["rounds"]
        self.assertEqual(fr[0]["verdict"], "back")
        self.assertEqual(fr[0]["verdictText"], "VRÁCENO (změněn schválený model)")
        self.assertEqual(fr[0]["approvedChanged"][0]["path"], "rozvadec/Rozvadec.FCStd")
        self.assertIn("V13 / C1", fr[0]["autoPoints"][0])
        k5p = next(x[2] for x in r.prompts if x[:2] == ("frame", "k5"))
        self.assertIn("POZOR — po schválení změněno", k5p)
        self.assertIn("Rozvaděč: rozvadec/KONTROLA_K5_rozvadec_kolo1.md", k5p)
        # model se nevrátil → ani další kola rámu schválení nedostanou (stavitel musí změnu vrátit / předat)
        self.assertEqual(p.state["units"]["frame"]["state"], "rejected")
        self.assertIn("změněn po schválení", (d / pp.SUMMARY_FILE).read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
