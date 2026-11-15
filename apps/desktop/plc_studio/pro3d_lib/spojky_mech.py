"""Spojka V4 mechanická — kotvení modulu k rámu (čistý Python, bez FreeCADu; staví ``fc_lib.py``).

Co umí: díra s vůlí (ISO 273), podélný otvor pro seřízení, šroub ISO 4762 + matice T do drážky profilu ALUTEC (délka
šroubu podle požadavku zašroubování a dna drážky), šroub do závitu dílu (délka podle materiálu). Požadavek zašroubování
je TENTÝŽ, který kontroluje ``pro3d_tools`` (``rules.posud_sroub``): závit ≥ max(k·d, 3 mm), matice = celá výška matice
(≤ max(d, 3)). Data a zdroje: ``data/spojky_mech.json``; šrouby a matice ISO z ``pro3d_parts/data/normalie.json``
(neopisují se — díly staví ``pro3d_parts/fc_parts.py``).

Popis tělesa (sdílený s ``fc_lib``): ``{"add": [prim…], "cut": [prim…]}``, prim = ``{"box": [x0,x1,y0,y1,z0,z1]}`` |
``{"cyl": {"p": [x,y,z], "d": [dx,dy,dz], "r": r, "h": h}}`` | ``{"slot": {"p1": [x,y,z], "p2": [x,y,z], "r": r, "h": h}}``
(podélný otvor, osa Z, od z do z + h) | ``{"prism_x": {"pts": [[y,z]…], "x0": a, "x1": b}}`` (mnohoúhelník v rovině YZ
vysunutý podél X)."""

from __future__ import annotations

import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = json.loads((HERE / "data" / "spojky_mech.json").read_text(encoding="utf-8"))
NORM = json.loads((HERE.parent / "pro3d_parts" / "data" / "normalie.json").read_text(encoding="utf-8"))


def _d(m: str) -> float:
    return float(str(m).upper().lstrip("M"))


def otvor_vule(m: str, rada: str = "m") -> float:
    """Průměr průchozí díry pro šroub ``m`` (ISO 273, řada f / m / c)."""
    return float(DATA["iso273"][rada][m.upper()])


def min_zasroubovani(d: float, mat: str = "ocel") -> float:
    z = DATA["zasroubovani"]
    return max(z["k"].get(mat, 1.0) * d, z["min_mm"])


def potreba_matice(d: float, h_matice: float) -> float:
    """Požadovaná délka dříku v matici — jako ``rules.posud_sroub``: min(výška matice, max(d, 3))."""
    return min(h_matice, max(d, DATA["zasroubovani"]["min_mm"]))


def delky() -> list[int]:
    return list(DATA["delky_iso4762"]["l"])


def podelny_otvor(m: str, serizeni: float | None = None, rada: str = "m") -> dict:
    """Podélný otvor pro seřízení ± ``serizeni``: šířka = díra s vůlí, délka = šířka + 2 × seřízení."""
    s = DATA["podelny_otvor"]["serizeni_mm"] if serizeni is None else float(serizeni)
    w = otvor_vule(m, rada)
    return {"sirka": w, "delka": w + 2 * s, "serizeni": s, "rozteč_stredu": 2 * s}


