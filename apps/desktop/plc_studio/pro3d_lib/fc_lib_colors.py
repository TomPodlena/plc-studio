# FreeCAD 1.1 GUI — barvy dílů a sestavy pro3d_lib (headless barvy neukládá) + snímky. Spouštět JEN přes freecad-instance:
#   run_fc.ps1 gui-start --slot <slot>; gui-run --slot <slot> fc_lib_colors.py <ulohy.json>; gui-stop
# ulohy.json = {"dily": [FCStd…], "model": FCStd, "snimky": {"iso": png, "iso2": png, "bok": png, "shora": png}}.
# Pravidla barev jako pro3d_modules/fc_modules_colors.py (rules.py): zástupné oranžová, „dle dokumentace“ žlutá, kabel
# signálový modrý, pomocné šedé průhledné, vlastní konstrukce šedá. Odkazy App::Link se nepřebarvují. Uloží bez .FCBak.
import json
import sys

import FreeCAD as App
import FreeCADGui as Gui

ORANGE, YELLOW, GREY, BLUE = (255, 140, 0), (255, 215, 0), (175, 178, 182), (30, 70, 200)


def color(vo, c, transp=0):
    try:
        mats = []
        for m in (vo.ShapeAppearance or [App.Material()]):
            m = m.copy() if hasattr(m, "copy") else App.Material()
            m.DiffuseColor = tuple(x / 255.0 for x in c) + (0.0,)
            m.Transparency = transp / 100.0
            mats.append(m)
        vo.ShapeAppearance = mats
    except Exception:  # noqa: BLE001
        vo.ShapeColor = tuple(x / 255.0 for x in c)


def _st(o, name):
    v = str(getattr(o, name, "") or "")
    if v:
        return v
    for p in o.InList:
        if p.TypeId == "App::Part" and str(getattr(p, name, "") or ""):
            return str(getattr(p, name))
    return ""


def paint(doc):
    n = 0
    for o in doc.Objects:
        if o.TypeId in ("App::Origin", "App::Line", "App::Plane", "App::Point"):
            o.Visibility = False                       # osy a roviny App::Part do snímku nepatří
            continue
        if hasattr(o, "Visibility"):
            o.Visibility = True
        if o.TypeId != "Part::Feature" or o.ViewObject is None:
            continue
        typ = str(getattr(o, "Konstrukce_Typ", "") or "")
        if _st(o, "PLCdesk_ModelStatus").lower() == "placeholder" or str(getattr(o, "Konstrukce_Zastupny", "")).lower() == "true":
            color(o.ViewObject, ORANGE)
        elif _st(o, "Konstrukce_ModelStav") == "dle dokumentace":
            color(o.ViewObject, YELLOW)
        elif typ == "kabel":
            color(o.ViewObject, BLUE)
        elif typ == "pomocny":
            color(o.ViewObject, (120, 120, 120), 75)
        else:
            color(o.ViewObject, GREY)
        n += 1
    return n


def camera(v, d):
    d = App.Vector(*d)
    d.normalize()
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
job = json.load(open(sys.argv[1], encoding="utf-8"))
res = {"ok": True, "dily": {}, "snimky": []}
for f in job.get("dily", []):
    try:
        d = App.openDocument(f)
        res["dily"][f] = paint(d)
        d.save()
        App.closeDocument(d.Name)
    except Exception as exc:  # noqa: BLE001
        res["ok"] = False
        res["dily"][f] = f"chyba: {exc}"
doc = App.openDocument(job["model"])
res["obarveno"] = paint(doc)
doc.save()
try:
    v = Gui.ActiveDocument.ActiveView
    views = {"iso": (1.0, 1.0, -0.8), "iso2": (-1.0, -1.0, -0.7), "bok": (1.0, 0.0001, -0.0001), "shora": (0.0001, 0.0001, -1.0)}
    for k, p in (job.get("snimky") or {}).items():
        camera(v, views.get(k, (1.0, 1.0, -0.8)))
        v.saveImage(p, 1600, 1200, "White")
        res["snimky"].append(p)
except Exception as exc:  # noqa: BLE001
    res["snimky"].append(f"chyba: {exc}")
App.closeDocument(doc.Name)
json.dump(res, open(globals().get("FC_RESULT") or sys.argv[1] + ".vysledek.json", "w", encoding="utf-8"), ensure_ascii=False)
print(json.dumps({"ok": res["ok"], "obarveno": res.get("obarveno")}))
