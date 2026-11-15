# FreeCAD 1.1 GUI — barvy modulů z fc_modules.py (headless barvy neukládá) a snímky. Spouštět JEN přes skill freecad-instance:
#   run_fc.ps1 gui-start --slot <slot>; gui-run --slot <slot> fc_modules_colors.py <Moduly.FCStd> [iso.png] [moduly_iso.png] [shora.png]; gui-stop
# Pravidla (pro3d_tools/rules.py): zástupné oranžová 255,140,0, „dle dokumentace“ (šrouby) žlutá 255,215,0, vlastní
# konstrukce šedá, kabely signálové modře / silové černě (EN 60204-1 13.2.4), hadice světle modře. Odkazy App::Link (rám,
# dily/) se nepřebarvují. Zviditelní vše a uloží bez .FCBak. Výsledek (FC_RESULT): {"ok", "obarveno", "snimky"}.
import json
import sys

import FreeCAD as App
import FreeCADGui as Gui

ORANGE, YELLOW, GREY = (255, 140, 0), (255, 215, 0), (175, 178, 182)
CABLE = {"silovy": (40, 40, 40), "signal": (30, 70, 200)}
HOSE = (90, 170, 230)


def rgb(c):
    return tuple(x / 255.0 for x in c)


def color(vo, c, transp=0):
    try:
        mats = []
        for m in (vo.ShapeAppearance or [App.Material()]):
            m = m.copy() if hasattr(m, "copy") else App.Material()
            m.DiffuseColor = rgb(c) + (0.0,)
            m.Transparency = transp / 100.0
            mats.append(m)
        vo.ShapeAppearance = mats
    except Exception:  # noqa: BLE001
        vo.ShapeColor = rgb(c)


def camera(v, d):
    d = App.Vector(*d).normalize()
    zc = d.negative()
    xc = d.cross(App.Vector(0, 0, 1))
    if xc.Length < 1e-6:
        xc = App.Vector(1, 0, 0)
    xc.normalize()
    yc = zc.cross(xc)
    m = App.Matrix(xc.x, yc.x, zc.x, 0, xc.y, yc.y, zc.y, 0, xc.z, yc.z, zc.z, 0, 0, 0, 0, 1)
    try:
        v.setCameraType("Orthographic")
    except Exception:  # noqa: BLE001
        pass
    v.setCameraOrientation(App.Rotation(m))
    v.fitAll()
    Gui.updateGui()
    v.fitAll()
    Gui.updateGui()


App.ParamGet("User parameter:BaseApp/Preferences/Document").SetBool("CreateBackupFiles", False)
doc = App.openDocument(sys.argv[1])
n = 0
for o in doc.Objects:
    if hasattr(o, "Visibility"):
        o.Visibility = True
    if o.TypeId != "Part::Feature" or o.ViewObject is None:
        continue
    st = str(getattr(o, "PLCdesk_ModelStatus", "") or "").lower()
    typ = str(getattr(o, "Konstrukce_Typ", "") or "")
    if st == "placeholder" or str(getattr(o, "Konstrukce_Zastupny", "")).lower() == "true":
        color(o.ViewObject, ORANGE)
    elif str(getattr(o, "Konstrukce_ModelStav", "")) == "dle dokumentace":
        color(o.ViewObject, YELLOW)
    elif typ == "kabel":
        color(o.ViewObject, CABLE.get(str(getattr(o, "Konstrukce_Druh", "")), CABLE["signal"]))
    elif typ == "hadice":
        color(o.ViewObject, HOSE)
    elif typ == "pomocny":
        color(o.ViewObject, (120, 120, 120), 80)
    else:
        color(o.ViewObject, GREY)
    n += 1
doc.save()
shots = []
try:
    v = Gui.ActiveDocument.ActiveView
    if len(sys.argv) > 2:                                   # celek s rámem, izometrie zepředu zleva shora
        camera(v, (1.0, 1.0, -0.8))
        v.saveImage(sys.argv[2], 1600, 1200, "White")
        shots.append(sys.argv[2])
    if len(sys.argv) > 3:                                   # jen moduly (rám skrytý)
        ram = doc.getObject("Ram_odkaz")
        if ram is not None:
            ram.Visibility = False
            for c in ram.Group:
                c.Visibility = False
        camera(v, (1.0, 1.0, -0.8))
        v.saveImage(sys.argv[3], 1600, 1200, "White")
        shots.append(sys.argv[3])
        camera(v, (-1.0, -1.0, -0.7))
        p2 = sys.argv[3].replace(".png", "_2.png")
        v.saveImage(p2, 1600, 1200, "White")
        shots.append(p2)
    if len(sys.argv) > 4:                                   # půdorys modulů
        camera(v, (0.0001, 0.0001, -1.0))
        v.saveImage(sys.argv[4], 1600, 1200, "White")
        shots.append(sys.argv[4])
except Exception as exc:  # noqa: BLE001
    shots.append(f"chyba: {exc}")
App.closeDocument(doc.Name)
json.dump({"ok": True, "obarveno": n, "snimky": shots}, open(globals().get("FC_RESULT") or sys.argv[1] + ".barvy.json", "w",
                                                             encoding="utf-8"), ensure_ascii=False)
print(json.dumps({"ok": True, "obarveno": n}))
