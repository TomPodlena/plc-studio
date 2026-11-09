"""Modul E1 — stojan / konzola rozvaděče (čistý Python: plán, výška skříně, smlouva ``E1_<id>.json``; FreeCAD: ``fc_lib.py``).

Skříň a výbava jsou z ``pro3d_cabinet`` (``rozvadec/layout.json`` + ``rozvadec/Rozvadec.FCStd`` — App::Link na kořen
``Rozvadec``), modul E1 jen řeší, KDE skříň visí / stojí a ČÍM je přišroubovaná:

* **konzola na rám N1** (``konzola_n1``): dva svislé sloupky 40 × 40 přiložené k vnějšímu líci rámu (zadní / přední strana)
  — kříží podélník horního věnce a spodní příčku x; spoj = šroub ISO 4762 M8 skrz sloupek (stupňovitá díra 13,5 / 8,5)
  do matice T v drážce rámu (V4, délka ``spojky_mech.delka_do_drazky``); mezi sloupky příčky 40 × 40 (úhelníky 303876
  nahoře / dole jako N1): **C1 / C2** nesou skříň (šrouby ISO 4762 M6 + podložka zevnitř skříně zadní stěnou do matic T
  v drážce příčky), **C0** pod skříní nese úchytky kabelů E2 (svazek do vývodek ve dně);
* **samostatný stojan** (``stojan``): rám ``modul_ram`` bez desky s patkami (D × W = šířka skříně + 160 × hloubka skříně),
  skříň stojí na horním věnci (šrouby M6 dnem do drážek podélníků), vývodky dnem mezi podélníky.

Výška skříně (``vyska_skrine``): nejnižší ``z_b`` (po 10 mm), při které platí EN 60204-1 čl. 11.2.1 (skill rozvadec-3d,
[ověřeno] přes JIS B 9960-1): přístroje k údržbě 0,4–2,0 m nad úrovní obsluhy, svorky ≥ 0,2 m; rukojeť hlavního vypínače
na dveřích 0,6–1,9 m (IEC 60204-1 čl. 5.3.4 — ve skillu NENÍ, z paměti = [neověřeno], doporučení ≤ 1,7 m) a místo pod
skříní pro ohyb kabelů do vývodek (poloměr média ze skillu kabelaz-a-hadice) nad příčkou rámu.

Upevnění skříně Rittal AX: otvory zadní stěny / dna pro šrouby ze skříně NEJSOU doloženy (datový list v katalogu PLCdesk je
neuvádí) → poloha a Ø = ODHAD (v modelu je vyřízne ``pro3d_cabinet`` z ``layout.json hw.rear_holes / floor_holes``,
``upravit_skrin``). Hmotnost skříně s výbavou = ODHAD (``M_SKRIN_KG``) — síly ve smlouvě jsou orientační.

CLI: ``python -m plc_studio.pro3d_lib.modul_stojan_rozvadece <layout.json> [--varianta konzola|stojan] [--rozhrani SLOŽKA]``
(konzola na vzorový rám N1 800 × 600 × 800)."""

from __future__ import annotations

import argparse
import json
import re
import math
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    __package__ = "plc_studio.pro3d_lib"

from . import modul_ram, spojky_mech  # noqa: E402
from .modul_ram import _lib, add, cols, r3  # noqa: E402

GEN = "pro3d_lib/modul_stojan_rozvadece"
A = 40.0
I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
RZ180 = [[-1, 0, 0], [0, -1, 0], [0, 0, 1]]
G = 9.81
VYSKY = {
    "udrzba": {"min": 400.0, "max": 2000.0, "zdroj": "EN 60204-1 čl. 11.2.1 (skill rozvadec-3d references/normy.md, [ověřeno] — JIS B 9960-1)",
               "text": "přístroje k údržbě / seřízení 0,4–2,0 m nad úrovní obsluhy"},
    "svorky": {"min": 200.0, "zdroj": "EN 60204-1 čl. 11.2.1 (skill rozvadec-3d, [ověřeno])", "text": "svorky doporučeno ≥ 0,2 m"},
    "vypinac": {"min": 600.0, "max": 1900.0, "doporuceno_max": 1700.0,
                "zdroj": "IEC 60204-1 čl. 5.3.4 — [neověřeno]: ve skillech rozvadec-3d / plc-rizeni není, hodnota z paměti; ověřit v platném znění",
                "text": "rukojeť odpojovače napájení 0,6–1,9 m (doporučeno ≤ 1,7 m)"},
}
M_SKRIN_KG = 25.0          # ODHAD — skříň AX + montážní deska + přístroje (hmotnosti nejsou v manifestu)
GLAND_DROP = 28.0          # vývodka SKINTOP pod dnem (pro3d_cabinet fc_cabinet: šestihran C − D = 37 − 9)
DIRA_SKRINE = "M6"         # šrouby skříně zevnitř (ODHAD — otvory Rittal AX nedoloženy)


