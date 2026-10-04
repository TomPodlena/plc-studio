# PLCdesk → EPLAN: export AutomationML (AR APC)

Zadání modulu, který z projektu PLCdesk vygeneruje soubor `.aml` ve formátu **AutomationML AR APC**, jejž EPLAN Electric P8 naimportuje a vyrobí z něj nativní dokumentaci.

Stav: **implementováno v2 (2026-10-04), neověřeno importem do EPLAN** — licence EPLAN ani zlatý vzorek z P8 nejsou k dispozici; výstup je kontrolován schématem CAEX 2.15 (XSD) a vlastní validací §13. Viz „Implementace v2“ na konci. Verze zadání 2026-10-03.

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
| AutomationML GUID | 20530 / 25030 | na každém objektu, viz §9 |
| GUID 2 [1…12] | — | na PLC připojovacích bodech a kartách |
| Sběrnicový systém | 20308 | Ethernet-based, Profibus DP, ASI, DRIVE-CLiQ, IO-Link, PortToPort, ET-Connection, Local-Bus |
| Fyzická síť: název | 20413 | **unikátní v rámci projektu** |
| Logická síť: název | 20414 | IO systém / DP master systém |
| MasterSystemID | 20334 | |
| Karta umístěna na racku ID | 20410 | takto se nese osazení racku a slotu |
| Konfigurační projekt | 20161 | |
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
- **Hierarchie (§6, §7, §10):** AutomationProject (konfigurační projekt) → Subnet `PN_IE_1` (Type `Ethernet`) a Device stanice → `Rack_0` (`System:Rack.Generic`, PositionNumber = slot) → CPU `-A1` s CommunicationInterface `X1` (Node + NodeEthernet, IoSystem `Number` 100 = MasterSystemID, CommunicationPort `P1 R`) a TagTable; karty `-A2…` s kanály. Linky v nejbližším společném rodiči: kanál ↔ tag v `Rack_0`, Node ↔ Subnet v AutomationProject. Model nemá vzdálené stanice ani IO-Link mastery → jen lokální rack; Local-Bus jako samostatná síť se neexportuje (osazení racku nese vnoření a PositionNumber).
- **UDT (§7):** volba `udt: true` → ComplexTag (Name = zařízení, DataType = `UDT_<třída>`), Tag = signál. Výchozí jsou ploché tagy `<zařízení>_<signál>`, shodné s generovaným kódem.
- **Funkční texty (§8):** atribut `Comment` podle BPR Multilingual expressions — výchozí hodnota (komentář z I/O tabulky) + `aml-lang=cs-CZ / en-US / de-DE / es-ES / zh-CN`; popis zařízení se nepřekládá, popisek signálu ano.
- **Validace (§13):** unikátní ID (GUID), rozložitelné `RefPartnerSideA/B` (escapování 5.2.8), rozhraní na partnerovi, link v nejbližším společném rodiči, povinné atributy podle rolí, unikátní název stanice a fyzické sítě, unikátní UDT + symbolická adresa v CPU (bez ohledu na velikost písmen), GUID v modelu. Všech 12 příkladů projde bez nálezu a schématem CAEX 2.15 (lxml).
- **Odloženo:** §11 katalog objednacích čísel EPLAN; GUID 2 [1…12] (podzařízení karet); pohony (ARE Drive); vzdálené stanice / IO-Link (až je model bude znát).
