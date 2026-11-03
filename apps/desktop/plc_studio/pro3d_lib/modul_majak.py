"""Modul O2 — signální věž / maják (čistý Python: plán; FreeCAD: ``fc_lib.py``).

Vstup = řádky kusovníku kategorie ``beacon`` z manifestu PLCdesk (``PLCdesk_CAD.json`` v2) a zařízení DO s rolí.
Umí oba tvary kusovníku:

* STARÝ — každé DO má vlastní řádek věže (vzor 03: -H1 run, -H2 fault = 2 × KS71 64924005, qty 1),
* NOVÝ — jeden řádek věže s patry (``patra`` / ``tiers`` / ``levels``: jména zařízení nebo {device, role, barva}).

Všechny řádky jedné skupiny (``group`` / ``tower`` řádku, jinak celý stroj) = JEDNA věž, patro na každé DO; rozdíl
proti kusovníku (N věží → 1, nevyužité patro hotové věže, dvě DO téže barvy) jde do ``zpetna_vazba`` — nic se
neopravuje potichu. Barva patra: z popisu zařízení (cs / en / de), jinak z role (``data/veze.json``
``role_DO_na_barvu`` = výchozí PLCdesk, rozhodnutí uživatele 2026-11-03 — shodně s jádrem bom.ts), pořadí shora R, Y, B, G, W (IEC 60204-1 10.3.2 podle IDEC — sekundární).

Věž WERMA KombiSIGN 71: hotová věž 64924005 (GN / YE / RD, kóty výkresu 299 / 282 / 226 / 170 / 114 / 87, patka Ø70
4 × Ø5,5 na Ø54), když se barvy pater vejdou do GN / YE / RD bez konfliktu; jinak stavebnice KS71 (přípojný prvek
26,5, světelné prvky po 56 mm — rozteč z výkresu 64924005, katalogová výška 65 včetně bajonetu = ODHAD výkladu, víko
17 mm odvozeno 299 − 282) na trubce Ø25 v základně 975.840.91 (Ø70, 4 × Ø5,5 na Ø54, ověřeno). Rozměr Ø70 a výška
299 hotové věže se čtou z ``pro3d_parts/data/katalog.json`` (64924005); model věže staví tento modul jako tvar
s otvory patky (obálka pro3d_parts je plný válec bez děr — šrouby patky by v ní kolidovaly).

Montáž (spojka V4): ``deska`` = ocelová deska t 5 (ODHAD) na horní drážce profilu (2 × M6 + matice T), věž /
základna 4 × M5 + podložka + matice ISO 4032 v otvorech výrobce; ``uhelnik`` = úhelník t 5 (ODHAD) na boční drážce
profilu (2 × M6 + matice T), základna na vodorovném rameni. Kabel (V2) středem patky dolů, R = 5 × D (pevné uložení,
``pro3d_cabinet/data/dvere.json`` ``polomer``), průměr kabelu ODHAD. Pomocná tělesa: barevná patra (náhled), kužel
viditelnosti, kóta výšky spodního svítícího patra.

CLI: ``python -m plc_studio.pro3d_lib.modul_majak [--manifest PLCdesk_CAD.json] [--plan plan.json] [--md MAJAK.md]
[--fc SLOŽKA]`` (bez manifestu = zkušební deska O2 se třemi věžemi)."""

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

HERE = Path(__file__).resolve().parent
VEZE = json.loads((HERE / "data" / "veze.json").read_text(encoding="utf-8"))
KATALOG = json.loads((HERE.parent / "pro3d_parts" / "data" / "katalog.json").read_text(encoding="utf-8"))["polozky"]
DVERE = json.loads((HERE.parent / "pro3d_cabinet" / "data" / "dvere.json").read_text(encoding="utf-8"))   # jen čtení
GEN = "pro3d_lib/modul_majak"

HOTOVA = "64924005"
W64 = VEZE["veze"]["werma_KS71_RM_64924005"]
WSYS = VEZE["veze"]["werma_KS71_system"]
WZAK = VEZE["veze"]["werma_zakladna_975_840_91"]
POZN_64 = W64["zdroj"]["dokument"] + " — " + W64["zdroj"]["url"]
POZN_ZAK = WZAK["zdroj"]["dokument"] + " — " + WZAK["zdroj"]["url"]
POZN_SYS = WSYS["zdroj"]["dokument"] + " — " + WSYS["zdroj"]["url"]

