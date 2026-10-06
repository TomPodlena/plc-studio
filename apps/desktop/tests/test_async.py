"""Drahé výpočty mimo vlákno okna — pracovní proces mostu (``DualBridge``) a zástupný stav kroků.

Pracovní proces se „zdrží“ obalem ``request_raw`` (běží v pracovním vlákně a čeká na bránu),
takže test řídí, kdy výpočet doběhne, a ověří, že okno mezitím reaguje, výsledek se dokreslí,
zrušení a zastaralý výsledek se zahodí a zavření aplikace nic nenechá viset.

Spuštění (z apps/desktop):  python -m unittest tests.test_async -v
"""

from __future__ import annotations

import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ["PLCSTUDIO_HOME"] = tempfile.mkdtemp(prefix="plcstudio_test_async_")

import tkinter as tk  # noqa: E402
from tkinter import ttk  # noqa: E402

from plc_studio.app import App  # noqa: E402
from plc_studio.bridge import BridgeError, DualBridge, Pending  # noqa: E402

STEP_GEN, STEP_DOCS, STEP_BOM = 7, 8, 9


def walk(widget):
    for w in widget.winfo_children():
        yield w
        yield from walk(w)


class Gate:
    """Zdrží požadavky pracovního procesu (vybrané operace), dokud se brána neotevře."""

    def __init__(self, bridge: DualBridge, ops=("files",)):
        self.bridge, self.ops = bridge, set(ops)
        self.open = threading.Event()
        self.entered = threading.Event()
        self.orig = bridge.worker.request_raw

        def slow(op, payload=None, body=None):
            if op in self.ops:
                self.entered.set()
                while not self.open.is_set():
                    job = bridge.running()
                    if bridge._closed or (job is not None and job.state == "cancelled"):
                        raise BridgeError("zrušeno v testu")
                    time.sleep(0.01)
            return self.orig(op, payload, body)

        bridge.worker.request_raw = slow

    def close(self) -> None:
        self.open.set()
        self.bridge.worker.request_raw = self.orig


class AsyncBridgeTest(unittest.TestCase):
    """Most bez okna: fronta, cache, zrušení, zavření."""

    def setUp(self):
        self.b = DualBridge()
        self.b.request("init", lang="cs")
        self.prj = self.b.call("sampleSmall")

    def tearDown(self):
        self.b.close()

    def test_fetch_cache_and_pending(self):
        self.b.grace = 0.0
        gate = Gate(self.b)
        try:
            with self.assertRaises(Pending) as cm:
                self.b.fetch("files", prj=self.prj)
            job = cm.exception.job
            self.assertTrue(gate.entered.wait(30))
            self.assertEqual(job.state, "running")
            # stejný požadavek se nezakládá znovu
            self.assertIs(self.b.submit("files", {"prj": self.prj}), job)
            gate.open.set()
            self.assertTrue(job.event.wait(120))
        finally:
            gate.close()
        self.assertEqual(job.state, "done")
        self.assertTrue(self.b.is_cached("files", prj=self.prj))
        t0 = time.monotonic()
        files = self.b.fetch("files", prj=self.prj)["files"]      # z cache, bez výpočtu
        self.assertLess(time.monotonic() - t0, 2.0)
        self.assertTrue(files)
        # synchronní volání sdílí stav pracovního procesu (cache ověření simulací)
        self.assertTrue(self.b.request("approval.badge", prj=self.prj)["partial"] is False)

    def test_cancel_kills_worker_and_next_request_restarts(self):
        self.b.grace = 0.0
        self.b.request("bom", prj=self.prj)                     # proces nahozený
        proc = self.b.worker._proc
        gate = Gate(self.b, ("verify",))
        try:
            job = self.b.submit("verify", {"prj": self.prj})
            self.assertTrue(gate.entered.wait(30))
            self.assertEqual(job.state, "running")
            self.b.cancel(job)
            self.assertTrue(job.event.wait(30))
        finally:
            gate.close()
        self.assertEqual((job.state, job.reason), ("cancelled", "user"))
        self.assertIsNotNone(proc.poll(), "zrušení ukončí běžící proces")
        self.assertFalse(self.b.is_cached("verify", prj=self.prj))
        # další požadavek proces nahodí (i s jazykem)
        self.b.request("init", lang="de")
        res = self.b.fetch("bom", wait=60, prj=self.prj)
        self.assertTrue(res["lines"])
        self.assertEqual(self.b.worker._proc_lang, "de")

    def test_core_error_is_reported_not_raised_in_thread(self):
        job = self.b.submit("call", {"fn": "nonexistentFn", "args": []})
        self.assertTrue(job.event.wait(60))
        self.assertEqual(job.state, "error")
        with self.assertRaises(BridgeError):
            job.result()
        # pracovní vlákno žije dál
        self.assertTrue(self.b.fetch("bom", wait=60, prj=self.prj)["lines"])

    def test_close_while_running(self):
        gate = Gate(self.b)
        try:
            job = self.b.submit("files", {"prj": self.prj})
            self.assertTrue(gate.entered.wait(30))
            procs = [self.b.main._proc, self.b.worker._proc]
            th = self.b._thread
            t0 = time.monotonic()
            self.b.close()
            self.assertLess(time.monotonic() - t0, 6.0)
        finally:
            gate.close()
        self.assertFalse(th.is_alive(), "pracovní vlákno skončilo")
        self.assertTrue(all(p is None or p.poll() is not None for p in procs), "procesy skončily")
        self.assertEqual(job.state, "cancelled")
        with self.assertRaises(BridgeError):
            self.b.request("files", prj=self.prj)


