# FreeCAD 1.1 (freecadcmd) — scéna pro generátor modulů: čte (jen čte) schválený rám ``ram/Ram.FCStd`` a koncept
# ``koncept/Koncept.FCStd`` a zapíše ``scena.json`` (objekty s obálkou v globálních souřadnicích, druh dílu, PLCdesk_Id,
# skupiny pro odkazy). Spouštět JEN přes skill freecad-instance:
#   & run_fc.ps1 run --slot pro3d-modules --timeout 600 --result <scena.json> fc_scene.py <Ram.FCStd> [<Koncept.FCStd>]
# Nic se neukládá. Duté díly (plech skříňky, kryt) dostanou místo jedné obálky obálky svých stěn (``boxes``) — router
# tras pak vidí vnitřek skříňky jako volný prostor.
import json
import os
import re
import sys
import unicodedata

import FreeCAD as App
import Part

CONTAINERS = ("App::Part", "App::DocumentObjectGroup", "App::LinkGroup")


def fold(s):
    s = unicodedata.normalize("NFKD", str(s or ""))
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


def props(o):
    out = {}
    for k in o.PropertiesList:
        if k.startswith(("PLCdesk_", "Konstrukce_", "Placeholder", "Zona_")):
            try:
                v = getattr(o, k)
            except Exception:  # noqa: BLE001
                continue
            out[k] = v if isinstance(v, (str, int, float, bool)) else str(v)
    return out


def bb6(b):
    return [round(b.XMin, 2), round(b.YMin, 2), round(b.ZMin, 2), round(b.XMax, 2), round(b.YMax, 2), round(b.ZMax, 2)]


def wall_boxes(s):
    """Obálky stěn dutého tělesa (rovinné plochy ≥ 400 mm², max. 600)."""
    out = []
    for f in s.Faces:
        if f.Surface.TypeId != "Part::GeomPlane" or f.Area < 400:
            continue
        b = f.BoundBox
        out.append(bb6(b))
        if len(out) >= 600:
            break
    return out


def walk(o, plc, path, inh, docname, out, link_src):
    if o.TypeId.startswith("App::Origin") or o.TypeId in ("App::Line", "App::Plane", "App::Point"):
        return
    pr = props(o)
    lab = o.Label
    kont = inh["kontext"] or "kontext" in fold(lab)
    sub = {"kontext": kont, "pohyb": pr.get("Konstrukce_Pohyb") or inh["pohyb"], "pid": pr.get("PLCdesk_Id") or inh["pid"],
           "pkey": "/".join(path + [lab]) if pr.get("PLCdesk_Id") else inh.get("pkey", ""),
           # role celku konceptu (``Konstrukce_Role = stul`` = pracovní stůl / rám) — dědí se na tělesa uvnitř
           "role": pr.get("Konstrukce_Role") or inh.get("role", "")}
    if o.TypeId in CONTAINERS:
        nplc = plc.multiply(o.Placement) if o.TypeId == "App::Part" else plc
        for c in getattr(o, "Group", []) or []:
            walk(c, nplc, path + [lab], sub, docname, out, link_src)
        return
    if o.TypeId == "App::Link":
        lo = o.LinkedObject
        if lo is not None and lo.TypeId in CONTAINERS:
            nplc = plc.multiply(o.Placement)
            if getattr(o, "LinkTransform", False):
                nplc = nplc.multiply(lo.Placement)
            lpr = props(lo)
            lpid = pr.get("PLCdesk_Id") or lpr.get("PLCdesk_Id")
            sub = dict(sub, pid=lpid or sub["pid"], pkey="/".join(path + [lab]) if lpid else sub["pkey"],
                       role=sub["role"] or lpr.get("Konstrukce_Role") or "")
            for c in getattr(lo, "Group", []) or []:
                walk(c, nplc, path + [lab], sub, docname, out, link_src)
            return
    if not hasattr(o, "Shape") or o.Name.startswith("SRC_"):
        return
    if (o.Document.Name, o.Name) in link_src and o.TypeId != "App::Link" and not getattr(o, "Visibility", True):
        return
    for p in o.InList:
        if p.TypeId not in CONTAINERS and p.TypeId != "App::Link" and p.isDerivedFrom("Part::Feature"):
            return                                   # základ booleanu
    try:
        s = Part.getShape(o, "", needSubElement=False, transform=False).copy()
    except Exception:  # noqa: BLE001
        return
    if s.isNull() or not s.Solids:
        return
    s.Placement = plc.multiply(o.Placement).multiply(s.Placement)
    b = s.BoundBox
    vol = s.Volume
    bvol = max(1e-9, b.XLength * b.YLength * b.ZLength)
    rec = {"doc": docname, "name": o.Name, "label": lab, "path": "/".join(path + [lab]), "typ": pr.get("Konstrukce_Typ") or "",
           "vedeni": pr.get("Konstrukce_Vedeni") or "", "pid": pr.get("PLCdesk_Id") or "", "pid_inh": sub["pid"] or "", "pkey": sub["pkey"],
           "zona": pr.get("Konstrukce_Zona") or "", "pohyb": pr.get("Konstrukce_Pohyb") or inh["pohyb"] or "",
           "stav": pr.get("PLCdesk_ModelStatus") or pr.get("Konstrukce_ModelStav") or "", "kontext": kont, "role": sub["role"],
           "bb": bb6(b), "vol": round(vol, 1), "grp": path[1] if len(path) > 1 else (path[0] if path else "")}
    if vol / bvol < 0.25 and max(b.XLength, b.YLength, b.ZLength) > 150:
        rec["boxes"] = wall_boxes(s)
    out.append(rec)


