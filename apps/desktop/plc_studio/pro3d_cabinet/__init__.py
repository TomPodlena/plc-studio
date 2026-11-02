"""PLCdesk PRO — deterministický generátor rozvaděče kódem (místo AI stavitele části „Rozvaděč“).

``python -m plc_studio.pro3d_cabinet <PLCdesk_CAD.json> <složka stroje> [--rezerva 20] [--tamb 35] [--tin 40]``
(= ``cli.py``) → ``rozvadec/layout.json`` (rozmístění, mezery, tepelná bilance — ``layout.py``, čistý Python),
``rozvadec/Rozvadec.FCStd`` (``fc_cabinet.py`` ve VLASTNÍ instanci FreeCADu přes skill freecad-instance, barvy
``fc_cabinet_colors.py`` v GUI instanci téhož slotu) a ``rozvadec/ROZVADEC.md``. Data se zdrojem v ``data/``
(``ztraty.json``, ``mezery.json``, ``rozmery.json``, ``skrine.json``). Balík nic neimportuje z ``plc_studio`` (jen
sourozence ``pro3d_parts.catalog_map`` jako samostatný modul) — agent ho spouští jako skripty."""

from pathlib import Path

CABINET_DIR = Path(__file__).resolve().parent
