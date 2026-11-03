# -*- coding: utf-8 -*-
"""Kontroly 3D modelu ve FreeCADu (headless, jen čte — nic neukládá do modelu). Spouští ``run.py`` přes
``run_fc.ps1 run`` (vlastní instance). argv: [skript, model.FCStd, out.json, opts.json]

Průchod sestavou: kořeny dokumentu → App::Part / skupiny (s umístěním) → App::Link na kontejner (umístění odkazu,
LinkTransform) i na těleso → listy s globálním tvarem (``Part.getShape(o, transform=False)`` × umístění cesty, jako
ověřené skripty K5 stroje 01). Zdroje odkazů (``SRC_*``, objekty, na které ukazuje App::Link) a spotřebované základy
booleanů se přeskočí. Výsledek se zapisuje průběžně po každé kontrole (pád = co doběhlo, zůstane)."""
import itertools
import json
import math
import os
import sys
import time
import traceback

import FreeCAD as App
import Part

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rules  # noqa: E402

V = App.Vector
MODEL, OUTF, OPTF = sys.argv[1:4]
OPT = json.load(open(OPTF, encoding="utf-8"))
CHECKS = OPT.get("checks") or ["kolize", "souvislost", "zasunuti", "kopie", "otvory", "kusovnik", "step"]
TOL = float(OPT.get("tol", 0.2))              # mm — dotyk
VOL_TOL = float(OPT.get("vol_tol", 0.5))      # mm³ — průnik pod touto mezí = dotyk (zaokrouhlení booleanu)
R = {"model": MODEL, "checks": {}, "t": {}}
T0 = time.time()
CONTAINERS = ("App::Part", "App::DocumentObjectGroup", "App::DocumentObjectGroupPython")
SKIP_TYPES = ("App::Origin", "App::Line", "App::Plane", "App::Point", "Spreadsheet::Sheet", "App::FeaturePython",
              "App::LinkGroup")


def save():
    R["t"]["celkem"] = round(time.time() - T0, 1)
    tmp = OUTF + ".tmp"
    json.dump(R, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, default=str)
    os.replace(tmp, OUTF)


def props(o):
    out = {}
    for k in o.PropertiesList:
        if k.startswith(("PLCdesk_", "Konstrukce_", "Placeholder", "PLM_", "Zona_")):
            try:
                v = getattr(o, k)
            except Exception:  # noqa: BLE001
                continue
            out[k] = v if isinstance(v, (str, int, float, bool)) else str(v)
    return out


def bbl(bb):
    return [round(x, 2) for x in (bb.XMin, bb.XMax, bb.YMin, bb.YMax, bb.ZMin, bb.ZMax)]


doc = App.openDocument(MODEL)
# externí dokumenty odkazů načíst celé (částečně načtený dokument nemá tvary)
for o in list(doc.Objects):
    if o.TypeId == "App::Link":
        lo = o.LinkedObject
        if lo is not None and lo.Document is not doc and getattr(lo.Document, "FileName", ""):
            try:
                App.openDocument(lo.Document.FileName)
            except Exception:  # noqa: BLE001
                pass
doc = App.getDocument(doc.Name)
R["doc"] = doc.Name

link_sources = set()
for d in App.listDocuments().values():
    for o in d.Objects:
        if o.TypeId == "App::Link" and o.LinkedObject is not None:
            link_sources.add((o.LinkedObject.Document.Name, o.LinkedObject.Name))


def consumed(o):
    """Základ booleanu / prvku: nadřazený objekt není kontejner ani odkaz."""
    for p in o.InList:
        if p.TypeId in CONTAINERS or p.TypeId == "App::Link":
            continue
        if p.isDerivedFrom("Part::Feature"):
            return True
    return False


def _zjed(pr):
    """Zjednodušený model bez děr: zástupný díl nebo díl dle dokumentace jen jako obálka (Konstrukce_Detail)."""
    return rules.je_zastupny(pr) or "obalka" in rules.fold(pr.get("Konstrukce_Detail") or "")


LEAVES = []      # {key, label, name, doc, path, typ, s, bb, pohyb, props}
PLC_OBJS = []    # díly s PLCdesk_Id (kusovník)
SKIPPED = {"zdroje": 0, "pomocne": 0, "prazdne": 0, "chyby_tvaru": []}


def walk(o, plc, path, inh):
    """inh = zděděné: {"zona": bool, "pohyb": dict|None, "ids": set (PLCdesk_Id předků), "lnk": list přes App::Link,
    "src": bool předek je cíl odkazu}."""
    if o.TypeId in SKIP_TYPES or o.TypeId.startswith("App::Origin"):
        return
    pr = props(o)
    if o.TypeId == "App::Link" and o.LinkedObject is not None and o.LinkedObject.TypeId not in CONTAINERS:
        # odkaz na těleso: druh / materiál dílu ze zdroje (Konstrukce_*), vlastní vlastnosti odkazu mají přednost;
        # PLCdesk_* (kusovník) a Konstrukce_Pohyb (absolutní souřadnice zdroje) se nedědí
        pr = {**{k: v for k, v in props(o.LinkedObject).items() if k.startswith("Konstrukce_") and k != "Konstrukce_Pohyb"},
              **pr}
    lab = o.Label
    fl = rules.fold(lab)
    zona = False                 # nebezpečí jen výslovně (rules.typ_dilu), ne podle skupiny „Zóny“
    pm = rules.pohyb(pr) or inh["pohyb"]
    pid = pr.get("PLCdesk_Id") or ""
    ids = inh["ids"]
    if pid and pid not in ids:
        PLC_OBJS.append({"id": pid, "inst": pr.get("PLCdesk_Instance", ""), "label": lab, "path": "/".join(path + [lab]),
                         "status": pr.get("PLCdesk_ModelStatus", ""), "guid": pr.get("PLCdesk_ProjectGuid", ""),
                         "obj": f"{o.Document.Name}#{o.Name}"})
        ids = ids | {pid}
    # montáž kusovníku (PLCdesk_Mount din / rack = přístroj nacvaknutý na lištu) dědí obsah odkazu / kontejneru
    sub = {"zona": zona, "pohyb": pm, "ids": ids, "mount": str(pr.get("PLCdesk_Mount") or inh.get("mount") or ""),
           "lnk": inh.get("lnk") or (), "src": inh.get("src") or (o.Document.Name, o.Name) in link_sources,
           "zjed": inh.get("zjed") or _zjed(pr)}
    if o.TypeId in CONTAINERS:
        nplc = plc.multiply(o.Placement) if o.TypeId == "App::Part" else plc
        for c in getattr(o, "Group", []) or []:
            walk(c, nplc, path + [lab], sub)
        return
    if o.TypeId == "App::Link":
        lo = o.LinkedObject
        if lo is not None and lo.TypeId in CONTAINERS and not getattr(o, "ElementCount", 0):
            nplc = plc.multiply(o.Placement)
            if getattr(o, "LinkTransform", False):
                nplc = nplc.multiply(lo.Placement)
            lpr = props(lo)
            lpid = lpr.get("PLCdesk_Id") or ""
            if lpid and lpid not in ids and not pid:        # vlastní PLCdesk_Id odkazu má přednost před cílem
                PLC_OBJS.append({"id": lpid, "inst": lpr.get("PLCdesk_Instance", ""), "label": lab,
                                 "path": "/".join(path + [lab]), "status": lpr.get("PLCdesk_ModelStatus", ""),
                                 "guid": lpr.get("PLCdesk_ProjectGuid", ""), "obj": f"{o.Document.Name}#{o.Name}"})
                sub = dict(sub, ids=ids | {lpid})
            sub = dict(sub, pohyb=rules.pohyb(lpr) or sub["pohyb"], lnk=tuple(sub["lnk"]) + (f"{o.Document.Name}#{o.Name}",),
                       zjed=sub["zjed"] or _zjed(lpr))
            for c in getattr(lo, "Group", []) or []:
                walk(c, nplc, path + [lab], sub)
            return
    if not hasattr(o, "Shape"):
        return
    if o.Name.startswith("SRC_") or ((o.Document.Name, o.Name) in link_sources and o.TypeId != "App::Link"
                                     and not getattr(o, "Visibility", True)):
        SKIPPED["zdroje"] += 1
        return
    if consumed(o):
        return
    try:
        s0 = Part.getShape(o, "", needSubElement=False, transform=False)
    except Exception as exc:  # noqa: BLE001
        SKIPPED["chyby_tvaru"].append(f"{lab}: {exc}")
        return
    if s0 is None or s0.isNull() or not s0.Solids:
        SKIPPED["prazdne"] += 1
        return
    s = s0.copy()
    s.Placement = plc.multiply(o.Placement).multiply(s.Placement)
    typ = rules.typ_dilu(pr, lab, o.Name)
    if typ == "pomocny":
        SKIPPED["pomocne"] += 1
    LEAVES.append({"key": f"{o.Document.Name}#{o.Name}#{len(LEAVES)}", "label": lab, "name": o.Name, "doc": o.Document.Name,
                   "path": "/".join(path + [lab]), "typ": typ, "s": s, "bb": s.BoundBox, "pohyb": pm, "props": pr,
                   "vis": bool(getattr(o, "Visibility", True)), "mount": str(pr.get("PLCdesk_Mount") or inh.get("mount") or ""),
                   "lnk": tuple(inh.get("lnk") or ()) + ((f"{o.Document.Name}#{o.Name}",) if o.TypeId == "App::Link" else ()),
                   "src": bool(inh.get("src")) or (o.Document.Name, o.Name) in link_sources, "otype": o.TypeId,
                   "zjed": bool(inh.get("zjed") or _zjed(pr))})