PORADI = ["R", "Y", "B", "G", "W"]                 # shora dolů (veze.json barvy.poradi_shora)
JMENO = dict(zip(PORADI, VEZE["barvy"]["poradi_shora"]))
RGB = {"R": "220,30,30", "Y": "255,190,0", "B": "30,90,220", "G": "30,170,60", "W": "245,245,245", "-": "150,150,150"}
CS_NA_KOD = {"červená": "R", "žlutá": "Y", "modrá": "B", "zelená": "G", "bílá": "W"}
RE_BARVA = [("R", r"červen|\bred\b|\brot\b|\brote?[nrs]?\b"), ("Y", r"žlut|oranž|yellow|amber|\bgelb"),
            ("B", r"modr|\bblue\b|\bblau"), ("G", r"zelen|green|\bgrün|\bgruen"), ("W", r"bíl|\bwhite\b|\bweiß|\bweiss|čir|clear")]
HOT_PATRA = ["R", "Y", "G"]                        # 64924005 GN / YE / RD — shora RD, YE, GN (výkres)

# ODHADY modulu (do MAJAK.md a zpětné vazby)
T_DESKA = 5.0          # deska / úhelník, ocel S235
M_PROFIL = "M6"        # šrouby do matic T drážky 40/8
X_PROFIL = 25.0        # ± rozteč šroubů do drážky podél profilu
M_PATKA = "M5"         # do otvorů Ø5,5 patky (šroub výrobce neuvádí)
STENA_TRUBKY = 2.0     # trubka Ø25 — stěna výrobce neuvádí
ZASUNUTI_ZAKLADNA = 25.0   # hloubka otvoru Ø25,2 základny (krk h 31, patka 1,5 — výkres hloubku nekótuje)
ZASUNUTI_PRVEK = 20.0  # zasunutí trubky do přípojného prvku
KABEL_D = {4: 5.0, 7: 6.5}  # průměr kabelu podle počtu žil (patra + společný) — ODHAD (LiYY 0,5 mm²)
VYSKA_MIN = float(VEZE["viditelnost"]["vyska_spodni_hrana_min"])
KUZEL_UHEL = 20.0      # polovina úhlu pomocného kuželu viditelnosti (jen pro kontrolu výhledu)
KUZEL_L = 400.0
I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]


def _fold(s: str) -> str:
    return str(s or "").lower()


def barva_z_popisu(desc: str) -> str | None:
    t = _fold(desc)
    for k, rx in RE_BARVA:
        if re.search(rx, t):
            return k
    return None


def barva_z_role(role: str | None) -> tuple[str | None, bool]:
    """(kód barvy, ODHAD?) z ``veze.json role_DO_na_barvu`` (fault = R, run = G, ready = W, stopped = Y, lock = B,
    auto = W — výchozí PLCdesk, rozhodnutí uživatele 2026-11-03; ODHAD jen u neznámé role)."""
    v = VEZE["role_DO_na_barvu"].get(str(role or ""))
    if not v:
        return None, True
    k = CS_NA_KOD.get(v.split(" ")[0])
    return k, "ODHAD" in v


def _devices(manifest: dict) -> dict:
    return {d.get("name"): d for d in manifest.get("devices") or []}


def _patro(dev: dict | None, name: str, row: dict | None, extra: dict | None = None) -> dict:
    extra = extra or {}
    d = dev or {}
    desc = extra.get("desc") or d.get("desc") or ""
    role = extra.get("role") or d.get("role")
    b, zdroj, odhad = None, "", False
    if extra.get("barva"):
        b = extra["barva"] if extra["barva"] in PORADI else barva_z_popisu(extra["barva"])
        zdroj = "zadání patra"
    if not b:
        b = barva_z_popisu(desc)
        zdroj = "popis zařízení" if b else ""
    if not b:
        b, odhad = barva_z_role(role)
        zdroj = f"role {role}" + (" (ODHAD)" if odhad else " (výchozí PLCdesk)") if b else ""
    sig = [s.get("tag") for s in d.get("signals") or [] if s.get("dir") == "DO"]
    return {"device": name, "role": role, "desc": desc, "barva": b or "W", "zdroj_barvy": zdroj or "bez barvy a role — bílá (ODHAD)",
            "odhad": odhad or not zdroj, "tag": sig[0] if sig else "", "id": (row or {}).get("id") or "",
            "devTag": "-" + name if name else ""}


