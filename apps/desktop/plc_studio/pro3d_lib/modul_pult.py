"""Modul O1 — pult obsluhy: tlačítka a signálky Ø22, nouzové zastavení, volič, HMI (čistý Python: plán; FreeCAD:
``fc_lib.py``).

Vstup = řádky kusovníku z manifestu PLCdesk (``PLCdesk_CAD.json`` v2): ``estop_button`` / ``emergency_stop``,
``pushbutton`` / ``push_button``, ``selector_switch``, ``pilot_light``, ``plc_hmi`` (obě jména kategorií — kusovník
bom.ts i ``pro3d_cabinet/data/dvere.json``). Dvouruční tlačítka (popis „dvouruč“ / two-hand / Zweihand) do O1 nepatří
(modul O5) — jdou do ``vynechano``. Funkce tlačítka z popisu (START / STOP / RESET / AUTO), barva podle
``data/pult.json barvy_tlacitek`` (IEC 60204-1 10.2.1 podle Schneider FA28043 — sekundární), signálka podle role / popisu.

Pult (vlastní konstrukce, ODHAD): plechové tělo t 2 (dno, záda, boky, strop, vpředu příruby 15 mm) + **snímatelné
víko** t 3 s přístroji — příchytky (držák 3SU1500 30 × 40 × 30,1, ověřeno) a upínky HMI jsou po sejmutí víka
přístupné (vada K5 stroj 20 rám kolo 2: matice v uzavřené dutině); víko 8 × M4 do navařovacích matic ISO 4032 na
přírubách (ODHAD druhu matic), ``Konstrukce_Pohyb`` víka = sejmutí dopředu (kontrola kolizí i v té poloze).
Výřezy Ø22,3 (Schneider / Eaton +0,4, Siemens bez tolerance — ``data/pristroje_22.json``), drážka 3,2 × 24,1 u voliče
a E-stopu jen u řad, které ji vyžadují (Siemens 3SU1 ne). Rozteče os ≥ obálka výrobců (vodorovně 30, svisle 50,
E-stop 48 × 56). HMI: výřez, tloušťka desky, upínky a volné okolí jen z ``pro3d_cabinet/data/dvere.json`` (čte se),
tělo za panelem = App::Link na ``pro3d_parts`` (hmi_panel), čelo 214 × 158 × 8,4 z téhož listu. Přístroje 3SU1:
rozměry z ``pro3d_parts/data/katalog.json`` (act_d, front_h, rear_*), tvar „hlavice + krk v otvoru + držák za deskou“
= model pro3d_parts ``panel_22`` s parametrem ``deska_t`` (dle dokumentace); jiný typ / volič = obálka tohoto modulu.
HMI v pultu jen podle konceptu (``pro3d_cabinet.dvere.hmi_misto``) — jinak zůstává ve dveřích rozvaděče.
Kotvení V4: dva úhelníky S235 t 8 (ODHAD) — svislé rameno M6 do matice T boční drážky profilu, vodorovné rameno pod
přesahem dna pultu, dnem M6 + podložka + matice ISO 4032 (schváleno 2026-11-03); kabel V2: vývodka SKINTOP ST-M M20 v zadní stěně
(normalie.json), kabel Ø10 (ODHAD) R = 5 × D.

CLI: ``python -m plc_studio.pro3d_lib.modul_pult [--manifest PLCdesk_CAD.json] [--plan] [--md PULT.md] [--fc SLOŽKA]``."""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    __package__ = "plc_studio.pro3d_lib"

from . import spojky_el, spojky_mech  # noqa: E402
from .modul_majak import RGB, barva_z_popisu, barva_z_role  # noqa: E402
from ..pro3d_cabinet.dvere import hmi_misto  # noqa: E402  (umístění HMI: pult × dveře — jedno místo rozhodnutí)

HERE = Path(__file__).resolve().parent
P22 = json.loads((HERE / "data" / "pristroje_22.json").read_text(encoding="utf-8"))
PULT = json.loads((HERE / "data" / "pult.json").read_text(encoding="utf-8"))
KATALOG = json.loads((HERE.parent / "pro3d_parts" / "data" / "katalog.json").read_text(encoding="utf-8"))["polozky"]
DVERE = json.loads((HERE.parent / "pro3d_cabinet" / "data" / "dvere.json").read_text(encoding="utf-8"))   # jen čtení
NORM = spojky_mech.NORM
GEN = "pro3d_lib/modul_pult"
SG = P22["souhrn_pro_generator"]

KAT = {"estop_button": "estop", "emergency_stop": "estop", "pushbutton": "tlacitko", "push_button": "tlacitko",
       "selector_switch": "volic", "pilot_light": "signalka", "plc_hmi": "hmi"}
SIEMENS_VZOR = {"estop": "3SU1150-1HB20-1CH0", "tlacitko": "3SU1100-0AB40-1BA0", "signalka": "3SU1102-6AA40-1AA0",
                "volic": "3SU1100-0AB40-1BA0"}
RE_FUNKCE = [("dvourucni", r"dvouru|two.?hand|zweihand"), ("volic", r"volič|přepína|selector|wahlschalter|režim|mode"),
             ("reset", r"kvit|reset|quitt|acknow|\back\b"), ("stop", r"\bstop|zastav|halt\b"), ("start", r"\bstart|spušt|cyklus start"),
             ("auto", r"\bauto")]
BARVA_FUNKCE = {"start": ("bílá", "W"), "stop": ("černá", "K"), "reset": ("modrá", "B"), "auto": ("bílá", "W")}
RGB_X = dict(RGB, K="30,30,30", E="200,20,20", EY="245,195,0")   # EY ≠ žlutá „dle dokumentace“ (kontrola stav)

