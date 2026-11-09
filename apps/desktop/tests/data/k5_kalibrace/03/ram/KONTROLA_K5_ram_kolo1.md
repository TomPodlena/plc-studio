# Kontrola K5 — Rám a kryty, kolo 1 (Pneumatický nýtovací lis NL-1)

## Verdikt: **SCHVÁLENO**

TEST – schválení předpokládáno

Kontrolor K5 (jiná role než stavitel). Model nezměněn (SHA-256 na začátku = na konci). Kontrolováno proti zadání, `PLCdesk_CAD.json` (SHA-256 `e83f5faf…2d20`, shodný s manifestem uvedeným ve zprávě stavitele a v `parts_index.json`), `ROZBOR.md`, `KUSOVNIK.csv` a schválenému konceptu (`koncept/KONCEPT.md`, `koncept/KONTROLA_K5_koncept_kolo1.md`). Bezpečnostní prvky (zadní dveře + S4, prstová ochrana, PC / plech kryty) jsou jen návrh ke schválení odpovědnou osobou; v tomto běhu se považují za schválené (TEST).

## SHA-256 modelů (začátek = konec, shodné)

| soubor | SHA-256 |
|---|---|
| ram/Ram.FCStd | `51289b40e2e0808a236230c3c75d5a57c4418abc0791d046199d70dd0371b60e` |
| koncept/Koncept.FCStd | `9e446e35ab1daefe451f4d4e02f4d55fe3880c1071ea10ce7dab2a2e810f27d0` |
| rozvadec/Rozvadec.FCStd | `4df1a1e8ba1db95afe366a440dca0a6d6b5743a030e3858ddb99c43f5209fe6f` |
| dily/modely/*.FCStd (17) a dily/knihovna/modely/*.FCStd (13) | shodné na začátku i na konci (prvních 12 znaků každého souboru porovnáno; výpis na začátku běhu) |

## Kontroly kódem (vlastní běh `pro3d vse`, slot pro3d-k5, `ram/k5_kolo1/kontroly.json`)

Stav **OK — chyby 0, varování 5** (shodně se stavitelem; model SHA-256 `51289b40e2e0`).

| kontrola | stav | výsledek |
|---|---|---|
| Kolize | OK | 210 těles, 0 chyb; kalibrace OK (4000 / 4000 mm³); 116 povolených průniků (šroub × díra / závit, matice × drážka, patka × závit M10); 0 průniků i v poloze „zadní dveře otevřené 90°“ |
| Souvislost | OK | 1 komponenta, 0 dílů ve vzduchu, 4 patky na podlaze (z = 0), 0 volných čel profilů, 5 varování „bez spoje“ (viz níže) |
| Otvory ISO 13857 | OK | jediná cesta: štěrbina pod prstovou ochranou, e ≈ 6 mm ⇒ Sr ≥ 10 mm, změřeno ≥ 52,9 mm (poloha 618; 240,5; 1004). Voxely cesty jen hledaly (oblast oříznuta na zóny ±1000 mm / ±200 mm — přijatelné), rozhodlo změřené e a Sr |
| Kusovník × manifest | OK | 45 řádků manifestu, žádný nemá ve 3D `PLCdesk_Id` ⇒ vše „mimo rozsah“ (info) — rám a kryty jsou konstrukce, ne kusovník (viz výhrada 2) |
| Zástupné díly | OK | 9 zástupných objektů, všechny oranžové a s `Placeholder = True`; 0 žlutých bez vlastnosti |
| STEP export / načtení | OK | 210 těles = 210, objem shodný, 0 neplatných |

Rozdíl proti zprávě stavitele: skript počítá 210 těles a 116 povolených průniků (stavitel uvádí 200 a 106). Bez vlivu na verdikt (0 nepovolených).

### Posouzení 5 varování „bez spoje“

1. Zadní dveře kabiny (PC 6 mm) — drží je panty, které jsou zástupné (nákup doplní kód a upevnění); západka a ovladač S4 patří do fáze Moduly. Přijato.
2. Prstová ochrana razníku — visí na zástupném rameni lisu; závity v rameni výrobce lisu zatím neznáme. Přijato.
3. Zástupný stojan C-rámu, 4. zástupné rameno C-rámu, 5. přípravek — obálky z konceptu; spojení se základovou deskou řeší výrobce lisu / fáze Moduly. Přijato (tyto díly jsou zástupné, ne konstrukce rámu).

## Ruční posouzení

- **Soulad se zadáním / konceptem / manifestem:** varianta A (stůl 1200 × 900, pracovní rovina přípravku z = 1000, deska z = 900, zadní kabina s jedinými dveřmi a jedním S4) odpovídá schválenému konceptu i kusovníku (S4 je 1×). Zóny `Zona_Y2_razeni`, `Zona_Y4_oddelovac` jsou zachovány. Konstrukce rámu nemění řádky kusovníku — správně.
- **App::Part / App::Link:** celky jsou App::Part (Rám stolu, Kabina, Kryty, Základ lisu, Spojovací materiál, Zóny); opakované díly (profily, spojovací materiál) jsou App::Link s vypočteným Placementem; 158 spojovacích dílů linkuje `dily/knihovna` (žluté, „dle dokumentace“, bez přebarvení — kontrola `stav`: 0 chyb). Žlutá není použita na nic jiného.
- **Normalizované díly:** v `parts_index.json` nemá žádný díl rámu stav „dle dokumentace“ (profily ALUTEC a patky nejsou v kusovníku). Profil je zjednodušený průřez drážky 8 a není vydáván za model výrobce (poznámka ve zprávě stavitele); S4 je v indexu „zástupný“. V pořádku.
- **Rozměry a hmotnosti:** řezací seznam sedí s modelem (profil 45×45: 23 ks / 20 760 mm / 51,3 kg; 45×90: 5 ks / 4 950 mm / 20,3 kg). Výpočet (VYPOCTY.md) je věcně správný a rozumně konzervativní: horní příčky Y po změně na 45×90 vyhovují (0,256 mm), nosníky T 0,449 mm. Převrácení ≈ 5,6 bez kotvení; vzpěr zadní nohy je jen orientační (viz výhrada 3). Všechny vstupy jsou označeny ODHAD.
- **Vyrobitelnost / montáž / servis:** každý dílec má spoj na obou koncích (0 volných čel); opracování (závity M8 / M10, díry Ø7,3 pro klíč) je v řezacím seznamu. Stěny od obsluhy se šroubují zevnitř kabiny (nelze sundat zepředu), servisní přístup zadními dveřmi — vyhovuje. Díry pro klíč v modelu nejsou (ODHAD uvedený ve zprávě), jsou v seznamu opracování.
- **Bezpečnostní koncepce (TEST):** čísla otvorů má skript (Sr změřeno ≥ 52,9 mm vs. požadavek ≥ 10 mm); kabina jinak bez otvorů; dveře s S4 — ovladač, západka a posouzení doběhu (Y4, M1; SF2 „bez jištění“) zůstávají otevřené a jsou správně zapsány jako zpětná vazba. Zakládací zóna zůstává otevřená (z konceptu) — rozhodne posouzení rizik, ne hotové řešení.
- **Zpětná vazba** `PLCdesk_CAD_feedback_ram.json` (4 položky, formát plcdesk-cad-feedback v1, SHA manifestu sedí): věcně správná, kusovník nebyl ve 3D potichu měněn. Jedna chyba v textu — viz výhrada 1.
- **Snímky** (`ram/k5_kolo1/k5_kolo1_iso.png`, `_iso2`, `_pudorys`, `_celo`) prohlédnuty: stůl s deskou, ocelovými plechy po bocích a patkami (oranžové), vzadu kabina z profilů s PC výplněmi, dělicí stěna se světlým otvorem mezi sloupky C1/C2 pro rameno lisu, zástupné rameno (oranžové) nad základovou deskou, nic nevisí ve vzduchu, zadní dveře s panty vzadu, zelená plocha = místo obsluhy. Obrázek odpovídá číslům i popisu stavitele. Snímky jsou přehledové; šroub × díra detaily viditelné nejsou (viz výhrada 4).

## Výhrady (nebrání schválení, vyřešit v dalších fázích / nejpozději před vydáním výkresů)

1. **Číselná chyba ve zpětné vazbě:** položka `ram-konstrukce-mimo-kusovnik` uvádí „profily 104545 × 25 ks, 104590 × 3 ks“; skutečnost (model, `rezaci_seznam.csv`, RAM.md) je **23 ks × 104545 a 5 ks × 104590**. Opravit při příštím kole (jde o info, kusovník PLCdesk se nemění).
2. Kontrola „Kusovník × manifest“ nic neověřila (žádný objekt nemá `PLCdesk_Id`); přiřazení řádků (S4, S5, Y1–Y4 …) provede fáze Moduly a K5 ji tehdy ověří znovu.
3. Nosný předpoklad „Y2 = uzavřený C-rám, síla 50 kN se nevnáší do stolu“ je ODHAD (zpětná vazba `ram-lis-uzavreny-c-ram`); při jiné konstrukci lisu se rám musí přepočítat. Vzpěr zadních nohou / sloupků kabiny (štíhlost 271) ověřit podle EN 1999-1-1 nebo MKP před vydáním výkresů; únosnost spojů ALUTEC a ztužení plechy 3 mm výrobce neuvádí — zkouška / poptávka.
4. Detail vazeb na úrovni šroubu nebyl ve snímcích stavitele ani v mých pořízen (nástroj `snimky --detail` vykresluje prázdno); vazby jsou ověřeny jen kontrolami kolizí a souvislosti. Doplnit při další fázi.
5. Zadní dveře: chybí ovladač S4, západka / zámek s únikem zevnitř, případně zajištění krytu (doběh Y4 / M1) — jen návrh, rozhodne odpovědná osoba (TEST – schválení předpokládáno). Dveře 1104 × 949 mm z jednoho PC panelu 6 mm: pevnost / impakt podle ISO 14120 neověřena (ODHAD).
6. Patky ALUTEC 408010 a panty jsou zástupné (oranžové) — kódy a způsob upevnění doplní nákup; stavěcí patka nemá kotvení k podlaze (rozhodne uživatel).
7. Rozvaděč vpravo a úprava vzduchu vlevo se musí ve fázi Moduly / Celek posunout o 3 mm (plechy), viz zpětná vazba `ram-rozvadec-poloha`.
8. `plm scan` v tomto kole neběžel (stavitel ani kontrolor); nespouštěno, protože by změnilo registr bez potřeby pro verdikt.

## Předpoklady (ODHAD)

Převzaty ze zprávy stavitele (RAM.md kap. 5); kontrolor žádné nové nepřidal. ODHAD kontrolora: voxelová kontrola oříznutá na zóny ±1000 / ±200 mm je pro posouzení dosahu k zónám razníku a oddělovače dostatečná (mimo ni neleží nebezpečný pohyb) — nic jiného nepřijato bez měření.

## Stav

Po tomto schválení jde o výsledek „SCHVÁLENO K5“ pouze za výše uvedených výhrad; bezpečnostní prvky zůstávají návrhem ke schválení odpovědnou osobou (TEST – schválení předpokládáno). Moje GUI instance (slot pro3d-k5) je zavřená.