ID = App.Placement()
for o in doc.RootObjects:
    walk(o, ID, [], {"zona": False, "pohyb": None, "ids": frozenset(), "lnk": (), "src": False})
REAL = [x for x in LEAVES if x["typ"] not in ("zona", "pomocny")]
ZONES = [x for x in LEAVES if x["typ"] == "zona"]
mbb = None
for x in REAL:
    mbb = x["bb"] if mbb is None else mbb.united(x["bb"])
R["pruchod"] = {"listu": len(LEAVES), "realnych": len(REAL), "zon": len(ZONES), "dilu_s_id": len(PLC_OBJS),
                "preskoceno": SKIPPED, "obalka": bbl(mbb) if mbb else None,
                "typy": {t: sum(1 for x in REAL if x["typ"] == t) for t in rules.TYPES if any(x["typ"] == t for x in REAL)}}
R["t"]["pruchod"] = round(time.time() - T0, 1)
save()


def f_(kod, text, poloha=None, objekty=None, **kw):
    d = {"kod": kod, "text": text}
    if poloha is not None:
        d["poloha"] = [round(float(c), 1) for c in poloha]
    if objekty:
        d["objekty"] = objekty
    d.update(kw)
    return d


def ov_box(A, B, tol=1e-3):
    lo = [max(A.XMin, B.XMin), max(A.YMin, B.YMin), max(A.ZMin, B.ZMin)]
    hi = [min(A.XMax, B.XMax), min(A.YMax, B.YMax), min(A.ZMax, B.ZMax)]
    return (lo, hi) if all(h > l + tol for l, h in zip(lo, hi)) else None


def grid_hits(a, b, lo, hi, n=6):
    h = 0
    for i, j, k in itertools.product(range(n), repeat=3):
        p = V(*[lo[d] + (hi[d] - lo[d]) * (q + 0.5) / n for d, q in enumerate((i, j, k))])
        if a.isInside(p, 1e-3, False) and b.isInside(p, 1e-3, False):
            h += 1
    return h


def main_cyl(s):
    """Osa šroubu: válcová plocha s největší plochou → (bod, směr, poloměr)."""
    best = None
    for fc in s.Faces:
        if fc.Surface.TypeId == "Part::GeomCylinder" and (best is None or fc.Area > best.Area):
            best = fc
    if best is None:
        return None
    return V(best.Surface.Center), V(best.Surface.Axis).normalize(), best.Surface.Radius


def coaxial_hole(fast, other, common):
    """Leží průnik v díře / závitu? Druhý díl má válcovou plochu souosou se šroubem (osa do 0,6 mm, poloměr ≤ šroub
    + 0,6 mm) a průnik nepřesahuje polovinu objemu šroubu."""
    ax = main_cyl(fast)
    if ax is None:
        return False, "šroub bez válcové plochy"
    c, d, r = ax
    for fc in other.Faces:
        if fc.Surface.TypeId != "Part::GeomCylinder":
            continue
        d2 = V(fc.Surface.Axis).normalize()
        if abs(abs(d.dot(d2)) - 1) > 1e-3:
            continue
        w = V(fc.Surface.Center) - c
        off = (w - d * w.dot(d)).Length
        if off <= 0.6 and fc.Surface.Radius <= r + 0.6:
            return common <= 0.5 * fast.Volume, "souosá díra"
    return False, "bez souosé díry v druhém dílu"


def in_slot(nut, prof, common, cs=None):
    """Matice v drážce profilu: průnik do 50 % objemu matice, leží v obálce profilu a nesahá do jádra profilu
    (střední třetina průřezu = jádro, drážky jsou u obvodu)."""
    pb = prof.BoundBox
    cb = cs.BoundBox if cs is not None and not cs.isNull() else nut.BoundBox
    g = App.BoundBox(pb)
    g.enlarge(0.5)
    inside = g.isInside(cb)
    dims = sorted(((pb.XLength, 0), (pb.YLength, 1), (pb.ZLength, 2)))
    core = True
    for L, ax in dims[:2]:                       # dvě kratší osy = průřez profilu
        lo, hi = (pb.XMin, pb.YMin, pb.ZMin)[ax], (pb.XMax, pb.YMax, pb.ZMax)[ax]
        clo, chi = (cb.XMin, cb.YMin, cb.ZMin)[ax], (cb.XMax, cb.YMax, cb.ZMax)[ax]
        if chi <= lo + L / 3 + 0.5 or clo >= hi - L / 3 - 0.5:
            core = False
    ok = common <= 0.5 * nut.Volume and inside and not core
    return ok, ("v drážce profilu" if ok else ("zasahuje do jádra profilu" if core else "mimo obálku profilu"))


