"""Napojení schválených modulů PLCdesk PRO do generátoru modulů (čistý Python, bez FreeCADu):

* **smlouva N1** (``ram/N1_<id>.json``, modul_ram): kam šroubovat — osy drážek profilů s volnými úseky (``plochy``),
  pracovní deska a její závity (``deska``), průchody (``pruchody``); souřadnice smlouvy + ``rozmery.umisteni`` = stroj;
* **pneumatika P2 / P3 / P4** (``pro3d_lib.modul_ostrov``): rozváděče s vazbou ``actuates`` na liště (ostrov P3) a úprava
  vzduchu P2 (uzávěr → filtr-regulátor → bezpečnostní ventil MS6-SV-E jen se ``safety`` manifestu) na volném úseku drážky
  rámu podle smlouvy; hadice P4 z ústí šroubení ostrova k válcům staví router generátoru modulů (``layout.route_all``),
  rozvod P z úpravy vzduchu do lišty je součástí modulu. Model ``moduly/Pneumatika.FCStd`` staví ``pro3d_lib/fc_lib.py``
  (cli.py), do ``Moduly.FCStd`` jde jako App::Link (skupina ``G-pneu`` — průnik s rámem ověří fc_modules).

Bez smlouvy N1 nebo bez modulu ``modul_ostrov`` zůstává dosavadní chování (zástupné rozváděče z konceptu)."""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
GROUP = "G-pneu"
MODEL = "Pneumatika"
SNAP_TOL = 25.0           # mm — bod upevnění k ose drážky (jako slot_lines)
END_FREE = 10.0           # mm — odstup od konce volného úseku drážky


def _mo():
    """``pro3d_lib.modul_ostrov`` (sourozenec; balík plc_studio jen kvůli relativním importům knihovny)."""
    root = str(HERE.parents[1])
    if root not in sys.path:
        sys.path.insert(0, root)
    try:
        from plc_studio.pro3d_lib import modul_ostrov, modul_valec  # type: ignore  # noqa: E402
    except Exception:  # noqa: BLE001
        return None, None
    return modul_ostrov, modul_valec


