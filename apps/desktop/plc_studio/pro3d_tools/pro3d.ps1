# PLCdesk PRO - kontroly 3D modelu skripty. Pouziti:
#   powershell -NoProfile -ExecutionPolicy Bypass -File pro3d.ps1 vse C:\stroj\ram\Ram.FCStd [--out C:\stroj\ram]
# Python s numpy: PLCDESK_PY, jinak Python FreeCADu 1.1 (numpy + scipy pribalene), jinak Python311.
$py = $env:PLCDESK_PY
if (-not $py -or -not (Test-Path $py)) {
    foreach ($c in @("$env:LOCALAPPDATA\Programs\FreeCAD 1.1\bin\python.exe", "$env:ProgramFiles\FreeCAD 1.1\bin\python.exe",
                     "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe")) {
        if (Test-Path $c) { $py = $c; break }
    }
}
& $py -I "$PSScriptRoot\run.py" @args
exit $LASTEXITCODE