def in_fitting(hose, common, cs=None):
    """Hadice zasunutá do šroubení / rychlospojky: průnik je krátký (≤ ``rules.ZASUN_MAX``) a leží v něm čelo hadice
    (rovinná koncová plocha) — hadice tam KONČÍ. Hadice, která šroubením prochází nebo ho protíná bokem, čelo
    v průniku nemá → chyba."""
    if cs is None or cs.isNull():
        return False, "průnik hadice × šroubení nelze ověřit"
    cb = cs.BoundBox
    if max(cb.XLength, cb.YLength, cb.ZLength) > rules.ZASUN_MAX + 1e-6:
        return False, f"průnik delší než {rules.ZASUN_MAX:.0f} mm — hadice šroubením prochází"
    g = App.BoundBox(cb)
    g.enlarge(0.5)
    for fc in hose.Faces:
        if fc.Surface.TypeId == "Part::GeomPlane" and g.isInside(fc.BoundBox):
            return True, "hadice zasunutá do šroubení (konec hadice uvnitř)"
    return False, "konec hadice není v šroubení — hadice protíná šroubení"


def _near_solids(s, bb):
    """Jen tělesa složeného tvaru, jejichž obálka protíná ``bb`` (boolean nad celým sestavením je pomalý)."""
    sol = s.Solids
    if len(sol) <= 1:
        return s
    near = [x for x in sol if x.BoundBox.intersect(bb)]
    if not near:
        return None
    return near[0] if len(near) == 1 else Part.makeCompound(near)


def collide(items, moved_keys=None, label=""):
    """Matice kolizí dvojic s protnutou obálkou. moved_keys: jen dvojice, kde je aspoň jeden pohyblivý."""
    chyby, povol, dotyk, n = [], [], 0, 0
    for a, b in itertools.combinations(items, 2):
        if moved_keys is not None and not (a["key"] in moved_keys or b["key"] in moved_keys):
            continue
        box = ov_box(a["bb"], b["bb"])
        if not box:
            continue
        n += 1
        if n % 250 == 0:
            R["t"]["kolize_dvojic"] = n
            save()
        try:
            sa, sb = _near_solids(a["s"], b["bb"]), _near_solids(b["s"], a["bb"])
            cs = sa.common(sb) if sa is not None and sb is not None else None
            v = cs.Volume if cs is not None else 0.0
        except Exception as exc:  # noqa: BLE001
            chyby.append(f_("kolize-boolean", f"{a['label']} × {b['label']}: boolean selhal ({exc})",
                            rules.bbox_center([box[0][0], box[1][0], box[0][1], box[1][1], box[0][2], box[1][2]]),
                            [a["path"], b["path"]]))
            continue
        lo, hi = box
        pos = [(l + h) / 2 for l, h in zip(lo, hi)]
        if v <= VOL_TOL:
            thick = min(h - l for l, h in zip(lo, hi))
            if thick > 1.0 and grid_hits(a["s"], b["s"], lo, hi) > 0:
                chyby.append(f_("kolize-skryta", f"{a['label']} × {b['label']}: boolean vrátil {v:.2f} mm³, mřížka bodů "
                                "našla společné body — průnik (ověřit)", pos, [a["path"], b["path"]], common=round(v, 2)))
            else:
                dotyk += 1
            continue
        kind = rules.povolena_kolize(a["typ"], b["typ"])
        ok, why = False, "nepovolená dvojice"
        if kind == "vedeni":
            ok, why = True, "kabel / hadice ve vedení (žlab / obálka řetězu)"
        elif kind == "zasunuti":
            hs = a if a["typ"] == "hadice" else b
            ok, why = in_fitting(hs["s"], v, cs)
        elif kind in ("dira", "otvor", "zavit"):
            fa, ot = (a, b) if a["typ"] in ("sroub", "patka", "sroubeni") else (b, a)
            if kind == "zavit":
                ok, why = v <= 0.5 * min(a["s"].Volume, b["s"].Volume), "závit šroub × matice"
            else:
                ok, why = coaxial_hole(fa["s"], ot["s"], v)
                if not ok and fa["typ"] == "sroub" and ot["typ"] == "profil":
                    ok2, why2 = in_slot(fa["s"], ot["s"], v, cs)       # hlava šroubu / spojky v drážce profilu
                    if ok2:
                        ok, why = ok2, why2
        elif kind == "drazka":
            nt, pf = (a, b) if a["typ"] == "matice" else (b, a)
            ok, why = in_slot(nt["s"], pf["s"], v, cs)
        rec = f_("kolize", f"{label}{a['label']} × {b['label']}: průnik {v:.1f} mm³ ({a['typ']} × {b['typ']}, {why})",
                 pos, [a["path"], b["path"]], common=round(v, 2))
        (povol if ok else chyby).append(rec)
    return n, chyby, povol, dotyk


def calibrate():
    """Měřič ověřený známým průnikem: kvádry 20³ posunuté o 10 → průnik 10 × 20 × 20 = 4000 mm³."""
    a = Part.makeBox(20, 20, 20)
    b = Part.makeBox(20, 20, 20, V(10, 0, 0))
    v = a.common(b).Volume
    lo, hi = [10.0, 0.0, 0.0], [20.0, 20.0, 20.0]
    g = grid_hits(a, b, lo, hi, 4)
    return {"common": round(v, 3), "ocekavano": 4000.0, "mrizka": g, "ok": abs(v - 4000.0) < 1e-3 and g == 64}


def moved(item, pm):
    s = item["s"].copy()
    if "posun" in pm:
        s.translate(V(*pm["posun"]))
    else:
        o = pm["otoc"]
        s.rotate(V(*o["bod"]), V(*o["osa"]), o["uhel"])
    return dict(item, s=s, bb=s.BoundBox, key=item["key"] + "@" + pm["nazev"], label=item["label"] + " [" + pm["nazev"] + "]")


def check_kolize():
    t = time.time()
    res = {"chyby": [], "varovani": [], "info": [], "data": {}}
    cal = calibrate()
    res["data"]["kalibrace"] = cal
    if not cal["ok"]:
        res["chyby"].append(f_("kalibrace", f"měřič průniku neprošel kalibrací ({cal}) — výsledek kolizí neplatí"))
    items = [x for x in REAL if x["typ"] not in ("kabel", "hadice")] if OPT.get("bez_kabelu") else list(REAL)
    n, ch, pv, dt = collide(items)
    res["chyby"] += ch
    res["data"].update({"dvojic_s_obalkou": n, "povolenych": len(pv), "dotyku": dt, "teles": len(items)})
    res["info"] += pv[:30]
    bad = [x for x in items if x["pohyb"] and x["pohyb"].get("chyba")]
    for x in bad[:10]:
        res["chyby"].append(f_("pohyb", f"{x['label']}: {x['pohyb']['chyba']}", objekty=[x["path"]]))
    groups = {}
    for x in items:
        if x["pohyb"] and not x["pohyb"].get("chyba"):
            groups.setdefault(json.dumps(x["pohyb"], sort_keys=True), []).append(x)
    poses = []
    for key, mem in groups.items():
        pm = json.loads(key)
        mv = [moved(x, pm) for x in mem]
        mkeys = {m["key"] for m in mv}
        fixed = [x for x in items if x["key"] not in {m["key"] for m in mem}]
        n2, ch2, pv2, _d = collide(fixed + mv, mkeys, label=f"[{pm['nazev']}] ")
        res["chyby"] += ch2
        poses.append({"poloha": pm["nazev"], "dilu": len(mem), "dvojic": n2, "chyb": len(ch2)})
    res["data"]["polohy"] = poses
    res["secs"] = round(time.time() - t, 1)
    return res


