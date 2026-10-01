# PLC Studio — desktopová aplikace

Nativní okno (Python + tkinter) nad stejným jádrem jako webová aplikace. Stejné
workflow: Projekt → AI návrh → Platformy → Zařízení (+ Import) → I/O → Schéma →
Program → Generovat → Dokumentace, plus Nápověda.

## Spuštění

- dvojklik na `PLCStudio.bat` (nebo zástupce na ploše — vytvoří ho `make_shortcut.ps1`),
- nebo z příkazové řádky: `python -m plc_studio` v adresáři `apps/desktop`.

Potřebuje **Python 3.9+ s tkinter** a **Node 18+** (jádro běží v Node). Žádné balíčky
se neinstalují; Pillow je volitelný (logo v hlavičce, generování ikony, snímky při `--smoke`).

## Jak to drží pohromadě

```
plc_studio/app.py        okno, stav, navigace, ukládání
plc_studio/steps/*.py    jeden modul na krok (render(app, parent))
plc_studio/bridge.py     trvalý proces Node ─┐
bridge.mjs               JSON po řádcích ────┴─► packages/core/dist + apps/web/src/ai.js
plc_studio/svgview.py    výkresy z jádra (SVG) kreslené na tk.Canvas
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

## Rozdíly proti webu

- Projekt se otevírá/ukládá jako soubor; soubory se ukládají dialogem, „vše" do složky.
- Import je v dialogu (tlačítko v kroku Zařízení); po převzetí importu se smaže sekvence
  a E-stop, protože zařízení mají nová id.
- Před zahozením rozpracovaného návrhu (ukázka, nový projekt, import) se aplikace zeptá.
