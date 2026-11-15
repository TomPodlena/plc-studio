# FreeCAD 1.1 (freecadcmd) — obálky (bounding box) modelů STEP / FCStd jen ke čtení (porovnání generovaného dílu
# s modelem výrobce). Spouštět JEN přes skill freecad-instance:
#   & run_fc.ps1 run --slot pro3d-parts --timeout 300 fc_bbox.py <soubor1> [<soubor2> …]
# Výsledek (FC_RESULT): {"soubory": {cesta: {"bbox": [xmin, xmax, ymin, ymax, zmin, zmax], "rozmery": [dx, dy, dz],
#                                          "telesa": n} | {"chyba": …}}}
import json
import os
import sys

import FreeCAD as App
import Part


def shape_of(path):
    if path.lower().endswith((".step", ".stp")):
        s = Part.Shape()
        s.read(path)
        return s
    doc = App.openDocument(path)
    try:
        shapes = [o.Shape for o in doc.Objects if o.TypeId == "Part::Feature" and not o.Shape.isNull()]
        return Part.makeCompound(shapes)
    finally:
        App.closeDocument(doc.Name)


res = {"soubory": {}}
for p in sys.argv[1:]:
    try:
        s = shape_of(p)
        b = s.BoundBox
        res["soubory"][p] = {"bbox": [round(x, 3) for x in (b.XMin, b.XMax, b.YMin, b.YMax, b.ZMin, b.ZMax)],
                             "rozmery": [round(b.XLength, 3), round(b.YLength, 3), round(b.ZLength, 3)],
                             "telesa": len(s.Solids)}
    except Exception as exc:  # noqa: BLE001
        res["soubory"][p] = {"chyba": str(exc)}
json.dump(res, open(os.environ.get("FC_RESULT") or globals().get("FC_RESULT"), "w", encoding="utf-8"), ensure_ascii=False)