# --- zašroubování (V4 / M1): délka dříku v závitu / matici ----------------------------------------------------------

def _axial(fc, c, d):
    """Interval faces podél osy (bod c, směr d): průměty bodů jejích hran."""
    ts = []
    for e in fc.Edges:
        try:
            pts = e.discretize(Number=6)
        except Exception:  # noqa: BLE001
            pts = [v.Point for v in e.Vertexes]
        ts += [(p - c).dot(d) for p in pts]
    return (min(ts), max(ts)) if ts else None


def _union_len(iv, lo, hi):
    """Délka sjednocení intervalů ``iv`` oříznutých na ⟨lo, hi⟩."""
    segs = sorted((max(a, lo), min(b, hi)) for a, b in iv if min(b, hi) > max(a, lo))
    tot, cur = 0.0, None
    for a, b in segs:
        if cur is None or a > cur[1]:
            if cur is not None:
                tot += cur[1] - cur[0]
            cur = [a, b]
        else:
            cur[1] = max(cur[1], b)
    return tot + (cur[1] - cur[0] if cur else 0.0)


def shank_of(s):
    """Dřík šroubu: válcová plocha s nejmenším poloměrem (hlava i zápustná hlava jsou větší) → osa, poloměr, interval
    dříku podél osy, strana hlavy. None = šroub bez válcové plochy."""
    cyl = [fc for fc in s.Faces if fc.Surface.TypeId == "Part::GeomCylinder" and fc.Area > 1e-3]
    if not cyl:
        return None
    r = min(fc.Surface.Radius for fc in cyl)
    base = next(fc for fc in cyl if abs(fc.Surface.Radius - r) < 1e-6)
    c, d = V(base.Surface.Center), V(base.Surface.Axis).normalize()
    iv = []
    for fc in cyl:
        if abs(fc.Surface.Radius - r) > 1e-3 or abs(abs(V(fc.Surface.Axis).normalize().dot(d)) - 1) > 1e-4:
            continue
        w = V(fc.Surface.Center) - c
        if (w - d * w.dot(d)).Length > 1e-3:
            continue
        a = _axial(fc, c, d)
        if a:
            iv.append(a)
    if not iv:
        return None
    t0, t1 = min(a for a, _ in iv), max(b for _, b in iv)
    if t1 - t0 < 0.5:
        return None
    ts = [(vt.Point - c).dot(d) for vt in s.Vertexes]
    head = "hi" if ts and max(ts) > t1 + 0.3 else ("lo" if ts and min(ts) < t0 - 0.3 else None)
    return {"c": c, "d": d, "r": r, "t0": t0, "t1": t1, "head": head}


def _zaber(sh, x):
    """Záběr dříku ``sh`` (shank_of) s dílem ``x``: souosé válcové plochy (závit / jádro ≤ jmenovitý poloměr, průchozí
    díra do r + max(0,6; 0,1·d)), jinak průnik s plným materiálem (díra chybí). None = bez záběru."""
    c, d, r, t0, t1 = sh["c"], sh["d"], sh["r"], sh["t0"], sh["t1"]
    clr = max(0.6, 0.2 * r)
    bb = sh["bb"]
    thr, cl = [], []
    for so in (x["s"].Solids or [x["s"]]):
        if not so.BoundBox.intersect(bb):
            continue
        for fc in so.Faces:
            if fc.Surface.TypeId != "Part::GeomCylinder" or not fc.BoundBox.intersect(bb):
                continue
            R = fc.Surface.Radius
            if R < 0.7 * r or R > r + clr:
                continue
            if abs(abs(V(fc.Surface.Axis).normalize().dot(d)) - 1) > 1e-3:
                continue
            w = V(fc.Surface.Center) - c
            if (w - d * w.dot(d)).Length > 0.6:
                continue
            a = _axial(fc, c, d)
            if a:
                (thr if R <= r + 0.05 else cl).append(a)
    mat = rules.material_zavitu(x["props"], x["label"], x["typ"])
    rec = {"dil": x["label"], "path": x["path"], "material": mat}
    if x["typ"] == "kontext":
        L = _union_len(thr + cl, t0, t1) if thr or cl else 0.0
        if L <= rules.ZASROUB_TOL:
            try:
                L = sh["solid"].common(_near_solids(x["s"], bb) or x["s"]).Volume / (math.pi * r * r)
            except Exception:  # noqa: BLE001
                L = 0.0
        return dict(rec, druh="kontext", delka=round(L, 2)) if L > rules.ZASROUB_TOL else None
    if x["typ"] == "matice":
        iv = thr + cl
        L = _union_len(iv, t0, t1) if iv else 0.0
        nl = _axial(x["s"], c, d)
        if L <= rules.ZASROUB_TOL:
            try:
                L = sh["solid"].common(x["s"]).Volume / (math.pi * r * r)
            except Exception:  # noqa: BLE001
                L = 0.0
        return dict(rec, druh="matice", delka=round(L, 2), matice_l=round(nl[1] - nl[0], 2) if nl else None) \
            if L > rules.ZASROUB_TOL else None
    if thr:
        L = _union_len(thr, t0, t1)
        if L > rules.ZASROUB_TOL:
            hole = _union_len(thr, -1e9, 1e9)
            return dict(rec, druh="zavit", delka=round(L, 2), diry=round(hole, 2), skrz=L >= hole - rules.ZASROUB_TOL)
    if cl:
        L = _union_len(cl, t0, t1)
        if L > rules.ZASROUB_TOL:
            return dict(rec, druh="pruchozi", delka=round(L, 2))
    try:
        v = sh["solid"].common(_near_solids(x["s"], bb) or x["s"]).Volume
    except Exception:  # noqa: BLE001
        v = 0.0
    if v > VOL_TOL:
        return dict(rec, druh="bez_diry", delka=round(v / (math.pi * r * r), 2))
    return None


_SCREWS = None


