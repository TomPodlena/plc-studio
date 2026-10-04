@echo off
rem PLCdesk - launcher desktopove aplikace (bez konzole, pythonw).
rem POZOR: NEpouzivat bare "python" - na PATH muze vyhrat cizi Python bez tkinter.
rem Pinujeme Python311, jinak se zkusi launcher "py".
cd /d "%~dp0"
set "PYW=%LOCALAPPDATA%\Programs\Python\Python311\pythonw.exe"
if exist "%PYW%" (
  start "" "%PYW%" "%~dp0PLCStudio.pyw" %*
) else (
  start "" pyw -3 "%~dp0PLCStudio.pyw" %*
)
