# PLC Studio — kontext pro vývoj

Aplikace pro malé integrátory a strojírny: návrh PLC systému od zadání po kód a dokumentaci.
Workflow: Projekt → AI návrh → Platformy → Zařízení (Import jako vedlejší volba) → I/O → Schéma → Program → Generovat → Dokumentace → Kusovník. Jazyky UI i výstupů: **čeština (zdrojová), angličtina, němčina, španělština, čínština** — viz „Vícejazyčnost".

## Architektura

- `packages/core` — **jádro bez závislostí** (čistý TypeScript, ESM). Vše podstatné žije tady:
  datový model (`model.ts`), generátory kódu (`codegen.ts`), import/reverse engineering
  (`importers.ts`), výkresy ops→SVG/DXF (`drawing.ts`), dokumentace (`docs.ts`), ukázky (`samples.ts`),
  simulace procesu a ověření programu (`sim.ts`), funkční a časový diagram (`flow.ts`),
  kusovník komponent (`bom.ts` + katalog `catalog.ts` / `catalog_data.ts`), odkazy na dokumentaci
  platforem (`platform_refs.ts`).
  Jádro musí běžet v prohlížeči i Node — žádné závislosti nepřidávat.
- `apps/web` — aplikace: statické HTML + ES moduly nad `packages/core/dist` (bez bundleru,
  záměrně — budoucí přechod na Vite/React je OK, ale core zůstává oddělené).
  `prototype.html` = původní single-file prototyp (referenční), `demo.html` = technické demo jádra.
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
pnpm -C packages/core test    # node --test, 29+ testů, bez závislostí
npx -y -p typescript tsc -p packages/core/tsconfig.json   # build bez pnpm (ověřeno: tsc 7 dává shodný dist)
npx http-server . -p 8080     # → http://localhost:8080/apps/web/
# desktop (z apps/desktop; na vývojové stanici pinovat Python311, ne bare `python`):
python -m plc_studio                       # spuštění; bez konzole PLCStudio.bat
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

## Příklady a ověření simulací

- `samples/*.plcstudio.json` — 12 příkladových strojů od pásu se 6 zařízeními po výrobní halu se 143
  zařízeními a 85 kroky (formát = uložený projekt desktopu / export webu). Každý musí projít
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
  `prune`. Po přidání textu: `missing` → přeložit → `merge` → build jádra. Úplnost hlídají testy
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
  -M1 dle IEC 81346, -W1xx čísla vodičů, NC/NO dle IEC 60617). DXF texty bez diakritiky.
- **Bezpečnost: nikdy negenerovat safety logiku** — E-stop je v programu jen informativní signál;
  všude disclaimer „návrh k revizi". Toto pravidlo nerozvolňovat.
- **Řízení stroje v generovaném kódu:** režimy `modeAuto` (AUTO / ručně), start `cmdAutoStart`,
  kvitace `cmdAck` (→ vstup `reset` všech bloků), ruční povely `manRun_*` / `manOpen_*` (jen mimo
  AUTO; bez sekvence vždy). Porucha kteréhokoli bloku nebo vypršení hlídacího času kroku
  (`timeS` u přechodu na zpětné hlášení) nastaví `machineFault` (+ `faultStep`): sekvence do
  kroku 0, povely vypnout, nový start až po kvitaci. Poruchy bloků drží do kvitace; stop / zavřít
  funguje i během rozběhu / otevírání. Toto chování popisuje i FDS, seznam alarmů a FAT —
  při změně držet kód, simulátor a dokumentaci pohromadě.
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
- Rockwell CSV: povinná hlavička `remark,…` + řádek `0.3`; žádný WORD (→ INT). GX Works3 CSV
  formát je verzově vrtkavý — před změnou srovnat s reálným exportem.
- AI návrhář: protokol = JSON {questions, devices, estop, seq, note}; instrukce v `apps/web/src/ai.js`
  (`aiInstructions()` — posílá i aktuální sestavu). Ve webu zatím přímé volání Anthropic API
  s klíčem uživatele; v produkci přes backend. Model je volitelný: známé modely + seznam dostupných pro klíč (`GET /v1/models`, na klik, neúčtuje se) + vlastní ID — web `AI_MODELS` v `ai.js`, desktop `ai_client.KNOWN_MODELS`, držet shodně.
- Commity: česky bez diakritiky, stručný popis změn.

## Roadmapa (pořadí)

1. PLCopen XML (TC6) export — CODESYS/TwinCAT/Machine Expert jedním importovatelným souborem
2. apps/api: účty, projekty v DB, CZ/EN, platby (Stripe)
3. AI přes backend; AI z fotky P&ID
4. Openness worker (import+kompilace do TIA na klik)
5. Firemní knihovny šablon FB, HMI/UDT vrstva

Kontext a rozhodnutí průběžně viz claude.ai projekt „PLC programovani" (koncept, review, produktové zhodnocení).
