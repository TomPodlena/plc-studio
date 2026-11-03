# FreeCAD 1.1 (freecadcmd) — stavba rozvaděče z layout.json (pro3d_cabinet/layout.py). Spouštět JEN přes skill
# freecad-instance:   & run_fc.ps1 run --slot pro3d-cabinet --timeout 900 fc_cabinet.py <layout.json> <Rozvadec.FCStd> <složka stroje>
# Geometrie i poloha všeho (díry, šrouby, panty, vývodky) jsou v layout.json — tady se jen staví tělesa a odkazy.
# Konvence (pro3d_tools/rules.py): App::Part kontejnery, přístroje „dle dokumentace“ = App::Link na dily/modely/*.FCStd,
# zástupné = Part::Feature s PLCdesk_ModelStatus = placeholder (barvy uloží až GUI: fc_cabinet_colors.py), spojovací
# materiál Konstrukce_Typ = sroub, žlaby Konstrukce_Typ = zlab, zóny mezer / rezervy Konstrukce_Typ = pomocny,
# dveře App::Part s Konstrukce_Pohyb (otevření 95°). Výsledek (FC_RESULT): {"ok", "out", "objektu", "odkazu", "chyby"}.
import json
import math
import os
import sys
import traceback

import FreeCAD as App
import Part

V = App.Vector
STAV = "dle dokumentace"
LAY = json.load(open(sys.argv[1], encoding="utf-8"))
OUT = os.path.abspath(sys.argv[2])
FOLDER = os.path.abspath(sys.argv[3]) if len(sys.argv) > 3 else os.path.dirname(os.path.dirname(OUT))
GUID = LAY.get("projectGuid") or ""
ERR = []
STATS = {"odkazu": 0, "zastupnych": 0, "sroubu": 0, "odkazu_tvaru": 0}
SHARED = {}          # podpis tvaru → (zdrojový Part::Feature, min. obálky lokálního tvaru) — opakované díly jako App::Link


def box(x0, x1, y0, y1, z0, z1):
    return Part.makeBox(x1 - x0, y1 - y0, z1 - z0, V(x0, y0, z0))


def cyl_y(r, y0, y1, x, z):
    return Part.makeCylinder(r, y1 - y0, V(x, y0, z), V(0, 1, 0))


def cyl_z(r, z0, z1, x, y):
    return Part.makeCylinder(r, z1 - z0, V(x, y, z0), V(0, 0, 1))


def hex_z(s, z0, z1, x=0.0, y=0.0):
    r = s / math.sqrt(3.0)
    pts = [V(x + r * math.cos(math.radians(30 + 60 * i)), y + r * math.sin(math.radians(30 + 60 * i)), z0) for i in range(6)]
    return Part.Face(Part.makePolygon(pts + [pts[0]])).extrude(V(0, 0, z1 - z0))


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


DOC = App.newDocument("Rozvadec")
os.makedirs(os.path.dirname(OUT), exist_ok=True)
DOC.saveAs(OUT)          # odkaz App::Link na jiný dokument potřebuje uložený dokument vlastníka (relativní cesta XLink)


def part(name, label, parent=None, **pr):
    p = DOC.addObject("App::Part", name)
    p.Label = label
    props(p, pr)
    if parent is not None:
        parent.addObject(p)
    return p


def _key(s):
    """Podpis tvaru (s jeho umístěním) nezávislý na posunutí: objem, plocha, počty a vrcholy vůči min. obálky."""
    bb = s.BoundBox
    pts = tuple(sorted((round(v.X - bb.XMin, 3), round(v.Y - bb.YMin, 3), round(v.Z - bb.ZMin, 3)) for v in s.Vertexes))
    return (round(s.Volume, 3), round(s.Area, 3), len(s.Faces), len(s.Edges), pts), V(bb.XMin, bb.YMin, bb.ZMin)


def shape_key(sh):
    """Podpis lokálního tvaru (bez umístění objektu)."""
    loc = sh.copy()
    loc.Placement = App.Placement()
    return _key(loc)


