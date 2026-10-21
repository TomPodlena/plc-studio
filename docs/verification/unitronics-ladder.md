# PLCdesk — Unitronics VisiLogic (Vision / Samba) a U90 Ladder (Jazz / M91): ruční přenos (stav „beta“)

Stav k 2026-10-21. Podnět beta testera; platformy schválil uživatel 2026-10-21.

## Proč ruční přenos

VisiLogic i U90 Ladder programují jen v Ladderu. Program ani názvy operandů nejdou naimportovat z textu
(formát projektu .vlp / .U90 není dokumentovaný, API není; VisiLogic importuje z Excelu / CSV jen hodnoty
Data Tables a hodnot operandů — https://www.unitronicsplc.com/Download/SoftwareHelp/VisiLogic_Knowledgebase/Utilities/New_Utilities/DataBase/Data_Tables_and_Excel.htm).
PLCdesk proto generuje žebříček k ručnímu zadání: `Ladder.md` / `Ladder.html`, `Operandy.csv`, `IO_mapa.csv`, `README.txt`.

## Jak výstup vzniká (kód, žádná AI)

1. `uniSections` (codegen.ts) — plochá logika Unitronics z `buildIR` a šablon bloků (`inlineFb`), tentýž text
   jako `Machine.st` UniLogicu (ten je ověřený překladačem UniLogic 1.43, viz `unilogic-1.43.md`).
2. Parser emulátoru (`emu/lexer.ts`, `emu/parser.ts`) → příkazy ST → větve (`unitronics_ladder.ts`): kontakty NO / NC,
   porovnání, cívky, SET / RST, MOV / ADD / SUB / MUL / DIV (FP u REAL), časovače TD. Podmínka IF / CASE, jejíž
   operandy větev mění, se nejdřív uloží do pomocného bitu `aux_*` (vyhodnocení jednou jako v ST).
3. Operandy: I / O podle sestavy hardwaru (Vision: rozšiřovací modul x = 32 + 16·x + kanál, návod EX-A2X),
   analogy do MI (propojení v konfiguraci HW), stav programu MB / MI / MF, časovače T s presetem
   (Vision 10 ms — VisiLogic Knowledgebase Store Timer Counter Preset; U90 14 bit + jednotka 10 ms / 100 ms / 1 s / 10 s — U90 Knowledgebase Timers).

## Co hlídají testy (`unitronics_vision.test.ts`)

Vzory 00b, 01, 03, 11 × obě platformy: každý signál a každá proměnná programu má operand, adresy jednoznačné,
presety časovačů v jednotkách platformy, každý krok sekvence a každé zařízení má větev, žádný nepodporovaný
příkaz, ASCII v CSV a kresbách, determinismus, 5 jazyků bez češtiny ve výstupech jiných jazyků.

## Neověřeno

Zadání a překlad ve VisiLogicu / U90 Ladder, adresy rozšiřovacích modulů, rozsahy analogů (výchozí rawMax Vision
16383, Jazz 4095), velikost aplikace U90 (Jazz 24K, M91 32K), výpočty REAL na U90 (nemá MF — označeno `!REAL`),
chování časovače uvnitř podmíněné větve (v žebříčku se nuluje, ST ho jen nevolá), běh na skutečném PLC.
Po prvním zadání v IDE doplnit nálezy sem a do `data/verification.json`.
