"""PLCdesk PRO — časy odezvy a zastavení pro bezpečnostní vzdálenost S = K·T + C (ISO 13855).

Data ``data/bezpecnost_casy.json``: položky (kategorie, výrobce, typ / kódy, veličina, hodnota | tabulka | vzorec,
podmínky, zdroj {url, dokument, strana, cteno, citace}, stav doloženo / chybí). Hodnota bez zdroje v tabulce není —
co výrobce veřejně nedokládá, má stav „chybí“ a poznámku (typicky „změřit“).

Použití (stavitel / koncept, bez sítě)::

    python -m plc_studio.pro3d_parts.bezpecnost_casy --aopd "C4C d=14 h=900" --logika 1214FC \\
        --ventil MS6-SV-E --dobeh 0.13

Každý člen dostane citaci zdroje; člen zadaný číslem bez položky s doloženým zdrojem je ODHAD (ručně, ze zadání).
Výstup = JSON + řádky markdownu pro KONCEPT.md. Čistý Python bez závislostí, nic neimportuje z ``plc_studio``.

Výpočet (ISO 13855:2010; pravidla v ``ISO_RULES`` s odkazem na položky dat se zdrojem):
- kolmo, d ≤ 40 mm: S = 2000·T + 8·(d − 14) (C ≥ 0); S < 100 → 100; S > 500 → S = 1600·T + 8·(d − 14), nejméně 500;
- kolmo, 40 < d ≤ 70 mm: S = 1600·T + 850; vícepaprskové (``--paprsku``): C = 1200 (1 paprsek) / 850 (2–4);
- rovnoběžně (``--pristup paralelne --H``): S = 1600·T + (1200 − 0,4·H), C ≥ 850; dvouruční ovládání: C = 250 / 0.
Přes horní hranu (CRO) a vydání 2024 (S = K·T + DDS + Z) se nepočítají — výstup na vydání 2024 vždy upozorní.
Viz ``BEZPECNOST_CASY.md``.
"""

from __future__ import annotations

import argparse
import ast
import json
import math
import re
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data" / "bezpecnost_casy.json"
STATES = ("doloženo", "chybí")
ROLES = {   # role členu T → kategorie dat a preferované veličiny (první = nejvhodnější)
    "aopd": (("aopd", "skener"), ("doba_odezvy",)),
    "logika": (("logika", "rele"), ("doba_odezvy", "doba_odpadnuti")),
    "vstup": (("vstup",), ("zpozdeni_vstupu", "doba_odezvy")),
    "vystup": (("vystup",), ("doba_odezvy", "zpozdeni_vystupu")),
    "rele": (("rele",), ("doba_odezvy", "doba_odpadnuti")),
    "ventil": (("ventil",), ("doba_odezvy", "spinaci_cas_vyp")),
    "odvzdusneni": (("ventil",), ("doba_odvzdusneni",)),
    "pohon": (("pohon",), ("reakcni_doba_sto", "doba_odezvy")),
    "brzda": (("brzda",), ("doba_sepnuti_brzdy",)),
    "dobeh": (("valec", "pohon"), ("dobeh", "doba_zastaveni")),
    "osa": ((), ()),   # kinematika osy (axis_term), bez položky dat
}
ROLE_LABEL = {"aopd": "ochranné zařízení (AOPD / skener)", "logika": "bezpečnostní logika", "vstup": "bezpečnostní vstup",
              "vystup": "bezpečnostní výstup", "rele": "bezpečnostní relé", "ventil": "bezpečnostní ventil (reakce)",
              "odvzdusneni": "odvzdušnění objemu",
              "pohon": "pohon (STO / SS1)", "brzda": "brzda", "dobeh": "doběh stroje / válce",
              "osa": "zastavení osy (kinematika)"}
ROLE_ORDER = list(ROLES)


class CasyError(ValueError):
    """Chybný dotaz nebo nevyčíslitelný člen."""


# ── data ───────────────────────────────────────────────────────────────────────────────────────────────────────────

def load(path: str | Path | None = None) -> dict:
    """Načte data (``{"_popis", "polozky": [...]}``)."""
    with open(path or DATA, encoding="utf-8") as f:
        return json.load(f)


def items(data: dict | None = None) -> list[dict]:
    return list((data or load())["polozky"])


def by_id(data: dict, item_id: str) -> dict | None:
    return next((it for it in data["polozky"] if it.get("id") == item_id), None)


