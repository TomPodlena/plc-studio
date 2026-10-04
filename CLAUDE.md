# PLCdesk — kontext pro vývoj

Aplikace pro malé integrátory a strojírny: návrh PLC systému od zadání po kód a dokumentaci.
**Produkt se jmenuje PLCdesk** (rozhodnutí uživatele 2026-10-03, dříve „PLC Studio“) — tak všude ve
viditelných textech (titulky, UI, dokumenty, README, komentáře generovaného kódu, DXF, L5X `PLCdesk_*.L5X`).
Interní názvy zůstávají: repo `plc-studio`, adresáře, balíček `@plc-studio/core`, Python balíček
`plc_studio`, `PLCSTUDIO_HOME`, data uživatele `%APPDATA%\PLCStudio`, klíče `localStorage` `plcstudio.*`,
přípona `.plcstudio.json`, spouštěč `PLCStudio.bat` (nově i `PLCdesk.bat`). Import přijímá i výstupy
se starým názvem.
Workflow: Projekt → AI návrh → Platformy → Zařízení (Import jako vedlejší volba) → I/O → Schéma → Program → Generovat → Dokumentace → Kusovník. Jazyky UI i výstupů: **čeština (zdrojová), angličtina, němčina, španělština, čínština** — viz „Vícejazyčnost".

## Architektura

- `packages/core` — **jádro bez závislostí** (čistý TypeScript, ESM). Vše podstatné žije tady:
  datový model (`model.ts`), generátory kódu (`codegen.ts`), import/reverse engineering
  (`importers.ts`), výkresy ops→SVG/DXF (`drawing.ts`), dokumentace (`docs.ts`), ukázky (`samples.ts`),
  simulace procesu a ověření programu (`sim.ts`), funkční a časový diagram (`flow.ts`),
  kusovník komponent (`bom.ts` + katalog `catalog.ts` / `catalog_data.ts`), odkazy na dokumentaci
  platforem (`platform_refs.ts`), schvalování (`approval.ts`), oživení (`commission.ts`), bezpečnostní
  funkce a program (`safety*.ts`), PLCopen XML (`plcopen.ts`), L5X (`logix.ts`), koncepty (`concept.ts`),
  emulace překladu a běhu (`emu/`), HMI (`hmi*.ts`), revize (`revision.ts`), nabídka (`quote.ts`),
  firemní knihovna (`library.ts`), exporty SISTEMA (`sistema.ts`) a EPLAN (`eplan.ts`).
  Jádro musí běžet v prohlížeči i Node — žádné závislosti nepřidávat.
- `apps/web` — aplikace: statické HTML + ES moduly nad `packages/core/dist` (bez bundleru,
  záměrně — budoucí přechod na Vite/React je OK, ale core zůstává oddělené).
  `prototype.html` = původní single-file prototyp (historický, zastaralý), `demo.html` = technické demo jádra.
- `apps/desktop` — desktopová aplikace: Python + tkinter (vizuál nástrojů PearTec), stejné workflow
  jako web. **Logiku nekopíruje** — volá `packages/core/dist` a `apps/web/src/ai.js` přes trvalý
  proces Node (`bridge.mjs`, JSON po řádcích); výkresy z jádra kreslí na `tk.Canvas`.
  Změna v jádře se v desktopu projeví sama, nový krok/prvek UI je potřeba doplnit ve webu i tady.
  Desktop má navíc proti webu: klikací schémata s panelem zařízení a odkazy mezi kroky, funkční
  diagram cyklu, živou simulaci (grafické schéma systému s vodiči a animací funkce, tlačítka
  AUTO / START / E-STOP / kvitace, ruční povely) a přehrávač
  scénářů s ověřením (web z toho má jen nové soubory v kroku Dokumentace a bubliny `<title>`).
