# FreeCAD (run_fc.ps1): syntetický „model výrobce“ STEP (kvádr 10 × 20 × 30 mm) a model stroje se zástupným dílem
# (App::Part Celek → App::Part Y1 s PLCdesk_Id / PLCdesk_ModelStatus = placeholder, kvádr 12 × 22 × 32 mm na 100, 0, 0).
# argv: <výstupní STEP> <výstupní FCStd stroje>; test test_pro3d_download.py.
import sys

import FreeCAD as App
import Part

step, machine = sys.argv[1], sys.argv[2]
Part.makeBox(10, 20, 30).exportStep(step)
d = App.newDocument("Stroj")
celek = d.addObject("App::Part", "Celek")
ph = d.addObject("App::Part", "Y1")
celek.addObject(ph)
box = d.addObject("Part::Feature", "Y1_obalka")
box.Shape = Part.makeBox(12, 22, 32)
ph.addObject(box)
ph.Placement = App.Placement(App.Vector(100, 0, 0), App.Rotation())
for n, v in (("PLCdesk_Id", "-Y1:valve_solenoid"), ("PLCdesk_ModelStatus", "placeholder")):
    ph.addProperty("App::PropertyString", n, "PLCdesk")
    setattr(ph, n, v)
d.recompute()
d.saveAs(machine)
App.closeDocument(d.Name)
print("synth ok")
