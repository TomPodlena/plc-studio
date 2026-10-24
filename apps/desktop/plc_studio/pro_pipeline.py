"""PLCdesk PRO — automatický postup 3D agenta (stavový automat, bez Tk).

Fáze a kroky (``UNITS``):

1. **Vstupy z PLCdesk** (bez AI): z projektu přes jádro (most Node ``CoreBridge``, vlastní proces) do složky stroje
   ``PLCdesk_CAD.json`` (cadManifestJson), ``projekt.plcstudio.json``, funkční rozbor ``ROZBOR.md`` (skript skillu
   automatizacni-technika), kusovník ``KUSOVNIK.csv`` (bomCsv), program hardwarové platformy (``program/<plat>/``,
   genFor) + souhrn emulace překladu a běhu ``PROGRAM.md``, ``STAV.md`` (start).
2. **Koncept**: role Koncept → kontrola K5 (role Kontrolor, model nemění) → při VRÁCENO oprava stavitelem a znovu K5,
   nejvýš ``max_rounds`` kol. Neschválený koncept postup ZASTAVÍ (stavba nad ním nemá smysl).
3. **Stavba po částech**: rozvaděč → rám a kryty → moduly → celek + PLM; každá část stavitel → K5, nejvýš
   ``max_rounds`` kol. Neschválená část se zapíše a postup pokračuje další částí.

Stav je v ``pipeline.json`` ve složce stroje (navázání po pádu / zastavení od posledního hotového kroku), log každého
běhu agenta v ``logy/``, na konci ``PREHLED.md``. Běh agentů obstarává ``runner`` (výchozí = Claude Code CLI přes
``pro_agent.AgentRun``; testy podvrhnou). Tk se odsud nevolá — krok ``steps/pro3d.py`` čte ``Pipeline.state`` /
``Pipeline.current`` z hlavního vlákna.

Dávka bez GUI:
    python -m plc_studio.pro_pipeline --sample <projekt.plcstudio.json> --out <složka> [--from-phase X]
        [--max-rounds 3] [--test-safety] [--no-ai] [--model-concept M] [--model-build M] [--model-check M]
        [--turns-concept N] [--turns-build N] [--turns-check N] [--model M (všechny role)] [--budget USD]
        [--parts | --no-parts]   (normalizované díly kódem před stavbou; výchozí jen s AI)

Před stavbou (fáze 3) postup spustí generátory normalizovaných dílů ``pro3d_parts`` (bez AI, FreeCAD ve vlastní
instanci) → ``dily/parts_index.json``; stavitel díly „dle dokumentace“ MUSÍ vložit jako App::Link, zástupné jen zbytek.

Kontroly modelu dělá KÓD (``pro3d_tools``: kolize, souvislost, otvory ISO 13857, kusovník, zástupné díly, STEP, snímky);
stavitel je spouští před odevzdáním, kontrolor K5 nezávisle a verdikt o ně opírá — SCHVÁLENO s chybou v
``<část>/k5_kolo<N>/kontroly.json`` postup sám zneplatní.
"""

from __future__ import annotations

import argparse
import copy
import datetime as _dt
import hashlib
import json
import os
import re
import subprocess
import sys
import threading
import time
from pathlib import Path

from . import pro_agent
from .i18n import N_, _, _n

STATE_FILE = "pipeline.json"
SUMMARY_FILE = "PREHLED.md"
LOG_DIR = "logy"
MAX_ROUNDS = 3
ROZBOR_SCRIPT = pro_agent.SKILLS_DIR / "automatizacni-technika" / "scripts" / "rozbor_zadani.py"
TEST_MARK = "TEST – schválení předpokládáno"

PHASES = (("inputs", N_("Vstupy z PLCdesk")), ("concept", N_("Koncept")), ("build", N_("Stavba")))
# krok: (klíč, fáze, popisek, podsložka, předmět kontroly K5, skilly)
UNITS = (
    ("inputs", "inputs", N_("Vstupy z PLCdesk"), "", "", ()),
    ("concept", "concept", N_("Koncept"), "koncept", "koncept", ("automatizacni-technika", "konstrukce-pracoviste-3d")),
    ("cabinet", "build", N_("Rozvaděč"), "rozvadec", "rozvadec", ("rozvadec-3d",)),
    ("frame", "build", N_("Rám a kryty"), "ram", "ram", ("alutech-profily", "ramy-a-kryty", "bezpecnost-stroju")),
    ("modules", "build", N_("Moduly (pohony, pneumatika, držáky, kabely)"), "moduly", "moduly",
     ("pohony-a-vedeni", "festo-pneumatics", "pneumatic-assemblies", "konstrukce-pracoviste-3d")),
    ("assembly", "build", N_("Celek a PLM"), "celek", "celek", ("konstrukce-pracoviste-3d", "freecad-api")),
)
UNIT_KEYS = tuple(u[0] for u in UNITS)
AI_UNITS = UNIT_KEYS[1:]
UNIT = {u[0]: {"phase": u[1], "label": u[2], "sub": u[3], "subject": u[4], "skills": u[5]} for u in UNITS}

# stavy kroku: waiting (čeká), running (běží), review (kolo kontroly), approved / rejected / done / stopped / failed
STATE_LABELS = {
    "waiting": N_("čeká"), "running": N_("běží"), "review": N_("kontrola K5, kolo {n}"),
    "approved": N_("schváleno"), "rejected": N_("neschváleno"), "done": N_("hotovo"),
    "stopped": N_("zastaveno"), "failed": N_("chyba"), "skipped": N_("bez AI (vynecháno)"),
}
FINAL = frozenset({"approved", "rejected", "done"})

# --- pravidla a šablony pokynů (česky, jako prompt AI návrháře) ----------------------------------------------

PIPELINE_RULES = """Běžíš v AUTOMATICKÉM postupu PLCdesk PRO (bez uživatele u obrazovky). Navíc platí:
A. Na otázky nikdo neodpoví: chybějící údaj doplň jako rozumný předpoklad, v textu ho označ slovem ODHAD
   (např. „ODHAD: výška pracovní roviny 900 mm — zadání ji neuvádí“) a vypiš ho v sekci „Předpoklady (ODHAD)“ své zprávy.
B. PLCdesk je zdroj pravdy: neshodu s kusovníkem / manifestem neopravuj ve 3D potichu — sepiš ji jako zpětnou vazbu
   {feedback} (formát plcdesk-cad-feedback v1). V automatickém běhu se do PLCdesk NEPOUŽIJE, jen se uvede v přehledu.
C. Sestavy: App::Part pro každou část, opakované díly App::Link s VYPOČTENÝM umístěním (Placement z rozměrů, ne odhadem).
D. Povolené kolize jen šroub × díra / drážka / závit a matice × drážka profilu; ostatní průniky hmot = chyba.
E. Nic ve vzduchu: graf souvislosti (každé těleso se dotýká nosného dílu, cesta až k podlaze / rámu) — ověř výpočtem.
F. Otvory v krytech posuzuj podle ISO 13857 tab. 4 MĚŘENÍM otvoru; voxelová kontrola jen hledá cesty, neschvaluje.
G. Díly s modelem v dily/parts_index.json (stav „dle dokumentace“, generátory kódem) vkládej jako App::Link na jejich
   FCStd. Zástupné díly (bez modelu výrobce i generátoru) barvi oranžově RGB 255,140,0 a označ vlastností
   (např. Placeholder = True).
H. Snímky klíčových míst (iso, půdorys, čelo, detaily vazeb) ulož do {sub}/snimky/ a PROHLÉDNI je před zprávou.
I. FreeCAD jen ve vlastní instanci (skill freecad-instance, vlastní slot), cizí instance nech být; šetři paměť —
   jedna instance FreeCADu najednou, stavby po malých dávkách, po práci instanci zavři.
J. PLM: `plm scan` (C:\\CLAUDE\\freecad_plm, kód PLM neměnit) nejvýš jednou za kolo; registr PLM patří do složky stroje.
K. Modely výrobců neskriptuj z 3Dfindit / CADENAS; jen portály výrobců nebo zástupný díl.
L. Pracuj jen ve složce stroje (aktuální adresář); skilly a PLM jen čti / spouštěj.
{test}"""