- Budoucí: `apps/api` (Node + Postgres, účty/projekty), `apps/worker-openness` (C#, Windows + TIA V21).

## Příkazy

```bash
pnpm -C packages/core build   # tsc → dist (dist je commitnutý, po změně core přegeneruj a commitni)
pnpm -C packages/core test    # build + node --test dist/*.test.js: 139 testů v 8 souborech (~75 s), bez závislostí
node --test "packages/core/dist/*.test.js"   # totéž bez buildu; testy berou samples/ a test-data/ relativně k dist
npx -y -p typescript tsc -p packages/core/tsconfig.json   # build bez pnpm (ověřeno: tsc 7 dává shodný dist)
npx http-server . -p 8080     # → http://localhost:8080/apps/web/
# desktop (z apps/desktop; na vývojové stanici pinovat Python311, ne bare `python`):
python -m plc_studio                       # spuštění; bez konzole PLCdesk.bat (PLCStudio.bat zůstává)
python -m unittest discover -s tests -v    # most + výkresy + kroky GUI, bez volání API
python -m plc_studio --smoke               # projde všechny kroky a skončí
python scripts/i18n.py check               # texty v kódu × katalogy překladů (viz Vícejazyčnost)
node scripts/check_samples.mjs [soubor -v]  # příklady samples/: generování 8 platforem + ověření simulací
node --test scripts/samples.test.mjs        # totéž jako regresní test (~30 s)
```

## Funkce stroje v modelu (generátor ↔ simulátor ↔ ověření)

- **Krok čekání na vstup** `act: "waitOn" | "waitOff"`, `dev` = DI, `timeS` = hlídací čas
  (`seqCond` → kind `fbk`). Simulátor modeluje proces: stav přijde `DI_DELAY` (0,5 s) po vstupu do
  kroku a drží se do konce cyklu (pak klidová hodnota).
- **Role DO** (`Device.role`, `DO_ROLES`, `roleExpr` v generátoru, `roleValue` v simulátoru):
  run / fault / ready / stopped / lock / auto. Výstupy s rolí se nepočítají mezi „sepnuté výstupy".
- **Meze AnalogIn** `limHi` / `limLo` → `limitHi/limitLo` bloku, alarm je součástí `machineFault`
  (fault blok i simulace); v simulaci je běžná hodnota uprostřed pásma mezí.
- **Žádaná hodnota AnalogOut** `setpoint`; **takt** `meta.takt` → ověření porovná cyklus.
- Ventil hlídá drženou polohu (ztráta `fbkOpen` ve stavu OPEN = porucha).
- Při změně kteréhokoli z nich držet pohromadě codegen, sim, docs (FDS, alarmy) a testy.

## Kusovník komponent (základní verze; stavba v CADu = verze PRO)

- `buildBom(prj)` (`bom.ts`): položky z návrhu s označením dle IEC 81346 — PLC a moduly platformy
  `bomPlatform()` (Unitronics: HMI v CPU, kombinovaný AI/AO modul), ke každému zařízení jeho díly
  (motor → `-Q` jistič motoru + `-K` stykač, válec → rozváděč + válec + snímače polohy, analog podle
  jednotky a popisu…), rozvaděč. Bezpečnostní prvky jen jako HW řádek `safety` s výhradou
  „EN ISO 13849, návrh k revizi" — **žádná bezpečnostní logika**. Výstupy `bomCsv` (středník, BOM
  pro český Excel), `bomMd`; v dokumentaci `09_kusovnik.md/.csv`.
- Volby uživatele `prj.bom` = `{ plat, brand: {catKey: optId|vlastní}, lines: {id: {brand, type,
  orderCode, supplier, qty, note}} }`; `BomLine.id` (označení + kategorie) je stabilní — naváže na
  něj CAD (Cimatron) ve verzi PRO. Výchozí značka = shodná s platformou PLC, jinak první v katalogu.
- Katalog: rešerše se zdroji v `data/catalog/*.json` → `python scripts/build_catalog.py` generuje
  `catalog_data.ts` (+ `platform_refs.ts` z `data/platform_refs.json`); objednací kód jen s URL
  zdroje, ceny se neuvádějí; české popisy jsou klíče překladu (N_). Po přegenerování build jádra,
  `i18n.py missing/merge`, testy. Desktop: krok `steps/kusovnik.py` + operace mostu `bom`, `refs`.

## Import stávajícího zařízení (reverse engineering + AI)

- **Přesně, bez AI** (`reverse.ts` + `importers.ts`): `extractFiles(InputFile[]) → Extracted`
  (signály, POU, odhad platformy, `unparsed` pro AI), `inferProject(ex) → ImportProposal` (projekt +
  `evidence` ke každé položce `dev:/io:/seq:/estop/lock:/meta` s jistotou sure/guess/missing a zdrojem
  soubor:řádek, `conflicts`, `missing`), `mergeProposals(přesný, ai)` (přesné má přednost, adresa od AI
  jen se zdrojem). Formáty: vlastní výstupy všech 8 platforem (round-trip test 14 projektů × 8 × 5 jazyků
  beze změny) + exporty IDE: SimaticML (tagy i bloky Openness), SCL/STL/AWL, .sdf, L5X/L5K/CSV (aliasy
  modulů), PLCopen XML (ST, FBD vazby, LD, **SFC → sekvence**), TwinCAT .TcPOU/.TcGVL/.tsproj/.xti
  (TcLinkTo), GX Works CSV, Sysmac, Unitronics, I/O listy CSV/TSV ve více jazycích. Binární projekty
  (.ACD, .zap, .gxw, .smc2…) → `unparsed` s doporučeným textovým exportem. Reálná data (licence MIT/BSD/
  Apache) v `packages/core/test-data/real/`; hodnocení na 36 veřejných projektech (jobs tmp `realdata/eval.mjs`).
