"""Ručně stažené modely výrobců → models/index.json (bez jakéhokoli přístupu k síti).

Podmínky CADENAS čl. 12.3 (vii) zakazují skriptované hledání i stahování z 3Dfindit — modely proto stahuje
člověk v prohlížeči (3dfindit.com nebo portál výrobce) a ukládá je do <projekt>/models/manual/ pod jménem
<partId-safe>.stp. Tento nástroj nic nehledá ani nestahuje; jen sestaví seznam ke stažení a soubory zaeviduje.

  python register_manual.py todo     --pilot-root pilot --pilots 11,17,26 [--out pilot/STAHNOUT_RUCNE.md]
  python register_manual.py register <PLCdesk_CAD.json> <projekt>/models --by "Jméno"
                                     [--source manual-3dfindit] [--timeout 600] [--slot pro3d-dl]
                                     [--dry-run] [--force]

Převzato ze stagingu plcdesk_freecad (tools/register_manual.py, 2026-10-24) do PLCdesk PRO
(``plc_studio/pro3d_download``); aplikace volá ``register(…, plan=…)`` se seznamem z ``listing.download_list``
(odkazy podle ``vendors.json``). Příkaz ``todo`` zůstává pro piloty stagingu.

todo      seznam ke stažení (Markdown) ze všech manifestů pilotů: jeden řádek = jeden soubor (stejný výrobce +
          objednací kód v projektu se stahuje jednou), pořadí podle důležitosti (rozvaděč a velké polní díly
          první), odkaz na stránku produktu (3Dfindit z dřívějšího resolve / kandidátů, nebo portál výrobce),
          přesný název souboru a cílová složka, stav staženo / chybí, plán po dnech (fair use 50 / den, náš strop 45).
register  projde models/manual/*.stp|*.step, spáruje je podle jména s díly manifestu (i ostatní řádky se stejným
          výrobcem a kódem), ověří ve FreeCADu přes skill freecad-instance (run_fc.ps1: vlastní slot, timeout, úklid
          jen vlastních PID; načtení, objem > 0, obálka), zapíše do models/index.json (source manual-3dfindit /
          manual-<výrobce>, datum, kdo, SHA-256) a tím nahradí zástupný model (soubor zástupného modelu zůstává
          na disku, index ukazuje na model výrobce). Report: stdout + models/manual/REGISTRACE.md.

Zdroj se bere z doporučení seznamu (3Dfindit, nebo portál výrobce); jiný zdroj u jednoho souboru:
přípona jména „@<zdroj>“, např. TA1_vfd@siemens.stp → manual-siemens (párování podle části před „@“).
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import quote

HERE = Path(__file__).resolve().parent
if __package__:
    from . import models_index as MI  # noqa: E402
else:  # spuštění jako skript
    sys.path.insert(0, str(HERE))
    import models_index as MI  # noqa: E402

RUN_FC = Path(os.environ.get("PRO3D_RUN_FC") or Path.home() / ".claude" / "skills" / "freecad-instance" / "run_fc.ps1")
DEFAULT_SLOT = "pro3d-dl"
DAILY_CAP = 45          # náš strop / den (fair use CADENAS 50 — rezerva, stejně jako tools/quota.py)
FAIR_USE = 50
STEP_EXT = (".stp", ".step")
NOWIN = getattr(subprocess, "CREATE_NO_WINDOW", 0)
TDF = "https://www.3dfindit.com/en/digitaltwin/?path="

# --- výrobci a portály ---------------------------------------------------------------------------------------
# key -> název, odkaz na produkt ({code} = objednací kód) nebo stránka k hledání, zda doporučit místo 3Dfindit
# a poznámka. Doporučení „portál“ jen tam, kde portál výrobce nespotřebuje download tickets CADENAS a model
# dává přímo výrobce (podmínky portálů: README, oddíl „Portály výrobců — podmínky“).
VENDORS = {
    "siemens": {"name": "Siemens", "portal": True,
                "url": "https://sieportal.siemens.com/en-ww/products-services/detail/{code}",
                "note": "SiePortal (dříve Industry Mall) → produkt → „CAx data“ / CAx Download Manager (víc obj. čísel "
                        "najednou do jednoho ZIP, objednací čísla jednotlivě); po registraci; jen interní použití. "
                        "Nespotřebuje tickety 3Dfindit."},
    "rittal": {"name": "Rittal", "portal": False, "url": "https://www.rittal.com/",
               "note": "rittal.com → CAD přes rittal.partcommunity.com = CADENAS (stejné podmínky i limit); 3Dfindit má přesnou variantu"},
    "festo": {"name": "Festo", "portal": False, "url": "https://www.festo.com/cz/cs/a/{code}/",
              "note": "festo.com → produkt → CAD (katalog CADENAS eCATALOG — stejné podmínky jako 3Dfindit)"},
    "ifm": {"name": "ifm electronic", "portal": False, "url": "https://www.ifm.com/cz/cs/product/{code}",
            "note": "ifm.com — CAD ke stažení na produktové stránce neověřen; 3Dfindit má přesnou shodu"},
    "werma": {"name": "Werma", "portal": False, "url": "https://www.werma.com/",
              "note": "werma.com download centrum CAD nenabízí; 3Dfindit má přesnou variantu"},
    "phoenix": {"name": "Phoenix Contact", "portal": True, "url": "https://www.phoenixcontact.com/",
                "note": "phoenixcontact.com → produkt (číslo výrobku) → Downloads → CAD data (STEP); CAD jen pro vlastní použití"},
    "wago": {"name": "WAGO", "portal": False, "url": "https://www.wago.com/",
             "note": "wago.com → CAD přes wago.partcommunity.com = CADENAS (stejné podmínky)"},
    "smc": {"name": "SMC", "portal": False, "url": "https://www.smc.eu/",
            "note": "smc.eu → produkt → CAD (knihovna CADENAS — stejné podmínky jako 3Dfindit)"},
    "sick": {"name": "SICK", "portal": True, "url": "https://www.sick.com/",
             "note": "sick.com → hledat obj. č. → produkt → Downloads → CAD (3Dfindit SICK nenašel)"},
    "balluff": {"name": "Balluff", "portal": True, "url": "https://www.balluff.com/",
                "note": "balluff.com → hledat obj. kód → produkt → CAD"},
    "ross": {"name": "ROSS Controls", "portal": True, "url": "https://www.rosscontrols.com/",
             "note": "rosscontrols.com → produkt → CAD"},
    "jsp": {"name": "JSP", "portal": True, "url": "https://www.jsp.cz/",
            "note": "jsp.cz — výkres / model na vyžádání u výrobce, jinak zástupný model"},
    "lukas": {"name": "LUKAS TENZO", "portal": True, "url": "https://www.lukas-tenzo.cz/",
              "note": "model na vyžádání u výrobce, jinak zástupný model"},
}

# pořadí důležitosti pro pilot: rozvaděč, velké polní díly, velké přístroje rozvaděče, DIN lišta, malé polní
PRIORITY = {
    "cabinet": 0,
    "linear_axis": 1, "gearmotor": 1, "motor": 1, "servo_motor": 1, "two_hand_station": 1, "light_curtain": 1,
    "cylinder": 1, "beacon": 1, "load_cell": 1, "analog_sensor": 1,
    "vfd": 2, "servo_drive": 2, "positioning_drive": 2, "plc_hmi": 2, "main_switch": 2,
    "safety_controller": 3, "plc_cpu": 3, "plc_di": 3, "plc_do": 3, "plc_ai": 3, "plc_ao": 3,
    "power_supply_24v": 3, "motor_protection": 3, "contactor": 3, "contactor_mirror": 3, "mcb": 3,
    "terminal_block": 3, "safety_relay": 3,
}
PRIORITY_DEFAULT = 4
PRIORITY_LABEL = {0: "rozvaděč", 1: "velký polní díl", 2: "velký přístroj rozvaděče", 3: "DIN lišta",
                  4: "malý polní díl"}


def vendor_key(brand: str) -> str:
    b = (brand or "").lower()
    for k in VENDORS:
        if k in b:
            return k
    return re.sub(r"[^a-z0-9]+", "", b.split("(")[0].split("/")[0]) or "vyrobce"


def norm_code(s: str) -> str:
    return re.sub(r"[^0-9a-z]", "", (s or "").lower())


def is_cable(p: dict) -> bool:
    return (p.get("category") or "").startswith("cable")


def group_key(p: dict) -> tuple:
    """Řádky se stejným výrobcem a kódem sdílejí jeden model; bez kódu = vlastní řádek."""
    c = norm_code(p.get("orderCode", ""))
    return (vendor_key(p.get("brand", "")), c) if c else ("", p["id"])


def short(s: str, n: int = 80) -> str:
    s = " ".join((s or "").split())
    return s if len(s) <= n else s[: n - 1] + "…"


# --- známé odkazy na 3Dfindit (jen z dřívějších dat na disku, nic se nehledá) ---------------------------------
def known_links(pilot_root: Path) -> dict:
    """(vendor, kód) -> {url, lineId, typecode, src}: resolve_*.json (best u „nalezeno“), kandidáti ke schválení,
    záznamy 3dfindit v models/index.json. Žádný dotaz na síť."""
    out: dict = {}

    def put(brand, code, url, line, typecode, src):
        k = (vendor_key(brand), norm_code(code))
        if k[1] and url and k not in out:
            out[k] = {"url": url, "lineId": line, "typecode": typecode or "", "src": src}

    for rp in sorted(pilot_root.glob("*/resolve_*.json")):
        try:
            r = json.loads(rp.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        for p in r.get("parts", []):
            b = p.get("best") or {}
            if p.get("status") == "nalezeno" and b.get("url"):
                put(p.get("brand"), p.get("orderCode"), b["url"], b.get("lineId"), b.get("typecode"), rp.name)
    kp = pilot_root / "kandidati_ke_schvaleni.json"
    if kp.is_file():
        try:
            k = json.loads(kp.read_text(encoding="utf-8"))
        except ValueError:
            k = {}
        for c in k.get("candidates", []):
            if c.get("path"):
                put(c.get("brand"), c.get("orderCode"), TDF + quote(c["path"], safe=""), c.get("lineId"),
                    c.get("type", "").split(" ")[0], kp.name)
    for ip in sorted(pilot_root.glob("*/models/index.json")):
        try:
            idx = json.loads(ip.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        for e in idx.get("parts", {}).values():
            if e.get("source") == "3dfindit" and e.get("url"):
                m = re.search(r"\{LINEID=(\d+)\}", e.get("mident", ""))
                put(e.get("brand"), e.get("orderCode"), e["url"], int(m.group(1)) if m else None,
                    e.get("typecode"), str(ip.relative_to(pilot_root)))
    return out


# --- plán ručního stahování ---------------------------------------------------------------------------------
def manual_dir(models_dir: Path) -> Path:
    return Path(models_dir) / "manual"


def plan_project(manifest: dict, models_dir: Path, links: dict) -> list[dict]:
    """Jeden záznam = jeden soubor ke stažení. Čistá funkce (test)."""
    models_dir = Path(models_dir)
    idx = MI.load(models_dir) if (models_dir / "index.json").is_file() else {"parts": {}}
    groups: dict = {}
    order = []
    for p in manifest.get("parts", []):
        if is_cable(p):
            continue
        k = group_key(p)
        if k not in groups:
            groups[k] = {"parts": []}
            order.append(k)
        groups[k]["parts"].append(p)
    rows = []
    for k in order:
        parts = groups[k]["parts"]
        first = parts[0]
        vk = vendor_key(first.get("brand", ""))
        v = VENDORS.get(vk, {"name": first.get("brand", ""), "portal": True, "url": "", "note": "portál výrobce"})
        code = first.get("orderCode") or ""
        link = links.get((vk, norm_code(code))) if code else None
        if not code:
            where = "doplnit kód"
        elif v.get("portal") or not link:
            where = vk
        else:
            where = "3dfindit"
        u = v.get("url") or ""
        if code:
            vurl = u.replace("{code}", quote(code, safe="-."))
        else:  # bez kódu jen kořen portálu (https://host/)
            m = re.match(r"https?://[^/]+/", u)
            vurl = m.group(0) if m else u
        fname = MI.safe_name(first["id"]) + ".stp"
        # stav: ruční soubor kteréhokoli řádku skupiny, nebo model výrobce v indexu pro všechny řádky
        man = manual_dir(models_dir)
        have_manual = [f for f in (man.glob("*") if man.is_dir() else [])
                       if f.suffix.lower() in STEP_EXT and _stem_base(f).lower() in
                       {MI.safe_name(p["id"]).lower() for p in parts}]
        entries = [idx["parts"].get(p["id"]) or {} for p in parts]
        if have_manual and all(MI.is_vendor_model(e) and e.get("source", "").startswith(MI.MANUAL_PREFIX)
                               for e in entries):
            status = "staženo, zaevidováno"
        elif have_manual:
            status = "staženo, NEZAEVIDOVÁNO (spusť register)"
        elif all(e.get("source") == "3dfindit" and (models_dir / e.get("file", "")).is_file() for e in entries):
            status = "máme (3Dfindit skriptem, před pozastavením)"
        elif not code:
            status = "chybí — bez kódu"
        else:
            status = "chybí"
        prio = PRIORITY.get(first.get("category", ""), PRIORITY_DEFAULT)
        rows.append({
            "partId": first["id"], "partIds": [p["id"] for p in parts], "tag": first.get("tag", ""),
            "category": first.get("category", ""), "label": first.get("label", ""), "type": first.get("type", ""),
            "brand": first.get("brand", ""), "vendor": vk, "orderCode": code, "qty": sum(int(p.get("qty") or 1) for p in parts),
            "where": where, "source": "manual-3dfindit" if where == "3dfindit" else f"manual-{vk}",
            "tdf": link, "vendorUrl": vurl, "vendorNote": v.get("note", ""),
            "file": fname, "dir": str(man), "status": status, "priority": prio,
        })
    rows.sort(key=lambda r: r["priority"])  # stabilní: v rámci skupiny pořadí manifestu
    return rows


def assign_days(rows_by_project: list[tuple[str, list[dict]]], cap: int = DAILY_CAP) -> int:
    """Den stažení jen pro řádky 3Dfindit, které chybí (portály výrobců tickety CADENAS nespotřebují)."""
    n = 0
    for _, rows in rows_by_project:
        for r in rows:
            r["day"] = None
            if r["where"] == "3dfindit" and r["status"].startswith("chybí"):
                n += 1
                r["day"] = math.ceil(n / cap)
    return n


def _stem_base(f: Path) -> str:
    return f.stem.split("@", 1)[0]


HOWTO = """\
## Postup (ručně v prohlížeči — žádné skripty)