def veze_z_manifestu(manifest: dict) -> list[dict]:
    """Řádky ``beacon`` → věže (skupina = ``group`` / ``tower`` řádku, jinak všechny řádky stroje = jedna věž).
    Vrací [{radky, patra (shora), orderCode, brand, zpetna_vazba}]."""
    devs = _devices(manifest)
    rows = [p for p in manifest.get("parts") or [] if p.get("category") == "beacon"]
    groups: dict[str, list] = {}
    for r in rows:
        groups.setdefault(str(r.get("group") or r.get("tower") or ""), []).append(r)
    out = []
    for gk, rr in groups.items():
        patra, fb = [], []
        for r in rr:
            tiers = r.get("patra") or r.get("tiers") or r.get("levels")
            if tiers:                                            # NOVÝ tvar: jeden řádek, patra uvnitř
                for t in tiers:
                    t = {"device": t} if isinstance(t, str) else dict(t)
                    nm = t.get("device") or t.get("name") or ""
                    patra.append(_patro(devs.get(nm), nm, r, t))
            elif r.get("device"):                                # STARÝ tvar: řádek = jedno DO
                patra.append(_patro(devs.get(r["device"]), r["device"], r))
            else:
                fb.append(f"řádek {r.get('id')}: věž bez zařízení — patro nelze přiřadit (doplnit DO v PLCdesk)")
        n_old = sum(1 for r in rr if not (r.get("patra") or r.get("tiers") or r.get("levels")))
        if n_old > 1:
            fb.append(f"kusovník má {n_old} celých věží ({', '.join(r.get('id', '') for r in rr)}) — ve 3D jedna věž s "
                      f"{len(patra)} patry; návrh řádku: 1 věž + patra (M-02)")
        cnt: dict[str, list] = {}
        for p in patra:
            cnt.setdefault(p["barva"], []).append(p["device"])
        for b, ds in cnt.items():
            if len(ds) > 1:
                fb.append(f"konflikt barev: {', '.join(ds)} mají stejnou barvu ({JMENO[b]}) — rozlišit popisem / rolí (M-03)")
        patra.sort(key=lambda p: (PORADI.index(p["barva"]), p["device"]))
        codes = sorted({str(r.get("orderCode") or "") for r in rr})
        out.append({"skupina": gk, "radky": [r.get("id") for r in rr], "patra": patra, "orderCode": codes[0] if codes else "",
                    "brand": rr[0].get("brand") or "", "zpetna_vazba": fb})
    return out


def volba_veze(patra: list[dict]) -> dict:
    """Hotová věž 64924005, když se barvy vejdou do GN / YE / RD bez konfliktu; jinak stavebnice KS71 (max. 5 prvků)."""
    bb = [p["barva"] for p in patra]
    if len(set(bb)) == len(bb) and set(bb) <= set(HOT_PATRA):
        return {"druh": "hotova", "kod": HOTOVA, "prvky": list(HOT_PATRA)}
    n = len(patra)
    maxp = int(str(WSYS["max_prvku"]).split(" ")[0])
    if n > maxp:
        raise ValueError(f"{n} pater > max. {maxp} prvků KombiSIGN 71 — rozdělit na dvě věže")
    return {"druh": "stavebnice", "kod": "KS71", "prvky": bb}


# --- díly -------------------------------------------------------------------------------------------------------------

def _holes(r: float, n: int = 4, start: float = 45.0) -> list[tuple[float, float]]:
    return [(r * math.cos(math.radians(start + 360 / n * k)), r * math.sin(math.radians(start + 360 / n * k))) for k in range(n)]


def _spec(key, body, nazev, zdroj, detail, poznamka="", typ="dil", material="", zastupny=False) -> dict:
    return {"key": key, "gen": "lib_body", "body": body, "nazev": nazev, "zdroj": zdroj, "detail": detail, "typ": typ,
            "material": material, "poznamka": poznamka, "zastupny": zastupny}


def _spec_zakladna(key: str, nazev: str, zdroj: list[str], pozn: str) -> dict:
    """Základna / patka Ø70: příruba t 1,5 se 4 × Ø5,5 na Ø54 (zahloubení Ø10,5 = místo pro hlavu / podložku), krk Ø35
    do výšky 31, otvor pro trubku Ø25,2, kabelový průchod Ø16 dnem (975.840.91, ověřeno)."""
    d, t, h = WZAK["d"], WZAK["patka_t"], WZAK["h"]
    cut = [{"cyl": {"p": [x, y, -1], "d": [0, 0, 1], "r": WZAK["otvor_d"] / 2, "h": t + 2}} for x, y in
           _holes(WZAK["roztecna_kruznice_d"] / 2)]
    cut += [{"cyl": {"p": [0, 0, h - ZASUNUTI_ZAKLADNA], "d": [0, 0, 1], "r": WZAK["trubka_otvor_d"] / 2, "h": ZASUNUTI_ZAKLADNA + 1}},
            {"cyl": {"p": [0, 0, -1], "d": [0, 0, 1], "r": WZAK["kabel_d"] / 2, "h": h - ZASUNUTI_ZAKLADNA + 2}}]
    body = {"add": [{"cyl": {"p": [0, 0, 0], "d": [0, 0, 1], "r": d / 2, "h": t}},
                    {"cyl": {"p": [0, 0, t], "d": [0, 0, 1], "r": WZAK["krk_d"] / 2, "h": h - t}}], "cut": cut}
    return _spec(key, body, nazev, zdroj, "tvar zjednodušen (příruba + krk, otvory dle výkresu)", pozn, material=WZAK["material"])


