"""Jedna instance aplikace na složku stavu (forenzní test M5).

Dvě okna nad týmž ``state.json`` (dvojklik na projekt při běžící aplikaci) si navzájem přepisovala
rozpracovaný návrh — vyhrál poslední zápis. První instance proto drží pojmenovaný mutex Windows
(jméno podle složky stavu, takže testy s vlastním ``PLCSTUDIO_HOME`` běží vedle sebe) a sleduje
soubor žádosti ``open_request.json`` ve složce stavu. Druhé spuštění:

- se souborem projektu → zapíše žádost a skončí; první instance okno vytáhne dopředu a soubor
  otevře (s dotazem na nahrazení neprázdného návrhu, jako „Otevřít projekt…“),
- bez souboru → jen vytáhne první instanci dopředu (stejná žádost bez cesty) a skončí,
- když první instance žádost do pár sekund nepřevezme (visí) → varování a konec; ``state.json``
  druhé spuštění nikdy nezapíše.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path

REQUEST = "open_request.json"
POLL_MS = 700
_handle = None                      # mutex drží proces do konce (uvolní ho Windows)


def _mutex_name(home: Path) -> str:
    key = hashlib.sha256(str(Path(home).resolve()).lower().encode("utf-8")).hexdigest()[:24]
    return "Local\\PLCdesk-" + key


def acquire(home: Path) -> bool:
    """True = tahle instance je první (nebo zámek nejde zjistit — mimo Windows). False = už běží jiná."""
    global _handle
    if os.name != "nt":
        return True
    try:
        import ctypes
        k32 = ctypes.windll.kernel32
        k32.CreateMutexW.restype = ctypes.c_void_p
        h = k32.CreateMutexW(None, False, _mutex_name(home))
        already = k32.GetLastError() == 183          # ERROR_ALREADY_EXISTS
        if not h:
            return True
        if already:
            k32.CloseHandle(ctypes.c_void_p(h))
            return False
        _handle = h
        return True
    except Exception:  # noqa: BLE001 — bez zámku aplikace běží jako dřív
        return True


def hand_over(home: Path, project: str | None, wait_s: float = 6.0) -> bool:
    """Předá žádost běžící instanci; True = převzala ji (soubor žádosti zmizel)."""
    path = Path(home) / REQUEST
    body = {"path": str(Path(project).resolve()) if project else "", "at": time.time()}
    try:
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(body, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, path)
    except OSError:
        return False
    end = time.monotonic() + wait_s
    while time.monotonic() < end:
        if not path.exists():
            return True
        time.sleep(0.1)
    try:                                              # nepřevzato: žádost uklidit (neotevřít později)
        path.unlink(missing_ok=True)
    except OSError:
        pass
    return False


def load_lang(home: Path) -> None:
    """Jazyk hlášky druhého spuštění (bez mostu Node): ``settings.json`` + katalog jádra
    ``packages/core/src/i18n/<jazyk>.ts`` (tělo je JSON)."""
    from . import i18n
    try:
        lang = json.loads((Path(home) / "settings.json").read_text(encoding="utf-8-sig")).get("lang")
        if lang not in i18n.LANGS or lang == "cs":
            return
        src = Path(__file__).resolve().parents[3] / "packages" / "core" / "src" / "i18n" / f"{lang}.ts"
        text = src.read_text(encoding="utf-8")
        body = text[text.index("{", text.index("const d")):text.rindex("};") + 1]
        i18n.set_catalog(lang, json.loads(body))
    except Exception:  # noqa: BLE001 — bez katalogu česky
        pass


def watch(app) -> None:
    """V první instanci: pravidelně převzít žádost druhého spuštění (okno dopředu, otevřít soubor)."""
    path = Path(app.home) / REQUEST

    def poll() -> None:
        if getattr(app, "_closing", False):
            return
        try:
            if path.exists():
                try:
                    req = json.loads(path.read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    req = {}
                try:
                    path.unlink(missing_ok=True)
                except OSError:
                    pass
                app.root.after_idle(lambda: app.open_external(req.get("path") if isinstance(req, dict) else ""))
        finally:
            try:
                app.root.after(POLL_MS, poll)
            except Exception:  # noqa: BLE001 — okno se zavírá
                pass

    app.root.after(POLL_MS, poll)
