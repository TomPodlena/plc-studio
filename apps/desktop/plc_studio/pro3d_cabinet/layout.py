"""Rozmístění rozvaděče z manifestu PLCdesk (čistý Python, bez FreeCADu a bez importu z ``plc_studio``).

``plan(manifest, folder=…, rezerva=20, tamb=35, tin=40)`` → slovník ``layout`` (zapisuje se do ``rozvadec/layout.json``):

1. díly ``location = cabinet`` (bez skříně samé) rozvine na kusy (``qty``), PLC stanice v pořadí ``plc.stations[].modules[].slot``,
   svorkovnice ``X1…`` po svorkách se zarážkami;
2. rozměry: model ``dily/parts_index.json`` (obálka změřená FreeCADem v ``modely[].bbox``) → tabulky ``pro3d_parts``
   (``catalog_map.spec_for_part``) → ``data/rozmery.json`` → ODHAD podle kategorie (příznak, DOLOŽIT);
3. skupiny (napájení a jištění, silová část, pohony na desce, řízení = PLC + bezpečnost, svorky, dveře) na lišty TS35
   se žlaby mezi nimi; mezery výrobců z ``data/mezery.json``; **rezerva ≥ ``rezerva`` % délky každé lišty**;
4. skříň: nejdřív ta z manifestu, nevejde-li se výbava, nejmenší z katalogu (``data/catalog/plc.json`` / ``data/skrine.json``),
   do které se vejde (šířka lišt, výška desky, hloubka, přístroje na dveřích);
5. tepelná bilance Qs = k · A · ΔT (Rittal) se ztrátami z ``data/ztraty.json`` a nejnižší dovolenou teplotou přístrojů.

Geometrie, kterou výrobce nedokládá (plech skříně, odsazení desky, žlaby, zarážky, vývodky), je ``GEOM`` — ODHAD návrhu
s příznakem v ``layout["odhady"]``; konstrukční díly mimo kusovník jsou „návrh k odsouhlasení“.
Souřadnice: X šířka skříně (zleva), Y hloubka (0 = vnější záda, k dveřím), Z výška (0 = vnější dno)."""

from __future__ import annotations

import datetime as _dt
import hashlib
import json
import math
import re
import sys
from functools import lru_cache
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
PARTS_DIR = HERE.parent / "pro3d_parts"
if str(PARTS_DIR) not in sys.path:
    sys.path.insert(0, str(PARTS_DIR))
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
import dvere  # noqa: E402  (sourozenec, bez plc_studio)
try:
    import catalog_map as cm  # type: ignore  # noqa: E402  (sourozenec pro3d_parts, bez plc_studio)
except Exception:  # noqa: BLE001
    cm = None

FORMAT = "plcdesk-pro3d-cabinet"
VERSION = 1

# Geometrie bez dokladu výrobce = ODHAD návrhu (vše mm). Popis jde do ROZVADEC.md.
GEOM = {
    "stena": 1.5, "dvere": 2.0, "odsazeni": 10.0, "deska": 2.5, "okraj": 15.0, "zlab_s": 30.0, "zlab_h": 40.0,
    "zlab_t": 2.0, "zlab_vika": 1.5, "mezera_zlab_lista": 5.0, "lista": "7.5", "zarazka_w": 10.0, "zarazka_d": 25.0,
    "rozteč_srouby_lista": 150.0, "rozteč_srouby_zlab": 200.0, "pant_r": 6.0, "pant_l": 20.0, "sloupek_r": 6.0,
    "vyvodka": "M20", "mezera_skupin": 50.0, "dvere_okraj": 12.0, "dvere_pant_pas": 25.0, "dvere_mezera": 5.0, "hmi_vyska_pct": 0.62,
}
GEOM_TEXT = {
    "stena": "plech skříně 1,5 mm (datový list skříně tloušťku neuvádí v katalogu PLCdesk)",
    "dvere": "dveře 2 mm, vnitřní líc dveří = přední hrana skříně − 2 mm",
    "odsazeni": "montážní deska na 4 sloupcích Ø12 mm 10 mm od zad (poloha desky ve skříni nezměřena — model skříně chybí)",
    "deska": "tloušťka desky 2,5 mm (AX 1050.000 / AE 1060.500 podle datasheetu ve skillu rozvadec-3d; u ostatních skříní ODHAD)",
    "okraj": "okraj desky 15 mm bez přístrojů (šrouby desky)",
    "zlab": "kabelové žlaby 30 × 40 mm (š × h) s víkem, šrouby M4 po ≤ 200 mm — typ z katalogu výrobce doplnit",
    "lista": "lišta TS35 × 7,5 (EN 60715, rozměry WAGO 210-113 z pro3d_parts/normalie.json), šrouby M4 po ≤ 150 mm",
    "zarazka": "koncové zarážky 10 × 35 × 25 mm se šroubem M4 (typ doplnit)",
    "pant": "2 panty vlevo (čep Ø6), otevření 95°",
    "vyvodka": "vývodky Lapp SKINTOP ST-M M20 ve dně (počet = svorkovnice + přívod; návrh)",
    "osa": "přístroj na liště: střed výšky v ose lišty (poloha upínky nezměřena)",
    "pas": "silová lišta a pohony na desce smí sdílet pás (mezera skupin 50 mm), lišta pak s vlastní rezervou",
}
POWER = ("main_switch", "mcb", "fuse", "rcd", "surge_protection", "power_supply_24v", "power_supply")
SILOVA = ("motor_protection", "contactor", "contactor_mirror", "soft_starter", "overload_relay", "vfd")
# kategorie kusovníku jádra (bom.ts); starší jména push_button / emergency_stop převede dvere.core_cat
DOOR_CATS = ("plc_hmi", "main_switch", "pilot_light", "pushbutton", "estop_button", "selector_switch")
FAMILIES = (  # (klíč, popisek, skupiny, druh montáže)
    ("sil", "Napájení, jištění a silová část", ("napajeni", "silova"), "din"),
    ("poh", "Pohony na desce", ("pohony",), "panel"),
    ("riz", "Řízení (PLC, bezpečnost, relé)", ("rizeni",), "din"),
    ("svo", "Svorkovnice", ("svorky",), "din"),
)
CAT_ORDER = {c: i for i, c in enumerate(POWER + SILOVA)}
STAV_DOK = "dle dokumentace"


# --- data ------------------------------------------------------------------------------------------------------------

@lru_cache(maxsize=None)
def load(name: str) -> dict:
    return json.loads((DATA / f"{name}.json").read_text(encoding="utf-8"))


def norm_code(c: str) -> str:
    return re.sub(r"\s+", "", str(c or "")).upper()


def loss_of(code: str) -> dict:
    t = load("ztraty")["polozky"]
    it = {norm_code(k): v for k, v in t.items()}.get(norm_code(code))
    if not it:
        return {"W": None, "stav": "chybí", "co": "kód není v data/ztraty.json" if code else "řádek bez objednacího kódu",
                "tmax": None, "zdroj": None}
    return dict(it)


def clear_of(code: str) -> dict:
    m = load("mezery")
    c = norm_code(code)
    it = {norm_code(k): v for k, v in m["polozky"].items()}.get(c)
    if not it and c:
        best = None
        for pre, row in m["rady"].items():
            if c.startswith(norm_code(pre)) and (best is None or len(pre) > len(best[0])):
                if row.get("jen_g2") and not re.search(r"-\w{3}50-", c):
                    continue
                best = (pre, row)
        if best:
            it = dict(best[1])
            if it.get("ref") and not it.get("zdroj"):
                ref = m["rady"][it["ref"]]
                it.setdefault("zdroj", ref.get("zdroj"))
                it.setdefault("text", ref.get("text"))
    if not it:
        d = dict(m["vychozi"])
        d["zdroj"] = None
        return d
    out = dict(it)
    for k in ("nad", "pod", "bok", "pred"):
        out.setdefault(k, None)
    return out


def _repo_catalog() -> Path | None:
    for p in HERE.parents:
        f = p / "data" / "catalog" / "plc.json"
        if f.is_file():
            return f
    return None


