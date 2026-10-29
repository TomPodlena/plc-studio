# Kontrola K5 — Koncept, kolo 1 — Pásový dopravník s vyhazovačem
## Verdikt: **VRÁCENO**

TEST – schválení předpokládáno

Kontrolor K5 (jiná role než stavitel), 2026-10-21 09:54–10:05, automatický běh PLCdesk PRO.
Kontrolováno proti `PLCdesk_CAD.json` (v2), `KUSOVNIK.csv`, `ROZBOR.md`. Tvrzení z `KONCEPT.md` jsem ověřil sám.
Model jsem neměnil. Stavitelovy soubory (`KONCEPT.md`, `build_koncept.py`, `check_koncept.py`,
`shots_koncept.py`, `PLCdesk_CAD_feedback_koncept.json`) zůstaly beze změny.

## Otisky SHA-256

| | *.FCStd ve složce stroje |
|---|---|
| začátek kontroly (09:55) | **žádný soubor** (0 souborů *.FCStd) |
| konec kontroly (10:04) | **žádný soubor** (0 souborů *.FCStd) — **shoda** |

`PLCdesk_CAD.json` má SHA-256 `97bb7828d8ae611cd0262e02ac732b71089744308d9944a462d40881dbf56f0f`. Shoduje se s `manifest.sha256` ve zpětné vazbě.

## Jak jsem kontroloval

Odevzdaný model **neexistuje** (`koncept/Koncept.FCStd` chybí, `koncept/snimky/` byla prázdná). Samotné to stačí na VRÁCENO.
Aby kolo 2 nestálo naslepo, pustil jsem stavitelův `build_koncept.py` **jen v paměti** ve vlastní instanci
(slot `plcdesk-pro-k5`). Spouštěč vynechá `doc.saveAs`, takže žádný *.FCStd nevznikl. Nad tímto dokumentem v paměti jsem pak spustil
stavitelův `check_koncept.py` a vlastní měření a nafotil snímky. Skripty K5 jsou `koncept/skripty/k5_kolo1_zkouska.py`
(měření) a `k5_kolo1_snimky.py` (snímky). Výsledky dál jsou **měření zkušební stavby**, ne převzetí díla.
Po práci jsem GUI zavřel (`gui-stop`, `leftover: []`, `list` → „zadny FreeCAD nebezi“).

**Zjištění k blokaci stavitele:** v tomto automatickém běhu jde FreeCAD spustit.
Nástroj PowerShell sice hlásí „command line is too long“, ale přes Bash funguje
`powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME/.claude/skills/freecad-instance/run_fc.ps1" run|gui-start|gui-run|gui-stop …`
Ověřil jsem to headless během i GUI během. Blokace tedy není důvod model neodevzdat.

## Povinné body (pro stavitele, kolo 2)

1. **Odevzdat model a snímky.** Chybí `koncept/Koncept.FCStd`, snímky v `koncept/snimky/` (iso, půdorys, čelo z obsluhy,
   záda, detail vyhazovače) a výstup `check_koncept.py` (`collisions_rest`, `collisions_extended`, `floating`).
   Bez nich nejde ověřit nic z § 4–5 KONCEPT.md. Spouštěcí příkaz viz výše.
2. **Skript stavby spadne v GUI a bez GUI neuloží barvy.** V `gui-run` končí `build_koncept.py` chybou
   `TypeError: Type in tuple must be consistent (integer)` (řádek 84 `vo.ShapeColor = rgb`, volá ho zóna
   `Z_Obsluha` s barvou `(0, 0.8, 0)` na ř. 309). Bez GUI (`freecadcmd`) je `ViewObject = None`, takže se barva
   vůbec nenastaví a uloží se jen text `Koncept_Barva`. Uložený model by pak zástupné díly oranžově **nezobrazil**
   (pravidlo G). Opravit barvy na float a model uložit z GUI (nebo barvy v GUI nastavit před uložením). Ověřit, že
   v uloženém souboru mají zástupné díly ShapeColor 255,140,0.
