# PLC Studio — kontext pro vývoj

Aplikace pro malé integrátory a strojírny: návrh PLC systému od zadání po kód a dokumentaci.
Workflow: Projekt → AI návrh → Platformy → Zařízení (Import jako vedlejší volba) → I/O → Schéma → Program → Generovat → Dokumentace. Jazyk UI i dokumentace: **čeština** (později i EN).

## Architektura

- `packages/core` — **jádro bez závislostí** (čistý TypeScript, ESM). Vše podstatné žije tady:
  datový model (`model.ts`), generátory kódu (`codegen.ts`), import/reverse engineering
  (`importers.ts`), výkresy ops→SVG/DXF (`drawing.ts`), dokumentace (`docs.ts`), ukázky (`samples.ts`).
  Jádro musí běžet v prohlížeči i Node — žádné závislosti nepřidávat.
- `apps/web` — aplikace: statické HTML + ES moduly nad `packages/core/dist` (bez bundleru,
  záměrně — budoucí přechod na Vite/React je OK, ale core zůstává oddělené).
  `prototype.html` = původní single-file prototyp (referenční), `demo.html` = technické demo jádra.
- Budoucí: `apps/api` (Node + Postgres, účty/projekty), `apps/worker-openness` (C#, Windows + TIA V21).

## Příkazy

```bash
pnpm -C packages/core build   # tsc → dist (dist je commitnutý, po změně core přegeneruj a commitni)
pnpm -C packages/core test    # node --test, 13+ testů, bez závislostí
npx http-server . -p 8080     # → http://localhost:8080/apps/web/
```

## Konvence a pravidla

- Kanonické adresy I/O v Siemens notaci (%I0.0, %IW64); převody per platforma přes `addrFor()`.
- Tagy: `<Zařízení>_<signál>`; `sanitizeTag()`/`validateProject()` hlídá přenositelnost (ASCII pro
  Rockwell/GX Works3/Sysmac). Generovaný kód: stavové automaty s timeouty, statusy 16#0000/8001/8002.
- Výkresy: jedna geometrie (ops) → SVG náhled + DXF R12; konvence ECAD (rámeček, popisové pole,
  -M1 dle IEC 81346, -W1xx čísla vodičů, NC/NO dle IEC 60617). DXF texty bez diakritiky.
- **Bezpečnost: nikdy negenerovat safety logiku** — E-stop je v programu jen informativní signál;
  všude disclaimer „návrh k revizi". Toto pravidlo nerozvolňovat.
- Rockwell CSV: povinná hlavička `remark,…` + řádek `0.3`; žádný WORD (→ INT). GX Works3 CSV
  formát je verzově vrtkavý — před změnou srovnat s reálným exportem.
- AI návrhář: protokol = JSON {questions, devices, estop, seq, note}; instrukce v `apps/web/src/ai.js`
  (`aiInstructions()` — posílá i aktuální sestavu). Ve webu zatím přímé volání Anthropic API
  s klíčem uživatele; v produkci přes backend.
- Commity: česky bez diakritiky, stručný popis změn.

## Roadmapa (pořadí)

1. PLCopen XML (TC6) export — CODESYS/TwinCAT/Machine Expert jedním importovatelným souborem
2. apps/api: účty, projekty v DB, CZ/EN, platby (Stripe)
3. AI přes backend; AI z fotky P&ID
4. Openness worker (import+kompilace do TIA na klik)
5. Firemní knihovny šablon FB, HMI/UDT vrstva

Kontext a rozhodnutí průběžně viz claude.ai projekt „PLC programovani" (koncept, review, produktové zhodnocení).
