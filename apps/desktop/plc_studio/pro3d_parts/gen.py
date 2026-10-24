"""PLCdesk PRO — generátory normalizovaných dílů kódem (model „dle dokumentace“ se zdrojem místo zástupné obálky).

    pro3d_parts.ps1 gen <PLCdesk_CAD.json> <výstupní složka> [--slot pro3d-parts] [--timeout 900] [--no-fc] [--force]
    pro3d_parts.ps1 part "ISO4762 M6x20" "TS35 7.5x450" "SKINTOP M20" … --out <složka>
    pro3d_parts.ps1 map <PLCdesk_CAD.json>                 (jen pokrytí, bez FreeCADu)
    (= python gen.py …; bez importu z plc_studio)

``gen`` namapuje řádky manifestu (``catalog_map.py``), každý jedinečný model postaví FreeCAD ve VLASTNÍ instanci
(``run_fc.ps1 run``, slot ``--slot``) skriptem ``fc_parts.py`` a zapíše ``parts_index.json`` (id dílu → soubor FCStd,
stav ``dle dokumentace`` / ``zástupný``, zdroj, důvod) a ``DILY.md`` (souhrn pokrytí). Hotové modely se stejnou
specifikací se nepřestavují (otisk ve ``parts_index.json``; ``--force`` přestaví vše). Headless FreeCAD barvy neukládá,
proto se nové modely (a starší bez ``barva``) potom otevřou v GUI instanci téhož slotu (``gui-start`` → ``gui-run``
``fc_colors.py`` → ``gui-stop``) a uloží jednotně žluté RGB 255,215,0 (``barva: true`` v indexu). Návratový kód 0 = ok,
2 = FreeCAD selhal, model není platný nebo se barvy neuložily.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
import catalog_map as cm  # noqa: E402

INDEX = "parts_index.json"
SUMMARY = "DILY.md"
DEFAULT_SLOT = "pro3d-parts"
NOWIN = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def run_fc_path() -> Path | None:
    p = Path(os.environ.get("PRO3D_RUN_FC") or Path.home() / ".claude" / "skills" / "freecad-instance" / "run_fc.ps1")
    return p if p.is_file() else None


def spec_hash(spec: dict) -> str:
    s = {k: v for k, v in spec.items() if k != "out"}
    return hashlib.sha256(json.dumps(s, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:16]


def run_freecad(specs: list[dict], work: Path, slot: str, timeout: int) -> dict:
    """Postaví modely ve vlastní instanci FreeCADu. Vrací ``{"modely": {...}}`` nebo ``{"chyba": …}``."""
    rf = run_fc_path()
    if rf is None:
        return {"chyba": "run_fc.ps1 (skill freecad-instance) nenalezen — modely nepostaveny"}
    work.mkdir(parents=True, exist_ok=True)
    sp = work / "specs.json"
    res = work / "vysledek.json"
    sp.write_text(json.dumps(specs, ensure_ascii=False, indent=1), encoding="utf-8")
    if res.exists():
        res.unlink()
    cmd = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(rf), "run", "--slot", slot,
           "--timeout", str(timeout), "--result", str(res), str(HERE / "fc_parts.py"), str(sp)]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", creationflags=NOWIN,
                       timeout=timeout + 120)
    if res.is_file():
        try:
            return json.loads(res.read_text(encoding="utf-8"))
        except ValueError:
            pass
    tail = (r.stdout or "")[-1500:] + (r.stderr or "")[-800:]
    return {"chyba": f"FreeCAD skončil kódem {r.returncode} bez výsledku: {tail}"}


def color_freecad(files: list[str], work: Path, slot: str, timeout: int, runner=subprocess.run) -> dict:
    """Obarví díly „dle dokumentace“ v ``files`` žlutě a uloží je z GUI instance (vlastní slot, po práci zavřená).
    Vrací ``{"soubory": {cesta: {ok, obarveno, chyba}}}`` nebo ``{"chyba": …}``."""
    rf = run_fc_path()
    if rf is None:
        return {"chyba": "run_fc.ps1 (skill freecad-instance) nenalezen — barvy neuloženy"}
    work.mkdir(parents=True, exist_ok=True)
    fl = work / "barvy.json"
    res = work / "barvy_vysledek.json"
    fl.write_text(json.dumps(files, ensure_ascii=False), encoding="utf-8")
    if res.exists():
        res.unlink()
    ps = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(rf)]
    kw = dict(capture_output=True, text=True, encoding="utf-8", errors="replace", creationflags=NOWIN)
    st = runner(ps + ["gui-start", "--slot", slot, "--max-min", str(max(5, timeout // 60 + 5))], timeout=600, **kw)
    r = None
    try:
        r = runner(ps + ["gui-run", "--slot", slot, "--timeout", str(timeout), "--result", str(res),
                         str(HERE / "fc_colors.py"), str(fl)], timeout=timeout + 120, **kw)
    finally:
        runner(ps + ["gui-stop", "--slot", slot], timeout=180, **kw)
    if res.is_file():
        try:
            return json.loads(res.read_text(encoding="utf-8"))
        except ValueError:
            pass
    tail = ((st.stdout or "") + ((r.stdout or "") if r is not None else ""))[-1500:]
    return {"chyba": f"GUI FreeCADu barvy neuložilo: {tail}"}


def generate(specs: dict, out_dir: Path, *, slot: str = DEFAULT_SLOT, timeout: int = 900, no_fc: bool = False,
             force: bool = False, old: dict | None = None) -> tuple[dict, str]:
    """Postaví modely ``specs`` (key → spec) do ``out_dir/modely``. Vrací (stav modelů key → {...}, chyba)."""
    mod_dir = out_dir / "modely"
    old_m = (old or {}).get("modely") or {}
    state: dict = {}
    todo = []
    for key, s in specs.items():
        h = spec_hash(s)
        f = mod_dir / f"{key}.FCStd"
        prev = old_m.get(key) or {}
        if not force and f.is_file() and prev.get("hash") == h and prev.get("ok"):
            state[key] = dict(prev, znovu=False)
            continue
        state[key] = {"file": f"modely/{key}.FCStd", "hash": h, "ok": False}
        todo.append(dict(s, out=str(f)))
    err = ""
    if todo and not no_fc:
        res = run_freecad(todo, out_dir / ".prace", slot, timeout)
        err = res.get("chyba", "")
        for key, r in (res.get("modely") or {}).items():
            state[key].update(ok=bool(r.get("ok")), bbox=r.get("bbox"), objem=r.get("objem"), telesa=r.get("telesa"),
                              chyba=r.get("chyba", ""), znovu=True)
    elif todo:
        err = "--no-fc: modely nepostaveny"
    paint = [k for k, v in state.items() if v.get("ok") and not v.get("barva")]
    if paint and not no_fc:                            # barvy uloží jen GUI (GuiDocument.xml)
        files = {str((out_dir / state[k]["file"]).resolve()): k for k in paint}
        cr = color_freecad(list(files), out_dir / ".prace", slot, timeout)
        done = cr.get("soubory") or {}
        for f, k in files.items():
            state[k]["barva"] = bool((done.get(f) or {}).get("ok"))
        bad = [f for f, k in files.items() if not state[k]["barva"]]
        if bad:
            why = cr.get("chyba") or ", ".join((done.get(f) or {}).get("chyba") or Path(f).name for f in bad[:3])
            err = "; ".join(x for x in (err, f"barvy neuloženy ({len(bad)}): {why}") if x)
    return state, err


def write_index(out_dir: Path, manifest_path: Path | None, mapped: dict, models: dict, err: str) -> dict:
    parts = {}
    for pid, row in mapped["parts"].items():
        r = dict(row)
        if r["stav"] == cm.STAV_DOK:
            m = models.get(r["model"]) or {}
            if m.get("ok"):
                r["file"] = m["file"]
            else:                                      # model nevznikl → díl zůstává zástupný
                r.update(stav=cm.STAV_ZAST, duvod="model nevznikl: " + (m.get("chyba") or err or "neznámá chyba"))
        parts[pid] = r
    fixed = {"parts": parts, "specs": mapped["specs"]}
    idx = {"version": 1, "format": "plcdesk-pro3d-parts", "created": _dt.datetime.now().isoformat(timespec="seconds"),
           "manifest": str(manifest_path) if manifest_path else "",
           "manifestSha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest() if manifest_path else "",
           "souhrn": cm.coverage(fixed), "parts": parts, "modely": models, "chyba": err}
    (out_dir / INDEX).write_text(json.dumps(idx, ensure_ascii=False, indent=1), encoding="utf-8")
    (out_dir / SUMMARY).write_text(summary_md(idx, mapped["specs"]), encoding="utf-8")
    return idx


def summary_md(idx: dict, specs: dict) -> str:
    s = idx["souhrn"]
    out = ["# Normalizované díly — generátory kódem (PLCdesk PRO)", "",
           f"Řádků kusovníku: **{s['radku']}**, dle dokumentace **{s['dle_dokumentace']}** ({s['pokryti_pct']} %), "
           f"zástupné {s['zastupne']}; kusů {s['kusu_dle_dokumentace']} / {s['kusu']}; modelů {s['modelu']}.", "",
           "Modely z tabulek rozměrů se zdrojem (`pro3d_parts/data/*.json`); detail „obálka“ = rozměry z datového listu, "
           "tvar zjednodušen. Barvy v modelu: **žlutá** RGB 255,215,0 = díl dle dokumentace (vložit jako App::Link, "
           "nepřebarvovat), **oranžová** 255,140,0 = zástupná obálka (jen pro díly se stavem zástupný), ostatní = "
           "model výrobce / vlastní konstrukce.", "",
           "| díl | stav | model / důvod |", "|---|---|---|"]
    for pid, r in idx["parts"].items():
        what = f"`{r['file']}` ({r.get('detail', '')})" if r.get("file") else (r.get("duvod") or "")
        out.append(f"| {pid} | {r['stav']} | {what.replace('|', '/')} |")
    if idx.get("chyba"):
        out += ["", "Chyba: " + idx["chyba"]]
    return "\n".join(out) + "\n"


def cmd_gen(a) -> int:
    mp = Path(a.manifest).resolve()
    manifest = json.loads(mp.read_text(encoding="utf-8"))
    out_dir = Path(a.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    mapped = cm.map_manifest(manifest)
    old = None
    if (out_dir / INDEX).is_file():
        try:
            old = json.loads((out_dir / INDEX).read_text(encoding="utf-8"))
        except ValueError:
            old = None
    models, err = generate(mapped["specs"], out_dir, slot=a.slot, timeout=a.timeout, no_fc=a.no_fc, force=a.force, old=old)
    idx = write_index(out_dir, mp, mapped, models, err)
    s = idx["souhrn"]
    print(json.dumps({"ok": not err, "souhrn": s, "index": str(out_dir / INDEX), "chyba": err}, ensure_ascii=False))
    return 0 if (not err or a.no_fc) and all(m.get("ok") for m in models.values() if not a.no_fc) else 2


def cmd_part(a) -> int:
    out_dir = Path(a.out).resolve()
    specs, errs = {}, []
    for req in a.requests:
        s, why = cm.spec_for_request(req)
        if s:
            specs[s["key"]] = s
        else:
            errs.append(f"{req}: {why}")
    models, err = generate(specs, out_dir, slot=a.slot, timeout=a.timeout, no_fc=a.no_fc, force=True)
    print(json.dumps({"ok": not (errs or err), "modely": {k: {"file": str(out_dir / v["file"]), "ok": v.get("ok"),
                                                           "bbox": v.get("bbox")} for k, v in models.items()},
                      "nerozpoznano": errs, "chyba": err}, ensure_ascii=False))
    return 0 if not (errs or err) else 2


def cmd_map(a) -> int:
    manifest = json.loads(Path(a.manifest).read_text(encoding="utf-8"))
    mapped = cm.map_manifest(manifest)
    print(json.dumps({"souhrn": cm.coverage(mapped), "parts": {k: (v.get("model") or "ZÁSTUPNÝ: " + v.get("duvod", ""))
                                                              for k, v in mapped["parts"].items()}},
                     ensure_ascii=False, indent=1))
    return 0


def main(argv: list[str] | None = None) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass
    ap = argparse.ArgumentParser(prog="pro3d_parts", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("gen")
    g.add_argument("manifest")
    g.add_argument("out")
    p = sub.add_parser("part")
    p.add_argument("requests", nargs="+")
    p.add_argument("--out", required=True)
    m = sub.add_parser("map")
    m.add_argument("manifest")
    for x in (g, p):
        x.add_argument("--slot", default=DEFAULT_SLOT)
        x.add_argument("--timeout", type=int, default=900)
        x.add_argument("--no-fc", action="store_true")
    g.add_argument("--force", action="store_true")
    a = ap.parse_args(argv)
    return {"gen": cmd_gen, "part": cmd_part, "map": cmd_map}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