def _spec_trubka(L: float, pozn: str) -> dict:
    body = {"add": [{"cyl": {"p": [0, 0, 0], "d": [0, 0, 1], "r": 12.5, "h": L}}],
            "cut": [{"cyl": {"p": [0, 0, -1], "d": [0, 0, 1], "r": 12.5 - STENA_TRUBKY, "h": L + 2}}]}
    return _spec(f"WERMA_trubka_25x{L:g}", body, f"Trubka WERMA Ø25 × {L:g}", [POZN_SYS], "obálka (stěna ODHAD 2 mm)",
                 pozn, material="hliník (ODHAD)")


def _stack(volba: dict) -> dict:
    """Výšky a hranice prvků věže nad dosedací rovinou montáže (z_m = 0)."""
    if volba["druh"] == "hotova":
        k = W64["vyskove_koty"]
        z0, hr = 87.0, [114.0, 170.0, 226.0, 282.0]          # přípojný prvek 87–114, prvky po 56, víko 282–299
        top = float(KATALOG[HOTOVA]["h"])
        return {"z0": z0, "top": top, "prvky": [(hr[i], hr[i + 1]) for i in range(3)][::-1], "ref": k}
    n = len(volba["prvky"])
    pr = float(WSYS["prvky"]["pripojny_prvek"]["h"])
    pitch = 56.0                                              # odvozeno z výkresu 64924005 (114 → 170 → 226 → 282)
    return {"pr": pr, "pitch": pitch, "n": n, "vika": float(W64["h"] - 282.0)}


def _spec_vez(volba: dict) -> tuple[dict, float, list]:
    """Těleso věže (přípojný prvek + světelné prvky + víko) Ø70 s otvorem pro trubku zespodu. Vrací (spec, výška,
    [(z_od, z_do) prvků SHORA] v místních souřadnicích od spodku přípojného prvku)."""
    D = float(KATALOG[HOTOVA]["d"])
    if volba["druh"] == "hotova":
        s = _stack(volba)
        H = s["top"] - s["z0"]
        prv = [(a - s["z0"], b - s["z0"]) for a, b in s["prvky"]]
        key, naz = "WERMA_64924005_vez", "WERMA KS71 RM 64924005 GN/YE/RD — věž nad trubkou (kóty výkresu)"
        zdroj, det = [POZN_64, KATALOG[HOTOVA]["zdroj"]], "obálka Ø70 po kótách výkresu 114 / 170 / 226 / 282 / 299"
        pozn = "výklad kót výkresu ODHAD (veze.json vyskove_koty.pozn); Ø70 × 299 z pro3d_parts katalog.json"
    else:
        s = _stack(volba)
        n = s["n"]
        H = s["pr"] + n * s["pitch"] + s["vika"]
        prv = [(s["pr"] + (n - 1 - i) * s["pitch"], s["pr"] + (n - i) * s["pitch"]) for i in range(n)]
        key = f"WERMA_KS71_{n}prvku"
        naz = f"WERMA KombiSIGN 71 — přípojný prvek pro trubku + {n} × světelný prvek + víko"
        zdroj, det = [POZN_SYS, POZN_64], "obálka Ø70 (rozteč prvků 56 a víko 17 odvozeny z výkresu 64924005)"
        pozn = "přípojný prvek 26,5 a Ø70 z katalogu; katalogová výška světelného prvku 65 zahrnuje bajonet (ODHAD výkladu)"
    body = {"add": [{"cyl": {"p": [0, 0, 0], "d": [0, 0, 1], "r": D / 2, "h": H}}],
            "cut": [{"cyl": {"p": [0, 0, -1], "d": [0, 0, 1], "r": WZAK["trubka_otvor_d"] / 2, "h": ZASUNUTI_PRVEK + 1}}]}
    return _spec(key, body, naz, zdroj, det, pozn, material="PC / PA (plast)"), H, prv


# --- modul ------------------------------------------------------------------------------------------------------------