def _axis_rotations():
    """24 otočení, která převádějí osy na osy (upínka na dveřích × na boku skříně = týž kvádr otočený)."""
    out = []
    for perm in ((0, 1, 2), (0, 2, 1), (1, 0, 2), (1, 2, 0), (2, 0, 1), (2, 1, 0)):
        for sg in ((1, 1, 1), (1, 1, -1), (1, -1, 1), (1, -1, -1), (-1, 1, 1), (-1, 1, -1), (-1, -1, 1), (-1, -1, -1)):
            m = [[0.0] * 3 for _ in range(3)]
            for i in range(3):
                m[i][perm[i]] = float(sg[i])
            det = (m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
                   + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]))
            if det > 0 and (perm, sg) != ((0, 1, 2), (1, 1, 1)):
                M = App.Matrix(m[0][0], m[0][1], m[0][2], 0, m[1][0], m[1][1], m[1][2], 0, m[2][0], m[2][1], m[2][2], 0)
                out.append(App.Rotation(M))
    return out


AXIS_ROT = _axis_rotations()


def feat(name, label, shape, parent, share=True, **pr):
    """Těleso dílu. Opakovaný tvar (stejný jako dříve vložený, jen posunutý / jinak umístěný) = App::Link na první kus
    s vlastními vlastnostmi (kontrola ``kopie`` pro3d_tools — kopie těles jsou chyba); pomocné a kabely se nesdílejí."""
    if not shape.isValid() or not shape.Solids:
        ERR.append(f"{label}: neplatné těleso")
    elif share and pr.get("Konstrukce_Typ") not in ("pomocny", "kabel"):
        key, mn = shape_key(shape)
        hit = None
        if key in SHARED:
            src, mn0 = SHARED[key]
            hit = (src, shape.Placement.multiply(App.Placement(mn - mn0, App.Rotation())))
        else:
            loc = shape.copy()
            loc.Placement = App.Placement()
            for R in AXIS_ROT:          # R(lokální) = zdroj + Δ  →  umístění odkazu = pl · R⁻¹ · T(Δ)
                s2 = loc.copy()
                s2.Placement = App.Placement(V(), R)
                k2, mn2 = _key(s2)
                if k2 in SHARED:
                    src, mn0 = SHARED[k2]
                    hit = (src, shape.Placement.multiply(App.Placement(V(), R.inverted())).multiply(
                        App.Placement(mn2 - mn0, App.Rotation())))
                    break
        if hit is not None:
            lk = DOC.addObject("App::Link", name)
            lk.setLink(hit[0])
            lk.Label = label
            lk.Placement = hit[1]
            props(lk, pr)
            parent.addObject(lk)
            STATS["odkazu_tvaru"] += 1
            return lk
    o = DOC.addObject("Part::Feature", name)
    o.Label = label
    o.Shape = shape
    props(o, pr)
    parent.addObject(o)
    if share and shape.Solids and pr.get("Konstrukce_Typ") not in ("pomocny", "kabel"):
        SHARED.setdefault(shape_key(shape)[0], (o, shape_key(shape)[1]))
    return o


def bom_props(d):
    return {"PLCdesk_Id": d["pid"], "PLCdesk_Instance": str(d["inst"]), "PLCdesk_Tag": d["tag"], "PLCdesk_Mount": d["mount"] or "",
            "PLCdesk_OrderCode": d["code"], "PLCdesk_ProjectGuid": GUID,
            "PLCdesk_Station": "" if d.get("station") is None else str(d["station"]),
            "PLCdesk_Slot": "" if d.get("slot") is None else str(d["slot"])}


_DOCS = {}


def ext_part(path):
    p = os.path.abspath(path)
    if p not in _DOCS:
        d = App.openDocument(p)
        _DOCS[p] = d
    d = _DOCS[p]
    root = d.getObject("Dil") or next((o for o in d.RootObjects if o.TypeId == "App::Part"), None)
    return root


# --- přístroj: odkaz na model dle dokumentace, jinak zástupná obálka ---------------------------------------------------

