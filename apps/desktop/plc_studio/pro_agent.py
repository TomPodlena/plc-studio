"""PLCdesk PRO — 3D agent (prototyp, náhled).

Spouští **Claude Code CLI** v neinteraktivním režimu (``claude -p --output-format stream-json --verbose``)
ve složce 3D stroje s pokynem uživatele a pravidly role (Stavitel / Kontrolor K5 / Koncept). Výstup se čte
řádek po řádku ve vlákně do fronty (Tk sahá na frontu jen z hlavního vlákna přes ``after`` — krok
``steps/pro3d.py``); ``parse_event`` převádí události stream-json na čitelné řádky logu.

Zastavit = ukončit JEN vlastní proces (a jeho potomky: ``taskkill /T`` nad vlastním PID). FreeCAD se otevírá
přes spouštěč vlastní instance ze skillu ``freecad-instance`` (``run_fc.ps1 gui-start / gui-run``, slot
``plcdesk-pro``) — cizí instance FreeCADu se nikdy nezavírají.

Agent spotřebovává tarif uživatele (Claude) — krok se před spuštěním ptá. Prompt agenta je česky (jako prompt
AI návrháře), jazyk odpovědí řídí pokyn uživatele.

TODO(PRO licence): krok zatím zapíná jen ``settings.json`` ``pro_preview: true`` nebo ``PLCDESK_PRO=1``;
po zavedení licence PRO (nárok ``cad3d`` / ``product: "pro"``) ho podmínit licencí.
"""

from __future__ import annotations

import json
import os
import queue
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

from .i18n import N_, _

FC_SLOT = "plcdesk-pro"
HOME = Path(os.path.expanduser("~"))
SKILLS_DIR = HOME / ".claude" / "skills"
SKILL_REFS = ("automatizacni-technika", "alutech-profily", "rozvadec-3d", "ramy-a-kryty", "freecad-instance")

# --- role ---------------------------------------------------------------------------------------------

COMMON_RULES = """Pracuješ jako 3D agent aplikace PLCdesk PRO ve složce 3D stroje (aktuální adresář).
Závazná pravidla (porušení = práce se vrací):
1. FreeCAD spouštěj JEN ve vlastní instanci přes skill freecad-instance (run_fc.ps1, slot {slot}); cizí instance FreeCADu
   ani cizí procesy nikdy nezavírej; po práci své GUI zavři (gui-stop).
2. Sestavy: App::Part pro díl / celek, opakované díly jako App::Link (žádné kopie těles).
3. Zástupné díly (bez modelu výrobce) barvi oranžově a pojmenuj je tak, aby bylo vidět, že jsou zástupné.
4. Kolize jsou povolené JEN šroub × díra / drážka / závit a matice × drážka profilu. Jakýkoli jiný průnik hmot je chyba.
5. Nic ve vzduchu: každý díl má nosnou vazbu (dosedá, je přišroubovaný, visí na profilu) — ověř měřením, ne odhadem.
6. Po každé stavbě udělej snímky (iso, půdorys, čelo) a PROHLÉDNI je dřív, než ohlásíš výsledek; při rozporu platí obrázek.
7. PLCdesk je zdroj pravdy kusovníku: neshodu (malá skříň, chybějící díl, jiný počet, nevhodný typ) NEopravuj ve 3D potichu —
   zapiš ji jako zpětnou vazbu PLCdesk_CAD_feedback.json (formát plcdesk-cad-feedback v1) a uživatel ji rozhodne v PLCdesk.
8. Modely výrobců nestahuj skripty z 3Dfindit / CADENAS (podmínky to zakazují) — jen ručně, z portálů výrobců, jinak zástupný díl.
9. Bezpečnostní prvky a funkce jen jako návrh ke schválení odpovědnou osobou, nikdy jako hotové řešení.
10. Hotovo je až po kontrole K5 JINOU rolí (Kontrolor K5); do té doby výsledek označ jako „ke kontrole“.
11. Stav práce průběžně zapisuj do STAV.md (co je hotové, co zbývá, otevřené otázky na uživatele).
12. Průběh pro ukazatel v aplikaci: hned na začátku vypiš samostatný řádek „PRŮBĚH 0/N: plán“ (N = počet kroků tvého plánu)
   a po dokončení každého kroku řádek „PRŮBĚH k/N: <co je hotové>“ (N smíš upravit, když se plán změní).
Skilly k použití podle potřeby: {skills}."""

