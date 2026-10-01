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

## Aktuální handoff pro lokální Claude Code (2026-10-01)

Do core přibyl **PLCopen XML (TC6) export** (`src/plcopen.ts` + `src/generate.ts`,
`genFor` se přestěhoval z codegen.ts do generate.ts; dist je přegenerovaný a commitnutý).
`genFor()` teď pro codesys/beckhoff/schneider vrací navíc `PLCopen_Import.xml` —
**web app ho zobrazí automaticky** (Generovat i Dokumentace iterují přes soubory).
Úkoly k převzetí v app:
1. `git pull`, proklikat krok Generovat (CODESYS/Beckhoff/Schneider) — ověřit, že se
   PLCopen_Import.xml zobrazuje, stahuje a README zmiňuje import jedním souborem.
2. Ideálně ověřit reálný import souboru do CODESYS V3.5 / TwinCAT (Project → Import
   PLCopenXML) na ukázkové lince; nálezy zapsat sem do CLAUDE.md.
3. Volitelné: v kroku Generovat zvýraznit PLCopen_Import.xml jako doporučenou cestu
   (badge „doporučeno") pro tyto tři platformy.

**Dále přibyla AI nadstavba KONCEPTŮ** (`src/concept.ts`, dist přegenerován):
`conceptInstructions(prj)` + `conceptNorm()` + typ `SolutionConcept` + `conceptMd(prj)`;
`Project.concept` nese zvolenou variantu; FDS a dokumentace (08_koncept_reseni.md)
se propisují automaticky. Úkol pro app (apps/web):
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

1. ~~PLCopen XML (TC6) export~~ ✅ hotovo v core (viz handoff výše)
2. apps/api: účty, projekty v DB, CZ/EN, platby (Stripe)
3. AI přes backend; AI z fotky P&ID
4. Openness worker (import+kompilace do TIA na klik)
5. Firemní knihovny šablon FB, HMI/UDT vrstva

Kontext a rozhodnutí průběžně viz claude.ai projekt „PLC programovani" (koncept, review, produktové zhodnocení).
