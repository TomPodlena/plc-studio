"""Voxelová dosažitelnost nebezpečných zón zvenku (numpy, volitelně scipy) — běží MIMO FreeCAD (vlastní proces).

Vstup ``tes.npz`` z ``fc_scan.py``: ``v`` (vrcholy float32 N×3), ``f`` (trojúhelníky int32 M×3), ``fo`` (offset
trojúhelníků každého tělesa), ``zone`` (1 = těleso je nebezpečná zóna), ``bb`` (obálka modelu). Překážky = povrch těles
(skořepina voxelů, vnitřek je od okolí oddělen), zóna = vyplněný objem. Pro každou mřížku (výchozí 5 / 4 / 3 mm):
spojitost volného prostoru od okraje oblasti k zóně → nejkratší cesta → nejužší místo cesty (e ≈ 2 × vzdálenost
k překážce) a vzdálenost Sr od nejužšího místa k zóně (přímkou = dolní mez, po dráze). Nalezený otvor se virtuálně
ucpe a hledá se další (nejvýš ``max_paths`` na mřížku). Voxely jen HLEDAJÍ cesty — e a Sr jsou odhady s přesností
kroku mřížky, vyhodnocení ISO 13857 je konzervativní (``rules.posud_otvor``) a nález je potřeba změřit v modelu.

Oblast lze omezit parametrem ``oblast`` [x0, x1, y0, y1, z0, z1] (``fc_scan``: obálka krytů / výplní + zón + okraj — celek
stroje; okraj oblasti leží VNĚ krytu, takže každá cesta zvenku krytem projde uvnitř oblasti). Hledání vzdálenosti = BFS
po čele vlny (seznam indexů) a končí, jakmile čelo dosáhne okraje oblasti (stačí nejkratší cesta).

    python voxel.py tes.npz out.json [params.json]
"""

from __future__ import annotations

import json
import sys
import time

import numpy as np

try:
    from scipy import ndimage
except ImportError:  # pragma: no cover — FreeCAD i Python311 stanice scipy mají
    ndimage = None

MAX_VOX = 64_000_000      # nejvýš voxelů jedné mřížky (paměť samostatného procesu: pole bool + int32, ~0,8 GB)
MAX_REACH = 1000.0        # mm — oblast kolem zóny (Sr tab. 4 nejvýš 850 mm)
LOCAL_REACH = 200.0       # mm — místní jemná mřížka, když se celá oblast nevejde
LOCAL_E_MAX = 12.0        # mm — z místní mřížky se berou jen malé otvory (tab. 4: Sr ≤ 100 mm)


