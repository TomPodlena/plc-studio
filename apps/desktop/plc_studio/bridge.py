"""Most do jádra PLCdesk — trvalé procesy Node s ``bridge.mjs``.

Protokol: jeden JSON požadavek na řádek → jedna JSON odpověď na řádek.

``CoreBridge`` = jeden proces, volaný synchronně. Aplikace používá ``DualBridge``: rychlé
operace (konstanty, validace, výkresy, živá simulace) jdou synchronně do hlavního procesu,
drahé výpočty (ověření simulací, dokumentace, schválení, oživení…) do druhého procesu, který
obsluhuje pracovní vlákno — okno mezitím reaguje. Tk se z pracovního vlákna nevolá nikdy:
výsledky si hlavní vlákno vyzvedne samo (``DualBridge.take_finished``).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
import time
from collections import OrderedDict
from pathlib import Path

from .i18n import _

BRIDGE_JS = Path(__file__).resolve().parent.parent / "bridge.mjs"
# operace, které u velkého stroje počítají sekundy až desítky sekund (ověření simulací,
# dokumentace, kusovník…) — během nich okno ukazuje kurzor čekání (CoreBridge.on_busy)
SLOW_OPS = frozenset({"files", "verify", "commission", "approval", "scenarios", "simulate",
                      "safety", "exports", "bom", "gen", "hmi", "hmi.files", "quote.files",
                      "revision.affected", "emu.platform", "emu.finish"})
# operace pracovního procesu: drahé výpočty a všechno, co sdílí jejich stav v procesu jádra —
# cache ověření simulací (schválení, oživení, revize, dokumentace) a přihlášený dokument
# emulace (emu.finish → files); synchronní volání odsud jde do téhož procesu
WORKER_OPS = frozenset({"files", "verify", "commission", "approval", "approval.badge",
                        "approval.many", "approval.tune", "safety", "exports", "bom", "gen",
                        "quote.files", "revision.affected", "revision.view", "revision.md",
                        "revision.create", "emu.platform", "emu.finish", "verifypack"})
# funkce jádra (operace ``call``), které počítají položky schválení / plán oživení (ověření)
WORKER_FNS = frozenset({"approve", "reject", "resetApproval", "setCommissionResult",
                        "clearCommissionResult", "docVerifyMd"})
# operace se stavem v procesu jádra (emulace přihlašuje dokument 15) — výsledek necachovat
NO_CACHE_OPS = frozenset({"emu.platform", "emu.finish", "approval.badge"})
# výsledek závisí i na stavu procesu (dokument 15 po emulaci) — otisk nese „epochu“ stavu
STATE_OPS = frozenset({"files"})
CACHE_ITEMS = 24                 # výsledky drahých výpočtů (otisk operace + jazyka + projektu)
CACHE_BYTES = 160 * 1024 * 1024


class BridgeError(RuntimeError):
    """Chyba jádra nebo mostu; ``code`` nese kód z jádra (např. invalid_json)."""

    def __init__(self, message: str, code: str = ""):
        super().__init__(message)
        self.code = code


def find_node() -> str | None:
    """Cesta k ``node``: proměnná ``PLCDESK_NODE``, přibalený runtime přenosné
    verze (``<kořen>/runtime/node/node.exe``), PATH, obvyklá místa instalace."""
    env = os.environ.get("PLCDESK_NODE")
    if env and Path(env).is_file():
        return env
    # přenosná verze: <kořen>/app/apps/desktop/bridge.mjs → <kořen>/runtime/node
    portable = BRIDGE_JS.parents[3] / "runtime" / "node" / "node.exe"
    if portable.is_file():
        return str(portable)
    exe = shutil.which("node")
    if exe:
        return exe
    for base in (os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)"),
                 os.environ.get("LOCALAPPDATA")):
        if base:
            for sub in ("nodejs", r"Programs\nodejs"):
                p = Path(base) / sub / "node.exe"
                if p.exists():
                    return str(p)
    return None


class CoreBridge:
    def __init__(self, log_file: Path | None = None):
        self._proc: subprocess.Popen | None = None
        self._lock = threading.Lock()
        self._id = 0
        self._log_file = log_file
        self._log = None
        self.lang = "cs"        # jazyk jádra; po restartu procesu se nastaví znovu
        self._proc_lang = "cs"  # jazyk, který má právě běžící proces
        # ``on_busy(True/False)`` kolem operací, které můžou trvat sekundy (okno pak ukáže
        # kurzor čekání); volá se v hlavním vlákně, most je synchronní
        self.on_busy = None

    # --- životní cyklus ------------------------------------------------------

    def start(self) -> None:
        node = find_node()
        if not node:
            raise BridgeError(_("Nenašel jsem Node.js (node.exe). PLCdesk potřebuje "
                                "Node 18+ — nainstaluj ho z nodejs.org."))
        if not BRIDGE_JS.exists():
            raise BridgeError(_("Chybí soubor mostu: {path}", path=BRIDGE_JS))
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)  # bez blikající konzole
        if self._log_file is not None and self._log is None:
            self._log = open(self._log_file, "a", encoding="utf-8")
        self._proc = subprocess.Popen(
            [node, str(BRIDGE_JS)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=self._log or subprocess.DEVNULL, encoding="utf-8",
            cwd=str(BRIDGE_JS.parent), creationflags=flags)

    def _stop(self) -> None:
        """Ukončí proces mostu (i už mrtvý) a zavře jeho roury."""
        proc, self._proc = self._proc, None
        if proc is None:
            return
        try:
            proc.stdin.close()
            proc.wait(timeout=2)
        except Exception:
            proc.kill()
            proc.wait()
        proc.stdout.close()

    def close(self) -> None:
        self._stop()
        if self._log is not None:
            self._log.close()
            self._log = None

    def kill(self) -> None:
        """Ukončí proces hned, bez zámku (zrušení výpočtu z jiného vlákna): čekající
        ``_exchange`` dostane konec roury → ``BridgeError``; další požadavek proces nahodí."""
        proc = self._proc
        if proc is not None and proc.poll() is None:
            try:
                proc.kill()
                proc.wait(timeout=2)      # ať další požadavek proces pozná jako mrtvý a nahodí nový
            except (OSError, subprocess.TimeoutExpired):
                pass

    # --- volání ----------------------------------------------------------------

    def request(self, op: str, **payload):
        """Pošle operaci mostu a vrátí její ``result``."""
        busy = self.on_busy if op in SLOW_OPS else None
        if busy is None:
            return parse_response(self.request_raw(op, payload))
        busy(True)
        try:
            return parse_response(self.request_raw(op, payload))
        finally:
            busy(False)

    def request_raw(self, op: str, payload: dict | None = None, body: str | None = None) -> str:
        """Pošle operaci a vrátí surový řádek odpovědi (bez kontroly ``ok``).

        ``body`` = už serializované parametry (objekt JSON) místo ``payload``."""
        with self._lock:
            if self._proc is None or self._proc.poll() is not None:
                self._stop()
                self.start()
                self._proc_lang = "cs"                      # nový proces začíná česky
            if op == "init":
                self.lang = (payload or {}).get("lang") or "cs"
            elif self._proc_lang != self.lang:
                parse_response(self._exchange("init", {"lang": self.lang}))
                self._proc_lang = self.lang
            raw = self._exchange(op, payload or {}, body)
            if op == "init":
                self._proc_lang = self.lang
            return raw

    def _exchange(self, op: str, payload: dict, body: str | None = None) -> str:
        """Jeden požadavek → jedna odpověď (surový řádek JSON); volat se zámkem."""
        self._id += 1
        line = json.dumps({"id": self._id, "op": op, **payload})
        if body and body.strip() not in ("", "{}"):
            line = line[:-1] + ", " + body.strip()[1:]
        try:
            self._proc.stdin.write(line + "\n")
            self._proc.stdin.flush()
            raw = self._proc.stdout.readline()
        except OSError as exc:
            self._stop()
            raise BridgeError(_("Spojení s jádrem se přerušilo: {exc}", exc=exc)) from exc
        if not raw:
            self._stop()
            raise BridgeError(_("Jádro (Node) neodpovědělo — proces skončil."))
        return raw

    def call(self, fn: str, *args):
        """Zavolá funkci jádra a vrátí její návratovou hodnotu."""
        return self.request("call", fn=fn, args=list(args))["result"]

    def mutate(self, fn: str, *args):
        """Zavolá funkci jádra, která mění první argument (projekt), a vrátí ho."""
        return self.request("call", fn=fn, args=list(args))["args"][0]

    def ai(self, fn: str, *args):
        return self.request("ai", fn=fn, args=list(args))["result"]


def parse_response(raw: str):
    """Surový řádek odpovědi → ``result``; chyba jádra → ``BridgeError``."""
    resp = json.loads(raw)
    if not resp.get("ok"):
        raise BridgeError(resp.get("error") or _("Neznámá chyba jádra."), resp.get("code") or "")
    return resp.get("result")


def _ok_line(raw: str) -> bool:
    """Odpověď je úspěch? Most píše ``{"id":…,"ok":…`` — u velké odpovědi stačí začátek řádku."""
    head = raw[:64]
    if '"ok":true' in head:
        return True
    if '"ok":false' in head:
        return False
    return bool(json.loads(raw).get("ok"))


# --------------------------------------------------------------------------- výpočty na pozadí

class Pending(Exception):
    """Výsledek drahého výpočtu ještě není — počítá se v pracovním procesu (``job``).

    Krok, který ho vyhodí, se po výsledku vykreslí znovu (``App.deferred``)."""

    def __init__(self, job: "Job"):
        super().__init__(job.op)
        self.job = job


class Job:
    """Jeden požadavek pracovního procesu. Stav: queued → running → done / error / cancelled."""

    def __init__(self, num: int, op: str, key: str, body: str, *, background: bool,
                 preemptible: bool, cache: bool = True):
        self.id = num
        self.op, self.key, self.body = op, key, body
        self.background, self.preemptible = background, preemptible
        self.cache = cache                    # výsledek do cache (ne u operací se stavem v procesu)
        self.state = "queued"
        self.raw: str | None = None           # surová odpověď (úspěch)
        self.error: BridgeError | None = None
        self.reason = ""                      # u zrušení: "user" / "preempted" / "closed"
        self.t_submit = time.monotonic()
        self.t_start: float | None = None
        self.t_end: float | None = None
        self.event = threading.Event()

    @property
    def finished(self) -> bool:
        return self.state in ("done", "error", "cancelled")

    def elapsed(self) -> float:
        return (self.t_end or time.monotonic()) - (self.t_start or self.t_submit)

    def result(self):
        """Výsledek hotového požadavku (nová kopie — volající ji smí měnit)."""
        if self.state == "error":
            raise self.error
        if self.state != "done":
            raise BridgeError(_("Výpočet byl zrušen."), "cancelled")
        return parse_response(self.raw)


class DualBridge:
    """Dva procesy mostu: hlavní (synchronní, rychlé operace) a pracovní (drahé výpočty).

    * ``request`` / ``call`` / ``mutate`` / ``ai`` — synchronně; operace z ``WORKER_OPS``
      (a funkce ``WORKER_FNS``) jdou do pracovního procesu, aby sdílely jeho stav.
    * ``fetch`` — výsledek z cache, nebo krátce počká (``grace``); jinak ``Pending``.
    * ``submit`` / ``cancel`` / ``take_finished`` — fronta pracovního vlákna. Volat jen z
      hlavního vlákna; pracovní vlákno jen posílá požadavky a ukládá surové odpovědi.

    Nový požadavek popředí zruší běžící požadavek, o který už nikdo nestojí (``wanted``
    vrací False — krok, který ho chtěl, už není vidět); proces se pak nahodí znovu.
    """

    def __init__(self, log_file: Path | None = None):
        self.main = CoreBridge(log_file=log_file)
        self.worker = CoreBridge(log_file=log_file)
        self.grace = 0.15             # s: tak dlouho fetch počká, než ukáže „Počítám…“
        self.wanted = lambda job: True  # nastaví aplikace: stojí ještě někdo o výsledek?
        self._cv = threading.Condition()
        self._queue: list[Job] = []
        self._running: Job | None = None
        self._finished: list[Job] = []
        self._cache: OrderedDict[str, str] = OrderedDict()
        self._cache_bytes = 0
        self._seq = 0
        self._epoch = 0
        self._closed = False
        self._thread: threading.Thread | None = None

    # --- kompatibilita s CoreBridge -------------------------------------------------------

    @property
    def lang(self) -> str:
        return self.main.lang

    @property
    def on_busy(self):
        return self.main.on_busy

    @on_busy.setter
    def on_busy(self, fn) -> None:
        self.main.on_busy = fn
        self.worker.on_busy = fn       # jen synchronní volání z hlavního vlákna

    @property
    def _proc(self):
        return self.main._proc

    def start(self) -> None:
        self.main.start()

    # --- synchronní volání --------------------------------------------------------------------

    @staticmethod
    def to_worker(op: str, payload: dict) -> bool:
        if op in ("revision.view", "revision.md") and not payload.get("exact"):
            return False                  # levné porovnání revizí (bez ověření simulací)
        return op in WORKER_OPS or (op == "call" and payload.get("fn") in WORKER_FNS)

    def request(self, op: str, **payload):
        if self._closed:
            raise BridgeError(_("Aplikace se zavírá."), "closed")
        if self.to_worker(op, payload):
            self._make_room()
            try:
                return self.worker.request(op, **payload)
            finally:
                if op in NO_CACHE_OPS and op != "approval.badge":
                    self._bump()
        res = self.main.request(op, **payload)
        if op == "init":
            self.worker.lang = self.main.lang   # pracovní proces se přepne před dalším požadavkem
        return res

    def call(self, fn: str, *args):
        return self.request("call", fn=fn, args=list(args))["result"]

    def mutate(self, fn: str, *args):
        return self.request("call", fn=fn, args=list(args))["args"][0]

    def ai(self, fn: str, *args):
        return self.request("ai", fn=fn, args=list(args))["result"]

    def _make_room(self) -> None:
        """Synchronní volání pracovního procesu: běžící výpočet, o který nikdo nestojí, zrušit
        (jinak by okno čekalo, až doběhne)."""
        job = self._running
        if job is not None and job.preemptible and not job.background and not self.wanted(job):
            self.cancel(job, "preempted")

    # --- cache --------------------------------------------------------------------------------

    def key(self, op: str, payload: dict) -> str:
        """Otisk požadavku: operace, jazyk, stav procesu (jen u ``STATE_OPS``) a parametry."""
        epoch = str(self._epoch) if op in STATE_OPS else ""
        # bez sort_keys: parametry jdou jádru v původním pořadí (emuGate porovnává JSON projektu)
        return "\x00".join((op, self.main.lang, epoch, json.dumps(
            payload, ensure_ascii=False, separators=(",", ":"))))

    def _bump(self) -> None:
        """Stav pracovního procesu se změnil (emulace přihlásila / odhlásila dokument 15,
        proces byl ukončen) — výsledky ``STATE_OPS`` z cache už neplatí."""
        self._epoch += 1

    def cached(self, key: str) -> str | None:
        with self._cv:
            raw = self._cache.get(key)
            if raw is not None:
                self._cache.move_to_end(key)
            return raw

    def is_cached(self, op: str, **payload) -> bool:
        return self.cached(self.key(op, payload)) is not None

    def _cache_put(self, key: str, raw: str) -> None:       # se zámkem
        old = self._cache.pop(key, None)
        if old is not None:
            self._cache_bytes -= len(old)
        self._cache[key] = raw
        self._cache_bytes += len(raw)
        while len(self._cache) > 1 and (len(self._cache) > CACHE_ITEMS
                                        or self._cache_bytes > CACHE_BYTES):
            _k, v = self._cache.popitem(last=False)
            self._cache_bytes -= len(v)

    def clear_cache(self) -> None:
        with self._cv:
            self._cache.clear()
            self._cache_bytes = 0

    # --- fronta -------------------------------------------------------------------------------

    def start_worker(self) -> None:
        """Pracovní vlákno (a v něm proces) — hned po startu aplikace, ať je první výpočet rychlý."""
        with self._cv:
            if self._thread is not None or self._closed:
                return
            self._thread = threading.Thread(target=self._loop, name="plcdesk-core-worker",
                                            daemon=True)
            self._thread.start()

    def fetch(self, op: str, *, wait: float | None = None, **payload):
        """Výsledek drahé operace: z cache, nebo z pracovního procesu, pokud do ``wait``
        (výchozí ``grace``) doběhne; jinak ``Pending`` s běžícím požadavkem."""
        key = self.key(op, payload)
        raw = self.cached(key)
        if raw is not None:
            return parse_response(raw)
        job = self.submit(op, payload, key=key)
        job.event.wait(self.grace if wait is None else wait)
        if job.state in ("done", "error"):
            return job.result()
        raise Pending(job)

    def submit(self, op: str, payload: dict, *, key: str | None = None, background: bool = False,
               preemptible: bool = True, cache: bool | None = None) -> Job:
        """Zařadí požadavek do fronty pracovního procesu (stejný požadavek se nezakládá dvakrát).

        ``background`` = nikdo na něj nečeká v okně (odznak): řadí se za požadavky kroků
        a nic neruší; ``preemptible=False`` = výslovná akce (emulace), novější krok ji neruší."""
        key = key or self.key(op, payload)
        cache = op not in NO_CACHE_OPS if cache is None else cache
        body = key.split("\x00", 3)[3]
        drop: list[Job] = []
        kill = False
        with self._cv:
            if self._closed:
                job = Job(0, op, key, body, background=background, preemptible=preemptible)
                job.state, job.reason = "cancelled", "closed"
                job.event.set()
                return job
            run = self._running
            for j in ([run] if run else []) + self._queue:
                if j.key == key and j.state in ("queued", "running"):
                    if not background:
                        j.background = False          # o výsledek teď stojí krok okna
                    return j
            self._seq += 1
            job = Job(self._seq, op, key, body, background=background, preemptible=preemptible,
                      cache=cache)
            if background:
                # odznak a podobné: platí jen poslední požadavek téže operace
                drop = [j for j in self._queue if j.background and j.op == op]
                self._queue = [j for j in self._queue if j not in drop]
                self._queue.append(job)
            else:
                # popředí: dřívější čekající požadavky, o které nikdo nestojí, zahodit
                drop = [j for j in self._queue if not j.background and j.preemptible
                        and not self.wanted(j)]
                self._queue = [j for j in self._queue if j not in drop]
                n = sum(1 for j in self._queue if not j.background)
                self._queue.insert(n, job)            # před požadavky na pozadí
                if run is not None and run.preemptible and not run.background \
                        and not self.wanted(run):
                    run.state, run.reason = "cancelled", "preempted"
                    kill = True
            for j in drop:
                j.state, j.reason = "cancelled", "preempted"
                j.t_end = time.monotonic()
                self._finished.append(j)
                j.event.set()
            self._cv.notify_all()
        if kill:
            self._bump()
            self.worker.kill()
        if self._thread is None:
            self.start_worker()
        return job

    def cancel(self, job: Job, reason: str = "user") -> None:
        """Zruší požadavek; běžící výpočet ukončí zabitím pracovního procesu."""
        kill = False
        with self._cv:
            if job.finished:
                return
            job.state, job.reason = "cancelled", reason
            if job in self._queue:
                self._queue.remove(job)
                job.t_end = time.monotonic()
                self._finished.append(job)
                job.event.set()
                self._cv.notify_all()
                return
            kill = job is self._running           # běží: dokončí ho pracovní vlákno
        if kill:
            self._bump()
            self.worker.kill()

    def running(self) -> Job | None:
        return self._running

    def active(self) -> bool:
        """Běží nebo čeká nějaký požadavek, nebo čeká hotový na vyzvednutí?"""
        with self._cv:
            return bool(self._running or self._queue or self._finished)

    def take_finished(self) -> list[Job]:
        """Hotové (i zrušené) požadavky od minula — volá hlavní vlákno."""
        with self._cv:
            out, self._finished = self._finished, []
        return out

    def _loop(self) -> None:
        try:                                          # proces nahodit hned, ne až s prvním výpočtem
            with self.worker._lock:
                if self.worker._proc is None and not self._closed:
                    self.worker.start()
                    self.worker._proc_lang = "cs"
        except BridgeError:
            pass                                      # ohlásí se u prvního požadavku
        while True:
            with self._cv:
                while not self._closed and not self._queue:
                    self._cv.wait()
                if self._closed:
                    return
                job = self._queue.pop(0)
                job.state, job.t_start = "running", time.monotonic()
                self._running = job
            raw, err = None, None
            try:
                raw = self.worker.request_raw(job.op, body=job.body)
                if not _ok_line(raw):
                    parse_response(raw)                 # vyhodí BridgeError s hláškou jádra
            except BridgeError as exc:
                raw, err = None, exc
            except Exception as exc:                    # noqa: BLE001 — vlákno nesmí spadnout
                raw, err = None, BridgeError(str(exc))
            with self._cv:
                self._running = None
                job.t_end = time.monotonic()
                if job.state != "cancelled":
                    if err is None:
                        job.state, job.raw = "done", raw
                        if job.op in NO_CACHE_OPS and job.op != "approval.badge":
                            self._bump()
                        if job.cache:
                            self._cache_put(job.key, raw)
                    else:
                        job.state, job.error = "error", err
                self._finished.append(job)
                job.event.set()

    # --- konec --------------------------------------------------------------------------------

    def close(self) -> None:
        """Zruší frontu, ukončí oba procesy a počká na pracovní vlákno (nanejvýš pár sekund)."""
        with self._cv:
            self._closed = True
            for j in self._queue + ([self._running] if self._running else []):
                if not j.finished:
                    j.state, j.reason = "cancelled", "closed"
                    j.event.set()
            self._queue.clear()
            self._cv.notify_all()
        self.worker.kill()
        th = self._thread
        if th is not None and th is not threading.current_thread():
            th.join(timeout=5)
        try:
            self.worker.close()
        finally:
            self.main.close()