# --- skříň z pro3d_cabinet -------------------------------------------------------------------------------------------
def nacti_skrin(layout_path: str | Path, fcstd: str | Path | None = None) -> dict:
    """Údaje skříně z ``rozvadec/layout.json`` (souřadnice skříně: x zleva při pohledu zepředu, y k dveřím, z nahoru,
    počátek zadní spodní levý roh) — rozměry, vývodky, výšky přístrojů a hlavního vypínače."""
    lp = Path(layout_path)
    L = json.loads(lp.read_text(encoding="utf-8"))
    cab = L["cabinet"]
    dev = [d for d in L.get("devices") or [] if d.get("box")]
    svorky = [d for d in dev if d.get("cat") in ("terminal_block",)]
    pristroje = [d for d in dev if d.get("cat") not in ("terminal_block", "end_stop")]
    door = (L.get("door") or {}).get("items") or []
    q0 = next((d for d in door if d.get("cat") == "main_switch" or str(d.get("tag")).startswith("-Q0")), None)
    fc = Path(fcstd) if fcstd else lp.parent / "Rozvadec.FCStd"
    return {
        "id": cab.get("id") or "+1:cabinet", "tag": cab.get("tag") or "+1", "typ": cab.get("typ"), "kod": cab.get("orderCode"),
        "brand": cab.get("brand"), "w": float(cab["w"]), "h": float(cab["h"]), "d": float(cab["d"]), "src": cab.get("src"),
        "stena": float((L.get("geom") or {}).get("stena", 1.5)), "plate": L.get("plate"), "studs": (L.get("hw") or {}).get("studs") or [],
        "glands": (L.get("hw") or {}).get("glands") or [], "door_axis": (L.get("hw") or {}).get("door_axis"),
        "z_pristroje": [min(d["box"][4] for d in pristroje), max(d["box"][5] for d in pristroje)] if pristroje else None,
        "z_svorky": min(d["box"][4] for d in svorky) if svorky else None,
        "z_vypinac": (q0["box"][4] + q0["box"][5]) / 2 if q0 and q0.get("box") else None,
        "z_hmi": (lambda h: (h["box"][4] + h["box"][5]) / 2 if h and h.get("box") else None)(
            next((d for d in door if d.get("cat") == "plc_hmi"), None)),
        "layout": str(lp.resolve()), "fcstd": str(fc.resolve()) if fc.is_file() else None,
    }


def vyska_kontrola(sk: dict, z_b: float) -> list[dict]:
    """Výšky nad úrovní obsluhy (podlaha z 0) při spodní hraně skříně ``z_b``."""
    out = []
    if sk.get("z_pristroje"):
        lo, hi = z_b + sk["z_pristroje"][0], z_b + sk["z_pristroje"][1]
        v = VYSKY["udrzba"]
        out.append({"co": "přístroje k údržbě", "z_mm": [round(lo, 1), round(hi, 1)], "pozadavek": [v["min"], v["max"]],
                    "ok": lo >= v["min"] - 1e-6 and hi <= v["max"] + 1e-6, "zdroj": v["zdroj"]})
    if sk.get("z_svorky") is not None:
        z = z_b + sk["z_svorky"]
        out.append({"co": "svorky", "z_mm": round(z, 1), "pozadavek": [VYSKY["svorky"]["min"], None], "ok": z >= VYSKY["svorky"]["min"] - 1e-6,
                    "zdroj": VYSKY["svorky"]["zdroj"]})
    if sk.get("z_vypinac") is not None:
        z = z_b + sk["z_vypinac"]
        v = VYSKY["vypinac"]
        out.append({"co": "rukojeť hlavního vypínače (dveře)", "z_mm": round(z, 1), "pozadavek": [v["min"], v["max"]],
                    "ok": v["min"] - 1e-6 <= z <= v["max"] + 1e-6, "doporuceno_max": v["doporuceno_max"],
                    "v_doporuceni": z <= v["doporuceno_max"], "zdroj": v["zdroj"]})
    if sk.get("z_hmi") is not None:
        out.append({"co": "střed HMI na dveřích (informace — ergonomie EN 894 neposouzena)", "z_mm": round(z_b + sk["z_hmi"], 1),
                    "pozadavek": None, "ok": True, "zdroj": "layout.json pro3d_cabinet"})
    return out


