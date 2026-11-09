# FreeCAD 1.1 (freecadcmd) — generátor normalizovaných dílů PLCdesk PRO. Spouštět JEN přes skill freecad-instance:
#   & run_fc.ps1 run --slot pro3d-parts --timeout 600 fc_parts.py <specs.json>
# specs.json = [{"key", "gen", "params", "nazev", "zdroj": [..], "detail", "typ", "material", "poznamka", "out": "<cesta.FCStd>"}]
# (připraví gen.py z catalog_map.py). Výsledek (FC_RESULT): {"modely": {key: {ok, out, bbox, objem, telesa, chyba}}}.
# Konvence os: válce a válcové snímače osa +X (zadní čelo / čelo snímače v x = 0); přístroje na lištu a polní skříňky
# X = šířka, Y = hloubka od montážní roviny (y = 0) ven, Z = výška (střed); panelové přístroje: čelo panelu y = 0,
# ovládač k +Y, tělo za panelem k −Y; šrouby osa Z, dosedací rovina hlavy z = 0, dřík k −Z (zápustný: horní plocha z = 0).
import json
import math
import os
import sys
import traceback

import FreeCAD as App
import Part

V = App.Vector
STAV = "dle dokumentace"


def cyl_x(r, x0, x1):
    return Part.makeCylinder(r, x1 - x0, V(x0, 0, 0), V(1, 0, 0))


def cyl_y(r, y0, y1, x=0.0, z=0.0):
    return Part.makeCylinder(r, y1 - y0, V(x, y0, z), V(0, 1, 0))


def cyl_z(r, z0, z1, x=0.0, y=0.0):
    return Part.makeCylinder(r, z1 - z0, V(x, y, z0), V(0, 0, 1))


def box(x0, x1, y0, y1, z0, z1):
    return Part.makeBox(x1 - x0, y1 - y0, z1 - z0, V(x0, y0, z0))


def hex_prism_z(s, z0, z1):
    """Pravidelný šestiboký hranol, klíč s (přes plochy), osa Z."""
    r = s / math.sqrt(3.0)              # poloměr opsané kružnice = s / (2·cos 30°)
    pts = [V(r * math.cos(math.radians(30 + 60 * i)), r * math.sin(math.radians(30 + 60 * i)), z0) for i in range(6)]
    face = Part.Face(Part.makePolygon(pts + [pts[0]]))
    return face.extrude(V(0, 0, z1 - z0))


def hex_prism_x(s, x0, x1):
    sh = hex_prism_z(s, 0, x1 - x0)
    sh.rotate(V(0, 0, 0), V(0, 1, 0), 90)       # osa Z -> +X
    sh.translate(V(x0, 0, 0))
    return sh


# --- generátory: každý vrací [(název tělesa, tvar, Konstrukce_Typ, podčást | None)] --------------------------------

def g_valec_iso15552(p):
    L = p["L8"] + p["zdvih"]
    E, R = p["E"], p["R"]
    body = box(0, L, -E / 2, E / 2, -E / 2, E / 2)
    holes = []
    for sy in (-1, 1):
        for sz in (-1, 1):
            y, z = sy * R / 2, sz * R / 2
            holes.append(Part.makeCylinder(p["RT_tap"] / 2, p["BG"], V(0, y, z), V(1, 0, 0)))
            holes.append(Part.makeCylinder(p["RT_tap"] / 2, p["BG"], V(L - p["BG"], y, z), V(1, 0, 0)))
    if p.get("EE_hole"):                       # přípojky EE na horní ploše (+z), PL od čela víka
        for x in (p["PL"], L - p["PL"]):
            holes.append(Part.makeCylinder(p["EE_hole"] / 2, p["EE_depth"] + 0.5, V(x, 0, E / 2 - p["EE_depth"]), V(0, 0, 1)))
    body = body.cut(Part.makeCompound(holes))
    front = cyl_x(p["B"] / 2, L, L + p["VD"]).cut(cyl_x(p["D"] / 2, L - 1, L + p["VD"] + 1))
    rear = cyl_x(p["B"] / 2, -p["VA"], 0)
    rod = cyl_x(p["D"] / 2, L, L + p["WH"]).fuse(cyl_x(p["KK_d"] / 2, L + p["WH"], L + p["H"])).removeSplitter()
    return [("Telo", body, "dil", None), ("Nakruzek_predni", front, "dil", None), ("Nakruzek_zadni", rear, "dil", None),
            ("Pistnice", rod, "dil", "Pistnice")]


