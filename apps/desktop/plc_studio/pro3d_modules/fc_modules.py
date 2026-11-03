# FreeCAD 1.1 (freecadcmd) — stavba modulů z layout.json (pro3d_modules/layout.py). Spouštět JEN přes skill freecad-instance:
#   & run_fc.ps1 run --slot pro3d-modules --timeout 1200 fc_modules.py <layout.json> <Moduly.FCStd> <složka stroje>
# Polohy, díry a šrouby jsou v layout.json — tady se jen staví tělesa a odkazy. Rám = App::Link na části schváleného
# ram/Ram.FCStd (bez kontextu konceptu, nic se nekopíruje), nosné konstrukce = tvar z Koncept.FCStd s dírami, válce
# a snímače „dle dokumentace“ = App::Link na dily/modely/*.FCStd, zástupné = Part::Feature (PLCdesk_ModelStatus =
# placeholder; barvy uloží GUI fc_modules_colors.py), šrouby ISO 4762 a matice v drážce, trasy hadic a kabelů skriptem
# skillu kabelaz-a-hadice (fc_trasa.stavej_trasu). Každá skupina (zařízení + držáky + šrouby) se ověří průnikem s rámem
# a s už postavenými díly — koliduje-li, odstraní se celá a zapíše do „nepostaveno“ (nic se nestaví naslepo).
# Výsledek (FC_RESULT): {"ok", "out", "objektu", "odkazu", "skupin", "odebrano", "tras", "chyby"}.
import json
import math
import os
import sys
import traceback

import FreeCAD as App
import Part

V = App.Vector
HERE = os.path.dirname(os.path.abspath(globals().get("__file__") or sys.argv[0]))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "pro3d_tools"))
import rules  # noqa: E402

LAY = json.load(open(sys.argv[1], encoding="utf-8"))
OUT = os.path.abspath(sys.argv[2])
FOLDER = os.path.abspath(sys.argv[3]) if len(sys.argv) > 3 else os.path.dirname(os.path.dirname(OUT))
GUID = LAY.get("projectGuid") or ""
STAV = "dle dokumentace"
GEN = "pro3d_modules"
ERR, REMOVED = [], []
STATS = {"odkazu": 0, "zastupnych": 0, "sroubu": 0, "konstrukci": 0}
NORM = json.load(open(os.path.join(os.path.dirname(HERE), "pro3d_parts", "data", "normalie.json"), encoding="utf-8"))
VOL_TOL = 1.0


def props(o, d, group="Konstrukce"):
    for k, v in d.items():
        if v is None:
            continue
        if isinstance(v, bool):
            if k not in o.PropertiesList:
                o.addProperty("App::PropertyBool", k, group)
            setattr(o, k, v)
        else:
            if k not in o.PropertiesList:
                o.addProperty("App::PropertyString", k, group)
            setattr(o, k, str(v))


App.ParamGet("User parameter:BaseApp/Preferences/Document").SetBool("CreateBackupFiles", False)
DOC = App.newDocument("Moduly")
os.makedirs(os.path.dirname(OUT), exist_ok=True)
DOC.saveAs(OUT)


def part(name, label, parent=None, **pr):
    p = DOC.addObject("App::Part", name)
    p.Label = label
    props(p, pr)
    if parent is not None:
        parent.addObject(p)
    return p


def feat(name, label, shape, parent, **pr):
    o = DOC.addObject("Part::Feature", name)
    o.Label = label
    o.Shape = shape
    props(o, pr)
    parent.addObject(o)
    if not shape.isValid() or not shape.Solids:
        ERR.append(f"{label}: neplatné těleso")
    return o


def prim(p):
    if p[0] == "box":
        x0, y0, z0, x1, y1, z1 = [float(v) for v in p[1:7]]
        return Part.makeBox(max(0.01, x1 - x0), max(0.01, y1 - y0), max(0.01, z1 - z0), V(x0, y0, z0))
    _, x, y, z, dx, dy, dz, r, h = p
    return Part.makeCylinder(float(r), float(h), V(x, y, z), V(dx, dy, dz))


def solid(adds, cuts):
    s = None
    for p in adds:
        t = prim(p)
        s = t if s is None else s.fuse(t)
    if s is None:
        return None
    if len(adds) > 1:
        s = s.removeSplitter()
    if cuts:
        s = s.cut(Part.makeCompound([prim(c) for c in cuts]))
    return s