# --- konzola na rám N1 -----------------------------------------------------------------------------------------------
class Konzola(modul_ram.Ram):
    """Stavitel E1 (sdílí s N1 díly, úhelníky, šrouby do drážky a řezací seznam — ``modul_ram.Ram`` bez ``build``)."""

    def __init__(self, ident="E1", nazev=""):
        super().__init__(D=100, W=100, H=100, deska=False, zatizeni_kg=0.0, uhelniky=True, ident=ident, nazev=nazev or "E1 konzola rozvaděče")
        self.kod = "104040"

    def pruchozi_sroub(self, m_own, P0, d, bod_rama, along, label, M="M8"):
        """Šroub ISO 4762 ``M`` skrz profil ``m_own`` (tloušťka 40 ve směru ``d``) z vnějšího líce ``P0`` do matice T v drážce
        druhého profilu (líc v ``bod_rama``, normála ``-d``): stupňovitá díra 13,5 / 8,5 (jako dlouhý šroub ALUTEC), hloubka
        zahloubení zvolena tak, aby existovala normalizovaná délka do matice (V4) — ODHAD typu spoje (průchozí spoj)."""
        ds = modul_ram.DATA["dlouhy_sroub"]
        for c in [20.0 + 0.5 * k for k in range(0, 21)] + [20.0 - 0.5 * k for k in range(1, 11)]:
            dl = spojky_mech.delka_do_drazky(M, A - c, "40/8", podlozka=False)
            if dl["ok"]:
                break
        else:
            self.chyby.append(f"{label}: žádná délka šroubu {M} skrz profil do drážky")
            return None
        m_own["cuts"].append({"p": add(P0, d, -1.0), "d": d, "r": ds["zahloubeni"] / 2, "h": c + 1.0})
        m_own["cuts"].append({"p": add(P0, d, c - 0.01), "d": d, "r": spojky_mech.otvor_vule(M) / 2, "h": A - c + 0.6})
        m_own["opr"].append(f"stupňovitá díra {ds['zahloubeni']:g} × {spojky_mech.otvor_vule(M):g} hl. {c:g} (průchozí šroub)")
        self.odhady.add("průchozí šroub sloupku konzoly do drážky rámu (stupňovitá díra jako dlouhý šroub ALUTEC, hloubka zahloubení podle "
                        "délky šroubu do matice T) = ODHAD typu spoje — výrobce ho mezi spoji neuvádí")
        return self.nut_screw(M, bod_rama, along, [-x for x in d], A - c, False, label)


def _faces(n1_roz: dict, n: list) -> list[dict]:
    """VNĚJŠÍ líce rámu N1 s normálou ``n`` — podélník horního věnce a spodní příčka x (drážka podél x) v krajní rovině y."""
    out = [p for p in n1_roz.get("plochy") or [] if p.get("role") in ("podelnik", "spodni_x")
           and [round(v) for v in p["normala"]] == [round(v) for v in n]]
    if not out:
        return out
    ext = max(p["osa_od"][1] * n[1] for p in out)
    return [p for p in out if abs(p["osa_od"][1] * n[1] - ext) < 1e-6]


def _free_x(p: dict, x0: float, x1: float) -> bool:
    """Leží úsek x ⟨x0; x1⟩ v některém volném úseku drážky líce ``p``?"""
    a, s = p["osa_od"][0], p["smer"][0]
    for u0, u1 in p.get("volne_useky_mm") or []:
        lo, hi = sorted((a + s * u0, a + s * u1))
        if lo - 1e-6 <= x0 and x1 <= hi + 1e-6:
            return True
    return False


def vyska_skrine(sk: dict, z_min_kabel: float, R_kabel: float, z_start: float = 0.0) -> tuple[float, list]:
    """Nejnižší ``z_b`` (po 10 mm) pro výšky EN 60204-1 a místo pod skříní: dolní vodorovný úsek kabelů ≥ ``z_min_kabel``,
    ohyb R a rovný konec 25 mm do vývodky."""
    need = z_min_kabel + GLAND_DROP + 0.5 + R_kabel + 25.0
    z = max(z_start, math.ceil(need / 10.0) * 10.0)
    while z < 2000.0:
        k = vyska_kontrola(sk, z)
        if all(x["ok"] for x in k) and all(x.get("v_doporuceni", True) for x in k):
            return z, k
        z += 10.0
    return z, vyska_kontrola(sk, z)


def _cab_place(sk: dict, xc: float, y_back: float, z_b: float, n: list) -> dict:
    """Skříň zády k rámu: n = +y → identita, n = −y → otočení 180° kolem z. Vrací pos, rot a převod místní → globální."""
    if n[1] > 0:
        pos, R = [xc - sk["w"] / 2, y_back, z_b], I3
    else:
        pos, R = [xc + sk["w"] / 2, y_back, z_b], RZ180
    return {"pos": r3(pos), "rot": R}


def to_glob(pl: dict, p) -> list:
    R, o = pl["rot"], pl["pos"]
    return [o[i] + sum(R[i][j] * p[j] for j in range(3)) for i in range(3)]