Podmínky CADENAS čl. 12.3 (vii) zakazují automatizované hledání i stahování; ruční stažení přihlášeným
uživatelem je v pořádku (fair use **50 stažení / den** na účet, čl. 2; držíme se **{cap} / den** jako rezerva).
Modely jen k tomuto projektu (čl. 8 (1)) — nic do sdílené knihovny, nic k trénování AI (čl. 2).

### A) 3Dfindit (řádky se zdrojem „3Dfindit“)

1. Otevři https://www.3dfindit.com a **přihlas se** (vpravo nahoře „Login“, účet CADENAS / PARTcommunity).
2. Klikni na odkaz v tabulce (sloupec „Kde“) — otevře se produkt (digitaltwin). Bez odkazu: do hledání napiš
   **objednací kód** a otevři výsledek **výrobce z tabulky** (pozor na modely třetích stran se stejným kódem).
3. **Vyber variantu:** v tabulce variant najdi řádek s **objednacím kódem** z tabulky (u Festo číslo dílu,
   u Siemens kód bez mezer, Werma 649.240.05). Kde je uvedeno LINEID, je to pořadí řádku tabulky variant
   z dřívějšího vyhledání (kontrola, že jde o stejný řádek — rozhoduje objednací kód).
4. **CAD download** → formát **STEP AP214** (neutrální formát; ne AP203 / AP242, ne „STEP AP214 (asm)“ pokud je
   na výběr jednodílný). Potvrď generování, stáhni ZIP / STEP.
