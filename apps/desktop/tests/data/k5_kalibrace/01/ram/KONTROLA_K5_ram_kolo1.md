# Kontrola K5 — Rám a kryty, kolo 1

TEST – schválení předpokládáno

## Verdikt: **SCHVÁLENO**

Kontroloval Kontrolor K5 (jiná role než stavitel), model nezměněn. Vlastní běh `pro3d.ps1 vse` (slot pro3d-k5, výstup `ram/k5_kolo1/`): **Stav OK, chyby 0, varování 15** (`ram/k5_kolo1/kontroly.json`, SHA-256 modelu v něm = níže).
Pozn.: schválení platí za předpokladu, že schválení bezpečnostních prvků je jen testovací předpoklad (pravidlo M); v ostré verzi jde o návrh ke schválení odpovědnou osobou.

## SHA-256 (začátek = konec, shodné)

| soubor | SHA-256 |
|---|---|
| ram/Ram.FCStd | 675af9a5d943629c8a8c0f1a7dfb3a4b5bc5e99fc7bb0363381ef2f9ef655b40 |
| koncept/Koncept.FCStd | 2335e3115df86bdb8c6a1b6a123e1c45906b61ca2e53ff9ba8b3a2ba94580e15 |
| rozvadec/Rozvadec.FCStd | 9ad4e2f6fa610fe54df7199e4a45a49ed4518dd25b8623859a17bcfb4aa52dd7 |

Modely v `dily/modely` a `dily/knihovna/modely` (35 souborů): hashe zaznamenány na začátku, kontrola je jen čte; na konci jsem znovu porovnal jen tři výše uvedené (ostatní nebyly nástrojem otevřeny pro zápis).

## Výsledky kontrol kódem (vlastní běh)

| kontrola | stav | chyby | varování |
|---|---|---|---|
| Kolize | OK | 0 | 0 (165 těles, 248 dvojic s obálkou, 81 povolených, 167 dotyků; polohy pístnice / tlačník / víko 105° bez chyb) |
| Souvislost | OK | 0 | 15 (1 komponenta, 0 ve vzduchu, 14 těles na podlaze, 0 volných čel) |
| Otvory ISO 13857 | OK | 0 | 0 |
| Kusovník × manifest | OK | 0 | 0 |
| Zástupné díly | OK | 0 | 0 |
| STEP export / načtení | OK | 0 | 0 |

## Ruční posouzení

- Soulad se zadáním: pás + vyhazovač (válec DSBC-32-100 z `dily`, zdvih 100), S3 před vyhazovačem, skluz do přepravky, víko s místem pro −S2, E-stop −S1 u zakládání, signálka −H1, pult. Odpovídá funkčnímu rozboru; změny oproti konceptu (víko −180, PC 6 mm, pevná přední vana) jsou označeny ODHAD a zdůvodněny.
- Normalizované díly: „dle dokumentace“ dílů (válec, S3, S1, S0R, H1, šrouby, matice) jsou App::Link na model, žluté; zástupné (M1, ventil, snímače SMT, S2, YS1, dopravník, přepravka, FRL, odrazka) oranžové s vlastností Placeholder — kontrola kódem OK.
- Snímky (`ram/k5_kolo1/k5_kolo1_{iso,iso2,pudorys,celo}.png`) prohlédnuty: `iso2` a půdorys i čelo ukazují souvislou konstrukci (stojan rozvaděče, dva stojany dopravníku, skluz do přepravky na podstavci, víko). Snímek `iso` je kamerou nevhodně (z jiné strany / zespodu) a skupiny dílů v něm působí odděleně; číselná souvislost (1 komponenta, 0 ve vzduchu) a `iso2` to vyvracejí. Rozpor nenalezen.
- Neshody kusovníku: stavitel je sepsal do `PLCdesk_CAD_feedback_ram.json` (dopravník, odrazka S3, ovladač S2, příslušenství pneumatiky, konstrukční díly, druhý E-stop); souhlasím, ve 3D nic neopraveno potichu. Nové neshody jsem nenalezl.

## Výhrady (nejsou důvodem k vrácení)

1. Stabilita bez kotvení: rozvaděč bokem K = 0,69, dopravník bokem K = 1,46 (< 1,5) — patky je nutné kotvit do podlahy a ztužit rohy; v modelu není, jde o návrh ke schválení.
2. Štěrbina u pásu: e ≈ 6 mm zjištěno jen z mřížky 3 mm (voxel neschvaluje). Rezerva je velká (změřeno ≥ 192 mm proti Sr ≥ 80 mm; platí do e ≈ 20 mm → 120 mm), přesto doporučuji při předání ověřit šířku štěrbiny měřením na modelu. Vstup víka: měřený čtverec 76 × 27 mm, Sr ≥ 850, změřeno ≥ 878 mm; mřížka tamtéž ukázala místo e ≈ 8 mm (ověřit).
3. Čísla ve zprávě stavitele (160 těles, 241 / 77) se liší od mého běhu (165 / 248 / 81) při shodném SHA modelu — pravděpodobně jiné počítání po obarvení; bez vlivu na verdikt, doporučuji sjednotit.
4. Řezací seznam uvádí zahloubení 8,5 mm, model 9,0 mm — sjednotit před předáním dodavateli.
5. 15 varování souvislosti (válec, tlačník, snímače SMT, přepravka, podpěra M1, přístroje pultu) posouzena: dotýkají se nosného dílu, spojení bez modelovaného šroubu je záměrné (příchytky, závit pístnice, volné uložení přepravky); nosná vazba je dotyk. Ovladač −S2 a aretace víka nejsou modelovány (zpětná vazba existuje).
6. Hotovost: tímto je část „Rám a kryty“ po K5 schválena; bezpečnostní opatření (blokování víka, E-stop, odvzdušnění) zůstávají návrhem ke schválení odpovědnou osobou. PLM `plm scan` v tomto kole neproběhl.
7. Technická poznámka: nástroj PowerShell v tomto běhu selhával (příliš dlouhý příkaz), kontroly spuštěny přes Bash → powershell.exe; výsledky tím nejsou dotčeny.
