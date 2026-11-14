"""Pevná dráha svazku hadic určená kódem (zadání: skill kabelaz-a-hadice references/vedeni-svazku.md).

Router se nepoužívá: každá hadice dostane vlastní výškovou hladinu nad ústími a 2D pravoúhlý tvar, který vede přes kmen
nad nosným profilem rámu (nejbližší dlouhý vodorovný profil). Hadice se nekříží z konstrukce — jedou v různých hladinách
(rozteč 2r + 2 + 1 mm) a pořadí hladin vyplyne z omezení „vodorovný úsek jedné hadice nesmí projet svislou přípojkou jiné
pod jejím vrcholem“ (topologické řazení). Úsek mezi dvěma ohyby je ≥ 2R + 1 mm (R = poloměr ohybu výrobce). Čísla
označená ODHAD nemají zdroj."""
from __future__ import annotations

import math

from .svazek import _box, _prekryv, kolize_s


LAST: dict = {}


def _in(p, bx, infl=0.0):
    return all(bx[k] - infl <= p[k] <= bx[k + 3] + infl for k in range(3))


def _d2seg(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 < 1e-9 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2))
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)


def _d2poly(p, P):
    return min(_d2seg(p, a, b) for a, b in zip(P, P[1:]))


def _clean(P):
    """Vyhodí body s nulovou délkou úseku a body ležící na přímce; None, když zbyl jediný bod."""
    out = [tuple(P[0])]
    for q in P[1:]:
        if math.dist(q, out[-1]) >= 1e-6:
            out.append(tuple(q))
    i = 1
    while i < len(out) - 1:
        a, b, c = out[i - 1], out[i], out[i + 1]
        cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
        dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1])
        if abs(cross) < 1e-6 and dot > 0:
            del out[i]
        else:
            i += 1
    return out if len(out) >= 2 else None


def _tvary(s, e, xT, R):
    """Pravoúhlé 2D tvary (kmen přes ``xT`` první, pak ostatní podle délky); každý úsek ≥ 2R + 1."""
    mn = 2 * R + 1.0
    kand = [[s, (xT, s[1]), (xT, e[1]), e]] if xT is not None else []
    rest = [[s, (e[0], s[1]), e], [s, (s[0], e[1]), e]]
    for off in (mn, 2 * mn, 3 * mn):
        for sg in (1, -1):
            rest.append([s, (s[0], e[1] + sg * off), (e[0], e[1] + sg * off), e])
            rest.append([s, (e[0] + sg * off, s[1]), (e[0] + sg * off, e[1]), e])
    rest.sort(key=lambda P: sum(math.dist(a, b) for a, b in zip(P, P[1:])))
    out = []
    for P in kand + rest:
        P = _clean(P)
        if P and all(math.dist(a, b) >= mn - 1e-6 for a, b in zip(P, P[1:])):
            out.append(P)
    return out


def _obs_pro(allobs, s):
    infl = s["r"] + 3 + 0.15 * s["R"] + 0.5
    return [bx for bx in allobs if not (_in(s["p1"], bx, infl) or _in(s["p2"], bx, infl))]


