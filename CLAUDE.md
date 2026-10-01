# PLC Studio — kontext pro vývoj

Aplikace pro malé integrátory a strojírny: návrh PLC systému od zadání po kód a dokumentaci.
Workflow: Projekt → AI návrh → Platformy → Zařízení (Import jako vedlejší volba) → I/O → Schéma → Program → Generovat → Dokumentace. Jazyk UI i dokumentace: **čeština** (později i EN).

## Architektura

- `packages/core` — **jádro bez závislostí** (čistý TypeScript, ESM). Vše podstatné žije tady:
  datový model (`model.ts`), generátory kódu (`codegen.ts`), import/reverse engineering
  (`importers.ts`), výkresy ops→SVG/DXF (`drawing.ts`), dokumentace (`docs.ts`), ukázky (`samples.ts`),
  simulace procesu a ověření programu (`sim.ts`), funkční a časový diagram (`flow.ts`).
  Jádro musí běžet v prohlížeči i Node — žádné závislosti nepřidávat.
- `apps/web` — aplikace: statické HTML + ES moduly nad `packages/core/dist` (bez bundleru,
  záměrně — budoucí přechod na Vite/React je OK, ale core zůstává oddělené).
  `prototype.html` = původní single-file prototyp (referenční), `demo.html` = technické demo jádra.
- `apps/desktop` — desktopová aplikace: Python + tkinter (vizuál nástrojů PearTec), stejné workflow
  jako web. **Logiku nekopíruje** — volá `packages/core/dist` a `apps/web/src/ai.js` přes trvalý
  proces Node (`bridge.mjs`, JSON po řádcích); výkresy z jádra kreslí na `tk.Canvas`.
  Změna v jádře se v desktopu projeví sama, nový krok/prvek UI je potřeba doplnit ve webu i tady.
  Desktop má navíc proti webu: klikací schémata s panelem zařízení a odkazy mezi kroky, funkční
  diagram cyklu a přehrávač simulace s ověřením (web z toho má jen nové soubory v kroku Dokumentace
  a bubliny `<title>` ve schématech).
- Budoucí: `apps/api` (Node + Postgres, účty/projekty), `apps/worker-openness` (C#, Windows + TIA V21).

## Příkazy

```bash
pnpm -C packages/core build   # tsc → dist (dist je commitnutý, po změně core přegeneruj a commitni)
pnpm -C packages/core test    # node --test, 21+ testů, bez závislostí
npx -y -p typescript tsc -p packages/core/tsconfig.json   # build bez pnpm (ověřeno: tsc 7 dává shodný dist)
npx http-server . -p 8080     # → http://localhost:8080/apps/web/
# desktop (z apps/desktop; na vývojové stanici pinovat Python311, ne bare `python`):
python -m plc_studio                       # spuštění; bez konzole PLCStudio.bat
python -m unittest discover -s tests -v    # most + výkresy + kroky GUI, bez volání API
python -m plc_studio --smoke               # projde všechny kroky a skončí
```

## Konvence a pravidla

- Kanonické adresy I/O v Siemens notaci (%I0.0, %IW64); převody per platforma přes `addrFor()`.
- Tagy: `<Zařízení>_<signál>`; `sanitizeTag()`/`validateProject()` hlídá přenositelnost (ASCII pro
  Rockwell/GX Works3/Sysmac). Generovaný kód: stavové automaty s timeouty, statusy 16#0000/8001/8002.
- Výkresy: jedna geometrie (ops) → SVG náhled + DXF R12; konvence ECAD (rámeček, popisové pole,
  -M1 dle IEC 81346, -W1xx čísla vodičů, NC/NO dle IEC 60617). DXF texty bez diakritiky.
- **Bezpečnost: nikdy negenerovat safety logiku** — E-stop je v programu jen informativní signál;
  všude disclaimer „návrh k revizi". Toto pravidlo nerozvolňovat.
- **Simulace = zrcadlo generátoru.** `sim.ts` provádí scan po scanu logiku, kterou generuje
  `codegen.ts` (FB_Motor/FB_Ventil, timeouty, CASE sekvence, pořadí enable → sekvence → TON →
  instance). Při změně šablon bloků nebo `seqBody` uprav i `sim.ts`; shodu timeoutů a podmínek
  přechodu hlídají testy. Simulace ověřuje návrh, ne kód v cílovém IDE — tuhle výhradu z UI ani
  z protokolu `08_overeni_simulaci.md` neodstraňovat.
- Schémata (SVG) nesou odkazy `data-dev` / `data-mod` / `data-io` / `data-step` a popis v `<title>`;
  DXF je ignoruje. Interaktivní náhledy na nich stojí — při úpravě výkresů je zachovat.
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
