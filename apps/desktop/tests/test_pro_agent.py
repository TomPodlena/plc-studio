"""Testy náhledu PLCdesk PRO — krok 3D agent (plc_studio/pro_agent.py, steps/pro3d.py).

Bez volání Claude Code CLI a bez FreeCADu: příkaz a prompt se jen sestaví, stream-json se parsuje ze vzorku,
proces agenta je podvržený (mock Popen) a Zastavit se ověří nad podvrženým ``kill``.

Spuštění (z apps/desktop):  python -m unittest tests.test_pro_agent -v
"""

from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ["PLCSTUDIO_HOME"] = tempfile.mkdtemp(prefix="plcstudio_protest_")

import tkinter as tk  # noqa: E402

from plc_studio import pro_agent as pa  # noqa: E402
from plc_studio.app import App, STEP_BOM, STEP_PRO  # noqa: E402

SAMPLE = [
    {"type": "system", "subtype": "init", "model": "claude-opus-5-5", "cwd": "C:\\stroj"},
    {"type": "assistant", "message": {"content": [
        {"type": "text", "text": "Prohlédnu STAV.md."},
        {"type": "tool_use", "name": "Read", "input": {"file_path": "C:\\stroj\\STAV.md"}}]}},
    {"type": "user", "message": {"content": [
        {"type": "tool_result", "content": [{"type": "text", "text": "# Stav\nrám hotový"}]}]}},
    {"type": "assistant", "message": {"content": [
        {"type": "tool_use", "name": "Bash", "input": {"command": "powershell run_fc.ps1 gui-start --slot plcdesk-pro"}}]}},
    {"type": "user", "message": {"content": [{"type": "tool_result", "content": "chyba", "is_error": True}]}},
    {"type": "result", "subtype": "success", "is_error": False, "total_cost_usd": 0.1234, "num_turns": 3,
     "duration_ms": 12000, "usage": {"input_tokens": 100, "cache_read_input_tokens": 50, "output_tokens": 20}},
]


