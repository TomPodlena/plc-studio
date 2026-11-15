# -*- coding: utf-8 -*-
"""Syntetický model vedení kabelů a hadic pro test pro3d_tools (FreeCAD headless). argv: [skript, out.FCStd]
Konvence skillu kabelaz-a-hadice (Konstrukce_Typ kabel / hadice, Konstrukce_Vedeni = zlab / retez, šroubení).
Známé nálezy: kolize Snímač × Obálka řetězu (do dráhy řetězu nic nesmí), Hadice prochází šroubením bokem (chyba);
povolené: kabel × žlab a kabel × obálka řetězu (vedení), hadice zasunutá do šroubení, šroub × profil (díra);
souvislost: žlab bez šroubu = chyba ``zlab-bez-spoje``, přišroubovaný žlab bez nálezu."""
import sys

import FreeCAD as App
import Part

V = App.Vector
doc = App.newDocument("SynthVedeni")
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


X = V(1, 0, 0)
add("Deska", box(600, 400, 10, 0, 0, 0), "Deska stolu")
add("Profil", box(40, 40, 300, 20, 20, 10).cut(Part.makeCylinder(2.5, 20, V(40, 40, 230), X)), "Profil 40x40 sloup")
# žlab přišroubovaný k profilu (šroub M6 v díře žlabu a v závitu profilu)
add("Zlab2", box(5, 80, 60, 60, 0, 200).cut(Part.makeCylinder(3.2, 5, V(60, 40, 230), X)), "Žlab přišroubovaný k profilu")
add("Sroub", Part.makeCylinder(3, 20, V(45, 40, 230), X).fuse(Part.makeCylinder(5, 5, V(65, 40, 230), X)).removeSplitter(),
    "Šroub ISO 4762 M6x20")
# žlab jen přiložený k profilu (bez šroubu)
add("Zlab1", box(5, 80, 60, 15, 0, 100), "Žlab 40×60 bez šroubu")
# kabel leží ve žlabu (zapuštěný 0,5 mm — povolené vedení)
add("Kabel1", Part.makeCylinder(3, 180, V(67.5, -50, 245), V(0, 1, 0)), "Kabel -W101 ve žlabu", Konstrukce_Typ="kabel")
# obálka energetického řetězu (skill kabelaz-a-hadice: pomocny + Konstrukce_Vedeni = retez) s kabelem uvnitř
add("Obalka_retezu_E1", box(100, 40, 50, 300, 100, 10), "Obálka řetězu E1", Konstrukce_Typ="pomocny",
    Konstrukce_Vedeni="retez")
add("Kabel2", Part.makeCylinder(3, 140, V(280, 120, 13), X), "Kabel -W102 v řetězu", Konstrukce_Typ="kabel")
add("Snimac", box(10, 20, 40, 350, 130, 10), "Snímač -B9 v dráze řetězu")
# hadice zasunutá do rychlospojky (konec hadice uvnitř)
add("Sroubeni1", Part.makeCylinder(6, 20, V(500, 300, 10)).cut(Part.makeCylinder(3, 15, V(500, 300, 15))),
    "Šroubení QS-G1/8-6")
add("Hadice1", Part.makeCylinder(3.2, 80, V(500, 300, 20)), "Hadice PUN-H 6 zasunutá", Konstrukce_Typ="hadice")
# hadice prochází šroubením bokem (konec hadice mimo šroubení = chyba)
add("Sroubeni2", Part.makeCylinder(6, 20, V(540, 300, 10)), "Šroubení QS-G1/8-6 druhé")
add("Hadice2", Part.makeCylinder(3.2, 40, V(520, 300, 20), X), "Hadice PUN-H 6 skrz šroubení", Konstrukce_Typ="hadice")
doc.recompute()
doc.saveAs(sys.argv[1])
App.closeDocument(doc.Name)
import json  # noqa: E402
json.dump({"ok": True}, open(FC_RESULT, "w"))  # noqa: F821
