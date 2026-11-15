"""PLCdesk PRO — generátory normalizovaných dílů kódem (model „dle dokumentace“ se zdrojem místo zástupné obálky).

Spouští se ``pro3d_parts.ps1 gen <PLCdesk_CAD.json> <složka>`` (= ``gen.py``); FreeCAD jen ve vlastní instanci přes skill
freecad-instance (``fc_parts.py``). Moduly: ``typy`` (rozbor typů válců Festo / SMC, závity), ``catalog_map`` (řádek
manifestu → generátor, tabulky ``data/*.json`` se zdrojem u každé řady — rozměr bez zdroje v tabulce není a díl zůstane
zástupný), ``fc_parts`` (FreeCAD: App::Part s tělesy a vlastnostmi Konstrukce_*), ``gen`` (CLI, ``parts_index.json`` +
``DILY.md``). Balík záměrně nic neimportuje z ``plc_studio`` — agent ho spouští jako samostatné skripty."""

from pathlib import Path

PARTS_DIR = Path(__file__).resolve().parent
LAUNCHER = PARTS_DIR / "pro3d_parts.ps1"
