# Kontrola K5 — Moduly (pohony, pneumatika, držáky, kabely), kolo 1

TEST – schválení předpokládáno

## Verdikt: **SCHVÁLENO**

Role: Kontrolor K5 (jiná než stavitel). Model nebyl měněn. Kontrolováno `moduly/Moduly.FCStd`, výsledek kódem `moduly/k5_kolo1/kontroly.json`.
Povinné body: žádné (kontroly.json: **chyby 0**, stav OK). Níže jsou výhrady a doporučení, žádná z nich verdikt nemění.

## 1. Neporušenost modelů (SHA-256)

Na začátku i na konci kontroly jsem spočítal SHA-256 všech `*.FCStd` ve složce stroje (mimo `_archiv/`; 44 souborů, úplný seznam
`moduly/k5_kolo1/sha256_konec.txt`). Hodnoty se **shodují**, nic se neuložilo.

| soubor | SHA-256 |
|---|---|
| moduly/Moduly.FCStd | c120cfaed3c7d10ad91cfc704c71e5b40f49aa3b968922aa5f60087abd1f7c7b |
| ram/Ram.FCStd | 675af9a5d943629c8a8c0f1a7dfb3a4b5bc5e99fc7bb0363381ef2f9ef655b40 |
| rozvadec/Rozvadec.FCStd | 9ad4e2f6fa610fe54df7199e4a45a49ed4518dd25b8623859a17bcfb4aa52dd7 |
| koncept/Koncept.FCStd | 2335e3115df86bdb8c6a1b6a123e1c45906b61ca2e53ff9ba8b3a2ba94580e15 |
| dily/knihovna/modely/SKINTOP_ST-M_M20.FCStd | b98726816b8ffcc38e2eb8e838dcd12e598261e3166c6614e017b2558c02b9a5 |
| dily/modely/ISO15552_32x100.FCStd | a0ec2b2ccc1c8bc60783006316b45195e9751f226812d2a4b55d9c5629c1485f |
| dily/modely/1041436.FCStd | ac1040771882354ccad32cd000c7c4be05bcb1f5083f4d0f087636348fb50b15 |

SHA modelu v `kontroly.json` (k5_kolo1) = SHA souboru = SHA, který uvádí stavitel.

## 2. Kontroly kódem (nezávislý běh `pro3d vse`, `moduly/k5_kolo1/kontroly.json`, vytvořeno 2026-10-24T15:24:08)

Poznámka: pokračování po vyčerpaném limitu — kontroly.json z `k5_kolo1` už existoval (liší se od stavitelova jen časem a trváním kontrol, tedy jde o samostatný běh), znovu jsem je nespouštěl.

| kontrola | stav | chyby | varování |
|---|---|---|---|
| Kolize | OK | 0 | 0 |
| Souvislost | OK | 0 | 15 |
| Otvory ISO 13857 | OK | 0 | 0 |
| Kusovník × manifest | OK | 0 | 0 |
| Zástupné díly | OK | 0 | 0 |
| STEP export / načtení | OK | 0 | 0 |
| **Souhrn** | **OK** | **0** | **15** |

### Posouzení 15 varování souvislosti
Všech 15 je „dotýká se jen dílů bez spojovacího prvku“ u dílů, které jsou součástí rámu / válce (ne nové části modulů):
podpěra pohonu M1 (@1440,240,382), přepravka (@1150,−826,210), tělo a náboje válce, pístnice (@1150,58…102…300…925), tlačná deska, 2× snímač polohy
(@1150,120|282,951), přístroje pultu Ovladač / Teleso_za_panelem (@162,−188…−140,885…1005).
Stejná varování byla vypořádána v K5 rámu (schváleno). Kód hlásí 0 těles ve vzduchu, 1 komponenta, cesta k podlaze. Žádné varování nepochází z nových dílů
modulů (hadice, kabely, žlaby, držáky, svorkovnice). **Přijato** (viz výhrada V3 u snímačů polohy).

## 3. Ruční posouzení (to, co skripty neumí)

- **Soulad se zadáním a manifestem:** moduly dodávají jen vedení (hadice A/B/P, kabely −W1xx, kabel motoru, žlaby) a svorkovnici motoru; funkce zadání
  (pás → snímač S3 → stop → válec Y1 vysune a vrátí se, signálka, E-stop, kryt) se v modulech nemění. Počet −W1xx = 5 ks = kusovník řádek 18. OK.
- **Normalizované díly:** válec (`ISO15552_32x100`), S3 (`1041436`) a přístroje pultu (S1, S0R, H1) jsou z rámu jako App::Link na modely z `dily/`; v modulech
  přibyly vývodka SKINTOP M20, šrouby ISO 4762 M4/M5/M6 a matice ISO 4032 M4/M5/M6 jako App::Link na `dily/knihovna/modely/` (žluté, nepřebarvené — potvrzeno ve stromu). OK.
