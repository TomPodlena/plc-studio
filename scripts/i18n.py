#!/usr/bin/env python3
"""Vícejazyčnost PLC Studia — sběr klíčů, slučování překladů a kontrola katalogů.

Zdrojový jazyk je čeština; český text ve zdrojovém kódu je klíčem překladu:

    jádro, web (TS/JS):  tr("…"), trx("…"), N_("…")      — viz packages/core/src/i18n.ts
    desktop (Python):    _("…"), N_("…")                  — viz apps/desktop/plc_studio/i18n.py

Katalogy jsou v ``packages/core/src/i18n/<jazyk>.ts`` (tělo souboru je JSON objekt).

    python scripts/i18n.py check              klíče × katalogy: chybějící, navíc, zástupné znaky
    python scripts/i18n.py missing en         chybějící klíče jazyka jako JSON {klíč: ""}
    python scripts/i18n.py keys               všechny klíče (JSON pole)
    python scripts/i18n.py merge en a.json …  doplní / přepíše překlady z JSON {klíč: překlad}
    python scripts/i18n.py prune              odstraní z katalogů klíče, které už kód nepoužívá

Argument volání musí být JEDEN řetězcový literál (v Pythonu smí být složený ze sousedních
literálů), bez spojování ``+`` a bez ``${…}`` / f-řetězce — proměnné části se předávají
jako ``{jméno}``. Jinak sběr klíč nevidí; ``check`` taková místa vypíše jako chybu.
"""

from __future__ import annotations

import ast
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOGS = ROOT / "packages" / "core" / "src" / "i18n"
LANGS = ("en", "de", "es", "zh")
HEAD = ("/* Překlady {lang} — klíč je český text ze zdrojového kódu (viz ../i18n.ts).\n"
        "   Soubor udržuje scripts/i18n.py; tělo objektu musí zůstat platný JSON. */\n"
        "const d: Record<string, string> = ")
TAIL = ";\nexport default d;\n"
PLACEHOLDER = re.compile(r"\{(\w+)\}")


# --- zdroje -----------------------------------------------------------------------

def py_sources() -> list[Path]:
    return sorted((ROOT / "apps" / "desktop" / "plc_studio").rglob("*.py"))


def js_sources() -> list[Path]:
    core = [p for p in sorted((ROOT / "packages" / "core" / "src").glob("*.ts"))
            if not p.name.endswith((".test.ts", ".d.ts")) and p.name != "i18n.ts"]
    web = sorted((ROOT / "apps" / "web" / "src").glob("*.js"))
    return core + web + [ROOT / "apps" / "desktop" / "bridge.mjs"]


# --- sběr klíčů -------------------------------------------------------------------

def extract_py(path: Path, keys: dict, problems: list) -> None:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        f = node.func
        name = f.id if isinstance(f, ast.Name) else f.attr if isinstance(f, ast.Attribute) else ""
        if name not in ("_", "N_") or not node.args:
            continue
        arg = node.args[0]
        where = f"{path.relative_to(ROOT)}:{node.lineno}"
        if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
            keys.setdefault(arg.value, []).append(where)
        elif isinstance(arg, ast.JoinedStr):
            problems.append(f"{where}: f-řetězec v {name}() — použij {{jméno}} a pojmenované argumenty")
        elif isinstance(arg, ast.BinOp):
            problems.append(f"{where}: spojovaný řetězec v {name}() — sběr klíč nevidí")
        # ostatní (proměnná, index do tabulky) = překlad textu označeného jinde přes N_()


JS_CALL = re.compile(r"(?<![\w$])(tr|trx|N_)\(\s*")      # i core.tr(…) v mostu
JS_ESC = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f", "v": "\v", "0": "\0"}


def js_literal(text: str, i: int):
    """Řetězcový literál JS od pozice ``i`` → (hodnota, konec) nebo None; ``${`` → chyba."""
    q = text[i] if i < len(text) else ""
    if q not in "\"'`":
        return None
    out, j = [], i + 1
    while j < len(text):
        c = text[j]
        if c == "\\":
            n = text[j + 1]
            if n == "u":
                if text[j + 2] == "{":
                    end = text.index("}", j)
                    out.append(chr(int(text[j + 3:end], 16)))
                    j = end + 1
                else:
                    out.append(chr(int(text[j + 2:j + 6], 16)))
                    j += 6
                continue
            if n == "x":
                out.append(chr(int(text[j + 2:j + 4], 16)))
                j += 4
                continue
            if n == "\n":                      # pokračování řádku
                j += 2
                continue
            out.append(JS_ESC.get(n, n))
            j += 2
            continue
        if c == q:
            return "".join(out), j + 1
        if q == "`" and c == "$" and text[j + 1] == "{":
            raise ValueError("${…} v šabloně")
        if c == "\n" and q != "`":
            return None
        out.append(c)
        j += 1
    return None


