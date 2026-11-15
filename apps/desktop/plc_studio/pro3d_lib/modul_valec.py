"""Modul P1 — pneumatický válec s upevněním, příslušenstvím pístnice, snímači polohy a přípojkami (čistý Python: plán;
FreeCAD: ``fc_lib.py``).

Vstup: norma + Ø + zdvih (``pro3d_parts/data/valce.json`` přes ``catalog_map.cylinder_spec`` — válec je App::Link na model
„dle dokumentace“), upevnění (ISO 15552: ``patky`` MS1 / ``priruba`` MF1 přední; ISO 6432: ``patka`` C85L přední na
nákružku), příslušenství pístnice (``kloub`` ISO 8139 / ``vidlice`` ISO 8140 / ``nic``), kotvení (``deska`` = ocelová
deska na profilu se závity pro patky, ``uhelnik`` = úhelník s přírubou na profilu, ``drazka`` = patka přímo do drážky
profilu maticemi T), snímače polohy (0–2, A = vysunuto u předního víka, B = zasunuto u zadního víka). Rozměry upevnění
a příslušenství z ``data/upevneni.json`` (převzato ze skillu modul-valec: SMC CP96 / C85 se stranami katalogu).

Výstup (``modul``): díly (spec), instance (App::Link s polohou), vlastní tělesa (deska / úhelník, zóny), kabely a hadice,
skupina „Pístnice“ s ``Konstrukce_Pohyb`` (příslušenství pístnice se posouvá se zdvihem), umístění modulu (``placement``)
a ``rozhrani`` = smlouva modulu ``P1_<tag>.json`` (kotvení, přípojky V1, elektro V2, signály, zóny, obálky, síly, odhady,
zdroje) v globálních souřadnicích.

Místní souřadnice válce: osa X = pístnice ven, z nahoru, počátek = zadní čelo těla válce (jako ``pro3d_parts``).

**Šrouby do závitu víka válce (otázka §5 návrhu generátoru):** model válce z ``pro3d_parts`` MÁ závity RT ve vících
vymodelované jako díry Ø d − P hloubky BG (``catalog_map.cylinder_spec`` → ``RT_tap``), takže App::Link na něj nese
díry a kontrola ``zasunuti`` (``fc_scan._zaber``) šroub uzná jako „závit“ v materiálu hliník (1,5·d). Délka šroubu se volí
spojkou V4 ``delka_do_zavitu(…, "hlinik", pruchozi=False)``. Odkaz válce navíc nese ``Konstrukce_Zavit`` (8 × RT hloubky
BG, zdroj tabulka SMC — schváleno 2026-11-03): po záměně za model výrobce bez děr (stažený STEP) kontrola ``zasunuti``
závit uzná podle dokumentace a ``kolize`` průnik šroubu povolí. Příruba MF1: šrouby do víka DIN 7984 (nízká hlava v
zahloubení L4, ``normalie.json``). Výchozí upevnění bez zadání = patky na adaptérové desce (``vychozi_upevneni``; deska
do dvou drážek profilu 80, když ho rám má).

CLI: ``python -m plc_studio.pro3d_lib.modul_valec [--tag -Y1 --norma "ISO 15552" --prumer 32 --zdvih 100 --upevneni patky
--pistnice nic --kotveni deska] [--plan plan.json] [--rozhrani SLOŽKA] [--fc SLOŽKA]`` (bez --prumer = zkušební deska P1)."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    __package__ = "plc_studio.pro3d_lib"

from . import spojky_el, spojky_mech, spojky_pneu  # noqa: E402
from ..pro3d_parts import catalog_map  # noqa: E402

HERE = Path(__file__).resolve().parent
UPV = json.loads((HERE / "data" / "upevneni.json").read_text(encoding="utf-8"))
NORM = spojky_mech.NORM
GEN = "pro3d_lib/modul_valec"

T_DESKA = 8.0          # ODHAD — ocelová deska S235 pod patkami (8 mm: závit M6 ≥ 6 mm, šroub do matice T M6x20 bez podložky)
T_UHELNIK = 12.0       # ODHAD — úhelník S235 pro přírubu (závit M8 ≥ 8 mm, šroub do matice T M6x25 s podložkou)
PREKRYV = 15.0         # ODHAD — přesah desky za patkou (místo pro šroub do drážky)
M_PROFIL = "M6"        # šrouby desky / úhelníku do matic T drážky 40/8
PROFIL80_Y = 20.0      # osy drážek plochy 80 profilu 40 × 80 (ALUTEC 104080, modul 40, drážka 8 — katalog s. 4/3, skill
                       # alutech-profily data/profily_alutec.json) od středu plochy
ZONA_PRSTY = 25.0      # ODHAD — přídavek zóny zdvihu (ISO 13854 nejmenší mezera pro prsty 25 mm)
TLAK_MAX = 1.0         # MPa = 10 bar — ODHAD max. tlaku pro síly do rámu (provozní 6 bar ODHAD)
TLAK_PROVOZ = 0.6
SNIMAC_L, SNIMAC_W = 25.0, 6.0     # ODHAD obálky snímače v drážce (pro3d_modules geom.snimac_valce 25 × 6 × 6)
SNIMAC_TYP = "SMT-8M_0.3_M8"
POHYB_NAZEV = "pístnice vysunuta"  # shodně s pro3d_parts/fc_parts.py (jedna skupina pohybu s pístnicí válce)

I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
RZ180 = [[-1, 0, 0], [0, -1, 0], [0, 0, 1]]
RZ90 = [[0, -1, 0], [1, 0, 0], [0, 0, 1]]
RY_PX = [[0, 0, -1], [0, 1, 0], [1, 0, 0]]     # dřík šroubu (model −Z) → +X
RY_MX = [[0, 0, 1], [0, 1, 0], [-1, 0, 0]]     # dřík šroubu → −X; model Z → +X (matice na nákružku)


def mul(R, v):
    return [sum(R[i][j] * v[j] for j in range(3)) for i in range(3)]


def mmul(A, B):
    return [[sum(A[i][k] * B[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def add(a, b, k=1.0):
    return [a[i] + k * b[i] for i in range(3)]


def _row(tab: dict, d: int) -> dict:
    for k, v in tab["rady"].items():
        if str(d) in k.split(","):
            return dict(v, _zdroj=tab["zdroj"], _nazev=tab["nazev"])
    raise ValueError(f"Ø{d}: v tabulce {tab['nazev'][:40]} není")


def m_pro_diru(d: float) -> str:
    """Největší šroub, jehož díra s vůlí (ISO 273 řada m) se vejde do díry ``d`` upevnění."""
    best = None
    for m, h in spojky_mech.DATA["iso273"]["m"].items():
        if h <= d + 0.01 and m in NORM["ISO4762"]["rady"] and (best is None or h > spojky_mech.otvor_vule(best)):
            best = m
    if not best:
        raise ValueError(f"díra Ø{d}: žádný šroub")
    return best


def vychozi_upevneni(norma: str, profily_ramu=()) -> dict:
    """Výchozí upevnění bez údaje v zadání (rozhodnutí uživatele 2026-11-03): patky. ISO 15552 = patky MS1 na adaptérové
    desce; deska kotvená do profilu 80 (dvě drážky), když ho rám má (``profily_ramu`` = šířky profilů rámu v mm, např.
    ``(40, 80)``), jinak do jedné drážky profilu 40. ISO 6432 = přední patka C85L maticemi T do drážky."""
    if norma == "ISO 6432":
        return {"upevneni": "patka", "kotveni": "drazka", "profil": 40}
    prof = [int(p) for p in profily_ramu or () if p]
    return {"upevneni": "patky", "kotveni": "deska", "profil": 80 if 80 in prof else 40}


def delka_7984(m: str, t_upinany: float, t_zavit: float, mat: str = "hlinik") -> dict:
    """Délka šroubu DIN 7984 (nízká hlava) do slepého závitu: dřík v závitu ≥ min. zašroubování, konec nad dnem
    (0,5 mm). Délky z ``normalie.json DIN7984 l`` (M6, M8); bez nich řada ISO 4762 = ODHAD dostupnosti."""
    row = NORM["DIN7984"]["rady"][m.upper()]
    d = float(m.upper().lstrip("M"))
    need = spojky_mech.min_zasroubovani(d, mat)
    lmin, lmax = t_upinany + need, t_upinany + t_zavit - 0.5
    rada = row.get("l") or spojky_mech.delky()
    for l in rada:
        if lmin - 0.2 <= l <= lmax + 1e-6:
            return {"ok": True, "m": m.upper(), "l": l, "potreba": need, "odhad_delky": not row.get("l"),
                    "text": f"DIN 7984 {m.upper()}x{l}: v závitu {min(l - t_upinany, t_zavit):.1f} ≥ {need:.1f} mm ({mat})"
                            + ("" if row.get("l") else " — délka z řady ISO 4762 (ODHAD dostupnosti DIN 7984)")}
    return {"ok": False, "m": m.upper(), "l": None, "text": f"DIN 7984 {m.upper()}: žádná délka v ⟨{lmin:.1f}; {lmax:.1f}⟩"}


def spec_sroub_7984(m: str, l: float) -> dict:
    """Šroub DIN 7984 — tvar jako ISO 4762 (válcová hlava + šestihran), rozměry z ``normalie.json DIN7984``."""
    r = NORM["DIN7984"]
    p = {k: v for k, v in r["rady"][m.upper()].items() if k != "l"}
    p.update(d=float(m.upper().lstrip("M")), l=float(l))
    return {"key": f"DIN7984_{m.upper()}x{l:g}", "gen": "sroub_4762", "params": p, "nazev": f"DIN 7984 {m.upper()}x{l:g}",
            "zdroj": [r["zdroj"]], "zdroj_popis": r["zdroj_popis"], "detail": "tvar", "typ": "sroub", "material": "ocel 8.8",
            "poznamka": "nízká válcová hlava (zapuštěná v zahloubení příruby)"}


def zavity_vik(p: dict, L: float, zdroj: str) -> str:
    """``Konstrukce_Zavit`` válce ISO 15552: 4 × RT hloubky BG v zadním (osa +x) i předním víku (osa −x), čtverec TG
    (= R tabulky SMC) — doložený závit pro model výrobce bez děr (``pro3d_tools.rules.parse_zavit``)."""
    from ..pro3d_tools import rules as _r
    d, P = (float(x) for x in p["RT"].upper().lstrip("M").split("X"))
    zz = []
    for sy in (-1, 1):
        for sz in (-1, 1):
            y, z = sy * p["R"] / 2, sz * p["R"] / 2
            zz.append({"d": d, "P": P, "hloubka": p["BG"], "poloha": [0.0, y, z], "osa": [1, 0, 0], "zdroj": zdroj, "material": "hlinik"})
            zz.append({"d": d, "P": P, "hloubka": p["BG"], "poloha": [L, y, z], "osa": [-1, 0, 0], "zdroj": zdroj, "material": "hlinik"})
    return _r.zavit_text(zz)


def _lib(key, body, nazev, zdroj, detail, typ="dil", material="ocel", pozn="", zastupny=False):
    return {"key": key, "gen": "lib_body", "body": body, "nazev": nazev, "zdroj": [zdroj] if isinstance(zdroj, str) else zdroj,
            "detail": detail, "typ": typ, "material": material, "poznamka": pozn, "zastupny": zastupny}


def _cyl_x(x0, x1, r, y=0.0, z=0.0):
    return {"cyl": {"p": [x0, y, z], "d": [1, 0, 0], "r": r, "h": x1 - x0}}


def _cyl_y(x, z, r, y0, y1):
    return {"cyl": {"p": [x, y0, z], "d": [0, 1, 0], "r": r, "h": y1 - y0}}


def _cyl_z(x, y, r, z0, z1):
    return {"cyl": {"p": [x, y, z0], "d": [0, 0, 1], "r": r, "h": z1 - z0}}


# --- upevnění ------------------------------------------------------------------------------------------------------

def patka_ms1(d: int) -> dict:
    """Patka ISO 15552 MS1 (SMC L5…, Festo HNC) v souřadnicích patky: svislá stěna x ∈ ⟨−AT, 0⟩ dosedá na čelo víka
    (x = 0), noha k −x, dosedací plocha z = −AH, osa válce v (y, z) = 0. Obrys (výška stěny, tvar) ODHAD, rozhraní tabulka."""
    t = UPV["iso15552"]["patka_L_MS1"]
    r = _row(t, d)
    m = r["sroub"].split("x")[0]
    AT, AH, E, TG, AU, AO, TR, AB, R2 = (r[k] for k in ("AT", "AH", "E", "TG", "AU", "AO", "TR", "AB", "R2"))
    top = -TG / 2 + spojky_mech.otvor_vule(m) / 2 + 4.0              # ODHAD — stěna jen přes spodní dvojici šroubů
    body = {"add": [{"box": [-AT, 0, -E / 2, E / 2, -AH, top]}, {"box": [-(AU + AO), 0, -E / 2, E / 2, -AH, -AH + AT]}],
            "cut": [_cyl_x(-AT - 1, 1, R2)]
                   + [_cyl_x(-AT - 1, 1, spojky_mech.otvor_vule(m) / 2, sy * TG / 2, -TG / 2) for sy in (-1, 1)]
                   + [_cyl_z(-AU, sy * TR / 2, AB / 2, -AH - 1, -AH + AT + 1) for sy in (-1, 1)]}
    spec = _lib(f"Patka_MS1_{d}", body, f"Patka ISO 15552 MS1 Ø{d} (SMC {r['kod_SMC']} / Festo HNC-{d})", t["zdroj"],
                "tvar zjednodušen: rozhraní (AB, TG, TR, AU, AH, AT, R2) z tabulky, výška stěny ODHAD",
                pozn="rozhraní ISO 15552, obrys SMC")
    return {"spec": spec, "r": r, "m": m, "holes_cover": [(sy * TG / 2, -TG / 2) for sy in (-1, 1)],
            "holes_frame": [(-AU, sy * TR / 2) for sy in (-1, 1)], "AH": AH, "AT": AT, "delka": AU + AO, "E": E}


def priruba_mf1(d: int) -> dict:
    """Příruba ISO 15552 MF1 (SMC F…, Festo FNC) v souřadnicích příruby: x ∈ ⟨0, MF⟩, x = 0 dosedá na čelo předního víka,
    středicí díra D na nákružek, 4 šrouby do víka v zahloubení L4 (výklad), 4 díry FB do rámu (TF × R)."""
    t = UPV["iso15552"]["priruba_F_MF1_MF2"]
    r = _row(t, d)
    m = r["sroub"].split("x")[0]
    MF, UF, E, D, TG, L4, TF, R, FB = (r[k] for k in ("MF", "UF", "E", "D", "TG", "L4", "TF", "R", "FB"))
    dk = NORM["ISO4762"]["rady"][m]["dk"]
    cut = [_cyl_x(-1, MF + 1, D / 2)]
    for sy in (-1, 1):
        for sz in (-1, 1):
            cut.append(_cyl_x(-1, MF + 1, spojky_mech.otvor_vule(m) / 2, sy * TG / 2, sz * TG / 2))
            cut.append(_cyl_x(MF - L4, MF + 1, (dk + 1) / 2, sy * TG / 2, sz * TG / 2))
            cut.append(_cyl_x(-1, MF + 1, FB / 2, sy * TF / 2, sz * R / 2))
    body = {"add": [{"box": [0, MF, -UF / 2, UF / 2, -E / 2, E / 2]}], "cut": cut}
    spec = _lib(f"Priruba_MF1_{d}", body, f"Příruba ISO 15552 MF1 Ø{d} (SMC {r['kod_SMC']} / Festo FNC-{d})", t["zdroj"],
                "tvar zjednodušen (kvádr): rozhraní D, FB, TG, MF, TF, UF, E, R z tabulky; zahloubení L4 Ø dk + 1 ODHAD",
                pozn="rozhraní ISO 15552, obrys SMC")
    return {"spec": spec, "r": r, "m": m, "m_fb": m_pro_diru(FB), "MF": MF, "L4": L4,
            "holes_cover": [(sy * TG / 2, sz * TG / 2) for sy in (-1, 1) for sz in (-1, 1)],
            "holes_frame": [(sy * TF / 2, sz * R / 2) for sy in (-1, 1) for sz in (-1, 1)], "E": E, "UF": UF}


def patka_c85(d: int, BE_d: float) -> dict:
    """Patka ISO 6432 C85L (1 ks) na předním nákružku: stěna x ∈ ⟨0, LT⟩ s dírou Ø BE (nasunutá na nákružek, drží
    matice nákružku), noha k +x s dírami AB (TR napříč). Délka nohy a poloha děr ODHAD (výklad výkresu)."""
    t = UPV["iso6432"]["patka_L"]
    r = _row(t, d)
    AB, AO, LT, NH, TR, UR, US = (r[k] for k in ("AB", "AO", "LT", "NH", "TR", "UR", "US"))
    LG = LT + 2 * AO + AB                                            # ODHAD délka nohy
    hx = LG - AO - AB / 2                                            # ODHAD díra AO od volného konce (k okraji díry)
    body = {"add": [{"box": [0, LT, -US / 2, US / 2, -NH, -NH + UR]}, {"box": [0, LG, -US / 2, US / 2, -NH, -NH + LT]}],
            "cut": [_cyl_x(-1, LT + 1, BE_d / 2)] + [_cyl_z(hx, sy * TR / 2, AB / 2, -NH - 1, -NH + LT + 1) for sy in (-1, 1)]}
    spec = _lib(f"Patka_C85L_{d}", body, f"Patka ISO 6432 Ø{d} (SMC {r['kod_SMC']}A, 1 ks)", t["zdroj"],
                "tvar zjednodušen: AB, LT, NH, TR, UR, US z tabulky; délka nohy a poloha děr ODHAD (výklad výkresu)",
                pozn="Festo HBN — list nečten, rozhraní ISO 6432 (ODHAD)")
    return {"spec": spec, "r": r, "m": m_pro_diru(AB), "holes_frame": [(hx, sy * TR / 2) for sy in (-1, 1)], "NH": NH, "LT": LT,
            "LG": LG, "hx": hx}


def matice_nakruzku(BE: str) -> dict:
    """Matice nákružku ISO 6432 — tenká matice ISO 4035 (ODHAD: s, m z normy nejsou v normalie.json) → zástupná."""
    d = float(BE.upper().lstrip("M").split("X")[0])
    s, m = {12: (18.0, 7.0), 16: (24.0, 8.0), 22: (32.0, 10.0)}.get(int(d), (1.5 * d, 0.5 * d))
    body = {"add": [{"hex_z": {"s": s, "z0": 0.0, "z1": m}}], "cut": [_cyl_z(0, 0, d / 2, -1, m + 1)]}
    return {"spec": _lib(f"Matice_nakruzku_{BE.replace('.', '_')}", body, f"Matice nákružku {BE} (zástupná, ISO 4035 ODHAD s{s:g} m{m:g})",
                         "ODHAD — dodává výrobce s válcem / patkou (SMC C85 str. 10 rozměr matice neuveden)", "obálka", typ="matice",
                         pozn="díra = Ø závitu nákružku (sevření bez průniku)", zastupny=True), "m": m, "s": s}


# --- příslušenství pístnice ------------------------------------------------------------------------------------------

def kloub(norma: str, d: int, KK_d: float, A: float) -> dict:
    """Kloubová hlava ISO 8139 (SMC KJ, Festo SGS) v souřadnicích x = 0 na osazení pístnice, osa +X; oko s dírou d1 osa Y.
    Vnitřní závit = válec Ø KK hloubky A + 0,5 (dotyk se závitem pístnice), krk Ø KK + 8 ODHAD."""
    t = UPV[norma]["pistnice_oko_KJ_ISO8139" if norma == "iso15552" else "pistnice_oko_KJ"]
    r = _row(t, d)
    h, d6, d1 = r["h"], r["d6"], r.get("d1") or r.get("d")
    b1 = r.get("b1")
    if A + 0.5 > h - d6 / 2 - 1:
        raise ValueError(f"kloub Ø{d}: závit pístnice {A} delší než krk hlavy")
    rk = KK_d / 2 + 4.0
    body = {"add": [_cyl_x(0, h - d6 / 2 + 1.0, rk), _cyl_y(h, 0, d6 / 2, -b1 / 2, b1 / 2)],
            "cut": [_cyl_x(-1, A + 0.5, KK_d / 2), _cyl_y(h, 0, d1 / 2, -b1 / 2 - 1, b1 / 2 + 1)]}
    spec = _lib(f"Kloub_{r['kod_SMC']}", body, f"Kloubová hlava ISO 8139 {r['kod_SMC']} {r.get('d3', '')}", t["zdroj"],
                "tvar zjednodušen: h, d6, d1, b1 z tabulky; krk Ø KK + 8 ODHAD; vnitřní závit = Ø KK (dotyk)")
    return {"spec": spec, "r": r, "delka": h + d6 / 2, "polomer": max(d6 / 2, rk), "sirka": b1, "kod": r["kod_SMC"]}


def vidlice(norma: str, d: int, KK_d: float, A: float) -> dict:
    """Vidlice pístnice ISO 8140 (SMC GKM, Festo SG) — x = 0 na osazení, mezera b, čep f osa Y uprostřed délky vidlice c
    (výklad), šířka líců ODHAD."""
    t = UPV[norma]["pistnice_vidlice_GKM_ISO8140" if norma == "iso15552" else "pistnice_vidlice_GKM"]
    r = _row(t, d)
    L = r.get("l") or r["l1"]
    g = r.get("g") or r["a"]
    c, b, f = r["c"], r["b"], r["f"]
    j = max(r.get("j") or 0, KK_d + 3.0)
    if A + 0.5 > L - c:
        raise ValueError(f"vidlice Ø{d}: závit pístnice {A} delší než krk vidlice {L - c}")
    w = b + 2 * max(2.0, f / 2)                                     # ODHAD vnější šířka
    body = {"add": [_cyl_x(0, L - c, j / 2), {"box": [L - c, L, -w / 2, w / 2, -g / 2, g / 2]}],
            "cut": [_cyl_x(-1, A + 0.5, KK_d / 2), {"box": [L - c + 2.0, L + 1, -b / 2, b / 2, -g / 2 - 1, g / 2 + 1]},
                    _cyl_y(L - c / 2, 0, f / 2, -w / 2 - 1, w / 2 + 1)]}
    spec = _lib(f"Vidlice_{r['kod_SMC']}", body, f"Vidlice pístnice ISO 8140 {r['kod_SMC']} {r.get('e', '')}", t["zdroj"],
                "tvar zjednodušen: l, c, b, f, g z tabulky; šířka líců ODHAD; čep není modelován")
    return {"spec": spec, "r": r, "delka": L, "polomer": max(g / 2, w / 2, j / 2), "kod": r["kod_SMC"]}


# --- snímač polohy ----------------------------------------------------------------------------------------------------

def spec_snimac() -> dict:
    body = {"add": [{"box": [0, SNIMAC_L, 0, SNIMAC_W, -SNIMAC_W / 2, SNIMAC_W / 2]}]}
    return _lib("Snimac_polohy_SMT-8M", body, "Snímač polohy válce Festo SMT-8M-A-PS-24V-E-0,3-M8D (zástupná obálka 25 × 6 × 6)",
                UPV["snimace_v_drazce"]["Festo_SMT-8M"]["zdroj"], "obálka", material="PA / Zn",
                pozn="rozměry v listu nejsou — obálka ODHAD (pro3d_modules geom.snimac_valce); v modelu válce drážka není → "
                     "snímač leží na ploše nad drážkou", zastupny=True)


# --- modul -----------------------------------------------------------------------------------------------------------

def _forces(Dp: float, d_rod: float, h: float) -> dict:
    A = math.pi * Dp * Dp / 4
    Ar = math.pi * (Dp * Dp - d_rod * d_rod) / 4
    out = {"A_mm2": round(A, 1), "A_zpet_mm2": round(Ar, 1)}
    for nm, p in (("10bar", TLAK_MAX), ("6bar", TLAK_PROVOZ)):
        out[f"F_ven_{nm}_N"] = round(A * p, 1)
        out[f"F_zpet_{nm}_N"] = round(Ar * p, 1)
    out["rameno_mm"] = h
    out["M_kotveni_10bar_Nm"] = round(A * TLAK_MAX * h / 1000.0, 2)
    out["pozn"] = ("ODHAD: teoretická síla p·A při max. tlaku 10 bar (rozsah ventilů / GRLA 0,2–10 bar), bez tření a rázu; "
                   "moment na kotvení = F × výška osy nad dosedací plochou (dimenzovani.md §5)")
    return out


def modul(tag: str, norma: str, prumer: int, zdvih: int, upevneni: str | None = None, pistnice: str = "nic",
          kotveni: str | None = None, snimace: int = 2, grla: bool = False, pos=(0.0, 0.0, 0.0), rot=None, nazev: str = "",
          profil: int | None = None, profily_ramu=()) -> dict:
    """Plán modulu P1 (místní souřadnice válce) + ``placement`` (rot, pos) do zkušební desky / stroje. ``pos`` je poloha
    počátku válce v globálu, z se volí tak, aby dosedací rovina kotvení ležela na z = pos[2] − výška (viz ``z_kotveni``).
    Bez ``upevneni`` / ``kotveni`` / ``profil`` = ``vychozi_upevneni(norma, profily_ramu)`` (patky; deska do profilu 80,
    když ho rám má)."""
    vy = vychozi_upevneni(norma, profily_ramu)
    upevneni = upevneni or vy["upevneni"]
    kotveni = kotveni or vy["kotveni"]
    profil = int(profil or vy["profil"])
    if profil not in (40, 80):
        raise ValueError("profil kotvení desky = 40 (jedna drážka) nebo 80 (dvě drážky po 40 mm)")
    nk = {"ISO 15552": "iso15552", "ISO 6432": "iso6432"}[norma]
    spec, why = catalog_map.cylinder_spec(norma, prumer, zdvih)
    if not spec:
        raise ValueError(why)
    p = spec["params"]
    Rg = rot or I3
    L = (p["L8"] if nk == "iso15552" else p["S"]) + zdvih
    half = (p["E"] if nk == "iso15552" else p["NA"]) / 2
    KK_d = p["KK_d"]
    A_thr = p["A"] if nk == "iso15552" else p["AM"]
    x_s = L + (p["WH"] if nk == "iso15552" else p["H"] - p["AM"])        # osazení pístnice (zasunuto)
    d_rod = p["D"] if nk == "iso15552" else p["C"]
    dily, inst, tel, kab, odh, zdroje = [spec], [], [], [], [], [spec["zdroj"][0]]
    var = []
    cprops = {"PLCdesk_Id": f"{tag}:cylinder"}
    if nk == "iso15552":     # doložené závity RT víek — platí i po záměně za model výrobce bez děr (Konstrukce_Zavit)
        cprops["Konstrukce_Zavit"] = zavity_vik(p, L, spec["zdroj"][0])
    inst.append({"model": spec["key"], "pos": [0, 0, 0], "rot": I3, "druh": "valec", "props": cprops})
    kotv, srouby_txt = [], []

    def put(r_, mount="", skupina=None, props=None):
        dily.extend(r_["dily"])
        for it in r_["instance"]:
            it = dict(it)
            if skupina:
                it["skupina"] = skupina
            if mount:
                it["mount"] = mount
            if props:
                it["props"] = props
            inst.append(it)
        srouby_txt.append(r_["text"])

    # 1) upevnění + šrouby do víka
    if nk == "iso15552" and upevneni == "patky":
        u = patka_ms1(prumer)
        dily.append(u["spec"])
        inst.append({"model": u["spec"]["key"], "pos": [0, 0, 0], "rot": I3, "druh": "patka_zadni"})
        inst.append({"model": u["spec"]["key"], "pos": [L, 0, 0], "rot": RZ180, "druh": "patka_predni"})
        for (y, z) in u["holes_cover"]:
            for x, R_, sx in ((-u["AT"], RY_PX, 1), (L + u["AT"], RY_MX, -1)):
                dl = spojky_mech.delka_do_zavitu(u["m"], u["AT"], p["BG"], "hlinik", pruchozi=False)
                if not dl["ok"]:
                    raise ValueError(dl["text"])
                sp = spojky_mech.spec_sroub(u["m"], dl["l"])
                put({"dily": [sp], "instance": [{"model": sp["key"], "pos": [x, sx * y if sx < 0 else y, z], "rot": R_, "druh": "sroub"}],
                     "text": "víko: " + dl["text"]})
        h_kotv, z_dosed = u["AH"], -u["AH"]
        odh.append("patka MS1: výška svislé stěny ODHAD (jen přes spodní šrouby), obrys SMC")
        zdroje.append(UPV["iso15552"]["patka_L_MS1"]["zdroj"])
        hmot = UPV["iso15552"]["hmotnosti_SMC_kg"]
        m_kg = hmot["s_patkami"][str(prumer)] + hmot["na_50mm_zdvihu"][str(prumer)] * zdvih / 50
        # kotvení: deska se závity + šrouby desky do drážky
        if kotveni != "deska":
            raise ValueError("patky ISO 15552: kotvení zatím jen 'deska' (díry TR napříč osou — jedna drážka 40 nestačí)")
        x0, x1 = -u["delka"] - PREKRYV, L + u["delka"] + PREKRYV
        W = max(u["E"] + 10.0, 2 * PROFIL80_Y + spojky_mech.otvor_vule(M_PROFIL) + 10.0 if profil == 80 else 0.0)
        zt, zb = z_dosed, z_dosed - T_DESKA
        cut = []
        for hx, hy in u["holes_frame"]:
            for xx, yy in ((hx, hy), (L - hx, -hy)):
                cut.append(_cyl_z(xx, yy, spojky_mech.zavit_otvor(u["m"]) / 2, zb - 1, zt + 1))
                r_ = spojky_mech.sroub_do_zavitu(u["m"], [xx, yy, zt + u["AT"]], True, u["AT"], T_DESKA, "ocel")
                if not r_["ok"]:
                    raise ValueError(r_["text"])
                put(r_)
        ys = (-PROFIL80_Y, PROFIL80_Y) if profil == 80 else (0.0,)
        for xx in (x0 + PREKRYV / 2, x1 - PREKRYV / 2):
            for yy in ys:
                cut.append(_cyl_z(xx, yy, spojky_mech.otvor_vule(M_PROFIL) / 2, zb - 1, zt + 1))
                r_ = spojky_mech.sroub_do_drazky(M_PROFIL, xx, yy, zb, T_DESKA)
                if not r_["ok"]:
                    raise ValueError(r_["text"])
                put(r_)
                kotv.append({"pos": [xx, yy, zb], "osa": [0, 0, -1], "M": M_PROFIL, "druh": "matice T drážka 40/8",
                             "sroub": r_["delka"]["l"], "profil": profil})
        nk_ = len(ys) * 2
        tel.append({"name": "Deska", "label": f"Adaptérová deska pod patky {tag} (S235 t {T_DESKA:g}, profil {profil}, ODHAD)",
                    "body": {"add": [{"box": [x0, x1, -W / 2, W / 2, zb, zt]}], "cut": cut},
                    "props": {"Konstrukce_Typ": "dil", "Konstrukce_Material": "ocel S235 (ODHAD)",
                              "Konstrukce_Poznamka": f"tloušťka a obrys ODHAD; závity {u['m']} pro patky, {nk_} × {M_PROFIL} do "
                                                     f"{'dvou drážek profilu 80' if profil == 80 else 'drážky profilu 40'}"}})
        odh.append(f"adaptérová deska pod patky S235 t {T_DESKA:g} — ODHAD (výchozí upevnění; profil {profil}"
                   + (", drážky ±20 mm" if profil == 80 else "") + ")")
        z_kotv = zb
    elif nk == "iso15552" and upevneni == "priruba":
        u = priruba_mf1(prumer)
        dily.append(u["spec"])
        inst.append({"model": u["spec"]["key"], "pos": [L, 0, 0], "rot": I3, "druh": "priruba"})
        # šrouby do víka: nízká hlava DIN 7984 se vejde do zahloubení L4 (ISO 4762 by vyčnívala — K5 / skill modul-valec)
        k7984 = NORM["DIN7984"]["rady"][u["m"]]["k"]
        hlava_ven = max(0.0, k7984 - u["L4"])
        for (y, z) in u["holes_cover"]:
            dl = delka_7984(u["m"], u["MF"] - u["L4"], p["BG"], "hlinik")
            if not dl["ok"]:
                raise ValueError(dl["text"])
            sp = spec_sroub_7984(u["m"], dl["l"])
            put({"dily": [sp], "instance": [{"model": sp["key"], "pos": [L + u["MF"] - u["L4"], y, z], "rot": RY_MX, "druh": "sroub"}],
                 "text": "víko: " + dl["text"]})
        zdroje.append(NORM["DIN7984"]["zdroj"])
        if kotveni != "uhelnik":
            raise ValueError("příruba MF1: kotvení zatím jen 'uhelnik'")
        za = u["E"] / 2 + 5.0                                       # osa nad profilem (spodek příruby 5 mm nad profilem)
        zb, xv = -za, L + u["MF"]
        W = u["UF"] + 10.0
        ztop = u["E"] / 2 + 10.0
        dk = NORM["ISO4762"]["rady"][u["m"]]["dk"]
        cut = [_cyl_x(xv - 1, xv + T_UHELNIK + 1, d_rod / 2 + 5.0)]
        if hlava_ven > 0:
            for (y, z) in u["holes_cover"]:
                cut.append(_cyl_x(xv - 1, xv + T_UHELNIK + 1, (dk + 2) / 2, y, z))   # průchod hlav šroubů víka (vyčnívají)
        for (y, z) in u["holes_frame"]:
            cut.append(_cyl_x(xv - 1, xv + T_UHELNIK + 1, spojky_mech.zavit_otvor(u["m_fb"]) / 2, y, z))
            dl = spojky_mech.delka_do_zavitu(u["m_fb"], u["MF"], T_UHELNIK, "ocel")
            if not dl["ok"]:
                raise ValueError(dl["text"])
            sp = spojky_mech.spec_sroub(u["m_fb"], dl["l"])
            put({"dily": [sp], "instance": [{"model": sp["key"], "pos": [L, y, z], "rot": RY_PX, "druh": "sroub"}],
                 "text": "příruba → úhelník: " + dl["text"]})
        leg = 40.0 + T_UHELNIK
        for xx in (xv + T_UHELNIK + 10.0, xv + T_UHELNIK + 30.0):
            cut.append(_cyl_z(xx, 0, spojky_mech.otvor_vule(M_PROFIL) / 2, zb - 1, zb + T_UHELNIK + 1))
            r_ = spojky_mech.sroub_do_drazky(M_PROFIL, xx, 0.0, zb, T_UHELNIK)
            if not r_["ok"]:
                raise ValueError(r_["text"])
            put(r_)
            kotv.append({"pos": [xx, 0.0, zb], "osa": [0, 0, -1], "M": M_PROFIL, "druh": "matice T drážka 40/8",
                         "sroub": r_["delka"]["l"]})
        tel.append({"name": "Uhelnik", "label": f"Úhelník příruby {tag} (S235 t {T_UHELNIK:g}, ODHAD)",
                    "body": {"add": [{"box": [xv, xv + T_UHELNIK, -W / 2, W / 2, zb, ztop]},
                                     {"box": [xv, xv + leg, -W / 2, W / 2, zb, zb + T_UHELNIK]}], "cut": cut},
                    "props": {"Konstrukce_Typ": "dil", "Konstrukce_Material": "ocel S235 (ODHAD)",
                              "Konstrukce_Poznamka": f"svařenec / ohýbaný plech ODHAD; závity {u['m_fb']} pro přírubu, "
                                                     + ("průchody hlav šroubů víka, " if hlava_ven > 0 else
                                                        "šrouby víka DIN 7984 zapuštěné v zahloubení příruby, ") +
                                                     f"2 × {M_PROFIL} do drážky profilu"}})
        odh += ["úhelník příruby S235 t 12 — ODHAD (tuhost neověřena — dimenzovani.md)", "zahloubení L4 příruby Ø dk + 1 (výklad)"]
        zdroje.append(UPV["iso15552"]["priruba_F_MF1_MF2"]["zdroj"])
        hmot = UPV["iso15552"]["hmotnosti_SMC_kg"]
        m_kg = hmot["s_prirubou"][str(prumer)] + hmot["na_50mm_zdvihu"][str(prumer)] * zdvih / 50
        h_kotv, z_kotv = za, zb
    elif nk == "iso6432" and upevneni == "patka":
        u = patka_c85(prumer, p["BE_d"])
        mt = matice_nakruzku(p["BE"])
        if u["LT"] + mt["m"] > p["F"]:
            raise ValueError("patka + matice delší než nákružek")
        dily += [u["spec"], mt["spec"]]
        inst.append({"model": u["spec"]["key"], "pos": [L, 0, 0], "rot": I3, "druh": "patka"})
        inst.append({"model": mt["spec"]["key"], "pos": [L + u["LT"], 0, 0], "rot": RY_MX, "druh": "matice_nakruzku"})
        if kotveni != "drazka":
            raise ValueError("patka ISO 6432: kotvení zatím jen 'drazka' (osa válce napříč profilem)")
        zb = -u["NH"]
        for hx, hy in u["holes_frame"]:
            r_ = spojky_mech.sroub_do_drazky(u["m"], L + hx, hy, zb, u["LT"])
            if not r_["ok"]:
                raise ValueError(r_["text"])
            for it in r_["instance"]:
                if it["druh"] == "matice":
                    it["rot"] = RZ90                     # drážka vede podél místní osy y (válec napříč profilem)
            put(r_)
            kotv.append({"pos": [L + hx, hy, zb], "osa": [0, 0, -1], "M": u["m"], "druh": "matice T drážka 40/8",
                         "sroub": r_["delka"]["l"]})
        odh += ["patka C85L: délka nohy a poloha děr ODHAD (výklad výkresu)", "matice nákružku ISO 4035 ODHAD (zástupná)",
                "válec drží jen přední patka (konzola) — zadní oko volné; u dlouhého zdvihu / bočního zatížení přidat kozlík"]
        zdroje.append(UPV["iso6432"]["patka_L"]["zdroj"])
        m_kg = None
        odh.append("hmotnost ISO 6432 v tabulce není")
        h_kotv, z_kotv = u["NH"], zb
    else:
        raise ValueError(f"upevnění {upevneni!r} pro {norma} zatím není (hotovo: ISO 15552 patky / priruba, ISO 6432 patka)")

    # 2) pístnice — příslušenství ve skupině „Pístnice“ s druhou polohou
    skupiny = [{"name": "Pistnice", "label": f"Pístnice {tag} — příslušenství (pohyb se zdvihem)",
                "props": {"Konstrukce_Typ": "dil", "Konstrukce_Pohyb": json.dumps({"nazev": POHYB_NAZEV, "posun": [float(zdvih), 0.0, 0.0]},
                                                                                   ensure_ascii=False)}}]
    acc = None
    if pistnice in ("kloub", "vidlice"):
        acc = (kloub if pistnice == "kloub" else vidlice)(nk, prumer, KK_d, A_thr)
        dily.append(acc["spec"])
        inst.append({"model": acc["spec"]["key"], "pos": [x_s, 0, 0], "rot": I3, "druh": pistnice, "skupina": "Pistnice",
                     "mount": "zavit"})                    # našroubováno na závit KK pístnice
        zdroje.append(acc["spec"]["zdroj"][0])
        fz = UPV["iso15552"]["festo_doplnky"]
        kk = p["KK"]
        nos = (fz.get("SGS" if pistnice == "kloub" else "SG", {}).get(kk) or {}).get("nosnost_kN")
        F = math.pi * prumer ** 2 / 4 * TLAK_MAX
        if nos and F > 0.8 * nos * 1000:
            var.append(f"příslušenství pístnice {kk}: nosnost Festo {nos} kN × síla {F / 1000:.2f} kN při 10 bar — rezerva < 20 % "
                       "(ráz v koncové poloze) — ověřit (dimenzovani.md)")
    elif pistnice != "nic":
        raise ValueError(f"příslušenství pístnice {pistnice!r} zatím není (kloub / vidlice / nic)")
    tip = x_s + (acc["delka"] if acc else A_thr)
    r_acc = acc["polomer"] if acc else d_rod / 2

    # 3) snímače polohy (B = zasunuto u zadního víka, A = vysunuto u předního) — kabel vývodu ven k −x, oblouk do +y
    sn = []
    if snimace:
        sp_s = spec_snimac()
        dily.append(sp_s)
        if nk == "iso15552":
            AB = UPV["snimace_v_drazce"]["SMC_D-M9"]["poloha_A_B"]["D-M9"][str(prumer)]
            pozA, pozB = AB
            odh.append("poloha snímačů A / B podle SMC D-M9 (výklad: od čela víka ke konci snímače) — seřídit na stroji")
        else:
            pozA = pozB = 3.0
            odh.append("poloha snímačů ISO 6432 ODHAD 3 mm od konců (tabulka A / B pro C85 není); upnutí páskem ODHAD")
        for k, (x0, nm, poloha) in enumerate(((pozB, "B", "zasunuto"), (L - pozA - SNIMAC_L, "A", "vysunuto"))[:snimace]):
            inst.append({"model": sp_s["key"], "pos": [x0, half, 0.0], "rot": I3, "druh": f"snimac_{nm}", "mount": "drazka",
                         "props": {"PLCdesk_Id": f"{tag}:cylinder_switch", "PLCdesk_Instance": str(k + 1)}})
            kv = spojky_el.kabel_vyvod_snimace(SNIMAC_TYP, [x0, half + SNIMAC_W / 2, 0.0], [-1, 0, 0], [0, 1, 0])
            kab.append({"name": f"Kabel_snimace_{nm}", "label": f"Kabel snímače {tag} {nm} (vývod 0,3 m M8, začátek, R {kv['R']:g})",
                        "r": kv["r"], "path": kv["path"], "props": {"Konstrukce_Typ": "kabel", "Konstrukce_Druh": "signal",
                                                                    "Kabel_R_min": kv["R"]}})
            sn.append({"nazev": nm, "poloha_pistu": poloha, "x": [x0, x0 + SNIMAC_L], "kabel": kv, "signal": f"{tag} {nm}"})
        odh.append(f"vývod snímače Ø {spojky_el.vyvod_data(SNIMAC_TYP)['D']:g}, R 10 × D — ODHAD (list neuvádí)")

    # 4) přípojky V1 na horní ploše (EE, PL od čela víka; ISO 6432 ODHAD 8 mm od konců)
    ee = p["EE"]
    vol = spojky_pneu.volba_pro_valec(ee, grla=grla)
    pl = p.get("PL") or 8.0
    if not p.get("PL"):
        odh.append("přípojky ISO 6432: poloha 8 mm od konců ODHAD (model válce port nemá — závit šroubení nemodelován)")
    s_zav = bool(p.get("EE_hole"))
    porty = []
    for nm, x in (("zadni", pl), ("predni", L - pl)):
        prt = {"id": f"{tag}.{nm}", "seat": [x, 0.0, half], "n": [0, 0, 1], "thread": vol["thread"], "fitting": vol["fitting"],
               "hose": vol["hose"]}
        if vol["grla"]:
            prt["tower"], prt["w"] = [0, -1, 0], [0, 0, 1]
        else:
            prt["tower"] = prt["w"] = [0, -1, 0]
        r_ = spojky_pneu.port(prt, s_zavitem=s_zav)
        if r_["dil"]["key"] not in {d["key"] for d in dily}:
            dily.append(r_["dil"])
        j = len(inst)
        inst.append(dict(r_["instance"], druh=f"sroubeni_{nm}"))
        h = r_["hadice"]
        kab.append({"name": f"Hadice_{nm}", "label": f"Hadice {h['nazev']} {tag} {nm} (začátek, R {h['R']:g})", "r": h["r"],
                    "path": h["path"], "props": {"Konstrukce_Typ": "hadice", "Hadice_R_min": h["R_min"], "Hadice_R": h["R"]}})
        tel.append({"name": f"Prostor_hadice_{nm}", "label": f"Pomocný prostor nasunutí hadice {tag} {nm}", "body": r_["zona"],
                    "props": {"Konstrukce_Typ": "pomocny", "Konstrukce_Zona": "hadice"}, "vyjimka": [f"inst:{j}"]})
        porty.append({"id": prt["id"], "seat": prt["seat"], "n": prt["n"], "thread": vol["thread"], "fitting": vol["fitting"],
                      "hose": vol["hose"], "tower": prt.get("tower"), "zacatek_hadice": h["zacatek"], "smer_hadice": h["smer"],
                      "R": h["R"], "R_min": h["R_min"], "usti": h["usti"], "zasun": h["zasun"], "port": nm,
                      "pripojit": "4 (vysunutí)" if nm == "zadni" else "2 (zasunutí)"})
    odh.append(f"šroubení {vol['fitting']} zástupná obálka (rozhraní z datového listu); Ø hadice: {vol['stav']}")

    # 5) zóna zdvihu (nebezpečná — pístnice a příslušenství v obou polohách + 25 mm)
    xz0 = L + (p.get("VD") or p.get("F") or 0.0)
    zr = r_acc + ZONA_PRSTY
    zona = {"add": [{"box": [xz0, tip + zdvih + ZONA_PRSTY, -zr, zr, -zr, zr]}]}
    tel.append({"name": f"Zona_zdvihu", "label": f"Zona_zdvihu {tag} (pístnice + příslušenství, zdvih {zdvih}, + {ZONA_PRSTY:g} mm)",
                "body": zona, "props": {"Konstrukce_Typ": "zona", "Konstrukce_Zona": "zdvih"}})

    # 6) rozhraní modulu (globální souřadnice)
    t = list(pos)
    G = lambda v: [round(x, 3) for x in add(mul(Rg, v), t)]   # noqa: E731
    Gd = lambda v: [round(x, 6) for x in mul(Rg, v)]           # noqa: E731

    def bb(lo, hi):
        pts = [G([a, b, c]) for a in (lo[0], hi[0]) for b in (lo[1], hi[1]) for c in (lo[2], hi[2])]
        return [round(min(q[i] for q in pts), 1) for i in range(3)] + [round(max(q[i] for q in pts), 1) for i in range(3)]
    ob_lo = [-(p.get("VA") or p.get("F") or 0) - 40, -max(half, 60), z_kotv]
    sil = _forces(prumer, d_rod, h_kotv)
    rozhrani = {
        "format": "plcdesk-pro-modul", "modul": "P1", "verze": 1, "tag": tag, "generator": GEN,
        "valec": {"norma": norma, "prumer": prumer, "zdvih": zdvih, "model": spec["key"], "upevneni": upevneni, "pistnice": pistnice,
                  "kotveni": kotveni, "osa": Gd([1, 0, 0]), "pocatek": G([0, 0, 0])},
        "kotveni": [dict(k, pos=G(k["pos"]), osa=Gd(k["osa"])) for k in kotv],
        "pripojky": [dict(q, seat=G(q["seat"]), n=Gd(q["n"]), tower=Gd(q["tower"]) if q.get("tower") else None,
                          zacatek_hadice=G(q["zacatek_hadice"]), smer_hadice=Gd(q["smer_hadice"]), usti=G(q["usti"])) for q in porty],
        "elektro": [{"signal": s["signal"], "poloha_pistu": s["poloha_pistu"], "kabel": SNIMAC_TYP,
                     "zacatek": G(s["kabel"]["path"][-1]["line"][1]), "smer": Gd(spojky_el.smer_konce(s["kabel"]["path"], [0, 1, 0])), "R": s["kabel"]["R"],
                     "konektor": s["kabel"]["konektor"], "delka_vyvodu_mm": s["kabel"]["konec_vyvodu_mm"],
                     "pozn": "konektor M8 je na konci vývodu 0,3 m — volný prostor konektoru řeší trasa (V2)"} for s in sn],
        "signaly": [{"id": f"{tag}:cylinder_switch", "inst": str(i + 1), "nazev": s["nazev"], "poloha_pistu": s["poloha_pistu"]}
                    for i, s in enumerate(sn)],
        "zony": [{"nazev": "zdvih", "bbox": bb([xz0, -zr, -zr], [tip + zdvih + ZONA_PRSTY, zr, zr])}],
        "obalka": bb(ob_lo, [tip + 5, max(half, 60), half + 45]),
        "obalka_vysunuto": bb(ob_lo, [tip + zdvih + 5, max(half, 60), half + 45]),
        "hmotnost_kg": round(m_kg, 2) if m_kg else None,
        "sily": sil, "odhady": odh, "varovani": var, "zdroje": sorted(set(zdroje)),
    }
    for k in rozhrani["kotveni"]:
        k["F_max_N"] = sil["F_ven_10bar_N"]
    return {"typ": f"{norma} Ø{prumer}×{zdvih}", "tag": tag, "nazev": nazev or f"P1 {tag} {norma} Ø{prumer}×{zdvih} {upevneni}",
            "dily": dily, "instance": inst, "telesa": tel, "kabely": kab, "skupiny": skupiny,
            "placement": {"pos": t, "rot": Rg}, "z_kotveni": z_kotv,
            "props": {"Konstrukce_Generator": GEN, "Konstrukce_Modul": "P1", "Konstrukce_Valec": f"{norma} Ø{prumer}×{zdvih}",
                      "PLCdesk_Id": f"asm:P1{tag}"},
            "rozhrani": rozhrani,
            "kontrola": {"L": L, "x_osazeni": x_s, "konec": tip, "zdvih": zdvih, "snimace": sn, "porty": porty, "srouby": srouby_txt,
                         "sily": sil, "kotveni": kotv, "hadice_R": [(q["R"], round(spojky_pneu.ohyb_z_cesty(c["path"]), 3))
                                                                      for q, c in zip(porty, [k for k in kab if k["props"]["Konstrukce_Typ"] == "hadice"])],
                         "kabel_R": [(s["kabel"]["R"], round(spojky_el.ohyb_z_cesty(s["kabel"]["path"]), 3)) for s in sn]},
            "varovani": var}


def _uniq(dily):
    seen, out = set(), []
    for s in dily:
        if s["key"] not in seen:
            seen.add(s["key"])
            out.append(s)
    return out


def lavice_p1(delka: float = 920.0) -> dict:
    """Zkušební deska P1: profil ALUTEC 40 × 40 × ``delka`` podél X (drážka nahoře v y = 0, z 0…40) a tři varianty:
    A ISO 15552 Ø32 × 100 na patkách (deska), GRLA; B ISO 15552 Ø50 × 80 na přírubě s kloubovou hlavou (úhelník), QS;
    C ISO 6432 Ø16 × 50 na přední patce maticemi T do drážky (napříč profilem) s vidlicí, QSM M5."""
    pa = patka_ms1(32)
    A = modul("-Y1", "ISO 15552", 32, 100, "patky", "nic", "deska", grla=True,
              pos=(10.0 + pa["delka"] + PREKRYV, 0.0, 40.0 + pa["AH"] + T_DESKA), nazev="P1 -Y1 ISO 15552 Ø32×100 patky, GRLA")
    pf = priruba_mf1(50)
    B = modul("-Y2", "ISO 15552", 50, 80, "priruba", "kloub", "uhelnik", pos=(440.0, 0.0, 40.0 + pf["E"] / 2 + 5.0),
              nazev="P1 -Y2 ISO 15552 Ø50×80 příruba + kloubová hlava")
    sc, _ = catalog_map.cylinder_spec("ISO 6432", 16, 50)
    pc = patka_c85(16, sc["params"]["BE_d"])
    Lc = sc["params"]["S"] + 50
    C = modul("-Y3", "ISO 6432", 16, 50, "patka", "vidlice", "drazka", pos=(delka - 40.0, -(Lc + pc["hx"]), 40.0 + pc["NH"]),
              rot=RZ90, nazev="P1 -Y3 ISO 6432 Ø16×50 patka do drážky + vidlice")
    m = [A, B, C]
    return {"format": "pro3d-lib-plan", "verze": 1, "generator": GEN, "model": "Lavice_P1", "nazev": "Zkušební deska modulu P1",
            "profil": {"kod": "104040L", "delka": delka, "label": f"Profil ALUTEC 104040L 40×40×{delka:g} (zkušební deska; průřez z kót katalogu)"},
            "dily": _uniq([s for x in m for s in x["dily"]]), "moduly": m}


def write_rozhrani(plan: dict, folder: Path) -> list[str]:
    folder.mkdir(parents=True, exist_ok=True)
    out = []
    for m in plan["moduly"]:
        if "rozhrani" in m:
            p = folder / f"P1_{m['tag'].lstrip('-')}.json"
            p.write_text(json.dumps(m["rozhrani"], ensure_ascii=False, indent=1), encoding="utf-8")
            out.append(str(p))
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Modul P1 — pneumatický válec s upevněním (plán; volitelně FreeCAD + kontroly)")
    ap.add_argument("--tag", default="-Y1")
    ap.add_argument("--norma", default="ISO 15552", choices=["ISO 15552", "ISO 6432"])
    ap.add_argument("--prumer", type=int, help="Ø válce (bez = zkušební deska se 3 variantami)")
    ap.add_argument("--zdvih", type=int, default=100)
    ap.add_argument("--upevneni", choices=["patky", "priruba", "patka"], help="výchozí patky (ISO 6432 přední patka)")
    ap.add_argument("--pistnice", default="nic", choices=["nic", "kloub", "vidlice"])
    ap.add_argument("--kotveni", choices=["deska", "uhelnik", "drazka"], help="výchozí adaptérová deska (ISO 6432 drážka)")
    ap.add_argument("--profil", type=int, choices=[40, 80], help="deska do profilu 40 / 80 (výchozí 80, když ho rám má)")
    ap.add_argument("--profily-ramu", default="", help="šířky profilů rámu oddělené čárkou, např. 40,80")
    ap.add_argument("--grla", action="store_true", help="GRLA místo QS v přípojkách (jen kde je doložené)")
    ap.add_argument("--plan", help="uložit plán JSON")
    ap.add_argument("--rozhrani", help="složka pro P1_<tag>.json")
    ap.add_argument("--fc", help="složka: postavit ve FreeCADu (slot pro3d-p1-test) a spustit kontroly")
    a = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
    if a.prumer:
        m = modul(a.tag, a.norma, a.prumer, a.zdvih, a.upevneni, a.pistnice, a.kotveni, grla=a.grla, profil=a.profil,
                  profily_ramu=[int(x) for x in a.profily_ramu.split(",") if x.strip()])
        plan = {"format": "pro3d-lib-plan", "verze": 1, "generator": GEN, "model": "Lavice_P1", "nazev": "Modul P1",
                "profil": {"kod": "104040L", "delka": 400.0, "label": "Profil ALUTEC 104040L 40×40×400"}, "dily": _uniq(m["dily"]),
                "moduly": [m]}
    else:
        plan = lavice_p1()
    for m in plan["moduly"]:
        s = m["rozhrani"]["sily"]
        print(f"{m['nazev']}: F ven {s['F_ven_10bar_N']:g} N / zpět {s['F_zpet_10bar_N']:g} N při 10 bar, moment {s['M_kotveni_10bar_Nm']:g} N·m")
        for t in m["kontrola"]["srouby"][:3]:
            print("  ", t)
        for v in m["varovani"]:
            print("  VAROVÁNÍ:", v)
    if a.plan:
        Path(a.plan).write_text(json.dumps(plan, ensure_ascii=False, indent=1), encoding="utf-8")
    if a.rozhrani:
        print("\n".join(write_rozhrani(plan, Path(a.rozhrani))))
    if a.fc:
        from . import bench
        write_rozhrani(plan, Path(a.fc))
        res = bench.build_and_check(plan, Path(a.fc), slot="pro3d-p1-test", vysunuto=True)
        print(json.dumps(res.get("souhrn", res), ensure_ascii=False, indent=1))
        return 0 if res.get("ok") else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