def matice_t(m: str, drazka: str = "40/8") -> dict:
    """Matice T (s pružinou) do drážky: rozměry a průřez. Souřadnice matice: osa šroubu = osa Z v (0, 0), horní plocha
    matice z = 0 (dosedá na spodek rtů), tělo dolů; délka podél drážky (X) ``L``. Průřez: horní obdélník šířky B a výšky
    H_horni, pod ním zkosení rovnoběžné s boky drážky (s vůlí), závitová díra Ø d − P (konvence pro3d_parts)."""
    mt = DATA["matice_t"][drazka]
    dz = DATA["drazky"][drazka]
    d = _d(m)
    P = NORM["ISO4762"]["rady"][m.upper()]["P"]
    B, Hh, H, vb = mt["B"], mt["H_horni"], mt["H_model"], mt["vule_bok"]
    sl = (dz["sirka_pod_rty"] - dz["otvor"]) / 2 / (dz["hloubka"] - dz["ret"])   # zúžení boku drážky na mm hloubky
    w_bottom = B / 2 - sl * (H - Hh)
    # kontrola vejití do drážky (hloubka pod povrchem profilu = ret + h)
    probl = []
    for h, half in ((0.0, B / 2), (Hh, B / 2), (H, w_bottom)):
        cav = dz["sirka_pod_rty"] / 2 - sl * h
        if half > cav - 1e-6 and h > 0:
            probl.append(f"matice T {m} v hloubce {dz['ret'] + h:.1f}: polovina šířky {half:.2f} > drážka {cav:.2f}")
    if w_bottom < (d - P) / 2 + 1.0:
        probl.append(f"matice T {m}: dno matice {2 * w_bottom:.1f} mm užší než díra Ø {d - P:.1f} + 2 mm")
    pts = [[-B / 2, 0.0], [B / 2, 0.0], [B / 2, -Hh], [w_bottom, -H], [-w_bottom, -H], [-B / 2, -Hh]]
    info = mt.get(m.upper(), {})
    return {"m": m.upper(), "d": d, "P": P, "L": mt["L"], "B": B, "H": H, "H_katalog": mt["H_katalog"], "tap": d - P,
            "kod": info.get("kod", ""), "druh": info.get("druh", "matice T"), "drazka": drazka, "problemy": probl,
            "body": {"add": [{"prism_x": {"pts": pts, "x0": -mt["L"] / 2, "x1": mt["L"] / 2}}],
                     "cut": [{"cyl": {"p": [0, 0, -H - 1], "d": [0, 0, 1], "r": (d - P) / 2, "h": H + 2}}]},
            "zdroj": mt["_zdroj"], "odhad": mt["_odhad"]}


def delka_do_drazky(m: str, t_upinany: float, drazka: str = "40/8", podlozka: bool = False) -> dict:
    """Délka šroubu ISO 4762 do matice T v drážce: dřík projde upínaným dílem (+ podložkou), rtem drážky a CELOU
    maticí (požadavek ``potreba_matice``), konec nejméně ``rezerva_dna`` nad dnem drážky. Vrací nejkratší normalizovanou
    délku, nebo ok = False s důvodem."""
    d = _d(m)
    dz = DATA["drazky"][drazka]
    mt = matice_t(m, drazka)
    hw = NORM["ISO7089"]["rady"][m.upper()]["h"] if podlozka else 0.0
    nad = hw + t_upinany                                   # od dosedu hlavy k povrchu profilu
    need = potreba_matice(d, mt["H"])
    lmin = nad + dz["ret"] + need                          # konec dříku nejméně na spodku potřebné délky v matici
    lmin = max(lmin, nad + dz["ret"] + mt["H"])            # projít celou maticí (spodní hrana matice)
    lmax = nad + dz["hloubka"] - DATA["rezerva_dna_mm"]["hodnota"]
    for l in delky():
        if lmin - 1e-6 <= l <= lmax + 1e-6:
            tip = l - nad
            return {"ok": True, "m": m.upper(), "l": l, "podlozka": podlozka, "nad_povrchem": nad, "hloubka_konce": tip,
                    "v_matici": min(l - nad - dz["ret"], mt["H"]), "potreba": need, "lmin": lmin, "lmax": lmax,
                    "text": f"ISO 4762 {m.upper()}x{l}: v matici {min(l - nad - dz['ret'], mt['H']):.1f} ≥ {need:.1f} mm, "
                            f"konec {tip:.1f} mm pod povrchem (dno {dz['hloubka']})"}
    return {"ok": False, "m": m.upper(), "l": None, "podlozka": podlozka, "lmin": lmin, "lmax": lmax,
            "text": f"{m.upper()}: žádná normalizovaná délka v ⟨{lmin:.1f}; {lmax:.1f}⟩ (upínaný díl {t_upinany} mm"
                    f"{' + podložka' if podlozka else ''})"}


def delka_do_drazky_auto(m: str, t_upinany: float, drazka: str = "40/8") -> dict:
    """Nejdřív s podložkou ISO 7089, když se délka nenajde, bez ní (hlava ISO 4762 dosedne přímo)."""
    r = delka_do_drazky(m, t_upinany, drazka, podlozka=True)
    return r if r["ok"] else delka_do_drazky(m, t_upinany, drazka, podlozka=False)