- **AI** (`apps/web/src/import_ai.js`, desktop přes most `import.*` + `ai_client.call_full`): PDF/obrázky
  jako document/image bloky, dělení velkých podkladů na navazující dotazy, `estimateImport` (cena PŘED
  odesláním — placené, uživatel potvrzuje), `importNorm` (evidence povinná, bez zdroje = missing; adresy
  jen doložené), dílčí výsledek při chybě/Stop. E-stop a kryty jen jako signály — nikdy rekonstruovat
  bezpečnostní okruh ani logiku.
- **Průvodce** (web `import_wizard.js`, desktop `importer.py`): Podklady → Rozpoznáno → Analýza AI
  (volitelná) → Kontrola a převzetí (jistota barevně, citace zdroje, konflikty, chybí, odškrtnutí
  zařízení) → projekt + předvyplněný krok AI návrh. Vstup z kroku Projekt i Zařízení.

## Příklady a ověření simulací

- `samples/*.plcstudio.json` — 12 příkladových strojů od pásu se 6 zařízeními po výrobní halu se 125
  zařízeními a 120 kroky (formát = uložený projekt desktopu / export webu). Každý musí projít
  `check_samples.mjs`: validace, kód pro všech 8 platforem (párování IF/CASE/FB, ASCII u Unitronics
  a DXF, deklarované identifikátory), dokumentace, ověření bez nálezu `error` a matice bez ✖.
- `verifyProject()`: běžný cyklus, poruchové scénáře, **kontrola konceptu** (vstupy, které program
  nečte, výstupy, které neovládá, měření bez mezí, pohony mimo cyklus, blokování bez NC) a **matice
  stavů** (`stateMatrix`: klid, ruční režim a každý krok × E-stop, každé blokování, vypnutí AUTO
  — ve třech okamžicích kroku —, zamrzlé hlášení, porucha a ztráta hlášení pohonu, ztráta polohy
  ventilu, analog mimo mez; reakce musí odpovídat FDS), **časové hledisko** (takt, rezerva
  hlídacích časů ≥ 20 %), druhý cyklus. Zásahy navazují z kontrolních bodů
  běžného cyklu (`Checkpoints`, `Simulator.clone()`) — test hlídá shodu se simulací od začátku.
  Výsledek se cachuje (projekt × volby × jazyk). Simulátor zapisuje vstupy stroje přes `setModel`
  (sledování změn) a snímky ukládá jen při změně stavu — při úpravách scanu to dodržet.

## Emulace překladu a běhu (`src/emu/`)

- `emulateCompile(prj, plat)` ověří **skutečný výstup `genFor`** (SCL, ST, L5X, plochý ST UniLogic):
  lexer + parser IEC 61131-3 (`lexer.ts`, `parser.ts`), načtení souborů platformy (`load.ts`) a pravidla
  dialektů se zdrojem u každého pravidla (`dialects.ts`: `EMU_DIALECTS`, `EMU_RULES`, `EMU_SRC`) →
  `EmuFinding` (error / warn / info, soubor:řádek:sloupec). `emulateRun` / `emulateRunMany` / `emulateAll`
  přeložený kód spustí scan po scanu proti modelu stroje simulátoru ve scénářích `verifyProject`
  (`emuScenarios`) a porovná chování kód ↔ návrh (`diffs`); `emulateFiles` / `emulateRunFiles` pro
  vlastní soubory. Cache podle otisku přeloženého programu (komentáře a jazyk ho nemění).
- Testy (`emu.test.ts`): 12 příkladů × 8 platforem × 5 jazyků bez chyby překladu a bez rozdílu proti
  návrhu, mutační testy (vložené chyby kódu musí emulátor chytit), výkon `emulateAll` největšího příkladu.
- **Emulátor ≠ překladač výrobce.** Výhradu nese dokument `15_emulace_prekladu.md` (`emuDocMd`) i každé UI,
  které výsledek ukáže — neodstraňovat; reálný import v IDE je dál nutný. Dokument je opt-in:
  `registerEmuModule()` (import jádra nic nepřihlašuje; celá matice je výpočetně drahá).
