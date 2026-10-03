"""Bezpečnostní funkce: data/safety/*.json (rešerše se zdroji) → packages/core/src/safety_data.ts.

    python scripts/build_safety.py                 # přegeneruje safety_data.ts z data/safety/
    python scripts/build_safety.py --import DIR    # nejdřív zkopíruje rešerši z DIR do data/safety/
    python scripts/build_safety.py --check         # jen kontrola (URL u funkcí a zkoušek, kategorie)

Zdroj (rešerše 2026-10-03, vše „návrh k revizi, nenahrazuje normu“):
  risk_graph.json   graf rizik ISO 13849-1 (S/F/P → PLr), PL ↔ PFH, rozpory
  categories.json   kategorie, třídy MTTFd / DCavg, CCF, zjednodušená tabulka PL, B10d → MTTFd,
                    typické hodnoty (tab. C.1), kategorie zastavení IEC 60204-1
  functions.json    katalog 21 typických bezpečnostních funkcí, ISO 13855, rozpory
  safety_plc.json   certifikované bloky bezpečnostních PLC (PLCopen, Siemens, Rockwell…), mapování
  components.json   bezpečnostní komponenty (relé, PLC, spínače, závory, stykače, ventily, STO…)
  validation.md     ověření a validace, SRS, FAT, nařízení 2023/1230 (jen podklad, do TS nejde)

České texty, které jdou do dokumentů, se v TS označí N_() (klíč překladu, viz scripts/i18n.py);
názvy bloků, značek, řad a kódů ne. Do TS jde jen to, co modul safety.ts používá.
Po přegenerování: build jádra, `python scripts/i18n.py missing <jazyk>` → přeložit → merge, testy.
"""

from __future__ import annotations

import json
import re
import shutil
import unicodedata
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "safety"
OUT = ROOT / "packages" / "core" / "src" / "safety_data.ts"
FILES = ["risk_graph.json", "categories.json", "functions.json", "safety_plc.json", "components.json", "validation.md"]
CZ = re.compile(r"[áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]")
# české texty bez diakritiky (popisky v tabulkách mapování a komponent)
CZ_WORDS = re.compile(r"\b(prvek|logika|bez|nebo|vstup|vstupy|moduly|funkce|dle|podle|jen|let|souhrn|pro|viz|jako|typ|kvitace|reset prvek|cyklů|varianta)\b", re.I)
# kategorie komponent, které modul nabízí (components.json → SAFETY_COMPONENTS)
# sloupce mapování a platformy text_generation, které dokumenty zobrazují (ostatní bez N_ — nepřekládají se)
SHOWN_COLS = {"popis", "omron", "beckhoff", "codesys", "pilz_pnozmulti", "sick_flexisoft"}
SHOWN_TEXTGEN = {"siemens", "rockwell", "codesys", "omron", "beckhoff", "pilz", "sick", "schmersal"}
COMP_CATS = ["safety_relay", "safety_controller", "guard_switch", "guard_lock", "light_curtain", "scanner",
             "two_hand", "estop", "contactor_mirror", "safety_valve", "drive_sto", "enabling_device", "mode_selector"]


def lit(s) -> str:
    """TS literál; český text jako N_("…")."""
    if s is None:
        return "null"
    if isinstance(s, bool):
        return "true" if s else "false"
    if isinstance(s, (int, float)):
        return json.dumps(s)
    s = str(s)
    j = json.dumps(s, ensure_ascii=False)
    return f"N_({j})" if (CZ.search(s) or CZ_WORDS.search(s)) else j


def txt(s) -> str:
    """Souvislý český text (popis, postup, výsledek) — vždy klíč překladu, i bez diakritiky."""
    s = "" if s is None else str(s)
    return f"N_({json.dumps(s, ensure_ascii=False)})" if s.strip() else '""'


def raw(v) -> str:
    return json.dumps(v, ensure_ascii=False)


def arr(xs, f=lit) -> str:
    return "[" + ", ".join(f(x) for x in xs) + "]"


def load(name: str):
    return json.loads((SRC / name).read_text(encoding="utf-8"))


