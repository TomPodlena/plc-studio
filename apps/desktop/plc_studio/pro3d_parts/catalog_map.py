"""Mapování řádků manifestu PLCdesk (``PLCdesk_CAD.json`` v2: ``parts[].category / type / orderCode / brand``) na generátor
normalizovaného dílu (čistý Python, bez FreeCADu a bez importu z ``plc_studio``).

``spec_for_part(part)`` → specifikace modelu (``key``, ``gen``, ``params``, ``zdroj``, ``detail``, ``typ``…) nebo
``(None, důvod)``. Rozměry jen z tabulek ``data/*.json`` se zdrojem — co v tabulce není, generátor nevytvoří a díl
zůstane zástupný (oranžová obálka stavitele). ``spec_for_request("ISO4762 M6x20")`` = díl na vyžádání (spojovací
materiál, lišta TS35, vývodka, válec podle normy).
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

try:
    from . import typy
except ImportError:          # spuštěno jako skript (gen.py / FreeCAD)
    import typy  # type: ignore

DATA = Path(__file__).resolve().parent / "data"
STAV_DOK = "dle dokumentace"
STAV_ZAST = "zástupný"
MATERIAL_TYP = {"hliník": "dil", "kov": "dil", "plast": "dil", "ocel": "dil"}


@lru_cache(maxsize=None)
def load(name: str) -> dict:
    return json.loads((DATA / f"{name}.json").read_text(encoding="utf-8"))


def _katalog() -> dict:
    return {typy.norm_code(k): v for k, v in load("katalog")["polozky"].items()}


def _tap(d: float, p: float) -> float:
    """Závitový otvor = Ø vrtáku d − P (ISO 2306)."""
    return round(d - p, 3)


def _kk(s: str) -> tuple[float, float]:
    d, p = typy.parse_thread(s) or (0.0, None)
    return d, (p or 0.0)


# ISO 228-1:2000 tab. 1 — vnější průměr trubkového závitu G (mm)
G_THREAD = {"G1/8": 9.728, "G1/4": 13.157, "G3/8": 16.662, "G1/2": 20.955}


def cylinder_spec(norma: str, prumer: int, zdvih: int, extra_src: str = "", nazev: str = "") -> tuple[dict | None, str]:
    tab = load("valce")
    key = {"ISO 15552": "iso15552", "ISO 6432": "iso6432"}.get(norma or "")
    if not key:
        return None, f"válec mimo normu ISO 15552 / ISO 6432 (rozměry řady v tabulce nejsou)"
    t = tab[key]
    row = t["rady"].get(str(prumer))
    if not row:
        return None, f"{norma} Ø{prumer}: průměr není v tabulce ({t['zdroj']})"
    if not (0 < zdvih <= 3000):
        return None, f"{norma} Ø{prumer}: neplatný zdvih {zdvih}"
    p = dict(row, prumer=prumer, zdvih=zdvih)
    kd, kp = _kk(row["KK"])
    p["KK_d"] = kd
    if key == "iso15552":
        rd, rp = _kk(row["RT"])
        p["RT_tap"] = _tap(rd, rp)
        # přípojky EE na horní ploše, PL od čela víka (SMC CP96 str. A 133); otvor = Ø závitu G (ISO 228-1) − 1,2 mm
        # (vrták pro závit, ODHAD), hloubka 10 mm (ODHAD — katalog neuvádí)
        g = G_THREAD.get(str(row.get("EE") or ""))
        if g and row.get("PL"):
            p["EE_hole"] = round(g - 1.2, 3)
            p["EE_depth"] = 10.0
        gen, mat, typ_k = "valec_iso15552", "hliník", "ISO15552"
    else:
        gen, mat, typ_k = "valec_iso6432", "ocel", "ISO6432"
        p["BE_d"] = _kk(row["BE"])[0]
    src = [t["zdroj"]] + ([extra_src] if extra_src else [])
    return {"key": f"{typ_k}_{prumer}x{zdvih}", "gen": gen, "params": p, "nazev": nazev or f"Válec {norma} Ø{prumer} × {zdvih}",
            "zdroj": src, "zdroj_popis": t["zdroj_popis"], "detail": "tvar", "typ": "dil", "material": mat,
            "poznamka": t["poznamka"]}, ""


def _safe(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", s).strip("_")[:60] or "dil"


def katalog_spec(code: str) -> dict | None:
    it = _katalog().get(typy.norm_code(code))
    if not it:
        return None
    params = {k: v for k, v in it.items() if k not in ("gen", "nazev", "material", "detail", "zdroj", "poznamka")}
    return {"key": _safe(typy.norm_code(code)), "gen": it["gen"], "params": params, "nazev": it["nazev"],
            "zdroj": [it["zdroj"]], "zdroj_popis": "", "detail": it["detail"], "typ": MATERIAL_TYP.get(it["material"], "dil"),
            "material": it["material"], "poznamka": it.get("poznamka", "")}


# řádky pneumatiky kusovníku jádra, které staví modul P2 / P3 (pro3d_lib.modul_ostrov) jako zástupné obálky s doloženými
# rozhraními — rozměrové výkresy Festo (VABM, MS6) nedostupné (ftp.festo.com nemá rozměry)
MODUL_P2_P3 = {
    "valve_manifold": "lišta rozváděčů = modul P3 (pro3d_lib.modul_ostrov) — rozteč 16 ze zdroje, obrys zástupný (výkres Festo nedostupný)",
    "air_shutoff": "uzávěr MS6-EM1 = modul P2 (pro3d_lib.modul_ostrov) — rastr 62 a porty ze zdroje, obrys zástupný (výkres nedostupný)",
    "air_prep": "filtr-regulátor MS6-LFR = modul P2 (pro3d_lib.modul_ostrov) — rastr 62 a porty ze zdroje, obrys zástupný (výkres nedostupný)",
}


def spec_for_part(part: dict) -> tuple[dict | None, str]:
    """Řádek manifestu → (spec, "") nebo (None, důvod, proč díl zůstane zástupný)."""
    cat = part.get("category") or ""
    code = part.get("orderCode") or ""
    typ = part.get("type") or ""
    if cat in MODUL_P2_P3:      # lišta / uzávěr / filtr-regulátor (2026-11-04): tvar staví modul P2 / P3, ne generátor dílů
        return None, MODUL_P2_P3[cat]
    if code:
        s = katalog_spec(code)
        if s:
            return s, ""
    # typ může začínat kódem (např. „IFS204 — …“, „WL12-3P2431 — …“)
    head = re.split(r"\s+[—–-]\s+", typ, maxsplit=1)[0].strip()
    if head and head != typ:
        s = katalog_spec(head)
        if s:
            return s, ""
    if cat == "cylinder" or re.search(r"\bISO\s*(15552|6432)\b", typ):
        c = typy.parse_cylinder(typ, code)
        if c:
            s, why = cylinder_spec(c["norma"], c["prumer"], c["zdvih"], c["zdroj"],
                                   f"Válec {c['rada']} Ø{c['prumer']} × {c['zdvih']} ({c['norma'] or 'mimo normu'})")
            if s:
                s["poznamka"] = (s["poznamka"] + f" Typ v kusovníku: {head or typ}.").strip()
                return s, ""
            return None, why
        return None, "typ válce nerozpoznán (parser Festo DSBC / DSNU, SMC CP96 / C96 / C85 / CJ2)"
    if not code and not typ:
        return None, "řádek bez typu a kódu"
    return None, f"{cat}: typ / kód „{code or head}“ není v tabulkách rozměrů se zdrojem"


def spec_for_request(req: str) -> tuple[dict | None, str]:
    """Díl na vyžádání: ISO4762 / ISO7380 / ISO10642 M6x20, ISO4032 / ISO7089 M6, TS35 7.5x500, SKINTOP M20,
    ISO15552 32x100, ISO6432 20x50, nebo objednací kód / typ válce."""
    pr = typy.parse_part_request(req)
    if not pr:
        s = katalog_spec(req)
        if s:
            return s, ""
        c = typy.parse_cylinder(req)
        if c:
            return cylinder_spec(c["norma"], c["prumer"], c["zdvih"], c["zdroj"])
        return None, f"neznámý požadavek „{req}“"
    kind, arg = pr
    n = load("normalie")
    if kind in ("ISO15552", "ISO6432"):
        m = re.match(r"^(\d+)x(\d+)$", arg, re.I)
        if not m:
            return None, f"{kind}: očekávám <Ø>x<zdvih>"
        return cylinder_spec("ISO " + kind[3:], int(m.group(1)), int(m.group(2)))
    if kind in ("ISO4762", "ISO7380", "ISO10642"):
        m = re.match(r"^(M\d+)x(\d+(?:\.\d+)?)$", arg, re.I)
        if not m:
            return None, f"{kind}: očekávám M<d>x<délka>"
        size, length = m.group(1).upper(), float(m.group(2))
        t = n[kind]
        row = t["rady"].get(size)
        if not row:
            return None, f"{kind} {size}: velikost není v tabulce"
        if not (0 < length <= 400):
            return None, f"{kind}: neplatná délka {length}"
        p = dict(row, d=float(size[1:]), l=length, velikost=size)
        return {"key": f"{kind}_{size}x{length:g}", "gen": "sroub_" + kind[3:], "params": p, "nazev": f"{kind} {size}×{length:g}",
                "zdroj": [t["zdroj"]], "zdroj_popis": t["zdroj_popis"], "detail": "tvar", "typ": "sroub", "material": "ocel",
                "poznamka": "závit nemodelován — dřík jmenovitého Ø"}, ""
    if kind in ("ISO4032", "ISO7089"):
        size = arg.upper()
        t = n[kind]
        row = t["rady"].get(size)
        if not row:
            return None, f"{kind} {size}: velikost není v tabulce"
        d = float(size[1:])
        p = dict(row, d=d, velikost=size)
        if kind == "ISO4032":
            p["tap"] = _tap(d, row["P"])
        return {"key": f"{kind}_{size}", "gen": "matice" if kind == "ISO4032" else "podlozka", "params": p,
                "nazev": f"{t['nazev']} {kind} {size}", "zdroj": [t["zdroj"]], "zdroj_popis": t["zdroj_popis"], "detail": "tvar",
                "typ": "matice" if kind == "ISO4032" else "podlozka", "material": "ocel", "poznamka": ""}, ""
    if kind == "TS35":
        m = re.match(r"^(7\.5|7,5|15)x(\d+(?:\.\d+)?)$", arg, re.I)
        if not m:
            return None, "TS35: očekávám 7.5x<délka> nebo 15x<délka>"
        h, length = m.group(1).replace(",", "."), float(m.group(2))
        t = n["TS35"]
        row = t["rady"][h]
        if not (0 < length <= 2000):
            return None, f"TS35: neplatná délka {length}"
        return {"key": f"TS35x{h}_{length:g}", "gen": "lista_ts35", "params": dict(row, l=length), "nazev": f"Lišta TS35 × {h} × {length:g}",
                "zdroj": [row["zdroj"]], "zdroj_popis": t["zdroj_popis"], "detail": "tvar", "typ": "dil", "material": "ocel",
                "poznamka": "bez perforace"}, ""
    if kind == "SKINTOP":
        t = n["SKINTOP_ST-M"]
        row = t["rady"].get(arg.upper())
        if not row:
            return None, f"SKINTOP {arg}: velikost není v tabulce"
        return {"key": f"SKINTOP_ST-M_{arg.upper()}", "gen": "vyvodka", "params": dict(row), "nazev": f"Vývodka Lapp SKINTOP ST-M {arg.upper()}x1,5",
                "zdroj": [t["zdroj"]], "zdroj_popis": t["zdroj_popis"], "detail": "obálka", "typ": "prislusenstvi", "material": "plast",
                "poznamka": "šestihran + kopule jako obálka šestihranu"}, ""
    return None, f"neznámý druh {kind}"


def map_manifest(manifest: dict) -> dict:
    """Celý manifest → ``{"parts": {id: {...}}, "specs": {key: spec}}`` (bez FreeCADu)."""
    out: dict = {"parts": {}, "specs": {}}
    for p in manifest.get("parts") or []:
        pid = p.get("id") or ""
        s, why = spec_for_part(p)
        row = {"category": p.get("category") or "", "type": p.get("type") or "", "orderCode": p.get("orderCode") or "",
               "brand": p.get("brand") or "", "qty": p.get("qty") or 1, "location": p.get("location") or ""}
        if s:
            out["specs"].setdefault(s["key"], s)
            row.update(stav=STAV_DOK, model=s["key"], zdroj=s["zdroj"], detail=s["detail"], generator=s["gen"])
        else:
            row.update(stav=STAV_ZAST, duvod=why)
        out["parts"][pid] = row
    return out


def coverage(mapped: dict) -> dict:
    parts = mapped["parts"].values()
    n = len(mapped["parts"])
    dok = sum(1 for r in parts if r["stav"] == STAV_DOK)
    ks = sum(int(r["qty"] or 1) for r in mapped["parts"].values())
    ks_dok = sum(int(r["qty"] or 1) for r in mapped["parts"].values() if r["stav"] == STAV_DOK)
    return {"radku": n, "dle_dokumentace": dok, "zastupne": n - dok, "pokryti_pct": round(100.0 * dok / n, 1) if n else 0.0,
            "kusu": ks, "kusu_dle_dokumentace": ks_dok, "modelu": len(mapped["specs"])}