TEST_RULE = ("M. TEST: bezpečnostní prvky a funkce považuj pro tento běh za schválené (předpoklad zkoušky postupu). "
             "Každou zprávu a STAV.md označ řádkem „" + TEST_MARK + "“.")

DEFAULT_PROMPTS = {
    "concept": """Navrhni hrubý koncept stroje ve složce {sub}/.
Vstupy: PLCdesk_CAD.json (manifest — zdroj pravdy), ROZBOR.md (funkční rozbor; otázky v něm nikdo nezodpoví → ODHAD),
KUSOVNIK.csv, PROGRAM.md (program a jeho ověření), projekt.plcstudio.json.
1. Z rozboru sepiš funkce stroje, pohyby, zdvihy a takt; chybějící údaje doplň jako ODHAD.
2. Navrhni 2–3 varianty uspořádání (rozvaděč, rám, polní prvky, místo obsluhy, kryty a přístup) se zdůvodněním
   a jednu doporuč.
3. Doporučenou variantu postav ve FreeCADu z jednoduchých obálek (App::Part po celcích, rozměry z manifestu / ODHAD),
   ulož {sub}/Koncept.FCStd a snímky do {sub}/snimky/.
4. Zprávu zapiš do {sub}/KONCEPT.md: varianty, doporučení, rozměry, předpoklady (ODHAD), rizika, otevřené body.""",
    "cabinet": """Postav 3D rozvaděč podle kusovníku PLCdesk (skill rozvadec-3d) ve složce {sub}/.
Vstupy: PLCdesk_CAD.json (díly s location = cabinet, plc.stations, terminals), KUSOVNIK.csv, schválený koncept
koncept/KONCEPT.md. Skříň podle kusovníku; nevejde-li se výbava, NEzvětšuj ji potichu — zpětná vazba (cabinet_too_small).
Ulož {sub}/Rozvadec.FCStd, snímky do {sub}/snimky/, zprávu {sub}/ROZVADEC.md (rozmístění, kontroly, ODHADY, otevřené body).""",
    "frame": """Postav rám a kryty stroje ve složce {sub}/ (skilly alutech-profily, ramy-a-kryty, bezpecnost-stroju).
Vstupy: schválený koncept koncept/KONCEPT.md a Koncept.FCStd, PLCdesk_CAD.json (rozměry zařízení, umístění field),
ROZBOR.md. Rám z profilů s výpočtem (průhyb, stabilita), řezací seznam {sub}/rezaci_seznam.csv, kryty s bezpečnými
vzdálenostmi (ISO 13857 měřením). Ulož {sub}/Ram.FCStd, snímky do {sub}/snimky/, zprávu {sub}/RAM.md.""",
    "modules": """Postav technologické moduly stroje ve složce {sub}/: pohony, pneumatika, držáky snímačů, vedení kabelů a hadic.
Vstupy: PLCdesk_CAD.json (devices, sequence, relations, parts s location = field), KUSOVNIK.csv, rám ram/Ram.FCStd
a koncept. Normalizované díly z dily/ (parts_index.json), díly výrobců z jejich portálů, jinak zástupné. Každý modul jako App::Part s vazbou na rám (nic ve vzduchu).
Ulož {sub}/Moduly.FCStd, snímky do {sub}/snimky/, zprávu {sub}/MODULY.md (moduly, vazby, kontroly, ODHADY).""",
    "assembly": """Slož celek stroje ve složce {sub}/: rozvaděč, rám a kryty, moduly jako App::Link s vypočteným umístěním.
Kontroly celku: kolize (jen povolené), graf souvislosti, kusovník 3D × PLCdesk_CAD.json (každý díl právě jednou),
otvory krytů ISO 13857. PLM (C:\\CLAUDE\\freecad_plm, registr ve složce stroje): init / assign / scan (jednou) / bom / check.
Ulož {sub}/Celek.FCStd, snímky do {sub}/snimky/, zprávu {sub}/CELEK.md (struktura, kontroly, PLM, ODHADY, otevřené body).""",
}

TOOLS_DIR = Path(__file__).resolve().parent / "pro3d_tools"
PARTS_DIR = Path(__file__).resolve().parent / "pro3d_parts"
PARTS_SUB = "dily"
PARTS_SLOT = "pro3d-parts"
TOOLS_SLOT = {"builder": "pro3d-stavitel", "concept": "pro3d-stavitel", "k5": "pro3d-k5"}


def tools_cmd(role: str = "builder") -> str:
    """Příkaz kontrol kódem pro pokyn agenta (prefix ``powershell`` = povolený příkaz Bash / PowerShell)."""
    return (f'powershell -NoProfile -ExecutionPolicy Bypass -File "{TOOLS_DIR / "pro3d.ps1"}"'
            f" <kontrola> <model.FCStd> --slot {TOOLS_SLOT.get(role, 'pro3d-kontroly')}")


BUILD_CHECKS = """Kontroly KÓDEM (povinné, nepiš na ně vlastní měřicí skripty): po každé stavbě / úpravě modelu spusť
  {cmd}   (kontrola = vse, výstup: --out {sub})
a všechny CHYBY z {sub}/KONTROLY.md (kontroly.json) oprav PŘED odevzdáním — kontrolu opakuj, dokud není „Stav: OK“;
varování vypořádej ve zprávě. Kontroly: kolize (povolené jen šroub × díra / závit, matice × drážka), souvislost (podlaha,
díly bez spoje, volná čela profilů), otvory (voxely + měření e / Sr, ISO 13857 tab. 4), kusovník × PLCdesk_CAD.json,
zástupné díly, STEP. Snímky: kontrola = snimky, --out {sub}/snimky --prefix <název> [--detail "díl;díl"].
Konvence modelu, které kontroly čtou: vlastnost Konstrukce_Typ (sroub / matice / podlozka / profil / patka / kryt /
vypln / zona / pomocny / kabel / hadice / dil), nebezpečné zóny jako tělesa Zona_* (Konstrukce_Typ = zona), druhé
polohy pohyblivých dílů Konstrukce_Pohyb = JSON {"nazev": …, "posun": [x, y, z]} nebo {"nazev": …, "otoc": {"osa":
[…], "bod": […], "uhel": …}}, zástupné díly PLCdesk_ModelStatus = placeholder + barva 255,140,0, díly kusovníku
PLCdesk_Id / PLCdesk_Instance (= řádek manifestu)."""

def parts_cmd(role: str = "builder") -> str:
    """Příkaz generátorů normalizovaných dílů pro pokyn agenta."""
    return (f'powershell -NoProfile -ExecutionPolicy Bypass -File "{PARTS_DIR / "pro3d_parts.ps1"}"'
            f" part <díl> … --out {PARTS_SUB}/knihovna --slot {TOOLS_SLOT.get(role, PARTS_SLOT)}")


