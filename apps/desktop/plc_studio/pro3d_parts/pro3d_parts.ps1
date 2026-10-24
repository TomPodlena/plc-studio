# PLCdesk PRO - generatory normalizovanych dilu kodem. Pouziti:
#   powershell -NoProfile -ExecutionPolicy Bypass -File pro3d_parts.ps1 gen C:\stroj\PLCdesk_CAD.json C:\stroj\dily
#   ... part "ISO4762 M6x20" "TS35 7.5x450" --out C:\stroj\dily\knihovna     ... map C:\stroj\PLCdesk_CAD.json
# Python: PLCDESK_PY, jinak Python311 (FreeCAD se spousti jen pres skill freecad-instance, slot --slot).
$py = $env:PLCDESK_PY
if (-not $py -or -not (Test-Path $py)) {
    foreach ($c in @("$env:LOCALAPPDATA\Programs\Python\Python311\python.exe", "$env:LOCALAPPDATA\Programs\FreeCAD 1.1\bin\python.exe",
                     "$env:ProgramFiles\FreeCAD 1.1\bin\python.exe")) {
        if (Test-Path $c) { $py = $c; break }
    }
}
& $py -I "$PSScriptRoot\gen.py" @args
exit $LASTEXITCODE
