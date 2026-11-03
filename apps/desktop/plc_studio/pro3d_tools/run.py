"""PLCdesk PRO — kontroly 3D modelu skripty (místo ručních kontrol agenta). Spouštěč i knihovna.

    pro3d.ps1 <kontrola> <model.FCStd> [--out SLOŽKA] [--manifest PLCdesk_CAD.json] [--slot SLOT] [--timeout S]
              [--grids 5,4,3] [--podlaha Z] [--detail "díl1;díl2"] [--prefix k5]
    (= python run.py …; pro3d.ps1 vybere Python s numpy — FreeCAD 1.1 ho má)

Kontroly: ``kolize`` (přísné průniky, povolené jen šroub × díra / závit, matice × drážka, kabel / hadice ve žlabu /
obálce řetězu, hadice zasunutá do šroubení, šroubení v portu; polohy ``Konstrukce_Pohyb``; kalibrace měřiče),
``souvislost`` (graf dotyků, podlaha, díly bez spoje, žlab bez šroubu k rámu = chyba, volná čela profilů), ``otvory`` (voxely
5 / 4 / 3 mm → cesty k zónám ``Zona_*``, e a Sr, ISO 13857 tab. 4), ``zasunuti`` (délka dříku šroubu v závitu / matici ×
max(k·d, 3 mm) podle materiálu — skill spoje-sroubove kap. 6; šroub do vzduchu / jen v průchozích dírách = chyba a pro
souvislost není spojem), ``kopie`` (shodná tělesa — objem, plocha, hlavní momenty, vrcholy po otočení — vložená jako kopie
místo App::Link = chyba), ``kusovnik`` (``PLCdesk_Id`` × manifest),
``stav`` (zástupné díly = oranžová 255,140,0 = vlastnost), ``step`` (export a zpětné načtení), ``snimky`` (GUI instance),
``vse`` = kolize … step (bez snímků) → ``kontroly.json`` + ``KONTROLY.md`` (≤ 40 řádků) ve složce ``--out``
(výchozí složka modelu). Návratový kód: 0 bez chyb, 1 chyby, 2 kontrola selhala (= chyba pro verdikt K5).

FreeCAD jen ve VLASTNÍ instanci přes ``run_fc.ps1`` (skill freecad-instance, slot ``--slot``); model se jen čte."""

from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
import rules  # noqa: E402

HOME = Path(os.path.expanduser("~"))
FC_CHECKS = ("kolize", "souvislost", "zasunuti", "kopie", "zony", "otvory", "kusovnik", "step")
ALL = ("kolize", "souvislost", "zasunuti", "kopie", "zony", "otvory", "kusovnik", "stav", "step")
DEFAULT_SLOT = "pro3d-kontroly"
WORK = ".kontroly"
NOWIN = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def run_fc_path() -> Path | None:
    p = Path(os.environ.get("PRO3D_RUN_FC") or HOME / ".claude" / "skills" / "freecad-instance" / "run_fc.ps1")
    return p if p.is_file() else None


def freecad_bin() -> Path | None:
    env = os.environ.get("PLCDESK_FREECAD")
    cands = [Path(env).parent] if env else []
    local = Path(os.environ.get("LOCALAPPDATA") or HOME / "AppData" / "Local")
    cands += [local / "Programs" / "FreeCAD 1.1" / "bin", Path(os.environ.get("ProgramFiles") or r"C:\Program Files") / "FreeCAD 1.1" / "bin"]
    return next((c for c in cands if (c / "freecadcmd.exe").is_file() or (c / "python.exe").is_file()), None)


def numpy_python() -> str:
    """Python s numpy pro voxely: tento interpret, jinak Python FreeCADu (numpy + scipy přibalené)."""
    try:
        import numpy  # noqa: F401
        return sys.executable
    except ImportError:
        b = freecad_bin()
        if b and (b / "python.exe").is_file():
            return str(b / "python.exe")
    return sys.executable


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def find_manifest(model: Path, explicit: str | None) -> Path | None:
    if explicit:
        p = Path(explicit)
        return p if p.is_file() else None
    d = model.resolve().parent
    for _ in range(4):
        for name in ("PLCdesk_CAD.json",):
            if (d / name).is_file():
                return d / name
        hits = sorted(d.glob("PLCdesk_CAD*.json"))
        hits = [h for h in hits if "feedback" not in h.name.lower()]
        if hits:
            return hits[0]
        d = d.parent
    return None