def rot(osy):
    ex, ey, ez = osy
    m = App.Matrix(ex[0], ey[0], ez[0], 0, ex[1], ey[1], ez[1], 0, ex[2], ey[2], ez[2], 0, 0, 0, 0, 1)
    return App.Rotation(m)


_DOCS = {}


def ext_doc(path):
    p = os.path.abspath(path)
    if p not in _DOCS:
        _DOCS[p] = App.openDocument(p)
    return _DOCS[p]


def ext_root(path):
    d = ext_doc(path)
    return d.getObject("Dil") or next((o for o in d.RootObjects if o.TypeId == "App::Part"), None)


def bom(it):
    return {"PLCdesk_Id": it.get("pid"), "PLCdesk_Instance": str(it.get("inst") or ""), "PLCdesk_Tag": it.get("tag"),
            "PLCdesk_OrderCode": it.get("code") or None, "PLCdesk_ProjectGuid": GUID if it.get("pid") else None,
            "PLCdesk_Mount": it.get("mount") or None}


# --- tvary rámu pro kontrolu průniků ----------------------------------------------------------------------------------
RAM_SHAPES = []      # (label, shape, bb, typ)


def ram_walk(o, plc, kont):
    lab = o.Label
    kont = kont or "kontext" in rules.fold(lab)
    if kont or o.TypeId.startswith("App::Origin"):
        return
    if o.TypeId in ("App::Part", "App::DocumentObjectGroup"):
        nplc = plc.multiply(o.Placement) if o.TypeId == "App::Part" else plc
        for c in getattr(o, "Group", []) or []:
            ram_walk(c, nplc, kont)
        return
    if o.TypeId == "App::Link":
        lo = o.LinkedObject
        if lo is not None and lo.TypeId in ("App::Part", "App::DocumentObjectGroup"):
            nplc = plc.multiply(o.Placement)
            for c in getattr(lo, "Group", []) or []:
                ram_walk(c, nplc, kont)
            return
    if not hasattr(o, "Shape") or o.Name.startswith("SRC_"):
        return
    pr = {k: str(getattr(o, k)) for k in o.PropertiesList if k.startswith("Konstrukce_")}
    typ = rules.typ_dilu(pr, lab, o.Name)
    if typ in ("zona", "pomocny"):
        return
    try:
        s = Part.getShape(o, "", needSubElement=False, transform=False).copy()
    except Exception:  # noqa: BLE001
        return
    if s.isNull() or not s.Solids:
        return
    s.Placement = plc.multiply(o.Placement).multiply(s.Placement)
    RAM_SHAPES.append((lab, s, s.BoundBox, typ))


def collisions(objs, skip_labels=(), with_ram=True, extra=()):
    """Průnik těles skupiny s rámem a s už přijatými díly; vrací první nalezený (popis) nebo None."""
    for o in objs:
        try:
            s = Part.getShape(o, "", needSubElement=False, transform=True) if o.TypeId == "App::Link" else o.Shape
            par = o.getParentGeoFeatureGroup()
            if par is not None and o.TypeId != "App::Link":
                s = s.copy()
                s.Placement = par.getGlobalPlacement().multiply(s.Placement)
        except Exception:  # noqa: BLE001
            continue
        bb = s.BoundBox
        cands = (RAM_SHAPES if with_ram else []) + list(extra)
        for lab, rs, rbb, typ in cands:
            if lab in skip_labels or not bb.intersect(rbb):
                continue
            try:
                v = s.common(rs).Volume
            except Exception:  # noqa: BLE001
                continue
            if v > VOL_TOL:
                return f"{o.Label} × {lab}: průnik {v:.1f} mm³"
    return None


def screw_shape(it):
    M = int(it["M"])
    r = NORM["ISO4762"]["rady"][f"M{M}"]
    d, L, dk, k, s, t = M, float(it["L"]), r["dk"], r["k"], r["s"], r["t"]
    rr = s / math.sqrt(3.0)
    hexf = Part.Face(Part.makePolygon([V(rr * math.cos(math.radians(60 * i)), rr * math.sin(math.radians(60 * i)), k - t)
                                       for i in range(7)]))
    head = Part.makeCylinder(dk / 2, k, V(0, 0, 0)).cut(hexf.extrude(V(0, 0, t + 1)))
    sh = head.fuse(Part.makeCylinder(d / 2, L, V(0, 0, -L))).removeSplitter()
    sh.Placement = App.Placement(V(*it["hlava"]), App.Rotation(V(0, 0, -1), V(*it["smer"])))
    return sh


