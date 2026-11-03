"""Spojka V1 pneumatická — přípojka (závit G / M) → šroubení QS / GRLA / tlumič → začátek hadice (čistý Python; staví
``fc_lib.py``).

Data: ``data/pripojky.json`` (převzato beze změny ze skillu spojka-pneumaticka — zdroje u každé hodnoty) a
``data/spojky_pneu.json`` (hadice = kopie kabelaz-a-hadice ``media.json``, obálky zástupných modelů — ODHAD tam, kde zdroj
rozměr nemá). Modely šroubení jsou ZÁSTUPNÉ (oranžové) s doloženým rozhraním: dosed na čele portu, závit pod dosedem,
ústí soketu, hloubka zasunutí hadice (datový list Festo) — ``fc_scan.in_fitting`` ověří, že čelo hadice leží v šroubení.

Smlouva přípojky (skill spojka-pneumaticka): ``{"id", "seat": [x,y,z], "n": [osa portu ven], "thread": "G1/8",
"fitting": "QS-G1/8-6" | "GRLA-1/8-QS-6-RS-D" | "U-1/8", "hose": "festo_PUN_6x1", "tower": [směr věže GRLA]}``.

Místní souřadnice dílu šroubení: dosed v počátku, osa portu +Z (ven), závit pod dosedem (z < 0); věž GRLA ve směru +X.
Na odkazu (App::Link) se díl natočí ``frame(n, w)`` (Z → n, X → w)."""

from __future__ import annotations

import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
PRIP = json.loads((HERE / "data" / "pripojky.json").read_text(encoding="utf-8"))
DATA = json.loads((HERE / "data" / "spojky_pneu.json").read_text(encoding="utf-8"))


def _n(v):
    L = math.sqrt(sum(x * x for x in v))
    return [x / L for x in v]


def _add(a, b, k=1.0):
    return [a[i] + k * b[i] for i in range(3)]


def _cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def frame(n, w):
    """Rotace (řádky) místní → globální: Z → ``n``, X → ``w`` (kolmé k n), Y = n × w."""
    n, w = _n(n), _n(w)
    if abs(sum(n[i] * w[i] for i in range(3))) > 1e-6:
        raise ValueError("w musí být kolmé k n")
    y = _cross(n, w)
    return [[w[i], y[i], n[i]] for i in range(3)]


def zavit(th: str) -> dict:
    """Závit přípojky (G = ISO 228-1, M5 / M7). ``th`` i ve tvaru „M5x0.8“."""
    k = th.split("x")[0] if th.upper().startswith("M") else th
    return dict(PRIP["zavity"][k], kod=k)


def hadice(D) -> dict:
    """Hadice PUN podle vnějšího Ø (kopie media.json skillu kabelaz-a-hadice)."""
    h = DATA["hadice"][str(int(D))]
    return dict(h, zdroj=DATA["hadice"]["_zdroj"])


def hadice_kod(kod: str) -> dict:
    for k, v in DATA["hadice"].items():
        if not k.startswith("_") and v["kod"] == kod:
            return dict(v, zdroj=DATA["hadice"]["_zdroj"])
    raise KeyError(kod)


def volba_pro_valec(ee: str, grla: bool = False) -> dict:
    """Výchozí šroubení a hadice k přípojce válce (pripojky.json valec_pripojka_hadice — volba Ø hadice ODHAD)."""
    k = zavit(ee)["kod"]
    v = PRIP["valec_pripojka_hadice"][k]
    fit = v.get("grla") if grla and v.get("grla") else v.get("qs")
    if not fit:
        raise ValueError(f"přípojka {k}: šroubení NEČTENO ({v.get('stav')})")
    return {"thread": k, "fitting": fit, "hose": hadice(v["hadice"])["kod"], "stav": v["stav"], "grla": fit.startswith("GRLA")}