@lru_cache(maxsize=None)
def cabinets() -> tuple:
    """Skříně s deskou (dims) — z katalogu PLCdesk v repozitáři, jinak ``data/skrine.json``. Seřazené od nejmenší."""
    rows = []
    f = _repo_catalog()
    if f:
        try:
            d = json.loads(f.read_text(encoding="utf-8"))

            def walk(o):
                if isinstance(o, dict):
                    if isinstance(o.get("cabinet"), dict) and "brands" in o["cabinet"]:
                        return o["cabinet"]
                    for v in o.values():
                        r = walk(v)
                        if r:
                            return r
                return None
            for b in (walk(d) or {}).get("brands") or []:
                dm = b.get("dims") or {}
                if dm.get("plateW") and b.get("orderCode"):
                    rows.append({"brand": b["brand"], "orderCode": b["orderCode"], "typ": b.get("typical", ""), "w": dm["w"],
                                 "h": dm["h"], "d": dm["d"], "plateW": dm["plateW"], "plateH": dm["plateH"], "src": dm["src"],
                                 "katalog": str(f)})
        except (OSError, ValueError):
            rows = []
    if not rows:
        rows = [dict(r, katalog="pro3d_cabinet/data/skrine.json") for r in load("skrine")["skrine"]]
    rows.sort(key=lambda r: (r["plateW"] * r["plateH"], r["d"], r["w"] * r["h"]))
    return tuple(rows)


# --- díly manifestu ---------------------------------------------------------------------------------------------------

def _tagnum(tag: str) -> tuple:
    m = re.match(r"^[-+]?([A-Za-z]+)(\d+)", tag or "")
    return (m.group(1), int(m.group(2))) if m else (tag or "", 0)


def group_of(cat: str, mount: str) -> str:
    if cat == "terminal_block":
        return "svorky"
    if mount == "rack":
        return "rizeni"
    if mount in ("panel", "door"):
        return "dvere" if dvere.core_cat(cat) in DOOR_CATS else "pohony"
    if cat in POWER:
        return "napajeni"
    if cat in SILOVA:
        return "silova"
    return "rizeni"


def _index_entry(parts_index: dict | None, pid: str) -> tuple[dict | None, dict | None]:
    if not parts_index:
        return None, None
    r = (parts_index.get("parts") or {}).get(pid)
    if not r or r.get("stav") != STAV_DOK or not r.get("file"):
        return r, None
    m = (parts_index.get("modely") or {}).get(r.get("model") or "") or {}
    return r, m if m.get("ok") else None


def device_geom(part: dict, parts_index: dict | None) -> dict:
    """Rozměry a lokální obálka modelu (souřadnice modelu pro3d_parts: X šířka, Y hloubka od montážní roviny, Z výška)."""
    cat = part.get("category") or ""
    code = part.get("orderCode") or ""
    spec, _why = (cm.spec_for_part(part) if cm else (None, "pro3d_parts nenalezen"))
    row, mod = _index_entry(parts_index, part.get("id") or "")
    gen = (spec or {}).get("gen") or ""
    p = (spec or {}).get("params") or {}
    out = {"gen": gen, "model": None, "stav": "", "zdroj": "", "hmi": gen == "hmi_panel" or cat == "plc_hmi"}
    if mod and mod.get("bbox"):
        b = [float(x) for x in mod["bbox"]]
        out.update(model="dily/" + row["file"], lb=b, stav="změřeno v modelu (dily)",
                   zdroj=" | ".join((spec or {}).get("zdroj") or row.get("zdroj") or []))
    elif spec and gen in ("skrinka", "skrinka_din") and all(k in p for k in ("w", "h", "d")):
        w, h, d = float(p["w"]), float(p["h"]), float(p["d"])
        out.update(lb=[-w / 2, w / 2, 0.0, d, -h / 2, h / 2], stav="datový list (pro3d_parts), model nevznikl",
                   zdroj=" | ".join(spec.get("zdroj") or []))
    elif spec and gen == "hmi_panel":
        w, h, d = float(p["cut_w"]), float(p["cut_h"]), float(p["depth"])
        out.update(lb=[-w / 2, w / 2, -d, 0.0, -h / 2, h / 2], stav="datový list (pro3d_parts), model nevznikl",
                   zdroj=" | ".join(spec.get("zdroj") or []))
    if "lb" not in out:
        r = load("rozmery")
        it = {norm_code(k): v for k, v in r["polozky"].items()}.get(norm_code(code))
        if it:
            w, h, d = float(it["w"]), float(it["h"]), float(it["d"])
            out.update(stav="datový list (pro3d_cabinet/data/rozmery.json)", zdroj=it["zdroj"]["url"])
        else:
            ko = r["kategorie_odhad"]
            it = ko.get(cat) or ko["_jine_panel" if (part.get("mount") == "panel") else "_jine_din"]
            w, h, d = float(it["w"]), float(it["h"]), float(it["d"])
            out.update(stav="ODHAD", zdroj=f"ODHAD podle kategorie ({it.get('pozn', '')}) — DOLOŽIT rozměr")
        out["lb"] = [-w / 2, w / 2, -d, 0.0, -h / 2, h / 2] if out["hmi"] else [-w / 2, w / 2, 0.0, d, -h / 2, h / 2]
    b = out["lb"]
    out.update(w=round(b[1] - b[0], 3), d=round(b[3] - b[2], 3), h=round(b[5] - b[4], 3))
    return out


def expand(manifest: dict, parts_index: dict | None) -> tuple[list, dict | None, list]:
    """Kusy přístrojů rozvaděče v pořadí: stanice PLC (podle slotů), ostatní podle manifestu. Vrací (kusy, skříň, poznámky)."""
    parts = [p for p in manifest.get("parts") or [] if isinstance(p, dict) and p.get("location") == "cabinet"]
    cab = next((p for p in parts if p.get("category") == "cabinet"), None)
    by_id = {p["id"]: p for p in parts}
    used: dict = {}
    notes = []
    out = []

    def mk(p, n, **kw):
        g = device_geom(p, parts_index)
        cl = clear_of(p.get("orderCode") or "")
        ls = loss_of(p.get("orderCode") or "")
        it = {"pid": p["id"], "inst": n, "tag": p.get("tag") or p["id"].split(":")[0], "label": p.get("label") or "",
              "cat": dvere.core_cat(p.get("category") or ""), "mount": p.get("mount") or "", "code": p.get("orderCode") or "",
              "brand": p.get("brand") or "", "type": p.get("type") or "", "safety": bool(p.get("safety")),
              "group": group_of(p.get("category") or "", p.get("mount") or ""), "geom": g, "clear": cl, "loss": ls,
              "seq": len(out)}
        it.update(kw)
        return it

    for st in ((manifest.get("plc") or {}).get("stations") or []):
        head = by_id.get(st.get("head") or "")
        if not head or head.get("mount") != "rack":
            continue
        seq = [(head["id"], 1, None)]
        for m in sorted(st.get("modules") or [], key=lambda m: m.get("slot") or 0):
            pid = m.get("partId") or ""
            if pid in by_id:
                used[pid] = used.get(pid, 0) + 1
                seq.append((pid, used[pid], m.get("slot")))
        used[head["id"]] = used.get(head["id"], 0) + 1
        block = f"stanice{st.get('index', 0)}"
        for pid, n, slot in seq:
            out.append(mk(by_id[pid], n, station=st.get("index", 0), slot=slot, block=block))
    for p in parts:
        if p is cab:
            continue
        qty = int(round(float(p.get("qty") or 1)))
        start = used.get(p["id"], 0)
        if p.get("mount") == "rack" and start and start < qty:
            notes.append(f"{p['id']}: {qty - start} ks mimo plc.stations — zařazeno do řízení za stanici")
        for n in range(start + 1, qty + 1):
            blk = None
            if p.get("category") == "terminal_block":
                blk = "svorky:" + (p.get("tag") or p["id"])
            out.append(mk(p, n, block=blk))
    return out, cab, notes


# --- rozmístění na lištách --------------------------------------------------------------------------------------------

