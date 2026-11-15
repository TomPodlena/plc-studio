# Kontrola K5 — Rozvaděč +1, kolo 1

TEST – schválení předpokládáno

## Verdikt: **SCHVÁLENO**

Role: Kontrolor K5 (jiná než stavitel). Model nebyl měněn. Kontrolováno proti zadání, manifestu (`PLCdesk_CAD.json`, `KUSOVNIK.csv`, `ROZBOR.md`) a konceptu (`koncept/KONCEPT.md`), ne proti zprávě stavitele.

## SHA-256 (začátek = konec, shodné)
- `rozvadec/Rozvadec.FCStd` = `9ad4e2f6fa610fe54df7199e4a45a49ed4518dd25b8623859a17bcfb4aa52dd7` (= hash v `k5_kolo1/kontroly.json`)
- `koncept/Koncept.FCStd` = `2335e3115df86bdb8c6a1b6a123e1c45906b61ca2e53ff9ba8b3a2ba94580e15`
- Knihovní a výrobcovské modely `dily/modely/*.FCStd` (15) a `dily/knihovna/modely/*.FCStd` (5): hash po celou kontrolu shodný (seznam v běhu; např. `2002-1201` = `f27a434b…8bfc`, `TS35x7.5_420` = `615ae044…5ab5`).
- Soubory v `_archiv/` jsem nehashoval (nejsou součástí této části a nikdo na ně nesahal).

## Kontroly kódem (nezávislý běh `pro3d.ps1 vse`, slot `pro3d-k5`, `rozvadec/k5_kolo1/kontroly.json`)
Souhrn: **stav OK, chyby 0, varování 0, selhalo [].**

| kontrola | stav | poznámka |
|---|---|---|
| Kolize | OK | 32 těles, 31 dotyků, 0 kolizí, kalibrace voxelu OK; poloha „dveře otevřené 95°“ 0 chyb |
| Souvislost | OK | 1 komponenta, 0 dílů ve vzduchu, 0 bez spoje; cesta deska → sloupky → zadní stěna → podlaha |
| Otvory ISO 13857 | OK | model nemá zóny ani větrací otvory → info, nic k měření |
| Kusovník × manifest | OK | rozsah „cabinet“: 24 řádků manifestu, počty sedí (F1 2, K0 2, KS1/KS2, X1 7, X2 3 …); řádky `field` jsou mimo rozsah (info) |
| Zástupné díly / barvy | OK | 23 dílů „dle dokumentace“ (žluté, bez přebarvení), 10 zástupných objektů oranžových s vlastností, 0 chyb |
| STEP export / načtení | OK | 32 / 32 těles, objem shodný 6 972 655 mm³ |

## Ruční posouzení (to, co skripty neumí)
- **Soulad s konceptem a zadáním:** skříň AX 1050.000 500 × 500 × 210 (měřeno: obálka 500 × 210 × 500) = kusovník; HMI -P1 a -Q0 ve dveřích (koncept: Q0 z 1000–1067 nad podlahou, měřeno 91–175 nad dnem skříně = cca 991–1075, v toleranci ODHADu); -P1 zapuštěn do výřezu 197 × 141 (shoda s výřezem MTP700), přední líc zarovnán s vnějším lícem dveří.
- **Měřením ověřeno (nezávislý bounding-box každého tělesa):** lišty TS35 y 14–21,5 na desce (y 14), přístroje dosedají zadním lícem na líc lišty y = 21,5, deska y 11,5–14 na čtyřech sloupcích y 1,5–11,5 od zadní stěny (y 0–1,5). Žádný díl nevisí ve vzduchu, všechny dosedají nulovou spárou.
- **Obrázky:** `k5_kolo1_iso`, `_iso2`, `_pudorys`, `_celo` + sám prohlédnut i snímek stavitele `snimky/rozvadec_p_celo_bez_dveri.png`. Rozpor s měřením nenalezen: tři lišty, přístroje na nich, dvě oranžové zástupné -KS1/-KS2, žluté generované díly, HMI ve dveřích a -Q0 vlevo dole odpovídají naměřeným souřadnicím. Kamera nástroje je mírně natočená (pohledy nejsou přesně kolmé) — výhrada k nástroji, ne k modelu.
- **Normalizované díly:** všech 15 řádků parts_index „dle dokumentace“ v rozsahu skříně (A1, P1, Q1, K1, Q0, F1, T1, K0, X1/X2, lišty) je App::Link na `dily/modely/` resp. `dily/knihovna/modely/`, ne zástupná obálka. Zástupné jsou jen +1, -KS1, -KS2 (a konstrukční deska, sloupky, plech dveří) — správně oranžové. Žlutá se nepoužívá na nic jiného.
- **Struktura:** App::Part pro celek, skříň, dveře, lišty i řady, opakované díly (lišty, svorky, F1, K0) jako App::Link.
- **Bezpečnost:** v modelu nejsou kryty ani nebezpečné zóny; skříň je zavřená (dveře), žádné větrací otvory. -K0, -KS1/-KS2, -S1/-S2 jsou jen návrh dle konceptu (TEST – schválení předpokládáno); -KS1/-KS2 jsou ve 3D a v kusovníku zástupné bez typu.
- **Vyrobitelnost / montáž / servis:** lišty, deska i dveře vyrobitelné; dveře se otevírají o 95° bez kolize; vůle nejhlubší přístroj (-K0, y 143,1) ke dveřím 65 mm; přístup k přístrojům zepředu volný.