def modul(vez: dict, montaz: str = "deska", cx: float = 100.0, trubka: float | None = None, nazev: str = "",
          z_podlaha: float = 0.0) -> dict:
    """Věž ``vez`` (z ``veze_z_manifestu``) na profilu 40 × 40 podél X (y −20…20, z 0…40). ``montaz`` = ``deska``
    (horní drážka) / ``uhelnik`` (boční drážka y = +20). ``trubka`` = délka trubky stavebnice (975 840 xx: 100 / 250 /
    400 …; výchozí 100 na desce, 400 na úhelníku). ``z_podlaha`` = výška horní plochy profilu… nad podlahou dílny −
    40 (pro kontrolu výšky; zkušební deska 0)."""
    patra = vez["patra"]
    volba = volba_veze(patra)
    var, info = [], []
    dily, inst, telesa = [], [], []
    # montážní plocha
    if montaz == "deska":
        cy, z_m = 65.0, 40.0 + T_DESKA
    elif montaz == "uhelnik":
        cy, z_m = 20.0 + T_DESKA + 45.0, 40.0 + T_DESKA
    else:
        raise ValueError("montaz = deska | uhelnik")
    pat = _holes(WZAK["roztecna_kruznice_d"] / 2)
    hole = spojky_mech.otvor_vule(M_PATKA)
    if abs(hole - WZAK["otvor_d"]) > 1e-6:
        var.append(f"díra ISO 273 {M_PATKA} {hole} ≠ otvor patky {WZAK['otvor_d']}")
    # nosič v místních souřadnicích (počátek = osa profilu x = cx) → jeden díl pro všechny věže, App::Link (kontrola kopií)
    cut = [{"cyl": {"p": [x, cy + y, z_m - T_DESKA - 1], "d": [0, 0, 1], "r": hole / 2, "h": T_DESKA + 2}} for x, y in pat]
    cut.append({"cyl": {"p": [0.0, cy, z_m - T_DESKA - 1], "d": [0, 0, 1], "r": WZAK["kabel_d"] / 2, "h": T_DESKA + 2}})
    h6 = spojky_mech.otvor_vule(M_PROFIL)
    if montaz == "deska":
        add = [{"box": [-45.0, 45.0, -20.0, cy + 40, 40.0, z_m]}]
        cut += [{"cyl": {"p": [sx * X_PROFIL, 0.0, 39.0], "d": [0, 0, 1], "r": h6 / 2, "h": T_DESKA + 2}} for sx in (-1, 1)]
        v4 = [spojky_mech.sroub_do_drazky(M_PROFIL, cx + sx * X_PROFIL, 0.0, 40.0, T_DESKA) for sx in (-1, 1)]
        nosic = f"Deska věže (ocel t {T_DESKA:g}, ODHAD) na horní drážce profilu"
    else:
        add = [{"box": [-45.0, 45.0, 20.0, 20.0 + T_DESKA, 2.0, z_m]},
               {"box": [-45.0, 45.0, 20.0, cy + 40, z_m - T_DESKA, z_m]}]
        cut += [{"cyl": {"p": [sx * X_PROFIL, 19.0, 20.0], "d": [0, 1, 0], "r": h6 / 2, "h": T_DESKA + 2}} for sx in (-1, 1)]
        v4 = [spojky_mech.sroub_do_drazky_r(M_PROFIL, [cx + sx * X_PROFIL, 20.0, 20.0], spojky_mech.R_BOK_PLUS_Y, T_DESKA)
              for sx in (-1, 1)]
        nosic = f"Úhelník věže (ocel t {T_DESKA:g}, ODHAD) na boční drážce profilu"
    for r in v4:
        if not r["ok"]:
            raise ValueError(r["text"])
        dily += r["dily"]
        inst += r["instance"]
    ns = {"key": f"O2_{montaz}_t{T_DESKA:g}", "gen": "lib_body", "body": {"add": add, "cut": cut}, "nazev": nosic, "vlastni": True,
          "zdroj": [POZN_ZAK], "detail": "vlastní konstrukce (ODHAD)", "typ": "dil", "material": "ocel S235 (ODHAD)",
          "poznamka": "tvar a tloušťka ODHAD; otvory věže = 4 × Ø5,5 na Ø54 dle výrobce, kabel Ø16"}
    dily.append(ns)
    inst.append({"model": ns["key"], "pos": [cx, 0.0, 0.0], "rot": I3, "druh": "nosic"})
    # základna / patka
    if volba["druh"] == "hotova":
        zak = _spec_zakladna("WERMA_64924005_patka", "WERMA 64924005 — patka se základnou trubky (Ø70, 4 × Ø5,5 na Ø54)",
                             [POZN_64, POZN_ZAK], "patka Ø70, otvory a průchod dle výkresu 64924005; krk Ø35 × 31 převzat ze "
                             "základny 975.840.91 (ODHAD — výkres 64924005 krk nekótuje)")
        L = 87.0 + ZASUNUTI_PRVEK - (WZAK["h"] - ZASUNUTI_ZAKLADNA)
    else:
        zak = _spec_zakladna("WERMA_975.840.91", WZAK["nazev"] + " (975.840.91)", [POZN_ZAK], "")
        L = float(trubka or (100.0 if montaz == "deska" else 400.0))
        if L not in [float(v) for v in WSYS["trubky_d25"].values()]:
            var.append(f"trubka {L:g} mm není v řadě WERMA {sorted(WSYS['trubky_d25'].values())}")
    tr = _spec_trubka(L, "trubka je součástí 64924005" if volba["druh"] == "hotova" else "")
    vs, H, prv = _spec_vez(volba)
    dily += [zak, tr, vs]
    inst.append({"model": zak["key"], "pos": [cx, cy, z_m], "rot": I3, "druh": "zakladna"})
    z_tr = z_m + WZAK["h"] - ZASUNUTI_ZAKLADNA
    inst.append({"model": tr["key"], "pos": [cx, cy, z_tr], "rot": I3, "druh": "trubka", "mount": "zavit",
                 "props": {"Konstrukce_Poznamka": "trubka sevřená svěrným šroubem základny výrobce (nemodelován, ODHAD)"}})
    z_v = z_tr + L - ZASUNUTI_PRVEK
    ids = [p["id"] for p in patra if p["id"]]
    inst.append({"model": vs["key"], "pos": [cx, cy, z_v], "rot": I3, "druh": "vez", "mount": "zavit",
                 "props": {"PLCdesk_Id": ids[0] if ids else "", "PLCdesk_Instance": ", ".join(ids),
                           "Konstrukce_Patra": json.dumps([{k: p[k] for k in ("device", "role", "barva", "tag")} for p in patra],
                                                          ensure_ascii=False),
                           "Konstrukce_Poznamka": "přípojný prvek na trubce svěrnými šrouby výrobce (nemodelovány, ODHAD)"}})
    # šrouby patky
    t_sev = WZAK["patka_t"] + T_DESKA
    txt_patka = ""
    for x, y in pat:
        r = spojky_mech.sroub_s_matici(M_PATKA, [cx + x, cy + y, z_m + WZAK["patka_t"]], [0, 0, -1], t_sev, podlozka=True)
        if not r["ok"]:
            raise ValueError(r["text"])
        dily += r["dily"]
        inst += r["instance"]
        txt_patka = r["text"]
    # patra (pomocná barevná tělesa — náhled a vazba DO → patro)
    obsaz = {p["barva"]: p for p in patra}
    pat_info = []
    for i, (a, b) in enumerate(prv):
        kod = volba["prvky"][i] if volba["druh"] == "hotova" else patra[i]["barva"]
        p = obsaz.get(kod) if volba["druh"] == "hotova" else patra[i]
        if volba["druh"] == "hotova" and p is None:
            vez["zpetna_vazba"].append(f"patro {JMENO[kod]} hotové věže {HOTOVA} nemá DO — nevyužito (jiná věž / doplnit DO)")
        z0, z1 = z_v + a + 1.0, z_v + b - 1.0
        lab = (f"Patro {i + 1} shora — {JMENO[kod]}" + (f" — -{p['device']} {p['role'] or ''} ({p['zdroj_barvy']})" if p else " — nevyužito"))
        telesa.append({"name": f"Patro_{i + 1}", "label": lab,
                       "body": {"add": [{"cyl": {"p": [cx, cy, z0], "d": [0, 0, 1], "r": 36.0, "h": z1 - z0}}],
                                "cut": [{"cyl": {"p": [cx, cy, z0 - 1], "d": [0, 0, 1], "r": 35.2, "h": z1 - z0 + 2}}]},
                       "props": {"Konstrukce_Typ": "pomocny", "Konstrukce_Barva_RGB": RGB[kod if p else "-"],
                                 "Konstrukce_Pruhlednost": 0, "Konstrukce_PLCdesk_Signal": (p or {}).get("tag", "")}})
        pat_info.append({"patro": i + 1, "barva": kod, "device": (p or {}).get("device"), "role": (p or {}).get("role"),
                         "tag": (p or {}).get("tag"), "z": [round(z_v + a, 1), round(z_v + b, 1)]})
    z_svit = min(z for pi in pat_info for z in pi["z"])
    vyska = z_svit + z_podlaha
    if vyska < VYSKA_MIN:
        (info if z_podlaha == 0 else var).append(
            f"spodní svítící patro {vyska:.0f} mm nad podlahou < {VYSKA_MIN:.0f} (ODHAD) — ve stroji zvýšit "
            "(trubka / poloha)" + (" — zkušební deska: z_podlaha = 0" if z_podlaha == 0 else ""))
    # kužel viditelnosti a kóta výšky
    zc = sum(pat_info[-1]["z"]) / 2
    r2 = 35.0 + KUZEL_L * math.tan(math.radians(KUZEL_UHEL))
    telesa.append({"name": "Kuzel_viditelnosti", "label": f"Pomocný kužel viditelnosti (±{KUZEL_UHEL:g}°, {KUZEL_L:g} mm, k místu obsluhy +Y)",
                   "body": {"add": [{"cone": {"p": [cx, cy + 36.0, zc], "d": [0, 1, 0], "r1": 35.0, "r2": r2, "h": KUZEL_L}}]},
                   "props": {"Konstrukce_Typ": "pomocny"}})
    telesa.append({"name": "Kota_vysky", "label": f"Pomocná kóta: spodní hrana svícení {vyska:.0f} mm nad podlahou",
                   "body": {"add": [{"box": [cx + 50, cx + 52, cy - 1, cy + 1, 0.0, z_svit]}]}, "props": {"Konstrukce_Typ": "pomocny"}})
    # kabel V2: středem patky dolů, oblouk do +Y
    zil = len(patra) + 1
    D = next(v for k, v in sorted(KABEL_D.items()) if zil <= k)
    R = float(DVERE["polomer"]["pevne_x"]) * D
    # kabel začíná na dně otvoru přípojného prvku (vývod věže), vede trubkou, základnou a deskou dolů
    z_k = z_v + ZASUNUTI_PRVEK
    kab = spojky_el.kabel_vyvod([cx, cy, z_k], [0, 0, -1], [0, 1, 0], D, R, s0=z_k - (z_m - T_DESKA) + 2 * D)
    if min(pt[2] for seg in kab["path"] for pts in seg.values() for pt in pts) - D / 2 < -1e-6:
        var.append("kabel pod úrovní podlahy desky — zvednout montáž")
    return {"typ": "O2", "nazev": nazev or f"O2 maják {', '.join('-' + p['device'] for p in patra)}", "dily": dily,
            "instance": inst, "telesa": telesa,
            "kabely": [{"name": "Kabel", "label": f"Kabel věže {zil} × 0,5 (Ø{D:g} ODHAD, R {R:g})", "r": kab["r"], "path": kab["path"],
                        "props": {"Konstrukce_Typ": "kabel", "Konstrukce_Druh": "signal", "Kabel_R_min": R}}],
            "props": {"Konstrukce_Generator": GEN, "Konstrukce_Modul": "O2", "Konstrukce_Vez": volba["kod"],
                      "Konstrukce_Montaz": montaz},
            "kontrola": {"volba": volba, "patra": pat_info, "montaz": montaz, "stred": [cx, cy], "z_montaz": z_m,
                         "spodni_sviceni": round(vyska, 1), "vyska_min": VYSKA_MIN, "vrchol": round(z_v + H, 1),
                         "otvory_patky": {"n": len(pat), "d": WZAK["otvor_d"], "roztec": WZAK["roztecna_kruznice_d"]},
                         "sroub_patky": txt_patka, "spojka_V4": v4[0]["text"], "kabel_R": R, "kabel_D": D,
                         "kabel_R_cesta": round(spojky_el.ohyb_z_cesty(kab["path"]), 2), "kabel_max_d": WSYS["kabel_max_d"],
                         "trubka": L},
            "zpetna_vazba": vez["zpetna_vazba"], "varovani": var, "info": info}