- Běh staví program přes `new Function` (`compile.ts`). Stránka s CSP bez `'unsafe-eval'` ho zakáže →
  kontrola překladu funguje dál, běh vrátí nález `runtime` („Interní chyba emulátoru…“), nespadne.
  Při nasazení webu s CSP buď povolit `'unsafe-eval'`, nebo běh emulace pouštět ve workeru / v desktopu.

## HMI (`hmi.ts`, `hmi_view.ts`, `hmi_export.ts`, `hmi_docs.ts`, `hmi_xlsx.ts`)

- Jeden model `buildHmi(prj)` → tagy, alarmy, obrazovky. **Nic se neopisuje:** tagy řízení z deklarací
  generátoru (`ctrlDecls`), proměnné bloků ze šablon (`parseFbTemplate`), alarmy = `docAlarmCsv` (stejné
  kódy a texty), kroky = `stepTitle` / `stepCondText`. Každý tag ukazuje na proměnnou, kterou program
  deklaruje (test: příklady × platformy × jazyky). Program se kvůli HMI nemění — meze a žádané hodnoty
  jsou v HMI jen ke čtení (globální proměnné pro zápis = fáze 2).
- Výstupy: SVG náhledy obrazovek, `hmiJson`, webové HMI `hmiWebHtml`, exporty výrobců `hmiFiles(prj, plat)`
  (WinCC: Openness XML + listy Excel přes vlastní zápis .xlsx `hmi_xlsx.ts`; FactoryTalk View CSV/XML;
  CODESYS / Machine Expert Visu; TwinCAT HMI; GT Designer3; Sysmac NA; Unitronics bez exportu) se stavem `unverified` / `reference` / `stub` a zdroji (`hmiExportSpec`).
  Dokument `16_hmi.md` a soubory se přidají po `registerHmiModule()` (opt-in, klienti ve fázi 3).

## Revize a změnové řízení (`revision.ts`)

- `createRevision(prj, kdo, poznámka)` → `prj.revisions` (označení A, B… nebo 01, 02…; zmrazený obsah bez
  revizí/schválení/oživení a stav schválení `approvalsAt`). `diffProjects(a, b)` / `diffRevisions` /
  `changesSinceRevision`: změny po položkách, třída kosmetická / funkční / bezpečnostní; dotčené položky
  ze **skutečných otisků** `approval.ts` (levně `maybe`, `exact` spustí ověření). `retestScope()` = NÁVRH
  rozsahu opakovaných zkoušek (FAT, kroky oživení, validace bezpečnostních funkcí) — potvrzuje člověk.
- Přihlašuje se sám při importu: `17_zmeny.md` (jen s revizí) a sloupec Rev popisového pole výkresů
  (`setSheetRevision`, bez revize „0.1“).

## Nabídka a firemní knihovna (`quote.ts`, `library.ts`)

- **Nabídka** (interní podklad): kusovník oceněný **vlastním ceníkem uživatele** (`parsePriceList` — český
  Excel se středníkem, desetinná čárka, měna ve sloupci/záhlaví; párování objednací kód → typ+značka →
  kategorie) + odhad hodin z projektu × sazby uživatele (`QUOTE_PARAM_INFO` vysvětluje parametry).
  **Ceny se nikdy nevymýšlí** — bez ceníku / kurzu / sazby prázdné a položka v `unpriced`. `18_nabidka.md`
  jen na volbu `prj.quote.inDocs`. Testovací ceník: `test-data/quote/` (kořen `test-data/` = podklady importu).
- **Knihovna** (`plcdesk-library`, verze `LIBRARY_SCHEMA`; export/import, kopie v `prj.library`): vlastní
  typy zařízení (díly kusovníku přes `registerBomProvider`, časy kroků), šablony FB se **stejným
  rozhraním** jako vestavěné (`validateFbTemplate`, ST jen ASCII), firemní hlavička, výchozí volby.
  `libraryOverrides(prj, plat)` říká, co nahradit — zapojení do `genFor` je fáze 2; simulace dál zrcadlí
  vestavěné šablony (vlastní blok simulací ověřen není).

## Exporty SISTEMA a EPLAN (`sistema.ts`, `eplan.ts`)

- **SISTEMA**: `sistemaModel` (funkce → subsystémy → kanály → bloky, označení shodná s kusovníkem a výkresem
  bezpečnostního okruhu) → `.ssm` (XML tiOPF, struktura SISTEMA 2.0.8 / ISO 13849-1:2015, kontrola proti
  `ssm_21.xsd`), `sistemaCsv` (předpis pro ruční zadání), `19_sistema.md` (porovnání PL PLCdesk × SISTEMA).
  Kategorie a PL se v SISTEMA potvrzují ručně. Stav `SISTEMA_VERIFIED` = neověřeno importem.
