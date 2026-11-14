"""Modul E2 — kabelové vedení: žlab na profilu ALUTEC, úchytky do drážky a trasy kabelů od zařízení do vývodek rozvaděče
(čistý Python: plán, trasy, délky, smlouva ``E2_<id>.json``; FreeCAD: ``fc_lib.py``).

* **Žlab** HellermannTyton HTWD-HF 40 × 40 (183-24040): obrys, stěna 1,5, dno 1,6, světlost 37,0 × 36,1 = 1336 mm²
  ZMĚŘENO ze STEP (skill pneumatic-assemblies §3c, kabelaz-a-hadice references/kabely.md §3) → díl „dle dokumentace“
  (U profil BEZ prstů — v místě vstupu / výstupu kabelu se prst vylomí, počet vylomení = montážní údaj ve smlouvě; víko se
  nemodeluje). Dnem na líc profilu (drážka 40/8), šrouby ISO 4762 M5 + matice T do drážky po ≤ 300 mm (rozteč a Ø 5,5 v
  dně = ODHAD — výrobce v přečtených podkladech neuvádí). ``Konstrukce_Vedeni = zlab`` → kontrola kolize povoluje kabel ×
  žlab, žlab bez šroubu k rámu = chyba ``zlab-bez-spoje``.
* **Úchytky** ALUTEC 623040 (úchyt na kabely PA6 do drážky, katalog s. 25/9 — skill alutech-profily references/
  prislusenstvi.md §2): rozměry výrobce neuvádí → ZÁSTUPNÁ obálka 12 × 16 × 8 (oranžově), ``PLCdesk_Mount = drazka``
  (zacvaknutý do drážky — bez šroubu); stahovací páska se nemodeluje. Úchytka je tam, kde trasa kříží nosnou lištu
  (E1 příčka C0) — rozteč 150–300 mm je ODHAD (kabely.md §3); delší volné úseky jsou varování ve smlouvě.
* **Trasy**: zařízení → (router ``pro3d_modules/router.py``, A* s rovným úsekem ≥ 2 R) → vstup do žlabu otvorem (kolmo
  na dno) → pruh ve žlabu → výstup otvorem → dolů pod skříň → vodorovně pod vývodku → svisle do vývodky ve dně (E1
  ``vstupy_kabelu``). Zaoblení, délka, rezerva a katalogová délka = skill kabelaz-a-hadice ``trasa.py posud_trasu``
  (poloměr výrobce, pevné uložení), oddělení silových × signálových ``trasa.oddeleni`` (25 cm nebo přepážka), plnění žlabu
  ``trasa.zlab_plneni`` (60 % = konvence uživatele, ODHAD). Kabel = jeden kus od zařízení do vývodky (u snímačů s
  vývodem a konektorem = prodlužovací kabel; konektor se nemodeluje).

CLI: ``python -m plc_studio.pro3d_lib.modul_vedeni --lavice SLOŽKA_STROJE [--fc] [--slot pro-e12]`` = zkušební sestava
N1 + E1 + S1 + P1 + E2 (``<složka>/e12/``)."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    __package__ = "plc_studio.pro3d_lib"

from . import modul_ostrov, modul_ram, spojky_mech  # noqa: E402
from .modul_ram import _lib, add, cols, cross, r3  # noqa: E402

GEN = "pro3d_lib/modul_vedeni"
HERE = Path(__file__).resolve().parent
I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
ZLABY = {
    "HTWD-HF-40x40": {"brand": "HellermannTyton", "kod": "183-24040", "b": 40.0, "h": 37.7, "stena": 1.5, "dno": 1.6,
                      "svetlost": [37.0, 36.1], "svetlost_mm2": 1336.0,
                      "zdroj": "skill pneumatic-assemblies SKILL.md §3c (změřeno ze STEP 3Dfindit) a kabelaz-a-hadice references/kabely.md §3",
                      "pozn": "U profil bez prstů (rozteč prstů 12,6 / mezera 4,9 — v místě vstupu / výstupu kabelu prst vylomit); víko nemodelováno"},
}
UCHYT = {"kod": "623040", "brand": "ALUTEC", "nazev": "úchyt na kabely PA6 do drážky", "rozmer": [12.0, 16.0, 8.0],
         "zdroj": "skill alutech-profily references/prislusenstvi.md §2 (katalog ALUTEC s. 25/9: 623040 / 623041, │45│40│)",
         "odhad": "rozměry úchytu výrobce neuvádí → zástupná obálka 12 × 16 × 8 mm; stahovací páska nemodelována"}
SROUB_ZLABU = "M5"
ROZTEC_SROUBU = 300.0      # ODHAD — rozteč šroubů žlabu (výrobce neuvádí)
ROZTEC_UCHYTEK = 300.0     # ODHAD — kabely.md §3: 150–300 mm, aby kabel neprověšoval
DOTYK = 0.1               # mm — kabel leží na úchytce / navazuje na vývod modulu / končí u vývodky (kontrola souvislost: dotyk ≤ 0,2)
REZERVA = {"pct": 10.0, "mm": 300.0, "zdroj": "ODHAD rezerva kabelu (skill kabelaz-a-hadice — rezervu volí konstruktér; jako celek E2)"}


def _unit(v):
    L = math.sqrt(sum(x * x for x in v))
    return [x / L for x in v]


def _mv(R, v):
    return [sum(R[i][j] * v[j] for j in range(3)) for i in range(3)]


def _router():
    root = str(HERE.parents[1])
    if root not in sys.path:
        sys.path.insert(0, root)
    from plc_studio.pro3d_modules import router  # type: ignore
    return router


# --- žlab ---------------------------------------------------------------------------------------------------------------
def spec_zlabu(typ: str, L: float, holes_s: list) -> dict:
    z = ZLABY[typ]
    b, h, st, dno = z["b"], z["h"], z["stena"], z["dno"]
    d = spojky_mech.otvor_vule(SROUB_ZLABU)
    body = {"add": [{"box": [0, L, 0, dno, -b / 2, b / 2]}, {"box": [0, L, 0, h, -b / 2, -b / 2 + st]}, {"box": [0, L, 0, h, b / 2 - st, b / 2]}],
            "cut": [{"cyl": {"p": [s, -1.0, 0.0], "d": [0, 1, 0], "r": d / 2, "h": dno + 2}} for s in holes_s]}
    key = f"Zlab_{z['kod']}_L{L:g}_" + "_".join(f"{s:g}" for s in holes_s)
    return _lib(key, body, f"Kabelový žlab {z['brand']} HTWD-HF 40×40 {z['kod']} L {L:g}", [z["zdroj"]],
                "obrys, stěna a dno dle změřeného STEP; prsty a víko nemodelovány", typ="zlab", material="PVC-free HF (HellermannTyton)",
                pozn=f"{z['pozn']}; otvory Ø{d:g} pro {SROUB_ZLABU} po ≤ {ROZTEC_SROUBU:g} mm = ODHAD")


def spec_uchytu() -> dict:
    a, b, c = UCHYT["rozmer"]
    return _lib(f"Uchyt_{UCHYT['kod']}", {"add": [{"box": [-a / 2, a / 2, -b / 2, b / 2, 0, c]}]},
                f"Úchyt na kabely ALUTEC {UCHYT['kod']} PA6 do drážky (zástupný)", UCHYT["zdroj"], "obálka", typ="prislusenstvi",
                material="PA6", pozn=UCHYT["odhad"], zastupny=True)


class Zlab:
    """Žlab dnem na líci profilu: ``plocha`` = položka ``plochy`` smlouvy N1 (osa drážky, normála líce = otevření žlabu)."""

    def __init__(self, plocha: dict, u0: float, u1: float, typ: str = "HTWD-HF-40x40", nazev: str = ""):
        self.z = ZLABY[typ]
        self.typ = typ
        self.n = _unit(plocha["normala"])
        self.e = _unit(plocha["smer"])
        self.w = cross(self.e, self.n)
        self.R = cols(self.e, self.n, self.w)              # místní x = osa, y = normála (hloubka), z = šířka
        self.o = add(plocha["osa_od"], self.e, u0)
        self.L = float(u1 - u0)
        self.plocha = plocha
        self.nazev = nazev or f"Žlab HTWD-HF 40×40 na {plocha['prvek']}"
        n_s = max(2, int(math.ceil(self.L / ROZTEC_SROUBU)) + 1)
        self.holes = [round(30.0 + (self.L - 60.0) * i / (n_s - 1), 2) for i in range(n_s)]

    def glob(self, s, y, w):
        return [self.o[i] + self.e[i] * s + self.n[i] * y + self.w[i] * w for i in range(3)]

    def s_of(self, p):
        return sum((p[i] - self.o[i]) * self.e[i] for i in range(3))

    def box(self):
        pts = [self.glob(s, y, w) for s in (0, self.L) for y in (0, self.z["h"]) for w in (-self.z["b"] / 2, self.z["b"] / 2)]
        return [min(p[k] for p in pts) for k in range(3)] + [max(p[k] for p in pts) for k in range(3)]

    def walls(self):
        """Obálky dna a stěn (překážky routeru — otvor žlabu zůstává volný)."""
        z = self.z
        parts = [(0, z["dno"], -z["b"] / 2, z["b"] / 2), (0, z["h"], -z["b"] / 2, -z["b"] / 2 + z["stena"]), (0, z["h"], z["b"] / 2 - z["stena"], z["b"] / 2)]
        out = []
        for y0, y1, w0, w1 in parts:
            pts = [self.glob(s, y, w) for s in (0, self.L) for y in (y0, y1) for w in (w0, w1)]
            out.append([min(p[k] for p in pts) for k in range(3)] + [max(p[k] for p in pts) for k in range(3)])
        return out

    def pruhy(self, Ds: list) -> list:
        """Pruhy kabelů v průřezu (hloubka y od dna, šířka w): řada vedle sebe nad hlavami šroubů, víc kabelů = další řada."""
        z = self.z
        k = spojky_mech.NORM["ISO4762"]["rady"][SROUB_ZLABU]["k"]
        y0 = z["dno"] + k + 3.0
        sirka = z["svetlost"][0] - 2.0
        poradi = sorted(range(len(Ds)), key=lambda i: -Ds[i])       # tlusté kabely dolů, tenké nad ně; pruhy podle skutečných průměrů
        out = [None] * len(Ds)
        y_row, i = y0, 0
        while i < len(poradi):
            rada, sum_w = [], 0.0
            while i < len(poradi) and (not rada or sum_w + Ds[poradi[i]] + 3.0 <= sirka):
                rada.append(poradi[i])
                sum_w += Ds[poradi[i]] + 3.0
                i += 1
            Dr = max(Ds[k] for k in rada)
            if y_row + Dr > z["h"] - 1.0:
                raise ValueError(f"žlab {self.typ}: {len(Ds)} kabelů Ø{max(Ds):g} se do průřezu nevejde")
            w = -sum_w / 2
            for k in rada:
                out[k] = (round(y_row + Dr / 2, 2), round(w + (Ds[k] + 3.0) / 2, 2))
                w += Ds[k] + 3.0
            y_row += Dr + 3.0
        return out


# --- trasy -----------------------------------------------------------------------------------------------------------------
def _posud(cid, body, medium, D, skupina, od, do, partId=None, konec=10.0):
    tr = modul_ostrov.trasa_mod()
    media = tr.nacti_media()
    ev = tr.posud_trasu({"id": cid, "medium": medium, "ulozeni": "pevne", "body": body, "D": D, "konec_rovny_mm": konec,
                         "rezerva": REZERVA, "skupina": skupina, "od": od, "do": do, "partId": partId}, media)
    return ev


def _path(ev):
    out = []
    for e in ev["prvky"]:
        if e[0] == "usek":
            out.append({"line": [list(e[1]), list(e[2])]})
        else:
            out.append({"arc": [list(e[1]), list(e[2]), list(e[3])]})
    return out


def _seg_ok(rt, a, b, obst, infl):
    return not any(rt.seg_hits(a, b, rt.inflate(bx, infl)) for bx in obst)


def _kolize_kabelu(boxes, cizi, tol=0.5):
    """Pravda, když některý kvádr trasy proniká do kvádru cizího kabelu (pevné pořadí: dřívější kabel má přednost)."""
    return any(all(a[k] < b[k + 3] - tol and a[k + 3] > b[k] + tol for k in range(3)) for a in boxes for b in cizi)


def trasy(kabely: list, zlab: Zlab, vyvodky: list, obst: list, nosne: list, z_pod: float, plates=None) -> dict:
    """Trasy kabelů ``kabely`` = [{id, od, start, smer, medium, D?, skupina, partId}] přes ``zlab`` do vývodek ``vyvodky``
    (E1 ``vstupy_kabelu``: bod = konec šestihranu pod dnem, osa +z). ``obst`` = kvádry překážek, ``nosne`` = nosné lišty
    (E1 ``nosna_lista``), ``z_pod`` = výška vodorovného úseku pod skříní (E1 ``pod_skrini.z_kabelu_max``)."""
    rt = _router()
    tr = modul_ostrov.trasa_mod()
    media = tr.nacti_media()
    res = {"kabely": [], "nepostaveno": [], "chyby": [], "varovani": [], "vylomeni": 0, "uchytky": []}
    ks = sorted(kabely, key=lambda c: zlab.s_of(c["start"]))
    gl = sorted(vyvodky, key=lambda g: zlab.s_of(g["bod"]))
    if len(ks) > len(gl):
        for c in ks[len(gl):]:
            res["nepostaveno"].append({"id": c["id"], "co": f"kabel {c['id']} ({c['od']})",
                                       "duvod": f"kabelů {len(ks)} > vývodek {len(gl)} ve dně skříně (SKINTOP = 1 kabel) — doplnit vývodky / kabelový "
                                                "průchod s membránami (zpětná vazba)"})
        ks = ks[:len(gl)]
    Ds = [float(c.get("D") or media[c["medium"]]["D"]) for c in ks]
    lanes = zlab.pruhy(Ds)
    Rs = [float(tr.pozadovany_polomer(media[c["medium"]], "pevne", D)["min"] or 6 * D) for c, D in zip(ks, Ds)]
    def _mk(gls):
        det = []
        for c, D, R, (yl, wl), g in zip(ks, Ds, Rs, lanes, gls):
            s_out = min(max(zlab.s_of(g["bod"]), 2 * R + 5), zlab.L - 2 * R - 5)
            s_in = min(max(zlab.s_of(c["start"]), 5.0), zlab.L - 5.0)
            if abs(s_in - s_out) < 2 * R + 5:
                s_in = s_out - (2 * R + 5) if s_out - (2 * R + 5) >= 5.0 else s_out + 2 * R + 5
            off = zlab.z["h"] - yl + 2 * R + 10.0               # výstup / vstup otvorem kolmo na dno o 2 R + 10 za otvor
            A = zlab.glob(s_in, yl + off, wl)
            L0, L1 = zlab.glob(s_in, yl, wl), zlab.glob(s_out, yl, wl)
            E = zlab.glob(s_out, yl + off, wl)
            V1 = [E[0], E[1], z_pod]
            V2 = [g["bod"][0], g["bod"][1], z_pod]
            Gp = [g["bod"][0], g["bod"][1], g["bod"][2] - DOTYK]
            det.append({"c": c, "D": D, "R": R, "A": A, "pevne": [L0, L1, E, V1, V2, Gp], "g": g, "lane": (yl, wl), "s": (s_in, s_out)})
        return det

    def _sd2(a, b, c, d):
        best = 1e18
        for i in range(21):
            p = [a[0] + (b[0] - a[0]) * i / 20, a[1] + (b[1] - a[1]) * i / 20]
            for j in range(21):
                q = [c[0] + (d[0] - c[0]) * j / 20, c[1] + (d[1] - c[1]) * j / 20]
                best = min(best, math.dist(p, q))
        return best

    def _cena(det):
        n = 0
        for i, x in enumerate(det):      # vodorovné úseky pod skříní (všechny ve stejné výšce) se nesmí křížit ani dotýkat
            for y in det[i + 1:]:
                if _sd2(x["pevne"][3], x["pevne"][4], y["pevne"][3], y["pevne"][4]) < (x["D"] + y["D"]) / 2 + 6.0:
                    n += 1
        return (n, sum(math.dist(x["pevne"][3], x["pevne"][4]) for x in det))

    det = _mk(gl[:len(ks)])
    if 1 < len(ks) <= 7 and _cena(det)[0]:
        import itertools
        best = (_cena(det), det)
        for perm in itertools.permutations(gl, len(ks)):
            dd = _mk(list(perm))
            cc = _cena(dd)
            if cc < best[0]:
                best = (cc, dd)
        det = best[1]
    # 1) pevné části tras (ve žlabu a pod skříní)
    fixed_boxes = []
    for x in det:
        fixed_boxes += rt.segments_boxes([x["A"]] + x["pevne"][:-1], x["D"] / 2 + 2.0)
    for x in det:
        pts = [x["A"]] + x["pevne"]
        for a, b in zip(pts[2:], pts[3:]):                    # od výstupu ze žlabu
            if not _seg_ok(rt, a, b, obst, x["D"] / 2 + 1.0):
                res["varovani"].append(f"{x['c']['id']}: pevný úsek {r3(a)} → {r3(b)} zasahuje do překážky — zkontrolovat")
    # 2) router: zařízení → vstup do žlabu
    done_boxes = []
    for x in det:
        c, D, R = x["c"], x["D"], x["R"]
        st = [float(v) for v in c["start"]]
        sd = _unit(c["smer"])
        if c.get("smer_odhad") or not c.get("smer"):           # směr neznámý → první osa, kterou kabel vyjde mimo překážky
            for cd in (sd, [0, 0, 1], [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, -1]):
                q0 = add(st, cd, DOTYK)
                q1 = add(q0, cd, 10.0 + R)
                if not any(rt.point_in(q1, rt.inflate(b, D / 2 + 4)) or rt.seg_hits(q0, q1, rt.inflate(b, D / 2 + 1)) for b in obst):
                    sd = _unit(cd)
                    break
        p0 = add(st, sd, DOTYK)
        p1 = add(p0, sd, 10.0 + R)
        others = [b for y in det if y is not x for b in rt.segments_boxes([y["A"]] + y["pevne"][:-1], y["D"] / 2 + 2.0)]

        def _hit(b):
            return rt.point_in(p1, rt.inflate(b, D / 2 + 4)) or rt.point_in(x["A"], rt.inflate(b, D / 2 + 4))
        r_ = None
        # nejdřív cizí kabely vždy jako překážka; nenajde-li se trasa, vyřadit překážky obsahující začátek / vstup do žlabu
        for strikt in (True, False):
            ob = [b for b in obst + zlab.walls() if not _hit(b)]
            ob += (others + done_boxes) if strikt else [b for b in others + done_boxes if not _hit(b)]
            for krok in (20.0, 40.0):                          # limit uzlů na jemné mřížce → hrubší mřížka
                r_ = rt.route(p1, sd, x["A"], [-v for v in zlab.n], ob, R=R, r_med=D / 2, clear=3.0, step=krok, margin=300.0, max_nodes=400000,
                              plates=plates, cross_cost=400.0)
                if r_ is not None:
                    break
            if r_ is not None and not strikt:                  # záložní průchod smí vynechat jen překážky u začátku / vstupu, ne protnout cizí kabel
                rb = rt.segments_boxes([p0] + [list(q) for q in r_["body"]], D / 2 + 2.0)
                if _kolize_kabelu(rb[1:-1], others + done_boxes):
                    r_ = None
                    res["varovani"].append(f"{c['id']}: záložní trasa by protnula jiný kabel — kabel nepostaven (doplní stavitel)")
            if r_ is not None:
                break
        if r_ is None:
            res["nepostaveno"].append({"id": c["id"], "co": f"kabel {c['id']} ({c['od']})", "duvod": f"router nenašel trasu do žlabu ({rt.LAST.get('fail')})"})
            continue
        body = [p0] + [list(p) for p in r_["body"]]
        if math.dist(body[-1], x["A"]) > 1e-3:
            body.append(x["A"])
        body += x["pevne"]
        ev = _posud(c["id"], body, c["medium"], D, c.get("skupina") or "signal", c["od"], x["g"]["name"], c.get("partId"))
        if ev["chyby"]:
            res["nepostaveno"].append({"id": c["id"], "co": f"kabel {c['id']} ({c['od']})", "duvod": "; ".join(ev["chyby"])})
            continue
        done_boxes += rt.segments_boxes([p0] + [list(q) for q in r_["body"]], D / 2 + 2.0)
        res["vylomeni"] += 2
        res["kabely"].append({"c": c, "ev": ev, "x": x, "router": r_})
        for pr_ in r_.get("pruchody") or []:                   # průchod deskou = požadavek na rám (N1 vyvrtá)
            lst = res.setdefault("pruchody", [])
            if not any(q["kabel"] == c["id"] and abs(q["bod"][0] - pr_["bod"][0]) < 1 and abs(q["bod"][1] - pr_["bod"][1]) < 1 for q in lst):
                lst.append({"kabel": c["id"], "bod": r3(pr_["bod"]), "d": round(D + 10.0, 1)})
    # 3) úchytky na nosných lištách (kde vodorovný úsek trasy lištu kříží nad drážkou)
    for k in res["kabely"]:
        ev, D = k["ev"], k["x"]["D"]
        for e in ev["prvky"]:
            if e[0] != "usek":
                continue
            a, b = e[1], e[2]
            for nl in nosne:
                zt = nl["osa_od"][2]
                if abs(a[2] - b[2]) > 0.5 or abs(a[2] - (zt + UCHYT["rozmer"][2] + D / 2 + DOTYK)) > 1.0:
                    continue
                yl = nl["osa_od"][1]
                if (a[1] - yl) * (b[1] - yl) > 0 or abs(b[1] - a[1]) < 1e-6:
                    continue
                t = (yl - a[1]) / (b[1] - a[1])
                xx = a[0] + t * (b[0] - a[0])
                if nl["volne_x"][0] + UCHYT["rozmer"][0] / 2 <= xx <= nl["volne_x"][1] - UCHYT["rozmer"][0] / 2:
                    res["uchytky"].append({"bod": r3([xx, yl, zt]), "kabel": k["c"]["id"], "lista": nl["nazev"]})
    # 4) volné úseky bez podpory (mimo žlab, ne svislé do vývodky)
    zb = zlab.box()
    for k in res["kabely"]:
        for e in k["ev"]["prvky"]:
            if e[0] != "usek":
                continue
            a, b = e[1], e[2]
            m = [(a[i] + b[i]) / 2 for i in range(3)]
            if rt.point_in(m, zb):
                continue
            Ls = math.dist(a, b)
            nu = sum(1 for u in res["uchytky"] if u["kabel"] == k["c"]["id"]
                     and min(a[0], b[0]) - 1 <= u["bod"][0] <= max(a[0], b[0]) + 1 and min(a[1], b[1]) - 1 <= u["bod"][1] <= max(a[1], b[1]) + 1)
            if Ls / (nu + 1) > ROZTEC_UCHYTEK:
                res["varovani"].append(f"{k['c']['id']}: volný úsek {Ls:.0f} mm ({nu} úchytek) > {ROZTEC_UCHYTEK:g} mm (ODHAD kabely.md §3) — "
                                       "doplnit úchytky / svislý žlab")
    return res


# --- modul E2 ----------------------------------------------------------------------------------------------------------------
def modul(kabely: list, zlab: Zlab, e1_roz: dict, obst: list, ident: str = "E2", nazev: str = "", plates=None) -> dict:
    """Modul E2: žlab + šrouby, úchytky, kabely; smlouva E2. ``e1_roz`` = smlouva E1 (vývodky, nosná lišta, výška pod skříní)."""
    nos = [e1_roz["nosna_lista"]] if e1_roz.get("nosna_lista") else []
    z_pod = (e1_roz.get("pod_skrini") or {}).get("z_kabelu_max")
    if z_pod is None:
        raise ValueError("E2: smlouva E1 nemá pod_skrini.z_kabelu_max")
    nos_z = [n["osa_od"][2] for n in nos]
    D0 = max(float(c.get("D") or modul_ostrov.trasa_mod().nacti_media()[c["medium"]]["D"]) for c in kabely)
    z_kab = (nos_z[0] + UCHYT["rozmer"][2] + D0 / 2 + DOTYK) if nos_z else z_pod
    if z_kab > z_pod + 1e-6:
        raise ValueError(f"E2: kabel nad nosnou lištou (z {z_kab:.1f}) je výš než dovoluje ohyb do vývodky (z {z_pod:.1f})")
    tr = trasy(kabely, zlab, e1_roz["vstupy_kabelu"], obst, nos, z_kab, plates=plates)
    dily, inst = [], []
    sp = spec_zlabu(zlab.typ, zlab.L, zlab.holes)
    dily.append(sp)
    inst.append({"model": sp["key"], "pos": r3(zlab.o), "rot": [r3(r) for r in zlab.R], "druh": "zlab",
                 "props": {"Konstrukce_Vedeni": "zlab", "Konstrukce_Modul": "E2", "Konstrukce_Zlab": f"{zlab.z['brand']} {zlab.z['kod']}"}})
    srouby = []
    for s in zlab.holes:                                      # šrouby žlabu M5 do matic T drážky profilu
        bod = add(zlab.o, zlab.e, s)
        r_ = _sroub_zlabu(bod, zlab, f"žlab → {zlab.plocha['prvek']} s {s:g}")
        dily += r_["dily"]
        inst += r_["inst"]
        srouby.append(r_["sroub"])
    su = spec_uchytu()
    if tr["uchytky"]:
        dily.append(su)
    for u in tr["uchytky"]:
        inst.append({"model": su["key"], "pos": u["bod"], "rot": I3, "druh": "uchyt", "mount": "drazka",
                     "props": {"Konstrukce_Spoj": f"úchyt {UCHYT['kod']} v drážce {u['lista']} (zacvaknutý)", "Konstrukce_Kabel": u["kabel"]}})
    kab, vys = [], []
    for k in tr["kabely"]:
        c, ev = k["c"], k["ev"]
        kab.append({"name": f"Kabel_{c['id'].replace('-', '_').replace(':', '_')}", "label": f"Kabel {c['id']} {c['od']} → {ev['do']} ({ev['delka_mm']:.0f} mm, R {ev['R']:g})",
                    "r": ev["D"] / 2, "path": _path(ev),
                    "props": {"Konstrukce_Typ": "kabel", "Konstrukce_Druh": c.get("skupina") or "signal", "Konstrukce_Medium": c["medium"],
                              "Konstrukce_Ulozeni": "pevne", "Konstrukce_D": ev["D"], "Konstrukce_RMin": ev["R_min"], "Konstrukce_RTrasy": ev["R"],
                              "Kabel_R_min": ev["R_min"], "Konstrukce_Delka": ev["delka_mm"], "Konstrukce_DelkaRezerva": ev["delka_s_rezervou_mm"],
                              "Konstrukce_DelkaKatalog_m": ev.get("delka_katalog_m"), "Konstrukce_Od": c["od"], "Konstrukce_Do": ev["do"],
                              "Konstrukce_Skupina": c.get("skupina") or "signal", "Konstrukce_Zdroj": ev.get("zdroj") or "",
                              "PLCdesk_Ref": c.get("partId")}})
        vys.append({"id": c["id"], "od": c["od"], "do": ev["do"], "partId": c.get("partId"), "medium": c["medium"], "nazev": ev.get("nazev"),
                    "D": ev["D"], "R_min": ev["R_min"], "R": ev["R"], "delka_mm": ev["delka_mm"], "delka_s_rezervou_mm": ev["delka_s_rezervou_mm"],
                    "delka_katalog_m": ev.get("delka_katalog_m"), "rezerva": ev["rezerva"], "skupina": c.get("skupina") or "signal",
                    "varovani": ev["varovani"], "zdroj_polomeru": ev.get("zdroj"), "body": [r3(p) for p in ev["body"]]})
    trm = modul_ostrov.trasa_mod()
    odd = trm.oddeleni([k["ev"] for k in tr["kabely"]])
    pl = trm.zlab_plneni(zlab.z["svetlost_mm2"], [k["ev"]["D"] for k in tr["kabely"]])
    fb = []
    for k in tr["kabely"]:
        g = k["x"]["g"]
        sv = g.get("svirani_mm")
        if sv and k["ev"]["D"] < sv[0] - 1e-6:
            fb.append({"kind": "other", "severity": "warning", "parts": [k["c"]["partId"]] if k["c"].get("partId") else [],
                       "message": f"vývodka {g['name']}: kabel {k['c']['id']} Ø{k['ev']['D']:g} mm je pod svíracím rozsahem {sv[0]:g}–{sv[1]:g} mm "
                                  "— menší vývodka (SKINTOP ST-M M16 4–10 mm) nebo těsnicí vložka",
                       "measured": {"what": "průměr kabelu", "value": k["ev"]["D"], "unit": "mm", "source": "skill kabelaz-a-hadice data/media.json"},
                       "required": {"what": "svírání vývodky", "min": sv[0], "unit": "mm", "source": g.get("zdroj") or "pro3d_parts normalie SKINTOP_ST-M"}})
        fb.append({"kind": "other", "severity": "info", "parts": [k["c"]["partId"]] if k["c"].get("partId") else [],
                   "message": f"kabel {k['c']['id']} {k['c']['od']} → {k['ev']['do']}: trasa {k['ev']['delka_mm']:.0f} mm, s rezervou "
                              f"{k['ev']['delka_s_rezervou_mm']:.0f} mm, katalog {k['ev'].get('delka_katalog_m')} m (E2 kódem)",
                   "measured": {"what": "délka kabelu", "value": k["ev"]["delka_s_rezervou_mm"], "unit": "mm", "source": "pro3d_lib/modul_vedeni (trasa.py)"}})
    for n_ in tr["nepostaveno"]:
        if "vývodek" in n_["duvod"]:
            fb.append({"kind": "other", "severity": "warning", "parts": [e1_roz["skrin"]["id"]], "message": f"E2: {n_['duvod']}",
                       "measured": {"what": "vývodky ve dně", "value": len(e1_roz["vstupy_kabelu"]), "unit": "ks", "source": "rozvadec/layout.json"}})
            break
    odhady = sorted({f"rozteč šroubů žlabu ≤ {ROZTEC_SROUBU:g} mm a otvory Ø{spojky_mech.otvor_vule(SROUB_ZLABU):g} v dně = ODHAD",
                     UCHYT["odhad"], f"rozteč úchytek {ROZTEC_UCHYTEK:g} mm = ODHAD (kabely.md §3: 150–300 mm)", REZERVA["zdroj"],
                     "plnění žlabu 60 % = konvence uživatele (trasa.zlab_plneni)", "konektory M8 / M12 na koncích kabelů nemodelovány"}
                    | ({"šroub žlabu M5: matice T zašroubována 6,4 mm (o 0,1 mm méně než celá výška ODHAD matice 6,5) — dno žlabu 1,6 mm"}
                       if any(s.get("zkraceno") for s in srouby) else set()))
    roz = {
        "format": "plcdesk-pro-modul", "modul": "E2", "verze": 1, "id": ident, "generator": GEN, "nazev": nazev or "E2 kabelové vedení",
        "trasy": vys,
        "zlaby": [{"typ": zlab.typ, "kod": zlab.z["kod"], "brand": zlab.z["brand"], "delka_mm": zlab.L, "na": zlab.plocha["prvek"],
                   "bod_od": r3(zlab.o), "bod_do": r3(add(zlab.o, zlab.e, zlab.L)), "otevreni": r3(zlab.n), "plneni": pl,
                   "vylomeni_prstu": tr["vylomeni"], "srouby": srouby, "zdroj": zlab.z["zdroj"]}],
        "uchytky": {"kod": f"{UCHYT['brand']} {UCHYT['kod']}", "kusu": len(tr["uchytky"]), "polohy": tr["uchytky"], "zdroj": UCHYT["zdroj"]},
        "oddeleni": {"nalezy": odd, "min_mm": trm.ODDELENI_MM, "zdroj": trm.ODDELENI_SRC,
                     "pozn": "silové a signálové kabely v jednom žlabu bez přepážky = nález" if odd else "bez silových kabelů / oddělení vyhovuje"},
        "pozadavky_na_ram": [{"co": f"drážka {zlab.plocha['prvek']} v úseku s {zlab.s_of(zlab.o):.0f}…{zlab.L:.0f} obsazena žlabem E2 (šrouby {SROUB_ZLABU})",
                              "plocha": zlab.plocha["prvek"], "normala": zlab.plocha["normala"]}]
        + [{"co": f"průchod kabelu {p_['kabel']} deskou Ø{p_['d']:g}", "bod": p_["bod"], "d": p_["d"], "kind": "pruchod"}
           for p_ in tr.get("pruchody") or []],
        "nepostaveno": tr["nepostaveno"], "varovani": tr["varovani"] + [o["text"] for o in odd], "chyby": tr["chyby"],
        "odhady": odhady, "zdroje": sorted({zlab.z["zdroj"], UCHYT["zdroj"], trm.ODDELENI_SRC}),
    }
    mod = {"typ": "E2 kabelové vedení", "tag": ident, "nazev": roz["nazev"], "dily": _uniq(dily), "instance": inst, "telesa": [], "kabely": kab,
           "skupiny": [], "props": {"Konstrukce_Generator": GEN, "Konstrukce_Modul": "E2", "PLCdesk_Id": f"asm:{ident}"}}
    return {"modul": mod, "rozhrani": roz, "zpetna_vazba": fb}


def _sroub_zlabu(bod, zlab: Zlab, label: str) -> dict:
    """ISO 4762 M5 dnem žlabu do matice T v drážce líce (V4). Délku dá ``delka_do_drazky``; s dnem 1,6 mm žádná normalizovaná
    délka neprojde CELOU maticí → M5×12 (6,4 mm v matici ≥ potřeba) s poznámkou."""
    M, t = SROUB_ZLABU, zlab.z["dno"]
    dl = spojky_mech.delka_do_drazky_auto(M, t)
    zkr = False
    if not dl["ok"]:
        mt = spojky_mech.matice_t(M, "40/8")
        need = spojky_mech.potreba_matice(spojky_mech._d(M), mt["H"])
        dz = spojky_mech.drazka("40/8")
        cand = [l for l in spojky_mech.delky() if l - t - dz["ret"] >= need and l <= t + dz["hloubka"] - 0.5]
        dl = {"ok": bool(cand), "l": max(cand) if cand else None, "podlozka": False,
              "text": f"ISO 4762 {M}x{max(cand) if cand else '?'}: v matici {max(cand) - t - dz['ret'] if cand else 0:.1f} ≥ {need:.1f} mm (ne celou výškou matice)"}
        zkr = True
    sp_s, sp_n = spojky_mech.spec_sroub(M, dl["l"]), spojky_mech.spec_matice_t(M, "40/8")
    n = zlab.n
    R = cols(zlab.e, cross(n, zlab.e), n)
    hw = spojky_mech.NORM["ISO7089"]["rady"][M]["h"] if dl["podlozka"] else 0.0
    inst = [{"model": sp_s["key"], "pos": r3(add(bod, n, t + hw)), "rot": [r3(r) for r in R], "druh": "sroub", "props": {"Konstrukce_Spoj": label}},
            {"model": sp_n["key"], "pos": r3(add(bod, n, -spojky_mech.drazka("40/8")["ret"])), "rot": [r3(r) for r in R], "druh": "matice", "props": {}}]
    dily = [sp_s, sp_n]
    if dl["podlozka"]:
        sp_w = spojky_mech.spec_podlozka(M)
        dily.append(sp_w)
        inst.append({"model": sp_w["key"], "pos": r3(add(bod, n, t)), "rot": [r3(r) for r in R], "druh": "podlozka", "props": {}})
    return {"dily": dily, "inst": inst, "sroub": {"spoj": label, "sroub": f"ISO 4762 {M}x{dl['l']}", "text": dl["text"], "zkraceno": zkr}}


def _uniq(dily):
    seen, out = set(), []
    for s in dily:
        if s["key"] not in seen:
            seen.add(s["key"])
            out.append(s)
    return out


# --- napojení do celku E3 ------------------------------------------------------------------------------------------------------
def celek_e1_e2(n1_roz: dict, starts: list, obst: list, layout_path, *, strana: str = "zadni", xc: float | None = None,
                plates=None, medium: str = "ifm_EVC002") -> dict:
    """E1 + E2 pro ``celek.plan_celku`` (místo „nepostaveno“ E1 / E2): ``n1_roz`` = smlouva N1 celku, ``starts`` = začátky
    kabelů jako v ``celek.cables_estimate`` [(id, partId, od, bod, D[, smer])], ``obst`` = překážky celku, ``plates`` =
    pracovní deska (průchod = požadavek na N1). Žlab na vnitřním líci podélníku na straně rozvaděče (nejdelší volný úsek).
    Vrací {moduly: [E1, E2], smlouvy: {E1, E2}, nepostaveno, zpetna_vazba, otvory_skrine, pozadavky_N1, boxes}."""
    from . import modul_stojan_rozvadece as e1m
    sk = e1m.nacti_skrin(layout_path)
    trm = modul_ostrov.trasa_mod()
    med = trm.nacti_media()
    def _sil(s):
        return any(w in str(s[2]).lower() for w in ("pohon", "motor"))
    def _med(s):
        return med["lapp_OLFLEX_CLASSIC_110" if _sil(s) else medium]
    R = max(float(trm.pozadovany_polomer(_med(s), "pevne", float(s[4] or _med(s)["D"]))["min"] or 43.0) for s in starts) if starts else 43.0
    e1 = e1m.konzola_n1(sk, n1_roz, strana=strana, xc=xc, R_kabel=R, r_kabel=max((float(s_[4] or 4.3) for s_ in starts), default=4.3) / 2)
    n_in = [0, -1, 0] if strana == "zadni" else [0, 1, 0]
    cand = [p for p in n1_roz.get("plochy") or [] if p.get("role") == "podelnik" and [round(v) for v in p["normala"]] == n_in]
    cand.sort(key=lambda p: p["osa_od"][1] * n_in[1])              # vnitřní líc podélníku u rozvaděče (ne vnější líc protější strany)
    out = {"moduly": [e1["modul"]], "smlouvy": {"E1": e1["rozhrani"]}, "nepostaveno": [], "zpetna_vazba": [], "otvory_skrine": e1["otvory_skrine"],
           "pozadavky_N1": list(e1["rozhrani"].get("pozadavky_N1") or []), "boxes": e1["boxes"]}
    if not cand or not starts:
        out["nepostaveno"].append({"id": "E2", "co": "kabelové vedení", "duvod": "rám N1 nemá vnitřní líc podélníku na straně rozvaděče" if not cand
                                   else "žádné kabely"})
        return out
    p = cand[0]
    u0, u1 = max(((a, b) for a, b in p.get("volne_useky_mm") or []), key=lambda ab: ab[1] - ab[0])
    zl = Zlab(p, u0 + 10.0, u1 - 10.0, nazev=f"E2 žlab na {p['prvek']}")
    kab = [{"id": s[0], "partId": s[1], "od": s[2], "start": list(s[3]), "D": s[4], "smer": list(s[5]) if len(s) > 5 and s[5] else [0, 0, 1], "smer_odhad": not (len(s) > 5 and s[5]),
            "medium": "lapp_OLFLEX_CLASSIC_110" if _sil(s) else medium, "skupina": "silovy" if _sil(s) else "signal"} for s in starts]
    try:
        e2 = modul(kab, zl, e1["rozhrani"], obst + e1["boxes"], plates=plates)
        e2s = [("E2", e2)]
    except ValueError as exc:
        e2s = _dva_zlaby(exc, kab, p, u0, u1, zl, e1, obst, plates)          # nevejde se do jednoho žlabu → druhý žlab (kap. 4 návrhu)
        if not e2s:
            raise
    for ident, e2 in e2s:
        out["moduly"].append(e2["modul"])
        out["smlouvy"][ident] = e2["rozhrani"]
        out["nepostaveno"] += [{"id": ident, "co": n["co"], "duvod": n["duvod"]} for n in e2["rozhrani"]["nepostaveno"]]
        out["zpetna_vazba"] += e2["zpetna_vazba"]
        out["pozadavky_N1"] += [x for x in e2["rozhrani"]["pozadavky_na_ram"] if x.get("kind") == "pruchod"]
    return out


def _dva_zlaby(exc, kab, p, u0, u1, zl, e1, obst, plates):
    """Kabely se nevejdou do jednoho žlabu: rozdělit na dvě skupiny (silové × signálové, jinak podle průměru napůl) a druhou
    vést druhým žlabem na dalším volném úseku téhož líce profilu (``E3``). Nelze-li, vrací [] (volající zvedne původní chybu)."""
    if "nevejde" not in str(exc) or len(kab) < 2:
        return []
    sil = [k for k in kab if k["skupina"] == "silovy"]
    sig = [k for k in kab if k["skupina"] != "silovy"]
    if not sil or not sig:
        srt = sorted(kab, key=lambda k: -float(k["D"] or 0))
        sil, sig = srt[0::2], srt[1::2]
    L2 = sorted(((a, b) for a, b in p.get("volne_useky_mm") or [] if (a, b) != (u0, u1) and b - a >= 400.0), key=lambda ab: ab[0] - ab[1])
    if not L2 and (u1 - u0) >= 2 * 500.0:                        # jediný dlouhý úsek: žlaby za sebou, každý polovinu
        mid = (u0 + u1) / 2
        zl_a = Zlab(p, u0 + 10.0, mid - 10.0, nazev=f"E2 žlab na {p['prvek']}")
        zl_b = Zlab(p, mid + 10.0, u1 - 10.0, nazev=f"E3 žlab na {p['prvek']}")
    elif L2:
        zl_a = zl
        zl_b = Zlab(p, L2[0][0] + 10.0, L2[0][1] - 10.0, nazev=f"E3 žlab na {p['prvek']}")
    else:
        return []
    try:
        ea = modul(sil, zl_a, e1["rozhrani"], obst + e1["boxes"], plates=plates)
        eb = modul(sig, zl_b, e1["rozhrani"], obst + e1["boxes"] + [zl_a.box()], ident="E3", nazev="E3 — druhý kabelový žlab", plates=plates)
    except ValueError:
        return []
    return [("E2", ea), ("E3", eb)]


# --- zkušební sestava N1 + E1 + S1 + P1 + E2 --------------------------------------------------------------------------------
RZ180 = [[-1, 0, 0], [0, -1, 0], [0, 0, 1]]


def _tbox(pl, b):
    pts = [_mv(pl["rot"], [x, y, z]) for x in (b[0], b[3]) for y in (b[1], b[4]) for z in (b[2], b[5])]
    return [round(min(p[k] for p in pts) + pl["pos"][k], 2) for k in range(3)] + [round(max(p[k] for p in pts) + pl["pos"][k], 2) for k in range(3)]


def _mod_boxes(m, extra_bb=None):
    """Obálky modulu (tělesa mimo zóny + ``extra_bb`` v místních souřadnicích) globálně — překážky routeru."""
    from .celek import _body_box
    pl = m.get("placement") or {"pos": [0, 0, 0], "rot": I3}
    out = []
    for t in m.get("telesa") or []:
        if (t.get("props") or {}).get("Konstrukce_Typ") in ("zona", "pomocny"):
            continue
        b = _body_box(t["body"])
        if b:
            out.append(_tbox(pl, b))
    for b in extra_bb or []:
        out.append(_tbox(pl, b))
    return out


def _cable_pts(c, pl):
    pts = [q for sg in c["path"] for q in (sg.get("line") or [sg["arc"][0], sg["arc"][2]])]
    return [[_mv(pl["rot"], p)[i] + pl["pos"][i] for i in range(3)] for p in pts]


def zkusebni_sestava(layout_path, fcstd=None) -> dict:
    """Malý stůl N1 800 × 600 × 800 (bez desky) + rozvaděč na konzole E1 (zadní strana) + P1 Ø32 × 100 a S1 IFS204 na předním
    podélníku + E2: žlab na vnitřním líci předního podélníku, 3 kabely do vývodek ve dně skříně, úchytky na příčce C0."""
    from . import modul_snimac, modul_valec
    from . import modul_stojan_rozvadece as e1m
    rt = _router()
    r = modul_ram.Ram(D=800, W=600, H=800, deska=False, podpory="patky", zatizeni_kg=20.0, ident="N1",
                      nazev="N1 rám 800 × 600 × 800 (zkušební sestava E1 + E2)").build()
    n1_mod, n1_roz = r.plan()["moduly"][0], r.rozhrani()
    sk = e1m.nacti_skrin(layout_path, fcstd)
    trm = modul_ostrov.trasa_mod()
    R = float(trm.pozadovany_polomer(trm.nacti_media()["ifm_EVC002"], "pevne", 4.3)["min"])
    e1 = e1m.konzola_n1(sk, n1_roz, strana="zadni", R_kabel=R, r_kabel=2.15)
    # P1 a S1 na horní drážce předního podélníku (y 20, z 800)
    p1 = modul_valec.lavice_p1()["moduly"][0]
    T1 = [170.0, 20.0, 760.0]
    lav = {"pos": T1, "rot": I3}
    plp = p1.get("placement") or {"pos": [0, 0, 0], "rot": I3}
    p1["placement"] = {"pos": r3(add(T1, plp["pos"])), "rot": plp["rot"]}
    s1 = modul_snimac.modul("IFS204", (50.0, 45.0, 72.0), nazev="S1 indukční M12 IFS204")
    s1["placement"] = {"pos": [680.0, 20.0, 760.0], "rot": RZ180}
    kabely = []
    for e in p1["rozhrani"]["elektro"]:
        kabely.append({"id": "W-" + e["signal"].replace(" ", "").lstrip("-"), "od": f"snímač {e['signal']} (SMT-8M, konektor M8)",
                       "start": add(T1, e["zacatek"]), "smer": e["smer"], "medium": "ifm_EVC002", "skupina": "signal", "partId": None})
    a, b = [[float(v) for v in q] for q in s1["kabely"][0]["path"][-1]["line"]]
    d = _unit([b[i] - a[i] for i in range(3)])
    kabely.append({"id": "W-S1", "od": "snímač S1 IFS204 (M12)", "start": [s1["placement"]["pos"][i] + _mv(RZ180, b)[i] for i in range(3)],
                   "smer": _mv(RZ180, d), "medium": "ifm_EVC002", "skupina": "signal", "partId": None})
    plocha = next(p for p in n1_roz["plochy"] if p["prvek"] == "podélník přední" and [round(v) for v in p["normala"]] == [0, 1, 0])
    zl = Zlab(plocha, 90.0, 710.0, nazev="E2 žlab HTWD-HF 40×40 na vnitřním líci předního podélníku")
    obst = [m["box"] for m in r.members] + [bx for _n, bx in r.boxes_extra] + e1["boxes"]
    obst.append(_tbox(lav, p1["rozhrani"]["obalka_vysunuto"]))
    obst += _mod_boxes(s1, [[30, -60, 30, 70, 60, 92]])
    for m in (p1, s1):
        for c in m["kabely"]:
            obst += rt.segments_boxes(_cable_pts(c, m["placement"]), c["r"] + 1.0)
    e2 = modul(kabely, zl, e1["rozhrani"], obst, ident="E2", nazev="E2 — kabely S1 / P1 → rozvaděč (žlab + úchytky)")
    mods = [n1_mod, e1["modul"], p1, s1, e2["modul"]]
    plan = {"format": "pro3d-lib-plan", "verze": 1, "generator": GEN, "model": "Lavice_E12",
            "nazev": "Zkušební sestava E1 + E2: rám N1, rozvaděč na konzole, P1 + S1, kabely ve žlabu", "dily": _uniq([s for m in mods for s in m["dily"]]),
            "moduly": mods, "snimky_prefix": "e12", "snimky": ["iso", "iso2", "celo", "shora", "bok"]}
    return {"plan": plan, "E1": e1, "E2": e2, "N1": n1_roz, "P1": p1["rozhrani"], "sk": sk}


def write_outputs(res: dict, folder) -> list:
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    fbk = {"format": "plcdesk-cad-feedback", "version": 1, "tool": GEN, "issues": res["E2"]["zpetna_vazba"]}
    out = []
    for nm, obj in ((f"E1_{res['E1']['rozhrani']['id']}.json", res["E1"]["rozhrani"]), (f"E2_{res['E2']['rozhrani']['id']}.json", res["E2"]["rozhrani"]),
                    ("N1_N1.json", res["N1"]), ("PLCdesk_CAD_feedback_e12.json", fbk)):
        p = folder / nm
        p.write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")
        out.append(str(p))
    return out


def report_md(res: dict, fc=None) -> str:
    e1, e2 = res["E1"]["rozhrani"], res["E2"]["rozhrani"]
    L = [f"# E1 + E2 — {e1['nazev']}", "", f"Skříň {e1['skrin']['tag']} {e1['skrin']['typ']} — box {e1['poloha_skrine']['box']}", "",
         "| výška | z mm | požadavek | ok | zdroj |", "|---|---|---|---|---|"]
    L += [f"| {v['co']} | {v['z_mm']} | {v['pozadavek']} | {'ano' if v['ok'] else 'NE'} | {v['zdroj']} |" for v in e1["vysky"]]
    L += ["", "| kabel | od | do | Ø | R | délka | s rezervou | katalog m |", "|---|---|---|---|---|---|---|---|"]
    L += [f"| {t['id']} | {t['od']} | {t['do']} | {t['D']} | {t['R']} | {t['delka_mm']:.0f} | {t['delka_s_rezervou_mm']:.0f} | {t['delka_katalog_m']} |"
          for t in e2["trasy"]]
    z = e2["zlaby"][0]
    L += ["", f"Žlab {z['brand']} {z['kod']} {z['delka_mm']:g} mm na {z['na']}, plnění {z['plneni']}, vylomení prstů {z['vylomeni_prstu']}; "
              f"úchytek {e2['uchytky']['kusu']} ({e2['uchytky']['kod']})", "", "## Nepostaveno", ""]
    L += [f"- {n['co']}: {n['duvod']}" for n in e2["nepostaveno"]] or ["- nic"]
    L += ["", "## Varování", ""] + ([f"- {v}" for v in e1["varovani"] + e2["varovani"]] or ["- žádná"])
    L += ["", "## ODHADY", ""] + [f"- {o}" for o in sorted(set(e1["odhady"]) | set(e2["odhady"]))]
    if fc:
        L += ["", "## Kontroly", "", "```", json.dumps(fc.get("souhrn"), ensure_ascii=False, indent=1)[:3000], "```"]
    return "\n".join(L) + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Modul E2 — kabelové vedení; zkušební sestava N1 + E1 + S1 + P1 + E2")
    ap.add_argument("--lavice", required=True, help="složka stroje s rozvadec/layout.json (+ Rozvadec.FCStd)")
    ap.add_argument("--fc", action="store_true", help="postavit ve FreeCADu a spustit kontroly")
    ap.add_argument("--slot", default="pro-e12")
    ap.add_argument("--bez-upravy-skrine", action="store_true", help="nevyřezávat otvory upevnění do Rozvadec.FCStd")
    a = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
    base = Path(a.lavice).resolve()
    lay = base / "rozvadec" / "layout.json"
    res = zkusebni_sestava(lay)
    out = base / "e12"
    files = write_outputs(res, out)
    summ = {"ok": True, "smlouvy": files, "kabely": len(res["E2"]["rozhrani"]["trasy"]), "nepostaveno": res["E2"]["rozhrani"]["nepostaveno"],
            "varovani": res["E1"]["rozhrani"]["varovani"] + res["E2"]["rozhrani"]["varovani"], "chyby": res["E1"]["rozhrani"]["chyby"]}
    fc = None
    if a.fc:
        from . import bench
        from . import modul_stojan_rozvadece as e1m
        if not a.bez_upravy_skrine:
            u = e1m.upravit_skrin(lay, res["E1"]["otvory_skrine"], slot=a.slot)
            summ["skrin_otvory"] = bool(u.get("ok"))
        fc = bench.build_and_check(res["plan"], out, slot=a.slot)
        summ.update(fc=fc.get("souhrn"), ok=bool(fc.get("ok")))
    (out / "E12.md").write_text(report_md(res, fc), encoding="utf-8")
    print(json.dumps(summ, ensure_ascii=False))
    return 0 if summ["ok"] and not summ["chyby"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
