# FreeCAD 1.1 (freecadcmd) — stavba plánu pro3d_lib (modul S1 a zkušební deska). Spouštět JEN přes skill freecad-instance:
#   run_fc.ps1 run --slot pro3d-s1-test --timeout 900 fc_lib.py <plan.json> <složka>
# Plán = modul_snimac.lavice(...). Díly: normalizované přes pro3d_parts/fc_parts.py (spuštěn runpy — neopisuje se),
# vlastní (matice T, zásuvka, zástupné matice) generátorem lib_body → <složka>/dily/<key>.FCStd. Sestava
# <složka>/Lavice_S1.FCStd: profil ALUTEC (zástupný průřez skillu alutech-profily scripts/fc_profil.py zastupny_40_8),
# moduly jako App::Part s App::Link na dily/ a vlastními tělesy (držák, zóny, kabel). Výsledek (FC_RESULT) JSON.
import json
import math
import os
import runpy
import sys
import traceback

import FreeCAD as App
import Part

V = App.Vector
HERE = os.path.dirname(os.path.abspath(__file__))
FC_PARTS = os.path.join(HERE, "..", "pro3d_parts", "fc_parts.py")
FC_PROFIL = os.path.join(os.path.expanduser("~"), ".claude", "skills", "alutech-profily", "scripts", "fc_profil.py")
STAV = "dle dokumentace"
GEN = "pro3d_lib/fc_lib"


def props(o, d, group="Konstrukce"):
    for k, v in d.items():
        if v is None:
            continue
        if isinstance(v, bool):
            if k not in o.PropertiesList:
                o.addProperty("App::PropertyBool", k, group)
            setattr(o, k, v)
        elif isinstance(v, (int, float)):
            if k not in o.PropertiesList:
                o.addProperty("App::PropertyFloat", k, group)
            setattr(o, k, float(v))
        else:
            if k not in o.PropertiesList:
                o.addProperty("App::PropertyString", k, group)
            setattr(o, k, str(v))


def hex_z(s, z0, z1):
    r = s / math.sqrt(3.0)
    pts = [V(r * math.cos(math.radians(30 + 60 * i)), r * math.sin(math.radians(30 + 60 * i)), z0) for i in range(6)]
    return Part.Face(Part.makePolygon(pts + [pts[0]])).extrude(V(0, 0, z1 - z0))


def prim(p):
    if "box" in p:
        x0, x1, y0, y1, z0, z1 = p["box"]
        return Part.makeBox(x1 - x0, y1 - y0, z1 - z0, V(x0, y0, z0))
    if "cyl" in p:
        c = p["cyl"]
        return Part.makeCylinder(c["r"], c["h"], V(*c["p"]), V(*c["d"]))
    if "cone" in p:
        c = p["cone"]
        return Part.makeCone(c["r1"], c["r2"], c["h"], V(*c["p"]), V(*c["d"]))
    if "hex_z" in p:
        c = p["hex_z"]
        return hex_z(c["s"], c["z0"], c["z1"])
    if "slot" in p:                                   # podélný otvor, osa Z
        c = p["slot"]
        a, b, r, h = V(*c["p1"]), V(*c["p2"]), c["r"], c["h"]
        sh = Part.makeCylinder(r, h, a, V(0, 0, 1)).fuse(Part.makeCylinder(r, h, b, V(0, 0, 1)))
        d = b - a
        if d.Length > 1e-6:
            n = V(-d.y, d.x, 0)
            n.normalize()
            pts = [a + n * r, b + n * r, b - n * r, a - n * r]
            f = Part.Face(Part.makePolygon(pts + [pts[0]]))
            sh = sh.fuse(f.extrude(V(0, 0, h)))
        return sh.removeSplitter()
    if "prism_x" in p:
        c = p["prism_x"]
        pts = [V(c["x0"], y, z) for y, z in c["pts"]]
        return Part.Face(Part.makePolygon(pts + [pts[0]])).extrude(V(c["x1"] - c["x0"], 0, 0))
    raise ValueError("neznámý prvek " + json.dumps(p)[:80])


def solid(body):
    adds = [prim(p) for p in body.get("add", [])]
    sh = adds[0]
    for s in adds[1:]:
        sh = sh.fuse(s)
    cuts = [prim(p) for p in body.get("cut", [])]
    if cuts:
        sh = sh.cut(Part.makeCompound(cuts))
    try:
        sh = sh.removeSplitter()
    except Exception:  # noqa: BLE001
        pass
    return sh


