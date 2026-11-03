# FreeCAD 1.1 (freecadcmd) — stavba plánu modulu N1 (rám / stůl z profilů ALUTEC). Spouštět JEN přes skill freecad-instance:
#   run_fc.ps1 run --slot pro-n1 --timeout 900 --result <vysledek.json> fc_ram.py <plan.json> <složka>
# Plán = modul_ram.plan_ramu(...). Staví ho TÝMŽ kódem jako fc_lib.py (díly do dily/, sestava s App::Link) — fc_lib se
# načte jako knihovna (bez volání main) a rozšíří se jen v paměti o:
#   * prvek tělesa {"profil": {"a", "b", "L"}} = zástupný průřez ALUTEC a × b (rastr 40, drážka 8, jádra Ø 7,4), osa Z;
#   * plán bez "profil" (rám nemá profil zkušební desky — profily jsou díly modulu).
# Sdílený fc_lib.py se tím nemění (paralelní práce); návrh přenést obojí do fc_lib je ve zprávě N1.
import os
import sys

import FreeCAD as App
import Part

V = App.Vector
HERE = os.path.dirname(os.path.abspath(__file__))
FC_LIB = os.path.join(HERE, "fc_lib.py")


def profil_sekce(a, b, otvor=8.2, ret=4.0, hloubka=12.5, sirka=20.0, jadro=7.4, raster=40.0):
    """ZÁSTUPNÝ průřez profilu ALUTEC a × b (násobky rastru 40, drážka 8) v rovině XY se středem v počátku: drážka
    v každém poli rastru na všech stranách a jádro Ø 7,4 ve středu každého pole. Tvar drážky = ``fc_profil.zastupny_40_8``
    (skill alutech-profily, kóty katalogu s. 4/4); vnitřní dutiny výrobce neokótoval (model je plnější)."""
    ha, hb = a / 2.0, b / 2.0
    face = Part.makePlane(a, b, V(-ha, -hb, 0))
    cut = []

    def slot(cx, h, ang):
        pts = [V(-otvor / 2, h + 1, 0), V(otvor / 2, h + 1, 0), V(otvor / 2, h - ret, 0), V(sirka / 2, h - ret, 0),
               V(otvor / 2, h - hloubka, 0), V(-otvor / 2, h - hloubka, 0), V(-sirka / 2, h - ret, 0),
               V(-otvor / 2, h - ret, 0), V(-otvor / 2, h + 1, 0)]
        f = Part.Face(Part.makePolygon(pts))
        f.translate(V(cx, 0, 0))
        f.rotate(V(), V(0, 0, 1), ang)
        cut.append(f)
    na, nb = int(round(a / raster)), int(round(b / raster))
    for i in range(na):                                   # strany ±Y (délka a)
        cx = -ha + raster / 2 + raster * i
        slot(cx, hb, 0)
        slot(-cx, hb, 180)
    for j in range(nb):                                   # strany ±X (délka b) a jádra
        cy = -hb + raster / 2 + raster * j
        slot(-cy, ha, -90)
        slot(cy, ha, 90)
        for i in range(na):
            cut.append(Part.Face(Part.Wire(Part.makeCircle(jadro / 2, V(-ha + raster / 2 + raster * i, cy, 0)))))
    f = face.cut(Part.makeCompound(cut))
    return max(f.Faces, key=lambda x: x.Area)


src = open(FC_LIB, encoding="utf-8").read()
TAIL = "\n\nmain()\n"
OLD = '''    pr = plan["profil"]
    po = doc.addObject("Part::Feature", "Profil")'''
NEW = '''    pr = plan.get("profil")
    if not pr:
        pr = None
    po = doc.addObject("Part::Feature", "Profil") if pr else None'''
if not src.rstrip().endswith("main()") or OLD not in src:
    raise SystemExit("fc_ram: fc_lib.py se změnil (konec main() / blok profilu) — upravit fc_ram.py")
src = src[: src.rstrip().rfind("main()")]
# zbytek bloku profilu jen s profilem
src = src.replace(OLD, NEW, 1)
src = src.replace('''    po.Shape = profil_shape(pr["delka"])
    po.Label = pr["label"]
    props(po, {''', '''    if pr:
      po.Shape = profil_shape(pr["delka"])
      po.Label = pr["label"]
      props(po, {''', 1)
src = src.replace('''    root.addObject(po)
    ext = {}''', '''    if pr:
      root.addObject(po)
    ext = {}''', 1)
ns = {"__name__": "fc_lib_n1", "__file__": FC_LIB}
exec(compile(src, FC_LIB, "exec"), ns)                 # noqa: S102 — vlastní knihovna repozitáře (fc_lib.py)
_prim = ns["prim"]


def prim(p):
    if "profil" in p:
        c = p["profil"]
        return profil_sekce(float(c["a"]), float(c["b"])).extrude(V(0, 0, float(c["L"])))
    return _prim(p)


ns["prim"] = prim
ns["main"]()
