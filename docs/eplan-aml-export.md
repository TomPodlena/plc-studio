# PLCdesk → EPLAN: export AutomationML (AR APC)

Zadání modulu, který z projektu PLCdesk vygeneruje soubor `.aml` ve formátu **AutomationML AR APC**, jejž EPLAN Electric P8 naimportuje a vyrobí z něj nativní dokumentaci.

Stav: **implementováno v3 (2026-10-04), neověřeno importem do EPLAN** — licence EPLAN ani zlatý vzorek z P8 nejsou k dispozici; výstup je kontrolován schématem CAEX 2.15 (XSD), vlastní validací §13 a porovnáním struktury s reálnými exporty EPLAN 2.7.3 a TIA Portal V17–V21. Viz „Implementace v2“ a „v3 — porovnání s reálnými exporty“ na konci. Verze zadání 2026-10-03.

## 1. Proč

Německé a automotive dodavatelské předpisy vyžadují **nativní projekt EPLAN P8** jako povinný formát dodání elektrické dokumentace; DXF/PDF jen jako doplněk. Vlastní SVG/DXF větev PLCdesku ten strop nepřekoná. AR APC ano — nedodáváme dokument, dodáváme data, z nichž si ji EPLAN zákazníka vyrobí sám.

Cílový průběh u zákazníka:

1. otevře svůj firemní šablonový projekt v P8 (rámeček, razítko, kmenová data),
2. naimportuje náš `.aml`,
3. spustí „Generovat schéma PLC" → vzniknou nakreslené stránky,
4. standardními reporty si vygeneruje svorkovnicový plán, přehled kabelů, kusovník.

Všechno vzniklo uvnitř EPLANu → je to nativní projekt.

## 2. Rozsah

**Přenáší se:** struktura stanice a racku, karty a sloty, sběrnicové porty a jejich propojení, sítě (PROFINET, Profibus DP, ASi, IO-Link, DRIVE-CLiQ, ET-Connection, Local-Bus, PortToPort), I/O adresy s rozlišením I/Q, symbolická jména včetně UDT, vícejazyčné funkční texty. Pohony řeší samostatné rozšíření `ARE-APC-Drive` V1.2.0 — mimo první verzi.

**Nepřenáší se:** silová část — rozvod 24 V, motorové vývody, bezpečnostní obvody, svorkovnice k polním přístrojům. Pro ně vede jiná cesta (Cogineer + makroprojekt), mimo rozsah tohoto zadání.

**Tvrdá podmínka:** EPLAN nakreslí stránku jen pro díl, který má v kmenových datech **přiřazené makro**, a dohledává ho přes objednací číslo. Viz §8.

## 3. Krok 0 — podklady

Bez těchto dvou věcí se finální mapování napsat nedá; nehádat názvy tříd.

1. **Normativní knihovna.** Stáhnout `https://www.automationml.org/wp-content/uploads/2023/07/AR-APC-V1.4.0.zip` (zdarma, bez registrace). Obsahuje PDF doporučení, sedm rozšíření ARE (ASi, DRIVE-CLiQ, Ethernet, Extension Rack, IO-Link, Mpi, Profibus) a soubor **`AutomationML_ARAPC_Libraries_AMLEd1_1.4.0.aml`** s doslovnými názvy všech RoleClass, InterfaceClass a AttributeType. Uložit do `packages/core/src/eplan/spec/`.
2. **Zlatý vzorek.** Z licencovaného P8 vyexportovat PLC data jednoduchého projektu (CPU + ET 200SP + 2×DI + 1×DO) do AML a uložit do `packages/core/test-data/real/`. Proti němu se exportér diffuje — rychlejší a spolehlivější než čtení specifikace.

## 4. Cílová verze formátu

- **AR APC 1.3.0 jako minimum** — od ní existují symbolické adresy uvnitř UDT.
- **1.4.0 doporučeně**, pokud to cílový EPLAN zvládne (zásuvné sběrnicové porty, `CommunicationPortProxyInterface`, komplexní custom atributy).
- **CAEX 2.15 (AutomationML Edition 1)**, ne CAEX 3.0 — potvrzuje to označení `AMLEd1` v názvu knihovny. Verze se liší jmenným prostorem i hlavičkou a nesmí se míchat.