def _uniq(dily):
    seen, out = set(), []
    for s in dily:
        if s["key"] not in seen:
            seen.add(s["key"])
            out.append(s)
    return out


def lavice(moduly: list[dict], delka: float = 600.0, profil: str = "104040L", sestava: str = "Lavice_O2", label: str = "") -> dict:
    return {"format": "pro3d-lib-plan", "verze": 1, "generator": GEN, "sestava": sestava,
            "label": label or "Zkušební deska modulu O2 (signální věž)", "snimky_prefix": sestava.lower(),
            "snimky": ["iso", "iso2", "bok", "celo"],
            "profil": {"kod": profil, "delka": delka, "label": f"Profil ALUTEC {profil} 40×40×{delka:g} (zkušební deska; průřez z kót katalogu)"},
            "dily": _uniq([s for m in moduly for s in m["dily"]]), "moduly": moduly}


def vzor_03() -> dict:
    """Výňatek manifestu vzoru 03 (NL-1) — STARÝ tvar: -H1 run a -H2 fault, každé vlastní řádek 64924005."""
    row = {"category": "beacon", "brand": "Werma", "orderCode": HOTOVA, "qty": 1}
    return {"devices": [{"name": "H1", "cls": "DO", "role": "run", "desc": "Maják zelená — cyklus běží",
                         "signals": [{"sig": "out", "dir": "DO", "tag": "H1_out"}]},
                        {"name": "H2", "cls": "DO", "role": "fault", "desc": "Maják červená — porucha stroje",
                         "signals": [{"sig": "out", "dir": "DO", "tag": "H2_out"}]}],
            "parts": [dict(row, id="-H1:beacon", device="H1"), dict(row, id="-H2:beacon", device="H2")]}


