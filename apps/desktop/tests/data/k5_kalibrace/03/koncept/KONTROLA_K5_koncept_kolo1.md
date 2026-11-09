# Kontrola K5 — Koncept, kolo 1 (Pneumatický nýtovací lis NL-1)

## Verdikt: **SCHVÁLENO**

TEST – schválení předpokládáno

Kontrolor K5 (jiná role než stavitel). Model nezměněn. Kontrolováno proti zadání, `PLCdesk_CAD.json` (SHA-256 `e83f5faf…2d20`, shoduje se s manifestem uvedeným v konceptu), `ROZBOR.md`, `KUSOVNIK.csv`.

## SHA-256 modelů (začátek = konec, shodné)

| soubor | SHA-256 |
|---|---|
| koncept/Koncept.FCStd | `9e446e35ab1daefe451f4d4e02f4d55fe3880c1071ea10ce7dab2a2e810f27d0` |

Ve složce stroje je jediný `*.FCStd`.

## Kontroly kódem (vlastní běh `pro3d vse`, slot pro3d-k5, `koncept/k5_kolo1/kontroly.json`)

Stav **OK** — chyby 0, varování 0 (shodně s tvrzením stavitele).

| kontrola | stav | poznámka |
|---|---|---|
| Kolize | OK | 43 těles, 0 průniků, kalibrace OK; 0 průniků i v poloze „zadní dveře otevřené 90°“ |
| Souvislost | OK | 1 komponenta, nic ve vzduchu, 4 nohy na podlaze (info: model nemá šrouby, kontrola „bez spoje“ vynechána — u konceptu přijatelné) |
| Otvory ISO 13857 | OK | jediné cesty: štěrbina pod prstovou ochranou e = 6 mm ⇒ Sr ≥ 10 mm, změřeno 43 a 57 mm |
| Kusovník × manifest | OK | všechny řádky „mimo rozsah modelu“ (info) — koncept řádky nepřiřazuje, viz výhrada 2 |
| Zástupné díly | OK | oranžové, `Placeholder = True` |
| STEP export / načtení | OK | |

## Ruční posouzení

- **Soulad se zadáním a manifestem:** funkce F1–F10 odpovídají sekvenci (kroky 1–14) a zařízením Y1–Y4, M1, S1–S6, H1/H2. Varianta A (stůl s uzavřenou zadní kabinou, jeden S4) odpovídá kusovníku bez změny řízení; varianty B a C jsou odůvodněně odmítnuty (počet S4, nová osa). Takt ~12 s ≤ 15 s je označen jako ODHAD.
- **Snímky** (`koncept/k5_kolo1/k5_kolo1_iso.png`, `_iso2`, `_pudorys`, `_celo`) prohlédnuty: sedí s popisem — rám stolu z profilů, lis s C-rámem a válcem Y2 nad přípravkem, kabina s dělicí stěnou vzadu, zásobník vlevo, rozvaděč vpravo, FRL vlevo, maják na stropu kabiny, místo obsluhy zeleně. Zástupné díly oranžově, žádné žluté (dle dokumentace se nepoužívá, `dily/parts_index.json` ve složce neexistuje — je to v pořádku). Obrázek odpovídá číslům.
- **Normalizované díly:** žádný díl se stavem „dle dokumentace“ není k dispozici, koncept používá jen obálky — v souladu s pravidly.
- **Zpětná vazba:** `PLCdesk_CAD_feedback_koncept.json` (10 položek) je věcně správná a odpovídá kusovníku (chybějící válec Y2 + hydraulický rozváděč, S5 typ, M1 pohon zásobníku, K0 × relé IIIC, kabely M8 × M12, H1/H2 jedna věž, předimenzovaný Y4, HMI, příslušenství pneumatiky, rezerva rozvaděče). Kusovník nebyl ve 3D potichu měněn.
- **Bezpečnost (TEST — schválení předpokládáno):** čísla otvorů z skriptu; ISO 13855 výpočet S ≥ 240 mm vs. ~385 mm je proveditelný, T je ODHAD a musí se změřit.
- **Vyrobitelnost / servis:** koncept hrubý; zadní dveře dávají přístup k zásobníku a ventilům.

## Výhrady (nebrání schválení konceptu, musí se vyřešit v dalších fázích)

1. Zakládací zóna je otevřená; Y1 (přidržovač) a Y3 (vyhazovač) se pohybují u ruky a Y3 jede po uvolnění dvouručního ovládání (krok 12). Staviteli navržená opatření (síla Y3 ≤ 150 N, nebo držení dvouručního ovládání do kroku 13) rozhodne posouzení rizik — ne hotové řešení.
2. Řádky kusovníku nemají ve 3D `PLCdesk_Id`; kontrola „Kusovník × manifest“ proto nic neověřila. Přiřazení musí provést fáze Moduly a K5 ho tehdy znovu ověří.
3. Y2 (typ pohonu, rozměry Ø160 × 400) je ODHAD a blokuje fázi Moduly (zpětná vazba `kon-y2-valec`, severity error — rozhoduje uživatel v PLCdesk).
4. Mezera prstové ochrany 6 mm platí jen pro ploché díly (rozměr dílu a nýtu není v zadání).
5. Výška 2,2 m s majákem — ověřit přepravní rozměry.
6. Žádný ze skriptů neověřuje, že obálky odpovídají budoucím modelům výrobců; po výměně obálek za skutečné modely nutno kontroly opakovat.

## Předpoklady (ODHAD)

Převzaty ze stavitele (KONCEPT.md kap. 5); kontrolor žádné nové nepřidal.