def delka_do_zavitu(m: str, t_upinany: float, t_zavit: float, mat: str = "ocel", pruchozi: bool = True) -> dict:
    """Délka šroubu do závitu dílu tloušťky ``t_zavit`` (materiál ``mat``): dřík v závitu ≥ min_zasroubovani; průchozí
    závit dovolí přesah konce nejvýš 1 stoupání + 2 mm (ODHAD), slepý závit nesmí na dno."""
    d = _d(m)
    need = min_zasroubovani(d, mat)
    if t_zavit + 0.2 < need:
        return {"ok": False, "m": m.upper(), "l": None, "potreba": need,
                "text": f"{m.upper()}: závit v {t_zavit} mm ({mat}) < požadavek {need:.1f} mm — silnější díl / matice / vložka"}
    P = NORM["ISO4762"]["rady"][m.upper()]["P"]
    lmin = t_upinany + need
    lmax = t_upinany + t_zavit + (P + 2.0 if pruchozi else -0.5)
    for l in delky():
        if lmin - 0.2 <= l <= lmax + 1e-6:
            return {"ok": True, "m": m.upper(), "l": l, "potreba": need, "v_zavitu": min(l - t_upinany, t_zavit),
                    "text": f"ISO 4762 {m.upper()}x{l}: v závitu {min(l - t_upinany, t_zavit):.1f} ≥ {need:.1f} mm ({mat})"}
    return {"ok": False, "m": m.upper(), "l": None, "potreba": need,
            "text": f"{m.upper()}: žádná normalizovaná délka v ⟨{lmin:.1f}; {lmax:.1f}⟩"}


def spec_sroub(m: str, l: float) -> dict:
    """Spec pro ``pro3d_parts/fc_parts.py`` (generátor ``sroub_4762``) — díl se jen staví, rozměry z normalie.json."""
    r = NORM["ISO4762"]
    p = dict(r["rady"][m.upper()], d=_d(m), l=float(l))
    return {"key": f"ISO4762_{m.upper()}x{l:g}", "gen": "sroub_4762", "params": p, "nazev": f"ISO 4762 {m.upper()}x{l:g}",
            "zdroj": [r["zdroj"]], "zdroj_popis": r["zdroj_popis"], "detail": "tvar", "typ": "sroub", "material": "ocel 8.8",
            "poznamka": ""}


def spec_podlozka(m: str) -> dict:
    r = NORM["ISO7089"]
    return {"key": f"ISO7089_{m.upper()}", "gen": "podlozka", "params": dict(r["rady"][m.upper()]),
            "nazev": f"Podložka ISO 7089 {m.upper()}", "zdroj": [r["zdroj"]], "zdroj_popis": r["zdroj_popis"],
            "detail": "tvar", "typ": "podlozka", "material": "ocel", "poznamka": ""}


def spec_matice_t(m: str, drazka: str = "40/8") -> dict:
    """Matice T — díl pro ``fc_lib`` (vlastní generátor ``matice_t``, tělo z ``matice_t``)."""
    mt = matice_t(m, drazka)
    return {"key": f"MaticeT_{drazka.replace('/', '-')}_{m.upper()}", "gen": "lib_body", "body": mt["body"],
            "nazev": f"Matice T {m.upper()} drážka {drazka} ALUTEC {mt['kod']}".strip(), "zdroj": [mt["zdroj"]],
            "detail": "tvar zjednodušen (boky podle drážky, výška ODHAD)", "typ": "matice", "material": "ocel Zn",
            "poznamka": mt["odhad"]}


def sroub_do_drazky(m: str, x: float, y: float, z_povrch: float, t_upinany: float, drazka: str = "40/8") -> dict:
    """Šroub + (podložka) + matice T v drážce, jejíž osa leží v (x, y) na povrchu profilu ``z_povrch`` (drážka podél X,
    otevřená nahoru). Vrací {ok, delka, dily: [spec…], instance: [{model, pos, rot}…], text}."""
    dl = delka_do_drazky_auto(m, t_upinany, drazka)
    if not dl["ok"]:
        return {"ok": False, "delka": dl, "dily": [], "instance": [], "text": dl["text"]}
    dz = DATA["drazky"][drazka]
    I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    sp_s, sp_n = spec_sroub(m, dl["l"]), spec_matice_t(m, drazka)
    z_hlava = z_povrch + t_upinany + (NORM["ISO7089"]["rady"][m.upper()]["h"] if dl["podlozka"] else 0.0)
    dily, inst = [sp_s, sp_n], [{"model": sp_s["key"], "pos": [x, y, z_hlava], "rot": I, "druh": "sroub"},
                                {"model": sp_n["key"], "pos": [x, y, z_povrch - dz["ret"]], "rot": I, "druh": "matice"}]
    if dl["podlozka"]:
        sp_w = spec_podlozka(m)
        dily.append(sp_w)
        inst.append({"model": sp_w["key"], "pos": [x, y, z_povrch + t_upinany], "rot": I, "druh": "podlozka"})
    return {"ok": True, "delka": dl, "dily": dily, "instance": inst, "text": dl["text"]}


