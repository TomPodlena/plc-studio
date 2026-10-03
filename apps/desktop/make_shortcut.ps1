# PLCdesk - vytvori zastupce na plose, ktery spousti aplikaci z TETO slozky.
# Po presunu repozitare staci skript pustit znovu.
#   powershell -ExecutionPolicy Bypass -File make_shortcut.ps1
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

# pythonw s tkinter: pripnuty Python 3.11, jinak cokoli, co najde launcher "py"
$pyw = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python311\pythonw.exe'
if (-not (Test-Path $pyw)) {
    $exe = & py -3 -c "import sys; print(sys.executable)" 2>$null
    if ($exe) { $pyw = Join-Path (Split-Path -Parent $exe) 'pythonw.exe' }
}
if (-not $pyw -or -not (Test-Path $pyw)) {
    Write-Error 'Nenasel jsem pythonw.exe (Python 3.9+ s tkinter).'
    exit 1
}

$lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'PLCdesk.lnk'
$sc = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$sc.TargetPath = $pyw
$sc.Arguments = '"' + (Join-Path $here 'PLCStudio.pyw') + '"'
$sc.WorkingDirectory = $here
$sc.IconLocation = (Join-Path $here 'plc_studio\assets\plc_studio.ico') + ',0'
$sc.Description = 'PLCdesk - navrh PLC systemu od zadani po kod a dokumentaci'
$sc.Save()
Write-Output "Zastupce vytvoren: $lnk -> $pyw"
