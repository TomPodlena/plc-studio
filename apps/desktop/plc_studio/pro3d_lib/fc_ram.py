# FreeCAD 1.1 (freecadcmd) — stavba plánu modulu N1 (rám / stůl z profilů ALUTEC). Spouštět JEN přes skill freecad-instance:
#   run_fc.ps1 run --slot pro-n1 --timeout 900 --result <vysledek.json> fc_ram.py <plan.json> <složka>
# Plán = modul_ram.plan_ramu(...). Staví ho TÝMŽ kódem jako fc_lib.py (díly do dily/, sestava s App::Link): prvek tělesa
# {"profil": {"a", "b", "L"}} (zástupný průřez ALUTEC a × b) i plán bez profilu zkušební desky umí fc_lib.py sám;
# tady se jen načte jako knihovna (``__name__ = "fc_lib_lib"`` — bez spuštění stavby) a zavolá se jeho main().
import os

HERE = os.path.dirname(os.path.abspath(__file__))
FC_LIB = os.path.join(HERE, "fc_lib.py")

ns = {"__name__": "fc_lib_lib", "__file__": FC_LIB}
exec(compile(open(FC_LIB, encoding="utf-8").read(), FC_LIB, "exec"), ns)   # noqa: S102 — vlastní knihovna repozitáře
ns["main"]()
