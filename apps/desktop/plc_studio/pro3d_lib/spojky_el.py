"""Spojka V2 elektrická — konektor kabelu snímače (čistý Python, staví ``fc_lib.py``).

Obálka kabelové zásuvky M8 / M12 (přímá / úhlová), volný prostor pro nasunutí a prsty (pomocná zóna — nic jiného
modulu do ní nesmí), začátek kabelu: rovný úsek (odlehčení tahu, ohyb ne hned za koncovkou), oblouk s poloměrem
podle výrobce kabelu (``R_x`` × D, uložení pohyblivé — přísnější), rovný úsek. Data a zdroje ``data/spojky_el.json``;
poloměry kabelů jsou tytéž jako ve skillu kabelaz-a-hadice ``data/media.json``.

Geometrie: ``start`` = dosedací čelo zásuvky na konektoru snímače, ``u`` = osa zásuvky směrem od snímače, ``w`` = směr,
kam se kabel po oblouku stáčí (kolmý k ``u``)."""

from __future__ import annotations

import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = json.loads((HERE / "data" / "spojky_el.json").read_text(encoding="utf-8"))


def _add(a, b, k=1.0):
    return [a[i] + k * b[i] for i in range(3)]


def _norm(v):
    n = math.sqrt(sum(x * x for x in v))
    return [x / n for x in v]


def _dot(a, b):
    return sum(a[i] * b[i] for i in range(3))


def konektor_data(typ: str) -> dict:
    return dict(DATA["konektory"][typ])


def kodovani(kod: str) -> dict:
    return dict(DATA["kodovani_m12"][kod.upper()])


def polomer_ohybu(typ: str) -> float:
    k = DATA["konektory"][typ]
    return float(k["R_x"]) * float(k["kabel_D"])


def konektor(typ: str, start, u, w) -> dict:
    """Zásuvka ``typ`` na konektoru v ``start`` s osou ``u``; kabel se stočí do ``w``. Vrací těla (popis pro fc_lib),
    zónu nasunutí, cestu kabelu a souhrn (poloměr, délky) pro kontrolu bez FreeCADu."""
    k = DATA["konektory"][typ]
    pr = DATA["prostor"]
    u, w = _norm(u), _norm(w)
    if abs(_dot(u, w)) > 1e-6:
        raise ValueError("w musí být kolmé k u")
    r = k["D"] / 2
    if k.get("uhel") == 90:                         # úhlová: hlava v ose u (H), vývod kabelu do w (L)
        head_h = k["H"]
        body = {"add": [{"cyl": {"p": list(start), "d": u, "r": r, "h": head_h}},
                        {"cyl": {"p": _add(start, u, head_h - r), "d": w, "r": r, "h": k["L"] - r}}]}
        exit_p, exit_d = _add(_add(start, u, head_h - r), w, k["L"] - r), w
        zona_h = head_h + pr["nasunuti_mm"]["hodnota"]
    else:
        body = {"add": [{"cyl": {"p": list(start), "d": u, "r": r, "h": k["L"]}}]}
        exit_p, exit_d = _add(start, u, k["L"]), u
        zona_h = k["L"] + pr["nasunuti_mm"]["hodnota"]
    rf = r + pr["prsty_mm"]["hodnota"]
    zona = {"add": [{"cyl": {"p": list(start), "d": u, "r": rf, "h": zona_h}}]}
    Dk = float(k["kabel_D"])
    R = polomer_ohybu(typ)
    s0 = pr["rovny_usek_x_D"]["hodnota"] * Dk
    a = exit_p
    b = _add(a, exit_d, s0)
    # oblouk 90° v rovině (exit_d, bend) — bend = w u přímé, u u úhlové (kabel se pak stáčí k ose snímače nejde → −u)
    bend = w if k.get("uhel") != 90 else [-x for x in u]
    c = _add(b, exit_d, R)
    c = _add(c, bend, R)                            # konec oblouku
    ctr = _add(b, bend, R)                          # střed oblouku
    mid = _add(ctr, _norm(_add([-x for x in bend], exit_d)), R)
    dkon = _add(c, bend, 2 * Dk + 10.0)             # krátký rovný úsek za obloukem (začátek trasy)
    path = [{"line": [a, b]}, {"arc": [b, mid, c]}, {"line": [c, dkon]}]
    delka = s0 + math.pi * R / 2 + 2 * Dk + 10.0
    return {"typ": typ, "nazev": k["nazev"], "body": body, "zona": zona, "zona_r": rf, "zona_h": zona_h,
            "kabel": {"r": Dk / 2, "path": path, "R": R, "delka": round(delka, 1), "zacatek": a, "smer": exit_d},
            "odhad": bool(k.get("odhad")), "zdroj": k.get("zdroj", ""), "zdroj_popis": k.get("zdroj_popis", "")}


def kabel_vyvod(start, u, w, D: float, R: float, s0: float | None = None, konec: float | None = None) -> dict:
    """Začátek volného kabelu (bez konektoru — vývod přístroje / vývodka): rovný úsek ``s0`` (výchozí 3 × D podle
    ``prostor.rovny_usek_x_D``) ve směru ``u``, oblouk 90° o poloměru ``R`` do směru ``w``, rovný úsek ``konec``
    (výchozí 2 × D + 10). Vrací {r, path, R, delka} ve tvaru jako ``konektor()['kabel']``."""
    u, w = _norm(u), _norm(w)
    if abs(_dot(u, w)) > 1e-6:
        raise ValueError("w musí být kolmé k u")
    s0 = DATA["prostor"]["rovny_usek_x_D"]["hodnota"] * D if s0 is None else float(s0)
    konec = 2 * D + 10.0 if konec is None else float(konec)
    a = list(start)
    b = _add(a, u, s0)
    ctr = _add(b, w, R)
    c = _add(ctr, u, R)
    mid = _add(ctr, _norm(_add(u, [-x for x in w])), R)
    dk = _add(c, w, konec)
    return {"r": D / 2, "path": [{"line": [a, b]}, {"arc": [b, mid, c]}, {"line": [c, dk]}], "R": R,
            "delka": round(s0 + math.pi * R / 2 + konec, 1), "zacatek": a, "smer": u}


def ohyb_z_cesty(path) -> float:
    """Poloměr oblouku z cesty kabelu (3 body oblouku) — kontrola bez FreeCADu."""
    for seg in path:
        if "arc" in seg:
            p1, p2, p3 = seg["arc"]
            a = math.dist(p2, p3)
            b = math.dist(p1, p3)
            c = math.dist(p1, p2)
            s = (a + b + c) / 2
            area = math.sqrt(max(s * (s - a) * (s - b) * (s - c), 1e-12))
            return a * b * c / (4 * area)
    return float("inf")