def _norm(s: str) -> str:
    return re.sub(r"[\s\-_./]+", "", str(s or "")).upper()


def _hay(it: dict) -> list[str]:
    return [_norm(x) for x in [it.get("id"), it.get("rada"), it.get("typ"), it.get("vyrobce") + " " + str(it.get("rada"))
                               if it.get("vyrobce") else None, *(it.get("kody") or []), *(it.get("hledat") or [])] if x]


def find(data: dict, query: str, kategorie=None, velicina=None) -> list[dict]:
    """Položky, jejichž id / řada / typ / kód / klíč ``hledat`` obsahuje dotaz (bez mezer, pomlček, velikosti písmen).

    Přesná shoda id nebo kódu má přednost. ``kategorie`` / ``velicina`` = řetězec nebo n-tice povolených hodnot."""
    q = _norm(query)
    if not q:
        return []
    kat = (kategorie,) if isinstance(kategorie, str) else kategorie
    vel = (velicina,) if isinstance(velicina, str) else velicina
    pool = [it for it in data["polozky"] if (not kat or it.get("kategorie") in kat) and (not vel or it.get("velicina") in vel)]
    exact = [it for it in pool if it.get("id") == query or q in [_norm(k) for k in it.get("kody") or []]]
    if exact:
        return exact
    return [it for it in pool if any(q in h for h in _hay(it))]


def check_data(data: dict) -> list[str]:
    """Kontrola úplnosti: každá položka buď doložená se zdrojem a hodnotou, nebo stav „chybí“ s poznámkou."""
    errs: list[str] = []
    seen: set[str] = set()
    for i, it in enumerate(data.get("polozky") or []):
        where = it.get("id") or f"polozky[{i}]"
        if not it.get("id"):
            errs.append(f"{where}: chybí id")
        elif it["id"] in seen:
            errs.append(f"{where}: duplicitní id")
        seen.add(it.get("id"))
        for k in ("kategorie", "vyrobce", "velicina", "jednotka", "stav"):
            if not it.get(k):
                errs.append(f"{where}: chybí {k}")
        st = it.get("stav")
        if st not in STATES:
            errs.append(f"{where}: stav {st!r} není {STATES}")
        has_val = it.get("hodnota") is not None or bool(it.get("tabulka")) or bool(it.get("vzorec"))
        z = it.get("zdroj") or {}
        if st == "doloženo":
            if not has_val:
                errs.append(f"{where}: doloženo bez hodnoty / tabulky / vzorce")
            for k in ("url", "dokument", "strana", "cteno"):
                if not z.get(k):
                    errs.append(f"{where}: doloženo, ale zdroj bez {k}")
            if z.get("url") and not str(z["url"]).startswith(("http://", "https://")):
                errs.append(f"{where}: url zdroje není http(s)")
            if z.get("cteno") and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(z["cteno"])):
                errs.append(f"{where}: cteno není YYYY-MM-DD")
        elif st == "chybí":
            if not it.get("poznamka"):
                errs.append(f"{where}: chybí bez poznámky (co zkoušeno / co měřit)")
        vz = it.get("vzorec")
        if vz and vz.get("py"):
            try:
                _compile_expr(vz["py"])
            except CasyError as e:
                errs.append(f"{where}: vzorec.py nejde vyhodnotit: {e}")
        for r in it.get("tabulka") or []:
            if not isinstance(r, dict):
                errs.append(f"{where}: řádek tabulky není objekt")
    return errs


# ── bezpečné vyhodnocení vzorce ─────────────────────────────────────────────────────────────────────────────────────

_FUNCS = {"max": max, "min": min, "ceil": math.ceil, "floor": math.floor, "sqrt": math.sqrt, "abs": abs}
_OPS = (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow, ast.USub, ast.UAdd)


def _compile_expr(expr: str) -> ast.Expression:
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError as e:
        raise CasyError(f"syntaxe vzorce {expr!r}: {e.msg}") from None
    for node in ast.walk(tree):
        if isinstance(node, (ast.Expression, ast.BinOp, ast.UnaryOp, ast.Name, ast.Load)) or isinstance(node, _OPS):
            continue
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            continue
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in _FUNCS and not node.keywords:
            continue
        raise CasyError(f"nepovolený prvek vzorce {type(node).__name__} v {expr!r}")
    return tree