def load_n1(folder: Path) -> dict | None:
    fs = sorted((Path(folder) / "ram").glob("N1_*.json"))
    if not fs:
        return None
    try:
        d = json.loads(fs[0].read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if d.get("modul") != "N1":
        return None
    d["_soubor"] = f"ram/{fs[0].name}"
    return d


def origin(n1: dict) -> list:
    return list(((n1 or {}).get("rozmery") or {}).get("umisteni") or [0.0, 0.0, 0.0])


def _add(a, b, k=1.0):
    return [a[i] + k * b[i] for i in range(3)]


def _dot(a, b):
    return sum(a[i] * b[i] for i in range(3))


def _cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def faces(n1: dict, normal) -> list[dict]:
    """Plochy smlouvy s normálou ``normal`` v souřadnicích stroje: {prvek, p0, dir, L, free, profil80}."""
    o = origin(n1)
    out = []
    for f in (n1 or {}).get("plochy") or []:
        if _dot(f["normala"], normal) < 0.99:
            continue
        p0 = _add(f["osa_od"], o)
        p1 = _add(f["osa_do"], o)
        L = math.dist(p0, p1)
        out.append({"prvek": f["prvek"], "p0": p0, "dir": list(f["smer"]), "L": L, "free": f["volne_useky_mm"],
                    "profil80": f.get("profil80"), "role": f.get("role")})
    return out


def snap(n1: dict, head, n_dir, bb=None) -> dict | None:
    """Bod šroubu ``head`` se dříkem ``n_dir`` → osa drážky smlouvy (plocha s normálou −n_dir), je-li do SNAP_TOL.
    ``bb`` = obálka profilu scény (osa musí ležet na jeho líci). Vrací {ok, p, prvek} / {ok: False, obsazeno, prvek} / None."""
    best = None
    for f in faces(n1, [-c for c in n_dir]):
        d = [head[i] - f["p0"][i] for i in range(3)]
        s = _dot(d, f["dir"])
        if s < -1 or s > f["L"] + 1:
            continue
        lat = _add(d, f["dir"], -s)
        nrm = abs(_dot(lat, n_dir))                  # vzdálenost roviny líce od hlavy (≈ tloušťka našeho dílu)
        side = math.sqrt(max(_dot(lat, lat) - nrm * nrm, 0.0))
        if side > SNAP_TOL:
            continue
        p = _add(f["p0"], f["dir"], s)
        if bb is not None and not all(bb[i] - 1.0 <= p[i] <= bb[i + 3] + 1.0 for i in range(3)):
            continue
        free = any(a + END_FREE <= s <= b - END_FREE for a, b in f["free"])
        cand = (side, free, f, s)
        if best is None or (free and not best[1]) or (free == best[1] and side < best[0]):
            best = cand
    if best is None:
        return None
    side, free, f, s = best
    if not free:
        return {"ok": False, "obsazeno": True, "prvek": f["prvek"], "s": round(s, 1)}
    return {"ok": True, "p": [round(x, 3) for x in _add(f["p0"], f["dir"], s)], "prvek": f["prvek"], "s": round(s, 1)}


def deska_info(n1: dict, head, n_dir, t) -> dict | None:
    """Šroub svisle dolů na pracovní desku N1: požadovaný závit a odstup od šroubů desky podle smlouvy."""
    dk = (n1 or {}).get("deska")
    if not dk or n_dir[2] > -0.99:
        return None
    o = origin(n1)
    z = dk["z_lic"] + o[2]
    if abs(head[2] - t - z) > 2.0:
        return None
    pt = [head[0], head[1], z]
    near = min((math.dist(pt, _add(p, o)) for p in dk.get("srouby_desky") or []), default=1e9)
    return {"z": z, "zavity": dk.get("zavity") or {}, "odstup": round(near, 1), "odstup_min": dk.get("odstup_od_sroubu_mm", 15),
            "soubor": n1.get("_soubor", "")}


def pozadavky_n1(predani: list) -> list[dict]:
    """Požadavky modulů na rám ve formátu ``modul_ram`` (``pozadavky`` = průchody {co, bod, d}) — pro opakovanou stavbu rámu."""
    import re
    out = []
    for p in predani:
        m = re.search(r"průchod Ø(\d+(?:\.\d+)?)", p.get("co") or "")
        if m and p.get("bod"):
            out.append({"co": p["co"], "bod": p["bod"], "d": float(m.group(1)), "proc": p.get("proc", "")})
    return out


def compare(n1: dict, predani: list) -> dict:
    """Požadavky na rám × smlouva N1: průchody, které rám už má (do 30 mm), závity do desky, drážky."""
    o = origin(n1)
    have = [_add(p.get("bod") or p.get("stred") or [0, 0, -1e6], o) for p in (n1.get("pruchody") or []) if isinstance(p, dict)]
    pr = pozadavky_n1(predani)
    ok = [p for p in pr if any(math.dist(p["bod"], h) <= 30.0 for h in have)]
    return {"soubor": n1.get("_soubor", ""), "pruchody": len(pr), "pruchody_v_ramu": len(ok), "pruchody_chybi": len(pr) - len(ok),
            "zavity_deska": sum(1 for p in predani if p.get("smlouva") == "deska"),
            "drazky_obsazene": sum(1 for p in predani if p.get("smlouva") == "drazka_obsazena")}


# --- pneumatika ------------------------------------------------------------------------------------------------------

def _rows(ex, ey, ez):
    return [[ex[i], ey[i], ez[i]] for i in range(3)]


def _mv(R, v):
    return [sum(R[i][j] * v[j] for j in range(3)) for i in range(3)]


def _box(R, o, bb):
    pts = []
    for x in (bb[0], bb[3]):
        for y in (bb[1], bb[4]):
            for z in (bb[2], bb[5]):
                pts.append(_add(o, _mv(R, [x, y, z])))
    return [round(min(p[k] for p in pts), 2) for k in range(3)] + [round(max(p[k] for p in pts), 2) for k in range(3)]


def island(pl) -> dict | None:
    """Rozmístí ostrov P3 + úpravu vzduchu P2 na volný úsek drážky rámu podle smlouvy N1 (``pl`` = layout.Plan po
    ``collect_devices`` a ``cylinders``). Vrací záznam do layoutu (plán fc_lib, porty, přiřazení) nebo None."""
    mo, mv = _mo()
    if mo is None or not getattr(pl, "n1", None):
        return None
    zm = mo.z_manifestu(pl.m)
    vent = [v for v in zm["ventily"] if v.get("valec") and str(v.get("obj")) in mo.D["ventily"]]
    if not vent:
        return None
    parts = pl.m.get("parts") or []
    by_cat = {}
    for p in parts:
        by_cat.setdefault(p.get("category"), []).append(p)
    sv = pl.m.get("safety") is not None
    ids = {"EM1": (by_cat.get("air_shutoff") or [{}])[0].get("id"), "LFR": (by_cat.get("air_prep") or [{}])[0].get("id"),
           "SV": (by_cat.get("safety_valve") or [{}])[0].get("id") if sv else None}
    man_id = (by_cat.get("valve_manifold") or [{}])[0].get("id") or ""
    ident = (man_id.split(":")[0] if man_id else "-WP1")
    try:
        p2 = mo.uprava("-P2", 0.0, 0.0, sv=sv, ids={k: v for k, v in ids.items() if v})
        xo = p2["rozhrani"]["vystup_P"]["usti"][0] + 2 * (54 + 20.7 + 20) + 20.1 + 10 - 60.0     # = lavice_p234 (oblouky PUN-10)
        p3 = mo.ostrov(ident, [{"tag": v["tag"], "valec": v["valec"]} for v in vent], xo, 0.0, lista_id=man_id)
    except Exception as exc:  # noqa: BLE001
        pl.nepostaveno.append({"id": "pneumatika P2/P3", "co": "ostrov a úprava vzduchu", "duvod": f"modul_ostrov: {exc}"})
        return None
    hs, why_h = [], ""
    try:
        hs = [mo.hadice_p2_p3(p2, p3)]
    except Exception as exc:  # noqa: BLE001
        why_h = str(exc)
    b2, b3 = p2["rozhrani"]["obalka"], p3["rozhrani"]["obalka"]
    lb = [min(b2[i], b3[i]) for i in range(3)] + [max(b2[i + 3], b3[i + 3]) for i in range(3)]
    Lx = lb[3] - lb[0]
    cyl = [d for d in pl.devices if d["cat"] == "cylinder" and d.get("bb")]
    target = ([sum((d["bb"][k] + d["bb"][k + 3]) / 2 for d in cyl) / len(cyl) for k in range(3)] if cyl else None)
    best = None
    for f in faces(pl.n1, [0.0, 0.0, 1.0]):
        for a, b in f["free"]:
            if b - a < Lx + 2 * END_FREE:
                continue
            for sgn in (1, -1):                        # podél drážky oběma směry (přední strana modulu = −y místně)
                ex = [sgn * c for c in f["dir"]]
                ez = [0.0, 0.0, 1.0]
                ey = _cross(ez, ex)
                R = _rows(ex, ey, ez)
                for s in (a + END_FREE, (a + b) / 2 - Lx / 2, b - END_FREE - Lx):
                    s0 = s if sgn > 0 else s + Lx           # místní x0 = začátek modulu
                    o = _add(f["p0"], f["dir"], s0 - sgn * lb[0])
                    box = _box(R, o, lb)
                    shrink = [box[0] + 1, box[1] + 1, box[2] + 1, box[3] - 1, box[4] - 1, box[5] - 1]
                    if not pl.free_box(shrink):
                        continue
                    front = -ey[1] if abs(ey[1]) > 0.5 else 0.0          # ovládání k přední straně stroje (−y)
                    dist = math.dist([(box[0] + box[3]) / 2, (box[1] + box[4]) / 2, (box[2] + box[5]) / 2], target) if target else 0.0
                    score = dist - 200.0 * front
                    if best is None or score < best[0]:
                        best = (score, o, R, box, f, s)
    if best is None:
        pl.nepostaveno.append({"id": "pneumatika P2/P3", "co": f"ostrov {ident} ({len(vent)} rozváděčů) a úprava vzduchu",
                               "duvod": f"smlouva N1 nemá volný úsek drážky shora ≥ {Lx + 2 * END_FREE:.0f} mm bez kolize — místo doplní "
                                        "stavitel (rozváděče zůstaly zástupné z konceptu)"})
        return None
    _s, o, R, box, f, s = best
    pl_ = {"pos": [round(x, 3) for x in o], "rot": R}
    p4 = {"typ": "P4 hadice", "tag": "-P4", "nazev": "P4 — rozvod P: úprava vzduchu → lišta", "dily": [], "instance": [], "telesa": [],
          "kabely": [{k: v for k, v in h.items() if k != "vysledek"} for h in hs], "skupiny": [],
          "props": {"Konstrukce_Generator": mo.GEN, "Konstrukce_Modul": "P4"}, "placement": pl_}
    mods = [dict(p2, placement=pl_), dict(p3, placement=pl_)] + ([p4] if hs else [])
    plan = {"format": "pro3d-lib-plan", "verze": 1, "generator": "pro3d_modules/pneu", "model": MODEL,
            "nazev": f"Pneumatika stroje: úprava vzduchu P2 + ostrov {ident} P3" + (" + bezpečnostní ventil (NÁVRH)" if sv else ""),
            "dily": mv._uniq([sp for m in mods for sp in m["dily"]]), "moduly": mods, "snimky_prefix": "pneumatika",
            "snimky": ["iso"]}
    item = pl.item(druh="model", skupina=GROUP, model=f"moduly/{MODEL}.FCStd", base=[0.0, 0.0, 0.0],
                   osy=[[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]], bb=box,
                   label=f"Pneumatika P2 + P3 {ident} (pro3d_lib.modul_ostrov, App::Link)", zdroj=mo.GEN,
                   upevneni=f"{len(p2['rozhrani']['kotveni']) + len(p3['rozhrani']['kotveni'])} × M6 matice T v drážce „{f['prvek']}“ "
                            f"(smlouva N1, úsek od {s:.0f} mm)")
    pl.groups[GROUP] = {"co": plan["nazev"], "pid": ""}
    ports = {}
    for q in p3["rozhrani"]["pripojky"]:
        ports[(q["ventil"], q["port"])] = {"mouth": [round(x, 3) for x in _add(o, _mv(R, q["usti"]))],
                                          "n": [round(x, 6) for x in _mv(R, q["osa_usti"])], "item": item["id"], "host": item["id"],
                                          "zasun": q["zasun"], "id": q["id"]}
    el = {}
    for e, v in zip(p3["rozhrani"]["elektro"], vent):
        el[v["tag"]] = ([round(x, 3) for x in _add(o, _mv(R, e["zacatek"]))], [round(x, 6) for x in _mv(R, e["smer"])])
    covered = {v["partId"] for v in vent} | {x for x in ids.values() if x} | ({man_id} if man_id else set())
    for d in pl.devices:
        if d["pid"] not in covered:
            continue
        tag = d["tag"]
        if d["pid"] in {v["partId"] for v in vent}:
            d.update(src="ostrov", item=item["id"], grp=GROUP)
            if tag in el:
                d["conn"], d["conn_n"] = el[tag]
        else:
            d.update(src="ostrov_bez_kabelu", item=item["id"], grp=GROUP)
    pl.nepostaveno[:] = [x for x in pl.nepostaveno if str(x.get("id", "")).split("#")[0] not in covered]
    if sv and ids.get("SV"):
        pl.nepostaveno.append({"id": f"kabel {ids['SV']}", "co": "kabel bezpečnostního ventilu MS6-SV-E (Sub-D, M8)",
                               "duvod": "rozhraní V2 Sub-D nedoloženo — kabel doplní stavitel; ventil = NÁVRH ke schválení"})
    if why_h:
        pl.nepostaveno.append({"id": "H-P (P2 → P3)", "co": "hadice rozvodu P", "duvod": why_h})
    pl.odhady.update({f"pneumatika: {x}" for x in (p2["rozhrani"].get("odhady") or [])[:3] + (p3["rozhrani"].get("odhady") or [])[:3]})
    pl.odhady.add(f"ostrov a úprava vzduchu na volném úseku drážky „{f['prvek']}“ podle smlouvy N1 — poloha (nejblíž válcům, ovládání "
                  "k přední straně) = ODHAD k odsouhlasení")
    return {"plan": plan, "ports": {f"{k[0]}.{k[1]}": v for k, v in ports.items()}, "item": item["id"], "ident": ident,
            "ventily": [v["tag"] for v in vent], "sv": sv, "box": box, "prvek": f["prvek"],
            "hadice_P": [h["vysledek"] for h in hs], "uzaver": p2["rozhrani"].get("uzaver"),
            "bezpecnost": p2["rozhrani"].get("bezpecnost")}