def mark_triangles(arr: np.ndarray, v: np.ndarray, f: np.ndarray, org: np.ndarray, step: float, vox: float) -> None:
    """Označí voxely, kterými prochází povrch trojúhelníků (vzorkování po ``step`` < voxel); trojúhelníky celé mimo
    oblast se přeskočí (celek stroje — oblast jen kolem krytu)."""
    if len(f) == 0:
        return
    A, B, C = v[f[:, 0]], v[f[:, 1]], v[f[:, 2]]
    hi_d = org + np.array(arr.shape, np.float32) * vox
    tlo = np.minimum(np.minimum(A, B), C)
    thi = np.maximum(np.maximum(A, B), C)
    inn = np.all((thi >= org - vox) & (tlo <= hi_d + vox), axis=1)
    if not inn.all():
        A, B, C = A[inn], B[inn], C[inn]
        if len(A) == 0:
            return
    # vrchol A = začátek nejkratší hrany (A→B): mřížka nu × nw podél A→C a A→B ~ plocha trojúhelníku, ne čtverec nejdelší
    # hrany (dlouhé tenké trojúhelníky profilů / válců jinak dávaly miliony bodů na trojúhelník)
    lab, lbc, lca = np.linalg.norm(B - A, axis=1), np.linalg.norm(C - B, axis=1), np.linalg.norm(A - C, axis=1)
    i_bc = (lbc < lab) & (lbc <= lca)                  # nejkratší B→C: A' = B, B' = C, C' = A
    i_ca = (lca < lab) & (lca < lbc)                   # nejkratší C→A: A' = C, B' = A, C' = B
    A2, B2, C2 = A.copy(), B.copy(), C.copy()
    A2[i_bc], B2[i_bc], C2[i_bc] = B[i_bc], C[i_bc], A[i_bc]
    A2[i_ca], B2[i_ca], C2[i_ca] = C[i_ca], A[i_ca], B[i_ca]
    A, B, C = A2, B2, C2
    nw_ = np.maximum(1, np.ceil(np.linalg.norm(B - A, axis=1) / step)).astype(np.int64)
    nu_ = np.maximum(1, np.ceil(np.linalg.norm(C - A, axis=1) / step)).astype(np.int64)
    shp = np.array(arr.shape)
    key = nu_ * 100000 + nw_
    for kk in np.unique(key):
        sel = key == kk
        ku, kw = int(kk // 100000), int(kk % 100000)
        a, b, c = A[sel], C[sel], B[sel]               # b = směr u (A→C), c = směr w (A→B)
        uu, ww = np.meshgrid(np.arange(ku + 1), np.arange(kw + 1), indexing="ij")
        m = (uu / ku + ww / kw) <= 1.0 + 1e-9
        u = (uu[m] / ku).astype(np.float32)
        w = (ww[m] / kw).astype(np.float32)
        ch = max(1, int(3e6 // len(u)))
        for s0 in range(0, len(a), ch):
            a_, b_, c_ = a[s0:s0 + ch], b[s0:s0 + ch], c[s0:s0 + ch]
            P = a_[:, None, :] + (b_ - a_)[:, None, :] * u[None, :, None] + (c_ - a_)[:, None, :] * w[None, :, None]
            idx = np.floor((P.reshape(-1, 3) - org) / vox).astype(np.int64)
            ok = np.all((idx >= 0) & (idx < shp), axis=1)
            idx = idx[ok]
            arr[idx[:, 0], idx[:, 1], idx[:, 2]] = True


def _label(free: np.ndarray):
    if ndimage is not None:
        return ndimage.label(free)
    raise RuntimeError("scipy chybí — voxelová kontrola potřebuje scipy.ndimage")


def _fill(shell: np.ndarray) -> np.ndarray:
    if ndimage is not None:
        return ndimage.binary_fill_holes(shell)
    return shell


def _edt(mask: np.ndarray) -> np.ndarray:
    if ndimage is not None:
        return ndimage.distance_transform_edt(mask)
    return mask.astype(float)


def _bfs_dist(comp: np.ndarray, seeds: np.ndarray, stop: np.ndarray | None = None) -> np.ndarray:
    """Vzdálenost (kroky 6-okolí) od ``seeds`` v rámci ``comp`` — BFS po čele vlny jako seznam indexů (cena ~ počet
    navštívených voxelů, ne počet vln × celé pole). Se ``stop`` konec po vlně, která ``stop`` zasáhla (nejkratší cesta
    k okraji je tím známá — vzdálenosti dál zůstanou −1)."""
    sh = comp.shape
    cp = np.pad(comp, 1).ravel()                       # okraj False → sousedé bez kontroly mezí
    ps = (sh[0] + 2, sh[1] + 2, sh[2] + 2)
    offs = np.array([ps[1] * ps[2], -ps[1] * ps[2], ps[2], -ps[2], 1, -1], np.int64)
    dist = np.full(cp.size, -1, np.int32)
    stamp = np.empty(cp.size, np.int32)
    front = np.flatnonzero(np.pad(seeds & comp, 1).ravel())
    dist[front] = 0
    st = np.pad(stop, 1).ravel() if stop is not None else None
    d = 0
    if st is not None and front.size and st[front].any():
        front = front[:0]
    while front.size:
        d += 1
        nb = (front[:, None] + offs[None, :]).ravel()
        nb = nb[cp[nb]]
        nb = nb[dist[nb] < 0]
        if not nb.size:
            break
        stamp[nb] = np.arange(nb.size, dtype=np.int32)  # bez řazení: ponech jen poslední výskyt každého indexu
        nb = nb[stamp[nb] == np.arange(nb.size, dtype=np.int32)]
        dist[nb] = d
        if st is not None and st[nb].any():
            break
        front = nb
    return dist.reshape(ps)[1:-1, 1:-1, 1:-1]


_NB = ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1))


def _descend(dist: np.ndarray, start: tuple) -> list[tuple]:
    path = [start]
    p = start
    sh = dist.shape
    while dist[p] > 0:
        best = None
        for d in _NB:
            q = (p[0] + d[0], p[1] + d[1], p[2] + d[2])
            if 0 <= q[0] < sh[0] and 0 <= q[1] < sh[1] and 0 <= q[2] < sh[2] and 0 <= dist[q] < dist[p]:
                if best is None or dist[q] < dist[best]:
                    best = q
        if best is None:
            break
        p = best
        path.append(p)
    return path


def domain(bb_model, bb_zone, vox: float, reach: float = MAX_REACH, oblast=None):
    """Oblast výpočtu: obálka modelu + 3 voxely, oříznutá na zónu ± ``reach`` a na ``oblast`` (obálka krytu + okraj);
    (počátek, tvar, oříznuto)."""
    lo = np.array([bb_model[0], bb_model[2], bb_model[4]], float) - 3 * vox
    hi = np.array([bb_model[1], bb_model[3], bb_model[5]], float) + 3 * vox
    if oblast is not None:
        lo = np.maximum(lo, np.array([oblast[0], oblast[2], oblast[4]], float))
        hi = np.minimum(hi, np.array([oblast[1], oblast[3], oblast[5]], float))
    zlo = np.array([bb_zone[0], bb_zone[2], bb_zone[4]], float) - reach
    zhi = np.array([bb_zone[1], bb_zone[3], bb_zone[5]], float) + reach
    clo, chi = np.maximum(lo, zlo), np.minimum(hi, zhi)
    cropped = bool(np.any(clo > lo + 1e-6) or np.any(chi < hi - 1e-6))
    shape = np.maximum(1, np.ceil((chi - clo) / vox).astype(int))
    return clo, tuple(int(x) for x in shape), cropped


def reach_grid(v, f, fo, zone, bb_model, vox: float, max_paths: int = 4, max_vox: int = MAX_VOX,
               reach: float = MAX_REACH, oblast=None) -> dict:
    """Jedna mřížka: cesty z okolí k zónám (seznam nálezů s e, Sr a body cesty); ``oblast`` = omezení oblasti."""
    t0 = time.time()
    zi = [i for i in range(len(zone)) if zone[i]]
    if not zi:
        return {"vox": vox, "skipped": "bez zón"}
    zf = np.concatenate([f[fo[i]:fo[i + 1]] for i in zi])
    zv = v[np.unique(zf)]
    bbz = [float(zv[:, 0].min()), float(zv[:, 0].max()), float(zv[:, 1].min()), float(zv[:, 1].max()),
           float(zv[:, 2].min()), float(zv[:, 2].max())]
    org, shape, cropped = domain(bb_model, bbz, vox, reach, oblast)
    nvox = shape[0] * shape[1] * shape[2]
    if nvox > max_vox:
        return {"vox": vox, "skipped": f"mřížka {shape} = {nvox / 1e6:.0f} M voxelů > limit {max_vox / 1e6:.0f} M"}
    occ = np.zeros(shape, bool)
    haz = np.zeros(shape, bool)
    org32 = org.astype(np.float32)
    for i in range(len(zone)):
        fi = f[fo[i]:fo[i + 1]]
        if zone[i]:
            shell = np.zeros(shape, bool)
            mark_triangles(shell, v, fi, org32, vox / 3, vox)
            haz |= _fill(shell)
        else:
            mark_triangles(occ, v, fi, org32, vox / 3, vox)
    free = ~occ | haz
    found = []
    border = np.zeros(shape, bool)
    border[0] = border[-1] = True
    border[:, 0] = border[:, -1] = True
    border[:, :, 0] = border[:, :, -1] = True
    for _ in range(max_paths):
        lab, _n = _label(free)
        hz = set(np.unique(lab[haz]).tolist()) - {0}
        bd = set(np.unique(lab[border & free]).tolist()) - {0}
        labs = sorted(hz & bd)
        if not labs:
            break
        comp = np.isin(lab, labs)
        del lab
        dist = _bfs_dist(comp, haz, border)
        cand = np.argwhere(border & comp & (dist >= 0))
        if len(cand) == 0:
            break
        dd = dist[cand[:, 0], cand[:, 1], cand[:, 2]]
        start = tuple(int(x) for x in cand[int(np.argmin(dd))])
        path = _descend(dist, start)
        del dist, comp
        pa = np.array(path)
        # nejužší místo: EDT volného prostoru (bez zóny) v okolí cesty
        pad = int(np.ceil(80.0 / vox)) + 2
        lo = np.maximum(pa.min(0) - pad, 0)
        hi = np.minimum(pa.max(0) + pad + 1, np.array(shape))
        sub = (~occ)[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]].copy()
        edt = _edt(sub)
        r = np.array([edt[tuple(p - lo)] for p in pa]) * vox
        inside = np.array([haz[tuple(p)] for p in pa])
        okb = ~inside & ~np.array([border[tuple(p)] for p in pa])
        if not okb.any():
            okb = ~inside
        if not okb.any():      # zóna sahá až na okraj oblasti = bez krytu
            w0 = [round(float(x), 1) for x in (org + (pa[0] + 0.5) * vox)]
            found.append({"vox": vox, "e": 999.0, "sr_primka": 0.0, "sr_draha": 0.0, "nejuzsi": w0, "vstup": w0,
                          "draha": [w0], "delka_vox": len(path), "bez_krytu": True})
            break
        ri = np.where(okb, r, np.inf)
        j = int(np.argmin(ri))
        e = float(2.0 * ri[j])
        pb = org + (pa[j] + 0.5) * vox
        hv = np.argwhere(haz)
        best = np.inf
        for s0 in range(0, len(hv), 500_000):
            hc = org + (hv[s0:s0 + 500_000] + 0.5) * vox
            best = min(best, float(np.min(np.linalg.norm(hc - pb, axis=1))))
        k_in = next((k for k in range(j, len(pa)) if inside[k]), len(pa) - 1)
        sr_path = float((k_in - j) * vox)
        w = lambda p: [round(float(x), 1) for x in (org + (np.asarray(p) + 0.5) * vox)]
        found.append({"vox": vox, "e": round(e, 1), "sr_primka": round(max(0.0, best - vox), 1), "sr_draha": round(sr_path, 1),
                      "nejuzsi": w(pa[j]), "vstup": w(pa[0]), "draha": [w(p) for p in path[::max(1, len(path) // 25)]],
                      "body": [w(p) + [round((k_in - k) * vox, 1)] for k, p in enumerate(path[:k_in + 1])
                               if k % max(1, (k_in + 1) // 150) == 0 or k == j],
                      "delka_vox": len(path)})
        # ucpat celý nalezený otvor (souvislé úzké místo kolem nejužšího bodu) a hledat další
        c = pa[j]
        rad = int(np.ceil((e / 2 + 2 * vox) / vox))
        R = int(np.ceil(max(150.0, 3 * e) / vox))
        g0 = np.maximum(c - R, 0)
        g1 = np.minimum(c + R + 1, np.array(shape))
        sl = np.s_[g0[0]:g1[0], g0[1]:g1[1], g0[2]:g1[2]]
        loc = free[sl]
        e2 = _edt(~occ[sl]) * vox
        narrow = loc & (e2 <= ri[j] + 1.5 * vox) & ~haz[sl]
        if ndimage is not None:
            lab2, _n2 = ndimage.label(narrow)
            k2 = lab2[tuple(c - g0)]
            if k2:
                loc[lab2 == k2] = False
        ii, jj, kk = np.ogrid[g0[0]:g1[0], g0[1]:g1[1], g0[2]:g1[2]]
        ball = (ii - c[0]) ** 2 + (jj - c[1]) ** 2 + (kk - c[2]) ** 2 <= rad * rad
        loc[ball & ~haz[sl]] = False
    out = {"vox": vox, "grid": list(shape), "cropped": cropped, "reach": reach, "zone_bb": [round(x, 1) for x in bbz],
           "paths": found, "secs": round(time.time() - t0, 1)}
    if oblast is not None:
        out["oblast"] = [round(float(x), 1) for x in oblast]
    return out


def run(tes_path: str, params: dict | None = None) -> dict:
    p = params or {}
    grids = p.get("grids") or [5.0, 4.0, 3.0]
    d = np.load(tes_path)
    v, f, fo, zone = d["v"].astype(np.float32), d["f"].astype(np.int64), d["fo"].astype(np.int64), d["zone"].astype(bool)
    bb = [float(x) for x in d["bb"]]
    out = {"grids": []}
    mx = int(p.get("max_vox", MAX_VOX))
    ob = p.get("oblast")
    for g in grids:
        r = reach_grid(v, f, fo, zone, bb, float(g), int(p.get("max_paths", 4)), mx, oblast=ob)
        if r.get("skipped") and "limit" in r["skipped"]:
            # jemná mřížka celé oblasti se nevejde: jen okolí zón ± LOCAL_REACH — hledá malé otvory (e ≤ LOCAL_E_MAX),
            # velké otvory najde hrubší mřížka celé oblasti; okraj místní oblasti může ležet uvnitř stroje
            r2 = reach_grid(v, f, fo, zone, bb, float(g), int(p.get("max_paths", 4)), mx, LOCAL_REACH, oblast=ob)
            r2["lokalni"] = True
            r2["pozn"] = r["skipped"]
            r = r2
        out["grids"].append(r)
    return out


if __name__ == "__main__":
    prm = json.load(open(sys.argv[3], encoding="utf-8")) if len(sys.argv) > 3 else {}
    res = run(sys.argv[1], prm)
    json.dump(res, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False)
