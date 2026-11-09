"""Pravoúhlý router tras kabelů a hadic mezi překážkami (čistý Python, bez závislostí).

Mřížka je nepravidelná: pravidelné čáry po ``krok`` mm + souřadnice obou konců (konec trasy pak leží přesně na mřížce).
A* nad stavem (uzel, směr, ujetá délka od posledního ohybu); ohyb je dovolený jen po rovném úseku ≥ ``2 R + rezerva``
(tečné délky dvou sousedních oblouků R · tan 45° — pravidlo skillu kabelaz-a-hadice, ``scripts/trasa.py`` zaobli), aby se
oblouky vešly. Překážky = osově zarovnané kvádry ``[x0, y0, z0, x1, y1, z1]`` zvětšené o poloměr média + vůli; uzly
u profilů rámu jsou levnější (trasa se drží rámu — úchytky na profil). Volitelně smí trasa projít tenkou deskou rámu
(„průchod“) za vysokou cenu — průchody se vrátí zvlášť (požadavek na rám, trasa se pak nestaví)."""

from __future__ import annotations

import heapq
import math

LAST = {}
AXES = ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1))


def inflate(b, d):
    return (b[0] - d, b[1] - d, b[2] - d, b[3] + d, b[4] + d, b[5] + d)


def seg_hits(p, q, box) -> bool:
    """Osově rovnoběžná úsečka p–q × kvádr (otevřený — dotyk plochou neblokuje)."""
    for k in range(3):
        lo, hi = min(p[k], q[k]), max(p[k], q[k])
        if hi - lo < 1e-9:
            if not (box[k] < lo < box[k + 3]):
                return False
        elif hi <= box[k] or lo >= box[k + 3]:
            return False
    return True


def point_in(p, box) -> bool:
    return all(box[k] < p[k] < box[k + 3] for k in range(3))


class Grid:
    def __init__(self, lo, hi, step, extra):
        self.c = []
        for k in range(3):
            n = max(1, int(math.ceil((hi[k] - lo[k]) / step)))
            vals = {round(lo[k] + i * step, 3) for i in range(n + 1)}
            vals |= {round(e[k], 3) for e in extra if lo[k] - 1e-6 <= e[k] <= hi[k] + 1e-6}
            self.c.append(sorted(vals))
        self.ix = [{v: i for i, v in enumerate(a)} for a in self.c]

    def pt(self, n):
        return (self.c[0][n[0]], self.c[1][n[1]], self.c[2][n[2]])

    def node(self, p):
        return tuple(self.ix[k][round(p[k], 3)] for k in range(3))


def _bucket(boxes, cell=100.0):
    idx = {}
    for i, b in enumerate(boxes):
        for x in range(int(math.floor(b[0] / cell)), int(math.floor(b[3] / cell)) + 1):
            for y in range(int(math.floor(b[1] / cell)), int(math.floor(b[4] / cell)) + 1):
                for z in range(int(math.floor(b[2] / cell)), int(math.floor(b[5] / cell)) + 1):
                    idx.setdefault((x, y, z), []).append(i)
    return idx, cell