def _bok(it) -> float:
    v = it["clear"].get("bok")
    return float(v) if v is not None else 0.0


def _gap(a, b) -> float:
    if a.get("block") and a.get("block") == b.get("block"):
        return 0.0
    if a.get("kind") == "zarazka" or b.get("kind") == "zarazka":
        return 0.0
    return max(_bok(a), _bok(b))


def occupancy(items: list) -> float:
    """Délka lišty, kterou kusy zaberou: boční mezera prvního + šířky + mezery mezi + boční mezera posledního."""
    if not items:
        return 0.0
    s = _bok(items[0]) + _bok(items[-1]) + sum(float(i["geom"]["w"]) for i in items)
    s += sum(_gap(a, b) for a, b in zip(items, items[1:]))
    return s


def _endstop(name: str) -> dict:
    w = GEOM["zarazka_w"]
    return {"pid": "", "inst": 0, "tag": name, "label": "Koncová zarážka (návrh)", "cat": "end_stop", "mount": "din",
            "kind": "zarazka", "group": "svorky", "block": None, "code": "",
            "geom": {"w": w, "h": 35.0, "d": GEOM["zarazka_d"], "lb": [-w / 2, w / 2, 0, GEOM["zarazka_d"], -17.5, 17.5],
                     "model": None, "stav": "ODHAD", "zdroj": GEOM_TEXT["zarazka"], "hmi": False},
            "clear": {"nad": 0, "pod": 0, "bok": 0, "pred": None, "stav": "—"},
            "loss": {"W": 0.0, "stav": "doloženo", "co": "pasivní díl"}}


def blocks_for(items: list, family: tuple) -> list:
    """Atomické bloky v pořadí lišty (stanice PLC celá, svorkovnice celá se zarážkou na začátku)."""
    sel = [i for i in items if i["group"] in family[2]]
    if family[0] == "sil":
        sel.sort(key=lambda i: (0 if i["group"] == "napajeni" else 1, CAT_ORDER.get(i["cat"], 99) if i["group"] == "napajeni" else 0,
                                _tagnum(i["tag"]), CAT_ORDER.get(i["cat"], 99), i["inst"]))
    elif family[0] == "riz":
        # stanice v pořadí slotů z expand (seq), pak bezpečnost, pak ostatní podle označení
        sel.sort(key=lambda i: (0, i["station"], i["seq"]) if i.get("station") is not None else
                 ((1 if i["safety"] else 2), 0, 0, _tagnum(i["tag"]), i["inst"]))
    elif family[0] == "svo":
        sel.sort(key=lambda i: (_tagnum(i["tag"]), i["inst"]))
    else:
        sel.sort(key=lambda i: (_tagnum(i["tag"]), i["inst"]))
    blocks, cur, key = [], [], None
    for it in sel:
        k = it.get("block")
        if k and k == key:
            cur.append(it)
            continue
        if cur:
            blocks.append(cur)
        cur, key = [it], k
    if cur:
        blocks.append(cur)
    if family[0] == "svo":
        for b in blocks:
            b.insert(0, _endstop(f"Zarážka před {b[0]['tag']}"))
    return blocks


def pack(blocks: list, cap: float, family: str) -> tuple[list, str]:
    """Bloky na lišty tak, aby obsazení ≤ cap; blok se nedělí. Vrací (lišty = seznamy kusů, chyba)."""
    rails: list = []
    cur: list = []
    for b in blocks:
        if occupancy(cur + b) <= cap + 1e-6:
            cur = cur + b
            continue
        if occupancy(b) > cap + 1e-6:
            return rails, (f"{b[0]['tag']}…{b[-1]['tag']}: blok {occupancy(b):.0f} mm se nevejde na lištu "
                           f"(max. {cap:.0f} mm s rezervou)")
        if cur:
            rails.append(cur)
        cur = list(b)
    if cur:
        rails.append(cur)
    if family == "svo" and rails:                      # zarážka i za posledním blokem každé lišty
        for r in rails:
            r.append(_endstop(f"Zarážka za {r[-1]['tag']}"))
        # znovu zkontrolovat (zarážka navíc)
        for r in rails:
            if occupancy(r) > cap + 1e-6:
                return rails, f"svorkovnice: {occupancy(r):.0f} mm > {cap:.0f} mm s rezervou"
    return rails, ""


# --- jedna skříň ------------------------------------------------------------------------------------------------------

def _up_dn(items: list) -> tuple[float, float]:
    up = max(float(i["geom"]["h"]) / 2 + float(i["clear"].get("nad") or 0) for i in items)
    dn = max(float(i["geom"]["h"]) / 2 + float(i["clear"].get("pod") or 0) for i in items)
    return up, max(dn, 17.5 + 2.0)


def _overlap(a, b, eps=1e-6) -> bool:
    return all(a[2 * k] < b[2 * k + 1] - eps and b[2 * k] < a[2 * k + 1] - eps for k in range(3))


