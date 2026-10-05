# PLCdesk × CODESYS V3.5 SP21 Patch 6 — re-verifikace po opravách 1–4 (2026-10-05)

Navazuje na první běh, který našel odchylky 1–4 (opravy níže). Výstupy vygenerované **opraveným** jádrem
(`packages/core/dist`) a importované **bez jakékoli ruční úpravy XML**.

## Opravy v jádře

1. **GVL_IO** v `<addData><data name="…/plcopenxml/globalvars"><globalVars name="GVL_IO">` projektu,
   `<instances><configurations /></instances>` prázdné (`plcopen.ts`: `plcopenGvlAddData`, `gvlVarsXml`;
   `codegen_oop.ts`). TwinCAT navíc dostal do GVL v XML proměnnou osy `Ax_… : AXIS_REF` (byla jen v GVL_IO.st —
   nalezeno novou kontrolou emulátoru). README codesys / schneider / wago / delta: krok „v MainTask nahraď
   volání PLC_PRG voláním MAIN; projekt jako Standard project (knihovna Standard)“.
2. **VAR_IN_OUT → `<inOutVars>`** (`parseStPou` vrací `inouts`).
3. **OOP InterfaceAsPlainText**: POU = `<data …/interfaceasplaintext>` v addData POU za `</body>`;
   Method / Property / Interface (i metody a vlastnosti rozhraní) = `<InterfaceAsPlainText>` jako přímý potomek
   (pak `<addData />`).
4. **`{attribute 'monitoring' := 'call'}` i u vlastností I_Device** (ST výpis, XML, TcIO).

## Postup

Pomocné skripty (`gen2.mjs`, `build2.py`, `run_cds.ps1`, `summ3.mjs`, `decl.mjs`) leží mimo repozitář
(pracovní složka ověření); CODESYS se ovládá vlastním skriptovacím rozhraním (Python, `--runscript`).

- `gen2.mjs` (= `gen.mjs` s výstupem do `gen2\`) — `genFor` 00b, 03, 11, 12, sampleSmall, sampleComplex ×
  classic / OOP × codesys, wago, delta, schneider; `emulateCompile` u všech 0 chyb.
- `build2.py` (`run_cds.ps1 -Script build2.py`, úlohy `jobs2_all.json` → `jobs2.json`, výsledky `res_v2fix.jsonl`):
  nový projekt + Control Win V3 x64 + knihovna Standard (u osy i SM3_Basic a `GVL_Axes` s `Ax_M1 : AXIS_REF_SM3`)
  + **stav jako šablona „Standard project“** (PLC_PRG a MainTask, která ho volá) →
  `Application.import_xml` (PLCopen_Import.xml beze změny) → **krok z README**: v MainTask nahradit PLC_PRG
  voláním MAIN (`task.pous.replace(index, "MAIN")`; `remove("PLC_PRG")` tiše nic neudělá, `remove(index)` hlásí
  chybu) → Build → Generate code. U OOP se po importu čtou deklarace FB_DeviceBase, Cycle, Fault a I_Device.Fault.
- `summ3.mjs` (souhrn, `--md` tabulka), `decl.mjs` (kontrola deklarací OOP po importu).

## Výsledek: 42 / 42 bez chyb a varování

- Import: bez hlášení (žádné „Object 'Default' is not accepted…“), GVL_IO založen, MainTask volá MAIN.
- Build: **0 chyb / 0 varování** ve všech 42 kombinacích (C37 / C540 u FB_Axis zmizely, C568 se neobjevil).
- Generate code: 0 chyb; varování jen **C373** „adresa není v žádném zařízení“ (Control Win bez I/O — očekávané;
  WAGO bez AT je nemá).
- OOP (20 kombinací): deklarace po importu = ST výpis — `FUNCTION_BLOCK ABSTRACT FB_DeviceBase IMPLEMENTS I_Device`
  s komentářem `(* … *)`, `METHOD PROTECTED ABSTRACT Cycle`, `{attribute 'monitoring' := 'call'}` + `PROPERTY PUBLIC
  Fault : BOOL`, v I_Device `{attribute 'monitoring' := 'call'}` + `PROPERTY Fault : BOOL` (20 / 20).
- Neověřeno: 12 × WAGO (SoftMotion Light není v čistém CODESYS), 12 × Schneider (osu negeneruje), 12 × OOP
  (osa vypíná OOP = klasika), TwinCAT, běh na runtime, zařízení / knihovny WAGO, Delta, Schneider.

| vzor | platforma | styl | import | úlohy po kroku README | build chyby / varování | generate code chyby / varování |
|---|---|---|---|---|---|---|
| 00b | codesys | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 44 (C373) |
| 00b | schneider | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 44 (C373) |
| 00b | wago | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 00b | delta | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 44 (C373) |
| 00b | codesys | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 44 (C373) |
| 00b | schneider | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 44 (C373) |
| 00b | wago | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 00b | delta | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 44 (C373) |
| 03 | codesys | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 24 (C373) |
| 03 | schneider | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 24 (C373) |
| 03 | wago | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 03 | delta | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 24 (C373) |
| 03 | codesys | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 24 (C373) |
| 03 | schneider | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 24 (C373) |
| 03 | wago | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 03 | delta | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 24 (C373) |
| 11 | codesys | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 31 (C373) |
| 11 | schneider | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 31 (C373) |
| 11 | wago | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 11 | delta | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 31 (C373) |
| 11 | codesys | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 31 (C373) |
| 11 | schneider | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 31 (C373) |
| 11 | wago | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| 11 | delta | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 31 (C373) |
| 12 | codesys | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 14 (C373) |
| 12 | delta | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 14 (C373) |
| small | codesys | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 10 (C373) |
| small | schneider | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 10 (C373) |
| small | wago | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| small | delta | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 10 (C373) |
| small | codesys | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 10 (C373) |
| small | schneider | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 10 (C373) |
| small | wago | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| small | delta | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 10 (C373) |
| complex | codesys | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 36 (C373) |
| complex | schneider | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 36 (C373) |
| complex | wago | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| complex | delta | classic | ok | MainTask:MAIN | 0 / 0 | 0 / 36 (C373) |
| complex | codesys | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 36 (C373) |
| complex | schneider | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 36 (C373) |
| complex | wago | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 0 |
| complex | delta | oop | ok | MainTask:MAIN | 0 / 0 | 0 / 36 (C373) |