def screw_analysis():
    """Každý šroub (Konstrukce_Typ sroub, ne kolík / spojka / upínka) → záběry dříku a posudek (rules.posud_sroub).
    Výsledek se počítá jednou (kontrola ``zasunuti`` i souvislost)."""
    global _SCREWS
    if _SCREWS is not None:
        return _SCREWS
    out, skipped = [], {"bez_driku": [], "nezavitove": 0}
    others = [x for x in REAL if x["typ"] not in ("sroub", "zona", "pomocny", "kabel", "hadice", "retez")]
    # díly jiné části vložené jako kontext (pomocné „[kontext] …“): závit v nich tady ověřit nejde → jen varování
    others += [dict(x, typ="kontext") for x in LEAVES if x["typ"] == "pomocny" and "kontext" in rules.fold(x["label"])]
    for x in REAL:
        if x["typ"] != "sroub":
            continue
        if rules.FASTENER_NOT_THREAD.search(rules.fold(x["label"])):
            skipped["nezavitove"] += 1
            continue
        try:
            sh = shank_of(x["s"])
        except Exception:  # noqa: BLE001
            sh = None
        if sh is None:
            skipped["bez_driku"].append(x["label"])
            continue
        c, d = sh["c"], sh["d"]
        sh["solid"] = Part.makeCylinder(sh["r"], sh["t1"] - sh["t0"], c + d * sh["t0"], d)
        bb = App.BoundBox(sh["solid"].BoundBox)
        bb.enlarge(0.5)
        sh["bb"] = bb
        zab = []
        for y in others:
            if not y["bb"].intersect(bb):
                continue
            try:
                z = _zaber(sh, y)
            except Exception as exc:  # noqa: BLE001
                z = {"dil": y["label"], "druh": "chyba", "delka": 0.0, "chyba": str(exc)[:200]}
            if z:
                zab.append(z)
        if not any(z.get("druh") in ("zavit", "matice", "bez_diry", "kontext") for z in zab):
            # konec dříku dosedá na zjednodušený model (obálka / zástupný bez děr) — závit v něm tady modelovat nejde
            ends = [(sh["t0"], -1.0), (sh["t1"], 1.0)] if sh["head"] is None else                 [(sh["t0"], -1.0)] if sh["head"] == "hi" else [(sh["t1"], 1.0)]
            for tt, sg in ends:
                p = c + d * (tt + sg * 0.5)
                for y in others:
                    if not y.get("zjed") or y["typ"] == "kontext" or not y["bb"].isInside(p):
                        continue
                    try:
                        inside = y["s"].isInside(p, 0.05, True)
                    except Exception:  # noqa: BLE001
                        inside = False
                    if inside:
                        zab.append({"dil": y["label"], "path": y["path"], "druh": "obalka", "delka": 0.0,
                                    "material": rules.material_zavitu(y["props"], y["label"], y["typ"])})
                        break
        dn = round(2 * sh["r"], 2)
        ev = rules.posud_sroub(dn, zab)
        tip = c + d * (sh["t0"] if sh["head"] != "lo" else sh["t1"])
        out.append({"key": x["key"], "label": x["label"], "path": x["path"], "d": dn,
                    "dril": round(sh["t1"] - sh["t0"], 2), "zabery": zab, "posudek": ev,
                    "poloha": [round(tip.x, 1), round(tip.y, 1), round(tip.z, 1)]})
    _SCREWS = {"sroubu": out, "preskoceno": skipped}
    return _SCREWS


def check_zasunuti():
    t = time.time()
    res = {"chyby": [], "varovani": [], "info": [], "data": {}}
    sa = screw_analysis()
    lst = sa["sroubu"]
    by = {}
    for s in lst:
        by.setdefault(s["posudek"]["kod"], []).append(s)
    thin = {}
    for s in lst:
        ev = s["posudek"]
        if ev["uroven"] == "ok":
            continue
        if ev["kod"] in ("sroub-tenky", "sroub-kontext", "sroub-obalka"):   # tenký plech / závit v kontextu — souhrnně po dílu a průměru
            thin.setdefault((ev["kod"], ev.get("dil"), s["d"], ev.get("delka"), ev.get("pozad")), []).append(s)
            continue
        rec = f_(ev["kod"], f"{s['label']}: {ev['text']}", s["poloha"], [s["path"]], delka=ev.get("delka"),
                 pozad=ev.get("pozad"))
        (res["chyby"] if ev["uroven"] == "chyba" else res["varovani"]).append(rec)
    for (kod, dil, dn, L, req), ss in sorted(thin.items(), key=lambda kv: -len(kv[1])):
        if kod == "sroub-obalka":
            txt = (f"{len(ss)}× šroub M{dn:g} končí na zjednodušeném modelu {dil} (obálka / zástupný, bez děr) — závit "
                   f"předpokládán v dílu, ověř podle dokumentace výrobce; např. {ss[0]['label']}")
        elif kod == "sroub-kontext":
            txt = (f"{len(ss)}× šroub M{dn:g} se závitem jen v dílu jiné části {dil} (kontext, {L:g} mm) — tady neověřitelné, "
                   f"ověř závit v té části; např. {ss[0]['label']}")
        else:
            txt = (f"{len(ss)}× šroub M{dn:g} se závitem jen v tenkém dílu {dil} (celá tloušťka {L:g} mm < {req:g} mm): ověř "
                   f"únosnost, jinak závitová vložka / nýtovací matice / matice ({rules.ZASROUB_SRC}); např. {ss[0]['label']}")
        res["varovani"].append(f_(kod, txt, ss[0]["poloha"], [x["path"] for x in ss[:8]], pocet=len(ss)))
    # stejné nálezy u mnoha šroubů: do chyb nejvýš 12 jednotlivě + souhrn (plný výpis v data.sroubu)
    for key in ("chyby", "varovani"):
        if len(res[key]) > 12:
            n = len(res[key]) - 10
            cnt = {}
            for f in res[key][10:]:
                cnt[f["kod"]] = cnt.get(f["kod"], 0) + 1
            res[key] = res[key][:10] + [f_("sroub-souhrn", f"… a dalších {n} šroubů ("
                                           + ", ".join(f"{k} {v}×" for k, v in sorted(cnt.items()))
                                           + ") — plný výpis kontroly.json checks.zasunuti.data.sroubu")]
    if sa["preskoceno"]["bez_driku"]:
        res["info"].append(f_("sroub-bez-driku", f"{len(sa['preskoceno']['bez_driku'])} dílů typu šroub bez válcového dříku "
                              "(zasunutí neměřeno): " + ", ".join(sa["preskoceno"]["bez_driku"][:6])))
    res["data"] = {"sroubu": [dict(s, key=None) for s in lst], "pocty": {k: len(v) for k, v in by.items()},
                   "preskoceno": {"bez_driku": len(sa["preskoceno"]["bez_driku"]), "nezavitove": sa["preskoceno"]["nezavitove"]},
                   "zdroj": rules.ZASROUB_SRC}
    if not lst:
        res["info"].append(f_("sroub-zadny", "model nemá šrouby s dříkem — zašroubování neměřeno"))
    res["secs"] = round(time.time() - t, 1)
    return res


# --- kopie těles (V12): opakovaný díl má být App::Link -----------------------------------------------------------------

def _inertia(s):
    """Tenzor setrvačnosti (objemový, k těžišti) složeného tvaru přes jednotlivá tělesa (Steiner), těžiště a objem."""
    import numpy as np
    sol = s.Solids
    vol = sum(x.Volume for x in sol)
    if vol <= 0:
        return None
    C = sum((x.CenterOfMass * x.Volume for x in sol[1:]), sol[0].CenterOfMass * sol[0].Volume) * (1.0 / vol)
    I = np.zeros((3, 3))
    for x in sol:
        m = x.MatrixOfInertia
        Ii = np.array([[m.A11, m.A12, m.A13], [m.A21, m.A22, m.A23], [m.A31, m.A32, m.A33]])
        r = np.array([x.CenterOfMass.x - C.x, x.CenterOfMass.y - C.y, x.CenterOfMass.z - C.z])
        I += Ii + x.Volume * (r.dot(r) * np.eye(3) - np.outer(r, r))
    return I, np.array([C.x, C.y, C.z]), vol


