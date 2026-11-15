"""Kontrola STEP ve FreeCADu (headless) — načtení, objem, obálka.

  python ~/.claude/skills/freecad-api/scripts/run_script.py tools/check_step.py <out.json> <soubor.stp> [...]

Do out.json: {soubor: {ok, solids, volume_mm3, bbox_mm: [dx, dy, dz], bbox: [xmin..zmax], error}}.
"""
import json
import sys

import Part  # noqa: F401  (FreeCAD)

out_path = sys.argv[1]
res = {}
for f in sys.argv[2:]:
    try:
        sh = Part.Shape()
        sh.read(f)
        bb = sh.BoundBox
        vol = sum(s.Volume for s in sh.Solids) if sh.Solids else sh.Volume
        res[f] = {
            "ok": bool(sh.Solids) and vol > 0,
            "solids": len(sh.Solids),
            "volume_mm3": round(vol, 1),
            "bbox_mm": [round(bb.XLength, 2), round(bb.YLength, 2), round(bb.ZLength, 2)],
            "bbox": [round(v, 2) for v in (bb.XMin, bb.YMin, bb.ZMin, bb.XMax, bb.YMax, bb.ZMax)],
        }
    except Exception as e:  # noqa: BLE001
        res[f] = {"ok": False, "error": str(e)[:300]}
with open(out_path, "w", encoding="utf-8") as fh:
    json.dump(res, fh, indent=1)
print("check_step", sum(1 for v in res.values() if v.get("ok")), "/", len(res), "ok")
