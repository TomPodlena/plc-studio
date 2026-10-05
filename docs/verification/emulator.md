# PLCdesk — ověření emulátorem (stav „beta“)

Platformy bez ověření v IDE výrobce (stav `beta` v `data/verification.json`) ověřuje **emulátor PLCdesk**
(`packages/core/src/emu/`). Emulátor **není překladač výrobce**: zachytí to, co zná z příruček, ale co řekne
překladač konkrétní verze IDE, potvrdí až skutečný import. Výhradu nese i dokument `15_emulace_prekladu.md`.

## Co emulátor dělá

1. **Překlad skutečného výstupu `genFor`** (`emulateCompile`): lexer a parser IEC 61131-3 (`lexer.ts`,
   `parser.ts`), načtení souborů platformy (`load.ts`: SCL, ST, L5X, plochý ST UniLogic, PLCopen XML, TcPOU,
   IEC 61131-10 XML) a pravidla dialektů se zdrojem u každého pravidla (`dialects.ts`, tabulka `SRC`: příručky
   Siemens, Rockwell 1756-PM007 / RM014, Mitsubishi JY997D55701 / JY997D55801 / SH-081215ENG, OMRON W501 / W502 /
   W504, Beckhoff Infosys, CODESYS Online Help). Kontroly struktury souborů: `plcopen_check.ts` (PLCopen XML),
   `iec61131_10_check.ts` (IEC 61131-10 XML), `oop_files.ts` (TcPOU / PLCopen × ST výpis).
2. **Běh** (`emulateRun` / `emulateRunMany`): přeložený program běží scan po scanu proti modelu stroje simulátoru
   ve scénářích `verifyProject` (běžný cyklus, poruchy, matice stavů) a porovná se chování kód × návrh.
3. **Mutační testy**: do kódu se vkládají chyby (chybějící END_IF, špatný typ, prohozené pořadí volání, chybějící
   MC_Power…) a emulátor je musí chytit.

## Důkazy (testy v repozitáři, běží v `node --test "packages/core/dist/*.test.js"`)

| test | rozsah |
|---|---|
| `emu.test.ts` | příklady 00a–12 × všechny platformy × 5 jazyků: překlad bez chyby, běh bez rozdílu proti návrhu; mutace |
| `emu_oop.test.ts` | OOP: příklady × platformy s OOP × 5 jazyků = návrh; lockstep OOP × klasika; mutace |
| `motion.test.ts`, `axis.test.ts` | pohony fáze 2a (10 platforem) a servoosa (7 platforem): návrh, mutace, simulace |
| `plcopen.test.ts` | PLCopen XML: struktura a round-trip (schéma TC6 v2.01 — Beremiz `tc6_xml_v201.xsd` — ověřeno mimo test na 14 projektech × 3 platformy) |
| `iec61131_10.test.ts` | IEC 61131-10 XML (GX Works3): XSD normy (lxml, vzory 00a–12 × 5 jazyků), strukturní kontrola, mutace |
| `hardware.test.ts` | adresy a sestava hardwaru (13 příkladů × platformy) |

Ověřeno k 2026-10-04 (fáze 1 — emulátory všech platforem; pravidla dialektů proti příručkám výrobců 2026-10-03).

## Co emulátor neověří

Import v IDE výrobce (formát souborů tagů, verze souborů, výchozí hodnoty), knihovny a typy výrobce mimo
modelované bloky, přiřazení I/O ke skutečným modulům, download do PLC a běh na runtime.
Každý README platformy proto popisuje nejkratší test v IDE a simulátoru výrobce.
