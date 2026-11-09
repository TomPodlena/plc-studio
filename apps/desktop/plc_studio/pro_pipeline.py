"""PLCdesk PRO — automatický postup 3D agenta (stavový automat, bez Tk).

Fáze a kroky (``UNITS``):

1. **Vstupy z PLCdesk** (bez AI): z projektu přes jádro (most Node ``CoreBridge``, vlastní proces) do složky stroje
   ``PLCdesk_CAD.json`` (cadManifestJson), ``projekt.plcstudio.json``, funkční rozbor ``ROZBOR.md`` (skript skillu
   automatizacni-technika), kusovník ``KUSOVNIK.csv`` (bomCsv), program hardwarové platformy (``program/<plat>/``,
   genFor) + souhrn emulace překladu a běhu ``PROGRAM.md``, ``STAV.md`` (start).
2. **Koncept**: role Koncept → kontrola K5 (role Kontrolor, model nemění) → při VRÁCENO oprava stavitelem a znovu K5,
   nejvýš ``rounds_for(část)`` kol (výchozí 3, rám a kryty 5 — ``UNIT_ROUNDS``). Neschválený koncept postup ZASTAVÍ (stavba nad ním nemá smysl).
3. **Stavba po částech**: rozvaděč → rám a kryty → moduly → celek + PLM; každá část stavitel → K5, nejvýš
   ``rounds_for(část)`` kol. Neschválená část se zapíše a postup pokračuje další částí.

Stav je v ``pipeline.json`` ve složce stroje (navázání po pádu / zastavení od posledního hotového kroku), log každého
běhu agenta v ``logy/``, na konci ``PREHLED.md``. Běh agentů obstarává ``runner`` (výchozí = Claude Code CLI přes
``pro_agent.AgentRun``; testy podvrhnou). Tk se odsud nevolá — krok ``steps/pro3d.py`` čte ``Pipeline.state`` /
``Pipeline.current`` z hlavního vlákna.

Dávka bez GUI:
    python -m plc_studio.pro_pipeline --sample <projekt.plcstudio.json> --out <složka> [--from-phase X]
        [--max-rounds N] [--test-safety] [--no-ai] [--model-concept M] [--model-build M] [--model-check M]
        [--turns-concept N] [--turns-build N] [--turns-check N] [--model M (všechny role)] [--budget USD]
        [--parts | --no-parts]   (normalizované díly kódem před stavbou; výchozí jen s AI)

Před stavbou (fáze 3) postup spustí generátory normalizovaných dílů ``pro3d_parts`` (bez AI, FreeCAD ve vlastní
instanci) → ``dily/parts_index.json``; stavitel díly „dle dokumentace“ MUSÍ vložit jako App::Link, zástupné jen zbytek.
Před 1. kolem stavitele rozvaděče postaví rozvaděč generátor kódem ``pro3d_cabinet`` (``make_cabinet``): když model vznikne,
stavitel ho jen kontroluje a doplňuje (``CABINET_GEN_PROMPT``), jinak staví postaru. Stejně tak moduly (pneumatika,
snímače s držáky, kotvení, hadice a kabely) generátorem ``pro3d_modules`` (``make_modules``, ``MODULES_GEN_PROMPT``).

Kontroly modelu dělá KÓD (``pro3d_tools``: kolize, souvislost, zašroubování, kopie těles, otvory ISO 13857, kusovník, zástupné díly, STEP, snímky);
stavitel je spouští před odevzdáním, kontrolor K5 nezávisle a verdikt o ně opírá — SCHVÁLENO s chybou v
``<část>/k5_kolo<N>/kontroly.json`` postup sám zneplatní.

Stavitel a kontrolor pracují podle skillů ``stroj-stavitel`` / ``stroj-kontrolor`` (``~/.claude/skills``; bez nich
vestavěné znění pravidel a kontrolního seznamu ``K5_ITEMS``). Brána ``k5_audit`` nad protokolem SCHVÁLENO (kontrolní
seznam s důkazem, minima, snímky, plné počty z kontroly.json) a ``approvedSha`` schválených částí verdikt smí jen
VRÁTIT, nikdy schválit.
"""

from __future__ import annotations

import argparse
import copy
import datetime as _dt
import hashlib
import json
import os
import re
import shutil
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
    ("concept", "concept", N_("Koncept"), "koncept", "koncept",
     ("stroj-stavitel", "automatizacni-technika", "konstrukce-pracoviste-3d")),
    ("cabinet", "build", N_("Rozvaděč"), "rozvadec", "rozvadec", ("stroj-stavitel", "rozvadec-3d")),
    ("frame", "build", N_("Rám a kryty"), "ram", "ram",
     ("stroj-stavitel", "alutech-profily", "ramy-a-kryty", "bezpecnost-stroju")),
    ("modules", "build", N_("Moduly (pohony, pneumatika, držáky, kabely)"), "moduly", "moduly",
     ("stroj-stavitel", "pohony-a-vedeni", "festo-pneumatics", "pneumatic-assemblies", "kabelaz-a-hadice",
      "konstrukce-pracoviste-3d")),
    ("assembly", "build", N_("Celek a PLM"), "celek", "celek", ("stroj-stavitel", "konstrukce-pracoviste-3d", "freecad-api")),
)
UNIT_KEYS = tuple(u[0] for u in UNITS)
AI_UNITS = UNIT_KEYS[1:]
UNIT = {u[0]: {"phase": u[1], "label": u[2], "sub": u[3], "subject": u[4], "skills": u[5]} for u in UNITS}
# generátory kódem před 1. kolem stavitele části (jen s generátory dílů): krok → metoda Pipeline
GEN_FNS = {"cabinet": "_cabinet", "frame": "_frame", "modules": "_modules"}

# --- kontrola K5 podle skillu stroj-kontrolor (kontrolní seznam, minima, brána) -----------------------------------
STAVITEL_SKILL = "stroj-stavitel"
KONTROLOR_SKILL = "stroj-kontrolor"
# oddíl kontrolního seznamu podle části (V = všechny části)
K5_SECTION = {"concept": "K", "cabinet": "R", "frame": "F", "modules": "M", "assembly": "C"}
# minimum na jedno kolo (SKILL.md kontrolora): vlastní kóty (kap. 3.2), prohlédnuté snímky (kap. 5), ověřená tvrzení (3.5)
K5_MIN = {"concept": (6, 6, 3), "cabinet": (8, 6, 3), "frame": (12, 8, 5), "modules": (10, 8, 4), "assembly": (12, 8, 5)}
# max. kol podle části (rám a kryty víc — přísnější K5 tam vrací nejčastěji); volba --max-rounds / krok je přebije
UNIT_ROUNDS = {"frame": 5}
BLANK_SHOT_PCT = 1.0       # snímek s méně než 1 % nebílých pixelů = prázdný (nástroj selhal)
BEZ_SPOJE_SHOWN = 15       # kontrola souvislosti ukazuje nejvýš 15 dílů bez spoje — skutečný počet v data.bez_spoje
# vestavěný kontrolní seznam (zkrácené znění stroj-kontrolor/references/kontrolni-seznam.md) — když skill chybí:
# ID pro bránu a seznam do pokynu kontrolora; se skillem se ID čtou z jeho souboru (změna seznamu = změna brány)
K5_ITEMS = {
    "V1": "SHA-256 všech *.FCStd (mimo _archiv) na začátku = na konci, plné hodnoty; SHA modelu = kontroly.json",
    "V2": "vlastní běh kontrol kódem vse do <část>/k5_kolo<N>/ v tomto kole, souhrn OK, selhalo []",
    "V3": "úplnost zón: každé pohyblivé zařízení a rotující / vtahovací místo má Zona_* v celém zdvihu (tabulka)",
    "V4": "skutečný počet dílů bez spoje (data.bez_spoje) a info „vynechána“; nosný díl bez spoje = nález",
    "V5": "objekty s Konstrukce_Typ pomocny / prislusenstvi / rozhrani / zona jsou opravdu tím, co tvrdí",
    "V6": "info „mimo rozsah“ v kusovníku: řádky, které do části patří, mají v modelu PLCdesk_Id",
    "V7": "minimum vlastních měření kót proti zadání (hlavní rozměry, výšky obsluhy 0,4–2,0 m, zdvihy, vůle)",
    "V8": "minimum snímků, každý otevřen a popsán, žádný prázdný, výřezy na nebezpečná místa a nálezy",
    "V9": "ověřená tvrzení stavitele (číslo zprávy × vlastní měření)",
    "V10": "ODHADY, na kterých stojí bezpečnost / funkce / pevnost: konzervativní a zdůvodněné",
    "V11": "zpětná vazba PLCdesk_CAD_feedback_<předmět>.json: formát v1, čísla = stav modelu teď",
    "V12": "díly „dle dokumentace“ = App::Link (žluté, nepřebarvené), zástupné oranžové s vlastností",
    "V13": "navazující modely jiných částí mají SHA schválené jejich K5",
    "V14": "body „Předáno dál“ z protokolů předchozích částí vypořádány",
    "V15": "kolo > 1: každý bod minulého protokolu ověřen měřením (před × po) + regrese",
    "K1": "každá funkce z ROZBOR.md / sequence má v modelu prvek a místo",
    "K2": "2–3 varianty, doporučení se zdůvodněním, postavená = doporučená",
    "K3": "řádky manifestu field / cabinet mají místo, hlavní vypínač má místo",
    "K4": "tok materiálu: světlosti × rozměr dílu, senzor × dráha dílu změřené",
    "K5": "bezpečnostní koncepce: nebezpečí → opatření → číslo (ISO 13857 / 13855); nebezpečí bez opatření = blokující",
    "K6": "místo obsluhy, ovládače 0,4–2,0 m, E-stop u každého ovládacího místa",
    "K7": "servis a výměna: rozvaděč, úprava vzduchu, pás / nástroj, přepravka — přístup změřen",
    "K8": "geometrická tvrzení KONCEPT.md ověřena v modelu",
    "K9": "hodnoty [Z] mají zdroj v zadání, jinak ODHAD",
    "K10": "zpětná vazba error blokující další fázi je řešena konzervativním ODHADem",
    "R1": "obsah = manifest location cabinet (PLCdesk_Id, qty), pořadí modulů PLC, svorky",
    "R2": "upevnění desky, lišt, žlabů, přístrojů a skříně spojovacími prvky",
    "R3": "zóny mezer výrobců vč. bočních (datasheet), bez průniku",
    "R4": "hloubka přístroj + mezera ≤ líc dveří, dveře otevřené bez kolize",
    "R5": "trasy vodičů: žlaby, svislá propojení, vstup kabelů, PE a přívodní svorky",
    "R6": "víka žlabů a svorky přístupné; výšky 0,4–2,0 m / ≥ 0,2 m",
    "R7": "oddělení silových a signálových vodičů změřené",
    "R8": "tepelná bilance se ztrátami z datasheetů a nejnižší dovolenou teplotou",
    "R9": "rezerva místa ≥ 20 % na lištách a desce",
    "R10": "krytí skříně ≥ nejpřísnější požadavek přístrojů",
    "F1": "průhyb / pevnost přepočtené pro 2 nejzatíženější nosníky",
    "F2": "stabilita proti převržení každého samostatně stojícího celku (300 N), K < 1,5 bez kotvení = nález",
    "F3": "každý spoj profilů: šroub / spojka + díra / závit v modelu, volná čela 0",
    "F4": "dva spoje v jednom místě, šroub × šroub, matice v drážce s těsněním",
    "F5": "díry ve vyráběných dílech (průnik = plný dřík → díra chybí)",
    "F6": "přístup klíčem / montážní pořadí",
    "F7": "ISO 13857 každá cesta k zóně: e a Sr změřené v B-rep (ne z mřížky)",
    "F8": "otvory mezi díly krytů v okolí každé zóny",
    "F9": "rotující a vtahovací místa krytá nebo e / Sr vyhovuje",
    "F10": "pohyblivé kryty v krajních polohách bez kolize, spojovací materiál v podsestavě",
    "F11": "blokovací spínače ISO 14119: ovladač zasunutý, hlava uvnitř, proti obcházení, počet",
    "F12": "vyjmutí přepravky / dílu / nástroje se změřenou vůlí",
    "F13": "řezací seznam = model, hmotnosti",
    "F14": "funkční tvar: skluz ≤ pás, nic nečnícího do dráhy dílu",
    "F15": "výplně odpovídají riziku, pevné kryty jen nářadím",
    "M1": "každé polní zařízení má držák a upevnění šrouby",
    "M2": "kolize v pohybu (Konstrukce_Pohyb v krajních polohách) 0",
    "M3": "snímače: poloha × dráha dílu, paprsek volný, spínací vzdálenost × pozadí",
    "M4": "kabely: poloměr ohybu ≥ datasheet (bez něj 4 × D pevně, 10 × D pohyblivě), žádné ostré zlomy",
    "M5": "oddělení silových a signálových kabelů",
    "M6": "hadice: R ohybu, zásuv do šroubení, délky řezů",
    "M7": "žlaby, držáky: upevnění k rámu, nosnost, víko / přístup",
    "M8": "žádná druhá verze dílu jiné části",
    "M9": "rozhraní a konektory odpovídají kusovníku",
    "C1": "části jako App::Link s vypočteným umístěním, SHA každé části = SHA schválené jejím K5",
    "C2": "kusovník 3D × manifest: každý řádek právě jednou",
    "C3": "upevnění částí k sobě (skříň, pult, úprava vzduchu) šrouby, nosnost doložená",
    "C4": "dveře rozvaděče a krytů otevřené × okolí",
    "C5": "bezpečnost celku: zóny všech částí, nové štěrbiny mezi částmi, E-stop, spínače",
    "C6": "stabilita celku a kotvení",
    "C7": "výstupy aktuální (STEP, výkresy) novější než poslední změna modelu",
    "C8": "PLM: plm check bez chyb, plm scan nejvýš 1× za kolo",
    "C9": "„Předáno dál“ ze všech částí uzavřené",
}

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
{model_rules}
I. FreeCAD jen ve vlastní instanci (skill freecad-instance, vlastní slot), cizí instance nech být; šetři paměť —
   jedna instance FreeCADu najednou, stavby po malých dávkách, po práci instanci zavři. Nečekej příkazem (sleep /
   Start-Sleep jsou blokované) a nezabíjej procesy (Stop-Process / taskkill zakázané) — stroj-stavitel/references/provoz.md.