class CommandTest(unittest.TestCase):
    def test_command(self):
        cmd = pa.build_command("C:/x/claude.exe", "builder", model="opus", budget=2.5, add_dirs=["C:/skills"])
        self.assertEqual(cmd[:5], ["C:/x/claude.exe", "-p", "--output-format", "stream-json", "--verbose"])
        self.assertEqual(cmd[cmd.index("--permission-mode") + 1], "acceptEdits")
        self.assertIn("Edit", cmd[cmd.index("--allowedTools") + 1].split(","))
        self.assertEqual(cmd[cmd.index("--add-dir") + 1], "C:/skills")
        self.assertEqual(cmd[cmd.index("--model") + 1], "opus")
        self.assertEqual(cmd[cmd.index("--max-budget-usd") + 1], "2.5")
        # bez volitelných: žádný model ani limit, pokyn NENÍ na příkazové řádce (jde na stdin)
        cmd = pa.build_command("claude", "k5", add_dirs=[])
        self.assertNotIn("--model", cmd)
        self.assertNotIn("--max-budget-usd", cmd)
        self.assertNotIn("--add-dir", cmd)
        self.assertNotIn("Edit", cmd[cmd.index("--allowedTools") + 1].split(","), "kontrolor model neupravuje")
        # zúžená oprávnění: jen nástroje role, shell jen s povoleným prefixem, zákazy, bez MCP
        self.assertNotIn("Edit", cmd[cmd.index("--tools") + 1].split(","))
        allow = cmd[cmd.index("--allowedTools") + 1].split(",")
        self.assertIn("Bash(python *)", allow)
        self.assertIn("PowerShell(powershell *)", allow)
        self.assertNotIn("Bash", allow, "Bash jen s prefixem")
        deny = cmd[cmd.index("--disallowedTools") + 1].split(",")
        self.assertIn("WebFetch", deny)
        self.assertTrue(any(d.startswith("Edit(//") and "skills" in d for d in deny))
        self.assertIn("--strict-mcp-config", cmd)
        self.assertTrue(pa.build_command("claude", "k5", add_dirs=[], extra_system="NAVIC")[-1].endswith("NAVIC"))

    def test_roles(self):
        self.assertEqual({k for k, _l in pa.ROLES}, set(pa.ROLE_RULES))
        for role in pa.ROLE_RULES:
            sp = pa.system_prompt(role)
            for must in ("plcdesk-pro", "App::Link", "oranžov", "šroub × díra", "matice × drážka", "ve vzduchu",
                         "PROHLÉDNI", "zdroj pravdy kusovníku", "3Dfindit", "ke schválení", "K5 JINOU rolí",
                         *pa.SKILL_REFS):
                self.assertIn(must, sp, f"{role}: {must}")
        self.assertIn("NEMĚNÍŠ", pa.system_prompt("k5"))
        self.assertIn("Verdikt", pa.system_prompt("k5"))
        with self.assertRaises(ValueError):
            pa.system_prompt("x")
        p = pa.build_prompt("builder", "  Doplň kryty.  ", "C:/stroj", "Stroj 01")
        self.assertIn("Projekt PLCdesk: Stroj 01", p)
        self.assertIn("Složka 3D stroje: C:/stroj", p)
        self.assertTrue(p.endswith("Doplň kryty."))
        self.assertIn("STAV.md", pa.build_prompt("k5", "", "C:/s"))

    def test_parser(self):
        items = [x for ev in SAMPLE for x in pa.parse_event(json.dumps(ev, ensure_ascii=False))]
        kinds = [k for k, _t in items]
        self.assertEqual(kinds, ["info", "text", "tool", "result", "tool", "error", "done"])
        self.assertIn("claude-opus-5-5", items[0][1])
        self.assertEqual(items[2][1], "Read: C:\\stroj\\STAV.md")
        self.assertIn("rám hotový", items[3][1])
        self.assertTrue(items[4][1].startswith("Bash: powershell run_fc.ps1"))
        done = items[-1][1]
        for must in ("0.1234", "150", "20", "12"):
            self.assertIn(must, done)
        self.assertEqual(pa.parse_event(""), [])
        self.assertEqual(pa.parse_event("není json")[0][0], "info")
        self.assertEqual(pa.parse_event(json.dumps({"type": "result", "subtype": "error_max_turns",
                                                    "is_error": True}))[0][0], "done")

    def test_progress(self):
        ev = {"type": "assistant", "message": {"content": [
            {"type": "text", "text": "Začínám.\nPRŮBĚH 2/5: rám postaven\nDál kryty."},
            {"type": "tool_use", "name": "Read", "input": {"file_path": "STAV.md"}}]}}
        items = pa.parse_event(json.dumps(ev, ensure_ascii=False))
        self.assertIn(("progress", "2/5 rám postaven"), items)
        run = pa.AgentRun(["x"], "p", ".")
        for it in items:
            run.queue.put(it)
        run.drain()
        self.assertEqual(run.step, (2, 5, "rám postaven"))
        self.assertEqual(run.tools, 1)
        self.assertNotIn("progress", [k for k, _t in run.lines])
        self.assertIn("PRŮBĚH", pa.system_prompt("builder"))

    def test_machine_state(self):
        d = Path(tempfile.mkdtemp(prefix="pro_stroj_"))
        (d / "ram").mkdir()
        (d / "STAV.md").write_text("# Stav\nrám kolo 6", encoding="utf-8")
        (d / "ram" / "KONTROLA_K5_ram.md").write_text("## Verdikt: **SCHVÁLENO**\n", encoding="utf-8")
        k = d / "ram" / "KONTROLA_K5_ram_kolo2.md"
        k.write_text("x\n## Verdikt: **VRÁCENO** staviteli\n", encoding="utf-8")
        os.utime(k, (2e9, 2e9))
        (d / "A.FCStd").write_bytes(b"")
        st = pa.machine_state(d)
        self.assertEqual(st["verdict"], "VRÁCENO staviteli")
        self.assertEqual(pa.verdict_kind(st["verdict"]), "back")
        self.assertEqual(pa.verdict_kind("SCHVÁLENO k předložení"), "ok")
        self.assertIn("rám kolo 6", st["stav"])
        self.assertEqual([Path(m).name for m in st["models"]], ["A.FCStd"])
        self.assertFalse(pa.machine_state(d / "nic")["exists"])

    def test_run_and_stop_own_pid(self):
        lines = [json.dumps(e, ensure_ascii=False) + "\n" for e in SAMPLE]

        class FakeProc:
            pid = 4242

            def __init__(self, *a, **kw):
                self.args, self.kw = a, kw
                self.stdin = io.StringIO()
                self.stdout = iter(lines)
                self.code = None

            def poll(self):
                return self.code

            def wait(self):
                self.code = 0
                return 0

        run = pa.AgentRun(["claude", "-p"], "pokyn", tempfile.gettempdir())
        run.start(popen=FakeProc)
        run._thread.join(5)
        got = run.drain()
        self.assertEqual(got[-1], ("end", "done"))
        self.assertEqual(run.lines[-1][0], "done")
        self.assertEqual(run.proc.kw["stdin"], pa.subprocess.PIPE)
        self.assertEqual(run.proc.kw["cwd"], tempfile.gettempdir())
        # Zastavit: jen vlastní PID (a nic, když proces už skončil)
        killed = []
        self.assertFalse(run.stop(kill=killed.append))
        run.proc.code = None
        run.stop(kill=lambda pid: killed.append(pid) or True)
        self.assertEqual(killed, [4242])
        self.assertEqual(run.state, "stopped")
        with mock.patch.object(pa.subprocess, "run") as r:
            r.return_value = mock.Mock(returncode=0)
            if sys.platform == "win32":
                pa.kill_tree(4242)
                self.assertEqual(r.call_args[0][0], ["taskkill", "/PID", "4242", "/T", "/F"])

    def test_freecad_commands(self):
        c = pa.freecad_commands("C:/s/run_fc.ps1", "C:/m/A.FCStd", "C:/t/open.py")
        self.assertEqual(c[0][-5:], ["gui-start", "--slot", "plcdesk-pro", "--max-min", "240"])
        self.assertEqual(c[1][6:9], ["gui-run", "--slot", "plcdesk-pro"])
        self.assertEqual(c[1][-2:], ["C:/t/open.py", "C:/m/A.FCStd"])


class StepTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.env = mock.patch.dict(os.environ, {"PLCDESK_PRO": ""})
        cls.env.start()
        cls.root = tk.Tk()
        cls.app = App(cls.root)
        cls.root.update()

    @classmethod
    def tearDownClass(cls):
        cls.app.close()
        cls.env.stop()

    def test_hidden_without_preview(self):
        app = self.app
        self.assertFalse(app.pro_enabled())
        self.assertIsNone(app._pro_btn)
        app.goto(STEP_BOM)
        app.goto(STEP_PRO)
        self.assertEqual(app.step, STEP_BOM, "bez náhledu krok neexistuje")
        from plc_studio import helppanel
        self.assertIsNone(helppanel.chapter(app, "pro3d"))

    def test_shown_with_preview(self):
        app = self.app
        app.settings["pro_preview"] = True
        try:
            self.assertTrue(app.pro_enabled())
            d = Path(tempfile.mkdtemp(prefix="pro_step_"))
            (d / "KONTROLA_K5.md").write_text("## Verdikt: **SCHVÁLENO**\n", encoding="utf-8")
            img = tk.PhotoImage(width=400, height=300)
            img.put("orange", to=(0, 0, 400, 300))
            img.write(str(d / "iso.png"), format="png")
            from plc_studio.steps import pro3d
            pro3d.set_folder(app, str(d))
            app.goto(STEP_PRO)
            self.root.update()
            self.assertEqual(app.step, STEP_PRO)
            self.assertEqual(app.pro_state["verdict"], "SCHVÁLENO")
            self.assertEqual(len(app.pro_thumbs), 1)
            self.assertLessEqual(app.pro_thumbs[0].width(), pro3d.THUMB)
            from plc_studio import helppanel
            self.assertEqual(helppanel.chapter_for_step(app, STEP_PRO), "pro3d")
            self.assertIsNotNone(helppanel.chapter(app, "pro3d"))
            # Spustit bez potvrzení nic nespustí (placené jen se souhlasem)
            with mock.patch.object(pa, "find_claude", return_value=Path(sys.executable)):
                self.assertIsNone(pro3d.start_pipeline(app, None, confirm=lambda: False))
            self.assertIsNone(getattr(app, "pro_pipe", None))
            self.assertEqual(set(app.pro_phase_labels), {"inputs", "concept", "build"})
            # model podle role: výchozí koncept Opus / stavba a kontrola Sonnet, volba se uloží pro projekt
            self.assertEqual({r: v.get() for r, v in app.pro_role_vars.items()},
                             {"concept": "claude-opus-5-5", "builder": "claude-sonnet-5-5", "k5": "claude-sonnet-5-5"})
            app.pro_role_vars["k5"].set("claude-haiku-4-5-20251001")
            self.assertEqual(pro3d.save_models(app)["k5"], "claude-haiku-4-5-20251001")
            self.assertEqual(pro3d.role_models(app)["k5"], "claude-haiku-4-5-20251001")
            # celý postup s podvrženým agentem (bez AI): K5 vše schválí → pruh fází „schváleno“
            from plc_studio import pro_pipeline as pp

            def runner(pipe, role, prompt, extra, log_path):
                unit = next(k for k in pp.AI_UNITS if f"_{k}_kolo" in log_path.name)
                if role == "k5":
                    f = pp.k5_file(pipe.folder, unit, 1)
                    f.parent.mkdir(parents=True, exist_ok=True)
                    f.write_text("## Verdikt: **SCHVÁLENO**\n", encoding="utf-8")
                return {"state": "done"}

            app.ui["pro_test"] = True
            pipe = pro3d.start_pipeline(app, None, confirm=lambda: True, runner=runner, thread=False)
            self.assertEqual(pipe.state["status"], "done")
            self.assertTrue(pipe.state["testSafety"])
            self.assertEqual(pipe.model_for("k5"), "claude-haiku-4-5-20251001")
            app.settings.pop("pro_models", None)
            pro3d._per_project(app, "pro3d_models").clear()
            app.ui["pro_open"] = ["frame"]
            app.render()
            self.root.update()
            self.assertEqual(app.pro_phase_labels["build"].cget("text"), pp.state_label("approved"))
            self.assertIn("frame", app.pro_prompt_texts)
            self.assertTrue((d / "PLCdesk_CAD.json").is_file())
            app.ui.pop("pro_test", None)
        finally:
            app.settings.pop("pro_preview", None)
            app.goto(0)


if __name__ == "__main__":
    unittest.main()