def _q(v, n=3):
    return float(f"{v:.{n}g}") if v else 0.0


def shape_sig(x):
    """Podpis tvaru nezávislý na poloze: počty těles / ploch / hran / vrcholů, objem, plocha, hlavní momenty."""
    import numpy as np
    s = x["s"]
    it = _inertia(s)
    if it is None:
        return None
    I, C, vol = it
    w, R = np.linalg.eigh(I)
    pts = np.array([[p.x, p.y, p.z] for p in (vt.Point for vt in s.Vertexes)], float).reshape(-1, 3) - C
    x["_g"] = {"w": w, "R": R, "pts": pts, "C": C}
    return (len(s.Solids), len(s.Faces), len(s.Edges), len(s.Vertexes), _q(vol), _q(s.Area)) + tuple(_q(v) for v in w)


def _match_pts(P, Q, tol):
    import numpy as np
    if len(P) != len(Q):
        return False
    if not len(P):
        return True
    try:
        from scipy.spatial import cKDTree
        dd, _ = cKDTree(Q).query(P)
        return float(dd.max()) <= tol
    except ImportError:
        for i in range(0, len(P), 500):
            d2 = ((P[i:i + 500, None, :] - Q[None, :, :]) ** 2).sum(-1).min(1)
            if float(np.sqrt(d2.max())) > tol:
                return False
        return True


def rigid_match(a, b):
    """``same`` = b je a po otočení a posunutí (App::Link ho nahradí), ``mirror`` = jen zrcadlově, None = jiný tvar.
    Hlavní osy setrvačnosti: 8 kombinací znamének; při shodných momentech (osa rotační symetrie, krychle) rozhodne
    rozložení vzdáleností vrcholů od těžiště."""
    import numpy as np
    ga, gb = a["_g"], b["_g"]
    w = ga["w"]
    scale = float(np.sqrt(max(abs(w[-1]), 1e-9) / max(a["s"].Volume, 1e-9))) + 1.0
    tol = 0.02 + 1e-3 * scale
    for ra, rb in ((np.linalg.norm(ga["pts"], axis=1), np.linalg.norm(gb["pts"], axis=1)),):
        if len(ra) != len(rb) or (len(ra) and float(np.abs(np.sort(ra) - np.sort(rb)).max()) > tol):
            return None
    gaps = [abs(w[i + 1] - w[i]) / max(abs(w[-1]), 1e-12) for i in range(2)]
    if min(gaps) < 1e-3:
        return "same"
    best = None
    for sx in (1, -1):
        for sy in (1, -1):
            for sz in (1, -1):
                M = gb["R"] @ np.diag([sx, sy, sz]) @ ga["R"].T
                if _match_pts(ga["pts"] @ M.T, gb["pts"], tol):
                    if np.linalg.det(M) > 0:
                        return "same"
                    best = "mirror"
    return best


def check_kopie():
    t = time.time()
    res = {"chyby": [], "varovani": [], "info": [], "data": {}}
    # zdroj odkazů se porovnává také: jeho další kopie (vedle odkazů) je chyba; listy uvnitř odkazu ne
    cand = [x for x in REAL if x["typ"] not in rules.KOPIE_SKIP and not x.get("lnk") and x.get("otype") != "App::Link"]
    buckets = {}
    for x in cand:
        try:
            k = shape_sig(x)
        except Exception:  # noqa: BLE001
            k = None
        if k is not None:
            buckets.setdefault(k, []).append(x)
    groups, mirrors = [], []
    for mem in buckets.values():
        if len(mem) < 2:
            continue
        clusters = []
        for x in mem:
            for cl in clusters:
                m = rigid_match(cl[0], x)
                if m == "same":
                    cl.append(x)
                    break
                if m == "mirror":
                    mirrors.append([cl[0]["label"], x["label"]])
            else:
                clusters.append([x])
        groups += [cl for cl in clusters if len(cl) > 1]
    groups.sort(key=lambda g: (-len(g), g[0]["label"]))
    full = [{"pocet": len(g), "objem": round(g[0]["s"].Volume, 1),
             "rozmer": sorted(round(v, 1) for v in (g[0]["bb"].XLength, g[0]["bb"].YLength, g[0]["bb"].ZLength)),
             "typ": g[0]["typ"], "dily": [x["label"] for x in g], "cesty": [x["path"] for x in g],
             "plcdesk_id": sorted({str(x["props"].get("PLCdesk_Id")) for x in g if x["props"].get("PLCdesk_Id")})} for g in groups]
    for g, info in list(zip(groups, full))[:rules.KOPIE_MAX_SKUPIN]:
        names = ", ".join(x[:36] for x in info["dily"][:2]) + (" …" if len(g) > 2 else "")
        ids = f" (různá PLCdesk_Id → na odkazy)" if len(info["plcdesk_id"]) > 1 else ""
        res["chyby"].append(f_("kopie", f"{len(g)}× totéž těleso jako kopie, ne App::Link ({info['typ']}, "
                               f"{' × '.join(f'{v:g}' for v in info['rozmer'])} mm){ids}: {names} → zdroj + App::Link, PLCdesk_Id na odkazu", rules.bbox_center(bbl(g[0]["bb"])),
                               [x["path"] for x in g[:8]], pokyn=rules.KOPIE_POKYN))
    if len(groups) > rules.KOPIE_MAX_SKUPIN:
        rest = groups[rules.KOPIE_MAX_SKUPIN:]
        res["chyby"].append(f_("kopie", f"… a dalších {len(rest)} skupin kopií ({sum(len(g) for g in rest)} těles) — plný výpis "
                               "kontroly.json checks.kopie.data.skupiny"))
    if groups:
        res["info"].append(f_("kopie-pokyn", rules.KOPIE_POKYN))
    if mirrors:
        res["info"].append(f_("kopie-zrcadlo", f"{len(mirrors)} dvojic zrcadlově shodných těles (App::Link zrcadlit neumí — "
                              "v pořádku): " + "; ".join(" / ".join(m) for m in mirrors[:4])))
    res["data"] = {"kandidatu": len(cand), "skupin": len(groups), "teles_v_kopiich": sum(len(g) for g in groups),
                   "odkazu": sum(1 for x in REAL if x.get("lnk") or x.get("otype") == "App::Link"),
                   "skupiny": full[:300], "zrcadlove": mirrors[:100]}
    res["secs"] = round(time.time() - t, 1)
    return res


