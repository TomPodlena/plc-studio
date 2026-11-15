# FreeCAD (headless, vlastní instance přes run_fc.ps1): zástupné díly → App::Link na zaevidovaný model výrobce.
# Úloha (argv[1], JSON): {"models": {partId: cesta STEP}, "docs": [FCStd modelu stroje]}.
# Každý STEP se převede na FCStd vedle sebe (<jméno>.FCStd: App::Part „Model“ s tvarem STEP, vlastnosti PLCdesk_*),
# v dokumentech se najdou objekty s PLCdesk_Id = partId a PLCdesk_ModelStatus = placeholder; místo každého vznikne
# App::Link na Model ve stejném rodiči (střed obálky modelu = střed obálky zástupného dílu, natočení zástupného dílu —
# ZKONTROLOVAT, model výrobce má vlastní počátek), zástupný díl se smaže. Výsledek (FC_RESULT):
# {"models": {pid: {ok, fcstd, error}}, "replaced": [{doc, partId, placeholder, link}], "docs": [...], "errors": []}.
# Nic z plc_studio se neimportuje.
import json
import os
import sys

import FreeCAD as App
import Part

job = json.load(open(sys.argv[1], encoding="utf-8"))
res = {"models": {}, "replaced": [], "docs": [], "errors": []}
model_docs = {}


def add_str(o, name, val):
    if name not in o.PropertiesList:
        o.addProperty("App::PropertyString", name, "PLCdesk")
    setattr(o, name, val)


by_step = {}
for pid, step in job["models"].items():
    if step in by_step:                                 # sdílený model (stejný výrobce + kód) — převod jednou
        model_docs[pid] = model_docs[by_step[step]]
        res["models"][pid] = dict(res["models"][by_step[step]])
        continue
    by_step[step] = pid
    try:
        sh = Part.Shape()
        sh.read(step)
        if not sh.Solids:
            raise ValueError("STEP bez těles")
        fc = os.path.splitext(step)[0] + ".FCStd"
        name = "M_" + "".join(c if c.isalnum() else "_" for c in os.path.basename(os.path.splitext(step)[0]))[:40]
        d = App.newDocument(name)
        part = d.addObject("App::Part", "Model")
        body = d.addObject("Part::Feature", "Tvar")
        body.Shape = sh
        part.addObject(body)
        add_str(part, "PLCdesk_Id", pid)
        add_str(part, "PLCdesk_ModelStatus", "manual")
        add_str(part, "PLCdesk_ModelFile", os.path.basename(step))
        add_str(part, "Konstrukce_Typ", "dil")
        d.recompute()
        d.saveAs(fc)
        model_docs[pid] = (d, part, sh.BoundBox)
        res["models"][pid] = {"ok": True, "fcstd": fc}
    except Exception as e:  # noqa: BLE001
        res["models"][pid] = {"ok": False, "error": str(e)[:300]}

for path in job["docs"]:
    try:
        doc = App.openDocument(path)
    except Exception as e:  # noqa: BLE001
        res["errors"].append(f"{path}: {e}"[:300])
        continue
    changed = False
    for name in [x.Name for x in doc.Objects]:
        o = doc.getObject(name)
        if o is None:                                   # už smazaný (potomek nahrazeného dílu)
            continue
        pid = getattr(o, "PLCdesk_Id", None)
        if pid not in model_docs or getattr(o, "PLCdesk_ModelStatus", "") != "placeholder":
            continue
        mdoc, mpart, mbb = model_docs[pid]
        try:
            pbb = Part.getShape(o).BoundBox
            rot = o.Placement.Rotation
            pc = App.Vector(pbb.Center)
            mc = rot.multVec(App.Vector(mbb.Center))
            link = doc.addObject("App::Link", o.Name + "_model")
            link.setLink(mpart)
            link.Label = o.Label
            link.Placement = App.Placement(pc - mc, rot)
            for p in ("PLCdesk_Id", "PLCdesk_Instance"):
                if p in o.PropertiesList:
                    add_str(link, p, str(getattr(o, p)))
            add_str(link, "PLCdesk_ModelStatus", "manual")
            add_str(link, "Konstrukce_Typ", "dil")
            add_str(link, "Konstrukce_Zarovnani", "střed obálky modelu výrobce = střed zástupného dílu — zkontrolovat")
            parent = o.getParentGeoFeatureGroup()
            if parent is not None:
                parent.addObject(link)
            kids = list(getattr(o, "Group", []) or [])
            pname = o.Name
            doc.removeObject(o.Name)
            for k in kids:
                if doc.getObject(k.Name) is not None:
                    doc.removeObject(k.Name)
            res["replaced"].append({"doc": path, "partId": pid, "placeholder": pname, "link": link.Name})
            changed = True
        except Exception as e:  # noqa: BLE001
            res["errors"].append(f"{path} {o.Name}: {e}"[:300])
    if changed:
        doc.recompute()
        doc.save()
        res["docs"].append(path)
    App.closeDocument(doc.Name)

for d in {id(v[0]): v[0] for v in model_docs.values()}.values():
    App.closeDocument(d.Name)
out = os.environ.get("FC_RESULT") or globals().get("FC_RESULT") or os.path.splitext(sys.argv[1])[0] + "_vysledek.json"
json.dump(res, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("fc_replace", len(res["replaced"]), "nahrazeno")