def konzola_n1(sk: dict, n1_roz: dict, *, strana: str = "zadni", xc: float | None = None, z_b: float | None = None,
               R_kabel: float = 43.0, r_kabel: float = 2.15, ident: str = "E1", m_skrin_kg: float = M_SKRIN_KG) -> dict:
    """Konzola rozvaděče na vnější líc rámu N1 (smlouva ``n1_roz`` = ``N1_<id>.json``). Vrací {modul, rozhrani, nosna_lista,
    vyvodky, boxes, otvory_skrine}."""
    n = [0.0, 1.0, 0.0] if strana == "zadni" else [0.0, -1.0, 0.0]
    fs = _faces(n1_roz, n)
    if len(fs) < 2:
        raise ValueError(f"E1: rám N1 nemá na straně {strana} podélník i spodní příčku (líce s drážkou podél x)")
    y_f = fs[0]["osa_od"][1]
    D = float(n1_roz["rozmery"]["D"])
    xc = D / 2 if xc is None else float(xc)
    w, h, d = sk["w"], sk["h"], sk["d"]
    xu = [xc - w / 2 - A / 2, xc + w / 2 + A / 2]                 # osy sloupků (vně šířky skříně — vývodky u boků volné)
    for x in xu:                                                    # příčka může být dělená (prostřední noha): stačí kus, který sloupek míjí
        for p in fs:
            if p.get("role") != "spodni_x" and not _free_x(p, x - A / 2, x + A / 2):
                raise ValueError(f"E1: sloupek konzoly x {x:g} kříží obsazený úsek drážky {p['prvek']} (volné {p['volne_useky_mm']})")
        sp = [p for p in fs if p.get("role") == "spodni_x"]
        if sp and not any(_free_x(p, x - A / 2, x + A / 2) for p in sp):
            raise ValueError(f"E1: sloupek konzoly x {x:g} nemá volný úsek spodní příčky")
    z_slots = sorted(p["osa_od"][2] for p in fs)
    z_lo_slot, z_hi_slot = z_slots[0], z_slots[-1]
    k = Konzola(ident, f"E1 konzola rozvaděče {sk['tag']} na rám N1 ({strana} strana)")
    yc = y_f + n[1] * A / 2                                        # osa sloupků a příček (rovina konzoly)
    y_face_out = y_f + n[1] * A                                    # líc konzoly ke skříni
    # výška skříně: kabely pod skříní nad příčkou C0, ta nad spodní příčkou rámu (+ úhelník a hlavy šroubů)
    z_c0_bottom_min = z_lo_slot + A / 2 + 7.0 + 12.0 + 5.0
    z_low_min = z_c0_bottom_min + A + 8.0 + r_kabel + 0.5
    if z_b is None:
        z_b, vk = vyska_skrine(sk, z_low_min, R_kabel)
    else:
        vk = vyska_kontrola(sk, z_b)
    z_low = z_b - GLAND_DROP - 0.5 - R_kabel - 25.0               # vodorovný úsek kabelů pod skříní (nejvýš)
    z_low = math.floor(z_low)
    zc0_top = z_low - r_kabel - 0.5 - 8.0
    zc0 = zc0_top - A / 2
    if zc0 - A / 2 < z_c0_bottom_min - 1e-6:
        k.chyby.append(f"E1: pod skříní není místo pro příčku C0 a ohyb kabelů (z_b {z_b:g})")
    zc2, zc1 = z_b + 60.0, z_b + h - 60.0
    z_top = z_b + h
    z_bot = z_lo_slot - A / 2 - 10.0
    # sloupky
    ups = []
    for i, x in enumerate(xu):
        m = k.member("104040", A, A, z_top - z_bot, [x, yc, z_bot], [1, 0, 0], [0, 1, 0], [0, 0, 1], "sloupek_konzoly",
                     f"E1 sloupek konzoly {i + 1} (x {x:g})")
        ups.append(m)
        for p in fs:                                               # průchozí šrouby do drážek rámu
            if p.get("role") == "spodni_x" and not _free_x(p, x - A / 2, x + A / 2):     # dělená příčka: jen kus u sloupku
                continue
            zs = p["osa_od"][2]
            k.pruchozi_sroub(m, [x, y_face_out, zs], [-v for v in n], [x, y_f, zs], [1, 0, 0],
                             f"sloupek {i + 1} → {p['prvek']} (z {zs:g})")
    # příčky
    L = xu[1] - xu[0] - A
    cross = {}
    for nm, zc, uh in (("C1", zc1, ("top", "bot")), ("C2", zc2, ("top", "bot")), ("C0", zc0, ("bot",))):
        m = k.member("104040", A, A, L, [xu[0] + A / 2, yc, zc], [0, 1, 0], [0, 0, 1], [1, 0, 0], "pricka_konzoly",
                     f"E1 příčka {nm} (z {zc:g})")
        cross[nm] = m
        for side in uh:
            nz = 1.0 if side == "top" else -1.0
            k.uhelnik([xu[0] + A / 2, yc, zc + nz * A / 2], [0, 0, nz], [1, 0, 0], None, ups[0], f"příčka {nm} → sloupek 1 ({side})")
            k.uhelnik([xu[1] - A / 2, yc, zc + nz * A / 2], [0, 0, nz], [-1, 0, 0], None, ups[1], f"příčka {nm} → sloupek 2 ({side})")
    # záslepky volných čel sloupků (nahoře i dole)
    zs_ = modul_ram.DATA["zaslepka"]
    zk = k.dil(_lib("Zaslepka_224040", {"add": [{"box": [-A / 2, A / 2, -A / 2, A / 2, 0, zs_["t"]]}]}, "Záslepka ALUTEC 224040 PA6 (zástupná)",
                    zs_["zdroj"], "obálka", typ="prislusenstvi", material="PA6", pozn=zs_["pozn"], zastupny=True))
    k.odhady.add(zs_["pozn"])
    for x in xu:
        k.put(zk, [x, yc, z_top], I3, "zaslepka")
        k.put(zk, [x, yc, z_bot], [[1, 0, 0], [0, -1, 0], [0, 0, -1]], "zaslepka")
    # skříň + šrouby zadní stěnou do příček C1 / C2
    pl = _cab_place(sk, xc, y_face_out, z_b, n)
    otvory = []
    for zc in (zc2, zc1):
        for fx in (0.2, 0.8):
            xl = fx * w
            zl = zc - z_b
            gp = to_glob(pl, [xl, 0.0, zl])
            pod = spojky_mech.delka_do_drazky_auto(DIRA_SKRINE, sk["stena"]).get("podlozka", False)
            k.nut_screw(DIRA_SKRINE, [gp[0], y_face_out, zc], [1, 0, 0], n, sk["stena"], pod,
                        f"skříň {sk['tag']} → příčka {'C2' if zc == zc2 else 'C1'} (x {gp[0]:.0f})")
            otvory.append({"x": round(xl, 2), "z": round(zl, 2), "d": spojky_mech.otvor_vule(DIRA_SKRINE), "kde": "zadní stěna"})
    k.odhady.add(f"otvory zadní stěny skříně Ø{spojky_mech.otvor_vule(DIRA_SKRINE):g} pro {DIRA_SKRINE} v 0,2 / 0,8 šířky a 60 mm od dna / "
                 "stropu = ODHAD (upevňovací otvory Rittal AX nedoloženy) — vyvrtat podle konzoly, skříň přišroubovat PŘED montáží desky")
    k.odhady.add(f"hmotnost skříně s výbavou {m_skrin_kg:g} kg = ODHAD (síly ve smlouvě orientační)")
    k.finalize_members()
    inst = list(k.inst)
    cab_inst = None
    if sk.get("fcstd"):
        cab_inst = {"model": "Rozvadec", "soubor": sk["fcstd"], "objekt": "Rozvadec", "pos": pl["pos"], "rot": [r3(r) for r in pl["rot"]],
                    "druh": "rozvadec", "props": {"Konstrukce_Modul": "E1", "Konstrukce_Poznamka": "rozvaděč pro3d_cabinet (App::Link)"}}
        inst.append(cab_inst)
    tel = []
    if not cab_inst:                                               # bez modelu rozvaděče jen zástupná obálka (oranžová)
        b0, b1 = to_glob(pl, [0, 0, 0]), to_glob(pl, [w, d, h])
        tel.append({"name": "Skrin_obalka", "label": f"{sk['tag']} skříň {sk.get('kod')} — obálka (rozvaděč nepostaven)",
                    "body": {"add": [{"box": [min(b0[0], b1[0]), max(b0[0], b1[0]), min(b0[1], b1[1]), max(b0[1], b1[1]), b0[2], b1[2]]}]},
                    "props": {"Konstrukce_Typ": "dil", "PLCdesk_ModelStatus": "placeholder", "Konstrukce_Zastupny": True,
                              "PLCdesk_Id": sk["id"]}})
    vyv = []
    for g in sk["glands"]:
        p = to_glob(pl, [g["x"], g["y"], -GLAND_DROP])
        vyv.append({"name": g["name"], "bod": r3(p), "osa": [0, 0, 1], "svirani_mm": _svirani(g), "zdroj": g.get("zdroj")})
    # síly (orientačně, ODHAD hmotnosti): tíha na 4 šrouby, klopný moment těžiště d/2 před konzolou → tah horních šroubů
    Fg = m_skrin_kg * G
    e = d / 2.0
    F_tah = Fg * e / max(zc1 - zc2, 1.0) / 2.0
    e_u = e + A
    F_sl = Fg * e_u / max(z_hi_slot - z_lo_slot, 1.0) / 2.0
    roz = {
        "format": "plcdesk-pro-modul", "modul": "E1", "verze": 1, "id": ident, "generator": GEN, "varianta": "konzola_n1",
        "nazev": k.nazev, "skrin": {k_: sk.get(k_) for k_ in ("id", "tag", "typ", "kod", "brand", "w", "h", "d", "src", "layout", "fcstd")},
        "poloha_skrine": {"pos": pl["pos"], "rot": pl["rot"], "z_spodni_hrana": z_b, "z_horni_hrana": z_top,
                          "box": r3([min(to_glob(pl, [0, 0, 0])[0], to_glob(pl, [w, d, h])[0]), min(to_glob(pl, [0, 0, 0])[1], to_glob(pl, [w, d, h])[1]), z_b,
                                     max(to_glob(pl, [0, 0, 0])[0], to_glob(pl, [w, d, h])[0]), max(to_glob(pl, [0, 0, 0])[1], to_glob(pl, [w, d, h])[1]), z_top]),
                          "dvere": "od rámu ven" , "souradnice": "globální = rám N1 (x délka, y šířka, z nahoru, podlaha z 0)"},
        "vysky": vk,
        "vstupy_kabelu": vyv,
        "pod_skrini": {"z_kabelu_max": z_low, "R_kabelu": R_kabel, "pozn": "vodorovný úsek kabelů pod skříní ≤ z_kabelu_max (ohyb R + rovný konec "
                                                                              "25 mm do vývodky); úchytky na příčce C0"},
        "nosna_lista": {"nazev": "E1 příčka C0 (úchytky kabelů E2)", "osa_od": r3([xu[0] + A / 2, yc, zc0_top]), "osa_do": r3([xu[1] - A / 2, yc, zc0_top]),
                        "normala": [0, 0, 1], "drazka": "40/8", "volne_x": [xu[0] + A / 2 + 1.0, xu[1] - A / 2 - 1.0]},
        "kotveni": {"na_ram": [s for s in k.srouby if "→ podélník" in s["spoj"] or "→ spodní" in s["spoj"]],
                    "skrin": [s for s in k.srouby if s["spoj"].startswith("skříň")], "otvory_skrine": otvory,
                    "uhelniky": "303876 (zástupné) nahoře / dole u příček C1, C2; C0 jen dole (horní líc nese úchytky kabelů)"},
        "sily": {"m_skrin_kg": m_skrin_kg, "m_zdroj": "ODHAD", "F_tiha_N": round(Fg, 1), "F_strih_na_sroub_skrine_N": round(Fg / 4, 1),
                 "F_tah_horni_sroub_skrine_N": round(F_tah, 1), "F_tah_horni_sroub_konzoly_N": round(F_sl, 1),
                 "pozn": "klopný moment těžiště skříně (d/2 před konzolou) rozdělen na 2 horní šrouby; únosnost spojů výrobce neuvádí "
                         "(spoje.md §0) — síly jsou malé proti M6 / M8, ale nejsou ověřeny"},
        "pozadavky_N1": [{"co": f"průchozí šroub sloupku E1 do drážky {p['prvek']}", "x": [round(x, 1) for x in xu], "z": p["osa_od"][2],
                          "pozn": "úsek drážky musí zůstat volný"} for p in fs],
        "montazni_poradi": ["1 sloupky konzoly přiložit k rámu, matice T do drážek rámu, průchozí šrouby M8 (klíč SW6 zvenku)",
                            "2 příčky C0 / C1 / C2 úhelníky mezi sloupky", "3 skříň: vyvrtat otvory zadní stěny podle příček, vyjmout montážní "
                            "desku, přišroubovat skříň zevnitř M6 do matic T příček, desku vrátit", "4 kabely E2 vývodkami ve dně, úchytky na C0",
                            "5 záslepky čel sloupků"],
        "rezaci_seznam": [{"profil": m["kod"], "delka_mm": round(m["L"], 1), "role": m["role"], "oznaceni": m["nazev"],
                           "opracovani": "; ".join(sorted(set(m["opr"]))) or "bez opracování"} for m in k.members],
        "spojovaci_material": k._bom(),
        "odhady": sorted(k.odhady), "chyby": k.chyby, "varovani": [f"{x['co']}: {x['z_mm']} mimo {x['pozadavek']}" for x in vk if not x["ok"]],
        "zdroje": sorted(k.zdroje | {VYSKY["udrzba"]["zdroj"], VYSKY["vypinac"]["zdroj"]}),
    }
    mod = {"typ": "E1 konzola rozvaděče", "tag": ident, "nazev": k.nazev, "dily": list(k.dily.values()), "instance": inst, "telesa": tel,
           "kabely": [], "skupiny": [], "props": {"Konstrukce_Generator": GEN, "Konstrukce_Modul": "E1", "PLCdesk_Id": f"asm:{ident}"}}
    boxes = [m["box"] for m in k.members] + [b for _n, b in k.boxes_extra] + [roz["poloha_skrine"]["box"]]
    return {"modul": mod, "rozhrani": roz, "boxes": boxes, "otvory_skrine": otvory, "kontrola": {"srouby": k.srouby, "chyby": k.chyby}}