PARTS_RULES = """Normalizované díly KÓDEM (povinné): {parts}/parts_index.json přiřazuje řádkům manifestu modely FCStd
v {parts}/modely/ (stav „dle dokumentace“ = rozměry z datových listů / norem se zdrojem, vlastnosti Konstrukce_*; souhrn
{parts}/DILY.md). Díl se stavem „dle dokumentace“ MUSÍŠ vložit jako App::Link na jeho FCStd (vlastní model ani zástupnou
obálku nestav, model neměň; PLCdesk_Id / PLCdesk_Instance dej na Link). Zástupnou obálku (pravidlo G) jen pro díly se
stavem „zástupný“ nebo mimo index. Spojovací materiál (ISO 4762 / 7380 / 10642, matice ISO 4032, podložky ISO 7089),
lišty TS35 (EN 60715) a vývodky SKINTOP generuj stejně, např.:
  {cmd}   (díly: "ISO4762 M6x20" "ISO4032 M6" "TS35 7.5x450" "SKINTOP M20" "ISO15552 32x100")
Osy: válce +X (zadní čelo x = 0, pístnice v podčásti „Pistnice“ s Konstrukce_Pohyb), přístroje na lištu a skříňky
X = šířka, Y = hloubka od montážní roviny, panelové přístroje čelo panelu y = 0 (tělo k −Y), šrouby osa −Z od hlavy."""


K5_CHECKS = """Postup kontroly:
1. NEJDŘÍV nezávisle spusť kontroly kódem nad každým modelem části (výsledky stavitele nepřebírej):
   {cmd}   (kontrola = vse, výstup: --out {sub}/k5_kolo{round})
   Čísla převezmi z {sub}/k5_kolo{round}/kontroly.json (souhrn, chyby a varování s polohou, SHA-256 modelu).
2. Ručně (AI) posuď JEN to, co skripty neumí: soulad se zadáním, konceptem a manifestem (funkce, rozměry, umístění),
   vyrobitelnost, montovatelnost a servis, bezpečnostní koncepci (kryty, zóny, přístup — čísla otvorů má skript),
   použití normalizovaných dílů (díl se stavem „dle dokumentace“ v dily/parts_index.json = App::Link na jeho model,
   ne zástupná obálka),
   označené ODHADY a sepsanou zpětnou vazbu; udělej 2–4 snímky (kontrola = snimky, --prefix k5_kolo{round}) a prohlédni je.
3. Verdikt opři o kontroly.json: jakákoli chyba nebo stav SELHALO = VRÁCENO (povinný bod s polohou z kontroly);
   varování posuď. Postup PLCdesk verdikt SCHVÁLENO s chybou v kontroly.json sám zneplatní."""

FIX_PROMPT = """Toto je kolo {round} téže části. Kontrola K5 ji VRÁTILA: {last_k5}.
Přednostně vyřeš všechny povinné body z tohoto protokolu (nic nevynechej, nic nepřidávej navíc), uprav model a zprávu
a v ní doplň oddíl „Kolo {round}“ s vypořádáním každého bodu."""

K5_PROMPT = """Kontrola K5 části „{label}“ (složka {sub}/), kolo {round}. Model NEMĚNÍŠ a nic neopravuješ.
Kontroluj proti ZADÁNÍ a MANIFESTU (PLCdesk_CAD.json, ROZBOR.md, KUSOVNIK.csv, u stavby i schválený koncept), ne proti
zprávě stavitele — tvrzení stavitele si ověř sám.
{checks}
Na začátku i na konci spočítej SHA-256 všech *.FCStd ve složce stroje a uveď je v protokolu (musí se shodovat).
Protokol zapiš do {k5file}: první řádek nadpis, pak řádek „## Verdikt: **SCHVÁLENO**“ nebo „## Verdikt: **VRÁCENO**“,
očíslované povinné body (jen u VRÁCENO) a výhrady."""


def fill(text: str, **kw) -> str:
    """Dosadí ``{klíč}`` (jen známé klíče — složené závorky v textu uživatele zůstanou)."""
    for k, v in kw.items():
        text = text.replace("{" + k + "}", str(v))
    return text


def default_prompt(unit: str) -> str:
    return DEFAULT_PROMPTS[unit]


def k5_file(folder: Path, unit: str, rnd: int) -> Path:
    u = UNIT[unit]
    return folder / u["sub"] / f"KONTROLA_K5_{u['subject']}_kolo{rnd}.md"


def k5_checks(folder: Path, unit: str, rnd: int) -> dict | None:
    """Souhrn kontrol kódem, které spustil kontrolor (``<část>/k5_kolo<N>/**/kontroly.json``): nejhorší stav ze všech
    modelů části (SELHALO > CHYBY > OK), počty a soubor; None = kontrolor kontroly nespustil."""
    base = folder / UNIT[unit]["sub"] / f"k5_kolo{rnd}"
    files = sorted(base.rglob("kontroly.json")) if base.is_dir() else []
    if not files:
        return None
    rank = {"OK": 0, "CHYBY": 1, "SELHALO": 2}
    out = {"stav": "OK", "chyby": 0, "varovani": 0, "file": files[0].relative_to(folder).as_posix(), "modely": []}
    for f in files:
        try:
            s = (json.loads(f.read_text(encoding="utf-8")).get("souhrn") or {})
        except (OSError, ValueError):
            s = {"stav": "SELHALO"}
        st = s.get("stav") if s.get("stav") in rank else "SELHALO"
        if rank[st] > rank[out["stav"]]:
            out["stav"], out["file"] = st, f.relative_to(folder).as_posix()
        out["chyby"] += int(s.get("chyby") or 0)
        out["varovani"] += int(s.get("varovani") or 0)
        out["modely"].append(f.relative_to(folder).as_posix())
    return out


def feedback_file(unit: str) -> str:
    return f"PLCdesk_CAD_feedback_{UNIT[unit]['subject']}.json"


def system_extra(unit: str, test_safety: bool) -> str:
    u = UNIT[unit]
    return fill(PIPELINE_RULES, feedback=feedback_file(unit), sub=u["sub"], test=TEST_RULE if test_safety else "") \
        + "\nSkilly této části: " + ", ".join(u["skills"]) + "."


def builder_prompt(folder: Path, unit: str, rnd: int, template: str = "", extra: str = "", project: str = "",
                   test_safety: bool = False) -> str:
    u = UNIT[unit]
    head = [f"Projekt PLCdesk: {project}" if project else "", f"Složka 3D stroje: {folder}",
            f"Část: {u['label']} (podsložka {u['sub']}/), kolo {rnd}"]
    body = fill(template.strip() or default_prompt(unit), sub=u["sub"], round=rnd)
    body += "\n\n" + fill(BUILD_CHECKS, cmd=tools_cmd("builder"), sub=u["sub"])
    if u["phase"] == "build":
        body += "\n\n" + fill(PARTS_RULES, parts=PARTS_SUB, cmd=parts_cmd("builder"))
    if rnd > 1:
        prev = k5_file(folder, unit, rnd - 1)
        body += "\n\n" + fill(FIX_PROMPT, round=rnd, last_k5=prev.relative_to(folder).as_posix())
    if extra.strip():
        body += "\n\nDoplňující pokyn uživatele:\n" + extra.strip()
    if test_safety:
        body += "\n\n" + TEST_RULE
    body += "\n\nPRŮBĚH: vypisuj řádky „PRŮBĚH k/N: …“ (pravidlo 12)."
    return "\n".join(x for x in head if x) + "\n\n" + body


