# PLCdesk

Návrh PLC systému od zadání po kód a dokumentaci — pro malé integrátory, strojírny a údržby.
Workflow: **zadání (AI návrh) → zařízení → I/O → schémata → program (simulace a ověření) → generování kódu → dokumentace → kusovník**, multiplatformně:

| Platforma | IDE | Výstup |
|---|---|---|
| Siemens SIMATIC | TIA Portal V17–V21 | SCL external sources, SimaticML XML, TSV tagů |
| Rockwell Allen-Bradley | Studio 5000 | **L5X** (Add-On Instructions + tagy + rutina ST v dialektu Logix, import jedním krokem) + Tags.csv |
| Beckhoff | TwinCAT 3 | **PLCopen XML** (import jedním souborem) + ST POU + GVL (AT %I* pro linkování) |
| CODESYS | V3.5 | **PLCopen XML** + ST POU + GVL |
| Mitsubishi | GX Works3 | ST + global labels CSV |
| Schneider | Machine Expert | **PLCopen XML** + ST POU + GVL |
| OMRON | Sysmac Studio | ST + tabulka proměnných |
| Unitronics | UniLogic (UniStream) | plochý ST k vložení do ST funkce + seznam tagů k založení — **neověřeno překladem** |

Výkresy: blokové schéma + elektrické zapojení I/O dle zvyklostí ECAD (rámeček s referencemi,
popisové pole, značení `-M1` dle IEC 81346, čísla vodičů `-W1xx`, NC/NO dle IEC 60617) — SVG náhled + **DXF** export.
Dokumentace: FDS, I/O list, svorkovnice, seznam alarmů, FAT protokol, návod k obsluze, SW dokumentace,
protokol ověření simulací, kusovník (MD + CSV pro Excel), koncept řešení (když je zvolen).

**Kusovník komponent:** z návrhu vznikne kusovník s označením dle IEC 81346 (PLC a moduly platformy, díly
každého zařízení, rozvaděč) a s typickými značkami, typy a dodavateli z katalogu (rešerše českého trhu se
zdroji, `data/catalog/`); verze PRO na něj naváže stavbou zařízení v CADu.

**Verifikace generovaného kódu:** výstupy všech platforem jsou ověřené proti manuálům výrobců, parserem
TwinCAT ST (blark) a schématem PLCopen TC6; skutečný import do IDE ověřený není — README každé platformy
uvádí nejkratší test.

**Simulace procesu a ověření programu:** jádro umí návrh odsimulovat scan po scanu stejnou logikou,
jakou generuje kód (stavové automaty bloků, timeouty, sekvence), a projít poruchové scénáře —
výpadek zpětného hlášení v každém kroku, poruchu motoru, nouzové zastavení. Výstupem je funkční
diagram cyklu, časový diagram signálů a protokol `08_overeni_simulaci.md`. Ověřuje se návrh, ne kód
přeložený v cílovém IDE — test v simulátoru platformy a FAT to nenahrazuje.

**Příklady:** složka `samples/` obsahuje 12 příkladových strojů (pás s vyhazovačem, míchací nádrž, nýtovací lis,
úpravna vody, paletizační buňka, lakovací linka, transferová lisovna, montážní linka s otočným stolem, plnicí linka
nápojů, výrobní hala se 125 zařízeními a 120 kroky) — otevřou se přes „Otevřít projekt…" a všechny procházejí generováním
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
apps/web          webová aplikace (statické HTML + ES moduly nad packages/core/dist, bez build kroku)
apps/desktop      desktopová aplikace (Python + tkinter) nad stejným jádrem — viz apps/desktop/README.md
```

## Vývoj

```bash
pnpm -C packages/core build    # tsc → dist
pnpm -C packages/core test     # node --test (bez externích závislostí)
pnpm web                       # build + statický server z kořene → http://localhost:8080/apps/web/
apps\desktop\PLCdesk.bat       # desktopová aplikace (Python 3.9+ s tkinter, Node 18+; PLCStudio.bat zůstává)
```

`apps/web/prototype.html` je původní single-file prototyp (claude.ai artifact) — historický, workflow
už plně převzala webová aplikace (`index.html`) a desktop; logika v něm je zastaralá (7 platforem).

## Roadmapa (MVP → produkt)

1. **Hotovo:** generátory pro 8 platforem ověřené proti manuálům (L5X pro Rockwell, PLCopen XML pro
   CODESYS rodinu), simulace a ověření (matice stavů, časové hledisko), web + desktop, 5 jazyků,
   kusovník s katalogem, 12 příkladů, výkresy SVG/DXF, dokumentace, koncepty řešení v jádře.
2. **Rozpracováno:** import stávajícího zařízení (exporty a programy z PLC zpětně, schémata a fotky přes AI).
3. UI konceptů řešení; IEC 61131-10 XML pro GX Works3 / Sysmac.
4. API + účty + projekty v DB (Node/Fastify + Postgres), platby; AI přes server.
5. Openness worker (C#/.NET, Windows + TIA V21): import a kompilace na klik.
6. Verze PRO: stavba zařízení v CADu (Cimatron) z kusovníku; firemní knihovny šablon FB, HMI/UDT vrstva.

## Stav znalostí k importům

- Rockwell: hlavní cesta L5X (Import Program); Tags.csv s `remark` hlavičkou a verzí `0.3` dle RM014 jako náhradní cesta.
- GX Works3 labels CSV: formát se liší dle verze/lokalizace — před nasazením srovnat
  s exportem z cílové instalace (viz README generované k platformě).
- Unitronics UniLogic: ST funkce nemají vlastní paměť a import tagů bere jen soubory, které
  UniLogic sám vyexportoval — generuje se proto plochý ST (bloky zařízení rozepsané do jedné
  funkce, stav v globálních tazích `instX_*`) a `Tags.csv` jako seznam k ručnímu založení.
  Časovače `TON` a literály `T#` v ST až od vydání UniLogic z května 2026. Výstup nebyl
  přeložen v UniLogic. Vision/Samba (VisiLogic) umí jen Ladder — ST slouží jako předloha.