def g_valec_iso6432(p):
    L = p["S"] + p["zdvih"]
    NA, D = p["NA"], p["D"]
    sq = box(0, L, -NA / 2, NA / 2, -NA / 2, NA / 2)
    body = sq.common(cyl_x(D / 2, 0, L))
    front = cyl_x(p["BE_d"] / 2, L, L + p["F"]).cut(cyl_x(p["C"] / 2, L - 1, L + p["F"] + 1))
    xc = -(p["F"] - p["RR"])
    eye = cyl_x(p["ND"] / 2, -p["F"], 0).common(box(-p["F"] - 1, 1, -p["EW"] / 2, p["EW"] / 2, -p["ND"], p["ND"]))
    eye = eye.cut(cyl_y(p["CD"] / 2, -p["ND"], p["ND"], x=xc))
    rod = cyl_x(p["C"] / 2, L, L + p["H"] - p["AM"]).fuse(cyl_x(p["KK_d"] / 2, L + p["H"] - p["AM"], L + p["H"])).removeSplitter()
    return [("Telo", body, "dil", None), ("Nakruzek_BE", front, "dil", None), ("Oko", eye, "dil", None),
            ("Pistnice", rod, "dil", "Pistnice")]


def g_skrinka(p):
    w, h, d = p["w"], p["h"], p["d"]
    return [("Teleso", box(-w / 2, w / 2, 0, d, -h / 2, h / 2), "dil", None)]


g_skrinka_din = g_skrinka


def g_hmi_panel(p):
    w, h = p["cut_w"], p["cut_h"]
    return [("Teleso_za_panelem", box(-w / 2, w / 2, -p["depth"], 0, -h / 2, h / 2), "dil", None)]


def g_panel_22(p):
    """Přístroj Ø22 na panelu: y = 0 = líc desky, hlavice do +y. ``deska_t`` (tloušťka desky, výchozí 0 = jako dřív)
    posune držák a kontakty za zadní líc desky a otvor desky vyplní krk Ø ``krk_d`` (výchozí 22, ODHAD — otvor Ø22,3)."""
    act = cyl_y(p["act_d"] / 2, 0, p["front_h"])
    rw, rh = p["rear_w"], p["rear_h"]
    t = float(p.get("deska_t") or 0.0)
    rear = box(-rw / 2, rw / 2, -t - p["rear_d"], -t, -rh / 2, rh / 2)
    out = [("Ovladac", act, "dil", None), ("Teleso_za_panelem", rear, "dil", None)]
    if t > 0:
        out.insert(1, ("Krk_v_otvoru", cyl_y(float(p.get("krk_d") or 22.0) / 2, -t, 0), "dil", None))
    return out


def g_snimac_valec(p):
    d, lt, tot = p["d"], p["thread_len"], p["total"]
    body = cyl_x(d / 2, 0, lt).fuse(cyl_x(d / 2, lt, tot)).removeSplitter()
    out = [("Teleso", body, "dil", None)]
    if p.get("nut_sw") and p.get("nut_m"):
        m = p["nut_m"]
        for i in range(int(p.get("nuts") or 1)):
            x1 = lt - i * m
            nut = hex_prism_x(p["nut_sw"], x1 - m, x1).cut(cyl_x(d / 2, x1 - m - 1, x1 + 1))
            out.append((f"Matice_{i + 1}", nut, "dil", None))
    return out


def g_snimac_tlak(p):
    th = cyl_z(p["thread_d"] / 2, 0, p["thread_len"])
    body = cyl_z(p["body_d"] / 2, p["thread_len"], p["body_top"])
    conn = cyl_z(p["conn_d"] / 2, p["body_top"], p["total"])
    return [("Zavit_G", th, "dil", None), ("Teleso", body, "dil", None), ("Konektor_M12", conn, "dil", None)]