J. PLM: `plm scan` (C:\\CLAUDE\\freecad_plm, kód PLM neměnit) nejvýš jednou za kolo; registr PLM patří do složky stroje.
K. Modely výrobců neskriptuj z 3Dfindit / CADENAS; jen portály výrobců nebo zástupný díl.
L. Pracuj jen ve složce stroje (aktuální adresář); skilly a PLM jen čti / spouštěj.
N. Bezpečnostní vzdálenost S = K·T + C (ISO 13855) počítej z tabulky časů se zdroji (odezva AOPD, F-logiky, F-DQ,
   ventilů, STO / brzd; členy bez dat skript označí ODHAD / CHYBÍ):
   python "{casy}" --aopd … --logika … --ventil … --d … (--help, --hledat TEXT); řádky výstupu se zdroji vlož do textu.
{test}"""

# pravidla modelu: se skillem odkaz (obecná pravidla žijí ve skillu), bez skillu vestavěné znění (postup funguje i bez něj)
MODEL_RULES_SKILL = """C. Pravidla modelu, spojů, barev, zón a snímků: skill stroj-stavitel (references/pravidla-modelu.md); způsob
   a přísnost kontroly: skill stroj-kontrolor. Načti ten, který odpovídá tvé roli (nástroj Skill), HNED na začátku."""
MODEL_RULES_INLINE = """C. Sestavy: App::Part pro každou část, opakované díly App::Link s VYPOČTENÝM umístěním (Placement z rozměrů, ne odhadem).
D. Povolené kolize jen šroub × díra / drážka / závit, matice × drážka profilu, kabel / hadice ve žlabu / řetězu
   a hadice zasunutá do šroubení; ostatní průniky hmot = chyba.
E. Nic ve vzduchu: graf souvislosti (každé těleso se dotýká nosného dílu, cesta až k podlaze / rámu) — ověř výpočtem.
F. Otvory v krytech posuzuj podle ISO 13857 tab. 4 MĚŘENÍM otvoru; voxelová kontrola jen hledá cesty, neschvaluje.
G. Díly s modelem v dily/parts_index.json (stav „dle dokumentace“, generátory kódem) vkládej jako App::Link na jejich
   FCStd — jsou jednotně ŽLUTÉ RGB 255,215,0 (barva se dědí), nepřebarvuj je (OverrideMaterial ne) a žlutou nepoužívej
   na nic jiného. Zástupné díly (bez modelu výrobce i generátoru) barvi oranžově RGB 255,140,0 a označ vlastností
   (např. Placeholder = True). Modely výrobců a vlastní konstrukce nechej v jejich barvách.
H. Snímky klíčových míst (iso, půdorys, čelo, detaily vazeb) ulož do {sub}/snimky/ a PROHLÉDNI je před zprávou
   (prázdný snímek = nepořízený)."""

TEST_RULE = ("M. TEST: bezpečnostní prvky a funkce považuj pro tento běh za schválené (předpoklad zkoušky postupu) — "
             "předpokládá se jen podpis odpovědné osoby. Bezpečnostní NÁVRH (zóny, kryty, vzdálenosti, opatření) se tím "
             "nevynechává ani nekontroluje mírněji — geometrické vady (otevřený otvor, chybějící kryt, vzdálenost menší "
             "než vypočtená S, opatření, které model nemá) jsou dál povinné body. Výjimka TESTu (rozhodnutí uživatele "
             "2026-10-31): chybějící ZDROJ členů doby zastavení T (ISO 13855: odezva AOPD, logiky, ventilu, doběh pohonu) "
             "je jen VÝHRADA, ne povinný bod — pokud stavitel použil hodnotu z tabulky časů (pro3d_parts, bezpecnost_casy) "
             "nebo konzervativní horní mez označenou ODHAD a výpočet S = K·T + C je v textu úplný a souhlasí s modelem. "
             "Totéž platí pro ztrátové výkony a mezery přístrojů v rozvaděči a odolnost krytu proti vymrštění dílu: chybí-li "
             "jen zdroj hodnoty, ale výpočet (tepelná bilance, energie dílu) je úplný s konzervativním ODHADEM a vychází, "
             "je to výhrada. Výpočet, který NEVYCHÁZÍ a model nemá navržené opatření (např. ventilátor u tepelné bilance), nebo "
             "chybějící výpočet zůstává povinným bodem; opatření v modelu + zápis do zpětné vazby pro uživatele = výhrada. "
             "Každou zprávu a STAV.md označ řádkem „" + TEST_MARK + "“.")

DEFAULT_PROMPTS = {
    "concept": """Navrhni hrubý koncept stroje ve složce {sub}/.
Vstupy: PLCdesk_CAD.json (manifest — zdroj pravdy), ROZBOR.md (funkční rozbor; otázky v něm nikdo nezodpoví → ODHAD),
KUSOVNIK.csv, PROGRAM.md (program a jeho ověření), projekt.plcstudio.json.
1. Z rozboru sepiš funkce stroje, pohyby, zdvihy a takt; chybějící údaje doplň jako ODHAD.
2. Navrhni 2–3 varianty uspořádání (rozvaděč, rám, polní prvky, místo obsluhy, kryty a přístup) se zdůvodněním
   a jednu doporuč.
3. Doporučenou variantu postav ve FreeCADu z jednoduchých obálek (App::Part po celcích, rozměry z manifestu / ODHAD),
   ulož {sub}/Koncept.FCStd a snímky do {sub}/snimky/. Celek pracovního stolu / rámu stroje (deska + nohy) označ
   vlastností Konstrukce_Role = stul (App::PropertyString na jeho App::Part) — generátor rámu z něj bere rozměry.
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
ARCHIVE_DIR = "_archiv"      # „Spustit od…“: staré výstupy resetovaných částí → _archiv/<YYYYMMDD-HHMMSS>/<podsložka>/
REBUILD_PROMPT = ("STAVBA ZNOVU: postup byl spuštěn od této části znovu. Dřívější výstupy podsložky {sub}/ jsou "
                  "přesunuté do {archive}/ (jen pro nahlédnutí — nenavazuj na ně, nic odtud nekopíruj do modelu). "
                  "Postav část znovu od začátku (nestačí model jen zkontrolovat); vygenerované normalizované díly "
                  "z {parts}/ vlož jako App::Link (dle {parts}/DILY.md a parts_index.json), zástupné jen tam, kde díl "
                  "dle dokumentace není.")
K5_CONTINUE_PROMPT = ("\n\nPOKRAČOVÁNÍ KONTROLY: předchozí běh téže kontroly vyčerpal limit kol. Nezačínej znovu — "
                      "přečti, co už je v {sub}/k5_kolo{round}/ a v rozepsaném protokolu {k5file}; kontroly kódem spusť "
                      "jen, když kontroly.json chybí, a dopiš protokol s verdiktem.")
K5_NO_CHECKS_POINT = "spustit pro3d_tools vse (kontroly kódem do {sub}/k5_kolo{round}/) a verdikt opřít o kontroly.json"
PARTS_SLOT = "pro3d-parts"
CABINET_DIR = Path(__file__).resolve().parent / "pro3d_cabinet"
CABINET_SLOT = "pro3d-cabinet"
# rozvaděč vygenerovaný kódem (pro3d_cabinet) — stavitel ho jen kontroluje a doplňuje, nepřestavuje
CABINET_GEN_PROMPT = """Rozvaděč je VYGENEROVANÝ KÓDEM (pro3d_cabinet, deterministicky z manifestu): {sub}/Rozvadec.FCStd,
{sub}/ROZVADEC.md (skříň, lišty, mezery, tepelná bilance i s filtračním ventilátorem, dveře s vrtacími obrazci a upínkami,
kabeláž ke dveřím s volným úsekem u pantu, oddělení silových a signálových tras přepážkami, PE / N přípojnice — vše se zdrojem
nebo ODHAD, zpětná vazba) a {sub}/layout.json (všechny polohy, díry, šrouby, svazky). Skříň: {skrin}; lišty: {listy};
tepelná bilance: {bilance}.
NEPŘESTAVUJ ho a neměň nic, co vygeneroval kód (rozmístění, skříň, mezery, dveře, ventilátor, svazky ke dveřím, přepážky,
PE / N) — zkontroluj ho a doplň JEN:
- kabeláž uvnitř žlabů (svazky Konstrukce_Typ = kabel ve žlabech; silové jen v silových žlabech / komorách, signálové jen
  v signálových — druh žlabů a komor je v ROZVADEC.md, oddíl Oddělení);
- popisky / štítky IEC 81346 podle tag z manifestu.
Víc nic. Pak spusť kontroly kódem (níže) a sebekontrolu oddílu R podle stroj-kontrolor; ve zprávě {sub}/ROZVADEC.md
NEPŘEPISUJ část vygenerovanou kódem — připiš oddíl „Doplněno stavitelem“ (co, proč, výsledek kontrol). Nálezy kódu (změna
skříně, bilance, chybějící ztráty / mezery, ODHADY, kabeláž ke dveřím a oddělení s výsledkem NESPLNĚNO) jsou rozhodnutí
uživatele: sepiš je do {sub}/PLCdesk_CAD_feedback_rozvadec.json (formát v1) a nic z toho v modelu neopravuj. Zóny mezer
(Mezera …) a rezervy (Rezerva …) jsou pomocná tělesa — nemazat."""
FRAME_SCRIPT = Path(__file__).resolve().parent / "pro3d_lib" / "ram_gen.py"
FRAME_SLOT = "pro3d-frame"
# rám vygenerovaný kódem (pro3d_lib.ram_gen = modul N1) — stavitel ho nepřestavuje, doplní kryty a co chybí
FRAME_GEN_PROMPT = """Rám je VYGENEROVANÝ KÓDEM (pro3d_lib.ram_gen = modul N1 z profilů ALUTEC, deterministicky z manifestu a
konceptu): {sub}/Ram.FCStd, {sub}/RAM.md (rozměry a jejich zdroj, nosnost, rozhodnutí, ODHADY, výsledek kontrol kódem) a
SMLOUVA rozhraní {sub}/{smlouva} (drážky a jejich volné úseky, pracovní deska a závity pro moduly, nosnost, průchody, montážní
pořadí, řezací seznam; globální bod = místní + rozmery.umisteni). Souhrn: {souhrn}.
NEPŘESTAVUJ ho a neměň nic, co vygeneroval kód (profily, spoje dlouhým šroubem, úhelníky, patky / kola, deska, záslepky).
Doplň JEN:
- ochranné kryty / oplocení s bezpečnými vzdálenostmi (ISO 13857 měřením, skill ramy-a-kryty) — do {sub}/Ram.FCStd jako
  další App::Part, kotvené do volných úseků drážek ze smlouvy (matice T, šrouby, díry), nic ve vzduchu;
- co rám pro koncept postrádá (nosníky / konzoly pro zařízení z konceptu, která nestojí na desce) — taky jen do volných úseků.
Pak spusť kontroly kódem (níže) a sebekontrolu oddílu F podle stroj-kontrolor; ve zprávě {sub}/RAM.md NEPŘEPISUJ část
vygenerovanou kódem — připiš oddíl „Doplněno stavitelem“ (co, proč, výsledek kontrol). Rozměry, profily, nosnost a
doporučení kódu (diagonály / MKP u rámu na kolech) jsou rozhodnutí uživatele: nálezy sepiš do
{sub}/PLCdesk_CAD_feedback_ram.json (formát v1) a v modelu je neopravuj."""
MODULES_DIR = Path(__file__).resolve().parent / "pro3d_modules"
MODULES_SLOT = "pro3d-modules"
# moduly vygenerované kódem (pro3d_modules) — stavitel je jen kontroluje a doplňuje to, co kód neumí
MODULES_GEN_PROMPT = """Moduly jsou VYGENEROVANÉ KÓDEM (pro3d_modules, deterministicky z manifestu, konceptu a schváleného rámu):
{sub}/Moduly.FCStd, {sub}/MODULY.md (válce s patkami / čelem, snímače polohy, snímače s držáky (podélné otvory ± 5 mm),
úchytky zařízení, nosné konstrukce převzaté z konceptu, šroubení QS a škrticí ventily GRLA, hadice a kabely s poloměry
a délkami ze skillu kabelaz-a-hadice — vše se zdrojem nebo ODHAD) a {sub}/layout.json (polohy, díry, šrouby, trasy).
Souhrn: {souhrn}.
NEPŘESTAVUJ je a neměň nic, co vygeneroval kód. Zkontroluj model a doplň JEN to, co je v MODULY.md v oddílu
„Nepostaveno“ (chybějící poloha / upevnění / držák, nestandardní mechanika přípravku, trasy, které kód nenašel, svislé
snímače, vývody kabelů z krytů) — do Moduly.FCStd jako další App::Part, se šrouby a dírami, nic ve vzduchu. Požadavky na
rám (oddíl „Požadavky na rám“: díry, průchody) rám NEMĚŇ — patří do zpětné vazby / předání. Pak spusť kontroly kódem
(níže) a sebekontrolu oddílu M podle stroj-kontrolor; ve zprávě {sub}/MODULY.md NEPŘEPISUJ část vygenerovanou kódem —
připiš oddíl „Doplněno stavitelem“ (co, proč, výsledek kontrol). Nálezy kódu (délky kabelů, počty, konektory, požadavky
na rám, ODHADY) jsou rozhodnutí uživatele: sepiš je do {sub}/PLCdesk_CAD_feedback_moduly.json (formát v1; podklad
{sub}/PLCdesk_CAD_feedback_moduly_kod.json) a nic z toho v modelu neopravuj."""
TOOLS_SLOT = {"builder": "pro3d-stavitel", "concept": "pro3d-stavitel", "k5": "pro3d-k5"}
_SLOT_BASE = (dict(TOOLS_SLOT), PARTS_SLOT, pro_agent.FC_SLOT)