def try_cabinet(cab: dict, items: list, rezerva: float) -> dict:
    """Rozmístí kusy do skříně ``cab``. Vrací {"ok", "proc", …geometrie…}."""
    G = GEOM
    W, H, D = float(cab["w"]), float(cab["h"]), float(cab["d"])
    Wp, Hp = float(cab["plateW"]), float(cab["plateH"])
    t = G["stena"]
    res = {"ok": False, "proc": [], "cabinet": cab}
    if Wp > W - 2 * t or Hp > H - 2 * t:
        res["proc"].append("deska větší než vnitřek skříně")
        return res
    px0, pz0 = (W - Wp) / 2, (H - Hp) / 2
    px1, pz1 = px0 + Wp, pz0 + Hp
    py0 = t + G["odsazeni"]
    py1 = py0 + G["deska"]
    yd = D - G["dvere"]                          # vnitřní líc dveří
    rail_h = 7.5 if G["lista"] == "7.5" else 15.0
    yr = py1 + rail_h
    dw, dh = G["zlab_s"], G["zlab_h"]
    xl0 = px0 + G["okraj"] + dw + G["mezera_zlab_lista"]
    xl1 = px1 - G["okraj"] - dw - G["mezera_zlab_lista"]
    L = xl1 - xl0
    cap = L * (1 - rezerva / 100.0)
    res.update(plate={"x0": px0, "x1": px1, "z0": pz0, "z1": pz1, "y0": py0, "y1": py1}, yd=yd, rail={"x0": xl0, "x1": xl1, "L": L, "cap": cap})
    rails = []
    for fam in FAMILIES:
        bl = blocks_for(items, fam)
        if not bl:
            continue
        rr, err = pack(bl, cap, fam[0])
        if err:
            res["proc"].append(f"{fam[1]}: {err}")
            return res
        for r in rr:
            rails.append({"family": fam[0], "label": fam[1], "kind": fam[3], "items": r, "x0": xl0, "x1": xl1})
    # pás = jedna řada mezi žlaby; silová lišta a pohony na desce smí sdílet pás (obě silové), když se vejdou s rezervou
    bands = [[r] for r in rails]
    sil = [b for b in bands if b[0]["family"] == "sil"]
    poh = [b for b in bands if b[0]["family"] == "poh"]
    if len(sil) == 1 and len(poh) == 1:
        a, p = sil[0][0], poh[0][0]
        gap = G["mezera_skupin"]
        rl = math.ceil(occupancy(a["items"]) / (1 - rezerva / 100.0) / 5.0) * 5.0     # lišta s vlastní rezervou
        rest = L - rl - gap
        if rest > 0 and occupancy(p["items"]) <= rest * (1 - rezerva / 100.0) + 1e-6:
            a["x1"] = xl0 + rl
            p["x0"] = xl0 + rl + gap
            bands.remove(poh[0])
            sil[0].append(p)
    # svisle: okraj, žlab, pás, žlab, …, žlab, okraj
    need = 2 * G["okraj"] + (len(bands) + 1) * dw
    ud = []
    for b in bands:
        up, dn = _up_dn([i for s in b for i in s["items"]])
        ud.append((up, dn))
        need += up + dn
    res["vyska"] = {"potreba": round(need, 1), "deska": Hp}
    if need > Hp + 1e-6:
        res["proc"].append(f"výška desky: potřeba {need:.0f} mm (lišty, mezery výrobců, žlaby {dw:.0f} mm) > {Hp:.0f} mm")
        return res
    # svislá rezerva desky (zbytek dole) — rozdělí se rovnoměrně mezi pásy (víc místa na vodiče)
    spare = (Hp - need) / max(1, len(bands))
    z = pz1 - G["okraj"]
    ducts = []
    hx0, hx1 = px0 + G["okraj"] + dw, px1 - G["okraj"] - dw
    ducts.append({"name": "Žlab H1", "orient": "h", "x0": hx0, "x1": hx1, "z0": z - dw, "z1": z})
    z -= dw
    for i, (b, (up, dn)) in enumerate(zip(bands, ud)):
        up2, dn2 = up + spare / 2, dn + spare / 2
        zc = z - up2
        for r in b:
            r["zc"], r["up"], r["dn"], r["pas"] = zc, up2, dn2, i + 1
        z = zc - dn2
        ducts.append({"name": f"Žlab H{i + 2}", "orient": "h", "x0": hx0, "x1": hx1, "z0": z - dw, "z1": z})
        z -= dw
    rails = [r for b in bands for r in b]
    zb = z
    zt = pz1 - G["okraj"]
    ducts.append({"name": "Žlab V1", "orient": "v", "x0": px0 + G["okraj"], "x1": px0 + G["okraj"] + dw, "z0": zb, "z1": zt})
    ducts.append({"name": "Žlab V2", "orient": "v", "x0": px1 - G["okraj"] - dw, "x1": px1 - G["okraj"], "z0": zb, "z1": zt})
    for dct in ducts:
        dct.update(y0=py1, y1=py1 + dh)
    # polohy kusů
    devices, zones, reserves = [], [], []
    for n, r in enumerate(rails, start=1):
        r["n"] = n
        r["name"] = f"Lišta {n}" if r["kind"] == "din" else f"Deska {n} (přístroje na desce)"
        x = r["x0"] + _bok(r["items"][0])
        Lr = r["x1"] - r["x0"]
        prev = None
        for it in r["items"]:
            if prev is not None:
                x += _gap(prev, it)
            w, h, d = it["geom"]["w"], it["geom"]["h"], it["geom"]["d"]
            y0 = yr if (r["kind"] == "din" or it.get("kind") == "zarazka") else py1
            it["box"] = [round(x, 3), round(x + w, 3), round(y0, 3), round(y0 + d, 3), round(r["zc"] - h / 2, 3), round(r["zc"] + h / 2, 3)]
            it["rail"] = n
            x += w
            prev = it
            devices.append(it)
        used = occupancy(r["items"])
        r.update(L=round(Lr, 1), obsazeno=round(used, 1), rezerva_mm=round(Lr - used, 1),
                 rezerva_pct=round(100.0 * (Lr - used) / Lr, 1), konec=round(x + _bok(r["items"][-1]), 1))
        ymax = max(i["box"][3] for i in r["items"])
        reserves.append({"name": f"Rezerva {r['name'].lower()} ({r['rezerva_mm']:.0f} mm = {r['rezerva_pct']:.1f} %)", "rail": n,
                         "box": [r["konec"], r["x1"], py1, ymax, r["zc"] - r["dn"], r["zc"] + r["up"]]})
    # hloubka
    for it in devices:
        pred = it["clear"].get("pred")
        lim = yd - float(pred or 0)
        if it["box"][3] > lim + 1e-6:
            res["proc"].append(f"hloubka: {it['tag']} čelo y {it['box'][3]:.1f} + mezera před {pred or 0} > vnitřní líc dveří {yd:.1f} mm")
    if res["proc"]:
        return res
    # zóny mezer: stanice / svorkovnice jako celek, jinak po kusech
    groups: dict = {}
    for it in devices:
        k = it.get("block") or f"{it['tag']}#{it['inst']}#{it.get('kind', '')}"
        groups.setdefault(k, []).append(it)
    for k, mem in groups.items():
        if all(i.get("kind") == "zarazka" for i in mem):
            continue
        real = [i for i in mem if i.get("kind") != "zarazka"]
        bx = [min(i["box"][0] for i in real), max(i["box"][1] for i in real), min(i["box"][2] for i in real),
              max(i["box"][3] for i in real), min(i["box"][4] for i in real), max(i["box"][5] for i in real)]
        c = real[0]["clear"]
        bok, nad, pod, pred = (float(c.get(x) or 0) for x in ("bok", "nad", "pod", "pred"))
        zone = [bx[0] - bok, bx[1] + bok, bx[2], bx[3] + pred, bx[4] - pod, bx[5] + nad]
        tag = real[0]["tag"] if len(real) == 1 else f"{real[0]['tag']}…{real[-1]['tag']}"
        zones.append({"name": f"Mezera {tag}", "pro": tag, "box": [round(v, 2) for v in zone], "clen": [f"{i['tag']}#{i['inst']}" for i in real],
                      "stav": c.get("stav"), "nad": nad, "pod": pod, "bok": bok, "pred": c.get("pred")})
    conflicts = []
    bodies = [(f"{i['tag']}#{i['inst']}", i["box"]) for i in devices if i.get("kind") != "zarazka"]
    bodies += [(dct["name"], [dct["x0"], dct["x1"], dct["y0"], dct["y1"], dct["z0"], dct["z1"]]) for dct in ducts]
    for zn in zones:
        for name, bx in bodies:
            if name in zn["clen"]:
                continue
            if _overlap(zn["box"], bx):
                conflicts.append(f"{zn['name']} × {name}")
    # dveře
    door_items = [i for i in items if i["group"] == "dvere"]
    door, derr = place_door(door_items, W, H, D, yd, devices, zones, reserves, ducts)
    if derr:
        res["proc"].append(derr)
        return res
    res.update(ok=True, rails=rails, ducts=ducts, devices=devices, zones=zones, reserves=reserves, door=door,
               konflikty_zon=conflicts)
    return res


def place_door(door_items: list, W, H, D, yd, devices, zones, reserves, ducts) -> tuple[dict, str]:
    """Přístroje na dveřích: místo, kde jejich hloubka za dveřmi nenarazí do přístrojů / zón na desce (rezervy jen
    v nouzi — s varováním). Pořadí: HMI (nejvyšší třetina, střed), ostatní (vpravo nahoře, dál od pantů)."""
    G = GEOM
    t = G["stena"]
    out = {"items": [], "varovani": []}
    if not door_items:
        return out, ""
    obst = [(f"{i['tag']}", i["box"]) for i in devices]
    obst += [(z["name"], z["box"]) for z in zones]
    obst += [(d["name"], [d["x0"], d["x1"], d["y0"], d["y1"], d["z0"], d["z1"]]) for d in ducts]
    res_obst = [(r["name"], r["box"]) for r in reserves]
    placed = []
    xmin, xmax = t + G["dvere_okraj"] + G["dvere_pant_pas"], W - t - G["dvere_okraj"]
    zmin, zmax = t + G["dvere_okraj"], H - t - G["dvere_okraj"]
    order = sorted(door_items, key=lambda i: (0 if i["geom"]["hmi"] else 1, -i["geom"]["w"] * i["geom"]["h"]))
    for it in order:
        g = it["geom"]
        w, h = g["w"], g["h"]
        depth_in = (g["d"] - G["dvere"]) if g["hmi"] else g["d"]
        y_back = yd - depth_in if not g["hmi"] else D - g["d"]
        m = G["dvere_mezera"]
        xs = [x for x in _frange(xmin, xmax - w, 5.0)]
        zs = [z for z in _frange(zmin, zmax - h, 5.0)]
        if g["hmi"]:
            zc = zmin + (zmax - zmin) * G["hmi_vyska_pct"]
            xc = (W - w) / 2
            cand = sorted(((x, z) for x in xs for z in zs), key=lambda p: (abs(p[1] + h / 2 - zc) + abs(p[0] - xc)))
        else:
            cand = sorted(((x, z) for x in xs for z in zs), key=lambda p: (-(p[1] + h), -p[0]))
        found = None
        for allow_res in (False, True):
            for x, z in cand:
                fp = [x - m, x + w + m, y_back - 2.0, yd + 0.01, z - m, z + h + m]
                if any(_overlap(fp, [p["box"][0] - m, p["box"][1] + m, p["box"][2], p["box"][3], p["box"][4] - m, p["box"][5] + m])
                       for p in placed):
                    continue
                if any(_overlap(fp, bx) for _n, bx in obst):
                    continue
                hit = [n for n, bx in res_obst if _overlap(fp, bx)]
                if hit and not allow_res:
                    continue
                found = (x, z, hit)
                break
            if found:
                break
        if not found:
            return out, f"dveře: {it['tag']} ({w:.0f} × {h:.0f}, hloubka za dveřmi {depth_in:.0f} mm) nemá místo bez kolize s přístroji / mezerami na desce"
        x, z, hit = found
        if g["hmi"]:
            box = [x, x + w, D - g["d"], D, z, z + h]
        else:
            box = [x, x + w, yd - g["d"], yd, z, z + h]
        it["box"] = [round(v, 3) for v in box]
        it["door"] = True
        placed.append(it)
        out["items"].append(it)
        if hit:
            out["varovani"].append(f"{it['tag']} na dveřích zasahuje hloubkou do {', '.join(hit)} — rezerva tam je omezená")
    return out, ""