ROLE_RULES = {
    "builder": """Role: STAVITEL. Stavíš a upravuješ 3D model stroje podle pokynu uživatele, manifestu PLCdesk_CAD.json
(kusovník, umístění, vazby, zadání) a předchozích kontrol KONTROLA_K5_*.md (povinné body z poslední kontroly řeš přednostně).
Nové verze ukládej do FCStd ve složce stroje, snímky do podsložky snimky/. Na konci shrň, co se změnilo, a navrhni kontrolu K5.""",
    "k5": """Role: KONTROLOR K5. Model NEMĚNÍŠ (žádné úpravy FCStd). Převezmi poslední práci stavitele a nezávisle ji zkontroluj:
průniky hmot (kromě povolených), nic ve vzduchu, rozměry a hmotnosti proti zadání a manifestu PLCdesk_CAD.json, kusovník 3D
× PLCdesk, App::Part / App::Link, zástupné díly oranžově, bezpečné vzdálenosti krytů, snímky (sám je udělej a prohlédni).
Výsledek zapiš do nového souboru KONTROLA_K5_<předmět>_kolo<N>.md s řádkem „## Verdikt: **SCHVÁLENO**“ nebo
„## Verdikt: **VRÁCENO** staviteli“ a očíslovaným seznamem povinných bodů. Neshody kusovníku zapiš jako zpětnou vazbu pro PLCdesk.""",
    "concept": """Role: KONCEPT. Z manifestu PLCdesk_CAD.json (zadání, zařízení, sekvence, bezpečnost) a pokynu uživatele navrhni hrubý
koncept stroje z obálek (rozvaděč, rám, polní prvky, obsluha, kryty) — 2 až 3 varianty se zdůvodněním, otázky na chybějící
údaje a doporučení. Model postav jen z jednoduchých obálek (žádné detaily), snímky ulož do snimky/ a koncept zapiš do KONCEPT.md.""",
}

ROLES = (("builder", N_("Stavitel")), ("k5", N_("Kontrolor K5")), ("concept", N_("Koncept")))
ROLE_TIPS = {
    "builder": N_("Staví a upravuje model ve FreeCADu podle pokynu, manifestu a poslední kontroly K5."),
    "k5": N_("Model nemění: nezávisle zkontroluje poslední práci a zapíše KONTROLA_K5_*.md s verdiktem."),
    "concept": N_("Hrubý koncept stroje z obálek: varianty, otázky na chybějící údaje, KONCEPT.md."),
}
# povolené nástroje CLI podle role (Kontrolor smí psát jen protokol — FCStd ho pravidla nechávají číst)
ROLE_TOOLS = {
    "builder": ["Read", "Write", "Edit", "Glob", "Grep", "Skill", "Bash", "PowerShell"],
    "k5": ["Read", "Write", "Glob", "Grep", "Skill", "Bash", "PowerShell"],
    "concept": ["Read", "Write", "Edit", "Glob", "Grep", "Skill", "Bash", "PowerShell"],
}


def system_prompt(role: str) -> str:
    """Pravidla role pro ``--append-system-prompt`` (česky, jako prompt AI návrháře)."""
    if role not in ROLE_RULES:
        raise ValueError(role)
    return COMMON_RULES.format(slot=FC_SLOT, skills=", ".join(SKILL_REFS)) + "\n\n" + ROLE_RULES[role]


def build_prompt(role: str, instruction: str, folder: str | Path, project: str = "") -> str:
    """Zpráva agentovi: kontext (projekt, složka, role) + pokyn uživatele."""
    label = dict(ROLES)[role]
    head = [f"Projekt PLCdesk: {project}" if project else "", f"Složka 3D stroje: {folder}", f"Role: {label}"]
    text = instruction.strip() or "Pokračuj podle STAV.md a poslední kontroly K5."
    return "\n".join(x for x in head if x) + "\n\nPokyn uživatele:\n" + text


def build_command(exe: str | Path, role: str, *, model: str = "", budget: float | None = None,
                  add_dirs: list[str | Path] | None = None) -> list[str]:
    """Příkaz Claude Code CLI (headless). Pokyn jde na stdin (``-p`` bez argumentu) — dlouhý text by
    přetekl příkazovou řádku Windows."""
    cmd = [str(exe), "-p", "--output-format", "stream-json", "--verbose",
           "--permission-mode", "acceptEdits",
           "--allowedTools", ",".join(ROLE_TOOLS[role]),
           "--append-system-prompt", system_prompt(role)]
    for d in add_dirs if add_dirs is not None else [SKILLS_DIR]:
        cmd += ["--add-dir", str(d)]
    if model.strip():
        cmd += ["--model", model.strip()]
    if budget is not None and budget > 0:
        cmd += ["--max-budget-usd", f"{budget:g}"]
    return cmd


