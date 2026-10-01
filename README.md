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

Výkresy: blokové schéma + elektrické zapojení I/O dle zvyklostí ECAD (rámeček s referencemi,
popisové pole, značení `-M1` dle IEC 81346, čísla vodičů `-W1xx`, NC/NO dle IEC 60617) — SVG náhled + **DXF** export.
Dokumentace: FDS, I/O list, svorkovnice, seznam alarmů, FAT protokol, návod k obsluze, SW dokumentace.

> ⚠️ Generované výstupy jsou **návrh k revizi**. Bezpečnostní funkce (E-stop, kryty, dvouruční
> ovládání) musí řešit certifikovaná safety technika dle ISO 13849 / IEC 62061 — nikdy jen program.

## Struktura repozitáře

```
packages/core     jádro (TypeScript, bez závislostí): model, generátory, import, výkresy, dokumentace
apps/web          demo shell nad jádrem + prototype.html (plné workflow UI z prototypu)
```

## Vývoj

```bash
pnpm -C packages/core build    # tsc → dist
pnpm -C packages/core test     # node --test (bez externích závislostí)
pnpm web                       # build + statický server nad apps/web
```

`apps/web/prototype.html` je původní single-file prototyp (claude.ai artifact) s kompletním
workflow UI včetně AI návrháře — referenční implementace pro port do produkční aplikace.

## Roadmapa (MVP → produkt)

1. **Hotovo v core:** generátory pro 7 platforem, P1 opravy správnosti (Rockwell CSV hlavička,
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