def eval_expr(expr: str, params: dict) -> float:
    tree = _compile_expr(expr)
    missing = sorted({n.id for n in ast.walk(tree) if isinstance(n, ast.Name) and n.id not in _FUNCS and n.id not in params})
    if missing:
        raise CasyError("chybí parametry vzorce: " + ", ".join(missing))
    env = {k: float(v) for k, v in params.items()}
    return float(eval(compile(tree, "<vzorec>", "eval"), {"__builtins__": {}, **_FUNCS}, env))  # noqa: S307 — AST ověřen


# ── členy T ────────────────────────────────────────────────────────────────────────────────────────────────────────

def _num(s: str) -> float:
    return float(str(s).replace(",", "."))


def parse_time(s: str) -> float:
    """Čas → ms. „130ms“ / „130 ms“ = ms, „0.13s“ = s; bez jednotky: < 10 = sekundy (0.13 → 130 ms), jinak ms (60 → 60 ms)."""
    m = re.fullmatch(r"\s*([0-9]+(?:[.,][0-9]+)?)\s*(ms|s)?\s*", str(s))
    if not m:
        raise CasyError(f"čas {s!r} není číslo nebo číslo s jednotkou ms / s")
    v = _num(m.group(1))
    unit = m.group(2) or ("s" if v < 10 else "ms")
    return v if unit == "ms" else v * 1000.0


def parse_query(q: str) -> tuple[str, dict]:
    """„C4C d=14 h=900“ → („C4C“, {d: 14, h: 900}). Hodnota parametru je číslo; ``t=`` = čas (s / ms)."""
    words, params = [], {}
    for tok in str(q).split():
        if "=" in tok:
            k, v = tok.split("=", 1)
            k = k.strip()
            if k in ("t", "id", "sloupec"):
                params[k] = v
            else:
                try:
                    params[k] = _num(v)
                except ValueError:
                    params[k] = v.replace("_", " ")   # textový klíč tabulky (kodovani=bez_kodovani, sloupec=…)
        else:
            words.append(tok)
    return " ".join(words), params


UP_KEYS = ("h_mm", "delka_mm", "paprsku", "objem_l", "tlak_bar", "n")   # nezadaná hodnota → nejbližší vyšší řádek
DOWN_KEYS = ("na_bar",)                                                  # cílový tlak → nejbližší nižší (déle)
ALIAS = {"d": "d_mm", "h": "h_mm", "l": "delka_mm", "v": "objem_l", "p": "tlak_bar", "p0": "na_bar"}


def _tcol(rows: list[dict], want: str | None) -> str:
    cols = [k for k in rows[0] if k.startswith("t_")]
    if want:
        if want not in cols:
            raise CasyError(f"sloupec {want!r} v tabulce není (je: {', '.join(cols)})")
        return want
    for pref in ([c for c in cols if "porucha" in c], ["t_ms"], ["t_s"], cols):
        for c in pref:
            if c in cols:
                return c
    raise CasyError("tabulka bez sloupce t_*")