# --- hledání nástrojů ------------------------------------------------------------------------------------

def find_claude() -> Path | None:
    """Claude Code CLI: ``PLCDESK_CLAUDE``, PATH, ``~/.local/bin/claude.exe``."""
    env = os.environ.get("PLCDESK_CLAUDE")
    cands = [Path(env)] if env else []
    w = shutil.which("claude")
    if w:
        cands.append(Path(w))
    cands += [HOME / ".local" / "bin" / "claude.exe", HOME / ".local" / "bin" / "claude"]
    return next((c for c in cands if c.is_file()), None)


def find_freecad() -> Path | None:
    """FreeCAD 1.1 GUI: ``PLCDESK_FREECAD``, uživatelská instalace, Program Files."""
    env = os.environ.get("PLCDESK_FREECAD")
    cands = [Path(env)] if env else []
    local = Path(os.environ.get("LOCALAPPDATA") or HOME / "AppData" / "Local")
    for base in (local / "Programs", Path(os.environ.get("ProgramFiles") or r"C:\Program Files")):
        cands.append(base / "FreeCAD 1.1" / "bin" / "freecad.exe")
    return next((c for c in cands if c.is_file()), None)


def find_run_fc() -> Path | None:
    """Spouštěč vlastní instance FreeCADu (skill freecad-instance)."""
    p = SKILLS_DIR / "freecad-instance" / "run_fc.ps1"
    return p if p.is_file() else None


# --- stav stroje ----------------------------------------------------------------------------------------

_VERDICT = re.compile(r"^#+\s*Verdikt\s*:?\s*(.+)$", re.IGNORECASE | re.MULTILINE)


def _walk(folder: Path, depth: int = 4, limit: int = 20000):
    """Soubory složky do hloubky ``depth`` (bez skrytých a záložních složek), nejvýš ``limit`` položek."""
    base = len(folder.parts)
    n = 0
    for root, dirs, files in os.walk(folder):
        if len(Path(root).parts) - base >= depth:
            dirs[:] = []
        dirs[:] = [d for d in dirs if not d.startswith((".", "__"))]
        for f in files:
            n += 1
            if n > limit:
                return
            yield Path(root) / f


def machine_state(folder: str | Path, shots: int = 6) -> dict:
    """Stav složky 3D stroje: verdikt poslední kontroly K5, začátek STAV*.md, modely FCStd, poslední snímky PNG."""
    folder = Path(folder)
    out = {"exists": folder.is_dir(), "verdict": "", "verdictFile": "", "stav": "", "stavFile": "",
           "models": [], "shots": []}
    if not out["exists"]:
        return out
    k5, stav, models, pngs = [], [], [], []
    for p in _walk(folder):
        name = p.name.lower()
        try:
            if name.endswith(".fcstd"):
                models.append((p.stat().st_mtime, p))
            elif name.endswith(".png"):
                pngs.append((p.stat().st_mtime, p))
            elif name.endswith(".md") and name.startswith("kontrola_k5"):
                k5.append((p.stat().st_mtime, p))
            elif name.endswith(".md") and name.startswith("stav"):
                stav.append((p.stat().st_mtime, p))
        except OSError:
            continue
    if k5:
        p = max(k5)[1]
        out["verdictFile"] = str(p)
        m = _VERDICT.search(_read(p))
        out["verdict"] = m.group(1).replace("**", "").strip() if m else ""
    if stav:
        p = max(stav)[1]
        out["stavFile"] = str(p)
        out["stav"] = "\n".join(_read(p).strip().splitlines()[:12])
    out["models"] = [str(p) for _t, p in sorted(models, reverse=True)]
    out["shots"] = [str(p) for _t, p in sorted(pngs, reverse=True)[:shots]]
    return out


def verdict_kind(verdict: str) -> str:
    """``ok`` (schváleno) / ``back`` (vráceno) / ``""`` podle textu verdiktu."""
    v = verdict.upper()
    if "VRÁCENO" in v or "VRACENO" in v or "RETURNED" in v:
        return "back"
    if "SCHVÁLENO" in v or "SCHVALENO" in v or "APPROVED" in v:
        return "ok"
    return ""


def _read(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


# --- stream-json → řádky logu -----------------------------------------------------------------------------

def _short(v, n: int = 160) -> str:
    s = v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)
    s = " ".join(s.split())
    return s if len(s) <= n else s[:n - 1] + "…"


def _tool_arg(name: str, inp: dict) -> str:
    for k in ("command", "file_path", "path", "pattern", "skill", "url", "description", "prompt"):
        if isinstance(inp.get(k), str) and inp[k].strip():
            return _short(inp[k], 120)
    return _short(inp, 120) if inp else ""