def g_snimac_kvadr(p):
    b = box(0, p["d"], 0, p["w"], 0, p["h"])
    hs = [cyl_y(hh["d"] / 2, -1, p["w"] + 1, x=hh["x"], z=hh["z"]) for hh in p.get("holes", [])]
    if hs:
        b = b.cut(Part.makeCompound(hs))
    return [("Teleso", b, "dil", None)]


def g_valec_obalka(p):
    """Válcová obálka Ø d × h; volitelně díry patky (``holes_n`` × Ø ``holes_d`` na Ø ``holes_pcd`` od úhlu ``holes_start``
    skrz patku ``holes_t``, nad ní zahloubení Ø ``holes_cb_d`` výšky ``holes_cb_h``) — šrouby patky pak v modelu nekolidují."""
    body = cyl_z(p["d"] / 2, 0, p["h"])
    if p.get("holes_n"):
        cut = []
        for k in range(int(p["holes_n"])):
            a = math.radians(float(p.get("holes_start", 0)) + 360.0 / int(p["holes_n"]) * k)
            x, y = p["holes_pcd"] / 2 * math.cos(a), p["holes_pcd"] / 2 * math.sin(a)
            cut.append(cyl_z(p["holes_d"] / 2, -1, p["holes_t"] + 0.01, x, y))
            if p.get("holes_cb_d"):
                cut.append(cyl_z(p["holes_cb_d"] / 2, p["holes_t"], p["holes_t"] + p.get("holes_cb_h", 0), x, y))
        body = body.cut(Part.makeCompound(cut))
    return [("Teleso", body, "dil", None)]


def _socket(s, t, ztop):
    return hex_prism_z(s, ztop - t, ztop + 1)


def g_sroub_4762(p):
    d, l = p["d"], p["l"]
    head = cyl_z(p["dk"] / 2, 0, p["k"]).cut(_socket(p["s"], p["t"], p["k"]))
    return [("Sroub", head.fuse(cyl_z(d / 2, -l, 0)).removeSplitter(), "sroub", None)]


def g_sroub_7380(p):
    d, l, a, k = p["d"], p["l"], p["dk"] / 2, p["k"]
    r = (a * a + k * k) / (2 * k)                    # kulový vrchlík: základna Ø dk, výška k
    sph = Part.makeSphere(r, V(0, 0, k - r))
    head = sph.common(cyl_z(a + 1, 0, k + 1)).cut(_socket(p["s"], p["t"], k))
    return [("Sroub", head.fuse(cyl_z(d / 2, -l, 0)).removeSplitter(), "sroub", None)]


def g_sroub_10642(p):
    d, l, k = p["d"], p["l"], p["k"]
    cone = Part.makeCone(d / 2, p["dk"] / 2, k, V(0, 0, -k), V(0, 0, 1))
    shank = cyl_z(d / 2, -l, -k)
    sh = cone.fuse(shank).removeSplitter().cut(_socket(p["s"], p["t"], 0))
    return [("Sroub", sh, "sroub", None)]


def g_matice(p):
    return [("Matice", hex_prism_z(p["s"], 0, p["m"]).cut(cyl_z(p["tap"] / 2, -1, p["m"] + 1)), "matice", None)]


def g_podlozka(p):
    return [("Podlozka", cyl_z(p["d2"] / 2, 0, p["h"]).cut(cyl_z(p["d1"] / 2, -1, p["h"] + 1)), "podlozka", None)]


def g_lista_ts35(p):
    b, h, t, dno, l = p["b"], p["h"], p["t"], p["dno"], p["l"]
    a = dno / 2
    # průřez v rovině YZ: dno 27 na montážní rovině z = 0, stěny do výšky h, příruby ven do šířky b
    pts = [(-a, 0), (a, 0), (a, h - t), (b / 2, h - t), (b / 2, h), (a - t, h), (a - t, t), (-a + t, t), (-a + t, h),
           (-b / 2, h), (-b / 2, h - t), (-a, h - t), (-a, 0)]
    face = Part.Face(Part.makePolygon([V(0, y, z) for y, z in pts]))
    return [("Lista", face.extrude(V(l, 0, 0)), "dil", None)]