def _table_value(it: dict, params: dict) -> tuple[float, str]:
    """Řádek tabulky: shodné hodnoty filtrují; výška / délka / objem / tlak nahoru, cílový tlak dolů, rozsah h_min–h_max;
    co zůstane víc řádků, rozhoduje nejhorší (nejdelší) čas. Sloupec času: ``sloupec=…``, jinak porucha > t_ms > t_s."""
    rows = [r for r in it["tabulka"] if isinstance(r, dict) and any(k.startswith("t_") for k in r)]
    if not rows:
        raise CasyError(f"{it['id']}: tabulka bez číselných časů")
    p = {ALIAS.get(k, k): v for k, v in params.items() if k not in ("t", "id", "sloupec", "_slova")}
    words = [_norm(w) for w in str(params.get("_slova") or "").split() if len(_norm(w)) >= 4]
    for w in words:   # slovo dotazu = textová buňka řádku (model, objednací číslo, typ) → jen ty řádky
        hit = [r for r in rows if any(isinstance(v, str) and w in _norm(v) for k, v in r.items() if not k.startswith("t_"))]
        if hit and len(hit) < len(rows):
            rows = hit
    if "h_mm" in p and "h_min_mm" in rows[0]:
        h = p.pop("h_mm")
        cand = [r for r in rows if r["h_max_mm"] >= h]
        if not cand:
            raise CasyError(f"{it['id']}: h = {h:g} mm je nad tabulkou (max {max(r['h_max_mm'] for r in rows)})")
        lo = min(r["h_max_mm"] for r in cand)
        rows = [r for r in cand if r["h_max_mm"] == lo]
    for k, v in p.items():
        if not any(k in r for r in rows):
            continue   # parametr patří vzorci / jiné položce
        exact = [r for r in rows if r.get(k) == v]
        if not exact and isinstance(v, str):
            exact = [r for r in rows if isinstance(r.get(k), str) and _norm(v) in _norm(r[k])]
        if exact:
            rows = exact
        elif isinstance(v, (int, float)) and k in UP_KEYS + DOWN_KEYS:
            vals = sorted({r[k] for r in rows if isinstance(r.get(k), (int, float))})
            pick = [x for x in vals if x >= v] if k in UP_KEYS else [x for x in vals if x <= v]
            if not pick:
                raise CasyError(f"{it['id']}: {k} = {v:g} mimo tabulku ({vals[0]:g}–{vals[-1]:g})")
            sel = pick[0] if k in UP_KEYS else pick[-1]
            rows = [r for r in rows if r.get(k) == sel]
        else:
            vals = sorted({str(r.get(k)) for r in rows})
            raise CasyError(f"{it['id']}: v tabulce není {k} = {v} (je: {', '.join(vals)})")
    if "d_mm" in rows[0] and len({r.get("d_mm") for r in rows}) > 1:
        raise CasyError(f"{it['id']}: zadej d=… (rozlišení v tabulce: "
                        + ", ".join(f"{x:g}" for x in sorted({r['d_mm'] for r in rows})) + ")")
    col = _tcol(rows, params.get("sloupec"))
    rows = [r for r in rows if isinstance(r.get(col), (int, float))]
    if not rows:
        raise CasyError(f"{it['id']}: pro zadané parametry není hodnota ve sloupci {col} (ve zdroji nepovoleno / chybí)")
    row = max(rows, key=lambda r: r[col])
    t = float(row[col]) * (1000.0 if col.startswith("t_s") and not col.startswith("t_ms") else 1.0)
    worst = " (nejhorší z " + str(len(rows)) + " řádků)" if len(rows) > 1 else ""
    params["_radek"] = row
    return t, f"tabulka, sloupec {col}: " + ", ".join(f"{k} = {v}" for k, v in row.items() if not str(k).startswith("t_") or k == col) + worst


def item_ms(it: dict, params: dict) -> tuple[float, str]:
    """Čas položky v ms a popis, odkud (hodnota / řádek tabulky / vzorec s parametry)."""
    unit = it.get("jednotka")
    tparams = {k for k in params if k not in ("t", "id", "_slova")}
    if it.get("tabulka") and (it.get("hodnota") is None or tparams) and not (it.get("vzorec") or {}).get("py"):
        return _table_value(it, params)
    vz = it.get("vzorec") or {}
    if vz.get("py"):
        env = dict(vz.get("vychozi") or {})
        env.update({k: v for k, v in params.items() if k not in ("t", "id", "sloupec", "_slova") and isinstance(v, (int, float))})
        v = eval_expr(vz["py"], env)
        used = ", ".join(f"{k} = {env[k]:g}" for k in sorted(env))
        return (v * 1000.0 if unit == "s" else v), f"vzorec {vz.get('vyraz') or vz['py']} ({used})"
    if it.get("hodnota") is not None:
        v = float(it["hodnota"])
        return (v * 1000.0 if unit == "s" else v), f"hodnota {it['hodnota']:g} {unit}"
    raise CasyError(f"{it['id']}: položka nemá hodnotu (stav {it.get('stav')})")


def _cite(it: dict | None) -> str:
    if not it:
        return "bez zdroje"
    z = it.get("zdroj") or {}
    parts = [z.get("dokument"), z.get("strana"), z.get("url"), f"čteno {z['cteno']}" if z.get("cteno") else None]
    return "; ".join(p for p in parts if p) or "bez zdroje"


