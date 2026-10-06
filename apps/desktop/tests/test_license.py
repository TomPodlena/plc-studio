"""Testy licence v desktopu (plc_studio/license.py nad jádrem license.ts).

Síť je podvržená (``License.http``) — žádný dotaz na server PLCdesk. Podpis ověřuje jádro zabudovaným
veřejným klíčem; produkční klíč v repu zatím není (TODO v license.ts), proto testy tarifu Pro / Firma
nahradí jen krok ověření podpisu (``license.verify``) — stav, tarify, brána projektu, patička a DXF
počítá skutečné jádro přes most. Skutečné ověření podpisu testuje jádro (license.test.ts).

Spuštění (z apps/desktop):  python -m unittest tests.test_license -v
"""

from __future__ import annotations

import base64
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ["PLCSTUDIO_HOME"] = tempfile.mkdtemp(prefix="plcstudio_lictest_")

import tkinter as tk  # noqa: E402

from plc_studio import license as lic_mod  # noqa: E402
from plc_studio.app import App  # noqa: E402
from plc_studio.widgets import save_file, save_many  # noqa: E402

SAMPLES = Path(__file__).resolve().parents[3] / "samples"
B64 = lambda b: base64.urlsafe_b64encode(b).decode().rstrip("=")   # noqa: E731


def lic_file(**claims) -> str:
    """Licenční soubor ve tvaru serveru; podpis je náhodný (ověření v těchto testech podvrhujeme)."""
    payload = {"v": 1, "key": "PLCD-ABCD-EFGH-JKLM-NPQR", "email": "test@firma.cz", "seats": 1,
               "iat": "2026-10-01T00:00:00.000Z", "plan": "pro", "exp": "2027-12-31T00:00:00.000Z", **claims}
    return B64(json.dumps(payload).encode()) + "." + B64(os.urandom(64))


class FakeNet:
    """Podvržené API PLCdesk: záznam dotazů a odpovědi podle cesty; ``down`` = bez sítě."""

    def __init__(self):
        self.calls: list[tuple[str, dict | None]] = []
        self.down = False
        self.resp = {
            "/api/config": (200, {"free_io_limit": 64}),
            "/api/license/activate": (200, {"ok": True, "license": lic_file(), "plan": "pro"}),
            "/api/license/check": (200, {"status": "active", "plan": "pro", "valid_until": "2027-12-31T00:00:00.000Z"}),
        }

    def __call__(self, path, body=None, timeout=8):
        self.calls.append((path, body))
        if self.down:
            raise OSError("bez sítě")
        return self.resp.get(path, (404, {"error": "not found"}))


class LicenseTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = tk.Tk()
        cls.app = App(cls.root)
        cls.root.update()
        cls.real_request = cls.app.bridge.request

    @classmethod
    def tearDownClass(cls):
        cls.app.close()

    def setUp(self):
        self.app.errors.clear()
        self.net = FakeNet()
        self.app.lic.http = self.net
        self.fake_sig = True
        self.app.bridge.request = self.request        # podvrhnout jen ověření podpisu
        self.app.lic.remove()
        self.app.load_sample("small")
        self.tmp = Path(tempfile.mkdtemp(prefix="plcdesk_lic_out_"))

    def tearDown(self):
        self.app.bridge.request = self.real_request
        self.assertEqual(self.app.errors, [], "callback okna skončil chybou")
        for w in self.root.winfo_children():
            if isinstance(w, tk.Toplevel):
                w.destroy()

    def request(self, op, **payload):
        if op == "license.verify" and self.fake_sig:
            t = payload.get("text") or ""
            try:
                p = t.split(".")[0]
                claims = json.loads(base64.urlsafe_b64decode(p + "=" * (-len(p) % 4)))
            except ValueError:
                return {"ok": False, "claims": None, "error": "format"}
            return {"ok": True, "claims": claims}
        return self.real_request(op, **payload)

    def wait(self, cond, timeout=15.0):
        t0 = time.monotonic()
        while not cond() and time.monotonic() - t0 < timeout:
            self.root.update()
            time.sleep(0.02)
        self.assertTrue(cond(), "nedočkal jsem se výsledku")

    def insert(self, text):
        res = []
        self.app.lic.insert(text, lambda ok, msg: res.append((ok, msg)))
        self.wait(lambda: res)
        return res[0]

    def big(self):
        self.assertTrue(self.app.open_project(SAMPLES / "10_vyrobni_hala_linka_rozdelovacu.plcstudio.json"))

    def save_to(self, name, body):
        target = self.tmp / name
        with mock.patch("plc_studio.widgets.filedialog.asksaveasfilename", return_value=str(target)):
            ok = save_file(self.app, name, body)
        return ok, (target.read_text(encoding="utf-8") if target.exists() else None)

    # --- otisk, úložiště ---------------------------------------------------------------

    def test_device_hash_stable_without_personal_data(self):
        h = lic_mod.device_hash()
        self.assertRegex(h, r"^[0-9a-f]{64}$")
        self.assertEqual(h, lic_mod.device_hash())
        self.assertNotIn(lic_mod.machine_id().split(":", 1)[1].lower(), h)
        self.assertNotIn(os.environ.get("USERNAME", "@@").lower(), lic_mod.device_label().lower())

    def test_site_urls(self):
        self.assertEqual(lic_mod.site_url("cenik", "cs"), "https://plcdesk.podlena-t.workers.dev/cenik/")
        self.assertEqual(lic_mod.site_url("kontakt", "de"), "https://plcdesk.podlena-t.workers.dev/de/kontakt/")
        self.assertEqual(lic_mod.site_url("cenik", "zh"), "https://plcdesk.podlena-t.workers.dev/en/cenik/")

    # --- Free ----------------------------------------------------------------------------

    def test_free_footer_dxf_and_code(self):
        self.assertEqual(self.app.lic.state["plan"], "free")
        ok, body = self.save_to("01_funkcni_specifikace_FDS.md", "# FDS\n")
        self.assertTrue(ok)
        self.assertIn("Vytvořeno v PLCdesk Free", body)
        ok, body = self.save_to("codesys_MAIN.st", "PROGRAM MAIN\nEND_PROGRAM\n")
        self.assertEqual(body, "PROGRAM MAIN\nEND_PROGRAM\n", "kód PLC beze změny")
        ok, body = self.save_to("01_DI1_X1.dxf", "0\nEOF\n")
        self.assertFalse(ok)
        self.assertIsNone(body)
        self.assertIsNotNone(lic_mod.LicenseDialog.current, "okno Licence s důvodem")
        self.assertIn("DXF", lic_mod.LicenseDialog.current.reason)
        # uložit vše: DXF se přeskočí, ostatní se uloží
        with mock.patch("plc_studio.widgets.filedialog.askdirectory", return_value=str(self.tmp)):
            self.assertTrue(save_many(self.app, [("a.md", "# a\n"), ("b.dxf", "0\n"), ("c.csv", "x;y\n")]))
        self.assertTrue((self.tmp / "a.md").exists() and (self.tmp / "c.csv").exists())
        self.assertFalse((self.tmp / "b.dxf").exists())
        self.assertEqual((self.tmp / "c.csv").read_text(encoding="utf-8"), "x;y\n")

    def test_over_limit_blocks_everything_but_preview(self):
        self.big()
        g = self.app.lic.gate()
        self.assertTrue(g["over"])
        self.assertGreater(g["io"], 64)
        ok, body = self.save_to("siemens_Gen_Main.scl", "x")
        self.assertFalse(ok)
        self.assertIn("povoluje 64", lic_mod.LicenseDialog.current.reason)
        with mock.patch("plc_studio.widgets.filedialog.askdirectory", return_value=str(self.tmp)) as dlg:
            self.assertFalse(save_many(self.app, [("a.md", "x"), ("b.st", "y")]))
            dlg.assert_not_called()
        # projekt (data uživatele) jde uložit vždy
        ok, body = self.save_to("Hala.plcstudio.json", "{}")
        self.assertTrue(ok)
        # krok Generovat: pás s vysvětlením, náhled kódu zůstává
        self.app.goto(7)
        self.app.wait_jobs(300)
        self.root.update()
        bars = [w for w in self.app.view.winfo_children() if getattr(w, "over", None) is True]
        self.assertEqual(len(bars), 1, "pás nad limitem")
        # odemčení: Kontakt webu + text žádosti s ID projektu ve schránce
        d = lic_mod.LicenseDialog.open(self.app, focus="unlock")
        with mock.patch("plc_studio.license.webbrowser.open") as wb:
            d.unlock()
            wb.assert_called_once_with("https://plcdesk.podlena-t.workers.dev/kontakt/")
        self.assertIn(self.app.prj["guid"], self.root.clipboard_get())
        self.assertEqual(self.net.calls, [], "odemčení nic neposílá (server chce Turnstile)")

    # --- aktivace -------------------------------------------------------------------------

    def test_activation_pro_and_persistence(self):
        ok, msg = self.insert("plcd-abcd-efgh-jklm-npqr")
        self.assertTrue(ok, msg)
        path, body = self.net.calls[-1]
        self.assertEqual(path, "/api/license/activate")
        self.assertEqual(body["key"], "PLCD-ABCD-EFGH-JKLM-NPQR")
        self.assertEqual(body["device_hash"], lic_mod.device_hash())
        self.assertEqual(self.app.lic.state["plan"], "pro")
        self.assertIn("Pro", self.app._lic_btn.cget("text"))
        stored = json.loads((Path(os.environ["PLCSTUDIO_HOME"]) / "license.json").read_text(encoding="utf-8"))
        self.assertEqual(stored["key"], "PLCD-ABCD-EFGH-JKLM-NPQR")
        self.assertTrue(stored["text"].count(".") == 1)
        # Pro: DXF a čisté dokumenty, velký projekt bez limitu
        ok, body = self.save_to("01_DI1_X1.dxf", "0\nEOF\n")
        self.assertEqual(body, "0\nEOF\n")
        ok, body = self.save_to("01_fds.md", "# FDS\n")
        self.assertEqual(body, "# FDS\n")
        self.big()
        self.assertFalse(self.app.lic.gate()["over"])
        # nový start aplikace: licence se načte ze souboru
        again = lic_mod.License(self.app, http=self.net)
        self.assertEqual(again.state["plan"], "pro")

    def test_activation_errors(self):
        self.net.down = True
        ok, msg = self.insert("PLCD-ABCD-EFGH-JKLM-NPQR")
        self.assertFalse(ok)
        self.assertIn("licenční soubor z e-mailu", msg)
        self.net.down = False
        self.net.resp["/api/license/activate"] = (409, {"error": "Licence je už použitá na všech povolených počítačích (1)."})
        ok, msg = self.insert("PLCD-ABCD-EFGH-JKLM-NPQR")
        self.assertFalse(ok)
        self.assertIn("všech povolených počítačích", msg)
        ok, msg = self.insert("nesmysl")
        self.assertFalse(ok)
        self.assertEqual(self.app.lic.state["plan"], "free")

    def test_offline_license_file_and_real_signature_check(self):
        n = len(self.net.calls)
        ok, msg = self.insert(lic_file(plan="firma", seats=5))
        self.assertTrue(ok, msg)
        self.assertEqual(len(self.net.calls), n, "licenční soubor se ověří bez sítě")
        self.assertEqual(self.app.lic.state["plan"], "firma")
        self.assertTrue(self.app.lic.gen_opts()["library"])
        # skutečné ověření podpisu jádrem: náhodný podpis (a bez produkčního klíče) = neplatné, Free
        self.fake_sig = False
        self.app.lic.verify()
        st = self.app.lic.state
        self.assertEqual(st["state"], "invalid")
        self.assertEqual(st["plan"], "free")
        self.assertRegex(st["message"], "veřejný klíč|Podpis licence nesedí")

    # --- kontrola na pozadí -----------------------------------------------------------------

    def test_background_check_daily_cancel_and_offline(self):
        self.insert("PLCD-ABCD-EFGH-JKLM-NPQR")
        lic = self.app.lic
        lic.store.pop("checked_at", None)
        # bez sítě: nic se nemění
        self.net.down = True
        done = []
        self.assertTrue(lic.background_check(on_done=done.append))
        self.wait(lambda: done)
        self.assertEqual(lic.state["plan"], "pro")
        self.assertFalse(lic.background_check(), "nejvýš jednou denně")
        # zrušené předplatné → Free
        self.net.down = False
        self.net.resp["/api/license/check"] = (200, {"status": "canceled", "plan": "pro"})
        done.clear()
        self.assertTrue(lic.background_check(force=True, on_done=done.append))
        self.wait(lambda: done)
        self.assertEqual(lic.state["state"], "canceled")
        self.assertEqual(lic.state["plan"], "free")
        # zaplaceno dál → nový licenční soubor aktivací
        self.net.resp["/api/license/check"] = (200, {"status": "active", "valid_until": "2028-06-30T00:00:00.000Z"})
        newer = lic_file(exp="2028-06-30T00:00:00.000Z")
        self.net.resp["/api/license/activate"] = (200, {"ok": True, "license": newer})
        done.clear()
        lic.background_check(force=True, on_done=done.append)
        self.wait(lambda: done)
        self.assertEqual(lic.store["text"], newer)
        self.assertEqual(lic.state["state"], "active")
        self.assertEqual(lic.state["exp"][:10], "2028-06-30")

    # --- knihovna bloků jen ve Firmě ----------------------------------------------------

    def test_library_templates_only_in_firma(self):
        prj = json.loads(json.dumps(self.app.prj))
        prj["platforms"] = ["codesys"]
        prj["library"] = {"format": "plcdesk-library", "schema": 1, "name": "ACME", "version": "1.0",
                          "company": {"name": "ACME Automation"},
                          "fbTemplates": [{"id": "AcmeMotor", "cls": "Motor", "dialect": "st",
                                           "source": self.real_request("call", fn="builtinTemplate", args=["Motor", "st"])["result"]
                                           .replace("(* Sablona: motor", "(* ACME firemni blok: motor")}]}
        free = self.real_request("gen", prj=json.loads(json.dumps(prj)), lic={"library": False})["out"]["codesys"]
        firma = self.real_request("gen", prj=json.loads(json.dumps(prj)), lic={"library": True})["out"]["codesys"]
        self.assertNotIn("ACME firemni blok", free["Gen_Library.st"])
        self.assertTrue(free["README.txt"].startswith("FIREMNÍ KNIHOVNA ACME 1.0 NEPOUŽITA"))
        self.assertIn("ACME firemni blok", firma["Gen_Library.st"])
        # bez parametru lic = výstup jádra beze změny
        plain = self.real_request("gen", prj=json.loads(json.dumps(prj)))["out"]["codesys"]
        self.assertEqual(plain, firma)

    def test_dialog_and_badge_render(self):
        d = self.app.open_license(reason="Důvod")
        self.root.update()
        self.assertTrue(d.win.winfo_exists())
        self.assertIn("Free", self.app._lic_btn.cget("text"))
        d.var_in.set(lic_file())
        d.activate()
        self.wait(lambda: self.app.lic.state["plan"] == "pro")
        self.root.update()
        self.assertIn("Pro", self.app._lic_btn.cget("text"))
        d.close()


if __name__ == "__main__":
    unittest.main()