def plan_svazek(specs: list, obst: list, rails: list, fixed: list | None = None, mezera: float = 1.0) -> dict:
    """Dráhy hadic svazku. ``specs`` = [{hid, p1, p2, r, R, up}] (up = obě ústí svisle nahoru); ``rails`` = profily rámu;
    ``fixed`` = [(body, r)] už položené hadice (překážky). Vrací {hid: [body]} jen pro hadice, které prošly kontrolou;
    nejde-li svazek sestavit (tvar nebo pořadí hladin), vrací {}."""
    sp = [s for s in specs if s.get("up")]
    if not sp:
        return {}
    n = len(sp)
    cx = sum(s["p1"][0] for s in sp) / n
    cy = sum(s["p1"][1] for s in sp) / n
    zlow = min(min(s["p1"][2], s["p2"][2]) for s in sp)
    best = None
    for bx in rails or []:
        ex, ey, ez = bx[3] - bx[0], bx[4] - bx[1], bx[5] - bx[2]
        if max(ex, ey) < 400 or ez > 120 or bx[5] > zlow - 5:
            continue
        osa_y = ey >= ex
        d = abs((bx[0] + bx[3]) / 2 - cx) if osa_y else abs((bx[1] + bx[4]) / 2 - cy)
        if best is None or d < best[0]:
            best = (d, osa_y, (bx[0] + bx[3]) / 2 if osa_y else (bx[1] + bx[4]) / 2)
    xT = best[2] if best and best[1] else None          # kmen podél osy y (jiná osa: bez kmene, jen nejkratší tvary)
    rm = max(s["r"] for s in sp)
    Rm = max(s["R"] for s in sp)
    pitch = 2 * rm + 2.0 + mezera
    zbase = max(max(s["p1"][2], s["p2"][2]) for s in sp) + Rm + 2.0
    zhi = zbase + (n - 1) * pitch + rm
    allobs = list(obst) + [_box(a, b, hr) for hb, hr in (fixed or []) for a, b in zip(hb, hb[1:])]
    tvall = []
    for s in sp:
        obs = _obs_pro(allobs, s)
        vse = []
        for cand in _tvary(s["p1"][:2], s["p2"][:2], xT, s["R"]):
            bxs = [_box((a[0], a[1], zbase - s["r"]), (b[0], b[1], zhi), s["r"] + 1.0) for a, b in zip(cand, cand[1:])]
            bxs += [_box((p[0], p[1], s["p1"][2]), (p[0], p[1], zhi), s["r"] + 1.0) for p in (cand[0], cand[-1])]
            if not any(_prekryv(b, o) for b in bxs for o in obs):
                vse.append(cand)
        if not vse:
            LAST["fail"] = f"tvar: {s['hid']}"
            return {}
        tvall.append(vse)

    def razeni(idx):
        """(pořadí hladin, hadice v cyklu / za cyklem, dotyk přípojek) pro vybrané tvary ``idx``."""
        tv_ = [tvall[i][idx[i]] for i in range(n)]
        nxt = {i: set() for i in range(n)}
        for k in range(n):
            for pt in (tv_[k][0], tv_[k][-1]):
                for j in range(n):
                    if j == k:
                        continue
                    lim = sp[j]["r"] + sp[k]["r"] + mezera
                    if _d2poly(pt, tv_[j]) < lim:
                        if math.dist(pt, tv_[j][0]) < lim or math.dist(pt, tv_[j][-1]) < lim:
                            return None, None, f"dotyk pripojek: {sp[k]['hid']} x {sp[j]['hid']}"
                        nxt[k].add(j)
        indeg = {i: 0 for i in range(n)}
        for k in nxt:
            for j in nxt[k]:
                indeg[j] += 1
        order, ready = [], sorted(i for i in indeg if indeg[i] == 0)
        while ready:
            i = ready.pop(0)
            order.append(i)
            for j in sorted(nxt[i]):
                indeg[j] -= 1
                if indeg[j] == 0:
                    ready.append(j)
            ready.sort()
        return order, [i for i in range(n) if i not in order], ""

    idx = [0] * n
    order, left, why = razeni(idx)
    for _ in range(80):                                   # cyklus v omezeních → vyměnit tvar hadice z cyklu za jiný
        if why:
            LAST["fail"] = why
            return {}
        if not left:
            break
        best = (len(left), None)
        for k in left:
            for q in range(len(tvall[k])):
                if q == idx[k]:
                    continue
                o2, l2, w2 = razeni(idx[:k] + [q] + idx[k + 1:])
                if not w2 and len(l2) < best[0]:
                    best = (len(l2), (k, q))
        if best[1] is None:
            break
        idx[best[1][0]] = best[1][1]
        order, left, why = razeni(idx)
    if why or left:
        LAST["fail"] = why or "cyklus v poradi hladin"
        return {}
    tv = [tvall[i][idx[i]] for i in range(n)]
    rank = {i: r_ for r_, i in enumerate(order)}
    out = {}
    for i, s in enumerate(sp):
        z = zbase + rank[i] * pitch
        pts = [list(s["p1"])] + [[p[0], p[1], z] for p in tv[i]] + [list(s["p2"])]
        if not kolize_s(pts, s["r"] + 1.0, _obs_pro(allobs, s)):
            out[s["hid"]] = pts
    return out


def plan_rozvod(spec: dict, obst: list, fixed: list, krok: float = 9.0) -> list | None:
    """Rozvod P (ústí vodorovně po ose y, příjezd po ose x ve směru ``arrive``): p1 → po y k y cíle → svisle do hladiny zh →
    po x → svisle na z cíle → p2. Hladina ``zh`` se zkouší od výšky ústí nahoru / dolů, dokud trasa neprojde kontrolou proti
    ``obst`` a ``fixed`` [(body, r)]. None, když to nejde."""
    p1, p2, r, R = spec["p1"], spec["p2"], spec["r"], spec["R"]
    mn = 2 * R + 1.0
    allobs = list(obst) + [_box(a, b, hr) for hb, hr in fixed for a, b in zip(hb, hb[1:])]
    obs = _obs_pro(allobs, spec)
    xd = p2[0] - spec.get("arrive", 1) * mn
    for m in range(0, 70):
        for sg in ((1,) if m == 0 else (1, -1)):
            zh = p1[2] + (0 if m == 0 else sg * (mn + (m - 1) * krok))
            if m and abs(zh - p2[2]) < mn:
                continue
            pts = [list(p1), [p1[0], p2[1], p1[2]], [p1[0], p2[1], zh], [xd, p2[1], zh], [xd, p2[1], p2[2]], list(p2)]
            out = [pts[0]]
            for q in pts[1:]:
                if math.dist(q, out[-1]) > 1e-6:
                    out.append(q)
            if len(out) < 3:
                continue
            if all(math.dist(a, b) >= mn - 1e-6 for a, b in list(zip(out, out[1:]))[1:-1]) and not kolize_s(out, r + 1.0, obs):
                return out
    return None