def _ps(run_fc: Path) -> list[str]:
    return ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(run_fc)]


def _last_json(text: str) -> dict:
    for line in reversed((text or "").strip().splitlines()):
        line = line.strip()
        if line.startswith("{"):
            try:
                return json.loads(line)
            except ValueError:
                continue
    return {}


def fc_run(script: Path, args: list[str], slot: str, timeout: int, runner=subprocess.run) -> dict:
    """Headless běh skriptu ve vlastní instanci FreeCADu (run_fc.ps1 run) → souhrn spouštěče."""
    rf = run_fc_path()
    if rf is None:
        return {"ok": False, "error": "run_fc.ps1 (skill freecad-instance) nenalezen"}
    cmd = _ps(rf) + ["run", "--slot", slot, "--timeout", str(timeout), str(script)] + [str(a) for a in args]
    r = runner(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", creationflags=NOWIN)
    s = _last_json(r.stdout)
    s.setdefault("ok", r.returncode == 0)
    if not s.get("ok") and not s.get("error"):
        s["error"] = ((r.stdout or "") + (r.stderr or ""))[-1500:]
    return s


# --- zástupné díly bez FreeCADu (Document.xml + GuiDocument.xml) ------------------------------------------------------

def _doc_objects(z: zipfile.ZipFile) -> dict:
    """{jméno: {type, label, props, link}} z Document.xml (jen potřebné vlastnosti)."""
    d = z.read("Document.xml").decode("utf-8", errors="replace")
    types = {n: t for t, n in re.findall(r'<Object type="([^"]+)" name="([^"]+)"', d)}
    out = {}
    i = d.find("<ObjectData")
    for m in re.finditer(r'<Object name="([^"]+)"[^>]*>(.*?)</Object>', d[i:], re.S):
        name, body = m.group(1), m.group(2)
        pr = {}
        for pm in re.finditer(r'<Property name="([^"]+)" type="[^"]+"[^>]*>\s*<(\w+) value="([^"]*)"', body):
            k = pm.group(1)
            if k.startswith(("PLCdesk_", "Konstrukce_", "Placeholder")) or k == "Label":
                pr[k] = pm.group(3)
        lk = re.search(r'<Property name="LinkedObject"[^>]*>\s*<(XLink|Link)\b([^>]*)/?>', body)
        link = None
        if lk:
            attrs = dict(re.findall(r'(\w+)="([^"]*)"', lk.group(2)))
            link = {"ext": attrs.get("file", ""), "name": attrs.get("name") or attrs.get("value") or ""}
        out[name] = {"type": types.get(name, ""), "label": pr.pop("Label", name), "props": pr, "link": link}
    return out


def _ext_dle_dokumentace(path: Path) -> list[str]:
    """Popisky dílů „dle dokumentace“ v dokumentu ``path``, které nejsou žluté (prázdné = v pořádku)."""
    with zipfile.ZipFile(path) as z:
        objs = _doc_objects(z)
        gui = "GuiDocument.xml" in z.namelist()
    colors = rules.fcstd_colors(str(path)) if gui else {}
    return [o["label"] for n, o in objs.items() if rules.je_dle_dokumentace(o["props"]) and o["type"] == "Part::Feature"
            and not rules.je_zluta(colors.get(n))]


def check_stav(model: Path) -> dict:
    t = time.time()
    res = {"chyby": [], "varovani": [], "info": [], "data": {}}
    with zipfile.ZipFile(model) as z:
        objs = _doc_objects(z)
        has_gui = "GuiDocument.xml" in z.namelist()
    colors = rules.fcstd_colors(str(model))
    if not has_gui:
        n = sum(1 for o in objs.values() if rules.je_zastupny(o["props"]))
        nd = sum(1 for o in objs.values() if rules.je_dle_dokumentace(o["props"]) and o["type"] == "Part::Feature")
        res["varovani"].append({"kod": "stav-gui", "text": f"model uložen bez GUI (chybí GuiDocument.xml) — barvy {n} zástupných "
                                f"a {nd} dílů dle dokumentace nelze ověřit; ulož model z GUI instance"})
        res["data"] = {"objektu": len(objs), "zastupnych": n, "barev": 0}
        res["secs"] = round(time.time() - t, 1)
        return res

    def color_of(name, depth=0):
        o = objs.get(name) or {}
        if name in colors and not (o.get("link") and depth < 5 and o["type"].startswith("App::Link")):
            return colors[name]
        lk = o.get("link")
        if lk and not lk["ext"] and lk["name"] in objs and depth < 5:
            return color_of(lk["name"], depth + 1) if lk["name"] not in colors else colors[lk["name"]]
        return colors.get(name)

    n_ph = n_or = n_dd = n_ye = 0
    overrides = rules.fcstd_overrides(str(model))
    ext_cache: dict = {}
    for name, o in objs.items():
        lk = o.get("link") or {}
        if lk.get("ext") and o["type"].startswith("App::Link"):          # odkaz na jiný dokument (díl dle dokumentace?)
            f = (model.parent / lk["ext"]).resolve()
            if f not in ext_cache:
                try:
                    with zipfile.ZipFile(f) as z:
                        dd = any(rules.je_dle_dokumentace(x["props"]) for x in _doc_objects(z).values())
                    ext_cache[f] = _ext_dle_dokumentace(f) if dd else None
                except (OSError, zipfile.BadZipFile, KeyError):
                    ext_cache[f] = None
            bad = ext_cache[f]
            if bad is not None:
                n_dd += 1
                if bad:
                    res["chyby"].append({"kod": "stav-barva", "text": f"{o['label']}: díl dle dokumentace ({f.name}) není žlutý "
                                         f"255,215,0 ({', '.join(bad[:3])}) — vygeneruj díly znovu (barvy ukládá GUI)",
                                         "objekty": [name]})
                if name in overrides and not rules.je_zluta(overrides[name]):
                    res["chyby"].append({"kod": "stav-barva", "text": f"{o['label']}: odkaz na díl dle dokumentace přebarvuje "
                                         f"cíl na {overrides[name]} — díly dle dokumentace nepřebarvovat (žlutá)",
                                         "objekty": [name]})
        ph = rules.je_zastupny(o["props"])
        dd = rules.je_dle_dokumentace(o["props"]) and not ph
        if not (ph or dd or name in colors):
            continue
        if o["type"] in ("App::Origin", "App::Line", "App::Plane", "App::Point"):
            continue
        rgb = color_of(name)
        orange = rules.je_oranzova(rgb)
        if dd:
            if o["type"] == "App::Part":
                continue
            n_dd += 1
            if rgb is None and lk.get("ext"):
                continue
            if not rules.je_zluta(rgb):
                res["chyby"].append({"kod": "stav-barva", "text": f"{o['label']}: díl dle dokumentace, barva {rgb} místo 255,215,0",
                                     "objekty": [name]})
            continue
        if rules.je_zluta(rgb) and o["type"] != "App::Part" and not lk:
            n_ye += 1
            res["varovani"].append({"kod": "stav-vlastnost", "text": f"{o['label']}: žlutý, ale bez Konstrukce_ModelStav = "
                                    "„dle dokumentace“ (žlutá patří jen dílům z generátorů)", "objekty": [name]})
        if ph:
            n_ph += 1
            if rgb is None and (o.get("link") or {}).get("ext"):
                res["info"].append({"kod": "stav-barva", "text": f"{o['label']}: zástupný, barva v jiném dokumentu (neověřeno)"})
            elif not orange:
                if o["type"] == "App::Part":
                    continue
                res["chyby"].append({"kod": "stav-barva", "text": f"{o['label']}: zástupný díl, barva {rgb} místo 255,140,0",
                                     "objekty": [name]})
            if "zástupn" not in o["label"].lower() and "zastupn" not in rules.fold(o["label"]) and \
                    "placeholder" not in o["label"].lower():
                res["info"].append({"kod": "stav-jmeno", "text": f"{o['label']}: zástupný — jméno to neříká"})
        elif orange and o["type"] not in ("App::Part",):
            n_or += 1
            res["varovani"].append({"kod": "stav-vlastnost", "text": f"{o['label']}: oranžový, ale bez vlastnosti zástupného "
                                    "dílu (PLCdesk_ModelStatus = placeholder / Placeholder = True)", "objekty": [name]})
    if len([x for x in res["info"] if x["kod"] == "stav-jmeno"]) > 10:
        n = len([x for x in res["info"] if x["kod"] == "stav-jmeno"])
        res["info"] = [x for x in res["info"] if x["kod"] != "stav-jmeno"] + [
            {"kod": "stav-jmeno", "text": f"{n} zástupných dílů nemá v popisku „zástupný“"}]
    res["data"] = {"objektu": len(objs), "zastupnych": n_ph, "oranzovych_bez_vlastnosti": n_or, "dle_dokumentace": n_dd,
                   "zlutych_bez_vlastnosti": n_ye, "barev": len(colors)}
    res["secs"] = round(time.time() - t, 1)
    return res


# --- otvory: vyhodnocení cest -------------------------------------------------------------------------------------------

def eval_paths(vox: dict, tes_info: dict) -> dict:
    res = {"chyby": [], "varovani": [], "info": [], "data": {"mrizky": [], "zony": tes_info.get("zony") or []}}
    if not tes_info.get("zon"):
        res["info"].append({"kod": "otvory-zony", "text": "model nemá nebezpečné zóny (Zona_* / Konstrukce_Zona / skupina Zóny) "
                            "— dosažitelnost nevyhodnocena"})
        return res
    found = []
    for g in vox.get("grids") or []:
        res["data"]["mrizky"].append({k: g.get(k) for k in ("vox", "grid", "cropped", "reach", "lokalni", "secs", "skipped")} |
                                     {"cest": len(g.get("paths") or [])})
        if g.get("skipped"):
            res["varovani"].append({"kod": "otvory-mrizka", "text": f"mřížka {g['vox']} mm vynechána: {g['skipped']}"})
        if g.get("cropped"):
            res["info"].append({"kod": "otvory-oblast", "text": f"mřížka {g['vox']} mm: oblast oříznuta na zóny "
                                f"± {g.get('reach', 1000):.0f} mm" + (" (místní — jen malé otvory)" if g.get("lokalni") else "")})
        for p in g.get("paths") or []:
            if g.get("lokalni") and p.get("e_mer", p["e"]) > 12.0:
                continue                 # velké otvory hodnotí mřížka celé oblasti (okraj místní může být uvnitř stroje)
            pk = p.get("bod_mer") or p["nejuzsi"]
            dup = next((q for q in found if rules.dist(q.get("bod_mer") or q["nejuzsi"], pk)
                        < max(30.0, 2 * p.get("e_mer", p["e"]))), None)
            if dup is not None:
                if p["vox"] < dup["vox"]:
                    found[found.index(dup)] = p
                continue
            found.append(p)
    for p in found:
        if p.get("e_mer") is not None and p.get("sr_mer") is not None:      # změřeno v modelu (přesné)
            ev = rules.posud_otvor(p["e_mer"], p["sr_mer"], p.get("sr_draha_mer"), 0.0, p.get("tvar") or "sterbina",
                                   p.get("delka_mer"))
            how = "změřeno v modelu, " + {"ctverec": "čtverec", "sterbina": "štěrbina"}.get(p.get("tvar"), "štěrbina")
            if p.get("delka_mer") is not None:
                how += f" {p['e_mer']:.0f} × {p['delka_mer']:.0f} mm"
            pos = p.get("bod_mer") or p["nejuzsi"]
            if p["e_mer"] > p["e"] + 3 * p["vox"] + 5:
                how += f"; mřížka ukazuje užší místo e ≈ {p['e']:.0f} mm u {p['nejuzsi']} — ověřit měřením"
        else:                                                               # jen odhad z mřížky (konzervativně)
            ev = rules.posud_otvor(p["e"], p["sr_primka"], p.get("sr_draha"), p["vox"])
            how, pos = "odhad z mřížky", p["nejuzsi"]
        p["posudek"] = ev
        rec = {"kod": "otvor", "text": ev["text"] + f" ({how}, mřížka {p['vox']:g} mm; vstup {p['vstup']})", "poloha": pos,
               "e": p.get("e_mer", p["e"]), "sr": p.get("sr_mer", p["sr_primka"]), "sr_pozad": ev["sr_pozad"]}
        {"chyba": res["chyby"], "varovani": res["varovani"]}.get(ev["uroven"], res["info"]).append(rec)
    res["data"]["cesty"] = found
    res["data"]["zdroj_tabulky"] = rules.ISO13857_SRC
    if not found:
        res["info"].append({"kod": "otvory", "text": "žádná cesta zvenku k nebezpečné zóně (mřížky "
                            + ", ".join(f"{g.get('vox'):g}" for g in vox.get("grids") or []) + " mm)"})
    return res


# --- hlavní běh ---------------------------------------------------------------------------------------------------------

def run_checks(model: str | Path, checks=ALL, *, out: str | Path | None = None, manifest: str | None = None,
               slot: str = DEFAULT_SLOT, timeout: int = 3600, grids=(5.0, 4.0, 3.0), podlaha: float | None = None,
               fc_runner=None, keep: bool = False, otvory_varovani: bool = False) -> dict:
    """``otvory_varovani`` = nálezy kontroly ``otvory`` jen jako varování (zkušební deska modulu bez krytů — ISO 13857
    řeší rám / kryty stroje, ne modul; ``pro3d_lib.bench``)."""
    model = Path(model).resolve()
    outd = Path(out).resolve() if out else model.parent
    work = outd / WORK
    work.mkdir(parents=True, exist_ok=True)
    rep = {"tool": "pro3d_tools", "version": 1, "model": str(model), "model_name": model.name, "sha256": sha256(model),
           "created": _dt.datetime.now().isoformat(timespec="seconds"), "checks": {}}
    checks = [c for c in ALL if c in checks]
    need_fc = [c for c in checks if c in FC_CHECKS]
    scan = {}
    if need_fc:
        stem = re.sub(r"[^\w.-]", "_", model.stem)
        opts = {"checks": need_fc, "tes": str(work / f"{stem}_tes.npz"), "step": str(work / f"{stem}_kontrola.step"),
                "podlaha": podlaha, "grids": [float(g) for g in grids]}
        optf = work / f"{stem}_opts.json"
        optf.write_text(json.dumps(opts, ensure_ascii=False), encoding="utf-8")
        outf = work / f"{stem}_scan.json"
        outf.unlink(missing_ok=True)
        t = time.time()
        summ = (fc_runner or fc_run)(HERE / "fc_scan.py", [model, outf, optf], slot, timeout)
        try:
            scan = json.loads(outf.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            scan = {}
        rep["freecad"] = {"ok": bool(summ.get("ok")), "secs": round(time.time() - t, 1), "pruchod": scan.get("pruchod"),
                          "error": None if summ.get("ok") else str(summ.get("error") or "")[-800:]}
        for c in need_fc:
            r = (scan.get("checks") or {}).get(c)
            if r is None:
                rep["checks"][c] = {"selhalo": "nedoběhlo: " + str(summ.get("error") or "FreeCAD skončil dřív")[-600:],
                                    "chyby": [], "varovani": []}
            elif r.get("selhalo"):
                rep["checks"][c] = {"selhalo": r["selhalo"], "chyby": [], "varovani": []}
            elif c == "kusovnik":
                mp = find_manifest(model, manifest)
                man = json.loads(mp.read_text(encoding="utf-8")) if mp else None
                k = rules.kusovnik(r.get("objekty") or [], man)
                k["data"]["manifest"] = str(mp) if mp else None
                rep["checks"][c] = k
            elif c == "otvory":
                try:
                    e = eval_paths(r, r)
                except Exception as exc:  # noqa: BLE001 — chyba vyhodnocení = kontrola selhala, ostatní zůstanou
                    e = {"selhalo": f"vyhodnocení otvorů: {type(exc).__name__}: {exc}", "chyby": [], "varovani": []}
                e["secs"] = r.get("secs", 0)
                if otvory_varovani and e.get("chyby"):
                    e["varovani"] = [dict(f, text=f["text"] + " [zkušební deska modulu bez krytů — jen varování]")
                                     for f in e["chyby"]] + list(e.get("varovani") or [])
                    e["chyby"] = []
                    e.setdefault("data", {})["jen_varovani"] = True
                rep["checks"][c] = e
            else:
                rep["checks"][c] = r
        if not keep:
            for k in ("step", "tes"):
                for p in work.glob(Path(opts[k]).name + "*"):
                    p.unlink(missing_ok=True)
    if "stav" in checks:
        try:
            rep["checks"]["stav"] = check_stav(model)
        except Exception as exc:  # noqa: BLE001
            rep["checks"]["stav"] = {"selhalo": f"{type(exc).__name__}: {exc}", "chyby": [], "varovani": []}
    rep["checks"] = {k: rep["checks"][k] for k in ALL if k in rep["checks"]}
    nch = sum(len(c.get("chyby") or []) for c in rep["checks"].values())
    nva = sum(len(c.get("varovani") or []) for c in rep["checks"].values())
    failed = [k for k, c in rep["checks"].items() if c.get("selhalo")]
    rep["souhrn"] = {"chyby": nch + len(failed), "varovani": nva, "selhalo": failed,
                     "stav": "SELHALO" if failed else ("CHYBY" if nch else "OK")}
    if sha256(model) != rep["sha256"]:
        rep["souhrn"]["stav"] = "SELHALO"
        rep["souhrn"]["selhalo"].append("model se během kontroly změnil")
    outd.mkdir(parents=True, exist_ok=True)
    (outd / "kontroly.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    (outd / "KONTROLY.md").write_text(rules.summarize(rep), encoding="utf-8")
    return rep


def shots(model: str | Path, out: str | Path, *, slot: str = DEFAULT_SLOT, prefix: str = "snimek", detail=(),
          runner=subprocess.run, max_min: int = 20) -> dict:
    """Standardní snímky v GUI instanci (gui-start → gui-run fc_shots.py → gui-stop)."""
    rf = run_fc_path()
    if rf is None:
        return {"ok": False, "error": "run_fc.ps1 nenalezen"}
    out = Path(out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    optf = out / f".{prefix}_snimky.json"
    optf.write_text(json.dumps({"prefix": prefix, "detail": list(detail)}, ensure_ascii=False), encoding="utf-8")
    kw = dict(capture_output=True, text=True, encoding="utf-8", errors="replace", creationflags=NOWIN)
    st = runner(_ps(rf) + ["gui-start", "--slot", slot, "--max-min", str(max_min)], **kw)
    r = None
    res: dict = {}
    try:
        r = runner(_ps(rf) + ["gui-run", "--slot", slot, "--timeout", "600", str(HERE / "fc_shots.py"), str(Path(model).resolve()),
                              str(out), str(optf)], **kw)
        res = _last_json(r.stdout)
    finally:
        runner(_ps(rf) + ["gui-stop", "--slot", slot], **kw)
        optf.unlink(missing_ok=True)
    res.setdefault("ok", False)
    if not res.get("ok"):
        res["error"] = res.get("error") or ((st.stdout or "") + ((r.stdout or "") if r is not None else ""))[-800:]
    return res


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="pro3d_tools", description="PLCdesk PRO — kontroly 3D modelu (FreeCAD, vlastní instance)")
    ap.add_argument("kontrola", choices=ALL + ("vse", "snimky"))
    ap.add_argument("model")
    ap.add_argument("--out", help="složka pro kontroly.json / KONTROLY.md / snímky (výchozí složka modelu)")
    ap.add_argument("--manifest")
    ap.add_argument("--slot", default=os.environ.get("PRO3D_SLOT") or DEFAULT_SLOT)
    ap.add_argument("--timeout", type=int, default=3600)
    ap.add_argument("--grids", default="5,4,3")
    ap.add_argument("--podlaha", type=float)
    ap.add_argument("--detail", default="", help="snímky: díly k výřezu oddělené ;")
    ap.add_argument("--prefix", default="snimek")
    ap.add_argument("--keep", action="store_true", help="ponechat pracovní soubory (.kontroly/)")
    ap.add_argument("--otvory-varovani", action="store_true",
                    help="nálezy otvorů ISO 13857 jen jako varování (zkušební deska modulu bez krytů)")
    a = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    if not Path(a.model).is_file():
        print(f"Model {a.model} nenalezen.", file=sys.stderr)
        return 2
    if a.kontrola == "snimky":
        res = shots(a.model, a.out or Path(a.model).resolve().parent / "snimky", slot=a.slot, prefix=a.prefix,
                    detail=[x.strip() for x in a.detail.split(";") if x.strip()])
        print(json.dumps(res, ensure_ascii=False))
        return 0 if res.get("ok") else 2
    checks = ALL if a.kontrola == "vse" else (a.kontrola,)
    rep = run_checks(a.model, checks, out=a.out, manifest=a.manifest, slot=a.slot, timeout=a.timeout,
                     grids=[float(x) for x in a.grids.split(",") if x.strip()], podlaha=a.podlaha, keep=a.keep,
                     otvory_varovani=a.otvory_varovani)
    print(rules.summarize(rep))
    return {"OK": 0, "CHYBY": 1}.get(rep["souhrn"]["stav"], 2)


if __name__ == "__main__":
    sys.exit(main())
