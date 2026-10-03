# PLCdesk — desktopová aplikace

Nativní okno (Python + tkinter) nad stejným jádrem jako webová aplikace. Stejné
workflow: Projekt → AI návrh → Platformy → Zařízení (+ Import) → I/O → Schéma →
Program → Generovat → Dokumentace, plus Nápověda.

## Spuštění

- dvojklik na `PLCdesk.bat` (starší `PLCStudio.bat` funguje dál) (nebo zástupce na ploše — vytvoří ho `make_shortcut.ps1`),
- nebo z příkazové řádky: `python -m plc_studio` v adresáři `apps/desktop`.

Potřebuje **Python 3.9+ s tkinter** a **Node 18+** (jádro běží v Node). Žádné balíčky
se neinstalují; Pillow je volitelný (generování ikony, snímky při `--smoke`; logo v hlavičce zatím není).

## Jak to drží pohromadě

```
plc_studio/app.py        okno, stav, navigace, ukládání
plc_studio/steps/*.py    jeden modul na krok (render(app, parent))
plc_studio/bridge.py     trvalý proces Node ─┐
bridge.mjs               JSON po řádcích ────┴─► packages/core/dist + apps/web/src/ai.js
plc_studio/svgview.py    výkresy z jádra (SVG) kreslené na tk.Canvas — klikací, se zvýrazněním
plc_studio/detail.py     panel zařízení: rozcestník mezi schématy, I/O a programem
plc_studio/mimic.py      grafické schéma systému pro živou simulaci (vodiče, animace funkce)
plc_studio/theme.py      paleta a ttk styly (vizuál nástrojů PearTec)
```

**Logika se do Pythonu nekopíruje.** Generátory, výkresy, dokumentace, import i instrukce
pro AI zůstávají v `packages/core` a `apps/web/src/ai.js`; desktop je jen další UI.
Nová funkce jádra je z Pythonu dostupná hned: `app.core("jmenoFunkce", …)`.
Operace, které potřebují víc kroků nad stejnými objekty (schémata), jsou v `bridge.mjs`.

Importéry SimaticML/L5X potřebují `DOMParser`; v Node ho nahrazuje malý XML parser
v `bridge.mjs` (bez závislostí).

## Data uživatele

`%APPDATA%\PLCStudio\` (přesměruje proměnná `PLCSTUDIO_HOME`):

- `state.json` — rozpracovaný návrh, AI konverzace, aktuální krok (ukládá se průběžně),
- `settings.json` — poloha okna, poslední složka, **API klíč AI v čitelné podobě**,
- `plc_studio.log`, `bridge.log` — chyby.

Soubor projektu `*.plcstudio.json` je zaměnitelný s „Export návrhu (JSON)" z webu.

## Testy

```bash
python -m unittest discover -s tests -v    # most, výkresy, kroky GUI (otevře okno)
python -m plc_studio --smoke               # projde všechny kroky a skončí
python -m plc_studio --smoke --shots DIR   # + snímky kroků (Pillow)
```

Testy nahrazují dialogy i volání AI — nic neposílají na API a zapisují jen do dočasných složek.

## Provázané pohledy

Výkresy z jádra nesou odkazy (`data-dev`, `data-mod`, `data-io`, `data-step`) a popis v `<title>`.
`svgview.py` je čte a staví na nich interaktivitu: zvýraznění souvisejících prvků při najetí,
bublinu s popisem, klik (`on_click`) a značky stavu (`marker`).

- **Blokové schéma** — klik na zařízení otevře panel (`detail.py`): popis, vstupy a výstupy,
  kroky programu. Tag vede do kroku I/O, svorka na list zapojení, krok do funkčního diagramu.
  Klik na modul PLC otevře jeho list zapojení.
- **Funkční diagram cyklu** — kroky sekvence, podmínky přechodu a časy z běžného cyklu.
- **Elektrické zapojení** — klik kamkoli do řádku kanálu ukáže odkazy na zařízení a I/O.
- Stejné odkazy jsou u vybraného řádku v krocích Zařízení a I/O a ve svorkovnici.

Cíl odkazu se předává přes `app.open_device / open_io / open_block / open_flow / open_wiring /
open_program / open_sim` — krok si výběr vyzvedne z `app.ui` při vykreslení.

## Živá simulace (krok Program)

`steps/ziva.py`: systém řízený tlačítky, ve dvou pohledech — grafické schéma (`mimic.py`:
symboly zařízení propojené vodiči s kanály modulů PLC, animovaná funkce) a bloky zařízení
(`svgMachine` z jádra). Simulátor (`Simulator` v `sim.ts`) žije v procesu mostu — operace
`live.start` ho založí, `live.step` posune čas a převezme stav tlačítek. Aplikace ho krokuje
v reálném čase (50 ms × rychlost).

Tlačítka odpovídají proměnným generovaného programu: `modeAuto`, `cmdAutoStart`, `cmdAck`,
centrální uvolnění a ruční povely `manRun_*` / `manOpen_*`. Zásahy do zařízení (zamrzlé hlášení,
vstup poruchy, volný vstup, analogová hodnota) simulují stroj. Dávková `simulate()` běží nad
stejnou třídou, takže živá simulace a scénáře nemohou dávat různé výsledky.

Vstupy se ovládají **přímo ve schématu** (`mimic.py`, `on_force` / `on_analog`): popisek každého
digitálního vstupu zařízení je tlačítko (klik = přepnout a vnutit, `↺` = zpět stroji, „Uvolnit vše"
v liště), analogový snímač má otočný potenciometr (tažení, kolečko, dvojklik = polovina rozsahu).
Vnucení jde do `SimControls.force` — hodnota přebije model stroje i ostatní zásahy, model pod ní
běží dál a po uvolnění se vstup vrátí k jeho stavu; potenciometr nastavuje `SimControls.ai`.

`mimic.py` staví statickou kresbu jednou (a znovu při změně měřítka) a v `update()` jen přebarvuje
a posouvá prvky podle snímku: barva a „tok" vodiče podle hodnoty signálu, píst válce podle polohy
z modelu stroje (`frame.dev[id].pos`), rotor motoru, páka kontaktu, kontrolka, sloupec měření.

## Scénáře a ověření (krok Program)

Simulátor je v jádře (`sim.ts`); `steps/simulace.py` výsledek jen přehrává: aktivní krok na
funkčním diagramu, stavy bloků, události, časový diagram s kurzorem. Záložka **Ověření programu**
spustí všechny scénáře (`verifyProject`) a nálezy jdou přehrát. Model stroje (rozběh motoru,
přestavení ventilu) se ukládá do projektu (`prj.sim`), takže platí i pro protokol v dokumentaci.

## Rozdíly proti webu

- Klikací schémata, panel zařízení, funkční diagram a přehrávač simulace má jen desktop; web
  dostal nové soubory v kroku Dokumentace a bubliny ve schématech.

- Projekt se otevírá/ukládá jako soubor; soubory se ukládají dialogem, „vše" do složky.
- Import je v dialogu (tlačítko v kroku Zařízení); po převzetí importu se smaže sekvence
  a E-stop, protože zařízení mají nová id.
- Před zahozením rozpracovaného návrhu (ukázka, nový projekt, import) se aplikace zeptá.
