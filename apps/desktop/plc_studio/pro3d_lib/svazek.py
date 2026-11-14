"""Svazek hadic (P4 / rozvod P) — společné vedení po profilech rámu s úchytkami (zadání: skill kabelaz-a-hadice
references/vedeni-svazku.md, kap. 2, 3, 5).

Hadice se nehledají izolovaně se vzájemným blokováním: trasa se drží profilů rámu (router s vyšší preferencí profilu,
páteř do ``PREF_DOSAH`` od líce), dříve položené hadice NEJSOU překážkou — hadice téhož svazku jedou vedle sebe po stejném
profilu a kde se úseky kryjí, ``rozloz_pruhy`` posune úsek do vlastního pruhu (rozteč D1/2 + D2/2 + ``MEZERA``), takže trasy
se nekříží a nekolidují. Úchytky ``uchytky_hadic``: zástupný blok na líci profilu pod hadicí po ≤ ``ROZTEC_UCHYTEK``
(``PLCdesk_Mount = drazka``). Čísla označená ODHAD nemají zdroj."""
from __future__ import annotations

import math

from .modul_ram import _lib, r3

PREF_W = 0.35               # cena jednotky délky u profilu (router; 1,0 = jinde)
PREF_DOSAH = 14.0           # mm — pás kolem profilu, ve kterém je trasa levná (osa hadice pak do ~30 mm od líce)
MEZERA = 2.0                # mm — vůle mezi hadicemi ve svazku (zadání: D + 2 mm)
ROZTEC_UCHYTEK = 280.0      # mm — rozteč úchytek (ODHAD, ≤ 300 mm OPORA_MAX; zdroj výrobce nečten)
UCHYT_DOSAH = 250.0         # mm — největší vzdálenost osy hadice od líce profilu, ze které se úchytka staví
I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
ROT_NA_NORMALU = {          # otočení místní osy +z na normálu líce
    (0, 0, 1): I3, (0, 0, -1): [[1, 0, 0], [0, -1, 0], [0, 0, -1]],
    (1, 0, 0): [[0, 0, 1], [0, 1, 0], [-1, 0, 0]], (-1, 0, 0): [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
    (0, 1, 0): [[1, 0, 0], [0, 0, 1], [0, -1, 0]], (0, -1, 0): [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
}


def _box(a, b, r):
    return (min(a[0], b[0]) - r, min(a[1], b[1]) - r, min(a[2], b[2]) - r, max(a[0], b[0]) + r, max(a[1], b[1]) + r, max(a[2], b[2]) + r)


def _prekryv(x, y, tol=0.0):
    return all(x[k] < y[k + 3] - tol and x[k + 3] > y[k] + tol for k in range(3))


def kolize_s(body, r, boxes, tol=0.05):
    """Počet úseků lomené čáry (poloměr ``r``), které se překrývají s některým z ``boxes``."""
    return sum(1 for a, b in zip(body, body[1:]) if any(_prekryv(_box(a, b, r), bx, tol) for bx in boxes))


def _osa(a, b):
    d = [abs(b[k] - a[k]) for k in range(3)]
    return d.index(max(d)) if max(d) > 1e-6 else None


def _skore(pts, r, ub, obst):
    segs = [_box(pts[j], pts[j + 1], r) for j in range(1, len(pts) - 2)]       # první a poslední úsek = přípojky (nehýbou se)
    return (sum(1 for x in segs if any(_prekryv(x, o) for o in obst)), sum(1 for x in segs if any(_prekryv(x, u) for u in ub)))


def _kandidati(pts, i, r, hr):
    """Posuny úseku ``i`` jako pevný celek: vrchol i..k se posune po ose úseku i-1 (k = první následující úsek rovnoběžný
    s touto osou ho pohltí), nebo vrchol m+1..i+1 po ose úseku i+1 (pohlcení dozadu). První a poslední úsek se nehýbou."""
    n = len(pts)
    pitch = r + hr + MEZERA
    out = []
    if i >= 1:
        ax = _osa(pts[i - 1], pts[i])
        k = next((q for q in range(i + 1, n - 1) if _osa(pts[q], pts[q + 1]) == ax), None)
        if ax is not None and k is not None:
            out += [(list(range(i, k + 1)), ax, m * pitch) for m in (1, -1, 2, -2, 3, -3)]
    if i + 2 <= n - 1:
        ax = _osa(pts[i + 1], pts[i + 2])
        m_ = next((q for q in range(i - 1, -1, -1) if _osa(pts[q], pts[q + 1]) == ax), None)
        if ax is not None and m_ is not None:
            out += [(list(range(m_ + 1, i + 2)), ax, m * pitch) for m in (1, -1, 2, -2, 3, -3)]
    return out


def rozloz_pruhy(body, r, drive, obst, minL=0.0):
    """Posune úseky ``body`` (ortogonální lomená čára, první a poslední úsek = přípojky), které kolidují s dříve položenými
    hadicemi ``drive`` [(body, r)], do vlastního pruhu (rozteč ``r + r_jiné + MEZERA``): úsek se posouvá s navazujícím
    řetězem úseků po ose sousedního úseku, který změnu délky pohltí. Vrací nové body, nebo None."""
    pts = [list(p) for p in body]
    ub = [bx for h_b, h_r in drive for bx in [_box(a, b, h_r) for a, b in zip(h_b, h_b[1:])]]
    hr = max([h_r for _hb, h_r in drive] + [r])
    for _ in range(60):
        o0, u0 = _skore(pts, r, ub, obst)
        if o0:
            return None
        if u0 == 0:
            return pts
        hits = [i for i in range(1, len(pts) - 2) if any(_prekryv(_box(pts[i], pts[i + 1], r), u) for u in ub)]
        best = None
        for idx, ax, sh in [c for h_ in hits for c in _kandidati(pts, h_, r, hr)]:
            cand = [list(p) for p in pts]
            for q in idx:
                cand[q][ax] += sh
            if any(math.dist(cand[j], cand[j + 1]) < max(1.0, minL) and math.dist(cand[j], cand[j + 1]) < math.dist(pts[j], pts[j + 1]) - 1e-6
                   for j in range(len(cand) - 1)):                   # zkrácený úsek musí dál pojmout ohyb (minL = 2R + 2)
                continue
            o1, u1 = _skore(cand, r, ub, obst)
            if o1 == 0 and u1 < u0 and (best is None or (u1, abs(sh)) < best[0]):
                best = ((u1, abs(sh)), cand)
        if best is None:
            return None
        pts = best[1]
    return None


def spec_uchytky(r_hadice: float, h: float) -> dict:
    """Zástupná úchytka hadice na líci profilu: čtverec (2r − 0,4) × výška ``h`` (od líce k dolní straně hadice)."""
    a = round(2 * r_hadice - 0.4, 2)
    h = round(h, 1)
    return _lib(f"Uchyt_hadice_{a:g}_{h:g}", {"add": [{"box": [-a / 2, a / 2, -a / 2, a / 2, 0, h]}]},
                f"Úchytka hadice Ø{2 * r_hadice:g} na profilu (zástupná, výška {h:g} mm)",
                "ODHAD — úchytka do drážky (ALUTEC 623040 obdobně); rozměry výrobce neuvádí, výška = vzdálenost hadice od líce",
                "obálka", typ="prislusenstvi", material="PA6", pozn="zástupná obálka úchytky; stahovací páska nemodelována", zastupny=True)


def _nejblizsi_profil(p, profily):
    """(vzdálenost osy od líce, osa normály, znaménko, box) nejbližšího profilu, na který se vejde úchytka."""
    best = None
    for bx in profily:
        out = [max(bx[k] - p[k], p[k] - bx[k + 3], 0.0) for k in range(3)]
        if sum(1 for v in out if v > 0) != 1:                      # bod leží přímo nad / vedle jedné plochy (ne přes hranu, ne uvnitř)
            continue
        ax = next(k for k in range(3) if out[k] > 0)
        sg = 1 if p[ax] > bx[ax + 3] else -1
        if best is None or out[ax] < best[0]:
            best = (out[ax], ax, sg, bx)
    return best


def _d2(p, a, b):
    """Vzdálenost bodu od úsečky v půdorysu (x, y)."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 < 1e-9 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2))
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)


def uchytky_hadic(hoses: list, profily: list):
    """Úchytky po ≤ ``ROZTEC_UCHYTEK`` na úsecích hadic do ``UCHYT_DOSAH`` od líce profilu. Vrací (dily, instance, statistika)."""
    dily, inst, stat = {}, [], {"hadic": 0, "uchytek": 0, "bez_opory_mm": 0.0}
    for h in hoses:
        body, r = h.get("body"), h["r"]
        if not body:
            continue
        stat["hadic"] += 1
        for a, b in zip(body, body[1:]):
            L = math.dist(a, b)
            if L < 1e-6:
                continue
            n = max(1, int(math.ceil(L / ROZTEC_UCHYTEK)))
            cands = [([a[k] + ((j + 0.5) / n) * (b[k] - a[k]) for k in range(3)], True) for j in range(n)]
            if abs(b[2] - a[2]) < 1e-6:                          # úsek přejíždějící profil: úchytka v místě přejezdu (jinak by minula)
                for bx in profily:
                    lo, hi = 0.0, 1.0
                    for k in (0, 1):
                        d_ = b[k] - a[k]
                        if abs(d_) < 1e-9:
                            if not (bx[k] + 3.0 <= a[k] <= bx[k + 3] - 3.0):
                                hi = -1.0
                        else:
                            t0, t1 = sorted(((bx[k] + 3.0 - a[k]) / d_, (bx[k + 3] - 3.0 - a[k]) / d_))
                            lo, hi = max(lo, t0), min(hi, t1)
                    if hi > lo:
                        tm = (lo + hi) / 2
                        cands.append(([a[k] + tm * (b[k] - a[k]) for k in range(3)], False))
            for p, reg in cands:
                nb = _nejblizsi_profil(p, profily)
                if nb is None or nb[0] > UCHYT_DOSAH or nb[0] - r < 3.0:
                    stat["bez_opory_mm"] += L / n if reg else 0.0
                    continue
                dist, ax, sg, bx = nb
                o = [k for k in range(3) if k != ax]
                if any(not (bx[k] + 3.0 <= p[k] <= bx[k + 3] - 3.0) for k in o):
                    stat["bez_opory_mm"] += L / n if reg else 0.0
                    continue
                if ax == 2 and sg > 0 and any(                       # stojka úchytky nesmí projít jinou hadicí pod touto
                        o is not h and o.get("body") and any(
                            min(a2[2], b2[2]) < p[2] and _d2(p, a2, b2) < r + o["r"] + 1.0 for a2, b2 in zip(o["body"], o["body"][1:]))
                        for o in hoses):
                    stat["bez_opory_mm"] += L / n if reg else 0.0
                    continue
                pos = list(p)
                pos[ax] = bx[ax + 3] if sg > 0 else bx[ax]
                sp = spec_uchytky(r, dist - r)
                dily[sp["key"]] = sp
                nrm = [0, 0, 0]
                nrm[ax] = sg
                inst.append({"model": sp["key"], "pos": r3(pos), "rot": ROT_NA_NORMALU[tuple(nrm)], "druh": "uchyt", "mount": "drazka",
                             "props": {"Konstrukce_Spoj": "úchytka hadice na líci profilu (zástupná, v drážce)", "Konstrukce_Hadice": h.get("name", "")}})
                stat["uchytek"] += 1
    return list(dily.values()), inst, stat