# ODHADY modulu
T_TELO = 2.0           # plech těla
T_VIKO = 3.0           # čelní deska (víko) — v pásmu 1–6 (přístroje) i 2–6 (HMI); Siemens držák z výroby 4,5 → seřídit
UH_T = 8.0             # úhelník kotvení S235 t 8 (šroub M6 do matice T bez podložky vychází jen pro 8 / 12 mm — V4)
UH_W = 50.0            # šířka úhelníku podél profilu
UH_DX = 12.0           # šroub do drážky x − 12, šroub dnem x + 12 (konec dříku nesmí na hlavu šroubu v drážce)
UH_HORIZ = 22.0        # vodorovné rameno od boku profilu (pod přesahem dna pultu)
UH_VYSKA = 32.0        # svislé rameno (z 8 … 40, přes boční drážku z = 20)
R_BOK_MINUS_Y = [[1, 0, 0], [0, 0, -1], [0, 1, 0]]   # boční plocha profilu −Y: místní Z → −Y, místní X → X
PRIRUBA = 15.0         # příruby těla vpředu (pod šrouby víka)
HLOUBKA = 100.0        # vnější hloubka pultu (tělo přístroje 49,7 + víko + rezerva na vodiče ≥ 30)
M_VIKO = "M4"
M_PROFIL = "M6"
KRK_D = 22.0           # krk přístroje v otvoru (Ø otvoru 22,3)
PODKLAD_D = 60.0       # žlutý podklad E-stopu (průměr ODHAD — v listu 3SU1150 nekótován)
OKRAJ = 30.0           # okraj čela k obálce přístrojů
KABEL_D = 10.0         # vícežilový kabel do pultu
VYVODKA = "M20"
OTVOR_VYVODKY = 20.5   # otvor pro M20 (ODHAD — Lapp díru v přečtené tabulce neuvádí)
POSUN_VIKA = 150.0     # sejmutí víka dopředu (kontrola kolizí v druhé poloze)
DOSAH_ESTOP_HMI = 400.0  # E-stop od okraje čela HMI (ODHAD; K5 stroj 20 vrátil 1289 mm)
I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
ROT_VYV = [[1, 0, 0], [0, 0, -1], [0, 1, 0]]          # model +Z vývodky → globální −Y (šestihran vně zadní stěny)


def _rada(brand: str, code: str) -> str:
    b = (brand or "").lower() + " " + (code or "").upper()
    if "schneider" in b or code.upper().startswith(("XB4", "XB5", "ZB")):
        return "schneider_XB5"
    if "eaton" in b or "moeller" in b or code.upper().startswith("M22"):
        return "eaton_M22"
    return "siemens_3SU1"


def _funkce(desc: str) -> str:
    t = (desc or "").lower()
    for k, rx in RE_FUNKCE:
        if re.search(rx, t):
            return k
    return ""


def pristroje_z_manifestu(manifest: dict) -> dict:
    """Řádky kusovníku → přístroje pultu {pristroje: [...], hmi, vynechano, zpetna_vazba}."""
    devs = {d.get("name"): d for d in manifest.get("devices") or []}
    out, vyn, fb, hmi = [], [], [], None
    hm = hmi_misto(manifest)                       # jedno rozhodnutí sdílené s rozvaděčem (pro3d_cabinet.dvere)
    for r in manifest.get("parts") or []:
        druh = KAT.get(r.get("category"))
        if not druh:
            continue
        d = devs.get(r.get("device")) or {}
        desc = d.get("desc") or r.get("label") or ""
        if druh == "hmi" and hm["misto"] != "pult":
            vyn.append(f"{r.get('id')}: HMI ve dveřích rozvaděče ({hm['zdroj']}) — do pultu nevloženo")
            continue
        if druh == "hmi":
            code = str(r.get("orderCode") or "").replace(" ", "")
            if code in DVERE["pristroje"] and KATALOG.get(code, {}).get("gen") == "hmi_panel":
                hmi = {"id": r.get("id"), "kod": code}
            else:
                fb.append(f"{r.get('id')}: HMI {code or '?'} bez dat výřezu / upínek (dvere.json) — do pultu nevloženo, doplnit data")
            continue
        f = _funkce(desc)
        if druh == "tlacitko" and f == "dvourucni":
            vyn.append(f"{r.get('id')}: dvouruční ovládání → modul O5 (rozteč ≥ 260, kryty)")
            continue
        if druh == "tlacitko" and f == "volic":
            druh = "volic"
        code = str(r.get("orderCode") or "").replace(" ", "")
        rada = _rada(r.get("brand") or "", code)
        if druh == "estop":
            f = "nouzove_zastaveni"
            barva, kod_b = "červená na žlutém podkladu", "E"
        elif druh == "signalka":
            b = barva_z_popisu(desc) or barva_z_role(d.get("role"))[0] or "W"
            barva, kod_b = {"R": "červená", "Y": "žlutá", "B": "modrá", "G": "zelená", "W": "bílá"}[b], b
        elif druh == "volic":
            barva, kod_b = "černá (ODHAD)", "K"
        else:
            barva, kod_b = BARVA_FUNKCE.get(f, ("šedá (ODHAD — funkce z popisu nepoznána)", "W"))
            if not f:
                fb.append(f"{r.get('id')}: funkce tlačítka z popisu nepoznána — barva ODHAD")
        if code in KATALOG and KATALOG[code].get("gen") == "panel_22":
            model, zast = code, False
        else:
            model, zast = SIEMENS_VZOR[druh], True
        out.append({"id": r.get("id"), "tag": r.get("tag") or ("-" + str(r.get("device") or "")), "druh": druh, "funkce": f,
                    "barva": barva, "kod_barvy": kod_b, "rada": rada, "kod": code, "model": model, "zastupny": zast, "desc": desc})
    if any(p["druh"] == "estop" for p in out) is False and (out or hmi):
        fb.append("pult bez E-stopu — ovládací místo musí mít nouzové zastavení (P-03)")
    if any(p["druh"] == "volic" and not p["kod"] for p in out):
        fb.append("volič bez objednacího kódu v kusovníku — typ doplní projektant (kategorie selector_switch)")
    return {"pristroje": out, "hmi": hmi, "vynechano": vyn, "zpetna_vazba": fb}


# --- díly -------------------------------------------------------------------------------------------------------------