def k5_prompt(folder: Path, unit: str, rnd: int, project: str = "", test_safety: bool = False) -> str:
    u = UNIT[unit]
    head = [f"Projekt PLCdesk: {project}" if project else "", f"Složka 3D stroje: {folder}"]
    checks = fill(K5_CHECKS, cmd=tools_cmd("k5"), sub=u["sub"], round=rnd)
    body = fill(K5_PROMPT, label=u["label"], sub=u["sub"], round=rnd, checks=checks,
                k5file=k5_file(folder, unit, rnd).relative_to(folder).as_posix())
    if test_safety:
        body += "\n\n" + TEST_RULE
    return "\n".join(x for x in head if x) + "\n\n" + body


def parse_verdict(text: str) -> str:
    """``ok`` / ``back`` / ``""`` z protokolu K5."""
    return pro_agent.verdict_kind(pro_agent.verdict_text(text))


# --- vstupy z PLCdesk (bez AI) --------------------------------------------------------------------------------

def _python() -> str:
    return sys.executable or "python"


def _summary_program(plat: str, label: str, files: dict, comp: dict, run: dict) -> str:
    fnd = comp.get("findings") or []
    cnt = {lv: sum(1 for f in fnd if f.get("level") == lv) for lv in ("error", "warn", "info")}
    sc = run.get("scenarios") or []
    out = [f"# Program PLC — {label} ({plat})", "",
           "Výstup generátoru PLCdesk (`genFor`) hardwarové platformy projektu a jeho kontrola emulátorem PLCdesk.",
           "Emulátor ≠ překladač výrobce — import a překlad ve skutečném IDE je dál nutný.", "",
           "## Soubory (`program/" + plat + "/`)", ""]
    out += [f"- `{n}` ({len(t.encode('utf-8'))} B)" for n, t in sorted(files.items())]
    out += ["", "## Emulace překladu", "",
            f"Výsledek: **{'bez chyb' if comp.get('ok') else 'CHYBY'}** — chyby {cnt['error']}, varování {cnt['warn']}, "
            f"info {cnt['info']}.", ""]
    out += [f"- {f.get('level')}: {f.get('file')}:{f.get('line')} — {f.get('msg')}" for f in fnd[:30]]
    if len(fnd) > 30:
        out.append(f"- … a dalších {len(fnd) - 30}")
    out += ["", "## Emulace běhu (kód × návrh)", ""]
    if run.get("skipped"):
        out.append("Neproběhla: " + str(run["skipped"]))
    else:
        ok = sum(1 for s in sc if s.get("ok"))
        out.append(f"Výsledek: **{'shoda s návrhem' if run.get('ok') else 'ROZDÍLY'}** — scénáře {ok}/{len(sc)}, "
                   f"rozdíly {len(run.get('diffs') or [])}, scanů {run.get('scans', 0)}.")
        out += [f"- ✖ {s.get('label')}" for s in sc if not s.get("ok")][:20]
        out += [f"- rozdíl {d.get('scenario')}: {d.get('signal')} t={d.get('t')} s (návrh {d.get('design')}, kód {d.get('code')})"
                for d in (run.get("diffs") or [])[:20]]
    return "\n".join(out) + "\n"