def slot_tag(folder: str | Path) -> str:
    """Přípona slotů FreeCADu pro složku stroje (souběžné postupy různých strojů si sloty nesdílejí)."""
    name = Path(folder).name
    m = re.match(r"(\d+)", name)
    return (m.group(1) if m else "") + hashlib.sha1(name.encode("utf-8")).hexdigest()[:4]


def set_slot_tag(tag: str) -> None:
    """Sloty FreeCADu tohoto procesu (kontroly, díly, agent) s příponou ``-tag``; prázdná = výchozí jména."""
    global PARTS_SLOT
    sfx = f"-{tag}" if tag else ""
    for k, v in _SLOT_BASE[0].items():
        TOOLS_SLOT[k] = v + sfx
    PARTS_SLOT = _SLOT_BASE[1] + sfx
    pro_agent.FC_SLOT = _SLOT_BASE[2] + sfx


def tools_cmd(role: str = "builder") -> str:
    """Příkaz kontrol kódem pro pokyn agenta (prefix ``powershell`` = povolený příkaz Bash / PowerShell)."""
    return (f'powershell -NoProfile -ExecutionPolicy Bypass -File "{TOOLS_DIR / "pro3d.ps1"}"'
            f" <kontrola> <model.FCStd> --slot {TOOLS_SLOT.get(role, 'pro3d-kontroly')}")


BUILD_CHECKS = """Kontroly KÓDEM (povinné, nepiš na ně vlastní měřicí skripty): po každé stavbě / úpravě modelu spusť
  {cmd}   (kontrola = vse, výstup: --out {sub})
a všechny CHYBY z {sub}/KONTROLY.md (kontroly.json) oprav PŘED odevzdáním — kontrolu opakuj, dokud není „Stav: OK“;
varování i info „vynecháno / mimo rozsah / ověřit měřením“ a skutečný počet data.bez_spoje vypořádej ve zprávě.
Snímky: kontrola = snimky, --out {sub}/snimky --prefix <název> [--detail "díl;díl"]. Dlouhý běh: jednotlivé kontroly
zvlášť (stroj-stavitel/references/provoz.md), ne čekání.
{conventions}
Před odevzdáním SEBEKONTROLA: oddíl V a {section} kontrolního seznamu kontrolora K5 ({checklist}), tabulka
ID → důkaz → výsledek do zprávy (oddíl „Sebekontrola“)."""

CONVENTIONS_SKILL = "Konvence modelu: stroj-stavitel/references/pravidla-modelu.md."
CONVENTIONS_INLINE = """Konvence modelu, které kontroly čtou: vlastnost Konstrukce_Typ (sroub / matice / podlozka / profil / patka / kryt /
vypln / zona / pomocny / kabel / hadice / zlab / retez / sroubeni / prislusenstvi / rozhrani / dil), vedení kabelů
Konstrukce_Vedeni = zlab / retez (žlab přišroubovaný k rámu), nebezpečné zóny jako tělesa Zona_* (Konstrukce_Typ = zona),
druhé polohy pohyblivých dílů Konstrukce_Pohyb = JSON {"nazev": …, "posun": [x, y, z]} nebo {"nazev": …, "otoc": {"osa":
[…], "bod": […], "uhel": …}}, zástupné díly PLCdesk_ModelStatus = placeholder + barva 255,140,0, díly dle dokumentace
(generátory) žluté 255,215,0 jen jako App::Link bez přebarvení, díly kusovníku
PLCdesk_Id / PLCdesk_Instance (= řádek manifestu). Opakovaný díl = App::Link na první kus (kopie tělesa = chyba
kontroly kopie); vlastní PLCdesk_Id / PLCdesk_Instance dej na odkaz (addProperty na App::Link). Každý šroub do závitu
(díra Ø d − P) nebo matice se zašroubováním ≥ max(k·d, 3 mm) — ocel 1, hliník 1,5, plast 2 (kontrola zasunuti)."""

def parts_cmd(role: str = "builder") -> str:
    """Příkaz generátorů normalizovaných dílů pro pokyn agenta."""
    return (f'powershell -NoProfile -ExecutionPolicy Bypass -File "{PARTS_DIR / "pro3d_parts.ps1"}"'
            f" part <díl> … --out {PARTS_SUB}/knihovna --slot {TOOLS_SLOT.get(role, PARTS_SLOT)}")


PARTS_RULES = """Normalizované díly KÓDEM (povinné): {parts}/parts_index.json přiřazuje řádkům manifestu modely FCStd
v {parts}/modely/ (stav „dle dokumentace“ = rozměry z datových listů / norem se zdrojem, vlastnosti Konstrukce_*; souhrn
{parts}/DILY.md). Díl se stavem „dle dokumentace“ MUSÍŠ vložit jako App::Link na jeho FCStd (vlastní model ani zástupnou
obálku nestav, model neměň ani nepřebarvuj — žlutá 255,215,0 se dědí; PLCdesk_Id / PLCdesk_Instance dej na Link). Zástupnou obálku (pravidlo G) jen pro díly se
stavem „zástupný“ nebo mimo index. Spojovací materiál (ISO 4762 / 7380 / 10642, matice ISO 4032, podložky ISO 7089),
lišty TS35 (EN 60715) a vývodky SKINTOP generuj stejně, např.:
  {cmd}   (díly: "ISO4762 M6x20" "ISO4032 M6" "TS35 7.5x450" "SKINTOP M20" "ISO15552 32x100")
Osy: válce +X (zadní čelo x = 0, pístnice v podčásti „Pistnice“ s Konstrukce_Pohyb), přístroje na lištu a skříňky
X = šířka, Y = hloubka od montážní roviny, panelové přístroje čelo panelu y = 0 (tělo k −Y), šrouby osa −Z od hlavy.
Modely výrobců stažené RUČNĚ (models/index.json, zdroj manual-*, soubor models/manual/<partId-safe>.stp, FCStd vedle
něj; seznam STAHNOUT.md) mají PŘEDNOST: díl se zaevidovaným modelem vlož jako App::Link na jeho FCStd (jinak STEP
importuj jednou do vlastního FCStd v models/manual/), model výrobce neměň; pořadí model výrobce → dle dokumentace →
zástupný. Modely sám nestahuj (podmínky portálů) — chybějící zůstanou zástupné."""


COLOR_LEGEND = ["- **žlutá** RGB 255,215,0 — díl dle dokumentace (generátory kódem pro3d_parts, App::Link, nepřebarvovat)",
                "- **oranžová** RGB 255,140,0 — zástupný díl (model chybí — stáhnout podle STAHNOUT.md)",
                "- ostatní barvy — model výrobce nebo vlastní konstrukce"]


K5_CHECKS = """Postup: skill stroj-kontrolor (načti ho nástrojem Skill jako první krok) — kontrolní seznam oddíl V a {section},
minimum měření / snímků / ověřených tvrzení, pravidla verdiktu a šablona protokolu.
Kontroly kódem nezávisle a v TOMTO kole (nepřebírej soubor stavitele ani z dřívějšího pokusu):
   {cmd}   (kontrola = vse, výstup: --out {sub}/k5_kolo{round})
   Přečti celé {sub}/k5_kolo{round}/kontroly.json včetně data a info; jakákoli chyba nebo stav SELHALO = VRÁCENO.
Měření (jen čte): skill stroj-kontrolor, scripts/k5_mer.py přes run_fc.ps1 run --slot {k5slot}; výstupy do
{sub}/k5_kolo{round}/mereni/.
Snímky: kontrola = snimky, --out {sub}/k5_kolo{round} --prefix k5_kolo{round} [--detail "díl;díl"]; každý otevři.
Normalizované díly (V12): díl se stavem „dle dokumentace“ v dily/parts_index.json = App::Link na jeho model, ne zástupná
obálka; model výrobce (models/index.json) má přednost.
Přísnost: položka bez důkazu = NESPLNĚNO; blokující / závažný nález nebo NESPLNĚNO = VRÁCENO; pochybnost = VRÁCENO
s konkrétním bodem; TEST nevynechává kontrolu bezpečnostního návrhu.
Minimum tohoto kola: {min_kot} vlastních kót v tabulce 3.2, {min_shots} prohlédnutých snímků v tabulce kap. 5 (soubory
existují, nejsou prázdné), {min_claims} ověřených tvrzení stavitele v tabulce 3.5.
Postup PLCdesk SCHVÁLENO sám zneplatní (brána K5), když v kontrolním seznamu chybí řádek položky, je tam NESPLNĚNO nebo
SPLNĚNO bez důkazu, chybí minimum, snímek chybí / je prázdný, data.bez_spoje > 15 není posouzeno nebo je kontroly.json
s chybou."""

# kontrolní seznam do pokynu kontrolora, když skill stroj-kontrolor chybí (bez skillu by kontrolor ID neznal)
K5_FALLBACK = """Skill stroj-kontrolor NENÍ nainstalován — platí tento vestavěný kontrolní seznam (každá položka svým řádkem
tabulky „| ID | položka | důkaz | výsledek |“ v kap. 2 protokolu, výsledek SPLNĚNO / NESPLNĚNO / N/A, důkaz = vlastní
měření, pole kontroly.json, snímek nebo citace dokumentu):
{items}
Protokol: kap. 1 povinné body, 2 kontrolní seznam, 3 vlastní měření (3.1 zóny nebezpečí, 3.2 kóty proti zadání,
3.3 otvory ISO 13857, 3.4 výpočty, 3.5 tvrzení stavitele), 4 kontroly kódem, 5 snímky (tabulka soubor / pohled / co je
vidět), 6 integrita (SHA-256), 7 výhrady, 8 předáno dál, 9 předpoklady."""

FIX_PROMPT = """Toto je kolo {round} téže části. Kontrola K5 ji VRÁTILA: {last_k5}.
Přednostně vyřeš všechny povinné body z tohoto protokolu (nic nevynechej, nic nepřidávej navíc), uprav model a zprávu
a v ní doplň oddíl „Kolo {round}“: ke každému bodu co změněno a hodnota PŘED → PO (změřená) s důkazem. Po opravě
zkontroluj okolí každé změny (nové štěrbiny, kolize, spoje) a znovu sebekontrolu podle seznamu."""

K5_PROMPT = """Kontrola K5 části „{label}“ (složka {sub}/), kolo {round}. Model NEMĚNÍŠ a nic neopravuješ.
Kontroluj proti ZADÁNÍ a MANIFESTU (PLCdesk_CAD.json, ROZBOR.md, KUSOVNIK.csv, u stavby i schválený koncept), ne proti
zprávě stavitele — tvrzení stavitele si ověř sám.
{checks}
Na začátku i na konci spočítej SHA-256 všech *.FCStd ve složce stroje (mimo _archiv, plné hodnoty) a uveď je v protokolu.
Protokol zapiš do {k5file} podle stroj-kontrolor/references/protokol.md: první řádek nadpis, pak PRÁVĚ JEDEN řádek
„## Verdikt: **SCHVÁLENO**“ nebo „## Verdikt: **VRÁCENO**“ (žádný jiný řádek nezačíná slovem Verdikt), pod ním
„Povinných bodů: n (blokující b, závažné z) …“, oddíly 1–9 šablony. Schválené protokoly předchozích částí: {approved}.
Neschválené předchozí části: {unapproved}. Jejich vady se počítají u nich (mají vlastní protokol) — to, že tato část
na nich stojí, je u ní jen VÝHRADA (V13 / C1 = N/A s odkazem na protokol té části), ne povinný bod. Povinné body dávej
jen za to, co tato část sama přidává nebo mění; změna schváleného modelu jiné části (SHA) zůstává povinným bodem."""

