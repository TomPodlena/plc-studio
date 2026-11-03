"""Dveře rozvaděče, kabeláž ke dveřím, oddělení silových a signálových tras, PE / N přípojnice a filtrační ventilátor
(čistý Python, bez FreeCADu a bez importu z ``plc_studio``; volá ho ``layout.plan`` po zrcadlení, souřadnice jako layout:
X šířka zleva při pohledu zepředu, Y hloubka k dveřím, Z výška; panty na straně x = W).

``apply(lay)`` doplní do ``layout``:

* ``oddeleni`` — druh každého žlabu (silový / signálový / smíšený) podle sousedních pásů, svislý žlab u pantů jen
  silový v rozsahu silových žlabů (pod ním vodorovné signálové žlaby končí otevřeně u boku), smíšené žlaby s podélnou
  uzemněnou přepážkou a čelními přepážkami komor, tabulka vzdáleností silová × signálová trasa ≥ ``min_mm`` nebo
  přepážka mezi nimi (``data/dvere.json`` oddeleni, zdroj G120C OI přes skill rozvadec-3d);
* ``bilance.ventilator`` — když přirozené chlazení nevyhovuje: filtrační ventilátor Rittal 24 V DC s výstupním filtrem
  (průtok s filtrem, příkon do Qv), rezerva vnitřní teploty ≥ ``rezerva_K`` jinak varování;
* ``door`` — přístroje na dveřích znovu rozmístěné (silové nahoře u pantů, signálové pod stropem oddělení), vrtací
  obrazce / výřezy / upínky z ``data/dvere.json`` (3LD2 4 × Ø5 na 48 × 48, MTP700 výřez 197 × 141 a 6 upínek);
* ``kabelaz_dvere`` — svazky ke dveřím po druzích: větve po vnitřní straně dveří (hledání cesty kolem přístrojů),
  kmen v ose pantu, volný úsek (svislý oblouk u pantu — otevření ho kroutí), pevný úsek po boku skříně do žlabu;
  poloměry z dat skillu kabelaz-a-hadice (``data/media.json``, výpočet zaoblení podle ``trasa.py``), délka volného
  úseku ≥ (1 + rezerva) × nejkratší dráha konců v celém rozsahu 0–95°;
* ``pripojnice`` — PE na desce vodivě (šrouby do závitu desky), N na izolátorech (šroub jen do izolátoru).
"""

from __future__ import annotations

import heapq
import json
import math
import os
from functools import lru_cache
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
SKILL_MEDIA = Path(os.environ.get("PRO3D_KABELAZ_MEDIA") or
                   Path.home() / ".claude" / "skills" / "kabelaz-a-hadice" / "data" / "media.json")
EPS = 1e-6