def _spec_pristroj(p: dict) -> dict:
    """Přístroj Ø22 v MÍSTNÍCH souřadnicích: y = 0 líc čelní desky (vpředu +Y), hlavice y 0…front_h, krk Ø22 v otvoru
    přes tloušťku desky, držák + kontakty za deskou (rear_w × rear_h × rear_d od zadního líce desky)."""
    k = KATALOG[p["model"]]
    t = T_VIKO
    if not p["zastupny"] and p["druh"] != "volic" and k.get("gen") == "panel_22":
        # model pro3d_parts „dle dokumentace“ s tloušťkou desky (g_panel_22 deska_t) — rozměry z katalog.json
        prm = {kk: v for kk, v in k.items() if kk not in ("gen", "nazev", "material", "detail", "zdroj", "poznamka")}
        prm.update(deska_t=t, krk_d=KRK_D)
        return {"key": f"P22_{p['model']}_t{t:g}", "gen": "panel_22", "params": prm, "nazev": f"{k['nazev']} — deska {t:g} mm",
                "zdroj": [k["zdroj"], P22["rady"]["siemens_3SU1"]["drzak"]["zdroj"]], "detail": "obálka",
                "typ": "dil", "material": k.get("material", ""),
                "poznamka": "hlavice, krk Ø22 (ODHAD) v otvoru Ø22,3, držák 3SU1500 + kontakty za zadním lícem desky"}
    add = [{"cyl": {"p": [0, 0, 0], "d": [0, 1, 0], "r": k["act_d"] / 2, "h": k["front_h"]}},
           {"cyl": {"p": [0, -t, 0], "d": [0, 1, 0], "r": KRK_D / 2, "h": t}},
           {"box": [-k["rear_w"] / 2, k["rear_w"] / 2, -t - k["rear_d"], -t, -k["rear_h"] / 2, k["rear_h"] / 2]}]
    if p["druh"] == "volic":                       # páčka voliče (ODHAD) na hlavici
        add.append({"box": [-3.0, 3.0, k["front_h"], k["front_h"] + 15.0, -12.0, 12.0]})
    key = f"P22_{p['druh']}_{p['model']}_t{t:g}"
    zdroj = [k["zdroj"], P22["rady"]["siemens_3SU1"]["drzak"]["zdroj"]]
    return {"key": key, "gen": "lib_body", "body": {"add": add}, "zastupny": p["zastupny"],
            "nazev": (k["nazev"] if not p["zastupny"] else f"{p['druh']} Ø22 (obálka podle {p['model']})") + f" — deska {t:g} mm",
            "zdroj": zdroj, "detail": "obálka: hlavice, krk Ø22 (ODHAD) v otvoru Ø22,3, držák 3SU1500 30 × 40 + kontakty za deskou",
            "typ": "dil", "material": k.get("material", ""),
            "poznamka": ("rozměry " + p["model"] + (" — jiný typ / řada, obálka" if p["zastupny"] else "") +
                         "; hloubka za panelem počítána od zadního líce desky (ODHAD výkladu kóty)")}


def _spec_hmi_celo(code: str) -> dict:
    c = DVERE["pristroje"][code]["celo"]
    z = DVERE["pristroje"][code]["zdroj"]
    return {"key": f"HMI_celo_{code}", "gen": "lib_body", "body": {"add": [{"box": [-c["w"] / 2, c["w"] / 2, 0.0, c["d"], -c["h"] / 2, c["h"] / 2]}]},
            "nazev": f"{KATALOG[code]['nazev']} — čelní rámeček {c['w']:g} × {c['h']:g} × {c['d']:g}", "zdroj": [z["url"]],
            "detail": "obálka čela (dvere.json)", "typ": "dil", "material": "plast", "poznamka": z["dokument"]}


def _spec_hmi_telo(code: str) -> dict:
    k = KATALOG[code]
    p = {kk: v for kk, v in k.items() if kk not in ("gen", "nazev", "material", "detail", "zdroj", "poznamka")}
    return {"key": f"HMI_{code}", "gen": "hmi_panel", "params": p, "nazev": k["nazev"], "zdroj": [k["zdroj"]],
            "detail": k["detail"], "typ": "dil", "material": k["material"], "poznamka": k.get("poznamka", "")}


def _spec_upinka(code: str, svisla: bool) -> dict:
    tv = DVERE["pristroje"][code]["upinky"]["tvar"]
    L, hh, dd = float(tv["delka"]), float(tv["vyska"]), float(tv["hloubka"])
    b = [-hh / 2, hh / 2, -dd, 0.0, -L / 2, L / 2] if svisla else [-L / 2, L / 2, -dd, 0.0, -hh / 2, hh / 2]
    return {"key": f"HMI_upinka_{'svisla' if svisla else 'vodorovna'}", "gen": "lib_body", "body": {"add": [{"box": b}]},
            "zastupny": True, "nazev": f"Upínka HMI {L:g} × {hh:g} × {dd:g} (tvar ODHAD, počet a strany dle návodu)",
            "zdroj": [DVERE["pristroje"][code]["zdroj"]["url"]], "detail": "obálka", "typ": "prislusenstvi", "material": "plast",
            "poznamka": tv["pozn"]}


def _spec_uhelnik() -> dict:
    """Úhelník kotvení pultu (vlastní konstrukce, ODHAD) v místních souřadnicích: počátek = horní hrana boku profilu
    (y = −20, z = 40 globálně), svislé rameno na boku profilu (−Y), vodorovné rameno pod přesahem dna pultu."""
    h6 = spojky_mech.otvor_vule(M_PROFIL)
    yl = -UH_HORIZ / 2 - UH_T / 2
    body = {"add": [{"box": [-UH_W / 2, UH_W / 2, -UH_T, 0.0, -UH_VYSKA, 0.0]},
                    {"box": [-UH_W / 2, UH_W / 2, -UH_HORIZ, 0.0, -UH_T, 0.0]}],
            "cut": [{"cyl": {"p": [-UH_DX, -UH_T - 1, -20.0], "d": [0, 1, 0], "r": h6 / 2, "h": UH_T + 2}},
                    {"cyl": {"p": [UH_DX, yl, -UH_T - 1], "d": [0, 0, 1], "r": h6 / 2, "h": UH_T + 2}}]}
    return {"key": f"O1_uhelnik_t{UH_T:g}", "gen": "lib_body", "body": body, "vlastni": True,
            "nazev": f"Úhelník kotvení pultu (ocel S235 t {UH_T:g}, ODHAD)", "zdroj": ["vlastní konstrukce (ODHAD)"],
            "detail": "vlastní konstrukce (ODHAD)", "typ": "dil", "material": "ocel S235 (ODHAD)",
            "poznamka": f"2 ks na pult; díry Ø{h6:g} (ISO 273 m) — {M_PROFIL} do matice T boční drážky a {M_PROFIL} dnem pultu s maticí"}


