# PLC Studio

Návrh PLC systému od zadání po kód a dokumentaci — pro malé integrátory, strojírny a údržby.
Workflow: **zadání (AI návrh) → zařízení → I/O → schémata → program → generování kódu → dokumentace projektu**, multiplatformně:

| Platforma | IDE | Výstup |
|---|---|---|
| Siemens SIMATIC | TIA Portal V17–V21 | SCL external sources, SimaticML XML, TSV tagů |
| Rockwell Allen-Bradley | Studio 5000 | ST + CSV import tagů (remark hlavička + 0.3) |
| Beckhoff | TwinCAT 3 | ST POU + GVL |
| CODESYS | V3.5 | ST POU + GVL |
| Mitsubishi | GX Works3 | ST + global labels CSV |
| Schneider | Machine Expert | ST POU + GVL |
| OMRON | Sysmac Studio | ST + tabulka proměnných |
| Unitronics | UniLogic (UniStream) | plochý ST k vložení do ST funkce + seznam tagů k založení — **neověřeno překladem** |

Výkresy: blokové schéma + elektrické zapojení I/O dle zvyklostí ECAD (rámeček s referencemi,
popisové pole, značení `-M1` dle IEC 81346, čísla vodičů `-W1xx`, NC/NO dle IEC 60617) — SVG náhled + **DXF** export.
Dokumentace: FDS, I/O list, svorkovnice, seznam alarmů, FAT protokol, návod k obsluze, SW dokumentace.

**Simulace procesu a ověření programu:** jádro umí návrh odsimulovat scan po scanu stejnou logikou,
jakou generuje kód (stavové automaty bloků, timeouty, sekvence), a projít poruchové scénáře —
výpadek zpětného hlášení v každém kroku, poruchu motoru, nouzové zastavení. Výstupem je funkční
diagram cyklu, časový diagram signálů a protokol `08_overeni_simulaci.md`. Ověřuje se návrh, ne kód
přeložený v cílovém IDE — test v simulátoru platformy a FAT to nenahrazuje.

**Příklady:** složka `samples/` obsahuje 12 příkladových strojů (pás s vyhazovačem, míchací nádrž, nýtovací lis,
úpravna vody, paletizační buňka, lakovací linka, transferová lisovna, montážní linka s otočným stolem, plnicí linka
nápojů, výrobní hala se 143 zařízeními) — otevřou se přes „Otevřít projekt…" a všechny procházejí generováním
a ověřením simulací (`node scripts/check_samples.mjs`).

**Jazyky:** čeština, angličtina, němčina, španělština a čínština — přepínač v hlavičce webu i desktopu
mění jazyk rozhraní i generovaných výstupů (dokumentace, README, hlášení simulace, diagramy). Komentáře
v generovaném kódu a texty výkresů zůstávají v latince: při čínštině jsou anglicky. Obsah projektu
(názvy a popisy zařízení) se nepřekládá. Překlady jsou strojové s oborovým slovníkem — před předáním
zákazníkovi je vhodné nechat je projít rodilým mluvčím. Postup pro vývojáře viz `CLAUDE.md`.

> ⚠️ Generované výstupy jsou **návrh k revizi**. Bezpečnostní funkce (E-stop, kryty, dvouruční
> ovládání) musí řešit certifikovaná safety technika dle ISO 13849 / IEC 62061 — nikdy jen program.

## Struktura repozitáře

```
packages/core     jádro (TypeScript, bez závislostí): model, generátory, import, výkresy, dokumentace
apps/web          demo shell nad jádrem + prototype.html (plné workflow UI z prototypu)
apps/desktop      desktopová aplikace (Python + tkinter) nad stejným jádrem — viz apps/desktop/README.md
```

## Vývoj

```bash
pnpm -C packages/core build    # tsc → dist
pnpm -C packages/core test     # node --test (bez externích závislostí)
pnpm web                       # build + statický server nad apps/web
apps\desktop\PLCStudio.bat     # desktopová aplikace (Python 3.9+ s tkinter, Node 18+)
```

`apps/web/prototype.html` je původní single-file prototyp (claude.ai artifact) s kompletním
workflow UI včetně AI návrháře — referenční implementace pro port do produkční aplikace.

## Roadmapa (MVP → produkt)

1. **Hotovo v core:** generátory pro 8 platforem, P1 opravy správnosti (Rockwell CSV hlavička,
   Siemens TSV tagů, škálování bez NORM_X), validace + sanitizace tagů, výkresy SVG/DXF,
   import (SimaticML, L5X, GVL/ST, CSV/tab), dokumentace, 2 ukázkové projekty, testy.
2. Web app (React + Vite) — port workflow UI z prototypu nad `@plc-studio/core`.
3. API + účty + projekty v DB (Node/Fastify + Postgres), CZ/EN, platby.
4. PLCopen XML export (CODESYS/TwinCAT/Machine Expert jedním souborem).
5. AI návrhář přes server (Anthropic API), AI z fotky P&ID.
6. Openness worker (C#/.NET, Windows + TIA V21): import a kompilace na klik.
7. Firemní knihovny šablon FB, HMI/UDT vrstva.

## Stav znalostí k importům

- Rockwell CSV: formát s `remark` hlavičkou a verzí `0.3` dle dokumentace Studio 5000.
- GX Works3 labels CSV: formát se liší dle verze/lokalizace — před nasazením srovnat
  s exportem z cílové instalace (viz README generované k platformě).
- Unitronics UniLogic: ST funkce nemají vlastní paměť a import tagů bere jen soubory, které
  UniLogic sám vyexportoval — generuje se proto plochý ST (bloky zařízení rozepsané do jedné
  funkce, stav v globálních tazích `instX_*`) a `Tags.csv` jako seznam k ručnímu založení.
  Časovače `TON` a literály `T#` v ST až od vydání UniLogic z května 2026. Výstup nebyl
  přeložen v UniLogic. Vision/Samba (VisiLogic) umí jen Ladder — ST slouží jako předloha.
