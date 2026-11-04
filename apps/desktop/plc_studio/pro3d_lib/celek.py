"""Celek E3 — stroj složený z modulů kódem (čistý Python: plán, smlouvy, požadavky na rám; FreeCAD: ``fc_ram.py`` = ``fc_lib.py``).

Celek vzniká OBRÁCENĚ než ze stolu konceptu: **moduly určí rám**. Pořadí (kdo určuje co):

1. **D1 dopravník** (``modul_dopravnik``) — délka, šířka a výška pásu z manifestu / skillu dopravniky; obálka D1 vč. modulů na
   něm (**P1 vyhazovač** na konzole bočnice a **S1 snímač** na bočnici podle smlouvy D1). Výška pracovní desky N1 =
   horní líc pod stojinami D1, snížený tak, aby visící pohon nezasáhl desku (vůle ``VULE_POHON``; stojiny se prodlouží —
   délka stojin je v D1 ODHAD).
2. **O3 kryt** (``modul_kryt``) — vnitřek krytu = obálka D1 + P1 + S1 + vůle ``VULE_KRYT`` + místo pro přepravku za pásem
   (ODHAD, přepravka není v kusovníku); zóny nebezpečí = vtažná místa D1 a zóny P1; dveře vpředu (−y, strana obsluhy).
3. **O1 pult + P2 / P3 pneumatika** — na nosném profilu 40 × 40 v pásu desky u nakládacího konce (x min, vratný buben —
   strana obsluhy), mimo kryt a mimo dráhu dveří; čelo pultu a ovládání úpravy vzduchu ven (−x). **O2 maják** jen když
   kusovník má věž (``beacon``); signálka ve vzoru 01 je v pultu.
4. **N1 rám** (``modul_ram``) — D × Š = kryt + pás obsluhy + odsazení věnce (kryt stojí uvnitř věnce: 2A v x, A v y),
   H = výška desky z bodu 1, montážní nosníky 40 × 80 pod stojinami D1 (smlouva D1 ``pozadavek_N1``), požadavky modulů =
   otvory v desce (šrouby krytu a nosného profilu zespodu se zahloubením, šrouby stojin D1 deskou do drážky nosníku
   ``kind: otvor_drazka``, průchody hadic P4). Poloha D1 v x se posune po 10 mm, dokud N1 přijme VŠECHNY otvory.
5. **P4 hadice** ostrov → válec — router generátoru modulů (``pro3d_modules/router.py``, A* s rovným úsekem ≥ 2 R) mezi
   obálkami celku; deskou smí projít (průchod = požadavek na N1, rám ho vyvrtá), krytem ne.
6. **E2 kabely** zařízení → rozvaděč a **E1 rozvaděč**: pozice rozvaděče = ODHAD (stojan u hnacího konce, rozměr skříně
   z kusovníku); trasy spočítá router jako ODHAD délek do kusovníku / zpětné vazby — v modelu se zatím NESTAVÍ (stojan
   rozvaděče, držáky skříně a žlab nejsou moduly s doloženými rozměry → ``nepostaveno``).

Co nejde postavit, je v ``nepostaveno`` s důvodem a ve zpětné vazbě ``PLCdesk_CAD_feedback_celek.json``; rozměry bez zdroje
jen jako ODHAD s poznámkou (stejně jako moduly).

CLI: ``python -m plc_studio.pro3d_lib.celek <PLCdesk_CAD.json> <složka> [--model Celek_01] [--no-fc] [--slot pro-e3]
[--bez-otvoru]`` → ``<složka>/celek/``: ``plan.json``, ``<model>.FCStd``, smlouvy modulů, ``CELEK.md``, ``celek.json``,
snímky ``snimky/celek_*.png`` a kontroly ``kontroly/``. Poslední řádek stdout = JSON souhrn. Kód 0 = model bez chyb,
1 = model vznikl s chybami / nepostavenými položkami k doplnění, 2 = selhalo."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    __package__ = "plc_studio.pro3d_lib"

from . import modul_dopravnik as md  # noqa: E402
from . import modul_kryt as mk  # noqa: E402
from . import modul_majak, modul_ostrov, modul_pult, modul_ram, modul_valec, spojky_mech  # noqa: E402
from .modul_ram import _lib, cols, r3  # noqa: E402

HERE = Path(__file__).resolve().parent
GEN = "pro3d_lib/celek"
SLOT = "pro-e3"
SUB = "celek"
A = 40.0
I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
RAM = modul_ram.DATA
VULE_POHON = 25.0       # ODHAD — vůle visícího pohonu D1 nad pracovní deskou
VULE_KRYT = 50.0        # ODHAD — vůle obálky modulů od vnitřního líce krytu (montáž, seřízení)
PREPRAVKA = 250.0       # ODHAD — místo pro přepravku / skluz za pásem (strana +y), přepravka není v kusovníku
PAS_OBSLUHY = 230.0     # pás desky u nakládacího konce pro pult a pneumatiku (x 0 … PAS_OBSLUHY)
X_NOSIC = 150.0         # osa nosného profilu pultu / pneumatiky (mimo příčník N1 x 40…80; vývod cívky ventilu −x nad deskou)
MEZERA_MODULU = 40.0    # mezera pult ↔ pneumatika na nosném profilu (ODHAD)
SKRIN_ODSTUP = 150.0    # ODHAD — stojan rozvaděče u hnacího konce, odstup od rámu
# strana obsluhy u nakládacího konce: místní x modulu → +y, místní +y (čelo / ovládání) → −x
R_PAS = cols([0, 1, 0], [-1, 0, 0], [0, 0, 1])


def _u(bs):
    bs = [b for b in bs if b]
    return [min(b[i] for b in bs) for i in range(3)] + [max(b[i] for b in bs) for i in range(3, 6)]


def _mv(R, v):
    return [sum(R[i][j] * v[j] for j in range(3)) for i in range(3)]


def _tb(R, o, bb):
    pts = [_mv(R, [x, y, z]) for x in (bb[0], bb[3]) for y in (bb[1], bb[4]) for z in (bb[2], bb[5])]
    return [round(min(p[k] for p in pts) + o[k], 2) for k in range(3)] + [round(max(p[k] for p in pts) + o[k], 2) for k in range(3)]


def _prim_box(p):
    if "box" in p:
        b = p["box"]
        return [b[0], b[2], b[4], b[1], b[3], b[5]]
    if "cyl" in p:
        c = p["cyl"]
        e = [c["p"][k] + c["d"][k] * c["h"] for k in range(3)]
        return [min(c["p"][k], e[k]) - c["r"] * (1 - abs(c["d"][k])) for k in range(3)] + \
               [max(c["p"][k], e[k]) + c["r"] * (1 - abs(c["d"][k])) for k in range(3)]
    if "prism_z" in p:
        c = p["prism_z"]
        xs, ys = [q[0] for q in c["pts"]], [q[1] for q in c["pts"]]
        return [min(xs), min(ys), c["z0"], max(xs), max(ys), c["z1"]]
    return None


def _body_box(body):
    return _u([_prim_box(p) for p in body.get("add") or []])


def _module_boxes(m, typy_skip=("zona", "pomocny")):
    """Obálky těles modulu (globálně, s ``placement``) — překážky routeru; zóny a pomocné prostory zvlášť."""
    pl = m.get("placement") or {"pos": [0, 0, 0], "rot": I3}
    out = []
    for t in m.get("telesa") or []:
        if (t.get("props") or {}).get("Konstrukce_Typ") in typy_skip:
            continue
        b = _body_box(t["body"])
        if b:
            out.append(_tb(pl["rot"], pl["pos"], b))
    return out


# --- D1 na pracovní desce N1 ------------------------------------------------------------------------------------------
class D1NaDesce(md.Dopravnik):
    """D1 s kotvením ``ram``, ale stojiny stojí NA pracovní desce N1 (tloušťka ``t_deska``) nad montážními nosníky 40 × 80:
    šrouby spodních úhelníků vedou deskou do matic T horní drážky nosníku (otvor v desce = požadavek ``otvor_drazka``)."""

    def __init__(self, *a, t_deska=0.0, **kw):
        super().__init__(*a, **kw)
        self.t_deska = float(t_deska)
        self.otvory_desky = []
        self._na_desce = False

    def uhelnik(self, C, nA, nB, mA, mB, label):
        self._na_desce = "→ nosník N1" in label and self.t_deska > 0
        try:
            return super().uhelnik(C, nA, nB, mA, mB, label)
        finally:
            self._na_desce = False

    def nut_screw(self, M, bod, along, normal, t_up, podlozka, label, druh="sroub"):
        if self._na_desce and normal[2] > 0.9:
            self.otvory_desky.append({"bod": r3([bod[0], bod[1], bod[2]]), "d": spojky_mech.otvor_vule(M), "kind": "otvor_drazka",
                                      "co": f"D1: otvor Ø{spojky_mech.otvor_vule(M):g} pro šroub {M} úhelníku stojiny deskou do drážky nosníku ({label})"})
            bod = [bod[0], bod[1], bod[2] - self.t_deska]
            t_up = t_up + self.t_deska
            label = f"{label} (deskou {self.t_deska:g} mm)"
        return super().nut_screw(M, bod, along, normal, t_up, podlozka, label, druh)


def d1_build(vst, origin, z_ramu=None, t_deska=0.0):
    par = dict(vst.get("popis") or {})
    par["_ze_zadani"] = tuple(par)
    if vst.get("rampS"):
        par["t_rampa_s"] = vst["rampS"]
    vy = (vst.get("vyhazovace") or [None])[0]
    sn = next((s for s in vst.get("snimace") or [] if s.get("typ")), None)
    d = D1NaDesce(ident=vst.get("id") or "M1", nazev=f"D1 {vst.get('id', 'M1')} pásový dopravník", par=par, origin=origin, kotveni="ram",
                  z_ramu=z_ramu, vyhazovac=vy, snimac=sn, pohon_PLCdesk_Id=vst.get("pohon_PLCdesk_Id") or "",
                  pohon_typ=vst.get("pohon_typ") or "", t_deska=t_deska)
    return d.build()


def d1_obalka(d) -> dict:
    """Obálka D1 (profily, díly, tělesa bez zón, moduly P1 / S1) a dno pohonu (globálně)."""
    bs = [m["box"] for m in d.members] + [b for _n, b in d.boxes_extra]
    bs += [_body_box(t["body"]) for t in d.tel if (t.get("props") or {}).get("Konstrukce_Typ") not in ("zona", "pomocny")]
    for m in d.moduly_ext:
        if m.get("rozhrani", {}).get("obalka"):
            bs.append(m["rozhrani"]["obalka"])
        bs += _module_boxes(m)
    poh = [b for n, b in d.boxes_extra if n.startswith("pohon")]
    return {"bb": _u(bs), "pohon_dno": min(b[2] for b in poh) if poh else None, "boxes": bs}


# --- pás obsluhy: nosný profil + pult + pneumatika ------------------------------------------------------------------
def pas_obsluhy(man: dict, Hd: float, t_deska: float, y0: float):
    """Nosný profil 40 × 40 podél +y na desce (x = ``X_NOSIC``), šrouby M6 zespodu deskou; na něm pult O1 (u přední strany)
    a za ním úprava vzduchu P2 + ostrov P3. Vrací {fixture, moduly, porty, pozadavky, obalky, info}."""
    out = {"moduly": [], "pozadavky": [], "obalky": [], "nepostaveno": [], "odhady": set(), "info": {}, "porty": {}, "elektro": {}}
    x_cursor = 20.0
    # O1 pult
    pr = modul_pult.pristroje_z_manifestu(man)
    pult = None
    if pr["pristroje"]:
        pult = modul_pult.modul(pr, x_cursor, nazev="Pult obsluhy O1 (u nakládacího konce)")
        k = pult["kontrola"]
        W = k["rozmer"][0]
        pult["placement"] = {"pos": [X_NOSIC, y0, Hd], "rot": R_PAS}
        out["moduly"].append(pult)
        loc = [x_cursor, -45.0, 40.0, x_cursor + W, 55.0, 40.0 + k["rozmer"][2]]
        out["obalky"].append(("O1 pult", _tb(R_PAS, [X_NOSIC, y0, Hd], loc)))
        out["info"]["O1"] = {"pristroje": [p["tag"] for p in k["pristroje"]], "vynechano": pult.get("vynechano"),
                             "zpetna_vazba": pult.get("zpetna_vazba"),
                             "vyska_ovladacu_mm": {t: round(Hd + z, 1) for t, z in (k.get("vysky") or {}).items()}}
        x_cursor += W + MEZERA_MODULU + 40.0
        kb = (pult.get("kabely") or [{}])[0]
        if kb.get("path"):
            a, b = kb["path"][-1].get("line") or kb["path"][-1]["arc"][1:]
            out["elektro"]["O1"] = {"bod": [round(v, 2) for v in _tb(R_PAS, [X_NOSIC, y0, Hd], list(b) + list(b))[:3]], "D": 2 * kb.get("r", 4.0)}
    else:
        out["nepostaveno"].append({"id": "O1", "co": "pult obsluhy", "duvod": "kusovník nemá ovládací přístroje do pultu"})
    # P2 + P3
    zm = modul_ostrov.z_manifestu(man)
    vent = [v for v in zm["ventily"] if v.get("valec") and str(v.get("obj")) in modul_ostrov.D["ventily"]]
    p2 = p3 = None
    if vent:
        parts = man.get("parts") or []
        by_cat = {}
        for p in parts:
            by_cat.setdefault(p.get("category"), []).append(p)
        sv = man.get("safety") is not None
        ids = {"EM1": (by_cat.get("air_shutoff") or [{}])[0].get("id"), "LFR": (by_cat.get("air_prep") or [{}])[0].get("id"),
               "SV": (by_cat.get("safety_valve") or [{}])[0].get("id") if sv else None}
        man_id = (by_cat.get("valve_manifold") or [{}])[0].get("id") or ""
        ident = man_id.split(":")[0] if man_id else "-WP1"
        p2 = modul_ostrov.uprava("-P2", x_cursor, 0.0, sv=sv, ids={k: v for k, v in ids.items() if v})
        xo = p2["rozhrani"]["vystup_P"]["usti"][0] + 2 * (54 + 20.7 + 20) + 20.1 + 10 - 60.0      # = lavice_p234 (oblouky PUN-10)
        p3 = modul_ostrov.ostrov(ident, [{"tag": v["tag"], "valec": v["valec"]} for v in vent], xo, 0.0, lista_id=man_id)
        o = [X_NOSIC, y0, Hd + A]
        pl = {"pos": o, "rot": R_PAS}
        hs = [modul_ostrov.hadice_p2_p3(p2, p3)]
        p4a = {"typ": "P4 hadice", "tag": "-P4P", "nazev": "P4 — rozvod P: úprava vzduchu → lišta", "dily": [], "instance": [],
               "telesa": [], "kabely": [{k: v for k, v in h.items() if k != "vysledek"} for h in hs], "skupiny": [],
               "props": {"Konstrukce_Generator": modul_ostrov.GEN, "Konstrukce_Modul": "P4"}, "placement": pl,
               "vysledek": [h["vysledek"] for h in hs]}
        out["moduly"] += [dict(p2, placement=pl), dict(p3, placement=pl), p4a]
        lb = _u([p2["rozhrani"]["obalka"], p3["rozhrani"]["obalka"]])
        out["obalky"].append(("P2 úprava vzduchu", _tb(R_PAS, o, p2["rozhrani"]["obalka"])))   # zvlášť — překážky routeru
        out["obalky"].append(("P3 ostrov", _tb(R_PAS, o, p3["rozhrani"]["obalka"])))
        for q in p3["rozhrani"]["pripojky"]:
            out["porty"][q["id"]] = {"usti": [round(v, 3) for v in _tb(R_PAS, o, q["usti"] + q["usti"])[:3]],
                                    "osa_usti": [round(v, 6) for v in _mv(R_PAS, q["osa_usti"])], "zasun": q["zasun"], "id": q["id"],
                                    "cil": q["cil"], "valec": q["valec"], "ventil": q["ventil"], "R": q["R"]}
        for e, v in zip(p3["rozhrani"]["elektro"], vent):
            out["elektro"][v["tag"] + " cívka"] = {"bod": [round(c, 2) for c in _tb(R_PAS, o, e["zacatek"] + e["zacatek"])[:3]], "D": 4.3}
        out["info"]["P2"] = {k: p2["rozhrani"].get(k) for k in ("bezpecnost", "uzaver")}
        out["info"]["P3"] = {"ident": ident, "ventily": [v["tag"] for v in vent]}
        out["hadice"] = hs
        x_cursor = lb[3] + 20.0
        if sv and ids.get("SV"):
            out["nepostaveno"].append({"id": f"kabel {ids['SV']}", "co": "kabel bezpečnostního ventilu MS6-SV-E (Sub-D, M8)",
                                       "duvod": "rozhraní V2 Sub-D nedoloženo — kabel doplní stavitel; ventil = NÁVRH ke schválení"})
        out["odhady"].add("pneumatika P2 + P3 na nosném profilu u nakládacího konce mimo kryt (uzávěr dosažitelný bez otevření krytu) — "
                          "poloha ODHAD k odsouhlasení")
    # nosný profil (místní x 0 … L → globální y y0 … y0 + L)
    L = math.ceil((x_cursor + 10.0) / 10.0) * 10.0
    fx = modul_ram.Ram(L, 100.0, Hd)
    fx.member("104040", A, A, L, [X_NOSIC, y0, Hd + A / 2], [0, 0, 1], [1, 0, 0], [0, 1, 0], "nosnik_obsluhy",
              "Nosný profil pultu a pneumatiky 40×40")
    for y in (y0 + 15.0, y0 + L / 2, y0 + L - 15.0):
        _r, q = mk.sroub_zespodu(fx, X_NOSIC, round(y, 1), Hd, t_deska, [0, 1, 0], f"nosný profil obsluhy → deska y {y:.0f}")
        out["pozadavky"].append(dict(q, co=f"nosný profil obsluhy: otvor M6 zespodu se zahloubením y {y:.0f}", kind="otvor_sroub"))
    zs = RAM["zaslepka"]
    zk = fx.dil(_lib("Zaslepka_224040", {"add": [{"box": [-A / 2, A / 2, -A / 2, A / 2, 0, zs["t"]]}]}, "Záslepka ALUTEC 224040 PA6 (zástupná)",
                     zs["zdroj"], "obálka", typ="prislusenstvi", material="PA6", pozn=zs["pozn"], zastupny=True))
    for y, sgn in ((y0, -1), (y0 + L, 1)):            # pravotočivě: ex × ey = ez (ven z čela)
        fx.put(zk, [X_NOSIC, y, Hd + A / 2], cols([-sgn, 0, 0], [0, 0, 1], [0, sgn, 0]), "zaslepka")
    fx.finalize_members()
    out["fixture"] = {"typ": "nosný profil", "tag": "N2", "nazev": f"Nosný profil 40×40×{L:g} pultu a pneumatiky na desce N1",
                      "dily": list(fx.dily.values()), "instance": fx.inst, "telesa": [], "kabely": [], "skupiny": [],
                      "props": {"Konstrukce_Generator": GEN, "Konstrukce_Modul": "N2"}}
    out["obalky"].append(("nosný profil obsluhy", fx.members[0]["box"]))
    for m in out["moduly"]:                          # začátky kabelů / hadic modulů (vývody za pultem) — místo v pásu
        pts = [q for k_ in m.get("kabely") or [] for sg in k_["path"] for q in (sg.get("line") or sg.get("arc"))]
        if pts and m.get("placement"):
            g = [_tb(m["placement"]["rot"], m["placement"]["pos"], list(q) + list(q))[:3] for q in pts]
            r_ = max(k_.get("r", 3.0) for k_ in m["kabely"])
            out["obalky"].append((f"{m.get('typ')} vývody", [min(q[i] for q in g) - r_ for i in range(3)] + [max(q[i] for q in g) + r_ for i in range(3)]))
    out["L"] = L
    out["chyby"] = list(fx.chyby)
    out["pult"], out["p2"], out["p3"] = pult, p2, p3
    return out


# --- kryt O3 v souřadnicích N1 -------------------------------------------------------------------------------------
def kryt_build(n1_roz: dict, box: list, zony: list, man: dict, vyska: float):
    """Kryt O3 na desce N1 s vnějším obrysem ``box`` = [X0, Y0, X1, Y1] (souřadnice N1; modul O3 jinak bere celou desku
    s odsazením věnce — tady obrys určuje obálka modulů)."""
    k = mk.Kryt(n1_roz, zony, man, vyska=vyska, ident="O3")
    k.X0, k.Y0, k.X1, k.Y1 = box
    k.D, k.W = box[0] + box[2], box[1] + box[3]          # střed obrysu (rozlišení přední / zadní strany v Kryt.build)
    k.nazev = f"O3 kryt {box[2] - box[0]:g} × {box[3] - box[1]:g} × {k.Hk:g} s dveřmi"
    k.build()
    return {"modul": k.modul(), "rozhrani": k.rozhrani(), "kryt": k}


def kryt_steny(k, t=4.0) -> list:
    return [[k.X0, k.Y0, k.Zb, k.X0 + A, k.Y1, k.Zt], [k.X1 - A, k.Y0, k.Zb, k.X1, k.Y1, k.Zt], [k.X0, k.Y1 - A, k.Zb, k.X1, k.Y1, k.Zt],
            [k.X0, k.Y0 - 12.0, k.Zb, k.X1, k.Y0 + A, k.Zt], [k.X0, k.Y0, k.Zt - A, k.X1, k.Y1, k.Zt + t]]


# --- router -----------------------------------------------------------------------------------------------------------
def _router():
    root = str(HERE.parents[1])
    if root not in sys.path:
        sys.path.insert(0, root)
    from plc_studio.pro3d_modules import router  # type: ignore
    return router


def route_hose(hid, a, b, obst, plates, medium="festo_PUN_6x1", nazev="", prefer=None):
    """Hadice ústí ``a`` → ústí ``b`` routerem (pevné uložení, poloměr podle média) + zaoblení ``modul_ostrov.hadice``."""
    rt = _router()
    tr = modul_ostrov.trasa_mod()
    med = tr.nacti_media()[medium]
    req = tr.pozadovany_polomer(med, "pevne", med["D"])
    R = float(req["doporuceny"] or req["min"])
    D = float(med["D"])
    stub = 15.0 + R + 4.0
    p1 = [a["usti"][k] + a["osa_usti"][k] * stub for k in range(3)]
    p2 = [b["usti"][k] + b["osa_usti"][k] * stub for k in range(3)]
    infl = D / 2 + 3.0 + 0.15 * R + 0.5
    obs = [bx for bx in obst if not (rt.point_in(p1, rt.inflate(bx, infl)) or rt.point_in(p2, rt.inflate(bx, infl)))]
    res = rt.route(p1, a["osa_usti"], p2, [-c for c in b["osa_usti"]], obs, R=R, r_med=D / 2, clear=3.0 + 0.15 * R, step=20.0 if math.dist(p1, p2) < 900 else 40.0,
                   plates=plates, margin=350.0, max_nodes=900000, cross_cost=400.0, prefer=prefer)
    if res is None:
        return None, f"router: {rt.LAST.get('fail')}"
    via = res["body"]
    try:
        h = modul_ostrov.hadice(hid, a, b, via, medium, nazev)
    except ValueError as exc:
        return None, str(exc)
    h["pruchody"] = res["pruchody"]
    h["body"] = via
    return h, ""


def route_cable(cid, start, goal, obst, plates, D=6.0, R=None):
    """Kabel (ODHAD trasy) bod → bod routerem; vrací {body, delka, pruchody} nebo None."""
    rt = _router()
    R = R or 6.0 * D
    obs = [bx for bx in obst if not (rt.point_in(start, rt.inflate(bx, D / 2 + 4)) or rt.point_in(goal, rt.inflate(bx, D / 2 + 4)))]
    res = rt.route(start, [0, 0, 1], goal, [0, 0, -1], obs, R=R, r_med=D / 2, clear=3.0, step=40.0, plates=plates, margin=400.0,
                   max_nodes=120000, cross_cost=400.0)
    return res


# --- plán celku -----------------------------------------------------------------------------------------------------
def _n1(D, W, Hd, nos, poz, mods, name):
    return modul_ram.plan_ramu(D=D, W=W, H=Hd, deska=True, podpory="patky", zatizeni_kg=0.0, nosniky=nos, pozadavky=poz, moduly=mods,
                               ident="N1", nazev=f"N1 rám {D:g} × {W:g} × {Hd:g} — {name}")


def n1_params(man: dict) -> dict | None:
    """Parametry rámu N1 z celku (pro ``ram_gen`` v postupu): {kw, umisteni, zdroj, odhady} nebo None (stroj bez D1)."""
    if not any(d.get("cls") in ("Motor", "Vfd") and md.RE_PAS.search(d.get("desc") or "") for d in man.get("devices") or []):
        return None                                         # celek zatím jen kolem pásového dopravníku D1
    try:
        c = plan_celku(man, s_hadicemi=True, s_kabely=False)
    except ValueError:
        return None
    return c["n1_params"]


def plan_celku(man: dict, *, s_hadicemi=True, s_kabely=True, model="Celek") -> dict:
    """Plán celku (formát ``fc_lib``) + smlouvy modulů, požadavky na rám, nepostaveno, odhady, zpětná vazba."""
    vst = md.vstup_z_manifestu(man)                       # ValueError = stroj bez dopravníku
    odhady, nep, fb = set(), [], []
    poradi = []
    # 1) D1 — obálka a výška desky
    pre = d1_build(vst, (0.0, 0.0, 0.0))
    ob = d1_obalka(pre)
    t_d = float(RAM["deska"]["t"])
    Hd = pre.z0_ram
    if ob["pohon_dno"] is not None and ob["pohon_dno"] - VULE_POHON < Hd:
        Hd = ob["pohon_dno"] - VULE_POHON
        odhady.add(f"výška desky N1 {Hd:.1f} mm = dno visícího pohonu D1 {ob['pohon_dno']:.1f} − vůle {VULE_POHON:g} (ODHAD); stojiny D1 "
                   f"{pre.geo['boc_bot'] - Hd:.0f} mm místo {pre.p['stojina']:g}")
    Hd = round(Hd, 2)
    poradi.append(f"D1: pás H {pre.geo['H']:g}, L {pre.geo['L']:g}, b0 {pre.geo['b0']:g}; obálka D1 + P1 + S1 {[round(v) for v in ob['bb']]}; "
                  f"deska N1 z {Hd:g} (pod stojinami, pohon nad deskou)")
    bb = ob["bb"]
    # 2) kryt kolem obálky (vnitřní líce = obálka + vůle; vzadu přepravka)
    yb_rear = max(bb[4], pre.geo["yb"] + 40.0 + PREPRAVKA)
    odhady.add(f"kryt O3: vůle {VULE_KRYT:g} mm od obálky D1 / P1 / S1 a {PREPRAVKA:g} mm za pásem pro přepravku / skluz (ODHAD — "
               "přepravka není v kusovníku)")
    inner_x = bb[3] - bb[0] + 2 * VULE_KRYT
    inner_y = yb_rear - bb[1] + 2 * VULE_KRYT
    Lk = math.ceil((inner_x + 2 * A) / 10.0) * 10.0
    Wk = math.ceil((inner_y + 2 * A) / 10.0) * 10.0
    inset_x, inset_y = mk.DATA["ramec"]["inset_x"], mk.DATA["ramec"]["inset_y"]
    y0_pas = inset_y + A + 20.0
    pas0 = pas_obsluhy(man, Hd, t_d, y0_pas)
    X0 = max(PAS_OBSLUHY, math.ceil((max(b[3] for _n, b in pas0["obalky"]) + 15.0) / 10.0) * 10.0)
    X1 = X0 + Lk
    Y0 = inset_y
    Y1 = Y0 + Wk
    D = X1 + inset_x
    W = Y1 + inset_y
    zt_need = max(bb[5], max((z["bbox"][5] for z in pre.zony), default=0.0)) + VULE_KRYT
    vyska = max(mk.DATA["ramec"]["vyska"], math.ceil((zt_need - Hd + A) / 10.0) * 10.0)
    poradi.append(f"O3: obrys {Lk:g} × {Wk:g} × {vyska:g} (vnitřek = obálka modulů + {VULE_KRYT:g}, za pásem {PREPRAVKA:g})")
    poradi.append(f"O1 + P2/P3: nosný profil v pásu x 0…{X0:g} u nakládacího konce (čelo ven −x; šířka pásu = moduly vč. vývodů "
                  f"kabelů + 15), mimo dráhu dveří")
    poradi.append(f"N1: {D:g} × {W:g}, deska z {Hd:g}, montážní nosníky pod stojinami D1")
    # 3) poloha D1 v x — posun po 10 mm, dokud N1 přijme všechny otvory
    best = None
    Lk0 = Lk
    for dlt in range(0, 210, 10):
        ox = X0 + A + VULE_KRYT - bb[0] + dlt           # D1 i pravý konec krytu o dlt dál (vnitřek beze změny vůlí)
        Lk = Lk0 + dlt
        X1 = X0 + Lk
        D = X1 + inset_x
        oy = Y0 + A + VULE_KRYT - bb[1]
        d = d1_build(vst, (ox, oy, 0.0), z_ramu=Hd, t_deska=t_d)
        nos = sorted({k["nosnik_N1_x"] for k in d.kotvy})
        n1_0 = _n1(D, W, Hd, nos, [], [], "předběžný")
        zony = [{"nazev": z["nazev"], "bbox": z["bbox"]} for z in d.zony]
        for m in d.moduly_ext:
            for z in (m.get("rozhrani") or {}).get("zony") or []:
                zony.append({"nazev": f"P1 {m['rozhrani'].get('tag', '')} {z['nazev']}", "bbox": z["bbox"]})
        o3 = kryt_build(n1_0["rozhrani"], [X0, Y0, X1, Y1], zony, man, vyska)
        poz = [dict(q) for q in o3["rozhrani"]["pozadavky_na_ram"] if q.get("bod")] + d.otvory_desky
        pas = pas_obsluhy(man, Hd, t_d, y0_pas)
        poz += pas["pozadavky"]
        n1 = _n1(D, W, Hd, nos, poz, [], "zkouška otvorů")
        odm = n1["rozhrani"].get("pruchody", {}).get("odmitnuto") if isinstance(n1["rozhrani"].get("pruchody"), dict) else None
        if odm is None:
            odm = [p for p in (n1["rozhrani"].get("pruchody") or []) if isinstance(p, dict) and p.get("duvod")]
        cand = (len(odm), dlt, d, o3, pas, poz, nos, zony, odm, X1, D, Lk)
        if best is None or cand[0] < best[0]:
            best = cand
        if not odm:
            break
    nodm, dlt, d, o3, pas, poz, nos, zony, odm, X1, D, Lk = best
    if dlt:
        poradi.append(f"D1 posunut o {dlt} mm v x a kryt o tolik delší ({Lk:g}), aby otvory krytu a stojin nebyly nad nosníky / "
                      f"příčníky N1 → N1 {D:g} × {W:g}")
    for p in odm:
        nep.append({"id": "N1 otvor", "co": p.get("co"), "duvod": f"N1 otvor odmítl: {p.get('duvod')}"})
    # 4) O2 maják — jen s řádkem beacon
    vez = modul_majak.veze_z_manifestu(man)
    if vez:
        nep.append({"id": "O2", "co": "signální věž", "duvod": "umístění věže na kryt O3 zatím celek neumí (horní věnec nese střechu) — "
                                                               "doplní stavitel podle smlouvy O2"})
    # 5) P4 hadice ostrov → válce (router), průchody deskou → požadavky N1
    p1_mods = [m for m in d.moduly_ext if (m.get("props") or {}).get("Konstrukce_Modul") != "S1" and m.get("rozhrani", {}).get("pripojky")]
    s1_mods = [m for m in d.moduly_ext if m not in p1_mods]
    n1_pre = _n1(D, W, Hd, nos, poz, [], "pro trasy")
    rp = n1_pre["rozhrani"]
    ram_plan = n1_pre["moduly"][0]
    obst = []
    deska_box = [0.0, 0.0, Hd - t_d, D, W, Hd]
    for inst in ram_plan["instance"]:
        if inst["druh"] == "profil":
            pass
    ram_b = modul_ram.Ram(D, W, Hd, deska=True, nosniky=nos, pozadavky=poz, zatizeni_kg=0.0).build()
    prefer = [m["box"] for m in ram_b.members]          # trasa se drží profilů rámu (úchytky na profil)
    for m in ram_b.members:
        obst.append([m["box"][0] - 6, m["box"][1] - 6, m["box"][2], m["box"][3] + 6, m["box"][4] + 6, m["box"][5]])
    obst += [b for _n, b in ram_b.boxes_extra if _n != "pracovní deska"]
    obst += [m["box"] for m in d.members] + [b for _n, b in d.boxes_extra]
    obst += [_body_box(t["body"]) for t in d.tel if (t.get("props") or {}).get("Konstrukce_Typ") not in ("zona",)]
    for m in d.moduly_ext:
        obst += _module_boxes(m)
        ob_ = (m.get("rozhrani") or {}).get("obalka")
        if ob_ and m in p1_mods:
            top = max(q["usti"][2] for q in m["rozhrani"]["pripojky"]) - 25.0
            obst.append([ob_[0], ob_[1], ob_[2], ob_[3], ob_[4], min(ob_[5], top)])
    k = o3["kryt"]
    obst += kryt_steny(k)
    obst += _module_boxes(o3["modul"], typy_skip=("zona",))
    obst += [b for _n, b in pas["obalky"]]
    hoses, h_info = [], []
    prip = {}
    if s_hadicemi and pas.get("p3") and p1_mods:
        for m in p1_mods:
            for q in modul_ostrov._p1_porty(m).values():
                prip[(m["rozhrani"]["tag"], q["port"])] = {"usti": q["usti"], "osa_usti": q["osa_usti"], "zasun": q["zasun"], "id": q["id"]}
        used = []
        for pid, a in sorted(pas["porty"].items(), key=lambda kv: kv[1]["cil"] != "zadni"):
            tgt = prip.get((a["valec"], a["cil"]))
            if not tgt:
                nep.append({"id": f"H {pid}", "co": f"hadice {pid} → {a['valec']} {a['cil']}", "duvod": "válec v celku není"})
                continue
            h, why = route_hose(f"{pid.lstrip('-').replace('.', '_')}_{a['valec'].lstrip('-')}_{a['cil']}", a, tgt, obst + used,
                                [deska_box], prefer=prefer, nazev=f"Hadice PUN-6x1 {a['ventil']} port {pid.split('.')[-1]} → {a['valec']} {a['cil']}")
            if h is None:
                nep.append({"id": f"H {pid}", "co": f"hadice {pid} → {a['valec']} {a['cil']}", "duvod": f"trasa nenalezena ({why}) — doplní stavitel"})
                continue
            h["vysledek"].update({"od": pid, "do": tgt["id"]})
            hoses.append(h)
            used += _router().segments_boxes(h["body"], h["r"] + 2.0)
            for cr in h["pruchody"]:
                b_ = cr["bod"]
                poz.append({"co": f"průchod Ø{2 * h['r'] + 10:.0f} hadice {pid} → {a['valec']} {a['cil']}", "bod": [b_[0], b_[1], Hd],
                            "d": round(2 * h["r"] + 10, 1), "kind": "pruchod"})
            h_info.append(h["vysledek"])
    elif s_hadicemi and pas.get("p3"):
        nep.append({"id": "P4", "co": "hadice ostrov → válce", "duvod": "válce P1 v celku nejsou"})
    # 6) N1 finální (s průchody hadic)
    mods_m = [{"nazev": "D1 stojiny", "hmotnost_kg": (d.hmotnost["celkem_kg"] + d.p["m_kg"]) / max(1, len(nos)),
               "pos": [x + 20, W / 2]} for x in nos]
    mods_m.append({"nazev": "O3 kryt", "hmotnost_kg": o3["rozhrani"]["hmotnost_kg"], "pos": [(X0 + X1) / 2, (Y0 + Y1) / 2]})
    mods_m.append({"nazev": "O1 + P2/P3 (ODHAD 8 kg)", "hmotnost_kg": 8.0, "pos": [X_NOSIC, (Y0 + Y1) / 2]})
    odhady.add("hmotnost pultu a pneumatiky 8 kg ODHAD (pro průhyb věnce)")
    n1 = _n1(D, W, Hd, nos, poz, mods_m, str((man.get("project") or {}).get("name") or "celek"))
    roz_n1 = n1["rozhrani"]
    pr_ = roz_n1.get("pruchody") or {}
    for p in (pr_.get("odmitnuto") if isinstance(pr_, dict) else []) or []:
        if all(x.get("co") != p.get("co") for x in nep):
            nep.append({"id": "N1 otvor", "co": p.get("co"), "duvod": f"N1 otvor odmítl: {p.get('duvod')}"})
    # 7) E1 rozvaděč (pozice ODHAD) a E2 kabely
    cab = next((p for p in man.get("parts") or [] if p.get("category") == "cabinet"), None)
    dims = _cabinet_dims(cab)
    e1 = {"partId": (cab or {}).get("id"), "typ": (cab or {}).get("type"), "rozmer_mm": dims,
          "poloha": "stojan u hnacího konce za rámem (ODHAD)", "box": None}
    if dims:
        w_, h_, t_ = dims
        x_c0 = D + SKRIN_ODSTUP
        e1["box"] = [x_c0, W / 2 - w_ / 2, 400.0, x_c0 + t_, W / 2 + w_ / 2, 400.0 + h_]
        e1["vstup_kabelu"] = [x_c0 + t_ / 2, W / 2, 400.0]
    nep.append({"id": "E1", "co": f"rozvaděč {e1.get('partId') or ''} {e1.get('typ') or ''}".strip(),
                "duvod": "rozvaděč staví pro3d_cabinet (rozvadec/Rozvadec.FCStd); stojan a držáky skříně nejsou modul s doloženými "
                         "rozměry — v celku jen rezervovaná poloha (ODHAD), App::Link doplní stavitel"})
    kabely = []
    if s_kabely and e1.get("vstup_kabelu"):
        kabely = cables_estimate(man, d, pas, o3, e1, obst + [x for h in hoses for x in _router().segments_boxes(h["body"], h["r"] + 2)],
                                 deska_box, Hd)
        for c in kabely:
            if not c.get("postaveno"):
                pass
        nep.append({"id": "E2", "co": f"kabely k rozvaděči ({len(kabely)})",
                    "duvod": "trasy spočítány routerem jako ODHAD délek (kusovník / zpětná vazba); v modelu se nestaví — žlab / úchytky na "
                             "profilech a průchody do krytu nejsou zatím moduly (požadavek na rám a kryt níže)"})
    # 8) plán
    ram_mod = n1["moduly"][0]
    mods = [ram_mod, d.plan()]
    for m in p1_mods:
        mods.append(modul_ostrov._bez_zacatku_hadic(m) if hoses else m)
    mods += s1_mods
    mods.append(o3["modul"])
    mods.append(pas["fixture"])
    mods += pas["moduly"]
    if hoses:
        mods.append({"typ": "P4 hadice", "tag": "-P4", "nazev": "P4 — hadice ostrov → válce", "dily": [], "instance": [], "telesa": [],
                     "kabely": [{k: v for k, v in h.items() if k not in ("vysledek", "pruchody", "body")} for h in hoses], "skupiny": [],
                     "props": {"Konstrukce_Generator": GEN, "Konstrukce_Modul": "P4"}})
    plan = {"format": "pro3d-lib-plan", "verze": 1, "generator": GEN, "model": model,
            "nazev": f"Celek — {(man.get('project') or {}).get('name') or 'stroj'} (moduly kódem)",
            "dily": md._uniq([s for m in mods for s in m["dily"]]), "moduly": mods, "snimky_prefix": "celek",
            "snimky": ["iso", "iso2", "celo", "shora", "bok"], "snimky_skryt": {"shora": [f"M{mods.index(o3['modul']) + 1}_strecha"], "iso2": [f"M{mods.index(o3['modul']) + 1}_strecha"]}}
    for m in mods:                                         # pomocná pole (vysledek) do FreeCADu nejdou
        m.pop("vysledek", None)
    _jedno_id(mods, man)
    # zpětná vazba
    if d.zpetna_vazba():
        fb += d.zpetna_vazba()["issues"]
    fb += modul_ostrov.z_manifestu(man)["issues"]
    for t in (pas["info"].get("O1") or {}).get("zpetna_vazba") or []:
        fb.append({"kind": "other", "severity": "info", "parts": [], "message": f"O1: {t}",
                   "measured": {"what": "pult", "value": 0, "unit": "-", "source": "modul O1"}})
    fb += o3["rozhrani"].get("zpetna_vazba") or []
    for c in kabely:
        if c.get("delka_mm"):
            fb.append({"kind": "other", "severity": "info", "parts": [c["partId"]] if c.get("partId") else [],
                       "message": f"kabel {c['id']} {c['od']} → rozvaděč: délka trasy {c['delka_mm']:.0f} mm, s rezervou "
                                  f"{c['delka_s_rezervou_mm']:.0f} mm (ODHAD routerem celku E2)",
                       "measured": {"what": "délka kabelu", "value": c["delka_s_rezervou_mm"], "unit": "mm",
                                    "source": "pro3d_lib/celek E2 (router, poloha rozvaděče ODHAD)"}})
    vyska_ov = (pas["info"].get("O1") or {}).get("vyska_ovladacu_mm") or {}
    if vyska_ov and min(vyska_ov.values()) < 800.0:
        odhady.add(f"pult O1 na desce stolu: ovladače ve výšce {min(vyska_ov.values()):.0f}–{max(vyska_ov.values()):.0f} mm — pro stojící "
                   "obsluhu nízko (doporučení stojan / konzola pultu ~ 1000–1200 mm, EN 894-3 — rozhodne uživatel)")
    odhady |= set(pas["odhady"])
    pozad_n1 = [p for p in poz]
    n1p = {"kw": dict(D=D, W=W, H=Hd, deska=True, podpory="patky", zatizeni_kg=0.0, nosniky=nos, pozadavky=pozad_n1, moduly=mods_m,
                      ident="N1"), "umisteni": [0.0, 0.0, 0.0],
           "zdroj": f"celek E3 (moduly kódem): D1 + P1 + S1 → kryt O3 + pás obsluhy {X0:g} mm → N1 {D:g} × {W:g} × {Hd:g}",
           "odhady": sorted(odhady)}
    celek = {
        "format": "plcdesk-pro-celek", "verze": 1, "generator": GEN, "model": model,
        "poradi": poradi, "n1_params": n1p,
        "rozmery": {"N1": {"D": D, "W": W, "H": Hd}, "O3": {"obrys": [X0, Y0, X1, Y1], "vyska": vyska},
                    "D1_pocatek": r3(d.o), "D1_posun_x": dlt, "pas_obsluhy": {"x": [0, X0], "nosic_x": X_NOSIC, "L": pas["L"]}},
        "hadice": h_info, "kabely": kabely, "E1": e1,
        "nepostaveno": nep + pas["nepostaveno"], "odhady": sorted(odhady),
        "smlouvy": {"D1": d.rozhrani(), "N1": roz_n1, "O3": o3["rozhrani"],
                    "P1": [m["rozhrani"] for m in p1_mods], "P2": (pas.get("p2") or {}).get("rozhrani"),
                    "P3": (pas.get("p3") or {}).get("rozhrani")},
        "kontrola_planu": {"chyby": d.chyby + o3["rozhrani"]["chyby"] + roz_n1.get("chyby", []) + pas["chyby"],
                           "varovani": d.varovani + o3["rozhrani"]["varovani"] + roz_n1.get("varovani", [])},
        "pruchody_N1": pr_, "info": pas["info"],
    }
    zv = {"format": "plcdesk-cad-feedback", "version": 1, "project": {"guid": (man.get("project") or {}).get("guid", "")},
          "manifest": {"sha256": ""}, "created": "", "tool": GEN, "issues": fb}
    return {"plan": plan, "celek": celek, "zpetna_vazba": zv, "n1_params": n1p}


def _jedno_id(mods, man=None):
    """Řádek kusovníku = jeden díl v modelu: kabel / hadice / druhá část dílu (ovladač spínače, kabel motoru) nese stejné
    ``PLCdesk_Id`` jako díl — v celku se u nich přejmenuje na ``PLCdesk_Ref`` (kontrola ``kusovnik`` počítá kusy)."""
    qty = {}
    for p in (man or {}).get("parts") or []:
        try:
            qty[p.get("id")] = int(round(float(p.get("qty") or 1)))
        except (TypeError, ValueError):
            qty[p.get("id")] = 1
    seen = {}
    items = []
    for m in mods:
        for it in m.get("instance") or []:
            items.append((0, it.get("props") or {}))
        for t in m.get("telesa") or []:
            items.append((1, t.get("props") or {}))
        for k in m.get("kabely") or []:
            items.append((2, k.get("props") or {}))
    for _p, pr in sorted(items, key=lambda x: x[0]):
        pid = pr.get("PLCdesk_Id")
        if not pid or str(pid).startswith("asm:"):
            continue
        if seen.get(pid, 0) >= qty.get(pid, 1) or pr.get("Konstrukce_Typ") in ("kabel", "hadice"):
            pr["PLCdesk_Ref"] = pr.pop("PLCdesk_Id")
        else:
            seen[pid] = seen.get(pid, 0) + 1


def _cabinet_dims(cab):
    import re
    if not cab:
        return None
    m = re.search(r"(\d{3,4})\s*[×x]\s*(\d{3,4})\s*[×x]\s*(\d{2,4})", str(cab.get("type") or ""))
    return [float(m.group(1)), float(m.group(2)), float(m.group(3))] if m else None


def cables_estimate(man, d, pas, o3, e1, obst, deska_box, Hd) -> list:
    """E2: kabel od každého zařízení v poli k vstupu rozvaděče (dno skříně) — trasa routerem (ODHAD, nestaví se)."""
    tr = modul_ostrov.trasa_mod()
    rz = {"pct": 10.0, "mm": 300.0, "zdroj": "ODHAD rezerva kabelu (skill kabelaz-a-hadice data kabel rezerva)"}
    goal = list(e1["vstup_kabelu"])
    starts = []
    kb = d.rozhrani()["kabel_motoru"]
    starts.append(("W-" + (kb.get("PLCdesk_Id") or "M1").split(":")[0].lstrip("-"), kb.get("PLCdesk_Id"), "pohon D1", kb["zacatek"], kb.get("D") or 9.0))
    for m in d.moduly_ext:
        r = m.get("rozhrani") or {}
        for e in r.get("elektro") or []:
            starts.append((f"W-{r.get('tag', '').lstrip('-')}-{e['signal'].split()[-1]}", None, e["signal"], e["zacatek"], 4.3))
        kk = (m.get("kontrola") or {}).get("konektor")
        if kk and (m.get("props") or {}).get("Konstrukce_Modul") == "S1":
            starts.append((f"W-{(m.get('props') or {}).get('PLCdesk_Id', 'S').split(':')[0].lstrip('-')}",
                           (m.get("props") or {}).get("PLCdesk_Id"), "snímač S1", kk["start"], 6.0))
    for nm, e in pas["elektro"].items():
        starts.append((f"W-{nm.split()[0].lstrip('-')}", None, nm, e["bod"], e.get("D") or 6.0))
    for s in o3["rozhrani"].get("blokovani") or []:
        z = s.get("zona_spinace")
        if z:
            starts.append((f"W-{s['device']}", (s.get("plcdesk_id") or [None])[0] if isinstance(s.get("plcdesk_id"), list) else s.get("plcdesk_id"),
                           f"blokovací spínač {s['device']}", [(z[0] + z[3]) / 2, z[4] - 20.0, (z[2] + z[5]) / 2], 7.0))
    out = []
    for cid, pid, od, st, D in starts:
        st = [float(v) for v in st]
        res = route_cable(cid, st, goal, obst, [deska_box], D=D)
        rec = {"id": cid, "partId": pid, "od": od, "do": e1.get("partId") or "rozvaděč", "D": D, "postaveno": False}
        if res is None:
            body = [st, [st[0], st[1], goal[2]], [goal[0], st[1], goal[2]], goal]
            L = sum(math.dist(body[i], body[i + 1]) for i in range(len(body) - 1))
            rec.update(stav="ODHAD pravoúhlou spojnicí (router nenašel trasu)", body=[r3(p) for p in body])
        else:
            L = res["delka"]
            rec.update(stav="ODHAD trasou routeru (nestavěno)", body=res["body"], pruchody=res["pruchody"])
        rec["delka_mm"] = round(L, 1)
        rec["delka_s_rezervou_mm"] = round(L * (1 + rz["pct"] / 100.0) + rz["mm"], 1)
        rec["rezerva"] = rz
        out.append(rec)
    _ = tr
    return out


# --- výstupy -------------------------------------------------------------------------------------------------------------
def write_outputs(res: dict, folder: Path) -> list[str]:
    folder.mkdir(parents=True, exist_ok=True)
    c = res["celek"]
    out = []

    def put(name, obj):
        p = folder / name
        p.write_text(json.dumps(obj, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
        out.append(str(p))
    s = c["smlouvy"]
    put(f"D1_{s['D1']['id']}.json", s["D1"])
    put(f"N1_{s['N1'].get('id', 'N1')}.json", s["N1"])
    put(f"O3_{s['O3']['id']}.json", s["O3"])
    for r in s.get("P1") or []:
        put(f"P1_{r['tag'].lstrip('-')}.json", r)
    for k in ("P2", "P3"):
        if s.get(k):
            put(f"{k}_{str(s[k].get('tag') or s[k].get('id') or k).lstrip('-')}.json", s[k])
    put("celek.json", {k: v for k, v in c.items() if k != "smlouvy"})
    put("PLCdesk_CAD_feedback_celek.json", res["zpetna_vazba"])
    return out


def report_md(res: dict, fc: dict | None = None) -> str:
    c = res["celek"]
    r = c["rozmery"]
    L = [f"# Celek {c['model']} — moduly kódem (pro3d_lib.celek, E3)", "",
         "Celek vzniká z modulů: dopravník D1 určí výšku desky a obálku, kryt O3 obálku obejde, pult O1 a pneumatika P2/P3 mají "
         "vlastní pás desky u nakládacího konce, rám N1 se postaví až nakonec s plochami a otvory, které moduly žádají.", "",
         "## Pořadí a kdo určuje co", "", *[f"{i + 1}. {t}" for i, t in enumerate(c["poradi"])], "",
         "## Rozměry", "", f"- N1: {r['N1']['D']:g} × {r['N1']['W']:g}, deska z {r['N1']['H']:g} mm",
         f"- O3: obrys {r['O3']['obrys']}, výška {r['O3']['vyska']:g}",
         f"- D1 počátek {r['D1_pocatek']} (posun x {r['D1_posun_x']} mm)", f"- pás obsluhy: {r['pas_obsluhy']}", "",
         "## Hadice P4", "", "| hadice | od → do | R | délka | s rezervou |", "|---|---|---|---|---|",
         *[f"| {h['id']} | {h.get('od')} → {h.get('do')} | {h['R']:g} | {h['delka_mm']:.0f} | {h['delka_s_rezervou_mm']:.0f} |" for h in c["hadice"]], "",
         "## Kabely E2 (ODHAD — nestaví se)", "", f"Rozvaděč E1: {c['E1'].get('partId')} {c['E1'].get('typ') or ''} — {c['E1'].get('poloha')}, "
         f"box {c['E1'].get('box')}", "", "| kabel | od | Ø | délka | s rezervou | stav |", "|---|---|---|---|---|---|",
         *[f"| {k['id']} | {k['od']} | {k['D']:g} | {k['delka_mm']:.0f} | {k['delka_s_rezervou_mm']:.0f} | {k['stav']} |" for k in c["kabely"]], "",
         "## Nepostaveno (doplní stavitel / rozhodne uživatel)", "", *[f"- **{n['id']}** {n.get('co') or ''}: {n['duvod']}" for n in c["nepostaveno"]], "",
         "## Odhady", "", *[f"- ODHAD: {o}" for o in c["odhady"]], "",
         "## Kontrola plánu", "", *[f"- CHYBA: {x}" for x in c["kontrola_planu"]["chyby"]], *[f"- varování: {x}" for x in c["kontrola_planu"]["varovani"]], ""]
    if fc:
        s = fc.get("souhrn") or {}
        L += ["## Model a kontroly kódem", "", f"- model: {s.get('model')}", f"- chyb: {s.get('chyb')}, selhalo: {s.get('selhalo')}",
              *[f"- {k}: {v.get('chyby')} chyb, {v.get('varovani')} varování" for k, v in (s.get("kontroly") or {}).items()],
              *[f"- snímek: snimky/{Path(p).name}" for p in s.get("snimky") or []], ""]
    return "\n".join(L)


def build_fc(res: dict, folder: Path, slot: str = SLOT, timeout: int = 2400, checks=None, manifest: str | None = None,
             shots: bool = True, stavet: bool = True) -> dict:
    """Plán → model (fc_ram.py) → barvy + snímky (i dveře otevřené) → kontroly (``checks`` = podmnožina, výchozí všechny
    ``pro3d_tools`` vč. ``otvory`` přísně — celek je měřítkem ISO 13857)."""
    from . import bench
    from ..pro3d_tools import run as p3run
    plan = res["plan"]
    folder = Path(folder).resolve()
    folder.mkdir(parents=True, exist_ok=True)
    pp = folder / "plan.json"
    pp.write_text(json.dumps(plan, ensure_ascii=False, indent=1), encoding="utf-8")
    rp = folder / "fc_lib_vysledek.json"
    if stavet:
        rp.unlink(missing_ok=True)
        r = bench._ps([bench.RUN_FC, "run", "--slot", slot, "--timeout", str(timeout), "--result", rp, HERE / "fc_ram.py", pp, folder],
                      timeout + 120)
        summ = bench._last_json(r.stdout)
        b = json.loads(rp.read_text(encoding="utf-8")) if rp.is_file() else {"ok": False, "stdout": r.stdout[-1500:], "stderr": r.stderr[-1500:]}
        b["fc"] = {k: summ.get(k) for k in ("ok", "exit_code", "timed_out", "duration_s", "error", "leftover")}
    else:                                              # jen snímky / kontroly nad hotovým modelem (etapy — žádný běh nad 10 min)
        b = json.loads(rp.read_text(encoding="utf-8")) if rp.is_file() else {"ok": False}
    if not b.get("model"):
        return {"ok": False, "stavba": b}
    model = Path(b["model"])
    shot_files = {}
    col = None
    if shots:
        sn = folder / "snimky"
        sn.mkdir(exist_ok=True)
        shot_files = {k: sn / f"celek_{k}.png" for k in plan["snimky"]}
        s2 = {"iso": sn / "celek_dvere_otevrene_iso.png", "shora": sn / "celek_dvere_otevrene_shora.png"}
        col = bench.colors_and_shots(model, b.get("soubory_dilu") or [], shot_files, slot=slot, shots2=s2, skryt=plan.get("snimky_skryt"),
                                     max_min=25)
        shot_files.update({"v_" + k: v for k, v in s2.items()})
    chk = tuple(checks) if checks is not None else p3run.ALL
    if not chk:
        return {"ok": bool(b.get("ok")), "stavba": {k: b.get(k) for k in ("ok", "chyby", "model", "objektu", "fc")}, "barvy": col,
                "souhrn": {"model": str(model), "chyb": None, "selhalo": [], "kontroly": {}, "snimky": [str(p) for p in shot_files.values()]}}
    rep = p3run.run_checks(str(model), chk, out=str(folder / "kontroly"), manifest=manifest, slot=slot, timeout=5400,
                           grids=[5.0, 4.0, 3.0], podlaha=None, keep=False, otvory_varovani=False)
    s = bench.souhrn(rep)
    nch = sum(v["chyby"] for v in s.values())
    failed = [k for k, v in s.items() if v["selhalo"]]
    return {"ok": bool(b.get("ok")) and nch == 0 and not failed, "stavba": {k: b.get(k) for k in ("ok", "chyby", "model", "objektu", "fc")},
            "barvy": col, "kontroly": rep,
            "souhrn": {"model": str(model), "chyb": nch, "selhalo": failed, "kontroly": s, "snimky": [str(p) for p in shot_files.values()]}}


def generate(manifest_path, folder, *, model="Celek", no_fc=False, slot=SLOT, checks=None, shots=True, stavet=True) -> dict:
    mp, folder = Path(manifest_path).resolve(), Path(folder).resolve()
    out = folder / SUB
    summ = {"ok": False, "kod": 2, "fcstd": "", "md": ""}
    try:
        man = json.loads(mp.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as exc:
        summ["chyba"] = f"manifest nelze načíst: {exc}"
        return summ
    try:
        res = plan_celku(man, model=model)
    except ValueError as exc:
        summ["chyba"] = f"celek nelze sestavit: {exc}"
        return summ
    res["zpetna_vazba"]["manifest"]["sha256"] = hashlib.sha256(mp.read_bytes()).hexdigest()
    files = write_outputs(res, out)
    c = res["celek"]
    summ.update(smlouvy=files, rozmery=c["rozmery"], nepostaveno=len(c["nepostaveno"]), hadice=len(c["hadice"]), kabely=len(c["kabely"]),
                chyby_planu=c["kontrola_planu"]["chyby"])
    fc = None
    if not no_fc:
        fc = build_fc(res, out, slot=slot, checks=checks, manifest=str(mp), shots=shots, stavet=stavet)
        (out / "fc_souhrn.json").write_text(json.dumps(fc.get("souhrn") or fc, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    (out / "CELEK.md").write_text(report_md(res, fc), encoding="utf-8")
    summ["md"] = str(out / "CELEK.md")
    if no_fc:
        summ.update(ok=True, kod=1 if c["kontrola_planu"]["chyby"] else 0)
        return summ
    fcp = out / f"{model}.FCStd"
    if not fcp.is_file():
        summ.update(kod=2, chyba="model nevznikl: " + json.dumps((fc or {}).get("stavba") or {}, ensure_ascii=False, default=str)[:800])
        return summ
    s = (fc or {}).get("souhrn") or {}
    summ.update(ok=True, fcstd=str(fcp), kod=0 if (fc or {}).get("ok") and not c["kontrola_planu"]["chyby"] else 1,
                chyb_kontrol=s.get("chyb"), selhalo=s.get("selhalo"), kontroly=s.get("kontroly"), snimky=s.get("snimky") or [])
    return summ


def main(argv=None) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
    ap = argparse.ArgumentParser(prog="celek", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("manifest")
    ap.add_argument("folder")
    ap.add_argument("--model", default="Celek")
    ap.add_argument("--no-fc", action="store_true")
    ap.add_argument("--slot", default=SLOT)
    ap.add_argument("--kontroly", default="", help="podmnožina kontrol oddělená čárkou (výchozí všechny vč. otvory)")
    ap.add_argument("--bez-otvoru", action="store_true", help="všechny kontroly kromě otvory (rychlé kolo)")
    ap.add_argument("--bez-snimku", action="store_true")
    ap.add_argument("--bez-kontrol", action="store_true", help="jen model (+ snímky)")
    ap.add_argument("--nestavet", action="store_true", help="model už je — jen snímky / kontroly (etapy)")
    a = ap.parse_args(argv)
    checks = [x.strip() for x in a.kontroly.split(",") if x.strip()] or None
    if a.bez_otvoru:
        from ..pro3d_tools import run as p3run
        checks = [x for x in p3run.ALL if x != "otvory"]
    if a.bez_kontrol:
        checks = []
    s = generate(a.manifest, a.folder, model=a.model, no_fc=a.no_fc, slot=a.slot, checks=checks, shots=not a.bez_snimku,
                 stavet=not a.nestavet)
    print(json.dumps(s, ensure_ascii=False, default=str))
    return int(s["kod"])


if __name__ == "__main__":
    sys.exit(main())