def resolve_term(data: dict, role: str, query: str) -> dict:
    """Člen T z dotazu role (``--aopd "C4C d=14 h=900"``). Bez doložené položky a s ``t=`` / samotným číslem = ODHAD."""
    if role not in ROLES:
        raise CasyError(f"neznámá role {role!r} (povolené: {', '.join(ROLES)})")
    if role == "osa":
        return axis_term(query)
    kats, vels = ROLES[role]
    words, params = parse_query(query)
    term = {"role": role, "popis": ROLE_LABEL[role], "dotaz": query, "t_ms": None, "odhad": False, "stav": None,
            "polozka": None, "vypocet": None, "zdroj": None, "citace": None, "podminky": None, "alternativy": [],
            "poznamka": None}
    bare = None
    if words and "t" not in params and (role == "dobeh" or re.search(r"\d\s*m?s\s*$", words)):
        try:   # samotné číslo jen u doběhu (jinak je to objednací číslo); s jednotkou ms / s u každé role
            bare = parse_time(words)
        except CasyError:
            bare = None
    if bare is not None:   # samotné číslo = člen bez položky (např. změřený / odhadnutý doběh)
        term.update(t_ms=bare, odhad=True, stav="odhad", vypocet=f"zadáno ručně {query} → {bare:g} ms",
                    poznamka="ODHAD — zadáno číslem bez doloženého zdroje; nahradit měřením / údajem výrobce")
        return term
    if params.get("id"):
        cand = [it for it in data["polozky"] if it.get("id") == params["id"]]
    else:
        cand = find(data, words, kats) if words else []
        other = [c for c in cand if c.get("velicina") not in vels]
        cand = [c for c in cand if c.get("velicina") in vels]
        if not cand and other and not params.get("t"):
            raise CasyError(f"{role}: „{words}“ v datech jen s veličinami "
                            + ", ".join(sorted({c['velicina'] for c in other})) + f" — role {role} hledá {', '.join(vels)}")
    if not cand and not params.get("t"):
        raise CasyError(f"{role}: „{words}“ není v datech (zkus --hledat {words!r}) — případně zadej t=… jako ODHAD")
    cand.sort(key=lambda it: (it.get("stav") != "doloženo",
                              vels.index(it["velicina"]) if it.get("velicina") in vels else len(vels)))
    it = cand[0] if cand else None
    term["alternativy"] = [c["id"] for c in cand[1:6]]
    if it:
        term.update(polozka=it["id"], stav=it.get("stav"), zdroj=it.get("zdroj"), citace=_cite(it),
                    podminky=it.get("podminky"), poznamka=it.get("poznamka"))
    if params.get("t"):   # ruční hodnota má přednost — vždy ODHAD (zdroj položky jen pro informaci)
        term.update(t_ms=parse_time(params["t"]), odhad=True, vypocet=f"zadáno ručně t = {params['t']} → {parse_time(params['t']):g} ms")
        term["poznamka"] = "ODHAD — hodnota zadána ručně" + (f" (položka {it['id']} jen pro kontext)" if it else "")
        if not it:
            term["stav"] = "odhad"
        return term
    if it.get("stav") != "doloženo":
        term.update(odhad=True, poznamka=f"CHYBÍ v datech: {it.get('poznamka') or ''} — zadej t=… (ODHAD) nebo změř")
        return term
    params["_slova"] = words
    term["t_ms"], term["vypocet"] = item_ms(it, params)
    row = params.get("_radek")
    if row and isinstance(row.get("d_mm"), (int, float)):
        term["d_mm"] = row["d_mm"]
    elif isinstance(params.get("d"), (int, float)):
        term["d_mm"] = params["d"]
    return term


def axis_term(query: str) -> dict:
    """Doba zastavení osy z kinematiky (rovnoměrné zpomalení): t = t_r + v / a, dráha s = v·t_r + v² / (2a).

    Parametry v mm/s, a mm/s², tr ms (reakce do začátku brzdění). Vzorec výrobce ve veřejných zdrojích není
    (položka ``vzorec.brzdna_draha_osy``) → člen je vždy ODHAD; skutečnou dobu a dráhu změřit (akceptační test)."""
    _, p = parse_query(query)
    miss = [k for k in ("v", "a") if not isinstance(p.get(k), (int, float))]
    if miss:
        raise CasyError("osa: zadej " + ", ".join(f"{k}=…" for k in miss) + " (v mm/s, a mm/s², volitelně tr ms)")
    v, a, tr = float(p["v"]), float(p["a"]), float(p.get("tr", 0.0))
    if v <= 0 or a <= 0:
        raise CasyError("osa: v a a musí být kladné")
    t = tr + v / a * 1000.0
    s = v * tr / 1000.0 + v * v / (2.0 * a)
    return {"role": "osa", "popis": ROLE_LABEL["osa"], "dotaz": query, "t_ms": round(t, 3), "odhad": True, "stav": "odhad",
            "polozka": "vzorec.brzdna_draha_osy", "vypocet": f"t = tr + v/a = {tr:g} + {v:g}/{a:g} s = {t:.1f} ms; "
            f"dráha s = v·tr + v²/(2a) = {s:.1f} mm", "zdroj": None, "citace": None, "podminky": None,
            "alternativy": [], "brzdna_draha_mm": round(s, 1),
            "poznamka": "ODHAD — kinematika (rovnoměrné zpomalení a z konfigurace osy), ne údaj výrobce; změřit doběh"}


