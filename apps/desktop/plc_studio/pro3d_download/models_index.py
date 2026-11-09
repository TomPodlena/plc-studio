"""models/index.json — evidence modelů dílů projektu (vstup pro stavbu ve FreeCADu a pro FreeCAD PLM).

Složka models/ je přenositelná celá (např. do projektové složky PLCdesk 02_Vykresy\3D\models):
všechny cesty v indexu jsou relativní k adresáři, kde index.json leží, oddělovač "/".

  models/
    index.json
    3dfindit/<partId-safe>.stp          stažené modely (STEP AP214)
    placeholders/<partId-safe>.stp      zástupné modely (+ .FCStd)
    placeholders/<partId-safe>.FCStd

Formát (verze 1) — viz README.md, oddíl „models/index.json“.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

FORMAT = "plcdesk-models-index"
VERSION = 1
CADENAS_TERMS = {
    "source": "3Dfindit.com (CADENAS GmbH)",
    "url": "https://www.cadenas.de/terms-of-use-3d-cad-models",
    "summary": ("Modely jen pro tento projekt (uložení k projektu / do PLM povoleno). "
                "Zakázáno budovat z nich vlastní sdílenou databázi modelů a používat je k trénování AI. "
                "Fair use 50 stažení / den."),
}


def safe_name(part_id: str) -> str:
    """'-Y1:valve_solenoid' -> 'Y1_valve_solenoid' (bezpečné jméno souboru, stabilní)."""
    s = re.sub(r"[^\w.\-]+", "_", part_id, flags=re.ASCII).strip("_.-")
    return s or "part"


def load(models_dir: Path, project: dict | None = None) -> dict:
    p = Path(models_dir) / "index.json"
    try:
        idx = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        idx = {}
    if idx.get("format") != FORMAT:
        idx = {"format": FORMAT, "version": VERSION, "project": project or {}, "terms": CADENAS_TERMS, "parts": {}}
    if project:
        idx["project"] = project
    idx.setdefault("parts", {})
    return idx


def save(models_dir: Path, idx: dict) -> Path:
    p = Path(models_dir) / "index.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    idx["parts"] = dict(sorted(idx["parts"].items()))
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(idx, indent=1, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, p)
    return p


def rel(models_dir: Path, f: Path) -> str:
    return Path(os.path.relpath(f, models_dir)).as_posix()


def has_file(models_dir: Path, idx: dict, part_id: str, source: str | None = None) -> bool:
    e = idx["parts"].get(part_id)
    if not e or (source and e.get("source") != source):
        return False
    return (Path(models_dir) / e.get("file", "")).is_file()


# Skutečný model výrobce (ne zástupný): stažený skriptem z 3Dfindit ("3dfindit", pozastaveno — čl. 12.3 (vii)
# podmínek CADENAS) nebo ručně v prohlížeči a zaevidovaný tools/register_manual.py ("manual-3dfindit",
# "manual-<výrobce>", soubor models/manual/<partId-safe>.stp).
MANUAL_PREFIX = "manual-"


def is_vendor_model(e: dict | None) -> bool:
    s = (e or {}).get("source") or ""
    return s == "3dfindit" or s.startswith(MANUAL_PREFIX)


def has_vendor_model(models_dir: Path, idx: dict, part_id: str) -> bool:
    """Díl má v indexu skutečný model výrobce (skriptem z 3Dfindit nebo ručně) a soubor existuje."""
    e = idx["parts"].get(part_id)
    return is_vendor_model(e) and (Path(models_dir) / e.get("file", "")).is_file()
