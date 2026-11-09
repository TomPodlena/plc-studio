"""PLCdesk PRO — řízené RUČNÍ stahování modelů výrobců (bez Tk, bez sítě).

Nic se neskriptuje ani nestahuje: podmínky 3Dfindit / CADENAS (čl. 12.3 (vii)), TraceParts i portálů výrobců
automatizaci zakazují nebo ji nedovolují. Modul jen sestaví seznam ke stažení s odkazy (``vendors.json``),
pozná stažené soubory, nechá je zaevidovat (``register_manual``) a nahradí zástupné díly v modelu stroje.

Moduly: ``listing`` (seznam ``download_list``, STAHNOUT.md / .html, párování souborů, knihovna modelů, registrace),
``register_manual`` + ``models_index`` + ``check_step`` (převzato ze stagingu plcdesk_freecad), ``fc_replace``
(FreeCAD: zástupný díl → App::Link na model výrobce; jen ve vlastní instanci přes run_fc.ps1)."""

from pathlib import Path

DL_DIR = Path(__file__).resolve().parent