def rot(R):
    return App.Rotation(App.Matrix(R[0][0], R[0][1], R[0][2], 0, R[1][0], R[1][1], R[1][2], 0,
                                   R[2][0], R[2][1], R[2][2], 0, 0, 0, 0, 1))


def build_lib_body(spec, out):
    doc = App.newDocument("Dil")
    part = doc.addObject("App::Part", "Dil")
    part.Label = spec["nazev"]
    ph = bool(spec.get("zastupny"))
    common = {"Konstrukce_Typ": spec.get("typ") or "dil", "Konstrukce_Zdroj": " | ".join(spec.get("zdroj") or []),
              "Konstrukce_Detail": spec.get("detail") or "", "Konstrukce_Generator": GEN + "/lib_body",
              "Konstrukce_Material": spec.get("material") or "", "Konstrukce_Poznamka": spec.get("poznamka") or "",
              "Konstrukce_Model": spec["key"]}
    stav = {"PLCdesk_ModelStatus": "placeholder", "Konstrukce_Zastupny": True} if ph else {"Konstrukce_ModelStav": STAV}
    if spec.get("vlastni") and not ph:               # vlastní konstrukce modulu (deska, úhelník) — díl pro App::Link, ne „dle dokumentace“
        stav = {}
    props(part, dict(common, **stav))
    sh = solid(spec["body"])
    o = doc.addObject("Part::Feature", "Teleso")
    o.Shape = sh
    o.Label = "Těleso: " + spec["nazev"]           # popisek ≠ popisek dílu (FreeCAD by duplicitu přečísloval)
    props(o, dict({"Konstrukce_Typ": spec.get("typ") or "dil"}, **stav))
    part.addObject(o)
    doc.recompute()
    doc.saveAs(out)
    App.closeDocument(doc.Name)
    bb = sh.BoundBox
    return {"ok": sh.isValid(), "out": out, "objem": round(sh.Volume, 2),
            "bbox": [round(x, 3) for x in (bb.XMin, bb.XMax, bb.YMin, bb.YMax, bb.ZMin, bb.ZMax)]}


def profil_shape(L):
    src = open(FC_PROFIL, encoding="utf-8").read()
    src = src.replace("\nmain()\n", "\n")            # jen funkce (skript na konci volá main())
    ns = {"__name__": "fc_profil_lib", "__file__": FC_PROFIL}
    exec(compile(src, FC_PROFIL, "exec"), ns)        # noqa: S102 — skript skillu alutech-profily (důvěryhodný, lokální)
    face = ns["zastupny_40_8"]()
    sh = face.extrude(V(0, 0, L))
    sh.rotate(V(0, 0, 0), V(0, 1, 0), 90)           # osa profilu Z → X
    sh.translate(V(0, 0, 20))
    return sh


def cable_shape(c):
    edges = []
    for seg in c["path"]:
        if "line" in seg:
            a, b = seg["line"]
            edges.append(Part.LineSegment(V(*a), V(*b)).toShape())
        else:
            a, m, b = seg["arc"]
            edges.append(Part.Arc(V(*a), V(*m), V(*b)).toShape())
    w = Part.Wire(edges)
    a, b = c["path"][0]["line"]
    d = V(*b) - V(*a)
    d.normalize()
    circ = Part.Wire(Part.makeCircle(c["r"], V(*a), d))
    return w.makePipeShell([circ], True, True)


