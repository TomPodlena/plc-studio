# PLCdesk × CODESYS V3.5 SP21 Patch 6 — profily CODESYS dalších výrobců (2026-10-05)

Postup jako [codesys-3.5.21.60.md](codesys-3.5.21.60.md) (jen jiné úlohy; skripty leží mimo repozitář): gen3.mjs vygeneruje PLCopen_Import.xml
vzorů 00b, 03, 11 (+12 s osou u Festo) × classic / OOP (OOP jen u profilů s CODESYS SP13+; Inovance jen
klasika); u všech emulateCompile 0 chyb a emulateRunMany 0 rozdílů. build3.py: nový projekt Control Win V3 x64
+ knihovna Standard (u osy SM3_Basic a GVL_Axes), import XML BEZ úprav, krok README (MainTask → MAIN), Build,
Generate code.

**Výsledek: 58 / 58 — import bez hlášení, Build 0 chyb / 0 varování, Generate code 0 / 0** (profily jsou bez AT,
proto ani C373). OOP: po importu `FUNCTION_BLOCK ABSTRACT FB_DeviceBase` u 27 / 27 OOP úloh.

Neověřeno: IDE výrobců (FAS, Automation Builder, ctrlX PLC Engineering, InoProShop, XSOFT-CODESYS-3,
PLC Designer, HX-CODESYS), balíky zařízení a knihovny, I/O mapování na skutečném HW, běh na runtime.

| vzor | platforma | styl | import | úlohy po kroku README | build chyby / varování | generate code chyby / varování |
|---|---|---|---|---|---|---|
| 00b | turck | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 00b | festo | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 00b | abb | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 00b | rexroth | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 00b | inovance | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 00b | weidmueller | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 00b | eaton | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 00b | lenze | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 00b | berghof | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 00b | hitachi | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 00b | turck | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 00b | festo | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 00b | abb | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 00b | rexroth | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 00b | weidmueller | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 00b | eaton | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 00b | lenze | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 00b | berghof | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 00b | hitachi | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 03 | turck | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 03 | festo | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 03 | abb | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 03 | rexroth | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 03 | inovance | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 03 | weidmueller | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 03 | eaton | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 03 | lenze | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 03 | berghof | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 03 | hitachi | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 03 | turck | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 03 | festo | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 03 | abb | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 03 | rexroth | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 03 | weidmueller | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 03 | eaton | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 03 | lenze | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 03 | berghof | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 03 | hitachi | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 11 | turck | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 11 | festo | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 11 | abb | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 11 | rexroth | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 11 | inovance | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 11 | weidmueller | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 11 | eaton | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 11 | lenze | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 11 | berghof | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 11 | hitachi | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 11 | turck | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 11 | festo | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 11 | abb | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 11 | rexroth | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 11 | weidmueller | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 11 | eaton | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 11 | lenze | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 11 | berghof | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 11 | hitachi | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 12 | festo | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