3. **Pohyblivý kryt dopravníku nejde otevřít a nese konzolu válce.** Spodní plech krytu (z 856–860) vede pod
   `KonzolaValce` (64 640 mm³ plechu přímo pod konzolou). Konzola leží na krytu plochou **16 160 mm²**,
   kdežto na zadní bočnici rámu jen plochou **1 600 mm²**. Odklopení krytu dozadu kolem horní zadní hrany (y 330, z 1050) dává průniky:
   5° → Dopravnik 38 691 mm³, KonzolaValce 64 753 mm³, OdrazkaS3 527 mm³; 15° → KonzolaValce, Y1_Valec, Y1_Pistnice,
   Tlacnik; 30° → KonzolaValce, Y1_Valec, Y1_SMT1, Y1_SMT2. Volno je až při 60°.
   Kryt blokovaný S2 (SF2) musí jít otevřít a nesmí nést pevné díly. Upravit dělení krytu nebo spodní plech,
   konzolu nést rámem a otevření **doložit měřením** (průniky při pootočení) a snímkem.
4. **Skluz nemá doloženou nosnou vazbu.** Skluz má objem 1 284,7 cm³ (ocel ≈ 10,1 kg, ODHAD materiálu) a vyčnívá asi 800 mm.
   S rámem se dotýká jen čelem 3mm dna (styčná plocha **454 mm²**). Druhý dotyk (498 mm²) je s **pohyblivým** krytem.
   Graf souvislosti hlásí „ok“ jen díky těmto dotykům, ale nosnou vazbu nedokládají (pravidlo 5). Doplnit podpěru nebo konzolu
   k rámu či podstavci a změřit styčné plochy. Stavitel to sám uvádí jako „slabé místo“ (§ 4), ale přesunul to až do fáze rám.
5. **ISO 13857 tab. 4: boční spáry pod krytem vedle skluzu nevyhovují.** V rovinách x = 1090 a x = 1220 je mezi
   dnem skluzu (z 843 → 856) a spodním plechem krytu (z 856) volný trojúhelníkový otvor. Ověřeno sondou, žádné těleso ho nezakrývá: y −130 … −111,4, odvěsny 13,0 × 18,6 mm. Nejmenší štěrbina, do které otvor zapadne, je výška na přeponu
   **10,6 mm**, tedy štěrbina 10 < e ≤ 12, sr ≥ 100. Pro čtverec 18,6 mm a kruh 22,7 mm platí sr ≥ 120. Nejmírnější požadavek je tedy **sr ≥ 100 mm**.
   Přímá vzdálenost k tlačníku ve vysunuté poloze je **89,6 mm** (x = 1090) a **94,5 mm** (x = 1220), tedy **< 100**, a otvor nevyhovuje.
   Kanál uzavřít bočnicemi až ke krytu (nebo jinak) a znovu změřit.
6. **Vtahovací místo na výstupním bubnu není kryté.** Kryt dopravníku končí na x = 1370, buben je na x ≈ 1500.
   „Pevný kryt bubnu – výstup“ zakrývá jen čelo (x 1500–1540, z 800–900), ne horní nabíhající větev pásu na buben
   (x 1370–1500 shora i z boku). Na vtahovací místo je v konceptu potřeba doložit obálku krytu nebo
   vzdálenost podle ISO 13857 měřením. Nestačí odkaz „detail ve fázi kryty“.
7. **Díl při výhozu narazí do držáku S3.** `DrzakS3` (x 1188–1208, y −95 … −65, z 880–1039) stojí v ústí skluzu
   (skluz x 1090–1220), 8 mm před čelem dílu v nominální poloze (čelo x = 1180). KONCEPT § 6 počítá s dojezdem pásu
   ≤ 10 mm (ODHAD). Díl pak sahá do x = 1190 a dráha výhozu (y −108 … −48, z 900–960) se s držákem kryje o 2 mm v X.
   `check_koncept.py` zkouší jen nominální polohu. Držák přesunout mimo dráhu a vysunutou polohu kontrolovat
   i s maximálním dojezdem.