def sroubeni(kod: str) -> dict:
    """Rozhraní šroubení: data listu (pripojky.json) + obálka (spojky_pneu.json). Vrací souhrn pro kontrolu bez FreeCADu."""
    if kod.startswith("GRLA"):
        g = PRIP["grla_festo"][kod]
        ob = DATA["obalky"][kod]
        qs = PRIP["qs_festo"].get(f"QS-{g['zavit']}-{g['hadice']}") or {}
        return {"kod": kod, "druh": "grla", "zavit": g["zavit"], "hadice": g["hadice"], "obj": g["kod"],
                "zasun": qs.get("zasun"), "zasun_zdroj": f"jako QS-{g['zavit']}-{g['hadice']} ({qs.get('zdroj')}) — ODHAD pro věž GRLA",
                "vez_z": g["rameno_dosedu"], "vez_x": g["vez_od_osy_zavitu"], "obalka": ob, "zdroj": g["zdroj"]}
    if kod in DATA["obalky"] and kod.startswith(("U-", "UO-")):
        t = PRIP["tlumice_festo"][kod]
        return {"kod": kod, "druh": "tlumic", "zavit": t["zavit"], "obj": t["kod"], "obalka": DATA["obalky"][kod], "zdroj": t["zdroj"]}
    q = PRIP["qs_festo"][kod]
    if not q.get("zasun"):
        raise ValueError(f"{kod}: hloubka zasunutí NEČTENA ({q.get('stav')})")
    return {"kod": kod, "druh": "qs", "zavit": q["zavit"], "hadice": q["hadice"], "obj": q["kod"], "zasun": q["zasun"],
            "zasun_zdroj": q["zdroj"], "sw": q["sw"], "obalka": DATA["obalky"][kod], "zdroj": q["zdroj"]}


def _hex(sw, z0, z1):
    return {"hex_z": {"s": sw, "z0": z0, "z1": z1}}


def spec(kod: str, s_zavitem: bool = True) -> dict:
    """Díl šroubení pro ``fc_lib`` (lib_body, ZÁSTUPNÝ) v místních souřadnicích. ``s_zavitem`` = modelovat závit pod
    dosedem (jen když model protikusu má díru portu — jinak by závit byl průnik s plným materiálem)."""
    s = sroubeni(kod)
    ob = s["obalka"]
    d = zavit(s["zavit"])["d"]
    add = []
    if s_zavitem:
        add.append({"cyl": {"p": [0, 0, -ob["zavit"]], "d": [0, 0, 1], "r": d / 2, "h": ob["zavit"]}})
    if s["druh"] == "qs":
        add += [_hex(s["sw"], 0.0, ob["hex_h"]),
                {"cyl": {"p": [0, 0, ob["hex_h"]], "d": [0, 0, 1], "r": ob["pouzdro_D"] / 2, "h": ob["soket"] - ob["hex_h"]}}]
        nazev = f"Šroubení Festo {kod} ({s['obj']}) — zástupná obálka, rozhraní z datového listu"
    elif s["druh"] == "grla":
        r = ob["teleso_D"] / 2
        add += [{"cyl": {"p": [0, 0, 0], "d": [0, 0, 1], "r": r, "h": ob["teleso_h"]}},
                {"cyl": {"p": [0, 0, s["vez_z"]], "d": [1, 0, 0], "r": ob["vez_D"] / 2, "h": s["vez_x"]}}]
        nazev = f"Škrticí ventil Festo {kod} ({s['obj']}) — zástupná obálka, věž +X"
    else:
        add.append({"cyl": {"p": [0, 0, 0], "d": [0, 0, 1], "r": ob["D"] / 2, "h": ob["L"]}})
        nazev = f"Tlumič Festo {kod} ({s['obj']}) — zástupná obálka"
    odh = ", ".join(ob.get("odhad") or [])
    return {"key": ("Sroubeni_" + kod + ("" if s_zavitem else "_bez_zavitu")).replace("/", "-").replace(".", "_"),
            "gen": "lib_body", "body": {"add": add}, "zastupny": True, "typ": "sroubeni", "nazev": nazev,
            "zdroj": [s["zdroj"]], "detail": "obálka", "material": "mosaz niklovaná / PBT",
            "poznamka": f"ODHAD obálky: {odh}" + ("" if s_zavitem else "; závit nemodelován (model válce port nemá)")}


def _usti(s: dict) -> tuple[list, list]:
    """Ústí soketu a směr hadice ven v místních souřadnicích dílu."""
    if s["druh"] == "grla":
        return [s["vez_x"], 0.0, s["vez_z"]], [1.0, 0.0, 0.0]
    return [0.0, 0.0, s["obalka"]["soket"]], [0.0, 0.0, 1.0]


