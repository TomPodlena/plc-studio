"""PLCdesk PRO — generátor modulů kódem (CLI).

    python -m plc_studio.pro3d_modules <PLCdesk_CAD.json> <složka stroje> [--slot pro3d-modules] [--timeout 1500]
        [--no-fc] [--no-snimky] [--scena <scena.json>]
    (= python cli.py …; balík nic neimportuje z plc_studio)

Vstupy ve složce stroje: ``ram/Ram.FCStd`` (schválený rám — jen čte), ``koncept/Koncept.FCStd`` (polohy zařízení
a nosné konstrukce), ``dily/parts_index.json`` (modely pro3d_parts — zastaralé modely válců bez přípojek se nejdřív
přegenerují ``pro3d_parts gen``), volitelně ``rozvadec/layout.json`` (vývodky). Postup: ① scéna (FreeCAD headless
``fc_scene.py`` → ``moduly/.prace/scena.json``), ② rozmístění a trasy (``layout.py``, čistý Python + skill
kabelaz-a-hadice), ③ model (``fc_modules.py`` headless, pak GUI ``fc_modules_colors.py`` — barvy a snímky
``moduly/snimky/generator_*.png``). Výstup ``moduly/layout.json``, ``moduly/MODULY.md``, ``moduly/Moduly.FCStd``,
``moduly/PLCdesk_CAD_feedback_moduly_kod.json``. FreeCAD jen ve VLASTNÍ instanci (skill freecad-instance).
Poslední řádek stdout = JSON souhrn. Kód: 0 = vše postaveno; 1 = model vznikl, ale něco zůstalo nepostaveno
(chybí poloha / upevnění / trasa — doplní stavitel); 2 = selhalo (vstup, FreeCAD).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
import layout as L  # noqa: E402
import report  # noqa: E402

SUB = "moduly"
DEFAULT_SLOT = "pro3d-modules"
FEEDBACK = "PLCdesk_CAD_feedback_moduly_kod.json"
NOWIN = getattr(subprocess, "CREATE_NO_WINDOW", 0)
PARTS_DIR = HERE.parent / "pro3d_parts"


def run_fc_path() -> Path | None:
    p = Path(os.environ.get("PRO3D_RUN_FC") or Path.home() / ".claude" / "skills" / "freecad-instance" / "run_fc.ps1")
    return p if p.is_file() else None


def _ps(rf: Path) -> list[str]:
    return ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(rf)]


KW = dict(capture_output=True, text=True, encoding="utf-8", errors="replace", creationflags=NOWIN)


def fc_run(script: Path, args: list[str], res: Path, slot: str, timeout: int, runner=subprocess.run) -> dict:
    rf = run_fc_path()
    if rf is None:
        return {"ok": False, "chyby": ["run_fc.ps1 (skill freecad-instance) nenalezen"]}
    res.parent.mkdir(parents=True, exist_ok=True)
    res.unlink(missing_ok=True)
    r = runner(_ps(rf) + ["run", "--slot", slot, "--timeout", str(timeout), "--result", str(res), str(script)] + args,
               timeout=timeout + 180, **KW)
    try:
        return json.loads(res.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"ok": False, "chyby": [f"FreeCAD skončil kódem {r.returncode} bez výsledku: {((r.stdout or '') + (r.stderr or ''))[-1200:]}"]}


def spec_hash(spec: dict) -> str:          # = pro3d_parts/gen.spec_hash
    s = {k: v for k, v in spec.items() if k != "out"}
    return hashlib.sha256(json.dumps(s, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:16]


def stale_cylinders(manifest: dict, pidx: dict) -> list[str]:
    """Modely válců v dily/, jejichž specifikace se změnila (např. přípojky EE) — přegenerovat pro3d_parts gen."""
    if L.cm is None:
        return []
    out = []
    mods = pidx.get("modely") or {}
    for p in manifest.get("parts") or []:
        if p.get("category") != "cylinder" or p.get("location") != "field":
            continue
        spec, _ = L.cm.spec_for_part(p)
        if not spec:
            continue
        m = mods.get(spec["key"])
        if not m or m.get("hash") != spec_hash(spec):
            out.append(spec["key"])
    return sorted(set(out))


def regen_parts(mp: Path, folder: Path, slot: str, timeout: int, runner=subprocess.run) -> str:
    r = runner([sys.executable, "-I", str(PARTS_DIR / "gen.py"), "gen", str(mp), str(folder / "dily"), "--slot", slot,
                "--timeout", str(timeout)], timeout=timeout + 900, **KW)
    return "" if r.returncode == 0 else ((r.stdout or "") + (r.stderr or ""))[-800:]


def build_freecad(lay_path: Path, fcstd: Path, folder: Path, slot: str, timeout: int, shots: bool, runner=subprocess.run) -> dict:
    work = fcstd.parent / ".prace"
    out = fc_run(HERE / "fc_modules.py", [str(lay_path), str(fcstd), str(folder)], work / "fc_vysledek.json", slot, timeout, runner)
    if not fcstd.is_file():
        return out
    rf = run_fc_path()
    cres = work / "barvy_vysledek.json"
    cres.unlink(missing_ok=True)
    args = [str(fcstd)]
    if shots:
        sd = fcstd.parent / "snimky"
        sd.mkdir(parents=True, exist_ok=True)
        args += [str(sd / "generator_iso.png"), str(sd / "generator_moduly.png"), str(sd / "generator_shora.png")]
    runner(_ps(rf) + ["gui-start", "--slot", slot, "--max-min", str(max(10, timeout // 60 + 5))], timeout=600, **KW)
    try:
        runner(_ps(rf) + ["gui-run", "--slot", slot, "--timeout", str(timeout), "--result", str(cres),
                          str(HERE / "fc_modules_colors.py")] + args, timeout=timeout + 180, **KW)
    finally:
        runner(_ps(rf) + ["gui-stop", "--slot", slot], timeout=180, **KW)
    try:
        c = json.loads(cres.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        c = {"ok": False}
    out["barvy"] = bool(c.get("ok"))
    out["snimky"] = c.get("snimky") or []
    if not c.get("ok"):
        out.setdefault("chyby", []).append("barvy neuloženy (GUI FreeCADu)")
    return out


def generate(manifest_path, folder, *, slot: str = DEFAULT_SLOT, timeout: int = 1500, no_fc: bool = False, shots: bool = True,
             scene_path=None, runner=subprocess.run) -> dict:
    mp, folder = Path(manifest_path).resolve(), Path(folder).resolve()
    out_dir = folder / SUB
    summary = {"ok": False, "kod": 2, "fcstd": "", "layout": "", "md": ""}
    try:
        manifest = json.loads(mp.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as exc:
        summary["chyba"] = f"manifest nelze načíst: {exc}"
        return summary
    ram = folder / "ram" / "Ram.FCStd"
    kon = folder / "koncept" / "Koncept.FCStd"
    if not scene_path and not ram.is_file():
        summary["chyba"] = "ram/Ram.FCStd chybí — moduly se kotví k rámu"
        return summary
    if L.trasa_mod() is None:
        summary["chyba"] = f"skill kabelaz-a-hadice chybí ({L.skill_scripts()}) — trasy hadic a kabelů nelze spočítat"
        return summary
    pidx_p = folder / "dily" / "parts_index.json"
    pidx = json.loads(pidx_p.read_text(encoding="utf-8")) if pidx_p.is_file() else {}
    work = out_dir / ".prace"
    work.mkdir(parents=True, exist_ok=True)
    stale = stale_cylinders(manifest, pidx)
    if stale and not no_fc:
        err = regen_parts(mp, folder, slot.replace("modules", "parts"), timeout, runner)
        summary["dily_pregenerovany"] = stale
        if err:
            summary["dily_chyba"] = err
        pidx = json.loads(pidx_p.read_text(encoding="utf-8")) if pidx_p.is_file() else pidx
    if scene_path:
        scene = json.loads(Path(scene_path).read_text(encoding="utf-8"))
    else:
        sc = fc_run(HERE / "fc_scene.py", [str(ram), str(kon) if kon.is_file() else ""], work / "scena.json", slot, 600, runner)
        if not sc.get("ok"):
            summary["chyba"] = "scéna rámu nenačtena: " + "; ".join(sc.get("chyby") or ["?"])
            return summary
        scene = sc
    cab_p = folder / "rozvadec" / "layout.json"
    cab = json.loads(cab_p.read_text(encoding="utf-8")) if cab_p.is_file() else None
    lay = L.plan(manifest, scene, folder=folder, parts_index=pidx, cab_layout=cab, manifest_path=mp)
    lp = out_dir / "layout.json"
    lp.write_text(json.dumps(lay, ensure_ascii=False, indent=1), encoding="utf-8")
    (out_dir / FEEDBACK).write_text(json.dumps(lay["zpetna_vazba"], ensure_ascii=False, indent=1), encoding="utf-8")
    summary.update(layout=str(lp), md=str(out_dir / "MODULY.md"), souhrn=lay["souhrn"], feedback=str(out_dir / FEEDBACK))
    fc = None
    fcstd = out_dir / "Moduly.FCStd"
    if not no_fc:
        fc = build_freecad(lp, fcstd, folder, slot, timeout, shots, runner)
    (out_dir / "MODULY.md").write_text(report.md(lay, fc), encoding="utf-8")
    incomplete = bool(lay["nepostaveno"]) or bool((fc or {}).get("odebrano"))
    if no_fc:
        summary.update(ok=True, kod=1 if incomplete else 0)
        return summary
    if not fc or not fcstd.is_file() or not fc.get("objektu"):
        summary.update(kod=2, chyba="; ".join((fc or {}).get("chyby") or ["model nevznikl"]))
        return summary
    summary.update(ok=True, fcstd=str(fcstd), kod=1 if (incomplete or not fc.get("ok")) else 0,
                   odebrano=len(fc.get("odebrano") or []), snimky=fc.get("snimky") or [], chyby_fc=fc.get("chyby") or [])
    return summary


def main(argv: list[str] | None = None) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass
    ap = argparse.ArgumentParser(prog="pro3d_modules", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("manifest")
    ap.add_argument("folder")
    ap.add_argument("--slot", default=DEFAULT_SLOT)
    ap.add_argument("--timeout", type=int, default=1500)
    ap.add_argument("--no-fc", action="store_true", help="jen layout.json a MODULY.md (scéna z --scena)")
    ap.add_argument("--no-snimky", action="store_true")
    ap.add_argument("--scena", default="", help="hotová scena.json (bez FreeCADu pro scénu)")
    a = ap.parse_args(argv)
    s = generate(a.manifest, a.folder, slot=a.slot, timeout=a.timeout, no_fc=a.no_fc, shots=not a.no_snimky,
                 scene_path=a.scena or None)
    print(json.dumps(s, ensure_ascii=False))
    return int(s["kod"])


if __name__ == "__main__":
    sys.exit(main())