8. **Hmotnosti a materiál chybí.** KONCEPT neuvádí hmotnost žádného modulu ani materiál krytu. Kryt má
   5 584,9 cm³: z oceli by vážil ≈ 43,8 kg, z PC ≈ 6,7 kg (ODHAD hustot 7,85 / 1,2 g/cm³). U ručně odklápěného krytu to rozhoduje
   o konstrukci (dělení, plynové pružiny). Doplnit ODHAD materiálu a hmotností (dopravník, kryt, skluz, rozvaděč na sloupu,
   přepravka s díly) a jejich zdroj.
9. **Opravit zprávu podle modelu.** Ruční kontroly v KONCEPT.md § 4–5 a § 8 nahradit měřením z uloženého modelu
   a upravit text podle snímků. V `STAV.md` vést výsledek jako „ke kontrole“, ne jako hotovo.

## Výhrady (nepovinné, doporučení)

- Ovládací skříňka pultu (x 120–205, y −165 … −80, z 820–1050) stojí přímo před místem zakládání (díl při zakládání
  x 70–130). Obsluha musí sahat kolem ní. Signálka H1 je na z 885, tedy pod rovinou pásu (900). Zvážit posun pultu proti toku
  (x < 0) nebo na sloup rozvaděče. Viz `k5_kolo1_zkusebni_detail_pult.png`.
- `Y1_Pistnice` má `Placeholder = True`, ale v Labelu chybí „(zástupný)“. `SMT_zdroj` (skrytý zdroj Linků) leží mimo App::Part.
  Obojí je přípustné, ale sjednotit.
- Zpětná vazba `kon-estop-reach-1` počítá s bodem stanoviště (1150; −1200). Zóna `Z_Prepravka` má ale střed (1150; −1375),
  takže vzdálenost od E-stopu (162; −195) vychází **1 539 mm**, ne 1 410 mm. Údaj sjednotit se zónou.
- Koridor hadic (zóna) prochází spodním plechem krytu bez otvoru. Až bude průchodka, posoudit ji podle ISO 13857.
- SF2 je blokování krytu bez jištění. Doběh pásu a odvzdušnění válce proti době přístupu (ISO 14119 / 13855) nejsou
  posouzené (TEST – schválení předpokládáno, jen poznámka pro fázi kryty).
- Snímek `koncept/snimky/k5_kolo1_zkusebni_detail_skluz_iso.png` zůstal z prvního běhu K5, kdy se kvůli animaci kamery neuplatnil
  pohled. **Neplatí.** Smazání nebylo v tomto běhu povoleno.

## Co je ve zkušební stavbě v pořádku (ověřeno měřením)

