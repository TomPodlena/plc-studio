"""Spuštění PLC Studia:  ``python -m plc_studio``  (z adresáře apps/desktop).

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

from . import theme
from .app import STEPS, App
from .bridge import BridgeError


def _grab(root: tk.Tk, path: Path) -> None:
    """Snímek okna včetně rámečku (vyžaduje Pillow)."""
    import ctypes
    from ctypes import wintypes

    from PIL import ImageGrab
    rect = wintypes.RECT()
    hwnd = ctypes.windll.user32.GetParent(root.winfo_id())
    ctypes.windll.user32.GetWindowRect(hwnd, ctypes.byref(rect))
    ImageGrab.grab(bbox=(rect.left, rect.top, rect.right, rect.bottom)).save(path)


def _smoke(app: App, shots: Path | None) -> int:
    root = app.root
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
        root.attributes("-topmost", True)

    def walk(label: str) -> None:
        for step in [*range(len(STEPS)), "help"]:
            tabs = range(3) if step == 5 and app.prj["io"] else [0]
            for tab in tabs:
                app.ui["schema_tab"] = tab
                app.goto(step)
                root.update()
                if shots:
                    root.after(250)
                    root.update()
                    suffix = f"_{tab}" if len(tabs) > 1 else ""
                    _grab(root, shots / f"{label}_{step}{suffix}.png")

    walk("slozita")                 # výchozí stav = ukázka složité linky
    app.load_sample("small")
    walk("mala")
    app.reset_project()
    walk("prazdny")
    errors = list(app.errors)
    app.close()
    for e in errors:
        print(e, file=sys.stderr)
    print(f"smoke: {'CHYBY: ' + str(len(errors)) if errors else 'OK'}")
    return 1 if errors else 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="plc_studio", description="PLC Studio — desktop")
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
        messagebox.showerror("PLC Studio nejde spustit", str(exc))
        return 2
    if args.smoke:
        return _smoke(app, Path(args.shots) if args.shots else None)
    if args.project:
        app.open_project(args.project)
    root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