# ── ISO 13855 ──────────────────────────────────────────────────────────────────────────────────────────────────────

ISO_RULES = {   # pravidlo → id položky dat se zdrojem
    "K_2000": "iso13855.K_2000", "K_1600": "iso13855.K_1600", "C_8d14": "iso13855.C_8d14",
    "C_850": "iso13855.C_850", "S_min_100": "iso13855.S_min_100", "S_500": "iso13855.S_500",
    "vicepaprsek": "iso13855.vicepaprsek", "paralelni": "iso13855.paralelni", "dvourucni": "iso13855.dvourucni",
}
PRISTUPY = ("kolmo", "paralelne", "dvourucni")


def safety_distance(t_ms: float, d_mm: float | None, data: dict | None = None, pristup: str = "kolmo",
                    paprsku: int | None = None, H_mm: float | None = None, zakryti: bool = False) -> dict:
    """S podle ISO 13855 (vzorce vydání 2010). Kolmo: d ≤ 40 → 2000·T + 8(d − 14) s pravidly 100 / 500 mm; d > 40 nebo
    vícepaprskové → 1600·T + 850 (1 paprsek: + 1200). Rovnoběžně: 1600·T + (1200 − 0,4·H), C ≥ 850, 15(d − 50) ≤ H ≤ 1000.
    Dvouruční ovládání: 1600·T + 250 (se zakrytím C = 0)."""
    if pristup not in PRISTUPY:
        raise CasyError(f"přístup {pristup!r} není {PRISTUPY}")
    T = t_ms / 1000.0
    steps: list[str] = []
    used: list[str] = []
    if pristup == "paralelne":
        if H_mm is None:
            raise CasyError("přístup rovnoběžně: zadej --H (výška pole nad referenční rovinou, mm)")
        if H_mm < 0 or H_mm > 1000:
            raise CasyError("přístup rovnoběžně: H musí být 0–1000 mm")
        if d_mm is not None and H_mm < 15.0 * (d_mm - 50.0):
            raise CasyError(f"přístup rovnoběžně: H = {H_mm:g} < 15·(d − 50) = {15 * (d_mm - 50):g} mm — rozlišení nestačí")
        C = max(850.0, 1200.0 - 0.4 * H_mm)
        S, K = 1600.0 * T + C, 1600.0
        used += ["K_1600", "paralelni"]
        steps.append(f"S = 1600 mm/s × {T:.4f} s + (1200 − 0,4 × {H_mm:g}) = {S:.1f} mm (C = {C:g} ≥ 850)")
    elif pristup == "dvourucni":
        C = 0.0 if zakryti else 250.0
        S, K = 1600.0 * T + C, 1600.0
        used += ["K_1600", "dvourucni"]
        steps.append(f"S = 1600 mm/s × {T:.4f} s + {C:g} mm = {S:.1f} mm (dvouruční ovládání, "
                     + ("se zakrytím" if zakryti else "bez zakrytí") + "; ISO 13855:2024 bez krytu 550 mm)")
    elif paprsku:
        C = 1200.0 if paprsku == 1 else 850.0
        S, K = 1600.0 * T + C, 1600.0
        used += ["K_1600", "vicepaprsek"]
        steps.append(f"S = 1600 mm/s × {T:.4f} s + {C:g} mm = {S:.1f} mm ({paprsku} paprsek/y)")
    elif d_mm is not None and d_mm <= 40:
        C = max(0.0, 8.0 * (d_mm - 14.0))
        used += ["C_8d14"]
        S = 2000.0 * T + C
        used += ["K_2000"]
        steps.append(f"S = 2000 mm/s × {T:.4f} s + 8 × ({d_mm:g} − 14) = {S:.1f} mm")
        K = 2000.0
        if S < 100.0:
            steps.append("S < 100 mm → S = 100 mm")
            S = 100.0
            used.append("S_min_100")
        elif S > 500.0:
            S2 = 1600.0 * T + C
            used += ["S_500", "K_1600"]
            steps.append(f"S > 500 mm → K = 1600: S = 1600 × {T:.4f} + {C:g} = {S2:.1f} mm"
                         + (" ≤ 500 → S = 500 mm" if S2 <= 500.0 else ""))
            S, K = max(S2, 500.0), 1600.0
    else:
        if d_mm is not None and d_mm > 70:
            raise CasyError(f"d = {d_mm:g} mm > 70: kolmý přístup jen jako vícepaprskové zařízení (--paprsku 1–4)")
        C, K = 850.0, 1600.0
        S = K * T + C
        used += ["K_1600", "C_850"]
        steps.append(f"S = 1600 mm/s × {T:.4f} s + 850 mm = {S:.1f} mm"
                     + (" (40 < d ≤ 70 mm)" if d_mm is not None else " (bez rozlišení — zadej d nebo --paprsku)"))
    cites = {}
    for r in used:
        it = by_id(data, ISO_RULES[r]) if data else None
        cites[r] = {"polozka": ISO_RULES[r], "citace": _cite(it) if it and it.get("stav") == "doloženo" else "bez zdroje v datech"}
    return {"K_mm_s": K, "C_mm": C, "S_mm": round(S, 2), "postup": steps, "pravidla": cites}


