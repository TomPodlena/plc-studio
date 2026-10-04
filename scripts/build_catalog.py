"""Katalog kusovníku: data/catalog/*.json (rešerše se zdroji) → packages/core/src/catalog_data.ts.

    python scripts/build_catalog.py          # přegeneruje catalog_data.ts
    python scripts/build_catalog.py --check  # jen kontrola (kategorie, duplicity, URL)

Totéž pro odkazy na dokumentaci platforem: data/platform_refs.json → platform_refs.ts (nápověda).

Formát zdrojových JSON viz data/catalog/README.md. České texty (typický typ, poznámka) se
v TS označí N_(), aby je sebral scripts/i18n.py a šly přeložit; názvy značek, řad a kódů ne.
Po přegenerování: build jádra, i18n missing/merge, testy.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "catalog"
OUT = ROOT / "packages" / "core" / "src" / "catalog_data.ts"
REFS_SRC = ROOT / "data" / "platform_refs.json"
REFS_OUT = ROOT / "packages" / "core" / "src" / "platform_refs.ts"
CATALOG_TS = ROOT / "packages" / "core" / "src" / "catalog.ts"
CZ = re.compile(r"[áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]")
PLATS = {"siemens", "rockwell", "beckhoff", "codesys", "mitsubishi", "schneider", "omron", "unitronics", "wago", "delta"}


def known_cats() -> set[str]:
    txt = CATALOG_TS.read_text(encoding="utf-8")
    block = txt.split("export const CAT_LABEL", 1)[1].split("};", 1)[0]
    return set(re.findall(r"^\s+(\w+):", block, re.M))


def lit(s: str) -> str:
    """TS literál; český text jako N_("…") (klíč překladu)."""
    j = json.dumps(s, ensure_ascii=False)
    return f"N_({j})" if CZ.search(s) else j


def load() -> tuple[dict, list, list[str]]:
    cats: dict[str, list] = {}
    sups: dict[str, dict] = {}
    problems: list[str] = []
    base = known_cats()
    for f in sorted(SRC.glob("*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        for key, c in (d.get("categories") or {}).items():
            cat, _, plat = key.partition("@")
            if cat not in base:
                problems.append(f"{f.name}: neznámá kategorie {key!r} (doplň CAT_LABEL v catalog.ts)")
                continue
            if plat and plat not in PLATS:
                problems.append(f"{f.name}: neznámá platforma {key!r}")
                continue
            lst = cats.setdefault(key, [])
            for b in c.get("brands") or []:
                if not b.get("brand"):
                    continue
                same = (b.get("orderCode") or b.get("typical") or "")
                if any(x["brand"] == b["brand"] and (x.get("orderCode") or x.get("typical") or "") == same for x in lst):
                    problems.append(f"{f.name}: {key}: {b['brand']} {same} dvakrát — ponechán první záznam")
                    continue
                hw = b.get("hw")
                if hw is not None:
                    if not isinstance(hw, dict):
                        problems.append(f"{f.name}: {key}/{b['brand']}: hw musí být objekt")
                    elif cat in ("plc_di", "plc_do", "plc_ai", "plc_ao") and not (hw.get("ch") and hw.get("bus")):
                        problems.append(f"{f.name}: {key}/{b['brand']}: modul bez hw.ch / hw.bus — sestava ho nepoužije")
                    elif hw.get("hwSrc") and not str(hw["hwSrc"]).startswith("http"):
                        problems.append(f"{f.name}: {key}/{b['brand']}: hw.hwSrc není URL")
                if b.get("orderCode") and not str(b.get("src", "")).startswith("http"):
                    problems.append(f"{f.name}: {key}/{b['brand']}: kód bez zdroje — vynechán")
                    b = {k: v for k, v in b.items() if k != "orderCode"}
                lst.append(b)
        for s in d.get("suppliers") or []:
            if not s.get("name"):
                continue
            cur = sups.setdefault(s["name"], {**s, "cats": []})
            cur["cats"] = sorted(set(cur["cats"]) | set(s.get("cats") or []))
    return cats, list(sups.values()), problems


def brand_ts(b: dict) -> str:
    parts = [f"brand: {json.dumps(b['brand'], ensure_ascii=False)}",
             "series: [" + ", ".join(lit(str(x)) for x in b.get("series") or []) + "]"]
    for k in ("typical", "note"):
        if b.get(k):
            parts.append(f"{k}: {lit(str(b[k]))}")
    for k in ("orderCode", "src"):
        if b.get(k):
            parts.append(f"{k}: {json.dumps(str(b[k]), ensure_ascii=False)}")
    if b.get("priceLevel") in ("nízká", "střední", "vysoká"):
        parts.append(f"priceLevel: {json.dumps(b['priceLevel'], ensure_ascii=False)}")
    parts.append("suppliers: [" + ", ".join(lit(str(x)) for x in b.get("suppliers") or []) + "]")
    if b.get("hw"):
        # hardwarová data sestavy (hardware.ts) — technické hodnoty, nepřekládají se
        parts.append("hw: " + json.dumps(b["hw"], ensure_ascii=False, sort_keys=True))
    return "{ " + ", ".join(parts) + " }"


def sup_ts(s: dict) -> str:
    parts = [f"name: {lit(s['name'])}"]
    for k in ("url", "country", "kind"):
        if s.get(k):
            parts.append(f"{k}: {json.dumps(str(s[k]), ensure_ascii=False)}")
    if s.get("note"):
        parts.append(f"note: {lit(str(s['note']))}")
    parts.append("cats: [" + ", ".join(json.dumps(x) for x in s["cats"]) + "]")
    return "{ " + ", ".join(parts) + " }"


KINDS = ("product", "ide", "st_ref", "manual", "import", "support", "cz")


def build_refs() -> str:
    d = json.loads(REFS_SRC.read_text(encoding="utf-8"))
    lines = [
        "/* VYGENEROVÁNO scripts/build_catalog.py z data/platform_refs.json — needitovat ručně. */",
        'import { N_ } from "./i18n.js";',
        'import type { PlatformKey } from "./model.js";',
        "",
        "export interface PlatformRef { kind: " + " | ".join(json.dumps(k) for k in KINDS)
        + "; title: string; url: string; lang: string; login?: boolean; }",
        "",
        "/** Ověřené odkazy na dokumentaci platforem (stav k rešerši); `title` je klíč překladu. */",
        "export const PLATFORM_REFS: Record<PlatformKey, PlatformRef[]> = {",
    ]
    n = 0
    for plat in sorted(d):
        if plat not in PLATS:
            print("! neznámá platforma v odkazech:", plat)
            continue
        lines.append(f"  {plat}: [")
        for r in d[plat]:
            if r.get("kind") not in KINDS or not str(r.get("url", "")).startswith("https://"):
                print("! odkaz vynechán:", plat, r.get("title"))
                continue
            login = ", login: true" if r.get("login") else ""
            lines.append(f"    {{ kind: {json.dumps(r['kind'])}, title: N_({json.dumps(r['title'], ensure_ascii=False)}), url: {json.dumps(r['url'])}, "
                         f"lang: {json.dumps(r.get('lang', 'en'))}{login} }},")
            n += 1
        lines.append("  ],")
    lines += ["};", ""]
    REFS_OUT.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    return f"{REFS_OUT.relative_to(ROOT)}: {n} odkazů"


def main() -> int:
    cats, sups, problems = load()
    for p in problems:
        print("!", p)
    if "--check" in sys.argv:
        print(f"kategorií {len(cats)}, značek {sum(map(len, cats.values()))}, dodavatelů {len(sups)}")
        return 0
    lines = [
        "/* VYGENEROVÁNO scripts/build_catalog.py z data/catalog/*.json — needitovat ručně. */",
        'import { N_ } from "./i18n.js";',
        'import type { CatalogBrand, Supplier } from "./catalog.js";',
        "",
        "export const CATALOG_DATA: Record<string, CatalogBrand[]> = {",
    ]
    for key in sorted(cats):
        lines.append(f"  {json.dumps(key)}: [")
        lines += [f"    {brand_ts(b)}," for b in cats[key]]
        lines.append("  ],")
    lines += ["};", "", "export const SUPPLIERS_DATA: Supplier[] = ["]
    lines += [f"  {sup_ts(s)}," for s in sorted(sups, key=lambda s: s["name"].lower())]
    lines += ["];", ""]
    OUT.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    if REFS_SRC.exists():
        print(build_refs())
    print(f"{OUT.relative_to(ROOT)}: kategorií {len(cats)}, značek {sum(map(len, cats.values()))}, dodavatelů {len(sups)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
