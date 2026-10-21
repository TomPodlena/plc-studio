# -*- coding: utf-8 -*-
"""Standardní snímky modelu v GUI instanci FreeCADu (``run_fc.ps1 gui-run``; model se neukládá).
argv: [skript, model.FCStd, out_dir, opts.json] — opts: {"prefix": "k5", "detail": ["Label nebo jméno", …],
"skryt": ["kryt", "vypln"] (druhy / slova popisku skrytá při výřezu), "w": 1600, "h": 1000}.

Snímky: ``<prefix>_iso.png`` (izometrie), ``<prefix>_iso2.png`` (izometrie z protějšího rohu), ``<prefix>_pudorys.png``,
``<prefix>_celo.png`` a pro každý díl z ``detail`` ``<prefix>_detail_<n>.png`` (fitSelection, skryté kryty / výplně)."""
import json
import os
import re
import sys

import FreeCAD as App
import FreeCADGui as Gui

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rules  # noqa: E402

MODEL, OUT = sys.argv[1], sys.argv[2]
OPT = json.load(open(sys.argv[3], encoding="utf-8")) if len(sys.argv) > 3 else {}
PRE = OPT.get("prefix") or "snimek"
W, H = int(OPT.get("w", 1600)), int(OPT.get("h", 1000))
os.makedirs(OUT, exist_ok=True)
doc = App.openDocument(MODEL)
Gui.setActiveDocument(doc.Name)
gdoc = Gui.getDocument(doc.Name)
view = gdoc.activeView()
done = []
# model uložený bez GUI (headless) nemá viditelnost — bez jediného viditelného tělesa ukázat všechna tělesa
_shapes = [o for o in doc.Objects if hasattr(o, "Shape") and getattr(o, "ViewObject", None) is not None
           and not o.TypeId.startswith(("App::Origin", "App::Line", "App::Plane", "App::Point"))]
if _shapes and not any(o.ViewObject.Visibility for o in _shapes):
    for o in doc.Objects:
        vo = getattr(o, "ViewObject", None)
        if vo is not None and not o.TypeId.startswith(("App::Origin", "App::Line", "App::Plane", "App::Point")) \
                and not any(p.isDerivedFrom("Part::Feature") for p in o.InList if p.TypeId != "App::Link"):
            vo.Visibility = True


def save(name):
    p = os.path.join(OUT, f"{PRE}_{name}.png")
    Gui.updateGui()
    view.saveImage(p, W, H, "White")
    done.append(p)


view.viewIsometric()
view.fitAll()
save("iso")
d = view.getViewDirection()                       # izometrie z protějšího rohu: směr pohledu otočený o 180° kolem Z
view.setViewDirection((-d.x, -d.y, d.z))
view.fitAll()
save("iso2")
view.viewTop()
view.fitAll()
save("pudorys")
view.viewFront()
view.fitAll()
save("celo")

hide_kw = [rules.fold(x) for x in (OPT.get("skryt") or ["kryt", "vypln"])]
hidden = []
if OPT.get("detail"):
    for o in doc.Objects:
        vo = getattr(o, "ViewObject", None)
        if vo is None or not hasattr(o, "Shape"):
            continue
        typ = rules.typ_dilu({k: getattr(o, k) for k in o.PropertiesList if k.startswith("Konstrukce_")}, o.Label, o.Name)
        if typ in hide_kw or any(k in rules.fold(o.Label) for k in hide_kw if len(k) > 3):
            if vo.Visibility:
                vo.Visibility = False
                hidden.append(o.Name)
    for n, want in enumerate(OPT["detail"], 1):
        rx = re.compile(re.escape(rules.fold(want)))
        hits = [o for o in doc.Objects if rx.search(rules.fold(o.Label)) or o.Name == want]
        if not hits:
            done.append(f"(detail {want}: nenalezen)")
            continue
        Gui.Selection.clearSelection()
        for o in hits[:20]:
            Gui.Selection.addSelection(o)
        view.viewIsometric()
        Gui.SendMsgToActiveView("ViewSelection")
        Gui.Selection.clearSelection()
        save(f"detail_{n}")
json.dump({"ok": True, "snimky": done, "skryto": len(hidden)}, open(FC_RESULT, "w", encoding="utf-8"),  # noqa: F821
          ensure_ascii=False)
