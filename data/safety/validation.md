# Ověření a validace bezpečnostních funkcí, SRS, FAT a dokumentace podle nařízení (EU) 2023/1230

Podklad pro modul „Bezpečnostní funkce" aplikace PLCdesk. Stav ke dni 3. 10. 2026.
Normy ISO/IEC jsou placené. Jejich obsah je proto převzat z veřejných výkladů (IFA/DGUV, Pilz, Rockwell, SICK, SMC)
a z volně dostupných ukázek norem (obsah, předmluva, definice). Tam, kde jsem plné znění normy neviděl, to u daného místa uvádím.
Právní předpisy (nařízení 2023/1230, oprava, směrnice 2006/42/ES, prováděcí rozhodnutí 2024/1329) jsem četl v plném znění.

Zkratky zdrojů v hranatých závorkách odkazují na seznam na konci. U každého odstavce je uvedena i přímá URL.

> **Upozornění pro aplikaci:** Nic z níže uvedeného nenahrazuje posouzení odpovědné osoby. Podle čl. 21 odst. 4 nařízení
> výrobce vypracováním EU prohlášení o shodě „přebírá odpovědnost" za soulad stroje
> ([EUR-Lex, nařízení 2023/1230, čl. 21](https://eur-lex.europa.eu/eli/reg/2023/1230/oj/eng)).

---

## 0. Důležité opravy a rozpory zjištěné hned na začátku

1. **Datum použitelnosti nařízení je 20. 1. 2027, ne 14. 1. 2027.** Původně vyhlášený text (Úř. věst. L 165, 29. 6. 2023)
   uvádí v čl. 54 a čl. 51 odst. 2 datum „14 January 2027". Oprava zveřejněná v Úř. věst. L 169 ze 4. 7. 2023 (s. 35) ho
   mění na „20 January 2027". Opravena jsou i další data: čl. 52 odst. 1 (20. 1. 2027 a 19. 7. 2023), čl. 54 písm. a) až d)
   a čl. 50 odst. 2 (20. 10. 2026).
   Zdroje: [nařízení – původní text](https://eur-lex.europa.eu/eli/reg/2023/1230/oj/eng),
   [oprava OJ L 169/35](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=uriserv%3AOJ.L_.2023.169.01.0035.01.ENG).
   Prakticky to znamená, že směrnice 2006/42/ES platí naposledy 19. 1. 2027. Od 20. 1. 2027 se uplatní nařízení.
   Pozor: některé texty na webu dodnes uvádějí neopravené datum 14. 1. 2027.
2. **Validace podle ISO 13849-2:2012 byla v ISO 13849-1:2023 převzata do kapitoly 10.** Kapitola 13 obsahuje
   informace pro používání („Information for use"), ne validaci. Podrobnosti jsou v kap. 1.6.
3. **Pro nařízení 2023/1230 jsem nenašel žádný průvodce Komise k aplikaci.** Stránka Komise k 3. 10. 2026 nabízí jen průvodce
   ke směrnici 2006/42/ES, vydání 2.3 z dubna 2024
   ([EC – Machinery](https://single-market-economy.ec.europa.eu/sectors/mechanical-engineering/machinery_en),
   [Guide 2.3](https://ec.europa.eu/docsroom/documents/60145)).

---

## 1. Osnova plánu ověření a validace (V&V) podle ISO 13849-1:2023, kap. 10 (dříve ISO 13849-2:2012)

### 1.1 Kde je validace v aktuálních normách

- **ISO 13849-1:2023 (4. vydání)** v předmluvě mezi hlavními změnami uvádí „validation (updated Clause 8 and moved to Clause 10)".
  Úvod normy dále říká: „The requirements of Clause 10 of this document supersede the requirements of ISO 13849-2:2012
  (excluding the informative annexes)."
  ([ISO 13849-1:2023 Preview, Certifico](https://www.studiobarbaracalvi.com/wp-content/uploads/2023/05/ISO-13849-1_2023-Preview.pdf))
- **Struktura kap. 10** podle obsahu ve volné ukázce normy
  ([iTeh sample ISO 13849-1:2023](https://cdn.standards.iteh.ai/samples/73481/a2b27fd1dab8460fa3cef34426de7cce/ISO-13849-1-2023.pdf)):
  - 10.1 Validation principles: 10.1.1 General, 10.1.2 Validation plan, 10.1.3 Generic fault lists, 10.1.4 Specific fault lists, 10.1.5 Information for validation
  - 10.2 Validation of the safety requirements specification (SRS)
  - 10.3 Validation by analysis: 10.3.1 General, 10.3.2 Analysis techniques
  - 10.4 Validation by testing: 10.4.1 General, 10.4.2 Measurement accuracy, 10.4.3 Additional requirements for testing, 10.4.4 Number of test samples, 10.4.5 Testing methods
  - 10.5 Validation of the safety functions
  - 10.6 Validation of the safety integrity of the SRP/CS: 10.6.1 Validation of subsystem(s), 10.6.2 Validation of measures against systematic failures, 10.6.3 Validation of safety-related software, 10.6.4 Validation of combination of subsystems, 10.6.5 Overall validation of safety integrity
  - 10.7 Validation of environmental requirements
  - 10.8 Validation record
  - 10.9 Validation maintenance requirements
  - Navazující kapitoly: 11 Maintainability of SRP/CS, 12 Technical documentation, 13 Information for use (13.2 pro integrátora, 13.3 pro uživatele).
- **IFA/DGUV** ([Fourth edition of EN ISO 13849-1, 2024](https://publikationen.dguv.de/widgets/pdf/download/article/4894)):
  kap. 10 byla podle IFA „taken over entirely from sections 4 to 12 of EN ISO 13849-2". Obsah a požadavky zůstaly
  v podstatě stejné, změnilo se hlavně uspořádání. Bez ohledu na kategorii se kromě analýzy vyžaduje alespoň funkční
  zkouška bezpečnostních funkcí. V přechodném období mají přednost novější požadavky části 1. Revize části 2 se má
  týkat jen tabulek a příkladů v přílohách. Dlouhodobě se počítá s přesunem celé části 2 do části 1.
- **Pilz** ([Changes in EN ISO 13849-1, Pilz India 2023](https://www.safe-machines-at-work.org/fileadmin/user_upload/pdf/control_devices/Seminars_Functional_Safety_and_Validation/Seminars__Functional_Safety_and_Validation__in_India/in_Bangalore__India__September_27th_-_28th/09_Changes_in_ISO13849-1_PILZ.pdf)):
  normativní požadavky ISO 13849-2 byly podle Pilzu revidovány a začleněny do kap. 10. Validace a přezkum SRS jsou
  popsány podrobně. Příloha N obsahuje jednoduchý příklad validace softwaru. ISO 13849-2:2012 „will initially remain as it is
  and will be revised afterwards".
- **Stav ISO 13849-2:** podle ibf solutions bylo hlasování o návrhu prEN ISO 13849-2:2026 ukončeno 2. 5. 2026. Část 2 se má
  zaměřit na bezpečnostní principy, osvědčené součásti a podmínky vyloučení poruch (přílohy A–D: mechanika, pneumatika,
  hydraulika, elektro) a má dostat přílohu ZBB k nařízení 2023/1230
  ([ibf – The new prEN ISO 13849-2](https://www.ibf-solutions.com/en/news-and-knowledge/technical-papers-and-news-on-ce-marking/the-new-pren-iso-13849-2)).
  Seznamy poruch a kritéria vyloučení poruch tedy zůstávají v části 2.
- **Harmonizace:** EN ISO 13849-1:2023 byla k **směrnici** 2006/42/ES zařazena prováděcím rozhodnutím (EU) 2024/1329
  (řádek 66a). Odkaz na EN ISO 13849-1:2015 se ruší. Podle odůvodnění (14) je zrušení odloženo a podle závěru rozhodnutí
  se bod (1)(a) přílohy I použije od 15. 5. 2027.
  ([prováděcí rozhodnutí 2024/1329, kopie OJ L 15. 5. 2024](https://www.ibf-solutions.com/fileadmin/dateidownloads/amtsblaetter/eu-official-journal-2024-05-15-2024-1329-md.pdf),
  [ELI](http://data.europa.eu/eli/dec_impl/2024/1329/oj)).
  *Neověřeno:* že vypouštěný řádek 66 je právě EN ISO 13849-1:2015. Vyvozuji to z odůvodnění (11) a (14). Nepodařilo se
  ověřit ani to, zda už existuje seznam harmonizovaných norem k **nařízení** 2023/1230.
- **IEC 62061:2021** (pro SIL) řeší validaci v kap. 9: 9.1 Validation principles s plánem validace, informacemi pro validaci
  a záznamem, 9.2 analýza, 9.3 zkoušky, 9.4 validace bezpečnostní funkce, 9.5 validace integrity SCS (subsystémy, systematické
  poruchy, software). Příloha J (informativní) stanoví nezávislost přezkumů a validace
  ([iTeh sample IEC 62061:2021](https://cdn.standards.iteh.ai/samples/100331/f60ea607ab4e48268e2b8fbddc83e9e8/IEC-62061-2021.pdf)).

### 1.2 Principy (IFA Report 2/2017, kap. 7.1.1, podle ISO 13849-2)

Zdroj celé sekce 1.2–1.9: [IFA Report 2/2017e](https://www.dguv.de/medien/ifa/en/pub/rep/pdf/reports-2019/report0217e/rep0217e.pdf), kap. 7.

- V&V má prokázat, že každá bezpečnostní část a každá bezpečnostní funkce splňuje ISO 13849-1.
- S činnostmi začít co nejdříve, už během vývoje.
- Ověřovatelé by podle možnosti neměli být účastni návrhu. Má jít o jiné osoby, oddělení nebo subjekty mimo hierarchii
  konstrukce. Míra nezávislosti má odpovídat riziku (PLr).
- Postup: validační plán → analýza → (pokud analýza nestačí) zkoušky → validační zpráva. Vstupy jsou seznamy poruch,
  kritéria vyloučení poruch a dokumentace (obr. 7.2 v IFA).

### 1.3 Obsah validačního plánu (IFA 7.1.2)

Navrhovaná pole formuláře „Validační plán":

| Pole | Obsah |
|---|---|
| Předmět | identifikace SRP/CS, jejich součástí a variant |
| Bezpečnostní funkce | seznam BF a jejich přiřazení k SRP/CS |
| Referenční dokumenty | normy, technická pravidla, specifikace, firemní pravidla návrhu a programování |
| Zkušební normy | normy pro metody zkoušek (např. IEC 60068 pro vlivy prostředí) |
| Analýzy a zkoušky | co se provádí a v jakém pořadí |
| Existující doklady | certifikáty součástí a odkazy na ně |
| Seznamy poruch | použité seznamy poruch (generické a specifické) |
| Odpovědné osoby | osoby, oddělení nebo zkušebna |
| Podmínky | prostředí zkoušky, zkušební zařízení, nástroje |
| Dokumentace výsledků | protokoly, specifikace testovacích případů, kontrolní seznamy |
| Kritéria hodnocení | kritéria přijetí a postup při neúspěchu |
| Formální údaje | identifikace dokumentu, verze, historie, autoři, schválení, podpisy |

IFA doporučuje plán sestavit souběžně se specifikací a nechat ho přezkoumat osobou kompetentní v QM/QA.
U složitých systémů plán stanoví, které zkoušky proběhnou až na stroji a kde lze použít simulátor („hardware in the loop").
([IFA 2/2017, 7.1.2](https://www.dguv.de/medien/ifa/en/pub/rep/pdf/reports-2019/report0217e/rep0217e.pdf))

### 1.4 Seznamy poruch a vylučování poruch (IFA 7.1.3, ISO 13849-1:2023 10.1.3–10.1.4, 6.1.10)

- Generické seznamy poruch a vyloučení poruch obsahují přílohy A–D normy ISO 13849-2 (mechanika, pneumatika, hydraulika,
  elektrotechnika). IFA je rozebírá v příloze C. Specializované seznamy obsahuje například IEC 61800-5-2 (pohony)
  a IEC 61784-3 (bezpečné sběrnice). ([IFA 2/2017, 7.1.3](https://www.dguv.de/medien/ifa/en/pub/rep/pdf/reports-2019/report0217e/rep0217e.pdf))
- Pro součásti, které v seznamech nejsou, doplní výrobce vlastní seznam. **Každé vyloučení poruchy musí být zdůvodněno**
  a doplněné seznamy se stávají součástí technické dokumentace.
- Pro SRESW ani SRASW normy seznamy poruch nemají. Pomáhá statická analýza kódu.
- Stejné poruchy se posuzují i z hlediska CCF (příloha F).
- Nově v ISO 13849-1:2023, 6.1.10: **PL e subsystému nesmí stát jen na vyloučení poruch.** V kategorii 4 se do kumulace
  poruch nemusí započítávat prakticky irelevantní nedetekované poruchy, pokud je tato úvaha dokumentována a ověřena
  ([IFA/DGUV 4th edition](https://publikationen.dguv.de/widgets/pdf/download/article/4894)).

### 1.5 Validace specifikace (SRS) – ISO 13849-1:2023, 5.4 a 10.2

- Přezkum SRS se musí provést **před** zahájením návrhu SRP/CS, aby se chyby specifikace odhalily včas
  ([IFA/DGUV 4th edition](https://publikationen.dguv.de/widgets/pdf/download/article/4894)).
- Ověření specifikace se dělá inspekcí a přezkumem (review, walk-through). IFA doporučuje dva stupně: nejprve zkušení
  pracovníci výrobce, potom kompetentní externí subjekt, např. zkušebna. Kontroluje se úplnost, správnost, srozumitelnost
  a bezrozpornost ([IFA 2/2017, 7.2 a Box 6.1](https://www.dguv.de/medien/ifa/en/pub/rep/pdf/reports-2019/report0217e/rep0217e.pdf)).

### 1.6 Validace bezpečnostních funkcí (IFA 7.3; ISO 13849-1:2023, 10.5)

Dílčí zkoušky ([IFA 2/2017, 7.3](https://www.dguv.de/medien/ifa/en/pub/rep/pdf/reports-2019/report0217e/rep0217e.pdf)):
- funkční zkouška,
- rozšířená funkční zkouška: netypické, neočekávané, procedurálně chybné nebo neplatné vstupy a obsluha,
- simulace, kde je možná,
- výkonové zkoušky: parametry, doba odezvy.

Konečné posouzení na kompletním stroji zahrnuje i doběhy a bezpečné vzdálenosti.

### 1.7 Validace PL a kategorie (IFA 7.4)

- **Kategorie (7.4.1):** analýza struktury a signálových cest, účinnosti diagnostiky, základních a osvědčených principů,
  osvědčených součástí (kat. 1) a vyloučení poruch. Pokud analýza nestačí, následují zkoušky s **vnášením poruch**
  (fault injection) nebo simulace poruch a rozšířené funkční zkoušky.
- **MTTFD (7.4.2):** alespoň kontrola věrohodnosti zdrojů dat (B10D, T10D, nop).
- **DC (7.4.3):** identifikace diagnostických funkcí, zkoušky vnášením poruch, kontrola výpočtu DCavg.
- **CCF (7.4.4):** bodové hodnocení podle přílohy F. Analýzou nebo zkouškou se prokáže, že opatření jsou skutečně realizována
  (statická analýza HW, funkční zkoušky v mezních podmínkách prostředí).
- **Systematické poruchy (7.4.5):** zkoušky na mezních a změněných jmenovitých hodnotách, vnášení poruch do napájení
  (výpadek, kolísání, přepětí, podpětí, změny frekvence), odolnost vůči prostředí (klima, mechanika, EMC), kontrola
  monitorování běhu programu a bezpečné komunikace.
- **Kontrola stanovení PL (7.4.7):** správnost metody a výpočtů, např. ověření podle sloupcového grafu.

Zdroj: [IFA 2/2017, 7.4](https://www.dguv.de/medien/ifa/en/pub/rep/pdf/reports-2019/report0217e/rep0217e.pdf).
Nástroj: SISTEMA (zdarma, IFA) ([IFA – Practical solutions EN ISO 13849](https://www.dguv.de/ifa/praxishilfen/practical-solutions-machine-safety/sicherheit-von-maschinensteuerungen/index.jsp)).

### 1.8 Software – SRESW / SRASW a V-model

- ISO 13849-1:2023 má samostatnou kap. 7 „Software safety requirements": 7.2 LVL/FVL, 7.3 SRESW, 7.4 SRASW. Příloha J
  obsahuje příklad SRESW, příloha N opatření proti systematickým chybám v SW a jednoduchý příklad validace SRASW
  ([iTeh sample](https://cdn.standards.iteh.ai/samples/73481/a2b27fd1dab8460fa3cef34426de7cce/ISO-13849-1-2023.pdf),
  [IFA/DGUV 4th edition](https://publikationen.dguv.de/widgets/pdf/download/article/4894)).
- **Rozpor v číslování:** zadání uvádí V-model v „kap. 4.6". To odpovídá vydání 2015 (IFA 7.4.6 odkazuje na „EN ISO 13849-1,
  subclause 4.6.4" pro parametrizaci). Ve vydání 2023 je V-model v kap. 7 a kap. 4.6 je „Safety function realization by
  using subsystems" ([iTeh sample, obsah](https://cdn.standards.iteh.ai/samples/73481/a2b27fd1dab8460fa3cef34426de7cce/ISO-13849-1-2023.pdf)).
- Novinka 2023: **zjednodušený dvoustupňový V-model** pro LVL (IEC 61131-3 LD, FBD, SFC, Booleova algebra) s validovanými
  funkčními bloky na ověřeném HW (SRASW). Specifikace bezpečnostního SW tu může vést přímo ke kódování. Kap. 7 neobsahuje
  žádné specifické požadavky na software s umělou inteligencí ([IFA/DGUV 4th edition](https://publikationen.dguv.de/widgets/pdf/download/article/4894)).
- Validace SW = „black-box test" celého SW integrovaného v HW, doplněný I/O testy a rozšířeným testem se simulovanými
  poruchami. Certifikované bezpečnostní funkční bloky se znovu netestují, ale musí se doložit, že validovány byly. Jejich
  kombinace v projektu se validuje jako celek. **Po každé změně SW se musí znovu ověřit a validovat v přiměřeném rozsahu.**
  Pro SRESW v PL e bez diverzity platí požadavky SIL 3 podle IEC 61508-3, kap. 7
  ([IFA 2/2017, 7.4.6](https://www.dguv.de/medien/ifa/en/pub/rep/pdf/reports-2019/report0217e/rep0217e.pdf)).
- Softwarová ruční parametrizace (ISO 13849-1:2023, 6.3) jsou samostatné požadavky: jen autorizované osoby, ověření
  parametrizačního nástroje (6.3.4) a dokumentace parametrizace (6.3.5)
  ([IFA/DGUV 4th edition](https://publikationen.dguv.de/widgets/pdf/download/article/4894);
  [iTeh sample](https://cdn.standards.iteh.ai/samples/73481/a2b27fd1dab8460fa3cef34426de7cce/ISO-13849-1-2023.pdf)).

### 1.9 Kombinace subsystémů, prostředí, údržba, informace pro uživatele, validační zpráva

- **Kombinace a integrace (IFA 7.6):** jednotlivé SRP/CS validovat zvlášť ještě před kombinací. Potom inspekce návrhové
  dokumentace, porovnání charakteristik rozhraní (napětí, proudy, tlaky, data), FMEA kombinace, funkční a rozšířená funkční
  zkouška a kontrola zjednodušeného stanovení celkového PL. Doporučen je I/O test.
- **Podmínky prostředí (ISO 13849-1:2023, 10.7):** funkční zkoušky za specifikovaných klimatických a mechanických podmínek
  a EMC (IFA 7.4.5). Příloha L normy 2023 se týká odolnosti vůči EMI.
- **Údržba (10.9) a udržovatelnost (kap. 11):** kap. 11 nově zahrnuje přístupnost, snadnost obsluhy, viditelnost,
  zjednodušení a automaticky generované pokyny k údržbě ([IFA/DGUV 4th edition](https://publikationen.dguv.de/widgets/pdf/download/article/4894)).
  *Neověřeno:* znění 10.9. Znám jen název kapitoly.
- **Informace pro používání (IFA 7.5):** kontrola, zda návod, montážní pokyny, štítky a pokyny k údržbě obsahují vše
  potřebné. Forma (jazyk, digitální či tištěná) se řídí předpisem, ne ISO 13849.
- **Ergonomie rozhraní (IFA 7.7):** prevence obcházení a manipulace, předvídatelná chybná obsluha. ISO 13849-1:2023 má nové
  5.2.3 „Minimizing motivation to defeat safety functions" a 5.2.4 „Remote access"
  ([IFA/DGUV 4th edition](https://publikationen.dguv.de/widgets/pdf/download/article/4894)).
- **Validační záznam / zpráva (IFA 7.1.7, norma 10.8):** dokumentují se všechny analýzy a zkoušky s výsledky.
  Uvádí se datované nebo verzované specifikace a normy, jednoznačná identifikace zkoušeného objektu (dokument, SW,
  vzorek), konfigurace, podmínky a postup, všechny body a výsledky, osoby, datum a podpis.
- **Nesplnění (IFA 7.1.8):** návrat do návrhu. V plánu se označí, které V&V činnosti je nutné zopakovat. Hodnocení je
  dokončeno, až když u všech BF platí PL ≥ PLr a jsou splněny požadavky specifikace.

Zdroj, kde není uvedeno jinak: [IFA 2/2017, kap. 7](https://www.dguv.de/medien/ifa/en/pub/rep/pdf/reports-2019/report0217e/rep0217e.pdf).

### 1.10 Validace při uvádění stroje do provozu (pohled integrátora)

Rockwell Safebook 5 uvádí: „validation of the safety functions must be carried out in all operating modes and should cover
all normal and foreseeable abnormal conditions. Combinations of inputs and sequences of operation must also be taken into
consideration." Validace je podle něj „functional test … normal operating conditions in addition to potential fault injection",
dokumentovaný kontrolním seznamem.
([Rockwell Safebook 5, SAFEBK-RM002C, 2016](https://literature.rockwellautomation.com/idc/groups/literature/documents/rm/safebk-rm002_-en-p.pdf))
*Rozdíl ve zdrojích:* Safebook 5 je z roku 2016 a jako zdroj požadavků na validaci uvádí ještě ISO 13849-2:2012.
Podle IFA a ISO je to dnes ISO 13849-1:2023, kap. 10.

---

## 2. Obsah specifikace bezpečnostních požadavků (SRS)

### 2.1 Pole pro každou bezpečnostní funkci – ISO 13849-1:2023, kap. 5 (podle výkladu IFA)

IFA/DGUV uvádí položky nutné pro přesnou a úplnou definici každé BF
([Fourth edition of EN ISO 13849-1](https://publikationen.dguv.de/widgets/pdf/download/article/4894)):

| # | Pole SRS | Poznámka |
|---|---|---|
| 1 | Název / stručný popis (jednoznačná reference) | ID funkce |
| 2 | Spouštěcí událost, která funkci vyžaduje | např. otevření krytu |
| 3 | Požadovaná reakce vedoucí do bezpečného stavu | např. STO, odvzdušnění |
| 4 | **PLr** | z posouzení rizik (příloha A nebo norma typu C) |
| 5 | Přípustná doba odezvy (od vyžádání do dosažení bezpečného stavu) | ve vydání 2023 povinně u všech BF |
| 6 | Provozní režimy, ve kterých je funkce aktivní | |
| 7 | Rozhraní k řízení stroje a k jiným BF | |
| 8 | Reakce na poruchu (návrat do bezpečného stavu po detekci poruchy v kanálu) | „if necessary" |
| 9 | Chování při ztrátě energie | např. zpětné ventily přímo na válci, mechanické brzdy. Lze rozdělit na dvě BF (s energií a bez ní) |
| 10 | Četnost vyžádání (demand rate) | |
| 11 | Priorita BF, které mohou být aktivní současně a vyvolat protichůdné reakce | |
| 12 | Doplňkové požadavky z norem typu C | |
| 13 | Podmínky pro opětovný rozběh po vyžádání BF | |

Doplnění z výkladů:
- **Ruční reset:** vyžaduje monitorovanou změnu signálu, tj. hranu, jako ochranu proti předvídatelnému zneužití.
  ([IFA/DGUV 4th edition](https://publikationen.dguv.de/widgets/pdf/download/article/4894))
- **Volba provozního režimu:** pokud zapíná nebo vypíná BF, je sama bezpečnostní funkcí. Normy přidávají i poznámky
  k BF pro údržbu a servis. ([tamtéž](https://publikationen.dguv.de/widgets/pdf/download/article/4894))
- **Motivace k obcházení (5.2.3) a vzdálený přístup (5.2.4):** vzdálený přístup omezit tak, aby nevznikla nebezpečná
  situace kvůli nepozorované přítomnosti osob. ([tamtéž](https://publikationen.dguv.de/widgets/pdf/download/article/4894))
- **Tabulky typických BF** byly přesunuty do přílohy M. Další vodítko dává SISTEMA Cookbook 6 „Definition of safety
  functions" ([tamtéž](https://publikationen.dguv.de/widgets/pdf/download/article/4894);
  [ISO 13849-1:2023 Preview – bibliografie [81]](https://www.studiobarbaracalvi.com/wp-content/uploads/2023/05/ISO-13849-1_2023-Preview.pdf)).
- **Pilz** shrnuje SRS takto: popis funkce se spouštěcí událostí, reakcí a bezpečným stavem, PLr, provozní režimy, doby
  reakce, reakce na chyby a chování, priorita, rozhraní k jiným BF
  ([Pilz India 2023](https://www.safe-machines-at-work.org/fileadmin/user_upload/pdf/control_devices/Seminars_Functional_Safety_and_Validation/Seminars__Functional_Safety_and_Validation__in_India/in_Bangalore__India__September_27th_-_28th/09_Changes_in_ISO13849-1_PILZ.pdf)).

### 2.2 Rozšířená šablona SRS (IFA Report 2/2017, Box 6.1)

IFA dává obecnou šablonu celé SRS ([IFA 2/2017, Box 6.1, s. 43–44](https://www.dguv.de/medien/ifa/en/pub/rep/pdf/reports-2019/report0217e/rep0217e.pdf)):

1. **Obecné údaje:** identifikace produktu, autor, verze, datum, terminologie, historie změn, použité předpisy a normy.
2. **Funkční údaje o stroji:** zamýšlené použití a rozumně předvídatelné nesprávné použití, popis procesu, provozní režimy,
   charakteristické údaje (časy cyklu, doby odezvy, doběhy), **bezpečný stav stroje**, interakce procesu a ručních zásahů
   (seřizování, čištění, odstraňování poruch), postup v nouzi, **chování při ztrátě energie**.
3. **PLr:** odkaz na posouzení rizik a výsledky pro každé nebezpečí s přiřazenými BF.
4. **Pro každou BF:** popis „vstup → logika → výstup", podmínky aktivace a deaktivace (režimy), chování stroje při spuštění BF,
   **podmínky opětovného rozběhu**, výkonová kritéria, časový průběh včetně **doby odezvy**, **četnost vyžádání** a doba
   zotavení, nastavitelné parametry, **priority při souběhu BF**, **chování při výpadku napájení**, koncept oddělení
   a nezávislosti od nebezpečnostních funkcí.
5. **Údaje pro návrh SRP/CS:** přiřazení technologie a zařízení, kategorie a blokové schéma, rozhraní (procesní, interní,
   HMI), chování při zapnutí a (re)startu, výkonové údaje, chování při poruchách součástí včetně časování, uvažované
   módy poruch a **zdůvodnění vyloučení poruch**, koncept detekce náhodných a systematických poruch, cílové MTTFD a DCavg,
   četnost spínání opotřebitelných součástí, četnost testů, doba mise (pokud není 20 let), **provozní a mezní podmínky
   prostředí** (teplota, vlhkost, IP, rázy a vibrace, EMC, napájení s tolerancemi), použité normy, **ochrana proti
   manipulaci a neoprávněnému přístupu k bezpečnostním parametrům** (klíč, kód), požadavky na uvedení do provozu,
   zkoušky, přejímku, údržbu a opravy.

IFA dodává, že specifikace musí být ověřena dřív, než se přejde k dalšímu kroku návrhu.

### 2.3 IEC 62061:2021

Kap. 5.2 „Safety requirements specification (SRS)" se dělí na 5.2.1 General, 5.2.2 Information to be available, 5.2.3
Functional requirements specification, 5.2.4 Estimation of demand mode of operation a 5.2.5 Safety integrity requirements
specification. Pořadí 5.2.2 a 5.2.3 je odvozeno z čísel stran v obsahu, protože text ukázky je poškozený.
([iTeh sample IEC 62061:2021](https://cdn.standards.iteh.ai/samples/100331/f60ea607ab4e48268e2b8fbddc83e9e8/IEC-62061-2021.pdf)).
Podle Rockwellu (k IEC 62061) obsahuje funkční specifikace „frequency of operation, required response time, operating modes,
duty cycles, operating environment, and fault reaction functions". Integrita se vyjadřuje jako SIL
([Rockwell Safebook 5, kap. 8](https://literature.rockwellautomation.com/idc/groups/literature/documents/rm/safebk-rm002_-en-p.pdf)).

### 2.4 Doporučená pole SRS pro aplikaci (sjednocení zdrojů 2.1–2.3)

`id`, `název`, `popis (vstup–logika–výstup)`, `nebezpečí / odkaz na posouzení rizik`, `spouštěcí událost`, `reakce`,
`bezpečný stav`, `kategorie zastavení (0/1/2)`, `PLr (nebo SIL)`, `provozní režimy aktivní`, `přípustná doba odezvy [ms]`,
`četnost vyžádání`, `priorita`, `podmínky resetu / opětovného rozběhu (ruční reset na hranu, místo resetu)`,
`rozhraní (k řízení stroje, k jiným BF)`, `reakce na poruchu`, `chování při ztrátě energie (el., pneu, hydr.)`,
`podmínky prostředí`, `nastavitelné parametry a ochrana proti manipulaci`, `požadavky norem typu C`,
`navržená architektura (kategorie, subsystémy)`, `použitá vyloučení poruch se zdůvodněním`,
`plán validace (odkaz)`, `stav schválení (kdo, kdy, verze)`.
Pole jsou převzata z [IFA/DGUV 4th edition](https://publikationen.dguv.de/widgets/pdf/download/article/4894)
a [IFA 2/2017 Box 6.1](https://www.dguv.de/medien/ifa/en/pub/rep/pdf/reports-2019/report0217e/rep0217e.pdf).
Pole „kategorie zastavení" vychází z IEC 60204-1 podle [IFA 2/2017, tab. 5.2](https://www.dguv.de/medien/ifa/en/pub/rep/pdf/reports-2019/report0217e/rep0217e.pdf).

---

## 3. Kontrolní seznam zkoušek pro FAT (po funkcích)

**Obecně pro každou zkoušku:** kontrolní seznam se záhlavím (stroj, sériové číslo, zákazník, datum, zkoušející, číslo schématu,
verze programu / safety signature, firmware), sloupce *krok – očekávaný výsledek – vyhověl/nevyhověl – změny*.
Bloky jsou: (A) ověření zapojení a konfigurace, (B) normální provoz, (C) abnormální provoz se vnášením poruch.
Každá vnesená porucha musí vést do bezpečného stavu a **systém nesmí jít resetovat ani znovu spustit, dokud porucha trvá**.
([Rockwell SAFETY-AT061C](https://literature.rockwellautomation.com/idc/groups/literature/documents/at/safety-at061_-en-p.pdf),
[Safebook 5, s. 130–134](https://literature.rockwellautomation.com/idc/groups/literature/documents/rm/safebk-rm002_-en-p.pdf))

Před bloky B a C (blok A):

| Krok | Očekávaný výsledek | Kritérium přijetí |
|---|---|---|
| Ověřit, že specifikace součástí odpovídají aplikaci (základní a osvědčené principy ISO 13849-2) | shoda | záznam |
| Vizuálně porovnat zapojení se schématy | shoda | bez odchylek |
| Ověřit konfiguraci bezpečnostního relé / PLC (program, parametry, safety signature) | odpovídá dokumentaci | shoda verze a signatury |
| Projít všechny vstupy a výstupy (I/O test) a sledovat stav | každý signál na správné adrese | 100 % I/O |

Zdroj: [Safebook 5, s. 130](https://literature.rockwellautomation.com/idc/groups/literature/documents/rm/safebk-rm002_-en-p.pdf),
[SAFETY-AT061C, s. 21](https://literature.rockwellautomation.com/idc/groups/literature/documents/at/safety-at061_-en-p.pdf).

### 3.1 Nouzové zastavení

Požadavek nařízení, příloha III, 1.2.4.3: povel musí trvat, dokud zařízení není výslovně odjištěno. Zařízení nelze
zaaretovat bez vyvolání povelu. Odjištění nesmí stroj spustit, jen povolit restart. Funkce je k dispozici v každém režimu
([EUR-Lex 2023/1230, příl. III 1.2.4.3](https://eur-lex.europa.eu/eli/reg/2023/1230/oj/eng)).

| Krok | Očekávaný výsledek | Kritérium přijetí |
|---|---|---|
| Za běhu stisknout každé tlačítko E-stop | stykače / STO odpadnou, pohyb se zastaví (kat. 0/1 podle SRS) | čas zastavení ≤ hodnota v SRS |
| Při stisknutém E-stopu dát Start | nic se nerozběhne | žádný pohyb |
| Odjistit E-stop | stroj se **nerozběhne** | žádný pohyb bez resetu a startu |
| Reset, pak Start | běh obnoven | jen tímto pořadím |
| Zopakovat ve všech provozních režimech | funkce vždy účinná | všechny režimy |
| Vnesení poruch: rozpojit kanál 1, potom kanál 2; kanál 1 na +24 V a na 0 V, totéž pro kanál 2; zkrat kanál 1–kanál 2 | bezpečný stav, porucha hlášena | reset nejde, dokud porucha trvá |
| U sběrnicového E-stopu odpojit komunikaci | bezpečný stav | ano |

Zdroj: [Rockwell SAFETY-AT071C, E-Stop V&V checklist](https://literature.rockwellautomation.com/idc/groups/literature/documents/at/safety-at071_-en-e.pdf),
[SAFETY-AT061C](https://literature.rockwellautomation.com/idc/groups/literature/documents/at/safety-at061_-en-p.pdf).

### 3.2 Blokování krytu (bez zámku)

| Krok | Očekávaný výsledek | Kritérium |
|---|---|---|
| Za běhu otevřít kryt | BF vybaví, pohyb se zastaví | do doby v SRS (příklad Rockwell: < 0,7 s) |
| Reset při otevřeném krytu | nic | žádná reakce |
| Zavřít kryt | stroj se **sám nerozběhne** | ano |
| Reset a Start | běh | jen tímto pořadím |
| Rozpojit nebo zkratovat každý kanál snímače (OSSD na 24 V, na 0 V, OSSD1–OSSD2) | vybavení / porucha | detekce, reset nejde |

Zdroj: [Safebook 5, s. 131–133](https://literature.rockwellautomation.com/idc/groups/literature/documents/rm/safebk-rm002_-en-p.pdf).
U snímačů s OSSD může detekce zkratu trvat déle. V příkladu Rockwell vypne snímač SensaGuard při spojení OSSD s 24 V
„after approximately 40 seconds" a při zkratu OSSD1–OSSD2 asi po 50 s. **Kritérium přijetí musí vycházet z dokumentace
konkrétního zařízení, ne z obecné hodnoty.**

### 3.3 Kryt se zámkem (guard locking)

| Krok | Očekávaný výsledek | Kritérium |
|---|---|---|
| Za běhu se pokusit otevřít | kryt zůstane zamčený, běh pokračuje | |
| Stop | pohon odpadne a **po časovém zpoždění nebo potvrzení klidu** se kryt odemkne | odemčení až po zastavení nebezpečného pohybu (doba doběhu z měření) |
| V klidu otevřít, dát Start | nic | |
| Rozpojit nebo zkratovat kanály **monitorování dveří** i **monitorování zámku** (24 V, 0 V, mezi kanály, na testovací zdroj) | bezpečný stav | reset nejde, dokud porucha trvá |
| Odpojit síť mezi safety I/O a PLC; přepnout PLC z Run | všechny výstupy odpadnou; po návratu do Run zůstanou vypnuté | |

Zdroj: [Rockwell SAFETY-AT061C, s. 21–23](https://literature.rockwellautomation.com/idc/groups/literature/documents/at/safety-at061_-en-p.pdf).

### 3.4 Světelná závora (ESPE/AOPD), doba doběhu a bezpečná vzdálenost

| Krok | Očekávaný výsledek | Kritérium |
|---|---|---|
| **Změřit dobu zastavení stroje** (zařízením pro měření doběhu) při nejhorších podmínkách | T = doba zastavení stroje + odezva závory (+ odezva logiky) | změřená hodnota je zdokumentována |
| **Vypočítat a změřit minimální vzdálenost** (ISO 13855:2010, kolmý přístup): S = K·T + 8·(d − 14). K = 2000 mm/s. Je-li S > 500 mm, přepočítat s K = 1600 mm/s; vyjde-li pak méně než 500 mm, použije se 500 mm | skutečná vzdálenost ≥ S | ano |
| Ověřit, že k nebezpečnému místu se lze dostat jen přes ochranné pole (nelze podlézt, přesáhnout, obejít) | ano | |
| **Zkouška zkušební tyčí** (průměr podle rozlišení na štítku): pomalu projet chráněnou plochou, pak podél okrajů, u zrcadel přímo před zrcadly | OSSD trvale červené | **ani krátce zelené**, jinak stroj neprovozovat |
| Vzdálenost od reflexních ploch | dodržena | podle návodu výrobce |
| Ovladač resetu / restartu | mimo nebezpečný prostor, s výhledem | |
| BF účinná ve všech režimech a po celou dobu nebezpečného stavu | ano | |
| EDM: výstupy závory monitorují stykače a ventily | ano | viz 3.12 |

Zdroje: [SICK deTec4 Core, 4.3.2, 4.5.1 a kontrolní seznam 15.3](https://www.sick.com/media/docs/1/11/011/operating_instructions_detec4_core_en_im0048011.pdf),
[Keyence – Safety distance](https://www.keyence.eu/ss/products/safetyknowledge/caution/),
[Safebook 5, s. 58 (T = Ts + Tc + Tr + Tbm, „usually measured by a stop-time measuring device")](https://literature.rockwellautomation.com/idc/groups/literature/documents/rm/safebk-rm002_-en-p.pdf).

**Rozpory a změny norem:**
- Vyšlo **ISO 13855:2024** (3. vydání, nahrazuje 2010). Podle Leuze (srpen 2025) zatím **není harmonizováno**, ale
  „reflects the state of the art" ([machinebuilding.net / Leuze](https://www.machinebuilding.net/iso-138552024--new-guidelines-for-safer-sensor-positioning-in-industrial-automation)).
  Návod SICK z dubna 2025 stále počítá podle ISO 13855:2010.
  Vzorec 2024 (podle vyhledávání S = K·T + D_DS + Z) jsem z primárního zdroje **neověřil**.
- Výklad konstanty K se liší. SICK uvádí K = 2000 mm/s s přepočtem na 1600 mm/s nad 500 mm. Keyence přiřazuje
  2000 „hand/finger" a 1600 „body". Rockwell píše „1600 mm/s … to 2500 mm/s … must be determined by the risk assessment"
  a uvádí odlišný americký vzorec Dpf (ANSI) ([Safebook 5, s. 58](https://literature.rockwellautomation.com/idc/groups/literature/documents/rm/safebk-rm002_-en-p.pdf)).
  Pro EU používat ISO 13855.

### 3.5 Dvouruční ovládání (ISO 13851)

| Krok | Očekávaný výsledek | Kritérium |
|---|---|---|
| Stisknout obě tlačítka současně | pohyb | |
| Pustit jedno nebo obě | pohyb se zastaví | |
| Stisknout jen levé, potom jen pravé | nic | |
| Stisknout levé a **pravé o 1 s později** (a obráceně) | nic | synchronnost ≤ 0,5 s (typ III) |
| Po spuštění pustit jedno a znovu stisknout | nic, dokud se nepustí obě | opětovné spuštění jen po uvolnění obou |
| Vnesení poruch v obou kanálech (rozpojení, 24 V, 0 V, zkrat mezi kanály) | bezpečný stav | |
| Ověřit bezpečnou vzdálenost ovladače od nebezpečí (ISO 13855) | pohyb se zastaví dřív, než ruka dosáhne nebezpečí | |

Zdroje: [Rockwell SAFETY-AT071C](https://literature.rockwellautomation.com/idc/groups/literature/documents/at/safety-at071_-en-e.pdf)
(„Simultaneous operation of the two buttons must be within 0.5 seconds per ISO 13851").
Ukázka [ISO 13851:2019](https://cdn.standards.iteh.ai/samples/70295/48c735b3148b4aa4943c9f1095f6541a/ISO-13851-2019.pdf)
obsahuje požadavky 5.7 Re-initiation, 5.8 Synchronous actuation a pro typ III minimálně PL c / SIL 1.
Hodnotu 0,5 s jsem v ukázce normy neviděl. Pochází z výkladu Rockwellu.

### 3.6 Ochrana proti neočekávanému rozběhu

| Krok | Očekávaný výsledek | Kritérium |
|---|---|---|
| Zapnout napájení | stroj se nerozběhne | žádný pohyb |
| Obnovit napájení po výpadku za běhu | žádný samovolný rozběh | jen po resetu a startu |
| Zavřít kryt, odjistit E-stop, uvolnit závoru | žádný rozběh | |
| Restart a změna podmínek | jen úmyslným ovládáním (výjimka: automatický režim, pokud nevznikne nebezpečí) | |

Zdroje: [EUR-Lex 2023/1230, příl. III 1.2.1 a 1.2.3](https://eur-lex.europa.eu/eli/reg/2023/1230/oj/eng),
[Safebook 5, s. 131 krok 7](https://literature.rockwellautomation.com/idc/groups/literature/documents/rm/safebk-rm002_-en-p.pdf).

### 3.7 Volba režimu a SLS (bezpečně omezená rychlost)

| Krok | Očekávaný výsledek | Kritérium |
|---|---|---|
| Přepínač režimů: každá poloha odpovídá jednomu režimu a lze ji uzamknout | ano | příl. III 1.2.5 |
| Ve zvoleném režimu ověřit všechny BF, které podle SRS mají být aktivní | ano | |
| SLS: zvolit omezenou rychlost, odemknout a otevřít kryt | pohyb jen ≤ SLS | |
| Za otevřeného krytu zvýšit rychlost nad mez SLS | nouzové zastavení (STO / odpad) | |
| Překročit bezpečnou maximální rychlost (SMS) v libovolném režimu | zastavení | |
| Přepnutí režimu za pohybu | bezpečný stav nebo definované chování podle SRS | |

Zdroje: [EUR-Lex 2023/1230, příl. III 1.2.5](https://eur-lex.europa.eu/eli/reg/2023/1230/oj/eng),
[Rockwell SAFETY-AT086A (SLS / SMS)](https://literature.rockwellautomation.com/idc/groups/literature/documents/at/safety-at086_-en-p.pdf),
[IFA/DGUV 4th edition (volba režimu = BF)](https://publikationen.dguv.de/widgets/pdf/download/article/4894).

### 3.8 Pneumatika – bezpečné odvzdušnění (SDE)

| Krok | Očekávaný výsledek | Kritérium |
|---|---|---|
| Vyžádat BF a změřit dobu poklesu tlaku na výstupu (manometrem nebo snímačem) | tlak klesne na hodnotu bez nebezpečí | doba odvzdušnění započtena do T (bezpečná vzdálenost) |
| Zkoušku opakovat při všech předvídatelných tlacích, průtocích a objemech | | podle návodu výrobce ventilu |
| Diagnostika ventilu (snímač polohy nebo tlaku) při každém sepnutí; simulace selhání jednoho kanálu | porucha detekována, bezpečný stav udržen | |
| Zachycený vzduch / svislé osy | žádný nebezpečný pohyb po odvzdušnění | případně další opatření |

Zdroje: [SMC, safety exhaust valve VP… DOC1092179](https://www.smcworld.com/upfiles/manual/en-jp/files/DOC1092179.pdf).
Výrobce uvádí, že doba odvzdušnění závisí na průtoku ventilu, tlumičích, objemu, tlaku a odporech systému. Uživatel ji
má stanovit a „the performance of the system should be validated by test after each installation". Udává i orientační
vzorce, např. T2 [ms] = 60·V[l] + 800 bez poruchy a 90·V + 800 při selhání jednoho kanálu. Pro kategorii 4 požaduje
diagnostický test alespoň jednou denně.
[IFA 2/2017, příklad 11](https://www.dguv.de/medien/ifa/en/pub/rep/pdf/reports-2019/report0217e/rep0217e.pdf)
upozorňuje, že odvzdušnění nadřazeným ventilem obvykle prodlužuje doběh, a to je nutné zohlednit ve vzdálenosti.

### 3.9 Hydraulika

| Krok | Očekávaný výsledek | Kritérium |
|---|---|---|
| Vyžádat BF: rozvaděče do střední uzavřené polohy (pružinové centrování) | pohyb se zastaví | doběh ≤ hodnota v SRS |
| Ověřit monitorování polohy šoupátka u ventilu, který se necykluje; simulovat ztrátu signálu nebo zaseknutí | porucha detekována | |
| Nadřazený ventil sepnout při vyžádání BF, **nejméně jednou za směnu** (podle příkladu) | funkční | |
| Zatížení gravitací / svislé osy | žádný pokles | podle SRS |

Zdroj: [IFA 2/2017, příklad 27 (hydraulika, kat. 3, PL e)](https://www.dguv.de/medien/ifa/en/pub/rep/pdf/reports-2019/report0217e/rep0217e.pdf).
*Poznámka:* veřejný zdroj s hotovým kontrolním seznamem FAT pro hydrauliku jsem nenašel. Tabulka je odvozena z popisu
příkladu IFA.

### 3.10 STO / SS1 (pohony, IEC 61800-5-2)

| Krok | Očekávaný výsledek | Kritérium |
|---|---|---|
| STO (kat. zastavení 0): vyžádat BF | motor bez momentu, doběh | doba odezvy STO podle údajů pohonu (příklad: < 15 ms pro PowerFlex 755 s modulem S3) |
| SS1 (kat. 1): vyžádat BF | řízené zpomalení, potom STO (SS1-t po čase, SS1-r při monitorování rampy) | časové zpoždění odpovídá SRS a změřenému doběhu |
| Simulovat poruchu (ztráta komunikace, PLC z Run) | pohon přejde do **kat. 0** | doběh volným výběhem zohledněn ve vzdálenostech; svislé zatížení zajištěno jinak |
| Reset | STO se uvolní jen po splnění podmínek a řádném resetu | |

Zdroje: [IFA 2/2017, tab. 5.2](https://www.dguv.de/medien/ifa/en/pub/rep/pdf/reports-2019/report0217e/rep0217e.pdf),
[Rockwell SAFETY-AT141D](https://literature.rockwellautomation.com/idc/groups/literature/documents/at/safety-at141_-en-p.pdf)
(„In the event of a malfunction, the most likely stop category is stop category 0 … timing and distance must be considered
for a coast-to-stop, and the possibility of the loss of control of a vertical load").

### 3.11 Muting

| Krok | Očekávaný výsledek | Kritérium |
|---|---|---|
| Projet materiálem ve správném pořadí senzorů a v časových mezích | muting aktivní, kontrolka muting svítí, pohyb pokračuje | |
| Konec mutingu | ukončen, jakmile objekt opustí senzory / závoru | |
| Špatné pořadí, překročení času, přerušení závory mimo muting (např. osobou) | porucha nebo bezpečné zastavení | |
| Muting a override nesmí ovlivnit E-stop | E-stop funguje vždy | |
| Override (vyprázdnění zablokovaného materiálu): jen klíčem, časově omezený, kontrolka bliká | po uplynutí času nebo uvolnění přepínače bezpečný stav | max. doba override podle SRS (příklad Rockwell: 20 s) |
| Ovladač override mimo dosah nebezpečí | ano | |

Zdroj: [Rockwell SAFETY-AT136D (muting se dvěma senzory)](https://literature.rockwellautomation.com/idc/groups/literature/documents/at/safety-at136_-en-p.pdf).
*Rozpor:* sekundární zdroje uvádějí pevné maximum mutingu „4 s". Rockwell má maximální dobu mutingu jako konfigurovatelný
parametr. Pevnou hodnotu z IEC 62046 jsem z primárního zdroje neověřil, proto ji nepřebírám.

### 3.12 Reset a EDM (monitorování stykačů, simulace svařeného kontaktu)

| Krok | Očekávaný výsledek | Kritérium |
|---|---|---|
| Reset musí reagovat na **hranu** signálu, ne na trvalou úroveň (zkratovat tlačítko resetu) | trvale sepnutý reset nic nespustí | ISO 13849-1:2023 |
| Za běhu **odpojit zpětné hlášení stykače** (EDM) | stykače zůstanou sepnuté; po Stop **nejde Reset ani Restart** | |
| **Zkratovat zpětné hlášení** (simulace nerozpojeného, svařeného stykače) | po Stop nejde Reset ani Restart | |
| Vnutit cívku K1 trvale na 24 V (simulace „visícího" stykače) | logika vybaví, K2 odpadne, porucha | |
| Zkrat cívky K1 na 0 V | vybavení, porucha | |

Zdroje: [IFA/DGUV 4th edition (reset na hranu)](https://publikationen.dguv.de/widgets/pdf/download/article/4894),
[SAFETY-AT061C, Safety Contactor Output Tests](https://literature.rockwellautomation.com/idc/groups/literature/documents/at/safety-at061_-en-p.pdf),
[Safebook 5, s. 133–134](https://literature.rockwellautomation.com/idc/groups/literature/documents/rm/safebk-rm002_-en-p.pdf).

### 3.13 Zkraty mezi kanály (cross-fault)

| Krok | Očekávaný výsledek | Kritérium |
|---|---|---|
| Pro každý dvoukanálový vstup: kanál 1 ↔ kanál 2, kanál ↔ +24 V, kanál ↔ 0 V, kanál ↔ testovací zdroj druhého kanálu | detekce (pulzní testy), bezpečný stav | detekce nejpozději při dalším vyžádání (kat. 3) nebo okamžitě či do doby podle dokumentace (kat. 4) |

Zdroje: [Safebook 5 (pulzní testy pro detekci cross-faultů)](https://literature.rockwellautomation.com/idc/groups/literature/documents/rm/safebk-rm002_-en-p.pdf),
[SAFETY-AT061C, kroky 4–5](https://literature.rockwellautomation.com/idc/groups/literature/documents/at/safety-at061_-en-p.pdf).
Požadavky na chování kategorií (kat. 3 / kat. 4) jsou ve výkladu
[IFA/DGUV 4th edition](https://publikationen.dguv.de/widgets/pdf/download/article/4894).

### 3.14 Ztráta napájení (elektrické, pneumatické, hydraulické)

| Krok | Očekávaný výsledek | Kritérium |
|---|---|---|
| Výpadek napájení řízení za běhu | bezpečný stav (podle SRS „chování při ztrátě energie") | |
| Podpětí, kolísání, přepětí na napájení bezpečnostní logiky | bezpečný stav, žádné nebezpečné chování | IFA 7.4.5 |
| Obnovení napájení | žádný samovolný rozběh | |
| Ztráta tlaku vzduchu nebo oleje | žádný pád nebo pohyb (zpětné ventily, brzdy podle SRS) | |

Zdroje: [IFA 2/2017, 7.4.5](https://www.dguv.de/medien/ifa/en/pub/rep/pdf/reports-2019/report0217e/rep0217e.pdf),
[EUR-Lex 2023/1230, příl. III 1.2.1 písm. e) „no moving part … shall fall"](https://eur-lex.europa.eu/eli/reg/2023/1230/oj/eng),
[IFA/DGUV 4th edition (ztráta energie v SRS)](https://publikationen.dguv.de/widgets/pdf/download/article/4894).

### 3.15 CCF (poruchy se společnou příčinou)

Ověřuje se hlavně analýzou: bodové hodnocení podle přílohy F, minimálně 65 bodů
([Safebook 5, s. 129](https://literature.rockwellautomation.com/idc/groups/literature/documents/rm/safebk-rm002_-en-p.pdf)).
Zkouškou se potvrdí, že opatření jsou skutečně provedena: oddělení vedení, diverzita, ochrana proti přepětí, EMC, teplota.
IFA doporučuje statickou analýzu HW a funkční zkoušky v mezních podmínkách prostředí
([IFA 2/2017, 7.4.4](https://www.dguv.de/medien/ifa/en/pub/rep/pdf/reports-2019/report0217e/rep0217e.pdf)).

| Krok | Očekávaný výsledek | Kritérium |
|---|---|---|
| Kontrola provedení opatření z hodnocení CCF na stroji (fyzické oddělení kanálů, kabeláž, odrušení, rozdílné technologie) | odpovídá dokumentaci | součet bodů ≥ 65 platí pro realizaci |
| Funkční zkouška při mezních podmínkách (napětí, teplota podle specifikace) | BF funguje | |

---

## 4. Požadavky nařízení (EU) 2023/1230 na dokumentaci a posouzení shody

Text: [EUR-Lex, nařízení (EU) 2023/1230](https://eur-lex.europa.eu/eli/reg/2023/1230/oj/eng), oprava
[OJ L 169/35](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=uriserv%3AOJ.L_.2023.169.01.0035.01.ENG).

### 4.1 Časový rámec a přechod

- **čl. 54:** použitelnost **od 20. 1. 2027** (po opravě). Dříve platí čl. 26–42 (oznámené subjekty) od 20. 1. 2024,
  čl. 50 odst. 1 (sankce) od 20. 10. 2026 a čl. 6 odst. 7, čl. 48 a 52 od 19. 7. 2023.
- **čl. 51 odst. 2:** směrnice 2006/42/ES se zrušuje s účinkem od 20. 1. 2027. Odkazy na ni se čtou jako odkazy na
  nařízení podle srovnávací tabulky v příloze XII.
- **čl. 52:** výrobky uvedené na trh podle směrnice **před 20. 1. 2027** lze dále dodávat na trh. Certifikáty ES
  přezkoušení typu podle čl. 12 směrnice platí do konce své platnosti.
- Do 19. 1. 2027 se tedy při uvádění na trh postupuje podle směrnice, od 20. 1. 2027 podle nařízení.

### 4.2 Technická dokumentace – příloha IV

**Část A (stroje a související výrobky)** musí obsahovat nejméně:
a) úplný popis stroje a zamýšleného použití;
b) dokumentaci posouzení rizik: (i) seznam použitelných základních požadavků (EHSR), (ii) popis ochranných opatření ke
   každému z nich a případně zbytková rizika;
c) konstrukční a výrobní výkresy a schémata stroje, součástí, podsestav a **obvodů**;
d) popisy nutné k pochopení výkresů, schémat a činnosti stroje;
e) odkazy na použité harmonizované normy nebo společné specifikace, při částečném použití i které části;
f) jiné použité technické specifikace, kde normy použity nebyly;
g) **zprávy a výsledky výpočtů, zkoušek, inspekcí a prověrek** ověřujících shodu (sem patří validační zpráva a protokoly FAT);
h) prostředky zajištění shody ve výrobě;
i) kopii návodu k použití a informací podle 1.7.4;
j) případně EU prohlášení o začlenění neúplných strojů a montážní návody (příloha XI);
k) případně EU prohlášení o shodě začleněných výrobků podle jiných předpisů;
l) u sériové výroby vnitřní opatření k udržení shody;
m) **zdrojový kód nebo programovou logiku bezpečnostního softwaru** na odůvodněnou žádost orgánu;
n) u strojů řízených senzory, dálkově řízených nebo autonomních, kde bezpečnostní operace řídí data ze senzorů: popis
   charakteristik, schopností a omezení systému, dat, vývoje, testování a validace;
o) výsledky zkoušek, zda lze stroj bezpečně smontovat a uvést do provozu.

**Část B (neúplné strojní zařízení):** obdobně, body a) až m). Místo návodu je kopie montážního návodu (příloha XI).
Zdrojový kód bezpečnostního SW se předkládá na odůvodněnou žádost (bod k). Popis senzorového nebo autonomního řízení
obsahuje bod l).

**Uchovávání:** technickou dokumentaci a EU prohlášení o shodě uchovává výrobce **nejméně 10 let** od uvedení na trh
nebo do provozu (čl. 10 odst. 3; u neúplných strojů čl. 11 odst. 3; dovozci čl. 13 odst. 8; zplnomocněný zástupce
čl. 12 odst. 2 písm. a)). Zdrojový kód nebo programovou logiku zahrnutou v dokumentaci poskytne výrobce na odůvodněnou
žádost (čl. 10 odst. 3).

*Rozdíl oproti směrnici:* směrnice (příl. VII) počítala 10 let „following the date of manufacture … or … of the last unit
produced" ([směrnice 2006/42/ES](https://eur-lex.europa.eu/eli/dir/2006/42/oj/eng)). Nařízení počítá od uvedení na trh
nebo do provozu.

### 4.3 Návod k použití – čl. 10 odst. 7 a příloha III 1.7.4

- **Digitální forma je dovolena** (čl. 10 odst. 7). Pokud je návod digitální, výrobce musí:
  a) na stroji, obalu nebo v průvodním dokladu uvést, jak se k návodu dostat;
  b) dodat ho ve formátu, který lze vytisknout, stáhnout a uložit, aby byl dostupný kdykoli, i při poruše stroje. To platí
     i pro návod vložený do softwaru stroje;
  c) držet ho online po dobu očekávané životnosti a **nejméně 10 let** od uvedení na trh.
- **Na žádost uživatele při nákupu** dodá výrobce návod **v tištěné podobě zdarma do jednoho měsíce**.
- Pro neprofesionální uživatele (i předvídatelné) musí být bezpečnostní informace nutné k uvedení do provozu a bezpečnému
  používání vždy v tištěné podobě.
- Jazyk: snadno srozumitelný uživatelům, jak určí členský stát. Výjimka (1.7.4): pokyny k údržbě pro specializovaný
  personál pověřený výrobcem mohou být v jednom úředním jazyce EU, kterému tento personál rozumí.
- **Obsah (1.7.4.2), výběr pro bezpečnostní funkce:** c) EU prohlášení o shodě nebo odkaz / strojově čitelný kód, e) výkresy
  a schémata pro používání, údržbu a **kontrolu správné funkce**, k) uvedení do provozu a zaškolení, l) **zbytková rizika**,
  m) ochranná opatření uživatele včetně OOP, q) postup při nehodě nebo poruše a bezpečné odblokování, r) a s) seřizování
  a údržba včetně ochranných opatření při nich, t) náhradní díly ovlivňující bezpečnost.
- Navazuje 1.1.2 písm. e): stroj musí umožnit, aby uživatel **zkoušel bezpečnostní funkce**. Kde je to vhodné, dodá
  výrobce popis konkrétních postupů funkčních zkoušek. To je přímý podklad pro „pravidelné zkoušky BF" v návodu.

Zdroj: [EUR-Lex 2023/1230, čl. 10 a příl. III 1.1.2, 1.7.4](https://eur-lex.europa.eu/eli/reg/2023/1230/oj/eng).
*Rozdíl oproti směrnici:* směrnice vyžadovala návod v úředním jazyce s označením „Original instructions" nebo
„Translation of the original instructions" a digitální formu výslovně neupravovala
([směrnice 2006/42/ES, příl. I 1.7.4.1](https://eur-lex.europa.eu/eli/dir/2006/42/oj/eng)).

### 4.4 EU prohlášení o shodě – čl. 21 a příloha V

**Příloha V, část A (stroje):**
1. stroj (výrobek, typ, model, šarže nebo sériové číslo) nebo podstatně změněný stroj;
2. jméno a adresa výrobce, případně zplnomocněného zástupce;
3. u zdvihacích strojů montovaných až na místě adresa místa;
4. „vydáno na výhradní odpovědnost výrobce";
5. předmět prohlášení (identifikace umožňující sledovatelnost, případně barevný obrázek);
6. shoda s harmonizačními předpisy EU;
7. odkazy na harmonizované normy nebo společné specifikace **včetně data zveřejnění odkazu v Úř. věst.**, nebo jiné
   specifikace s datem; při částečném použití také použité části;
8. případně oznámený subjekt (název, číslo), modul B a certifikát, následovaný modulem C, G nebo H;
9. případně postup modulu A;
10. doplňující informace; podpis za koho, místo a datum, jméno, funkce, podpis.

Další povinnosti: prohlášení se průběžně aktualizuje a překládá. Při více předpisech se vydává jedno prohlášení (čl. 21).
Stroj ho má doprovázet, nebo návod uvede internetovou adresu či strojově čitelný kód. Digitální prohlášení musí být
dostupné online po dobu životnosti a nejméně 10 let (čl. 10 odst. 8).
**Část B:** EU prohlášení o začlenění neúplného stroje, včetně výroku, že stroj nesmí být uveden do provozu, dokud finální
stroj neprohlásí shodu.

Zdroj: [EUR-Lex 2023/1230, čl. 10, 21, 22, příl. V](https://eur-lex.europa.eu/eli/reg/2023/1230/oj/eng).

### 4.5 Postupy posuzování shody – čl. 25 a příloha I

| Kategorie | Povolené postupy (čl. 25) |
|---|---|
| **Příloha I, část A** | modul B + C (příl. VII + VIII), modul H (příl. IX), modul G (příl. X). **Vždy se zapojením oznámeného subjektu. Modul A nelze.** |
| **Příloha I, část B** | modul A (příl. VI) **jen tehdy**, když stroj splňuje harmonizované normy nebo společné specifikace pokrývající **všechny** relevantní EHSR; jinak B + C, H nebo G |
| Mimo přílohu I | modul A (interní řízení výroby) |

**Příloha I, část A** (6 položek): snímatelná mechanická převodová zařízení a jejich kryty, zvedáky pro údržbu vozidel,
přenosné upevňovací a jiné rázové stroje s nábojkami, **bezpečnostní součásti s plně nebo částečně samovyvíjejícím se
chováním využívajícím strojové učení, které zajišťují bezpečnostní funkce (bod 5)** a **stroje s vestavěnými systémy
s takovým chováním zajišťujícími bezpečnostní funkce, pokud nebyly uvedeny na trh samostatně, a to jen pro tyto systémy
(bod 6)**.

**Příloha I, část B** (19 položek) zahrnuje mimo jiné: pily a dřevoobráběcí stroje, **lisy včetně ohraňovacích lisů pro
tváření kovů za studena s ručním zakládáním nebo vyjímáním (zdvih > 6 mm a rychlost > 30 mm/s)**, **vstřikovací
a lisovací stroje na plasty a pryž s ručním zakládáním nebo vyjímáním**, zařízení pro zvedání osob s rizikem pádu z více
než 3 m, **ochranná zařízení určená k detekci osob (bod 15)**, poháněné blokovací pohyblivé kryty pro stroje z bodů 9–11,
**logické jednotky k zajištění bezpečnostních funkcí (bod 17)**, ROPS a FOPS.

Označení CE následuje identifikační číslo oznámeného subjektu, pokud se podílel (čl. 24 odst. 3).
Zdroj: [EUR-Lex 2023/1230, čl. 6, 24, 25, příl. I](https://eur-lex.europa.eu/eli/reg/2023/1230/oj/eng).

*Rozdíl oproti směrnici:* podle čl. 12 směrnice šlo u strojů z přílohy IV (např. logické jednotky, detekční ochranná
zařízení) použít interní kontrolu výroby, pokud byly vyrobeny podle harmonizovaných norem pokrývajících všechny EHSR.
Jinak byl nutný typový přezkoušení nebo komplexní QA ([směrnice 2006/42/ES, čl. 12](https://eur-lex.europa.eu/eli/dir/2006/42/oj/eng)).
Nařízení tento princip zachovává pro část B. Nově zavádí část A s **povinným oznámeným subjektem**, kam patří hlavně
bezpečnostní systémy se strojovým učením. Doplňuje i modul G (ověření jednotlivého výrobku).

### 4.6 Bezpečnostní součásti a software s bezpečnostní funkcí – čl. 3, čl. 7, příloha II

- Definice (čl. 3): „safety component" je fyzická nebo **digitální součást, včetně softwaru**, určená k plnění
  bezpečnostní funkce a **samostatně uvedená na trh**, jejíž selhání ohrožuje osoby a která není nutná pro funkci výrobku.
- **Příloha II (orientační seznam)** zahrnuje mimo jiné: ochranná zařízení k detekci osob, logické jednotky pro
  bezpečnostní funkce, **ventily s dalšími prostředky detekce poruch pro řízení nebezpečných pohybů**, kryty a ochranná
  zařízení proti pohyblivým částem, **zařízení nouzového zastavení**, **dvouruční ovladače**, bezpečnostní spínače
  s elektronikou (u výtahových zařízení), **„Software ensuring safety functions" (bod 18)** a bezpečnostní součásti se
  samovyvíjejícím se chováním (ML) (bod 19).

Zdroj: [EUR-Lex 2023/1230, čl. 3, 7, příl. II](https://eur-lex.europa.eu/eli/reg/2023/1230/oj/eng).
*Rozdíl oproti směrnici:* příloha V směrnice software ani ML výslovně neuváděla
([směrnice 2006/42/ES, příl. V](https://eur-lex.europa.eu/eli/dir/2006/42/oj/eng)).

**Vlastní výklad pro PLCdesk (neověřeno u úřadu ani oznámeného subjektu):** pokud by se aplikace nebo její výstup samostatně
uváděly na trh jako „software zajišťující bezpečnostní funkce", šlo by o bezpečnostní součást podle čl. 3 a příl. II
bod 18. AI používaná jen při **návrhu**, která se nestane součástí stroje a samostatně nevyvíjí jeho chování, podle
znění přílohy I části A bodů 5–6 do těchto kategorií zřejmě nespadá. Rozhodnutí patří odborníkovi nebo oznámenému subjektu.

### 4.7 Ochrana proti poškození (kybernetická bezpečnost) – příloha III 1.1.9 a 1.2.1

**1.1.9 Protection against corruption** požaduje:
- připojení jiného zařízení nebo vzdáleného zařízení nesmí vést k nebezpečné situaci;
- HW součást přenášející signál nebo data, která je relevantní pro přístup k softwaru kritickému pro shodu, musí být
  přiměřeně chráněna před náhodným i úmyslným poškozením. Stroj **sbírá důkazy o oprávněném i neoprávněném zásahu** do této
  součásti;
- software a data kritické pro shodu musí být **označeny** a chráněny;
- stroj musí **identifikovat bezpečnostně nutný software** a tuto informaci kdykoli snadno poskytnout;
- stroj sbírá důkazy o zásahu do softwaru nebo jeho modifikaci, včetně konfigurace.

**1.2.1 Safety and reliability of control systems** (nově proti směrnici):
- a) odolnost i vůči **„reasonably foreseeable malicious attempts from third parties"**;
- b) a c) porucha HW nebo logiky ani chyby v logice nesmějí vést k nebezpečné situaci;
- d) meze bezpečnostních funkcí se stanoví v posouzení rizik. Změny nastavení nebo pravidel generované strojem nebo
  obsluhou, i ve fázi učení, nejsou dovoleny, pokud by vedly k nebezpečí;
- f) **záznam (tracing log)** dat o zásahu a o verzích bezpečnostního softwaru nahraných po uvedení na trh se uchovává
  **5 let** od nahrání, výhradně pro prokázání shody na žádost orgánu;
- u strojů se samovyvíjejícím chováním: nesmějí překročit definovaný úkol a prostor pohybu. Záznam rozhodování
  bezpečnostního SW se uchovává **1 rok**. Stroj musí jít vždy korigovat;
- bezdrátové řízení: výpadek nebo chyba spojení nesmí vést k nebezpečí.
- Předpoklad shody pro 1.1.9 a 1.2.1 v rozsahu kybernetické bezpečnosti mohou dát certifikáty podle nařízení (EU) 2019/881
  (čl. 20 odst. 9).

Zdroj: [EUR-Lex 2023/1230, příl. III 1.1.9, 1.2.1, čl. 20](https://eur-lex.europa.eu/eli/reg/2023/1230/oj/eng).
Pro porovnání: znění 1.2.1 ve směrnici neobsahuje zlomyslné pokusy, log ani ML
([směrnice 2006/42/ES, příl. I 1.2.1](https://eur-lex.europa.eu/eli/dir/2006/42/oj/eng)).
ISO 13849-1:2023 výslovně „does not provide specific measures for security aspects" a odkazuje na ISO/TR 22100-4
a IEC/TR 63074 ([ISO 13849-1:2023 Preview](https://www.studiobarbaracalvi.com/wp-content/uploads/2023/05/ISO-13849-1_2023-Preview.pdf)).

### 4.8 Další změny proti směrnici, které se týkají bezpečnostních funkcí

- **Podstatná změna (čl. 3 a 18):** fyzická nebo **digitální** změna po uvedení na trh, kterou výrobce nepředvídal, která
  vytváří nové nebezpečí nebo zvyšuje riziko a vyžaduje přidat ochranné zařízení se změnou bezpečnostního řídicího systému
  (nebo opatření pro stabilitu a pevnost). Kdo ji provede, stává se výrobcem.
- **Posouzení rizik (příl. III, část B, bod 1)** musí zahrnout i nebezpečí ze zamýšleného vývoje samovyvíjejícího se
  chování a z interakce strojů v sestavě.
- **Ergonomie (1.1.6 f), g)):** HMI musí odpovídat obsluze i u autonomních strojů.
- **Nouzové zastavení (1.2.4.3):** výslovně „available and operational at all times, regardless of the operating mode".

Zdroj: [EUR-Lex 2023/1230](https://eur-lex.europa.eu/eli/reg/2023/1230/oj/eng).

---

## 5. Co musí v aplikaci zůstat ke schválení uživatelem (odpovědnou osobou)

Podle zdrojů leží odpovědnost na výrobci stroje, tedy na osobě, která stroj uvádí na trh nebo do provozu, případně na tom,
kdo provede podstatnou změnu:

- výrobce zajišťuje návrh v souladu s EHSR (čl. 10 odst. 1), vypracovává technickou dokumentaci a provádí posouzení
  shody (čl. 10 odst. 2), **přebírá odpovědnost vydáním EU prohlášení o shodě** (čl. 21 odst. 4) a podepisuje ho
  (příl. V) ([EUR-Lex](https://eur-lex.europa.eu/eli/reg/2023/1230/oj/eng));
- výrobce **zajistí posouzení rizik** a iterativně určí meze stroje, nebezpečí, odhad a hodnocení rizik a opatření
  v pořadí podle 1.1.2 písm. b) (příl. III, část B, bod 1) ([EUR-Lex](https://eur-lex.europa.eu/eli/reg/2023/1230/oj/eng));
- povinnost vypracovat technickou dokumentaci **nemůže být součástí mandátu zplnomocněného zástupce** (čl. 12 odst. 1).
  To ukazuje, že ji nelze „delegovat pryč" ([EUR-Lex](https://eur-lex.europa.eu/eli/reg/2023/1230/oj/eng));
- ISO 13849-1 se uplatní až tam, kde posouzení rizik podle ISO 12100 určí, že snížení rizika spoléhá na bezpečnostní
  funkci. Norma sama neurčuje, jaké BF a jaké PLr se mají použít („does not specify the safety functions or required
  performance levels") ([ISO 13849-1:2023 Preview](https://www.studiobarbaracalvi.com/wp-content/uploads/2023/05/ISO-13849-1_2023-Preview.pdf));
- každá metoda odhadu rizika „will show a variance because of the subjective nature of the evaluation criteria"
  ([tamtéž](https://www.studiobarbaracalvi.com/wp-content/uploads/2023/05/ISO-13849-1_2023-Preview.pdf)).
  Výsledek rizikového grafu je tedy odborný úsudek, ne výpočet;
- V&V mají provádět osoby nezávislé na návrhu, s nezávislostí úměrnou PLr
  ([IFA 2/2017, 7.1.1](https://www.dguv.de/medien/ifa/en/pub/rep/pdf/reports-2019/report0217e/rep0217e.pdf)).
  IEC 62061 stanoví minimální úrovně nezávislosti v příloze J
  ([iTeh sample IEC 62061](https://cdn.standards.iteh.ai/samples/100331/f60ea607ab4e48268e2b8fbddc83e9e8/IEC-62061-2021.pdf)).

**Body, které aplikace jen navrhuje a uživatel výslovně schvaluje (s podpisem, datem a verzí):**

1. **Meze stroje, zamýšlené použití a předvídatelné nesprávné použití** (příl. III, část B, bod 1 a)).
2. **Identifikace nebezpečí a nebezpečných situací**, odhad a hodnocení rizik, volba opatření v pořadí: konstrukce →
   ochranná opatření → informace (1.1.2 b)). Aplikace nesmí sama rozhodnout, že riziko je přijatelné.
3. **Seznam bezpečnostních funkcí a jejich přiřazení k nebezpečím.**
4. **PLr (parametry S, F, P a pravděpodobnost výskytu)** pro každou BF, případně převzetí z normy typu C. Při použití
   nižšího odhadu pravděpodobnosti výskytu podle přílohy A vydání 2023 je nutné zdůvodnění
   ([IFA/DGUV 4th edition, Annex A](https://publikationen.dguv.de/widgets/pdf/download/article/4894)).
5. **Celá SRS** (všechna pole z kap. 2.4) a její **přezkum před návrhem** (ISO 13849-1:2023, 5.4).
6. **Architektura / kategorie a výběr součástí**, zejména **každé vyloučení poruchy** se zdůvodněním. PL e nesmí stát
   jen na vyloučení poruch.
7. **Doba zastavení a bezpečné vzdálenosti:** aplikace smí počítat jen ze **změřených** hodnot zadaných uživatelem,
   výpočet schvaluje uživatel. Vzorec a vydání normy (ISO 13855:2010 / 2024) musí být viditelné.
8. **Validační plán** (kdo, co, kdy, kritéria) a **validační zpráva / protokol FAT**. Výsledky „vyhověl / nevyhověl"
   zadává člověk podle skutečné zkoušky na stroji. Simulace v aplikaci ověřuje návrh, ne skutečný stroj
   (shodně se zásadou projektu, že simulace „ověřuje návrh, ne kód v cílovém IDE").
9. **Bezpečnostní program / konfigurace bezpečnostního PLC nebo relé.** Podle pravidel projektu PLCdesk
   (CLAUDE.md: „nikdy negenerovat safety logiku") aplikace bezpečnostní logiku negeneruje. Může nanejvýš navrhnout
   specifikaci a kontrolní seznamy.
10. **Zbytková rizika a texty do návodu** (1.7.4.2 l), m)), včetně postupů pravidelných zkoušek BF (1.1.2 e)).
11. **Technická dokumentace, EU prohlášení o shodě a volba postupu posuzování shody** (příloha I A/B, moduly), včetně
    rozhodnutí, zda je nutný oznámený subjekt.
12. **Kybernetická bezpečnost (1.1.9):** které SW a data jsou kritické, jak jsou chráněny a jak se zaznamenávají zásahy.
13. **Posouzení změn:** po každé změně SW nebo HW rozhoduje odpovědná osoba o rozsahu opakované V&V
    ([IFA 2/2017, 7.4.6](https://www.dguv.de/medien/ifa/en/pub/rep/pdf/reports-2019/report0217e/rep0217e.pdf))
    a o tom, zda jde o podstatnou změnu (čl. 3 a 18).

Doporučení pro UI, odvozené ze zdrojů výše: každý výstup modulu nese stav *návrh → přezkoumáno → schváleno* se jménem,
datem a verzí (obdoba „formal aspects" ve V&V plánu podle [IFA 7.1.2](https://www.dguv.de/medien/ifa/en/pub/rep/pdf/reports-2019/report0217e/rep0217e.pdf)).
Dál nese disclaimer „návrh k revizi" a odkaz na použité vydání norem (u ISO 13849-1 rozlišovat 2015 / 2023, u ISO 13855
2010 / 2024).

---

## 6. Co se nepodařilo ověřit

- Plné znění ISO 13849-1:2023 (kap. 5.2.1 a kap. 10 v detailu, zejména 10.4.4 počet vzorků a 10.9 údržba). Mám jen obsah
  a výklady IFA a Pilz.
- Plné znění ISO 13849-2:2012 / prEN ISO 13849-2:2026 (seznamy poruch, přesná čísla kapitol).
- ISO 13855:2024: nový vzorec a jeho harmonizace (jen sekundární zdroje).
- IEC 62046: pevné časové limity mutingu.
- Zda už existuje seznam harmonizovaných norem k nařízení 2023/1230 a průvodce Komise k nařízení. Na stránce Komise
  k 3. 10. 2026 nebyl.
- IFA Report 1/2025 „Funktionale Sicherheit von Maschinensteuerungen" (DE) je zřejmě nástupce reportu 2/2017
  ([DGUV](https://publikationen.dguv.de/widgets/pdf/download/article/5091)). Nečetl jsem ho, report 2/2017 vychází
  z ISO 13849-1:2015 a ISO 13849-2:2012.
- Hotový kontrolní seznam FAT pro hydrauliku od výrobce.

---

## Seznam zdrojů

**Právní předpisy (plné znění, zdarma)**
- Nařízení (EU) 2023/1230 o strojních zařízeních, EUR-Lex: https://eur-lex.europa.eu/eli/reg/2023/1230/oj/eng
  (text čten přes Cellar: http://publications.europa.eu/resource/celex/32023R1230)
- Oprava nařízení 2023/1230, Úř. věst. L 169, 4. 7. 2023, s. 35: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=uriserv%3AOJ.L_.2023.169.01.0035.01.ENG
- Směrnice 2006/42/ES: https://eur-lex.europa.eu/eli/dir/2006/42/oj/eng
- Prováděcí rozhodnutí Komise (EU) 2024/1329 (harmonizované normy ke směrnici): http://data.europa.eu/eli/dec_impl/2024/1329/oj ;
  kopie PDF: https://www.ibf-solutions.com/fileadmin/dateidownloads/amtsblaetter/eu-official-journal-2024-05-15-2024-1329-md.pdf
- Evropská komise – Machinery: https://single-market-economy.ec.europa.eu/sectors/mechanical-engineering/machinery_en
- Průvodce aplikací směrnice 2006/42/ES, vyd. 2.3 (2024): https://ec.europa.eu/docsroom/documents/60145

**IFA / DGUV**
- IFA Report 2/2017e, Functional safety of machine controls (kap. 6 Box 6.1, kap. 7 V&V, kap. 8 příklady): https://www.dguv.de/medien/ifa/en/pub/rep/pdf/reports-2019/report0217e/rep0217e.pdf
- IFA/DGUV: Fourth edition of EN ISO 13849-1 – Most important new features in 2023 at a glance (2024): https://publikationen.dguv.de/widgets/pdf/download/article/4894
- IFA – Practical solutions EN ISO 13849 (SISTEMA, Cookbooks): https://www.dguv.de/ifa/praxishilfen/practical-solutions-machine-safety/sicherheit-von-maschinensteuerungen/index.jsp
- IFA Report 1/2025 (DE, nečteno): https://publikationen.dguv.de/widgets/pdf/download/article/5091

**Normy – volné ukázky a výklady**
- ISO 13849-1:2023 Preview (předmluva, úvod, rozsah, definice, bibliografie): https://www.studiobarbaracalvi.com/wp-content/uploads/2023/05/ISO-13849-1_2023-Preview.pdf
- ISO 13849-1:2023, ukázka iTeh (obsah): https://cdn.standards.iteh.ai/samples/73481/a2b27fd1dab8460fa3cef34426de7cce/ISO-13849-1-2023.pdf
- IEC 62061:2021, ukázka iTeh (obsah): https://cdn.standards.iteh.ai/samples/100331/f60ea607ab4e48268e2b8fbddc83e9e8/IEC-62061-2021.pdf
- ISO 13851:2019, ukázka iTeh: https://cdn.standards.iteh.ai/samples/70295/48c735b3148b4aa4943c9f1095f6541a/ISO-13851-2019.pdf
- Pilz India: Changes in EN ISO 13849-1 (2023): https://www.safe-machines-at-work.org/fileadmin/user_upload/pdf/control_devices/Seminars_Functional_Safety_and_Validation/Seminars__Functional_Safety_and_Validation__in_India/in_Bangalore__India__September_27th_-_28th/09_Changes_in_ISO13849-1_PILZ.pdf
- ibf solutions: The new prEN ISO 13849-2: https://www.ibf-solutions.com/en/news-and-knowledge/technical-papers-and-news-on-ce-marking/the-new-pren-iso-13849-2
- Leuze / machinebuilding.net: ISO 13855:2024: https://www.machinebuilding.net/iso-138552024--new-guidelines-for-safer-sensor-positioning-in-industrial-automation

**Výrobci**
- Rockwell Automation, Safebook 5 (SAFEBK-RM002C, 2016): https://literature.rockwellautomation.com/idc/groups/literature/documents/rm/safebk-rm002_-en-p.pdf
- Rockwell SAFETY-AT071C, Two Hand Control + E-Stop V&V checklist: https://literature.rockwellautomation.com/idc/groups/literature/documents/at/safety-at071_-en-e.pdf
- Rockwell SAFETY-AT061C, Door Locking and Monitoring V&V checklist: https://literature.rockwellautomation.com/idc/groups/literature/documents/at/safety-at061_-en-p.pdf
- Rockwell SAFETY-AT086A, Safe Limited Speed / Safe Maximum Speed: https://literature.rockwellautomation.com/idc/groups/literature/documents/at/safety-at086_-en-p.pdf
- Rockwell SAFETY-AT136D, Light Curtain with Muting: https://literature.rockwellautomation.com/idc/groups/literature/documents/at/safety-at136_-en-p.pdf
- Rockwell SAFETY-AT141D, Stop Cat. 0/1 via PowerFlex STO: https://literature.rockwellautomation.com/idc/groups/literature/documents/at/safety-at141_-en-p.pdf
- SICK deTec4 Core, návod (zkouška zkušební tyčí, minimální vzdálenost, kontrolní seznam uvedení do provozu): https://www.sick.com/media/docs/1/11/011/operating_instructions_detec4_core_en_im0048011.pdf
- Keyence – Safety distance (ISO 13855): https://www.keyence.eu/ss/products/safetyknowledge/caution/
- SMC – Safety exhaust valve, návod DOC1092179: https://www.smcworld.com/upfiles/manual/en-jp/files/DOC1092179.pdf
