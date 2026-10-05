# PLCdesk × Unitronics UniLogic 1.43.369 — ověření výstupu `genFor(prj, "unitronics")` (2026-10-05)

## Shrnutí

- **ST výstup (`Machine.st`) vzorů 00b LL-03, 03 NL-1, 11 PS-11 (pohony fáze 2a) a sampleSmall prošel
  skutečným překladačem ST UniLogicu 1.43.369 s 0 chybami** (`Unitronics.Compiler.Ladder2C`: tokenizace,
  parser, tabulka symbolů, typová kontrola — `STTokenizer` → `STParsers.FuncDeclParser` → `SyntaxTree.Verify`).
- Překladač byl volán z vlastního harnessu (C# / .NET Framework 4) nad knihovnami rozbalené instalace UniLogicu,
  protože GUI UniLogicu bez práv správce nespustíme: projekty ukládá do SQL Server LocalDB (per-machine MSI
  s registrací v HKLM).
- **Harness je citlivý:** 29 vložených chyb (mutace sampleSmall) → překladač UniLogicu hlásí přesně ty chyby,
  které mají být (nedeklarovaný tag, chybí END_IF, REAL→BOOL, INT↔UINT, DINT→INT, duplicitní návěští CASE,
  špatný parametr TON…).
- Emulátor PLCdesk (`emulateCompile`) hlásí u všech 4 projektů 0 chyb + 1 varování `tag-table` (TON jako
  globální tag) = shoda. Na mutacích 3 rozdíly dialektu (návrh oprav emulátoru níže; generátor opravu nepotřebuje).

## Prostředí a postup

1. Instalátor bez registrace: UniLogicSetup_1_43_Build_369.exe ze stránky výrobce
   <https://www.unitronicsplc.com/software-unilogic-for-programmable-controllers/> (verze 1.43.369, 810 262 504 B).
2. Obal 7z SFX → InstallShield → MSI → administrativní instalace (`msiexec /a … TARGETDIR=…`, jen kopie
   souborů, bez registrace produktu). Nápověda `UniLogicHelp.chm` rozbalena jako text.
3. Vygenerovány `Machine.st`, `Tags.csv`, `README.txt` vzorů výše (`genFor`).
4. Harness: funkce = `FUNCTION Machine : BOOL` + `VAR_EXTERNAL` ze všech tagů Tags.csv (UniLogic tak sám skládá
   „Used Globals“ — nápověda ST_Editor: *"The tag is added as VAR_EXTERNAL"*) + tělo Machine.st + `END_FUNCTION`.
   Typy: BIT→BOOL, INT16→INT, UINT16→UINT, REAL, TON.

Skripty harnessu a pracovní soubory leží mimo repozitář. Mimo pracovní složku se nic nezapsalo, žádné procesy
nezůstaly běžet.

### Co harness simuluje (a co ne)

- Projekt (ShellServices.CurrentProject / SolutionExplorer / ladder) je nahrazen prázdnými atrapami.
  **TON** = systémový UDT (`SystemUserDefinedTypes.TONUDTId`, v `UserDefinedType.FB_MAP` jako ST funkční blok);
  členy IN, PT, Q, ET jsou v atrapě složeny ručně (skutečná definice je v databázi projektu) → zápis do `ton.Q`
  harness nepozná.
- **Neproběhlo:** generování C (`CompileFunctionBody` potřebuje členy UDT z databáze), GCC, volání funkce
  z Ladderu, import tagů, download. Post-processing `ParseFunction` sahá na databázi (LocalDB); harness bere
  úspěšný parse + Verify jako konec (chyby se zapíší před tímto místem).

## Výsledky — výstupy PLCdesk

| projekt | ST překladač UniLogic 1.43.369 (parse + Verify) | emulateCompile |
|---|---|---|
| 00b LL-03 | **0 chyb** | 0 chyb, 1 varování tag-table (TON globálně) |
| 03 NL-1 | **0 chyb** | 0 chyb, 1 varování tag-table |
| 11 PS-11 (pohony 2a) | **0 chyb** | 0 chyb, 1 varování tag-table |
| sampleSmall | **0 chyb** | 0 chyb, 1 varování tag-table |

## Kontrolní mutace (sampleSmall) — UniLogic × emulátor

| mutace | UniLogic 1.43 | emulátor PLCdesk | shoda |
|---|---|---|---|
| m01 nedeklarovaný tag | Unknown Identifier | undeclared | ano |
| m02 chybí END_IF | Expected 'END_IF' | syntax | ano |
| m03 REAL→BOOL, m14 INT→BOOL, m20 BOOL→INT | Cannot convert | type-conv error | ano |
| m04 REAL→INT | Cannot convert REAL to INT | type-conv error | ano |
| **m05 `END_IF` bez `;`** | **přijato** | warn „vyžaduje END_IF;“ | **ne** (text nepravdivý) |
| m06 `16#8001`, m07 MOD, m08 XOR, m09 ABS, m10 SEL, m15 RETURN, m16 `T#5s`, m25 WHILE | přijato | 0 / warn RETURN | ano |
| **m11 vnořený komentář `(* a (* b *) c *)`** | **přijato** | error syntax | **ne** |
| m12 TON bez parametru, m13 `PT := 5000` | chyba | fb-param / type-conv | ano |
| m17 INT→REAL, m28 UINT→REAL | přijato | 0 | ano |
| **m18 INT→UINT, m19 UINT→INT** | **Cannot convert** | warn | **ne** (přísnější je UniLogic) |
| **m26 DINT→INT, m27 UDINT→UINT** | **Cannot convert** | warn | **ne** |
| m21 70000 → INT, m29 −1 → UINT | chyba | literal-range | ano |
| m22 duplicitní návěští CASE | Duplicate label | case-label | ano |
| m23 `IF <INT>` | Cannot convert INT to BOOL | condition | ano |
| m24 zápis `tonSeq10.Q` | (atrapa UDT neumí read-only) | 0 | neověřeno |

## Návrhy oprav (v tomto kroku neopraveno)

Emulátor (`packages/core/src/emu/dialects.ts`, profil `unitronics`):
1. Převody: UniLogic 1.43 odmítá implicitní zúžení i INT↔UINT (m18, m19, m26, m27) → chyba místo varování.
2. `END_IF` bez středníku UniLogic přijme (m05) → nehlásit varování (generátor `;` píše dál).
3. Vnořené komentáře pro unitronics povolit (m11).
4. ABS / SEL / MOD / XOR / RETURN / 16# UniLogic 1.43 přijímá (omezení v šablonách je kvůli Logixu).

Generátor / README Unitronics:
- V 1.43 se položka jmenuje **Add ST Function** (nápověda ST_Editor).
- TON v ST: verze 1.43 je má (nápověda IEC_Function_Blocks). Převody: IEC `TO_INT` ořezává k nule, `TO_INT_UNI_`
  zaokrouhluje.
- Nápověda deklaruje instance FB ve `VAR` funkce a píše, že bloky *"maintain internal data across scan cycles"* —
  ověřit v GUI; pokud ano, šel by TON deklarovat lokálně místo globálního tagu typu TON.
- Tags.csv: UniLogic importuje jen soubor, který sám exportoval (*"You can only import a file that has been
  exported from UniLogic"*) — po prvním exportu šablony z GUI lze generátor naučit psát přímo ten formát.

## Neověřeno

Import tagů a ST v GUI UniLogicu, Build (fáze C / GCC), volání funkce z Ladderu, TON jako globální tag, download
a běh na UniStreamu.

## Co udělat v GUI (s právy správce, ~20 min)

1. Nainstalovat UniLogic 1.43 jako správce (doinstaluje LocalDB 2019 a VC++). Účet ani licence nejsou potřeba.
2. New Project → UniStream (CPU dle kusovníku PLCdesk).
3. Tagy: PLC → Import/Export → Export global tags do Excelu, doplnit řádky podle `Tags.csv`, Import zpět.
4. Solution Explorer → modul → **Add ST Function** `Machine`; Properties → **Used Globals** → všechny tagy
   z Tags.csv; obsah `Machine.st` vložit pod `(*User code starts below this comment)`.
5. Hlavní Ladder: funkci `Machine` volat každý scan. Když TON nejde jako globální tag, deklarovat ho lokálně
   a ověřit, že drží stav mezi scany.
6. Build / Verify a nálezy zapsat do `data/verification.json` a sem.
