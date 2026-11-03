"""Rozmístění modulů stroje z manifestu PLCdesk a scény (čistý Python, bez FreeCADu a bez importu z ``plc_studio``).

``plan(manifest, scene, folder=…)`` → slovník ``layout`` (zapisuje se do ``moduly/layout.json``):

1. **Zařízení v poli** (``parts[].location = field`` bez kabelů): poloha z rámu (díl s ``PLCdesk_Id`` už v ``Ram.FCStd`` —
   generátor ho nestaví, jen k němu vede kabel), jinak ze zástupného dílu konceptu (``Koncept.FCStd``), jinak CHYBÍ.
2. **Nosné konstrukce z konceptu**: konstrukční tělesa konceptu bez ``PLCdesk_Id``, na kterých zařízení (nebo jiná
   nosná konstrukce) stojí nebo o která se válec opírá čelem — převezmou se jako tvar konceptu (ODHAD rozměrů konceptu,
   návrh k odsouhlasení) a přišroubují se k tomu, na čem stojí (vlastní díl = závit, profil rámu = matice v drážce,
   deska rámu bez díry = požadavek na rám).
3. **Válce** ISO 15552 / 6432 (rozměry ``pro3d_parts/data/valce.json`` se zdrojem): model z ``dily/`` (App::Link), osa a
   směr pístnice z konceptu, upevnění čelem (4 × šroub do závitů RT víka) nebo patkami (L úhelník u obou vík, šrouby do
   horních závitů RT a do podložky), přípojky EE na horní ploše (PL od čela víka), škrticí ventily GRLA, snímače polohy
   v drážce (2 koncové polohy, ODHAD — seřídit), ``Konstrukce_Pohyb`` pístnice nese model.
4. **Ostatní zařízení** (ventily, bezpečnostní ventil, proporcionální ventil, snímače…): model z ``dily/`` nebo zástupný
   kvádr konceptu; úchytky (L, 2 šrouby: do zařízení a do podložky), snímače se závitem v držáku (plech, podélné otvory
   ± 5 mm — seřízení), snímač tlaku na rozvodném bloku.
5. **Hadice** rozváděč → válec (vazby ``actuates``: 4 → zadní přípojka, 2 → přední — ODHAD, ověřit schéma) a rozvod P,
   **kabely** od každého zařízení s kabelem k rozvaděči: trasy routerem (``router.py``) mezi překážkami scény, poloměry,
   délky a rezerva skriptem skillu kabelaz-a-hadice (``scripts/trasa.py``, ``data/media.json``). Trasa, která by musela
   projít deskou rámu, se nestaví — požadavek na průchod (zpětná vazba / předání rámu) + délka.

Co kód neumí (nestandardní mechanika, chybějící poloha, kolize s rámem), se nestaví a je v ``layout["nepostaveno"]``
s důvodem — doplní stavitel. Souřadnice = globální souřadnice rámu (mm)."""

from __future__ import annotations

import datetime as _dt
import hashlib
import json
import math
import os
import re
import sys
from functools import lru_cache
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
for _d in (HERE, HERE.parent / "pro3d_parts", HERE.parent / "pro3d_tools"):
    if str(_d) not in sys.path:
        sys.path.insert(0, str(_d))
import router  # noqa: E402
try:
    import catalog_map as cm  # type: ignore  # noqa: E402  (sourozenec pro3d_parts)
except Exception:  # noqa: BLE001
    cm = None
import rules  # type: ignore  # noqa: E402  (sourozenec pro3d_tools — konvence modelu)

FORMAT = "plcdesk-pro3d-modules"
VERSION = 1
SUB = "moduly"
TOL = 1.5
CABLE_CATS = ("cable_sensor", "cable_power", "cable", "cable_motor", "cable_bus")
SKIP_CATS = ("machine_interface", "interface_relay")
REQUIRE_MODELS = [True]     # model z dily/ musí existovat na disku (plan(require_models=False) jen pro testy rozmístění)


def skill_scripts() -> Path:
    return Path(os.environ.get("PRO3D_KABELAZ") or Path.home() / ".claude" / "skills" / "kabelaz-a-hadice") / "scripts"


@lru_cache(maxsize=None)
def trasa_mod():
    """Výpočty tras skillu kabelaz-a-hadice (``scripts/trasa.py`` — poloměry, zaoblení, délky, oddělení, zpětná vazba)."""
    p = skill_scripts()
    if not (p / "trasa.py").is_file():
        return None
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))
    import trasa  # type: ignore
    return trasa


