"""PLCdesk PRO — deterministický generátor modulů stroje kódem (místo AI stavitele části „Moduly“).

``python -m plc_studio.pro3d_modules <PLCdesk_CAD.json> <složka stroje>`` (= ``cli.py``) → ``moduly/layout.json``
(``layout.py``: zařízení v poli z konceptu, nosné konstrukce konceptu, válce s patkami / čelem, snímače s držáky,
úchytky, šroubení, trasy hadic a kabelů routerem ``router.py`` a výpočty skillu kabelaz-a-hadice), ``moduly/MODULY.md``
(``report.py``) a ``moduly/Moduly.FCStd`` (``fc_modules.py`` ve VLASTNÍ instanci FreeCADu, barvy a snímky
``fc_modules_colors.py``). Scéna rámu a konceptu ``fc_scene.py``. Data se zdrojem v ``data/moduly.json``. Balík nic
neimportuje z ``plc_studio`` (jen sourozence ``pro3d_parts`` a ``pro3d_tools.rules`` jako samostatné moduly)."""

from pathlib import Path

MODULES_DIR = Path(__file__).resolve().parent