def _frange(a, b, s):
    if b < a:
        return []
    n = int(math.floor((b - a) / s + 1e-9))
    return [a + i * s for i in range(n + 1)] + ([b] if (b - a) % s > 1e-6 else [])


def _mirror_x(res: dict, W: float) -> None:
    """Rozmístění se počítá „zleva“ (x od pantů); pravotočivé souřadnice s Y k dveřím ale při pohledu od dveří ukazují
    +X doleva. Překlopení x → W − x dá pohled zepředu: CPU / první přístroj a panty vlevo, rezerva lišty vpravo."""
    def fb(b):
        b[0], b[1] = round(W - b[1], 3), round(W - b[0], 3)
    for it in res["devices"] + res["door"]["items"]:
        fb(it["box"])
    for z in res["zones"] + res["reserves"]:
        fb(z["box"])
    for d in res["ducts"]:
        d["x0"], d["x1"] = round(W - d["x1"], 3), round(W - d["x0"], 3)
        d["name"] = {"Žlab V1": "Žlab V2", "Žlab V2": "Žlab V1"}.get(d["name"], d["name"])
    for r in res["rails"]:
        r["x0"], r["x1"] = round(W - r["x1"], 3), round(W - r["x0"], 3)
        r["konec"] = round(W - r["konec"], 1)
    rl = res["rail"]
    rl["x0"], rl["x1"] = round(W - rl["x1"], 3), round(W - rl["x0"], 3)
    pl = res["plate"]
    pl["x0"], pl["x1"] = round(W - pl["x1"], 3), round(W - pl["x0"], 3)


# --- tepelná bilance --------------------------------------------------------------------------------------------------

def area(cab: dict, mount: str = "stena") -> float:
    W, H, D = cab["w"] / 1000.0, cab["h"] / 1000.0, cab["d"] / 1000.0
    a = W * H + W * D + 2 * H * D
    if mount == "volne":
        a += W * H
    return a


def thermal(cab: dict, items: list, tamb: float, tin: float, mount: str = "stena", alt: float = 0.0) -> dict:
    met = load("ztraty")["metoda"]
    k = float(met["k_ocel"])
    A = area(cab, mount)
    rows, missing, extract, tmaxs = [], [], [], []
    for it in items:
        if it.get("kind") == "zarazka":
            continue
        ls = it["loss"]
        rows.append({"tag": it["tag"], "inst": it["inst"], "code": it["code"], "W": ls.get("W"), "stav": ls.get("stav"),
                     "co": ls.get("co", ""), "zdroj": ls.get("zdroj"), "tmax": ls.get("tmax"), "tmax_text": ls.get("tmax_text", "")})
        if ls.get("W") is None:
            missing.append(f"{it['tag']}#{it['inst']} ({it['code'] or it['cat']})")
        elif ls.get("stav") == "výtah":
            extract.append(f"{it['tag']}#{it['inst']}")
        if ls.get("tmax") is not None:
            tmaxs.append((float(ls["tmax"]), it["tag"], ls.get("tmax_text", "")))
    qv = round(sum(float(r["W"]) for r in rows if r["W"] is not None), 2)
    tdev = min(tmaxs) if tmaxs else None
    ti = min(tin, tdev[0]) if tdev else tin
    dT = ti - tamb
    qs = round(k * A * dT, 2) if dT > 0 else 0.0
    t_est = round(tamb + qv / (k * A), 1)
    if dT <= 0:
        verdict = "nevyhovuje"
    elif qv > qs:
        verdict = "nevyhovuje"
    elif missing:
        verdict = "nelze rozhodnout"
    else:
        verdict = "vyhovuje"
    f = 3.1
    for rng, val in met["f_vyska"].items():
        lo, hi = (float(x) for x in rng.split("-"))
        if lo <= alt < hi or (alt >= hi and rng.endswith("1000")):
            f = float(val)
    meas = []
    if verdict == "nevyhovuje" and dT > 0:
        a_req = qv / (k * dT)
        bigger = next((c for c in cabinets() if area(c, mount) >= a_req and c["d"] >= cab["d"]), None)
        meas.append(f"filtrační ventilátor ≥ {f * qv / dT:.0f} m³/h (V = f · Qv / ΔT = {f} · {qv:.1f} / {dT:.0f}; Rittal TSH str. 7) — "
                    "typ bez kódu, s výstupním filtrem; snižuje krytí skříně — NÁVRH k odsouhlasení")
        meas.append(f"chladicí jednotka / výměník ≥ {qv - qs:.0f} W (Qv − Qs) — zachová krytí; typ bez kódu — NÁVRH")
        if bigger:
            meas.append(f"větší skříň s plochou ≥ {a_req:.2f} m²: {bigger['brand']} {bigger['orderCode']} "
                        f"({bigger['w']}×{bigger['h']}×{bigger['d']}, A = {area(bigger, mount):.2f} m²) — přirozené chlazení")
        else:
            meas.append(f"skříň s plochou ≥ {a_req:.2f} m² v katalogu PLCdesk není — přirozené chlazení nestačí")
        meas.append("nižší okolní teplota (zadání neuvádí — ověřit u zákazníka)")
    elif verdict == "nevyhovuje":
        meas.append(f"okolí {tamb} °C ≥ dovolená vnitřní {ti} °C — přirozené chlazení nefunguje, nutné chlazení (výměník / klimatizace) — NÁVRH")
    return {"k": k, "k_zdroj": met["k_zdroj"], "A": round(A, 3), "plocha": met["plocha"], "montaz": mount, "tamb": tamb,
            "tin_param": tin, "tdev": {"t": tdev[0], "tag": tdev[1], "text": tdev[2]} if tdev else None, "ti": ti, "dT": dT,
            "Qv": qv, "Qs": qs, "t_odhad": t_est, "verdikt": verdict, "chybi": missing, "vytah": extract, "radky": rows,
            "f": f, "f_zdroj": met["f_zdroj"], "opatreni": meas}


# --- hlavní funkce ----------------------------------------------------------------------------------------------------

def _cab_from_manifest(cabp: dict | None) -> dict | None:
    if not cabp:
        return None
    code = norm_code(cabp.get("orderCode") or "")
    return next((c for c in cabinets() if norm_code(c["orderCode"]) == code), None)