def _spec_vyvodka() -> dict:
    r = NORM["SKINTOP_ST-M"]
    return {"key": f"SKINTOP_ST-M_{VYVODKA}", "gen": "vyvodka", "params": dict(r["rady"][VYVODKA]),
            "nazev": f"{r['nazev']} {VYVODKA}", "zdroj": [r["zdroj"]], "zdroj_popis": r["zdroj_popis"], "detail": "obálka",
            "typ": "prislusenstvi", "material": "PA", "poznamka": ""}


# --- rozmístění a kontroly bez FreeCADu ---------------------------------------------------------------------------------

def roztec_pozadavek(a: dict, b: dict) -> tuple[float, float]:
    """(vodorovně, svisle) minimální rozteč os dvojice podle řady (obálka výrobců; E-stop 48 × 56)."""
    if "estop" in (a["druh"], b["druh"]):
        e = SG["estop_roztec_min"]
        return float(e["a"]), float(e["b"])
    return float(SG["roztec_min_vodorovne"]), float(SG["roztec_min_svisle"])


def kontrola_rozteci(pol: list[dict]) -> list[str]:
    """Dvojice přístrojů musí splnit rozteč vodorovně (ve stejné řadě) NEBO svisle; hlavice se nepřekrývají."""
    chyby = []
    for i, a in enumerate(pol):
        for b in pol[i + 1:]:
            dx, dz = abs(a["x"] - b["x"]), abs(a["z"] - b["z"])
            ph, pv = roztec_pozadavek(a, b)
            ok = dx >= ph - 1e-6 or dz >= pv - 1e-6
            ra = (PODKLAD_D if a["druh"] == "estop" else KATALOG[a["model"]]["act_d"]) / 2
            rb = (PODKLAD_D if b["druh"] == "estop" else KATALOG[b["model"]]["act_d"]) / 2
            if math.hypot(dx, dz) < ra + rb:
                ok = False
            if not ok:
                chyby.append(f"{a['tag']} × {b['tag']}: rozteč {dx:.1f} / {dz:.1f} < {ph:g} / {pv:g} nebo překryv hlavic")
    return chyby


def rozmisteni(pr: dict, x0: float = 65.0, z0: float = 40.0) -> dict:
    """Polohy přístrojů na čele (x vodorovně, z svisle), rozměr pultu. Řady shora: signálky, tlačítka, voliče
    (po 4), E-stop vpravo samostatně, HMI vlevo."""
    rows = []
    for druh in ("signalka", "tlacitko", "volic"):
        ps = [p for p in pr["pristroje"] if p["druh"] == druh]
        rows += [ps[i:i + 4] for i in range(0, len(ps), 4)]
    estop = [p for p in pr["pristroje"] if p["druh"] == "estop"]
    px, pz = 40.0, float(SG["roztec_min_svisle"])     # 40 ≥ 30 (výrobce) a ≥ hlavice 29,45 + 10 (ODHAD)
    hmi = pr["hmi"]
    hd = DVERE["pristroje"][hmi["kod"]] if hmi else None
    x_cur = x0 + OKRAJ
    pol = []
    if hd:
        hx = x_cur + hd["celo"]["w"] / 2
        x_grid = hx + hd["vyrez"]["w"] / 2 + hd["okoli"]["vpravo"] + 5.0 + 15.0 + 5.0   # okolí HMI + polovina držáku
    else:
        hx = None
        x_grid = x0 + PRIRUBA + T_TELO + 15.0 + 13.0
    cols = max([len(r) for r in rows] or [0])
    grid_h = (len(rows) - 1) * pz if rows else 0.0
    H = max(hd["vyrez"]["h"] + 2 * (hd["okoli"]["dole"] + PRIRUBA + 4.5) if hd else 0.0, grid_h + 40 + 2 * (PRIRUBA + 25.0),
            float(SG["estop_roztec_min"]["b"]) + 2 * (PRIRUBA + 25.0) if estop else 0.0, 120.0)
    H = math.ceil(H / 10.0) * 10.0
    zc = z0 + H / 2
    for ri, r in enumerate(rows):
        for ci, p in enumerate(r):
            pol.append(dict(p, x=x_grid + ci * px, z=zc + grid_h / 2 - ri * pz))
    x_last = x_grid + (cols - 1) * px if cols else x_grid - px
    ex = x_last + max(float(SG["estop_roztec_min"]["a"]) + 7.0, 15.0 + PODKLAD_D / 2 + 10.0) if rows else x_grid
    for i, p in enumerate(estop):
        pol.append(dict(p, x=ex, z=zc + (i - (len(estop) - 1) / 2) * 70.0))
    x_right = (ex + PODKLAD_D / 2 + 20.0) if estop else (x_last + 15.0 + PRIRUBA + T_TELO + 13.0)
    W = math.ceil((x_right - x0) / 10.0) * 10.0
    return {"x0": x0, "z0": z0, "W": W, "H": H, "zc": zc, "hmi_x": hx, "pol": pol}