def make_inputs(folder: str | Path, prj: dict, *, bridge=None, log=print) -> list[str]:
    """Fáze ①: zapíše vstupy z PLCdesk do složky stroje. ``bridge`` = most jádra (výchozí vlastní ``CoreBridge``,
    po dokončení se zavře). Vrací seznam zapsaných souborů (relativně ke složce)."""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    own = bridge is None
    if own:
        from .bridge import CoreBridge
        bridge = CoreBridge()
    written: list[str] = []

    def put(name: str, text: str, enc: str = "utf-8") -> None:
        p = folder / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding=enc, newline="")
        written.append(name)

    try:
        orig = bridge.call("normalizeProject", copy.deepcopy(prj))
        put("projekt.plcstudio.json", json.dumps(orig, ensure_ascii=False, indent=1))
        log(_("Vstupy: manifest pro CAD…"))
        put("PLCdesk_CAD.json", bridge.call("cadManifestJson", orig))
        synced = bridge.mutate("syncIO", copy.deepcopy(orig))
        log(_("Vstupy: kusovník…"))
        put("KUSOVNIK.csv", bridge.call("bomCsv", synced), "utf-8-sig")
        plat = bridge.call("hwPlatform", synced)
        log(_("Vstupy: program {plat} a emulace…", plat=plat))
        files = bridge.call("genFor", synced, plat) or {}
        for name, text in files.items():
            put(f"program/{plat}/{name}", text if isinstance(text, str) else json.dumps(text, ensure_ascii=False))
        comp = bridge.call("emulateCompile", synced, plat) or {}
        seq = ((synced.get("program") or {}).get("seq")) or []
        run = (bridge.call("emulateRunMany", synced, [plat], {"scope": "full" if len(seq) <= 40 else "quick"}) or {}
               ).get(plat) or {}
        label = ((bridge.call("platInfo") or {}).get(plat) or {}).get("name") or plat
        put("PROGRAM.md", _summary_program(plat, label or plat, files, comp, run))
        log(_("Vstupy: funkční rozbor…"))
        if ROZBOR_SCRIPT.is_file():
            r = subprocess.run([_python(), "-I", str(ROZBOR_SCRIPT), str(folder / "PLCdesk_CAD.json"),
                                "--out", str(folder / "ROZBOR.md")], capture_output=True, text=True,
                               encoding="utf-8", errors="replace",
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            if r.returncode == 0 and (folder / "ROZBOR.md").is_file():
                written.append("ROZBOR.md")
            else:
                put("ROZBOR.md", "# Funkční rozbor\n\nSkript rozboru selhal:\n\n```\n" + (r.stdout + r.stderr)[-2000:]
                    + "\n```\n")
        else:
            put("ROZBOR.md", "# Funkční rozbor\n\nSkript " + str(ROZBOR_SCRIPT) + " nenalezen — agent udělá rozbor sám "
                "z PLCdesk_CAD.json.\n")
        if not (folder / "STAV.md").exists():
            name = (orig.get("meta") or {}).get("name") or ""
            put("STAV.md", f"# Stav 3D stroje — {name}\n\nZahájeno automatickým postupem PLCdesk PRO "
                f"{_dt.datetime.now():%Y-%m-%d %H:%M}.\n\n- [x] Vstupy z PLCdesk\n- [ ] Koncept\n- [ ] Rozvaděč\n"
                "- [ ] Rám a kryty\n- [ ] Moduly\n- [ ] Celek a PLM\n")
    finally:
        if own:
            bridge.close()
    return written


def make_parts(folder: str | Path, *, log=print, slot: str = PARTS_SLOT, timeout: int = 1800) -> dict:
    """Normalizované díly kódem (``pro3d_parts gen``) nad ``PLCdesk_CAD.json`` → ``dily/parts_index.json`` + modely FCStd.
    FreeCAD jen ve vlastní instanci (slot ``pro3d-parts``); hotové modely se nepřestavují. Vrací ``{"souhrn", "chyba"}``."""
    folder = Path(folder)
    man = folder / "PLCdesk_CAD.json"
    if not man.is_file():
        return {"souhrn": None, "chyba": "PLCdesk_CAD.json chybí"}
    log(_("Normalizované díly: generátory kódem…"))
    try:
        r = subprocess.run([_python(), "-I", str(PARTS_DIR / "gen.py"), "gen", str(man), str(folder / PARTS_SUB),
                            "--slot", slot, "--timeout", str(timeout)], capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=timeout + 300, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"souhrn": None, "chyba": str(exc)}
    line = next((x for x in reversed((r.stdout or "").splitlines()) if x.startswith("{")), "")
    try:
        res = json.loads(line)
    except ValueError:
        return {"souhrn": None, "chyba": ((r.stdout or "") + (r.stderr or ""))[-1500:] or f"kód {r.returncode}"}
    return {"souhrn": res.get("souhrn"), "chyba": res.get("chyba") or ""}


# --- běh agenta --------------------------------------------------------------------------------------------------

def _usage(result: dict | None) -> dict:
    r = result or {}
    u = r.get("usage") or {}
    return {"cost": float(r.get("total_cost_usd") or 0.0),
            "tin": sum(int(u.get(k) or 0) for k in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")),
            "tout": int(u.get("output_tokens") or 0), "turns": int(r.get("num_turns") or 0),
            "subtype": str(r.get("subtype") or "")}


CONTINUE_PROMPT = ("\n\nPOKRAČOVÁNÍ: předchozí běh téže úlohy vyčerpal limit kol, práce je rozdělaná. "
                   "Nezačínej znovu — přečti STAV.md a výstupy ve složce, dokonči zbývající kroky "
                   "(kontroly pro3d_tools vse, snímky jen chybějící) a odevzdej.")


def _merge_runs(first: dict, second: dict) -> dict:
    """Součet ceny / tokenů / kol / času dvou běhů téže role (pokračování po limitu kol); stav = druhý běh."""
    out = dict(second)
    for k in ("cost", "tin", "tout", "turns", "secs"):
        out[k] = (first.get(k) or 0) + (second.get(k) or 0)
    out["continued"] = int(first.get("continued") or 0) + 1
    return out


def agent_runner(*, model: str = "", budget: float | None = None, exe=None):
    """Výchozí ``runner`` = Claude Code CLI (``pro_agent.AgentRun``), čeká na konec ve volajícím vlákně a průběžně
    zapisuje log. Model a limit kol podle role z ``pipe.model_for`` / ``pipe.turns_for`` (``model`` = jeden pro všechny
    role, starší volba). Vrací funkci ``run(pipe, role, prompt, extra_system, log_path) → dict``."""

    def run(pipe: "Pipeline", role: str, prompt: str, extra_system: str, log_path: Path) -> dict:
        claude = exe or pro_agent.find_claude()
        m = model.strip() or pipe.model_for(role)
        turns = pipe.turns_for(role)
        if claude is None:
            return {"state": "failed", "error": _("Claude Code nenalezen."), "model": m}
        cmd = pipe.command(claude, role, extra_system, model=m, budget=budget)
        ar = pro_agent.AgentRun(cmd, prompt, pipe.folder, role=role)
        pipe.current = ar
        try:
            ar.start()
        except OSError as exc:
            return {"state": "failed", "error": str(exc)}
        with open(log_path, "w", encoding="utf-8") as fh:
            fh.write(f"# {role}\n# {_dt.datetime.now():%Y-%m-%d %H:%M:%S}\n# model {m}, limit kol {turns}\n\n"
                     f"## Pokyn\n{prompt}\n\n## Průběh\n")
            done = False
            while not done:
                for kind, text in ar.drain():
                    if kind == "end":
                        done = True
                    elif kind != "progress":
                        fh.write(f"[{kind}] {text}\n")
                fh.flush()
                if pipe.stop_requested and ar.running():
                    ar.stop()
                time.sleep(0.2)
        return {"state": ar.state, **_usage(ar.result), "secs": round(ar.elapsed()), "model": m, "maxTurns": turns}

    return run


# --- automat -------------------------------------------------------------------------------------------------------

def _now() -> str:
    return _dt.datetime.now().isoformat(timespec="seconds")


def _sha_models(folder: Path) -> dict:
    out = {}
    for p in sorted(folder.rglob("*.FCStd")):
        try:
            out[p.relative_to(folder).as_posix()] = hashlib.sha256(p.read_bytes()).hexdigest()
        except OSError:
            pass
    return out


def blank_state(project: str = "", max_rounds: int = MAX_ROUNDS, test_safety: bool = False) -> dict:
    return {"version": 1, "project": project, "maxRounds": max_rounds, "testSafety": test_safety,
            "models": dict(pro_agent.ROLE_MODELS), "maxTurns": dict(pro_agent.ROLE_TURNS),
            "status": "new", "created": _now(), "updated": _now(), "inputs": [],
            "units": {k: {"state": "waiting", "rounds": []} for k in UNIT_KEYS}}


def load_state(folder: str | Path) -> dict | None:
    p = Path(folder) / STATE_FILE
    try:
        st = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(st, dict) or not isinstance(st.get("units"), dict):
        return None
    for k in UNIT_KEYS:
        st["units"].setdefault(k, {"state": "waiting", "rounds": []})
    return st


def phase_state(st: dict, phase: str) -> tuple[str, int]:
    """Souhrnný stav fáze z jejích kroků: (stav, kolo) — běží / kolo / zastaveno / chyba / neschváleno / schváleno."""
    us = [st["units"][k] for k in UNIT_KEYS if UNIT[k]["phase"] == phase]
    states = [u["state"] for u in us]
    rnd = max((len(u.get("rounds") or []) for u in us), default=0)
    for s in ("running", "review", "stopped", "failed"):
        if s in states:
            cur = next(u for u in us if u["state"] == s)
            return s, len(cur.get("rounds") or [])
    if all(s in FINAL for s in states):
        if "rejected" in states:
            return "rejected", rnd
        return ("done" if phase == "inputs" else "approved"), rnd
    if all(s == "skipped" for s in states):
        return "skipped", 0
    return "waiting", rnd


def state_label(state: str, rnd: int = 0) -> str:
    return _(STATE_LABELS.get(state, state), n=rnd) if state == "review" else _(STATE_LABELS.get(state, state))


def progress(st: dict) -> float:
    """Celkový průběh 0–1: hotové kroky + rozpracované kolo (kolo / max kol, půlka za stavitele)."""
    mx = max(1, int(st.get("maxRounds") or MAX_ROUNDS))
    total = 0.0
    for k in UNIT_KEYS:
        u = st["units"][k]
        if u["state"] in FINAL or u["state"] == "skipped":
            total += 1
        elif u.get("rounds"):
            r = u["rounds"][-1]
            total += min(0.95, (len(u["rounds"]) - 1 + (0.5 if r.get("builder") else 0)) / mx)
    return total / len(UNIT_KEYS)


class Pipeline:
    """Automatický postup nad složkou stroje. ``run()`` běží ve volajícím vlákně (GUI ho pouští ve vlákně na pozadí),
    ``stop()`` smí volat jiné vlákno. ``state`` = obsah ``pipeline.json``; ``current`` = běžící ``AgentRun``."""

    def __init__(self, folder: str | Path, prj: dict, *, max_rounds: int = MAX_ROUNDS, test_safety: bool = False,
                 prompts: dict | None = None, extras: dict | None = None, runner=None, ai: bool = True,
                 inputs_fn=None, log=None, models: dict | None = None, turns: dict | None = None,
                 parts: bool | None = None, parts_fn=None) -> None:
        self.folder = Path(folder)
        self.prj = prj
        self.project = str((prj.get("meta") or {}).get("name") or "")
        self.max_rounds = max(1, int(max_rounds))
        self.test_safety = bool(test_safety)
        self.prompts = prompts or {}
        self.extras = extras or {}
        self.runner = runner
        self.ai = ai
        self.inputs_fn = inputs_fn or make_inputs
        self.parts = ai if parts is None else bool(parts)     # normalizované díly před stavbou (FreeCAD, bez AI)
        self.parts_fn = parts_fn or make_parts
        self.events: list[str] = []
        self._log = log
        self.current = None
        self.stop_requested = False
        self.lock = threading.Lock()
        self.state = load_state(self.folder) or blank_state(self.project, self.max_rounds, self.test_safety)
        self.state["maxRounds"] = self.max_rounds
        self.state["testSafety"] = self.test_safety
        # model a limit kol podle role: výchozí < pipeline.json < volba (krok / CLI)
        st_m = self.state.get("models") if isinstance(self.state.get("models"), dict) else {}
        st_t = self.state.get("maxTurns") if isinstance(self.state.get("maxTurns"), dict) else {}
        self.state["models"] = {r: str((models or {}).get(r) or st_m.get(r) or d).strip()
                                for r, d in pro_agent.ROLE_MODELS.items()}
        self.state["maxTurns"] = {r: max(1, int((turns or {}).get(r) or st_t.get(r) or d))
                                  for r, d in pro_agent.ROLE_TURNS.items()}

    def model_for(self, role: str) -> str:
        return self.state["models"].get(role) or pro_agent.ROLE_MODELS.get(role, "")

    def turns_for(self, role: str) -> int:
        return int(self.state["maxTurns"].get(role) or pro_agent.ROLE_TURNS.get(role, 60))

    def command(self, exe, role: str, extra_system: str, *, model: str | None = None, budget: float | None = None) -> list:
        """Příkaz CLI pro roli: model a limit kol role, pracovní složky skilly, PLM, FreeCAD a nástroje kontrol."""
        fc = pro_agent.find_freecad()
        dirs = [pro_agent.SKILLS_DIR, pro_agent.PLM_DIR, TOOLS_DIR, PARTS_DIR] + ([fc.parent.parent] if fc else [])
        return pro_agent.build_command(exe, role, model=model if model is not None else self.model_for(role), budget=budget,
                                       add_dirs=dirs, extra_system=extra_system, max_turns=self.turns_for(role))

    # --- pomocné ---
    def log(self, text: str) -> None:
        line = f"{_dt.datetime.now():%H:%M:%S} {text}"
        self.events.append(line)
        if self._log:
            self._log(line)

    def save(self) -> None:
        self.state["updated"] = _now()
        self.folder.mkdir(parents=True, exist_ok=True)
        tmp = self.folder / (STATE_FILE + ".tmp")
        tmp.write_text(json.dumps(self.state, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp, self.folder / STATE_FILE)

    def stop(self) -> None:
        self.stop_requested = True
        run = self.current
        if run is not None and hasattr(run, "running") and run.running():
            run.stop()

    def first_open(self) -> str | None:
        return next((k for k in UNIT_KEYS if self.state["units"][k]["state"] not in FINAL), None)

    def reset_from(self, unit: str) -> None:
        """„Spustit od…“: krok ``unit`` a všechny další znovu (předchozí kola zůstanou v ``history``)."""
        i = UNIT_KEYS.index(unit)
        for k in UNIT_KEYS[i:]:
            u = self.state["units"][k]
            if u.get("rounds"):
                u.setdefault("history", []).append({"at": _now(), "state": u["state"], "rounds": u["rounds"]})
            u["state"], u["rounds"] = "waiting", []

    # --- běh ---
    def run(self, from_unit: str | None = None) -> str:
        if from_unit:
            unit = from_unit if from_unit in UNIT else next(k for k in UNIT_KEYS if UNIT[k]["phase"] == from_unit)
            self.reset_from(unit)
        self.stop_requested = False
        self.state["status"] = "running"
        self.save()
        status = "done"
        parts_done = False
        try:
            for key in UNIT_KEYS:
                u = self.state["units"][key]
                if u["state"] in FINAL:
                    continue
                if self.stop_requested:
                    status = "stopped"
                    break
                if UNIT[key]["phase"] == "build" and self.parts and not parts_done:
                    self._parts()
                    parts_done = True
                if key == "inputs":
                    res = self._inputs()
                elif not self.ai:
                    u["state"] = "skipped"
                    self.save()
                    continue
                else:
                    res = self._unit(key)
                if res in ("stopped", "failed"):
                    status = res
                    break
                if key == "concept" and res == "rejected":
                    self.log(_n(self.max_rounds, N_("Koncept neschválen ani po {n} kole — postup zastaven (stavba nad "
                                                 "neschváleným konceptem nemá smysl).|Koncept neschválen ani po {n} "
                                                 "kolech — postup zastaven (stavba nad neschváleným konceptem nemá "
                                                 "smysl).")))
                    status = "rejected"
                    break
            else:
                if not self.ai:
                    status = "noai"
        finally:
            self.current = None
            self.state["status"] = status
            self.save()
            write_summary(self.folder, self.state)
        self.log(_("Postup skončil: {status}.", status=status))
        return status

    def _inputs(self) -> str:
        u = self.state["units"]["inputs"]
        u["state"] = "running"
        u["started"] = _now()
        self.save()
        self.log(_("Fáze 1: vstupy z PLCdesk…"))
        try:
            files = self.inputs_fn(self.folder, self.prj, log=self.log)
        except Exception as exc:  # noqa: BLE001 — chyba jádra se zapíše a postup se zastaví
            u["state"], u["error"] = "failed", str(exc)
            self.log(_("Vstupy selhaly: {exc}", exc=exc))
            self.save()
            return "failed"
        self.state["inputs"] = files
        u["state"], u["finished"] = "done", _now()
        self.log(_n(len(files), N_("Vstupy hotové: {n} soubor.|Vstupy hotové: {n} soubory.|Vstupy hotové: {n} souborů.")))
        self.save()
        return "done"

    def _parts(self) -> None:
        """Před stavbou: normalizované díly kódem; chyba postup nezastaví (stavitel pak staví zástupné)."""
        try:
            res = self.parts_fn(self.folder, log=self.log) or {}
        except Exception as exc:  # noqa: BLE001
            res = {"souhrn": None, "chyba": str(exc)}
        self.state["parts"] = dict(res, at=_now())
        s = res.get("souhrn") or {}
        if s:
            self.log(_("Normalizované díly: dle dokumentace {a} z {n} řádků kusovníku, zástupné {z}.",
                       a=s.get("dle_dokumentace", 0), n=s.get("radku", 0), z=s.get("zastupne", 0)))
        if res.get("chyba"):
            self.log(_("Normalizované díly — chyba: {exc}", exc=res["chyba"]))
        self.save()

    def _agent(self, unit: str, role: str, prompt: str, rnd: int) -> dict:
        logs = self.folder / LOG_DIR
        logs.mkdir(parents=True, exist_ok=True)
        idx = UNIT_KEYS.index(unit)
        path = logs / f"{idx:02d}_{unit}_kolo{rnd}_{role}.log"
        runner = self.runner or agent_runner()
        self.log(_("{part}, kolo {n}: {role}…", part=_(UNIT[unit]["label"]), n=rnd, role=_(dict(pro_agent.ROLES)[role])))
        t0 = time.monotonic()
        res = runner(self, role, prompt, system_extra(unit, self.test_safety), path) or {}
        res.setdefault("secs", round(time.monotonic() - t0))
        res["log"] = path.relative_to(self.folder).as_posix()
        res["role"] = role
        res.setdefault("model", self.model_for(role))
        res.setdefault("maxTurns", self.turns_for(role))
        if self.stop_requested and res.get("state") not in ("failed",):
            res["state"] = "stopped"
        return res

    def _unit(self, key: str) -> str:
        u = self.state["units"][key]
        (self.folder / UNIT[key]["sub"]).mkdir(parents=True, exist_ok=True)
        while True:
            rounds = u["rounds"]
            if not rounds or rounds[-1].get("verdict"):
                if rounds and len(rounds) >= self.max_rounds:
                    u["state"] = "rejected"
                    self.log(_n(len(rounds), N_("{part}: neschváleno po {n} kole.|{part}: neschváleno po {n} kolech."),
                                part=_(UNIT[key]["label"])))
                    self.save()
                    return "rejected"
                rounds.append({"n": len(rounds) + 1, "builder": None, "k5": None, "verdict": "", "file": ""})
            r = rounds[-1]
            n = r["n"]
            if not r["builder"] or r["builder"].get("state") != "done":
                u["state"] = "running"
                self.save()
                role = "concept" if key == "concept" and n == 1 else "builder"
                p = builder_prompt(self.folder, key, n, self.prompts.get(key, ""), self.extras.get(key, ""),
                                   self.project, self.test_safety)
                prev = r["builder"] if r["builder"] and r["builder"].get("subtype") == "error_max_turns" else None
                r["builder"] = self._agent(key, role, p + (CONTINUE_PROMPT if prev else ""), n)
                if prev:                               # navázání po zastavení / pádu uprostřed pokračování
                    r["builder"] = _merge_runs(prev, r["builder"])
                if (r["builder"].get("state") == "failed" and r["builder"].get("subtype") == "error_max_turns"
                        and not self.stop_requested):
                    # limit kol vyčerpán uprostřed práce → jedno pokračování, ne pád celého postupu
                    self.log(_("{part}, kolo {n}: limit kol vyčerpán, pokračuji…", part=_(UNIT[key]["label"]), n=n))
                    self.save()
                    r["builder"] = _merge_runs(r["builder"], self._agent(key, role, p + CONTINUE_PROMPT, n))
                self.save()
                if r["builder"].get("state") != "done":
                    u["state"] = r["builder"].get("state") if r["builder"].get("state") in ("stopped",) else "failed"
                    self.save()
                    return u["state"]
            u["state"] = "review"
            self.save()
            before = _sha_models(self.folder)
            r["k5"] = self._agent(key, "k5", k5_prompt(self.folder, key, n, self.project, self.test_safety), n)
            if r["k5"].get("state") != "done":
                u["state"] = "stopped" if r["k5"].get("state") == "stopped" else "failed"
                r["k5"] = None if u["state"] == "stopped" else r["k5"]
                self.save()
                return u["state"]
            f = k5_file(self.folder, key, n)
            r["file"] = f.relative_to(self.folder).as_posix()
            text = f.read_text(encoding="utf-8", errors="replace") if f.is_file() else ""
            kind = parse_verdict(text)
            changed = sorted(k for k, v in _sha_models(self.folder).items() if before.get(k) != v)
            if changed:
                r["k5Modified"] = changed
                self.log(_("Kontrolor změnil model ({files}) — verdikt neplatí.", files=", ".join(changed)))
                kind = ""
            chk = k5_checks(self.folder, key, n)
            r["checks"] = chk
            if kind == "ok" and chk and chk.get("stav") != "OK":
                self.log(_("Kontroly kódem K5 ({file}): {state} — verdikt SCHVÁLENO neplatí.", file=chk["file"],
                           state=chk.get("stav")))
                kind = "back"
                r["k5ChecksOverride"] = chk.get("stav")
            elif chk is None:
                self.log(_("Kontrolor nespustil kontroly kódem (kontroly.json chybí)."))
            r["verdict"] = kind or "none"
            r["verdictText"] = pro_agent.verdict_text(text)
            self.log(_("{part}, kolo {n}: verdikt {v}.", part=_(UNIT[key]["label"]), n=n,
                       v=r["verdictText"] or _("chybí")))
            if kind == "ok":
                u["state"] = "approved"
                self.save()
                return "approved"
            self.save()


# --- přehled -------------------------------------------------------------------------------------------------------

_ODHAD = re.compile(r"\bODHAD\b")
_ROLE_CS = {"concept": "Koncept", "builder": "Stavitel", "k5": "Kontrolor K5"}


def collect_estimates(folder: Path, limit: int = 60) -> list[str]:
    out = []
    for p in sorted(folder.rglob("*.md")):
        if p.name in (SUMMARY_FILE, "ROZBOR.md") or LOG_DIR in p.parts or p.name.upper().startswith("KONTROLA_K5"):
            continue
        try:
            for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
                if _ODHAD.search(line):
                    out.append(f"- `{p.relative_to(folder).as_posix()}`: {' '.join(line.split())[:220]}")
                    if len(out) >= limit:
                        return out
        except OSError:
            continue
    return out


def write_summary(folder: str | Path, st: dict) -> Path:
    """``PREHLED.md``: fáze, kola, verdikty, cena a tokeny, předpoklady (ODHAD), zpětná vazba, snímky, TEST."""
    folder = Path(folder)
    L = [f"# Přehled automatického postupu 3D — {st.get('project') or folder.name}", ""]
    if st.get("testSafety"):
        L += [f"> **{TEST_MARK}** — bezpečnostní prvky a funkce byly v tomto běhu považovány za schválené.", ""]
    L += [f"Stav postupu: **{st.get('status')}**, aktualizováno {st.get('updated')}, max. kol {st.get('maxRounds')}.", "",
          "| Fáze | Krok | Stav | Kola | Verdikty | Cena USD | Tokeny vstup / výstup |", "|---|---|---|---|---|---|---|"]
    tc = ti = to = 0
    for k in UNIT_KEYS:
        u = st["units"][k]
        cost = tin = tout = 0
        verd = []
        for r in u.get("rounds") or []:
            for side in ("builder", "k5"):
                x = r.get(side) or {}
                cost += float(x.get("cost") or 0)
                tin += int(x.get("tin") or 0)
                tout += int(x.get("tout") or 0)
            if r.get("verdict"):
                v = {"ok": "SCHVÁLENO", "back": "VRÁCENO"}.get(r["verdict"], "bez verdiktu")
                verd.append(f"{r['n']}: [{v}]({r['file']})" if r.get("file") else f"{r['n']}: {v}")
        tc, ti, to = tc + cost, ti + tin, to + tout
        lbl = STATE_LABELS.get(u["state"], u["state"]).replace("{n}", str(len(u.get("rounds") or [])))
        L.append(f"| {dict(PHASES)[UNIT[k]['phase']]} | {UNIT[k]['label']} | {lbl} | {len(u.get('rounds') or [])} | "
                 f"{'; '.join(verd) or '—'} | {cost:.2f} | {tin} / {tout} |")
    L += ["", f"**Celkem:** {tc:.2f} USD, tokeny vstup {ti} / výstup {to}.", ""]
    if st.get("inputs"):
        L += ["## Vstupy z PLCdesk", ""] + [f"- [{f}]({f})" for f in st["inputs"] if "/" not in f] + \
             ([f"- program: {sum(1 for f in st['inputs'] if f.startswith('program/'))} souborů v `program/`"]
              if any(f.startswith("program/") for f in st["inputs"]) else []) + [""]
    ms, mt = st.get("models") or {}, st.get("maxTurns") or {}
    if ms:
        L += ["Modely: " + ", ".join(f"{_ROLE_CS.get(r, r)} `{ms.get(r)}` (limit {mt.get(r, '?')} kol)"
                                    for r in ("concept", "builder", "k5")), ""]
    runs = [(k, r, x) for k in UNIT_KEYS for r in st["units"][k].get("rounds") or []
            for x in (r.get("builder"), r.get("k5")) if x]
    if runs:
        L += ["## Běhy agentů (skutečná cena z Claude Code)", "",
              "| Krok | Kolo | Role | Model | Stav | Kol / limit | Cena USD | Tokeny vstup / výstup | s | Log |",
              "|---|---|---|---|---|---|---|---|---|---|"]
        for k, r, x in runs:
            lg = x.get("log") or ""
            L.append(f"| {UNIT[k]['label']} | {r.get('n')} | {_ROLE_CS.get(x.get('role'), x.get('role') or '?')} | "
                     f"`{x.get('model') or '?'}` | {x.get('state') or '?'} | {x.get('turns', 0)} / {x.get('maxTurns', '?')} | "
                     f"{float(x.get('cost') or 0):.2f} | {int(x.get('tin') or 0)} / {int(x.get('tout') or 0)} | "
                     f"{x.get('secs', '')} | {f'[log]({lg})' if lg else '—'} |")
        L.append("")
    chk = [f"- {UNIT[k]['label']} kolo {r['n']}: kontroly kódem K5 {r['checks']['stav']} (chyby {r['checks']['chyby']}, "
           f"varování {r['checks']['varovani']}) — [{r['checks']['file']}]({r['checks']['file']})"
           + (" — verdikt SCHVÁLENO zneplatněn" if r.get("k5ChecksOverride") else "")
           for k in UNIT_KEYS for r in st["units"][k].get("rounds") or [] if r.get("checks")]
    if chk:
        L += ["## Kontroly kódem (pro3d_tools)", ""] + chk + [""]
    warn = [f"- {UNIT[k]['label']} kolo {r['n']}: kontrolor změnil {', '.join(r['k5Modified'])} — verdikt neplatí"
            for k in UNIT_KEYS for r in st["units"][k].get("rounds") or [] if r.get("k5Modified")]
    if warn:
        L += ["## Upozornění", ""] + warn + [""]
    pi = folder / PARTS_SUB / "parts_index.json"
    try:
        ps = json.loads(pi.read_text(encoding="utf-8")).get("souhrn") if pi.is_file() else None
    except (OSError, ValueError):
        ps = None
    perr = (st.get("parts") or {}).get("chyba")
    if ps or perr:
        L += ["## Normalizované díly (generátory kódem)", ""]
        if ps:
            L.append(f"Řádků kusovníku {ps.get('radku')}: **dle dokumentace {ps.get('dle_dokumentace')}** "
                     f"({ps.get('pokryti_pct')} %), zástupné {ps.get('zastupne')}; kusů dle dokumentace "
                     f"{ps.get('kusu_dle_dokumentace')} / {ps.get('kusu')}; modelů {ps.get('modelu')} — "
                     f"[{PARTS_SUB}/DILY.md]({PARTS_SUB}/DILY.md)")
        if perr:
            L.append(f"Chyba generátorů: {perr}")
        L.append("")
    est = collect_estimates(folder)
    L += ["## Předpoklady (ODHAD)", "", *(est or ["- žádné označené"]), ""]
    fbs = sorted(p.relative_to(folder).as_posix() for p in folder.rglob("PLCdesk_CAD_feedback*.json"))
    L += ["## Zpětná vazba pro PLCdesk (NEPOUŽITA — rozhodne uživatel v kroku Kusovník)", "",
          *([f"- [{f}]({f})" for f in fbs] or ["- žádná"]), ""]
    shots = sorted(folder.rglob("*.png"), key=lambda p: p.stat().st_mtime, reverse=True)[:24]
    L += ["## Snímky", "", *([f"- [{p.relative_to(folder).as_posix()}]({p.relative_to(folder).as_posix()})" for p in shots]
                             or ["- žádné"]), ""]
    L += ["Bezpečnostní funkce a prvky jsou návrh ke schválení odpovědnou osobou (PLCdesk Bezpečnost / Schválení).", ""]
    p = folder / SUMMARY_FILE
    p.write_text("\n".join(L), encoding="utf-8")
    return p


# --- CLI ------------------------------------------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m plc_studio.pro_pipeline",
                                 description="PLCdesk PRO — automatický postup 3D agenta (dávka bez GUI)")
    ap.add_argument("--sample", required=True, help="projekt .plcstudio.json")
    ap.add_argument("--out", required=True, help="složka 3D stroje")
    ap.add_argument("--from-phase", choices=sorted({*UNIT_KEYS, "build"}), help="začít od fáze / kroku (znovu)")
    ap.add_argument("--max-rounds", type=int, default=MAX_ROUNDS)
    ap.add_argument("--test-safety", action="store_true", help="TEST: bezpečnostní prvky považovat za schválené")
    ap.add_argument("--no-ai", action="store_true", help="jen vstupy z PLCdesk, agenti se nespustí")
    ap.add_argument("--model", default="", help="jeden model pro všechny role (přebije --model-*)")
    ap.add_argument("--model-concept", default="", help=f"model role Koncept (výchozí {pro_agent.ROLE_MODELS['concept']})")
    ap.add_argument("--model-build", default="", help=f"model role Stavitel (výchozí {pro_agent.ROLE_MODELS['builder']})")
    ap.add_argument("--model-check", default="", help=f"model role Kontrolor K5 (výchozí {pro_agent.ROLE_MODELS['k5']})")
    ap.add_argument("--turns-concept", type=int, default=0, help=f"limit kol Koncept (výchozí {pro_agent.ROLE_TURNS['concept']})")
    ap.add_argument("--turns-build", type=int, default=0, help=f"limit kol Stavitel (výchozí {pro_agent.ROLE_TURNS['builder']})")
    ap.add_argument("--turns-check", type=int, default=0, help=f"limit kol Kontrolor (výchozí {pro_agent.ROLE_TURNS['k5']})")
    ap.add_argument("--budget", type=float, default=None, help="limit ceny jednoho běhu agenta (USD)")
    ap.add_argument("--parts", action="store_true", help="normalizované díly kódem i s --no-ai (FreeCAD, bez AI)")
    ap.add_argument("--no-parts", action="store_true", help="bez generátorů normalizovaných dílů")
    a = ap.parse_args(argv)
    models = {"concept": a.model_concept, "builder": a.model_build, "k5": a.model_check}
    turns = {"concept": a.turns_concept, "builder": a.turns_build, "k5": a.turns_check}
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    data = json.loads(Path(a.sample).read_text(encoding="utf-8"))
    prj = data["prj"] if isinstance(data.get("prj"), dict) else data       # uložený projekt desktopu / export webu
    if not a.no_ai and pro_agent.find_claude() is None:
        print("Claude Code nenalezen (PLCDESK_CLAUDE / PATH).", file=sys.stderr)
        return 2
    pipe = Pipeline(a.out, prj, max_rounds=a.max_rounds, test_safety=a.test_safety, ai=not a.no_ai,
                    runner=None if a.no_ai else agent_runner(model=a.model, budget=a.budget), log=print,
                    models=models, turns=turns, parts=False if a.no_parts else (True if a.parts else None))
    status = pipe.run(a.from_phase)
    print(f"PREHLED: {Path(a.out) / SUMMARY_FILE}")
    return 0 if status in ("done", "noai") else 1


if __name__ == "__main__":
    sys.exit(main())