def nut_shape(it):
    M = int(it["M"])
    w, l, h, tap = (12.0, 17.0, 5.0, 5.0) if M <= 6 else (15.5, 17.0, 6.0, 6.8)
    sh = Part.makeBox(w, l, h, V(-w / 2, -l / 2, -h / 2)).cut(Part.makeCylinder(tap / 2, h + 2, V(0, 0, -h / 2 - 1)))
    sh.Placement = App.Placement(V(*it["stred"]), App.Rotation(V(0, 0, 1), V(*it["n"])))
    return sh


try:
    root = part("Moduly", "Moduly stroje — generátor kódem (pro3d_modules)", PLCdesk_Id="asm:modules", PLCdesk_ProjectGuid=GUID,
                Konstrukce_Generator=GEN)
    # --- rám (odkazy) ----------------------------------------------------------------------------------------------
    ramp = part("Ram_odkaz", "Rám (App::Link na schválený ram/Ram.FCStd, bez kontextu konceptu)", root, Konstrukce_Generator=GEN)
    ramdoc = ext_doc(LAY["ram"]) if LAY.get("ram") and os.path.isfile(LAY["ram"]) else None
    if ramdoc is None:
        ERR.append("ram/Ram.FCStd nenalezen")
    else:
        for c in LAY.get("ram_links") or []:
            o = ramdoc.getObject(c["name"])
            if o is None:
                continue
            lk = DOC.addObject("App::Link", "Ram_" + "".join(ch if ch.isalnum() else "_" for ch in c["name"]))
            lk.setLink(o)
            lk.LinkTransform = False
            b, q = c["placement"]
            lk.Placement = App.Placement(V(*b), App.Rotation(*q))
            lk.Label = c["label"]
            ramp.addObject(lk)
            STATS["odkazu"] += 1
        for o in ramdoc.RootObjects:
            ram_walk(o, App.Placement(), False)
    kdoc = ext_doc(LAY["koncept"]) if LAY.get("koncept") and os.path.isfile(LAY["koncept"]) else None

    groups = {}
    accepted = []          # (label, shape, bb, typ) — naše přijaté díly (kontrola dalších skupin)

    def grp_part(g):
        if g not in groups:
            info = (LAY.get("groups") or {}).get(g) or {}
            groups[g] = part("G_" + "".join(ch if ch.isalnum() else "_" for ch in g)[:60], (info.get("co") or g)[:90], root,
                             Konstrukce_Generator=GEN, Konstrukce_Skupina=g)
        return groups[g]

    # --- nosné konstrukce z konceptu --------------------------------------------------------------------------------
    for s in LAY.get("supports") or []:
        if kdoc is None:
            break
        o = kdoc.getObject(s["name"])
        if o is None:
            ERR.append(f"koncept: {s['name']} chybí")
            continue
        sh = Part.getShape(o, "", needSubElement=False, transform=True).copy()
        par = o.getParentGeoFeatureGroup()
        if par is not None:
            sh.Placement = par.getGlobalPlacement().multiply(sh.Placement)
        sh = Part.Solid(sh.Solids[0]) if len(sh.Solids) == 1 else sh
        g = grp_part(s["grp"])
        if s.get("holes"):
            sh = sh.cut(Part.makeCompound([prim(h) for h in s["holes"]]))
        pr = {"Konstrukce_Typ": "dil", "Konstrukce_Generator": GEN, "Konstrukce_Zdroj": "tvar a poloha z koncept/Koncept.FCStd (ODHAD konceptu)",
              "Konstrukce_Poznamka": "nosná konstrukce převzatá z konceptu — návrh k odsouhlasení; upevnění: " + (s.get("upevneni") or "")}
        if s.get("zast"):
            pr.update({"PLCdesk_ModelStatus": "placeholder", "Konstrukce_Zastupny": True})
        feat("Nosna_" + "".join(ch if ch.isalnum() else "_" for ch in s["name"])[:50], s["label"][:80] + " (z konceptu)", sh, g, **pr)

    # --- díly ------------------------------------------------------------------------------------------------------
    by_grp = {}
    for it in LAY.get("items") or []:
        by_grp.setdefault(it.get("skupina") or "?", []).append(it)
    support_objs = [o for o in DOC.Objects if o.Name.startswith("Nosna_")]
    for o in support_objs:
        accepted.append((o.Label, o.Shape, o.Shape.BoundBox, "dil"))
    for gname, items in by_grp.items():
        if gname.startswith("S-"):
            g = grp_part(gname)
        else:
            g = grp_part(gname)
        made = []
        for it in items:
            dr = it["druh"]
            nm = it["id"]
            try:
                if dr in ("valec", "model"):
                    mp = os.path.join(FOLDER, it["model"])
                    rt = ext_root(mp) if os.path.isfile(mp) else None
                    if rt is None:
                        ERR.append(f"{it['label']}: model {it['model']} chybí")
                        continue
                    lk = DOC.addObject("App::Link", nm)
                    lk.setLink(rt)
                    lk.LinkTransform = False
                    lk.Placement = App.Placement(V(*it["base"]), rot(it["osy"]))
                    lk.Label = it["label"]
                    props(lk, bom(it))
                    props(lk, {"PLCdesk_ModelStatus": STAV, "Konstrukce_Zdroj": it.get("zdroj"), "Konstrukce_Generator": GEN,
                               "Konstrukce_Upevneni": it.get("upevneni")})
                    g.addObject(lk)
                    made.append(lk)
                    STATS["odkazu"] += 1
                elif dr == "zastupny":
                    b = it["bb"]
                    sh = solid([["box", *b]], it.get("cut") or [])
                    o = feat(nm, it["label"], sh, g, Konstrukce_Typ="dil", PLCdesk_ModelStatus="placeholder", Konstrukce_Zastupny=True,
                             Konstrukce_Poznamka=it.get("pozn"), Konstrukce_Generator=GEN, Konstrukce_Upevneni=it.get("upevneni"))
                    props(o, bom(it))
                    made.append(o)
                    STATS["zastupnych"] += 1
                elif dr == "konstrukce":
                    sh = solid(it["add"], it.get("cut") or [])
                    made.append(feat(nm, it["label"], sh, g, Konstrukce_Typ="dil", Konstrukce_Generator=GEN,
                                     Konstrukce_Poznamka=it.get("pozn"), Konstrukce_Navrh="vlastní konstrukce (ODHAD rozměrů)"))
                    STATS["konstrukci"] += 1
                elif dr == "sroubeni":
                    # závit zvlášť (kontrola: souosý s otvorem přípojky), tělo s ústím zvlášť (hadice zasunutá do ústí)
                    for suf, prims, lab in (("_zavit", it["add"][:1], " — závit"), ("", it["add"][1:], "")):
                        made.append(feat(nm + suf, it["label"] + lab, solid(prims, []), g, Konstrukce_Typ="sroubeni",
                                         PLCdesk_ModelStatus="placeholder", Konstrukce_Zastupny=True, Konstrukce_Poznamka=it.get("pozn"),
                                         Konstrukce_Generator=GEN, PLCdesk_OrderCode=it.get("code") or None))
                    STATS["zastupnych"] += 1
                elif dr == "sroub":
                    o = feat(nm, it["label"], screw_shape(it), g, Konstrukce_Typ="sroub", Konstrukce_ModelStav=STAV,
                             Konstrukce_Zdroj=NORM["ISO4762"]["zdroj"], Konstrukce_Generator=GEN + "/ISO4762",
                             Konstrukce_Predani="závit v rámu = požadavek na rám (dřík končí na ploše rámu)" if it.get("predani") else None)
                    made.append(o)
                    STATS["sroubu"] += 1
                elif dr == "matice":
                    made.append(feat(nm, it["label"], nut_shape(it), g, Konstrukce_Typ="matice", Konstrukce_Generator=GEN,
                                     Konstrukce_Poznamka="matice do drážky 40/8 — zjednodušený model (jako v rámu), ODHAD tvaru"))
            except Exception as exc:  # noqa: BLE001
                ERR.append(f"{it.get('label')}: {exc}")
        DOC.recompute()
        bodies = [o for o in made if str(getattr(o, "Konstrukce_Typ", "")) not in ("sroub", "matice", "sroubeni")]
        hit = collisions(bodies, extra=accepted)
        if hit is None:
            fast = [o for o in made if str(getattr(o, "Konstrukce_Typ", "")) in ("sroub", "matice")]
            hit = collisions(fast)
        if hit:
            REMOVED.append({"skupina": gname, "co": ((LAY.get("groups") or {}).get(gname) or {}).get("co") or gname, "duvod": hit})
            for o in made:
                DOC.removeObject(o.Name)
            if not g.Group:
                DOC.removeObject(g.Name)
                groups.pop(gname, None)
            continue
        for o in bodies + [o for o in made if str(getattr(o, "Konstrukce_Typ", "")) == "sroubeni"]:
            try:
                s = Part.getShape(o, "", needSubElement=False, transform=True) if o.TypeId == "App::Link" else o.Shape
                accepted.append((o.Label, s, s.BoundBox, "dil"))
            except Exception:  # noqa: BLE001
                pass

    # --- trasy hadic a kabelů (skill kabelaz-a-hadice) ---------------------------------------------------------------
    tr_res = []
    routes = [r for r in LAY.get("routes") or [] if r.get("postavit")]
    if routes:
        sys.path.insert(0, LAY.get("kabelaz_skill") or "")
        try:
            import fc_trasa  # type: ignore
        except Exception as exc:  # noqa: BLE001
            fc_trasa = None
            ERR.append(f"fc_trasa (skill kabelaz-a-hadice) nelze načíst: {exc}")
        if fc_trasa is not None:
            kp = part("Kabelaz_a_hadice", "Kabely a hadice (trasy kódem, kabelaz-a-hadice/trasa.py)", root, Konstrukce_Generator=GEN)
            present = {o.Label for o in DOC.Objects}
            for r in routes:
                v = r["vysledek"]
                if not v.get("prvky"):
                    continue
                v = dict(v, id=r["trasa"]["id"])
                try:
                    info = fc_trasa.stavej_trasu(DOC, kp, v)
                except Exception as exc:  # noqa: BLE001
                    REMOVED.append({"skupina": r["trasa"]["id"], "co": r["trasa"]["id"], "duvod": f"sweep selhal: {exc}"})
                    continue
                obj = DOC.getObject(info["objekt"])
                part_obj = obj.getParentGeoFeatureGroup()
                if r["druh"] == "kabel":
                    props(obj, {"Konstrukce_Druh": "silovy" if r["trasa"].get("skupina") == "silovy" else "signal"})
                # průnik s rámem a díly (šroubení svých konců je zasunutí — povolené)
                own_fit = [x for x in accepted if x[3] == "dil"]
                hit = collisions([obj], extra=[x for x in own_fit if not x[0].startswith(("QS-", "GRLA-"))])
                if hit:
                    REMOVED.append({"skupina": r["trasa"]["id"], "co": f"{r['druh']} {r['trasa']['id']}", "duvod": hit})
                    for c in list(part_obj.Group):
                        DOC.removeObject(c.Name)
                    DOC.removeObject(part_obj.Name)
                    continue
                accepted.append((obj.Label, obj.Shape, obj.Shape.BoundBox, r["druh"]))
                tr_res.append(info)
    DOC.recompute()
    DOC.save()
    n = len([o for o in DOC.Objects if o.TypeId in ("Part::Feature", "App::Link")])
    res = {"ok": not ERR, "out": OUT, "objektu": n, "odkazu": STATS["odkazu"], "skupin": len(groups), "odebrano": REMOVED,
           "tras": len(tr_res), "trasy": tr_res, "stat": STATS, "chyby": ERR}
except Exception:  # noqa: BLE001
    res = {"ok": False, "out": OUT, "objektu": 0, "chyby": ERR + [traceback.format_exc()[-1500:]], "odebrano": REMOVED}
json.dump(res, open(globals().get("FC_RESULT") or os.environ.get("FC_RESULT") or OUT + ".json", "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
print(json.dumps({"ok": res["ok"], "objektu": res.get("objektu"), "odebrano": len(REMOVED)}))