- **EPLAN**: AutomationML AR APC 1.4.0 (`eplanAml`), seznam zařízení z kusovníku, svorky `-X<n>:<k>` a vodiče
  (`wireNo`) shodné s výkresy; stav `EPLAN_VERIFIED` = neověřeno importem (licence není). AML v2 = fáze 2.
- Oba exporty se přihlašují s bezpečnostním modulem (`addSafetyRegistration`). Testy používají pomůcky
  `exp_util.test.ts` (příklady, přísná kontrola well-formed XML).

## Vícejazyčnost

- **Zdrojový jazyk je čeština a český text je klíčem překladu** (jako gettext). Chybějící překlad
  vrátí češtinu. Česky se proto píše dál normálně — jen přes překladovou funkci:
  - jádro a web: `tr("Krok {n}: {title}", { n, title })`, `trx(…)`, `N_(…)` z `packages/core/src/i18n.ts`,
  - desktop: `_("Krok {n}: {title}", n=…, title=…)`, `N_(…)` z `apps/desktop/plc_studio/i18n.py`.
- Argument je vždy **jeden řetězcový literál** (žádné `+`, `${…}`, f-řetězec) — proměnné části jako
  `{jméno}`; jinak ho sběr klíčů nevidí. Klíč je celá věta / popisek / odstavec, struktura
  (HTML, Markdown tabulky, `\n`) zůstává mimo. Tabulky na úrovni modulu se jen označí `N_()`
  a přeloží při použití (`tr(CLS[c].label)`, `platInfo()`, `clsInfo()`).
- `tr` = texty pro lidi (UI, dokumentace, README, hlášení simulace, diagramy). `trx` = technické
  výstupy, které musí zůstat v latince — **komentáře generovaného kódu a texty výkresů (DXF)**;
  při čínštině vrací angličtinu. Výstup pro Unitronics a DXF je ASCII v každém jazyce.
- Komentáře šablon bloků (`SCL_MOTOR`…) se překládají až ve výstupu (`trComments`); jejich texty
  musí být v seznamu `TPL_COMMENTS` (hlídá test).
- Katalogy: `packages/core/src/i18n/{en,de,es,zh}.ts` (tělo = JSON, společné pro jádro, web
  i desktop — desktop dostane katalog z mostu v `init`). Udržuje je `scripts/i18n.py`:
  `check` (chybějící / přebývající klíče, zástupné znaky), `missing <jazyk>`, `merge <jazyk> soubor.json`,
  `prune`. Sběr klíčů prochází `packages/core/src` rekurzivně (i `emu/`; bez testů a katalogů `i18n/`),
  `apps/web/src`, `bridge.mjs` a `plc_studio/`. Testy jádra překlady neberou odjinud než z katalogů. Po přidání textu: `missing` → přeložit → `merge` → build jádra. Úplnost hlídají testy
  (jádro: žádná čeština ve výstupech jiných jazyků; desktop: `CatalogTest` a průchod všemi kroky).
- Jazyk je stav jádra (`setLang`); desktop ho drží v `settings.json`, web v `localStorage`
  (`plcstudio.lang`, parametr adresy `?lang=en`). **Obsah projektu se nepřekládá** (názvy, popisy,
  komentáře I/O — vznikají v jazyce platném při vytvoření). Prompt AI návrháře zůstává český,
  jen dostane pokyn, v jakém jazyce psát texty pro uživatele.
- Logika nesmí záviset na přeloženém textu (porovnávat stavy / klíče, ne popisky).
- Nový jazyk: přidat do `Lang`, `LANGS`, `DICT` a `LOCALE` v `i18n.ts`, do `LANGS` ve
  `scripts/i18n.py` a v `plc_studio/i18n.py`, založit katalog a přeložit; testy jazyky berou
  z `LANGS` (desktopový test má jejich seznam vypsaný).
- Pevné šířky tlačítek a výběrů počítat z délky přeloženého textu (německé popisky jsou
  nejdelší) a Tk proměnné widgetů držet živé (`StringVar` bez reference uklidí GC a pole zbělá).

## Konvence a pravidla

