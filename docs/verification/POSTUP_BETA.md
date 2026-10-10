# Postup: převzetí protokolu beta testera → záznam ověření

Platí pro platformy ve stavu `beta` v `data/verification.json` (k 2026-10-10 Siemens, Rockwell, Mitsubishi,
OMRON). Tester dostane přes aplikaci (krok Platformy → **Balík k ověření**, `packages/core/src/verify_pack.ts`)
ZIP s výstupy vzorů, `NAVOD.md`, šablonu `PROTOKOL.md` a `MANIFEST.json` a pošle zpět vyplněný protokol.
Přihlášky testerů eviduje web (`/beta`, správa `/sprava/#/beta`, `apps/site/worker/beta.js`).

**Zásada: repozitář je veřejný.** Do repa nikdy nepatří jméno, e-mail, firma, telefon testera, licenční ani
sériová čísla IDE, názvy počítačů, cesty s uživatelským jménem, snímky s osobními údaji. Protokol v repu
popisuje prostředí a výsledek, ne člověka. Kontakt na testera zůstává jen ve správě (přihláška) a v poště.

## 1. Přijetí protokolu

1. Zkontroluj, že došel vyplněný `PROTOKOL.md` a **nezměněný** `MANIFEST.json` (verze PLCdesk, platforma,
   commit, otisky SHA-256). Upravené soubory od testera (pokud nějaké) ulož mimo repo.
2. Ověř otisky: soubory, které tester importoval, musí odpovídat `MANIFEST.json` (jinak testoval něco jiného —
   vyžádej si nový balík). Verze v manifestu ≠ aktuální verze = výsledek platí pro tu starší verzi; když se
   výstup platformy mezitím změnil (golden), napiš to do protokolu.
3. Ve správě `/sprava/#/beta` u přihlášky nastav stav **Hotovo** a do poznámky stručně, co přišlo (bez obsahu
   protokolu). Pokud byla nabídnuta licence, vystav ji tlačítkem **Vystavit licenci Pro na N dní** (formulář
   Nová licence se předvyplní, nic se neodešle bez potvrzení).

## 2. Návrh záznamu a protokolu (skript)

```bash
node scripts/beta_protocol.mjs cesta/PROTOKOL.md cesta/MANIFEST.json --out %TEMP%\beta-navrh
```

Skript (bez závislostí) čte strukturu šablony — pořadí oddílů `##` a tabulek, ne přeložené nadpisy, takže
funguje pro protokol v kterémkoli jazyce aplikace — a vytvoří **návrhy k ruční kontrole**, nic nezapisuje do
`data/` ani `docs/`:

- `zaznam.json` — návrh položky `platforms.<platforma>` pro `data/verification.json`: `state` = `verified`,
  jen když mají všechny vyplněné řádky 0 chyb importu i překladu (jinak stav zůstává), `ide` z tabulky
  Prostředí, `date`, `evidence` s novým protokolem, `formats` — soubor dostane stav `ide`, jen když prošel
  bez chyb ve všech vzorech; `summary` a `notVerified` jsou `TODO` k napsání.
- `<ide>-<verze>.md` — návrh protokolu do `docs/verification/` (prostředí, výsledky, výpis hlášení, ruční
  zásahy, simulace) s hlavičkou NÁVRH.

E-maily a telefonní čísla v textu nahradí `[ODSTRANENO]` a vypíše varování; **jména, firmy, licenční čísla,
názvy počítačů a cesty skript nepozná** — protokol vždy projdi očima. Nesedí-li platforma nebo verze
s manifestem, skript to vypíše.

Bez skriptu postupuj stejně ručně: tabulka Prostředí → `ide` a `date`, tabulka Výsledky → stav a formáty.

## 3. Rozhodnutí o stavu

| výsledek protokolu | stav v `verification.json` |
|---|---|
| import i překlad v IDE výrobce 0 chyb u všech vzorů (varování popsaná) | `verified` (scope jen to, co se zkoušelo: klasika / motion / axis …) |
| chyby importu nebo překladu | zůstává `beta`; nálezy opravit v generátoru a **emulátoru** (dialekt, pravidlo + zdroj), golden vědomě, pak požádat testera o nový balík |
| tester zkoušel jen část (např. bez servoosy) | `verified` jen pro zkoušený rozsah, zbytek do `notVerified` |