def _svirani(g: dict) -> list | None:
    """Svírací rozsah vývodky SKINTOP ST-M z normálií pro3d_parts (M16 4–10, M20 6–13, M25 8–17 mm)."""
    try:
        nm = json.loads((Path(__file__).resolve().parents[1] / "pro3d_parts" / "data" / "normalie.json").read_text(encoding="utf-8"))
        r = (nm.get("SKINTOP_ST-M") or {}).get("rady", {}).get(f"M{int(g['thread'])}") or {}
        if r.get("svirani"):
            return r["svirani"]
    except (OSError, ValueError, KeyError):
        pass
    return {16: [4.0, 10.0], 20: [6.0, 13.0], 25: [8.0, 17.0]}.get(int(g.get("thread") or 0))


# --- samostatný stojan -----------------------------------------------------------------------------------------------
def stojan(sk: dict, *, pos=(0.0, 0.0), z_b: float | None = None, R_kabel: float = 43.0, ident: str = "E1",
           m_skrin_kg: float = M_SKRIN_KG) -> dict:
    """Samostatný stojan: rám ``modul_ram`` bez desky s patkami, šířka skříně + 160 (příčníky věnce mimo vývodky u boků),
    hloubka skříně; skříň stojí na podélnících (šrouby M6 dnem do drážek). Výška věnce = ``z_b`` (výšky EN 60204-1 a místo
    pro ohyb kabelů zespodu). Stabilita: klopná síla na horní hraně = ODHAD → kotvit k podlaze."""
    if z_b is None:
        z_b, vk = vyska_skrine(sk, 300.0, R_kabel)
    else:
        vk = vyska_kontrola(sk, z_b)
    Dst, Wst = sk["w"] + 160.0, sk["d"]
    pr = modul_ram.plan_ramu(D=Dst, W=Wst, H=z_b, deska=False, podpory="patky", zatizeni_kg=m_skrin_kg, ident=ident,
                             z_spodni=max(60.0, min(150.0, z_b - 300.0)),
                             nazev=f"E1 stojan rozvaděče {sk['tag']} {Dst:g} × {Wst:g} × {z_b:g}")
    mod = pr["moduly"][0]
    mod["props"] = {"Konstrukce_Generator": GEN, "Konstrukce_Modul": "E1", "PLCdesk_Id": f"asm:{ident}"}
    mod["typ"] = "E1 stojan rozvaděče"
    x0, y0 = float(pos[0]), float(pos[1])
    mod["placement"] = {"pos": [x0, y0, 0.0], "rot": I3}
    pl = {"pos": [x0 + 80.0, y0, z_b], "rot": I3}
    srouby, otvory, dily = [], [], []
    for xl in (0.2 * sk["w"], 0.8 * sk["w"]):
        for yl in (A / 2, Wst - A / 2):
            dl = spojky_mech.delka_do_drazky_auto(DIRA_SKRINE, sk["stena"])
            sp_s, sp_n = spojky_mech.spec_sroub(DIRA_SKRINE, dl["l"]), spojky_mech.spec_matice_t(DIRA_SKRINE)
            dily += [sp_s, sp_n]
            hw = modul_ram.NORM["ISO7089"]["rady"][DIRA_SKRINE]["h"] if dl["podlozka"] else 0.0
            gp = [80.0 + xl, yl, z_b]
            mod["instance"] += [{"model": sp_s["key"], "pos": r3(add(gp, [0, 0, 1], sk["stena"] + hw)), "rot": I3, "druh": "sroub", "props": {}},
                                {"model": sp_n["key"], "pos": r3(add(gp, [0, 0, 1], -spojky_mech.drazka()["ret"])), "rot": I3, "druh": "matice", "props": {}}]
            if dl["podlozka"]:
                sp_w = spojky_mech.spec_podlozka(DIRA_SKRINE)
                dily.append(sp_w)
                mod["instance"].append({"model": sp_w["key"], "pos": r3(add(gp, [0, 0, 1], sk["stena"])), "rot": I3, "druh": "podlozka", "props": {}})
            srouby.append({"spoj": f"skříň dnem → podélník stojanu (x {xl:.0f})", "sroub": f"ISO 4762 {DIRA_SKRINE}x{dl['l']}", "text": dl["text"]})
            otvory.append({"x": round(xl, 2), "y": round(yl, 2), "d": spojky_mech.otvor_vule(DIRA_SKRINE), "kde": "dno"})
    have = {d["key"] for d in mod["dily"]}
    mod["dily"] += [d for d in dily if d["key"] not in have and not have.add(d["key"])]
    if sk.get("fcstd"):
        mod["instance"].append({"model": "Rozvadec", "soubor": sk["fcstd"], "objekt": "Rozvadec", "pos": r3([80.0, 0.0, z_b]), "rot": I3, "druh": "rozvadec",
                                "props": {"Konstrukce_Modul": "E1"}})
    h_tot = z_b + sk["h"]
    F_klop = m_skrin_kg * G * (Wst / 2) / h_tot
    vyv = [{"name": g["name"], "bod": r3([x0 + 80.0 + g["x"], y0 + g["y"], z_b - GLAND_DROP]), "osa": [0, 0, 1], "svirani_mm": _svirani(g)}
           for g in sk["glands"]]
    roz = {"format": "plcdesk-pro-modul", "modul": "E1", "verze": 1, "id": ident, "generator": GEN, "varianta": "stojan",
           "nazev": mod["nazev"], "skrin": {k_: sk.get(k_) for k_ in ("id", "tag", "typ", "kod", "w", "h", "d", "src", "layout", "fcstd")},
           "poloha_skrine": {"pos": r3([x0 + 80.0, y0, z_b]), "rot": I3, "z_spodni_hrana": z_b, "z_horni_hrana": h_tot,
                             "box": r3([x0 + 80.0, y0, z_b, x0 + 80.0 + sk["w"], y0 + sk["d"], h_tot])},
           "vysky": vk, "vstupy_kabelu": vyv, "ram_stojanu": pr["rozhrani"],
           "kotveni": {"skrin": srouby, "otvory_skrine": otvory, "podlaha": "patky 408008 — kotvení k podlaze NUTNÉ (viz síly)"},
           "sily": {"m_skrin_kg": m_skrin_kg, "m_zdroj": "ODHAD", "F_klopna_horni_hrana_N": round(F_klop, 1),
                    "pozn": f"stojan {Dst:g} × {Wst:g}, výška {h_tot:g}: převrhne ho vodorovná síla {F_klop:.0f} N na horní hraně (ODHAD) "
                            "→ kotvit k podlaze nebo ke stroji"},
           "odhady": sorted(set(pr["rozhrani"]["odhady"]) | {"otvory dna skříně pro M6 = ODHAD", f"hmotnost skříně {m_skrin_kg:g} kg = ODHAD"}),
           "chyby": pr["rozhrani"]["chyby"], "varovani": [f"stabilita stojanu: klopná síla {F_klop:.0f} N — kotvit k podlaze"],
           "zdroje": [VYSKY["udrzba"]["zdroj"], VYSKY["vypinac"]["zdroj"]]}
    return {"modul": mod, "rozhrani": roz, "otvory_skrine": otvory, "boxes": [roz["poloha_skrine"]["box"]], "plan_ramu": pr}


