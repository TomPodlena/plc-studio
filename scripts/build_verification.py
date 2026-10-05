"""Ověření platforem: data/verification.json → packages/core/src/verification_data.ts.

    python scripts/build_verification.py          # přegeneruje verification_data.ts
    python scripts/build_verification.py --check  # jen kontrola (stavy, data, protokoly, čeština)

data/verification.json je JEDINÝ zdroj pravdy o tom, co je u které platformy ověřené (viz CLAUDE.md
„Ověření platforem“). Čtou ho: jádro (verification.ts → README platforem, výběr platforem v aplikaci)
a web apps/site (scripts/build.js → stránka Platformy). České texty (summary, notVerified, note) se v TS
označí N_(), aby je sebral scripts/i18n.py; `ide` a `file` jsou technické a nesmí obsahovat češtinu.
Po přegenerování: build jádra, i18n missing/merge, testy (verification.test.ts), golden jen README.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "verification.json"
OUT = ROOT / "packages" / "core" / "src" / "verification_data.ts"
CZ = re.compile(r"[áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def load() -> tuple[dict, list[str]]:
    d = json.loads(SRC.read_text(encoding="utf-8"))
    states, fstates, scopes = set(d["states"]), set(d["formatStates"]), set(d["scopes"])
    problems: list[str] = []
    for k, v in d["platforms"].items():
        w = f"{k}:"
        if v.get("state") not in states:
            problems.append(f"{w} neznámý stav {v.get('state')!r}")
        if not DATE.match(str(v.get("date", ""))):
            problems.append(f"{w} datum není RRRR-MM-DD")
        ide = v.get("ide")
        if ide is None and v.get("state") not in ("beta", "unsupported"):
            problems.append(f"{w} stav {v.get('state')} bez ide (IDE / překladač a verze)")
        if ide is not None and (not isinstance(ide, str) or not ide.strip() or CZ.search(ide)):
            problems.append(f"{w} ide musí být neprázdný technický text bez češtiny")
        for s in v.get("scope") or []:
            if s not in scopes:
                problems.append(f"{w} neznámý rozsah {s!r}")
        for f in ("summary", "notVerified"):
            if not str(v.get(f, "")).strip():
                problems.append(f"{w} chybí {f}")
        ev = v.get("evidence") or []
        if not ev:
            problems.append(f"{w} chybí evidence (protokol v docs/verification/)")
        for e in ev:
            if not (ROOT / e).is_file():
                problems.append(f"{w} protokol {e} neexistuje")
        for fm in v.get("formats") or []:
            if fm.get("state") not in fstates:
                problems.append(f"{w} výstup {fm.get('file')!r}: neznámý stav {fm.get('state')!r}")
            if not fm.get("file") or CZ.search(fm["file"]):
                problems.append(f"{w} výstup bez názvu souboru nebo s češtinou: {fm.get('file')!r}")
    return d, problems


def tr_lit(s: str) -> str:
    return f"N_({json.dumps(s, ensure_ascii=False)})"


def build(d: dict) -> str:
    q = json.dumps
    lines = [
        "/* VYGENEROVÁNO scripts/build_verification.py z data/verification.json — needitovat ručně. */",
        'import { N_ } from "./i18n.js";',
        'import type { PlatformKey } from "./model.js";',
        'import type { PlatformVerification } from "./verification.js";',
        "",
        "/** Stav ověření platforem; `summary`, `notVerified` a `note` jsou klíče překladu. */",
        "export const VERIFICATION_DATA: Record<PlatformKey, PlatformVerification> = {",
    ]
    for k, v in d["platforms"].items():
        fm = ", ".join(
            "{ file: " + q(f["file"]) + ", state: " + q(f["state"])
            + (", note: " + tr_lit(f["note"]) if f.get("note") else "") + " }"
            for f in v.get("formats") or [])
        lines += [
            f"  {k}: {{",
            f"    state: {q(v['state'])}, ide: {q(v.get('ide'), ensure_ascii=False)}, date: {q(v['date'])},",
            f"    scope: [{', '.join(q(s) for s in v.get('scope') or [])}],",
            f"    summary: {tr_lit(v['summary'])},",
            f"    notVerified: {tr_lit(v['notVerified'])},",
            f"    evidence: [{', '.join(q(e) for e in v['evidence'])}],",
            f"    formats: [{fm}],",
            "  },",
        ]
    lines += ["};", ""]
    return "\n".join(lines)


def main() -> int:
    d, problems = load()
    for p in problems:
        print("!", p)
    if problems:
        return 1
    if "--check" in sys.argv:
        print(f"{SRC.relative_to(ROOT)}: {len(d['platforms'])} platforem v pořádku")
        return 0
    OUT.write_text(build(d), encoding="utf-8", newline="\n")
    print(f"{OUT.relative_to(ROOT)}: {len(d['platforms'])} platforem")
    return 0


if __name__ == "__main__":
    sys.exit(main())
