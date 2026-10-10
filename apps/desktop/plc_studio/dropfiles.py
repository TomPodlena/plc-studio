"""Přetažení souborů z Průzkumníka do okna (Windows) — bez závislostí.

tkinter bez rozšíření tkdnd přetažení neumí. Ve Windows ale stačí shell API přes ``ctypes``:
okno se přihlásí ``DragAcceptFiles`` a jeho obsluha zpráv (podtřída přes ``SetWindowLongPtrW``)
zachytí ``WM_DROPFILES`` a cesty přečte ``DragQueryFileW``. Obsluha cesty jen uloží a předá
je Tk až ze smyčky událostí (``after``), aby se uvnitř zprávy Windows nevolal Tcl.

Jinde než ve Windows (nebo když se přihlášení nepovede) ``enable`` vrátí ``None`` a okno
funguje dál bez přetažení — soubory se přidávají tlačítkem.
"""

from __future__ import annotations

import sys

WM_DROPFILES = 0x0233
GWLP_WNDPROC = -4


class _Drop:
    """Přihlášené okno: původní obsluha zpráv, naše obsluha (reference proti GC), fronta cest."""

    def __init__(self, hwnd: int, old, proc, widget, callback) -> None:
        self.hwnd, self.old, self.proc = hwnd, old, proc
        self.widget, self.callback = widget, callback
        self.pending: list[list[str]] = []
        self.job = None


def _api():
    import ctypes
    from ctypes import wintypes
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    shell32 = ctypes.WinDLL("shell32")
    LRESULT = ctypes.c_ssize_t
    WNDPROC = ctypes.WINFUNCTYPE(LRESULT, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)
    user32.SetWindowLongPtrW.restype = ctypes.c_void_p
    user32.SetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_void_p]
    user32.CallWindowProcW.restype = LRESULT
    user32.CallWindowProcW.argtypes = [ctypes.c_void_p, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    shell32.DragAcceptFiles.argtypes = [wintypes.HWND, wintypes.BOOL]
    shell32.DragQueryFileW.restype = wintypes.UINT
    shell32.DragQueryFileW.argtypes = [wintypes.HANDLE, wintypes.UINT, wintypes.LPWSTR, wintypes.UINT]
    shell32.DragFinish.argtypes = [wintypes.HANDLE]
    return ctypes, user32, shell32, WNDPROC


def _hwnd(widget) -> int:
    """HWND rámu okna nejvyšší úrovně (``wm frame``), kam Windows posílá WM_DROPFILES."""
    top = widget.winfo_toplevel()
    top.update_idletasks()
    return int(top.wm_frame(), 16)


def enable(widget, callback) -> _Drop | None:
    """Okno ``widget`` (jeho toplevel) přijme přetažené soubory → ``callback(list[str])``."""
    if sys.platform != "win32":
        return None
    try:
        ctypes, user32, shell32, WNDPROC = _api()
        hwnd = _hwnd(widget)
        holder: dict = {}

        def proc(h, msg, wparam, lparam):
            d = holder.get("d")
            if msg == WM_DROPFILES and d is not None:
                paths = []
                try:
                    n = shell32.DragQueryFileW(wparam, 0xFFFFFFFF, None, 0)
                    for i in range(n):
                        size = shell32.DragQueryFileW(wparam, i, None, 0) + 1
                        buf = ctypes.create_unicode_buffer(size)
                        shell32.DragQueryFileW(wparam, i, buf, size)
                        paths.append(buf.value)
                finally:
                    shell32.DragFinish(wparam)
                if paths:
                    d.pending.append(paths)
                    _schedule(d)
                return 0
            return user32.CallWindowProcW(holder["old"], h, msg, wparam, lparam)

        cb = WNDPROC(proc)
        old = user32.SetWindowLongPtrW(hwnd, GWLP_WNDPROC, ctypes.cast(cb, ctypes.c_void_p).value)
        if not old:
            return None
        holder["old"] = old
        d = _Drop(hwnd, old, cb, widget, callback)
        holder["d"] = d
        shell32.DragAcceptFiles(hwnd, True)
        return d
    except Exception:  # noqa: BLE001 — přetažení je pohodlí navíc, okno nesmí spadnout
        return None


def _schedule(d: _Drop) -> None:
    """Předá cesty Tk mimo obsluhu zprávy Windows (``after`` ze smyčky událostí)."""
    if d.job is not None:
        return
    try:
        d.job = d.widget.after(1, lambda: _flush(d))
    except Exception:  # noqa: BLE001 — okno už zaniká
        d.job = None


def _flush(d: _Drop) -> None:
    d.job = None
    batches, d.pending = d.pending, []
    for paths in batches:
        d.callback(paths)


def disable(d: _Drop | None) -> None:
    """Vrátí původní obsluhu zpráv (před zavřením okna)."""
    if d is None:
        return
    try:
        ctypes, user32, shell32, _w = _api()
        shell32.DragAcceptFiles(d.hwnd, False)
        user32.SetWindowLongPtrW(d.hwnd, GWLP_WNDPROC, d.old)
    except Exception:  # noqa: BLE001
        pass


def simulate_drop(d: _Drop, paths: list[str]) -> None:
    """Testy: pošle oknu skutečnou zprávu WM_DROPFILES se seznamem cest (HDROP v paměti)."""
    import ctypes
    from ctypes import wintypes
    kernel32 = ctypes.WinDLL("kernel32")
    user32 = ctypes.WinDLL("user32")
    kernel32.GlobalAlloc.restype = wintypes.HGLOBAL
    kernel32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
    kernel32.GlobalLock.restype = ctypes.c_void_p
    kernel32.GlobalLock.argtypes = [wintypes.HGLOBAL]
    kernel32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
    user32.SendMessageW.restype = ctypes.c_ssize_t
    user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    text = "\0".join(paths) + "\0\0"
    raw = text.encode("utf-16-le")
    head = 20                                     # DROPFILES: pFiles, pt.x, pt.y, fNC, fWide
    h = kernel32.GlobalAlloc(0x0042, head + len(raw))      # GMEM_MOVEABLE | GMEM_ZEROINIT
    ptr = kernel32.GlobalLock(h)
    ctypes.memmove(ptr, (ctypes.c_uint32 * 5)(head, 0, 0, 0, 1), head)
    ctypes.memmove(ptr + head, raw, len(raw))
    kernel32.GlobalUnlock(h)
    user32.SendMessageW(d.hwnd, WM_DROPFILES, h, 0)       # DragFinish v obsluze paměť uvolní