def modul(pr: dict, x0: float = 65.0, z_podlaha: float = 0.0, nazev: str = "Pult obsluhy O1") -> dict:
    """Pult na profilu 40 × 40 podél X (horní drážka y = 0, z = 40). Čelo (víko) hledí do +Y (strana obsluhy)."""
    lay = rozmisteni(pr, x0, 40.0)
    W, H = lay["W"], lay["H"]
    x1, z0 = x0 + W, 40.0
    z1 = z0 + H
    yb = -HLOUBKA / 2 + 5.0
    yf = yb + HLOUBKA - T_VIKO               # líc přírub = zadní líc víka
    yv = yf + T_VIKO                         # přední líc víka
    xc = x0 + W / 2
    var, info = [], []
    dily, inst, telesa = [], [], []
    # tělo: plášť (dno, záda, boky, strop) otevřený vpředu + příruby
    # tělo = kvádr − dutina − otvor čela (zbydou příruby PRIRUBA vpředu)
    add = [{"box": [x0, x1, yb, yf, z0, z1]}]
    xa, xb, ya, yb2 = x0 + T_TELO, x1 - T_TELO, yb + T_TELO, yf - T_TELO
    zs = z0 + T_TELO
    cut = [{"box": [xa, xb, ya, yb2, zs, z1 - T_TELO]},
           {"box": [x0 + PRIRUBA, x1 - PRIRUBA, yb2 - 1, yf + 1, z0 + PRIRUBA, z1 - PRIRUBA]}]
    fl = []
    sv = [(x0 + PRIRUBA / 2, z0 + PRIRUBA / 2), (x1 - PRIRUBA / 2, z0 + PRIRUBA / 2), (x0 + PRIRUBA / 2, z1 - PRIRUBA / 2),
          (x1 - PRIRUBA / 2, z1 - PRIRUBA / 2), (x0 + PRIRUBA / 2, z0 + H / 2), (x1 - PRIRUBA / 2, z0 + H / 2),
          (xc, z0 + PRIRUBA / 2), (xc, z1 - PRIRUBA / 2)]
    h4 = spojky_mech.otvor_vule(M_VIKO)
    h6 = spojky_mech.otvor_vule(M_PROFIL)
    cut_tel = [{"cyl": {"p": [x, yf - T_TELO - 1, z], "d": [0, 1, 0], "r": h4 / 2, "h": T_TELO + 2}} for x, z in sv]
    a6 = min(60.0, (W - UH_W - 10.0) / 2.0)         # malý pult (3 přístroje, W 150): úhelníky od sebe ≥ UH_W + 10 (celek E3)
    xs6 = [x0 + a6, x1 - a6]                        # úhelníky kotvení (V4) — osy podél X
    yu = -20.0 - UH_HORIZ / 2 - UH_T / 2             # šroub dna → vodorovné rameno úhelníku (mimo svislé rameno a matici)
    if yu - spojky_mech.otvor_vule(M_PROFIL) / 2 < yb + T_TELO + 1.0:
        raise ValueError("pult: šroub úhelníku mimo dno (hloubka pultu)")
    cut_tel += [{"cyl": {"p": [x + UH_DX, yu, z0 - 1], "d": [0, 0, 1], "r": h6 / 2, "h": T_TELO + 2}} for x in xs6]
    xv, zv = x1 - 60.0, z0 + 60.0
    cut_tel.append({"cyl": {"p": [xv, yb - 1, zv], "d": [0, 1, 0], "r": OTVOR_VYVODKY / 2, "h": T_TELO + 2}})
    telesa.append({"name": "Telo", "label": f"Tělo pultu (plech t {T_TELO:g}, příruby {PRIRUBA:g}, "
                   f"{W:g} × {HLOUBKA:g} × {H:g}, ODHAD)",
                   "body": {"add": add + fl, "cut": cut + cut_tel},
                   "props": {"Konstrukce_Typ": "dil", "Konstrukce_Material": "ocel DC01 t 2 (ODHAD)",
                             "Konstrukce_Poznamka": "vlastní konstrukce; víko snímatelné, navařovací matice M4 na přírubách (ODHAD)"}})
    # víko s výřezy
    cut_v = [{"cyl": {"p": [x, yf - 1, z], "d": [0, 1, 0], "r": h4 / 2, "h": T_VIKO + 2}} for x, z in sv]
    vyrezy = []
    for p in lay["pol"]:
        r = P22["rady"][p["rada"]]
        d = float(r["otvor"]["d"])
        if r["otvor"].get("tol"):
            d += 0.2                                    # střed tolerance 0 / +0,4
        cut_v.append({"cyl": {"p": [p["x"], yf - 1, p["z"]], "d": [0, 1, 0], "r": d / 2, "h": T_VIKO + 2}})
        drazka = bool(r["drazka_proti_pootoceni"].get("nutna")) and p["druh"] in ("volic", "estop") and p["rada"] != "siemens_3SU1"
        if drazka:
            dr = r["drazka_proti_pootoceni"]
            cut_v.append({"box": [p["x"] - dr["sirka"] / 2, p["x"] + dr["sirka"] / 2, yf - 1, yv + 1, p["z"], p["z"] + dr["rozmer_pres_drazku"] - d / 2]})
        vyrezy.append({"tag": p["tag"], "d": round(d, 2), "drazka": drazka, "rada": p["rada"]})
    hmi = pr["hmi"]
    if hmi:
        hd = DVERE["pristroje"][hmi["kod"]]
        hw, hh = hd["vyrez"]["w"] + 0.5, hd["vyrez"]["h"] + 0.5    # tolerance +1 / 0 → střed
        hx, hz = lay["hmi_x"], lay["zc"]
        cut_v.append({"box": [hx - hw / 2, hx + hw / 2, yf - 1, yv + 1, hz - hh / 2, hz + hh / 2]})
        if not (hd["panel_t"][0] <= T_VIKO <= hd["panel_t"][1]):
            var.append(f"víko {T_VIKO} mm mimo tloušťku pro HMI {hd['panel_t']}")
    if not (SG["deska_t"][0] <= T_VIKO <= SG["deska_t"][1]):
        var.append(f"víko {T_VIKO} mm mimo tloušťku desky přístrojů {SG['deska_t']}")
    telesa.append({"name": "Viko", "label": f"Víko pultu snímatelné (plech t {T_VIKO:g}, výřezy Ø22,3, HMI, ODHAD)", "skupina": "Viko",
                   "body": {"add": [{"box": [x0, x1, yf, yv, z0, z1]}], "cut": cut_v},
                   "props": {"Konstrukce_Typ": "dil", "Konstrukce_Material": "ocel DC01 t 3 (ODHAD)",
                             "Konstrukce_Poznamka": "čelní deska s přístroji — po sejmutí (8 × M4) přístupné držáky a upínky"}})
    # šrouby víka do matic na přírubách
    txt_viko = ""
    for x, z in sv:
        r = spojky_mech.sroub_s_matici(M_VIKO, [x, yv, z], [0, -1, 0], T_VIKO + T_TELO, podlozka=True)
        if not r["ok"]:
            raise ValueError(r["text"])
        dily += r["dily"]
        for it in r["instance"]:
            if it["druh"] != "matice":
                it["skupina"] = "Viko"
            inst.append(it)
        txt_viko = r["text"]
    # kotvení V4: dva úhelníky — svislé rameno na boční drážce profilu (strana −Y, šroub + matice T), vodorovné rameno
    # pod přesahem dna pultu (šroub dnem shora + podložka + matice ISO 4032 pod ramenem; přístup po sejmutí víka)
    v4 = []
    uh = _spec_uhelnik()
    dily.append(uh)
    for x in xs6:
        inst.append({"model": uh["key"], "pos": [x, -20.0, 40.0], "rot": I3, "druh": "uhelnik"})
        r = spojky_mech.sroub_do_drazky_r(M_PROFIL, [x - UH_DX, -20.0, 20.0], R_BOK_MINUS_Y, UH_T)
        if not r["ok"]:
            raise ValueError(r["text"])
        dily += r["dily"]
        inst += r["instance"]
        v4.append("úhelník → profil: " + r["text"])
        r = spojky_mech.sroub_s_matici(M_PROFIL, [x + UH_DX, yu, z0 + T_TELO], [0, 0, -1], T_TELO + UH_T, podlozka=True)
        if not r["ok"]:
            raise ValueError(r["text"])
        dily += r["dily"]
        inst += r["instance"]
        v4.append("pult → úhelník: " + r["text"])
    # přístroje
    for p in lay["pol"]:
        sp = _spec_pristroj(p)
        dily.append(sp)
        inst.append({"model": sp["key"], "pos": [p["x"], yv, p["z"]], "rot": I3, "druh": p["druh"], "mount": "zavit", "skupina": "Viko",
                     "props": {"PLCdesk_Id": p["id"] or "", "Konstrukce_Funkce": p["funkce"], "Konstrukce_Barva": p["barva"],
                               "Konstrukce_Poznamka": "držák přístroje sevřen šrouby výrobce o zadní líc desky (1–1,2 N·m)"}})
        k = KATALOG[p["model"]]
        fh = k["front_h"] + (15.0 if p["druh"] == "volic" else 0.0)
        if p["druh"] == "estop":
            telesa.append({"name": f"Podklad_{p['tag'].strip('-')}", "label": f"Pomocný žlutý podklad E-stopu {p['tag']} (Ø{PODKLAD_D:g} ODHAD)",
                           "skupina": "Viko", "body": {"add": [{"cyl": {"p": [p["x"], yv, p["z"]], "d": [0, 1, 0], "r": PODKLAD_D / 2, "h": 0.8}}]},
                           "props": {"Konstrukce_Typ": "pomocny", "Konstrukce_Barva_RGB": RGB_X["EY"], "Konstrukce_Pruhlednost": 0}})
        telesa.append({"name": f"Barva_{p['tag'].strip('-')}", "label": f"Pomocná barva hlavice {p['tag']} — {p['barva']} ({p['funkce'] or p['druh']})",
                       "skupina": "Viko", "body": {"add": [{"cyl": {"p": [p["x"], yv + fh, p["z"]], "d": [0, 1, 0],
                                                                     "r": k["act_d"] / 2 + 0.5, "h": 1.0}}]},
                       "props": {"Konstrukce_Typ": "pomocny", "Konstrukce_Barva_RGB": RGB_X[p["kod_barvy"]], "Konstrukce_Pruhlednost": 0}})
    # HMI
    hmi_info = None
    if hmi:
        code = hmi["kod"]
        hd = DVERE["pristroje"][code]
        hx, hz = lay["hmi_x"], lay["zc"]
        t_sp, c_sp = _spec_hmi_telo(code), _spec_hmi_celo(code)
        dily += [t_sp, c_sp]
        inst.append({"model": t_sp["key"], "pos": [hx, yv, hz], "rot": I3, "druh": "hmi", "mount": "upinka", "skupina": "Viko",
                     "props": {"PLCdesk_Id": hmi["id"] or "", "Konstrukce_Poznamka": "drží upínky výrobce (6 ×, 0,2 N·m)"}})
        inst.append({"model": c_sp["key"], "pos": [hx, yv, hz], "rot": I3, "druh": "hmi_celo", "mount": "upinka", "skupina": "Viko"})
        up = hd["upinky"]
        vw, vh = hd["vyrez"]["w"] + 0.5, hd["vyrez"]["h"] + 0.5
        L, hh = up["tvar"]["delka"], up["tvar"]["vyska"]
        for side, n in up["strany"].items():
            svis = side in ("vlevo", "vpravo")
            sp = _spec_upinka(code, svis)
            if sp["key"] not in {d["key"] for d in dily}:
                dily.append(sp)
            for k_ in range(int(n)):
                if not svis:
                    cxp = hx + (vw * (k_ + 1) / (n + 1) - vw / 2)
                    czp = hz + vh / 2 + hh / 2 if side == "nahore" else hz - vh / 2 - hh / 2
                else:
                    cxp = hx + vw / 2 + hh / 2 if side == "vpravo" else hx - vw / 2 - hh / 2
                    czp = hz
                inst.append({"model": sp["key"], "pos": [cxp, yf, czp], "rot": I3, "druh": "upinka", "mount": "upinka", "skupina": "Viko"})
        ok_ = {"vlevo": hx - vw / 2 - (x0 + T_TELO), "vpravo": min([p["x"] - 15.0 for p in lay["pol"]] + [x1 - T_TELO]) - (hx + vw / 2),
               "nahore": (z1 - PRIRUBA) - (hz + vh / 2), "dole": (hz - vh / 2) - (z0 + PRIRUBA)}
        for s_, v in ok_.items():
            if v < hd["okoli"][s_] - 1e-6:
                var.append(f"HMI okolí {s_} {v:.1f} < {hd['okoli'][s_]:g} mm (dvere.json)")
        hmi_info = {"kod": code, "stred": [hx, hz], "okoli": {k: round(v, 1) for k, v in ok_.items()}, "okoli_min": hd["okoli"],
                    "hloubka_za": KATALOG[code]["depth"]}
    # vývodka a kabel V2
    vs = _spec_vyvodka()
    dily.append(vs)
    inst.append({"model": vs["key"], "pos": [xv, yb, zv], "rot": ROT_VYV, "druh": "vyvodka"})
    row = NORM["SKINTOP_ST-M"]["rady"][VYVODKA]
    cmin, cmax = (float(x) for x in row["clamp"].replace("–", "-").split("-"))
    if not (cmin <= KABEL_D <= cmax):
        var.append(f"kabel Ø{KABEL_D:g} mimo rozsah vývodky {row['clamp']}")
    R = float(DVERE["polomer"]["pevne_x"]) * KABEL_D
    kab = spojky_el.kabel_vyvod([xv, yb - (row["C"] - row["D"]), zv], [0, -1, 0], [0, 0, -1], KABEL_D, R)
    # pomocná tělesa: stanoviště, kóta výšky E-stopu
    telesa.append({"name": "Stanoviste", "label": "Stanoviště obsluhy pultu (pomocné, 600 × 600 ODHAD)",
                   "body": {"add": [{"box": [xc - 300, xc + 300, yv + 150, yv + 750, -z_podlaha, -z_podlaha + 2.0]}]},
                   "props": {"Konstrukce_Typ": "pomocny"}})            # na podlaze (místní z 0 = z_podlaha nad podlahou)
    es = [p for p in lay["pol"] if p["druh"] == "estop"]
    vysky = {p["tag"]: round(p["z"] + z_podlaha, 1) for p in lay["pol"]}
    if es:
        e = es[0]
        telesa.append({"name": "Kota_vysky", "label": f"Pomocná kóta: osa E-stopu {e['tag']} {e['z'] + z_podlaha:.0f} mm nad podlahou",
                       "body": {"add": [{"box": [e["x"] - 1, e["x"] + 1, yv + 60, yv + 62, -z_podlaha, e["z"]]}]}, "props": {"Konstrukce_Typ": "pomocny"}})
    lo, hi = PULT["estop"]["vyska"]["min"] * 1000, PULT["estop"]["vyska"]["max"] * 1000
    for tg, v in vysky.items():
        if not (lo <= v <= hi):
            (info if z_podlaha == 0 else var).append(f"{tg}: výška ovládání {v:.0f} mm mimo {lo:.0f}–{hi:.0f} (ODHAD)" +
                                                    (" — zkušební deska: z_podlaha = 0" if z_podlaha == 0 else ""))
    # E-stop u HMI
    dosah = None
    if hmi and es:
        hd = DVERE["pristroje"][hmi["kod"]]
        dx = max(0.0, abs(es[0]["x"] - lay["hmi_x"]) - hd["celo"]["w"] / 2)
        dz = max(0.0, abs(es[0]["z"] - lay["zc"]) - hd["celo"]["h"] / 2)
        dosah = round(math.hypot(dx, dz), 1)
        if dosah > DOSAH_ESTOP_HMI:
            var.append(f"E-stop {dosah:.0f} mm od čela HMI > {DOSAH_ESTOP_HMI:g} (ODHAD) — HMI je ovládací místo (P-03)")
    rz = kontrola_rozteci(lay["pol"])
    var += rz
    # přístupnost montáže: držáky / upínky ve víku, po sejmutí víka mimo tělo
    hloubka_za = max([KATALOG[p["model"]]["rear_d"] for p in lay["pol"]] + [KATALOG[hmi["kod"]]["depth"] if hmi else 0.0])
    vnitrni = (yf - (yb + T_TELO))
    pristup = {"viko_snimatelne": True, "posun": POSUN_VIKA, "sroubu_vika": len(sv), "hloubka_za_panelem": hloubka_za,
               "vnitrni_hloubka": round(vnitrni, 1), "rezerva_vodice": round(vnitrni - hloubka_za, 1),
               "drzaky_ve_viku": True,
               "po_sejmuti_mimo_telo": yv + POSUN_VIKA - T_VIKO - hloubka_za > yf}
    if pristup["rezerva_vodice"] < 30.0:
        var.append(f"rezerva na vodiče za přístroji {pristup['rezerva_vodice']:.0f} < 30 mm (ODHAD) — prohloubit pult")
    return {"typ": "O1", "nazev": nazev, "dily": dily, "instance": inst, "telesa": telesa,
            "skupiny": [{"name": "Viko", "label": "Víko pultu s přístroji (snímatelné)",
                         "props": {"Konstrukce_Pohyb": json.dumps({"nazev": "víko sejmuto", "posun": [0.0, POSUN_VIKA, 0.0]}, ensure_ascii=False)}}],
            "kabely": [{"name": "Kabel", "label": f"Kabel pultu Ø{KABEL_D:g} (ODHAD, R {R:g}) z vývodky {VYVODKA}", "r": kab["r"], "path": kab["path"],
                        "props": {"Konstrukce_Typ": "kabel", "Konstrukce_Druh": "signal", "Kabel_R_min": R}}],
            "props": {"Konstrukce_Generator": GEN, "Konstrukce_Modul": "O1"},
            "kontrola": {"rozmer": [W, HLOUBKA, H], "x0": x0, "y_celo": yv, "deska_t": T_VIKO, "pristroje": lay["pol"], "vyrezy": vyrezy,
                         "roztece_chyby": rz, "vysky": vysky, "estop_hmi": dosah, "hmi": hmi_info, "pristup": pristup,
                         "sroub_vika": txt_viko, "spojka_V4": v4[0], "kabel_R": R,
                         "kabel_R_cesta": round(spojky_el.ohyb_z_cesty(kab["path"]), 2)},
            "zpetna_vazba": pr["zpetna_vazba"] + ["skříňka / plechový pult, víko, matice a vývodka nejsou v kusovníku PLCdesk (P-14)"],
            "vynechano": pr["vynechano"], "varovani": var, "info": info}