APPROVED_CHANGED_POINT = ("model části „{label}“ {path} se po schválení K5 změnil (SHA {old} → {new}) — vrátit změnu, "
                          "nebo změnu zapsat jako zpětnou vazbu / předání a nechat tu část znovu zkontrolovat (V13 / C1)")


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
    out = {"stav": "OK", "chyby": 0, "varovani": 0, "file": files[0].relative_to(folder).as_posix(), "modely": [],
           "bezSpoje": 0, "zony": 0, "bezZon": False, "vynechano": []}
    for f in files:
        try:
            rep = json.loads(f.read_text(encoding="utf-8"))
            s = rep.get("souhrn") or {}
        except (OSError, ValueError):
            rep, s = {}, {"stav": "SELHALO"}
        ch = rep.get("checks") if isinstance(rep.get("checks"), dict) else {}
        sv, ot = ch.get("souvislost") or {}, ch.get("otvory") or {}
        try:
            out["bezSpoje"] = max(out["bezSpoje"], int((sv.get("data") or {}).get("bez_spoje") or 0))
        except (TypeError, ValueError, AttributeError):
            pass
        zl = (ot.get("data") or {}).get("zony") if isinstance(ot.get("data"), dict) else None
        if isinstance(zl, list):
            out["zony"] += len(zl)
        infos = [str(i.get("text") or "") for c in ch.values() if isinstance(c, dict)
                 for i in (c.get("info") or []) if isinstance(i, dict)]
        out["vynechano"] += [t for t in infos if "vynechána" in t or "vynechano" in t]
        if any("nemá nebezpečné zóny" in t for t in infos):
            out["bezZon"] = True
        st = s.get("stav") if s.get("stav") in rank else "SELHALO"
        if rank[st] > rank[out["stav"]]:
            out["stav"], out["file"] = st, f.relative_to(folder).as_posix()
        out["chyby"] += int(s.get("chyby") or 0)
        out["varovani"] += int(s.get("varovani") or 0)
        out["modely"].append(f.relative_to(folder).as_posix())
    return out


PRECHECK_PROMPT = """Před předáním kontrolorovi K5 postup ověřil tvé kontroly kódem v {sub}/: {why}.
Kontrolor K5 by část s tím vrátil (nejčastější důvod vrácení v dosavadních bězích). Oprav VŠECHNY chyby z
{sub}/KONTROLY.md, spusť kontroly kódem znovu ({cmd}, kontrola = vse, --out {sub}) až do „Stav: OK“ a aktualizuj zprávu
(i zpětnou vazbu, pokud se změnila čísla). Nic jiného neměň."""


def builder_checks(folder: Path, unit: str) -> str:
    """Důvod, proč kontroly kódem stavitele NEJSOU připravené pro K5 ("" = v pořádku): {sub}/kontroly.json chybí,
    je starší než nejnovější model části, nebo má stav CHYBY / SELHALO."""
    sub = folder / UNIT[unit]["sub"]
    f = sub / "kontroly.json"
    models = [m for m in sub.glob("*.FCStd")]
    if not f.is_file():
        return "kontroly.json chybí (kontroly kódem nespuštěny)"
    if models and max(m.stat().st_mtime for m in models) > f.stat().st_mtime + 1:
        return "kontroly.json je starší než model (po poslední úpravě nespuštěny)"
    try:
        s = (json.loads(f.read_text(encoding="utf-8")).get("souhrn") or {})
    except (OSError, ValueError):
        return "kontroly.json nečitelný"
    if s.get("stav") != "OK":
        return f"stav {s.get('stav') or '?'}, chyb {s.get('chyby', '?')}"
    return ""


def feedback_file(unit: str) -> str:
    return f"PLCdesk_CAD_feedback_{UNIT[unit]['subject']}.json"


def skill_installed(name: str) -> bool:
    """Skill je v ``~/.claude/skills`` (CLI ho načte); bez něj dostane agent vestavěné znění pravidel."""
    return (pro_agent.SKILLS_DIR / name / "SKILL.md").is_file()


def unit_skills(unit: str, role: str = "builder") -> tuple:
    """Skilly části podle role: kontrolor K5 = stroj-kontrolor + odborné skilly části (bez stroj-stavitel)."""
    sk = UNIT[unit]["skills"]
    if role == "k5":
        return (KONTROLOR_SKILL,) + tuple(s for s in sk if s != STAVITEL_SKILL)
    return sk


def system_extra(unit: str, test_safety: bool, role: str = "builder") -> str:
    u = UNIT[unit]
    have = skill_installed(KONTROLOR_SKILL if role == "k5" else STAVITEL_SKILL)
    rules = MODEL_RULES_SKILL if have else fill(MODEL_RULES_INLINE, sub=u["sub"])
    return fill(PIPELINE_RULES, model_rules=rules, feedback=feedback_file(unit), sub=u["sub"],
                casy=str(Path(__file__).resolve().parent / "pro3d_parts" / "bezpecnost_casy.py"),
                test=TEST_RULE if test_safety else "") + "\nSkilly této části: " + ", ".join(unit_skills(unit, role)) + "."


def k5_ids() -> tuple[dict, str]:
    """ID kontrolního seznamu po oddílech ({"V": […], "F": […]…}) a zdroj: soubor skillu stroj-kontrolor
    (``references/kontrolni-seznam.md``, řádky ``| V1 | …``), když chybí / je nečitelný, vestavěný ``K5_ITEMS``."""
    p = pro_agent.SKILLS_DIR / KONTROLOR_SKILL / "references" / "kontrolni-seznam.md"
    ids: list[str] = []
    try:
        ids = re.findall(r"^\|\s*([VKRFMC]\d+)\s*\|", p.read_text(encoding="utf-8"), re.M)
    except OSError:
        pass
    src = p.as_posix() if ids else "vestavěný seznam"
    out: dict = {}
    for i in (ids or list(K5_ITEMS)):
        if i not in out.setdefault(i[0], []):
            out[i[0]].append(i)
    return out, src


def checklist_items(unit: str) -> str:
    """Vestavěný kontrolní seznam části (oddíl V + oddíl části) do pokynu, když skill chybí."""
    sec = K5_SECTION[unit]
    return "\n".join(f"- {i}: {t}" for i, t in K5_ITEMS.items() if i[0] in ("V", sec))


def cabinet_gen_text(gen: dict) -> str:
    """Pokyn stavitele nad rozvaděčem vygenerovaným kódem (``gen`` = výsledek ``make_cabinet``)."""
    listy = "; ".join(f"{x.get('n')} rezerva {x.get('rezerva_pct')} %" for x in gen.get("listy") or []) or "—"
    b = gen.get("bilance") or {}
    bil = (f"{b.get('verdikt')} (Qv {b.get('Qv')} W, Qs {b.get('Qs')} W, chybí ztráty {b.get('chybi', 0)} kusů)" if b else "—")
    o = (b or {}).get("opatreni") or {}
    if o:
        bil += (f"; s ventilátorem {o.get('typ')}: {o.get('verdikt')}, Ti {o.get('ti')} °C, rezerva {o.get('rezerva_K')} K"
                if o.get("typ") else f"; opatření: {o.get('verdikt')}")
    skrin = str(gen.get("skrin") or "—") + (" — ZMĚNA proti manifestu (zpětná vazba)" if gen.get("zmena_skrine") else "")
    return CABINET_GEN_PROMPT.replace("{skrin}", skrin).replace("{listy}", listy).replace("{bilance}", bil)


def frame_gen_text(gen: dict) -> str:
    """Pokyn stavitele nad rámem vygenerovaným kódem (``gen`` = výsledek ``make_frame``)."""
    r = gen.get("rozmery") or {}
    txt = (f"{r.get('D', '?')} × {r.get('W', '?')} × {r.get('H', '?')} mm, podpory {r.get('podpory', '?')}, věnec {gen.get('venec', '?')}, "
           f"{gen.get('hmotnost_kg', '?')} kg, kontroly kódem {gen.get('chyb_kontrol', '?')} chyb; zdroj rozměrů: {gen.get('zdroj') or '?'}")
    sm = Path(gen.get("rozhrani") or "N1_N1.json").name
    return FRAME_GEN_PROMPT.replace("{souhrn}", txt).replace("{smlouva}", sm)


def modules_gen_text(gen: dict) -> str:
    """Pokyn stavitele nad moduly vygenerovanými kódem (``gen`` = výsledek ``make_modules``)."""
    s = gen.get("souhrn") or {}
    txt = (f"válce {s.get('valcu', '?')}, snímače {s.get('snimacu_postaveno', '?')} / {s.get('snimacu', '?')}, hadice "
           f"{s.get('hadic_postaveno', '?')} / {s.get('hadic', '?')}, kabely {s.get('kabelu_postaveno', '?')} / {s.get('kabelu', '?')}, "
           f"nepostaveno {s.get('nepostaveno', '?')} (+ odebráno pro kolizi {gen.get('odebrano', 0)}), požadavky na rám "
           f"{s.get('predani', '?')}") if s else "—"
    return MODULES_GEN_PROMPT.replace("{souhrn}", txt)


def builder_prompt(folder: Path, unit: str, rnd: int, template: str = "", extra: str = "", project: str = "",
                   test_safety: bool = False, rebuild: str = "", generated: dict | None = None) -> str:
    u = UNIT[unit]
    head = [f"Projekt PLCdesk: {project}" if project else "", f"Složka 3D stroje: {folder}",
            f"Část: {u['label']} (podsložka {u['sub']}/), kolo {rnd}"]
    if generated and generated.get("ok") and unit == "cabinet":
        template, rebuild = cabinet_gen_text(generated), ""        # model z kódu: kontrola a doplnění, ne stavba znovu
    elif generated and generated.get("ok") and unit == "modules":
        template, rebuild = modules_gen_text(generated), ""
    elif generated and generated.get("ok") and unit == "frame":
        template, rebuild = frame_gen_text(generated), ""
    body = fill(template.strip() or default_prompt(unit), sub=u["sub"], round=rnd)
    skill = skill_installed(STAVITEL_SKILL)
    have_k5 = skill_installed(KONTROLOR_SKILL)
    body += "\n\n" + fill(BUILD_CHECKS, cmd=tools_cmd("builder"), sub=u["sub"], section=K5_SECTION[unit],
                          conventions=CONVENTIONS_SKILL if skill else CONVENTIONS_INLINE,
                          checklist="stroj-kontrolor/references/kontrolni-seznam.md" if have_k5 else "seznam níže")
    if not have_k5:
        body += "\n" + checklist_items(unit)
    if skill:
        body += "\nPostupuj podle skillu stroj-stavitel (načti ho nástrojem Skill jako první krok)."
    if u["phase"] == "build":
        body += "\n\n" + fill(PARTS_RULES, parts=PARTS_SUB, cmd=parts_cmd("builder"))
    if rebuild and rnd == 1:
        body = fill(REBUILD_PROMPT, sub=u["sub"], archive=rebuild, parts=PARTS_SUB) + "\n\n" + body
    if rnd > 1:
        prev = k5_file(folder, unit, rnd - 1)
        body += "\n\n" + fill(FIX_PROMPT, round=rnd, last_k5=prev.relative_to(folder).as_posix())
    if extra.strip():
        body += "\n\nDoplňující pokyn uživatele:\n" + extra.strip()
    if test_safety:
        body += "\n\n" + TEST_RULE
    body += "\n\nPRŮBĚH: vypisuj řádky „PRŮBĚH k/N: …“ (pravidlo 12)."
    return "\n".join(x for x in head if x) + "\n\n" + body


def k5_prompt(folder: Path, unit: str, rnd: int, project: str = "", test_safety: bool = False,
              approved: str = "", unapproved: str = "") -> str:
    u = UNIT[unit]
    head = [f"Projekt PLCdesk: {project}" if project else "", f"Složka 3D stroje: {folder}"]
    mk, ms, mc = K5_MIN[unit]
    checks = fill(K5_CHECKS, cmd=tools_cmd("k5"), sub=u["sub"], round=rnd, section=K5_SECTION[unit],
                  min_kot=mk, min_shots=ms, min_claims=mc, k5slot=TOOLS_SLOT["k5"])
    body = fill(K5_PROMPT, label=u["label"], sub=u["sub"], round=rnd, checks=checks, approved=approved or "žádné",
                unapproved=unapproved or "žádné",
                k5file=k5_file(folder, unit, rnd).relative_to(folder).as_posix())
    if not skill_installed(KONTROLOR_SKILL):
        body += "\n\n" + fill(K5_FALLBACK, items=checklist_items(unit))
    if test_safety:
        body += "\n\n" + TEST_RULE
    return "\n".join(x for x in head if x) + "\n\n" + body


def parse_verdict(text: str) -> str:
    """``ok`` / ``back`` / ``""`` z protokolu K5 (první řádek „Verdikt“ — kompatibilní se staršími protokoly)."""
    return pro_agent.verdict_kind(pro_agent.verdict_text(text))


# --- brána K5: formální úplnost protokolu (smí jen vracet, nikdy schválit) -------------------------------------