def compute(data: dict, terms: dict[str, list[str]], d_mm: float | None = None, pristup: str = "kolmo",
            paprsku: int | None = None, H_mm: float | None = None, zakryti: bool = False) -> dict:
    """Členy T podle rolí → T, S a seznam chybějících / odhadnutých členů."""
    out_terms: list[dict] = []
    for role in ROLE_ORDER:
        for q in terms.get(role) or []:
            out_terms.append(resolve_term(data, role, q))
    if d_mm is None:   # rozlišení z řádku tabulky / dotazu AOPD
        d_mm = next((t["d_mm"] for t in out_terms if t["role"] == "aopd" and t.get("d_mm") is not None), None)
    missing = [t for t in out_terms if t["t_ms"] is None]
    odhad = [t for t in out_terms if t["odhad"] and t["t_ms"] is not None]
    res = {"norma": "ISO 13855 (vzorce vydání 2010; změny vydání 2024 viz položka iso13855.2024_zmeny)",
           "pristup": pristup, "d_mm": d_mm, "paprsku": paprsku, "H_mm": H_mm, "cleny": out_terms,
           "T_ms": None, "S_mm": None, "odhad": bool(odhad), "chybi": [t["role"] for t in missing], "upozorneni": []}
    if not out_terms:
        raise CasyError("zadej aspoň jeden člen T (--aopd, --logika, --ventil, --dobeh …)")
    if not any(t["role"] == "aopd" for t in out_terms):
        res["upozorneni"].append("bez členu ochranného zařízení (--aopd) — T nemusí být úplné")
    if not any(t["role"] in ("dobeh", "brzda", "pohon", "ventil", "odvzdusneni", "osa") for t in out_terms):
        res["upozorneni"].append("bez doby zastavení stroje (--dobeh / --pohon / --osa / --odvzdusneni) — T je jen odezva řízení")
    if any(t["role"] in ("ventil", "odvzdusneni") for t in out_terms) and not any(t["role"] == "dobeh" for t in out_terms):
        res["upozorneni"].append("pneumatika: doba odvzdušnění ≠ zastavení pohybu — doběh válce změřit (položka valec.obecne.dobeh) a zadat --dobeh")
    it24 = by_id(data, "iso13855.2024_zmeny")
    if it24 and it24.get("stav") == "doloženo":
        res["upozorneni"].append("ISO 13855:2024 (3. vydání) mění vzorec na S = K·T + DDS + Z (DDS nahrazuje C); tento výpočet "
                                 "je podle vydání 2010 — ověřit proti vydání platnému pro stroj [" + _cite(it24) + "]")
    if missing:
        res["upozorneni"].append("S nelze spočítat — chybí členy: " + ", ".join(t["role"] for t in missing))
        return res
    T = sum(t["t_ms"] for t in out_terms)
    res["T_ms"] = round(T, 3)
    res.update(safety_distance(T, d_mm, data, pristup, paprsku, H_mm, zakryti))
    return res


