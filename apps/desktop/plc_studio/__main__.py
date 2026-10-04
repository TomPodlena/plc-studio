"""Spuštění PLCdesk:  ``python -m plc_studio``  (z adresáře apps/desktop).

``--smoke`` projde všechny kroky nad ukázkami i prázdným projektem a skončí
(kontrola, že se každý krok vykreslí); ``--shots SLOŽKA`` k tomu uloží snímky.
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
from pathlib import Path

import tkinter as tk
from tkinter import messagebox

from . import theme, updates
from .app import STEPS, App
from .bridge import BridgeError
from .i18n import _


def grab_window(win, path: Path) -> None:
    """Snímek okna včetně rámečku (vyžaduje Pillow).

    Okno se přes PrintWindow vykreslí samo do paměti — nesnímá se obrazovka,
    takže nevadí zamčená stanice ani okna jiných aplikací přes něj."""
    import ctypes
    from ctypes import wintypes

    from PIL import Image
    user32, gdi32 = ctypes.windll.user32, ctypes.windll.gdi32
    vp = ctypes.c_void_p
    user32.GetParent.restype = user32.GetWindowDC.restype = vp
    gdi32.CreateCompatibleDC.restype = gdi32.CreateCompatibleBitmap.restype = vp
    gdi32.SelectObject.restype = vp
    user32.GetParent.argtypes = user32.GetWindowDC.argtypes = [vp]
    user32.GetWindowRect.argtypes = [vp, ctypes.POINTER(wintypes.RECT)]
    user32.PrintWindow.argtypes = [vp, vp, wintypes.UINT]
    user32.ReleaseDC.argtypes = [vp, vp]
    gdi32.CreateCompatibleDC.argtypes = gdi32.DeleteDC.argtypes = gdi32.DeleteObject.argtypes = [vp]
    gdi32.CreateCompatibleBitmap.argtypes = [vp, ctypes.c_int, ctypes.c_int]
    gdi32.SelectObject.argtypes = [vp, vp]
    gdi32.GetDIBits.argtypes = [vp, vp, wintypes.UINT, wintypes.UINT, vp, vp, wintypes.UINT]

    class BITMAPINFOHEADER(ctypes.Structure):
        _fields_ = [("biSize", wintypes.DWORD), ("biWidth", wintypes.LONG),
                    ("biHeight", wintypes.LONG), ("biPlanes", wintypes.WORD),
                    ("biBitCount", wintypes.WORD), ("biCompression", wintypes.DWORD),
                    ("biSizeImage", wintypes.DWORD), ("biXPelsPerMeter", wintypes.LONG),
                    ("biYPelsPerMeter", wintypes.LONG), ("biClrUsed", wintypes.DWORD),
                    ("biClrImportant", wintypes.DWORD)]

    hwnd = user32.GetParent(win.winfo_id())
    rect = wintypes.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(rect))
    w, h = rect.right - rect.left, rect.bottom - rect.top
    wdc = user32.GetWindowDC(hwnd)
    mdc = gdi32.CreateCompatibleDC(wdc)
    bmp = gdi32.CreateCompatibleBitmap(wdc, w, h)
    old = gdi32.SelectObject(mdc, bmp)
    try:
        user32.PrintWindow(hwnd, mdc, 2)            # PW_RENDERFULLCONTENT
        gdi32.SelectObject(mdc, old)
        hdr = BITMAPINFOHEADER(ctypes.sizeof(BITMAPINFOHEADER), w, -h, 1, 32, 0)
        buf = ctypes.create_string_buffer(w * h * 4)
        gdi32.GetDIBits(mdc, bmp, 0, h, buf, ctypes.byref(hdr), 0)
        Image.frombuffer("RGB", (w, h), buf, "raw", "BGRX", 0, 1).save(path)
    finally:
        gdi32.DeleteObject(bmp)
        gdi32.DeleteDC(mdc)
        user32.ReleaseDC(hwnd, wdc)


def _smoke(app: App, shots: Path | None) -> int:
    root = app.root
    if shots:
        shots.mkdir(parents=True, exist_ok=True)

    def views(step) -> list[tuple[str, dict]]:
        """Záložky kroku, které se mají projít: (přípona snímku, nastavení UI)."""
        if step == 5 and app.prj["io"]:
            return [(f"_{t}", {"schema_tab": t}) for t in range(4)]
        if step == 6:
            scen = range(3) if app.prj["program"]["seq"] else [0]
            return [("_0", {"prog_tab": 0}), ("_1", {"prog_tab": 1})] + [
                (f"_2{t}", {"prog_tab": 2, "sim_tab": t}) for t in scen]
        if step == 7 and app.prj["devices"]:              # Generovat: kód, HMI, emulace, SISTEMA a EPLAN
            return [(f"_{t}", {"gen_tab": t}) for t in range(4)]
        if step == 10 and app.prj["devices"]:             # Bezpečnost: funkce, nebezpečí, … výkres
            return [(f"_{t}", {"safety": {"tab": t}}) for t in range(5)]
        return [("", {})]

    def walk(label: str) -> None:
        for step in [*range(len(STEPS)), "help"]:
            for suffix, ui in views(step):
                app.ui.update(ui)
                app.goto(step)
                root.update()
                if shots:
                    root.after(250)
                    root.update()
                    grab_window(root, shots / f"{label}_{step}{suffix}.png")

    def walk_import(label: str) -> None:
        """Průvodce importem nad vlastním vygenerovaným kódem (bez AI — klíč chybí)."""
        from .importer import open_wizard
        app.ui.pop("import", None)
        out = app.bridge.request("gen", prj=app.prj)["out"]
        files = out[app.prj["platforms"][0]] if app.prj["platforms"] else {}
        wiz = open_wizard(app)
        wiz.add_inputs([{"name": n, "text": t} for n, t in files.items()])
        for page in range(4):
            if page == 1:
                wiz.extract()
            else:
                wiz.goto(page)
            root.update()
            if shots:
                root.after(250)
                root.update()
                grab_window(wiz.win, shots / f"{label}_import_{page}.png")
        wiz.close()
        root.update()

    walk("slozita")                 # výchozí stav = ukázka složité linky
    walk_import("slozita")
    app.load_sample("small")
    walk("mala")
    # pohony fáze 2a (měnič, polohovací pohon, proporcionální ventil): vzor 11 ze složky samples/
    motion = Path(__file__).resolve().parents[3] / "samples" / "11_podavaci_lisovaci_stanice_PS-11.plcstudio.json"
    if motion.exists() and app.open_project(motion):
        walk("pohony")
    # servoosa (fáze 2b): vzor 12 — vybraná osa v Zařízení / živé simulaci, krok osy rozpracovaný v Programu
    axis = motion.with_name("12_portalovy_manipulator_PM-12.plcstudio.json")
    if axis.exists() and app.open_project(axis):
        ax = next((d for d in app.prj["devices"] if d["cls"] == "Axis"), None)
        if ax is not None:
            app.ui.update(dev_sel=ax["id"], live_sel=ax["id"],
                          seq_add={"dev": ax["id"], "act": "moveAbs", "cond": "fbk", "time": "3"})
        walk("osa")
    app.reset_project()
    walk("prazdny")
    errors = list(app.errors)
    app.close()
    for e in errors:
        print(e, file=sys.stderr)
    print(f"smoke: {'CHYBY: ' + str(len(errors)) if errors else 'OK'}")
    return 1 if errors else 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="plc_studio", description="PLCdesk — desktop")
    ap.add_argument("project", nargs="?", help="soubor projektu (.plcstudio.json) k otevření")
    ap.add_argument("--smoke", action="store_true", help="projít všechny kroky a skončit")
    ap.add_argument("--shots", metavar="SLOŽKA", help="při --smoke uložit snímky kroků")
    args = ap.parse_args(argv)

    if args.smoke and not os.environ.get("PLCSTUDIO_HOME"):
        # zkouška nesmí sáhnout na rozpracovaný návrh uživatele
        os.environ["PLCSTUDIO_HOME"] = tempfile.mkdtemp(prefix="plcstudio_smoke_")

    theme.set_app_id()   # před tk.Tk(), jinak Windows okno seskupí s jinými pythonw
    root = tk.Tk()
    try:
        app = App(root)
    except BridgeError as exc:
        root.withdraw()
        messagebox.showerror(_("PLCdesk nejde spustit"), str(exc))
        return 2
    if args.smoke:
        return _smoke(app, Path(args.shots) if args.shots else None)
    if args.project:
        app.open_project(args.project)
    # kontrola aktualizací na pozadí (nejvýš jednou denně, bez sítě tiše nic) — ne v --smoke
    root.after(2000, lambda: updates.start_check(app))
    root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
