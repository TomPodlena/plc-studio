#!/usr/bin/env python3
"""Snímky aplikace PLCdesk na web — skutečná aplikace, žádné kreslené maketky.

1. Desktop (apps/desktop, tkinter): pro každý jazyk se spustí VLASTNÍ proces s aplikací
   (dočasný PLCSTUDIO_HOME, jazyk a velikost okna v settings.json), otevře ukázkovou linku
   LL-03 (``sampleComplex`` jádra — v jazyce okna), část položek schválí smyšlenou osobou
   jako ukázková dokumentace na webu, projde kroky a každý nasnímá přes PrintWindow
   (jen okno aplikace, ne obrazovka — nevadí zamčená stanice ani okna přes něj).
   Okno se zavře jen to, které skript sám otevřel (vlastní proces).
2. Webová aplikace (apps/web): ``node scripts/app-shots-web.js`` — headless Edge.
3. Zpracování: ořez na obsah, WebP ve dvou šířkách → assets/img/app/<krok>-<jazyk>[-800].webp

Spuštění z apps/site (Python 3.11 s Pillow, Node 22+, Edge):
    python scripts/app-shots.py                 # vše (cs, en, de)
    python scripts/app-shots.py --lang en       # jen jeden jazyk
    python scripts/app-shots.py --only ziva,schvaleni
    python scripts/app-shots.py --no-web        # bez webové aplikace
    python scripts/app-shots.py --encode-only   # jen znovu převést uložené PNG
Pracovní složka (PNG, PLCSTUDIO_HOME): --work SLOŽKA, výchozí %TEMP%/plcdesk-app-shots.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent            # apps/site
REPO = ROOT.parent.parent
DESKTOP = REPO / "apps" / "desktop"
OUT = ROOT / "assets" / "img" / "app"
LANGS = ["cs", "en", "de"]
CONTENT = {l: json.loads((ROOT / "content" / f"{l}.json").read_text(encoding="utf-8")) for l in LANGS}
WIN_W, WIN_H = 1440, 900
SIZES = (1440, 800)          # nativní šířka okna (bez zvětšování) + menší pro mobil / srcset
QUALITY = 80

# klíč snímku → ořez (vlevo, nahoře, vpravo, dole) v px klientské plochy okna 1440×900
CROP = {
    "web-schema": (150, 0, 1290, 900),     # webová aplikace: bez prázdných okrajů stránky
}
DESKTOP_SHOTS = ["navrh", "zarizeni", "schema", "diagram", "ziva", "bezpecnost",
                 "schvaleni", "kusovnik", "generovat", "dokumentace", "ozivovani", "import"]
WEB_SHOTS = ["web-schema"]
IMPORT_FILE = "taveren_packaging_sfc.plc.xml"
ANIM = "ziva-anim"           # animace živé simulace (MP4 přes ffmpeg + plakát WebP)
ANIM_ROWS = (0, 1012)        # řádky schématu (px plátna) v animaci: snímače, PLC, motory, válce Y1–Y5


# ------------------------------------------------------------------ PrintWindow
def grab_client(hwnd: int, path: Path) -> None:
    """Klientská plocha okna (bez rámečku a titulku Windows) přes PrintWindow."""
    import ctypes
    from ctypes import wintypes

    from PIL import Image
    user32, gdi32 = ctypes.windll.user32, ctypes.windll.gdi32
    vp = ctypes.c_void_p
    for f, a, r in [(user32.GetDC, [vp], vp), (gdi32.CreateCompatibleDC, [vp], vp),
                    (gdi32.CreateCompatibleBitmap, [vp, ctypes.c_int, ctypes.c_int], vp),
                    (gdi32.SelectObject, [vp, vp], vp),
                    (user32.PrintWindow, [vp, vp, wintypes.UINT], wintypes.BOOL),
                    (user32.ReleaseDC, [vp, vp], ctypes.c_int), (gdi32.DeleteDC, [vp], wintypes.BOOL),
                    (gdi32.DeleteObject, [vp], wintypes.BOOL),
                    (user32.GetClientRect, [vp, ctypes.POINTER(wintypes.RECT)], wintypes.BOOL),
                    (gdi32.GetDIBits, [vp, vp, wintypes.UINT, wintypes.UINT, vp, vp, wintypes.UINT],
                     ctypes.c_int)]:
        f.argtypes, f.restype = a, r

    class BIH(ctypes.Structure):
        _fields_ = [("biSize", wintypes.DWORD), ("biWidth", wintypes.LONG), ("biHeight", wintypes.LONG),
                    ("biPlanes", wintypes.WORD), ("biBitCount", wintypes.WORD),
                    ("biCompression", wintypes.DWORD), ("biSizeImage", wintypes.DWORD),
                    ("a", wintypes.LONG), ("b", wintypes.LONG), ("c", wintypes.DWORD), ("d", wintypes.DWORD)]

    rect = wintypes.RECT()
    user32.GetClientRect(hwnd, ctypes.byref(rect))
    w, h = rect.right, rect.bottom
    wdc = user32.GetDC(hwnd)
    mdc = gdi32.CreateCompatibleDC(wdc)
    bmp = gdi32.CreateCompatibleBitmap(wdc, w, h)
    old = gdi32.SelectObject(mdc, bmp)
    try:
        user32.PrintWindow(hwnd, mdc, 3)            # PW_CLIENTONLY | PW_RENDERFULLCONTENT
        gdi32.SelectObject(mdc, old)
        hdr = BIH(ctypes.sizeof(BIH), w, -h, 1, 32, 0)
        buf = ctypes.create_string_buffer(w * h * 4)
        gdi32.GetDIBits(mdc, bmp, 0, h, buf, ctypes.byref(hdr), 0)
        Image.frombuffer("RGB", (w, h), buf, "raw", "BGRX", 0, 1).save(path)
    finally:
        gdi32.DeleteObject(bmp)
        gdi32.DeleteDC(mdc)
        user32.ReleaseDC(hwnd, wdc)


# ------------------------------------------------------------------ jeden jazyk (podproces)
def child(lang: str, raw: Path, only: set[str]) -> int:
    sys.path.insert(0, str(DESKTOP))
    import tkinter as tk
    from tkinter import ttk

    from plc_studio import theme
    from plc_studio.app import App
    from plc_studio.i18n import _

    theme.set_app_id()
    root = tk.Tk()
    app = App(root)
    app.load_sample("complex")                    # ukázková linka LL-03 v jazyce okna
    root.geometry(f"{WIN_W}x{WIN_H}+0+0")
    root.update()
    hwnd = lambda w: int(w.winfo_id())             # tk okno = klientská plocha (frame má rodiče)
    import ctypes
    ctypes.windll.user32.GetParent.restype = ctypes.c_void_p
    ctypes.windll.user32.GetParent.argtypes = [ctypes.c_void_p]

    def pump(sec: float) -> None:
        end = time.time() + sec
        while time.time() < end:
            root.update()
            time.sleep(0.02)

    def shot(key: str, win=None) -> None:
        pump(0.6)
        w = win or root
        h = ctypes.windll.user32.GetParent(int(w.winfo_id())) or int(w.winfo_id())
        grab_client(h, raw / f"{key}-{lang}.png")
        print(f"  {key}-{lang}.png", flush=True)

    def find(widget, text: str):
        for c in widget.winfo_children():
            try:
                if c.cget("text") == text and c.winfo_ismapped():
                    return c
            except tk.TclError:
                pass
            r = find(c, text)
            if r is not None:
                return r
        return None

    def trees(widget):
        for c in widget.winfo_children():
            if isinstance(c, ttk.Treeview):
                yield c
            yield from trees(c)

    def select_row(widget, iid: str) -> None:
        """Vybere řádek tabulky jako klik uživatele (panel detailu se naplní)."""
        for tv in trees(widget):
            if tv.winfo_ismapped() and tv.exists(iid):
                tv.selection_set(iid)
                tv.focus(iid)
                tv.see(iid)
                tv.event_generate("<<TreeviewSelect>>")
                return
        print(f"  (řádek {iid} nenalezen)")

    want = lambda k: not only or k in only
    prj = app.prj
    dev = {d["name"]: d["id"] for d in prj["devices"]}

    # --- schválení jako v ukázkové dokumentaci webu (scripts/ukazka-pdf.js: sampleProject)
    import re
    t = CONTENT[lang]["pdf"]
    app.settings["approver"] = t["approver"]
    items = app.bridge.request("approval", prj=app.prj)["items"]
    app.prj = app.bridge.request("approval", prj=app.prj)["prj"]

    def approve_key(k: str) -> bool:
        return (k.startswith("dev:") or k in ("io", "seq", "interlocks", "limits", "verify", "safety:hazards")
                or re.match(r"^safety:SF[1-4](:design)?$", k) is not None)
    for it in items:
        if approve_key(it["key"]) and it.get("ready") is not False:
            app.prj = app.bridge.mutate("approve", app.prj, it["key"], t["approver"], t["approver_note"])
    # změna po schválení: delší hlídací čas jednoho kroku → sekvence znovu ke schválení
    for s in app.prj["program"]["seq"]:
        if (s.get("timeS") or 0) > 0:
            s["timeS"] += 2
            break
    # pro krok Generovat víc platforem (uživatel je volí v kroku Platformy)
    app.prj["platforms"] = ["siemens", "rockwell", "beckhoff", "codesys", "mitsubishi", "omron"]
    app.save()

    if want("navrh"):
        app.goto(1)                                # předvyplněná konverzace ukázky (bez volání AI)
        shot("navrh")
    if want("zarizeni"):
        app.ui["dev_sel"] = dev["Y1"]
        app.goto(3)
        shot("zarizeni")
    if want("schema"):
        app.ui.update(schema_tab=0, block_sel=dev["Y1"])
        app.goto(5)
        shot("schema")
    if want("diagram"):
        app.ui.update(schema_tab=1, flow_sel=8)
        app.goto(5)
        shot("diagram")
    if want("bezpecnost"):
        app.ui["safety"] = {"tab": 0}
        app.goto(10)
        shot("bezpecnost")
    if want("schvaleni"):
        app.ui["appr"] = {"closed": {"design": True}}     # zařízení sbalená → vidět i další skupiny
        app.goto(11)
        pump(0.3)
        select_row(root, "seq")                           # změněno po schválení
        shot("schvaleni")
    if want("kusovnik"):
        app.goto(9)
        pump(0.3)
        for tv in trees(root):
            kids = tv.get_children()
            if tv.winfo_ismapped() and len(kids) > 6:
                select_row(root, kids[6])                 # první motor: díly zařízení
                break
        shot("kusovnik")
    if want("generovat"):
        app.ui.update(gen_plat="siemens", gen_file="Gen_Main.scl")
        app.goto(7)
        shot("generovat")
    if want("dokumentace"):
        app.ui["doc_sel"] = 1
        app.goto(8)
        shot("dokumentace")
    if want("ozivovani"):
        # rozpracované oživení: rozvaděč a část smyčkového testu odškrtnuté
        plan = app.bridge.request("commission", prj=app.prj)["plan"]
        for st in plan[:16]:
            app.prj = app.bridge.mutate("setCommissionResult", app.prj, st["id"], "ok", t["approver"], {})
        app.goto(12)
        pump(0.3)
        select_row(root, plan[16]["id"])
        shot("ozivovani")
    if want("ziva"):
        app.ui.update(prog_tab=1, live_view=0, live_sel=dev["Y1"], live_speed="2×")
        app.goto(6)
        pump(0.8)
        b = find(root, _("▶ START cyklu"))
        if b is None:
            raise SystemExit("tlačítko START nenalezeno")
        b.invoke()
        pump(float(os.environ.get("SHOT_LIVE_S", "9")))
        shot("ziva")
        app.ui["prog_tab"] = 0
        app.goto(3)                                # zastaví smyčku živé simulace
    if want("import"):
        from plc_studio.importer import open_wizard
        app.ui.pop("import", None)
        wiz = open_wizard(app)
        wiz.win.geometry(f"{WIN_W}x{WIN_H}+0+0")
        # veřejný projekt z GitHubu (PLCopen XML se SFC, licence BSD-2, viz test-data/real/README.md):
        # cizí export dá i odhady a chybějící údaje — jistota je pak vidět barevně
        src = REPO / "packages" / "core" / "test-data" / "real" / IMPORT_FILE
        wiz.add_inputs([{"name": src.name, "text": src.read_text(encoding="utf-8")}])
        wiz.extract()
        wiz.goto(3)
        pump(0.5)
        for tv in trees(wiz.win):
            rows = [i for i in tv.get_children() if "guess" in " ".join(map(str, tv.item(i, "tags")))]
            if tv.winfo_ismapped() and tv.get_children():
                pick = (rows or tv.get_children())[0]
                tv.selection_set(pick); tv.focus(pick); tv.event_generate("<<TreeviewSelect>>")
                break
        shot("import", wiz.win)
        wiz.close()
    if want(ANIM):
        anim(app, root, find, pump, lang, raw)
    pump(0.2)
    errors = list(app.errors)
    app.close()
    for e in errors:
        print(e, file=sys.stderr)
    return 1 if errors else 0


def anim(app, root, find, pump, lang: str, raw: Path) -> None:
    """Snímky jednoho celého cyklu živé simulace (čas se krokuje tlačítkem +0,1 s, takže
    každý snímek = 0,1 s simulace bez ohledu na rychlost stanice), ořez na schéma systému."""
    import tkinter as tk
    from plc_studio.i18n import _
    out = raw / f"{ANIM}-{lang}"
    out.mkdir(parents=True, exist_ok=True)
    for f in out.glob("*.png"):
        f.unlink()
    app.ui.update(prog_tab=1, live_view=0, live_sel=None, live_speed="1×")
    app.goto(6)
    pump(1.0)
    find(root, _("⏸ Zastavit čas")).invoke()
    step = find(root, _("+0,1 s"))
    start = find(root, _("▶ START cyklu"))

    def canvases(w):
        for c in w.winfo_children():
            if isinstance(c, tk.Canvas) and c.winfo_ismapped():
                yield c
            yield from canvases(c)
    cv = max(canvases(root), key=lambda c: c.winfo_width() * c.winfo_height())
    pump(0.3)
    x0, y0 = cv.winfo_rootx() - root.winfo_rootx(), cv.winfo_rooty() - root.winfo_rooty()
    vw, vh = cv.winfo_width() - 2, cv.winfo_height() - 2
    sr = [float(v) for v in str(cv.cget("scrollregion")).split()]
    if not sr:
        sr = [0.0, 0.0, float(vw), float(vh)]
    total = int(sr[3])
    print(f"  plátno {vw}x{vh}, scrollregion {sr}", flush=True)
    cy0, cy1 = ANIM_ROWS if ANIM_ROWS else (0, total)
    cy1 = min(cy1, total)
    import ctypes
    hwnd = ctypes.windll.user32.GetParent(int(root.winfo_id()))
    from PIL import Image
    n = 0

    def frame() -> None:
        """Okno je nižší než schéma: plátno se posune a pruhy se slepí (obsah plátna
        posun nemění, jen pohled), výsledek = řádky cy0..cy1 schématu."""
        nonlocal n
        img = Image.new("RGB", (vw, cy1 - cy0), "white")
        tmp = out / "_full.png"
        off, last = cy0, None
        while off < cy1:
            cv.yview_moveto((off - sr[1]) / (sr[3] - sr[1]))
            root.update()
            top = round(cv.canvasy(0))
            if top == last:                        # dál už plátno nejede
                break
            last = top
            grab_client(hwnd, tmp)
            # okraj pruhu (3 px) vynechat a pruhy překrýt — jinak je na švu světlá linka
            m = 0 if top <= cy0 else 3
            band = Image.open(tmp).crop((x0 + 1, y0 + 1 + m, x0 + 1 + vw, y0 + 1 + vh - 3))
            img.paste(band, (0, top + m - cy0))
            off = top + vh - 6
        img.save(out / f"f{n:04d}.png")
        n += 1
    idle = _("Klid — čeká na START")
    if os.environ.get("ANIM_PROBE"):              # jen jeden snímek celého schématu
        start.invoke()
        for _i in range(int(os.environ["ANIM_PROBE"])):
            step.invoke()
        frame()
        return
    for _i in range(6):                            # klid před startem
        step.invoke()
        frame()
    start.invoke()
    running = 0
    while n < 2000:
        step.invoke()
        frame()
        running += 1
        if running > 20 and find(root, idle) is not None:
            break
    for _i in range(5):                            # klid po cyklu = plynulá smyčka
        step.invoke()
        frame()
    (out / "_full.png").unlink()
    (out / "info.json").write_text(json.dumps({"rows": [cy0, cy1], "total": total, "frames": n}), encoding="utf-8")
    print(f"  {ANIM}-{lang}: {n} snimku, radky schematu {cy0}-{cy1} z {total}", flush=True)
    app.ui["prog_tab"] = 0
    app.goto(3)


# ------------------------------------------------------------------ zpracování
def encode(raw: Path, keys: list[str], langs: list[str]) -> None:
    from PIL import Image
    OUT.mkdir(parents=True, exist_ok=True)
    known = set(DESKTOP_SHOTS + WEB_SHOTS + [ANIM])
    for f in OUT.glob("*.webp"):                  # snímky kroků, které už skript nedělá
        if f.name.rsplit("-", 2 if f.stem.endswith("-800") else 1)[0] not in known:
            f.unlink()
            print(f"  smazáno (už se nepoužívá): {f.name}")
    for key in keys:
        for lang in langs:
            src = raw / f"{key}-{lang}.png"
            if not src.exists():
                continue
            im = Image.open(src).convert("RGB")
            box = CROP.get(key)
            if box:
                im = im.crop(box)
            for w in SIZES:
                img = im if im.width <= w else im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
                name = f"{key}-{lang}.webp" if w == SIZES[0] else f"{key}-{lang}-{w}.webp"
                img.save(OUT / name, "WEBP", quality=QUALITY, method=6)
                kb = (OUT / name).stat().st_size / 1024
                print(f"  assets/img/app/{name}  {img.width}x{img.height}  {kb:.0f} kB"
                      + ("  POZOR > 150 kB" if kb > 150 else ""))


def encode_anim(raw: Path, langs: list[str]) -> None:
    """Animace živé simulace: MP4 (H.264, 20 snímků/s = 2× rychleji než simulace, smyčka
    klid → cyklus → klid) a plakát WebP ze snímku uprostřed cyklu. Vyžaduje ffmpeg
    (proměnná FFMPEG nebo ffmpeg v PATH)."""
    import shutil
    from PIL import Image
    ff = os.environ.get("FFMPEG") or shutil.which("ffmpeg")
    for lang in langs:
        src = raw / f"{ANIM}-{lang}"
        frames = sorted(src.glob("f*.png")) if src.exists() else []
        if not frames:
            continue
        if not ff:
            print("  POZOR: ffmpeg nenalezen (FFMPEG=...), animace se nepřevedla")
            return
        mp4 = OUT / f"{ANIM}-{lang}.mp4"
        subprocess.run([ff, "-hide_banner", "-loglevel", "error", "-y", "-framerate", "20",
                        "-i", str(src / "f%04d.png"), "-c:v", "libx264", "-preset", "veryslow",
                        "-crf", "20", "-tune", "animation", "-pix_fmt", "yuv420p",
                        "-movflags", "+faststart", "-an", str(mp4)], check=True)
        poster = OUT / f"{ANIM}-{lang}.webp"
        Image.open(frames[len(frames) // 2]).convert("RGB").save(poster, "WEBP", quality=QUALITY, method=6)
        w, h = Image.open(frames[0]).size
        print(f"  assets/img/app/{mp4.name}  {w}x{h}, {len(frames)} snimku  {mp4.stat().st_size / 1024:.0f} kB")
        print(f"  assets/img/app/{poster.name}  {poster.stat().st_size / 1024:.0f} kB")


def main() -> int:
    for stream in (sys.stdout, sys.stderr):          # čeština i v rouře (log, terminál)
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lang", default=",".join(LANGS))
    ap.add_argument("--only", default="")
    ap.add_argument("--work", default=str(Path(tempfile.gettempdir()) / "plcdesk-app-shots"))
    ap.add_argument("--no-web", action="store_true")
    ap.add_argument("--encode-only", action="store_true")
    ap.add_argument("--child", help=argparse.SUPPRESS)
    a = ap.parse_args()
    work = Path(a.work)
    raw = work / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    only = {x for x in a.only.split(",") if x}
    langs = [x for x in a.lang.split(",") if x]

    if a.child:
        return child(a.child, raw, only)

    if not a.encode_only:
        for lang in langs:
            if only and not (only & set(DESKTOP_SHOTS + [ANIM])):
                break
            home = work / f"home-{lang}"
            home.mkdir(parents=True, exist_ok=True)
            for f in home.glob("*.json"):
                f.unlink()                       # čistý start: žádný rozpracovaný návrh
            (home / "settings.json").write_text(json.dumps(
                {"lang": lang, "geometry": f"{WIN_W}x{WIN_H}+0+0"}), encoding="utf-8")
            env = dict(os.environ, PLCSTUDIO_HOME=str(home), TEMP=str(work), TMP=str(work))
            print(f"desktop {lang}:", flush=True)
            r = subprocess.run([sys.executable, __file__, "--child", lang, "--work", str(work),
                                "--only", a.only], cwd=str(DESKTOP), env=env)
            if r.returncode:
                print(f"  CHYBA: proces aplikace skončil kódem {r.returncode}")
                return r.returncode
        if not a.no_web and (not only or only & set(WEB_SHOTS)):
            print("webová aplikace:", flush=True)
            r = subprocess.run(["node", str(ROOT / "scripts" / "app-shots-web.js"), str(raw), *langs])
            if r.returncode:
                return r.returncode
    print("WebP:")
    encode(raw, [k for k in DESKTOP_SHOTS + WEB_SHOTS if not only or k in only], langs)
    if not only or ANIM in only:
        encode_anim(raw, langs)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
