"""Kontrola a doplnění projektu načteného ze souboru (nebo ze stavu aplikace).

Soubor projektu může přijít odkudkoli (web, ruční úprava, starší verze). Model projektu
normalizuje JÁDRO (``normalizeProject``, ``packages/core/src/project_norm.ts`` — stejné pravidlo
jako web): každou hodnotu typově ověří, vadné položky zahodí (zařízení bez platného id,
signál s ``devId`` = seznam, krok s ``dev`` = seznam…) a jednořádková pole vyčistí; celý soubor
odmítne, jen když nejde o projekt. Tady zůstávají části, které jádro nepřenáší: bezpečnostní data
a revize / nabídka / knihovna (shodné s webem ``normSafety`` / ``normBiz``).
"""

from __future__ import annotations

import math

from .i18n import _


def finite(v) -> bool:
    """Konečné číslo (bool, NaN ani nekonečno se nepočítá)."""
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def parse_num(text: str) -> float | None:
    """Číslo z pole (desetinná čárka i tečka); prázdné, text, NaN i nekonečno = None."""
    try:
        v = float(str(text).strip().replace(",", "."))
    except (ValueError, OverflowError):
        return None
    return v if math.isfinite(v) else None


def normalize(prj, core_normalize) -> dict:
    """Vrátí úplný projekt; ``ValueError`` s popisem, když se soubor použít nedá.

    ``core_normalize(raw)`` = jádro ``normalizeProject`` přes most (vyhodí výjimku, když vstup
    není projekt). Výsledek doplní o bezpečnostní data a revize / nabídku / knihovnu."""
    if not isinstance(prj, dict):
        raise ValueError(_("soubor neobsahuje objekt návrhu"))
    try:
        out = core_normalize(prj)
    except Exception as exc:  # noqa: BLE001 — chyba jádra = soubor není projekt
        raise ValueError(_("soubor neobsahuje návrh PLCdesk")) from exc
    if not isinstance(out, dict):
        raise ValueError(_("soubor neobsahuje návrh PLCdesk"))
    safety = normalize_safety(prj.get("safety"))
    if safety:
        out["safety"] = safety
    else:
        out.pop("safety", None)
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