Varování IDE nejsou automaticky v pořádku: každé posoudit (vlastnost IDE / chyba výstupu) a zapsat do protokolu.
Rozdíl proti emulátoru (emulátor nehlásil, IDE ano) = chyba emulátoru → doplnit pravidlo a mutační test.

## 4. Zápis do repozitáře (podle CLAUDE.md „Ověření platforem“)

1. `docs/verification/<ide>-<verze>.md` — protokol bez osobních údajů (vzor: `unilogic-1.43.md`,
   `beckhoff-codesys.md`): shrnutí, prostředí (IDE, verze, update, CPU, OS — bez licenčních čísel a jmen počítačů),
   postup, výsledky po vzorech a souborech, ruční zásahy, co zůstává neověřené. Tester se neuvádí (na jeho
   výslovné přání nejvýš jako „beta tester“ bez kontaktu).
2. `data/verification.json` — upravit položku platformy: `state`, `ide` (technický text **bez češtiny**),
   `date` (RRRR-MM-DD), `scope`, `summary` a `notVerified` (česky — jsou klíčem překladu), `evidence`
   (nový protokol), `formats`.
3. `python scripts/build_verification.py --check`, pak `python scripts/build_verification.py`
   (→ `packages/core/src/verification_data.ts`).
4. Build jádra: `pnpm -C packages/core build` (nebo `npx -y -p typescript tsc -p packages/core/tsconfig.json`).
5. Překlady: `python scripts/i18n.py missing en` (a `de`, `es`, `zh`) → přeložit nové `summary` / `notVerified`
   → `python scripts/i18n.py merge <jazyk> soubor.json` → znovu build jádra → `python scripts/i18n.py check`.
6. Testy: `node --test packages/core/dist/verification.test.js` (záznam pro každou platformu, protokoly existují,
   štítek v README × 5 jazyků).
7. Golden **jen README**: `node scripts/golden.mjs --code` — změnit se smí jen otisky `README.txt` dotčené
   platformy (štítek STAV OVĚŘENÍ). Přepsat jen tyto otisky (výběrově, jako commit 4080bac „Golden: jen README
   Beckhoff“), **ne** `--write` na celou referenci. Jiný rozdíl = nevědomá změna výstupu, hledat příčinu.
8. Web: `apps/site/content/{cs,en,de}.json` → `platformy.rows[]` řádek platformy: `state` (musí sedět
   s verification.json, jinak build varuje a deploy se zastaví) a texty `check` (jak ověřeno, verze, datum)
   ve všech třech jazycích; případně úvod stránky Platformy (`platformy.lead`). Pak `cd apps/site && npm run build`
   (0 varování). Platforma, která už není `beta`, sama zmizí ze stránky `/beta`, z formuláře přihlášky
   i z validace `/api/beta`; u přihlášek ve správě zůstane.
9. Aplikace (README platforem, čip v kroku Platformy web i desktop, tlačítko Balík k ověření jen u `beta`)
   se aktualizují samy z `verification_data.ts`.
10. Commit česky bez diakritiky: co ověřeno, kde (IDE a verze), výsledek, „Golden: jen README <platforma>
    (N otisků)“. Tester ani jeho firma v commitu nejsou.

## 5. Po zápisu

- Testerovi poděkovat a napsat, co se změnilo (opravy z jeho nálezů, nový stav platformy).
- Ve správě nechat přihlášku ve stavu Hotovo; karta v kanbanu (pokud vznikla) nese jen firmu a platformy —
  další obchodní kontakt jen po domluvě s testerem.
- Osobní údaje z přihlášky: po skončení testu a vyřízení licence přihlášku smazat nebo anonymizovat podle
  pravidel na stránce Ochrana osobních údajů (mazání ve správě zatím není — TODO provozovatel).