- Kanonické adresy I/O v Siemens notaci (%I0.0, %IW64); převody per platforma přes `addrFor()`.
- Tagy: `<Zařízení>_<signál>`; `sanitizeTag()`/`validateProject()` hlídá přenositelnost (ASCII pro
  Rockwell/GX Works3/Sysmac). Generovaný kód: stavové automaty s timeouty, statusy 16#0000/8001/8002.
- Výkresy: jedna geometrie (ops) → SVG náhled + DXF R12; konvence ECAD (rámeček, popisové pole,
  -M1 dle IEC 81346, čísla vodičů, NC/NO dle IEC 60617). DXF texty bez diakritiky.
  **Čísla vodičů** jen z `wireNo(xnum, kanál)` (model.ts): stovky = svorkovnice X<n> → X1:1 = -W101,
  X2:3 = -W203, X10:1 = -W1001 — unikátní v projektu a stabilní při změně jiného modulu. Používají ho
  výkresy, svorkovnice (`svorkyCSV`, sloupec Vodič; tabulky Schéma ve webu i desktopu) a `eplan.ts`;
  unikátnost a shodu na všech příkladech hlídá test v `eplan.test.ts`.
- **Navrhovat vše, platí jen schválené** (rozhodnutí uživatele 2026-10-03, nahrazuje dřívější „nikdy
  negenerovat safety logiku“): aplikace NAVRHUJE procesní logiku, bezpečnostní funkce (nebezpečí, PLr,
  architektura, komponenty, zapojení) včetně **bezpečnostního programu** pro bezpečnostní PLC z
  certifikovaných bloků, ladění i oživení — a každou položku nechá **schválit** odpovědnou osobou (jméno,
  datum, poznámka; `approval.ts`). Schválení se váže na otisk obsahu — změna = znovu ke schválení.
  Neschválené výstupy nesou výrazně NESCHVÁLENO; bezpečnostní program se generuje až po schválení
  bezpečnostních funkcí. „Alibismus není na místě“: nestačí odkázat na normu — navrhnout, zdůvodnit
  (zdroj), hlídat chybějící a neschválené. Bezpečnostní logika patří do bezpečnostního PLC / relé, ne do
  standardního programu: tam E-stop a blokování zůstávají jen stavové signály (enable, kvitace).
  Validaci na stroji (ISO 13849-2) aplikace plánuje a protokoluje, ale provádí ji člověk.
- **Řízení stroje v generovaném kódu:** režimy `modeAuto` (AUTO / ručně), start `cmdAutoStart`,
  kvitace `cmdAck` (→ vstup `reset` všech bloků), ruční povely `manRun_*` / `manOpen_*` (jen mimo
  AUTO; bez sekvence vždy). Porucha kteréhokoli bloku nebo vypršení hlídacího času kroku
  (`timeS` u přechodu na zpětné hlášení) nastaví `machineFault` (+ `faultStep`): sekvence do
  kroku 0, povely vypnout, nový start až po kvitaci. Poruchy bloků drží do kvitace; stop / zavřít
  funguje i během rozběhu / otevírání. Toto chování popisuje i FDS, seznam alarmů a FAT —
  při změně držet kód, simulátor a dokumentaci pohromadě.
- **Dialekty platforem (ověřeno proti manuálům výrobců 2026-10-03, zprávy v jobs tmp `verify/`):**
  `END_IF;` se středníkem všude (GX Works3, Sysmac a Logix ho vyžadují); text uživatele do
  komentářů `(* *)` jen přes `cmtSafe()` (CODESYS/TwinCAT komentáře vnořují); označení zařízení
  i tagy musí být identifikátory (validace = error, duplicity bez ohledu na velikost písmen).
  Siemens: `.scl`/`.tsv` s BOM, časovače `TON_TIME`, kultura komentáře v XML dle jazyka.
  Beckhoff: `AT %I*` / `%Q*` (linkování), CODESYS/Schneider: `%IW` = index slova (bajt/2).
  Mitsubishi FX5: X/Y osmičkově, bez počátečních hodnot (meze a `rawMax` se předávají vždy),
  TON max. 32 767 ms. Omron: vstup `reset` → `resetIn` (Reset je instrukce Sysmac), Variables.txt
  ve sloupcích Global Variables. `rawMax` analogů dle platformy (`RAW_MAX`). Rockwell: L5X
  (`logix.ts`) — Logix ST není IEC (TONR/FBD_TIMER, AOI, bez deklarací v textu).
