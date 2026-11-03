# FreeCAD 1.1 GUI — barvy rozvaděče z fc_cabinet.py (headless barvy neukládá). Spouštět JEN přes skill freecad-instance:
#   run_fc.ps1 gui-start --slot <slot>; gui-run --slot <slot> fc_cabinet_colors.py <Rozvadec.FCStd> [snimek.png]; gui-stop
# Pravidla (pro3d_tools/rules.py): zástupné (PLCdesk_ModelStatus = placeholder) oranžová 255,140,0, díly „dle dokumentace“
# (šrouby, lišty, vývodky z normálií) žlutá 255,215,0, zóny mezer / rezervy průhledně modrá, ostatní (deska, žlaby,
# zarážky) šedá. Odkazy App::Link na dily/ se nepřebarvují (barvu dědí z modelu). Zviditelní vše a uloží bez .FCBak.
# Volitelně snímek (shot) čela bez dveří. Výsledek (FC_RESULT): {"ok", "obarveno", "snimky"}.
import json
import sys

import FreeCAD as App
import FreeCADGui as Gui

ORANGE, YELLOW, BLUE, GREY, DUCT = (255, 140, 0), (255, 215, 0), (90, 160, 230), (190, 190, 185), (140, 140, 140)
CABLE = {"silovy": (40, 40, 40), "signal": (30, 70, 200)}       # EN 60204-1 13.2.4: silové černá, řídicí DC modrá


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
    try:
        vo.Transparency = transp
    except Exception:  # noqa: BLE001
        pass


App.ParamGet("User parameter:BaseApp/Preferences/Document").SetBool("CreateBackupFiles", False)
doc = App.openDocument(sys.argv[1])
def want(o):
    """Barva (a průhlednost) dílu podle jeho vlastností — Part::Feature i App::Link (vlastnosti nese odkaz)."""
    st = str(getattr(o, "PLCdesk_ModelStatus", "") or "").lower()
    typ = str(getattr(o, "Konstrukce_Typ", "") or "")
    if st == "placeholder" or str(getattr(o, "Konstrukce_Zastupny", "")).lower() == "true":
        return ORANGE, 0
    if str(getattr(o, "Konstrukce_ModelStav", "")) == "dle dokumentace":
        return YELLOW, 0
    if typ == "kabel":
        return CABLE.get(str(getattr(o, "Konstrukce_Druh", "")), GREY), 0
    if str(getattr(o, "Konstrukce_Pripojnice", "")) == "PE":
        return (60, 160, 60), 0
    if str(getattr(o, "Konstrukce_Pripojnice", "")) == "N":
        return (90, 160, 230), 0
    if typ == "pomocny":
        return BLUE, 85
    if typ in ("zlab", "prislusenstvi"):
        return DUCT, 0
    return GREY, 0


n = 0
for o in doc.Objects:
    if hasattr(o, "Visibility"):
        o.Visibility = True
    if o.ViewObject is None:
        continue
    if o.TypeId == "Part::Feature":
        c, tr = want(o)
        color(o.ViewObject, c, tr)
        n += 1
    elif o.TypeId == "App::Link" and o.LinkedObject is not None and o.LinkedObject.Document is doc             and o.LinkedObject.TypeId == "Part::Feature":
        # opakovaný díl jako odkaz (fc_cabinet.feat): barvu dědí ze zdroje; jiná barva podle vlastností (N × PE) = přepis
        c, _tr = want(o)
        if c != want(o.LinkedObject)[0]:
            try:
                o.ViewObject.OverrideMaterial = True
                m = App.Material()
                m.DiffuseColor = rgb(c) + (0.0,)
                o.ViewObject.ShapeMaterial = m
            except Exception:  # noqa: BLE001
                pass
        n += 1
doc.save()
shots = []
if len(sys.argv) > 2:
    try:
        for o in doc.Objects:          # čelo bez dveří a bez zón
            if o.Name.startswith(("Dvere", "Mezera", "Rezerva")) or o.Name in ("Zony_mezer", "Rezervy"):
                o.Visibility = False
        # čelo skříně = pohled od dveří (+Y → −Y) = „rear“ FreeCADu
        shot(sys.argv[2], 1600, 1200, view="rear")  # noqa: F821 — globál spouštěče freecad-instance
        shots.append(sys.argv[2])
        if len(sys.argv) > 3:
            for o in doc.Objects:          # izometrie zepředu zleva shora, dveře otevřené jen tvarem (skryté)
                if o.Name.startswith(("Mezera", "Rezerva")) or o.Name in ("Zony_mezer", "Rezervy"):
                    o.Visibility = False
            v = Gui.ActiveDocument.ActiveView
            # kamera zepředu (+Y), zleva (+X), shora: směr pohledu d, nahoru +Z (kamera Coin hledí podél svého −Z)
            d = App.Vector(-1.0, -1.0, -0.8).normalize()
            zc = d.negative()
            xc = d.cross(App.Vector(0, 0, 1)).normalize()
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
            v.saveImage(sys.argv[3], 1600, 1200, "White")
            shots.append(sys.argv[3])
        if len(sys.argv) > 4:                  # dveře otevřené 95° (Konstrukce_Pohyb), pohled zepředu z boku proti pantům
            dvp = doc.getObject("Dvere")
            pohyb = json.loads(str(getattr(dvp, "Konstrukce_Pohyb", "") or "{}"))
            ot = pohyb.get("otoc") or {}
            for o in doc.Objects:
                if hasattr(o, "Visibility"):
                    o.Visibility = not (o.Name.startswith(("Mezera", "Rezerva", "Osa_")) or o.Name in ("Zony_mezer", "Rezervy"))
            if dvp is not None and ot:
                dvp.Placement = App.Placement(App.Vector(*ot["bod"]), App.Rotation(App.Vector(*ot["osa"]), ot["uhel"]),
                                              App.Vector(0, 0, 0)).multiply(App.Placement(App.Vector(*[-c for c in ot["bod"]]), App.Rotation()))
                doc.recompute()
            v = Gui.ActiveDocument.ActiveView
            d = App.Vector(0.55, -1.0, -0.45).normalize()
            zc = d.negative()
            xc = d.cross(App.Vector(0, 0, 1)).normalize()
            yc = zc.cross(xc)
            m = App.Matrix(xc.x, yc.x, zc.x, 0, xc.y, yc.y, zc.y, 0, xc.z, yc.z, zc.z, 0, 0, 0, 0, 1)
            v.setCameraOrientation(App.Rotation(m))
            v.fitAll()
            Gui.updateGui()
            v.fitAll()
            Gui.updateGui()
            v.saveImage(sys.argv[4], 1600, 1200, "White")
            shots.append(sys.argv[4])
    except Exception as exc:  # noqa: BLE001
        shots.append(f"chyba: {exc}")
App.closeDocument(doc.Name)
json.dump({"ok": True, "obarveno": n, "snimky": shots}, open(globals().get("FC_RESULT") or sys.argv[1] + ".barvy.json", "w",
                                                             encoding="utf-8"), ensure_ascii=False)
print(json.dumps({"ok": True, "obarveno": n}))