def vzor_novy() -> dict:
    """NOVÝ tvar: jeden řádek věže s patry run / fault / ready (popisy bez barvy → barva z role)."""
    return {"devices": [{"name": "H1", "cls": "DO", "role": "run", "desc": "Stroj v cyklu", "signals": [{"dir": "DO", "tag": "H1_out"}]},
                        {"name": "H2", "cls": "DO", "role": "fault", "desc": "Porucha", "signals": [{"dir": "DO", "tag": "H2_out"}]},
                        {"name": "H3", "cls": "DO", "role": "ready", "desc": "Připraven", "signals": [{"dir": "DO", "tag": "H3_out"}]}],
            "parts": [{"id": "-H1:beacon", "category": "beacon", "brand": "Werma", "orderCode": "", "qty": 1, "device": None,
                       "patra": [{"device": "H1"}, {"device": "H2"}, {"device": "H3"}]}]}


def lavice_o2() -> dict:
    """Zkušební deska O2: věž run / fault / ready (stavebnice) na desce s trubkou 100 a na úhelníku s trubkou 400,
    hotová věž 64924005 vzoru 03 (starý tvar kusovníku) na desce."""
    a = veze_z_manifestu(vzor_novy())[0]
    b = veze_z_manifestu(vzor_novy())[0]
    c = veze_z_manifestu(vzor_03())[0]
    m = [modul(a, "deska", 100.0, 100.0, "O2 věž run / fault / ready na desce (trubka 100)"),
         modul(b, "uhelnik", 300.0, 400.0, "O2 věž run / fault / ready na úhelníku (trubka 400)"),
         modul(c, "deska", 500.0, None, "O2 hotová věž 64924005 vzoru 03 na desce")]
    return lavice(m)