def plan(manifest: dict, *, folder: str | Path | None = None, parts_index: dict | None = None, rezerva: float = 20.0,
         tamb: float = 35.0, tin: float = 40.0, mount: str = "stena", alt: float = 0.0,
         manifest_path: str | Path | None = None) -> dict:
    if parts_index is None and folder is not None:
        pi = Path(folder) / "dily" / "parts_index.json"
        if pi.is_file():
            try:
                parts_index = json.loads(pi.read_text(encoding="utf-8"))
            except ValueError:
                parts_index = None
    items, cabp, notes = expand(manifest, parts_index)
    out = {"format": FORMAT, "version": VERSION, "created": _dt.datetime.now().isoformat(timespec="seconds"),
           "manifest": str(manifest_path or ""), "params": {"rezerva": rezerva, "tamb": tamb, "tin": tin, "montaz": mount, "vyska_nm": alt},
           "geom": GEOM, "geom_text": GEOM_TEXT, "poznamky": notes, "pokusy": [], "ok": False,
           "projectGuid": (manifest.get("project") or {}).get("guid") or "", "projekt": (manifest.get("project") or {}).get("name") or ""}
    if manifest_path:
        try:
            out["manifestSha256"] = hashlib.sha256(Path(manifest_path).read_bytes()).hexdigest()
        except OSError:
            pass
    if not items:
        out["chyba"] = "manifest nemá žádné přístroje s location = cabinet"
        return out
    first = _cab_from_manifest(cabp)
    order = ([first] if first else []) + [c for c in cabinets() if c is not first]
    chosen = None
    for c in order:
        for it in items:
            it.pop("box", None)
            it.pop("door", None)
        r = try_cabinet(c, items, rezerva)
        out["pokusy"].append({"skrin": f"{c['brand']} {c['orderCode']}", "ok": r["ok"], "proc": r["proc"]})
        if r["ok"]:
            chosen = r
            break
    fb = []
    mcode = (cabp or {}).get("orderCode") or ""
    if cabp and not first:
        out["poznamky"].append(f"skříň manifestu {mcode} není v katalogu s rozměry desky — vybrána nejmenší vyhovující")
    if not chosen:
        out["chyba"] = "výbava se nevejde do žádné skříně katalogu PLCdesk (s rezervou {:.0f} %)".format(rezerva)
        fb.append({"kind": "cabinet_too_small", "partId": (cabp or {}).get("id") or "+1:cabinet",
                   "text": out["chyba"] + "; poslední pokus: " + "; ".join(out["pokusy"][-1]["proc"])})
        out["zpetna_vazba"] = fb
        return out
    cab = chosen["cabinet"]
    _mirror_x(chosen, float(cab["w"]))
    out["ok"] = True
    out["cabinet"] = {"id": (cabp or {}).get("id") or "+1:cabinet", "tag": (cabp or {}).get("tag") or "+1",
                      "brand": cab["brand"], "orderCode": cab["orderCode"], "typ": cab["typ"], "w": cab["w"], "h": cab["h"],
                      "d": cab["d"], "plateW": cab["plateW"], "plateH": cab["plateH"], "src": cab["src"], "katalog": cab.get("katalog", ""),
                      "manifestCode": mcode, "zmena": bool(mcode) and norm_code(mcode) != norm_code(cab["orderCode"]),
                      "guid": (cabp or {}).get("guid") or ""}
    if out["cabinet"]["zmena"]:
        why = next((p["proc"] for p in out["pokusy"] if norm_code(p["skrin"].split()[-1]) == norm_code(mcode)), [])
        fb.append({"kind": "cabinet_too_small", "partId": out["cabinet"]["id"],
                   "text": f"výbava se do skříně {mcode} nevejde ({'; '.join(why)}) — vygenerováno ve {cab['brand']} {cab['orderCode']} "
                           f"({cab['w']}×{cab['h']}×{cab['d']}); rozhodne uživatel v PLCdesk (krok Kusovník)"})
    out.update({k: chosen[k] for k in ("plate", "yd", "rail", "vyska", "ducts", "zones", "reserves", "konflikty_zon")})
    out["rails"] = [{k: v for k, v in r.items() if k != "items"} | {"items": [f"{i['tag']}#{i['inst']}" if i.get('kind') != 'zarazka' else i['tag']
                                                                                for i in r["items"]]} for r in chosen["rails"]]
    out["devices"] = [_dev_out(i) for i in chosen["devices"]]
    out["door"] = {"items": [_dev_out(i) for i in chosen["door"]["items"]], "varovani": chosen["door"]["varovani"]}
    bil = thermal(cab, items, tamb, tin, mount, alt)
    out["bilance"] = bil
    dv = dvere.apply(out)                       # dveře, kabeláž ke dveřím, oddělení tras, PE / N, ventilátor
    out["door"]["varovani"] += dv["varovani"]
    out["hw"] = hardware(out)
    if bil["verdikt"] == "nevyhovuje":
        fb.append({"kind": "other", "partId": out["cabinet"]["id"],
                   "text": f"tepelná bilance nevyhovuje: Qv {bil['Qv']:.1f} W > Qs {bil['Qs']:.1f} W (ΔT {bil['dT']:.0f} K, A {bil['A']:.2f} m²); "
                           "opatření: " + "; ".join(bil["opatreni"])})
    fan = bil.get("ventilator")
    if fan:
        if fan.get("typ"):
            fb.append({"kind": "other", "partId": out["cabinet"]["id"],
                       "text": f"návrh opatření tepelné bilance: filtrační ventilátor Rittal {fan['typ']['kod']} + výstupní filtr "
                               f"{fan['filtr']['kod']} ve dveřích (mimo kusovník, ke schválení); Q {fan['Q']:.1f} W, průtok s filtrem "
                               f"{fan['typ']['V_filtr']:.0f} m³/h, Ti {fan['ti_s']:.1f} °C, rezerva {fan['rezerva_K']:.1f} K"
                               + ("" if fan["rezerva_ok"] else " — REZERVA < 2 K") + "; snižuje krytí na IP 54"})
        else:
            fb.append({"kind": "other", "partId": out["cabinet"]["id"], "text": "tepelná bilance: " + fan.get("duvod", "")})
    for k, r in (out.get("kabelaz_dvere") or {}).items():
        if r.get("chyby"):
            fb.append({"kind": "other", "partId": "", "text": f"kabeláž ke dveřím ({k}): " + "; ".join(r["chyby"])})
    bad = [x for x in out["oddeleni"]["tabulka"] if not x["ok"]]
    if bad:
        fb.append({"kind": "other", "partId": "", "text": "oddělení silových a signálových tras nesplněno: "
                   + "; ".join(f"{x['a']} × {x['b']} {x['vzdalenost']:.0f} mm" for x in bad)})
    fb.append({"kind": "other", "partId": "", "text": "návrh mimo kusovník: PE a N přípojnice, přepážky žlabů, upínky a ochrana svazků "
               "ke dveřím, čelní obálka hlavního vypínače — doplnit do kusovníku nebo odsouhlasit (rozvaděč vygenerovaný kódem)"})
    if bil["chybi"]:
        cnt: dict = {}
        for x in bil["chybi"]:
            k = x.split(" (", 1)[-1].rstrip(")")
            cnt[k] = cnt.get(k, 0) + 1
        fb.append({"kind": "other", "partId": "", "text": "ztrátový výkon nedoložen (bilance neúplná): "
                   + ", ".join(f"{k} × {n}" for k, n in cnt.items())})
    out["zpetna_vazba"] = fb
    out["odhady"] = _estimates(out)
    out["verdikt"] = {"vejde_se": True, "rezerva_ok": all(r["rezerva_pct"] >= rezerva - 1e-6 for r in out["rails"]),
                      "bilance": bil["verdikt"], "konflikty_zon": len(out["konflikty_zon"]),
                      "bilance_s_opatrenim": (fan or {}).get("verdikt"), "dvere_chyby": len(dv["chyby"]),
                      "oddeleni_ok": not bad}
    return out


# --- spojovací materiál, díry, panty, vývodky (čistý Python — FreeCAD jen staví) -----------------------------------------

@lru_cache(maxsize=None)
def _normalie() -> dict:
    p = PARTS_DIR / "data" / "normalie.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.is_file() else {}


def _iso4762(M: str) -> dict:
    n = _normalie().get("ISO4762") or {}
    row = dict((n.get("rady") or {}).get(M) or {})
    if not row:
        raise ValueError(f"ISO 4762 {M} není v pro3d_parts/data/normalie.json")
    row.update(d=float(M[1:]), M=M, zdroj=n.get("zdroj", ""))
    return row


