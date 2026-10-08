"""Balík k ověření pro beta testery (krok Platformy, most ``verifypack``, jádro verify_pack.ts).

Tlačítko je jen u platforem ve stavu beta, balík se skládá v pracovním procesu mostu, uloží se
jako ZIP s návodem, protokolem a manifestem (otisky SHA-256 sedí) a licenční brána ho neblokuje
ani ve Free nad limitem I/O (není to export projektu uživatele).

Spuštění (z apps/desktop):  python -m unittest tests.test_verify_pack -v
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ["PLCSTUDIO_HOME"] = tempfile.mkdtemp(prefix="plcstudio_vptest_")

import tkinter as tk  # noqa: E402
from tkinter import ttk  # noqa: E402

from plc_studio import __version__  # noqa: E402
from plc_studio import license as lic_mod  # noqa: E402
from plc_studio.app import App  # noqa: E402
from plc_studio.steps import platformy  # noqa: E402

SAMPLES = Path(__file__).resolve().parents[3] / "samples"


def walk(widget):
    for w in widget.winfo_children():
        yield w
        yield from walk(w)


def no_net(path, body=None, timeout=8):
    raise OSError("bez sítě (test)")


class VerifyPackTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = tk.Tk()
        cls.app = App(cls.root)
        cls.app.lic.http = no_net
        cls.root.update()

    @classmethod
    def tearDownClass(cls):
        cls.app.close()

    def setUp(self):
        self.app.wait_jobs(300)
        self.app.errors.clear()
        self.app.lic.remove()                       # tarif Free
        self.tmp = Path(tempfile.mkdtemp(prefix="plcdesk_vp_out_"))

    def tearDown(self):
        self.assertEqual(self.app.errors, [], "callback okna skončil chybou")
        for w in self.root.winfo_children():
            if isinstance(w, tk.Toplevel):
                w.destroy()

    def goto_platforms(self):
        self.app.goto(2)
        self.root.update()
        self.assertTrue(self.app.wait_jobs(300))

    def pack_buttons(self):
        return {w.verify_pack: w for w in walk(self.app.view)
                if isinstance(w, ttk.Button) and hasattr(w, "verify_pack")}

    def check_zip(self, path: Path, plat: str) -> dict:
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
            root = f"PLCdesk-overeni-{plat}-{__version__}/"
            self.assertTrue(all(n.startswith(root) for n in names), names[:3])
            rel = {n[len(root):]: z.read(n) for n in names}
        for f in ("NAVOD.md", "PROTOKOL.md", "MANIFEST.json"):
            self.assertIn(f, rel)
        m = json.loads(rel["MANIFEST.json"].decode("utf-8"))
        self.assertEqual(m["platform"], plat)
        self.assertEqual(m["version"], __version__)
        self.assertEqual(m["verification"]["state"], "beta")
        self.assertEqual([f["path"] for f in m["files"]], [n for n in rel if n != "MANIFEST.json"])
        for f in m["files"]:
            self.assertEqual(f["sha256"], hashlib.sha256(rel[f["path"]]).hexdigest(), f["path"])
            self.assertEqual(f["size"], len(rel[f["path"]]), f["path"])
        return {"manifest": m, "files": rel}

    def test_button_only_for_beta_platforms(self):
        self.app.reset_project()
        plats = list(self.app.prj["platforms"])
        self.goto_platforms()
        beta = {k for k, v in self.app.VERIF.items() if v["state"] == "beta"}
        self.assertTrue(beta)
        self.assertEqual(set(self.pack_buttons()), beta)
        text = "".join(w.cget("text") for w in walk(self.app.view) if isinstance(w, tk.Label))
        self.assertIn("licenci Pro dostanete zdarma", text)
        # odkaz Kontakt otevře stránku webu v jazyce okna
        link = [w for w in walk(self.app.view) if isinstance(w, tk.Label) and w.cget("text") == "Kontakt"][0]
        with mock.patch("plc_studio.steps.platformy.webbrowser.open") as wb:
            link.event_generate("<Button-1>", x=2, y=2)
            self.root.update()
            wb.assert_called_once_with("https://plcdesk.podlena-t.workers.dev/kontakt/")
        self.assertEqual(self.app.prj["platforms"], plats, "klik na odkaz nepřepíná platformu")

    def test_download_free_over_limit(self):
        """Ve Free nad limitem I/O se výstupy projektu neukládají — balík k ověření ano."""
        self.assertTrue(self.app.open_project(SAMPLES / "10_vyrobni_hala_linka_rozdelovacu.plcstudio.json"))
        self.assertTrue(self.app.lic.gate()["over"], "projekt nad limitem Free")
        plats = list(self.app.prj["platforms"])
        self.goto_platforms()
        btn = self.pack_buttons()["siemens"]
        target = self.tmp / "balik.zip"
        with mock.patch("plc_studio.steps.platformy.filedialog.asksaveasfilename",
                        return_value=str(target)) as dlg:
            btn.invoke()
            self.assertEqual(str(btn.cget("state")), "disabled", "během skládání tlačítko čeká")
            self.assertTrue(self.app.wait_jobs(300))
            self.root.update()
            dlg.assert_called_once()
            self.assertEqual(dlg.call_args.kwargs["initialfile"], f"PLCdesk-overeni-siemens-{__version__}.zip")
        self.assertTrue(target.exists())
        self.assertIsNone(lic_mod.LicenseDialog.current, "licenční okno se neotevřelo")
        self.assertEqual(self.app.prj["platforms"], plats, "tlačítko nepřepíná výběr platformy")
        z = self.check_zip(target, "siemens")
        self.assertTrue(any(n.startswith("04_servo_axis_PM-12/") and n.endswith(".scl") for n in z["files"]))
        commit = z["manifest"]["commit"]
        self.assertTrue(commit is None or len(commit) == 12)
        b = [w for w in walk(self.app.view) if isinstance(w, ttk.Button) and getattr(w, "verify_pack", "") == "siemens"]
        if b:
            self.assertEqual(str(b[0].cget("state")), "normal")

    def test_bridge_languages(self):
        """Balík v jazyce okna (most), FX5 bez kódu osy."""
        for lang, head in (("en", "# PLCdesk — verification pack"), ("de", "# PLCdesk — Prüfpaket")):
            self.app.set_language(lang)
            try:
                res = self.app.bridge.request("verifypack", plat="mitsubishi", version=__version__, commit=None)
                path = platformy.save_verify_pack(self.app, res, str(self.tmp / f"m_{lang}.zip"))
                z = self.check_zip(Path(path), "mitsubishi")
                navod = z["files"]["NAVOD.md"].decode("utf-8")
                self.assertTrue(navod.startswith(head), navod[:80])
                self.assertEqual([n for n in z["files"] if n.startswith("04_")], ["04_servo_axis_PM-12/README.txt"])
            finally:
                self.app.set_language("cs")

    def test_source_commit(self):
        c = platformy.source_commit()
        self.assertTrue(c is None or (len(c) == 12 and all(ch in "0123456789abcdef" for ch in c)))
        self.assertIsNone(platformy.source_commit(self.tmp), "složka bez .git")


if __name__ == "__main__":
    unittest.main()
