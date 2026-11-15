# -*- coding: utf-8 -*-
"""Syntetický model doloženého závitu (Konstrukce_Zavit) pro test pro3d_tools (FreeCAD headless). argv: [skript, out.FCStd]
Model výrobce bez děr = samostatný dokument ``Vyrobce.FCStd`` (App::Part „Dil“ s plným kvádrem 40 × 40 × 20, hliník)
vložený do sestavy jako App::Link (posun 100, 0, 0, natočení 90° kolem Z). Odkaz nese ``Konstrukce_Zavit`` se dvěma
závity M6 hloubky 12 v horní ploše (souřadnice cíle odkazu) — jeden se zdrojem, druhý bez zdroje (neuzná se).
Známé nálezy: deska 8 mm na kvádru, šroub M6x20 do doloženého závitu (12 mm ≥ 9 mm hliník → OK, kolize povolena),
šroub M6x20 do závitu bez zdroje (kolize = chyba, zašroubování ``bez_diry``), varování ``zavit-zaznam``."""
import os
import sys

import FreeCAD as App
import Part

V = App.Vector
out = os.path.abspath(sys.argv[1])
folder = os.path.dirname(out)
os.makedirs(folder, exist_ok=True)
App.ParamGet("User parameter:BaseApp/Preferences/Document").SetBool("CreateBackupFiles", False)


def sp(o, k, v):
    o.addProperty("App::PropertyString", k, "Konstrukce")
    setattr(o, k, v)


# model výrobce bez děr
vd = App.newDocument("Vyrobce")
part = vd.addObject("App::Part", "Dil")
part.Label = "Blok vyrobce (bez der)"
sp(part, "Konstrukce_Material", "hlinik")
t = vd.addObject("Part::Feature", "Teleso")
t.Shape = Part.makeBox(40, 40, 20, V(-20, -20, 0))
part.addObject(t)
vp = os.path.join(folder, "Vyrobce.FCStd")
vd.saveAs(vp)

doc = App.newDocument("SynthZavit")
doc.saveAs(out)
root = doc.addObject("App::Part", "Stroj")
lk = doc.addObject("App::Link", "Blok")
lk.setLink(part)
lk.LinkTransform = False
lk.Placement = App.Placement(V(100, 0, 0), App.Rotation(V(0, 0, 1), 90))
lk.Label = "Blok výrobce (odkaz)"
sp(lk, "Konstrukce_Typ", "dil")
sp(lk, "Konstrukce_Zavit", "M6x1;hloubka 12;poloha 10,0,20;osa 0,0,-1;zdroj https://example.com/list.pdf"
                           " | M6x1;hloubka 12;poloha -10,0,20;osa 0,0,-1")
root.addObject(lk)
# deska 8 mm s průchozími dírami Ø6,6 nad oběma závity (globálně: natočení 90° → (100, 10) a (100, -10))
deska = Part.makeBox(40, 40, 8, V(80, -20, 20))
deska = deska.cut(Part.makeCompound([Part.makeCylinder(3.3, 10, V(100, y, 19)) for y in (10, -10)]))
o = doc.addObject("Part::Feature", "Deska")
o.Shape = deska
o.Label = "Deska ocel 8"
sp(o, "Konstrukce_Typ", "dil")
root.addObject(o)
for nm, y in (("S_dolozeny", 10), ("S_bez_zdroje", -10)):
    s = doc.addObject("Part::Feature", nm)
    s.Shape = Part.makeCylinder(5, 6, V(100, y, 28)).fuse(Part.makeCylinder(3, 20, V(100, y, 8))).removeSplitter()
    s.Label = "Šroub ISO 4762 M6x20 " + ("do doloženého závitu" if y > 0 else "bez zdroje")
    sp(s, "Konstrukce_Typ", "sroub")
    root.addObject(s)
doc.recompute()
doc.save()
App.closeDocument(doc.Name)
App.closeDocument(vd.Name)