def report_md(plan: dict) -> str:
    L = ["# MAJAK — signální věž (modul O2, kód)", "", f"Generátor `{GEN}`; legenda: žlutá = dle dokumentace, oranžová = "
         "zástupný, šedá = vlastní konstrukce (ODHAD), barevné prstence = patra (pomocné).", ""]
    for m in plan["moduly"]:
        k = m["kontrola"]
        L += [f"## {m['nazev']}", "", f"Věž: **{k['volba']['kod']}** ({k['volba']['druh']}), montáž {k['montaz']}, trubka {k['trubka']:g} mm, "
              f"vrchol {k['vrchol']:g} mm, spodní svícení {k['spodni_sviceni']:g} mm.", "",
              "| patro (shora) | barva | DO | role | tag | z [mm] |", "|---|---|---|---|---|---|"]
        for p in k["patra"]:
            L.append(f"| {p['patro']} | {JMENO[p['barva']]} | {('-' + p['device']) if p['device'] else '—'} | {p['role'] or '—'} | "
                     f"{p['tag'] or '—'} | {p['z'][0]:g}–{p['z'][1]:g} |")
        L += ["", f"Patka: {k['otvory_patky']['n']} × Ø{k['otvory_patky']['d']:g} na Ø{k['otvory_patky']['roztec']:g} — {k['sroub_patky']}.",
              f"Kotvení V4: {k['spojka_V4']}. Kabel V2: Ø{k['kabel_D']:g} (ODHAD), R {k['kabel_R']:g} (max. průchod {k['kabel_max_d']:g}).", ""]
        if m["zpetna_vazba"]:
            L += ["**Zpětná vazba PLCdesk:**", ""] + [f"- {x}" for x in m["zpetna_vazba"]] + [""]
        for x in m["varovani"] + m["info"]:
            L.append(f"- {x}")
        L.append("")
    L += ["## ODHADY", "", f"- deska / úhelník ocel t {T_DESKA:g}, šrouby {M_PROFIL} do matic T (± {X_PROFIL:g}), {M_PATKA} do patky "
          "(výrobce šroub neuvádí)", f"- trubka stěna {STENA_TRUBKY:g}, zasunutí do základny {ZASUNUTI_ZAKLADNA:g} a do přípojného prvku "
          f"{ZASUNUTI_PRVEK:g}, svěrné šrouby výrobce nemodelovány (PLCdesk_Mount = zavit)",
f"- výška spodního svícení ≥ {VYSKA_MIN:g} mm, "
          "kužel viditelnosti jen pro kontrolu", "- průměr kabelu podle počtu žil", ""]
    return "\n".join(L)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Modul O2 — signální věž (plán; volitelně FreeCAD + kontroly)")
    ap.add_argument("--manifest", help="PLCdesk_CAD.json (bez = zkušební deska se 3 věžemi)")
    ap.add_argument("--montaz", default="deska", choices=["deska", "uhelnik"])
    ap.add_argument("--trubka", type=float)
    ap.add_argument("--plan")
    ap.add_argument("--md")
    ap.add_argument("--fc", help="složka: postavit ve FreeCADu a spustit kontroly")
    a = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
    if a.manifest:
        man = json.loads(Path(a.manifest).read_text(encoding="utf-8"))
        vv = veze_z_manifestu(man)
        if not vv:
            print("manifest nemá řádek beacon", file=sys.stderr)
            return 1
        plan = lavice([modul(v, a.montaz, 100.0 + 200 * i, a.trubka) for i, v in enumerate(vv)], delka=200.0 * len(vv) + 100)
    else:
        plan = lavice_o2()
    for m in plan["moduly"]:
        k = m["kontrola"]
        print(f"{m['nazev']}: {k['volba']['kod']} {[JMENO[p['barva']] for p in k['patra']]}; {k['sroub_patky']}")
        for v in m["zpetna_vazba"] + m["varovani"]:
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