def device(d, parent, name, rotate180=False):
    b = d["box"]
    lb = d["lb"]
    label = f"{d['tag']} {d['label'] or d['cat']}".strip()
    if d["inst"] and d["inst"] > 1 or d["cat"] == "terminal_block":
        label += f" #{d['inst']}"
    mp = os.path.join(FOLDER, d["model"]) if d.get("model") else ""
    if mp and os.path.isfile(mp):
        try:
            root = ext_part(mp)
            lk = DOC.addObject("App::Link", name)
            lk.setLink(root)
            lk.Label = label
            if rotate180:
                pos = V(b[0] + lb[1], b[2] + lb[3], b[4] - lb[4])
                lk.Placement = App.Placement(pos, App.Rotation(V(0, 0, 1), 180))
            else:
                lk.Placement = App.Placement(V(b[0] - lb[0], b[2] - lb[2], b[4] - lb[4]), App.Rotation())
            props(lk, bom_props(d), "PLCdesk")
            props(lk, {"PLCdesk_ModelStatus": "dle dokumentace", "Konstrukce_Zdroj": d["rozmer"]["zdroj"]})
            parent.addObject(lk)
            STATS["odkazu"] += 1
            return lk
        except Exception as exc:  # noqa: BLE001
            ERR.append(f"{label}: odkaz na {mp} selhal ({exc}) — zástupná obálka")
    o = feat(name, label + " (zástupný)", box(*b), parent,
             Konstrukce_Typ="dil", Konstrukce_Zastupny=True, Konstrukce_Zdroj=d["rozmer"]["zdroj"],
             Konstrukce_RozmerStav=d["rozmer"]["stav"])
    props(o, bom_props(d), "PLCdesk")
    props(o, {"PLCdesk_ModelStatus": "placeholder"}, "PLCdesk")
    STATS["zastupnych"] += 1
    return o


def screw(s, parent, n):
    d, l, dk, k = s["d"], s["l"], s["dk"], s["k"]
    head = cyl_z(dk / 2, 0, k, 0, 0).cut(hex_z(s["s"], k - s["t"], k + 1))
    shank = cyl_z(d / 2, -l, 0, 0, 0)
    sh = head.fuse(shank).removeSplitter()
    rot = App.Rotation(V(0, 0, -1), V(*s["dir"]))
    sh.Placement = App.Placement(V(*s["head"]), rot)
    STATS["sroubu"] += 1
    return feat(f"Sroub{n:03d}", s["name"], sh, parent, Konstrukce_Typ="sroub", Konstrukce_ModelStav=STAV,
                Konstrukce_Zdroj=s.get("zdroj", ""), Konstrukce_Ucel=s.get("ucel", ""),
                Konstrukce_Generator="pro3d_cabinet/ISO4762")


def rail_shape(r, holes, y0):
    nm = LAY["geom"]
    b, h, t, dno = 35.0, 7.5, 1.0, 27.0
    a = dno / 2
    pts = [(-a, 0), (a, 0), (a, h - t), (b / 2, h - t), (b / 2, h), (a - t, h), (a - t, t), (-a + t, t), (-a + t, h),
           (-b / 2, h), (-b / 2, h - t), (-a, h - t), (-a, 0)]
    zc = r["zc"]
    face = Part.Face(Part.makePolygon([V(r["x0"], y0 + hy, zc + wz) for wz, hy in pts]))
    sh = face.extrude(V(r["x1"] - r["x0"], 0, 0))
    cut = [cyl_y(hh["d"] / 2, y0 - 1, y0 + t + 1, hh["x"], zc) for hh in holes]
    if cut:
        sh = sh.cut(Part.makeCompound(cut))
    return sh


def duct_shape(dct, holes, y0, h, tw):
    if dct["orient"] == "h":
        u = box(dct["x0"], dct["x1"], y0, y0 + h, dct["z0"], dct["z1"])
        inner = box(dct["x0"] - 1, dct["x1"] + 1, y0 + tw, y0 + h + 1, dct["z0"] + tw, dct["z1"] - tw)
    else:
        u = box(dct["x0"], dct["x1"], y0, y0 + h, dct["z0"], dct["z1"])
        inner = box(dct["x0"] + tw, dct["x1"] - tw, y0 + tw, y0 + h + 1, dct["z0"] - 1, dct["z1"] + 1)
    sh = u.cut(inner)
    cut = [cyl_y(hh["d"] / 2, y0 - 1, y0 + tw + 1, hh["x"], hh["z"]) for hh in holes]
    if cut:
        sh = sh.cut(Part.makeCompound(cut))
    return sh