- **Unitronics (UniLogic / UniStream):** ST funkce nemá paměť a FB v ST nejsou → generuje se
  plochý ST (`Machine.st`) a seznam tagů (`Tags.csv`). Logika bloků se **neopisuje** — vzniká
  z týchž šablon `ST_MOTOR` / `ST_VENTIL` / … přes `parseFbTemplate()` + `inlineFb()` + `uniDialect()`,
  takže změna šablony se propíše sama. Výstup je čisté ASCII a **není ověřen překladem**
  v UniLogic (README to uvádí) — po prvním překladu u uživatele doplnit zjištěné odchylky dialektu.
- **Simulace = zrcadlo generátoru.** `sim.ts` (třída `Simulator`, jeden `scan()` = jeden scan
  programu; nad ní dávková `simulate()` i živá simulace v desktopu) provádí logiku, kterou generuje
  `codegen.ts` (FB_Motor/FB_Ventil, timeouty, CASE sekvence, pořadí enable → sekvence → TON →
  instance → porucha stroje). Vnější zásahy jdou jen přes `SimControls` (AUTO, start, kvitace,
  E-stop, ruční povely, poruchy, vnucené hodnoty vstupů `force`) — nepřidávat tam nic, co
  generovaný program nečte. Vstupy mají dvě vrstvy: `model` (stav podle stroje) a `io` (co čte
  program = `force`, jinak `model`) — model stroje zapisuje jen do `model`.
  Podmínky přechodu kroků má generátor i simulátor z jediné funkce `seqCond()`.
  Při změně šablon bloků nebo `seqBody` uprav i `sim.ts`; shodu timeoutů a podmínek
  přechodu hlídají testy. Simulace ověřuje návrh, ne kód v cílovém IDE — tuhle výhradu z UI ani
  z protokolu `08_overeni_simulaci.md` neodstraňovat.
- Schémata (SVG) nesou odkazy `data-dev` / `data-mod` / `data-io` / `data-step` a popis v `<title>`;
  DXF je ignoruje. Interaktivní náhledy na nich stojí — při úpravě výkresů je zachovat.
- Rockwell: hlavní výstup je L5X (`logix.ts`: AOI ze šablon přes `lxDialect`, TONR/FBD_TIMER s PRE v ms, WORD → DINT, analogy REAL 0–100 %, kontrola `logixProblems`); Tags.csv jako náhradní cesta — povinná hlavička `remark,…` + řádek `0.3`, ASCII popisy s escapováním `$`, aliasy na body modulů 5069. GX Works3 CSV
  formát je verzově vrtkavý — před změnou srovnat s reálným exportem.
- AI návrhář: protokol = JSON {questions, devices, estop, seq, note}; instrukce v `apps/web/src/ai.js`
  (`aiInstructions()` — posílá i aktuální sestavu). Ve webu zatím přímé volání Anthropic API
  s klíčem uživatele; v produkci přes backend. Model je volitelný: známé modely + seznam dostupných pro klíč (`GET /v1/models`, na klik, neúčtuje se) + vlastní ID — web `AI_MODELS` v `ai.js`, desktop `ai_client.KNOWN_MODELS`, držet shodně.
- Commity: česky bez diakritiky, stručný popis změn.

## PLCopen XML a koncepty řešení (sloučeno z main 2026-10-03)

**PLCopen XML (TC6)** (`src/plcopen.ts`): `genFor()` (zůstává v `codegen.ts`) pro codesys /
beckhoff / schneider přidává `PLCopen_Import.xml` a README ho uvádí jako nejrychlejší cestu.
XML se staví z **finálního textu** `Gen_Library.st` (`splitLibrary`) a `MAIN.st` téže platformy
(`parseStPou`) — ne ze surových šablon — takže import = ručně vložené soubory (ruční povely,
porucha, `cmtSafe`, `rawMax`, adresy `addrFor` vč. `%I*` u TwinCATu). Ověřeno: well-formed a
schéma TC6 v2.01 (Beremiz `tc6_xml_v201.xsd`, ns přepsán) na 14 projektech × 3 platformy;
**reálný import v CODESYS / TwinCAT zatím neověřen** — nálezy zapsat sem.
Úkoly v app (z handoffu main): proklikat krok Generovat (PLCopen_Import.xml se zobrazí a stáhne
sám — Generovat i Dokumentace iterují přes soubory), volitelně badge „doporučeno".