def _uniq(dily):
    seen, out = set(), []
    for s in dily:
        if s["key"] not in seen:
            seen.add(s["key"])
            out.append(s)
    return out


def lavice(moduly: list[dict], delka: float = 600.0, profil: str = "104040L") -> dict:
    return {"format": "pro3d-lib-plan", "verze": 1, "generator": GEN, "sestava": "Lavice_O1",
            "label": "Zkušební deska modulu O1 (pult obsluhy)", "snimky_prefix": "lavice_o1",
            "snimky": ["iso", "celo", "zezadu", "zezadu_iso", "bok"],
            "snimky_skryt": {"zezadu": ["M1_Telo"], "zezadu_iso": ["M1_Telo"]},
            "profil": {"kod": profil, "delka": delka, "label": f"Profil ALUTEC {profil} 40×40×{delka:g} (zkušební deska; průřez z kót katalogu)"},
            "dily": _uniq([s for m in moduly for s in m["dily"]]), "moduly": moduly}


def vzor_lavice() -> dict:
    """Výňatek manifestu: E-stop + START / STOP / RESET + volič + MTP700 (Siemens 3SU1)."""
    def part(i, cat, code, dev, brand="Siemens"):
        return {"id": f"-{dev}:{cat}", "tag": "-" + dev, "category": cat, "orderCode": code, "brand": brand, "device": dev, "qty": 1}
    return {"brief": {"desc": "", "concept": {"hmi": "Dotykový panel HMI 7\" v pultu obsluhy u stroje, tlačítka Ø22 vedle něj"}},
            "devices": [{"name": "S1", "cls": "DI", "desc": "Nouzové zastavení (NC)"},
                        {"name": "S2", "cls": "DI", "desc": "Tlačítko START cyklu"},
                        {"name": "S3", "cls": "DI", "desc": "Tlačítko STOP cyklu"},
                        {"name": "S0R", "cls": "DI", "desc": "Kvitace poruchy (RESET)"},
                        {"name": "S5", "cls": "DI", "desc": "Volič režimu AUTO / RUČNĚ"}],
            "parts": [part(1, "estop_button", "3SU1150-1HB20-1CH0", "S1"), part(2, "pushbutton", "3SU1100-0AB40-1BA0", "S2"),
                      part(3, "pushbutton", "3SU1100-0AB40-1BA0", "S3"), part(4, "pushbutton", "3SU1100-0AB40-1BA0", "S0R"),
                      part(5, "selector_switch", "", "S5"),
                      {"id": "-P1:plc_hmi", "tag": "-P1", "category": "plc_hmi", "orderCode": "6AV2123-3GB32-0AW0", "brand": "Siemens",
                       "device": None}]}