def _screw(name, M, l, head, direction, ucel):
    r = _iso4762(M)
    return {"name": name, "norma": "ISO 4762", "M": M, "d": r["d"], "l": round(float(l), 2), "dk": r["dk"], "k": r["k"], "s": r["s"],
            "t": r["t"], "P": r["P"], "head": [round(v, 3) for v in head], "dir": list(direction), "ucel": ucel, "zdroj": r["zdroj"]}


def _positions(a: float, b: float, step: float, inset: float, avoid=(), clear=8.0) -> list:
    """Polohy šroubů na úsečce ⟨a, b⟩: oba konce (± inset) a mezi nimi po ≤ step; mimo ``avoid`` ± clear."""
    lo, hi = a + inset, b - inset
    if hi <= lo:
        return [round((a + b) / 2, 2)]
    n = max(1, int(math.ceil((hi - lo) / step)))
    pts = [lo + (hi - lo) * i / n for i in range(n + 1)]
    out = []
    for p in pts:
        q = p
        for _ in range(8):
            bad = [v for v in avoid if abs(v - q) < clear]
            if not bad:
                break
            q = bad[0] + clear if q >= bad[0] else bad[0] - clear
        if lo - inset <= q <= hi + inset and all(abs(q - o) > 2 * clear for o in out):
            out.append(round(q, 2))
    return out


def hardware(lay: dict) -> dict:
    """Díry, sloupky, šrouby, zarážky, panty a vývodky z rozmístění. Konvence šroubu: ``head`` = střed dosedací plochy
    hlavy, ``dir`` = směr dříku (jednotkový vektor)."""
    G = GEOM
    cab, pl = lay["cabinet"], lay["plate"]
    W, H, D = float(cab["w"]), float(cab["h"]), float(cab["d"])
    t = G["stena"]
    py0, py1 = pl["y0"], pl["y1"]
    yr = py1 + 7.5
    down = (0.0, -1.0, 0.0)
    hw = {"plate_holes": [], "studs": [], "screws": [], "rail_holes": {}, "duct_holes": {}, "endstops": [], "door_holes": [],
          "door_cutouts": [], "glands": [], "gland_holes": [], "hinges": [], "pin_holes": []}
    # deska na 4 sloupcích (M6 do závitu sloupku)
    m6 = _iso4762("M6")
    for i, (x, z) in enumerate(((pl["x0"] + 7.5, pl["z0"] + 7.5), (pl["x1"] - 7.5, pl["z0"] + 7.5),
                                (pl["x0"] + 7.5, pl["z1"] - 7.5), (pl["x1"] - 7.5, pl["z1"] - 7.5)), start=1):
        hw["studs"].append({"x": x, "z": z, "r": G["sloupek_r"], "y0": t, "y1": py0, "tap": round(m6["d"] - m6["P"], 3)})
        hw["plate_holes"].append({"x": x, "z": z, "d": m6["d"] + 0.2, "druh": "průchozí"})
        hw["screws"].append(_screw(f"Šroub desky {i} ISO 4762 M6×12", "M6", 12, (x, py1, z), down, "deska → sloupek skříně"))
    m4 = _iso4762("M4")
    tap4 = round(m4["d"] - m4["P"], 3)
    # lišty
    stops = [d for d in lay["devices"] if d["kind"] == "zarazka"]
    for r in lay["rails"]:
        if r["kind"] != "din":
            continue
        avoid = [(d["box"][0] + d["box"][1]) / 2 for d in stops if d["rail"] == r["n"]]
        xs = _positions(r["x0"], r["x1"], G["rozteč_srouby_lista"], 10.0, avoid)
        hw["rail_holes"][str(r["n"])] = [{"x": x, "d": m4["d"] + 0.2} for x in xs]
        for j, x in enumerate(xs, start=1):
            hw["plate_holes"].append({"x": x, "z": r["zc"], "d": tap4, "druh": "závit M4"})
            hw["screws"].append(_screw(f"Šroub lišty {r['n']}.{j} ISO 4762 M4×6", "M4", 6, (x, py1 + 1.0, r["zc"]), down,
                                       f"lišta {r['n']} → deska"))
    # zarážky (šroub M4 v závitu zarážky, hrot na dně kanálu lišty)
    for k, d in enumerate(stops, start=1):
        x = (d["box"][0] + d["box"][1]) / 2
        z = (d["box"][4] + d["box"][5]) / 2
        hw["endstops"].append({"name": f"Koncová zarážka {k} (návrh)", "box": d["box"], "tap": tap4, "x": x, "z": z})
        l = d["box"][3] - (py1 + 1.0)
        hw["screws"].append(_screw(f"Šroub zarážky {k} ISO 4762 M4×{l:.1f}", "M4", l, (x, d["box"][3], z), down,
                                   "zarážka → lišta (hrot na dně kanálu)"))
    # žlaby
    for dct in lay["ducts"]:
        if dct["orient"] == "h":
            zc = (dct["z0"] + dct["z1"]) / 2
            pts = [(x, zc) for x in _positions(dct["x0"], dct["x1"], G["rozteč_srouby_zlab"], 20.0)]
        else:
            xc = (dct["x0"] + dct["x1"]) / 2
            pts = [(xc, z) for z in _positions(dct["z0"], dct["z1"], G["rozteč_srouby_zlab"], 20.0)]
        hw["duct_holes"][dct["name"]] = [{"x": x, "z": z, "d": m4["d"] + 0.2} for x, z in pts]
        for j, (x, z) in enumerate(pts, start=1):
            hw["plate_holes"].append({"x": x, "z": z, "d": tap4, "druh": "závit M4"})
            hw["screws"].append(_screw(f"Šroub {dct['name'].lower()}.{j} ISO 4762 M4×6", "M4", 6, (x, py1 + G["zlab_t"], z), down,
                                       f"{dct['name']} → deska"))
    # přístroje na desce (mimo lištu): 2 × M5, hlava těsně u horní / dolní hrany přístroje (poloha ODHAD — vrtací obrazec doplnit)
    m5 = _iso4762("M5")
    for d in lay["devices"]:
        if d["kind"] == "zarazka" or d["mount"] not in ("panel",) or d["door"]:
            continue
        b = d["box"]
        xc = (b[0] + b[1]) / 2
        for side, z in (("nahoře", b[5] + m5["dk"] / 2 + 0.05), ("dole", b[4] - m5["dk"] / 2 - 0.05)):
            hw["plate_holes"].append({"x": xc, "z": z, "d": round(m5["d"] - m5["P"], 3), "druh": "závit M5"})
            hw["screws"].append(_screw(f"Šroub {d['tag']} {side} ISO 4762 M5×8", "M5", 8, (xc, py1, z), down,
                                       f"upevnění {d['tag']} k desce (poloha ODHAD, vrtací obrazec z datasheetu doplnit)"))
    # dveře (dvere.apply): výřezy, vrtací obrazce, šrouby čelní montáže dle data/dvere.json
    dv = lay.get("dvere") or {}
    hw["door_cutouts"] += dv.get("door_cutouts", [])
    hw["door_holes"] += [dict(h, d=h["d"] + (0.0 if h.get("pozn") else 0.0)) for h in dv.get("door_holes", [])]
    for sc in dv.get("screws", []):
        hw["screws"].append(_screw(sc["name"], sc["M"], sc["l"], sc["head"], sc["dir"], sc["ucel"]))
    # přepážky smíšených žlabů: šrouby M4 patkou a dnem žlabu do závitu desky (mezi šrouby žlabu)
    hw["partitions"] = []
    for p in (lay.get("oddeleni") or {}).get("prepazky", []):
        dct = next(d for d in lay["ducts"] if d["name"] == p["zlab"])
        hs = hw["duct_holes"].get(dct["name"], [])
        along = [h["x"] for h in hs] if p["orient"] == "h" else [h["z"] for h in hs]
        lo, hi = (dct["x0"], dct["x1"]) if p["orient"] == "h" else (dct["z0"], dct["z1"])
        mids = [(a + b) / 2 for a, b in zip(along, along[1:])] or [(lo + hi) / 2]
        notches = [(h["x"], h["z"]) for h in hs]
        scr = []
        for j, u in enumerate(mids, start=1):
            x, z = (u, p["skrz"]) if p["orient"] == "h" else (p["skrz"], u)
            hw["duct_holes"][dct["name"]].append({"x": x, "z": z, "d": m4["d"] + 0.2})
            hw["plate_holes"].append({"x": x, "z": z, "d": tap4, "druh": "závit M4"})
            hw["screws"].append(_screw(f"Šroub přepážky {dct['name'].lower()}.{j} ISO 4762 M4×6", "M4", 6, (x, p["patka"][3], z), down,
                                       f"přepážka {dct['name']} → deska (uzemnění)"))
            scr.append((x, z))
        hw["partitions"].append(dict(p, notches=notches, screws=scr))
    hw["endplates"] = list((lay.get("oddeleni") or {}).get("celni", []))
    # PE / N přípojnice: PE šrouby do závitu desky, N šroub jen do izolátoru, izolátor na závrtném šroubu v desce
    pr = lay.get("pripojnice") or {}
    hw["busbars"] = None
    if pr and not pr.get("chyba"):
        Mb = pr["sroub"]
        rb_ = _iso4762(Mb)
        tapb = round(rb_["d"] - rb_["P"], 3)
        iz = pr["izolator"]
        pe, nn = pr["PE"], pr["N"]
        for k, z in enumerate(pe["sroub_z"], start=1):
            hw["plate_holes"].append({"x": pe["x"], "z": z, "d": tapb, "druh": f"závit {Mb} (PE)"})
            hw["screws"].append(_screw(f"Šroub PE přípojnice {k} ISO 4762 {Mb}×6", Mb, 6, (pe["x"], pe["box"][3], z), down,
                                       "PE přípojnice → deska (vodivě)"))
        studs = []
        # délka šroubu N: přípojnice + zašroubování ≥ 1,5·d do vložky izolátoru (skill spoje-sroubove kap. 6), ale ne přes
        # hloubku závitu (šroub nesmí dosednout na dno); normalizované délky ISO 4762
        tn, hz = float(nn["t"]), float(iz["hloubka"])
        ln = next((x for x in (6, 8, 10, 12, 16, 20) if tn + 1.5 * rb_["d"] + 0.5 <= x <= tn + hz), 8)
        for k, z in enumerate(iz["z"], start=1):
            hw["plate_holes"].append({"x": nn["x"], "z": z, "d": tapb, "druh": f"závit {Mb} (izolátor N)"})
            hw["screws"].append(_screw(f"Šroub N přípojnice {k} ISO 4762 {Mb}×{ln:g} (jen do izolátoru)", Mb, ln,
                                       (nn["x"], nn["box"][3], z), down, "N přípojnice → izolátor (izolovaně od desky)"))
            studs.append({"name": f"Závrtný šroub izolátoru N {k} {Mb}×{float(iz['hloubka']) + G['deska']:.1f}", "x": nn["x"], "z": z,
                          "r": rb_["d"] / 2, "y0": pl["y0"], "y1": pl["y1"] + float(iz["hloubka"])})
        hw["busbars"] = {"PE": pe, "N": nn, "izolator": iz, "studs": studs, "tap": tapb, "y_deska": pl["y1"]}
    # panty vlevo při pohledu zepředu (= na straně x = W, viz _mirror_x); dveře se otevírají ven (−95° kolem osy Z)
    ax, ay = W + G["pant_r"], D - G["dvere"] / 2
    for k, zh in enumerate((H * 0.2, H * 0.8 - 2 * G["pant_l"]), start=1):
        hw["hinges"].append({"n": k, "x": ax, "y": ay, "z0": round(zh, 2), "zm": round(zh + G["pant_l"], 2),
                             "z1": round(zh + 2 * G["pant_l"], 2), "r": G["pant_r"], "pin_r": 3.0, "hole_r": 3.1,
                             "leaf_x0": W, "leaf_x1": ax})
    hw["door_axis"] = {"bod": [ax, ay, 0.0], "osa": [0.0, 0.0, 1.0], "uhel": -95.0}
    # vývodky ve dně
    sk = (_normalie().get("SKINTOP_ST-M") or {}).get("rady", {}).get(G["vyvodka"]) or {"thread": 20, "sw": 25, "C": 37.0, "D": 9}
    n = len({d["tag"] for d in lay["devices"] if d["cat"] == "terminal_block"}) + 1
    span0, span1 = t + 40.0, W - t - 40.0
    step = max(sk["sw"] * 1.4, (span1 - span0) / max(1, n - 1)) if n > 1 else 0
    for i in range(n):
        x = span0 + i * step if n > 1 else W / 2
        if x > span1 + 1e-6:
            break
        hw["glands"].append({"name": f"Vývodka {i + 1} SKINTOP ST-M {G['vyvodka']} (návrh)", "x": round(x, 2), "y": round(D / 2, 2),
                             "thread": sk["thread"], "sw": sk["sw"], "C": sk["C"], "D": sk["D"],
                             "zdroj": (_normalie().get("SKINTOP_ST-M") or {}).get("zdroj", "")})
        hw["gland_holes"].append({"x": round(x, 2), "y": round(D / 2, 2), "d": sk["thread"] + 0.2})
    return hw


