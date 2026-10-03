"""Sestaví přenosnou verzi PLCdesk pro Windows 10/11 x64 (bez instalace Pythonu i Node).

Spouštět Pythonem, jehož runtime se má přibalit (na vývojové stanici Python311)::

    python apps/desktop/scripts/build_portable.py [--out SLOŽKA] [--node CESTA]

Výsledek ``<out>/PLCdesk-<verze>/`` a ``<out>/PLCdesk-<verze>-portable.zip``::

    PLCdesk.vbs, PLCdesk.bat     spouštěče (vbs bez konzole)
    README.txt                   cs + en
    licenses/                    Python (PSF), Node.js (MIT), Tcl/Tk (BSD)
    runtime/python/              zeštíhlený CPython (+ python311._pth: izolovaný, bez site-packages)
    runtime/node/node.exe
    app/                         stejná relativní struktura jako repo (importy bridge.mjs platí):
        package.json             {"type": "module"} pro apps/web/src
        apps/desktop/            plc_studio, bridge.mjs, PLCStudio.pyw
        apps/web/src/            jen soubory, které most importuje (dohledáno z importů)
        packages/core/           package.json + dist (bez testů a .d.ts)
        samples/

Most najde přibalený Node sám (``bridge.find_node``: PLCDESK_NODE → runtime/node → PATH).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DESKTOP = REPO / "apps" / "desktop"
DEFAULT_OUT = Path(r"C:\Users\podlenat\.claude\jobs\3501689b\tmp\portable")
NODE_LICENSE_URL = "https://raw.githubusercontent.com/nodejs/node/{ver}/LICENSE"


def app_version() -> str:
    txt = (DESKTOP / "plc_studio" / "__init__.py").read_text(encoding="utf-8")
    return re.search(r'__version__\s*=\s*"([^"]+)"', txt).group(1)


# --------------------------------------------------------------- Python runtime

PY_FILES = ["python.exe", "pythonw.exe", "python3.dll", "LICENSE.txt"]
PY_DLL_SKIP = re.compile(r"^(_test.*|_ctypes_test|_sqlite3|sqlite3|_msi|winsound)\.(pyd|dll)$", re.I)
LIB_SKIP_DIRS = {"site-packages", "test", "tests", "idlelib", "ensurepip", "lib2to3", "turtledemo",
                 "pydoc_data", "msilib", "distutils", "sqlite3", "venv", "curses", "__pycache__",
                 "__phello__"}
LIB_SKIP_FILES = re.compile(r"(\.(pyc|pyo|dll|lib|jl|exe|pdb)$)|^(__hello__|antigravity|this|turtle)\.py$", re.I)


def copy_tree(src: Path, dst: Path, skip_dir=lambda p: False, skip_file=lambda p: False) -> None:
    for root, dirs, files in os.walk(src):
        r = Path(root)
        dirs[:] = [d for d in dirs if not skip_dir(r / d)]
        out = dst / r.relative_to(src)
        out.mkdir(parents=True, exist_ok=True)
        for f in files:
            if not skip_file(r / f):
                shutil.copy2(r / f, out / f)


def build_python(dst: Path) -> None:
    py = Path(sys.base_prefix)
    ver = f"{sys.version_info.major}{sys.version_info.minor}"
    dst.mkdir(parents=True)
    for name in PY_FILES + [f"python{ver}.dll"] + [p.name for p in py.glob("vcruntime*.dll")]:
        shutil.copy2(py / name, dst / name)
    (dst / "DLLs").mkdir()
    for p in (py / "DLLs").iterdir():
        if p.suffix.lower() in (".pyd", ".dll") and not PY_DLL_SKIP.match(p.name):
            shutil.copy2(p, dst / "DLLs" / p.name)
    copy_tree(py / "Lib", dst / "Lib",
              skip_dir=lambda p: p.name in LIB_SKIP_DIRS or p.name == "idle_test",
              skip_file=lambda p: bool(LIB_SKIP_FILES.search(p.name)))
    # Tcl/Tk: knihovny skriptů (tcl8 = msgcat a spol., které Tk potřebuje), bez dem
    for sub in ("tcl8", "tcl8.6", "tk8.6"):
        copy_tree(py / "tcl" / sub, dst / "tcl" / sub, skip_dir=lambda p: p.name == "demos")
    # izolovaný režim: jen tyto cesty, bez site (žádné site-packages ani uživatelské balíčky,
    # PYTHONPATH/PYTHONHOME se ignorují); aplikace je na cestě, takže `-m plc_studio` jde odkudkoli
    (dst / f"python{ver}._pth").write_text("Lib\nDLLs\n..\\..\\app\\apps\\desktop\n", encoding="ascii")


# ----------------------------------------------------------------- Node runtime

def find_node_exe(arg: str | None) -> Path:
    for c in [arg, os.environ.get("PLCDESK_NODE"), shutil.which("node"),
              os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "nodejs", "node.exe")]:
        if c and Path(c).is_file():
            return Path(c)
    raise SystemExit("node.exe nenalezen (--node)")


def node_license(node: Path, cache: Path) -> bytes:
    for p in (node.parent / "LICENSE", node.parent / "LICENSE.txt"):
        if p.is_file():
            return p.read_bytes()
    import subprocess
    ver = subprocess.run([str(node), "-v"], capture_output=True, text=True, check=True).stdout.strip()
    cached = cache / f"node-{ver}-LICENSE"
    if not cached.is_file():
        cache.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(NODE_LICENSE_URL.format(ver=ver), timeout=60) as r:
            cached.write_bytes(r.read())
    return cached.read_bytes()


# ------------------------------------------------------------------------ app

IMPORT_RE = re.compile(r"""(?:^|[\s;])(?:import|export)\b[^'"]*?\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']""", re.M)


def js_closure(entry: Path) -> set[Path]:
    """Soubory, které ``entry`` (ESM) relativně importuje — tranzitivně."""
    seen: set[Path] = set()
    todo = [entry.resolve()]
    while todo:
        f = todo.pop()
        if f in seen:
            continue
        seen.add(f)
        for m in IMPORT_RE.finditer(f.read_text(encoding="utf-8")):
            spec = m.group(1) or m.group(2)
            if spec.startswith("."):
                t = (f.parent / spec).resolve()
                if not t.is_file():
                    raise SystemExit(f"{f}: import {spec} nenalezen")
                todo.append(t)
    return seen


def build_app(dst: Path) -> None:
    dst.mkdir(parents=True, exist_ok=True)
    (dst / "package.json").write_text(json.dumps({"private": True, "type": "module"}, indent=2) + "\n",
                                      encoding="utf-8")
    d = dst / "apps" / "desktop"
    copy_tree(DESKTOP / "plc_studio", d / "plc_studio",
              skip_dir=lambda p: p.name == "__pycache__",
              skip_file=lambda p: p.suffix == ".pyc" or p.name == "make_icon.py")
    for name in ("bridge.mjs", "PLCStudio.pyw"):
        shutil.copy2(DESKTOP / name, d / name)
    core = REPO / "packages" / "core"
    (dst / "packages" / "core").mkdir(parents=True)
    shutil.copy2(core / "package.json", dst / "packages" / "core" / "package.json")
    copy_tree(core / "dist", dst / "packages" / "core" / "dist",
              skip_file=lambda p: p.name.endswith((".d.ts", ".map")) or ".test." in p.name)
    # z apps/web jen to, co most opravdu importuje
    for f in js_closure(DESKTOP / "bridge.mjs"):
        rel = f.relative_to(REPO)
        if rel.parts[:2] == ("apps", "web"):
            (dst / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, dst / rel)
    copy_tree(REPO / "samples", dst / "samples")


# ------------------------------------------------------------------- spouštěče

VBS = r'''' PLCdesk - spoustec bez konzole (prenosna verze)
Option Explicit
Dim sh, fso, root, env, args, i
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
Set env = sh.Environment("Process")
env("PLCDESK_NODE") = root & "\runtime\node\node.exe"
env("PATH") = root & "\runtime\node;" & env("PATH")
env("PYTHONHOME") = ""
env("PYTHONPATH") = ""
args = ""
For i = 0 To WScript.Arguments.Count - 1
  args = args & " """ & WScript.Arguments(i) & """"
Next
sh.CurrentDirectory = root & "\app\apps\desktop"
sh.Run """" & root & "\runtime\python\pythonw.exe"" """ & root & "\app\apps\desktop\PLCStudio.pyw""" & args, 1, False
'''

BAT = r'''@echo off
rem PLCdesk - prenosna verze. Bez konzole spoustej PLCdesk.vbs; tento soubor je zalozni
rem (napr. "PLCdesk.bat --smoke" vypise vysledek kontroly do konzole).
setlocal
set "ROOT=%~dp0"
set "PLCDESK_NODE=%ROOT%runtime\node\node.exe"
set "PATH=%ROOT%runtime\node;%PATH%"
set "PYTHONHOME="
set "PYTHONPATH="
cd /d "%ROOT%app\apps\desktop"
if "%~1"=="--smoke" (
  "%ROOT%runtime\python\python.exe" -m plc_studio %*
) else (
  start "" "%ROOT%runtime\python\pythonw.exe" "%ROOT%app\apps\desktop\PLCStudio.pyw" %*
)
'''

README = """PLCdesk {ver} - prenosna verze pro Windows 10/11 (64bit)
=========================================================

CESKY
-----
Spusteni
  Rozbalte ZIP do libovolne slozky (napr. Dokumenty\\PLCdesk) a spustte
  PLCdesk.vbs (dvojklik). Instalace ani administratorska prava nejsou potreba;
  Python i Node.js jsou pribalene ve slozce runtime\\.
  Zastupce na plose: pravym tlacitkem na PLCdesk.vbs > Odeslat > Plocha.
  PLCdesk.bat je zalozni spoustec; "PLCdesk.bat --smoke" projde vsechny kroky
  aplikace a vypise vysledek (kontrola instalace).

Data uzivatele
  Rozpracovany navrh, nastaveni a logy: %APPDATA%\\PLCStudio
  (presmeruje promenna prostredi PLCSTUDIO_HOME). Projekty se ukladaji tam,
  kam je ulozite (soubory *.plcstudio.json). V settings.json je API klic AI
  v citelne podobe - nesdilejte ho.

Odinstalace
  Smazte slozku aplikace. Pokud chcete smazat i data, smazte %APPDATA%\\PLCStudio.

Vyhrada
  Vse, co aplikace vytvori (kod, schemata, dokumentace, bezpecnostni funkce),
  je NAVRH K REVIZI. Plati jen polozky schvalene odpovednou osobou.
  Simulace overuje navrh, ne kod v cilovem IDE. Validaci na stroji
  (EN ISO 13849-2) provadi clovek.

AI navrh
  Volitelne; vyzaduje vlastni klic Anthropic API (placene dotazy, aplikace
  pred odeslanim ukaze odhad ceny).

ENGLISH
-------
Start
  Unzip anywhere (e.g. Documents\\PLCdesk) and double-click PLCdesk.vbs.
  No installation or admin rights required; Python and Node.js are bundled
  in runtime\\. PLCdesk.bat is a fallback launcher; "PLCdesk.bat --smoke"
  walks through all steps and prints the result (installation check).

User data
  Work in progress, settings and logs: %APPDATA%\\PLCStudio
  (override with the PLCSTUDIO_HOME environment variable). settings.json
  stores the AI API key in plain text - do not share it.

Uninstall
  Delete the application folder; optionally delete %APPDATA%\\PLCStudio.

Disclaimer
  Everything the application produces (code, drawings, documentation,
  safety functions) is a DRAFT FOR REVIEW. Only items approved by a
  responsible person are valid. Simulation verifies the design, not the
  code in the target IDE. Validation on the machine (EN ISO 13849-2) is
  performed by a person.

THIRD-PARTY LICENSES / LICENCE TRETICH STRAN (licenses\\)
  Python {pyver}   - Python Software Foundation License (PYTHON_LICENSE.txt)
  Node.js {nodever} - MIT License (NODE_LICENSE.txt, incl. bundled dependencies)
  Tcl/Tk 8.6      - BSD-style license (TCL_TK_LICENSE.txt)

(c) PearTec
"""


def write_launchers(root: Path, ver: str, nodever: str) -> None:
    pyver = ".".join(map(str, sys.version_info[:3]))
    (root / "PLCdesk.vbs").write_text(VBS.replace("\n", "\r\n"), encoding="ascii")
    (root / "PLCdesk.bat").write_text(BAT.replace("\n", "\r\n"), encoding="ascii")
    (root / "README.txt").write_text(
        README.format(ver=ver, pyver=pyver, nodever=nodever).replace("\n", "\r\n"), encoding="ascii")


# ------------------------------------------------------------------------ main

def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--node", help="cesta k node.exe (jinak PLCDESK_NODE / PATH / Program Files)")
    args = ap.parse_args()
    if os.name != "nt" or sys.maxsize < 2**32:
        raise SystemExit("Sestavovat na Windows x64 (64bit Python).")

    ver = app_version()
    name = f"PLCdesk-{ver}"
    out: Path = args.out
    root = out / name
    if root.exists():
        shutil.rmtree(root)
    root.mkdir(parents=True)

    print("python runtime ...")
    build_python(root / "runtime" / "python")
    print("node runtime ...")
    node = find_node_exe(args.node)
    import subprocess
    nodever = subprocess.run([str(node), "-v"], capture_output=True, text=True, check=True).stdout.strip()
    (root / "runtime" / "node").mkdir(parents=True)
    shutil.copy2(node, root / "runtime" / "node" / "node.exe")
    lic = root / "licenses"
    lic.mkdir()
    (lic / "NODE_LICENSE.txt").write_bytes(node_license(node, out / "_cache"))
    (root / "runtime" / "node" / "LICENSE").write_bytes((lic / "NODE_LICENSE.txt").read_bytes())
    shutil.copy2(Path(sys.base_prefix) / "LICENSE.txt", lic / "PYTHON_LICENSE.txt")
    shutil.copy2(Path(sys.base_prefix) / "tcl" / "tk8.6" / "license.terms", lic / "TCL_TK_LICENSE.txt")
    print("app ...")
    build_app(root / "app")
    write_launchers(root, ver, nodever)

    zpath = out / f"{name}-portable.zip"
    if zpath.exists():
        zpath.unlink()
    print("zip ...")
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for p in sorted(root.rglob("*")):
            if p.is_file():
                z.write(p, p.relative_to(out).as_posix())
    raw = sum(p.stat().st_size for p in root.rglob("*") if p.is_file())
    size = zpath.stat().st_size
    print(f"{zpath}\n  rozbaleno {raw / 2**20:.1f} MB, ZIP {size / 2**20:.1f} MB ({size} B)\n"
          f"  SHA-256 {sha256(zpath)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
