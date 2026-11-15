# -*- coding: utf-8 -*-
"""Syntetický model kopií těles a zašroubování pro test pro3d_tools (FreeCAD headless). argv: [skript, out.FCStd]
Známé nálezy:
* kopie: Konzola ×3 (dvě posunuté, třetí otočená o 90°) = 1 skupina kopií; Úhelník = zdroj + 2 App::Link s vlastním
  PLCdesk_Id (v pořádku), jeho další kopie tělesa vedle odkazů = 2. skupina; chirální díl a jeho zrcadlo = jen info (Link zrcadlit neumí).
* zašroubování (deska ocel 10 mm, plech 3 mm): M6×12 do závitu desky 9 mm (OK), M6×5 jen 2 mm v závitu (chyba
  ``sroub-kratky``), M6×11 jen průchozími dírami (``sroub-bez-zavitu``), M6×7,5 v průchozí díře držáku (``sroub-bez-zavitu``
  → držák pro souvislost bez spoje), M6×10 dříkem do vzduchu (``sroub-nic``)."""
import sys

import FreeCAD as App
import Part

V = App.Vector
Z = V(0, 0, 1)
doc = App.newDocument("SynthKopie")
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


def box(dx, dy, dz, x, y, z):
    return Part.makeBox(dx, dy, dz, V(x, y, z))


def holes(sh, pts, r, z0, h):
    return sh.cut(Part.makeCompound([Part.makeCylinder(r, h, V(x, y, z0)) for x, y in pts]))


def screw(x, y, z0, L, up=False):
    """ISO 4762 M6 zjednodušeně: hlava Ø10 × 6, dřík Ø6 × L; dosedací plocha hlavy v z0, dřík dolů (up = nahoru)."""
    if up:
        return Part.makeCylinder(5, 6, V(x, y, z0)).fuse(Part.makeCylinder(3, L, V(x, y, z0 + 6))).removeSplitter()
    return Part.makeCylinder(5, 6, V(x, y, z0)).fuse(Part.makeCylinder(3, L, V(x, y, z0 - L))).removeSplitter()


# deska (ocel 10 mm): závity M6 (jádro Ø5) v (50, 50) a (100, 50), průchozí Ø6,6 v (150, 50)
deska = holes(box(400, 300, 10, 0, 0, 0), [(50, 50), (100, 50)], 2.5, -1, 12)
deska = holes(deska, [(150, 50)], 3.3, -1, 12)
add("Deska", deska, "Deska stolu ocel", Konstrukce_Typ="dil", Konstrukce_Material="ocel S235")
add("Plech", holes(box(200, 40, 3, 20, 30, 10), [(50, 50), (100, 50), (150, 50)], 3.3, 9, 5), "Plech 3 mm",
    Konstrukce_Typ="dil")
add("S_ok", screw(50, 50, 13, 12), "Šroub ISO 4762 M6x12 do závitu")
add("S_kratky", screw(100, 50, 13, 5), "Šroub ISO 4762 M6x5 krátký")
add("S_pruchozi", screw(150, 50, 13, 11), "Šroub ISO 4762 M6x11 bez závitu")
add("Drzak", holes(box(30, 30, 8, 240, 35, 10), [(255, 50)], 3.3, 9, 10), "Držák volný", Konstrukce_Typ="dil")
add("S_drzak", screw(255, 50, 18, 7.5), "Šroub ISO 4762 M6x7.5 držáku")
add("S_vzduch", screw(300, 250, 10, 10, up=True), "Šroub ISO 4762 M6x10 do vzduchu")

# kopie: konzola (otvor mimo střed — žádná symetrie) ×3, třetí otočená o 90°
kon = holes(box(40, 20, 30, 20, 150, 10), [(30, 157)], 4, 9, 32)
add("K1", kon, "Konzola 1", Konstrukce_Typ="dil")
k2 = kon.copy()
k2.translate(V(60, 0, 0))
add("K2", k2, "Konzola 2", Konstrukce_Typ="dil")
k3 = kon.copy()
k3.rotate(V(40, 160, 10), Z, 90)
k3.translate(V(180 - k3.BoundBox.XMin, 150 - k3.BoundBox.YMin, 0))
add("K3", k3, "Konzola 3 otočená", Konstrukce_Typ="dil")
# úhelník: zdroj + 2 odkazy s vlastním PLCdesk_Id (správně)
uh = box(20, 20, 20, 300, 150, 10).cut(box(10, 10, 21, 310, 160, 9))
src = add("Uhelnik", uh, "Úhelník -B1", PLCdesk_Id="-B1:bracket", Konstrukce_Typ="dil")
for k, dx in ((2, 30), (3, 60)):
    lk = doc.addObject("App::Link", f"Uhelnik_L{k}")
    lk.setLink(src)
    lk.Label = f"Úhelník -B{k} (odkaz)"
    lk.Placement = App.Placement(V(dx, 0, 0), App.Rotation())
    for p, v in (("PLCdesk_Id", f"-B{k}:bracket"), ("Konstrukce_Typ", "dil")):
        lk.addProperty("App::PropertyString", p, "PLCdesk")
        setattr(lk, p, v)
    root.addObject(lk)
uh2 = uh.copy()
uh2.translate(V(0, 40, 0))
add("Uhelnik_kopie", uh2, "Úhelník -B4 kopie zdroje", PLCdesk_Id="-B4:bracket", Konstrukce_Typ="dil")   # zdroj + kopie = chyba
# chirální díl (ramena 30 / 20 / 25) a jeho zrcadlo — jen info
ch = box(30, 10, 10, 20, 230, 10).fuse([box(10, 20, 10, 20, 230, 10), box(10, 10, 25, 20, 230, 10)]).removeSplitter()
add("Ch1", ch, "Rohový díl levý", Konstrukce_Typ="dil")
add("Ch2", ch.mirror(V(100, 0, 0), V(1, 0, 0)), "Rohový díl pravý", Konstrukce_Typ="dil")
doc.recompute()
doc.saveAs(sys.argv[1])
App.closeDocument(doc.Name)
import json  # noqa: E402
json.dump({"ok": True}, open(FC_RESULT, "w"))  # noqa: F821