- **Zástupné díly:** −M1 (gearmotor), ventil Y1, snímače SMT, −YS1, S2, FRL, kabely, hadice, šroubení, tlumiče, průchodky jsou zástupné; ve snímcích
  oranžové, v modelu s `Placeholder`. Podle `parts_index.json` mají stav „zástupný“ — odpovídá. OK.
- **Architektura:** kořen App::Part, části App::Part, opakované díly (šrouby, matice, držáky) App::Link. OK.
- **Vyrobitelnost / montáž:** žlaby U z plechu 1,5 mm na konzolách L 6 mm šroubovaných do drážek profilu (M6 + matice do drážky) — vyrobitelné, montáž zepředu;
  držáky kabelu S3 šroub M4 + matice do podlahy vany. Servis: kabely a hadice ve žlabech přístupné shora (žlab bez víka). Bez připomínek mimo V2.
- **Bezpečnostní koncepce:** žádná bezpečnostní funkce není v modulech hotová, jen návrh ke schválení (TEST – schválení předpokládáno). Otvory: nové prostupy
  podlahou van (4 + 4) jsou vyplněny průchodkami, kód neshledal novou cestu k zónám (vstup víka e ≈ 76 mm, Sr ≥ 878 mm vs. požadovaných 850; štěrbina u pásu e ≈ 6 mm, Sr ≥ 192 mm vs. 80).
- **Snímky** (`moduly/snimky/k5_kolo1_*.png`: iso, iso2, půdorys, čelo, det_detail_1, det_detail_2, det_iso, det_pudorys) jsem prohlédl. Sedí s čísly:
  žlaby leží pod krytem a pod rozvaděčem (x −480…), kabely vedou souběžně nad žlabem a jsou k němu přidržené třemi držáky, hadice a konektory u válce a ventilu končí
  na svých dílech, oranžová zástupná barva a žlutá vývodka odpovídají. V čelním a půdorysném pohledu nevidím střet ani zjevně visící díl; v detailu
  bez rámu je kvůli skrytému rámu vidět samostatný oranžový kousek (přívodní hadice Ø8) — jde o rozhraní k FRL v rámu, kód ho nevede jako volné těleso.
  Při rozporu snímek × čísla: nenalezen.

## 4. Výhrady a doporučení (neblokují)

- V1. `Moduly.FCStd` obsahuje vlastní kopie dvou krytů (`KrytZadniPevny`, `KrytPredniPevny`) s prostupy, zatímco `Ram.FCStd` má originály bez nich —
  dvě verze téhož dílu. Stavitel to zdůvodnil a zapsal do zpětné vazby (`mod-frame-request-1`); doporučuji při příští úpravě převzít otvory do rámu a kopie zrušit.
- V2. Kabel motoru (silový) leží ve stejném žlabu jako snímačové kabely (EMC) — ODHAD stavitele označen; doporučuji oddělit (návrh ke schválení, nesledováno kontrolou).
- V3. Snímače polohy SMT (T-drážka válce), podpěra M1 a přístroje pultu nemají modelovaný upevňovací prvek (varování souvislosti) — v reálu příchytky; k doplnění až s modelem výrobce.
- V4. Odhady stavitele (porty válce a ventilu, konektory, tloušťky plechu, nosnost žlabů ≈ 1 kg/m neověřena) zůstávají ODHAD; nosnost žlabu výpočtem neověřena.
- V5. Stavitelův `plm scan` v kole neproběhl a pomocné soubory (`moduly/.kontroly/`, `skripty/dump*`) je třeba uklidit.

## 5. Neshody kusovníku → zpětná vazba PLCdesk

Neshody (kabel a vývodka motoru, M8 × M12 u SMT, konektor ventilu, pneumatický rozvod, FRL, délky kabelů, konstrukční díly, prostupy) jsou už sepsány v
`moduly/PLCdesk_CAD_feedback_moduly.json` (8 položek, formát plcdesk-cad-feedback v1). Ověřil jsem je proti `KUSOVNIK.csv`: souhlasí (−M1 bez kabelu a vývodky;
SMT-8M-…-M8D × EVC002 M12; hadice, šroubení a FRL v kusovníku nejsou). Další neshodu K5 nenašel, kusovník ve 3D nebyl měněn. V automatickém běhu se do PLCdesk nepoužije.

## 6. Předpoklady (ODHAD)

- ODHAD: kontroly.json z `k5_kolo1` beru jako samostatný běh K5 z předchozího pokusu (SHA modelu shodný, časy jiné než u stavitele); kontroly nebyly spouštěny znovu.
- ODHAD: varování souvislosti u dílů rámu (V3) pokládám za dostatečně vypořádaná K5 rámu; K5 rámu jsem znovu neprováděl.
