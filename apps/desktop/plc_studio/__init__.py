"""PLC Studio — desktopová aplikace (tkinter) nad jádrem ``packages/core``.

Jádro (model, generátory kódu, výkresy, dokumentace, import) se nekopíruje:
běží v Node a aplikace ho volá přes ``bridge.mjs``. Spuštění::

    python -m plc_studio          (z adresáře apps/desktop)
"""

__version__ = "0.1.0"