def build():
    G = LAY["geom"]
    cab, pl, hw = LAY["cabinet"], LAY["plate"], LAY["hw"]
    W, H, D = float(cab["w"]), float(cab["h"]), float(cab["d"])
    t, tdv = G["stena"], G["dvere"]
    py0, py1 = pl["y0"], pl["y1"]
    root = part("Rozvadec", "Rozvaděč " + (cab.get("tag") or "+1"), PLCdesk_Id="asm:cabinet", PLCdesk_ProjectGuid=GUID,
                Konstrukce_Generator="pro3d_cabinet", Konstrukce_Poznamka="vygenerováno kódem (pro3d_cabinet) — layout.json, ROZVADEC.md")
    # skříň
    sk = part("Skrin", f"{cab.get('tag') or '+1'} Skříň {cab['brand']} {cab['orderCode']} (zástupný)", root,
              PLCdesk_Id=cab["id"], PLCdesk_Tag=cab.get("tag") or "+1", PLCdesk_OrderCode=cab["orderCode"], PLCdesk_ProjectGuid=GUID,
              PLCdesk_ModelStatus="placeholder", Konstrukce_Zastupny=True)
    yb = D - tdv
    body = box(0, W, 0, yb, 0, H).cut(box(t, W - t, t, yb + 1, t, H - t))
    adds = [cyl_y(s["r"], s["y0"], s["y1"], s["x"], s["z"]) for s in hw["studs"]]
    for hg in hw["hinges"]:
        adds.append(cyl_z(hg["r"], hg["z0"], hg["zm"], hg["x"], hg["y"]))
        adds.append(box(hg["leaf_x0"], hg["leaf_x1"], hg["y"] - hg["r"] - 1.0, yb - 0.05, hg["z0"], hg["zm"]))   # křídlo k boku
    body = body.fuse(adds).removeSplitter()
    cuts = [cyl_y(s["tap"] / 2, s["y0"] - 0.5, s["y1"] + 0.5, s["x"], s["z"]) for s in hw["studs"]]
    cuts += [cyl_z(hh["d"] / 2, -1, t + 1, hh["x"], hh["y"]) for hh in hw["gland_holes"]]
    cuts += [cyl_z(hg["hole_r"], hg["z0"] - 1, hg["zm"] + 0.0, hg["x"], hg["y"]) for hg in hw["hinges"]]
    body = body.cut(Part.makeCompound(cuts))
    feat("Skrin_teleso", f"Skříň {cab['orderCode']} — obálka {W:.0f}×{H:.0f}×{D:.0f} (zástupný)", body, sk,
         Konstrukce_Typ="dil", Konstrukce_Zastupny=True, PLCdesk_ModelStatus="placeholder",
         Konstrukce_Zdroj=f"rozměry {cab['src']}; plech, sloupky, panty = ODHAD (layout.json geom)")
    # deska
    plate = box(pl["x0"], pl["x1"], py0, py1, pl["z0"], pl["z1"])
    holes = [cyl_y(hh["d"] / 2, py0 - 1, py1 + 1, hh["x"], hh["z"]) for hh in hw["plate_holes"]]
    plate = plate.cut(Part.makeCompound(holes))
    feat("Deska", f"Montážní deska {cab['plateW']}×{cab['plateH']}×{G['deska']}", plate, root, Konstrukce_Typ="dil",
         Konstrukce_Zdroj=f"rozměr desky {cab['src']}; tloušťka / odsazení ODHAD")
    # lišty, žlaby, víka
    gl = part("Listy", "Lišty TS35 (návrh, mimo kusovník)", root)
    for r in LAY["rails"]:
        if r["kind"] != "din":
            continue
        feat(f"Lista{r['n']}", f"Lišta TS35×7,5 {r['n']} ({r['L']:.0f} mm, rezerva {r['rezerva_pct']:.1f} %)",
             rail_shape(r, hw["rail_holes"].get(str(r["n"]), []), py1), gl, Konstrukce_Typ="dil", Konstrukce_ModelStav=STAV,
             Konstrukce_Zdroj="https://www.wago.com/global/accessories/steel-carrier-rail/p/210-113",
             Konstrukce_Generator="pro3d_cabinet/TS35")
    gz = part("Zlaby", "Kabelové žlaby (návrh, mimo kusovník)", root)
    for i, dct in enumerate(LAY["ducts"], start=1):
        feat(f"Zlab{i}", f"{dct['name']} {G['zlab_s']:.0f}×{G['zlab_h']:.0f}",
             duct_shape(dct, hw["duct_holes"].get(dct["name"], []), py1, G["zlab_h"], G["zlab_t"]), gz,
             Konstrukce_Typ="zlab", Konstrukce_Vedeni="zlab", Konstrukce_Zdroj="ODHAD 30×40 — typ z katalogu doplnit")
        cv = box(dct["x0"], dct["x1"], py1 + G["zlab_h"], py1 + G["zlab_h"] + G["zlab_vika"], dct["z0"], dct["z1"])
        feat(f"Viko{i}", f"Víko {dct['name'].lower()}", cv, gz, Konstrukce_Typ="prislusenstvi",
             Konstrukce_Zdroj="ODHAD — víko žlabu nacvaknuté")
    # přístroje
    groups = {}
    labels = {"napajeni": "R1 Napájení a jištění", "silova": "R2 Silová část", "pohony": "R3 Pohony", "rizeni": "R4 Řízení",
              "svorky": "R5 Svorkovnice"}
    stations = {}
    n = 0
    for d in LAY["devices"]:
        n += 1
        if d["kind"] == "zarazka":
            continue
        if d.get("station") is not None:
            key = d["station"]
            if key not in stations:
                stations[key] = part(f"Stanice{key}", f"PLC stanice {key}", root, PLCdesk_Id=f"asm:station:{key}",
                                     PLCdesk_ProjectGuid=GUID)
            par = stations[key]
        else:
            g = d["group"]
            if g not in groups:
                groups[g] = part(f"Skupina_{g}", labels.get(g, g), root)
            par = groups[g]
        device(d, par, f"Pristroj{n:03d}")
    ge = part("Zarazky", "Koncové zarážky (návrh, mimo kusovník)", root)
    for k, e in enumerate(hw["endstops"], start=1):
        b = e["box"]
        sh = box(*b).cut(cyl_y(e["tap"] / 2, b[2] - 1, b[3] + 1, e["x"], e["z"]))
        feat(f"Zarazka{k}", e["name"], sh, ge, Konstrukce_Typ="dil", Konstrukce_Zdroj="ODHAD 10×35×25 — typ doplnit")
    # dveře (pohyb 95° kolem pantů)
    ax = hw["door_axis"]
    dv = part("Dvere", "Dveře (zástupný)", root, Konstrukce_Pohyb=json.dumps({"nazev": "dveře otevřené 95°", "otoc": ax},
                                                                               ensure_ascii=False))
    door = box(0, W, D - tdv, D, 0, H)
    adds = []
    for hg in hw["hinges"]:
        adds.append(cyl_z(hg["r"], hg["zm"], hg["z1"], hg["x"], hg["y"]))
        adds.append(box(hg["leaf_x0"], hg["leaf_x1"], D - tdv, D, hg["zm"], hg["z1"]))
    door = door.fuse(adds).removeSplitter()
    cuts = [box(c["x0"], c["x1"], D - tdv - 1, D + 1, c["z0"], c["z1"]) for c in hw["door_cutouts"]]
    cuts += [cyl_y(h["d"] / 2, D - tdv - 1, D + 1, h["x"], h["z"]) for h in hw["door_holes"]]
    cuts += [cyl_z(hg["hole_r"], hg["zm"], hg["z1"] + 1, hg["x"], hg["y"]) for hg in hw["hinges"]]
    door = door.cut(Part.makeCompound(cuts))
    feat("Dvere_teleso", "Dveře skříně (zástupný)", door, dv, Konstrukce_Typ="kryt", Konstrukce_Zastupny=True,
         PLCdesk_ModelStatus="placeholder", Konstrukce_Zdroj="ODHAD plech 2 mm, panty vlevo")
    for k, d in enumerate(LAY["door"]["items"], start=1):
        device(d, dv, f"Dvere_pristroj{k:02d}", rotate180=not d["hmi"])
    # spojovací materiál (dveřní šrouby patří do dveří — pohybují se s nimi)
    gs = part("Sroubky", "Spojovací materiál ISO 4762", root)
    for s in hw["screws"]:
        par = dv if "ve dveřích" in s.get("ucel", "") else gs
        screw(s, par, STATS["sroubu"] + 1)
    for k, hg in enumerate(hw["hinges"], start=1):
        pin = cyl_z(hg["pin_r"], hg["z0"], hg["z1"], hg["x"], hg["y"])
        feat(f"Cep{k}", f"Čep pantu {k} Ø{2 * hg['pin_r']:.0f} (ODHAD)", pin, gs, Konstrukce_Typ="sroub",
             Konstrukce_Zdroj="ODHAD — pant skříně")
    # vývodky ve dně (šestihran a kopule vně, závit dnem)
    gv = part("Vyvodky", "Vývodky (návrh, mimo kusovník)", root)
    for k, g in enumerate(hw["glands"], start=1):
        th = cyl_z(g["thread"] / 2, 0.0, g["D"], g["x"], g["y"])
        hx = hex_z(g["sw"], -(g["C"] - g["D"]), 0.0, g["x"], g["y"])
        feat(f"Vyvodka{k}", g["name"], th.fuse(hx).removeSplitter(), gv, Konstrukce_Typ="prislusenstvi", Konstrukce_ModelStav=STAV,
             Konstrukce_Zdroj=g.get("zdroj", ""), Konstrukce_Generator="pro3d_cabinet/SKINTOP")
    # zóny mezer a rezervy (pomocné — kontroly je vynechají, STEP je nemá)
    gzn = part("Zony_mezer", "Zóny mezer výrobců", root)
    for k, z in enumerate(LAY["zones"], start=1):
        b = z["box"]
        if b[1] - b[0] < 0.1 or b[3] - b[2] < 0.1 or b[5] - b[4] < 0.1:
            continue
        feat(f"Mezera{k:03d}", z["name"], box(*b), gzn, Konstrukce_Typ="pomocny", Zona_pro=z["pro"],
             Konstrukce_Zdroj=f"mezery {z['stav']}: nad {z['nad']}, pod {z['pod']}, bok {z['bok']}, před {z['pred']}")
    grz = part("Rezervy", "Rezervy lišt", root)
    for k, r in enumerate(LAY["reserves"], start=1):
        b = r["box"]
        if b[1] - b[0] < 0.5:
            continue
        feat(f"Rezerva{k:02d}", r["name"], box(*b), grz, Konstrukce_Typ="pomocny")
    build_extras(root, dv)
    DOC.recompute()
    DOC.save()