def check_souvislost():
    t = time.time()
    res = {"chyby": [], "varovani": [], "info": [], "data": {}}
    # přípojky k okolí stroje se nemusí dotýkat rámu; obálka řetězu není těleso (kabely jí procházejí — jako most
    # by spojila díly, které spojené nejsou)
    items = [x for x in REAL if x["typ"] not in ("rozhrani", "retez")]
    if not items:
        return dict(res, secs=0)
    floor = float(OPT["podlaha"]) if OPT.get("podlaha") is not None else min(x["bb"].ZMin for x in items)
    idx = {x["key"]: i for i, x in enumerate(items)}
    par = list(range(len(items) + 1))           # poslední = PODLAHA
    FL = len(items)

    def g(i):
        while par[i] != i:
            par[i] = par[par[i]]
            i = par[i]
        return i

    nb = [set() for _ in items]
    for i, x in enumerate(items):
        if x["bb"].ZMin <= floor + TOL:
            par[g(i)] = g(FL)
            nb[i].add(FL)
    for (i, a), (j, b) in itertools.combinations(enumerate(items), 2):
        A, B = a["bb"], b["bb"]
        if (A.XMin > B.XMax + TOL or B.XMin > A.XMax + TOL or A.YMin > B.YMax + TOL or B.YMin > A.YMax + TOL
                or A.ZMin > B.ZMax + TOL or B.ZMin > A.ZMax + TOL):
            continue
        try:
            d = a["s"].distToShape(b["s"])[0]
        except Exception:  # noqa: BLE001
            d = 0.0 if ov_box(A, B) else 1e9
        if d <= TOL:
            par[g(i)] = g(j)
            nb[i].add(j)
            nb[j].add(i)
    comps = {}
    for i in range(len(items)):
        comps.setdefault(g(i), []).append(i)
    air = [c for r, c in comps.items() if g(r) != g(FL)]
    for c in sorted(air, key=len, reverse=True):
        bb = None
        for i in c:
            bb = items[i]["bb"] if bb is None else bb.united(items[i]["bb"])
        labels = [items[i]["label"] for i in c]
        res["chyby"].append(f_("ve-vzduchu", f"{len(c)} díl(ů) bez spojení s podlahou / rámem: {', '.join(labels[:6])}"
                               + (" …" if len(labels) > 6 else ""), rules.bbox_center(bbl(bb)), [items[i]["path"] for i in c[:8]]))
    has_fast = any(x["typ"] in rules.FASTENERS for x in items)
    # šroub, který nic nespojuje (dřík do vzduchu / jen průchozí díry), není spoj (kontrola zasunuti)
    dead = set()
    if has_fast:
        try:
            dead = {s["key"] for s in screw_analysis()["sroubu"] if not s["posudek"].get("nosny")}
        except Exception:  # noqa: BLE001
            dead = set()
    loose = []
    in_air = {i for c in air for i in c}
    skip_loose = rules.FASTENERS | {"kabel", "hadice", "patka", "prislusenstvi", "rozhrani", "sroubeni"}
    trays = []
    if has_fast:
        for i, x in enumerate(items):
            if i in in_air or x["typ"] in skip_loose or FL in nb[i] or \
                    str(x["props"].get("PLCdesk_Mount") or x.get("mount") or "").lower() in ("din", "rack"):   # přístroj na liště = klip
                    # (vlastnost i zděděná z App::Link / kontejneru — model dílu z dily/ ji nenese)
                continue
            if not any(j != FL and items[j]["typ"] in rules.FASTENERS and items[j]["key"] not in dead for j in nb[i]):
                (trays if x["typ"] == "zlab" else loose).append(i)
        # žlab nese kabely (nosný díl, skill kabelaz-a-hadice / K5 M7): bez šroubu k rámu = chyba, ne jen varování —
        # „leží na profilu“ se ve skutečnosti při tahu za kabely posune / spadne
        for i in trays:
            x = items[i]
            res["chyby"].append(f_("zlab-bez-spoje", f"{x['label']}: žlab bez spojovacího prvku k rámu ({len(nb[i])} "
                                   "dotyků) — přišroubovat (šroub + díra / matice v drážce)", rules.bbox_center(bbl(x["bb"])),
                                   [x["path"]]))
        for i in loose[:15]:
            x = items[i]
            res["varovani"].append(f_("bez-spoje", f"{x['label']}: dotýká se jen dílů bez spojovacího prvku "
                                      f"({len(nb[i])} dotyků) — ověřit uchycení", rules.bbox_center(bbl(x["bb"])), [x["path"]]))
    else:
        res["info"].append(f_("bez-spoje", "model nemá spojovací prvky (šrouby / matice) — kontrola dílů bez spoje vynechána"))
    # volná čela profilů
    free_ends = []
    for i, x in enumerate(items):
        if x["typ"] != "profil":
            continue
        bb = x["bb"]
        dims = [bb.XLength, bb.YLength, bb.ZLength]
        ax = dims.index(max(dims))
        if max(dims) < 2.5 * sorted(dims)[1]:
            continue
        for end in (0, 1):
            lo = [bb.XMin, bb.YMin, bb.ZMin]
            hi = [bb.XMax, bb.YMax, bb.ZMax]
            if end == 0:
                hi[ax], lo[ax] = lo[ax], lo[ax] - 0.3
            else:
                lo[ax], hi[ax] = hi[ax], hi[ax] + 0.3
            slab = Part.makeBox(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], V(*lo))
            covered = False
            for j in nb[i]:
                if j == FL:
                    if end == 0 and ax == 2:
                        covered = True
                    continue
                o = items[j]
                if o["bb"].intersect(slab.BoundBox) and o["s"].common(slab).Volume > 0.05:
                    covered = True
                    break
            if not covered:
                free_ends.append(f_("volne-celo", f"{x['label']}: volné čelo profilu (bez krytky / spoje)",
                                    [(l + h) / 2 for l, h in zip(lo, hi)], [x["path"]]))
    res["varovani"] += free_ends[:15]
    res["data"] = {"teles": len(items), "komponent": len(comps), "ve_vzduchu": sum(len(c) for c in air),
                   "sroubu_bez_zaberu": len(dead),
                   "bez_spoje": len(loose), "zlab_bez_spoje": len(trays), "volnych_cel": len(free_ends),
                   "podlaha_z": round(floor, 2),
                   "na_podlaze": sum(1 for i in range(len(items)) if FL in nb[i])}
    res["secs"] = round(time.time() - t, 1)
    return res


def tessellate():
    """Tělesa (bez pomocných a obálek řetězu) jako trojúhelníky pro voxely → npz (vrcholy, trojúhelníky, offsety, zóna)."""
    import numpy as np
    t = time.time()
    tol = float(OPT.get("tes_tol", 1.0))
    vs, fs, fo, zone = [], [], [0], []
    nv = 0
    for x in [y for y in REAL if y["typ"] != "retez"] + ZONES:   # obálka řetězu není zábrana
        try:
            pts, tri = x["s"].tessellate(tol)
        except Exception:  # noqa: BLE001
            continue
        if not tri:
            continue
        vs.append(np.array([[p.x, p.y, p.z] for p in pts], np.float32))
        fs.append(np.array(tri, np.int32) + nv)
        nv += len(pts)
        fo.append(fo[-1] + len(tri))
        zone.append(1 if x["typ"] == "zona" else 0)
    if not zone:
        return {"teles": 0}
    bb = bbl(mbb) if mbb else [0, 0, 0, 0, 0, 0]
    np.savez_compressed(OPT["tes"], v=np.concatenate(vs), f=np.concatenate(fs), fo=np.array(fo, np.int64),
                        zone=np.array(zone, np.int8), bb=np.array(bb, float))
    return {"teles": len(zone), "zon": int(sum(zone)), "trojuhelniku": int(fo[-1]), "secs": round(time.time() - t, 1),
            "zony": [{"label": z["label"], "bb": bbl(z["bb"])} for z in ZONES][:20]}