def route(start, s_dir, goal, g_dir, obstacles, *, R, clear=3.0, r_med=3.0, step=20.0, margin=300.0, plates=None,
          prefer=None, max_nodes=150000, cross_cost=600.0):
    """Trasa z bodu ``start`` (konec výstupního úseku, směr ``s_dir`` = směr, kterým trasa z konce odchází) do ``goal``
    (konec vstupního úseku, ``g_dir`` = směr, kterým trasa do cíle přichází — dál pokračuje k přípojce).

    Vrátí ``{"body": [...], "delka": mm, "pruchody": [{"box": i, "bod": p}], "uzlu": n}`` nebo ``None``.
    ``plates`` = kvádry, kterými smí trasa projít (průchod za ``cross_cost``), ``prefer`` = kvádry, u kterých je trasa
    levnější (×0,7)."""
    infl = r_med + clear
    obs = [inflate(b, infl) for b in obstacles]
    pl = [inflate(b, infl) for b in (plates or [])]
    pref = [inflate(b, infl + 25.0) for b in (prefer or [])]
    lo = [min(start[k], goal[k]) - margin for k in range(3)]
    hi = [max(start[k], goal[k]) + margin for k in range(3)]
    keep = [b for b in obs if all(b[k] < hi[k] and b[k + 3] > lo[k] for k in range(3))]
    keep_pl = [b for b in pl if all(b[k] < hi[k] and b[k + 3] > lo[k] for k in range(3))]
    if any(point_in(start, b) for b in keep) or any(point_in(goal, b) for b in keep):
        LAST["fail"] = "start" if any(point_in(start, b) for b in keep) else "cil"
        return None
    grid = Grid(lo, hi, step, [start, goal])
    bidx, cell = _bucket(keep)
    pidx, _ = _bucket(keep_pl)
    fidx, _ = _bucket(pref)

    def near(idx, boxes, p, q):
        out = set()
        for x in range(int(math.floor(min(p[0], q[0]) / cell)), int(math.floor(max(p[0], q[0]) / cell)) + 1):
            for y in range(int(math.floor(min(p[1], q[1]) / cell)), int(math.floor(max(p[1], q[1]) / cell)) + 1):
                for z in range(int(math.floor(min(p[2], q[2]) / cell)), int(math.floor(max(p[2], q[2]) / cell)) + 1):
                    out.update(idx.get((x, y, z), ()))
        return [boxes[i] for i in out]

    edge_cache = {}

    def edge(a, b):
        key = (a, b) if a < b else (b, a)
        if key in edge_cache:
            return edge_cache[key]
        p, q = grid.pt(a), grid.pt(b)
        blocked = any(seg_hits(p, q, bx) for bx in near(bidx, keep, p, q))
        crossed = None
        if blocked:
            res = (False, None)
        else:
            for bx in near(pidx, keep_pl, p, q):
                if seg_hits(p, q, bx):
                    crossed = bx
                    break
            res = (True, crossed)
        edge_cache[key] = res
        return res

    def nearpref(p):
        return any(point_in(p, bx) for bx in near(fidx, pref, p, p))

    need = 2.0 * R + 2.0
    s_node, g_node = grid.node(start), grid.node(goal)
    sd = AXES.index(tuple(int(round(v)) for v in s_dir))
    gd = AXES.index(tuple(int(round(v)) for v in g_dir))
    gp = grid.pt(g_node)

    def h(n):              # vážená heuristika (rychlost před optimem — trasa nemusí být nejkratší)
        p = grid.pt(n)
        return 2.0 * (abs(p[0] - gp[0]) + abs(p[1] - gp[1]) + abs(p[2] - gp[2]))

    # stav: (uzel, směr, rovně ujeto (omezeno na need), počet průchodů)
    start_state = (s_node, sd, need, 0)
    openh = [(h(s_node), 0.0, start_state)]
    best = {start_state[:3]: 0.0}
    parent = {start_state: None}
    cross_at = {}
    nodes = 0
    found = None
    while openh:
        f, g, st = heapq.heappop(openh)
        node, d, run, nc = st
        if g > best.get(st[:3], 1e18) + 1e-9:          # zastaralý záznam fronty
            continue
        if node == g_node and d == gd and run >= min(R + 1.0, need):
            found = st
            break
        nodes += 1
        if nodes > max_nodes:
            break
        for nd in range(6):
            if AXES[nd][0] == -AXES[d][0] and AXES[nd][1] == -AXES[d][1] and AXES[nd][2] == -AXES[d][2]:
                continue
            if nd != d and run < need - 1e-6:
                continue
            ax = next(k for k in range(3) if AXES[nd][k])
            i = node[ax] + AXES[nd][ax]
            if i < 0 or i >= len(grid.c[ax]):
                continue
            nn = list(node)
            nn[ax] = i
            nn = tuple(nn)
            ok, cr = edge(node, nn)
            if not ok:
                continue
            p, q = grid.pt(node), grid.pt(nn)
            L = abs(q[ax] - p[ax])
            cost = L * (0.7 if nearpref(q) else 1.0) + (30.0 if nd != d else 0.0)
            ncr = nc
            if cr is not None:
                if plates is None:
                    continue
                cost += cross_cost
                ncr = nc + 1
            nrun = (run if nd == d else 0.0) + L
            nrun = need if nrun >= need else math.floor(nrun / 10.0) * 10.0     # kvantování dolů (bezpečná strana)
            ns = (nn, nd, nrun, ncr)
            ng = g + cost
            key = ns[:3]
            if ng < best.get(key, 1e18) - 1e-9:
                best[key] = ng
                parent[ns] = st
                if cr is not None:
                    cross_at[ns] = (cr, ((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2))
                heapq.heappush(openh, (ng + h(nn), ng, ns))
    LAST["uzlu"] = nodes
    if found is None:
        LAST["fail"] = "limit uzlu" if nodes > max_nodes else "bez cesty"
        return None
    path, crossings = [], []
    st = found
    while st is not None:
        path.append(grid.pt(st[0]))
        if st in cross_at:
            crossings.append({"box": [round(v, 1) for v in cross_at[st][0]], "bod": [round(v, 1) for v in cross_at[st][1]]})
        st = parent[st]
    path.reverse()
    pts = [path[0]]
    for i in range(1, len(path) - 1):
        a, b, c = pts[-1], path[i], path[i + 1]
        u = [b[k] - a[k] for k in range(3)]
        v = [c[k] - b[k] for k in range(3)]
        cross = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
        if max(abs(x) for x in cross) > 1e-6:
            pts.append(b)
    pts.append(path[-1])
    L = sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
    return {"body": [[round(v, 3) for v in p] for p in pts], "delka": round(L, 1), "pruchody": crossings[::-1], "uzlu": nodes}


def segments_boxes(points, r):
    """Kvádry kolem úseků lomené čáry (překážka pro další trasy)."""
    out = []
    for a, b in zip(points, points[1:]):
        out.append((min(a[0], b[0]) - r, min(a[1], b[1]) - r, min(a[2], b[2]) - r,
                    max(a[0], b[0]) + r, max(a[1], b[1]) + r, max(a[2], b[2]) + r))
    return out