# --- úprava modelu skříně (otvory pro upevnění) ----------------------------------------------------------------------
def dopln_vyvodky(layout_path: str | Path, prumery: list[float]) -> int:
    """Jedna vývodka SKINTOP na kabel v poli (SKINTOP = 1 kabel) podle průměru: M16 svírá tenké kabely, M20 tlustší; plus přívod M20.
    Přepíše ``hw.glands`` / ``gland_holes`` v ``layout.json``, řady podle šířky dna. Vrací počet vývodek."""
    lp = Path(layout_path)
    L = json.loads(lp.read_text(encoding="utf-8"))
    nor = json.loads((Path(__file__).resolve().parents[1] / "pro3d_parts" / "data" / "normalie.json").read_text(encoding="utf-8-sig"))["SKINTOP_ST-M"]
    cab, hw = L["cabinet"], L.setdefault("hw", {})
    W, Dp = float(cab["w"]), float(cab["d"])
    prv = ["M16" if float(d or 0) <= float(re.split(r"\D+", nor["rady"]["M16"]["clamp"])[1]) else "M20" for d in prumery] + ["M20"]
    x0, x1 = 60.0, W - 60.0
    krok = max(nor["rady"][m]["sw"] for m in prv) * 1.4
    na_radu = max(1, int((x1 - x0) // krok) + 1)
    rady = max(1, -(-len(prv) // na_radu))
    glands, holes = [], []
    for i, m in enumerate(prv):
        r, k = divmod(i, na_radu)
        x, y = x0 + k * krok, Dp * (r + 1) / (rady + 1)
        sk = nor["rady"][m]
        co = "přívod" if i == len(prv) - 1 else f"kabel {i + 1}"
        glands.append({"name": f"Vývodka {i + 1} SKINTOP ST-M {m} ({co}, návrh)", "x": round(x, 2), "y": round(y, 2), "thread": sk["thread"], "sw": sk["sw"],
                       "C": sk["C"], "D": sk["D"], "zdroj": nor.get("zdroj", "")})
        holes.append({"x": round(x, 2), "y": round(y, 2), "d": sk["thread"] + 0.2})
    hw["glands"], hw["gland_holes"] = glands, holes
    lp.write_text(json.dumps(L, ensure_ascii=False, indent=1), encoding="utf-8")
    return len(glands)


def upravit_skrin(layout_path: str | Path, otvory: list[dict], slot: str = "pro3d-cabinet", timeout: int = 900, stavet: bool = True) -> dict:
    """Zapíše otvory pro upevnění skříně do ``layout.json`` (``hw.rear_holes`` / ``hw.floor_holes`` — ``fc_cabinet`` je vyřízne)
    a znovu postaví ``Rozvadec.FCStd`` (pro3d_cabinet ``build_freecad``)."""
    lp = Path(layout_path)
    L = json.loads(lp.read_text(encoding="utf-8"))
    hw = L.setdefault("hw", {})
    hw["rear_holes"] = [o for o in otvory if o.get("kde") == "zadní stěna"]
    hw["floor_holes"] = [o for o in otvory if o.get("kde") == "dno"]
    lp.write_text(json.dumps(L, ensure_ascii=False, indent=1), encoding="utf-8")
    if not stavet:
        return {"ok": True, "layout": str(lp)}
    root = Path(__file__).resolve().parents[2]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    from plc_studio.pro3d_cabinet import cli as ccli  # type: ignore
    fc = lp.parent / "Rozvadec.FCStd"
    folder = lp.parent.parent
    return ccli.build_freecad(lp, fc, folder, slot, timeout, False)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Modul E1 — konzola / stojan rozvaděče (plán + smlouva E1)")
    ap.add_argument("layout", help="rozvadec/layout.json (pro3d_cabinet)")
    ap.add_argument("--varianta", choices=["konzola", "stojan"], default="konzola")
    ap.add_argument("--rozhrani", help="složka pro E1_<id>.json")
    a = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
    sk = nacti_skrin(a.layout)
    if a.varianta == "konzola":
        n1 = modul_ram.plan_ramu(D=800, W=600, H=800, deska=False, podpory="patky", zatizeni_kg=20.0, ident="N1")
        r = konzola_n1(sk, n1["rozhrani"])
    else:
        r = stojan(sk)
    if a.rozhrani:
        p = Path(a.rozhrani)
        p.mkdir(parents=True, exist_ok=True)
        (p / f"E1_{r['rozhrani']['id']}.json").write_text(json.dumps(r["rozhrani"], ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({"ok": not r["rozhrani"]["chyby"], "poloha": r["rozhrani"]["poloha_skrine"], "vysky": r["rozhrani"]["vysky"],
                      "chyby": r["rozhrani"]["chyby"]}, ensure_ascii=False))
    return 0 if not r["rozhrani"]["chyby"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