5. Z ZIPu vyber soubor `.stp` / `.step` a **ulož ho pod přesným názvem ze sloupce „Soubor“** do cílové složky
   (`pilot\\<n>\\models\\manual\\`). Ostatní soubory ZIPu (PDF, obrázky) neukládej.
6. Hotovo za den: spusť `register` (níže); seznam přegeneruj příkazem `todo` — stav se změní na „staženo“.

### B) Portál výrobce (řádky se zdrojem výrobce)

- **Siemens** — SiePortal (odkaz v tabulce) → přihlásit (bezplatný účet Siemens) → produkt → **CAx data** → 3D
  model **STEP**. Víc kódů najednou: **CAx Download Manager** (seznam objednacích čísel → jeden ZIP). Z balíku
  ulož 3D STEP každého kódu pod názvem ze sloupce „Soubor“. Tickety 3Dfindit to nespotřebuje.
- **Ostatní** — stránka výrobce → hledat objednací kód → Downloads / CAD → STEP (AP214, je-li na výběr).
- Jiný zdroj, než doporučuje tabulka (např. Siemens díl přece jen z 3Dfindit): ulož jako `<Soubor bez .stp>@3dfindit.stp`
  (nebo `@<výrobce>`) — `register` zapíše skutečný zdroj.

### C) Zaevidování