def scan(path, docname):
    doc = App.openDocument(path)
    for o in list(doc.Objects):
        if o.TypeId == "App::Link" and o.LinkedObject is not None and o.LinkedObject.Document is not doc:
            fn = getattr(o.LinkedObject.Document, "FileName", "")
            if fn:
                try:
                    App.openDocument(fn)
                except Exception:  # noqa: BLE001
                    pass
    doc = App.getDocument(doc.Name)
    link_src = set()
    for d in App.listDocuments().values():
        for o in d.Objects:
            if o.TypeId == "App::Link" and o.LinkedObject is not None:
                link_src.add((o.LinkedObject.Document.Name, o.LinkedObject.Name))
    out = []
    roots = []
    for o in doc.RootObjects:
        if o.TypeId == "App::DocumentObjectGroup" and fold(o.Label).startswith(("sablon", "zdroj")):
            continue
        if o.TypeId == "App::Part":
            kids = []
            for c in o.Group:
                if c.TypeId.startswith("App::Origin"):
                    continue
                gp = c.getGlobalPlacement() if hasattr(c, "getGlobalPlacement") else c.Placement
                kids.append({"name": c.Name, "label": c.Label, "type": c.TypeId, "kontext": "kontext" in fold(c.Label),
                             "placement": [list(gp.Base), list(gp.Rotation.Q)]})
            roots.append({"name": o.Name, "label": o.Label, "children": kids})
        walk(o, App.Placement(), [], {"kontext": False, "pohyb": "", "pid": "", "pkey": ""}, docname, out, link_src)
    return doc, out, roots


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    res = {"format": "plcdesk-pro3d-scene", "version": 1, "files": {}, "objects": [], "ram_roots": [], "chyby": []}
    for i, p in enumerate(args[:2]):
        name = "ram" if i == 0 else "koncept"
        if not p or not os.path.isfile(p):
            res["chyby"].append(f"{name}: soubor {p} chybí")
            continue
        try:
            doc, objs, roots = scan(os.path.abspath(p), name)
        except Exception as exc:  # noqa: BLE001
            res["chyby"].append(f"{name}: {exc}")
            continue
        res["files"][name] = os.path.abspath(p)
        res["objects"] += objs
        if name == "ram":
            res["ram_roots"] = roots
            res["ram_doc"] = doc.Name
    for d in list(App.listDocuments().values()):
        App.closeDocument(d.Name)
    res["ok"] = "ram" in res["files"]
    out = os.environ.get("FC_RESULT") or (os.path.splitext(args[0])[0] + "_scena.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(res, fh, ensure_ascii=False)
    print(json.dumps({"ok": res["ok"], "objektu": len(res["objects"]), "chyby": len(res["chyby"])}))


main()