class AsyncGuiTest(unittest.TestCase):
    """Okno: zástupný stav, odezva během výpočtu, dokreslení, zrušení, zastaralý výsledek."""

    @classmethod
    def setUpClass(cls):
        cls.root = tk.Tk()
        cls.app = App(cls.root)
        cls.root.update()

    @classmethod
    def tearDownClass(cls):
        cls.app.close()

    def setUp(self):
        self.app.errors.clear()
        self.app.ui.clear()
        self.app.load_sample("small")
        self.app.wait_jobs(300)
        self.app.bridge.clear_cache()
        self.gate = Gate(self.app.bridge, ("files", "bom"))

    def tearDown(self):
        self.gate.close()
        self.app.wait_jobs(300)
        self.assertEqual(self.app.errors, [], "callback okna skončil chybou")

    def placeholder(self):
        return next((w for w in walk(self.app.view) if hasattr(w, "cancel_button")), None)

    def texts(self):
        out = []
        for w in walk(self.app.view):
            try:
                out.append(str(w.cget("text")))
            except tk.TclError:
                pass
        return out

    def start(self, step):
        self.app.goto(step)
        self.root.update()
        self.assertTrue(self.gate.entered.wait(30), "výpočet nezačal")
        self.gate.entered.clear()
        self.root.update()

    def responsive_ms(self) -> float:
        """Za jak dlouho okno zpracuje naplánovanou událost (after 0)."""
        fired = []
        t0 = time.monotonic()
        self.root.after(0, lambda: fired.append(time.monotonic() - t0))
        while not fired and time.monotonic() - t0 < 5:
            self.root.update()
            time.sleep(0.005)
        return fired[0] * 1000 if fired else 1e9

    def test_docs_placeholder_responsive_then_result(self):
        self.start(STEP_DOCS)
        box = self.placeholder()
        self.assertIsNotNone(box, "krok ukazuje zástupný stav")
        self.assertIn("Zrušit", self.texts())
        self.assertLess(self.responsive_ms(), 200, "okno během výpočtu reaguje")
        # během výpočtu jde přepnout krok a vrátit se — výpočet se nezakládá znovu
        job = box.job
        self.app.goto(0)
        self.root.update()
        self.assertIsNone(self.placeholder())
        self.app.goto(STEP_DOCS)
        self.root.update()
        self.assertIs(self.placeholder().job, job)
        self.gate.open.set()
        self.assertTrue(self.app.wait_jobs(300))
        self.assertIsNone(self.placeholder())
        self.assertIn("Uložit vše do složky…", self.texts(), "dokumentace se dokreslila")
        # návrat do kroku = z cache, bez zástupného stavu
        self.app.goto(0)
        self.root.update()
        self.app.goto(STEP_DOCS)
        self.root.update()
        self.assertIsNone(self.placeholder())
        self.assertIn("Uložit vše do složky…", self.texts())

    def test_cancel_and_compute_again(self):
        self.start(STEP_DOCS)
        box = self.placeholder()
        job = box.job
        box.cancel_button.invoke()
        for _ in range(500):
            self.root.update()
            self.app._pump()
            if "Výpočet zrušen." in self.texts():
                break
            time.sleep(0.01)
        self.assertEqual((job.state, job.reason), ("cancelled", "user"))
        self.assertIn("Výpočet zrušen.", self.texts())
        self.gate.open.set()
        btn = next(w for w in walk(self.app.view) if isinstance(w, ttk.Button)
                   and str(w.cget("text")) == "Spočítat znovu")
        btn.invoke()
        self.assertTrue(self.app.wait_jobs(300))
        self.assertIn("Uložit vše do složky…", self.texts())

    def test_stale_result_is_dropped(self):
        self.start(STEP_DOCS)
        old = self.placeholder().job
        old_key = old.key
        # uživatel odejde a změní projekt — výsledek pro starý projekt se nesmí ukázat
        self.app.goto(0)
        self.root.update()
        self.app.prj["meta"]["name"] = "Jiný stroj"
        self.gate.open.set()
        self.assertTrue(self.app.wait_jobs(300))
        self.assertEqual(self.app.step, 0)
        self.assertNotIn("Uložit vše do složky…", self.texts())
        self.assertEqual(old.state, "done")
        self.assertIsNotNone(self.app.bridge.cached(old_key), "výsledek zůstal v cache")
        self.assertFalse(self.app.bridge.is_cached("files", prj=self.app.prj))

    def test_newer_step_preempts_unwanted_computation(self):
        self.start(STEP_DOCS)
        old = self.placeholder().job
        self.app.goto(STEP_BOM)                     # kusovník: dokumentaci už nikdo nechce
        self.root.update()
        for _ in range(500):
            if old.finished:
                break
            self.root.update()
            time.sleep(0.01)
        self.assertEqual((old.state, old.reason), ("cancelled", "preempted"))
        self.gate.open.set()
        self.assertTrue(self.app.wait_jobs(300))
        self.assertEqual(self.app.step, STEP_BOM)
        self.assertIsNone(self.placeholder())
        self.assertTrue(any(isinstance(w, ttk.Treeview) for w in walk(self.app.view)))

    def test_language_switch_during_computation(self):
        self.start(STEP_DOCS)
        old = self.placeholder().job
        try:
            self.app.set_language("en")
            self.root.update()
            self.gate.open.set()
            self.assertTrue(self.app.wait_jobs(300))
            self.assertEqual(old.state, "cancelled")
            self.assertIsNone(self.placeholder())
            self.assertNotIn("Uložit vše do složky…", self.texts())
            self.assertEqual(self.app.bridge.worker._proc_lang, "en")
        finally:
            self.gate.close()
            self.app.set_language("cs")
            self.app.wait_jobs(300)

    def test_core_error_shows_message_with_retry(self):
        self.gate.close()
        orig = self.app.bridge.worker.request_raw

        def broken(op, payload=None, body=None):
            if op == "files":
                raise BridgeError("simulovaná chyba jádra")
            return orig(op, payload, body)

        self.app.bridge.worker.request_raw = broken
        grace, self.app.bridge.grace = self.app.bridge.grace, 0.0   # cesta přes zástupný stav
        try:
            self.app.goto(STEP_DOCS)
            self.root.update()
            self.assertTrue(self.app.wait_jobs(60))
            joined = " ".join(self.texts())
            self.assertIn("simulovaná chyba jádra", joined)
            self.assertIn("Zkusit znovu", self.texts())
            self.app.errors.clear()                # chyba patří do kroku, ne do pádu okna
        finally:
            self.app.bridge.worker.request_raw = orig
            self.app.bridge.grace = grace
        next(w for w in walk(self.app.view) if isinstance(w, ttk.Button)
             and str(w.cget("text")) == "Zkusit znovu").invoke()
        self.assertTrue(self.app.wait_jobs(300))
        self.assertIn("Uložit vše do složky…", self.texts())


class CloseDuringComputationTest(unittest.TestCase):
    def test_close_app_while_docs_compute(self):
        root = tk.Tk()
        app = App(root, home=Path(tempfile.mkdtemp(prefix="plcstudio_close_")))
        app.load_sample("small")
        app.wait_jobs(300)
        app.bridge.clear_cache()
        gate = Gate(app.bridge)
        try:
            app.goto(STEP_DOCS)
            root.update()
            self.assertTrue(gate.entered.wait(30))
            procs = [app.bridge.main._proc, app.bridge.worker._proc]
            th = app.bridge._thread
            t0 = time.monotonic()
            app.close()
            self.assertLess(time.monotonic() - t0, 6.0, "zavření nečeká na výpočet")
        finally:
            gate.close()
        self.assertFalse(th.is_alive(), "žádné visící vlákno")
        self.assertTrue(all(p is None or p.poll() is not None for p in procs), "oba procesy skončily")


if __name__ == "__main__":
    unittest.main()