PROGRESS_RE = re.compile(r"^\s*PR[ŮU]B[ĚE]H\s+(\d+)\s*/\s*(\d+)\s*:?\s*(.*)$", re.MULTILINE | re.IGNORECASE)


def parse_event(line: str) -> list[tuple[str, str]]:
    """Jedna řádka stream-json → seznam (druh, text) pro log: ``info``, ``text``, ``tool``, ``result``,
    ``error``, ``done``. Neznámé / neplatné řádky se ukážou jako ``info`` (nic se nezahodí potichu)."""
    line = line.strip()
    if not line:
        return []
    try:
        ev = json.loads(line)
    except ValueError:
        return [("info", _short(line, 300))]
    if not isinstance(ev, dict):
        return [("info", _short(line, 300))]
    t = ev.get("type")
    if t == "system":
        if ev.get("subtype") == "init":
            return [("info", _("Agent spuštěn (model {model}, složka {cwd}).",
                               model=ev.get("model") or "?", cwd=ev.get("cwd") or "?"))]
        return []
    if t in ("assistant", "user"):
        out: list[tuple[str, str]] = []
        content = (ev.get("message") or {}).get("content") or []
        if isinstance(content, str):
            content = [{"type": "text", "text": content}]
        for c in content:
            if not isinstance(c, dict):
                continue
            ct = c.get("type")
            if ct == "text" and t == "assistant" and str(c.get("text", "")).strip():
                txt = str(c["text"]).strip()
                out.extend(("progress", f"{m.group(1)}/{m.group(2)} {m.group(3).strip()}")
                           for m in PROGRESS_RE.finditer(txt))
                out.append(("text", txt))
            elif ct == "tool_use":
                name = str(c.get("name") or "?")
                arg = _tool_arg(name, c.get("input") or {})
                out.append(("tool", f"{name}: {arg}" if arg else name))
            elif ct == "tool_result":
                res = c.get("content")
                if isinstance(res, list):
                    res = " ".join(str(x.get("text", "")) for x in res if isinstance(x, dict))
                kind = "error" if c.get("is_error") else "result"
                out.append((kind, _short(res or "", 200) or "—"))
        return out
    if t == "result":
        usage = ev.get("usage") or {}
        parts = []
        cost = ev.get("total_cost_usd")
        if isinstance(cost, (int, float)):
            parts.append(_("cena {cost} USD", cost=f"{cost:.4f}"))
        tin = sum(int(usage.get(k) or 0) for k in ("input_tokens", "cache_creation_input_tokens",
                                                       "cache_read_input_tokens"))
        tout = int(usage.get("output_tokens") or 0)
        if tin or tout:
            parts.append(_("tokeny vstup {inp} / výstup {out}", inp=tin, out=tout))
        if ev.get("num_turns"):
            parts.append(_("kol {n}", n=ev["num_turns"]))
        if isinstance(ev.get("duration_ms"), (int, float)):
            parts.append(_("{s} s", s=round(ev["duration_ms"] / 1000)))
        ok = ev.get("subtype") == "success" and not ev.get("is_error")
        head = _("Hotovo") if ok else _("Skončeno s chybou ({kind})", kind=ev.get("subtype") or "?")
        return [("done", head + (": " + ", ".join(parts) if parts else ""))]
    return []


# --- běh agenta ---------------------------------------------------------------------------------------------