# --- dveře, kabeláž ke dveřím, přepážky, PE / N (dvere.py → layout.json) ------------------------------------------------

def _wire(prvky):
    edges = []
    for e in prvky:
        if e[0] == "usek":
            a, b = V(*e[1]), V(*e[2])
            if (b - a).Length > 1e-6:
                edges.append(Part.LineSegment(a, b).toShape())
        else:
            edges.append(Part.Arc(V(*e[1]), V(*e[2]), V(*e[3])).toShape())
    return Part.Wire(edges)


def _tube(prvky, r):
    """Svazek = tažení kruhu po každém prvku střednice zvlášť (úsečka / oblouk v jedné rovině — robustní i pro STEP),
    sloučené do jednoho tělesa; nesloučitelné → složenina."""
    w = _wire(prvky)
    pieces = []
    for ed in w.OrderedEdges:
        p0 = ed.valueAt(ed.FirstParameter)
        t0 = ed.tangentAt(ed.FirstParameter)
        prof = Part.Wire([Part.makeCircle(r, p0, t0)])
        pieces.append(Part.Wire([ed]).makePipeShell([prof], True, False))
    sh = pieces[0]
    if len(pieces) > 1:
        try:
            f = pieces[0].fuse(pieces[1:]).removeSplitter()
            sh = f if f.isValid() and len(f.Solids) == 1 else Part.makeCompound(pieces)
        except Exception:  # noqa: BLE001
            sh = Part.makeCompound(pieces)
    return sh, w


