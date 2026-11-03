"""Zkušební deska modulu: plán → FreeCAD (vlastní instance skillem freecad-instance) → barvy + snímky (GUI) → kontroly
``pro3d_tools`` (``pro3d.ps1 vse``). Bez Tk; FreeCAD se jen spouští skriptem ``run_fc.ps1`` ve slotu ``SLOT``."""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
SLOT = os.environ.get("PRO3D_S1_SLOT") or "pro3d-s1-test"
RUN_FC = Path(os.environ.get("PRO3D_RUN_FC") or Path.home() / ".claude" / "skills" / "freecad-instance" / "run_fc.ps1")
PRO3D = HERE.parent / "pro3d_tools" / "pro3d.ps1"


def _ps(args: list[str], timeout: int) -> subprocess.CompletedProcess:
    cmd = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File"] + [str(a) for a in args]
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)


def _last_json(text: str) -> dict:
    for line in reversed((text or "").strip().splitlines()):
        line = line.strip()
        if line.startswith("{"):
            try:
                return json.loads(line)
            except ValueError:
                continue
    return {}


def available() -> bool:
    return RUN_FC.is_file()


def build(plan: dict, folder: Path, timeout: int = 900, slot: str | None = None) -> dict:
    slot = slot or SLOT
    folder.mkdir(parents=True, exist_ok=True)
    pp = folder / "plan.json"
    pp.write_text(json.dumps(plan, ensure_ascii=False, indent=1), encoding="utf-8")
    rp = folder / "fc_lib_vysledek.json"
    r = _ps([RUN_FC, "run", "--slot", slot, "--timeout", str(timeout), "--result", rp, HERE / "fc_lib.py", pp, folder],
            timeout + 120)
    summ = _last_json(r.stdout)
    res = json.loads(rp.read_text(encoding="utf-8")) if rp.is_file() else {"ok": False}
    res["fc"] = {k: summ.get(k) for k in ("ok", "exit_code", "timed_out", "duration_s", "error", "leftover")}
    if not summ.get("ok"):
        res["ok"] = False
    return res


def colors_and_shots(model: Path, dily: list[str], shots: dict, max_min: int = 15, slot: str | None = None,
                     shots2: dict | None = None, skryt: dict | None = None) -> dict:
    slot = slot or SLOT
    job = model.parent / "barvy_ulohy.json"
    job.write_text(json.dumps({"dily": dily, "model": str(model), "snimky": {k: str(v) for k, v in shots.items()},
                              "snimky_vysunuto": {k: str(v) for k, v in (shots2 or {}).items()},
                              "skryt": skryt or {}}, ensure_ascii=False), encoding="utf-8")
    st = _ps([RUN_FC, "gui-start", "--slot", slot, "--max-min", str(max_min)], 300)
    try:
        r = _ps([RUN_FC, "gui-run", "--slot", slot, "--timeout", "600", HERE / "fc_lib_colors.py", job], 700)
        out = _last_json(r.stdout)
    finally:
        _ps([RUN_FC, "gui-stop", "--slot", slot], 120)
    out["start"] = _last_json(st.stdout) or st.stdout[-400:]
    return out


def checks(model: Path, out: Path, timeout: int = 1800, slot: str | None = None) -> dict:
    slot = slot or SLOT
    r = _ps([PRO3D, "vse", model, "--out", out, "--slot", slot, "--timeout", str(timeout)], timeout + 300)
    kj = out / "kontroly.json"
    rep = json.loads(kj.read_text(encoding="utf-8")) if kj.is_file() else {}
    rep["_exit"] = r.returncode
    return rep


def souhrn(rep: dict) -> dict:
    out = {}
    for k, c in (rep.get("checks") or {}).items():
        out[k] = {"chyby": len(c.get("chyby") or []), "varovani": len(c.get("varovani") or []),
                  "selhalo": c.get("selhalo")}
    return out


def build_and_check(plan: dict, folder: Path, slot: str | None = None, vysunuto: bool = False) -> dict:
    """Plán → model → barvy + snímky → kontroly. ``vysunuto`` = i snímky druhé polohy (Konstrukce_Pohyb, např. pístnice
    vysunuta; model se v té poloze neukládá)."""
    folder = Path(folder).resolve()
    b = build(plan, folder, slot=slot)
    if not b.get("model"):
        return {"ok": False, "stavba": b}
    model = Path(b["model"])
    sn = folder / "snimky"
    sn.mkdir(exist_ok=True)
    pre = plan.get("snimky_prefix") or "lavice"
    shots = {k: sn / f"{pre}_{k}.png" for k in (plan.get("snimky") or ("iso", "iso2", "shora", "bok"))}
    shots2 = {"iso": sn / f"{pre}_vysunuto_iso.png", "shora": sn / f"{pre}_vysunuto_shora.png"} if vysunuto else {}
    c = colors_and_shots(model, b.get("soubory_dilu") or [], shots, slot=slot, shots2=shots2, skryt=plan.get("snimky_skryt"))
    shots = dict(shots, **{"v_" + k: v for k, v in shots2.items()})
    rep = checks(model, folder / "kontroly", slot=slot)
    s = souhrn(rep)
    nch = sum(v["chyby"] for v in s.values())
    failed = [k for k, v in s.items() if v["selhalo"]]
    return {"ok": bool(b.get("ok")) and nch == 0 and not failed, "stavba": b, "barvy": c, "kontroly": rep,
            "souhrn": {"model": str(model), "chyb": nch, "selhalo": failed, "kontroly": s,
                       "snimky": [str(p) for p in shots.values()]}}
