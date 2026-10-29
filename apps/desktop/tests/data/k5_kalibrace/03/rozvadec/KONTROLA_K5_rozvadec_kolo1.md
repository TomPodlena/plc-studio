# KONTROLA K5 — Rozvaděč (+1), kolo 1

**TEST – schválení předpokládáno**

## Verdikt: **SCHVÁLENO**

Opřeno o nezávisle spuštěné `pro3d.ps1 vse` (`rozvadec/k5_kolo1/kontroly.json`): stav **OK**, chyby 0, SELHALO žádné, varování 15.
Schváleno **s výhradami** níže (žádná není povinný bod). Rozhodnutí o skříni a doplnění svorek patří uživateli v PLCdesk.

## SHA-256 modelů (začátek = konec kontroly, shodují se; model nebyl měněn)

| soubor | SHA-256 (začátek = konec) |
|---|---|
| rozvadec/Rozvadec.FCStd | 4df1a1e8ba1db95afe366a440dca0a6d6b5743a030e3858ddb99c43f5209fe6f |
| koncept/Koncept.FCStd | 9e446e35ab1daefe451f4d4e02f4d55fe3880c1071ea10ce7dab2a2e810f27d0 |
| dily/modely/*.FCStd (17) a dily/knihovna/modely/*.FCStd (4) | shodné na začátku i na konci (porovnáno prvních 16 znaků všech 21 souborů) |

## Kontroly kódem (nezávislý běh, slot pro3d-k5)

| kontrola | stav | chyby | varování |
|---|---|---|---|
| Kolize | OK | 0 | 0 |
| Souvislost | OK | 0 | 15 |
| Otvory ISO 13857 | OK | 0 | 0 |
| Kusovník × manifest | OK | 0 | 0 |
| Zástupné díly | OK | 0 | 0 |
| STEP export / načtení | OK | 0 | 0 |

Čísla odpovídají tvrzení stavitele (0 chyb, 15 varování). Snímky K5: `rozvadec/k5_kolo1/k5_kolo1_{celo,iso,iso2,pudorys}.png` —
prohlédnuty (celo, iso, půdorys): svorky dole vlevo, rack PLC nad nimi, silová řada nahoře, T1 vpravo, HMI ve dveřích,
díly nevisí ve vzduchu, žádný viditelný průnik; obraz odpovídá popisu stavitele.

## Ruční posouzení

- **Manifest × 3D:** všech 19 řádků `location: cabinet` (A1–A4, P1, Q1, K1, Q0, F1×2, T1, X1–X5 = 8/6/7/1/2, +1, K0, KS1, KS2) je v modelu; počty sedí.
  Pořadí PLC podle slotů 1–4 sedí. Manifest SHA v `parts_index.json` a ve zpětné vazbě je `e83f5fafb845…` (shodný).
- **Normalizované díly:** díly se stavem „dle dokumentace“ jsou Linky na `dily/modely` (žluté); K0, KS1, KS2 a skříň nemají model → oranžové zástupné s `Placeholder = True` a „zástupný“ v názvu. Správně.
- **Zpětná vazba:** `PLCdesk_CAD_feedback_rozvadec.json` (5 položek) je věcně správná: svorky PE / 24 V / 0 V / rezerva, příslušenství mimo kusovník, těsná skříň, chybějící typ KS1/KS2, HMI na dveřích. Nic nebylo ve 3D změněno potichu.
- **Bezpečnost:** v rozvaděči nejsou nebezpečné zóny ani otvory v krytech k posouzení podle ISO 13857; výřez HMI je zakryt tělesem. Bezpečnostní prvky (K0, KS1/2) jsou návrh, v tomto běhu považované za schválené (TEST).

## Výhrady (nezablokovaly verdikt)

1. Lišty TS35 (4 ks) drží na desce jen dotykem, šrouby nejsou modelované (varování „bez spojovacího prvku“). Je to návrh mimo kusovník; vazba je dosed na desku změřený skriptem. Před výrobou doplnit šroubování (2× M5 / lišta).
2. Odstupy T1 (PSU6200) 45 mm nad / pod jsou ODHAD; rezerva desky nad horním žlabem 44 mm, silová a řídicí řada od sebe 58 mm. Při doplnění svorek se skříň AX 1050 nevejde — rozhodnutí o AX 1060.500 v PLCdesk (`roz-t1-odstupy`).
3. Rozměry K0 (110×100×75) a KS1/KS2 (45×58×73) jsou ODHAD; KS1/KS2 bez objednacího kódu.
4. Tepelná bilance je orientační (≈ 40 W vs. ≈ 65 W odvod, ODHAD), ztráty z datových listů neověřeny.
5. Nezpracováno (krok G): čelní výkres TechDraw, `PLM_PN` (`plm scan` neběžel). Vývody Q0 (otvory pro čelní montáž ve dveřích) jsem zvlášť neměřil.
6. Výška skříně nad podlahou 300 mm je ODHAD z konceptu; ověří fáze Rám a kryty / Celek.

## Předpoklady (ODHAD)

- ODHAD: varování souvislosti u lišt a přístrojů na liště jsou přijatelná, protože přístroje dosedají zadní plochou na lištu (vzdálenost 0 mm dle stavitele; K5 ji neměřil nad rámec skriptu).
- ODHAD: skříň AX 1050.000 má vnitřní rozměry dle datasheetu v `rozmisteni.md`; K5 je znovu nečetl.
