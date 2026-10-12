"""Testy zpětné vazby v desktopu (plc_studio/feedback.py).

Síť jde jen na lokální stub server (http.server na 127.0.0.1 v tomto procesu) — žádný dotaz na web PLCdesk.
Ověřuje: formulář (předvyplněný e-mail z licence, smazání e-mailu, náhled kontextu), tvar požadavku
(hlavička klienta, kontext bez klíče licence a otisku, projekt jen se zaškrtnutím), výsledek, chyba pole,
koncept při zavření okna, bez sítě (hláška, Kopírovat text / Otevřít e-mail) a omezení adresy na localhost.

Spuštění (z apps/desktop):  python -m unittest tests.test_feedback -v
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ["PLCSTUDIO_HOME"] = tempfile.mkdtemp(prefix="plcstudio_fbtest_")

import tkinter as tk  # noqa: E402

from plc_studio import __version__  # noqa: E402
from plc_studio import feedback as fb  # noqa: E402
from plc_studio.app import App  # noqa: E402


class Stub:
    """Lokální stub /api/feedback: zaznamená požadavky, odpověď podle ``reply``."""

    def __init__(self):
        self.requests: list[dict] = []
        self.reply = (200, {"ok": True, "ref": "abcd1234"})
        stub = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802
                n = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(n)
                stub.requests.append({"path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()},
                                      "body": json.loads(raw.decode("utf-8"))})
                status, data = stub.reply
                out = json.dumps(data).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(out)))
                self.end_headers()
                self.wfile.write(out)

            def log_message(self, *a):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


class FeedbackTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stub = Stub()
        cls.env = mock.patch.dict(os.environ, {"PLCDESK_FEEDBACK_SITE": cls.stub.url})
        cls.env.start()
        cls.root = tk.Tk()
        cls.app = App(cls.root)
        cls.root.update()

    @classmethod
    def tearDownClass(cls):
        cls.app.close()
        cls.env.stop()
        cls.stub.close()

    def setUp(self):
        self.app.errors.clear()
        self.stub.requests.clear()
        self.stub.reply = (200, {"ok": True, "ref": "abcd1234"})
        fb.clear_draft(self.app)
        self.app.load_sample("small")
        self.app.goto(7)

    def tearDown(self):
        self.assertEqual(self.app.errors, [], "callback okna skončil chybou")
        if fb.FeedbackDialog.current is not None:
            fb.FeedbackDialog.current.close()

    def wait(self, cond, timeout=15.0):
        t0 = time.monotonic()
        while not cond() and time.monotonic() - t0 < timeout:
            self.root.update()
            time.sleep(0.02)
        self.assertTrue(cond(), "nedočkal jsem se výsledku")

    def open(self, **kw) -> fb.FeedbackDialog:
        d = self.app.open_feedback(**kw)
        self.root.update()
        return d

    def type_text(self, d, text):
        d.text.delete("1.0", "end")
        d.text.insert("1.0", text)
        self.root.update()

    # --- formulář ------------------------------------------------------------------------

    def test_header_button_and_form(self):
        texts = []

        def walk(w):
            for c in w.winfo_children():
                try:
                    texts.append(str(c.cget("text")))
                except tk.TclError:
                    pass
                walk(c)
        walk(self.root)
        self.assertIn("Zpětná vazba", texts, "tlačítko v hlavičce")
        d = self.open()
        self.assertEqual(d.var_kind.get(), "bug")
        self.assertFalse(d.var_attach.get(), "projekt výchozí NE")
        prev = json.loads(d.preview.get("1.0", "end-1c"))
        self.assertEqual([prev["client"], prev["app_version"], prev["step"], prev["project"]],
                         ["desktop", __version__, "8: Generovat", "ne"])
        for k in ("key", "device_hash", "license"):
            self.assertNotIn(k, prev)

    def test_email_prefilled_from_license_and_clearable(self):
        state = dict(self.app.lic.state)
        self.app.lic.state = {**state, "email": "licence@firma-example.cz"}
        try:
            d = self.open()
            self.assertEqual(d.var_email.get(), "licence@firma-example.cz")
            d.clear_email()
            self.assertEqual(d.var_email.get(), "")
            self.assertIn("(", json.loads(d.preview.get("1.0", "end-1c"))["email"])   # „(anonymně)“
        finally:
            self.app.lic.state = state

    def test_text_limit(self):
        d = self.open()
        self.type_text(d, "x" * (fb.TEXT_MAX + 50))
        self.assertEqual(len(d.body_text()), fb.TEXT_MAX)

    # --- odeslání ------------------------------------------------------------------------

    def test_send_ok_without_project(self):
        d = self.open()
        d.var_kind.set("idea")
        self.type_text(d, "Export I/O listu do Excelu.\nDruhý řádek.")
        d.var_email.set("Tester@Firma-Example.cz")
        d.send()
        self.wait(lambda: d.result and d.result[0] != "busy")
        self.assertEqual(d.result[0], "ok", d.result)
        self.assertIn("abcd1234", d.result[1])
        req = self.stub.requests[-1]
        self.assertEqual(req["path"], "/api/feedback")
        self.assertEqual(req["headers"]["x-plcdesk-client"], "desktop")
        self.assertEqual(req["headers"]["content-type"], "application/json")
        b = req["body"]
        self.assertEqual([b["kind"], b["text"], b["email"], b["client"], b["app_version"], b["step"], b["lang"]],
                         ["idea", "Export I/O listu do Excelu.\nDruhý řádek.", "Tester@Firma-Example.cz", "desktop",
                          __version__, "8: Generovat", self.app.lang])
        self.assertNotIn("project", b)
        self.assertNotIn("attach_project", b)
        raw = json.dumps(b)
        self.assertNotIn("PLCD-", raw)
        from plc_studio.license import device_hash
        self.assertNotIn(device_hash(), raw, "otisk počítače se neposílá")
        self.assertFalse((self.app.home / fb.DRAFT_FILE).exists(), "koncept po odeslání smazán")
        self.assertEqual(d.body_text(), "")

    def test_send_with_project_only_when_checked(self):
        d = self.open()
        self.type_text(d, "Import skončil chybou.")
        d.var_attach.set(True)
        d.changed()
        self.assertIn("kB", json.loads(d.preview.get("1.0", "end-1c"))["project"])
        d.send()
        self.wait(lambda: d.result and d.result[0] != "busy")
        b = self.stub.requests[-1]["body"]
        self.assertTrue(b["attach_project"])
        self.assertEqual(b["project"]["meta"]["name"], self.app.prj["meta"]["name"])
        self.assertEqual(len(b["project"]["devices"]), len(self.app.prj["devices"]))

    def test_server_field_error(self):
        self.stub.reply = (400, {"error": "x", "field": "email"})
        d = self.open()
        self.type_text(d, "Dotaz.")
        d.var_email.set("spatny")
        d.send()
        self.wait(lambda: d.result and d.result[0] != "busy")
        self.assertEqual(d.result[0], "err")
        self.assertIn("E-mail", d.result[1])
        self.assertTrue((self.app.home / fb.DRAFT_FILE).exists(), "koncept zůstává")

    def test_empty_text_not_sent(self):
        d = self.open()
        self.type_text(d, "   ")
        d.send()
        self.root.update()
        self.assertEqual(d.result[0], "err")
        self.assertEqual(self.stub.requests, [])

    # --- koncept a bez sítě ---------------------------------------------------------------

    def test_draft_survives_close(self):
        d = self.open()
        d.var_kind.set("question")
        self.type_text(d, "Rozepsaná otázka")
        d.var_email.set("a@firma-example.cz")
        d.close()
        saved = json.loads((self.app.home / fb.DRAFT_FILE).read_text(encoding="utf-8"))
        self.assertEqual(saved, {"kind": "question", "text": "Rozepsaná otázka", "email": "a@firma-example.cz"})
        d2 = self.open()
        self.assertEqual([d2.var_kind.get(), d2.body_text(), d2.var_email.get()],
                         ["question", "Rozepsaná otázka", "a@firma-example.cz"])
        self.assertFalse(d2.var_attach.get(), "zaškrtnutí projektu se z konceptu neobnoví")

    def test_draft_written_while_typing(self):
        d = self.open()
        self.type_text(d, "Píšu…")
        saved = json.loads((self.app.home / fb.DRAFT_FILE).read_text(encoding="utf-8"))
        self.assertEqual(saved["text"], "Píšu…")

    def test_offline(self):
        with socket_closed() as url:
            d = self.open(post=lambda body: fb.post_feedback(body, base=url, timeout=3))
            self.type_text(d, "Bez sítě")
            d.send()
            self.wait(lambda: d.result and d.result[0] != "busy")
        self.assertEqual(d.result[0], "offline")
        btns = [str(w.cget("text")) for w in d.offline_row.winfo_children()]
        self.assertEqual(len(btns), 2)
        self.assertTrue((self.app.home / fb.DRAFT_FILE).exists(), "koncept zůstává")
        with mock.patch("plc_studio.feedback.webbrowser.open") as wb:
            d.offline_row.winfo_children()[1].invoke()
        url = wb.call_args[0][0]
        self.assertTrue(url.startswith("mailto:" + fb.FEEDBACK_MAIL + "?subject="), url)
        self.assertIn("Bez%20s%C3%AD", url)
        d.offline_row.winfo_children()[0].invoke()
        self.assertIn("Bez sítě", self.root.clipboard_get())

    # --- adresa ---------------------------------------------------------------------------

    def test_site_override_only_localhost(self):
        with mock.patch.dict(os.environ, {"PLCDESK_FEEDBACK_SITE": "https://evil.example"}):
            self.assertEqual(fb.site(), fb.API_BASE)
        with mock.patch.dict(os.environ, {"PLCDESK_FEEDBACK_SITE": "http://localhost:8115/x"}):
            self.assertEqual(fb.site(), "http://localhost:8115")
        with mock.patch.dict(os.environ, {"PLCDESK_FEEDBACK_SITE": ""}):
            self.assertEqual(fb.site(), "https://plcdesk.podlena-t.workers.dev")


class socket_closed:
    """Adresa na 127.0.0.1, kde nic neposlouchá (spojení odmítnuto = bez sítě)."""

    def __enter__(self):
        import socket
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()
        return f"http://127.0.0.1:{port}"

    def __exit__(self, *a):
        return False


if __name__ == "__main__":
    unittest.main()