**Dále přibyla AI nadstavba KONCEPTŮ** (`src/concept.ts`, dist přegenerován):
`conceptInstructions(prj)` + `conceptNorm()` + typ `SolutionConcept` + `conceptMd(prj)`;
`Project.concept` nese zvolenou variantu; FDS a dokumentace (`10_koncept_reseni.md`, jen když je
koncept zvolen — `CONCEPT_FILE` v docs.ts) se propisují automaticky; nadpisy přes `tr`, prompt dostává
pokyn k jazyku výstupu. Úkol pro app (apps/web):
4. Krok „AI návrh" rozdělit na dva režimy (přepínač nahoře):
   a) **Koncept** — textarea zadání → aiCall s `conceptInstructions(prj)` (nový helper
      v ai.js vedle aiInstructions) → `conceptNorm` → vykreslit 2–3 varianty jako karty
      (název, shrnutí, architektura, pohony, bezpečnost, HMI, odhad I/O, platformy,
      rizika, pracnost) + tlačítko „Zvolit koncept" → uloží `prj.concept = {...variant,
      zadani: <první zpráva uživatele>}` a předvybere `prj.platforms` dle
      doporucenePlatformy; konverzace konceptu má vlastní turns (S.aiConcept).
   b) **Sestava zařízení** — stávající chování; `aiInstructions()` rozšířit, aby při
      existujícím prj.concept přikládala i koncept jako kontext (JSON.stringify(prj.concept)).
   Zvolený koncept zobrazit i v kroku Projekt (řádek s názvem + odkaz na dokument).

## Roadmapa (pořadí)

Hotovo: PLCopen XML (TC6), import stávajících zařízení (reverse + AI, delta protokol), kusovník,
bezpečnostní funkce + program po schválení, schvalování, oživení, web PLCdesk (apps/site, Cloudflare
workers.dev, licenční API, Stripe/Paddle), přenosná verze 0.1.0 (GitHub Releases).

**Fáze 1 — ✅ hotovo 2026-10-04 (integrace jádra: překlady sloučené, dist, testy; UI nových modulů = fáze 3):**
1. Emulátory překladu a běhu všech 8 platforem (`emu/`) — dialektová kontrola skutečného kódu + interpret
   proti modelu stroje (kód ↔ návrh); emulátor ≠ překladač výrobce
2. HMI (`hmi.ts`) — tagy, alarmy, obrazovky, exporty WinCC / FactoryTalk / CODESYS Visu / GT / NA / web HMI
3. Revize a změnové řízení (`revision.ts`) — diff verzí, zpráva o změnách, rozsah opakovaných zkoušek
4. Nabídka (`quote.ts`) — ceník uživatele, odhad hodin, interní podklad; firemní knihovna (`library.ts`)
5. Exporty SISTEMA (`sistema.ts`) a EPLAN (`eplan.ts`, AutomationML + seznamy)

**Fáze 2:** servoosy (PLCopen Motion) a pohony po síti (PROFINET / EtherCAT, IO-Link, vzdálené I/O);
volitelný styl kódu „OOP“ pro CODESYS / TwinCAT / WAGO (rozhraní, metody, ošetření chyb, pokyny k tasku)
+ WAGO jako varianta CODESYS — vše ověřené emulátory. Navazuje na fázi 1: knihovna FB do `genFor`
(`libraryOverrides`), globální proměnné pro zápis z HMI (meze, žádané hodnoty), FX5 časovače nad 32,7 s.
**EPLAN AML v2** (zadání `docs/eplan-aml-export.md`): perzistentní `guid` v modelu (Project, Device,
modul, IoEntry — přidělit při vzniku, doplnit při načtení starých projektů; nikdy negenerovat až při
exportu), hierarchie stanice/rack/slot, sítě a porty s InternalLink v nejbližším společném rodiči,
vlastnosti EPLAN (§7), vícejazyčné funkční texty, kontrola unikátnosti UDT+adresa. Licenci EPLAN nemáme
→ bez zlatého vzorku; ověření = vlastní strukturální kontrola (§13), XSD CAEX 2.15 + knihovna AR APC,
import v PLCnext Engineer (zdarma). Výstup zůstává „neověřeno importem do EPLAN“. Katalog EPLAN part
number (§11) až s přístupem k EPLAN Data Portal.
**Fáze 3:** napojení do webu a desktopu, kontrola aktualizací (podpis instalátoru = placený certifikát,
až po schválení), překlady, testy, commit.
**Dál:** licence v aplikaci (Free 64 I/O, aktivace přes API); reálné ověření importu v CODESYS / TwinCAT
(zdarma) a virtuální oživení se soft PLC (OPC UA / Modbus TCP); IEC 61131-10 XML pro GX Works3 / Sysmac;
Openness worker (TIA na klik); apps/api (účty, projekty v DB); AI přes backend, AI z fotky P&ID.

Kontext a rozhodnutí průběžně viz claude.ai projekt „PLC programovani" (koncept, review, produktové zhodnocení).