```bat
set PY=C:\\Users\\podlenat\\AppData\\Local\\Programs\\Python\\Python311\\python.exe
%PY% tools\\register_manual.py register pilot\\<n>\\PLCdesk_CAD_<n>.json pilot\\<n>\\models --by "Tvoje jméno"
%PY% tools\\register_manual.py todo --pilot-root pilot --pilots 11,17,26
```

`register` ověří každý soubor ve FreeCADu (vlastní instance přes skill freecad-instance, timeout), zapíše ho do
`models\\index.json` (zdroj `manual-3dfindit` / `manual-<výrobce>`, datum, kdo) místo zástupného modelu a stejný
soubor přiřadí i ostatním řádkům se stejným výrobcem a kódem (sloupec „Další řádky“).
"""


def render_todo(rows_by_project: list[tuple[str, list[dict], dict]], total_tdf: int, created: str) -> str:
    L = ["# Modely ke stažení ručně — pilot 11, pak 17 a 26", "",
         f"Vygenerováno {created} nástrojem `tools/register_manual.py todo` z manifestů `pilot/<n>/PLCdesk_CAD_<n>.json`, "
         "dřívějších výsledků `resolve_11.json`, `kandidati_ke_schvaleni.json` a `models/index.json` (nic se nehledalo "
         "ani nestahovalo). Po stažení a `register` seznam přegeneruj — sloupec Stav se aktualizuje.", "",
         "Jeden řádek = jeden soubor: řádky kusovníku se stejným výrobcem a objednacím kódem v projektu sdílejí model "
         "(stahuje se jednou). Kabely model nemají. Každý projekt má vlastní složku `models/` (modely se mezi projekty "
         "nesdílejí — podmínky CADENAS čl. 8 (1), README).", ""]
    L += ["## Souhrn", "", "| Pilot | Souborů celkem | 3Dfindit chybí | portál výrobce chybí | bez kódu | staženo / máme |",
          "|---|---|---|---|---|---|"]
    for n, rows, _ in rows_by_project:
        miss = [r for r in rows if r["status"].startswith("chybí")]
        L.append(f"| {n} | {len(rows)} | {sum(1 for r in miss if r['where'] == '3dfindit')} | "
                 f"{sum(1 for r in miss if r['where'] not in ('3dfindit', 'doplnit kód'))} | "
                 f"{sum(1 for r in miss if r['where'] == 'doplnit kód')} | "
                 f"{sum(1 for r in rows if not r['status'].startswith('chybí'))} |")
    days = math.ceil(total_tdf / DAILY_CAP) if total_tdf else 0
    L += ["", f"3Dfindit celkem **{total_tdf}** stažení → **{days} dní** při {DAILY_CAP} / den (fair use CADENAS "
          f"{FAIR_USE} / den na účet; sloupec „Den“). Portály výrobců tickety CADENAS nespotřebují "
          "(Festo / SMC portál je katalog CADENAS — viz README, oddíl Portály výrobců).", ""]
    L.append(HOWTO.format(cap=DAILY_CAP))
    for n, rows, meta in rows_by_project:
        L += [f"## Pilot {n} — {meta.get('name', '')}", "",
              f"Cílová složka: `pilot\\{n}\\models\\manual\\` · manifest `pilot/{n}/PLCdesk_CAD_{n}.json`", "",
              "| # | Den | Důležitost | Díl (partId) | Popis | Výrobce | Obj. kód | Kde | Varianta | Soubor | Další řádky | Stav |",
              "|---|---|---|---|---|---|---|---|---|---|---|---|"]
        for i, r in enumerate(rows, 1):
            if r["where"] == "3dfindit":
                t = r["tdf"]
                kde = f"[3Dfindit]({t['url']})" + (f" · alt. [{VENDORS.get(r['vendor'], {}).get('name', r['brand'])}]({r['vendorUrl']})"
                                                    if r["vendorUrl"] else "")
                var = (f"LINEID {t['lineId']}" if t.get("lineId") else "") + (f" · {t['typecode']}" if t.get("typecode") else "")
            elif r["where"] == "doplnit kód":
                kde = "nejdřív vybrat typ a kód v PLCdesk (krok Kusovník)"
                if r["vendorUrl"]:
                    kde += f"; pak [{VENDORS.get(r['vendor'], {}).get('name', r['brand'])}]({r['vendorUrl']})"
                if r["vendor"] == "siemens" and r["category"] == "gearmotor":
                    kde += " (SIMOGEAR jen v DT Configuratoru v SiePortal — na 3Dfindit není)"
                var = ""
            else:
                kde = f"[{VENDORS.get(r['vendor'], {}).get('name', r['brand'])}]({r['vendorUrl']})" if r["vendorUrl"] else r["brand"]
                if r["tdf"]:
                    kde += f" · alt. [3Dfindit]({r['tdf']['url']})"
                var = "objednací kód" + (f" (3Dfindit LINEID {r['tdf']['lineId']})" if r["tdf"] and r["tdf"].get("lineId") else "")
            others = ", ".join(f"`{p}`" for p in r["partIds"][1:]) or "—"
            desc = short(f"{r['label']}: {r['type']}", 90).replace("|", "/")
            L.append(f"| {i} | {r.get('day') or '—'} | {PRIORITY_LABEL[r['priority']]} | `{r['partId']}` ({r['tag']}) | {desc} | "
                     f"{r['brand']} | {r['orderCode'] or '—'} | {kde} | {var or '—'} | `{r['file']}` | {others} | {r['status']} |")
        L.append("")
        notes = sorted({(VENDORS.get(r['vendor'], {}).get('name', r['brand']), r['vendorNote'])
                        for r in rows if r['where'] not in ('3dfindit',) and r['vendorNote']})
        if notes:
            L += ["Portály:", ""] + [f"- **{a}** — {b}" for a, b in notes] + [""]
    L += ["Formát u všech: **STEP AP214** (`.stp`). Siemens CAx dodává STEP v ZIP — rozbalit a přejmenovat.", ""]
    return "\n".join(L)


def cmd_todo(a) -> int:
    root = Path(a.pilot_root)
    links = known_links(root)
    created = dt.datetime.now().strftime("%Y-%m-%d %H:%M")
    by_proj = []
    for n in [x.strip() for x in a.pilots.split(",") if x.strip()]:
        mp = root / n / f"PLCdesk_CAD_{n}.json"
        if not mp.is_file():
            mp = root / f"PLCdesk_CAD_{n}.json"
        m = json.loads(mp.read_text(encoding="utf-8"))
        rows = plan_project(m, root / n / "models", links)
        by_proj.append((n, rows, m.get("project", {})))
    total = assign_days([(n, r) for n, r, _ in by_proj])
    out = Path(a.out or root / "STAHNOUT_RUCNE.md")
    out.write_text(render_todo(by_proj, total, created), encoding="utf-8")
    for n, rows, _ in by_proj:
        miss = sum(1 for r in rows if r["status"].startswith("chybí"))
        print(f"pilot {n}: {len(rows)} souborů, chybí {miss}")
    print(f"3Dfindit k ručnímu stažení: {total} → {out}")
    return 0


# --- registrace ---------------------------------------------------------------------------------------------
def step_info(f: Path) -> dict:
    """Rychlá kontrola bez FreeCADu: STEP hlavička, schéma, ZIP omylem uložený jako .stp."""
    head = f.read_bytes()[:8192]
    if head[:2] == b"PK":
        return {"ok": False, "error": "soubor je ZIP — rozbalit a uložit jen .stp"}
    txt = head.decode("latin-1", "replace")
    if "ISO-10303-21" not in txt:
        return {"ok": False, "error": "není STEP (chybí hlavička ISO-10303-21)"}
    m = re.search(r"FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'", txt)
    schema = (m.group(1) if m else "").upper()
    fmt = ("STEP AP214" if "AUTOMOTIVE_DESIGN" in schema else
           "STEP AP242" if "AP242" in schema else
           "STEP AP203" if "CONFIG_CONTROL_DESIGN" in schema or "AP203" in schema else
           f"STEP ({schema or 'schéma neuvedeno'})")
    return {"ok": True, "format": fmt, "schema": schema}


def sha256(f: Path) -> str:
    h = hashlib.sha256()
    with open(f, "rb") as fh:
        for b in iter(lambda: fh.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def match_files(manifest: dict, models_dir: Path) -> tuple[dict, list[str], list[dict]]:
    """-> ({soubor: {partIds, explicit, src}}, nespárované soubory, přiřazení partId -> soubor)."""
    man = manual_dir(models_dir)
    files = sorted(f for f in (man.iterdir() if man.is_dir() else []) if f.is_file() and f.suffix.lower() in STEP_EXT)
    parts = [p for p in manifest.get("parts", []) if not is_cable(p)]
    by_safe = {MI.safe_name(p["id"]).lower(): p for p in parts}
    by_group: dict = {}
    for p in parts:
        by_group.setdefault(group_key(p), []).append(p)
    explicit, unmatched, srcs = {}, [], {}
    for f in files:
        base = _stem_base(f).lower()
        src = f.stem.split("@", 1)[1].strip().lower() if "@" in f.stem else ""
        p = by_safe.get(base)
        if not p:
            unmatched.append(f.name)
            continue
        if p["id"] in explicit:     # dvě přípony téhož dílu (a.stp a a@x.stp) -> první podle jména
            unmatched.append(f.name + " (duplicitní k " + explicit[p["id"]].name + ")")
            continue
        explicit[p["id"]] = f
        srcs[f.name] = src
    assign = {}
    for pid, f in explicit.items():
        assign[pid] = (f, True)
    for pid, f in explicit.items():
        p = next(x for x in parts if x["id"] == pid)
        k = group_key(p)
        if k[0] == "":
            continue
        for q in by_group[k]:
            assign.setdefault(q["id"], (f, False))
    out: dict = {}
    for pid, (f, ex) in assign.items():
        o = out.setdefault(f.name, {"path": f, "partIds": [], "explicit": [], "src": srcs.get(f.name, "")})
        o["partIds"].append(pid)
        if ex:
            o["explicit"].append(pid)
    return out, unmatched, files


def source_for(src_suffix: str, default_where: str, cli_source: str | None) -> str:
    if src_suffix:
        s = re.sub(r"[^a-z0-9]+", "", src_suffix.lower().removeprefix("manual-"))
        return f"manual-{s}"
    if cli_source:
        return cli_source if cli_source.startswith(MI.MANUAL_PREFIX) else MI.MANUAL_PREFIX + cli_source
    return default_where


def _powershell() -> str:
    return shutil.which("pwsh") or shutil.which("powershell.exe") or "powershell.exe"


def measure_fc(files: list[Path], timeout: float, slot: str) -> dict:
    """FreeCAD headless POVINNĚ přes skill freecad-instance (run_fc.ps1): vlastní slot, tvrdý timeout,
    úklid jen vlastních PID. -> {str(soubor): {ok, solids, volume_mm3, bbox_mm, bbox | error}}."""
    if not files:
        return {}
    if not RUN_FC.is_file():
        raise RuntimeError(f"chybí spouštěč skillu freecad-instance: {RUN_FC}")
    base = [_powershell(), "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(RUN_FC)]
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "check.json"
        cmd = base + ["run", "--slot", slot, "--timeout", str(int(timeout)),
                      str(HERE / "check_step.py"), str(out)] + [str(f) for f in files]
        summary = {}
        try:
            pr = subprocess.run(cmd, capture_output=True, timeout=timeout + 180, creationflags=NOWIN)
            lines = [ln for ln in pr.stdout.decode("utf-8", "replace").splitlines() if ln.strip()]
            try:
                summary = json.loads(lines[-1]) if lines else {}
            except ValueError:
                summary = {"error": lines[-1][:300] if lines else "bez výstupu"}
        except subprocess.TimeoutExpired:
            summary = {"timed_out": True}
        finally:
            if summary.get("timed_out") or summary.get("leftover") or not summary:
                # jen vlastní slot: run_fc zavře výhradně PID zapsané v <slot>\pids
                subprocess.run(base + ["cleanup", "--slot", slot], capture_output=True, timeout=120, creationflags=NOWIN)
        if summary.get("timed_out"):
            raise RuntimeError(f"FreeCAD překročil {timeout} s (slot {slot}) — ukončen jen vlastní proces")
        try:
            res = json.loads(out.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            raise RuntimeError("FreeCAD nevrátil výsledek: " + str(summary.get("error") or summary)[:400])
    return res


def register(manifest: dict, models_dir: Path, by: str, *, links: dict | None = None,
             cli_source: str | None = None, measure=None, now: str | None = None,
             dry_run: bool = False, force: bool = False, timeout: float = 600, slot: str = DEFAULT_SLOT,
             plan: list[dict] | None = None) -> dict:
    """``plan`` = řádky seznamu ke stažení (``partIds``, ``source``, ``vendorUrl``, volitelně ``tdf``) — výchozí
    ``plan_project`` stagingu."""
    models_dir = Path(models_dir)
    now = now or dt.datetime.now().isoformat(timespec="seconds")
    rows = plan if plan is not None else plan_project(manifest, models_dir, links or {})
    plan = {pid: r for r in rows for pid in r["partIds"]}
    matched, unmatched, _ = match_files(manifest, models_dir)
    idx = MI.load(models_dir, manifest.get("project"))
    parts = {p["id"]: p for p in manifest.get("parts", [])}
    rep = {"registered": [], "unchanged": [], "rejected": [], "unmatched": unmatched, "missing": []}

    # 1) rychlá kontrola + co je nového
    todo, info, hashes = [], {}, {}
    for name, m in matched.items():
        f = m["path"]
        si = step_info(f)
        info[name] = si
        if not si["ok"]:
            rep["rejected"].append({"file": name, "partIds": m["partIds"], "why": si["error"]})
            continue
        hashes[name] = sha256(f)
        rel = MI.rel(models_dir, f)
        fresh = [pid for pid in m["partIds"]
                 if force or not ((idx["parts"].get(pid) or {}).get("file") == rel
                                  and (idx["parts"].get(pid) or {}).get("sha256") == hashes[name])]
        if fresh:
            todo.append(name)
        else:
            rep["unchanged"].extend(m["partIds"])
    # 2) FreeCAD — jeden běh pro všechny nové soubory
    meas = {}
    if todo:
        fn = measure or (lambda fs: measure_fc(fs, timeout, slot))
        raw = fn([matched[n]["path"] for n in todo])
        for n in todo:
            meas[n] = raw.get(str(matched[n]["path"])) or {"ok": False, "error": "FreeCAD soubor nevrátil"}
    # 3) zápis
    for n in todo:
        m, c = matched[n], meas[n]
        if not (c.get("ok") and (c.get("volume_mm3") or 0) > 0):
            rep["rejected"].append({"file": n, "partIds": m["partIds"],
                                    "why": c.get("error") or f"objem {c.get('volume_mm3')} mm³, těles {c.get('solids')}"})
            continue
        for pid in m["partIds"]:
            p = parts[pid]
            pl = plan.get(pid) or {}
            src = source_for(m["src"], pl.get("source") or "manual-3dfindit", cli_source)
            prev = idx["parts"].get(pid) or {}
            url = ((pl.get("tdf") or {}).get("url") if src == "manual-3dfindit" else pl.get("vendorUrl")) or ""
            e = {
                "source": src, "file": MI.rel(models_dir, m["path"]), "fcstd": None,
                "format": info[n]["format"], "tag": p.get("tag", ""), "category": p.get("category", ""),
                "brand": p.get("brand", ""), "orderCode": p.get("orderCode", ""),
                "url": url, "downloaded": now[:10], "registered": now, "by": by,
                "sha256": hashes[n], "check": {k: c[k] for k in ("ok", "solids", "volume_mm3", "bbox_mm") if k in c},
            }
            if src == "manual-3dfindit" and (pl.get("tdf") or {}).get("lineId"):
                e["lineId"] = pl["tdf"]["lineId"]
            if prev and not prev.get("source", "").startswith(MI.MANUAL_PREFIX):
                e["replaced"] = {"source": prev.get("source"), "file": prev.get("file")}
            elif prev.get("replaced"):
                e["replaced"] = prev["replaced"]
            idx["parts"][pid] = e
            rep["registered"].append({"partId": pid, "file": e["file"], "source": src,
                                      "replaced": (e.get("replaced") or {}).get("source"),
                                      "bbox_mm": e["check"].get("bbox_mm"), "volume_mm3": e["check"].get("volume_mm3"),
                                      "format": e["format"], "shared": pid not in m["explicit"]})
    have = set(rep["unchanged"]) | {r["partId"] for r in rep["registered"]}
    for pid, pl in plan.items():
        if pid not in have and not MI.has_vendor_model(models_dir, idx, pid) and \
                str(pl.get("status", "")).startswith(("chybí", "missing", "library")):
            if pid == pl["partId"]:
                rep["missing"].append({"partId": pid, "file": pl["file"], "where": pl.get("where", "")})
    if not dry_run and rep["registered"]:
        MI.save(models_dir, idx)
    rep["dry_run"] = dry_run
    return rep


def report_md(rep: dict, manifest: dict, models_dir: Path, by: str, now: str) -> str:
    L = [f"# Registrace ručně stažených modelů — {manifest.get('project', {}).get('name', '')}", "",
         f"{now} · zaevidoval: {by} · složka `{manual_dir(models_dir)}`" + (" · **DRY RUN — index nezměněn**" if rep["dry_run"] else ""), "",
         f"Zaevidováno {len(rep['registered'])} řádků · beze změny {len(rep['unchanged'])} · odmítnuto "
         f"{len(rep['rejected'])} souborů · nespárováno {len(rep['unmatched'])} · stále chybí {len(rep['missing'])}", ""]
    if rep["registered"]:
        L += ["| Díl | Soubor | Zdroj | Nahrazeno | Formát | Obálka mm | Objem mm³ |", "|---|---|---|---|---|---|---|"]
        for r in rep["registered"]:
            bb = " × ".join(f"{x:g}" for x in (r["bbox_mm"] or []))
            L.append(f"| `{r['partId']}`{' (sdílený)' if r['shared'] else ''} | `{r['file']}` | {r['source']} | "
                     f"{r['replaced'] or '—'} | {r['format']} | {bb} | {r['volume_mm3']} |")
        L.append("")
    if rep["rejected"]:
        L += ["## Odmítnuto (index beze změny)", ""] + [f"- `{r['file']}` ({', '.join(r['partIds'])}): {r['why']}"
                                                      for r in rep["rejected"]] + [""]
    if rep["unmatched"]:
        L += ["## Nespárované soubory", "", "Jméno musí být `<partId-safe>.stp` ze seznamu STAHNOUT_RUCNE.md "
              "(volitelně `…@<zdroj>.stp`).", ""] + [f"- `{u}`" for u in rep["unmatched"]] + [""]
    if rep["missing"]:
        L += ["## Stále chybí", ""] + [f"- `{m['partId']}` → `{m['file']}` ({m['where']})" for m in rep["missing"]] + [""]
    return "\n".join(L)


def cmd_register(a) -> int:
    mp, models_dir = Path(a.manifest), Path(a.models)
    manifest = json.loads(mp.read_text(encoding="utf-8"))
    pilot_root = Path(a.pilot_root) if a.pilot_root else models_dir.resolve().parent.parent
    now = dt.datetime.now().isoformat(timespec="seconds")
    rep = register(manifest, models_dir, a.by, links=known_links(pilot_root), cli_source=a.source, now=now,
                   dry_run=a.dry_run, force=a.force, timeout=a.timeout, slot=a.slot)
    md = report_md(rep, manifest, models_dir, a.by, now)
    if manual_dir(models_dir).is_dir() and not a.dry_run:
        (manual_dir(models_dir) / "REGISTRACE.md").write_text(md, encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    print(md)
    return 1 if rep["rejected"] else 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("todo", help="seznam modelů ke stažení ručně (Markdown)")
    t.add_argument("--pilot-root", default="pilot")
    t.add_argument("--pilots", default="11,17,26")
    t.add_argument("--out")
    r = sub.add_parser("register", help="zaevidovat models/manual/*.stp do models/index.json")
    r.add_argument("manifest"); r.add_argument("models")
    r.add_argument("--by", required=True, help="kdo modely stáhl / zaevidoval (jméno do indexu)")
    r.add_argument("--source", help="výchozí zdroj místo doporučení seznamu (3dfindit, siemens, …)")
    r.add_argument("--pilot-root", help="kořen s resolve_*.json / kandidáty (výchozí ../.. od models)")
    r.add_argument("--timeout", type=float, default=600)
    r.add_argument("--slot", default=DEFAULT_SLOT, help="slot skillu freecad-instance (vlastní, nesdílet)")
    r.add_argument("--dry-run", action="store_true")
    r.add_argument("--force", action="store_true", help="znovu ověřit a zapsat i nezměněné soubory")
    a = ap.parse_args(argv)
    return cmd_todo(a) if a.cmd == "todo" else cmd_register(a)


if __name__ == "__main__":
    sys.exit(main())
