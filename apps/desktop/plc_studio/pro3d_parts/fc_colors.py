# FreeCAD 1.1 GUI — jednotná barva dílů „dle dokumentace“ (žlutá RGB 255,215,0). Headless FreeCAD barvy neukládá
# (GuiDocument.xml chybí), proto se modely z fc_parts.py po stavbě otevřou v GUI instanci, obarví a uloží. Spouštět JEN
# přes skill freecad-instance: run_fc.ps1 gui-start / gui-run --slot <slot> fc_colors.py <soubory.json> / gui-stop.
# soubory.json = ["C:/…/modely/x.FCStd", …]. Barví každý Part::Feature s Konstrukce_ModelStav = „dle dokumentace“
# (vlastní nebo zděděné od nadřazeného App::Part) a zviditelní ho; ostatní objekty nechá být. Výsledek (FC_RESULT):
# {"ok": bool, "soubory": {cesta: {"ok", "obarveno", "chyba"}}}.
import json
import sys

import FreeCAD as App
import FreeCADGui as Gui

YELLOW = (255, 215, 0)
STAV = "dle dokumentace"
RGB = tuple(c / 255.0 for c in YELLOW)


def _stav(o):
    if getattr(o, "Konstrukce_ModelStav", "") == STAV:
        return True
    return any(getattr(p, "Konstrukce_ModelStav", "") == STAV for p in o.InList if p.TypeId == "App::Part")


def _color(vo):
    try:
        mats = []
        for m in (vo.ShapeAppearance or [App.Material()]):
            m = m.copy() if hasattr(m, "copy") else App.Material()
            m.DiffuseColor = RGB + (0.0,)
            mats.append(m)
        vo.ShapeAppearance = mats or [App.Material(DiffuseColor=RGB)]
    except Exception:  # noqa: BLE001 — starší API
        vo.ShapeColor = RGB


def colorize(path):
    doc = App.openDocument(path)
    n = 0
    try:
        for o in doc.Objects:
            if o.TypeId == "App::Part" and _stav(o):        # uloženo headless = skryté → i obsah by byl neviditelný
                o.Visibility = True
            if o.TypeId != "Part::Feature" or not _stav(o) or o.ViewObject is None:
                continue
            o.Visibility = True
            _color(o.ViewObject)
            n += 1
        doc.save()
    finally:
        App.closeDocument(doc.Name)
    return n


App.ParamGet("User parameter:BaseApp/Preferences/Document").SetBool("CreateBackupFiles", False)   # bez *.FCBak v modely/
files = json.load(open(sys.argv[1], encoding="utf-8"))
res = {"ok": True, "soubory": {}}
for f in files:
    try:
        res["soubory"][f] = {"ok": True, "obarveno": colorize(f)}
    except Exception as exc:  # noqa: BLE001
        res["ok"] = False
        res["soubory"][f] = {"ok": False, "obarveno": 0, "chyba": f"{type(exc).__name__}: {exc}"}
json.dump(res, open(globals().get("FC_RESULT") or sys.argv[1] + ".vysledek.json", "w", encoding="utf-8"), ensure_ascii=False)
print(json.dumps({"ok": res["ok"], "n": len(files)}))
