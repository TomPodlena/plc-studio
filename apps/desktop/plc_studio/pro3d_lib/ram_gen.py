"""Rám N1 kódem v automatickém postupu PLCdesk PRO (``pro_pipeline.make_frame``): z manifestu PLCdesk a konceptu
(stroj s pásovým dopravníkem: rozměry z CELKU ``celek.n1_params`` — moduly kódem určí rám; jinak rozměry stolu
z ``koncept/Koncept.FCStd`` přes ``pro3d_modules/fc_scene.py``, jinak z briefu / ODHAD) →
``ram/Ram.FCStd`` (``modul_ram`` + ``fc_ram.py``), smlouva ``ram/N1_<id>.json``, ``ram/RAM.md``, snímky ``ram/snimky/ram_*.png``
a kontroly ``ram/kontroly/``.

    python -m plc_studio.pro3d_lib.ram_gen <PLCdesk_CAD.json> <složka stroje> [--scena scena.json] [--no-fc]
        [--slot pro3d-frame] [--timeout 1500]

Rozhodnutí uživatele 2026-11-04 (schválení N1): dlouhý šroub ALUTEC se zahloubenou hlavou v ose profilu = standardní spoj
rámu (hloubka zahloubení ODHAD s poznámkou); zavětrování úhelníky, u rámu na kolech se silami válců jen doporučení diagonál
/ MKP (poznámka ve výstupu); výchozí pracovní deska Al 15 mm (EN AW-5083).

Souřadnice: smlouva N1 je v místních souřadnicích rámu (x = délka, y = šířka, y 0 = přední strana, z nahoru, podlaha z 0);
``rozmery.umisteni`` = posun místních souřadnic do souřadnic stroje (koncept) — globální bod = místní + umístění. Model
``Ram.FCStd`` je už posunutý (umístění modulu N1). Požadavky modulů na rám (průchody) se převezmou z ``moduly/layout.json``
(``predani_n1``), když existuje (opakovaná stavba rámu po modulech).

Poslední řádek stdout = JSON souhrn. Kód: 0 = model bez chyb; 1 = model vznikl, plán nebo kontroly hlásí chyby (rozhodne
stavitel / K5); 2 = selhalo."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    __package__ = "plc_studio.pro3d_lib"

from . import bench, modul_ram  # noqa: E402

HERE = Path(__file__).resolve().parent
SUB = "ram"
SLOT = "pro3d-frame"
FC_SCENE = HERE.parent / "pro3d_modules" / "fc_scene.py"
DEFAULT = {"D": 1000.0, "W": 800.0, "H": 900.0}          # ODHAD bez konceptu (pracovní stůl)
TABLE_RE = re.compile(r"\b(deska stolu|pracovni deska|stul|stolu|stol|noha stolu|nohy stolu|ram stroje|ram\b|podnoz|frame|"
                      r"table|tisch|gestell|untergestell|mesa)")
WHEELS_RE = re.compile(r"kolec|kola\b|pojizd|mobil|wheel|castor|caster|rollen|fahrbar|ruedas")
MASS_KG = {"cylinder": 2.0, "linear_axis": 6.0, "motor": 8.0, "gearmotor": 10.0, "valve_solenoid": 0.3, "gripper": 1.0,
           "vfd": 3.0, "positioning_drive": 1.5, "servo_motor": 5.0}      # ODHAD hmotností modulů na rámu (pro průhyb)


def fold(s) -> str:
    s = unicodedata.normalize("NFKD", str(s or ""))
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


def concept_scene(koncept: Path, work: Path, slot: str, timeout: int = 600) -> dict | None:
    """Scéna konceptu (fc_scene.py, jen čte) — rám zatím není, 1. argument = neexistující soubor (PowerShell nepřenese „-“ ani prázdný argument)."""
    if not koncept.is_file() or not bench.available():
        return None
    work.mkdir(parents=True, exist_ok=True)
    rp = work / "scena_koncept.json"
    rp.unlink(missing_ok=True)
    bench._ps([bench.RUN_FC, "run", "--slot", slot, "--timeout", str(timeout), "--result", rp, FC_SCENE, work / "bez_ramu.FCStd", koncept], timeout + 120)
    try:
        return json.loads(rp.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _union(bbs):
    return [min(b[i] for b in bbs) for i in range(3)] + [max(b[i] for b in bbs) for i in range(3, 6)]


def params(manifest: dict, scene: dict | None, pozadavky: list | None = None) -> dict:
    """Parametry ``modul_ram.plan_ramu`` + umístění a zdroj rozměrů (koncept / brief / ODHAD)."""
    brief = manifest.get("brief") or {}
    text = fold(" ".join(str(brief.get(k) or "") for k in ("desc", "name")) + " " + json.dumps(brief.get("concept") or "", ensure_ascii=False))
    odhady, zdroj = [], ""
    objs = [o for o in (scene or {}).get("objects") or [] if o.get("doc") == "koncept" and not o.get("kontext")
            and (o.get("typ") or "") not in ("zona", "pomocny", "sroub", "matice", "podlozka")]
    # přednostně celek konceptu s vlastností ``Konstrukce_Role = stul`` (pokyn role Koncept), jinak podle názvu
    table = [o for o in objs if fold(o.get("role")) == "stul"]
    if not table:
        table = [o for o in objs if not (o.get("pid") or o.get("pid_inh")) and TABLE_RE.search(fold(o.get("label")))]
        table = [o for o in table if o["bb"][2] < 1.0 or o["bb"][5] > 300]        # stůl / nohy, ne drobný díl s „rám“
    origin = [0.0, 0.0, 0.0]
    if table:
        bb = _union([o["bb"] for o in table])
        D, W, H = bb[3] - bb[0], bb[4] - bb[1], bb[5]
        origin = [bb[0], bb[1], 0.0]
        zdroj = "koncept: " + ", ".join(sorted({o["label"][:40] for o in table})[:6])
        if abs(bb[2]) > 1.0:
            odhady.append(f"obálka stolu konceptu nezačíná na podlaze (z {bb[2]:g}) — výška = horní líc {H:g} mm (ODHAD)")
    elif objs:
        bb = _union([o["bb"] for o in objs if o["bb"][5] - o["bb"][2] < 2000])
        D, W = bb[3] - bb[0] + 100.0, bb[4] - bb[1] + 100.0
        origin = [bb[0] - 50.0, bb[1] - 50.0, 0.0]
        H = DEFAULT["H"]
        zdroj = "ODHAD: půdorys všech dílů konceptu + 50 mm po obvodu, výška pracovní roviny 900 mm"
        odhady.append(zdroj)
    else:
        D, W, H = DEFAULT["D"], DEFAULT["W"], DEFAULT["H"]
        zdroj = "ODHAD: bez konceptu — pracovní stůl 1000 × 800 × 900 mm"
        odhady.append(zdroj)
    D, W, H = round(max(400.0, D), 1), round(max(300.0, W), 1), round(max(500.0, H), 1)
    kola = bool(WHEELS_RE.search(text))
    moduly = []
    cats = {p["id"]: p.get("category") for p in manifest.get("parts") or []}
    for o in objs:
        pid = o.get("pid") or o.get("pid_inh")
        c = cats.get(pid)
        if c in MASS_KG and o["bb"][2] >= H - 30.0:
            moduly.append({"nazev": f"{pid} (ODHAD {MASS_KG[c]:g} kg)", "hmotnost_kg": MASS_KG[c],
                           "pos": [round((o["bb"][0] + o["bb"][3]) / 2 - origin[0], 1), round((o["bb"][1] + o["bb"][4]) / 2 - origin[1], 1)]})
    seen, mods = set(), []
    for m in moduly:                                   # díl z více těles = jeden modul
        if m["nazev"] not in seen:
            seen.add(m["nazev"])
            mods.append(m)
    if mods:
        odhady.append(f"hmotnosti {len(mods)} zařízení na rámu podle kategorie (ODHAD, tabulka ram_gen.MASS_KG) — pro průhyb věnce")
    poz = []
    for p in pozadavky or []:
        b = p.get("bod") or []
        if len(b) == 3:
            poz.append({"co": p.get("co") or "průchod", "bod": [b[0] - origin[0], b[1] - origin[1], b[2]], "d": float(p.get("d") or 20)})
    name = str((manifest.get("project") or {}).get("name") or "")
    kw = dict(D=D, W=W, H=H, deska=True, podpory="kola" if kola else "patky", zatizeni_kg=50.0, moduly=mods, pozadavky=poz,
              ident="N1", nazev=f"N1 rám {D:g} × {W:g} × {H:g}" + (f" — {name}" if name else ""))
    odhady.append("užitné zatížení desky 50 kg (ODHAD bez údaje v zadání)")
    if kola:
        odhady.append("podpory = kola podle zadání (" + "pojízdný" + ")")
    return {"kw": kw, "umisteni": origin, "zdroj": zdroj, "odhady": odhady}


def decisions(plan: dict, kw: dict, manifest: dict) -> list[str]:
    """Poznámky ke schváleným rozhodnutím N1 (2026-11-04) — do smlouvy a RAM.md."""
    ds = modul_ram.DATA["dlouhy_sroub"]
    out = [f"spoj rámu = dlouhý šroub ALUTEC {ds['M']} se zahloubenou hlavou v ose profilu (standard schválený uživatelem); "
           f"hloubka zahloubení ODHAD — {ds['pozn_hloubky']}",
           f"pracovní deska {modul_ram.DATA['deska']['material']} {modul_ram.DATA['deska']['t']:g} mm (výchozí, schváleno) — tloušťku a "
           "materiál ověřit u dodavatele"]
    cyl = sum(1 for p in manifest.get("parts") or [] if p.get("category") == "cylinder")
    if kw["podpory"] == "kola" and cyl:
        out.append(f"rám na kolech se silami {cyl} válců: zavětrování jen úhelníky — DOPORUČENÍ doplnit diagonály nebo ověřit tuhost "
                   "MKP (skill fem-vypocty); rázy válců rám rozkmitají")
    return out


def shift_plan(plan: dict, origin: list) -> None:
    if any(abs(c) > 1e-9 for c in origin):
        for m in plan["moduly"]:
            pl = m.get("placement") or {"pos": [0.0, 0.0, 0.0], "rot": modul_ram.I3}
            m["placement"] = {"pos": [pl["pos"][i] + origin[i] for i in range(3)], "rot": pl["rot"]}


def report_md(roz: dict, res: dict | None, src: str) -> str:
    r = roz["rozmery"]
    L = [f"# Rám N1 kódem — {roz['nazev']}", "",
         f"Rozměry {r['D']:g} × {r['W']:g} mm, horní líc {r['H_horni_lic']:g} mm, podpory {r['podpory']}, umístění {r.get('umisteni')} "
         f"(zdroj: {src}).", "",
         f"Smlouva rozhraní: `N1_{roz['id']}.json` (drážky a volné úseky, deska, nosnost, průchody, montážní pořadí, řezací seznam).", "",
         "## Rozhodnutí a doporučení", "", *[f"- {x}" for x in roz.get("poznamky") or []], "",
         "## Nosnost", "", f"- podélník: {json.dumps(roz['nosnost']['podelnik_svisle'], ensure_ascii=False)}",
         f"- sloupek: {json.dumps(roz['nosnost']['sloupek_vzper'], ensure_ascii=False)}", f"- {roz['nosnost']['spoje']}", "",
         f"Hmotnost rámu {roz['hmotnost'].get('celkem_kg')} kg.", "",
         "## Odhady (ODHAD)", "", *[f"- ODHAD: {x}" for x in roz.get("odhady") or []], ""]
    if roz.get("chyby") or roz.get("varovani"):
        L += ["## Chyby a varování plánu", "", *[f"- CHYBA: {x}" for x in roz.get("chyby") or []],
              *[f"- varování: {x}" for x in roz.get("varovani") or []], ""]
    if res:
        s = res.get("souhrn") or {}
        L += ["## Model a kontroly kódem", "", f"- model: {s.get('model') or (res.get('stavba') or {}).get('model')}",
              f"- chyb kontrol: {s.get('chyb')}, selhalo: {s.get('selhalo')}",
              *[f"- {k}: {v.get('chyby')} chyb, {v.get('varovani', 0)} varování" for k, v in (s.get("kontroly") or {}).items()],
              *[f"- snímek: snimky/{Path(p).name}" for p in s.get("snimky") or []], ""]
    return "\n".join(L)


def celek_params(man: dict) -> dict | None:
    """Rozměry rámu z CELKU (``celek.n1_params`` — moduly kódem určí rám: D1 + P1 + S1 → kryt O3 + pás obsluhy → N1);
    None = stroj bez pásového dopravníku nebo celek nelze sestavit (pak koncept / brief / ODHAD jako dřív)."""
    try:
        from . import celek
        return celek.n1_params(man)
    except Exception:  # noqa: BLE001 — celek je volitelný zdroj rozměrů, chyba nesmí zastavit rám
        return None


def generate(manifest_path, folder, *, scene_path=None, no_fc=False, slot=SLOT, timeout=1500, celek=True) -> dict:
    mp, folder = Path(manifest_path).resolve(), Path(folder).resolve()
    out = folder / SUB
    summ = {"ok": False, "kod": 2, "fcstd": "", "rozhrani": "", "md": ""}
    try:
        man = json.loads(mp.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as exc:
        summ["chyba"] = f"manifest nelze načíst: {exc}"
        return summ
    out.mkdir(parents=True, exist_ok=True)
    cp = celek_params(man) if celek and not scene_path else None
    if scene_path:
        scene = json.loads(Path(scene_path).read_text(encoding="utf-8"))
    elif cp is None:
        scene = concept_scene(folder / "koncept" / "Koncept.FCStd", out / ".prace", slot) if not no_fc else None
    else:
        scene = None
    lay_p = folder / "moduly" / "layout.json"
    poz = []
    if lay_p.is_file():
        try:
            poz = json.loads(lay_p.read_text(encoding="utf-8")).get("predani_n1") or []
        except ValueError:
            poz = []
    if cp is not None:
        kw = dict(cp["kw"])
        kw["pozadavky"] = list(kw.get("pozadavky") or []) + [p for p in params(man, None, poz)["kw"]["pozadavky"]]
        name = str((man.get("project") or {}).get("name") or "")
        kw["nazev"] = f"N1 rám {kw['D']:g} × {kw['W']:g} × {kw['H']:g} (celek)" + (f" — {name}" if name else "")
        pr = {"kw": kw, "umisteni": list(cp["umisteni"]), "zdroj": cp["zdroj"], "odhady": list(cp["odhady"])}
    else:
        pr = params(man, scene, poz)
    try:
        plan = modul_ram.plan_ramu(**pr["kw"])
    except Exception as exc:  # noqa: BLE001
        summ["chyba"] = f"plán rámu selhal: {exc}"
        return summ
    roz = plan["rozhrani"]
    roz["rozmery"]["umisteni"] = pr["umisteni"]
    roz["rozmery"]["zdroj"] = pr["zdroj"]
    roz["rozmery"]["souradnice"] += "; globální bod stroje = místní + umisteni"
    roz["odhady"] = sorted(set(roz.get("odhady") or []) | set(pr["odhady"]))
    roz["poznamky"] = decisions(plan, pr["kw"], man)
    roz["manifest"] = str(mp)
    shift_plan(plan, pr["umisteni"])
    files = modul_ram.write_rozhrani(plan, out)
    summ.update(rozhrani=files[0], rozmery={k: pr["kw"][k] for k in ("D", "W", "H", "podpory")}, umisteni=pr["umisteni"],
                zdroj=pr["zdroj"], venec=roz["profily"]["venec"], hmotnost_kg=roz["hmotnost"].get("celkem_kg"),
                chyby_planu=roz.get("chyby") or [], poznamky=roz["poznamky"])
    res = None
    if not no_fc:
        res = modul_ram.build_fc(plan, out, slot=slot, timeout=timeout)
    md = out / "RAM.md"
    md.write_text(report_md(roz, res, pr["zdroj"]), encoding="utf-8")
    summ["md"] = str(md)
    if no_fc:
        summ.update(ok=True, kod=1 if roz.get("chyby") else 0)
        return summ
    fc = out / "Ram.FCStd"
    if not fc.is_file():
        summ.update(kod=2, chyba="model nevznikl: " + json.dumps((res or {}).get("stavba") or {}, ensure_ascii=False)[:800])
        return summ
    s = (res or {}).get("souhrn") or {}
    summ.update(ok=True, fcstd=str(fc), kod=0 if (res or {}).get("ok") and not roz.get("chyby") else 1,
                chyb_kontrol=s.get("chyb"), selhalo=s.get("selhalo"), snimky=s.get("snimky") or [])
    return summ


def main(argv=None) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
    ap = argparse.ArgumentParser(prog="ram_gen", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("manifest")
    ap.add_argument("folder")
    ap.add_argument("--scena", default="")
    ap.add_argument("--no-fc", action="store_true")
    ap.add_argument("--slot", default=SLOT)
    ap.add_argument("--timeout", type=int, default=1500)
    ap.add_argument("--bez-celku", action="store_true", help="rozměry z konceptu / briefu i u stroje s dopravníkem (ne z celku E3)")
    a = ap.parse_args(argv)
    s = generate(a.manifest, a.folder, scene_path=a.scena or None, no_fc=a.no_fc, slot=a.slot, timeout=a.timeout, celek=not a.bez_celku)
    print(json.dumps(s, ensure_ascii=False))
    return int(s["kod"])


if __name__ == "__main__":
    sys.exit(main())