@lru_cache(maxsize=None)
def data() -> dict:
    return json.loads((DATA / "dvere.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=None)
def radius_rule() -> dict:
    """Násobky D pro pevné a pohyblivé uložení = nejpřísnější kabel z dat skillu kabelaz-a-hadice (media.json);
    bez skillu záloha z data/dvere.json (polomer)."""
    fb = data()["polomer"]
    try:
        med = json.loads(SKILL_MEDIA.read_text(encoding="utf-8"))["media"]
    except (OSError, ValueError, KeyError):
        return {"pevne": float(fb["pevne_x"]), "pohyblive": float(fb["pohyblive_x"]), "zdroj": fb["zdroj"] + " (záloha — skill nenalezen)"}
    out = {}
    who = {}
    for ul in ("pevne", "pohyblive"):
        best = None
        for k, m in med.items():
            if m.get("typ") != "kabel" or not isinstance(m.get(ul), dict) or "x" not in m[ul]:
                continue
            if best is None or float(m[ul]["x"]) > best:
                best, who[ul] = float(m[ul]["x"]), k
        out[ul] = best if best is not None else float(fb[ul + "_x"])
    out["zdroj"] = (f"{SKILL_MEDIA} — nejpřísnější kabel: pevně {out['pevne']:g}×D ({who.get('pevne')}), "
                    f"pohyblivě {out['pohyblive']:g}×D ({who.get('pohyblive')})")
    return out


# --- geometrie: zaoblení lomené čáry s poloměrem v každém vrcholu ------------------------------------------------------
# Stejný výpočet jako kabelaz-a-hadice/scripts/trasa.py ``zaobli`` (tečná délka t = R·tan(φ/2), oblouk R·φ, úsek musí
# pojmout tečné délky obou rohů), jen s vlastním R v každém vrcholu (pevné × pohyblivé úseky jednoho svazku).

def _sub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def _add(a, b): return (a[0] + b[0], a[1] + b[1], a[2] + b[2])
def _mul(a, k): return (a[0] * k, a[1] * k, a[2] * k)
def _dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def _len(a): return math.sqrt(_dot(a, a))


def _norm(a):
    n = _len(a)
    return (a[0] / n, a[1] / n, a[2] / n)


def round_path(points, radii) -> dict:
    """Body + poloměr ve vnitřních vrcholech → {prvky[('usek', a, b) | ('oblouk', S, M, E, C, R, uhel)], delka, chyby,
    tecny[i] = (S, E) tečné body vrcholu i}."""
    P = [tuple(float(v) for v in p) for p in points]
    n = len(P)
    chyby, prvky, tecny = [], [], {}
    tl = [0.0] * n
    geo = {}
    for j in range(1, n - 1):
        u, v = _norm(_sub(P[j], P[j - 1])), _norm(_sub(P[j + 1], P[j]))
        phi = math.acos(max(-1.0, min(1.0, _dot(u, v))))
        if phi < 1e-9:
            continue
        R = float(radii[j])
        tl[j] = R * math.tan(phi / 2)
        geo[j] = (u, v, phi, R)
    for j in range(n - 1):
        L = _len(_sub(P[j + 1], P[j]))
        if tl[j] + tl[j + 1] > L + 1e-6:
            chyby.append(f"úsek {j}: {L:.1f} mm < tečné délky {tl[j]:.1f} + {tl[j + 1]:.1f} mm (poloměr se nevejde)")
    cur, delka = P[0], 0.0
    for j in range(1, n - 1):
        if j not in geo:
            continue
        u, v, phi, R = geo[j]
        S, E = _sub(P[j], _mul(u, tl[j])), _add(P[j], _mul(v, tl[j]))
        C = _add(P[j], _mul(_norm(_sub(v, u)), R / math.cos(phi / 2)))
        M = _add(C, _mul(_norm(_sub(P[j], C)), R))
        if _len(_sub(S, cur)) > 1e-6:
            prvky.append(("usek", cur, S))
            delka += _len(_sub(S, cur))
        prvky.append(("oblouk", S, M, E, C, R, math.degrees(phi)))
        delka += R * phi
        tecny[j] = (S, E)
        cur = E
    if _len(_sub(P[-1], cur)) > 1e-6:
        prvky.append(("usek", cur, P[-1]))
        delka += _len(_sub(P[-1], cur))
    return {"prvky": prvky, "delka": delka, "chyby": chyby, "tecny": tecny}


def sample(prvky, n=8) -> list:
    pts = []
    for e in prvky:
        if e[0] == "usek":
            if not pts:
                pts.append(e[1])
            a, b = e[1], e[2]
            k = max(1, int(_len(_sub(b, a)) // 20))
            pts += [_add(a, _mul(_sub(b, a), i / k)) for i in range(1, k + 1)]
        else:
            S, E, C, R = e[1], e[3], e[4], e[5]
            a = _norm(_sub(S, C))
            b = _sub(E, C)
            w = _norm(_sub(b, _mul(a, _dot(b, a))))
            phi = math.radians(e[6])
            if not pts:
                pts.append(S)
            pts += [_add(C, _add(_mul(a, R * math.cos(phi * k / n)), _mul(w, R * math.sin(phi * k / n)))) for k in range(1, n + 1)]
    return pts


def _jsonable(prvky):
    return [[e[0]] + [list(map(lambda v: round(v, 4), x)) if isinstance(x, tuple) else (round(x, 4) if isinstance(x, float) else x)
                      for x in e[1:]] for e in prvky]


def _box_dist(p, b) -> float:
    d = [max(b[2 * k] - p[k], 0.0, p[k] - b[2 * k + 1]) for k in range(3)]
    return math.sqrt(sum(x * x for x in d))


def _overlap(a, b, eps=1e-6) -> bool:
    return all(a[2 * k] < b[2 * k + 1] - eps and b[2 * k] < a[2 * k + 1] - eps for k in range(3))


def _rot(p, ax, ay, deg):
    a = math.radians(deg)
    x, y = p[0] - ax, p[1] - ay
    return (ax + x * math.cos(a) - y * math.sin(a), ay + x * math.sin(a) + y * math.cos(a))


# --- žlaby: druh, úprava, přepážky ------------------------------------------------------------------------------------

def _kind_family(fam: str) -> str:
    return "silovy" if fam in ("sil", "poh") else "signal"


def classify_ducts(lay: dict) -> dict:
    """Druh vodorovných žlabů podle sousedních pásů, svislý u pantů (x největší) = silový jen v rozsahu silových
    žlabů, druhý svislý = smíšený; vodorovné signálové žlaby pod silovým rozsahem se u pantů prodlouží k boku desky."""
    G, pl = lay["geom"], lay["plate"]
    bands: dict = {}
    for r in lay["rails"]:
        bands.setdefault(r["pas"], set()).add(_kind_family(r["family"]))
    bz = {r["pas"]: (r["zc"] - r["dn"], r["zc"] + r["up"]) for r in lay["rails"]}
    hs = sorted([d for d in lay["ducts"] if d["orient"] == "h"], key=lambda d: -d["z1"])
    vs = sorted([d for d in lay["ducts"] if d["orient"] == "v"], key=lambda d: d["x0"])
    for d in hs:
        kinds = set()
        for p, (z0, z1) in bz.items():
            if abs(d["z0"] - z1) < 1.0 or abs(d["z1"] - z0) < 1.0:
                kinds |= bands[p]
        d["druh"] = "smiseny" if len(kinds) > 1 else (next(iter(kinds)) if kinds else "signal")
        d["komory"] = None
        if d["druh"] == "smiseny":
            up = next((bands[p] for p, (z0, z1) in bz.items() if abs(d["z1"] - z0) < 1.0), {"silovy"})
            d["komory"] = {"horni": next(iter(up)) if len(up) == 1 else "silovy"}
            d["komory"]["dolni"] = "signal" if d["komory"]["horni"] == "silovy" else "silovy"
    power = [d for d in hs if d["druh"] in ("silovy", "smiseny")]
    vh, vo = (vs[-1], vs[0]) if len(vs) == 2 else (None, vs[0] if vs else None)
    notes = []
    if vo is not None:
        vo["druh"] = "smiseny"
        vo["komory"] = {"vnejsi": "silovy", "vnitrni": "signal"}
    if vh is not None:
        if power:
            vh["druh"] = "silovy"
            dl = min(power, key=lambda d: d["z0"])
            if dl["druh"] == "smiseny" and dl["komory"]["horni"] == "silovy":
                # svislý silový žlab začíná v rovině podélné přepážky nejnižšího smíšeného žlabu (souvislé stínění)
                tw_ = float(data()["oddeleni"]["prepazka"]["t"])
                vh["z0"] = round((dl["z0"] + dl["z1"]) / 2 + 6.0 + tw_ / 2, 3)
            else:
                vh["z0"] = round(dl["z0"], 3)
            vh["z1"] = round(max(d["z1"] for d in power), 3)
            for d in hs:
                if d["z1"] <= vh["z0"] + 1e-6:
                    d["x1"] = round(vh["x1"], 3)
                    d["prodlouzen"] = True
            notes.append(f"{vh['name']} (u pantů) jen silový, z {vh['z0']:.0f}–{vh['z1']:.0f}; signálové žlaby pod ním končí "
                         "otevřeně u boku desky (vstup svazku ke dveřím)")
        else:
            vh["druh"] = "signal"
        vh["komory"] = None
    G2 = data()["oddeleni"]["prepazka"]
    tw, dh = float(G["zlab_t"]), float(G["zlab_h"])
    y0, y1 = pl["y1"] + tw, pl["y1"] + dh - 1.0
    parts, ends = [], []
    for d in [x for x in hs + vs if x.get("druh") == "smiseny"]:
        parts.append(_partition(d, y0, y1, float(G2["t"]), G2))
    # čelní přepážky: komora smíšeného vodorovného žlabu, která končí u svislého žlabu jiného druhu
    for d in hs:
        if d.get("druh") != "smiseny" or vh is None or vh.get("druh") != "silovy":
            continue
        if not (vh["z0"] - 1e-6 <= d["z0"] and d["z1"] <= vh["z1"] + 1e-6) or abs(d["x1"] - vh["x0"]) > 1.0:
            continue
        pz = next(p for p in parts if p["zlab"] == d["name"])["rovina"]
        if d["komory"]["dolni"] != "silovy":
            ends.append({"name": f"Čelní přepážka {d['name']} — signálová komora u {vh['name']} (uzemněná, návrh)",
                         "box": [d["x1"] - 1.0, d["x1"], y0, y1, d["z0"] + tw, pz - 0.5], "osa": "x", "rovina": d["x1"] - 0.5})
        else:
            ends.append({"name": f"Čelní přepážka {d['name']} — signálová komora u {vh['name']} (uzemněná, návrh)",
                         "box": [d["x1"] - 1.0, d["x1"], y0, y1, pz + 0.5, d["z1"] - tw], "osa": "x", "rovina": d["x1"] - 0.5})
    if vh is not None and vh.get("druh") == "silovy":
        # boční přepážka na vnější stěně silového svislého žlabu: odděluje ho od sloupce svazků ke dveřím u boku skříně
        ends.append({"name": f"Boční přepážka {vh['name']} (k pantům, uzemněná, návrh)",
                     "box": [vh["x1"], vh["x1"] + 1.0, pl["y1"], pl["y1"] + dh, vh["z0"], vh["z1"]], "osa": "x",
                     "rovina": vh["x1"] + 0.5, "bocni": True, "vyrezy": []})
    if vh is not None and vh.get("druh") == "silovy" and vh["z0"] > min(d["z0"] for d in hs) + 1.0:
        ends.append({"name": f"Spodní přepážka {vh['name']} (silový žlab nad signálovou oblastí, uzemněná, návrh)",
                     "box": [vh["x0"] + tw, vh["x1"] - tw, y0, y1, vh["z0"], vh["z0"] + 1.0], "osa": "z", "rovina": vh["z0"] + 0.5})
    return {"ducts": [{"name": d["name"], "orient": d["orient"], "druh": d.get("druh"), "komory": d.get("komory"),
                       "prodlouzen": bool(d.get("prodlouzen"))} for d in hs + vs],
            "hinge_duct": vh["name"] if vh else None, "prepazky": parts, "celni": ends, "poznamky": notes}


def _partition(d: dict, y0: float, y1: float, t: float, spec: dict) -> dict:
    """Podélná přepážka smíšeného žlabu: stojina 6 mm od osy žlabu (mimo hlavy šroubů žlabu), patka na dně žlabu
    k ose (výřezy kolem hlav šroubů žlabu), šrouby M4 patkou a dnem žlabu do závitu desky mezi šrouby žlabu."""
    if d["orient"] == "h":
        m = (d["z0"] + d["z1"]) / 2
        web = [d["x0"], d["x1"], y0, y1, m + 6.0 - t / 2, m + 6.0 + t / 2]
        foot = [d["x0"], d["x1"], y0, y0 + 1.0, m - 2.0, m + 5.5]
        return {"zlab": d["name"], "orient": "h", "stojina": web, "patka": foot, "osa": "z", "rovina": m + 6.0, "skrz": m + 1.75,
                "name": f"Přepážka {d['name']} (uzemněná, návrh)", "material": spec["material"]}
    m = (d["x0"] + d["x1"]) / 2
    web = [m + 6.0 - t / 2, m + 6.0 + t / 2, y0, y1, d["z0"], d["z1"]]
    foot = [m - 2.0, m + 5.5, y0, y0 + 1.0, d["z0"], d["z1"]]
    return {"zlab": d["name"], "orient": "v", "stojina": web, "patka": foot, "osa": "x", "rovina": m + 6.0, "skrz": m + 1.75,
            "name": f"Přepážka {d['name']} (uzemněná, návrh)", "material": spec["material"]}


# --- ventilátor --------------------------------------------------------------------------------------------------------

def choose_fan(bil: dict) -> dict | None:
    """Filtrační ventilátor, když přirozené chlazení nevyhovuje (Qv > Qs). Q = Qv + příkon ventilátoru (celý uvnitř),
    V = f · Q / (ΔT − rezerva) → nejmenší typ s průtokem s výstupním filtrem ≥ V; jinak největší, který vyhoví bez
    rezervy (varování), jinak nevyhovuje. Odvod pláštěm se nezapočítává (konzervativně)."""
    if bil.get("verdikt") != "nevyhovuje":
        return None
    V = data()["ventilatory"]
    dT, f, qv = float(bil["dT"]), float(bil["f"]), float(bil["Qv"])
    out = {"rezerva_K_min": V["rezerva_K"], "rezerva_text": V["rezerva_text"], "psu_text": V["psu_text"],
           "hloubka_text": V["hloubka_text"], "f": f, "dT": dT, "Qv": qv, "varovani": []}
    if dT <= 0:
        out.update(verdikt="nevyhovuje", typ=None, duvod=f"okolí ≥ dovolená vnitřní teplota (ΔT {dT:.0f} K) — ventilátor nepomůže, "
                   "nutné chlazení (výměník / chladicí jednotka) — NÁVRH")
        return out
    typy = sorted(V["typy"], key=lambda t: t["V_filtr"])
    pick, ok_margin = None, False
    for t in typy:
        q = qv + t["P"]
        if f * q / t["V_filtr"] <= dT - V["rezerva_K"] + 1e-9:
            pick, ok_margin = t, True
            break
    if pick is None:
        for t in reversed(typy):
            if f * (qv + t["P"]) / t["V_filtr"] <= dT + 1e-9:
                pick = t
                break
    if pick is None:
        t = typy[-1]
        q = qv + t["P"]
        out.update(verdikt="nevyhovuje", typ=None, duvod=f"ani {t['kod']} ({t['V_filtr']:.0f} m³/h s filtrem) nestačí: potřeba "
                   f"{f * q / dT:.0f} m³/h — chladicí jednotka / výměník nebo větší ventilátor (nedoložen) — NÁVRH")
        return out
    q = qv + pick["P"]
    dTf = f * q / pick["V_filtr"]
    rez = dT - dTf
    out.update(verdikt="vyhovuje", typ=pick, filtr=dict(data()["ventilatory"]["filtry"][pick["vystup"]], kod=pick["vystup"]),
               Q=round(q, 2), V_potreba=round(f * q / dT, 1), V_potreba_rezerva=round(f * q / max(1e-9, dT - V["rezerva_K"]), 1),
               dT_s=round(dTf, 2), ti_s=round(float(bil["tamb"]) + dTf, 2), rezerva_K=round(rez, 2), rezerva_ok=ok_margin)
    if not ok_margin:
        out["varovani"].append(f"rezerva vnitřní teploty {rez:.1f} K < {V['rezerva_K']:.0f} K (ODHAD zdůvodnění: {V['rezerva_text']}) "
                               "— žádný doložený typ ji nesplní; zvážit chladicí jednotku / výměník")
    if bil.get("chybi"):
        out["varovani"].append("Qv je jen součet DOLOŽENÝCH ztrát — chybějící ztráty bilanci mohou zhoršit (nelze rozhodnout)")
    return out


# --- dveře: rozmístění ------------------------------------------------------------------------------------------------

def core_cat(cat: str) -> str:
    """Kategorie kusovníku jádra PLCdesk (bom.ts) — starší jména generátoru (push_button, emergency_stop) z dřívějších
    manifestů / dat převede na jména jádra (pushbutton, estop_button); ostatní beze změny."""
    return (data()["kategorie"].get("_aliasy") or {}).get(cat, cat)


def _door_kind(cat: str) -> str:
    k = data()["kategorie"].get(core_cat(cat), "signal")
    return k if isinstance(k, str) else "signal"


def _elements(cat: str) -> list:
    v = data()["vodice"]
    out = []
    for key, n in data()["obsazeni"].get(core_cat(cat)) or data()["obsazeni"]["pushbutton"]:
        out += [(key, float(v[key]["D"]))] * int(n)
    return out


def _bundle_D(els) -> float:
    s = data()["svazek"]
    if not els:
        return 0.0
    return math.sqrt(sum(d * d for _k, d in els) / float(s["plneni"])) + 2 * float(s["ochrana_t"])


class Door:
    """Kontext dveří po zrcadlení (panty x = W)."""

    def __init__(self, lay: dict):
        G = lay["geom"]
        c = lay["cabinet"]
        self.lay, self.G = lay, G
        self.W, self.H, self.D = float(c["w"]), float(c["h"]), float(c["d"])
        self.t, self.tdv = float(G["stena"]), float(G["dvere"])
        self.yd = self.D - self.tdv
        self.yb = self.D - self.tdv
        self.ax, self.ay = self.W + float(G["pant_r"]), self.D - self.tdv / 2
        sm = data()["smycka"]
        self.tc, self.cl, self.croz = float(sm["upinka_t"]), float(sm["upinka_l"]), float(sm["upinka_roztec"])
        pl = lay["plate"]
        self.py1 = pl["y1"]
        self.y_duct = pl["y1"] + float(G["zlab_h"]) / 2
        self.xmin = self.t + G["dvere_okraj"]
        self.xmax = self.W - self.t - G["dvere_okraj"] - G["dvere_pant_pas"]
        self.zmin, self.zmax = self.t + G["dvere_okraj"], self.H - self.t - G["dvere_okraj"]
        self.obst = [i["box"] for i in lay["devices"] if i["kind"] != "zarazka"]
        self.obst += [z["box"] for z in lay["zones"]]
        self.obst += [[d["x0"], d["x1"], d["y0"], d["y1"] + float(G["zlab_vika"]), d["z0"], d["z1"]] for d in lay["ducts"]]
        self.soft = [(r["name"], r["box"]) for r in lay["reserves"]]


def _item_spec(dev: dict | None, ctx: Door, cat: str = "", w=0.0, h=0.0, d_in=0.0, front=None, tag="") -> dict:
    """Obrys přístroje na dveřích: vnitřní obálka (za vnitřním lícem dveří), čelo vně, okolí podle návodu."""
    dd = data()["pristroje"]
    if dev is not None:
        lb = dev["lb"]
        w, h = lb[1] - lb[0], lb[5] - lb[4]
        dep = lb[3] - lb[2]
        hmi = bool(dev.get("hmi"))
        d_in = dep - ctx.tdv if hmi else dep
        spec = dd.get(dev["code"]) or {}
        cat, tag = dev["cat"], dev["tag"]
        front = None
        if spec.get("celo"):
            front = (float(spec["celo"]["w"]), float(spec["celo"]["h"]), float(spec["celo"]["d"]))
        ok = spec.get("okoli") or {}
        return {"dev": dev, "tag": tag, "cat": cat, "w": w, "h": h, "d_in": d_in, "hmi": hmi, "front": front, "spec": spec,
                "okoli": [float(ok.get(k, 0.0)) for k in ("vlevo", "vpravo", "dole", "nahore")], "druh": _door_kind(cat)}
    return {"dev": None, "tag": tag, "cat": cat, "w": w, "h": h, "d_in": d_in, "hmi": False, "front": front, "spec": {},
            "okoli": [0.0] * 4, "druh": _door_kind(cat)}


def _foot(it, x, z) -> list:
    """Půdorys na dveřích (x0, x1, z0, z1) — větší z vnitřní obálky a čela, s okolím podle návodu."""
    w, h = it["w"], it["h"]
    xc, zc = x + w / 2, z + h / 2
    fw, fh = (it["front"][0], it["front"][1]) if it["front"] else (w, h)
    ww, hh = max(w, fw), max(h, fh)
    o = it["okoli"]
    return [xc - ww / 2 - o[0], xc + ww / 2 + o[1], zc - hh / 2 - o[2], zc + hh / 2 + o[3]]


def _frange(a, b, s):
    if b < a:
        return []
    n = int(math.floor((b - a) / s + 1e-9))
    return [a + i * s for i in range(n + 1)] + ([b] if (b - a) % s > 1e-6 else [])


def place_items(ctx: Door, items: list, placed: list, zmax_top=None) -> list:
    """Rozmístí položky (in place: it['x'], it['z']). ``zmax_top`` = strop pro dolní hranu (signálové pod oddělením).
    Vrací chyby."""
    err = []
    m = ctx.G["dvere_mezera"]
    for it in items:
        w, h = it["w"], it["h"]
        fw = it["front"][0] if it["front"] else w
        fh = it["front"][1] if it["front"] else h
        ex, ez = max(0.0, (fw - w) / 2), max(0.0, (fh - h) / 2)
        xs = _frange(ctx.xmin + ex + it["okoli"][0], ctx.xmax - w - ex - it["okoli"][1], 5.0)
        zs = _frange(ctx.zmin + ez + it["okoli"][2], ctx.zmax - h - ez - it["okoli"][3], 5.0)
        if zmax_top is not None and it.get("strop", True):
            zs = [z for z in zs if z <= zmax_top]
        pref = it.get("pref", "top")
        if pref == "hmi":
            zc0 = ctx.zmin + (ctx.zmax - ctx.zmin) * ctx.G["hmi_vyska_pct"]
            key = lambda p: abs(p[1] + h / 2 - zc0) + abs(p[0] + w / 2 - ctx.W / 2)  # noqa: E731
        elif pref == "low":
            key = lambda p: (p[1], -(p[0] + w))  # noqa: E731
        elif pref == "top_far":
            key = lambda p: (-(p[1] + h), p[0])  # noqa: E731
        else:
            key = lambda p: (-(p[1] + h), -(p[0] + w))  # noqa: E731
        cand = sorted(((x, z) for x in xs for z in zs), key=key)
        found = None
        for allow_soft in (False, True):
            for x, z in cand:
                fp = _foot(it, x, z)
                if any(not (fp[1] + m <= q[0] or q[1] + m <= fp[0] or fp[3] + m <= q[2] or q[3] + m <= fp[2]) for q in placed):
                    continue
                inner = [x - m, x + w + m, ctx.yd - it["d_in"] - 2.0, ctx.yd + 0.01, z - m, z + h + m]
                if any(_overlap(inner, b) for b in ctx.obst):
                    continue
                hit = [n for n, b in ctx.soft if _overlap(inner, b)]
                if hit and not allow_soft:
                    continue
                found = (x, z, hit)
                break
            if found:
                break
        if not found:
            err.append(f"dveře: {it['tag']} ({w:.0f} × {h:.0f}, hloubka za dveřmi {it['d_in']:.0f} mm) nemá místo"
                       + (f" pod stropem oddělení z {zmax_top + h:.0f} mm" if zmax_top is not None else ""))
            continue
        it["x"], it["z"], it["soft"] = found
        placed.append(_foot(it, it["x"], it["z"]))
    return err


def _set_box(ctx: Door, it: dict):
    x, z, w, h = it["x"], it["z"], it["w"], it["h"]
    if it["dev"] is not None:
        if it["hmi"]:
            box = [x, x + w, ctx.D - (it["d_in"] + ctx.tdv), ctx.D, z, z + h]
        else:
            box = [x, x + w, ctx.yd - it["d_in"], ctx.yd, z, z + h]
        it["dev"]["box"] = [round(v, 3) for v in box]
    it["box_in"] = [x, x + w, ctx.yd - it["d_in"], ctx.yd, z, z + h]


# --- kabeláž ke dveřím ----------------------------------------------------------------------------------------------

def _grid_route(ctx: Door, start_box, z_rng, x_end, obst2d, rb, z_lo, z_hi, step=5.0, turn=150.0, R=0.0, straight=False):
    """Cesta větve po vnitřní straně dveří (rovina x–z): z boku přístroje (+X) do sloupce kmene x_end, konec
    v ⟨z_lo, z_hi⟩, poslední úsek ve směru +X. Dijkstra po mřížce, penalizace zatáček. Vrací body [(x, z)] nebo None."""
    x0 = start_box[1] + rb + 1.0 + (0.0 if straight else R)   # první úsek od přístroje ≥ R (zaoblení)
    if x0 > x_end:
        return None
    nx = int(math.floor((x_end - x0) / step)) + 1
    zmin_g, zmax_g = ctx.zmin - 5.0 + rb, ctx.zmax + 5.0 - rb
    zmin_g = max(zmin_g, ctx.t + rb + 2.0)
    zmax_g = min(zmax_g, ctx.H - ctx.t - rb - 2.0)
    if z_hi < zmax_g:
        zmax_g = z_hi + 0.0
    nz = int(math.floor((zmax_g - zmin_g) / step)) + 1
    if nz <= 0:
        return None

    def X(i): return x0 + i * step
    def Z(k): return zmin_g + k * step

    blocked = [[False] * nz for _ in range(nx)]
    for (a0, a1, b0, b1) in obst2d:
        i0 = max(0, int(math.floor((a0 - rb - 1.0 - x0) / step + 1e-9)) + 1)
        i1 = min(nx - 1, int(math.ceil((a1 + rb + 1.0 - x0) / step - 1e-9)) - 1)
        k0 = max(0, int(math.floor((b0 - rb - 1.0 - zmin_g) / step + 1e-9)) + 1)
        k1 = min(nz - 1, int(math.ceil((b1 + rb + 1.0 - zmin_g) / step - 1e-9)) - 1)
        for i in range(i0, i1 + 1):
            row = blocked[i]
            for k in range(k0, k1 + 1):
                row[k] = True
    dirs = ((1, 0), (0, 1), (0, -1), (-1, 0))
    pq, best, prev = [], {}, {}
    def free_lead(z):
        for (a0, a1, b0, b1) in obst2d:
            if a0 - rb - 1.0 < x0 and a1 + rb + 1.0 > start_box[1] + rb + 1.0 and b0 - rb - 1.0 < z < b1 + rb + 1.0:
                return False
        return True

    for k in range(nz):
        z = Z(k)
        if z_rng[0] + rb + 1.0 <= z <= z_rng[1] - rb - 1.0 and not blocked[0][k] and free_lead(z):
            st = (0, k, 0)
            best[st] = X(0) - start_box[1]
            heapq.heappush(pq, (best[st], st))
    goal = None
    while pq:
        c, st = heapq.heappop(pq)
        if c > best.get(st, 1e18) + 1e-9:
            continue
        i, k, dd = st
        if i == nx - 1 and dd == 0 and z_lo <= Z(k) <= z_hi:
            goal = st
            break
        for nd, (di, dk) in enumerate(dirs):
            ii, kk = i + di, k + dk
            if not (0 <= ii < nx and 0 <= kk < nz) or blocked[ii][kk]:
                continue
            if dk != 0 and (straight or X(ii) > x_end - R - 1.0):   # svislý úsek nejméně R před kmenem
                continue
            if ii == nx - 1 and nd != 0:
                continue
            nc = c + step + (turn if nd != dd else 0.0)
            if ii == nx - 1:
                nc += 1.5 * (z_hi - Z(kk))
            ns = (ii, kk, nd)
            if nc < best.get(ns, 1e18) - 1e-9:
                best[ns] = nc
                prev[ns] = st
                heapq.heappush(pq, (nc, ns))
    if goal is None:
        return None
    path = [goal]
    while path[-1] in prev:
        path.append(prev[path[-1]])
    path.reverse()
    pts = [(start_box[1], Z(path[0][1]))] + [(X(i), Z(k)) for i, k, _d in path]
    pts[-1] = (x_end, pts[-1][1])
    out = [pts[0]]
    for p in pts[1:]:
        if len(out) >= 2:
            a, b = out[-2], out[-1]
            if (abs(a[0] - b[0]) < 1e-9 and abs(b[0] - p[0]) < 1e-9) or (abs(a[1] - b[1]) < 1e-9 and abs(b[1] - p[1]) < 1e-9):
                out[-1] = p
                continue
        if abs(p[0] - out[-1][0]) > 1e-9 or abs(p[1] - out[-1][1]) > 1e-9:
            out.append(p)
    return out


def _need_len(ctx: Door, pd, pc, dz) -> tuple[float, float]:
    """Nejkratší dráha konců volného úseku (upínka dveří pd se otáčí s dveřmi, upínka boku pc pevná) v rozsahu 0–95°:
    vodorovně kolem čela bočnice (obálka rb), svisle dz (rozvinutí). Vrací (max délka, úhel)."""
    sm = data()["smycka"]
    best, ang = 0.0, 0.0
    cx, cy = ctx.W - ctx.t - pd[2], ctx.yb + pd[2]
    for k in range(int(round(float(sm["uhel"]) / float(sm["uhly_krok"]))) + 1):
        th = k * float(sm["uhly_krok"])
        p = _rot(pd, ctx.ax, ctx.ay, -th)
        q = (pc[0], pc[1])
        hit = False
        for s in range(1, 50):
            u = s / 50.0
            x, y = p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u
            if x > cx and y < cy:
                hit = True
                break
        h = (math.hypot(p[0] - cx, p[1] - cy) + math.hypot(q[0] - cx, q[1] - cy)) if hit else math.hypot(p[0] - q[0], p[1] - q[1])
        L = math.hypot(h, dz)
        if L > best:
            best, ang = L, th
    return best, ang


def route_kind(ctx: Door, kind: str, devs: list, targets: list, ceiling=None, others=()) -> dict:
    """Svazek jednoho druhu: větve od přístrojů, kmen v ose pantu, volný úsek, pevný úsek do žlabu."""
    rr = radius_rule()
    sm = data()["smycka"]
    els = []
    for it in devs:
        it["els"] = _elements(it["cat"])
        els += it["els"]
    D = _bundle_D(els)
    rT = D / 2
    dmax = max(d for _k, d in els)
    R_f, R_m = rr["pevne"] * dmax, rr["pohyblive"] * dmax
    Xw = ctx.W - ctx.t - ctx.tc - rT
    yc = ctx.yd - ctx.tc - rT
    res = {"druh": kind, "D": round(D, 2), "prvky": _els_text(els), "R_pevne": round(R_f, 1), "R_pohyb": round(R_m, 1),
           "R_zdroj": rr["zdroj"], "chyby": [], "varovani": [], "tubes": [], "door_clamps": [], "cab_clamps": [],
           "pristroje": [it["tag"] for it in devs]}
    # větve
    z_hi = (ceiling - rT - 2 * 6.5 - 4.0) if ceiling is not None else (ctx.H - ctx.t - rT - 2.0)
    obst2d = [[b[0], b[1], b[4], b[5]] for b in others]
    for it in devs:
        b = it["box_in"]
        obst2d.append([b[0], b[1], b[4], b[5]])
        for c in it.get("clips", []):
            obst2d.append([c[0], c[1], c[4], c[5]])
    branches = []
    order = sorted(devs, key=lambda it: -it["box_in"][5])        # nejvyšší přístroj první (rovná větev nahoře)
    for it in order:
        rb = _bundle_D(it["els"]) / 2
        x_end = Xw - rT - rb - 0.05
        own = [it["box_in"][0], it["box_in"][1], it["box_in"][4], it["box_in"][5]]
        prev = [[min(p[0], q[0]), max(p[0], q[0]), min(p[1], q[1]) - br, max(p[1], q[1]) + br]
                for br, pts in branches for p, q in zip(pts, pts[1:])]
        obs = [o for o in obst2d if o != own] + prev + [own]
        pts = None
        for band in (60.0, 150.0, 1e9):
            z_lo = max(ctx.zmin, z_hi - band)
            Rb_ = rr["pevne"] * max(d for _k, d in it["els"])
            pts = _grid_route(ctx, it["box_in"], (it["box_in"][4], it["box_in"][5]), x_end, obs, rb, z_lo, z_hi, R=Rb_)
            if not pts:                                     # rovná větev (bez zatáček) — přístroj blízko kmene
                pts = _grid_route(ctx, it["box_in"], (it["box_in"][4], it["box_in"][5]), x_end, obs, rb, z_lo, z_hi, straight=True)
            if pts:
                break
        if not pts:
            res["chyby"].append(f"{it['tag']}: větev ke dveřnímu kmeni nenalezena (přístroje na dveřích v cestě"
                                + (f", strop oddělení z {ceiling:.0f}" if ceiling is not None else "") + ")")
            continue
        branches.append((rb, pts))
        it["branch"] = {"pts": pts, "rb": rb}
    if not branches:
        res["chyby"].append("žádná větev — svazek nevznikl")
        return res
    z_bmin = min(p[-1][1] for _rb, p in branches)
    z_bmax = max(p[-1][1] for _rb, p in branches)
    rbmax = max(rb for rb, _p in branches)
    # volný úsek + pevný úsek: hledání (cíl, z vstupu, tvar oblouku)
    best = None
    for tg in targets:
        zs = [tg["z"]] if tg.get("z") is not None else [z for z in _frange(tg["z0"], tg["z1"], 10.0)][::-1]
        for z_e in zs:
            if z_e + rT > z_bmin:
                continue
            sol = _solve_free(ctx, z_bmin - rbmax - 2.0 - ctx.cl, z_e, Xw, yc, rT, R_m, R_f, ctx.yd)
            if sol:
                best = (tg, z_e, sol)
                break
        if best:
            break
    if not best:
        res["chyby"].append(f"volný úsek u pantu se nevejde (R pohyblivě {R_m:.0f} mm, rezerva {sm['rezerva_pct']:.0f} %) "
                            f"mezi větvemi z {z_bmin:.0f} a žlabem — žádný cíl ({', '.join(t['name'] for t in targets) or 'žádný žlab'})")
        return res
    tg, z_e, sol = best
    z_top = z_bmax + rbmax + 2.0
    pts = [(Xw, yc, z_top), (Xw, yc, sol["z_pd"]), (Xw, yc - sol["s"], sol["z_pd"] - sol["a"]), (Xw, yc - sol["s"], sol["z_pc"] + sol["a"]),
           (Xw, yc, sol["z_pc"]), (Xw, yc, z_e), (Xw, ctx.y_duct, z_e), (tg["x_in"], ctx.y_duct, z_e)]
    radii = [0, R_m, R_m, R_m, R_m, R_f, R_f, 0]
    rp = round_path(pts, radii)
    res["chyby"] += [f"kmen: {c}" for c in rp["chyby"]]
    S_pd = rp["tecny"][1][0]
    E_pc = rp["tecny"][4][1]
    door_part, free_part, cab_part = _split(rp["prvky"], S_pd, E_pc)
    L_free = sum(_elen(e) for e in free_part)
    Lneed, ang = _need_len(ctx, (Xw, yc, rT), (Xw, yc), S_pd[2] - E_pc[2])
    req = Lneed * (1 + float(sm["rezerva_pct"]) / 100.0)
    res.update(cil=tg["name"], cil_typ=tg["typ"], z_vstup=round(z_e, 1), x_kmen=round(Xw, 2), y_kmen=round(yc, 2),
               z_upinka_dvere=round(S_pd[2], 1), z_upinka_bok=round(E_pc[2], 1),
               volny={"delka": round(L_free, 1), "potreba": round(Lneed, 1), "potreba_uhel": ang, "pozadavek": round(req, 1),
                      "pomer": round(L_free / Lneed, 3) if Lneed else None, "ok": L_free >= req - 1e-6, "R": round(R_m, 1),
                      "oblouk": {"a": round(sol["a"], 1), "s": round(sol["s"], 1)}},
               celkem=round(rp["delka"], 1))
    if not res["volny"]["ok"]:
        res["chyby"].append(f"volný úsek {L_free:.0f} mm < požadavek {req:.0f} mm")
    res["tubes"].append({"name": f"Svazek {kind} ke dveřím — kmen na dveřích", "part": "door", "r": rT, "prvky": door_part, "druh": kind,
                         "ulozeni": "pevne"})
    res["tubes"].append({"name": f"Svazek {kind} ke dveřím — volný úsek u pantu", "part": "fixed", "r": rT, "prvky": free_part,
                         "druh": kind, "ulozeni": "pohyblive"})
    res["tubes"].append({"name": f"Svazek {kind} ke dveřím — pevný úsek do {tg['name']}", "part": "fixed", "r": rT, "prvky": cab_part,
                         "druh": kind, "ulozeni": "pevne"})
    for it in devs:
        br = it.get("branch")
        if not br:
            continue
        yb = ctx.yd - ctx.tc - br["rb"]
        p3 = [(x, yb, z) for x, z in br["pts"]]
        Rb = rr["pevne"] * max(d for _k, d in it["els"])          # pevný poloměr podle prvků větve
        g = round_path(p3, [Rb] * len(p3))
        if g["chyby"]:
            mx = _max_radius(p3, Rb)
            res["chyby"].append(f"větev {it['tag']}: pevný poloměr {Rb:.0f} mm se nevejde (největší {mx:.0f} mm)")
            g = round_path(p3, [max(1.0, mx)] * len(p3))
        res["tubes"].append({"name": f"Svazek {kind} — větev {it['tag']}", "part": "door", "r": br["rb"], "prvky": g["prvky"],
                             "druh": kind, "ulozeni": "pevne", "pristroj": it["tag"]})
        res.setdefault("vetve", []).append({"tag": it["tag"], "D": round(2 * br["rb"], 2), "delka": round(g["delka"], 1), "R": round(Rb, 1),
                                            "prvky": _els_text(it["els"])})
        # upínka uprostřed nejdelšího úseku větve
        segs = [e for e in g["prvky"] if e[0] == "usek"]
        if segs:
            e = max(segs, key=_elen)
            if _elen(e) >= ctx.cl + 4:
                mid = _mul(_add(e[1], e[2]), 0.5)
                res["door_clamps"].append(_clamp_door(ctx, mid, _norm(_sub(e[2], e[1])), br["rb"], f"větev {it['tag']}"))
    # upínky kmene (dveře) a pevného úseku (bok)
    zc = S_pd[2] + ctx.cl / 2
    while zc <= z_top - ctx.cl / 2 - 1.0:
        res["door_clamps"].append(_clamp_door(ctx, (Xw, yc, zc), (0, 0, 1), rT, "kmen"))
        zc += ctx.croz
    zc = E_pc[2] - ctx.cl / 2
    zlim = z_e + R_f + ctx.cl / 2
    res["cab_clamps"].append(_clamp_side(ctx, (Xw, yc, zc), "z", rT, "pevný úsek"))
    zc -= ctx.croz
    while zc >= zlim:
        res["cab_clamps"].append(_clamp_side(ctx, (Xw, yc, zc), "z", rT, "pevný úsek"))
        zc -= ctx.croz
    yrun = (yc - R_f + ctx.y_duct + R_f) / 2
    if yc - ctx.y_duct - 2 * R_f >= ctx.cl + 2:
        res["cab_clamps"].append(_clamp_side(ctx, (Xw, yrun, z_e), "y", rT, "pevný úsek"))
    res["body"] = [list(p) for p in pts]
    res["clamps_kontrola"] = _clamp_conflicts(ctx, res, devs, others)
    return res


def _max_radius(p3, R):
    lo, hi = 0.0, R
    for _ in range(25):
        m = (lo + hi) / 2
        if round_path(p3, [m] * len(p3))["chyby"]:
            hi = m
        else:
            lo = m
    return lo


def _clamp_conflicts(ctx, res, devs, others):
    bad = []
    boxes = [it["box_in"] for it in devs] + list(others)
    for c in res["door_clamps"]:
        if any(_overlap(c["box"], b) for b in boxes):
            bad.append(c["name"])
    res["door_clamps"] = [c for c in res["door_clamps"] if c["name"] not in bad]
    return bad


def _clamp_door(ctx, p, d, r, what):
    """Upínka na vnitřní straně dveří pod svazkem (mezi svazkem a dveřmi), délka ve směru svazku."""
    L, w = ctx.cl, 2 * r + 4.0
    if abs(d[2]) > 0.5:
        box = [p[0] - w / 2, p[0] + w / 2, ctx.yd - ctx.tc, ctx.yd, p[2] - L / 2, p[2] + L / 2]
    else:
        box = [p[0] - L / 2, p[0] + L / 2, ctx.yd - ctx.tc, ctx.yd, p[2] - w / 2, p[2] + w / 2]
    return {"name": f"Upínka svazku na dveřích — {what} (ODHAD typu)", "box": [round(v, 3) for v in box]}


def _clamp_side(ctx, p, along, r, what):
    """Upínka na vnitřní straně boku skříně (u pantů) mezi svazkem a bokem."""
    L, w = ctx.cl, 2 * r + 4.0
    x0, x1 = ctx.W - ctx.t - ctx.tc, ctx.W - ctx.t
    if along == "z":
        box = [x0, x1, p[1] - w / 2, p[1] + w / 2, p[2] - L / 2, p[2] + L / 2]
    else:
        box = [x0, x1, p[1] - L / 2, p[1] + L / 2, p[2] - w / 2, p[2] + w / 2]
    return {"name": f"Upínka svazku na boku skříně — {what} (ODHAD typu)", "box": [round(v, 3) for v in box]}


def _elen(e):
    return _len(_sub(e[2], e[1])) if e[0] == "usek" else e[5] * math.radians(e[6])


def _split(prvky, a, b):
    """Rozdělí prvky v bodech a (začátek oblouku) a b (konec oblouku) — oba jsou hranice prvků."""
    door, free, cab = [], [], []
    stage = 0
    for e in prvky:
        if stage == 0 and _len(_sub(e[1], a)) < 1e-6:
            stage = 1
        (door if stage == 0 else free if stage == 1 else cab).append(e)
        end = e[2] if e[0] == "usek" else e[3]
        if stage == 1 and _len(_sub(end, b)) < 1e-6:
            stage = 2
    return door, free, cab


def _solve_free(ctx, z_top_lim, z_e, Xw, yc, rT, R_m, R_f, yd):
    """Svislý oblouk volného úseku: vrchol Pd (dveře), B1 / B2 odsazené o s k zádům, Pc (bok); hledá nejnižší s
    (a nejvyšší Pd) se splněnou délkou a poloměrem; pevný úsek pod Pc potřebuje R_f + upínku."""
    sm = data()["smycka"]
    p = float(sm["rezerva_pct"]) / 100.0
    s_max = yc - rT - ctx.t - 2.0
    for s in _frange(10.0, s_max, 5.0):
        for frac in (2.0, 1.5, 1.0, 0.75, 0.5):
            # a podle s: úhel φ = atan(s / a)
            a = s / frac if frac else s
            phi = math.atan2(s, a)
            t = R_m * math.tan(phi / 2)
            L1 = math.hypot(a, s)
            if L1 < 2 * t - 1e-6:
                continue
            z_pd = z_top_lim - t
            z_pc = z_e + R_f + ctx.cl + t + 2.0
            dz = z_pd - z_pc
            if dz - 2 * a < 2 * t - 1e-6:
                continue
            Lf = 4 * R_m * phi + 2 * (L1 - 2 * t) + (dz - 2 * a - 2 * t)
            Ln, _ang = _need_len(ctx, (Xw, yc, rT), (Xw, yc), (z_pd + t) - (z_pc - t))
            if Lf >= Ln * (1 + p) - 1e-6:
                return {"s": s, "a": a, "z_pd": z_pd, "z_pc": z_pc, "t": t, "L": Lf, "need": Ln}
    return None


def _els_text(els) -> str:
    cnt: dict = {}
    for k, _d in els:
        cnt[k] = cnt.get(k, 0) + 1
    return ", ".join(f"{n} × {k}" for k, n in cnt.items())


# --- PE / N ------------------------------------------------------------------------------------------------------------

def busbars(lay: dict, ctx: Door, extra_obst=()) -> dict:
    """PE (vodivě na desce) a N (na izolátorech) svisle u boku desky na straně pantů, v nejnižším volném místě."""
    P = data()["pripojnice"]
    pl, G = lay["plate"], lay["geom"]
    pe, nn, iz = P["PE"], P["N"], P["izolator"]
    L = float(nn["L"])
    fw = float(pe["b"]) + 12.0 + float(iz["d"])
    py1 = pl["y1"]
    obst = [i["box"] for i in lay["devices"] if i["kind"] != "zarazka"] + [z["box"] for z in lay["zones"]]
    obst += [r["box"] for r in lay["reserves"]]
    obst += [[d["x0"], d["x1"], d["y0"], d["y1"] + float(G["zlab_vika"]), d["z0"], d["z1"]] for d in lay["ducts"]]
    for x, z in ((pl["x0"] + 7.5, pl["z0"] + 7.5), (pl["x1"] - 7.5, pl["z0"] + 7.5), (pl["x0"] + 7.5, pl["z1"] - 7.5),
                 (pl["x1"] - 7.5, pl["z1"] - 7.5)):
        obst.append([x - 12, x + 12, 0, py1 + 50, z - 12, z + 12])            # sloupek + šroub desky M6
    obst += list(extra_obst)
    xs = _frange(pl["x0"] + 2.0, pl["x1"] - 2.0 - fw, 5.0)[::-1]
    zs = _frange(pl["z0"] + G["okraj"] + 15.0, pl["z1"] - G["okraj"] - L - 15.0, 5.0)
    for z0 in zs:
        for x0 in xs:
            box = [x0 - 2, x0 + fw + 2, py1, py1 + float(iz["h"]) + float(nn["t"]) + 8.0, z0 - 2, z0 + L + 2]
            if any(_overlap(box, b) for b in obst):
                continue
            xpe = x0 + float(pe["b"]) / 2
            xn = x0 + float(pe["b"]) + 12.0 + float(iz["d"]) / 2
            zz = (z0 + 15.0, z0 + L - 15.0)
            return {"PE": {"box": [x0, x0 + float(pe["b"]), py1, py1 + float(pe["t"]), z0, z0 + L], "x": xpe, "sroub_z": zz, **pe},
                    "N": {"box": [xn - float(nn["b"]) / 2, xn + float(nn["b"]) / 2, py1 + float(iz["h"]),
                                  py1 + float(iz["h"]) + float(nn["t"]), z0, z0 + L], "x": xn, "sroub_z": zz, **nn},
                    "izolator": dict(iz, x=xn, z=zz), "sroub": P["sroub"], "y_deska": py1}
    return {"chyba": "PE / N přípojnice: na desce není volné místo " f"{fw:.0f} × {L:.0f} mm"}


# --- oddělení: kontrola vzdáleností ----------------------------------------------------------------------------------

def _seg_hits_box(p, q, b, eps=1e-6) -> bool:
    """Úsečka p→q protne kvádr b (slab metoda, včetně dotyku)."""
    t0, t1 = 0.0, 1.0
    for k in range(3):
        d = q[k] - p[k]
        lo, hi = b[2 * k], b[2 * k + 1]
        if abs(d) < 1e-12:
            if p[k] < lo - eps or p[k] > hi + eps:
                return False
            continue
        a, c = (lo - p[k]) / d, (hi - p[k]) / d
        if a > c:
            a, c = c, a
        t0, t1 = max(t0, a), min(t1, c)
        if t0 > t1 + eps:
            return False
    return True


def _closest(p, b):
    return tuple(min(max(p[k], b[2 * k]), b[2 * k + 1]) for k in range(3))


def _toward_center(q, b, d=2.0):
    c = tuple((b[2 * k] + b[2 * k + 1]) / 2 for k in range(3))
    v = _sub(c, q)
    n = _len(v)
    return q if n < 1e-9 else _add(q, _mul(v, min(d, n) / n))


def _pairs_separated(pairs, seps):
    """Každá spojnice blízkých bodů musí protnout některou uzemněnou přepážku; vrací (ok, jména přepážek, nekrytých)."""
    used, bad = set(), 0
    for p, q in pairs:
        hit = next((s["name"] for s in seps if _seg_hits_box(p, q, s["box"])), None)
        if hit:
            used.add(hit)
        else:
            bad += 1
    return bad == 0, sorted(used), bad


def separation(lay: dict, od: dict, routes: dict, extra_seps=()) -> list:
    """Silová × signálová trasa: vzdálenost ≥ min_mm, jinak každá spojnice bodů blíž než min_mm protíná uzemněnou
    přepážku (podélná ve smíšeném žlabu, čelní / spodní na styku žlabů, dělicí plech u pantu)."""
    mm = float(data()["oddeleni"]["min_mm"])
    seps = [{"name": p["name"], "box": p["stojina"]} for p in od["prepazky"]]
    seps += [{"name": e["name"], "box": e["box"]} for e in od["celni"]]
    seps += [{"name": e["name"], "box": e["box"]} for e in extra_seps]
    chambers = []
    W = float(lay["cabinet"]["w"])
    for d in lay["ducts"]:
        b = [d["x0"], d["x1"], d["y0"], d["y1"], d["z0"], d["z1"]]
        if d.get("druh") == "smiseny":
            p = next(pp for pp in od["prepazky"] if pp["zlab"] == d["name"])
            w0, w1 = (p["stojina"][4], p["stojina"][5]) if d["orient"] == "h" else (p["stojina"][0], p["stojina"][1])
            if d["orient"] == "h":
                up, dn = list(b), list(b)
                up[4], dn[5] = w1, w0
                chambers += [(f"{d['name']} horní komora", d["komory"]["horni"], up), (f"{d['name']} dolní komora", d["komory"]["dolni"], dn)]
            else:
                lo_, hi_ = list(b), list(b)
                lo_[1], hi_[0] = w0, w1
                outer_low = d["x0"] < W / 2           # komora u boku skříně = silová
                chambers += [(f"{d['name']} komora u boku", "silovy", lo_ if outer_low else hi_),
                             (f"{d['name']} komora k desce", "signal", hi_ if outer_low else lo_)]
        else:
            chambers.append((d["name"], d.get("druh") or "signal", b))
    rows = []
    bundles = {k: [(p, t["r"]) for t in r.get("tubes", []) for p in sample(t["prvky"])] for k, r in routes.items()}
    if bundles.get("silovy") and bundles.get("signal"):
        pairs, dmin = [], 1e18
        for p, r1 in bundles["silovy"]:
            for q, r2 in bundles["signal"]:
                dd = _len(_sub(p, q)) - r1 - r2
                dmin = min(dmin, dd)
                if dd < mm:
                    pairs.append((p, q))
        ok, used, bad = _pairs_separated(pairs, seps) if pairs else (True, [], 0)
        how = "spojnice" if pairs else "vzdálenost"
        if not ok:                                   # rovina dělicího plechu mezi svazky (silový celý nad, signálový pod)
            pl_ = _plane_between_sets(bundles["silovy"], bundles["signal"],
                                      [x for x in seps if x["name"].startswith("Dělicí")] + seps)
            if pl_:
                ok, used, how = True, [pl_], f"rovina přepážky (spojnic mimo plech {bad})"
        rows.append({"a": "svazek silový ke dveřím", "b": "svazek signálový ke dveřím", "vzdalenost": round(dmin, 1),
                     "prepazka": ", ".join(used) or None, "nekryto": bad, "ok": ok, "metoda": how})
    for k, pts in bundles.items():
        if not pts:
            continue
        other = "signal" if k == "silovy" else "silovy"
        for name, kind, box in chambers:
            if kind != other:
                continue
            ds = [(_box_dist(p, box) - r, p) for p, r in pts]
            dmin = min(d for d, _p in ds)
            if dmin >= mm:
                continue
            pairs = [(p, _toward_center(_closest(p, box), box)) for d, p in ds if d < mm]
            ok, used, bad = _pairs_separated(pairs, seps)
            how = "spojnice"
            if not ok:                               # rovina přepážky mezi svazkem a komorou (komora celá za přepážkou)
                pl_ = _plane_between([(p, r) for p, r in pts], box, seps)
                if pl_:
                    ok, used, how = True, [pl_], f"rovina přepážky (spojnic mimo přepážku {bad})"
            rows.append({"a": f"svazek {'silový' if k == 'silovy' else 'signálový'} ke dveřím", "b": name, "vzdalenost": round(dmin, 1),
                         "prepazka": ", ".join(used) or None, "nekryto": bad, "ok": ok, "metoda": how})
    return rows


def _plane_between(pts_r, box, seps) -> str | None:
    """Přepážka, jejíž rovina odděluje všechny body svazku od komory (svazek a komora na opačných stranách)."""
    for s in seps:
        b = s["box"]
        k = min(range(3), key=lambda i: b[2 * i + 1] - b[2 * i])      # tenká osa přepážky
        lo, hi = b[2 * k], b[2 * k + 1]
        sp = {(-1 if p[k] + r <= lo + 1e-6 else 1 if p[k] - r >= hi - 1e-6 else 0) for p, r in pts_r}
        sb = -1 if box[2 * k + 1] <= hi + 1e-6 else 1 if box[2 * k] >= lo - 1e-6 else 0
        if len(sp) == 1 and 0 not in sp and sb != 0 and sb != next(iter(sp)):
            return s["name"]
    return None


def _plane_between_sets(a_r, b_r, seps) -> str | None:
    for s in seps:
        b = s["box"]
        k = min(range(3), key=lambda i: b[2 * i + 1] - b[2 * i])
        lo, hi = b[2 * k], b[2 * k + 1]
        sa = {(-1 if p[k] + r <= lo + 1e-6 else 1 if p[k] - r >= hi - 1e-6 else 0) for p, r in a_r}
        sb = {(-1 if p[k] + r <= lo + 1e-6 else 1 if p[k] - r >= hi - 1e-6 else 0) for p, r in b_r}
        if len(sa) == 1 and len(sb) == 1 and 0 not in sa | sb and sa != sb:
            return s["name"]
    return None


def hinge_plates(ctx: Door, rp: dict, z_sep: float, x_lo: float, x_min_fixed: float = 0.0) -> list:
    """Dělicí plechy u pantu (silový svazek nad, signálový pod): pevný na boku skříně ve sloupci svazků a druhý na
    dveřích; uzemněné (dveře přes PE vodič svazku) — návrh, typ ODHAD."""
    t = float(data()["oddeleni"]["prepazka"]["t"])
    xw0 = max(rp["x_kmen"] - 40.0, x_min_fixed)
    fixed = {"name": "Dělicí plech u pantu na boku skříně (uzemněný, návrh)", "box": [xw0, ctx.W - ctx.t, ctx.y_duct - 20.0,
             ctx.yd - 26.0, z_sep - t / 2, z_sep + t / 2], "part": "fixed", "osa": "z"}
    door = {"name": "Dělicí plech u pantu na dveřích (uzemněný, návrh)", "box": [x_lo, ctx.W - ctx.t - 0.5, ctx.yd - 25.0, ctx.yd,
            z_sep - t / 2, z_sep + t / 2], "part": "door", "osa": "z"}
    return [fixed, door]


# --- hlavní vstup ------------------------------------------------------------------------------------------------------

def apply(lay: dict) -> dict:
    """Doplní layout (po zrcadlení, před hardware); vrací souhrn pro ROZVADEC.md (lay['dvere'])."""
    od = classify_ducts(lay)
    lay["oddeleni"] = {"min_mm": data()["oddeleni"]["min_mm"], "zdroj": data()["oddeleni"]["zdroj"], **od}
    fan = choose_fan(lay["bilance"])
    lay["bilance"]["ventilator"] = fan
    ctx = Door(lay)
    mm = float(data()["oddeleni"]["min_mm"])
    items = [_item_spec(d, ctx) for d in lay["door"]["items"]]
    if fan and fan.get("typ"):
        t = fan["typ"]
        fi = _item_spec(None, ctx, cat="fan", w=float(t["vyrez"]), h=float(t["vyrez"]), d_in=float(t["hloubka"]),
                        front=(float(t["ram"]), float(t["ram"]), float(t["ram_t"])), tag=f"Ventilátor {t['kod']}")
        fi["pref"] = "low"
        ff = fan["filtr"]
        fl = _item_spec(None, ctx, cat="filter", w=float(ff["vyrez"]), h=float(ff["vyrez"]), d_in=0.0,
                        front=(float(ff["ram"]), float(ff["ram"]), float(ff["t"])), tag=f"Výstupní filtr {ff['kod']}")
        fl["pref"], fl["druh"], fl["strop"] = "top_far", "zadny", False
        items += [fi, fl]
    for it in items:
        if it["hmi"]:
            it["pref"] = "hmi"
        else:
            it.setdefault("pref", "low" if it["cat"] == "fan" else "top")
    power = [it for it in items if it["druh"] == "silovy"]
    signal = [it for it in items if it["druh"] == "signal"]
    passive = [it for it in items if it["druh"] == "zadny"]
    base_placed: list = []
    errs_p = place_items(ctx, power, base_placed)
    for it in power:
        if "x" in it:
            _set_box(ctx, it)
    targets_p, targets_s = _targets(lay, ctx)
    routes = {}
    if [it for it in power if "x" in it]:
        routes["silovy"] = route_kind(ctx, "silovy", [it for it in power if "x" in it], targets_p,
                                      others=[i["box_in"] for i in items if "box_in" in i and i["druh"] != "silovy"])
    rp = routes.get("silovy")
    if rp and rp.get("tubes") and rp.get("cil_typ") == "bok svislého žlabu":
        for e in od["celni"]:
            if e.get("bocni"):
                r_ = rp["D"] / 2 + 1.5
                e["vyrezy"].append([ctx.y_duct - r_, ctx.y_duct + r_, rp["z_vstup"] - r_, rp["z_vstup"] + r_])
    zlow = None
    if rp and rp.get("tubes"):
        zlow = min(p[2] - t["r"] for t in rp["tubes"] for p in sample(t["prvky"]))
    # signálová strana: A) strop = silový − 250 mm, B) strop = silový − 40 mm + dělicí plechy u pantu, C) bez stropu
    variants = []
    # strop i podle silových žlabů u sloupce svazků: svislý silový žlab u pantů končí spodní přepážkou (rovina z0)
    vh = next((d for d in lay["ducts"] if d["name"] == od["hinge_duct"]), None)
    shield = any(e.get("bocni") for e in od["celni"])
    z_vh = vh["z0"] - 5.0 if vh is not None and vh.get("druh") == "silovy" and not shield else None
    # strop od silových komor vodorovných žlabů: pod podélnou přepážkou smíšeného žlabu, pod čistě silovým o 250 mm
    z_ch = None
    for d in lay["ducts"]:
        if d["orient"] != "h":
            continue
        if d.get("druh") == "smiseny" and d["komory"]["horni"] == "silovy":
            web = next(pp for pp in od["prepazky"] if pp["zlab"] == d["name"])["stojina"]
            c = web[4] - 1.0
        elif d.get("druh") == "silovy":
            c = d["z0"] - mm
        else:
            continue
        z_ch = c if z_ch is None else min(z_ch, c)
    if zlow is not None:
        cA, cB = zlow - mm, zlow - 40.0
        for lim in (z_vh, z_ch):
            if lim is not None:
                cA, cB = min(cA, lim), min(cB, lim)
        variants += [("vzdalenost", cA, False), ("prepazka", cB, True)]
    variants.append(("bez", None if zlow is None else zlow - 20.0, False))
    final = None
    for name, ceil_, plates in variants:
        placed = list(base_placed)
        for it in signal + passive:
            for k in ("x", "z", "box_in", "clips", "branch", "soft"):
                it.pop(k, None)
        top = None if ceil_ is None else ceil_ - 40.0          # dolní hrana přístroje: větev pod stropem
        errs = []
        for it in signal:
            errs += place_items(ctx, [it], placed, zmax_top=top)
        for it in signal:
            if "x" in it:
                _set_box(ctx, it)
        errs += place_items(ctx, passive, placed)
        for it in passive:
            if "x" in it:
                _set_box(ctx, it)
        hw = {"door_holes": [], "door_cutouts": [], "front_blocks": [], "clips": [], "fan": None, "filter": None, "screws": [],
              "chyby": []}
        _door_hardware(ctx, items, hw)
        rs = None
        sig = [it for it in signal if "x" in it]
        if sig:
            rs = route_kind(ctx, "signal", sig, targets_s, ceiling=ceil_,
                            others=[i["box_in"] for i in items if "box_in" in i and i["druh"] != "signal"] + [c["box"] for c in hw["clips"]])
        pls = []
        if plates and rs and rs.get("tubes") and rp:
            zhigh = max(p[2] + t["r"] for t in rs["tubes"] for p in sample(t["prvky"]))
            # dveřní plech jen přes průmět, kde jsou dveřní části obou svazků (nejmenší x obou) — mimo přístroje
            mins = [min((p[0] for t in r["tubes"] if t["part"] == "door" for p in sample(t["prvky"])), default=None) for r in (rp, rs)]
            x_lo = max(ctx.xmin, max(m for m in mins if m is not None) - 30.0) if any(m is not None for m in mins) else ctx.xmin
            xmf = max((e["box"][1] + 0.5 for e in od["celni"] if e.get("bocni")), default=0.0)
            xmf = max([xmf] + [d["x1"] + 0.5 for d in lay["ducts"] if d["z0"] - 1 < (zhigh + zlow) / 2 < d["z1"] + 1])
            pls = hinge_plates(ctx, rp, (zhigh + zlow) / 2, x_lo, xmf)
            boxes = [i["box_in"] for i in items if "box_in" in i] + [c["box"] for c in hw["clips"]]
            if any(_overlap(pls[1]["box"], b) for b in boxes):
                errs.append("dělicí plech u pantu na dveřích koliduje s přístrojem na dveřích")
        final = (name, ceil_, errs, hw, rs, pls)
        if not errs and (rs is None or not rs["chyby"]):
            break
    name, ceil_, errs, hw, rs, pls = final
    out = dict(hw, varovani=[], pristroje=[], oddeleni_varianta=name, delici_plechy=pls)
    out["chyby"] = errs_p + errs + hw["chyby"]
    if name == "prepazka":
        out["varovani"].append("silový a signálový svazek u pantu jsou blíž než 250 mm — odděleny uzemněnými dělicími plechy (návrh)")
    elif name == "bez" and zlow is not None:
        out["varovani"].append("signálová strana dveří se pod silový svazek nevešla ani s dělicími plechy — oddělení viz tabulka")
    if rs is not None:
        routes["signal"] = rs
        if ceil_ is not None and rs.get("tubes"):
            rs["strop"] = round(ceil_, 1)
    for r in routes.values():                 # upínky nesmí ležet v dělicím plechu
        for key in ("door_clamps", "cab_clamps"):
            r[key] = [c for c in r.get(key, []) if not any(_overlap(c["box"], p["box"]) for p in pls)]
    lay["kabelaz_dvere"] = {k: {kk: vv for kk, vv in r.items() if kk not in ("tubes",)} | {
        "tubes": [dict(t, prvky=_jsonable(t["prvky"])) for t in r["tubes"]]} for k, r in routes.items()}
    for k, r in routes.items():
        out["chyby"] += [f"svazek {k}: {c}" for c in r["chyby"]]
    extra = [c["box"] for r in routes.values() for c in r.get("cab_clamps", [])] + [p["box"] for p in pls]
    for r in routes.values():
        for t in r.get("tubes", []):
            ps = sample(t["prvky"])
            for a, b in zip(ps, ps[1:]):
                extra.append([min(a[0], b[0]) - t["r"] - 2, max(a[0], b[0]) + t["r"] + 2, min(a[1], b[1]) - t["r"] - 2,
                              max(a[1], b[1]) + t["r"] + 2, min(a[2], b[2]) - t["r"] - 2, max(a[2], b[2]) + t["r"] + 2])
    lay["pripojnice"] = busbars(lay, ctx, extra)
    if lay["pripojnice"].get("chyba"):
        out["chyby"].append(lay["pripojnice"]["chyba"])
    lay["oddeleni"]["tabulka"] = separation(lay, od, routes, pls)
    lay["oddeleni"]["delici_plechy"] = pls
    out["pristroje"] = [{"tag": it["tag"], "cat": it["cat"], "druh": it["druh"], "x": it.get("x"), "z": it.get("z"),
                         "w": it["w"], "h": it["h"]} for it in items]
    lay["dvere"] = out
    return out


def _targets(lay, ctx):
    """Cíle svazků: silový = vnější stěna svislého silového žlabu u pantů (rozsah z), signálový = otevřené konce
    prodloužených signálových žlabů (osa žlabu) nebo signálový svislý žlab u pantů."""
    G = lay["geom"]
    tw = float(G["zlab_t"])
    hd = lay["oddeleni"]["hinge_duct"]
    tp, ts = [], []
    for d in lay["ducts"]:
        if d["orient"] == "v" and d["name"] == hd:
            rng = {"z0": d["z0"] + tw + 15.0, "z1": d["z1"] - tw - 15.0}
            t = {"name": d["name"], "typ": "bok svislého žlabu", "x_in": (d["x0"] + d["x1"]) / 2, **rng, "z": None}
            (tp if d.get("druh") == "silovy" else ts).append(t)
        elif d["orient"] == "h" and d.get("prodlouzen") and d.get("druh") == "signal":
            ts.append({"name": d["name"], "typ": "otevřený konec vodorovného žlabu", "x_in": d["x1"] - 30.0, "z": (d["z0"] + d["z1"]) / 2})
    ts.sort(key=lambda t: -(t["z"] if t["z"] is not None else t["z1"]))
    return tp, ts


def _door_hardware(ctx: Door, items: list, out: dict):
    """Výřezy, díry, čelní obálky, upínky a šrouby přístrojů na dveřích podle data/dvere.json."""
    D, yd = ctx.D, ctx.yd
    for it in items:
        if "x" not in it:
            continue
        x, z, w, h = it["x"], it["z"], it["w"], it["h"]
        xc, zc = x + w / 2, z + h / 2
        sp = it["spec"]
        if it["cat"] in ("fan", "filter"):
            out["door_cutouts"].append({"tag": it["tag"], "x0": x, "x1": x + w, "z0": z, "z1": z + h})
            fw, fh, ft = it["front"]
            rec = {"tag": it["tag"], "ram": [xc - fw / 2, xc + fw / 2, D, D + ft, zc - fh / 2, zc + fh / 2],
                   "telo": [x, x + w, yd - it["d_in"], D, z, z + h] if it["d_in"] > 0 else None}
            out["fan" if it["cat"] == "fan" else "filter"] = rec
            continue
        if sp.get("vyrez"):
            vw, vh = float(sp["vyrez"]["w"]), float(sp["vyrez"]["h"])
            out["door_cutouts"].append({"tag": it["tag"], "x0": xc - vw / 2, "x1": xc + vw / 2, "z0": zc - vh / 2, "z1": zc + vh / 2,
                                        "zdroj": sp["zdroj"]["dokument"]})
            up = sp["upinky"]
            tv = up["tvar"]
            L, hh, dd = float(tv["delka"]), float(tv["vyska"]), float(tv["hloubka"])
            clips = []
            for side, n in up["strany"].items():
                for k in range(int(n)):
                    if side in ("nahore", "dole"):
                        cx = xc + (w * (k + 1) / (n + 1) - w / 2)
                        z0 = z + h if side == "nahore" else z - hh
                        clips.append([cx - L / 2, cx + L / 2, yd - dd, yd, z0, z0 + hh])
                    else:
                        x0 = x + w if side == "vpravo" else x - hh
                        clips.append([x0, x0 + hh, yd - dd, yd, zc - L / 2, zc + L / 2])
            it["clips"] = clips
            out["clips"] += [{"name": f"Upínka {it['tag']} {i + 1}/{len(clips)} (počet a strany dle návodu, tvar ODHAD)",
                              "box": [round(v, 3) for v in c], "zdroj": sp["zdroj"]["dokument"]} for i, c in enumerate(clips)]
        elif sp.get("otvory"):
            o = sp["otvory"]
            hx, hz = float(o["roztec_x"]) / 2, float(o["roztec_z"]) / 2
            for dx, dz in ((-hx, -hz), (hx, -hz), (-hx, hz), (hx, hz)):
                out["door_holes"].append({"x": xc + dx, "z": zc + dz, "d": float(o["d"]), "tag": it["tag"]})
            out["door_holes"].append({"x": xc, "z": zc, "d": float(o["stred_d"]), "tag": it["tag"], "pozn": "středový otvor (kóta 10 — význam nejistý)"})
            cw, ch, cd = float(sp["celo"]["w"]), float(sp["celo"]["h"]), float(sp["celo"]["d"])
            pt = float(sp["celo_deska_t"])
            out["front_blocks"].append({"tag": it["tag"], "box": [xc - cw / 2, xc + cw / 2, D, D + cd, zc - ch / 2, zc + ch / 2],
                                        "bores": [(xc + dx, zc + dz) for dx, dz in ((-hx, -hz), (hx, -hz), (-hx, hz), (hx, hz))],
                                        "d": float(o["d"]), "deska_t": pt, "zdroj": sp["zdroj"]["dokument"]})
            M = sp["sroub"]["M"]
            for k, (dx, dz) in enumerate(((-hx, -hz), (hx, -hz), (-hx, hz), (hx, hz)), start=1):
                out["screws"].append({"name": f"Šroub {it['tag']} {k} ISO 4762 {M}×{pt + ctx.tdv:.0f}", "M": M, "l": pt + ctx.tdv,
                                      "head": (xc + dx, D + pt, zc + dz), "dir": (0.0, -1.0, 0.0),
                                      "ucel": f"upevnění {it['tag']} ve dveřích — 4 otvory Ø5 na 48 × 48 dle dokumentace, typ šroubu ODHAD"})
        else:
            hd = None
            cm = Path(HERE.parent / "pro3d_parts" / "data" / "katalog.json")
            try:
                kat = json.loads(cm.read_text(encoding="utf-8"))
                kk = {str(k).replace(" ", "").upper(): v for k, v in kat.items() if isinstance(v, dict)}
                hd = (kk.get(str(it["dev"]["code"] if it["dev"] else "").replace(" ", "").upper()) or {}).get("hole_d")
            except (OSError, ValueError):
                hd = None
            if hd:
                out["door_holes"].append({"x": xc, "z": zc, "d": float(hd), "tag": it["tag"], "pozn": "Ø22,3 dle katalog.json"})
            else:
                out["chyby"].append(f"{it['tag']}: vrtací obrazec / výřez nedoložen (data/dvere.json) — DOLOŽIT")