def build_extras(root, dv):
    G, hw = LAY["geom"], LAY["hw"]
    D = float(LAY["cabinet"]["d"])
    dd = LAY.get("dvere") or {}
    # čelní obálka hlavního vypínače (dle dokumentace: deska 66 × 66, před panelem 39, 4 × Ø5 na 48 × 48)
    for k, fb in enumerate(dd.get("front_blocks", []), start=1):
        b = fb["box"]
        sh = box(*b)
        cuts = [cyl_y(fb["d"] / 2, b[2] - 1, b[2] + fb["deska_t"] + 0.01, x, z) for x, z in fb["bores"]]
        m4 = 7.0 / 2 + 0.5
        cuts += [cyl_y(m4, b[2] + fb["deska_t"], b[3] + 1, x, z) for x, z in fb["bores"]]
        sh = sh.cut(Part.makeCompound(cuts))
        feat(f"Celo{k:02d}", f"{fb['tag']} čelní deska a rukojeť (obálka dle dokumentace 66 × 66 × 39)", sh, dv, Konstrukce_Typ="dil",
             Konstrukce_ModelStav=STAV, Konstrukce_Detail="obálka", Konstrukce_Zdroj=fb["zdroj"], Konstrukce_Generator="pro3d_cabinet/dvere")
    for k, c in enumerate(dd.get("clips", []), start=1):
        feat(f"Upinka_HMI{k:02d}", c["name"], box(*c["box"]), dv, Konstrukce_Typ="sroub", Konstrukce_Zastupny=True,
             PLCdesk_ModelStatus="placeholder", Konstrukce_Zdroj=c["zdroj"])
    for key, label in (("fan", "Filtrační ventilátor"), ("filter", "Výstupní filtr")):
        f = dd.get(key)
        if not f:
            continue
        sh = box(*f["ram"])
        if f.get("telo"):
            sh = sh.fuse(box(*f["telo"])).removeSplitter()
        feat(f"Dvere_{key}", f"{label} {f['tag'].split(' ', 1)[-1]} (zástupný — rozměry dle datového listu Rittal, upevnění ODHAD)", sh, dv,
             Konstrukce_Typ="prislusenstvi", Konstrukce_Zastupny=True, PLCdesk_ModelStatus="placeholder",
             Konstrukce_Zdroj="Rittal datový list (layout.json bilance.ventilator) — návrh mimo kusovník")
    # svazky ke dveřím: kmen a větve na dveřích (pohyb s dveřmi), volný a pevný úsek ve skříni
    gk = part("Kabelaz_dvere", "Kabeláž ke dveřím (svazky, návrh)", root)
    n = 0
    for kind, r in (LAY.get("kabelaz_dvere") or {}).items():
        for t in r.get("tubes", []):
            n += 1
            try:
                sh, w = _tube(t["prvky"], t["r"])
            except Exception as exc:  # noqa: BLE001
                ERR.append(f"{t['name']}: svazek nevznikl ({exc})")
                continue
            par = dv if t["part"] == "door" else gk
            feat(f"Svazek{n:02d}", t["name"] + f" Ø{2 * t['r']:.1f}", sh, par, Konstrukce_Typ="kabel", Konstrukce_Druh=kind,
                 Konstrukce_Ulozeni=t["ulozeni"], Konstrukce_Osa=f"Osa_svazek{n:02d}",
                 Konstrukce_Zdroj=f"pro3d_cabinet/dvere.py — R pevně {r['R_pevne']} / pohyblivě {r['R_pohyb']} mm ({r['R_zdroj']})")
            o = DOC.addObject("Part::Feature", f"Osa_svazek{n:02d}")
            o.Label = f"Střednice — {t['name']}"
            o.Shape = w
            props(o, {"Konstrukce_Typ": "pomocny"})
            par.addObject(o)
        for k, c in enumerate(r.get("door_clamps", []), start=1):
            feat(f"Upinka_{kind}_dv{k:02d}", c["name"], box(*c["box"]), dv, Konstrukce_Typ="prislusenstvi", Konstrukce_Zastupny=True,
                 PLCdesk_ModelStatus="placeholder", Konstrukce_Zdroj="ODHAD — upínka svazku se stahovací páskou")
        for k, c in enumerate(r.get("cab_clamps", []), start=1):
            feat(f"Upinka_{kind}_sk{k:02d}", c["name"], box(*c["box"]), gk, Konstrukce_Typ="prislusenstvi", Konstrukce_Zastupny=True,
                 PLCdesk_ModelStatus="placeholder", Konstrukce_Zdroj="ODHAD — upínka svazku se stahovací páskou")
    # přepážky žlabů a dělicí plechy u pantu (uzemněné, návrh)
    gp = part("Prepazky", "Přepážky silová × signálová trasa (uzemněné, návrh)", root)
    for k, p in enumerate(hw.get("partitions", []), start=1):
        sh = box(*p["stojina"]).fuse(box(*p["patka"])).removeSplitter()
        cuts = [cyl_y(4.5, p["patka"][2] - 1, p["patka"][3] + 1, x, z) for x, z in p["notches"]]
        cuts += [cyl_y(2.1, p["patka"][2] - 1, p["patka"][3] + 1, x, z) for x, z in p["screws"]]
        if cuts:
            sh = sh.cut(Part.makeCompound(cuts))
        feat(f"Prepazka{k:02d}", p["name"], sh, gp, Konstrukce_Typ="dil", Konstrukce_Zdroj=LAY["oddeleni"]["zdroj"]["dokument"],
             Konstrukce_Poznamka="podélná přepážka smíšeného žlabu, šrouby M4 do závitu desky (uzemnění)")
    for k, e in enumerate(LAY.get("oddeleni", {}).get("celni", []), start=1):
        sh = box(*e["box"])
        for v in e.get("vyrezy") or []:
            b = e["box"]
            sh = sh.cut(box(b[0] - 1, b[1] + 1, v[0], v[1], v[2], v[3]))
        feat(f"Celni_prepazka{k:02d}", e["name"], sh, gp, Konstrukce_Typ="prislusenstvi", Konstrukce_Zdroj="ODHAD — přepážka komory")
    for k, e in enumerate(LAY.get("oddeleni", {}).get("delici_plechy", []), start=1):
        feat(f"Delici_plech{k:02d}", e["name"], box(*e["box"]), dv if e["part"] == "door" else gp, Konstrukce_Typ="prislusenstvi",
             Konstrukce_Zastupny=True, PLCdesk_ModelStatus="placeholder", Konstrukce_Zdroj="ODHAD — dělicí plech u pantu (uzemněný)")
    # PE / N přípojnice
    bb = hw.get("busbars")
    if bb:
        gb = part("Pripojnice", "PE a N přípojnice (návrh, mimo kusovník)", root)
        pe, nn, iz = bb["PE"], bb["N"], bb["izolator"]
        sh = box(*pe["box"]).cut(Part.makeCompound([cyl_y(2.1, pe["box"][2] - 1, pe["box"][3] + 1, pe["x"], z) for z in pe["sroub_z"]]))
        feat("PE_pripojnice", f"PE přípojnice Cu {pe['b']:.0f}×{pe['t']:.0f}×{pe['L']:.0f} na desce (vodivě, návrh)", sh, gb,
             Konstrukce_Typ="dil", Konstrukce_Zdroj=pe["zdroj"]["dokument"], Konstrukce_Pripojnice="PE")
        sh = box(*nn["box"]).cut(Part.makeCompound([cyl_y(2.1, nn["box"][2] - 1, nn["box"][3] + 1, nn["x"], z) for z in nn["sroub_z"]]))
        feat("N_pripojnice", f"N přípojnice {nn['typ']} na izolátorech (izolovaná od desky, návrh)", sh, gb, Konstrukce_Typ="dil",
             Konstrukce_Zdroj=nn["zdroj"]["dokument"], Konstrukce_Pripojnice="N")
        y0 = bb["y_deska"]
        h, hl, rt = float(iz["h"]), float(iz["hloubka"]), bb["tap"] / 2
        for k, z in enumerate(iz["z"], start=1):
            c = cyl_y(float(iz["d"]) / 2, y0, y0 + h, nn["x"], z)
            c = c.cut(cyl_y(rt, y0 - 1, y0 + hl, nn["x"], z)).cut(cyl_y(rt, y0 + h - hl, y0 + h + 1, nn["x"], z))
            feat(f"Izolator_N{k}", f"Izolátor N přípojnice {k} Ø{float(iz['d']):.0f}×{h:.0f} PA (zástupný, ODHAD typu)", c, gb,
                 Konstrukce_Typ="dil", Konstrukce_Zastupny=True, PLCdesk_ModelStatus="placeholder",
                 Konstrukce_Material=iz.get("material") or "PA (izolant)",
                 Konstrukce_Zdroj=iz["pozn"])
        for k, s in enumerate(bb["studs"], start=1):
            feat(f"Zavrtny_N{k}", s["name"], cyl_y(s["r"], s["y0"], s["y1"], s["x"], s["z"]), gb, Konstrukce_Typ="sroub",
                 Konstrukce_Zdroj="ODHAD — závrtný šroub izolátoru (kov jen v dolním závitu izolátoru)")


res = {"ok": False, "out": OUT}
try:
    App.ParamGet("User parameter:BaseApp/Preferences/Document").SetBool("CreateBackupFiles", False)
    build()
    res.update(ok=not ERR, objektu=len(DOC.Objects), **STATS)
except Exception as exc:  # noqa: BLE001
    ERR.append(f"{type(exc).__name__}: {exc}")
    res["trace"] = traceback.format_exc()[-2500:]
res["chyby"] = ERR
for d in list(_DOCS.values()):
    try:
        App.closeDocument(d.Name)
    except Exception:  # noqa: BLE001
        pass
path = os.environ.get("FC_RESULT") or globals().get("FC_RESULT") or os.path.splitext(OUT)[0] + "_vysledek.json"
json.dump(res, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(json.dumps({"ok": res["ok"], "chyby": len(ERR)}))
