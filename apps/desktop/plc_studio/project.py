"""Kontrola a doplnění projektu načteného ze souboru (nebo ze stavu aplikace).

Soubor projektu může přijít odkudkoli (web, ruční úprava, starší verze). Kroky
i jádro počítají s úplnou strukturou (``blankProject`` v ``model.ts``), takže
se tu chybějící části doplní, neplatné položky zahodí a nepoužitelný soubor
odmítne dřív, než se jím přepíše rozpracovaný návrh.
"""

from __future__ import annotations

import math

from .i18n import _

ACTS = {"start", "stop", "open", "close", "wait", "waitOn", "waitOff",
        "home", "posRecord", "setPressure", "setFlow",   # + pohony fáze 2a (měnič, polohovací pohon, prop. ventil)
        "moveAbs", "moveRel", "velocity", "halt", "waitInPos"}   # + servoosa (fáze 2b)
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


def _iso_date(v) -> bool:
    """Platné datum ISO „YYYY-MM-DD“ (stejné pravidlo jako core isIsoDate)."""
    import datetime as dt
    if not isinstance(v, str) or len(v) != 10:
        return False
    try:
        return dt.date.fromisoformat(v).isoformat() == v
    except ValueError:
        return False


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
    # číslo projektu, zákazník, složka dat: jen neprázdný text (jinak pole v projektu není)
    for k in ("number", "customer", "dataDir"):
        if not (isinstance(meta.get(k), str) and meta[k].strip()):
            meta.pop(k, None)
    # datum zahájení projektu: jen platné ISO YYYY-MM-DD
    if not _iso_date(meta.get("startDate")):
        meta.pop("startDate", None)
    out["meta"] = meta

    plats = prj.get("platforms", blank["platforms"])
    out["platforms"] = list(dict.fromkeys(p for p in plats if p in platforms)) \
        if isinstance(plats, list) else list(blank["platforms"])
    # styl kódu: jen "oop" se ukládá (výchozí klasický = bez pole)
    if prj.get("codeStyle") == "oop":
        out["codeStyle"] = "oop"
    else:
        out.pop("codeStyle", None)

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
        for key in ("limHi", "limLo", "setpoint", "rampS", "tol", "tolTimeS", "selBits", "travelS"):
            if key in nd and not finite(nd[key]):
                nd.pop(key)
        if "records" in nd:      # polohovací pohon: tabulka záznamů jen v platném tvaru
            recs = nd["records"] if isinstance(nd["records"], list) else []
            nd["records"] = [{"no": r["no"], "name": _str(r.get("name")),
                              **({"pos": r["pos"]} if finite(r.get("pos")) else {})}
                             for r in recs if isinstance(r, dict) and _int(r.get("no"))]
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
        # parametry kroků pohonů: otáčky / žádaná, číslo záznamu, směr
        if "sp" in s and not finite(s["sp"]):
            s.pop("sp")
        if "rec" in s and not _int(s["rec"]):
            s.pop("rec")
        if "rev" in s and s["rev"] is not True:
            s.pop("rev")
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
    for key, fn in (("approvals", normalize_approvals), ("commissioning", normalize_commissioning),
                    ("safety", normalize_safety)):
        clean = fn(prj.get(key))
        if clean:
            out[key] = clean
        else:
            out.pop(key, None)
    normalize_biz(prj, out)
    return out


def normalize_biz(prj: dict, out: dict) -> None:
    """Revize, volby nabídky a kopie firemní knihovny: jen v tvaru, se kterým jádro počítá
    (podrobná kontrola je v ``biz_view.js`` / jádře; tady jen, aby rozbitý soubor neshodil kroky)."""
    revs = prj.get("revisions")
    if isinstance(revs, list):
        ok = [r for r in revs if isinstance(r, dict) and all(isinstance(r.get(k), str) for k in
                                                            ("id", "date", "by", "hash", "snapshot"))
              and r["by"].strip()]
        for r in ok:
            if not isinstance(r.get("approvalsAt"), dict):
                r["approvalsAt"] = {}
            if not isinstance(r.get("note"), str):
                r["note"] = ""
        if ok:
            out["revisions"] = ok
        else:
            out.pop("revisions", None)
    else:
        out.pop("revisions", None)
    if not isinstance(prj.get("quote"), dict):
        out.pop("quote", None)
    lib = prj.get("library")
    if not (isinstance(lib, dict) and lib.get("format") == "plcdesk-library"):
        out.pop("library", None)


APPROVAL_STATES = {"proposed", "approved", "rejected"}
COMMISSION_RESULTS = {"ok", "nok", "na"}