| bod | výsledek |
|---|---|
| průniky hmot, zadní poloha | 0 (39 těles, práh 0,001 mm³) |
| průniky, vysunutá poloha (tlačník −100, díl na konci dráhy, střed y = −78) | 0 (kromě dvojice tlačník × díl, ta je funkční) |
| souvislost k podlaze | `floating = []`, i když kryt nepočítám jako nosný díl (slabé vazby viz body 3–4) |
| zástavba (tělesa bez zón) | X −800 … 1540, Y −1026 … 380, Z 0 … 1400 → **2340 × 1406 × 1400 mm**, souhlasí s KONCEPT § 4 |
| App::Part | kořen + 8 skupin (Polní prvky, Rozvaděč, Rám, Moduly, Výrobek, Kryty, Kabeláž, Zóny) + 6× zařízení =M1 … =H1 |
| App::Link, vypočtená umístění | Stojan2 → Stojan1 posun 1100 = 1300 − 200 ✓; Y1_SMT1/2 → SMT_zdroj y 93 = 88 + 5, y 252 = 282 − 30, z 947,5 = horní plocha válce ✓; Dil_Zakladani → Dil_Stop posun −1050 (x = 100) ✓ |
| zástupné díly | 19 těles s `Placeholder = True`; v GUI (po obejití bodu 2) všechna RGB 255,140,0 ✓; Labely „(zástupný)“ kromě výhrady výše |
| kusovník 3D × PLCdesk | polní díly 1 : 1 s množstvím (-M1, -Y1 ventil, válec, SMT 2/2, -S1, -S2, -S3, -H1, -YS1, -S0R) + -P1, -Q0, +1 s `PLCdesk_*`; vnitřek rozvaděče (-A1, -Q1, -K1, -F1 2×, -T1, -X1 7×, -X2 3×, -K0 2×, -KS1, -KS2) v konceptu jen jako obálka skříně; -W1xx 5× jen jako koridor. Pro koncept přípustné |
| ISO 13857 vstupní otvor 120 × 68 | e = 68 → sr ≥ 850; změřeno 3D **880 mm** k tlačníku (klidová i vysunutá poloha) ✓ |
| spára nad pásem pod čely krytu | spodní hrana krytu nad pásem z = 902 → **2 mm** (e ≤ 4 → sr ≥ 2) ✓ |
| ústí krytého skluzu | střed ústí – tlačník vysunutý, přímá vzdálenost **954 mm** ≥ 850 ✓ (dolní mez dosahu); ústí 35,4 mm nad horní hranou přepravky, v jejím půdorysu (snímky) ✓ |
| takt, síla | 1050 / 0,3 = 3,5 s, celkem ≈ 4,5 s ≤ 5 s ✓; π/4 · 32² · 0,6 = 483 N ✓ |
| ODHADy | označené v textu i konstantách a vypsané v KONCEPT § 6 ✓ |
| zpětná vazba | `PLCdesk_CAD_feedback_koncept.json` je ve formátu v1 (druhy z povoleného výčtu, `measured.source` všude), otisk manifestu sedí, 9 položek. Věcně sedí s kusovníkem: M8 × M12, odrazka chybí, příslušenství pneumatiky, zdvih 100, M1 bez kódu, KS bez kódu. Neshody jsou sepsané a ve 3D se neopravují ✓ |

## Kusovník — zpětná vazba K5

Proti kusovníku a manifestu jsem **nenašel další neshodu** mimo 9 položek stavitele. Nový soubor zpětné vazby
proto nevzniká. Upřesnění k `kon-estop-reach-1` je ve výhradách. Body 3–8 jsou konstrukční vady modelu, ne kusovníku.

## Snímky K5 (prohlédnuté, zkušební stavba v paměti)

`koncept/snimky/`: `k5_kolo1_zkusebni_iso.png`, `_pudorys.png`, `_celo_obsluha.png`, `_zadni_udrzba.png`, `_bok_vystup.png`,
`_detail_vyhazovac_bez_krytu.png`, `_detail_skluz_bok.png`, `_detail_skluz_spara_zespodu.png`, `_detail_pult.png`.
Snímky souhlasí s měřením. Je na nich vidět skluz bez podpěry, spodní plech krytu pod konzolou válce, držák S3 v ústí
skluzu a pult před místem zakládání. Zóny obsluhy, přepravky, dveří a údržby jsou v celkových pohledech skryté.

## Předpoklady (ODHAD)

- ODHAD: hustota oceli 7,85 g/cm³, PC 1,2 g/cm³. Materiál krytu ani skluzu koncept neuvádí.
- ODHAD: kryt se odklápí kolem horní zadní hrany (y 330, z 1050). KONCEPT říká jen „odklápí se dozadu“.
- ODHAD: nebezpečné místo pro ISO 13857 je tlačník (klidová i vysunutá poloha), stejně jako v KONCEPT § 5. Pro pás uvnitř krytu
  platí hodnoty stejně nebo přísněji.
- ODHAD: dojezd pásu ≤ 10 mm převzatý z KONCEPT § 6.
- Vzdálenosti otvorů jsou přímé (distToShape), tedy dolní mez dosahu. Jako důkaz nevyhovění stačí (bod 5), jako důkaz
  vyhovění jen tam, kde je rezerva (vstup 880, ústí 954).

## Neprovedeno

- `plm scan`: neprovedeno, v kontrole K5 nebylo co registrovat (žádný *.FCStd).