AUTO_HEAD = "## Automatický bod PLCdesk"
_RESULT = re.compile(r"^(N/A|NA|NESPLN[ĚE]NO|SPLN[ĚE]NO)\b", re.I)
_POINTS = re.compile(r"Povinných\s+bodů\s*:\s*(\d+)(?:\s*\(\s*blokující\s*(\d+)\s*,\s*závažné\s*(\d+))?", re.I)
_PNG = re.compile(r"[\w./\\-]+\.png", re.I)
# rozsah snímků v protokolu „k5_kolo3_detail_1…4.png“ / „detail_1-4.png“ (vzor 20, 2026-11-02: brána četla „4.png“)
_PNG_RANGE = re.compile(r"([\w./\\-]*?[_\-])(\d{1,2})\s*(?:…|\.\.\.|–|-)\s*(\d{1,2})\.png", re.I)


def shot_names(text: str) -> list[str]:
    """Jména snímků z textu buňky; rozsah „x_1…4.png“ rozepíše na x_1.png … x_4.png."""
    out: list[str] = []

    def expand(m: re.Match) -> str:
        a, b = int(m.group(2)), int(m.group(3))
        if a <= b and b - a <= 20:
            out.extend(f"{m.group(1)}{i}.png" for i in range(a, b + 1))
            return " "
        return m.group(0)
    rest = _PNG_RANGE.sub(expand, text)
    out += _PNG.findall(rest)
    return list(dict.fromkeys(out))


def _section(text: str, head: str) -> str:
    """Obsah oddílu od nadpisu, který začíná ``head`` (např. ``## 2``, ``### 3.2``), po další nadpis téže nebo vyšší
    úrovně; "" = oddíl chybí."""
    level = len(head) - len(head.lstrip("#"))
    m = re.search(r"^" + re.escape(head) + r"\b.*$", text, re.M)
    if not m:
        return ""
    rest = text[m.end():]
    nxt = re.search(r"^#{1," + str(level) + r"}\s", rest, re.M)
    return rest[:nxt.start()] if nxt else rest


def _table_rows(text: str) -> list[list[str]]:
    """Datové řádky tabulek Markdown (bez záhlaví a oddělovače) jako seznam buněk."""
    def sep(s: str) -> bool:
        return s.startswith("|") and "-" in s and re.fullmatch(r"[|\s:-]+", s) is not None

    rows = []
    lines = [ln.strip() for ln in text.splitlines()]
    for i, ln in enumerate(lines):
        if not ln.startswith("|") or sep(ln):
            continue
        if i + 1 < len(lines) and sep(lines[i + 1]):
            continue                                   # záhlaví (řádek nad oddělovačem)
        cells = [c.strip() for c in ln.strip("|").split("|")]
        if any(c and c not in ("…", "...") for c in cells):
            rows.append(cells)
    return rows


def checklist_rows(text: str) -> dict:
    """{ID: (výsledek SPLNĚNO / NESPLNĚNO / N/A, důkaz)} z tabulky kontrolního seznamu (kap. 2; bez ní celý text)."""
    body = _section(text, "## 2") or text
    out: dict = {}
    for line in body.splitlines():
        m = re.match(r"^\|\s*([VKRFMC]\d+)\s*\|", line.strip())
        if not m:
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        res = next((_RESULT.match(c).group(1).upper() for c in reversed(cells[1:]) if _RESULT.match(c)), "")
        res = {"NA": "N/A", "SPLNENO": "SPLNĚNO", "NESPLNENO": "NESPLNĚNO"}.get(res, res)
        proof = cells[2] if len(cells) >= 4 else ""
        out.setdefault(m.group(1), (res, proof))
    return out


def points_count(text: str) -> dict | None:
    """Řádek „Povinných bodů: n (blokující b, závažné z)“ → {"n", "b", "z"} (b / z None, když chybí)."""
    m = _POINTS.search(text or "")
    if not m:
        return None
    return {"n": int(m.group(1)), "b": int(m.group(2)) if m.group(2) else None,
            "z": int(m.group(3)) if m.group(3) else None}