def port(p: dict, s_zavitem: bool = True) -> dict:
    """Přípojka podle smlouvy → díl (spec), instance (poloha + natočení), hadice (cesta s poloměrem), zóna volného
    prostoru u ústí a souhrn. ``p["w"]`` = směr, kam se hadice po oblouku stočí (kolmý k ose ústí); u GRLA ``tower``."""
    s = sroubeni(p["fitting"])
    n = _n(p["n"])
    tower = _n(p.get("tower") or p.get("w") or [1, 0, 0])
    R = frame(n, tower)
    sp = spec(p["fitting"], s_zavitem)
    mul = lambda v: [sum(R[i][j] * v[j] for j in range(3)) for i in range(3)]  # noqa: E731
    out = {"id": p.get("id", ""), "kod": p["fitting"], "druh": s["druh"], "dil": sp,
           "instance": {"model": sp["key"], "pos": list(p["seat"]), "rot": R, "druh": "sroubeni"},
           "seat": list(p["seat"]), "n": n, "thread": s["zavit"], "zdroj": s["zdroj"]}
    if s["druh"] == "tlumic":
        return dict(out, hadice=None, zona=None)
    h = hadice_kod(p["hose"])
    if abs(h["D"] - s["hadice"]) > 1e-6:
        raise ValueError(f"{p['fitting']} je pro hadici Ø{s['hadice']}, ne {h['kod']}")
    mo, du = _usti(s)
    mouth = _add(p["seat"], mul(mo))
    u = mul(du)
    w = _n(p.get("w") or ([0, 0, 1] if s["druh"] == "grla" else tower))
    if abs(sum(u[i] * w[i] for i in range(3))) > 1e-6:
        raise ValueError("směr stočení hadice musí být kolmý k ose ústí")
    ved = DATA["vedeni"]
    Rb = float(h["R_prutok"])
    zasun = s["zasun"]
    if not s_zavitem and s["druh"] == "qs":
        # bez modelované díry portu nesmí čelo hadice pod dosed (vnikla by do plného materiálu protikusu) — ODHAD zkrácení
        zasun = min(zasun, s["obalka"]["soket"] - 1.0)
    a = _add(mouth, u, -zasun)                            # čelo hadice uvnitř šroubení (hloubka zasunutí z listu)
    b = _add(mouth, u, ved["rovny_usek_x_D"]["hodnota"] * h["D"])
    ctr = _add(b, w, Rb)
    c = _add(ctr, u, Rb)
    mid = _add(ctr, _n(_add(u, [-x for x in w])), Rb)
    e = _add(c, w, ved["konec_x_D"]["hodnota"] * h["D"])
    path = [{"line": [a, b]}, {"arc": [b, mid, c]}, {"line": [c, e]}]
    pr = DATA["prostor"]
    zr = h["D"] / 2 + pr["prsty_mm"]["hodnota"]
    zona = {"add": [{"cyl": {"p": mouth, "d": u, "r": zr, "h": pr["nasunuti_mm"]["hodnota"]}}]}
    delka = math.dist(a, b) + math.pi * Rb / 2 + math.dist(c, e)
    return dict(out, hadice={"kod": h["kod"], "nazev": h["nazev"], "r": h["D"] / 2, "D": h["D"], "R": Rb, "R_min": h["R_min"],
                             "path": path, "zacatek": e, "smer": w, "usti": mouth, "zasun": zasun, "zasun_list": s["zasun"],
                             "delka": round(delka, 1)},
                zona=zona, zona_r=zr, usti=mouth, osa_usti=u)


def tlumic_port(seat, n, kod: str = "U-1/8") -> dict:
    """Tlumič do odfuku (ventil / ostrov): jen díl na portu, bez hadice."""
    return port({"seat": seat, "n": n, "fitting": kod, "tower": _perp(n)})


def _perp(n):
    n = _n(n)
    t = [1, 0, 0] if abs(n[0]) < 0.9 else [0, 1, 0]
    c = _cross(n, t)
    return _n(c)


def ohyb_z_cesty(path) -> float:
    from .spojky_el import ohyb_z_cesty as f
    return f(path)


__all__ = ["frame", "zavit", "hadice", "hadice_kod", "volba_pro_valec", "sroubeni", "spec", "port", "tlumic_port",
           "ohyb_z_cesty", "PRIP", "DATA"]