def extract_js(path: Path, keys: dict, problems: list) -> None:
    text = path.read_text(encoding="utf-8")
    for m in JS_CALL.finditer(text):
        line = text.count("\n", 0, m.start()) + 1
        where = f"{path.relative_to(ROOT)}:{line}"
        try:
            lit = js_literal(text, m.end())
        except ValueError as exc:
            problems.append(f"{where}: {exc} v {m.group(1)}() — použij {{jméno}} a parametry")
            continue
        if lit is None:
            continue                            # dynamický argument (text označený N_ jinde)
        value, end = lit
        rest = text[end:end + 40].lstrip()
        if rest.startswith("+"):
            problems.append(f"{where}: spojovaný řetězec v {m.group(1)}() — sběr klíč nevidí")
        keys.setdefault(value, []).append(where)


def collect() -> tuple[dict, list]:
    keys: dict[str, list[str]] = {}
    problems: list[str] = []
    for p in py_sources():
        extract_py(p, keys, problems)
    for p in js_sources():
        extract_js(p, keys, problems)
    keys.pop("", None)
    return keys, problems


# --- katalogy ---------------------------------------------------------------------

def catalog_path(lang: str) -> Path:
    return CATALOGS / f"{lang}.ts"


def read_catalog(lang: str) -> dict:
    path = catalog_path(lang)
    if not path.exists():
        return {}
    text = path.read_text(encoding="utf-8")
    start = text.index("{", text.index("const d"))
    end = text.rindex("}")
    return json.loads(text[start:end + 1])


def write_catalog(lang: str, data: dict) -> None:
    CATALOGS.mkdir(parents=True, exist_ok=True)
    body = json.dumps(dict(sorted(data.items())), ensure_ascii=False, indent=2)
    catalog_path(lang).write_text(HEAD.format(lang=lang.upper()) + body + TAIL,
                                  encoding="utf-8", newline="\n")


def check() -> list[str]:
    """Vrátí seznam nálezů (prázdný = katalogy odpovídají kódu)."""
    keys, problems = collect()
    out = list(problems)
    for lang in LANGS:
        cat = read_catalog(lang)
        missing = [k for k in keys if not cat.get(k)]
        if missing:
            out.append(f"{lang}: chybí {len(missing)} překladů, např. {missing[0]!r} "
                       f"({keys[missing[0]][0]})")
        for k in keys:
            v = cat.get(k)
            if v and set(PLACEHOLDER.findall(k)) != set(PLACEHOLDER.findall(v)):
                out.append(f"{lang}: jiné zástupné znaky než v klíči {k!r} → {v!r}")
        extra = [k for k in cat if k not in keys]
        if extra:
            out.append(f"{lang}: {len(extra)} klíčů navíc (kód je nepoužívá), např. {extra[0]!r}")
    return out


def main(argv: list[str]) -> int:
    cmd = argv[1] if len(argv) > 1 else "check"
    if cmd == "check":
        keys, _ = collect()
        found = check()
        print(f"klíčů: {len(keys)}")
        for line in found:
            print(" -", line)
        return 1 if found else 0
    if cmd == "keys":
        json.dump(sorted(collect()[0]), sys.stdout, ensure_ascii=False, indent=1)
        return 0
    if cmd == "missing":
        cat = read_catalog(argv[2])
        json.dump({k: "" for k in sorted(collect()[0]) if not cat.get(k)}, sys.stdout,
                  ensure_ascii=False, indent=1)
        return 0
    if cmd == "merge":
        cat = read_catalog(argv[2])
        for name in argv[3:]:
            new = json.loads(Path(name).read_text(encoding="utf-8-sig"))
            cat.update({k: v for k, v in new.items() if isinstance(v, str) and v})
        write_catalog(argv[2], cat)
        print(f"{argv[2]}: {len(cat)} překladů")
        return 0
    if cmd == "prune":
        keys, _ = collect()
        for lang in LANGS:
            cat = read_catalog(lang)
            write_catalog(lang, {k: v for k, v in cat.items() if k in keys})
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except AttributeError:
            pass
    sys.exit(main(sys.argv))
