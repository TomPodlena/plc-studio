"""PLCdesk PRO — generátor rozvaděče kódem (CLI).

    python -m plc_studio.pro3d_cabinet <PLCdesk_CAD.json> <složka stroje> [--rezerva 20] [--tamb 35] [--tin 40]
        [--montaz stena|volne] [--vyska-nm 0] [--slot pro3d-cabinet] [--timeout 900] [--no-fc] [--no-snimky]
    (= python cli.py …; balík nic neimportuje z plc_studio)

Výstup ve ``<složka>/rozvadec/``: ``layout.json``, ``ROZVADEC.md``, ``Rozvadec.FCStd`` (FreeCAD ve VLASTNÍ instanci přes
skill freecad-instance: headless ``fc_cabinet.py``, pak GUI ``fc_cabinet_colors.py`` — barvy + snímky
``snimky/generator_celo.png``, ``generator_iso.png`` a ``generator_dvere_otevrene.png`` — dveře 95°). Díly „dle dokumentace“ bere z ``<složka>/dily/parts_index.json``
(pro3d_parts gen). Poslední řádek stdout = JSON souhrn. Kód: 0 = vejde se, rezerva i bilance vyhovují; 1 = nevyhovuje
(nevejde se do žádné skříně / rezerva / tepelná bilance nevyhovuje nebo nelze rozhodnout); 2 = selhalo (vstup, FreeCAD).
"""

from __future__ import annotations

import argparse
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

SUB = "rozvadec"
DEFAULT_SLOT = "pro3d-cabinet"
NOWIN = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def run_fc_path() -> Path | None:
    p = Path(os.environ.get("PRO3D_RUN_FC") or Path.home() / ".claude" / "skills" / "freecad-instance" / "run_fc.ps1")
    return p if p.is_file() else None


def _ps(rf: Path) -> list[str]:
    return ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(rf)]