def main():
    plan = json.load(open(sys.argv[1], encoding="utf-8"))
    folder = os.path.abspath(sys.argv[2])
    dily_dir = os.path.join(folder, "dily")
    os.makedirs(dily_dir, exist_ok=True)
    App.ParamGet("User parameter:BaseApp/Preferences/Document").SetBool("CreateBackupFiles", False)
    res = {"ok": True, "dily": {}, "chyby": []}
    # 1) normalizované díly: pro3d_parts/fc_parts.py
    specs = []
    for s in plan["dily"]:
        out = os.path.join(dily_dir, s["key"] + ".FCStd")
        if s["gen"] == "lib_body":
            try:
                res["dily"][s["key"]] = build_lib_body(s, out)
            except Exception as exc:  # noqa: BLE001
                res["dily"][s["key"]] = {"ok": False, "chyba": str(exc), "trace": traceback.format_exc()[-800:]}
        else:
            specs.append(dict(s, out=out))
    if specs:
        sp = os.path.join(dily_dir, "_fc_parts_specs.json")
        json.dump(specs, open(sp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        rp = os.path.join(dily_dir, "_fc_parts_vysledek.json")
        old_argv, old_env = sys.argv, os.environ.get("FC_RESULT")
        sys.argv = [FC_PARTS, sp]
        os.environ["FC_RESULT"] = rp
        try:
            runpy.run_path(FC_PARTS, run_name="fc_parts")
        finally:
            sys.argv = old_argv
            if old_env is None:
                os.environ.pop("FC_RESULT", None)
            else:
                os.environ["FC_RESULT"] = old_env
        for k, v in json.load(open(rp, encoding="utf-8"))["modely"].items():
            res["dily"][k] = v
    for k, v in res["dily"].items():
        if not v.get("ok"):
            res["ok"] = False
            res["chyby"].append(f"díl {k}: {v.get('chyba', 'neplatné těleso')}")
    # 2) sestava zkušební desky
    sest = plan.get("sestava") or "Lavice_S1"
    doc = App.newDocument(sest)
    out = os.path.join(folder, sest + ".FCStd")
    doc.saveAs(out)                                   # App::Link na jiný dokument potřebuje uložený hostitelský dokument
    root = doc.addObject("App::Part", "Lavice")
    root.Label = plan.get("label") or "Zkušební deska modulu S1"
    props(root, {"Konstrukce_Generator": GEN})
    pr = plan["profil"]
    po = doc.addObject("Part::Feature", "Profil")
    po.Shape = profil_shape(pr["delka"])
    po.Label = pr["label"]
    props(po, {"Konstrukce_Typ": "profil", "Konstrukce_Material": "AlMgSi0,5 (hlinik)", "Konstrukce_Profil": pr["kod"],
               "Konstrukce_Poznamka": "průřez zástupný z kót katalogu ALUTEC s. 4/4 (skill alutech-profily fc_profil.zastupny_40_8)"})
    root.addObject(po)
    ext = {}
    for i, m in enumerate(plan["moduly"]):
        g = doc.addObject("App::Part", f"Modul_{i + 1}")
        g.Label = m["nazev"]
        props(g, m.get("props") or {"Konstrukce_Generator": "pro3d_lib/modul_snimac", "Konstrukce_Modul": "S1",
                                     "Konstrukce_Snimac": m["typ"]})
        root.addObject(g)
        grp = {}
        for sk in m.get("skupiny") or []:                 # podskupiny modulu (např. snímatelné víko s Konstrukce_Pohyb)
            sg = doc.addObject("App::Part", f"M{i + 1}_{sk['name']}")
            sg.Label = sk["label"]
            props(sg, dict(sk.get("props") or {}, Konstrukce_Generator=GEN))
            g.addObject(sg)
            grp[sk["name"]] = sg

        def host(x):
            return grp.get(x.get("skupina")) or g
        for j, it in enumerate(m["instance"]):
            p = os.path.join(dily_dir, it["model"] + ".FCStd")
            if p not in ext:
                ext[p] = App.openDocument(p)
            tgt = ext[p].getObject("Dil")
            lk = doc.addObject("App::Link", f"M{i + 1}_{it['druh']}_{j}")
            lk.setLink(tgt)
            lk.LinkTransform = False
            lk.Placement = App.Placement(V(*it["pos"]), rot(it["rot"]))
            lk.Label = f"{m['typ']} {it['druh']} {j} ({tgt.Label})"
            props(lk, dict(it.get("props") or {}, Konstrukce_Generator=GEN, PLCdesk_Mount=it.get("mount") or None))
            host(it).addObject(lk)
        for t in m["telesa"]:
            o = doc.addObject("Part::Feature", f"M{i + 1}_{t['name']}")
            o.Shape = solid(t["body"])
            o.Label = t["label"]
            props(o, dict(t["props"], Konstrukce_Generator=GEN))
            host(t).addObject(o)
        for c in m["kabely"]:
            o = doc.addObject("Part::Feature", f"M{i + 1}_{c['name']}")
            try:
                o.Shape = cable_shape(c)
            except Exception as exc:  # noqa: BLE001
                res["chyby"].append(f"kabel {m['typ']}: {exc}")
                res["ok"] = False
            o.Label = c["label"]
            props(o, dict(c["props"], Konstrukce_Generator=GEN))
            host(c).addObject(o)
    doc.recompute()
    doc.save()
    res["model"] = out
    res["objektu"] = len(doc.Objects)
    App.closeDocument(doc.Name)
    for d in ext.values():
        App.closeDocument(d.Name)
    res["soubory_dilu"] = sorted(v["out"] for v in res["dily"].values() if v.get("out"))
    json.dump(res, open(os.environ.get("FC_RESULT") or globals().get("FC_RESULT") or os.path.join(folder, "fc_lib_vysledek.json"),
                        "w", encoding="utf-8"), ensure_ascii=False, indent=1)


main()