def lavice_o1() -> dict:
    return lavice([modul(pristroje_z_manifestu(vzor_lavice()), 65.0)])


def report_md(plan: dict) -> str:
    L = ["# PULT — pult obsluhy (modul O1, kód)", ""]
    for m in plan["moduly"]:
        k = m["kontrola"]
        L += [f"## {m['nazev']}", "", f"Rozměr {k['rozmer'][0]:g} × {k['rozmer'][1]:g} × {k['rozmer'][2]:g} mm, víko t {k['deska_t']:g}, "
              f"E-stop od čela HMI {k['estop_hmi']} mm.", "", "| přístroj | druh | funkce | barva | řada | výřez | výška [mm] |",
              "|---|---|---|---|---|---|---|"]
        vy = {v["tag"]: v for v in k["vyrezy"]}
        for p in k["pristroje"]:
            v = vy[p["tag"]]
            L.append(f"| {p['tag']} | {p['druh']} | {p['funkce'] or '—'} | {p['barva']} | {p['rada']} | Ø{v['d']:g}"
                     f"{' + drážka' if v['drazka'] else ''} | {k['vysky'][p['tag']]:g} |")
        L += ["", f"Přístup: víko snímatelné ({k['pristup']['sroubu_vika']} × {M_VIKO}, {k['sroub_vika']}), rezerva na vodiče "
              f"{k['pristup']['rezerva_vodice']:g} mm. Kotvení V4: {k['spojka_V4']}. Kabel V2: vývodka {VYVODKA}, R {k['kabel_R']:g}.", ""]
        for x in m["zpetna_vazba"] + m["vynechano"] + m["varovani"] + m["info"]:
            L.append(f"- {x}")
        L.append("")
    L += ["## ODHADY", "", f"- tělo t {T_TELO:g}, víko t {T_VIKO:g}, příruby {PRIRUBA:g}, hloubka {HLOUBKA:g}, navařovací matice {M_VIKO}",
          f"- krk přístroje Ø{KRK_D:g}, podklad E-stopu Ø{PODKLAD_D:g}, páčka voliče, upínky HMI (tvar)",
          f"- výšky ovládání (pult.json: E-stop 0,6–1,7 m ODHAD), E-stop ≤ {DOSAH_ESTOP_HMI:g} mm od HMI",
          f"- kabel Ø{KABEL_D:g}, otvor vývodky Ø{OTVOR_VYVODKY:g}", ""]
    return "\n".join(L)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Modul O1 — pult obsluhy (plán; volitelně FreeCAD + kontroly)")
    ap.add_argument("--manifest")
    ap.add_argument("--plan")
    ap.add_argument("--md")
    ap.add_argument("--fc")
    a = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
    if a.manifest:
        pr = pristroje_z_manifestu(json.loads(Path(a.manifest).read_text(encoding="utf-8")))
        m = modul(pr)
        plan = lavice([m], delka=max(600.0, m["kontrola"]["rozmer"][0] + 130))
    else:
        plan = lavice_o1()
    for m in plan["moduly"]:
        k = m["kontrola"]
        print(f"{m['nazev']}: {k['rozmer']} mm, {len(k['pristroje'])} přístrojů, HMI {bool(k['hmi'])}, E-stop–HMI {k['estop_hmi']}")
        for v in m["zpetna_vazba"] + m["vynechano"] + m["varovani"] + m["info"]:
            print("  ", v)
    if a.plan:
        Path(a.plan).write_text(json.dumps(plan, ensure_ascii=False, indent=1), encoding="utf-8")
    if a.md:
        Path(a.md).write_text(report_md(plan), encoding="utf-8")
    if a.fc:
        from . import bench
        res = bench.build_and_check(plan, Path(a.fc))
        print(json.dumps(res.get("souhrn", res), ensure_ascii=False, indent=1))
        return 0 if res.get("ok") else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