## Výhrady (nebrání schválení, k vyřešení v dalších kolech / v PLCdesk)
1. Montážní prvky nejsou modelovány (šrouby desky, upevnění lišt, přístrojů, dveřního plechu a -Q0, panty, zámek) — nosná vazba je jen dosednutím. Kontrola „dílů bez spoje“ proto byla vynechána (info). Doplnit nebo výslovně schválit jako zjednodušení.
2. Pojmenování řad: štítky částí „R1 … (-F1, -T1)“ a „R2 … (-Q1, -K1)“ leží na téže liště (z ≈ 386), „R3 Bezpečnostní úsek“ leží na liště R2 a „R4 Svorkovnice“ na liště R3. Rozpor s označením lišt R1–R3 — kosmetika, sjednotit.
3. ODHAD K5: odstupy zdroje -T1 od horní stěny (≈ 34 mm k desce, ≈ 46 mm ke stropu skříně) mohou být menší než odstup, který předepisuje návod SITOP PSU6200 (obvykle kolem 50 mm nad/pod); ověřit v návodu výrobce. Souvisí s tepelnou bilancí.
4. Tepelná bilance nedoložena (skříň 500 × 500 × 210, ODHAD ≈ 49 °C u meze 50 °C pro MTP700 — STAV.md) — v zpětné vazbě je (roz-thermal-1).
5. Nejsou žlaby, zarážky, vývodky / průchodky, PE a přívodní svorky, kabely (v zpětné vazbě stavitele, K5 souhlasí; PLCdesk rozhodne).
6. Hmotnost ≈ 20 kg (ODHAD K5 z konceptu); v modelu nejsou materiálové hustoty — nelze ověřit měřením. Upevnění skříně na sloup řeší část Rám.
7. -P1 je obálka výřezu (197 × 141 × 36); přední rám panelu (≈ 214 × 158) se neověřoval — obálka z datasheetu.

## Zpětná vazba pro PLCdesk
Neshody kusovník × 3D: žádné nové. Stavitelova `PLCdesk_CAD_feedback_rozvadec.json` (4 položky: -KS1/-KS2 bez objednacího kódu, chybějící svorky přívodu / PE, konstrukční díly mimo kusovník, tepelná bilance) je věcně v pořádku a K5 s ní souhlasí. Nově navrhuji doplnit do poznámek kusovníku: ověřit odstupy -T1 podle návodu (výhrada 3). V automatickém běhu se do PLCdesk nepoužije, jen přehled.

## Předpoklady (ODHAD)
- ODHAD: odstup 50 mm nad / pod zdrojem SITOP PSU6200 je z paměti, nikoli z návodu — ověřit.
- ODHAD: -Q0 v konceptu z 1000–1067 se vztahuje ke spodku skříně z = 900 (z konceptu, ne zadání).
- Ostatní ODHADy viz `rozvadec/ROZVADEC.md` § 3 (plech 1,5 mm, deska 2,5 mm, sloupky Ø12 × 10, rozměr -KS1/-KS2).

## Stav FreeCADu
Vlastní instance, slot `pro3d-k5`; po práci `gui-stop` (žádný zbylý proces). Cizí instance nebyly dotčeny.