def sroub_do_zavitu(m: str, pos, osa_dolu: bool, t_upinany: float, t_zavit: float, mat: str = "ocel") -> dict:
    """Šroub do závitu dílu; ``pos`` = dosed hlavy, dřík ve směru −Z (``osa_dolu``)."""
    dl = delka_do_zavitu(m, t_upinany, t_zavit, mat)
    if not dl["ok"]:
        return {"ok": False, "delka": dl, "dily": [], "instance": [], "text": dl["text"]}
    sp = spec_sroub(m, dl["l"])
    rot = [[1, 0, 0], [0, 1, 0], [0, 0, 1]] if osa_dolu else [[1, 0, 0], [0, -1, 0], [0, 0, -1]]
    return {"ok": True, "delka": dl, "dily": [sp], "instance": [{"model": sp["key"], "pos": list(pos), "rot": rot,
                                                                "druh": "sroub"}], "text": dl["text"]}


def zavit_otvor(m: str) -> float:
    """Průměr modelované závitové díry (Ø d − P — konvence pro3d_parts / kontrola zasunuti)."""
    return _d(m) - NORM["ISO4762"]["rady"][m.upper()]["P"]


def drazka(drazka: str = "40/8") -> dict:
    return dict(DATA["drazky"][drazka])


def sirka_dutiny(drazka_: str, hloubka: float) -> float:
    """Šířka dutiny drážky v hloubce pod povrchem (zástupný průřez: rty, pak zúžení k dnu)."""
    dz = DATA["drazky"][drazka_]
    if hloubka < dz["ret"] - 1e-9:
        return dz["otvor"]
    sl = (dz["sirka_pod_rty"] - dz["otvor"]) / (dz["hloubka"] - dz["ret"])
    return max(dz["otvor"], dz["sirka_pod_rty"] - sl * (hloubka - dz["ret"]))


# --- rozšíření pro moduly O1 / O2 (2026-11-03): libovolná osa šroubu, šroub + matice ISO 4032, boční drážka ----------

def rot_z_na(v) -> list:
    """Rotační matice, jejíž třetí sloupec (obraz osy Z modelu) je jednotkový vektor ``v``."""
    n = math.sqrt(sum(x * x for x in v))
    z = [x / n for x in v]
    a = [1.0, 0.0, 0.0] if abs(z[0]) < 0.9 else [0.0, 1.0, 0.0]
    x = [a[1] * z[2] - a[2] * z[1], a[2] * z[0] - a[0] * z[2], a[0] * z[1] - a[1] * z[0]]
    nx = math.sqrt(sum(c * c for c in x))
    x = [c / nx for c in x]
    y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]]
    return [[x[i], y[i], z[i]] for i in range(3)]


