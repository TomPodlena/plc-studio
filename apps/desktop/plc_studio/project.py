"""Kontrola a doplnění projektu načteného ze souboru (nebo ze stavu aplikace).

Soubor projektu může přijít odkudkoli (web, ruční úprava, starší verze). Kroky
i jádro počítají s úplnou strukturou (``blankProject`` v ``model.ts``), takže
se tu chybějící části doplní, neplatné položky zahodí a nepoužitelný soubor
odmítne dřív, než se jím přepíše rozpracovaný návrh.
"""

from __future__ import annotations

import math

from .i18n import _

ACTS = {"start", "stop", "open", "close", "wait", "waitOn", "waitOff"}
CONDS = {"fbk", "time"}
DO_ROLES = {"run", "fault", "ready", "stopped", "lock", "auto"}


def finite(v) -> bool:
    """Konečné číslo (bool, NaN ani nekonečno se nepočítá)."""
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def parse_num(text: str) -> float | None:
    """Číslo z pole (desetinná čárka i tečka); prázdné, text, NaN i nekonečno = None."""
    try:
        v = float(str(text).strip().replace(",", "."))
    except ValueError:
        return None
    return v if math.isfinite(v) else None


def _int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _str(v, default: str = "") -> str:
    return v if isinstance(v, str) else default


def normalize(prj, blank: dict, classes, platforms) -> dict:
    """Vrátí úplný projekt; ``ValueError`` s popisem, když se soubor použít nedá."""
    if not isinstance(prj, dict):
        raise ValueError(_("soubor neobsahuje objekt návrhu"))
    if not isinstance(prj.get("meta"), dict) or not isinstance(prj.get("devices"), list):
        raise ValueError(_("chybí části návrhu (meta, devices)"))
    out = {**blank, **prj}

    meta = {**blank["meta"], **prj["meta"]}
    meta["name"], meta["desc"] = _str(meta.get("name")), _str(meta.get("desc"))
    if not (finite(meta.get("takt")) and meta["takt"] > 0):
        meta.pop("takt", None)
    out["meta"] = meta

    plats = prj.get("platforms", blank["platforms"])
    out["platforms"] = list(dict.fromkeys(p for p in plats if p in platforms)) \
        if isinstance(plats, list) else list(blank["platforms"])

    devices, ids = [], set()
    for i, d in enumerate(prj["devices"]):
        if not isinstance(d, dict) or not _int(d.get("id")) or d.get("cls") not in classes:
            raise ValueError(_("zařízení č. {n} nemá platné id nebo třídu", n=i + 1))
        if d["id"] in ids:
            raise ValueError(_("zařízení č. {n} má stejné id jako jiné zařízení", n=i + 1))
        ids.add(d["id"])
        nd = {**d, "name": _str(d.get("name")) or f"{d['cls']}{d['id']}",
              "desc": _str(d.get("desc")), "unit": _str(d.get("unit")),
              "opt": {k: bool(v) for k, v in d["opt"].items()} if isinstance(d.get("opt"), dict) else {},
              "rmin": d["rmin"] if finite(d.get("rmin")) else 0,
              "rmax": d["rmax"] if finite(d.get("rmax")) else 100}
        for key in ("limHi", "limLo", "setpoint"):
            if key in nd and not finite(nd[key]):
                nd.pop(key)
        if "role" in nd and nd["role"] not in DO_ROLES:
            nd.pop("role")
        devices.append(nd)
    out["devices"] = devices
    cls_of = {d["id"]: d["cls"] for d in devices}

    io = prj.get("io") if isinstance(prj.get("io"), list) else []
    out["io"] = [e for e in io if isinstance(e, dict) and isinstance(e.get("key"), str)
                 and e.get("devId") in ids and all(isinstance(e.get(k), str)
                                                   for k in ("sig", "dir", "tag", "addr", "cmt"))]

    prog = prj.get("program") if isinstance(prj.get("program"), dict) else {}
    prog = {**blank["program"], **prog}
    prog["modes"] = prog.get("modes") is not False
    if prog.get("estop") not in ids or cls_of.get(prog.get("estop")) != "DI":
        prog["estop"] = ""
    seq = prog.get("seq") if isinstance(prog.get("seq"), list) else []
    prog["seq"] = [s for s in seq if isinstance(s, dict) and s.get("act") in ACTS
                   and s.get("cond") in CONDS and finite(s.get("timeS")) and s["timeS"] > 0
                   and (s["act"] == "wait" or s.get("dev") in ids)]
    for s in prog["seq"]:
        if s["act"] == "wait":
            s["dev"] = 0
    locks = prog.get("interlocks") if isinstance(prog.get("interlocks"), list) else []
    prog["interlocks"] = [i for i in dict.fromkeys(locks) if i in ids and cls_of[i] == "DI"
                          and i != prog["estop"]]
    out["program"] = prog

    top = max(ids, default=0) + 1
    out["nextId"] = prj["nextId"] if _int(prj.get("nextId")) and prj["nextId"] >= top else top

    sim = prj.get("sim")
    if isinstance(sim, dict):
        out["sim"] = {k: v for k, v in sim.items()
                      if k in ("motorDelay", "valveTravel") and finite(v) and v > 0}
    else:
        out.pop("sim", None)
    bom = normalize_bom(prj.get("bom"), platforms)
    if bom:
        out["bom"] = bom
    else:
        out.pop("bom", None)
    return out


_BOM_TEXT = ("brand", "type", "orderCode", "supplier", "note")


def normalize_bom(bom, platforms) -> dict:
    """Volby kusovníku: jen známé klíče, texty jako řetězce, množství konečné ≥ 0."""
    if not isinstance(bom, dict):
        return {}
    out: dict = {}
    if bom.get("plat") in platforms:
        out["plat"] = bom["plat"]
    if isinstance(bom.get("brand"), dict):
        brand = {str(k): v for k, v in bom["brand"].items() if isinstance(v, str) and v}
        if brand:
            out["brand"] = brand
    lines = {}
    for lid, ln in (bom.get("lines") or {}).items() if isinstance(bom.get("lines"), dict) else ():
        if not isinstance(ln, dict):
            continue
        clean = {k: ln[k] for k in _BOM_TEXT if isinstance(ln.get(k), str)}
        if finite(ln.get("qty")) and ln["qty"] >= 0:
            clean["qty"] = ln["qty"]
        if clean:
            lines[str(lid)] = clean
    if lines:
        out["lines"] = lines
    return out
