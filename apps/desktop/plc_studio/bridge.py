"""Most do jádra PLCdesk — trvalý proces Node s ``bridge.mjs``.

Protokol: jeden JSON požadavek na řádek → jedna JSON odpověď na řádek.
Volat jen z hlavního (Tk) vlákna; zámek je tu pro jistotu, ne pro souběh.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
from pathlib import Path

from .i18n import _

BRIDGE_JS = Path(__file__).resolve().parent.parent / "bridge.mjs"


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

    # --- volání ----------------------------------------------------------------

    def request(self, op: str, **payload):
        """Pošle operaci mostu a vrátí její ``result``."""
        with self._lock:
            if self._proc is None or self._proc.poll() is not None:
                self._stop()
                self.start()
                if self.lang != "cs" and op != "init":     # nový proces začíná česky
                    self._exchange("init", {"lang": self.lang})
            if op == "init":
                self.lang = payload.get("lang") or "cs"
            raw = self._exchange(op, payload)
        resp = json.loads(raw)
        if not resp.get("ok"):
            raise BridgeError(resp.get("error") or _("Neznámá chyba jádra."),
                              resp.get("code") or "")
        return resp.get("result")

    def _exchange(self, op: str, payload: dict) -> str:
        """Jeden požadavek → jedna odpověď (surový řádek JSON); volat se zámkem."""
        self._id += 1
        line = json.dumps({"id": self._id, "op": op, **payload})
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
