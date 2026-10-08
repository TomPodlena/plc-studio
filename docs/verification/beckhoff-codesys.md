# Beckhoff TwinCAT 3 — jazyk ověřen překladačem CODESYS V3.5 SP21 Patch 6 (2026-10-06)

**Stav:** `lang` — strukturovaný text a PLCopen_Import.xml výstupu pro Beckhoff přeloženy skutečným překladačem
CODESYS (TwinCAT 3 PLC je postaven na CODESYS V3; dialekt ST, OOP rozšíření IEC 61131-3 3. vydání a PLCopen XML
s addData 3S jsou společné). Import a překlad v TwinCAT 3 XAE NEOVĚŘENY (instalace vyžaduje práva správce).

## Prostředí a postup

- CODESYS V3.5 SP21 Patch 6 (3.5.21.60), CODESYS Control Win V3 x64, rozbaleno bez instalace (viz
  `codesys-3.5.21.60.md`), skriptovací rozhraní `--noUI --runscript`.
- Projekt jako „Standard project“ (PLC_PRG + MainTask), knihovna Standard (TON), import `PLCopen_Import.xml`
  **beze změny** (`app.import_xml`), krok README (v MainTask volání MAIN), Build, Generate code.
- Vzory 00b, 03, 11 (pohony fáze 2a), sampleSmall, sampleComplex × klasika / OOP = 10 projektů.
  Vzor 12 (servoosa, Tc2_MC2 / AXIS_REF) vynechán — knihovna Tc2_MC2 v CODESYS není.

## Výsledky

| běh | import | Build | Generate code |
|---|---|---|---|
| výstup beze změny (10 projektů) | 0 chyb / 0 varování | **0 chyb / 0 varování** | 290 × C128 „No VAR_CONFIG for 'GVL_IO.…'“, nic jiného |
| kontrola: z XML odebrány jen adresy `%I*` / `%Q*` (308) | 0 / 0 | **0 / 0** | **0 / 0** |

C128 je očekávaný rozdíl platforem: GVL_IO Beckhoffu deklaruje I/O jako `AT %I*` / `%Q*` (neúplná adresa),
kterou TwinCAT propojí s kanálem svorky v I/O konfiguraci (Link / TcLinkTo). CODESYS neúplné adresy vyžaduje
doplnit ve VAR_CONFIG. Kontrolní běh bez těchto adres ukazuje, že zbytek programu (bloky, sekvence, OOP
rozhraní a dědičnost, pohony fáze 2a) generuje kód bez chyb.

## Neověřeno

Import PLCopen XML a souborů TcPOU / TcIO / TcGVL v TwinCAT 3 XAE, knihovny Tc2_Standard / Tc2_MC2 (servoosa),
linkování I/O na svorky EtherCAT, běh na runtime TwinCAT.