def _record(rec, required: tuple, optional: tuple) -> dict | None:
    """Záznam se zadanými povinnými a volitelnými textovými poli (jméno nesmí být prázdné)."""
    if not isinstance(rec, dict) or not all(isinstance(rec.get(k), str) for k in required) \
            or not rec["by"].strip():
        return None
    out = {k: rec[k] for k in required}
    out.update({k: rec[k] for k in optional if isinstance(rec.get(k), str) and rec[k]})
    return out


def normalize_approvals(data) -> dict:
    """Záznamy schválení (``approval.ts``): stav, kdo, kdy, otisk, poznámka; jiné zahodí."""
    out = {}
    for key, rec in data.items() if isinstance(data, dict) else ():
        clean = _record(rec, ("state", "by", "at", "hash"), ("note",))
        if clean and clean["state"] in APPROVAL_STATES:
            out[str(key)] = clean
    return out


def normalize_commissioning(data) -> dict:
    """Výsledky kroků oživení (``commission.ts``): výsledek, kdo, kdy, naměřeno, poznámka."""
    out = {}
    for key, rec in data.items() if isinstance(data, dict) else ():
        clean = _record(rec, ("result", "by", "at"), ("note", "measured"))
        if clean and clean["result"] in COMMISSION_RESULTS:
            out[str(key)] = clean
    return out


_SF_NUM = ("dcIn", "dcOut", "b10dIn", "b10dOut", "mttfdIn", "mttfdOut", "demandS", "tStopMs",
           "tDeviceMs", "tLogicMs", "d", "H", "Z", "DGT", "ss1DelayMs")
_SF_TEXT = ("reduce", "plrSource", "note", "compIn", "compOut")
_SF_CHOICE = {"S": ("S1", "S2"), "F": ("F1", "F2"), "P": ("P1", "P2"),
              "plr": ("a", "b", "c", "d", "e"), "cat": ("B", "1", "2", "3", "4")}
SAFETY_KINDS = {"estop", "guard", "guard_lock", "light_curtain", "multibeam", "scanner", "mat",
                "two_hand", "enabling", "mode", "muting", "restart", "sto", "pneumatic",
                "hydraulic", "vertical", "temperature", "pressure"}
SAFETY_TARGETS = {"siemens", "rockwell", "plcopen", "pilz", "sick", "schmersal", "relay"}


def _str_list(v) -> list[str]:
    return [x for x in v if isinstance(x, str) and x] if isinstance(v, list) else []


def normalize_safety(data) -> dict:
    """Bezpečnostní data (``safety.ts`` SafetyCfg): jen známá pole v platném tvaru.

    Shodné s ``normSafety`` webu; id komponent a logiky ověří jádro při výpočtu (neznámé
    id se ignoruje a použije se návrh)."""
    if not isinstance(data, dict):
        return {}
    out: dict = {}
    for k in ("dop", "hop", "missionYears"):
        if finite(data.get(k)) and data[k] > 0:
            out[k] = data[k]
    if data.get("iso13855") in ("2010", "2024"):
        out["iso13855"] = data["iso13855"]
    if isinstance(data.get("logic"), str) and data["logic"]:
        out["logic"] = data["logic"]
    if data.get("target") in SAFETY_TARGETS:
        out["target"] = data["target"]
    fns = {}
    for ref, c in data.get("fn", {}).items() if isinstance(data.get("fn"), dict) else ():
        if not isinstance(c, dict):
            continue
        clean: dict = {}
        for k in _SF_NUM:
            if finite(c.get(k)) and c[k] >= 0:
                clean[k] = c[k]
        for k in _SF_TEXT:
            if isinstance(c.get(k), str) and c[k].strip():
                clean[k] = c[k]
        for k, allowed in _SF_CHOICE.items():
            if c.get(k) in allowed:
                clean[k] = c[k]
        if c.get("off") is True:
            clean["off"] = True
        if c.get("stopCat") in (0, 1, 2) and not isinstance(c.get("stopCat"), bool):
            clean["stopCat"] = c["stopCat"]
        for k in ("inputs", "acts"):
            if _str_list(c.get(k)):
                clean[k] = _str_list(c[k])
        if isinstance(c.get("ccf"), list):
            clean["ccf"] = _str_list(c["ccf"])
        if clean:
            fns[str(ref)] = clean
    if fns:
        out["fn"] = fns
    add = []
    for a in data.get("add", []) if isinstance(data.get("add"), list) else ():
        if isinstance(a, dict) and isinstance(a.get("ref"), str) and a["ref"] \
                and a.get("kind") in SAFETY_KINDS:
            item = {"ref": a["ref"], "kind": a["kind"]}
            if isinstance(a.get("title"), str) and a["title"]:
                item["title"] = a["title"]
            for k in ("inputs", "acts"):
                if isinstance(a.get(k), list):
                    item[k] = _str_list(a[k])
            add.append(item)
    if add:
        out["add"] = add
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
