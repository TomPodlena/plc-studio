# -*- coding: utf-8 -*-
"""Syntetický model pro test pro3d_tools (FreeCAD headless). argv: [skript, out.FCStd]
Známé nálezy: kolize Kolidujici × Deska (12 500 mm³), [dveře dolů] Dvere × Deska, šroub × blok povolený (závit),
díl ve vzduchu „Volny dil“, kryt se štěrbinou 10 × 100 (Sr 105 ≥ 80 → OK) a čtvercovým otvorem 30 × 30 (Sr 85 < 120 → chyba),
kusovník -M1:motor 2× (duplicitní instance)."""
import sys

import FreeCAD as App
import Part

V = App.Vector
doc = App.newDocument("Synth")
root = doc.addObject("App::Part", "Stroj")


def add(name, shape, label=None, **props):
    o = doc.addObject("Part::Feature", name)
    o.Shape = shape
    o.Label = label or name
    for k, v in props.items():
        o.addProperty("App::PropertyString", k, "PLCdesk")
        setattr(o, k, v)
    root.addObject(o)
    return o


box = lambda dx, dy, dz, x, y, z: Part.makeBox(dx, dy, dz, V(x, y, z))
add("Deska", box(600, 400, 10, 0, 0, 0))
add("Profil", box(40, 40, 400, 20, 20, 10), "Profil 40x40 sloup")
add("Konzola", box(60, 40, 10, 60, 20, 200).cut(Part.makeCylinder(3.2, 30, V(90, 40, 190))))
add("Blok", box(40, 40, 30, 70, 20, 170).cut(Part.makeCylinder(2.5, 40, V(90, 40, 165))))
add("Sroub", Part.makeCylinder(3, 35, V(90, 40, 175)).fuse(Part.makeCylinder(5, 5, V(90, 40, 210))).removeSplitter(),
    "Šroub ISO 4762 M6x35")
add("Kolidujici", box(50, 50, 50, 500, 300, 5), "Kolidujici blok")
add("Volny", box(20, 20, 20, 500, 50, 300), "Volny dil")
outer = box(280, 280, 280, 200, 60, 10)
inner = box(270, 270, 270, 205, 65, 15)
kryt = outer.cut(inner).cut(box(10, 20, 100, 335, 50, 100)).cut(box(20, 30, 30, 470, 205, 135))
add("Kryt", kryt, "Kryt lisu")
add("Zona_Lis", box(100, 100, 100, 290, 170, 100), "Zona_Lis", Konstrukce_Typ="zona")
add("Dvere", box(100, 5, 100, 0, 15, 50), "Dvere", Konstrukce_Pohyb='{"nazev": "dveře dolů", "posun": [0, 0, -60]}')
add("M1", box(40, 40, 40, 505, 305, 55), "-M1 motor (zástupný)", PLCdesk_Id="-M1:motor", PLCdesk_Instance="1",
    PLCdesk_ModelStatus="placeholder")
add("M1b", box(40, 40, 40, 540, 10, 10), "-M1 motor kopie", PLCdesk_Id="-M1:motor", PLCdesk_Instance="1",
    PLCdesk_ModelStatus="model")
doc.recompute()
doc.saveAs(sys.argv[1])
App.closeDocument(doc.Name)
import json  # noqa: E402
json.dump({"ok": True}, open(FC_RESULT, "w"))  # noqa: F821