## 5. Kostra souboru

```xml
<CAEXFile FileName="plcdesk-export.aml" SchemaVersion="2.15"
  xsi:noNamespaceSchemaLocation="CAEX_ClassModel_V2.15.xsd"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <AdditionalInformation AutomationMLVersion="2.0" />
  <AdditionalInformation><WriterHeader>…PLCdesk, verze, datum…</WriterHeader></AdditionalInformation>
  <ExternalReference Path="…/AutomationMLBaseRoleClassLib.aml"  Alias="AutomationMLBaseRoleClassLib" />
  <ExternalReference Path="…/AutomationMLInterfaceClassLib.aml" Alias="AutomationMLInterfaceClassLib" />
  <ExternalReference Path="…/AutomationML_ARAPC_Libraries_…aml" Alias="…z knihovny…" />
  <InstanceHierarchy Name="…">…</InstanceHierarchy>
</CAEXFile>
```

CAEX 2.15 nepoužívá výchozí jmenný prostor a původce nese `AdditionalInformation/WriterHeader`.

## 6. Hierarchie

```
InstanceHierarchy (projekt)
└── InternalElement  stanice / CPU
    └── InternalElement  rack
        └── InternalElement  karta (modul)
            └── ExternalInterface  PLC připojovací bod (kanál)
```

Každý `InternalElement` nese `RoleRequirements` s `RefBaseRoleClassPath` z knihovny AR APC. Sítě jsou samostatné uzly identifikované jménem fyzické a logické sítě a MasterSystemID.

## 7. Vlastnosti, které musí import naplnit

Čísla jsou vlastnosti EPLANu plněné z AML; doslovné názvy atributů v AML vzít z knihovny.