def build_freecad(lay_path: Path, fcstd: Path, folder: Path, slot: str, timeout: int, shots: bool, runner=subprocess.run) -> dict:
    """Headless stavba + GUI barvy (a snímky) ve vlastní instanci FreeCADu slotu ``slot``."""
    rf = run_fc_path()
    if rf is None:
        return {"ok": False, "chyby": ["run_fc.ps1 (skill freecad-instance) nenalezen — model nepostaven"]}
    work = fcstd.parent / ".prace"
    work.mkdir(parents=True, exist_ok=True)
    res = work / "fc_vysledek.json"
    res.unlink(missing_ok=True)
    kw = dict(capture_output=True, text=True, encoding="utf-8", errors="replace", creationflags=NOWIN)
    r = runner(_ps(rf) + ["run", "--slot", slot, "--timeout", str(timeout), "--result", str(res), str(HERE / "fc_cabinet.py"),
                          str(lay_path), str(fcstd), str(folder)], timeout=timeout + 180, **kw)
    out = {}
    if res.is_file():
        try:
            out = json.loads(res.read_text(encoding="utf-8"))
        except ValueError:
            out = {}
    if not out:
        return {"ok": False, "chyby": [f"FreeCAD skončil kódem {r.returncode} bez výsledku: {((r.stdout or '') + (r.stderr or ''))[-1200:]}"]}
    if not out.get("ok") and not fcstd.is_file():
        return out
    # barvy (+ snímky) z GUI téhož slotu
    cres = work / "barvy_vysledek.json"
    cres.unlink(missing_ok=True)
    args = [str(fcstd)]
    if shots:
        sd = fcstd.parent / "snimky"
        sd.mkdir(parents=True, exist_ok=True)
        args += [str(sd / "generator_celo.png"), str(sd / "generator_iso.png"), str(sd / "generator_dvere_otevrene.png")]
    runner(_ps(rf) + ["gui-start", "--slot", slot, "--max-min", str(max(10, timeout // 60 + 5))], timeout=600, **kw)
    try:
        runner(_ps(rf) + ["gui-run", "--slot", slot, "--timeout", str(timeout), "--result", str(cres),
                          str(HERE / "fc_cabinet_colors.py")] + args, timeout=timeout + 180, **kw)
    finally:
        runner(_ps(rf) + ["gui-stop", "--slot", slot], timeout=180, **kw)
    try:
        c = json.loads(cres.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        c = {"ok": False}
    out["barvy"] = bool(c.get("ok"))
    out["snimky"] = c.get("snimky") or []
    if not c.get("ok"):
        out.setdefault("chyby", []).append("barvy neuloženy (GUI FreeCADu)")
        out["ok"] = False
    return out


def generate(manifest_path: str | Path, folder: str | Path, *, rezerva: float = 20.0, tamb: float = 35.0, tin: float = 40.0,
             montaz: str = "stena", vyska: float = 0.0, slot: str = DEFAULT_SLOT, timeout: int = 900, no_fc: bool = False,
             shots: bool = True, runner=subprocess.run) -> dict:
    mp, folder = Path(manifest_path).resolve(), Path(folder).resolve()
    out_dir = folder / SUB
    summary = {"ok": False, "kod": 2, "fcstd": "", "layout": "", "md": ""}
    try:
        manifest = json.loads(mp.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        summary["chyba"] = f"manifest nelze načíst: {exc}"
        return summary
    lay = L.plan(manifest, folder=folder, rezerva=rezerva, tamb=tamb, tin=tin, mount=montaz, alt=vyska, manifest_path=mp)
    if lay.get("chyba") and not lay.get("pokusy"):
        summary["chyba"] = lay["chyba"]
        return summary
    out_dir.mkdir(parents=True, exist_ok=True)
    lp = out_dir / "layout.json"
    lp.write_text(json.dumps(lay, ensure_ascii=False, indent=1), encoding="utf-8")
    summary.update(layout=str(lp), md=str(out_dir / "ROZVADEC.md"))
    fc = None
    fcstd = out_dir / "Rozvadec.FCStd"
    if lay.get("ok") and not no_fc:
        fc = build_freecad(lp, fcstd, folder, slot, timeout, shots, runner)
    (out_dir / "ROZVADEC.md").write_text(report.md(lay, fc), encoding="utf-8")
    if not lay.get("ok"):
        summary.update(kod=1, chyba=lay.get("chyba", ""))
        return summary
    b, v = lay["bilance"], lay["verdikt"]
    summary.update(skrin=f"{lay['cabinet']['brand']} {lay['cabinet']['orderCode']}", rozmer=[lay["cabinet"][k] for k in ("w", "h", "d")],
                   zmena_skrine=lay["cabinet"]["zmena"], listy=[{"n": r["name"], "obsazeno_pct": round(100 - r["rezerva_pct"], 1),
                                                                 "rezerva_pct": r["rezerva_pct"]} for r in lay["rails"]],
                   bilance={"verdikt": b["verdikt"], "Qv": b["Qv"], "Qs": b["Qs"], "ti": b["ti"], "t_odhad": b["t_odhad"],
                            "chybi": len(b["chybi"]), "opatreni": _fan_summary(b.get("ventilator"))},
                   rezerva_ok=v["rezerva_ok"], fc=fc, dvere_chyby=v.get("dvere_chyby", 0), oddeleni_ok=v.get("oddeleni_ok", True),
                   kabelaz_dvere={k: {"volny": r.get("volny"), "chyby": r.get("chyby")} for k, r in (lay.get("kabelaz_dvere") or {}).items()})
    therm_ok = b["verdikt"] == "vyhovuje" or (bool((b.get("ventilator") or {}).get("rezerva_ok")) and not b["chybi"])
    if no_fc:
        summary.update(ok=True, kod=0 if (v["rezerva_ok"] and therm_ok) else 1)
        return summary
    if not fc or not fcstd.is_file() or not fc.get("objektu"):
        summary.update(kod=2, chyba="; ".join((fc or {}).get("chyby") or ["model nevznikl"]))
        return summary
    summary.update(ok=True, fcstd=str(fcstd), kod=0 if (v["rezerva_ok"] and therm_ok and fc.get("ok")) else 1)
    return summary


def _fan_summary(f: dict | None) -> dict | None:
    if not f:
        return None
    t = f.get("typ") or {}
    return {"verdikt": f.get("verdikt"), "typ": t.get("kod"), "ti": f.get("ti_s"), "rezerva_K": f.get("rezerva_K"),
            "rezerva_ok": f.get("rezerva_ok"), "duvod": f.get("duvod")}


def main(argv: list[str] | None = None) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass
    ap = argparse.ArgumentParser(prog="pro3d_cabinet", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("manifest")
    ap.add_argument("folder")
    ap.add_argument("--rezerva", type=float, default=20.0, help="rezerva místa na každé liště v %% (výchozí 20)")
    ap.add_argument("--tamb", type=float, default=35.0, help="okolní teplota °C (výchozí 35)")
    ap.add_argument("--tin", type=float, default=40.0, help="dovolená vnitřní teplota °C (výchozí 40; platí i nižší mez přístrojů)")
    ap.add_argument("--montaz", choices=("stena", "volne"), default="stena")
    ap.add_argument("--vyska-nm", type=float, default=0.0, help="nadmořská výška m (součinitel f ventilátoru)")
    ap.add_argument("--slot", default=DEFAULT_SLOT)
    ap.add_argument("--timeout", type=int, default=900)
    ap.add_argument("--no-fc", action="store_true", help="jen layout.json a ROZVADEC.md (bez FreeCADu)")
    ap.add_argument("--no-snimky", action="store_true")
    a = ap.parse_args(argv)
    s = generate(a.manifest, a.folder, rezerva=a.rezerva, tamb=a.tamb, tin=a.tin, montaz=a.montaz, vyska=a.vyska_nm, slot=a.slot,
                 timeout=a.timeout, no_fc=a.no_fc, shots=not a.no_snimky)
    print(json.dumps(s, ensure_ascii=False))
    return int(s["kod"])


if __name__ == "__main__":
    sys.exit(main())