def first_pl(s) -> str | None:
    m = re.search(r"\b([a-e])\b", str(s or ""))
    return m.group(1) if m else None


def urls(*lists) -> list[str]:
    out: list[str] = []
    for lst in lists:
        for u in lst or []:
            if isinstance(u, dict):
                u = u.get("url", "")
            if isinstance(u, str) and u.startswith("http") and u not in out:
                out.append(u)
    return out


def build() -> tuple[str, list[str]]:
    problems: list[str] = []
    rg, cat, fn, plc, comp = (load(f) for f in FILES[:5])
    L: list[str] = [
        "/* VYGENEROVÁNO scripts/build_safety.py z data/safety/*.json — needitovat ručně.",
        "   Rešerše " + rg["meta"]["created"] + ": návrh k revizi, nenahrazuje normu (viz data/safety/). */",
        'import { N_ } from "./i18n.js";',
        "",
        "export const SAFETY_DATA_DATE = " + raw(rg["meta"]["created"]) + ";",
        "",
    ]

    # --- graf rizik a PL ↔ PFH
    rgi = rg["risk_graph_iso13849"]
    L.append("/** Graf rizik ISO 13849-1 příl. A: „S2F2P2“ → PLr. */")
    L.append("export const SAFETY_PLR_TABLE: Record<string, \"a\" | \"b\" | \"c\" | \"d\" | \"e\"> = {")
    for r in rgi["plr_table"]:
        L.append(f'  {r["S"]}{r["F"]}{r["P"]}: {raw(r["PLr"])},')
    L.append("};")
    L.append("export const SAFETY_PLR_SOURCES: string[] = " + raw(urls(rgi["sources"], rgi["plr_table_meta"]["sources"])) + ";")
    L.append("/** Parametry grafu rizik (popisky jsou klíče překladu). */")
    L.append("export const SAFETY_RISK_PARAMS: Record<string, string> = {")
    for p in ("S", "F", "P"):
        for k, v in rgi["parameters"][p]["values"].items():
            L.append(f"  {k}: {raw(v['label'])},")
    L.append("};")
    fcrit = rgi["parameters"]["F"]["criteria"]["machine_readable"]
    L.append("export const SAFETY_F2_MIN_INTERVENTIONS_PER_HOUR = " + raw(fcrit["F2_min_interventions_per_hour_exclusive"]) + ";")
    L.append("export const SAFETY_PL_PFH: Array<{ pl: string; min: number; max: number }> = " +
             raw([{"pl": r["PL"], "min": r["pfh_min"], "max": r["pfh_max_exclusive"]} for r in rg["pl_pfh"]["table"]]) + ";")
    L.append("")

    # --- kategorie, třídy, zjednodušená tabulka
    L.append("/** Kategorie ISO 13849-1: struktura a nejvyšší PL (popisy = klíče překladu). */")
    L.append("export const SAFETY_CATEGORIES: Array<{ cat: string; structure: string; maxPl: string; dcavg: string; ccf: string }> = [")
    for c in cat["categories"]["items"]:
        L.append(f'  {{ cat: {raw(c["category"])}, structure: {raw(c["structure"])}, maxPl: {raw(c["max_pl"])}, dcavg: {raw(c["dcavg"])}, ccf: {raw(c["ccf"])} }},')
    L.append("];")
    L.append("export const SAFETY_MTTFD_CLASSES = " + raw([{"cls": r["class"], "min": r["min_years"], "max": r.get("max_years_exclusive", r.get("max_years_inclusive"))} for r in cat["mttfd_classes"]["table"]]) + ";")
    cap = cat["mttfd_classes"]["capping"]
    L.append(f'export const SAFETY_MTTFD_CAP = {{ def: {cap["cap_years_default"]}, cat4: {cap["cap_years_category_4"]} }};')
    L.append("export const SAFETY_DC_CLASSES = " + raw([{"cls": r["class"], "min": r["min_percent"], "max": r.get("max_percent_exclusive", r.get("max_percent_inclusive"))} for r in cat["dc_classes"]["table"]]) + ";")
    L.append("/** Zjednodušené určení PL (sloupcový graf, ISO 13849-1:2015 tab. 6): null = nepřípustná kombinace. */")
    L.append("export const SAFETY_SIMPLE_PL: Array<{ cat: string; dc: string; low: string | null; medium: string | null; high: string | null }> = " +
             raw([{"cat": r["category"], "dc": r["dcavg"], "low": r["mttfd_low"], "medium": r["mttfd_medium"], "high": r["mttfd_high"]} for r in cat["simplified_pl_table"]["table"]]) + ";")
    L.append("export const SAFETY_SIMPLE_PL_SOURCES: string[] = " + raw(urls(cat["simplified_pl_table"]["sources"])) + ";")
    L.append(f'export const SAFETY_CCF_MIN = {cat["ccf"]["min_points"]};')
    L.append("/** Opatření proti CCF (body); splnění potvrzuje uživatel. */")
    L.append("export const SAFETY_CCF_MEASURES: Array<{ id: string; label: string; points: number }> = [")
    ccf_ids = ["separation", "diversity", "overload", "welltried", "fmea", "training", "emc", "environment"]
    for i, m in enumerate(cat["ccf"]["measures"]):
        L.append(f'  {{ id: {raw(ccf_ids[i])}, label: {txt(m["measure"])}, points: {m["points"]} }},')
    L.append("];")
    L.append("export const SAFETY_CCF_SOURCES: string[] = " + raw(urls(cat["ccf"]["sources"])) + ";")
    b = cat["b10d_to_mttfd"]
    ex = b["machine_readable_example"]
    L.append(f'export const SAFETY_NOP_DEFAULTS = {{ dop: {ex["dop"]}, hop: {ex["hop"]}, missionYears: 20 }};')
    L.append("export const SAFETY_B10D_SOURCES: string[] = " + raw(urls(b["sources"])) + ";")
    L.append("/** Typické hodnoty komponent (ISO 13849-1 tab. C.1) — použijí se, dokud uživatel nezadá hodnotu z datasheetu. */")
    L.append("export const SAFETY_GENERIC: Record<string, { label: string; b10d?: number; mttfd?: number }> = {")
    gen_ids = ["mechanical", "hyd_1m", "hyd_500k", "hyd_250k", "hyd_low", "pneumatic", "relay_low", "relay_nom",
               "prox_low", "prox_nom", "contactor_low", "contactor_nom", "position_switch", "guard_switch_sep",
               "estop", "pushbutton"]
    tcv = cat["typical_component_values"]["items"]
    if len(tcv) != len(gen_ids):
        problems.append(f"typical_component_values: čekáno {len(gen_ids)} položek, je {len(tcv)}")
    for i, it in enumerate(tcv):
        parts = [f"label: {txt(it['component'])}"]
        if it.get("b10d"):
            parts.append(f"b10d: {it['b10d']}")
        if it.get("mttfd_years"):
            parts.append(f"mttfd: {it['mttfd_years']}")
        L.append(f"  {gen_ids[i]}: {{ {', '.join(parts)} }},")
    L.append("};")
    L.append("export const SAFETY_GENERIC_SOURCES: string[] = " + raw(urls(cat["typical_component_values"]["sources"])) + ";")
    sc = cat["stop_categories_en60204"]
    L.append("/** Kategorie zastavení IEC 60204-1 (definice = klíče překladu) a funkce pohonu IEC 61800-5-2. */")
    L.append("export const SAFETY_STOP_CATEGORIES: Array<{ cat: number; text: string; drive: string }> = [")
    for it in sc["items"]:
        L.append(f'  {{ cat: {it["stop_category"]}, text: {raw(it["definition"])}, drive: {raw(it["drive_function_iec61800_5_2"].split(" ")[0])} }},')
    L.append("];")
    L.append("export const SAFETY_STOP_SOURCES: string[] = " + raw(urls(sc["sources"])) + ";")
    L.append("")

    # --- katalog funkcí
    L.append("export interface SafetyCatalogTest { name: string; kind: string; procedure: string; expected: string; sources: string[] }")
    L.append("export interface SafetyCatalogFn {")
    L.append("  name: string; category: string; hazards: string[]; trigger: string; reaction: string; stopCats: number[];")
    L.append("  drive: string[]; reset: string; typicalPlr: string; typicalArch: string; channels: string; edm: string;")
    L.append("  components: string[]; tests: SafetyCatalogTest[]; standards: string[]; sources: string[];")
    L.append("}")
    L.append("/** Katalog typických bezpečnostních funkcí (functions.json) — klíč = id funkce v rešerši. */")
    L.append("export const SAFETY_FN_CATALOG: Record<string, SafetyCatalogFn> = {")
    for f in fn["functions"]:
        ta = f["typical_architecture"]
        tp = f["typical_plr"]
        r = f["reaction"]
        edm = ta.get("edm")
        if not isinstance(edm, str):
            edm = "" if edm is None else ("ano" if edm else "ne")
        reset = (f.get("reset") or {}).get("description", "")
        srcs = urls(f["sources"], tp.get("sources"), ta.get("sources"), r.get("sources"), (f.get("reset") or {}).get("sources"))
        if not srcs:
            problems.append(f"{f['id']}: funkce bez URL zdroje")
        L.append(f'  {f["id"]}: {{')
        L.append(f'    name: {txt(f["name"])}, category: {raw(f["category"])},')
        L.append(f'    hazards: {arr(f["hazards"], raw)},')
        L.append(f'    trigger: {txt(f["trigger"])},')
        L.append(f'    reaction: {txt(r["description"])},')
        L.append(f'    stopCats: {raw(r.get("stop_category") or [])}, drive: {raw(r.get("drive_mapping") or [])},')
        L.append(f'    reset: {txt(reset)},')
        L.append(f'    typicalPlr: {txt(tp["value"])}, typicalArch: {txt(str(ta.get("category") or ""))},')
        L.append(f'    channels: {raw(str(ta.get("channels") or ""))}, edm: {raw(edm)},')
        L.append(f'    components: {arr(ta.get("components") or [], txt)},')
        L.append("    tests: [")
        for t in f["validation_tests"]:
            ts = urls(t.get("sources")) or srcs[:2]      # zkouška bez vlastního zdroje → zdroje funkce
            L.append(f'      {{ name: {txt(t["name"])}, kind: {raw(t.get("kind", ""))}, procedure: {txt(t["procedure"])}, expected: {txt(t["expected"])}, sources: {raw(ts)} }},')
        L.append("    ],")
        L.append(f'    standards: {arr(f.get("relevant_standards") or [], lit)},')
        L.append(f'    sources: {raw(srcs)},')
        L.append("  },")
    L.append("};")
    L.append("export const SAFETY_FN_SOURCES: string[] = " + raw(urls(fn["meta"]["sources"])) + ";")
    L.append("")

    # --- ISO 13855 (vzorce jsou v safety.ts, sem jen zdroje a tabulky)
    iso = fn["iso13855"]
    cases = {c["id"]: c for c in iso["cases"]}
    L.append("/** ISO 13855: zdroje k jednotlivým případům (vzorce viz `safetyDistance`). */")
    L.append("export const SAFETY_ISO13855_SOURCES: Record<string, string[]> = {")
    for cid, c in cases.items():
        s = urls(c.get("sources"), (c.get("2010") or {}).get("sources"), (c.get("2024") or {}).get("sources"))
        L.append(f"  {cid}: {raw(s)},")
    L.append("  editions: " + raw(urls(iso["editions"]["2010"]["sources"], iso["editions"]["2024"]["sources"])) + ",")
    L.append("};")
    L.append("/** Lisy (EN 692/693): přídavek C podle rozlišení d (C-norma má přednost). */")
    L.append("export const SAFETY_PRESS_C: Array<{ dMax: number; C: number; strokeByEspe: boolean }> = " + raw([
        {"dMax": 14, "C": 0, "strokeByEspe": True}, {"dMax": 20, "C": 80, "strokeByEspe": True},
        {"dMax": 30, "C": 130, "strokeByEspe": True}, {"dMax": 40, "C": 240, "strokeByEspe": False},
        {"dMax": 9999, "C": 850, "strokeByEspe": False}]) + ";")
    exp = [r["C_mm"] for r in cases["press_supplement"]["table"]]
    if exp != [0, 80, 130, 240, 850]:
        problems.append(f"press_supplement: hodnoty C {exp} neodpovídají kódu")
    L.append("export const SAFETY_MULTIBEAM_HEIGHTS: Record<string, number[]> = " + raw(cases["multibeam"]["beam_heights_mm"]) + ";")
    L.append("")

    # --- rozpory ve zdrojích
    L.append("/** Rozpory ve zdrojích (téma a řešení = klíče překladu) — do dokumentu 13. */")
    L.append("export const SAFETY_DISCREPANCIES: Array<{ area: string; topic: string; resolution: string; sources: string[] }> = [")
    for area, d in (("risk", rg), ("categories", cat), ("functions", fn)):
        for x in d["discrepancies"]:
            s = urls(x.get("sources"), *[v.get("sources") for v in x.get("variants", [])])
            L.append(f'  {{ area: {raw(area)}, topic: {txt(x["topic"])}, resolution: {txt(x.get("resolution") or "")}, sources: {raw(s)} }},')
    L.append("];")
    L.append("")

    # --- bloky bezpečnostních PLC
    L.append("/** Mapování bezpečnostních funkcí na bloky platforem (safety_plc.json, „neověřeno“ = nedohledáno). */")
    L.append("export const SAFETY_BLOCK_MAP: Record<string, Record<string, string>> = {")
    for r in plc["mapping"]["rows"]:
        cells = ", ".join(f"{k}: {lit(v) if k in SHOWN_COLS else raw(v)}" for k, v in r.items() if k not in ("function",))
        L.append(f'  {r["function"]}: {{ {cells} }},')
    L.append("};")
    L.append("export const SAFETY_BLOCK_MAP_SOURCES: string[] = " + raw(urls(plc["mapping"]["sources"])) + ";")
    L.append("export interface SafetyBlockPin { name: string; type: string; meaning: string }")
    L.append("export interface SafetyBlockDef { name: string; purpose: string; inputs: SafetyBlockPin[]; outputs: SafetyBlockPin[]; notes: string; sources: string[] }")
    for key, label in (("siemens", "SIEMENS"), ("rockwell", "ROCKWELL")):
        L.append(f"/** Instrukce {key} (safety_plc.json); význam pinů a poznámky jen u Siemens (předpis volání). */")
        L.append(f"export const SAFETY_BLOCKS_{label}: SafetyBlockDef[] = [")
        sie = key == "siemens"
        for bl in plc["platforms"][key]["blocks"]:
            pins = lambda xs: "[" + ", ".join(f'{{ name: {raw(p["name"])}, type: {raw(p.get("type", ""))}, meaning: {txt(p.get("meaning", "")) if sie else chr(34) * 2} }}' for p in xs) + "]"
            notes = raw(bl.get("notes", "")) if sie else '""'
            L.append(f'  {{ name: {raw(bl["name"])}, purpose: {txt(bl.get("purpose", "")) if sie else raw(bl.get("purpose", ""))}, inputs: {pins(bl.get("inputs", []))}, outputs: {pins(bl.get("outputs", []))}, notes: {notes}, sources: {raw(urls(bl.get("sources")))} }},')
        L.append("];")
    L.append("/** PLCopen Safety FB (Part 1 v2.x): rozhraní. */")
    L.append("export const SAFETY_BLOCKS_PLCOPEN: SafetyBlockDef[] = [")
    for bl in plc["plcopen"]["blocks"]:
        pins = lambda xs: "[" + ", ".join(f'{{ name: {raw(p["name"])}, type: {raw(p.get("type", ""))}, meaning: "" }}' for p in xs) + "]"
        L.append(f'  {{ name: {raw(bl["name"])}, purpose: {raw(bl.get("purpose", ""))}, inputs: {pins(bl.get("inputs", []))}, outputs: {pins(bl.get("outputs", []))}, notes: "",sources: {raw(urls(bl.get("sources"), plc["plcopen"]["sources"])[:2])} }},')
    L.append("];")
    L.append("/** Co jde reálně vygenerovat textově, po platformách (safety_plc.json → text_generation). */")
    L.append("export const SAFETY_TEXTGEN: Record<string, { feasible: string; how: string; limits: string; sources: string[] }> = {")
    for k, v in plc["text_generation"]["platforms"].items():
        t = txt if k in SHOWN_TEXTGEN else raw
        L.append(f'  {k}: {{ feasible: {t(v["feasible"])}, how: {t(v["how"])}, limits: {t(v.get("limits", ""))}, sources: {raw(urls(v.get("sources")))} }},')
    L.append("};")
    L.append("export const SAFETY_PLC_SOURCES: Record<string, string[]> = {")
    for k, v in plc["platforms"].items():
        L.append(f"  {k}: {raw(urls(v.get('sources'), (v.get('programming') or {}).get('sources')))},")
    L.append("  plcopen: " + raw(urls(plc["plcopen"]["sources"])) + ",")
    L.append("};")
    L.append("")

    # --- komponenty
    L.append("export interface SafetyComponentData {")
    L.append("  id: string; cat: string; brand: string; series: string; orderCode: string; type: string;")
    L.append("  plMax: string | null; plText: string; catMax: string; b10dText: string; pfhdText: string; mttfdText: string;")
    L.append("  sources: string[]; verified: boolean;")
    L.append("}")
    L.append("/** Bezpečnostní komponenty (components.json): hodnoty B10d / PFHd je nutné potvrdit podle datasheetu varianty. */")
    L.append("export const SAFETY_COMPONENTS: SafetyComponentData[] = [")
    seen: set[str] = set()
    for it in comp["items"]:
        if it["category"] not in COMP_CATS:
            problems.append(f"komponenta {it['brand']} {it['series']}: neznámá kategorie {it['category']}")
            continue
        plain = unicodedata.normalize("NFD", it["brand"].split(" ")[0] + "-" + it["series"])
        plain = "".join(ch for ch in plain if not unicodedata.combining(ch))
        base = re.sub(r"[^a-z0-9]+", "-", plain.lower()).strip("-")[:40].strip("-")
        cid, n = base, 2
        while cid in seen:
            cid = f"{base}-{n}"
            n += 1
        seen.add(cid)
        s = urls(it.get("sources"))
        if not s:
            problems.append(f"komponenta {cid}: bez URL zdroje")
        L.append("  { " + ", ".join([
            f"id: {raw(cid)}", f"cat: {raw(it['category'])}", f"brand: {raw(it['brand'])}", f"series: {lit(it['series'])}",
            f"orderCode: {lit(it.get('order_code') or '')}", f"type: {txt(it['typical_type'])}",
            f"plMax: {raw(first_pl(it.get('pl_max')))}", f"plText: {raw(it.get('pl_max') or '')}",
            f"catMax: {raw(str(it.get('category_max') or ''))}", f"b10dText: {raw(str(it.get('b10d') or ''))}",
            f"pfhdText: {lit(str(it.get('pfhd') or ''))}", f"mttfdText: {raw(str(it.get('mttfd') or ''))}",
            f"sources: {raw(s)}", f"verified: {'true' if it.get('verified') else 'false'}",
        ]) + " },")
    L.append("];")
    L.append("")
    return "\n".join(L) + "\n", problems


def main(argv: list[str]) -> int:
    if "--import" in argv:
        src = Path(argv[argv.index("--import") + 1])
        SRC.mkdir(parents=True, exist_ok=True)
        for f in FILES:
            shutil.copyfile(src / f, SRC / f)
        print(f"zkopírováno {len(FILES)} souborů z {src} do {SRC}")
    text, problems = build()
    for p in problems:
        print(" -", p)
    if "--check" in argv:
        return 1 if problems else 0
    OUT.write_text(text, encoding="utf-8", newline="\n")
    print(f"zapsáno {OUT.relative_to(ROOT)} ({len(text)} znaků)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