def markdown(res: dict) -> str:
    """Řádky pro KONCEPT.md: tabulka členů T se zdrojem, výpočet S, ODHAD / CHYBÍ."""
    def ms(v):
        return "—" if v is None else f"{v:g} ms"
    lines = ["| Člen T | Položka / dotaz | Čas | Odvození | Zdroj |", "|---|---|---|---|---|"]
    for t in res["cleny"]:
        tag = " **ODHAD**" if t["odhad"] and t["t_ms"] is not None else (" **CHYBÍ**" if t["t_ms"] is None else "")
        src = t["citace"] if t["citace"] and t["stav"] == "doloženo" and not (t["odhad"]) else (t["poznamka"] or "bez zdroje")
        lines.append(f"| {t['popis']}{tag} | {t['polozka'] or t['dotaz']} | {ms(t['t_ms'])} | "
                     f"{(t['vypocet'] or '').replace('|', '/')} | {src.replace('|', '/')} |")
    if res["T_ms"] is not None:
        lines.append("")
        lines.append(f"T = {' + '.join(ms(t['t_ms']) for t in res['cleny'])} = **{res['T_ms']:g} ms**")
    if res.get("S_mm") is not None:
        d = res["d_mm"]
        lines.append(f"ISO 13855 (vydání 2010), přístup {res['pristup']}" + (f", d = {d:g} mm" if d is not None else "")
                     + (f", {res['paprsku']} paprsky" if res.get("paprsku") else "") + ":")
        for s in res["postup"]:
            lines.append(f"- {s}")
        lines.append(f"- **S = {res['S_mm']:g} mm**" + (" — **ODHAD** (obsahuje člen bez zdroje)" if res["odhad"] else ""))
        for r, c in res["pravidla"].items():
            lines.append(f"- {r}: {c['citace']}")
    for u in res["upozorneni"]:
        lines.append(f"- POZOR: {u}")
    return "\n".join(lines)


# ── CLI ────────────────────────────────────────────────────────────────────────────────────────────────────────────

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m plc_studio.pro3d_parts.bezpecnost_casy",
                                 description="Člen T a bezpečnostní vzdálenost S = K·T + C (ISO 13855) z doložených dat.")
    for role in ROLE_ORDER:
        names = [f"--{role}"] + (["--doběh"] if role == "dobeh" else [])
        ap.add_argument(*names, dest=role, action="append", metavar="DOTAZ",
                        help=f"{ROLE_LABEL[role]}: typ / kód + parametry k=v (t=… = ruční ODHAD); u --dobeh i samotné číslo")
    ap.add_argument("--d", type=float, help="rozlišení ochranného zařízení d v mm (jinak z --aopd d=… / řádku tabulky)")
    ap.add_argument("--pristup", default="kolmo", choices=PRISTUPY, help="kolmo / paralelne (s --H) / dvourucni")
    ap.add_argument("--paprsku", type=int, choices=(1, 2, 3, 4), help="vícepaprskové zařízení (kolmo): C = 1200 / 850 mm")
    ap.add_argument("--H", type=float, help="výška pole nad referenční rovinou v mm (přístup rovnoběžně)")
    ap.add_argument("--zakryti", action="store_true", help="dvouruční ovládání se zakrytím (C = 0)")
    ap.add_argument("--hledat", metavar="TEXT", help="jen vypsat položky odpovídající textu")
    ap.add_argument("--kontrola", action="store_true", help="zkontrolovat úplnost dat")
    ap.add_argument("--data", help="jiný soubor dat")
    ap.add_argument("--format", choices=("json", "md", "oboji"), default="oboji")
    a = ap.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    data = load(a.data)
    if a.kontrola:
        errs = check_data(data)
        print("\n".join(errs) if errs else f"OK — {len(data['polozky'])} položek")
        return 1 if errs else 0
    if a.hledat:
        for it in find(data, a.hledat):
            val = it.get("hodnota")
            print(f"{it['id']:45s} {it.get('stav'):9s} {it.get('velicina')}: "
                  + (f"{val:g} {it.get('jednotka')}" if val is not None else
                     "tabulka" if it.get("tabulka") else "vzorec" if it.get("vzorec") else "—"))
        return 0
    terms = {r: getattr(a, r) for r in ROLE_ORDER if getattr(a, r)}
    try:
        res = compute(data, terms, a.d, a.pristup, a.paprsku, a.H, a.zakryti)
    except CasyError as e:
        print(f"CHYBA: {e}", file=sys.stderr)
        return 2
    if a.format in ("json", "oboji"):
        print(json.dumps(res, ensure_ascii=False, indent=1))
    if a.format in ("md", "oboji"):
        if a.format == "oboji":
            print("\n<!-- markdown pro KONCEPT.md -->")
        print(markdown(res))
    return 0 if res["S_mm"] is not None else 1


if __name__ == "__main__":
    sys.exit(main())
