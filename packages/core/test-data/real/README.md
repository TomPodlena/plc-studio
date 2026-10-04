# Reálné výňatky pro testy importu

Malé výňatky z veřejných projektů s permisivní licencí. Používají je testy `import: reálné …`
v `packages/core/src/core.test.ts`. Plné znění licencí je v souborech `LICENSE.*` vedle dat.

| Soubor | Zdroj | Licence / držitel práv | Úprava |
|---|---|---|---|
| `taveren_packaging_sfc.plc.xml` | https://github.com/sefcom/taveren (balicí stroj, PLCopen SFC) | BSD-2-Clause, © 2026 The Arizona Board of Regents | beze změny |
| `assembly_inspection_ladder.L5X` | https://github.com/shahrul-amin/Automated-Precision-Assembly-and-Inspection-Station (`sim/ladder/ladder.L5X`) | Apache-2.0 | beze změny |
| `bnl_vacuum_excerpt.L5X` | https://github.com/gwbischof/VacuumGroups (`Vacuum.L5X`) | BSD-3-Clause, © 2015 Brookhaven Science Associates, BNL | zkrácený výňatek (jeden ventil, AOI jen parametry, jeden list FBD) |
| `crixs_vac_excerpt.TcGVL` | https://github.com/slactjohnson/lcls-plc-crixs-vac (`GVLs/*.TcGVL`) | BSD-3-Clause, © 2019 Stanford University / SLAC | výňatek ze tří GVL sloučený do jednoho |

Ostatní soubory v `test-data/` jsou ručně vytvořené vzorky podle dokumentace formátů.

## AutomationML AR APC (`aml/`) — porovnání exportu do EPLAN

Reálné exporty s licencí MIT, beze změny; používají je testy `EPLAN AML: reálné exporty …` v
`packages/core/src/eplan_aml.test.ts` (validateAml bez falešných chyb, porovnání struktury).
Exporty bez licence (TIA V18/V20/V21, TwinCAT, TIA Selection Tool) do repozitáře nepatří — porovnání
s nimi je popsané v `docs/eplan-aml-export.md`.

| Soubor | Nástroj (WriterHeader) | Zdroj | Licence / držitel práv |
|---|---|---|---|
| `aml/eplan_2_7_3_arapc_example.aml` | EPLAN Software & Service, EPLAN 2.7.3.11561 (AR APC 1.0.0) | https://github.com/AutomationML/AML-UA-XSLT (commit e38653c, `TestData_AML/ARAPCExample.aml`; kopie v https://github.com/AutomationML/automationml-python `tests/vendor/aml-ua-xslt-e38653c/`) | MIT, © 2021 AutomationML e.V. (`aml/LICENSE.automationml-MIT.txt`) |
| `aml/tia_v17_s71200_vformi.aml` | TIA Portal V17 (WriterVersion 1700, AR APC 1.2.0), S7-1200 CPU 1214C | https://github.com/vformi/PLC.Commissioning.Lib (`src/PLC.Commissioning.Lib.App/samples/sample_device.aml`) | MIT, © 2025 vformi (`aml/LICENSE.vformi-MIT.txt`) |
| `aml/twincat_empty_gain.aml` | Beckhoff TwinCAT 3.1.4024.25 (AR APC 1.2.0), prázdný projekt | https://github.com/Gain-Automation-Technology/ExampleProject (`Example Project/_AML/Project.aml`) | MIT, © 2025 Gain Automation Technology B.V. (`aml/LICENSE.gain-MIT.txt`) |
