"""PLCdesk PRO — deterministické kontroly 3D modelu (kód místo ručních kontrol AI agenta).

Spouští se ``pro3d.ps1 <kontrola> <model.FCStd>`` (= ``run.py``); FreeCAD jen ve vlastní instanci přes skill
freecad-instance. Moduly: ``rules`` (konvence, ISO 13857 tab. 4, kusovník, barvy, souhrn — bez FreeCADu), ``voxel``
(dosažitelnost zón, numpy / scipy), ``fc_scan`` (FreeCAD headless: kolize, souvislost, teselace, kusovník, STEP),
``fc_shots`` (snímky v GUI instanci), ``run`` (CLI, ``kontroly.json`` + ``KONTROLY.md``).
Balík záměrně nic neimportuje z ``plc_studio`` — agent ho spouští jako samostatné skripty."""

from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parent
LAUNCHER = TOOLS_DIR / "pro3d.ps1"