def g_vyvodka(p):
    th = cyl_z(p["thread"] / 2, -p["D"], 0)
    hx = hex_prism_z(p["sw"], 0, p["C"] - p["D"])
    return [("Zavit", th, "prislusenstvi", None), ("Matice_kopule", hx, "prislusenstvi", None)]


GEN = {k[2:]: v for k, v in globals().items() if k.startswith("g_")}


def add_str(o, name, val, group="Konstrukce"):
    if name not in o.PropertiesList:
        o.addProperty("App::PropertyString", name, group)
    setattr(o, name, str(val))


def build(spec):
    out = spec["out"]
    fn = GEN.get(spec["gen"])
    if fn is None:
        raise ValueError("neznámý generátor " + spec["gen"])
    p = spec["params"]
    doc = App.newDocument("Dil")
    part = doc.addObject("App::Part", "Dil")
    part.Label = spec["nazev"]
    props = {"Konstrukce_Typ": spec.get("typ") or "dil", "Konstrukce_ModelStav": STAV,
             "Konstrukce_Zdroj": " | ".join(spec.get("zdroj") or []), "Konstrukce_ZdrojPopis": spec.get("zdroj_popis") or "",
             "Konstrukce_Detail": spec.get("detail") or "", "Konstrukce_Generator": "pro3d_parts/" + spec["gen"],
             "Konstrukce_Material": spec.get("material") or "", "Konstrukce_Poznamka": spec.get("poznamka") or "",
             "Konstrukce_Model": spec["key"]}
    for k, v in props.items():
        add_str(part, k, v)
    for k, v in sorted(p.items()):
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            n = "Rozmer_" + "".join(ch if ch.isalnum() else "_" for ch in k)
            part.addProperty("App::PropertyFloat", n, "Rozmery")
            setattr(part, n, float(v))
        elif isinstance(v, str):
            add_str(part, "Rozmer_" + "".join(ch if ch.isalnum() else "_" for ch in k), v, "Rozmery")
    subs = {}
    vol, solids, valid = 0.0, 0, True
    for name, shape, typ, sub in fn(p):
        tgt = part
        if sub:
            if sub not in subs:
                sp = doc.addObject("App::Part", sub)
                part.addObject(sp)
                add_str(sp, "Konstrukce_Typ", typ)
                add_str(sp, "Konstrukce_ModelStav", STAV)
                if sub == "Pistnice" and p.get("zdvih"):
                    add_str(sp, "Konstrukce_Pohyb", json.dumps({"nazev": "pístnice vysunuta", "posun": [float(p["zdvih"]), 0.0, 0.0]},
                                                               ensure_ascii=False))
                subs[sub] = sp
            tgt = subs[sub]
        o = doc.addObject("Part::Feature", name)
        o.Shape = shape
        add_str(o, "Konstrukce_Typ", typ)
        add_str(o, "Konstrukce_ModelStav", STAV)
        tgt.addObject(o)
        vol += shape.Volume
        solids += len(shape.Solids)
        valid = valid and shape.isValid() and len(shape.Solids) >= 1
    doc.recompute()
    bb = None
    for o in doc.Objects:
        if o.TypeId == "Part::Feature":
            b = o.Shape.BoundBox
            bb = b if bb is None else bb.united(b)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    doc.saveAs(out)
    App.closeDocument(doc.Name)
    return {"ok": bool(valid), "out": out, "objem": round(vol, 2), "telesa": solids,
            "bbox": [round(x, 3) for x in (bb.XMin, bb.XMax, bb.YMin, bb.YMax, bb.ZMin, bb.ZMax)]}


def main():
    specs = json.load(open(sys.argv[1], encoding="utf-8"))
    res = {"modely": {}}
    for s in specs:
        try:
            res["modely"][s["key"]] = build(s)
        except Exception as exc:  # noqa: BLE001
            res["modely"][s["key"]] = {"ok": False, "chyba": f"{exc}", "trace": traceback.format_exc()[-1500:]}
    path = os.environ.get("FC_RESULT") or globals().get("FC_RESULT") or os.path.splitext(sys.argv[1])[0] + "_vysledek.json"
    json.dump(res, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


main()