def kill_tree(pid: int) -> bool:
    """Ukončí proces ``pid`` a jeho potomky — nic jiného (Windows ``taskkill /T /F`` nad tímto PID)."""
    if sys.platform == "win32":
        r = subprocess.run(["taskkill", "/PID", str(int(pid)), "/T", "/F"], capture_output=True,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return r.returncode == 0
    import signal
    try:
        os.killpg(os.getpgid(pid), signal.SIGTERM)
        return True
    except OSError:
        return False


class AgentRun:
    """Jeden běh agenta: proces CLI, vlákno čtení stdout → ``queue`` (druh, text), řádky logu v ``lines``.

    Tk z vlákna nevolat — krok vybírá frontu přes ``drain()`` v ``after``."""

    def __init__(self, cmd: list[str], prompt: str, cwd: str | Path, *, role: str = "builder") -> None:
        self.cmd, self.prompt, self.cwd, self.role = cmd, prompt, str(cwd), role
        self.queue: queue.Queue = queue.Queue()
        self.lines: list[tuple[str, str]] = []
        self.proc: subprocess.Popen | None = None
        self.state = "new"                    # new / running / done / stopped / failed
        self._thread: threading.Thread | None = None
        # průběh pro ukazatel: krok k/N z řádků „PRŮBĚH k/N: …“, počet akcí, poslední akce, začátek běhu
        self.step = (0, 0, "")
        self.tools = 0
        self.last = ""
        self.t0: float | None = None

    def start(self, popen=subprocess.Popen) -> None:
        kw = {}
        if sys.platform == "win32":
            kw["creationflags"] = (getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
                                   | getattr(subprocess, "CREATE_NO_WINDOW", 0))
        else:
            kw["start_new_session"] = True
        self.proc = popen(self.cmd, cwd=self.cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                          stderr=subprocess.STDOUT, encoding="utf-8", errors="replace", bufsize=1, **kw)
        self.state = "running"
        self.t0 = time.monotonic()
        self._thread = threading.Thread(target=self._pump, daemon=True)
        self._thread.start()

    def _pump(self) -> None:
        p = self.proc
        try:
            if p.stdin is not None:
                p.stdin.write(self.prompt)
                p.stdin.close()
            for raw in p.stdout:
                for item in parse_event(raw):
                    self.queue.put(item)
            code = p.wait()
        except Exception as exc:  # noqa: BLE001 — chyba čtení se ukáže v logu
            self.queue.put(("error", str(exc)))
            code = -1
        if self.state == "running":
            self.state = "done" if code == 0 else "failed"
            if code:
                self.queue.put(("error", _("Proces agenta skončil s kódem {code}.", code=code)))
        self.queue.put(("end", self.state))

    def drain(self) -> list[tuple[str, str]]:
        """Nové řádky z fronty (hlavní vlákno)."""
        new = []
        while True:
            try:
                new.append(self.queue.get_nowait())
            except queue.Empty:
                break
        for kind, text in new:
            if kind == "progress":
                m = re.match(r"(\d+)/(\d+)\s*(.*)", text)
                if m:
                    self.step = (int(m.group(1)), int(m.group(2)), m.group(3))
            elif kind == "tool":
                self.tools += 1
                self.last = text
        self.lines.extend(x for x in new if x[0] not in ("end", "progress"))
        return new

    def elapsed(self) -> float:
        return time.monotonic() - self.t0 if self.t0 is not None else 0.0

    def running(self) -> bool:
        return self.state == "running" and self.proc is not None and self.proc.poll() is None

    def stop(self, kill=kill_tree) -> bool:
        """Zastaví JEN vlastní proces agenta (a jeho potomky)."""
        if self.proc is None or self.proc.poll() is not None:
            return False
        self.state = "stopped"
        ok = kill(self.proc.pid)
        self.queue.put(("info", _("Agent zastaven (PID {pid}).", pid=self.proc.pid)))
        return ok


# --- FreeCAD -------------------------------------------------------------------------------------------------

_OPEN_SCRIPT = """import sys
import FreeCAD as App
import FreeCADGui as Gui
doc = App.openDocument(sys.argv[1])
Gui.activeDocument().activeView().viewIsometric()
Gui.SendMsgToActiveView("ViewFit")
FC_RESULT["opened"] = doc.Name
"""


def freecad_commands(run_fc: str | Path, model: str | Path, script: str | Path, max_min: int = 240) -> list[list[str]]:
    """Příkazy pro otevření modelu ve vlastní instanci (slot ``plcdesk-pro``): gui-start, pak gui-run."""
    ps = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(run_fc)]
    return [ps + ["gui-start", "--slot", FC_SLOT, "--max-min", str(max_min)],
            ps + ["gui-run", "--slot", FC_SLOT, "--timeout", "300", str(script), str(model)]]


def open_in_freecad(model: str | Path, done=None, run=subprocess.run) -> threading.Thread | None:
    """Otevře model ve vlastní instanci FreeCADu na pozadí (vlákno). ``done(ok, text)`` se volá z vlákna —
    volající si výsledek předá do Tk sám (fronta / ``after``). Bez spouštěče vrátí None."""
    run_fc = find_run_fc()
    if run_fc is None:
        return None
    script = Path(tempfile.gettempdir()) / "plcdesk_pro_open_fc.py"
    script.write_text(_OPEN_SCRIPT, encoding="utf-8")

    def work() -> None:
        text, ok = "", True
        for cmd in freecad_commands(run_fc, model, script):
            r = run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace",
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            text += (r.stdout or "") + (r.stderr or "")
            if r.returncode != 0:
                ok = False
                break
        if done:
            done(ok, text.strip())

    t = threading.Thread(target=work, daemon=True)
    t.start()
    return t