def _mm(A, B):
    return [[sum(A[i][k] * B[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def _mv(A, v):
    return [sum(A[i][j] * v[j] for j in range(3)) for i in range(3)]


def spec_matice_4032(m: str) -> dict:
    """Šestihranná matice ISO 4032 — díl pro ``pro3d_parts/fc_parts.py`` (generátor ``matice``; osa Z, z 0 … m,
    závitová díra Ø d − P jako ostatní závity pro3d_parts)."""
    r = NORM["ISO4032"]
    row = r["rady"][m.upper()]
    return {"key": f"ISO4032_{m.upper()}", "gen": "matice", "params": {"s": row["s"], "m": row["m"], "tap": _d(m) - row["P"],
                                                                     "P": row["P"]},
            "nazev": f"Matice ISO 4032 {m.upper()}", "zdroj": [r["zdroj"]], "zdroj_popis": r["zdroj_popis"], "detail": "tvar",
            "typ": "matice", "material": "ocel 8", "poznamka": ""}


def delka_s_matici(m: str, t_svirane: float) -> dict:
    """Délka ISO 4762 pro průchozí spoj s maticí ISO 4032: dřík projde sevřenými díly a celou maticí (požadavek
    kontroly = celá výška matice ≤ max(d, 3)), přečnívá ½ stoupání až 1 stoupání + 3 mm (ODHAD); nejkratší
    normalizovaná délka."""
    d = _d(m)
    row = NORM["ISO4032"]["rady"][m.upper()]
    lmin = t_svirane + row["m"] + 0.5 * row["P"]
    lmax = t_svirane + row["m"] + row["P"] + 3.0
    for l in delky():
        if lmin - 1e-6 <= l <= lmax + 1e-6:
            return {"ok": True, "m": m.upper(), "l": l, "v_matici": row["m"], "potreba": potreba_matice(d, row["m"]),
                    "prechod": round(l - t_svirane - row["m"], 2),
                    "text": f"ISO 4762 {m.upper()}x{l} + matice ISO 4032 {m.upper()}: sevřeno {t_svirane:g} mm, přesah "
                            f"{l - t_svirane - row['m']:.1f} mm za maticí"}
    return {"ok": False, "m": m.upper(), "l": None, "text": f"{m.upper()}: žádná normalizovaná délka v ⟨{lmin:.1f}; {lmax:.1f}⟩"}


def sroub_s_matici(m: str, hlava, smer, t_svirane: float, podlozka: bool = True) -> dict:
    """Průchozí šroub ISO 4762 (+ podložka ISO 7089 pod hlavou) a matice ISO 4032 na druhé straně. ``hlava`` = bod na
    povrchu sevřeného dílu pod hlavou (podložkou), ``smer`` = směr dříku. Vrací {ok, dily, instance, text, delka}."""
    hw = NORM["ISO7089"]["rady"][m.upper()]["h"] if podlozka else 0.0
    dl = delka_s_matici(m, t_svirane + hw)
    if not dl["ok"]:
        return {"ok": False, "delka": dl, "dily": [], "instance": [], "text": dl["text"]}
    n = math.sqrt(sum(x * x for x in smer))
    s = [x / n for x in smer]
    R_s = rot_z_na([-x for x in s])                  # model sroub_4762: hlava nad z = 0, dřík do −Z
    R_n = rot_z_na(s)                               # matice / podložka z 0 … h ve směru dříku
    sp_s, sp_n = spec_sroub(m, dl["l"]), spec_matice_4032(m)
    p_h = [hlava[i] - s[i] * hw for i in range(3)]     # dosed hlavy na podložku
    p_n = [hlava[i] + s[i] * t_svirane for i in range(3)]
    dily = [sp_s, sp_n]
    inst = [{"model": sp_s["key"], "pos": p_h, "rot": R_s, "druh": "sroub"},
            {"model": sp_n["key"], "pos": p_n, "rot": R_n, "druh": "matice"}]
    if podlozka:
        sp_w = spec_podlozka(m)
        dily.append(sp_w)
        inst.append({"model": sp_w["key"], "pos": p_h, "rot": R_n, "druh": "podlozka"})
    return {"ok": True, "delka": dl, "dily": dily, "instance": inst, "text": dl["text"]}


def sroub_do_drazky_r(m: str, bod, R, t_upinany: float, drazka: str = "40/8") -> dict:
    """``sroub_do_drazky`` v obecné poloze: ``bod`` = osa drážky na povrchu profilu, ``R`` = matice místních os → globální
    (místní Z = vnější normála plochy profilu, místní X = podél drážky). Použití: boční drážka profilu (úhelník)."""
    r = sroub_do_drazky(m, 0.0, 0.0, 0.0, t_upinany, drazka)
    if not r["ok"]:
        return r
    for it in r["instance"]:
        it["pos"] = [bod[i] + v for i, v in enumerate(_mv(R, it["pos"]))]
        it["rot"] = _mm(R, it["rot"])
    return r


# boční plocha profilu 40 × 40 podél X: vnější normála +Y, drážka podél X (místní X → X, místní Y → −Z, místní Z → +Y)
R_BOK_PLUS_Y = [[1, 0, 0], [0, 0, 1], [0, -1, 0]]


__all__ = [n for n in dir() if not n.startswith("_") and n not in ("json", "math", "Path", "annotations")]
