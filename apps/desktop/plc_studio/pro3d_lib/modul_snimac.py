"""Modul S1 — snímač přítomnosti / polohy s držákem (čistý Python: plán; FreeCAD: ``fc_lib.py``).

Vstup: typ snímače (``data/snimace.json`` → rozměry těla z ``pro3d_parts/data/katalog.json``), kotvení (drážka profilu
ALUTEC: osa drážky v (y_drazka) na horní ploše z_povrch, drážka podél X) a cíl (poloha snímaného předmětu / odrazky).
Výstup: plán = díly pro ``pro3d_parts/fc_parts.py`` a ``fc_lib`` (šrouby, matice, tělo snímače, matice T, zásuvka),
instance (App::Link s polohou), vlastní tělesa (držák s podélnými otvory, zóny) a kabel — vše v globálních souřadnicích.

Držák (ODHAD konstrukce, ocel S235 t = 4): úhelník — základna na profilu se dvěma podélnými otvory ± 5 mm napříč drážkou
(seřízení vzdálenosti k cíli) a šrouby ISO 4762 do matic T (spojka V4), u válcového snímače svislá stojna s dírou
s vůlí a snímač sevřený svými maticemi (axiální seřízení po závitu), u kvádrového snímače (WL12) vodorovná deska,
na které snímač leží bokem a drží dvěma šrouby M4 do závitu v desce. Zásuvka M12 + začátek kabelu = spojka V2.

CLI: ``python -m plc_studio.pro3d_lib.modul_snimac --typ IFS204 --cil 50,45,70 [--profil 40x40] [--plan plan.json]
[--fc SLOŽKA]`` (``--fc`` = postaví model ve vlastní instanci FreeCADu a spustí kontroly ``pro3d_tools vse``)."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    __package__ = "plc_studio.pro3d_lib"

from . import spojky_el, spojky_mech  # noqa: E402

HERE = Path(__file__).resolve().parent
SNIMACE = json.loads((HERE / "data" / "snimace.json").read_text(encoding="utf-8"))["typy"]
KATALOG = json.loads((HERE.parent / "pro3d_parts" / "data" / "katalog.json").read_text(encoding="utf-8"))["polozky"]
NORM = spojky_mech.NORM
GEN = "pro3d_lib/modul_snimac"

T_DRZAK = 4.0          # ODHAD — tloušťka plechu držáku (ocel S235)
M_ZAKLAD = "M6"        # šrouby základny do matic T (drážka 8: matice T M4–M8)
X_SROUBY = 11.0        # ± rozteč šroubů základny podél drážky (matice T L = 20 → mezera 2 mm)
SIRKA = 40.0           # šířka držáku podél drážky
ZA_SROUBEM = 15.0      # přesah základny za osou drážky (dozadu)
VULE = 0.5             # vůle mezi díly (ODHAD)

I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
ROT_VALEC = [[0, 1, 0], [-1, 0, 0], [0, 0, 1]]       # model +X (osa snímače, čelo x = 0) → globální −Y; čelo hledí +Y
ROT_MATICE_Y = [[1, 0, 0], [0, 0, 1], [0, -1, 0]]    # model Z (osa matice) → globální +Y
ROT_KVADR = [[0, 0, -1], [-1, 0, 0], [0, 1, 0]]      # WL12: model x → −Y (paprsek +Y), model y → +Z (leží bokem), z → −X


def mul(R, v):
    return [sum(R[i][j] * v[j] for j in range(3)) for i in range(3)]


def add(a, b, k=1.0):
    return [a[i] + k * b[i] for i in range(3)]


def info(typ: str) -> dict:
    t = SNIMACE[typ]
    return dict(t, rozmery=KATALOG[t["katalog"]])


def _spec_telo(typ: str) -> dict:
    """Tělo snímače bez montážních matic (matice jsou samostatné díly — leží po obou stranách držáku)."""
    t = info(typ)
    k = t["rozmery"]
    p = {kk: v for kk, v in k.items() if kk not in ("gen", "nazev", "material", "detail", "zdroj", "poznamka",
                                                  "nut_sw", "nut_m", "nuts")}
    return {"key": f"{typ}_telo", "gen": k["gen"], "params": p, "nazev": k["nazev"] + " (tělo bez matic)",
            "zdroj": [k["zdroj"]], "detail": k["detail"], "typ": "dil", "material": k.get("material", ""),
            "poznamka": (k.get("poznamka") or "") + " — matice jako samostatné díly modulu S1"}


def _spec_matice_snimace(typ: str) -> dict:
    t = info(typ)
    mt, d = t["matice"], t["d"]
    e = mt["s"] / math.cos(math.radians(30))
    if mt.get("odhad"):
        body = {"add": [{"hex_z": {"s": mt["s"], "z0": 0.0, "z1": mt["m"]}}],
                "cut": [{"cyl": {"p": [0, 0, -1], "d": [0, 0, 1], "r": d / 2, "h": mt["m"] + 2}}]}
        return {"key": f"Matice_{typ}", "gen": "lib_body", "body": body, "zastupny": True,
                "nazev": f"Matice snímače {typ} M{d:g}x1 (zástupná — tloušťka neuvedena)", "zdroj": [mt["zdroj"]],
                "detail": "obálka", "typ": "matice", "material": mt["material"], "poznamka": mt["zdroj"], "e": e}
    return {"key": f"Matice_{typ}", "gen": "matice", "params": {"s": mt["s"], "m": mt["m"], "tap": d, "P": t["pitch"]},
            "nazev": f"Matice snímače {typ} M{d:g}x1 SW{mt['s']:g} × {mt['m']:g}", "zdroj": [mt["zdroj"], t["zdroj"]],
            "detail": "tvar (díra = Ø závitu snímače: sevření bez průniku)", "typ": "matice", "material": mt["material"],
            "poznamka": "", "e": e}


def _spec_konektor(kon: dict, key: str) -> dict:
    return {"key": key, "gen": "lib_body", "body": kon["body"], "zastupny": kon["odhad"],
            "nazev": kon["nazev"] + (" (zástupná obálka)" if kon["odhad"] else ""), "zdroj": [kon["zdroj"]] if kon["zdroj"] else [],
            "detail": "obálka", "typ": "dil", "material": "TPU / mosaz", "poznamka": kon["zdroj_popis"]}


def _zakladna(cx: float, y_s: float, z_p: float, y_konec: float, x0: float | None = None, x1: float | None = None) -> tuple:
    """Základna držáku (deska na profilu) se dvěma podélnými otvory napříč drážkou. Vrací (add, cut, otvor)."""
    po = spojky_mech.podelny_otvor(M_ZAKLAD)
    x0 = cx - SIRKA / 2 if x0 is None else x0
    x1 = cx + SIRKA / 2 if x1 is None else x1
    add_ = [{"box": [x0, x1, y_s - ZA_SROUBEM, y_konec, z_p, z_p + T_DRZAK]}]
    cut = [{"slot": {"p1": [cx + sx * X_SROUBY, y_s - po["serizeni"], z_p - 1], "p2": [cx + sx * X_SROUBY, y_s + po["serizeni"], z_p - 1],
                     "r": po["sirka"] / 2, "h": T_DRZAK + 2}} for sx in (-1, 1)]
    return add_, cut, po


def _srouby_zakladny(cx: float, y_s: float, z_p: float) -> tuple:
    dily, inst, txt = [], [], []
    for sx in (-1, 1):
        r = spojky_mech.sroub_do_drazky(M_ZAKLAD, cx + sx * X_SROUBY, y_s, z_p, T_DRZAK)
        if not r["ok"]:
            raise ValueError(r["text"])
        dily += r["dily"]
        inst += r["instance"]
        txt.append(r["text"])
    return dily, inst, txt[0]


def modul_valec(typ: str, cil, y_s: float = 0.0, z_p: float = 40.0, vzdalenost: float | None = None, nazev: str = "") -> dict:
    """Válcový snímač (indukční / kapacitní) v úhelníku na drážce. Osa snímače míří +Y na ``cil`` (čelo ve vzdálenosti
    ``vzdalenost`` před cílem — výchozí 0,75 × Sa)."""
    t = info(typ)
    k = t["rozmery"]
    d, lt, tot = t["d"], k["thread_len"], k["total"]
    mat = _spec_matice_snimace(typ)
    mn, e = t["matice"]["m"], mat["e"]
    kon_d = spojky_el.konektor_data(t["konektor"])
    prsty = spojky_el.DATA["prostor"]["prsty_mm"]["hodnota"]
    hlava_k = NORM["ISO4762"]["rady"][M_ZAKLAD]["k"]
    var = []
    cx, cy, cz = (float(c) for c in cil)
    zs_min = max(z_p + T_DRZAK + e / 2 + 1.0, z_p + T_DRZAK + hlava_k + kon_d["D"] / 2 + prsty + VULE)
    zs = cz
    if zs < zs_min - 1e-6:
        var.append(f"cíl z = {cz:g} je pod nejnižší osou držáku {zs_min:.1f} (matice / zásuvka + prsty nad šrouby) — osa zvednuta")
        zs = round(zs_min + 0.5, 1)
    dist = round(0.75 * t["Sa"], 2) if vzdalenost is None else float(vzdalenost)
    if dist > t["Sa"] + 1e-9:
        var.append(f"vzdálenost čela od cíle {dist} > zajištěná spínací vzdálenost Sa {t['Sa']} — snímač cíl nemusí spolehlivě vidět")
    py = cy - dist                                        # čelo snímače
    po = spojky_mech.podelny_otvor(M_ZAKLAD)
    yl_min = y_s + po["serizeni"] + NORM["ISO4762"]["rady"][M_ZAKLAD]["dk"] / 2 + 1.0
    yl = py - (lt + T_DRZAK) / 2                         # stojna uprostřed závitu (stejné seřízení dopředu i dozadu)
    if yl < yl_min:
        yl = yl_min
    ax_lo, ax_hi = yl + T_DRZAK + mn, yl - mn + lt       # rozsah polohy čela (matice na závitu)
    if not (ax_lo - 1e-6 <= py <= ax_hi + 1e-6):
        raise ValueError(f"{typ}: cíl je příliš blízko drážce — čelo by muselo být v y {py:.1f}, závit dovolí "
                         f"⟨{ax_lo:.1f}; {ax_hi:.1f}⟩")
    hole = spojky_mech.otvor_vule(f"M{d:g}")
    zt = zs + max(e / 2, hole / 2) + 6.0
    # držák: základna + stojna
    a, c, _ = _zakladna(cx, y_s, z_p, yl + T_DRZAK)
    a.append({"box": [cx - SIRKA / 2, cx + SIRKA / 2, yl, yl + T_DRZAK, z_p, zt]})
    c.append({"cyl": {"p": [cx, yl - 1, zs], "d": [0, 1, 0], "r": hole / 2, "h": T_DRZAK + 2}})
    dily, inst, txt_v4 = _srouby_zakladny(cx, y_s, z_p)
    telo = _spec_telo(typ)
    dily += [telo, mat]
    P = [cx, py, zs]
    inst.append({"model": telo["key"], "pos": P, "rot": ROT_VALEC, "druh": "snimac", "mount": "zavit"})
    inst.append({"model": mat["key"], "pos": [cx, yl + T_DRZAK, zs], "rot": ROT_MATICE_Y, "druh": "matice_snimace"})
    inst.append({"model": mat["key"], "pos": [cx, yl - mn, zs], "rot": ROT_MATICE_Y, "druh": "matice_snimace"})
    # spojka V2: zásuvka na konci snímače, kabel se stočí do −X (dolů by v nízkém držáku narazil na podlahu)
    start = [cx, py - tot, zs]
    kon = spojky_el.konektor(t["konektor"], start, [0, -1, 0], [-1, 0, 0])
    kk = _spec_konektor(kon, f"Zasuvka_{t['konektor']}")
    dily.append(kk)
    inst.append({"model": kk["key"], "pos": [0, 0, 0], "rot": I3, "druh": "konektor"})
    # zóna snímání a cíl
    zona = {"add": [{"cyl": {"p": P, "d": [0, 1, 0], "r": d / 2, "h": t["Sn"]}}]}
    cil_b = {"add": [{"box": [cx - 12, cx + 12, cy, cy + 1, zs - 12, zs + 12]}]}
    serizeni = {"podelne": po["serizeni"], "axialne": [round(py - ax_lo, 2), round(ax_hi - py, 2)]}
    return {"typ": typ, "nazev": nazev or f"S1 {typ}", "druh": t["druh"], "dily": dily, "instance": inst,
            "telesa": [{"name": "Drzak", "label": f"Držák snímače {typ} (úhelník t {T_DRZAK:g}, podélné otvory ± {po['serizeni']:g})",
                        "body": {"add": a, "cut": c}, "props": {"Konstrukce_Typ": "dil", "Konstrukce_Material": "ocel S235 (ODHAD)",
                                                                  "Konstrukce_Poznamka": "tvar a tloušťka ODHAD; seřízení: podélné otvory "
                                                                  f"± {po['serizeni']:g} mm napříč drážkou, axiálně po závitu {serizeni['axialne']}"}},
                       {"name": "Zona_snimani", "label": f"Pomocná zóna snímání {typ} (Sn {t['Sn']:g} mm)", "body": zona,
                        "props": {"Konstrukce_Typ": "pomocny"}},
                       {"name": "Prostor_konektoru", "label": f"Pomocný prostor nasunutí zásuvky {t['konektor']} a prsty",
                        "body": kon["zona"], "props": {"Konstrukce_Typ": "pomocny"}},
                       {"name": "Cil", "label": f"Pomocný cíl (snímaný předmět, {dist:g} mm od čela)", "body": cil_b,
                        "props": {"Konstrukce_Typ": "pomocny"}}],
            "kabely": [{"name": "Kabel", "label": f"Kabel {t['konektor']} (začátek, R {kon['kabel']['R']:g})", "r": kon["kabel"]["r"],
                        "path": kon["kabel"]["path"], "props": {"Konstrukce_Typ": "kabel", "Konstrukce_Druh": "signal",
                                                                 "Kabel_R_min": kon["kabel"]["R"]}}],
            "kontrola": {"celo": P, "osa": [0, 1, 0], "cil": [cx, cy, zs], "vzdalenost": dist, "Sa": t["Sa"], "Sn": t["Sn"],
                         "serizeni": serizeni, "drzak_z": [z_p, zt], "stojna_y": [yl, yl + T_DRZAK], "spojka_V4": txt_v4,
                         "konektor": {"start": start, "smer": [0, -1, 0], "zona_r": kon["zona_r"], "zona_h": kon["zona_h"]},
                         "kabel_R": kon["kabel"]["R"], "kabel_R_cesta": round(spojky_el.ohyb_z_cesty(kon["kabel"]["path"]), 2)},
            "varovani": var}


def modul_kvadr(typ: str, cil, y_s: float = 0.0, z_p: float = 40.0, py: float | None = None, nazev: str = "") -> dict:
    """Kvádrový optický snímač (SICK WL12) ležící bokem na desce držáku; paprsek +Y na odrazku v ``cil``. Osa paprsku je
    ve výšce desky + polovina tloušťky snímače (jiná výška = podložit / jiný držák — varování)."""
    t = info(typ)
    k = t["rozmery"]
    W, H, D = k["w"], k["h"], k["d"]                      # 15,6 × 48,5 × 42 (model y × z × x)
    cx, cy, cz = (float(c) for c in cil)
    var = []
    z_top = z_p + T_DRZAK
    px = cx + t["osa_z"]                                  # model z = osa_z → globální x = px − osa_z
    hole_m = [(hh["x"], hh["z"]) for hh in k["holes"]]
    # díry: globální y = py − x_m; konec šroubu vyčnívá pod desku → díra musí být za hranou profilu (y > 20 + r)
    min_py = y_s + 20.0 + 2.5 + max(hx for hx, _ in hole_m)
    py = max(min_py, py or 0.0)
    if cy - py < 50:
        raise ValueError(f"{typ}: odrazka {cy - py:.0f} mm před čelem — odrazný snímač potřebuje odstup (ODHAD ≥ 50)")
    if cy - py > t["dosah_max"]:
        var.append(f"odrazka {cy - py:.0f} mm > dosah {t['dosah_max']:g} mm (s {t['odrazka']})")
    zs = z_top + W / 2
    if abs(cz - zs) > 0.5:
        var.append(f"cíl z = {cz:g}, osa paprsku z = {zs:g} — výšku řeš podložením desky nebo jiným držákem (ODHAD)")
    P = [px, py, z_top]
    x0, x1 = px - H - 5.0, px                        # deska o 5 mm delší za otvorem u zadní hrany (okraj díry)
    xc = (x0 + x1) / 2
    a, c, po = _zakladna(xc, y_s, z_p, py, x0, x1)
    tap = spojky_mech.zavit_otvor(t["sroub"])
    dily, inst, txt_v4 = _srouby_zakladny(xc, y_s, z_p)
    srouby_m4 = []
    for hx, hz in hole_m:
        g = add(P, mul(ROT_KVADR, [hx, 0, hz]))
        c.append({"cyl": {"p": [g[0], g[1], z_p - 1], "d": [0, 0, 1], "r": tap / 2, "h": T_DRZAK + 2}})
        r = spojky_mech.sroub_do_zavitu(t["sroub"], [g[0], g[1], z_top + W], True, W, T_DRZAK, "ocel")
        if not r["ok"]:
            raise ValueError(r["text"])
        dily += r["dily"]
        inst += r["instance"]
        srouby_m4.append(r["text"])
    telo = _spec_telo(typ)
    dily.append(telo)
    inst.append({"model": telo["key"], "pos": P, "rot": ROT_KVADR, "druh": "snimac", "mount": ""})
    # konektor: vidlice M12 na spodku snímače (model −z → globální +X), ODHAD poloha
    kp = add(P, mul(ROT_KVADR, [t["konektor_x"], W / 2, 0]))
    vid = {"add": [{"cyl": {"p": kp, "d": [1, 0, 0], "r": 6.0, "h": t["konektor_vidlice_L"]}}]}
    start = add(kp, [1, 0, 0], t["konektor_vidlice_L"])
    kon = spojky_el.konektor(t["konektor"], start, [1, 0, 0], [0, 1, 0])
    kk = _spec_konektor(kon, f"Zasuvka_{t['konektor']}")
    dily.append(kk)
    inst.append({"model": kk["key"], "pos": [0, 0, 0], "rot": I3, "druh": "konektor"})
    opt = add(P, mul(ROT_KVADR, [0, W / 2, t["osa_z"]]))
    L = cy - py
    r0 = 5.0                                              # ODHAD — poloměr výstupu optiky
    r1 = r0 + L * math.tan(math.radians(t["rozptyl_deg"] / 2))
    zona = {"add": [{"cone": {"p": opt, "d": [0, 1, 0], "r1": r0, "r2": r1, "h": L}}]}
    odr = {"add": [{"cyl": {"p": [opt[0], cy, opt[2]], "d": [0, 1, 0], "r": 40.0, "h": 7.0}}]}
    return {"typ": typ, "nazev": nazev or f"S1 {typ}", "druh": t["druh"], "dily": dily, "instance": inst,
            "telesa": [{"name": "Drzak", "label": f"Držák snímače {typ} (deska t {T_DRZAK:g}, podélné otvory ± {po['serizeni']:g}, závity {t['sroub']})",
                        "body": {"add": a, "cut": c}, "props": {"Konstrukce_Typ": "dil", "Konstrukce_Material": "ocel S235 (ODHAD)",
                                                                  "Konstrukce_Poznamka": "tvar a tloušťka ODHAD; snímač leží bokem, 2 × "
                                                                  f"{t['sroub']} do závitu v desce; seřízení podélné ± {po['serizeni']:g}"}},
                       {"name": "Vidlice", "label": f"Konektor snímače {typ} M12 vidlice (zástupný — poloha ODHAD)", "body": vid,
                        "props": {"Konstrukce_Typ": "dil", "PLCdesk_ModelStatus": "placeholder", "Konstrukce_Zastupny": True,
                                  "PLCdesk_Mount": "zavit"}},
                       {"name": "Zona_paprsku", "label": f"Pomocná zóna paprsku {typ} (rozptyl {t['rozptyl_deg']:g}°)", "body": zona,
                        "props": {"Konstrukce_Typ": "pomocny"}},
                       {"name": "Prostor_konektoru", "label": f"Pomocný prostor nasunutí zásuvky {t['konektor']} a prsty",
                        "body": kon["zona"], "props": {"Konstrukce_Typ": "pomocny"}},
                       {"name": "Odrazka", "label": f"Pomocná odrazka {t['odrazka']} (mimo modul — poloha cíle, Ø 80 ODHAD)", "body": odr,
                        "props": {"Konstrukce_Typ": "pomocny"}}],
            "kabely": [{"name": "Kabel", "label": f"Kabel {t['konektor']} (začátek, R {kon['kabel']['R']:g})", "r": kon["kabel"]["r"],
                        "path": kon["kabel"]["path"], "props": {"Konstrukce_Typ": "kabel", "Konstrukce_Druh": "signal",
                                                                 "Kabel_R_min": kon["kabel"]["R"]}}],
            "kontrola": {"celo": opt, "osa": [0, 1, 0], "cil": [opt[0], cy, opt[2]], "vzdalenost": L, "dosah": t["dosah_max"],
                         "serizeni": {"podelne": po["serizeni"]}, "spojka_V4": txt_v4, "srouby_snimace": srouby_m4,
                         "konektor": {"start": start, "smer": [1, 0, 0], "zona_r": kon["zona_r"], "zona_h": kon["zona_h"]},
                         "kabel_R": kon["kabel"]["R"], "kabel_R_cesta": round(spojky_el.ohyb_z_cesty(kon["kabel"]["path"]), 2)},
            "varovani": var}


def modul(typ: str, cil, **kw) -> dict:
    t = SNIMACE[typ]
    return modul_valec(typ, cil, **kw) if t["tvar"] == "valec" else modul_kvadr(typ, cil, **kw)


def _uniq(dily):
    seen, out = set(), []
    for s in dily:
        if s["key"] not in seen:
            seen.add(s["key"])
            out.append(s)
    return out


def lavice(moduly: list[dict], delka: float = 300.0, profil: str = "104040L") -> dict:
    """Zkušební deska: kus profilu ALUTEC 40 × 40 × ``delka`` podél X (y −20…20, z 0…40, drážka nahoře v y = 0) +
    moduly. Výstup = plán pro ``fc_lib.py``."""
    return {"format": "pro3d-lib-plan", "verze": 1, "generator": GEN,
            "profil": {"kod": profil, "delka": delka, "label": f"Profil ALUTEC {profil} 40×40×{delka:g} (zkušební deska; průřez z kót katalogu)"},
            "dily": _uniq([s for m in moduly for s in m["dily"]]), "moduly": moduly}


def lavice_s1(delka: float = 300.0) -> dict:
    """Zkušební deska modulu S1 se třemi variantami: indukční M12 (IFS204), kapacitní M18 (CM18) a optický WL12
    s odrazkou."""
    m = [modul("IFS204", (50.0, 45.0, 72.0), nazev="S1 indukční M12 IFS204"),
         modul("CM18", (150.0, 50.0, 72.0), nazev="S1 kapacitní M18 CM18"),
         modul("WL12", (238.0, 362.0, 51.8), nazev="S1 optický WL12 s odrazkou")]
    return lavice(m, delka)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Modul S1 — snímač s držákem (plán; volitelně FreeCAD + kontroly)")
    ap.add_argument("--typ", choices=sorted(SNIMACE), help="typ snímače (bez --typ = zkušební deska se 3 variantami)")
    ap.add_argument("--cil", help="poloha cíle x,y,z (mm) — u WL12 poloha odrazky")
    ap.add_argument("--profil", default="40x40", help="kotvení: drážka profilu (zatím jen 40x40, drážka 40/8)")
    ap.add_argument("--vzdalenost", type=float, help="čelo snímače — cíl (válcové snímače), výchozí 0,75 × Sa")
    ap.add_argument("--plan", help="uložit plán JSON")
    ap.add_argument("--fc", help="složka: postavit ve FreeCADu (slot pro3d-s1) a spustit kontroly")
    a = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
    if a.profil.replace(" ", "").lower() not in ("40x40", "104040l", "104040"):
        print("zatím jen profil 40x40 (drážka 40/8)", file=sys.stderr)
        return 2
    if a.typ:
        cil = [float(x) for x in (a.cil or "150,45,72").split(",")]
        kw = {"vzdalenost": a.vzdalenost} if a.vzdalenost is not None and SNIMACE[a.typ]["tvar"] == "valec" else {}
        plan = lavice([modul(a.typ, cil, **kw)])
    else:
        plan = lavice_s1()
    for m in plan["moduly"]:
        print(f"{m['nazev']}: {m['kontrola']['spojka_V4']}; kabel R {m['kontrola']['kabel_R']:g}")
        for v in m["varovani"]:
            print("  VAROVÁNÍ:", v)
    if a.plan:
        Path(a.plan).write_text(json.dumps(plan, ensure_ascii=False, indent=1), encoding="utf-8")
    if a.fc:
        from . import bench
        res = bench.build_and_check(plan, Path(a.fc))
        print(json.dumps(res.get("souhrn", res), ensure_ascii=False, indent=1))
        return 0 if res.get("ok") else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