| Co | Vlastnost EPLANu | Poznámka |
|---|---|---|
| AutomationML GUID | 25030 | na každém objektu, viz §9 (dřívější „20530“ byl překlep; zdroj: [TechTip Overview of the PLC properties](https://eplan.help/techtipps/en-us/SPS/TechTip-Overview-of-the-PLC-properties.pdf), Eplan 2027, kap. 2) |
| AutomationML GUID 2 [1…12] | 25031 | index 1 na PLC připojovacích bodech a kartách (tentýž TechTip) |
| AutomationML GUID (příslušenství) [1…50] | 20399 | jen díly s typovým označením PLC (tentýž TechTip) |
| Sběrnicový systém | 20308 | Ethernet-based, Profibus DP, ASI, DRIVE-CLiQ, IO-Link, PortToPort, ET-Connection, Local-Bus |
| Fyzická síť: název | 20413 | **unikátní v rámci projektu** |
| Logická síť: název | 20414 | IO systém / DP master systém |
| MasterSystemID | 20334 | |
| Karta umístěna na racku ID | 20410 | takto se nese osazení racku a slotu |
| Konfigurační projekt | 20161 | bez tečky „.“ (TechTip) — export ji v názvu projektu nahradí „_“ |
| PLC stanice: ID | 20408 | bez tečky „.“ (TechTip) — = název Device, tečka nahrazena „_“ |
| Symbolická adresa: UDT (název) | 20618 | od AR APC 1.3.0 |
| Symbolická adresa: UDT (datový typ) | 20619 | od AR APC 1.3.0 |

Kombinovaný klíč `<název UDT><symbolická adresa>` musí být **unikátní v rámci jedné CPU** — validovat v PLCdesku, ne až při importu.

## 8. Kanály, adresy, texty

- PLC připojovací body se exportují jako `ExternalInterface` na kartě.
- Adresa s rozlišením I/Q, datový typ a symbolické jméno jako atributy bodu.
- Funkční text vícejazyčně — CAEX to řeší lokalizovaným atributem se sub-atributy podle jazyka (`aml-lang="cs"`, `"en"`, `"de"`). Přesnou konvenci převzít ze zlatého vzorku.
- Zdroj dat v modelu: `IoEntry` (adresa, směr, popis), `IoModule` (karta), `Device` (funkční text).

## 9. GUID — nejdůležitější implementační detail

Každý objekt nese GUID `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`. EPLAN podle něj páruje objekty při opakovaném importu. **GUID musí být stabilní napříč exporty téhož projektu**, jinak druhý import nic neaktualizuje a nasype do projektu duplicity.

Důsledek pro `packages/core/src/model.ts`: volitelné pole `guid` na `Project`, `Device`, `IoModule` a `IoEntry`, generované **jednou při vzniku objektu** a serializované do JSON exportu projektu (a později do DB). Nikdy negenerovat až v okamžiku exportu. Migrace starších projektů: doplnit chybějící GUID při načtení a projekt označit jako změněný.

## 10. Sítě a propojení

```xml
<InternalLink Name="…"
  RefPartnerSideA="<ID InternalElementu>:<název ExternalInterface>"
  RefPartnerSideB="<ID InternalElementu>:<název ExternalInterface>" />
```

`InternalLink` patří do **nejbližšího společného rodiče** obou stran. Časté místo chyb — ověřit proti zlatému vzorku.

## 11. Objednací čísla

Bez správného objednacího čísla EPLAN nenajde makro a schéma se nenakreslí. PLCdesk potřebuje u typových zařízení katalog čísel ve tvaru, v jakém je mají zákazníci v kmenových datech (zdroj: EPLAN Data Portal). Místo v repu: `data/catalog/plc.json`, nové pole pro EPLAN part number vedle stávajících značek.

Startovní sada: S7-1200, S7-1500, ET 200SP (interface modul + DI/DO/AI/AO karty), několik nejběžnějších IO-Link masterů.

## 12. Umístění v repu

- `packages/core/src/eplan_aml.ts` — generátor, vedle `plcopen.ts` a `logix.ts`, stejná signatura: `genEplanAml(prj: Project, opts?): string`
- `packages/core/src/eplan/spec/` — normativní knihovna AR APC
- `packages/core/test-data/real/` — zlatý vzorek z P8
- export přes `packages/core/src/index.ts`, UI tlačítko v kroku „Generovat"

## 13. Validace a akceptační test

- **Strukturální validace:** `Aml.Engine` (NuGet, .NET) má `ValidatorService` — validuje strukturu CAEX, ID a cestové reference, **ne** konformitu s AR APC. Veřejný konformitní kontrolor AR APC neexistuje. V TS stačí vlastní kontrola: unikátnost ID, rozlositelnost všech `RefPartnerSideA/B`, přítomnost povinných atributů.
- **Vizuální kontrola:** AutomationML Editor.
- **Akceptační test:** ET 200SP, 2×DI, 1×DO, PROFINET na CPU → import do prázdného šablonového projektu P8 → „Generovat schéma PLC". Projde, pokud vzniknou **nakreslené stránky** (ne jen neumístěné funkce), adresy a symbolika sedí, funkční texty jsou ve všech jazycích a vygeneruje se svorkovnicový plán i kusovník. **A druhý export po úpravě I/O listu musí objekty aktualizovat, ne zduplikovat.**

## 14. Pracovní balíčky

| # | Obsah | Odhad |
|---|---|---|
| 0 | Specifikace + zlatý vzorek z P8 | 0,5 dne + čas majitele licence |
| 1 | Extrakce doslovných názvů tříd z knihovny | 0,5 dne |
| 2 | Generátor kostry + hierarchie stanice/rack/karta | 2 dny |
| 3 | Kanály: adresy, datové typy, symbolika, vícejazyčné texty | 2 dny |
| 4 | Sítě, porty, InternalLinky | 1,5 dne |
| 5 | Perzistence GUID v modelu a JSON exportu | 1 den |
| 6 | Akceptační test a iterace proti reálnému EPLANu | 0,5 dne + kolo u zákazníka |
| 7 | Katalog objednacích čísel (startovní sada) | 2–5 dní, samostatně |

Bez balíčku 7 zhruba **8 dní**. CAEX je plochý XML bez binárních částí, takže implementace v TypeScriptu je realistická; obtížné nejsou značky, ale stabilita GUID, přesné řetězce cest tříd a umístění `InternalLink`.

## 15. Otevřené otázky

1. Doslovné názvy RoleClass / InterfaceClass / AttributeType — až z knihovny (krok 0).
2. Cílit na 1.3.0, nebo rovnou 1.4.0 — podle verze EPLANu u prvních zákazníků.
3. Konvence jazykových atributů ve funkčních textech — potvrdit zlatým vzorkem.
4. Pohony (`ARE-APC-Drive` V1.2.0) — až po základní verzi.
5. **Obousměrnost.** Stejný AML čte TIA Portal 19–21, Studio 5000, TwinCAT 3, PLCnext Engineer, Sysmac Studio i iQ-Works. Psát parser i generátor nad jedním modelem — pokryje to i reverse engineering hardwarové konfigurace (krok 2 workflow).

## Zdroje

- [AutomationML — specifikace a archiv](https://www.automationml.org/about-automationml/specifications/) · [AR APC 1.4.0](https://www.automationml.org/news/new-version-of-the-ar-apc-is-now-available/) · [AR APC 1.3.0 a ARE IO-Link](https://www.automationml.org/news/new-versions-of-ar-apc-and-are-io-link/)
- EPLAN: [výměna dat AML](https://www.eplan.help/en-us/Infoportal/Content/Plattform/2022/Content/htm/plcgui_k_amlbusdatenaustausch.htm) · [TechTip PLC data exchange](https://www.eplan.help/techtipps/en-us/SPS/TechTip-PLC-data-exchange.pdf) · [TechTip přehled vlastností PLC](https://eplan.help/techtipps/en-us/SPS/TechTip-Overview-of-the-PLC-properties.pdf)
- [AMLEngine2.1](https://github.com/AutomationML/AMLEngine2.1) · [PyAutomationML](https://github.com/CIIRC-ISI/PyAutomationML) · [reálný vzorek AML](https://github.com/amlModeling/iafCaseStudy)
- [PLCnext Engineer — import AML APC](https://engineer.plcnext.help/latest/ImportExport_AutomationML.htm)

## Implementace v2 (2026-10-04)

**Stav: neověřeno importem do EPLAN.** Licenci EPLAN nemáme a zlatý vzorek (§3 bod 2) chybí — rozhodnutí uživatele: postupovat podle tohoto zadání a knihovny AR APC. Import v PLCnext Engineer (§15 bod 5) nezkoušen: jde o instalaci celé aplikace do systému (instalátor Phoenix Contact), vývojová stanice nemá práva správce a podmínky stažení se nepodařilo ověřit. (Kontrola, zda PLCnext Engineer zmapuje typy Siemens apod. na svůj katalog, tím také chybí.)

- **Kód:** `packages/core/src/eplan_aml.ts` — `genEplanAml(prj, opts)` (volby `udt`, `network`, `now`), `validateEplan(prj)`, `validateAml(xml)`; `eplan.ts` (`eplanAml`, `eplanFiles`, README) ho volá. Testy `eplan_aml.test.ts`, `eplan.test.ts`.
- **Knihovna (§3):** `packages/core/src/eplan/spec/arapc.ts` — doslovné cesty rolí a rozhraní, povinné atributy, výřez definic tříd do výstupu, URL a SHA-256 archivu. Archiv ani PDF neuvádějí licenci (jen „© AutomationML consortium“), proto se soubor `AutomationML_ARAPC_Libraries_AMLEd1_1.4.0.aml` do repozitáře neukládá.
- **GUID (§9):** `packages/core/src/guid.ts`. `Project.guid` (v `blankProject`), `Device.guid` (při vzniku / `syncIO`), GUID I/O karet v `Project.moduleGuids` — karta není v modelu samostatný objekt, její identita je klíč `<směr><pořadí>` (DI1, DO2…, stejně jako ve výkresech), `IoEntry.guid` odvozený (UUIDv8) z GUID zařízení + signálu, takže přežije přejmenování tagu i zařízení. Stanice, rack, CPU, rozhraní PROFINET a síť mají GUID odvozený z GUID projektu. `ensureGuids(prj)` doplní chybějící při načtení (web `normProject` → uložení, desktop `set_project` → uložení); export GUID nikdy negeneruje (chybějící jen nahradí deterministickým zástupcem a `validateEplan` to hlásí). Otisky schvalování GUID neobsahují, revize ho vyřazuje z porovnání. Příklady `samples/` mají GUID uložené (doplněno jednorázově skriptem).
- **Hierarchie (§6, §7, §10)** (stav v2; rack, role, kanály a adresy upraveny ve v3 níže): AutomationProject (konfigurační projekt) → Subnet `PN_IE_1` (Type `Ethernet`) a Device stanice → `Rack_0` (`System:Rack.Generic`, PositionNumber = slot) → CPU `-A1` s CommunicationInterface `X1` (Node + NodeEthernet, IoSystem `Number` 100 = MasterSystemID, CommunicationPort `P1 R`) a TagTable; karty `-A2…` s kanály. Linky v nejbližším společném rodiči: kanál ↔ tag v `Rack_0`, Node ↔ Subnet v AutomationProject. Model nemá vzdálené stanice ani IO-Link mastery → jen lokální rack; Local-Bus jako samostatná síť se neexportuje (osazení racku nese vnoření a PositionNumber).
- **UDT (§7):** volba `udt: true` → ComplexTag (Name = zařízení, DataType = `UDT_<třída>`), Tag = signál. Výchozí jsou ploché tagy `<zařízení>_<signál>`, shodné s generovaným kódem.
- **Funkční texty (§8):** atribut `Comment` podle BPR Multilingual expressions — výchozí hodnota (komentář z I/O tabulky) + `aml-lang=cs-CZ / en-US / de-DE / es-ES / zh-CN`; popis zařízení se nepřekládá, popisek signálu ano.
- **Validace (§13):** unikátní ID (GUID), rozložitelné `RefPartnerSideA/B` (escapování 5.2.8), rozhraní na partnerovi, link v nejbližším společném rodiči, povinné atributy podle rolí, unikátní název stanice a fyzické sítě, unikátní UDT + symbolická adresa v CPU (bez ohledu na velikost písmen), GUID v modelu. Všech 12 příkladů projde bez nálezu a schématem CAEX 2.15 (lxml).
- **Odloženo:** §11 katalog objednacích čísel EPLAN; GUID 2 [1…12] (podzařízení karet); pohony (ARE Drive); vzdálené stanice / IO-Link (až je model bude znát).

## v3 — porovnání s reálnými exporty (2026-10-04)

Zlatý vzorek z P8 pořád chybí, ale veřejně jsou k dispozici reálné exporty AR APC. Porovnáno s: **EPLAN 2.7.3** (2018, AR APC 1.0.0, Beckhoff EtherCAT; jediný veřejný export z EPLANu), **TIA Portal V17** (S7-1200 CPU 1214C), **V18** (S7-1500 + 4× ET 200SP + G120C), **V20**, **V21** (S7-1500 + DI 16 HF / DQ 16 HF), **TIA Selection Tool**, **TwinCAT 3** (2×). Do repozitáře jdou jen vzorky s licencí MIT (`packages/core/test-data/real/aml/`: EPLAN 2.7.3 od AutomationML e.V., TIA V17 od vformi, prázdný TwinCAT od Gain — zdroje a licence v `test-data/real/README.md`); ostatní (bez licence) jen přečteny.

### Nálezy a opravy

| # | Nález (reálné exporty) | Dříve | Teď |
|---|---|---|---|
| P1.1 | Všechny exportéry (EPLAN, TIA, TwinCAT) zapisují roli jako `<SupportedRoleClass RefRoleClassPath=…>`, nikdo `RoleRequirements` | `RoleRequirements` | `SupportedRoleClass`; pořadí prvků podle XSD 2.15 (Attribute, ExternalInterface, InternalElement, SupportedRoleClass, InternalLink); `validateAml` čte roli z obou |
| P1.2 | `LogicalAddress` bez směru (AR APC 1.4.0, 5.2.1 „shall not contain the direction“; TIA V18/V21: `0.0`, `W102`) | `%I0.0` | `0.0`, `W64`, `W80` (CODESYS `%IX0.0` → `0.0`, `%IW32` → `W32`; TwinCAT `%I*` → bez adresy; Mitsubishi `X10` beze změny); směr nese `IoType` |
| P1.3 | Objednací čísla Siemens s mezerou po 4. znaku (`6ES7 214-1AG40-0XB0`; TIA V17–V21, Siemens 109766653) | z katalogu bez mezery | `amlOrderNumber()`: 6ES7 / 6AG1 / 6GKx s mezerou při exportu (katalog beze změny); ostatní výrobci i SITOP `6EP1332-4BA00` beze změny (tak ho píše i TIA V21) |
| P1.4 | `TypeIdentifier` stanice = rodina (`System:Device.S71200 / S71500 / ET200SP`; EPLAN `System:Device.Generic`), rack `System:Rack.<rodina>`; `DeviceItemType` jen `CPU` / `HeadModule` / `Accessory`, OrderNumber CPU jen na CPU | stanice s OrderNumber CPU, rack `DeviceItemType=Rack`, karty `DigitalModule` | `stationFamily()` z objednacího čísla CPU (jiní výrobci Generic); rack a karty bez `DeviceItemType` |
| P2 | ID kanálu | GUID signálu | poziční `derivedGuid(karta, "ch:<směr>:<n>")`; **tag** nese GUID signálu (přejmenování tagu i přesun signálu na jiný kanál zachová identitu tagu, kanál je místo na kartě) |
| P2 | Názvy rozhraní | `DI_0`, `LogicalEndPoint` | `Channel_DI_0`, `LogicalEndPoint_Subnet` / `_Node` / `_IoSystem` / `_Interface` (TIA i EPLAN shodně) |
| P2 | Tečka v konfiguračním projektu (20161) a ID stanice (20408) je v EPLANu zakázaná (TechTip) | beze změny | nahrazena „_“ |
| P2 | Siemens karty hierarchicky (TIA V18: ET 200SP, V21: S7-1500 — karta → BuiltIn podmodul PositionNumber 1 s `Address` a kanály) | ploše | **Siemens hierarchicky** — tak exportuje TIA (EPLAN konvertor TIA19 čte stejnou strukturu); AR APC 5.1.5 popisuje oba scénáře a ECAD bez vlastnosti podmodulu skládá hierarchický model do jednoho dílu. ID podmodulu = `derivedGuid(karta, "builtin:1")` (AR APC: identita BuiltIn = UUID nadřazené karty + PositionNumber). Ostatní výrobci ploše jako EPLAN 2.7.3 / TwinCAT |
| P2 | InternalLink mimo nejbližšího společného rodiče (TIA V18 dává linky kanál ↔ tag do AutomationProject, EPLAN 2.7.3 do racku stanice s tagy) | chyba | upozornění (náš export dál dává link do nejbližšího rodiče) |
| P2 | Karty se všemi kanály (TIA: DI 16 HF = 16 kanálů, obsazené mají link) | jen obsazené | všechny kanály karty (DI16 / DO16 / AI8 / AO4 podle `modules()`), neobsazené bez tagu a linku |
| — | `ProductDesignation IEC` / `LocationIdentifier IEC` s `RefSemantic` podle AR APC 5.1.5 (TwinCAT tak exportuje, EPLAN 2.7.3 bez něj) | bez | s `RefSemantic` (IEC 81346-1:2009-07#5.4 / #5.5) |
| — | Jazyk výchozí hodnoty `Comment` | — | komentář `<!-- PLCdesk language=cs_CZ -->` za hlavičkou XML (čte ho skript EPLAN pro parametr LANGUAGE) |

### Kontrola cizích souborů (`validateAml`)

`validateAml(xml)` bez volby = cizí soubor: chybou je jen to, co soubor rozbíjí (well-formed, GUID a duplicitní ID, nerozložitelný / neexistující partner linku, rozhraní na partnerovi, unikátnost stanic, sítí a UDT + symbolické adresy v CPU). Odchylky od AR APC, které reálné exporty dělají, jsou upozornění: chybějící „mandatory“ atribut (EPLAN 2.7.3: Node bez `NetworkAddress` u EtherCAT, IoSystem bez `Number`, Tag bez `IoType`; TwinCAT: prázdné položky `Address` bez `IoType`), `LogicalAddress „I“/„Q“` (AR APC 1.0.0), neznámá role / třída rozhraní, link mimo nejbližšího rodiče. `validateEplan` volá `validateAml(…, { strict: true })` — u vlastního exportu je každá odchylka chyba. Výsledek na 12 stažených souborech: **0 chyb** na všech AR APC exportech (EPLAN 2.7.3 ×2: 68 upozornění — přesně odchylky AR APC 1.0.0; TIA V17–V21, TST, TwinCAT: 0–3 upozornění). Jediná chyba je u souboru Zeugwerk (CAEX 3.0, není AR APC — `SchemaVersion` správně odmítnuta). `ProjectSign` už není povinný (AR APC 5.1.1: optional), povinný je `TypeIdentifier` stanice (5.1.4).

XSD CAEX 2.15 (lxml): náš export 72/72 souborů (12 příkladů × ploché / UDT / Beckhoff / CODESYS / Mitsubishi / Rockwell) platných. Pro zajímavost: oba exporty TwinCAT 3 a šablona TwinCAT schématem neprojdou (knihovny v pořadí InterfaceClassLib za RoleClassLib, ExternalInterface za InternalElement) — EPLAN je přesto čte, importér tedy pořadí nekontroluje.

### Porovnávací testy (`eplan_aml.test.ts`)

- **TIA V17 (S7-1200):** u vzorku i u našeho exportu stejně — Device `System:Device.S71200` → `Rack_0` (`System:Rack.S71200`, PositionNumber 0, BuiltIn false, bez DeviceItemType) → CPU (DeviceItemType CPU, slot 1, `OrderNumber:6ES7 xxx-xxxxx-xxxx`) → TagTable, CommunicationInterface X1 (32768) → Node + NodeEthernet (`LogicalEndPoint_Node`), IoSystem 100 (`LogicalEndPoint_IoSystem`), Port 32769; Subnet Ethernet pod projektem (`LogicalEndPoint_Subnet`), link Node ↔ Subnet v AutomationProject; kanály `Channel_<směr>_<n>` s atributy Type / IoType / Number / Length na BuiltIn DeviceItem s `Address`.
- **EPLAN 2.7.3:** stejná sada atributů AutomationProject, atributy tagů EPLANu ⊂ naše (+ IoType od AR APC 1.1.0), `Comment` s podatributy `aml-lang=xx-XX`, stejné atributy kanálů, jiný výrobce → stanice/rack `Generic`, karta ploše s `Address` a kanály, linky `Channel_*` ↔ rozhraní Tag.
- Rozdíly, které zůstávají záměrně: náš Device nese i `Comment` a `Manufacturer` (AR APC optional, TIA je nepíše), karty `Manufacturer`, `ProductDesignation IEC` (-A2 …) a `LocationIdentifier IEC` (+1) — EPLAN je zná (vlastní export je obsahuje), TIA je nepíše; `BitOffset` v `Address` (optional, výchozí 0).

### Skript EPLAN (`apps/eplan/PLCdesk_ImportAML.cs`)

Skript C# pro skriptovací stroj EPLAN (bez licence API), shodná kopie jde v sadě souborů EPLAN (`eplanFiles` → `eplan_PLCdesk_ImportAML.cs`; shodu hlídá test). Postup: `selectionset /TYPE:PROJECT` (aktuální projekt) → výběr `.aml` → `plcservice /TYPE:BUSDATAIMPORT /PROJECTNAME /SOURCEFILE /LANGUAGE /CONVERTERID /IMPORTMATCH:0` → volitelně `plcservice /TYPE:GENERATEPLCSCHEMATIC /CONFIGFILE` (cesta k uloženému nastavení zákazníka, ve skriptu `SchematicConfigFile`; prázdné = jen import). Konvertor podle obsahu: Siemens (`System:Device.S7…`, `OrderNumber:6ES7`) → `PlcDcExchangerSiemensTIA19AML` (AR APC 1.4.0), jinak `PlcDcAMLExchangerGeneral` („Eplan Electric P8 AML-format“); `IMPORTMATCH 0` = párování podle interních ID (naše GUID). Syntaxe podle eplan.help: [plcservice](https://www.eplan.help/en-us/Infoportal/Content/api/2027/plcservice.html) (seznam konvertorů, IMPORTMATCH 0/1/2, příklad `/LANGUAGE:de_DE`), [selectionset](https://www.eplan.help/en-us/Infoportal/Content/api/2027/selectionset.html), [skript s akcemi](https://www.eplan.help/en-US/infoportal/content/api/2025/SimpleScriptWithParameters.html). README_EPLAN popisuje ruční cestu (dialog „Import PLC data“ → „Start Generate PLC schematic“) i skript.

**Neověřeno:** skript nebyl spuštěn (bez EPLAN); zda konvertor TIA19 přijme soubor, který nepochází z TIA (kontroly konzistence TIA), i zda obecný konvertor čte AR APC 1.4.0 hierarchii Siemens. Makra a díly (kmenová data) jsou u zákazníka; generování schématu PLC může vyžadovat licenci „PLC & Bus Extension“. Formát LANGUAGE (`cs_CZ`) převzat z příkladu `de_DE`.

### Otevřený bod: konzistence hardwaru v modelu a kusovníku (samostatný úkol)

Export přenáší, co model a kusovník obsahují — a ty jsou pro Siemens vnitřně nekonzistentní. Import do EPLAN (konvertor TIA) nebo TIA by to odhalil:

1. **ET 200SP karty v racku S7-1200.** Kusovník pro Siemens volí CPU S7-1200 G2 (`6ES7212-1AG50-0XB0`) a karty ET 200SP (`6ES7131-6BH01-0BA0` DI 16, `6ES7132-6BH01` DQ 16, `6ES7134-6HD01` AI 4, `6ES7135-6HD00/-6FB00` AQ 4/2). ET 200SP se do racku S7-1200 nezasouvá (S7-1200 má signálové moduly SM 12xx). **Návrh:** buď karty S7-1200 SM (SM 1221 / 1222 / 1231 / 1232) v racku CPU, nebo — častější u strojů — samostatná **stanice ET 200SP s IM 155-6 PN** (Device `System:Device.ET200SP` → Rack `System:Rack.ET200SP` → HeadModule IM 155-6 PN ST/HF s BusAdapterem a rozhraním X1 → karty od slotu 1 + server modul), připojená na `PN_IE_1` a IO systém CPU (Node ↔ Subnet, `LogicalEndPoint_Interface` ↔ `LogicalEndPoint_IoSystem`, jako TIA V18 vzorek).
2. **Balení karet vs. kusovník.** `modules()` dělí I/O po DI16 / DO16 / **AI8** / **AO4**, export tedy dává kartě AI 8 kanálů — ale katalogová karta je AI **4**×U/I (a AQ **2**×I u `-6FB00`). Počet karet v kusovníku = počet modulů, takže chybí karty a kanály 4–7 neexistují. **Návrh:** velikost karty brát z katalogové položky kusovníku (počet kanálů jako vlastnost položky katalogu), `modules()` řídit touto velikostí (pro výkresy, svorky, EPLAN i kusovník jedním zdrojem) a kusovník počítat `ceil(n / kanálů)`.
3. **Vestavěné I/O CPU.** CPU 1212C má 8 DI / 6 DQ (1214C 14/10, 2 AI) vestavěných; model je ignoruje a vše dává na karty. **Návrh:** volitelně obsadit nejdřív vestavěné I/O — v AML jako BuiltIn DeviceItem pod CPU (`DI 8/DQ 6_1`, PositionNumber 1, `Address` se dvěma položkami Input/Output, kanály `Channel_DI_n` / `Channel_DO_n` — přesně podle TIA V17 vzorku) a adresy %I0.0… / %Q0.0… přidělovat od vestavěných.

Do té doby export záměrně nemění hardware (karty = kusovník, adresy = model); README_EPLAN uvádí obecně, že objednací čísla jsou typické volby z kusovníku a ne projekt elektro.