@lru_cache(maxsize=None)
def data() -> dict:
    return json.loads((DATA / "moduly.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=None)
def normalie() -> dict:
    p = HERE.parent / "pro3d_parts" / "data" / "normalie.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.is_file() else {}


# --- geometrie kvádrů [x0, y0, z0, x1, y1, z1] ---------------------------------------------------------------------

def size(b):
    return [b[3] - b[0], b[4] - b[1], b[5] - b[2]]


def center(b):
    return [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2]


def ov1(a0, a1, b0, b1):
    return max(0.0, min(a1, b1) - max(a0, b0))


def ovol(a, b):
    return ov1(a[0], a[3], b[0], b[3]) * ov1(a[1], a[4], b[1], b[4]) * ov1(a[2], a[5], b[2], b[5])


def vol(b):
    s = size(b)
    return max(0.0, s[0]) * max(0.0, s[1]) * max(0.0, s[2])


def touch_side(a, b, tol=TOL):
    """Dotýká se ``b`` kvádru ``a``? → (osa, znaménko strany ``a``, plocha dotyku) nebo None."""
    best = None
    for k in range(3):
        o = [ov1(a[j], a[j + 3], b[j], b[j + 3]) for j in range(3) if j != k]
        if min(o) < 2.0:
            continue
        if abs(b[k] - a[k + 3]) <= tol:
            c = (k, 1, o[0] * o[1])
        elif abs(a[k] - b[k + 3]) <= tol:
            c = (k, -1, o[0] * o[1])
        else:
            continue
        if best is None or c[2] > best[2]:
            best = c
    return best


def rests_on(item, sup, tol=TOL):
    """``item`` stojí na ``sup`` (dno item = horní plocha sup, překryv půdorysu ≥ 15 % nebo 100 mm²)."""
    if abs(item[2] - sup[5]) > tol:
        return 0.0
    a = ov1(item[0], item[3], sup[0], sup[3]) * ov1(item[1], item[4], sup[1], sup[4])
    fp = max(1e-9, (item[3] - item[0]) * (item[4] - item[1]))
    return a if a >= min(100.0, 0.15 * fp) else 0.0


def r3(v):
    return [round(float(x), 3) for x in v]


def add(a, b):
    return [a[i] + b[i] for i in range(3)]


def sub(a, b):
    return [a[i] - b[i] for i in range(3)]


def mul(a, k):
    return [a[i] * k for i in range(3)]


def cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def unit(k, s=1):
    v = [0.0, 0.0, 0.0]
    v[k] = float(s)
    return v


def box_of(p, q):
    return [min(p[0], q[0]), min(p[1], q[1]), min(p[2], q[2]), max(p[0], q[0]), max(p[1], q[1]), max(p[2], q[2])]


class Frame:
    """Lokální soustava (počátek + osy ex, ey, ez v globálních souřadnicích, osově zarovnané)."""

    def __init__(self, o, ex, ez):
        self.o, self.ex, self.ez = list(o), list(ex), list(ez)
        self.ey = cross(ez, ex)

    def p(self, x, y, z):
        return [self.o[i] + self.ex[i] * x + self.ey[i] * y + self.ez[i] * z for i in range(3)]

    def v(self, x, y, z):
        return [self.ex[i] * x + self.ey[i] * y + self.ez[i] * z for i in range(3)]

    def box(self, x0, x1, y0, y1, z0, z1):
        return box_of(self.p(x0, y0, z0), self.p(x1, y1, z1))

    def osy(self):
        return [r3(self.ex), r3(self.ey), r3(self.ez)]


# --- scéna ------------------------------------------------------------------------------------------------------------

def scene_index(scene: dict):
    ram, kon = [], []
    for o in scene.get("objects") or []:
        o = dict(o)
        o["typ2"] = rules.typ_dilu({"Konstrukce_Typ": o.get("typ"), "Konstrukce_Vedeni": o.get("vedeni"),
                                    "Konstrukce_Zona": o.get("zona")}, o.get("label", ""), o.get("name", ""))
        if o["doc"] == "ram":
            if not o.get("kontext"):
                ram.append(o)
        else:
            kon.append(o)
    return ram, kon


def obstacles_of(objs):
    out = []
    for o in objs:
        if o["typ2"] in ("zona", "pomocny"):
            continue
        out += [list(b) for b in (o.get("boxes") or [o["bb"]])]
    return out


# --- vstupní data ------------------------------------------------------------------------------------------------------

def thread_d(t: str) -> float:
    t = (t or "").replace(" ", "")
    g = data()["zavity_G"]
    if t in g:
        return float(g[t])
    m = re.match(r"M(\d+(?:\.\d+)?)", t)
    return float(m.group(1)) if m else 9.728


def hose_for(port: str) -> dict:
    t = data()["hadice_podle_pripojky"]
    return dict(t.get(port) or t["G1/8"], port=port)


def part_model(pidx: dict, pid: str, folder: Path):
    if not pidx:
        return None
    pp = (pidx.get("parts") or {}).get(pid) or {}
    if pp.get("stav") != rules.STAV_DOKUMENTACE or not pp.get("file"):
        return None
    f = folder / "dily" / pp["file"]
    mm = (pidx.get("modely") or {}).get(pp.get("model") or "") or {}
    return {"file": str(f), "rel": f"dily/{pp['file']}", "exists": f.is_file() or not REQUIRE_MODELS[0], "gen": pp.get("generator") or "",
            "bbox": mm.get("bbox"), "zdroj": " | ".join(pp.get("zdroj") or [])}


def cab_info(manifest: dict, ram, kon, cab_layout: dict | None):
    """Rozvaděč v poli: obálka z rámu / konceptu (díl location cabinet kategorie enclosure / cabinet) a strana dveří."""
    cabs = [p["id"] for p in manifest.get("parts") or [] if p.get("location") == "cabinet" and
            (p.get("category") in ("enclosure", "cabinet") or str(p.get("id", "")).endswith(":cabinet"))]
    obj = None
    for src in (ram, kon):
        for o in src:
            if o.get("pid") in cabs:
                obj = o
                break
        if obj:
            break
    if not obj:          # skříň bez PLCdesk_Id: podle popisku „skříň rozvaděče“ (ODHAD — doplnit PLCdesk_Id v konceptu / rámu)
        cands = [o for o in ram + kon if re.search(r"skrin\w*\s+rozvad|\bcabinet\b|schaltschrank", rules.fold(o["label"]))
                 and o["typ2"] not in ("zona",)]
        if cands:
            obj = dict(max(cands, key=lambda o: vol(o["bb"])), pid=(cabs[0] if cabs else "+1:cabinet"))
            obj["odhad"] = True
    if not obj:
        return None
    bb = obj["bb"]
    door_tags = {p["id"] for p in manifest.get("parts") or [] if p.get("mount") == "door"}
    door = [o for o in kon + ram if o.get("pid") in door_tags]
    side = (1, -1)                                   # dveře k −Y (ODHAD bez dveřních přístrojů v konceptu)
    if door:
        c = center(bb)
        d = center(door[0]["bb"])
        k = max(range(2), key=lambda i: abs(d[i] - c[i]) / max(1.0, size(bb)[i]))
        side = (k, 1 if d[k] > c[k] else -1)
    glands = (cab_layout or {}).get("hw", {}).get("glands") if cab_layout else None
    return {"pid": obj["pid"], "bb": bb, "label": obj["label"], "dvere": side, "src": obj["doc"],
            "glands": [g.get("x") for g in glands or []],
            "W": (cab_layout or {}).get("cabinet", {}).get("w")}


# --- hlavní plán ------------------------------------------------------------------------------------------------------

class Plan:
    def __init__(self, manifest, scene, folder, pidx, cab_layout):
        self.m = manifest
        self.folder = Path(folder)
        self.pidx = pidx or {}
        self.ram, self.kon = scene_index(scene)
        self.ram_obst = obstacles_of(self.ram)
        self.ram_real = [o for o in self.ram if o["typ2"] not in ("zona", "pomocny")]
        self.cab = cab_info(manifest, self.ram, self.kon, cab_layout)
        self.items = []           # stavěné díly (druh, skupina, tvar …)
        self.groups = {}          # skupina → popis
        self.nepostaveno = []
        self.odhady = set()
        self.predani = []         # požadavky na rám (díry, průchody)
        self.feedback = []
        self.devices = []
        self.supports = {}
        self.busy = []            # obsazené kvádry (naše díly) — pro kontrolu kolizí v plánu
        self.n = 0
        self.parts = {p.get("id"): p for p in manifest.get("parts") or [] if isinstance(p, dict)}

    # --- pomocné -----------------------------------------------------------------------------------------------------
    def nid(self, pre):
        self.n += 1
        return f"{pre}{self.n:03d}"

    def item(self, **kw):
        kw.setdefault("id", self.nid(kw.get("druh", "X")[:2].upper()))
        self.items.append(kw)
        return kw

    def collides_ram(self, b, ignore=()):
        for o in self.ram_real:
            if o["name"] in ignore:
                continue
            for bx in (o.get("boxes") or [o["bb"]]):
                if ovol(b, bx) > 1.0:
                    return o
        return None

    def ram_below(self, foot, zmax, depth=400.0):
        """Nejvyšší horní plocha rámu pod půdorysem ``foot`` (kvádr) v rozmezí (zmax − depth, zmax]."""
        best = None
        for o in self.ram_real:
            if o["typ2"] in rules.FASTENERS or o["typ2"] in ("kabel", "hadice"):
                continue
            for bx in (o.get("boxes") or [o["bb"]]):
                if bx[5] > zmax + TOL or bx[5] < zmax - depth:
                    continue
                if ov1(foot[0], foot[3], bx[0], bx[3]) * ov1(foot[1], foot[4], bx[1], bx[4]) < 0.9 * (foot[3] - foot[0]) * (foot[4] - foot[1]):
                    continue
                if best is None or bx[5] > best[1][5]:
                    best = (o, bx)
        return best

    # --- 1. zařízení ---------------------------------------------------------------------------------------------
    def collect_devices(self):
        by_ram, by_kon = {}, {}
        for src, dst in ((self.ram, by_ram), (self.kon, by_kon)):
            agg = {}
            for o in src:
                pid = o.get("pid") or o.get("pid_inh")
                if not pid or o["typ2"] in ("zona", "pomocny"):
                    continue
                key = (pid, o.get("pkey") or o["name"])
                if key in agg:                        # díl z více těles (model v odkazu) = jedna instance, obálka sjednocená
                    a = agg[key]
                    a["bb"] = union_box([a["bb"], o["bb"]])
                else:
                    agg[key] = dict(o, pid=pid)
            for (pid, _k), o in agg.items():
                dst.setdefault(pid, []).append(o)
        for lst in list(by_ram.values()) + list(by_kon.values()):
            lst.sort(key=lambda o: (round(o["bb"][0], 1), round(o["bb"][1], 1), round(o["bb"][2], 1)))
        for p in self.m.get("parts") or []:
            if p.get("location") != "field" or p.get("category") in CABLE_CATS or p.get("mount") == "none":
                continue
            qty = int(p.get("qty") or 1)
            for k in range(1, qty + 1):
                d = {"pid": p["id"], "inst": k, "tag": p.get("tag") or "", "cat": p.get("category") or "", "dev": p.get("device") or "",
                     "code": p.get("orderCode") or "", "type": p.get("type") or "", "brand": p.get("brand") or ""}
                r = by_ram.get(p["id"]) or []
                c = by_kon.get(p["id"]) or []
                if len(r) >= k:
                    d.update(src="ram", bb=r[k - 1]["bb"], label=r[k - 1]["label"], ram_name=r[k - 1]["name"])
                elif len(c) >= k:
                    d.update(src="koncept", bb=c[k - 1]["bb"], label=c[k - 1]["label"], kname=c[k - 1]["name"])
                elif d["cat"] == "cylinder_switch":
                    d.update(src="valec", bb=None, label=f"{d['tag']} snímač polohy {k}")
                else:
                    d.update(src="chybi", bb=None, label=d["tag"])
                    self.nepostaveno.append({"id": f"{p['id']}#{k}", "co": f"{d['tag']} {d['cat']}",
                                             "duvod": "poloha CHYBÍ — zařízení není v rámu ani v konceptu (PLCdesk_Id)"})
                if d["src"] == "koncept":
                    hit = self.collides_ram(d["bb"])
                    if hit is not None and ovol(d["bb"], hit["bb"]) > 0.3 * vol(d["bb"]):
                        d["src"] = "ram_bez_id"
                        self.nepostaveno.append({"id": f"{p['id']}#{k}", "co": d["label"],
                                                 "duvod": f"v místě konceptu je v rámu díl „{hit['label']}“ bez PLCdesk_Id — "
                                                          "zřejmě postaven rámem; generátor ho nestaví (doplnit PLCdesk_Id v rámu)"})
                self.devices.append(d)

    # --- 2. nosné konstrukce z konceptu --------------------------------------------------------------------------
    def collect_supports(self):
        built = [d for d in self.devices if d["src"] == "koncept"]
        cands = []
        cab_bb = self.cab["bb"] if self.cab else None
        for o in self.kon:
            if o.get("pid") or o["typ2"] not in ("dil",) or o.get("pohyb") or o.get("kontext"):
                continue
            if cab_bb and ovol(o["bb"], cab_bb) > 0.5 * vol(o["bb"]):
                continue
            if re.search(r"pistnic|celist|pistnice", rules.fold(o["label"])):
                continue
            cands.append(o)
        dev_names = {d.get("kname") for d in built}
        chosen = {}
        frontier = [("dev", d) for d in built]
        while frontier:
            kind, it = frontier.pop()
            bb = it["bb"]
            for c in cands:
                if c["name"] in chosen or c["name"] in dev_names:
                    continue
                ok = rests_on(bb, c["bb"]) > 0
                if not ok and kind == "dev" and it["cat"] == "cylinder":
                    ts = touch_side(bb, c["bb"])
                    ok = ts is not None and ts[2] > 200.0
                if ok:
                    hit = self.collides_ram(c["bb"])
                    if hit is not None and ovol(c["bb"], hit["bb"]) > 0.02 * vol(c["bb"]):
                        self.nepostaveno.append({"id": c["name"], "co": f"nosná konstrukce konceptu „{c['label']}“",
                                                 "duvod": f"koliduje s rámem („{hit['label']}“) — převzetí z konceptu nelze"})
                        chosen[c["name"]] = None
                        continue
                    chosen[c["name"]] = c
                    frontier.append(("sup", c))
        for name, c in chosen.items():
            if c is None:
                continue
            zast = rules.fold(c["label"]).startswith(("zastupn", "src zastupn"))
            self.supports[name] = {"obj": c, "zast": zast, "holes": [], "on": None}
        # na čem stojí: jiná nosná konstrukce, nebo rám
        for name, s in self.supports.items():
            bb = s["obj"]["bb"]
            under = None
            for n2, s2 in self.supports.items():
                if n2 != name and rests_on(bb, s2["obj"]["bb"]) > 0:
                    under = ("sup", n2, s2["obj"]["bb"])
                    break
            if under is None:
                rb = self.ram_below(bb, bb[2], depth=2.0)
                if rb:
                    under = ("ram", rb[0], rb[1])
            s["on"] = under

    # --- spojovací prvky -------------------------------------------------------------------------------------------
    def slot_lines(self, prof, face_k, face_s):
        """Osy drážek na ploše profilu rámu (rastr 40 mm, drážka 8 — ALUTEC 40/8): seznam (osa_podél, souřadnice napříč)."""
        b = prof["bb"]
        s = size(b)
        along = max(range(3), key=lambda k: s[k])
        across = [k for k in range(3) if k not in (along, face_k)]
        if not across:
            return []
        a = across[0]
        w = s[a]
        n = int(round(w / 40.0))
        if n < 1 or abs(w - 40.0 * n) > 1.0:
            return []
        return [(along, a, b[a] + 20.0 + 40.0 * i) for i in range(n)]

    def fasten_down(self, grp, pts, z_top, n_dir, target, M=6, t=8.0, label=""):
        """Šrouby svisle (n_dir = směr dříku) z plochy ``z_top`` dílu tloušťky ``t`` do ``target``.
        target = ("sup", name, bb) | ("ram", obj, bb) | ("own", item_id, bb). Vrací seznam děr v našem dílu."""
        holes = []
        kind = target[0]
        for p in pts:
            head = list(p)
            if kind == "ram":
                o, bx = target[1], target[2]
                if o["typ2"] == "profil":
                    lines = self.slot_lines(o, 2, 1)
                    best = None
                    for along, a, c in lines:
                        dd = abs(head[a] - c)
                        if dd <= 25.0 and (best is None or dd < best[0]):
                            best = (dd, a, c)
                    if best is None:
                        self.predani.append({"grp": grp, "co": f"závit M{M} v „{o['label']}“", "bod": r3(sub(head, mul(n_dir, t))),
                                             "proc": f"upevnění {label}: drážka profilu pod bodem není"})
                        L = round(t, 1)          # dřík jen přes náš díl — díra v rámu je požadavek
                        self.screw(grp, M, L, head, n_dir, f"{label} (do rámu — díra = požadavek na rám)", predani=True)
                    else:
                        head[best[1]] = best[2]
                        L = self.screw_len(t, 9.0)
                        self.screw(grp, M, L, head, n_dir, f"{label} do matice v drážce")
                        nut_c = add(head, mul(n_dir, t + 7.0))
                        self.item(druh="matice", skupina=grp, M=M, stred=r3(nut_c), n=r3(mul(n_dir, -1)),
                                  label=f"Matice M{M} v drážce „{o['label']}“", cil=o["name"])
                else:
                    self.predani.append({"grp": grp, "co": f"závit M{M}×{int(data()['geom']['zavit_zaber'])} v „{o['label']}“",
                                         "bod": r3(add(head, mul(n_dir, t))), "proc": f"upevnění {label}"})
                    self.screw(grp, M, round(t, 1), head, n_dir, f"{label} (díra v rámu = požadavek na rám)", predani=True)
                    self.odhady.add("šrouby do desek rámu bez díry: dřík končí na ploše rámu — díra se závitem je požadavek na rám")
            else:
                tb = target[2]
                k = max(range(3), key=lambda i: abs(n_dir[i]))
                thick = tb[k + 3] - tb[k]                     # tloušťka cílového dílu ve směru šroubu
                eng = min(data()["geom"]["zavit_zaber"], thick - 1.5)
                std = (6, 8, 10, 12, 16, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 80, 90, 100)
                fits = [s for s in std if t + 3.0 <= s <= t + max(3.0, eng) + 0.01]
                L = max(fits) if fits else round(t + max(3.0, eng), 1)   # dřík nesmí projít cílovým dílem
                self.screw(grp, M, L, head, n_dir, label)
                tgt = target[1]
                self.tap(tgt, add(head, mul(n_dir, t)), n_dir, M, min(L - t + 0.5, thick))
            holes.append(["cyl", *r3(sub(head, mul(n_dir, 0.5))), *r3(n_dir), self.clear(M) / 2, t + 1.0])
        return holes

    def clear(self, M):
        return {3: 3.4, 4: 4.5, 5: 5.5, 6: 6.6, 8: 9.0, 10: 11.0}.get(M, M + 1.0)

    def tap_d(self, M):
        P = ((normalie().get("ISO4762") or {}).get("rady") or {}).get(f"M{M}", {}).get("P", 1.0)
        return M - P

    def screw_len(self, t, eng):
        L = t + eng
        std = (6, 8, 10, 12, 16, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 80, 90, 100)
        for s in std:
            if s >= L - 0.5:
                return s if s - L <= 2.0 or L < 6 else max(x for x in std if x <= L + 0.5)
        return int(L)

    def screw(self, grp, M, L, head, n_dir, label, predani=False):
        return self.item(druh="sroub", skupina=grp, M=M, L=L, hlava=r3(head), smer=r3(n_dir), label=f"Šroub ISO 4762 M{M}×{L} {label}",
                         predani=predani)

    def tap(self, target_id, p, n_dir, M, depth):
        """Závitový otvor (Ø d − P) v našem dílu (nosná konstrukce / zástupný přístroj / úchytka)."""
        hole = ["cyl", *r3(sub(p, mul(n_dir, 0.2))), *r3(n_dir), round(self.tap_d(M) / 2, 3), round(depth + 0.2, 2)]
        if target_id in self.supports:
            self.supports[target_id]["holes"].append(hole)
        else:
            for it in self.items:
                if it["id"] == target_id:
                    it.setdefault("cut", []).append(hole)
                    break

    def target_below(self, foot, z, exclude=()):
        """Nosná plocha pod půdorysem ``foot`` ve výšce z (±TOL): nosná konstrukce, náš díl, nebo rám."""
        for name, s in self.supports.items():
            bb = s["obj"]["bb"]
            if name in exclude:
                continue
            if abs(bb[5] - z) <= TOL and ov1(foot[0], foot[3], bb[0], bb[3]) * ov1(foot[1], foot[4], bb[1], bb[4]) >= \
                    0.9 * (foot[3] - foot[0]) * (foot[4] - foot[1]):
                return ("sup", name, bb)
        rb = self.ram_below(foot, z, depth=2.0)
        if rb:
            return ("ram", rb[0], rb[1])
        return None

    def surface_below(self, foot, zmax, depth=300.0, exclude=()):
        """Nejvyšší plocha (nosná konstrukce nebo rám) pod půdorysem ``foot`` s horní plochou ≤ zmax. Nejvyšší těleso,
        které půdorys aspoň zčásti překrývá, musí půdorys nést celý (≥ 90 %) — jinak None (noha by visela přes hranu
        nebo procházela jiným dílem)."""
        area = (foot[3] - foot[0]) * (foot[4] - foot[1])
        top = None
        for name, s in self.supports.items():
            if name in exclude:
                continue
            bb = s["obj"]["bb"]
            if bb[5] > zmax + TOL or bb[5] < zmax - depth:
                continue
            a = ov1(foot[0], foot[3], bb[0], bb[3]) * ov1(foot[1], foot[4], bb[1], bb[4])
            if a > 1.0 and (top is None or bb[5] > top[2][5]):
                top = ("sup", name, bb, a)
        for o in self.ram_real:
            if o["typ2"] in rules.FASTENERS or o["typ2"] in ("kabel", "hadice"):
                continue
            for bx in (o.get("boxes") or [o["bb"]]):
                if bx[5] > zmax + TOL or bx[5] < zmax - depth:
                    continue
                a = ov1(foot[0], foot[3], bx[0], bx[3]) * ov1(foot[1], foot[4], bx[1], bx[4])
                if a > 1.0 and (top is None or bx[5] > top[2][5] + 1e-6):
                    top = ("ram", o, bx, a)
        if top is None or top[3] < 0.9 * area:
            return None
        return top[:3]

    def free_box(self, b, ignore_sup=(), grp=None):
        """Kvádr bez průniku s rámem a nosnými konstrukcemi (kontrola v plánu; FreeCAD pak ověří skutečné tvary)."""
        if self.collides_ram(b):
            return False
        for name, s in self.supports.items():
            if name not in ignore_sup and ovol(b, s["obj"]["bb"]) > 1.0:
                return False
        for it in self.items:                       # už rozmístěné díly (bez šroubů a matic — ty sedí v dírách)
            if it["druh"] in ("sroub", "matice") or (grp is not None and it.get("skupina") == grp):
                continue
            for bx in ([it["bb"]] if it.get("bb") else []) + [prim_box(p) for p in it.get("add") or [] if it["druh"] == "konstrukce"]:
                if ovol(b, bx) > 1.0:
                    return False
        return True

    # --- 3. válce ------------------------------------------------------------------------------------------------
    def cylinders(self):
        for d in self.devices:
            if d["src"] != "koncept" or d["cat"] != "cylinder":
                continue
            p = self.parts.get(d["pid"]) or {}
            spec, why = cm.spec_for_part(p) if cm else (None, "pro3d_parts chybí")
            if not spec or spec["gen"] not in ("valec_iso15552", "valec_iso6432"):
                d["cat_generic"] = True
                d["pozn"] = f"válec mimo tabulky ({why}) — jako zástupný kvádr konceptu"
                continue
            self.cylinder(d, spec)

    def rod_dir(self, d, ax):
        """Směr vysunutí pístnice z konceptu: zástupná pístnice / zóna se jménem zařízení, jinak + (ODHAD)."""
        c = center(d["bb"])
        name = rules.fold(d["dev"] or d["tag"].lstrip("-"))
        for o in self.kon:
            lab = rules.fold(o["label"])
            if o.get("pid") == d["pid"]:
                continue
            if (re.search(rf"\b{re.escape(name)}\b", lab) and (o.get("pohyb") or "pistnic" in lab)) or \
                    (o["typ2"] == "zona" and re.search(rf"\b{re.escape(name)}\b", lab)):
                oc = center(o["bb"])
                dd = oc[ax] - c[ax]
                if abs(dd) > 1.0:
                    return 1 if dd > 0 else -1, o["label"]
        self.odhady.add(f"{d['tag']}: směr pístnice bez zástupné pístnice / zóny v konceptu — ODHAD +osa")
        return 1, None

    def cylinder(self, d, spec):
        pr = spec["params"]
        iso = spec["gen"] == "valec_iso15552"
        L = (pr["L8"] if iso else pr["S"]) + pr["zdvih"]
        E = pr["E"] if iso else pr["NA"]
        bb = d["bb"]
        s = size(bb)
        ax = max(range(3), key=lambda k: s[k])
        if sorted(s)[1] > E + 30 or abs(s[ax] - L) > 0.25 * L:
            self.odhady.add(f"{d['tag']}: obálka konceptu {r3(s)} ≠ válec {L:g} × {E:g} — poloha podle středu obálky")
        sg, src = self.rod_dir(d, ax)
        ex = unit(ax, sg)
        c = center(bb)
        rear = list(c)
        rear[ax] = bb[ax] if sg > 0 else bb[ax + 3]
        if abs(s[ax] - L) > 0.25 * L:
            rear[ax] = c[ax] - sg * L / 2
        # podpora: čelo zadního víka × nosná konstrukce, jinak plocha pod válcem
        body = None
        ez = None
        mount = None
        for name, su in self.supports.items():
            ts = touch_side(bb, su["obj"]["bb"])
            if ts is None:
                continue
            k, side, area = ts
            if k == ax and side == -sg:
                mount = ("celo", name)
                break
        if ax != 2:
            ez = [0.0, 0.0, 1.0]
        else:
            ez = [1.0, 0.0, 0.0]
            for name, su in self.supports.items():
                ts = touch_side(bb, su["obj"]["bb"])
                if ts and ts[0] != 2:
                    ez = unit(ts[0], -ts[1])
                    break
        fr = Frame(rear, ex, ez)
        bbody = fr.box(-pr.get("VA", 0), L, -E / 2, E / 2, -E / 2, E / 2)
        grp = f"G-{d['pid']}#{d['inst']}"
        model = part_model(self.pidx, d["pid"], self.folder)
        if not model or not model["exists"]:
            self.nepostaveno.append({"id": f"{d['pid']}#{d['inst']}", "co": d["label"],
                                     "duvod": "model válce v dily/ chybí (pro3d_parts gen) — válec nepostaven"})
            d["src"] = "chybi"
            return
        cyl = self.item(druh="valec", skupina=grp, pid=d["pid"], inst=d["inst"], tag=d["tag"], label=f"{d['tag']} {spec['nazev']}",
                        model=model["rel"], base=r3(rear), osy=fr.osy(), bb=r3(bbody), L=L, E=E, zdvih=pr["zdvih"],
                        zdroj=" | ".join(spec.get("zdroj") or []), smer_zdroj=src or "ODHAD", code=d["code"])
        d["item"] = cyl["id"]
        d["frame"] = fr
        d["spec"] = spec
        self.groups[grp] = {"co": cyl["label"], "pid": d["pid"]}
        # přípojky EE na horní ploše (ez), PL od čela víka (SMC CP96 / C85 — tabulka valce.json)
        PL = pr.get("PL")
        EE = pr.get("EE") or "G1/8"
        h = hose_for(EE)
        d["ports"] = []
        if not PL or not pr.get("EE_hole"):
            self.odhady.add(f"{d['tag']}: poloha přípojek EE v tabulce válce chybí (ISO 6432 / model bez přípojek) — hadice doplní stavitel")
        for nm, x in ((("zadni", PL), ("predni", L - PL)) if PL and pr.get("EE_hole") else ()):
            seat = fr.p(x, 0, E / 2)
            d["ports"].append({"id": f"{d['tag']}.{nm}", "seat": r3(seat), "n": r3(fr.ez), "thread": EE, "hose": h,
                               "tower": r3(mul(fr.ey, -1))})
        # upevnění
        if mount and mount[0] == "celo":
            self.mount_face(d, cyl, fr, pr, mount[1], grp)
        else:
            self.mount_feet(d, cyl, fr, pr, L, E, grp)
        if str(cyl.get("upevneni", "")).startswith("CHYBÍ"):      # bez upevnění se válec nestaví (nic ve vzduchu)
            self.items = [it for it in self.items if it.get("skupina") != grp]
            d.pop("item", None)
            d["ports"] = []
            d["src"] = "chybi_drzak"
            return
        # snímače polohy v drážce
        sw_qty = int((self.parts.get(f"{d['tag']}:cylinder_switch") or {}).get("qty") or 0)
        g = data()["geom"]
        ln, w, hh = g["snimac_valce"]
        xs = [g.get("snimac_valce_x", 3.0) + (pr.get("G") or 25.0), L - (pr.get("G") or 25.0) - ln - g.get("snimac_valce_x", 3.0)]
        sw_devs = [x for x in self.devices if x["pid"] == f"{d['tag']}:cylinder_switch" and x["src"] in ("valec", "koncept")]
        for k, sd in enumerate(sw_devs[:2]):
            x0 = xs[min(k, 1)]
            sbb = fr.box(x0, x0 + ln, E / 2, E / 2 + hh, -w / 2, w / 2)
            it = self.item(druh="zastupny", skupina=grp, pid=sd["pid"], inst=sd["inst"], tag=sd["tag"], bb=r3(sbb),
                           label=f"{sd['tag']} snímač polohy {'zasunuto' if k == 0 else 'vysunuto'} (zástupný 25×6×6, ODHAD)",
                           mount="drazka", code=sd["code"], pozn=g["snimac_valce_zdroj"] + "; poloha ODHAD — seřídit na stroji")
            sd.update(src="gen", bb=r3(sbb), item=it["id"], grp=grp, conn=r3(fr.p(x0, E / 2 + hh / 2, 0)), conn_n=r3(mul(fr.ex, -1)))
        if sw_qty and len(sw_devs) < sw_qty:
            pass
        self.odhady.add("snímače polohy válců: zástupné 25 × 6 × 6 v drážce (upnutí vlastním šroubem — PLCdesk_Mount drazka), "
                        "poloha koncových poloh ODHAD — seřídit")

    def mount_face(self, d, cyl, fr, pr, sname, grp):
        """Válec čelem zadního víka na nosné konstrukci: 4 × ISO 4762 do závitů RT (TG = R)."""
        su = self.supports[sname]
        sb = su["obj"]["bb"]
        ax = [k for k in range(3) if abs(fr.ex[k]) > 0.5][0]
        thick = size(sb)[ax]
        RT = pr.get("RT") or "M6x1"
        M = int(float(re.match(r"M(\d+)", RT).group(1)))
        R = pr["R"]
        L = self.screw_len(thick, min(pr.get("BG", 16) - 2, 1.5 * M))
        for sy in (-1, 1):
            for sz in (-1, 1):
                head = fr.p(-thick, sy * R / 2, sz * R / 2)
                self.screw(grp, M, L, head, r3(fr.ex), f"{d['tag']} čelo válce → „{su['obj']['label']}“")
                su["holes"].append(["cyl", *r3(fr.p(-thick - 0.5, sy * R / 2, sz * R / 2)), *r3(fr.ex), self.clear(M) / 2, thick + 1.0])
        if pr.get("VA"):
            su["holes"].append(["cyl", *r3(fr.p(-pr["VA"] - 0.5, 0, 0)), *r3(fr.ex), pr["B"] / 2 + 0.5, pr["VA"] + 0.6])
        cyl["upevneni"] = f"čelem zadního víka na „{su['obj']['label']}“, 4 × M{M}×{L} do závitů RT"

    def mount_feet(self, d, cyl, fr, pr, L, E, grp):
        """Patky (L úhelník) u obou vík: svislá stěna na čele víka (otvor pro nákružek), šrouby do horních závitů RT;
        vodorovná noha ven na nosné ploše pod válcem."""
        g = data()["geom"]
        t, lh = g["patka_t"], g["patka_l"]
        R, B = pr["R"], pr.get("B", 30.0)
        RT = pr.get("RT") or "M6x1"
        M = int(float(re.match(r"M(\d+)", RT).group(1)))
        ok = True
        built = []
        zc = fr.p(0, 0, 0)[2]
        bbody = cyl["bb"]
        # nosné konstrukce konceptu přímo pod tělem válce (podpěry) nahrazují patky — nepřevezmou se
        under = [n for n, su in self.supports.items() if rests_on(bbody, su["obj"]["bb"]) > 0]
        for end, x0, x1, sgn, outw, inw in (("zadní", -t, 0.0, -1, (-t - lh, -t), (-t, lh)),
                                            ("přední", L, L + t, 1, (L + t, L + t + lh), (L - lh, L + t))):
            if abs(fr.ez[2] - 1) > 1e-6:
                ok = False
                break
            pick = None
            for kind, (xl0, xl1) in (("ven", outw), ("pod tělo", inw)):
                foot = fr.box(xl0, xl1, -E / 2, E / 2, -E / 2, -E / 2 + 0.1)
                surf = self.surface_below(foot, zc - E / 2 + TOL, depth=300.0, exclude=under)
                if surf is None:
                    continue
                zs = surf[2][5]
                if kind == "pod tělo" and zs > zc - E / 2 - (t + 7.0):
                    continue                          # pod tělem není místo na nohu a hlavy šroubů
                zloc0 = zs - zc
                ztop = R / 2 + g["patka_nad_rt"]
                shape_add = [["box", *r3(fr.box(x0, x1, -E / 2, E / 2, zloc0, ztop))],
                             ["box", *r3(fr.box(xl0, xl1, -E / 2, E / 2, zloc0, zloc0 + t))]]
                if all(self.free_box(prim_box(p), ignore_sup=under, grp=grp) for p in shape_add):
                    pick = (kind, xl0, xl1, surf, zloc0, shape_add)
                    break
            if pick is None:
                ok = False
                break
            kind, xl0, xl1, surf, zloc0, shape_add = pick
            cut = [["cyl", *r3(fr.p(x0 - 1, 0, 0)), *r3(fr.ex), B / 2 + g["patka_vule_nakruzku"], t + 2]]
            fid = self.nid("PA")
            hl = []
            for sy in (-1, 1):
                pt = fr.p(x0 if sgn < 0 else x1, sy * R / 2, R / 2)
                ndir = r3(mul(fr.ex, -sgn))
                Ls = self.screw_len(t, min(pr.get("BG", 16) - 2, 1.5 * M))
                self.screw(grp, M, Ls, pt, ndir, f"{d['tag']} patka {end} → víko (RT)")
                cut.append(["cyl", *r3(fr.p((x0 if sgn < 0 else x1) - sgn * 0.5, sy * R / 2, R / 2)), *ndir, self.clear(M) / 2, t + 1])
            for sy in (-1, 1):
                hl.append(fr.p((xl0 + xl1) / 2, sy * (E / 2 - 9.0), zloc0 + t))
            built.append((fid, shape_add, cut, hl, surf, end))
        if not ok:
            self.nepostaveno.append({"id": f"{d['pid']}#{d['inst']}", "co": f"{d['label']} — upevnění",
                                     "duvod": "patky nelze umístit (pod nohou není nosná plocha nebo noha koliduje s rámem / konstrukcí) a čelo se o nosnou konstrukci neopírá — válec s upevněním doplní stavitel"})
            cyl["upevneni"] = "CHYBÍ (nestandardní upevnění)"
            return
        for fid, shape_add, cut, hl, surf, end in built:
            target = surf if surf[0] == "ram" else ("sup", surf[1], surf[2])
            holes = self.fasten_down(grp, hl, hl[0][2], [0.0, 0.0, -1.0], target, M=6, t=t, label=f"{d['tag']} patka {end} → podložka")
            self.item(id=fid, druh="konstrukce", skupina=grp, label=f"{d['tag']} patka {end} (L úhelník Al t{t:g}, návrh — ODHAD)",
                      add=shape_add, cut=cut + holes, pozn="ISO 15552 patka podle tvaru MS1 — vlastní návrh, rozměry ODHAD")
        for n in under:
            self.supports[n]["drop_force"] = f"nahrazena patkami válce {d['tag']}"
        cyl["upevneni"] = f"patky u obou vík (2 × M{M} do horních závitů RT, 2 × M6 do podložky)"
        self.odhady.add("patky válců: L úhelník Al t 8 mm, noha 40 mm (vlastní návrh, pevnost neověřena — ODHAD)")

    # --- 4. ostatní zařízení --------------------------------------------------------------------------------------
    def others(self):
        for d in self.devices:
            if d["src"] != "koncept" or (d["cat"] == "cylinder" and not d.get("cat_generic")) or d["cat"] == "cylinder_switch":
                continue
            self.device(d)

    def device(self, d):
        bb = list(d["bb"])
        grp = f"G-{d['pid']}#{d['inst']}"
        self.groups[grp] = {"co": d["label"], "pid": d["pid"]}
        model = part_model(self.pidx, d["pid"], self.folder)
        g = data()["geom"]
        on = None
        for name, su in self.supports.items():
            if rests_on(bb, su["obj"]["bb"]) > 0:
                on = ("sup", name, su["obj"]["bb"])
                break
        if on is None:
            rb = self.ram_below(bb, bb[2], depth=2.0)
            if rb:
                on = ("ram", rb[0], rb[1])
        threaded = model and model["exists"] and model["gen"] in ("snimac_valec",)
        press = model and model["exists"] and model["gen"] == "snimac_tlak"
        if threaded:
            return self.sensor_threaded(d, model, grp)
        if press:
            return self.sensor_pressure(d, model, grp, on)
        if on is None:
            self.nepostaveno.append({"id": f"{d['pid']}#{d['inst']}", "co": d["label"],
                                     "duvod": "pod zařízením konceptu není nosná plocha — držák doplní stavitel"})
            d["src"] = "chybi_drzak"
            return
        it = self.item(druh="zastupny", skupina=grp, pid=d["pid"], inst=d["inst"], tag=d["tag"], bb=r3(bb), code=d["code"],
                       label=f"{d['tag']} {d['type'].split(' — ')[0][:40] or d['cat']} (zástupný, obálka konceptu — ODHAD)",
                       pozn="rozměry = obálka konceptu (ODHAD, model výrobce chybí)")
        d.update(item=it["id"], grp=grp)
        if not self.free_box(bb, ignore_sup=(on[1],) if on[0] == "sup" else (), grp=grp):
            self.nepostaveno.append({"id": f"{d['pid']}#{d['inst']}", "co": d["label"], "duvod": "obálka konceptu koliduje s rámem"})
            return self.drop_group(d, grp)
        h = size(bb)[2]
        if d["cat"].startswith("sensor") or d["cat"] in ("light_curtain", "safety_switch"):
            ok = self.tabs(d, it, bb, on, grp)       # snímač vždy v držáku (úchytky), ne šrouby skrz těleso
        else:
            ok = (h <= 60.0 and self.through_bolts(d, it, bb, on, grp)) or self.tabs(d, it, bb, on, grp) or \
                (h > 60.0 and h <= 120.0 and self.through_bolts(d, it, bb, on, grp))
        if not ok:
            self.drop_group(d, grp)

    def through_bolts(self, d, it, bb, on, grp):
        """Dva svislé šrouby skrz zástupné zařízení (průchozí otvory — ventil / blok na liště, ODHAD polohy) do podložky."""
        s = size(bb)
        k = 0 if s[0] >= s[1] else 1
        o = 1 - k
        if s[o] < 9.0 or s[k] < 24.0:
            return False
        M = 4 if s[o] < 16 else 5
        c = center(bb)
        ob = on[2]
        pts = []
        for sg in (-1, 1):
            p = list(c)
            p[k] = c[k] + sg * (s[k] / 2 - 7.0)
            p[2] = bb[5]
            if not (ob[0] < p[0] < ob[3] and ob[1] < p[1] < ob[4]):
                return False
            pts.append(p)
        holes = self.fasten_down(grp, pts, bb[5], [0.0, 0.0, -1.0], on, M=M, t=s[2], label=f"{d['tag']} skrz zařízení → podložka")
        it.setdefault("cut", []).extend(holes)
        it["upevneni"] = f"2 × M{M} skrz zařízení do podložky (průchozí otvory — ODHAD)"
        self.odhady.add("zástupná zařízení na liště / desce: 2 šrouby skrz těleso (průchozí otvory, poloha ODHAD — podle výrobce)")
        return True

    def tabs(self, d, it, bb, on, grp):
        """Dvě úchytky (L, plech t3): svislá stěna na čele zařízení (šroub M4 do závitu v zástupném zařízení), vodorovná
        noha ven na podložce (šroub M5 do podložky / matice v drážce)."""
        g = data()["geom"]
        t, ln, w0, h0 = g["uchytka_t"], g["uchytka_l"], g["uchytka_s"], g["uchytka_h"]
        s = size(bb)
        c = center(bb)
        ob = on[2]
        choice = None
        for k in ((0, 1) if s[0] >= s[1] else (1, 0)):   # úchytky na koncích delšího půdorysného rozměru, jinak kratšího
            o = 1 - k
            w, h = min(w0, s[o] - 2.0), min(h0, s[2] - 2.0)
            if w < 6 or h < 8:
                continue
            ok = True
            for sgn in (-1, 1):
                face = bb[k + 3] if sgn > 0 else bb[k]
                lo_k, hi_k = sorted([face, face + sgn * (t + ln)])
                b = [0.0] * 6
                b[k], b[k + 3] = lo_k, hi_k
                b[o], b[o + 3] = c[o] - w / 2, c[o] + w / 2
                b[2], b[5] = bb[2], bb[2] + h
                foot = list(b)
                foot[5] = bb[2] + 0.1
                inside = ov1(foot[0], foot[3], ob[0], ob[3]) * ov1(foot[1], foot[4], ob[1], ob[4]) >= \
                    0.95 * (foot[3] - foot[0]) * (foot[4] - foot[1])
                if not inside or not self.free_box(b, grp=grp) or any(ovol(b, x["bb"]) > 1.0 for x in self.items
                                                              if x.get("bb") and x.get("skupina") != grp and x["druh"] != "sroub"):
                    ok = False
                    break
            if ok:
                choice = (k, o, w, h)
                break
        if choice is None:
            self.nepostaveno.append({"id": f"{d['pid']}#{d['inst']}", "co": d["label"],
                                     "duvod": "úchytky nelze umístit (malé zařízení, noha mimo podložku nebo kolize se sousedem / rámem) — "
                                              "zařízení s držákem doplní stavitel"})
            return False
        k, o, w, h = choice
        for sgn in (-1, 1):
            face = bb[k + 3] if sgn > 0 else bb[k]
            lo, hi = [0.0] * 3, [0.0] * 3
            # svislá stěna
            v = [[0, 0], [0, 0], [bb[2], bb[2] + h]]
            v[k] = sorted([face, face + sgn * t])
            v[o] = [c[o] - w / 2, c[o] + w / 2]
            hz = [[0, 0], [0, 0], [bb[2], bb[2] + t]]
            hz[k] = sorted([face + sgn * t, face + sgn * (t + ln)])
            hz[o] = v[o]
            add_ = [["box", v[0][0], v[1][0], v[2][0], v[0][1], v[1][1], v[2][1]],
                    ["box", hz[0][0], hz[1][0], hz[2][0], hz[0][1], hz[1][1], hz[2][1]]]
            tid = self.nid("UC")
            n_in = unit(k, -sgn)
            sp = list(c)
            sp[k] = face + sgn * t
            sp[2] = bb[2] + min(h - 5.0, max(t + 5.5, h * 0.6))
            self.item(id=tid, druh="konstrukce", skupina=grp, label=f"{d['tag']} úchytka {'+' if sgn > 0 else '−'} (plech t{t:g}, návrh — ODHAD)",
                      add=[[a[0], *r3(a[1:])] for a in add_],
                      cut=[["cyl", *r3(sub(sp, mul(n_in, -0.5))), *r3(n_in), self.clear(4) / 2, t + 1]], pozn="úchytka — vlastní návrh, ODHAD")
            self.screw(grp, 4, self.screw_len(t, 8.0), sp, r3(n_in), f"{d['tag']} úchytka → zařízení")
            self.tap(it["id"], add(sp, mul(n_in, t)), n_in, 4, 8.0)
            fp = list(c)
            fp[k] = face + sgn * (t + ln / 2)
            fp[2] = bb[2] + t
            holes = self.fasten_down(grp, [fp], fp[2], [0.0, 0.0, -1.0], on if on[0] != "sup" else on, M=5, t=t,
                                     label=f"{d['tag']} úchytka → podložka")
            for itx in self.items:
                if itx["id"] == tid:
                    itx["cut"] += holes
        it["upevneni"] = "2 úchytky (M4 do zařízení, M5 do podložky)"
        return True

    def drop_group(self, d, grp):
        self.items = [x for x in self.items if x.get("skupina") != grp]
        self.predani = [p for p in self.predani if p.get("grp") != grp]
        d.pop("item", None)
        d["src"] = "chybi_drzak"

    def sensor_threaded(self, d, model, grp):
        """Snímač se závitem (M12 / M18 — model pro3d_parts snimac_valec, osa x, čelo x = 0): držák z plechu t3 kolmo
        k ose za první maticí, noha na podložce s podélnými otvory (± 5 mm seřízení)."""
        bb = d["bb"]
        s = size(bb)
        ax = max(range(3), key=lambda k: s[k])
        mb = model["bbox"] or [0, 45, -9.8, 9.8, -8.5, 8.5]
        tot = mb[1] - mb[0]
        # čelo snímače k nejbližší zóně / dílu konceptu, jinak +Z
        c = center(bb)
        rad = max(abs(mb[2]), abs(mb[3]), abs(mb[4]), abs(mb[5])) + 0.1
        if ax != 2 and c[2] - rad < bb[2] - 0.01:          # obálka konceptu nižší než matice modelu → osu zvednout
            c[2] = bb[2] + rad
            self.odhady.add(f"{d['tag']}: osa snímače zvednuta na {c[2]:.1f} mm (matice modelu vyšší než obálka konceptu)")
        sgn = 1
        best = None
        for o in self.kon:
            if o["typ2"] == "zona" or "dil pod" in rules.fold(o["label"]):
                oc = center(o["bb"])
                dist = math.dist(oc, c)
                if best is None or dist < best[0]:
                    best = (dist, 1 if oc[ax] > c[ax] else -1)
        if best:
            sgn = best[1]
        else:
            self.odhady.add(f"{d['tag']}: směr čela snímače bez zóny v konceptu — ODHAD")
        face = list(c)
        face[ax] = bb[ax + 3] if sgn > 0 else bb[ax]
        ex = unit(ax, -sgn)                      # model: čelo x = 0, tělo do +x
        ez = [0.0, 0.0, 1.0] if ax != 2 else [1.0, 0.0, 0.0]
        fr = Frame(face, ex, ez)
        # držák: deska kolmo k ose za první maticí (konec závitu modelu = thread_len z katalog.json), dolů k podložce
        g = data()["geom"]
        t = g["drzak_t"]
        ks = (cm.katalog_spec(d["code"]) if cm else None) or {}
        kp = ks.get("params") or {}
        lt = float(kp.get("thread_len") or tot * 0.55)
        dthr = float(kp.get("d") or 12.0)
        if ax == 2:
            self.nepostaveno.append({"id": f"{d['pid']}#{d['inst']}", "co": d["label"],
                                     "duvod": "svislý snímač — držák kódem jen pro vodorovnou osu; snímač i držák doplní stavitel"})
            d["src"] = "chybi_drzak"
            return
        zc = c[2]
        foot_probe = fr.box(lt, lt + t + g["drzak_noha"], -g["drzak_sirka"] / 2, g["drzak_sirka"] / 2, -10, -9.9)
        surf = self.surface_below(foot_probe, zc - 10.0, depth=250.0)
        if surf is None:
            self.nepostaveno.append({"id": f"{d['pid']}#{d['inst']}", "co": d["label"],
                                     "duvod": "pod snímačem není nosná plocha do 250 mm — snímač s držákem doplní stavitel"})
            d["src"] = "chybi_drzak"
            return
        item = self.item(druh="model", skupina=grp, pid=d["pid"], inst=d["inst"], tag=d["tag"], model=model["rel"], base=r3(face),
                         osy=fr.osy(), bb=r3(fr.box(0, tot, -9.9, 9.9, -9.9, 9.9)), label=f"{d['tag']} {d['type'].split(' — ')[0]}",
                         mount="zavit", code=d["code"], zdroj=model["zdroj"])
        d.update(item=item["id"], grp=grp, conn=r3(fr.p(tot, 0, 0)), conn_n=r3(fr.ex))
        zs = surf[2][5]
        w = g["drzak_sirka"]
        top = zc + 15.0
        plate = box_of(fr.p(lt, -w / 2, 0), fr.p(lt + t, w / 2, 0))
        plate[2], plate[5] = zs, top
        legx0, legx1 = sorted([fr.p(lt, 0, 0)[ax], fr.p(lt + t + g["drzak_noha"], 0, 0)[ax]])
        leg = list(plate)
        leg[ax], leg[ax + 3] = legx0, legx1
        leg[5] = zs + t
        if not (self.free_box(fr.box(0, tot, -rad, rad, -rad, rad), grp=grp) and self.free_box(plate, grp=grp) and self.free_box(leg, grp=grp)):
            self.nepostaveno.append({"id": f"{d['pid']}#{d['inst']}", "co": d["label"],
                                     "duvod": "snímač nebo držák koliduje s rámem / nosnou konstrukcí — doplní stavitel"})
            return self.drop_group(d, grp)
        tid = self.nid("DR")
        fp = fr.p(lt + t + g["drzak_noha"] / 2, 0, 0)
        fp[2] = zs + t
        target = surf if surf[0] == "ram" else ("sup", surf[1], surf[2])
        holes = self.fasten_down(grp, [fp], fp[2], [0.0, 0.0, -1.0], target, M=5, t=t, label=f"{d['tag']} držák → podložka")
        slot = []
        for hl in holes:              # podélný otvor ± 5 mm ve směru osy snímače (seřízení)
            rr, dd = g["drzak_drazka"], self.clear(5) / 2
            for dsh in (-rr, rr):
                h2 = list(hl)
                h2[1 + ax] += dsh
                slot.append(h2)
            o2 = 1 - ax if ax < 2 else 0
            lo_, hi_ = list(hl[1:4]), list(hl[1:4])
            lo_[ax] -= rr
            hi_[ax] += rr
            lo_[o2] -= dd
            hi_[o2] += dd
            lo_[2] = hl[3] - (t + 1.0)
            slot.append(["box", *r3(box_of(lo_, hi_))])
        hole = ["cyl", *r3(fr.p(lt - 0.5, 0, 0)), *r3(fr.ex), round(dthr / 2 + 0.1, 3), t + 1]
        self.item(id=tid, druh="konstrukce", skupina=grp, label=f"{d['tag']} držák snímače (plech t{t:g}, podélné otvory ± 5 mm, návrh — ODHAD)",
                  add=[["box", *r3(plate)], ["box", *r3(leg)]], cut=[hole] + holes + slot,
                  pozn="držák snímače — vlastní návrh, ODHAD; snímač upnut maticemi (seřízení závitem + podélné otvory)")
        d["drzak"] = tid
        self.odhady.add("držáky snímačů: plech t 3, šířka 30, noha 30, podélné otvory ± 5 mm (ODHAD); spínací vzdálenost × "
                        "pozadí změřit na stroji")

    def sensor_pressure(self, d, model, grp, on):
        """Snímač tlaku G1/4 (model pro3d_parts snimac_tlak, osa z, závit dole) na zástupném rozvodném bloku (ODHAD)."""
        bb = d["bb"]
        g = data()["geom"]
        bx, by, bz = g["blok_tlak"]
        c = center(bb)
        if on is None:
            self.nepostaveno.append({"id": f"{d['pid']}#{d['inst']}", "co": d["label"], "duvod": "pod snímačem tlaku není podložka"})
            d["src"] = "chybi_drzak"
            return
        z0 = bb[2]
        blk = [c[0] - bx / 2, c[1] - by / 2, z0, c[0] + bx / 2, c[1] + by / 2, z0 + bz]
        mb = model["bbox"] or [-9.5, 9.5, -9.5, 9.5, 0, 66]
        tl = 12.0
        thr_r = thread_d("G1/4") / 2
        bid = self.nid("BL")
        it_blk = self.item(id=bid, druh="zastupny", skupina=grp, tag=d["tag"], bb=r3(blk),
                           label=f"{d['tag']} rozvodný blok G1/4 (zástupný 32×32×24 — ODHAD, mimo kusovník)",
                           cut=[["cyl", c[0], c[1], z0 + bz - tl, 0, 0, 1, round(thr_r + 0.05, 3), tl + 1]],
                           pozn="rozvodný blok snímače tlaku — ODHAD; přípojka podle pneumatického schématu")
        base = [c[0], c[1], z0 + bz - tl]
        fr = Frame(base, [1.0, 0.0, 0.0], [0.0, 0.0, 1.0])
        item = self.item(druh="model", skupina=grp, pid=d["pid"], inst=d["inst"], tag=d["tag"], model=model["rel"], base=r3(base),
                         osy=fr.osy(), bb=r3([c[0] + mb[0], c[1] + mb[2], base[2] + mb[4], c[0] + mb[1], c[1] + mb[3], base[2] + mb[5]]),
                         label=f"{d['tag']} {d['type'].split(' — ')[0]}", mount="zavit", code=d["code"], zdroj=model["zdroj"])
        d.update(item=item["id"], grp=grp, conn=r3([c[0], c[1], base[2] + mb[5]]), conn_n=[0.0, 0.0, 1.0])
        self.odhady.add(f"{d['tag']}: snímač tlaku na rozvodném bloku zvednut o {bz - tl:g} mm proti konceptu (ODHAD)")
        if not self.free_box(blk, ignore_sup=(on[1],) if on[0] == "sup" else (), grp=grp) or not self.tabs(d, it_blk, blk, on, grp):
            self.drop_group(d, grp)

    # --- 5. pneumatika: přípojky, šroubení, hadice -----------------------------------------------------------------
    def valve_ports(self, d):
        """Zástupný rozváděč: přípojky 2 / 4 na horní ploše ve směru delšího půdorysného rozměru (ODHAD)."""
        bb = d["bb"]
        s = size(bb)
        k = 0 if s[0] >= s[1] else 1
        c = center(bb)
        out = {}
        for nm, f in (("2", -0.25), ("4", 0.25)):
            p = list(c)
            p[k] += f * s[k]
            p[2] = bb[5]
            out[nm] = {"id": f"{d['tag']}.{nm}", "seat": r3(p), "n": [0.0, 0.0, 1.0], "thread": "G1/8", "hose": hose_for("G1/8")}
        self.odhady.add("rozváděče (zástupné): přípojky 2 / 4 G1/8 na horní ploše (ODHAD — model výrobce chybí); přiřazení 4 → zadní, "
                        "2 → přední přípojka válce = ODHAD, ověřit pneumatické schéma")
        return out

    def fitting(self, port, kind, grp, host):
        """Šroubení QS (rovné) nebo GRLA (škrticí, věž kolmo) do přípojky; vrací ústí soketu (bod, směr ven)."""
        n = port["n"]
        seat = port["seat"]
        td = thread_d(port["thread"])
        if kind == "qs":
            q = data()["qs"]
            mouth = add(seat, mul(n, q["nad_dosedem"]))
            prims = [["cyl", *r3(sub(seat, mul(n, q["zavit"]))), *r3(n), round(td / 2, 3), q["zavit"]],
                     ["cyl", *r3(seat), *r3(n), round(q["sw"] / 2, 3), q["sestihran_h"]],
                     ["cyl", *r3(add(seat, mul(n, q["sestihran_h"]))), *r3(n), round(td / 2 + q["pouzdro_r_navic"], 3),
                      round(q["nad_dosedem"] - q["sestihran_h"], 3)]]
            label = f"{port['hose']['qs']} šroubení {port['id']} (zástupné, rozhraní dle skillu festo-pneumatics)"
            out_n = n
            code = port["hose"].get("qs_kod", "")
        else:
            q = data()["grla"]
            t = port.get("tower") or [0.0, -1.0, 0.0]
            axc = add(seat, mul(n, q["rameno"]))
            mouth = add(axc, mul(t, q["vez"]))
            s2 = q["rameno_s"] / 2
            arm = box_of(sub(add(seat, [0, 0, 0]), [s2 * (abs(n[0]) < 0.5), s2 * (abs(n[1]) < 0.5), s2 * (abs(n[2]) < 0.5)]),
                         add(add(seat, mul(n, q["rameno"] + s2)), [s2 * (abs(n[0]) < 0.5), s2 * (abs(n[1]) < 0.5), s2 * (abs(n[2]) < 0.5)]))
            prims = [["cyl", *r3(sub(seat, mul(n, q["zavit"]))), *r3(n), round(td / 2, 3), q["zavit"]],
                     ["box", *r3(arm)],
                     ["cyl", *r3(axc), *r3(t), q["vez_r"], q["vez"]]]
            label = f"{port['hose']['grla']} škrticí ventil {port['id']} (zástupný, rozhraní dle skillu festo-pneumatics)"
            out_n = t
            code = port["hose"].get("grla_kod", "")
        bb = None
        for p in prims:
            pb = prim_box(p)
            bb = pb if bb is None else [min(bb[i], pb[i]) for i in range(3)] + [max(bb[i + 3], pb[i + 3]) for i in range(3)]
        body_bb = union_box([prim_box(p) for p in prims[1:]])
        if not self.free_box(body_bb, grp=grp):                 # šroubení koliduje s úchytkou / sousedem / rámem
            self.nepostaveno.append({"id": port["id"], "co": label, "duvod": "šroubení koliduje s jiným dílem — hadici doplní stavitel"})
            return None
        it = self.item(druh="sroubeni", skupina=grp, label=label, add=prims, bb=r3(bb), code=code, host=host,
                       pozn=data()[kind]["_zdroj"])
        self.odhady.add("šroubení QS a škrticí ventily GRLA: zástupné válce s rozhraním změřeným ve skillu festo-pneumatics (dosed, ústí, "
                        "věž) — vnější tvar ODHAD")
        return {"mouth": r3(mouth), "n": r3(out_n), "item": it["id"]}

    def pneumatics(self):
        rel = [r for r in self.m.get("relations") or [] if r.get("kind") == "actuates"]
        dev_by = {}
        for d in self.devices:
            dev_by.setdefault(d["pid"], []).append(d)
        self.hoses = []
        valves_done = {}
        for r in rel:
            vs, cs = dev_by.get(r["from"]) or [], dev_by.get(r["to"]) or []
            if not vs or not cs:
                continue
            v, c = vs[0], cs[0]
            if v["src"] != "koncept" or not c.get("ports") or not v.get("item"):
                why = ("rozváděč není stavěn kódem" if v["src"] != "koncept" or not v.get("item") else "válec bez přípojek (nestavěn)")
                self.nepostaveno.append({"id": f"hadice {r['from']} → {r['to']}", "co": "hadice A / B", "duvod": why})
                continue
            vp = valves_done.get(v["pid"]) or self.valve_ports(v)
            valves_done[v["pid"]] = vp
            for vport, cport in (("4", 0), ("2", 1)):
                vp_ = vp[vport]
                cp = c["ports"][cport]
                fa = self.fitting(vp_, "qs", v["grp"], v["item"])
                fb = self.fitting(cp, "grla", c.get("grp") or f"G-{c['pid']}#{c['inst']}", c.get("item"))
                if fa is None or fb is None:
                    continue
                h = cp["hose"]
                self.hoses.append({"id": f"H-{c['tag'].lstrip('-')}-{'A' if vport == '4' else 'B'}", "medium": h["medium"],
                                   "od": vp_["id"], "do": cp["id"], "a": fa, "b": fb, "skupina": "pneu",
                                   "pohyb": False, "zasun": data()["qs"]["zasun"]})
        # rozvod P: bezpečnostní ventil / úprava vzduchu → nosná lišta rozváděčů (zástupná nosná konstrukce s rozváděči)
        sv = [d for d in self.devices if d["cat"] in ("safety_valve", "filter_regulator", "service_unit") and d.get("item")]
        rails = {}
        for d in self.devices:
            if d["cat"] == "valve_solenoid" and d.get("item"):
                for name, su in self.supports.items():
                    if su["zast"] and rests_on(d["bb"], su["obj"]["bb"]) > 0:
                        rails.setdefault(name, []).append(d)
        if sv and rails:
            s0 = sv[-1]
            rail = sorted(rails, key=lambda n: math.dist(center(self.supports[n]["obj"]["bb"]), center(s0["bb"])))[0]
            rb = self.supports[rail]["obj"]["bb"]
            sc = center(s0["bb"])
            rc = center(rb)
            k = 0 if abs(rc[0] - sc[0]) >= abs(rc[1] - sc[1]) else 1
            sg = 1 if rc[k] > sc[k] else -1
            ps = list(sc)
            ps[k] = s0["bb"][k + 3] if sg > 0 else s0["bb"][k]
            pr_ = list(rc)
            pr_[k] = rb[k] if sg > 0 else rb[k + 3]
            pr_[2] = (rb[2] + rb[5]) / 2
            hs = data()["rozvod_P"]
            th = "G1/4"
            p_out = {"id": f"{s0['tag']}.2", "seat": r3(ps), "n": r3(unit(k, sg)), "thread": th,
                     "hose": dict(hose_for(th), medium=hs["medium"])}
            p_in = {"id": f"lista.P", "seat": r3(pr_), "n": r3(unit(k, -sg)), "thread": th, "hose": dict(hose_for(th), medium=hs["medium"])}
            fa = self.fitting(p_out, "qs", s0["grp"], s0["item"])
            fb = self.fitting(p_in, "qs", f"S-{rail}", None) if fa else None
            if fa:
                self.port_hole(s0["item"], p_out)
            if fb:
                self.supports[rail]["holes"].append(port_hole_prim(p_in))
        if sv and rails and fa and fb:
            self.hoses.append({"id": "H-P-1", "medium": hs["medium"], "od": p_out["id"], "do": p_in["id"], "a": fa, "b": fb,
                               "skupina": "pneu", "pohyb": False, "zasun": data()["qs"]["zasun"]})
            self.odhady.add(f"rozvod P: {s0['tag']} → lišta rozváděčů, přípojky G1/4 (ODHAD); přívod z rozvodu haly a napájení "
                            "proporcionálních ventilů podle schématu doplní stavitel")
        # díry přípojek v zástupných rozváděčích
        for pid, vp in valves_done.items():
            v = next(x for x in self.devices if x["pid"] == pid)
            for port in vp.values():
                self.port_hole(v["item"], port)

    def port_hole(self, item_id, port):
        for it in self.items:
            if it["id"] == item_id:
                it.setdefault("cut", []).append(port_hole_prim(port))
                return

    # --- 6. trasy ------------------------------------------------------------------------------------------------
    def obstacles_now(self, skip=()):
        out = list(self.ram_obst)
        for it in self.items:
            if it.get("skupina") in skip or it["id"] in skip:
                continue
            if it.get("bb"):
                out.append(it["bb"])
            for p in it.get("add") or []:
                out.append(prim_box(p))
        for s in self.supports.values():
            out.append(list(s["obj"]["bb"]))
        return out

    def plates(self):
        """Tenké desky / plechy rámu, kterými může vést průchod (požadavek na rám)."""
        out = []
        for o in self.ram_real:
            if o["typ2"] not in ("dil", "kryt", "vypln"):
                continue
            for bx in (o.get("boxes") or [o["bb"]]):
                if min(size(bx)) <= 30.0 and max(size(bx)) >= 150.0:
                    out.append((o, bx))
        return out

    def route_all(self):
        tr = trasa_mod()
        self.routes = []
        if tr is None:
            self.nepostaveno.append({"id": "trasy", "co": "hadice a kabely", "duvod": "skill kabelaz-a-hadice (scripts/trasa.py) není nainstalován"})
            return
        media = tr.nacti_media()
        used = []
        plate_list = self.plates()
        plate_keys = {tuple(bx) for _o, bx in plate_list}
        base_obst = [b for o in self.ram_real if o["typ2"] not in ("zona", "pomocny")
                     for b in (o.get("boxes") or [o["bb"]]) if tuple(b) not in plate_keys]
        own = []
        for it in self.items:
            if it["druh"] in ("sroub", "matice"):
                continue
            own.append((it.get("skupina"), it["id"], it.get("bb") or union_box([prim_box(p) for p in it.get("add") or []])))
        for s in self.supports.values():
            own.append((None, None, list(s["obj"]["bb"])))
        prof = [o["bb"] for o in self.ram_real if o["typ2"] == "profil"]
        jobs = [("hadice", h) for h in getattr(self, "hoses", [])] + [("kabel", c) for c in self.cables()]
        for kind, j in jobs:
            med = tr._medium({"medium": j["medium"]} if isinstance(j["medium"], str) else {"medium": j["medium"]}, media)
            D = float(j.get("D") or med.get("D") or 5.0)
            req = tr.pozadovany_polomer(med, "pevne", D)
            R = float(req["doporuceny"] or req["min"])
            a, b = j["a"], j["b"]
            zas = j.get("zasun", 0.0)
            konec = 15.0
            p0 = sub(a["mouth"], mul(a["n"], zas))
            p3 = sub(b["mouth"], mul(b["n"], zas))
            stub = konec + R + 4.0
            p1 = add(a["mouth"], mul(a["n"], stub))
            p2 = add(b["mouth"], mul(b["n"], stub))
            skip_ids = {a.get("item"), b.get("item"), a.get("host"), b.get("host")}
            infl = D / 2 + 3.0 + 0.15 * R + 0.5
            mine = [bx for (_g, iid, bx) in own if iid not in skip_ids and bx] + used
            mine = [bx for bx in mine if not (router.point_in(p1, router.inflate(bx, infl)) or
                                              router.point_in(p2, router.inflate(bx, infl)))]
            obst = list(base_obst) + mine
            step = 20.0 if math.dist(p1, p2) < 900 else 40.0
            # 1) volná trasa mezi překážkami (desky rámu jsou překážky); 2) když není: pravoúhlá spojnice jako ODHAD délky
            #    a průchody deskami rámu na ní = požadavek na rám (trasa se nestaví)
            res = router.route(p1, a["n"], p2, [-x for x in b["n"]], obst + [bx for _o, bx in plate_list], R=R, r_med=D / 2, clear=3.0 + 0.15 * R,
                               step=step, prefer=prof, max_nodes=120000)
            t = {"id": j["id"], "oznaceni": j.get("oznaceni") or j["id"], "od": j["od"], "do": j["do"], "medium": j["medium"],
                 "D": D, "ulozeni": "pohyblive" if j.get("pohyb") else "pevne", "skupina": j["skupina"],
                 "partId": j.get("partId"), "konec_rovny_mm": konec,
                 "rezerva": data()["kabel" if kind == "kabel" else "hadice"]["rezerva"]}
            if res is None:
                why = {"start": "výstup trasy u zařízení je v překážce", "cil": "konec trasy je v překážce",
                       "limit uzlu": "router nenašel volnou trasu v limitu hledání", "bez cesty": "mezi překážkami není volná cesta"}.get(
                    router.LAST.get("fail"), "trasa nenalezena")
                mid = dedupe([r3(p0), r3(p1), [p1[0], p1[1], p2[2]], [p2[0], p1[1], p2[2]], r3(p2), r3(p3)])
                t["body"] = mid
                lom = sum(math.dist(mid[i], mid[i + 1]) for i in range(len(mid) - 1))
                rz = t["rezerva"]
                ev = tr.posud_trasu(dict(t), media)
                ev = dict(ev, chyby=[], delka_mm=round(lom, 1), delka_s_rezervou_mm=round(lom * (1 + rz["pct"] / 100) + rz["mm"], 1),
                          odhad=True, varovani=(ev.get("varovani") or []) + [f"délka = ODHAD pravoúhlou spojnicí ({why})"])
                crossing = []
                for p, q in zip(mid, mid[1:]):
                    for o, bx in plate_list:
                        if router.seg_hits(p, q, bx):
                            c = [min(max((p[i] + q[i]) / 2, bx[i]), bx[i + 3]) for i in range(3)]
                            if all(x["deska"] != o["label"] for x in crossing):
                                crossing.append({"deska": o["label"], "bod": r3(c), "kryt": o["typ2"] in ("kryt", "vypln")})
                for cr in crossing:
                    if cr.get("kryt"):               # kryt / výplň ochranného prostoru se nevrtá — trasu vést jinudy
                        continue
                    self.predani.append({"co": f"průchod Ø{D + 10:.0f} v „{cr['deska']}“ (na pravoúhlé spojnici — poloha ODHAD)",
                                         "bod": cr["bod"], "proc": f"{kind} {j['id']} ({j['od']} → {j['do']})"})
                if any(cr.get("kryt") for cr in crossing):
                    why += " — spojnice vede přes kryt (kryt se nevrtá, trasu vést jinudy)"
                self.routes.append({"druh": kind, "trasa": t, "vysledek": ev, "postavit": False, "pruchody": crossing,
                                    "duvod": why + (" — spojnice prochází deskou rámu (průchod = požadavek na rám)" if crossing else "")})
                self.nepostaveno.append({"id": j["id"], "co": f"{kind} {j['od']} → {j['do']}",
                                         "duvod": f"trasa nestavěna — {why}" + ("; průchody deskou rámu = požadavek na rám" if crossing else "")
                                                  + "; délka = ODHAD"})
                continue
            crossing = []
            body = dedupe([r3(p0)] + res["body"] + [r3(p3)])
            t["body"] = body
            ev = tr.posud_trasu(t, media)
            ok = not ev["chyby"]
            if ev["chyby"]:
                self.nepostaveno.append({"id": j["id"], "co": f"{kind} {j['od']} → {j['do']}", "duvod": "; ".join(ev["chyby"][:2])})
            self.routes.append({"druh": kind, "trasa": t, "vysledek": ev, "postavit": ok, "pruchody": crossing})
            if ok:
                used += router.segments_boxes(body, D / 2 + 1.5)

    def cables(self):
        """Kabel od každého zařízení s kabelem k rozvaděči (vstup pod skříní)."""
        if not self.cab:
            self.nepostaveno.append({"id": "kabely", "co": "kabely v poli", "duvod": "rozvaděč není v rámu ani v konceptu — cíl tras CHYBÍ"})
            return []
        kc = data()["kategorie_kabel"]
        sig, pwr = set(kc["signal"]), set(kc["silovy"])
        cab = self.cab
        bb = cab["bb"]
        jobs = []
        cab_part = next((p for p in self.m.get("parts") or [] if p.get("category") == "cable_sensor"), None)
        n = 0
        rozt = data()["kabel"]["rozteč_vstupu"]
        seen = set()
        vz = data()["kabel"]["vstup_rozvadec_mm"]
        below = [bb[0], bb[1], bb[2] - vz - 25.0, bb[3], bb[4], bb[2] - 0.5]
        # vstup zdola (vývodky ve dně — ROZVADEC.md); stojí-li skříň na desce / konzolách, vstup zadní stěnou dole
        k_d, s_d = cab["dvere"]
        back = self.collides_ram(below) is not None
        if back:
            self.odhady.add("vstup kabelů do rozvaděče: pod dnem je deska / konzola rámu — kabely zadní stěnou dole (ODHAD, vývodky "
                            "v zadní stěně = zpětná vazba rozvaděči)")
        for d in self.devices:
            if d["cat"] not in sig | pwr or d["src"] in ("chybi", "chybi_drzak", "ram_bez_id", "valec") or \
                    (d["cat"] == "cylinder_switch" and d["src"] != "ram" and not d.get("item")):
                continue
            key = (d["pid"], d["inst"])
            if key in seen:
                continue
            seen.add(key)
            conn, cn = d.get("conn"), d.get("conn_n")
            if conn is None:
                conn, cn = self.free_face(d)
                if conn is None:
                    self.nepostaveno.append({"id": f"kabel {d['pid']}#{d['inst']}", "co": f"kabel {d['tag']}",
                                             "duvod": "u zařízení není volná strana pro vývod kabelu (kryt / pult) — doplní stavitel"})
                    continue
            # vstup do rozvaděče: řada bodů pod dnem skříně (rozteč 15 mm), kabel přichází zdola
            cols = max(1, int((size(bb)[0] - 60) // rozt))
            ix, iy = n % cols, n // cols
            n += 1
            if back:
                o_ax = 1 - k_d if k_d < 2 else 0
                ent = [0.0, 0.0, bb[2] + 40 + iy * rozt]
                ent[o_ax] = bb[o_ax] + 30 + ix * rozt
                ent[k_d] = (bb[k_d] - vz) if s_d > 0 else (bb[k_d + 3] + vz)
                ent_n = unit(k_d, -1 if s_d > 0 else 1)
            else:
                ent = [bb[0] + 30 + ix * rozt, bb[1] + size(bb)[1] / 2 + (iy % 3 - 1) * rozt, bb[2] - vz]
                ent_n = [0.0, 0.0, -1.0]
            silovy = d["cat"] in pwr
            if silovy:
                mm = data()["kabel"]["medium_motor"]
                med, D, part_id = mm["id"], mm["D"], None
            elif d["cat"] in ("valve_solenoid", "proportional_valve"):
                med, D, part_id = dict(data()["kabel"]["medium_ventil"], id="ventil_odhad"), 4.3, None
            else:
                med = data()["kabel"]["medium_snimac"]
                D, part_id = None, (cab_part or {}).get("id")
            short = {"valve_solenoid": "V", "proportional_valve": "V", "cylinder_switch": "B"}.get(d["cat"], "")
            jobs.append({"id": f"W-{d['tag'].lstrip('-')}{('-' + short) if short else ''}{d['inst'] if (short == 'B' or d['inst'] > 1) else ''}",
                         "oznaceni": f"{d['tag']} → {cab['pid'].split(':')[0]}", "od": d["tag"], "do": cab["pid"].split(":")[0],
                         "medium": med, "D": D, "skupina": "silovy" if silovy else "signal", "partId": part_id,
                         "a": {"mouth": r3(conn), "n": r3(cn), "item": d.get("item"), "host": d.get("item")},
                         "b": {"mouth": r3(ent), "n": r3(ent_n), "item": None}, "zasun": 0.0, "dev": d})
        if any(j["skupina"] == "signal" and j["dev"]["cat"] == "cylinder_switch" for j in jobs):
            self.odhady.add("snímače polohy válců (konektor M8) připojeny kabelem jako EVC002 (M12) — konektor neodpovídá (zpětná vazba)")
        return jobs

    def free_face(self, d):
        """Volná strana obálky zařízení (žádná překážka rámu do 30 mm) nejblíž rozvaděči."""
        bb = d["bb"]
        if not bb:
            return None, None
        best = None
        gc = center(self.cab["bb"])
        c = center(bb)
        for k in range(3):
            for sg in (-1, 1):
                p = list(c)
                p[k] = bb[k + 3] if sg > 0 else bb[k]
                probe = list(bb)
                if sg > 0:
                    probe[k], probe[k + 3] = bb[k + 3], bb[k + 3] + 30.0
                else:
                    probe[k], probe[k + 3] = bb[k] - 30.0, bb[k]
                if self.collides_ram(probe):
                    continue
                dist = math.dist(add(p, mul(unit(k, sg), 30)), gc)
                if best is None or dist < best[0]:
                    best = (dist, p, unit(k, sg))
        if best is None:
            return None, None
        self.odhady.add("vývod kabelu u zařízení bez modelu konektoru: střed volné strany obálky nejblíž rozvaděči (ODHAD)")
        return r3(best[1]), best[2]

    # --- výstup --------------------------------------------------------------------------------------------------
    def run(self):
        self.collect_devices()
        self.collect_supports()
        for name, s in self.supports.items():
            s["grp"] = f"S-{name}"
            self.groups[s["grp"]] = {"co": s["obj"]["label"], "pid": ""}
        self.cylinders()
        self.others()
        # nosné konstrukce: šrouby k podkladu (po zařízeních — díry zařízení známe)
        for name, s in self.supports.items():
            on = s["on"]
            bb = s["obj"]["bb"]
            if on is None:
                self.nepostaveno.append({"id": name, "co": f"nosná konstrukce „{s['obj']['label']}“",
                                         "duvod": "nestojí na rámu ani na jiné nosné konstrukci — upevnění doplní stavitel"})
                s["upevneni"] = "CHYBÍ"
                continue
            if s.get("drop_force") and not s["holes"]:
                s["drop"] = True
                self.nepostaveno.append({"id": name, "co": f"nosná konstrukce konceptu „{s['obj']['label']}“",
                                         "duvod": f"nepřevzata — {s['drop_force']} (podpěru pod tělem doplní stavitel, je-li potřeba)"})
                continue
            pts = self.free_corners(name, bb, on[2])
            if not pts and not s["holes"]:
                s["drop"] = True
                self.nepostaveno.append({"id": name, "co": f"nosná konstrukce konceptu „{s['obj']['label']}“",
                                         "duvod": "plocha obsazená, nic do ní není přišroubováno — nepřevzata (zařízení nese jiné "
                                                  "upevnění, např. patky); doplní stavitel, je-li potřeba"})
                continue
            if not pts:
                self.odhady.add(f"„{s['obj']['label'][:40]}“: k podkladu bez šroubů (plocha obsazená) — upevnění doplní stavitel")
            t = size(bb)[2]
            M = 6 if t >= 10 else (5 if t >= 6 else 4)
            target = on if on[0] == "ram" else ("sup", on[1], on[2])
            s["holes"] += self.fasten_down(s["grp"], pts, bb[5], [0.0, 0.0, -1.0], target, M=M, t=t,
                                           label=f"„{s['obj']['label'][:30]}“ → podklad")
            s["upevneni"] = f"{len(pts)} × M{M} → „{on[1]['label'] if on[0] == 'ram' else self.supports[on[1]]['obj']['label']}“"
        self.supports = {k: v for k, v in self.supports.items() if not v.get("drop")}
        self.pneumatics()
        self.route_all()

    def free_corners(self, name, bb, onbb=None):
        """Body šroubů nosné konstrukce: rohy společného půdorysu s podkladem (šroub musí skončit v podkladu, ne v jiném
        dílu pod konstrukcí), odsazení 12 mm, mimo půdorysy dílů, které na ní stojí."""
        top = bb[5]
        if onbb is not None:
            bb = [max(bb[0], onbb[0]), max(bb[1], onbb[1]), bb[2], min(bb[3], onbb[3]), min(bb[4], onbb[4]), bb[5]]
            if bb[3] - bb[0] < 10 or bb[4] - bb[1] < 10:
                return []
        sz = size(bb)
        ins = 12.0 if min(sz[0], sz[1]) > 40 else min(sz[0], sz[1]) / 4
        cand = [[bb[0] + ins, bb[1] + ins], [bb[3] - ins, bb[1] + ins], [bb[0] + ins, bb[4] - ins], [bb[3] - ins, bb[4] - ins]]
        if max(sz[0], sz[1]) < 120:
            cand = [[bb[0] + ins, (bb[1] + bb[4]) / 2], [bb[3] - ins, (bb[1] + bb[4]) / 2]] if sz[0] >= sz[1] else \
                [[(bb[0] + bb[3]) / 2, bb[1] + ins], [(bb[0] + bb[3]) / 2, bb[4] - ins]]
        occupied = []
        for it in self.items:
            b = it.get("bb") or (union_box([prim_box(p) for p in it.get("add") or []]) if it.get("add") else None)
            if b and abs(b[2] - bb[5]) <= TOL + 8.0:
                occupied.append(b)
        for s2 in self.supports.values():
            b = s2["obj"]["bb"]
            if abs(b[2] - bb[5]) <= TOL:
                occupied.append(b)
        out = []
        for x, y in cand:
            if any(b[0] - 8 <= x <= b[3] + 8 and b[1] - 8 <= y <= b[4] + 8 for b in occupied):
                continue
            if any(math.dist((x, y), (p[0], p[1])) < 14.0 for p in out):     # hlavy šroubů se nesmí překrývat
                continue
            out.append([x, y, bb[5]])
        if len(out) < 2:
            self.odhady.add(f"„{self.supports[name]['obj']['label'][:40]}“: šrouby k podkladu jen {len(out)} (rohy obsazené) — ODHAD")
        return out


def prim_box(p):
    if p[0] == "box":
        return [float(x) for x in p[1:7]]
    _, x, y, z, dx, dy, dz, r, h = p
    a = [x, y, z]
    b = [x + dx * h, y + dy * h, z + dz * h]
    bb = box_of(a, b)
    for k, dd in enumerate((dx, dy, dz)):
        if abs(dd) < 0.5:
            bb[k] -= r
            bb[k + 3] += r
    return bb


def union_box(bs):
    bs = [b for b in bs if b]
    if not bs:
        return None
    return [min(b[i] for b in bs) for i in range(3)] + [max(b[i + 3] for b in bs) for i in range(3)]


def port_hole_prim(port):
    td = thread_d(port["thread"])
    depth = 10.0
    n = port["n"]
    return ["cyl", *r3(sub(port["seat"], mul(n, depth))), *r3(n), round(td / 2 - 0.6, 3), depth + 0.3]


def dedupe(pts):
    out = []
    for p in pts:
        if not out or math.dist(out[-1], p) > 0.05:
            out.append(p)
    return out


def plan(manifest: dict, scene: dict, *, folder: str | Path, parts_index: dict | None = None, cab_layout: dict | None = None,
         manifest_path: str | Path | None = None, require_models: bool = True) -> dict:
    pl = Plan(manifest, scene, folder, parts_index, cab_layout)
    REQUIRE_MODELS[0] = require_models          # False = jen rozmístění (testy bez modelů dily/)
    try:
        pl.run()
    finally:
        REQUIRE_MODELS[0] = True
    tr = trasa_mod()
    vys = None
    routes = getattr(pl, "routes", [])
    if tr is not None and routes:
        res = [r["vysledek"] for r in routes]
        vys = {"trasy": res, "oddeleni": tr.oddeleni([r for r in res if r.get("body")]) if res else []}
    raw = json.dumps(manifest, ensure_ascii=False, sort_keys=True).encode("utf-8")
    sha = hashlib.sha256(Path(manifest_path).read_bytes()).hexdigest() if manifest_path and Path(manifest_path).is_file() else \
        hashlib.sha256(raw).hexdigest()
    supports = []
    for name, s in pl.supports.items():
        o = s["obj"]
        supports.append({"name": name, "label": o["label"], "bb": o["bb"], "zast": s["zast"], "holes": s["holes"], "grp": s.get("grp"),
                         "upevneni": s.get("upevneni", ""), "on": None if not s["on"] else (s["on"][0], s["on"][1]["label"] if s["on"][0] == "ram"
                                                                  else s["on"][1])})
    devs = []
    for d in pl.devices:
        devs.append({k: v for k, v in d.items() if k not in ("frame", "spec", "ports")} |
                    {"ports": [{k: v for k, v in p.items() if k != "hose"} for p in d.get("ports") or []]})
    links = []
    for r in (scene.get("ram_roots") or []):
        for c in r.get("children") or []:
            if not c.get("kontext"):
                links.append(c)
    out = {"format": FORMAT, "version": VERSION, "created": _dt.datetime.now().isoformat(timespec="seconds"),
           "manifest": str(manifest_path or ""), "manifestSha256": sha, "projectGuid": (manifest.get("project") or {}).get("guid") or "",
           "projekt": (manifest.get("project") or {}).get("name") or "", "ram": (scene.get("files") or {}).get("ram", ""),
           "koncept": (scene.get("files") or {}).get("koncept", ""), "ram_links": links, "rozvadec": pl.cab and {k: pl.cab[k] for k in ("pid", "bb", "label")},
           "devices": devs, "supports": supports, "items": pl.items, "groups": pl.groups,
           "routes": [{"druh": r["druh"], "postavit": r["postavit"], "duvod": r.get("duvod", ""), "pruchody": r.get("pruchody") or [],
                       "trasa": r["trasa"], "vysledek": {k: v for k, v in r["vysledek"].items()}} for r in routes],
           "oddeleni": (vys or {}).get("oddeleni") or [], "nepostaveno": pl.nepostaveno, "predani": pl.predani,
           "odhady": sorted(pl.odhady), "kabelaz_skill": str(skill_scripts()), "trasa_ok": tr is not None}
    out["souhrn"] = summary(out)
    out["zpetna_vazba"] = feedback(out, manifest, manifest_path, tr, vys)
    return out


def summary(lay: dict) -> dict:
    devs = lay["devices"]
    routes = lay["routes"]
    hz = [r for r in routes if r["druh"] == "hadice"]
    kb = [r for r in routes if r["druh"] == "kabel"]

    def dl(rs):
        return round(sum((r["vysledek"].get("delka_s_rezervou_mm") or 0) for r in rs) / 1000.0, 2)
    return {"zarizeni": len(devs), "v_ramu": sum(1 for d in devs if d["src"] in ("ram", "ram_bez_id")),
            "postaveno_zarizeni": sum(1 for d in devs if d.get("item")),
            "chybi": sum(1 for d in devs if d["src"] in ("chybi", "chybi_drzak")),
            "valcu": sum(1 for it in lay["items"] if it["druh"] == "valec"),
            "snimacu": sum(1 for d in devs if d["cat"].startswith("sensor") or d["cat"] in ("cylinder_switch", "pressure_transmitter")),
            "snimacu_postaveno": sum(1 for d in devs if (d["cat"].startswith("sensor") or d["cat"] in ("cylinder_switch", "pressure_transmitter"))
                                     and d.get("item")),
            "drzaku": sum(1 for it in lay["items"] if it["druh"] == "konstrukce"),
            "nosnych": len(lay["supports"]), "sroubu": sum(1 for it in lay["items"] if it["druh"] == "sroub"),
            "hadic": len(hz), "hadic_postaveno": sum(1 for r in hz if r["postavit"]), "hadice_m": dl(hz),
            "kabelu": len(kb), "kabelu_postaveno": sum(1 for r in kb if r["postavit"]), "kabely_m": dl(kb),
            "pruchodu": sum(len(r["pruchody"]) for r in routes), "predani": len(lay["predani"]),
            "nepostaveno": len(lay["nepostaveno"]), "chyb_tras": sum(1 for r in routes if r["vysledek"].get("chyby"))}


def feedback(lay, manifest, manifest_path, tr, vys) -> dict:
    """Zpětná vazba plcdesk-cad-feedback v1: délky kabelů (trasa.zpetna_vazba skillu), počet kabelů snímačů, požadavky na rám."""
    issues = []
    if tr is not None and vys and manifest_path and Path(manifest_path).is_file():
        try:
            fb = tr.zpetna_vazba({"trasy": [r for r in vys["trasy"] if r.get("delka_mm") is not None]}, str(manifest_path),
                                 model="moduly/Moduly.FCStd")["feedback"]
            issues += fb.get("issues") or []
        except Exception:  # noqa: BLE001
            pass
    cab = next((p for p in manifest.get("parts") or [] if p.get("category") == "cable_sensor"), None)
    if cab:
        need = sum(1 for r in lay["routes"] if r["druh"] == "kabel" and r["trasa"].get("partId") == cab["id"])
        if need and need != int(cab.get("qty") or 0):
            issues.append({"id": f"moduly-pocet-{cab['id']}", "kind": "qty_mismatch", "severity": "warn", "parts": [cab["id"]],
                           "measured": {"what": "počet kabelů snímačů (M12) podle zařízení v poli", "value": need, "unit": "ks",
                                        "source": "pro3d_modules — trasa ke každému snímači s konektorem"},
                           "message": f"Kusovník {cab.get('qty')} ks, zařízení s kabelem snímače v poli {need}.",
                           "suggestion": {"partId": cab["id"], "line": {"qty": need}}})
    sw = [d for d in lay["devices"] if d["cat"] == "cylinder_switch"]
    if sw and cab and re.search(r"M12", cab.get("type") or "") and any(re.search(r"M8", (d.get("type") or "")) for d in sw):
        issues.append({"id": "moduly-konektor-M8", "kind": "other", "severity": "warn", "parts": [cab["id"]] + sorted({d["pid"] for d in sw}),
                       "measured": {"what": "konektor snímačů polohy válců", "value": "M8", "unit": "",
                                    "source": "typ řádku cylinder_switch v manifestu (…M8D)"},
                       "message": "Snímače polohy mají konektor M8, kabel snímačů v kusovníku je M12 — doplnit kabely M8 / redukci."})
    if lay["predani"]:
        issues.append({"id": "moduly-pozadavky-ram", "kind": "other", "severity": "info", "parts": [],
                       "measured": {"what": "požadavky na rám (díry, průchody)", "value": len(lay["predani"]), "unit": "ks",
                                    "source": "pro3d_modules — upevnění a trasy modulů"},
                       "message": "Moduly potřebují v rámu: " + "; ".join(f"{p['co']} u {p['bod']}" for p in lay["predani"][:12])
                                  + (" …" if len(lay["predani"]) > 12 else "")})
    raw = Path(manifest_path).read_bytes().decode("utf-8-sig") if manifest_path and Path(manifest_path).is_file() else \
        json.dumps(manifest, ensure_ascii=False)
    return {"format": "plcdesk-cad-feedback", "version": 1, "project": {"guid": (manifest.get("project") or {}).get("guid") or ""},
            "manifest": {"sha256": hashlib.sha256(raw.encode("utf-8")).hexdigest()},
            "created": _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "tool": "pro3d_modules 1", "issues": issues}