def _dev_out(i: dict) -> dict:
    g = i["geom"]
    return {"pid": i["pid"], "inst": i["inst"], "tag": i["tag"], "label": i["label"], "cat": i["cat"], "mount": i["mount"],
            "code": i["code"], "brand": i.get("brand", ""), "type": i.get("type", ""), "kind": i.get("kind", "pristroj"),
            "group": i["group"], "station": i.get("station"), "slot": i.get("slot"), "block": i.get("block"), "rail": i.get("rail"),
            "door": bool(i.get("door")), "box": i["box"], "model": g.get("model"), "lb": g["lb"], "hmi": g.get("hmi", False),
            "rozmer": {"w": g["w"], "h": g["h"], "d": g["d"], "stav": g["stav"], "zdroj": g["zdroj"]}, "mezery": i["clear"],
            "ztrata": i["loss"], "safety": i.get("safety", False)}


def _estimates(out: dict) -> list:
    L = [f"{k}: {v}" for k, v in GEOM_TEXT.items()]
    for d in out["devices"] + out["door"]["items"]:
        if d["kind"] == "zarazka":
            continue
        if d["rozmer"]["stav"] == "ODHAD":
            L.append(f"rozměr {d['tag']} ({d['code'] or d['cat']}): {d['rozmer']['zdroj']}")
    seen = set()
    for d in out["devices"]:
        c = d["mezery"]
        if c.get("stav") == "ODHAD" and d["kind"] != "zarazka" and (d["code"] or d["cat"]) not in seen:
            seen.add(d["code"] or d["cat"])
            L.append(f"mezery {d['tag']} ({d['code'] or d['cat']}): ODHAD nad/pod {c['nad']} / {c['pod']} mm — DOLOŽIT z návodu")
    L.append("tepelná bilance: " + out["bilance"]["plocha"])
    dd = dvere.data()
    L.append("kabeláž ke dveřím: " + dd["obsazeni"]["_pozn"] + "; " + dd["svazek"]["pozn"] + "; " + dd["smycka"]["pozn"])
    L.append("přepážky žlabů a dělicí plechy u pantu: plech 1 mm, patka 7,5 mm, šrouby M4 do desky (typ a uzemnění ODHAD)")
    L.append("PE / N: " + dd["pripojnice"]["N"]["odhad"] + "; " + dd["pripojnice"]["izolator"]["pozn"])
    L.append("ventilátor / filtr: " + dd["ventilatory"]["_pozn"] + "; " + dd["ventilatory"]["hloubka_text"])
    L.append("dveře: " + dd["pristroje"]["3LD2103-0TK53"]["sroub"]["pozn"] + "; upínky MTP700: "
             + dd["pristroje"]["6AV2123-3GB32-0AW0"]["upinky"]["tvar"]["pozn"])
    return L