def png_nonwhite_pct(path: str | Path, limit: float = 100.0) -> float | None:
    """Podíl nebílých pixelů PNG v % (jen zlib, bez závislostí); s ``limit`` skončí, jakmile ho podíl jistě překročí.
    None = formát neumí (prokládání, 16 bit, poškozený soubor) — brána ho pak neposuzuje."""
    import struct
    import zlib
    try:
        data = Path(path).read_bytes()
    except OSError:
        return None
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    pos, idat, ihdr, pal, trns = 8, [], None, b"", b""
    try:
        while pos + 8 <= len(data):
            n, typ = struct.unpack(">I4s", data[pos:pos + 8])
            chunk = data[pos + 8:pos + 8 + n]
            pos += 12 + n
            if typ == b"IHDR":
                ihdr = struct.unpack(">IIBBBBB", chunk)
            elif typ == b"PLTE":
                pal = chunk
            elif typ == b"tRNS":
                trns = chunk
            elif typ == b"IDAT":
                idat.append(chunk)
            elif typ == b"IEND":
                break
        w, h, depth, ctype, _c, _f, inter = ihdr
        if depth != 8 or inter or ctype not in (0, 2, 3, 4, 6):
            return None
        raw = zlib.decompress(b"".join(idat))
    except (TypeError, ValueError, struct.error, zlib.error):
        return None
    bpp = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ctype]
    stride = w * bpp
    total = w * h
    if total == 0 or len(raw) < h * (stride + 1):
        return None
    need = total * limit / 100.0
    prev = bytearray(stride)
    nonwhite = 0
    for y in range(h):
        f = raw[y * (stride + 1)]
        cur = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        if f == 1:
            for i in range(bpp, stride):
                cur[i] = (cur[i] + cur[i - bpp]) & 255
        elif f == 2:
            cur = bytearray((a + b) & 255 for a, b in zip(cur, prev))
        elif f == 3:
            for i in range(stride):
                left = cur[i - bpp] if i >= bpp else 0
                cur[i] = (cur[i] + ((left + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = cur[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                cur[i] = (cur[i] + (a if pa <= pb and pa <= pc else (b if pb <= pc else c))) & 255
        prev = cur
        if ctype != 3 and cur.count(255) == stride:
            continue                                      # celý řádek bílý (rychle, bez smyčky po pixelech)
        for x in range(0, stride, bpp):
            if ctype == 3:
                k = cur[x]
                if k < len(trns) and trns[k] == 0:
                    continue
                px = pal[3 * k:3 * k + 3]
            elif ctype in (4, 6) and cur[x + bpp - 1] == 0:
                continue                                  # průhledný pixel = pozadí
            else:
                px = cur[x:x + (1 if ctype in (0, 4) else 3)]
            if min(px or b"\xff") < 245:
                nonwhite += 1
        if nonwhite > need:
            break
    return 100.0 * nonwhite / total


def _find_shot(folder: Path, unit: str, rnd: int, name: str) -> Path | None:
    name = name.strip("`*()[] ").replace("\\", "/")
    sub = folder / UNIT[unit]["sub"]
    for p in (folder / name, sub / name, sub / f"k5_kolo{rnd}" / Path(name).name):
        if p.is_file():
            return p
    base = Path(name).name
    return next((p for p in sub.rglob(base) if ARCHIVE_DIR not in p.relative_to(folder).parts), None) \
        if sub.is_dir() else None


def k5_audit(folder: str | Path, unit: str, rnd: int, text: str, chk: dict | None = None) -> list[str]:
    """Brána nad protokolem SCHVÁLENO: body, proč schválení neplatí (prázdný seznam = brána prošla). Hodnotí jen úplnost
    a formální přísnost podle skillu stroj-kontrolor (seznam s důkazem, minima, snímky, plné počty z kontroly.json) —
    věcnou správnost posuzuje K5; brána proto smí jen vracet, nikdy schválit."""
    folder = Path(folder)
    text = (text or "").split(AUTO_HEAD)[0]
    pts: list[str] = []
    ids, _src = k5_ids()
    sec = K5_SECTION[unit]
    need = ids.get("V", []) + ids.get(sec, [])
    rows = checklist_rows(text)
    miss = [i for i in need if i not in rows]
    if miss:
        pts.append(f"kontrolní seznam (stroj-kontrolor, oddíl V a {sec}): chybí řádky {', '.join(miss)} — "
                   "položka bez řádku = NESPLNĚNO")
    bad = [i for i in need if rows.get(i, ("",))[0] == "NESPLNĚNO"]
    if bad:
        pts.append("SCHVÁLENO s nesplněnými položkami " + ", ".join(bad))
    nores = [i for i in need if i in rows and not rows[i][0]]
    if nores:
        pts.append("položky bez výsledku SPLNĚNO / NESPLNĚNO / N/A: " + ", ".join(nores))
    noproof = [i for i in need if rows.get(i, ("",))[0] == "SPLNĚNO"
               and re.sub(r"[\s—–\-.?…]", "", rows[i][1]) == ""]
    if noproof:
        pts.append("SPLNĚNO bez důkazu (položka bez důkazu = NESPLNĚNO): " + ", ".join(noproof))
    verd = [ln for ln in text.splitlines() if re.match(r"^[#*\s]*Verdikt\b", ln, re.I)]
    if len(verd) > 1:
        pts.append(f"protokol má {len(verd)} řádky začínající „Verdikt“ — smí být právě jeden (protokol.md)")
    pc = points_count(text)
    if pc and pc["n"] > 0:
        pts.append(f"SCHVÁLENO s povinnými body ({pc['n']}) — povinný bod = VRÁCENO")
    mk, ms, mc = K5_MIN[unit]
    for head, lo, what in (("### 3.1", 1, "tabulka zón nebezpečí (3.1)"), ("### 3.2", mk, "vlastní kóty proti zadání (3.2)"),
                           ("### 3.5", mc, "ověřená tvrzení stavitele (3.5)")):
        n = len(_table_rows(_section(text, head)))
        if n < lo:
            pts.append(f"{what}: {n} řádků, minimum {lo}")
    shots = _table_rows(_section(text, "## 5"))
    if len(shots) < ms:
        pts.append(f"prohlédnuté snímky (kap. 5): {len(shots)}, minimum {ms}")
    missing, blank = [], []
    for row in shots:
        for name in shot_names(" ".join(row)):
            p = _find_shot(folder, unit, rnd, name)
            if p is None:
                missing.append(Path(name.replace("\\", "/")).name)
                continue
            pct = png_nonwhite_pct(p, limit=BLANK_SHOT_PCT)
            if pct is not None and pct < BLANK_SHOT_PCT:
                blank.append(f"{p.name} ({pct:.1f} %)")
    if missing:
        pts.append("snímky z kap. 5 neexistují: " + ", ".join(missing[:8]))
    if blank:
        pts.append("prázdné snímky (nebílých pixelů < 1 % — nástroj selhal): " + ", ".join(blank[:8]))
    if chk:
        bs = int(chk.get("bezSpoje") or 0)
        if bs > BEZ_SPOJE_SHOWN and "bez_spoje" not in text:
            pts.append(f"data.bez_spoje = {bs} (varování ukazují jen {BEZ_SPOJE_SHOWN}) — skutečný počet neposouzen (V4)")
        if chk.get("vynechano") and "vynechan" not in _fold(text):
            pts.append("info kontrol kódem „" + chk["vynechano"][0][:120] + "“ neposouzeno (V4)")
        if chk.get("bezZon") and unit != "cabinet" and rows.get("V3", ("",))[0] == "SPLNĚNO":
            pts.append("model nemá zóny nebezpečí (Zona_*), V3 přesto SPLNĚNO — kontrola otvorů neproběhla")
    return pts


def _fold(s: str) -> str:
    """Malá písmena bez diakritiky."""
    import unicodedata
    s = unicodedata.normalize("NFKD", s or "")
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


def unit_models(folder: Path, unit: str) -> dict:
    """SHA-256 modelů FCStd části (podsložka, mimo archiv)."""
    sub = UNIT[unit]["sub"] + "/"
    return {k: v for k, v in _sha_models(folder).items() if k.startswith(sub)}


def approved_changes(state: dict, cur: dict, unit: str) -> list[tuple]:
    """Schválené části (jiné než ``unit``), jejichž model se od schválení K5 změnil: [(část, cesta, staré, nové)]."""
    out = []
    for k in UNIT_KEYS:
        if k == unit:
            continue
        u = state["units"].get(k) or {}
        last = (u.get("rounds") or [{}])[-1]
        if u.get("state") != "approved" or not isinstance(last.get("approvedSha"), dict):
            continue
        for path, sha in sorted(last["approvedSha"].items()):
            if cur.get(path) != sha:
                out.append((k, path, sha, cur.get(path) or "chybí"))
    return out


def unapproved_list(state: dict, unit: str) -> str:
    """Předchozí AI části, které po svých kolech zůstaly neschválené: „<část>: <poslední protokol>“."""
    out = []
    for k in UNIT_KEYS[:UNIT_KEYS.index(unit)]:
        u = state["units"].get(k) or {}
        if k not in AI_UNITS or u.get("state") == "approved" or not u.get("rounds"):
            continue
        last = u["rounds"][-1]
        out.append(f"{UNIT[k]['label']}: {last.get('file') or 'bez protokolu'}")
    return "; ".join(out)


def approved_list(state: dict, unit: str) -> str:
    """Schválené protokoly předchozích částí pro pokyn K5: „<část>: <protokol>, SHA <model> …“."""
    out = []
    for k in UNIT_KEYS[:UNIT_KEYS.index(unit)]:
        u = state["units"].get(k) or {}
        last = (u.get("rounds") or [{}])[-1]
        if u.get("state") != "approved" or not last.get("file"):
            continue
        shas = ", ".join(f"{p} {s}" for p, s in sorted((last.get("approvedSha") or {}).items()))
        out.append(f"{UNIT[k]['label']}: {last['file']}" + (f" (SHA {shas})" if shas else ""))
    return "; ".join(out)


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
        log(_("Vstupy: seznam modelů ke stažení…"))
        written += write_download_list(folder, log=log)
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


def write_download_list(folder: str | Path, *, log=print) -> list[str]:
    """STAHNOUT.md / .html (modely výrobců k ručnímu stažení, ``pro3d_download``) nad ``PLCdesk_CAD.json``; díly
    „dle dokumentace“ z ``dily/parts_index.json`` (bez něj z mapování generátorů). Chyba postup nezastaví."""
    from .pro3d_download import listing as dl
    folder = Path(folder)
    try:
        man = json.loads((folder / "PLCdesk_CAD.json").read_text(encoding="utf-8"))
        return dl.write_lists(folder, man)["files"]
    except (OSError, ValueError, KeyError) as exc:
        log(_("Seznam modelů ke stažení nevznikl: {exc}", exc=exc))
        return []


def make_parts(folder: str | Path, *, log=print, slot: str = "", timeout: int = 1800) -> dict:
    """Normalizované díly kódem (``pro3d_parts gen``) nad ``PLCdesk_CAD.json`` → ``dily/parts_index.json`` + modely FCStd.
    FreeCAD jen ve vlastní instanci (slot ``pro3d-parts``); hotové modely se nepřestavují. Vrací ``{"souhrn", "chyba"}``."""
    slot = slot or PARTS_SLOT
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


def make_cabinet(folder: str | Path, *, log=print, slot: str = CABINET_SLOT, timeout: int = 1200) -> dict:
    """Rozvaděč kódem (``pro3d_cabinet``) nad ``PLCdesk_CAD.json`` → ``rozvadec/Rozvadec.FCStd``, ``ROZVADEC.md``, ``layout.json``.
    FreeCAD jen ve vlastní instanci (slot ``pro3d-cabinet``). ``ok`` = model vznikl (kód 0 / 1 — i nevyhovující bilance je
    výsledek k rozhodnutí uživatele); kód 2 / bez modelu = selhalo → stavitel staví postaru."""
    folder = Path(folder)
    man = folder / "PLCdesk_CAD.json"
    if not man.is_file():
        return {"ok": False, "chyba": "PLCdesk_CAD.json chybí"}
    log(_("Rozvaděč: generátor kódem…"))
    try:
        r = subprocess.run([_python(), "-I", str(CABINET_DIR / "cli.py"), str(man), str(folder), "--slot", slot,
                            "--timeout", str(timeout)], capture_output=True, text=True, encoding="utf-8", errors="replace",
                           timeout=timeout + 900, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"ok": False, "chyba": str(exc)}
    line = next((x for x in reversed((r.stdout or "").splitlines()) if x.startswith("{")), "")
    try:
        res = json.loads(line)
    except ValueError:
        return {"ok": False, "chyba": ((r.stdout or "") + (r.stderr or ""))[-1500:] or f"kód {r.returncode}"}
    ok = bool(res.get("fcstd")) and Path(res["fcstd"]).is_file() and int(res.get("kod", 2)) in (0, 1)
    return {"ok": ok, "kod": res.get("kod"), "skrin": res.get("skrin"), "zmena_skrine": res.get("zmena_skrine"),
            "listy": res.get("listy"), "bilance": res.get("bilance"), "rezerva_ok": res.get("rezerva_ok"),
            "chyba": res.get("chyba") or ("" if ok else "model nevznikl")}


def make_frame(folder: str | Path, *, log=print, slot: str = FRAME_SLOT, timeout: int = 1500, celek: bool = True) -> dict:
    """Rám kódem (``pro3d_lib/ram_gen.py`` = modul N1) nad ``PLCdesk_CAD.json`` a ``koncept/Koncept.FCStd`` →
    (``celek`` = stroj s pásovým dopravníkem: rozměry rámu z CELKU ``pro3d_lib.celek`` — moduly kódem určí rám, ne půdorys
    konceptu; bez dopravníku / ``celek=False`` jako dřív)
    ``ram/Ram.FCStd``, smlouva ``ram/N1_<id>.json``, ``RAM.md``, snímky. FreeCAD jen ve vlastní instanci (slot ``pro3d-frame``).
    ``ok`` = model vznikl (kód 0 / 1 — chyby kontrol posoudí stavitel / K5); kód 2 / bez modelu = stavitel staví postaru."""
    folder = Path(folder)
    man = folder / "PLCdesk_CAD.json"
    if not man.is_file():
        return {"ok": False, "chyba": "PLCdesk_CAD.json chybí"}
    log(_("Rám: generátor kódem…"))
    try:
        r = subprocess.run([_python(), "-I", str(FRAME_SCRIPT), str(man), str(folder), "--slot", slot, "--timeout", str(timeout)]
                           + ([] if celek else ["--bez-celku"]),
                           capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout + 1500,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"ok": False, "chyba": str(exc)}
    line = next((x for x in reversed((r.stdout or "").splitlines()) if x.startswith("{")), "")
    try:
        res = json.loads(line)
    except ValueError:
        return {"ok": False, "chyba": ((r.stdout or "") + (r.stderr or ""))[-1500:] or f"kód {r.returncode}"}
    ok = bool(res.get("fcstd")) and Path(res["fcstd"]).is_file() and int(res.get("kod", 2)) in (0, 1)
    return {"ok": ok, "kod": res.get("kod"), **{k: res.get(k) for k in ("rozhrani", "rozmery", "umisteni", "zdroj", "venec", "hmotnost_kg",
                                                                        "chyby_planu", "poznamky", "chyb_kontrol", "selhalo", "snimky")},
            "chyba": res.get("chyba") or ("" if ok else "model nevznikl")}


def make_modules(folder: str | Path, *, log=print, slot: str = MODULES_SLOT, timeout: int = 1800) -> dict:
    """Moduly kódem (``pro3d_modules``) nad ``PLCdesk_CAD.json``, ``ram/Ram.FCStd`` a ``koncept/Koncept.FCStd`` →
    ``moduly/Moduly.FCStd``, ``MODULY.md``, ``layout.json``. FreeCAD jen ve vlastní instanci (slot ``pro3d-modules``).
    ``ok`` = model vznikl (kód 0 / 1 — nepostavené položky doplní stavitel); kód 2 / bez modelu = stavitel staví postaru."""
    folder = Path(folder)
    man = folder / "PLCdesk_CAD.json"
    if not man.is_file():
        return {"ok": False, "chyba": "PLCdesk_CAD.json chybí"}
    if not (folder / "ram" / "Ram.FCStd").is_file():
        return {"ok": False, "chyba": "ram/Ram.FCStd chybí"}
    log(_("Moduly: generátor kódem…"))
    try:
        r = subprocess.run([_python(), "-I", str(MODULES_DIR / "cli.py"), str(man), str(folder), "--slot", slot,
                            "--timeout", str(timeout)], capture_output=True, text=True, encoding="utf-8", errors="replace",
                           timeout=timeout + 1800, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"ok": False, "chyba": str(exc)}
    line = next((x for x in reversed((r.stdout or "").splitlines()) if x.startswith("{")), "")
    try:
        res = json.loads(line)
    except ValueError:
        return {"ok": False, "chyba": ((r.stdout or "") + (r.stderr or ""))[-1500:] or f"kód {r.returncode}"}
    ok = bool(res.get("fcstd")) and Path(res["fcstd"]).is_file() and int(res.get("kod", 2)) in (0, 1)
    return {"ok": ok, "kod": res.get("kod"), "souhrn": res.get("souhrn"), "odebrano": res.get("odebrano", 0),
            "chyba": res.get("chyba") or ("" if ok else "model nevznikl")}


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
        if ARCHIVE_DIR in p.relative_to(folder).parts:
            continue
        try:
            out[p.relative_to(folder).as_posix()] = hashlib.sha256(p.read_bytes()).hexdigest()
        except OSError:
            pass
    return out


def default_unit_rounds(base: int = MAX_ROUNDS) -> dict:
    return {k: int(UNIT_ROUNDS.get(k) or base) for k in AI_UNITS}


def blank_state(project: str = "", max_rounds: int = MAX_ROUNDS, test_safety: bool = False) -> dict:
    return {"version": 1, "project": project, "maxRounds": max_rounds, "testSafety": test_safety,
            "unitRounds": default_unit_rounds(max_rounds),
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
    ur = st.get("unitRounds") if isinstance(st.get("unitRounds"), dict) else {}
    total = 0.0
    for k in UNIT_KEYS:
        u = st["units"][k]
        if u["state"] in FINAL or u["state"] == "skipped":
            total += 1
        elif u.get("rounds"):
            r = u["rounds"][-1]
            mx = max(1, int(ur.get(k) or st.get("maxRounds") or MAX_ROUNDS))
            total += min(0.95, (len(u["rounds"]) - 1 + (0.5 if r.get("builder") else 0)) / mx)
    return total / len(UNIT_KEYS)


class Pipeline:
    """Automatický postup nad složkou stroje. ``run()`` běží ve volajícím vlákně (GUI ho pouští ve vlákně na pozadí),
    ``stop()`` smí volat jiné vlákno. ``state`` = obsah ``pipeline.json``; ``current`` = běžící ``AgentRun``."""

    def __init__(self, folder: str | Path, prj: dict, *, max_rounds: int | None = None, test_safety: bool = False,
                 prompts: dict | None = None, extras: dict | None = None, runner=None, ai: bool = True,
                 inputs_fn=None, log=None, models: dict | None = None, turns: dict | None = None,
                 parts: bool | None = None, parts_fn=None, cabinet_fn=None, modules_fn=None, frame_fn=None,
                 generators: bool = False) -> None:
        self.folder = Path(folder)
        self.prj = prj
        self.project = str((prj.get("meta") or {}).get("name") or "")
        self.test_safety = bool(test_safety)
        self.prompts = prompts or {}
        self.extras = extras or {}
        self.runner = runner
        self.ai = ai
        self.inputs_fn = inputs_fn or make_inputs
        self.parts = ai if parts is None else bool(parts)     # normalizované díly před stavbou (FreeCAD, bez AI)
        self.parts_fn = parts_fn or make_parts
        self.cabinet_fn = cabinet_fn or make_cabinet          # rozvaděč kódem před stavitelem (jen s generátory dílů)
        self.modules_fn = modules_fn or make_modules          # moduly kódem před stavitelem (jen s generátory dílů)
        self.frame_fn = frame_fn or make_frame                # rám N1 kódem před stavitelem (jen s generátory dílů)
        self.generators = bool(generators)                    # bez AI: aspoň generátory kódem (rozvaděč, rám, moduly)
        self.events: list[str] = []
        self._log = log
        self.current = None
        self.stop_requested = False
        self.lock = threading.Lock()
        self.state = load_state(self.folder) or blank_state(self.project, MAX_ROUNDS, self.test_safety)
        # max. kol podle části: výchozí (UNIT_ROUNDS, jinak MAX_ROUNDS) < pipeline.json < volba max_rounds (všem částem)
        if max_rounds is not None:
            self.max_rounds = max(1, int(max_rounds))
            self.state["unitRounds"] = {k: self.max_rounds for k in AI_UNITS}
        else:
            self.max_rounds = max(1, int(self.state.get("maxRounds") or MAX_ROUNDS))
            st_r = self.state.get("unitRounds") if isinstance(self.state.get("unitRounds"), dict) else {}
            self.state["unitRounds"] = {k: max(1, int(st_r.get(k) or d)) for k, d in default_unit_rounds(self.max_rounds).items()}
        self.state["maxRounds"] = self.max_rounds
        self.state["testSafety"] = self.test_safety
        # model a limit kol podle role: výchozí < pipeline.json < volba (krok / CLI)
        st_m = self.state.get("models") if isinstance(self.state.get("models"), dict) else {}
        st_t = self.state.get("maxTurns") if isinstance(self.state.get("maxTurns"), dict) else {}
        self.state["models"] = {r: str((models or {}).get(r) or st_m.get(r) or d).strip()
                                for r, d in pro_agent.ROLE_MODELS.items()}
        self.state["maxTurns"] = {r: max(1, int((turns or {}).get(r) or st_t.get(r) or d))
                                  for r, d in pro_agent.ROLE_TURNS.items()}

    def rounds_for(self, unit: str) -> int:
        """Max. kol stavitel + K5 pro část (``pipeline.json`` ``unitRounds``)."""
        return int(self.state["unitRounds"].get(unit) or self.max_rounds)

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
        keys = UNIT_KEYS[i:]
        arch = self._archive(keys)
        for k in keys:
            u = self.state["units"][k]
            if u.get("rounds"):
                u.setdefault("history", []).append({"at": _now(), "state": u["state"], "rounds": u["rounds"]})
            u["state"], u["rounds"] = "waiting", []
            u.pop("rebuild", None)
            u.pop("generated", None)
            if arch and k in arch["units"]:
                u["rebuild"] = f"{arch['dir']}/{UNIT[k]['sub']}"

    def _archive(self, keys) -> dict | None:
        """Výstupy resetovaných částí (podsložky a jejich logy) přesune do ``_archiv/<čas>/`` — nic se nemaže."""
        stamp = _dt.datetime.now().strftime("%Y%m%d-%H%M%S")
        rel = f"{ARCHIVE_DIR}/{stamp}"
        dest = self.folder / rel
        n = 1
        while dest.exists():
            n += 1
            rel = f"{ARCHIVE_DIR}/{stamp}-{n}"
            dest = self.folder / rel
        moved, logs = [], []
        ld = self.folder / LOG_DIR
        for k in keys:
            sub = UNIT[k]["sub"]
            src = self.folder / sub if sub else None
            if src is not None and src.is_dir() and any(src.iterdir()):
                dest.mkdir(parents=True, exist_ok=True)
                shutil.move(str(src), str(dest / sub))
                moved.append(k)
            idx = UNIT_KEYS.index(k)
            for f in (sorted(ld.glob(f"{idx:02d}_{k}_kolo*.log")) if ld.is_dir() else []):
                (dest / LOG_DIR).mkdir(parents=True, exist_ok=True)
                shutil.move(str(f), str(dest / LOG_DIR / f.name))
                logs.append(f.name)
        if not moved and not logs:
            return None
        rec = {"at": _now(), "dir": rel, "units": moved, "logs": len(logs)}
        self.state.setdefault("archives", []).append(rec)
        self.log(_("Dřívější výstupy přesunuty do {dir}.", dir=rel))
        return rec

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
                    if self.generators and self.parts and key in GEN_FNS:
                        getattr(self, GEN_FNS[key])()          # generátor kódem bez agenta (ověření postupu bez AI)
                    u["state"] = "skipped"
                    self.save()
                    continue
                else:
                    res = self._unit(key)
                if res in ("stopped", "failed"):
                    status = res
                    break
                if key == "concept" and res == "rejected":
                    self.log(_n(self.rounds_for("concept"), N_("Koncept neschválen ani po {n} kole — postup zastaven (stavba nad "
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
        if (self.folder / "PLCdesk_CAD.json").is_file():   # seznam ke stažení bez dílů „dle dokumentace“
            write_download_list(self.folder, log=self.log)
        self.save()

    def _modules(self) -> dict:
        """Před 1. kolem stavitele modulů: generátor kódem (FreeCAD, bez AI). Chyba postup nezastaví — stavitel pak
        staví postaru. Výsledek v ``units.modules.generated`` (navázání ho nespouští znovu)."""
        u = self.state["units"]["modules"]
        if u.get("generated") is not None:
            return u["generated"]
        try:
            res = self.modules_fn(self.folder, log=self.log) or {}
        except Exception as exc:  # noqa: BLE001
            res = {"ok": False, "chyba": str(exc)}
        res = dict(res, at=_now())
        u["generated"] = res
        if res.get("ok"):
            s = res.get("souhrn") or {}
            self.log(_("Moduly vygenerovány kódem: hadice {h}, kabely {k}, nepostaveno {n} (doplní stavitel).",
                       h=s.get("hadic_postaveno", "?"), k=s.get("kabelu_postaveno", "?"), n=s.get("nepostaveno", "?")))
        else:
            self.log(_("Generátor modulů selhal ({exc}) — stavitel staví moduly sám.", exc=res.get("chyba") or "?"))
        self.save()
        return res

    def _frame(self) -> dict:
        """Před 1. kolem stavitele rámu a krytů: rám N1 kódem (FreeCAD, bez AI). Chyba postup nezastaví — stavitel pak
        staví postaru. Výsledek v ``units.frame.generated`` (navázání ho nespouští znovu)."""
        u = self.state["units"]["frame"]
        if u.get("generated") is not None:
            return u["generated"]
        try:
            res = self.frame_fn(self.folder, log=self.log) or {}
        except Exception as exc:  # noqa: BLE001
            res = {"ok": False, "chyba": str(exc)}
        res = dict(res, at=_now())
        u["generated"] = res
        if res.get("ok"):
            r = res.get("rozmery") or {}
            self.log(_("Rám vygenerován kódem: {d} × {w} × {h} mm, chyb kontrol: {n}.", d=r.get("D", "?"), w=r.get("W", "?"),
                       h=r.get("H", "?"), n=res.get("chyb_kontrol", "?")))
        else:
            self.log(_("Generátor rámu selhal ({exc}) — stavitel staví rám sám.", exc=res.get("chyba") or "?"))
        self.save()
        return res

    def _cabinet(self) -> dict:
        """Před 1. kolem stavitele rozvaděče: generátor kódem (FreeCAD, bez AI). Chyba postup nezastaví — stavitel pak
        staví postaru. Výsledek v ``units.cabinet.generated`` (navázání ho nespouští znovu)."""
        u = self.state["units"]["cabinet"]
        if u.get("generated") is not None:
            return u["generated"]
        try:
            res = self.cabinet_fn(self.folder, log=self.log) or {}
        except Exception as exc:  # noqa: BLE001
            res = {"ok": False, "chyba": str(exc)}
        res = dict(res, at=_now())
        u["generated"] = res
        if res.get("ok"):
            self.log(_("Rozvaděč vygenerován kódem: {cab}; tepelná bilance {bil}.", cab=res.get("skrin") or "?",
                       bil=(res.get("bilance") or {}).get("verdikt") or "?"))
        else:
            self.log(_("Generátor rozvaděče selhal ({exc}) — stavitel staví rozvaděč sám.", exc=res.get("chyba") or "?"))
        self.save()
        return res

    def _agent(self, unit: str, role: str, prompt: str, rnd: int, cont: bool = False) -> dict:
        logs = self.folder / LOG_DIR
        logs.mkdir(parents=True, exist_ok=True)
        idx = UNIT_KEYS.index(unit)
        path = logs / f"{idx:02d}_{unit}_kolo{rnd}_{role}{'_pokracovani' if cont else ''}.log"
        runner = self.runner or agent_runner()
        self.log(_("{part}, kolo {n}: {role}…", part=_(UNIT[unit]["label"]), n=rnd, role=_(dict(pro_agent.ROLES)[role])))
        t0 = time.monotonic()
        res = runner(self, role, prompt, system_extra(unit, self.test_safety, role), path) or {}
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
                if rounds and len(rounds) >= self.rounds_for(key):
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
                gen = None
                if key in GEN_FNS and self.parts:
                    fn = getattr(self, GEN_FNS[key])
                    gen = fn() if n == 1 or u.get("generated") is not None else None
                p = builder_prompt(self.folder, key, n, self.prompts.get(key, ""), self.extras.get(key, ""),
                                   self.project, self.test_safety, rebuild=u.get("rebuild", ""), generated=gen)
                prev = r["builder"] if r["builder"] and r["builder"].get("subtype") == "error_max_turns" else None
                r["builder"] = self._agent(key, role, p + (CONTINUE_PROMPT if prev else ""), n)
                if prev:                               # navázání po zastavení / pádu uprostřed pokračování
                    r["builder"] = _merge_runs(prev, r["builder"])
                if (r["builder"].get("state") == "failed" and r["builder"].get("subtype") == "error_max_turns"
                        and not self.stop_requested):
                    # limit kol vyčerpán uprostřed práce → jedno pokračování, ne pád celého postupu
                    self.log(_("{part}, kolo {n}: limit kol vyčerpán, pokračuji…", part=_(UNIT[key]["label"]), n=n))
                    self.save()
                    r["builder"] = _merge_runs(r["builder"], self._agent(key, role, p + CONTINUE_PROMPT, n, cont=True))
                self.save()
                if r["builder"].get("state") != "done":
                    u["state"] = r["builder"].get("state") if r["builder"].get("state") in ("stopped",) else "failed"
                    self.save()
                    return u["state"]
            # brána PŘED K5 (2026-11-03, analýza 116 bodů K5: odevzdání s chybami kontrol kódem): jedno opravné kolo
            # stavitele místo drahého kontrolora; když ani potom kontroly neprojdou, K5 rozhodne sám
            if self.ai and key != "concept" and not r.get("precheck") and not self.stop_requested:
                why = builder_checks(self.folder, key)
                if why:
                    r["precheck"] = why
                    self.log(_("{part}, kolo {n}: kontroly kódem stavitele neprošly ({why}) — vracím staviteli před K5.",
                               part=_(UNIT[key]["label"]), n=n, why=why))
                    self.save()
                    pf = fill(PRECHECK_PROMPT, sub=UNIT[key]["sub"], why=why, cmd=tools_cmd("builder"))
                    r["builder"] = _merge_runs(r["builder"], self._agent(key, "builder", pf, n, cont=True))
                    self.save()
                    if self.stop_requested:
                        return "stopped"
            u["state"] = "review"
            self.save()
            before = _sha_models(self.folder)
            # modely schválených částí změněné po jejich K5 (V13 / C1) — do pokynu i jako automatický bod
            drift = approved_changes(self.state, before, key)
            appr = approved_list(self.state, key)
            if drift:
                appr += "; POZOR — po schválení změněno: " + "; ".join(
                    f"{UNIT[k]['label']} {pth} {old} → {new}" for k, pth, old, new in drift)
            kp = k5_prompt(self.folder, key, n, self.project, self.test_safety, approved=appr,
                           unapproved=unapproved_list(self.state, key))
            kcont = fill(K5_CONTINUE_PROMPT, sub=UNIT[key]["sub"], round=n,
                         k5file=k5_file(self.folder, key, n).relative_to(self.folder).as_posix())
            prev = r["k5"] if r["k5"] and r["k5"].get("subtype") == "error_max_turns" else None
            r["k5"] = self._agent(key, "k5", kp + (kcont if prev else ""), n, cont=bool(prev))
            if prev:                                   # navázání po pádu uprostřed pokračování kontroly
                r["k5"] = _merge_runs(prev, r["k5"])
            if (r["k5"].get("state") == "failed" and r["k5"].get("subtype") == "error_max_turns"
                    and not self.stop_requested and not r["k5"].get("continued")):
                # limit kol kontrolora → jedno pokračování (dopsat protokol), teprve druhé selhání = failed
                self.log(_("{part}, kolo {n}: kontrolor vyčerpal limit kol, pokračuji…", part=_(UNIT[key]["label"]), n=n))
                self.save()
                r["k5"] = _merge_runs(r["k5"], self._agent(key, "k5", kp + kcont, n, cont=True))
            if r["k5"].get("state") != "done":
                u["state"] = "stopped" if r["k5"].get("state") == "stopped" else "failed"
                r["k5"] = None if u["state"] == "stopped" else r["k5"]
                self.save()
                return u["state"]
            self._verdict(key, r, n, before, drift)
            if r["verdict"] == "ok":
                u["state"] = "approved"
                self.save()
                return "approved"
            self.save()

    def _verdict(self, key: str, r: dict, n: int, before: dict, drift: list) -> None:
        """Verdikt kola z protokolu K5 + pojistky postupu (smí jen vracet): změna modelu kontrolorem, kontroly kódem
        (chybí / SELHALO / CHYBY), změněný schválený model jiné části, brána K5 nad protokolem SCHVÁLENO."""
        f = k5_file(self.folder, key, n)
        r["file"] = f.relative_to(self.folder).as_posix()
        text = f.read_text(encoding="utf-8", errors="replace") if f.is_file() else ""
        kind = parse_verdict(text)
        r["points"] = points_count(text)
        after = _sha_models(self.folder)
        changed = sorted(k for k, v in after.items() if before.get(k) != v)
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
        r["verdictText"] = pro_agent.verdict_text(text)
        auto: list[str] = []
        why = ""
        if chk is None or chk.get("stav") == "SELHALO":
            # bez kontrol skriptem (chybí / nečitelné / selhaly) se verdikt nepřijme → VRÁCENO s automatickým bodem
            if chk is None:
                self.log(_("Kontrolor nespustil kontroly kódem (kontroly.json chybí) — verdikt VRÁCENO."))
            else:
                self.log(_("Kontroly kódem K5 ({file}) SELHALY — verdikt VRÁCENO.", file=chk["file"]))
            kind = "back"
            auto.append(fill(K5_NO_CHECKS_POINT, sub=UNIT[key]["sub"], round=n))
            r["k5NoChecks"] = "missing" if chk is None else "SELHALO"
            r["verdictText"] = why = "VRÁCENO (bez kontrol skriptem)"
        if drift:
            r["approvedChanged"] = [{"unit": k, "path": p, "old": o, "new": nw} for k, p, o, nw in drift]
            auto += [fill(APPROVED_CHANGED_POINT, label=UNIT[k]["label"], path=p, old=o[:12], new=nw[:12])
                     for k, p, o, nw in drift]
            self.log(_("Schválený model jiné části se změnil ({files}) — verdikt VRÁCENO.",
                       files=", ".join(p for _k, p, _o, _n in drift)))
            if kind == "ok":
                kind = "back"
                r["verdictText"] = why = why or "VRÁCENO (změněn schválený model)"
        if kind == "ok":
            gate = k5_audit(self.folder, key, n, text, chk)
            r["k5Audit"] = gate
            if gate:
                self.log(_n(len(gate), N_("Brána K5: protokol SCHVÁLENO nesplňuje {n} požadavek — verdikt VRÁCENO."
                                          "|Brána K5: protokol SCHVÁLENO nesplňuje {n} požadavky — verdikt VRÁCENO."
                                          "|Brána K5: protokol SCHVÁLENO nesplňuje {n} požadavků — verdikt VRÁCENO.")))
                kind = "back"
                auto += gate
                r["verdictText"] = why = "VRÁCENO (brána K5)"
        if auto:
            r["autoPoints"] = auto
            reason = {"VRÁCENO (bez kontrol skriptem)": "kontroly kódem chybí nebo selhaly, verdikt kontrolora neplatí.",
                      "VRÁCENO (brána K5)": "protokol SCHVÁLENO nesplňuje formální požadavky kontroly (kontrolní "
                                            "seznam s důkazem, minima, snímky) — schválení neplatí.",
                      "VRÁCENO (změněn schválený model)": "část stojí na modelu jiné části změněném po jejím schválení."}
            try:
                f.parent.mkdir(parents=True, exist_ok=True)
                with open(f, "a", encoding="utf-8") as fh:
                    fh.write(("\n" if text and not text.endswith("\n") else "") + f"\n{AUTO_HEAD}\n\n"
                             + (f"Verdikt: **{why}** — {reason.get(why, '')}\n\n" if why else "")
                             + "".join(f"{i}. {p}\n" for i, p in enumerate(auto, 1)))
            except OSError:
                pass
        if kind == "ok":
            r["approvedSha"] = unit_models(self.folder, key)     # SHA schválených modelů části (V13 / C1)
        r["verdict"] = kind or "none"
        self.log(_("{part}, kolo {n}: verdikt {v}.", part=_(UNIT[key]["label"]), n=n,
                   v=r["verdictText"] or _("chybí")))


# --- přehled -------------------------------------------------------------------------------------------------------

_ODHAD = re.compile(r"\bODHAD\b")
_ROLE_CS = {"concept": "Koncept", "builder": "Stavitel", "k5": "Kontrolor K5"}


def collect_estimates(folder: Path, limit: int = 60) -> list[str]:
    out = []
    for p in sorted(folder.rglob("*.md")):
        if p.name in (SUMMARY_FILE, "ROZBOR.md") or LOG_DIR in p.parts or ARCHIVE_DIR in p.parts or p.name.upper().startswith("KONTROLA_K5"):
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


def _rounds_text(st: dict) -> str:
    ur = st.get("unitRounds") if isinstance(st.get("unitRounds"), dict) else {}
    base = st.get("maxRounds") or MAX_ROUNDS
    extra = [f"{UNIT[k]['label']} {v}" for k, v in ur.items() if k in UNIT and v != base]
    return f"{base}" + (f" ({', '.join(extra)})" if extra else "")


def write_summary(folder: str | Path, st: dict) -> Path:
    """``PREHLED.md``: fáze, kola, verdikty, cena a tokeny, předpoklady (ODHAD), zpětná vazba, snímky, TEST."""
    folder = Path(folder)
    L = [f"# Přehled automatického postupu 3D — {st.get('project') or folder.name}", ""]
    if st.get("testSafety"):
        L += [f"> **{TEST_MARK}** — bezpečnostní prvky a funkce byly v tomto běhu považovány za schválené.", ""]
    L += [f"Stav postupu: **{st.get('status')}**, aktualizováno {st.get('updated')}, max. kol {_rounds_text(st)}.", "",
          "| Fáze | Krok | Stav | Kola | Verdikty | Odhad USD (ceník API) | Tokeny vstup / výstup |", "|---|---|---|---|---|---|---|"]
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
                pc = r.get("points") or {}
                if pc.get("n"):
                    v += f" ({pc['n']} b." + (f", B {pc['b']} / Z {pc['z']}" if pc.get("b") is not None else "") + ")"
                if r.get("k5Audit"):
                    v += " (brána K5)"
                verd.append(f"{r['n']}: [{v}]({r['file']})" if r.get("file") else f"{r['n']}: {v}")
        tc, ti, to = tc + cost, ti + tin, to + tout
        lbl = STATE_LABELS.get(u["state"], u["state"]).replace("{n}", str(len(u.get("rounds") or [])))
        L.append(f"| {dict(PHASES)[UNIT[k]['phase']]} | {UNIT[k]['label']} | {lbl} | {len(u.get('rounds') or [])} | "
                 f"{'; '.join(verd) or '—'} | {cost:.2f} | {tin} / {tout} |")
    L += ["", f"**Celkem:** tokeny vstup {ti} / výstup {to}; odhad podle ceníku API {tc:.2f} USD.", "",
          "> Částka je přepočet tokenů na ceník API, který hlásí Claude Code. Při přihlášení předplatným claude.ai "
          "(Pro / Max) se neúčtuje — čerpá limity předplatného. Agent API klíč nedostane (`pro_agent.agent_env`).", ""]
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
        L += ["## Běhy agentů (tokeny a odhad podle ceníku API z Claude Code)", "",
              "| Krok | Kolo | Role | Model | Stav | Kol / limit | Odhad USD | Tokeny vstup / výstup | s | Log |",
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
    chk += [f"- {UNIT[k]['label']} kolo {r['n']}: kontrolor K5 kontroly kódem nespustil — "
            f"verdikt VRÁCENO (bez kontrol skriptem)" for k in UNIT_KEYS for r in st["units"][k].get("rounds") or []
            if r.get("k5NoChecks") and not r.get("checks")]
    if chk:
        L += ["## Kontroly kódem (pro3d_tools)", ""] + chk + [""]
    gate = []
    for k in UNIT_KEYS:
        for r in st["units"][k].get("rounds") or []:
            pc = r.get("points") or {}
            pcs = (f"povinných bodů {pc['n']}" + (f" (blokující {pc['b']}, závažné {pc['z']})" if pc.get("b") is not None
                                                  else "")) if pc else "počet bodů neuveden"
            if "k5Audit" in r:
                res = (f"brána K5: SCHVÁLENO neplatí — {len(r['k5Audit'])} bodů: " + "; ".join(r["k5Audit"][:4])
                       + (" …" if len(r["k5Audit"]) > 4 else "")) if r["k5Audit"] else "brána K5: prošla"
                gate.append(f"- {UNIT[k]['label']} kolo {r['n']}: {res}; {pcs}")
            elif r.get("verdict") and r.get("file"):
                gate.append(f"- {UNIT[k]['label']} kolo {r['n']}: {pcs}")
            for c in r.get("approvedChanged") or []:
                gate.append(f"- {UNIT[k]['label']} kolo {r['n']}: model {c['path']} části "
                            f"{UNIT.get(c['unit'], {}).get('label', c['unit'])} změněn po schválení "
                            f"({str(c['old'])[:12]} → {str(c['new'])[:12]}) — verdikt VRÁCENO")
    if gate:
        L += ["## Kontrola K5 — brána a povinné body", "",
              "Brána K5 (PLCdesk) jen vrací: SCHVÁLENO bez úplného kontrolního seznamu s důkazy, minim měření a snímků "
              "nebo s neposouzenými počty z kontrol kódem se přepíše na VRÁCENO.", ""] + gate + [""]
    if st.get("archives"):
        L += ["## Archiv dřívějších výstupů (Spustit od…)", ""] + \
             [f"- {a.get('at')}: [{a['dir']}]({a['dir']}) — "
              + (", ".join(UNIT[k]["label"] for k in a.get("units") or []) or "jen logy") for a in st["archives"]] + [""]
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
    cg = (st.get("units") or {}).get("cabinet", {}).get("generated")
    if cg:
        L += ["## Rozvaděč kódem (pro3d_cabinet)", ""]
        if cg.get("ok"):
            b = cg.get("bilance") or {}
            L.append(f"Skříň **{cg.get('skrin')}**" + (" (změna proti manifestu — zpětná vazba)" if cg.get("zmena_skrine") else "")
                     + "; obsazení lišt: " + ", ".join(f"{x.get('n')} {x.get('obsazeno_pct')} % (rezerva {x.get('rezerva_pct')} %)"
                                                       for x in cg.get("listy") or [])
                     + f"; tepelná bilance **{b.get('verdikt')}** (Qv {b.get('Qv')} W, Qs {b.get('Qs')} W"
                     + (f", chybí ztráty {b.get('chybi')} ks" if b.get("chybi") else "") + ") — [rozvadec/ROZVADEC.md](rozvadec/ROZVADEC.md)")
        else:
            L.append(f"Generátor selhal ({cg.get('chyba')}) — rozvaděč stavěl stavitel postaru.")
        L.append("")
    fg = (st.get("units") or {}).get("frame", {}).get("generated")
    if fg:
        L += ["## Rám kódem (pro3d_lib.ram_gen, modul N1)", ""]
        if fg.get("ok"):
            r = fg.get("rozmery") or {}
            L.append(f"Rám **{r.get('D')} × {r.get('W')} × {r.get('H')} mm**, podpory {r.get('podpory')}, věnec {fg.get('venec')}, "
                     f"{fg.get('hmotnost_kg')} kg; kontroly kódem {fg.get('chyb_kontrol')} chyb"
                     + (f", selhalo {fg.get('selhalo')}" if fg.get("selhalo") else "")
                     + f"; zdroj rozměrů: {fg.get('zdroj')} — [ram/RAM.md](ram/RAM.md), smlouva "
                     f"[ram/{Path(fg.get('rozhrani') or 'N1_N1.json').name}](ram/{Path(fg.get('rozhrani') or 'N1_N1.json').name})")
            L += [f"- {x}" for x in fg.get("poznamky") or []]
        else:
            L.append(f"Generátor selhal ({fg.get('chyba')}) — rám stavěl stavitel postaru.")
        L.append("")
    mg = (st.get("units") or {}).get("modules", {}).get("generated")
    if mg:
        L += ["## Moduly kódem (pro3d_modules)", ""]
        if mg.get("ok"):
            s = mg.get("souhrn") or {}
            L.append(f"Zařízení v poli {s.get('zarizeni')} (v rámu {s.get('v_ramu')}, kódem {s.get('postaveno_zarizeni')}); válce "
                     f"{s.get('valcu')}, snímače {s.get('snimacu_postaveno')} / {s.get('snimacu')}, držáky {s.get('drzaku')}, šrouby "
                     f"{s.get('sroubu')}; hadice {s.get('hadic_postaveno')} / {s.get('hadic')} ({s.get('hadice_m')} m), kabely "
                     f"{s.get('kabelu_postaveno')} / {s.get('kabelu')} ({s.get('kabely_m')} m); **nepostaveno {s.get('nepostaveno')}** "
                     f"(+ odebráno pro kolizi {mg.get('odebrano', 0)}), požadavky na rám {s.get('predani')} — "
                     "[moduly/MODULY.md](moduly/MODULY.md)")
        else:
            L.append(f"Generátor selhal ({mg.get('chyba')}) — moduly stavěl stavitel postaru.")
        L.append("")
    L += ["## Barvy v modelu", "", *COLOR_LEGEND, ""]
    est = collect_estimates(folder)
    L += ["## Předpoklady (ODHAD)", "", *(est or ["- žádné označené"]), ""]
    fbs = sorted(p.relative_to(folder).as_posix() for p in folder.rglob("PLCdesk_CAD_feedback*.json")
                 if ARCHIVE_DIR not in p.relative_to(folder).parts)
    L += ["## Zpětná vazba pro PLCdesk (NEPOUŽITA — rozhodne uživatel v kroku Kusovník)", "",
          *([f"- [{f}]({f})" for f in fbs] or ["- žádná"]), ""]
    shots = sorted((p for p in folder.rglob("*.png") if ARCHIVE_DIR not in p.relative_to(folder).parts), key=lambda p: p.stat().st_mtime, reverse=True)[:24]
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
    ap.add_argument("--max-rounds", type=int, default=None,
                    help=f"max. kol každé části (výchozí {MAX_ROUNDS}, rám a kryty {UNIT_ROUNDS['frame']}; "
                         "volba platí všem částem)")
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
    ap.add_argument("--generators", action="store_true",
                    help="s --no-ai: i generátory kódem rozvaděče, rámu a modulů (FreeCAD, bez AI; zapne --parts)")
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
    set_slot_tag(slot_tag(a.out))                       # souběžné postupy různých strojů = různé sloty
    pipe = Pipeline(a.out, prj, max_rounds=a.max_rounds, test_safety=a.test_safety, ai=not a.no_ai,
                    runner=None if a.no_ai else agent_runner(model=a.model, budget=a.budget), log=print,
                    models=models, turns=turns, parts=False if a.no_parts else (True if a.parts or a.generators else None),
                    generators=a.generators)
    status = pipe.run(a.from_phase)
    print(f"PREHLED: {Path(a.out) / SUMMARY_FILE}")
    return 0 if status in ("done", "noai") else 1


if __name__ == "__main__":
    sys.exit(main())
