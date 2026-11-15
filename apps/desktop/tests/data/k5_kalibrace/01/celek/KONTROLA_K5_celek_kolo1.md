# Kontrola K5 — Celek a PLM, kolo 1 (Kontrolor K5)

TEST – schválení předpokládáno

## Verdikt: **SCHVÁLENO**

Podklad: nezávislý běh `pro3d.ps1 vse` (slot pro3d-k5) → `celek/k5_kolo1/kontroly.json`: **Stav OK, chyby 0, varování 15**, SHA-256 modelu v kontroly.json `5a5b4a2d…99f1d` = hash souboru. Model nebyl měněn.

## SHA-256 (začátek = konec, shodné)
| soubor | SHA-256 |
|---|---|
| celek/Celek.FCStd | 5a5b4a2d3dd754a9b6367ad6008d29430db391f8bed8ed26107459e3a3699f1d |
| ram/Ram.FCStd | 675af9a5d943629c8a8c0f1a7dfb3a4b5bc5e99fc7bb0363381ef2f9ef655b40 |
| moduly/Moduly.FCStd | c120cfaed3c7d10ad91cfc704c71e5b40f49aa3b968922aa5f60087abd1f7c7b |
| rozvadec/Rozvadec.FCStd | 11fc771a53e641bb2670260fcc2b1422d9209bcee99f7d36671ee7d8d6b585d4 |
| koncept/Koncept.FCStd | 2335e3115df86bdb8c6a1b6a123e1c45906b61ca2e53ff9ba8b3a2ba94580e15 |
(Soubory v dily/ a _archiv/ nejsou součástí kontroly; _archiv se nepoužívá.)

## Výsledek kontrol kódem (vlastní běh)
| kontrola | stav | chyby | varování |
|---|---|---|---|
| Kolize | OK | 0 | 0 |
| Souvislost | OK | 0 | 15 |
| Otvory ISO 13857 | OK | 0 | 0 |
| Kusovník × manifest | OK | 0 | 0 |
| Zástupné díly | OK | 0 | 0 |
| STEP | OK | 0 | 0 |

Čísla odpovídají tvrzení stavitele (0 / 15), převzal jsem je až po vlastním běhu.

## Posouzení 15 varování souvislosti (dotyk bez modelovaného spojovacího prvku)
Žádné není „ve vzduchu“ (všechny mají dotyk s nosným dílem, graf = 1 komponenta):
- Podpěra pohonu M1 (@1440,240,382), přepravka (@1150,-826,210 — stojí na vlastním podstavci / podlaze, volně položená přepravka je záměr), válec Y1: tělo, 2 nákružky, pístnice, tlačná deska, 2× snímač SMT (závit pístnice, T-drážka, příchytky), ovladač + těleso za panelem ×3 (pult). Jde o upevnění bez modelovaného šroubu → výhrada 1.
- Skříň +1 nemá varování: přišroubovaná 2× M8×12 do matic v drážce nosníku (kolize šroub × díra / matice × drážka povolené).

## Ruční posouzení (co skripty neumí)
- **Soulad se zadáním/manifestem:** kusovník 24 řádků = 24 řádků KUSOVNIK.csv, každý právě jednou; rozvaděč vlevo na stojanu, dveře s -P1 a -Q0 k obsluze (−Y), pole vpravo (dopravník, vyhazovač, skluz, přepravka) — odpovídá snímkům iso/čelo i `PLCdesk_CAD.json`.
- **Struktura:** `Celek` (App::Part, PDV-000001), `PolniPrvky`, `C_Rozvadec` jako App::Link, `UpevneniSkrine` — App::Part / App::Link dle pravidel; umístění rozvaděče vypočtené (build_celek_vysledek.json).
- **Normalizované díly:** díly „dle dokumentace“ (15 řádků v parts_index.json) jsou App::Link na modely v `dily/modely`, žluté; zástupné (9 řádků) oranžové s `Placeholder` (kontrola OK, na snímcích oranžové: skříň, přepravka, snímače, pult).
- **Snímky** (`celek/k5_kolo1/k5_kolo1_iso.png, _iso2, _pudorys, _celo`) prohlédnuty: bez rozporu s čísly; skříň sedí na horním nosníku stojanu, nic nevisí.
- **Bezpečnost:** otvory změřeny skriptem (vstup víka Sr ≥ 878 ≥ 850, štěrbina u pásu ≥ 192 ≥ 80), OK. Prvky -K0, -KS1/2, -S1, -S2, -S0R, -YS1 jsou jen návrh (TEST – schválení předpokládáno), ne hotové řešení.
- **Zpětná vazba** `PLCdesk_CAD_feedback_celek.json` (4 položky: spojovací materiál skříně, kabelový vstup, konstrukční díly mimo kusovník, odkaz na části) je věcně správná; ve 3D nic potichu neopraveno. ODHADY (plech 1,5 mm, 2× M8×12) jsou označeny.

## Výhrady (neblokují)
1. Upevnění bez modelovaného šroubu (varování souvislosti) — před výrobou dokončit příchytky podpěry M1, válce, snímačů, pultu.
2. Otevření dveří skříně (95°) nebylo v celku ověřeno měřením; stavitelův odhad (pult x 120…205 × skříň x −800…−300) je věrohodný, ale je třeba změřit.
3. Stabilita (rám K = 0,69 bokem bez kotvení): kotvení patic do podlahy otevřené; skříň na dvou šroubech M8 — pevnost neověřena výpočtem.
4. K5 rozvaděče musí běžet nad novým hashem `11fc771a…` (díry Ø9 ve dně); hmotnosti v PLM jsou 0.
5. Kabelový vstup do skříně a vývodky chybí (zpětná vazba) — stroj funkčně nehotový, jde o rozhodnutí v PLCdesk.
6. Úklid dočasných souborů (`celek/.kontroly/`, `show*.py` apod.) dle stavitele.

Povinné body: žádné (chyby 0, žádný stav SELHALO).