def _ray_hit(p, u, near, L=200.0):
    seg = Part.LineSegment(p, p + u * L).toShape()
    best = L
    for x in near:
        if not x["bb"].intersect(seg.BoundBox):
            continue
        try:
            c = x["s"].common(seg)
        except Exception:  # noqa: BLE001
            continue
        for vt in c.Vertexes:
            dd = (vt.Point - p).Length
            if 1e-3 < dd < best:
                best = dd
    return best


def measure_point(p, items, along=None):
    """Šířka otvoru v bodě: vzdálenost d1 k nejbližšímu tělesu + paprsek opačným směrem d2 → e = d1 + d2; se směrem
    cesty ``along`` i délka otvoru napříč (paprsky ve směru along × u) → tvar štěrbina / čtverec."""
    near = [x for x in items if x["bb"].isValid() and
            max(x["bb"].XMin - p.x, p.x - x["bb"].XMax, x["bb"].YMin - p.y, p.y - x["bb"].YMax,
                x["bb"].ZMin - p.z, p.z - x["bb"].ZMax) < 130.0]
    if not near:
        return None
    vx = Part.Vertex(p)
    d1, q1 = 1e9, None
    for x in near:
        if x["s"].isInside(p, 1e-3, True):
            return {"uvnitr": True}
        d, pts, _i = x["s"].distToShape(vx)
        if d < d1:
            d1, q1 = d, pts[0][0]
    if q1 is None or d1 > 130.0:
        return {"e": 2 * d1}
    u = p - q1
    if u.Length < 1e-6:
        return {"e": 0.0}
    u.normalize()
    out = {"e": d1 + _ray_hit(p, u, near), "d1": d1}
    if along is not None and along.Length > 1e-6:
        w = along.cross(u)
        if w.Length > 1e-6:
            w.normalize()
            out["delka"] = _ray_hit(p, w, near) + _ray_hit(p, w * -1, near)
    return out


def check_otvory():
    """Teselace → voxely (samostatný proces Pythonu FreeCADu, numpy + scipy) → změření e a Sr nalezených cest v modelu."""
    import subprocess
    t = time.time()
    tes = tessellate()
    out = {"teles": tes.get("teles", 0), "zon": tes.get("zon", 0), "zony": tes.get("zony", []), "grids": []}
    if not tes.get("zon"):
        return dict(out, secs=round(time.time() - t, 1))
    py = os.path.join(os.path.dirname(sys.executable), "python.exe")
    if not os.path.isfile(py):
        py = os.path.join(App.getHomePath(), "bin", "python.exe")
    vo, pf = OPT["tes"] + ".vox.json", OPT["tes"] + ".prm.json"
    json.dump({"grids": OPT.get("grids") or [5.0, 4.0, 3.0], "max_vox": OPT.get("max_vox", 64_000_000)}, open(pf, "w"))
    pr = subprocess.run([py, "-I", os.path.join(os.path.dirname(os.path.abspath(__file__)), "voxel.py"), OPT["tes"], vo, pf],
                        capture_output=True, text=True, timeout=int(OPT.get("vox_timeout", 3000)),
                        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    try:
        vox = json.load(open(vo, encoding="utf-8"))
    except (OSError, ValueError):
        raise RuntimeError("voxely selhaly: " + (pr.stdout + pr.stderr)[-1200:])
    for g in vox.get("grids") or []:
        for path in g.get("paths") or []:
            best = None
            body = path.get("body") or []
            for k, b in enumerate(body):
                nxt = body[min(k + 1, len(body) - 1)]
                prv = body[max(k - 1, 0)]
                m = measure_point(V(*b[:3]), REAL, V(*nxt[:3]) - V(*prv[:3]))
                if not m or m.get("uvnitr") or "e" not in m:
                    continue
                if best is None or m["e"] < best["e"] - 1e-6:
                    best = {"e": m["e"], "bod": b[:3], "draha": b[3], "delka": m.get("delka")}
            if best is not None:
                if best.get("delka") is not None:
                    path["delka_mer"] = round(best["delka"], 1)
                    path["tvar"] = "ctverec" if best["delka"] <= 1.25 * best["e"] else "sterbina"
                vp = Part.Vertex(V(*best["bod"]))
                srs = [z["s"].distToShape(vp)[0] for z in ZONES]
                path["e_mer"] = round(best["e"], 1)
                path["sr_mer"] = round(min(srs), 1) if srs else None
                path["sr_draha_mer"] = best["draha"]
                path["bod_mer"] = [round(c, 1) for c in best["bod"]]
            path.pop("body", None)
        out["grids"].append(g)
    out["secs"] = round(time.time() - t, 1)
    return out


def check_step():
    t = time.time()
    res = {"chyby": [], "varovani": [], "info": [], "data": {}}
    shapes = [x["s"] for x in REAL]
    if not shapes:
        res["varovani"].append(f_("step", "model nemá tělesa"))
        return dict(res, secs=0)
    comp = Part.makeCompound(shapes)
    n0, v0 = len(comp.Solids), comp.Volume
    path = OPT["step"]
    comp.exportStep(path)
    back = Part.Shape()
    back.read(path)
    n1, v1 = len(back.Solids), back.Volume
    inval = [i for i, s in enumerate(back.Solids) if not s.isValid()]
    res["data"] = {"soubor": path, "teles_model": n0, "teles_step": n1, "objem_model": round(v0, 1), "objem_step": round(v1, 1),
                   "neplatnych": len(inval), "velikost_B": os.path.getsize(path)}
    if n1 != n0:
        res["chyby"].append(f_("step-teles", f"STEP: {n1} těles po načtení, model {n0}"))
    if v0 > 0 and abs(v1 - v0) / v0 > 1e-4:
        res["chyby"].append(f_("step-objem", f"STEP: objem {v1:.0f} mm³ × model {v0:.0f} mm³ (Δ {100 * (v1 - v0) / v0:.3f} %)"))
    for i in inval[:5]:
        b = back.Solids[i].BoundBox
        res["varovani"].append(f_("step-neplatne", f"STEP: neplatné těleso č. {i} ({back.Solids[i].Volume:.0f} mm³)",
                                  rules.bbox_center(bbl(b))))
    bad_model = [x for x in REAL if not x["s"].isValid()]
    for x in bad_model[:5]:
        res["varovani"].append(f_("neplatne-teleso", f"{x['label']}: tvar není platný (isValid = False)",
                                  rules.bbox_center(bbl(x["bb"])), [x["path"]]))
    res["secs"] = round(time.time() - t, 1)
    return res


for name, fn in (("kolize", check_kolize), ("souvislost", check_souvislost), ("zasunuti", check_zasunuti),
                 ("kopie", check_kopie), ("otvory", check_otvory),
                 ("kusovnik", None), ("step", check_step)):
    if name not in CHECKS:
        continue
    if fn is None:
        R["checks"]["kusovnik"] = {"objekty": PLC_OBJS}
        save()
        continue
    try:
        R["checks"][name] = fn()
    except Exception:  # noqa: BLE001 — selhání jedné kontroly se zapíše, ostatní poběží
        R["checks"][name] = {"selhalo": traceback.format_exc()[-1500:]}
    save()
R["ok"] = True
save()
json.dump({"ok": True}, open(FC_RESULT, "w"))  # noqa: F821 — globál spouštěče run_fc
