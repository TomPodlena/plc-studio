/**
 * PLCdesk — nápověda: jediný zdroj obsahu pro web, desktop a web plcdesk (/napoveda/).
 *
 * Kapitola = jeden krok workflow nebo obecné téma: nadpis, shrnutí, postup (číslované kroky),
 * tipy, časté chyby a hlášky validace s opravou, odkazy na jiné kapitoly a klíčová slova pro
 * hledání. Texty jsou klíče překladu (`N_`, čeština) — přeloží se až při použití (`helpChapters`).
 * Zvýraznění jen `**tučně**`; klienti si ho převedou (web `<b>`, desktop tag Tk, web plcdesk `<b>`).
 * Položka s `only` platí jen pro jednoho klienta (web / desktop) — filtr `client` ji jinde vynechá.
 *
 * Pravidlo: nová funkce aplikace = aktualizovat kapitolu tady (a přeložit nové klíče).
 */
import { N_, tr, withLang, getLang } from "./i18n.js";
import { licenseSiteUrl } from "./license.js";

export type HelpClient = "web" | "desktop";
export type HelpGroup = "start" | "step" | "topic";

/** Text odstavce / bodu; `only` = jen pro jednoho klienta. */
export interface HelpText { text: string; only?: HelpClient }
/** Častá chyba nebo hláška: co se ukáže a jak to opravit. */
export interface HelpIssue { problem: string; fix: string; only?: HelpClient }

export interface HelpChapter {
  /** Stabilní ASCII id (kotva v aplikaci, adresa /napoveda/<id>/ na webu). */
  id: string;
  group: HelpGroup;
  /** Index kroku workflow (0 = Projekt … 12 = Oživení), u obecných kapitol chybí. */
  step?: number;
  title: string;
  summary: string;
  steps: HelpText[];
  tips: HelpText[];
  issues: HelpIssue[];
  /** Odkazy na jiné kapitoly (id). */
  see: string[];
  /** Klíčová slova pro hledání (přeložená; jeden klíč překladu, oddělená čárkou). */
  keywords: string[];
  only?: HelpClient;
}

interface Src {
  id: string; group: HelpGroup; step?: number; title: string; summary: string;
  steps?: (string | HelpText)[]; tips?: (string | HelpText)[]; issues?: HelpIssue[];
  see?: string[]; keywords: string; only?: HelpClient;
  /** Náhled funkce, kterou běžná aplikace nemá (PLCdesk PRO): jen na výslovné vyžádání (`preview`),
   *  web plcdesk ani běžný klient ji nevidí. */
  preview?: true;
}

const web = (text: string): HelpText => ({ text, only: "web" });
const desk = (text: string): HelpText => ({ text, only: "desktop" });

/** Skupiny kapitol v pořadí obsahu. */
export const HELP_GROUPS: Record<HelpGroup, string> = {
  start: N_("Začínáme"),
  step: N_("Kroky návrhu"),
  topic: N_("Témata"),
};

const SRC: Src[] = [
  /* ------------------------------------------------------------------ začínáme */
  {
    id: "start", group: "start", title: N_("Začínáme s PLCdesk"),
    summary: N_("PLCdesk provede návrh řízení stroje od zadání po kód PLC, výkresy, dokumentaci a kusovník. Kroky v liště nahoře se procházejí zleva doprava a kdykoli se k nim můžeš vrátit — výstupy se vždy přepočítají z aktuálního návrhu."),
    steps: [
      N_("V kroku **Projekt** vyplň název stroje a číslo projektu, nebo otevři hotový vzor z nabídky **Příklady strojů**."),
      N_("V kroku **AI návrh** popiš stroj vlastními slovy a převezmi navrženou sestavu — nebo přidej zařízení ručně v kroku **Zařízení**."),
      N_("V kroku **Platformy** vyber jeden nebo více řídicích systémů, pro které se vygeneruje program."),
      N_("Zkontroluj **I/O** (tagy a adresy), **Schéma** a **Program** (E-stop, blokování a automatická sekvence)."),
      N_("V kroku **Generovat** stáhni nebo ulož kód pro každou platformu; README.txt popisuje import do IDE výrobce."),
      N_("V kroku **Dokumentace** jsou FDS, I/O list, FAT, protokol ověření simulací a další soubory; **Kusovník** připraví komponenty k poptávce."),
      N_("Kroky **Bezpečnost**, **Schválení** a **Oživení** vedou návrh k odpovědnému schválení a k protokolu z uvádění do provozu."),
    ],
    tips: [
      N_("Návrh se ukládá průběžně a po novém spuštění aplikace pokračuje tam, kde jsi skončil."),
      N_("Hotový krok má v liště fajfku ✔. Kroky můžeš procházet v libovolném pořadí."),
      N_("Tlačítko **?** v záhlaví každého kroku (nebo klávesa **F1**) otevře nápovědu právě k tomu kroku; celá nápověda je pod tlačítkem **Nápověda** vpravo v liště kroků."),
      N_("PLCdesk navrhuje, ale za návrh odpovídá člověk — platí jen to, co odpovědná osoba schválí v kroku Schválení."),
      N_("**Videoprůvodce** (asi 10 minut) ukáže celý postup na ukázkovém stroji od projektu po oživení — odkaz je v kroku **Nápověda** a na konci úvodního průvodce."),
    ],
    see: ["tour", "projekt", "ai", "zkratky", "faq"],
    keywords: N_("začátek, úvod, postup, workflow, kroky, jak začít, první projekt"),
  },
  {
    id: "tour", group: "start", title: N_("Úvodní průvodce"),
    summary: N_("Krátká prohlídka aplikace po zastaveních — ukáže, kde začít, kde se generuje kód a kde najdeš nápovědu. Při prvním spuštění se ukáže sama, znovu ji spustíš tlačítkem **Spustit průvodce** v Nápovědě."),
    steps: [
      N_("**Projekt a příklady strojů** — začni názvem a číslem projektu, nebo otevři hotový vzor stroje."),
      N_("**AI návrh nebo Zařízení** — popiš stroj a nech si navrhnout sestavu, nebo přidej zařízení ručně."),
      N_("**Platformy** — vyber řídicí systémy; štítek u každé říká, jak je výstup ověřený."),
      N_("**Generovat** — kód pro každou platformu a README s postupem importu do IDE."),
      N_("**Dokumentace** — FDS, I/O list, FAT, výkresy a protokol ověření simulací ke stažení nebo uložení."),
      N_("**Nápověda a zpětná vazba** — tlačítko ? u kroku nebo F1 otevře nápovědu ke kroku; připomínky nám pošleš tlačítkem Zpětná vazba."),
    ],
    tips: [N_("Průvodce nic nemění v projektu — jen ukazuje. Přeskočit ho můžeš kdykoli.")],
    see: ["start"],
    keywords: N_("průvodce, prohlídka, úvod, první spuštění, tour"),
  },

  /* ------------------------------------------------------------------ kroky */
  {
    id: "projekt", group: "step", step: 0, title: N_("Projekt"),
    summary: N_("Základní údaje projektu: název stroje, číslo projektu, zákazník, datum zahájení, požadovaný takt a popis. Odsud se také otevírají, ukládají a zakládají projekty a otevírají příklady strojů."),
    steps: [
      N_("Vyplň **Název projektu / stroje** — objeví se v hlavičce, ve výkresech a v dokumentaci."),
      N_("Zkontroluj **Číslo projektu** ve tvaru RRNNNN (rok a pořadí, např. 260705) — aplikace navrhne další volné číslo."),
      N_("Doplň zákazníka, datum zahájení a **Požadovaný takt [s]** — takt porovná ověření simulací s délkou cyklu."),
      N_("Do **Popisu** napiš, co stroj dělá a pro koho; víc řádků a odstavců se propíše do dokumentace (FDS, návod)."),
      N_("Ulož projekt (Ctrl+S) nebo stáhni / ulož celou projektovou složku."),
    ],
    tips: [
      N_("Číslo projektu, zákazník a datum se propíšou do popisového pole výkresů, hlaviček dokumentů a README — do kódu PLC nikdy."),
      N_("**Příklady strojů** obsahují hotové vzory od pásu se 6 zařízeními po výrobní halu — dobrý start pro vyzkoušení."),
      N_("**Načíst stávající zařízení…** spustí průvodce importem stávajícího stroje z exportů PLC, I/O listů, schémat a fotek."),
      N_("**Nový prázdný projekt** se před nahrazením neprázdného návrhu zeptá."),
      web(N_("Na webu: **Export návrhu (JSON)** a **Načíst návrh (JSON)** přenesou návrh jako text; **Stáhnout projekt (ZIP)** stáhne celou projektovou složku.")),
      desk(N_("V desktopu: **Uložit vše do složky projektu** zapíše kód, dokumentaci, výkresy, kusovník a HMI do složky <číslo>_<Název> v kořenovém adresáři projektů.")),
      N_("Pod údaji projektu jsou části **Revize a změny** a **Firemní knihovna**."),
    ],
    issues: [
      { problem: N_("„Číslo projektu nemá tvar RRNNNN…“"), fix: N_("Je to jen upozornění — číslo se použije tak, jak je. Pro jednotné číslování zadej 6 číslic: rok a pořadí.") },
      { problem: N_("„Číslo … už má jiná složka v kořeni“"), fix: N_("Ve zvoleném kořenovém adresáři už existuje složka s tímto číslem — použij navržené volné číslo.") },
    ],
    see: ["slozka", "revize", "knihovna", "import", "ai"],
    keywords: N_("název, číslo projektu, zákazník, datum, takt, popis, příklad, vzor, otevřít, uložit, nový projekt"),
  },
  {
    id: "ai", group: "step", step: 1, title: N_("AI návrh"),
    summary: N_("Popíšeš stroj vlastními slovy a AI návrhář (Anthropic Claude) navrhne sestavu zařízení, E-stop a automatickou sekvenci, případně se nejdřív doptá na detaily. Návrh převezmeš a doladíš v dalších krocích."),
    steps: [
      N_("Otevři **Nastavení AI** a vlož svůj Anthropic API klíč (získáš ho na console.anthropic.com); zvol model."),
      N_("Popiš stroj — co dělá, jaké má pohony, válce, co se měří a hlídá. Pro inspiraci klikni na **Vložit příklad**."),
      N_("Klikni na **Navrhnout zařízení**. Když se AI doptává, odpověz a pošli **Odeslat upřesnění**."),
      N_("Prohlédni si navrženou sestavu a klikni na **Převzít návrh (nahradí zařízení)**."),
      N_("Pokračuj kroky Platformy, Zařízení a I/O a návrh dolaď."),
    ],
    tips: [
      N_("Každý dotaz na AI je placený z tvého API účtu u Anthropicu. Seznam dostupných modelů (**Načíst dostupné modely**) se neúčtuje."),
      N_("AI zná i tvou aktuální sestavu — můžeš kdykoli psát jen úpravy („přidej druhý válec“)."),
      N_("Klíč se ukládá jen na tomto počítači / v tomto prohlížeči."),
      N_("**Stop** přeruší rozpracovanou odpověď, **Nová konverzace** začne znovu."),
      N_("Akce kroků, které nepatří třídě zařízení, se při převzetí vynechají a aplikace to ohlásí."),
    ],
    issues: [
      { problem: N_("„API klíč byl odmítnut (401).“"), fix: N_("Zkontroluj klíč v Nastavení AI — musí být celý a aktivní v konzoli Anthropicu.") },
      { problem: N_("„Příliš mnoho dotazů — zkus to za chvíli.“"), fix: N_("Limit API účtu; počkej chvíli a odešli znovu.") },
      { problem: N_("Model není v seznamu dostupných pro klíč"), fix: N_("Načti dostupné modely a vyber jeden z nich, nebo zadej vlastní ID modelu.") },
    ],
    see: ["zarizeni", "program", "faq"],
    keywords: N_("AI, umělá inteligence, Claude, API klíč, model, návrh, konverzace, popis stroje"),
  },
  {
    id: "platformy", group: "step", step: 2, title: N_("Platformy"),
    summary: N_("Výběr cílových řídicích systémů. Program se vygeneruje pro každou vybranou platformu zvlášť — logika je stejná (IEC 61131-3 ST), liší se dialekt, soubor s tagy a postup importu."),
    steps: [
      N_("Klikni na dlaždici platformy (nebo ji vyber klávesou Enter / mezerou); vybraná je zvýrazněná."),
      N_("Zkontroluj štítek ověření: **ověřeno v IDE**, **jazyk ověřen** nebo **beta**. Bublina nad štítkem řekne, co ověřené není."),
      N_("U platforem rodiny CODESYS můžeš zvolit **Styl kódu**: klasický (doporučeno) nebo OOP."),
    ],
    tips: [
      N_("Další řídicí systémy na bázi CODESYS (Turck, Festo, ABB, Rexroth…) mají stejný kód jako CODESYS a vlastní postup importu, I/O a kusovník."),
      N_("Projekt se servoosou umí jen sedm platforem — u ostatních dlaždice ukáže „servoosu nepodporuje“."),
      N_("U platforem ve stavu beta je tlačítko **Balík k ověření** — připraví vzorové výstupy pro import ve skutečném IDE."),
      N_("Sestava hardwaru (CPU a moduly) a adresy I/O se počítají pro první vybranou platformu, pokud v Kusovníku nezvolíš jinou."),
    ],
    issues: [
      { problem: N_("„Vyber aspoň jednu platformu (krok 3).“"), fix: N_("Bez vybrané platformy se nevygeneruje žádný kód — vyber aspoň jednu dlaždici.") },
      { problem: N_("„Platforma … servoosu nepodporuje“"), fix: N_("Odeber platformu, nebo nahraď servoosu polohovacím pohonem se záznamy (přes I/O).") },
    ],
    see: ["overeni-platforem", "plc-nahrani", "generovat", "kusovnik"],
    keywords: N_("platforma, Siemens, Rockwell, CODESYS, Beckhoff, TwinCAT, Mitsubishi, Omron, Schneider, WAGO, Unitronics, OOP, styl kódu, IDE"),
  },
  {
    id: "zarizeni", group: "step", step: 3, title: N_("Zařízení"),
    summary: N_("Sestava zařízení stroje: motory a čerpadla, ventily a válce, analogové vstupy a výstupy, snímače, signálky, měniče, polohovací pohony, proporcionální ventily a servoosy. Ke každému zařízení se samy vytvoří signály I/O."),
    steps: [
      N_("Vyber **Třídu**, zadej **Označení** (např. M1, Y2) a **Popis**."),
      N_("Zaškrtni volby třídy — např. zpětné hlášení běhu a vstup poruchy u motoru, koncáky u ventilu."),
      N_("Klikni na **Přidat zařízení**; signály se objeví v kroku I/O."),
      N_("U vybraného zařízení uprav parametry: rozsah a jednotku analogu, meze měření, žádanou hodnotu, rampu, záznamy pohonu nebo konfiguraci osy."),
      N_("Digitální výstup (maják, houkačka, zámek) můžeš navázat na stav stroje: chod, porucha, připraveno, stop, zámek krytů, režim AUTO."),
    ],
    tips: [
      N_("Označení musí být identifikátor — písmena bez diakritiky, číslice a _, na začátku písmeno. Z označení vznikají jména instancí v kódu."),
      N_("Přejmenování zařízení přejmenuje i jeho výchozí tagy; ručně změněné tagy zůstanou."),
      N_("Smazání zařízení se nejdřív zeptá a ukáže, které kroky programu zařízení používají."),
      N_("Meze analogového vstupu (min / max) se hlídají v programu i v simulaci — mez mimo měřicí rozsah je chyba."),
      N_("Motor nebo měnič, který pohání pásový dopravník, může mít v parametrech **pásový dopravník**: délku osovou L a šířku pásu b [mm], rychlost [m/s], hmotnost zboží na pásu [kg] a výšku pásu nad podlahou [mm]. Údaje jdou jen do exportu pro CAD (3D) — kód PLC ani dokumentaci nemění."),
      N_("**Import stávajícího zařízení…** dole v kroku převezme stroj z exportů PLC a dalších podkladů."),
      desk(N_("V desktopu se po výběru řádku ukáže panel zařízení s jeho vstupy a výstupy a odkazy do I/O, schématu a programu.")),
    ],
    issues: [
      { problem: N_("„Duplicitní označení zařízení.“"), fix: N_("Dvě zařízení mají stejné označení (bez ohledu na velikost písmen) — jedno přejmenuj.") },
      { problem: N_("„Označení zařízení musí být identifikátor…“"), fix: N_("Odstraň diakritiku, mezery a pomlčky; začni písmenem (např. M1, Y2_A).") },
      { problem: N_("„Meze měření musí ležet v měřicím rozsahu…“"), fix: N_("Uprav mez min / max, aby ležela uvnitř rozsahu snímače, nebo rozšiř rozsah.") },
      { problem: N_("Kolize jména s rezervovaným slovem"), fix: N_("Jména, která si program deklaruje sám (MAIN, instM1…), a klíčová slova jazyků PLC nejdou použít — zvol jiné označení.") },
    ],
    see: ["io", "program", "import", "knihovna"],
    keywords: N_("zařízení, motor, ventil, válec, snímač, analog, měnič, pohon, servoosa, osa, třída, označení, meze, žádaná, rampa, maják, dopravník, pás"),
  },
  {
    id: "io", group: "step", step: 4, title: N_("I/O"),
    summary: N_("Tabulka všech signálů: zařízení, směr (DI / DO / AI / AO), tag, adresa, komentář a NC. Adresy přiděluje sestava hardwaru (kanál modulu); kontrola návrhu hlídá duplicity a přenositelnost tagů."),
    steps: [
      N_("Projdi tagy a komentáře — výchozí tag je <Zařízení>_<signál>."),
      N_("Adresu nech prázdnou (přidělí ji sestava hardwaru), nebo ji zapiš v Siemens notaci (%I0.0, %QW64) — ruční adresa kanál připne."),
      N_("U rozpínacích kontaktů zaškrtni **NC** — promítne se do schématu."),
      N_("Zkontroluj **Kontrolu návrhu**: červené řádky jsou duplicity nebo neplatné tagy."),
    ],
    tips: [
      N_("**Opravit tagy automaticky (ASCII)** převede tagy s diakritikou a mezerami na přenositelné identifikátory."),
      N_("**Přečíslovat adresy od nuly** zahodí ruční adresy a přidělí je znovu podle sestavy hardwaru."),
      N_("Adresy pro ostatní platformy se převedou automaticky (notace platformy)."),
      desk(N_("V desktopu se buňka upravuje dvojklikem, NC kliknutím; odkazy ↗ vedou na zařízení, blokové schéma a zapojení.")),
    ],
    issues: [
      { problem: N_("„Duplicitní tag.“ / „Duplicitní adresa.“"), fix: N_("Změň tag nebo adresu jednoho ze signálů; prázdná adresa se přidělí automaticky.") },
      { problem: N_("„Tag obsahuje diakritiku/mezery…“"), fix: N_("Rockwell, GX Works3 a Sysmac takový tag odmítnou — použij doporučený tag nebo Opravit tagy automaticky.") },
      { problem: N_("„Tag je delší než 32 znaků…“"), fix: N_("Zkrať tag; GX Works3 a Sysmac povolují nejvýš 32 znaků, Rockwell 40.") },
      { problem: N_("Adresa mimo sestavu hardwaru"), fix: N_("Adresa ze skutečného stroje se respektuje, ale výkres a kontrola upozorní; zkontroluj, že kanál existuje.") },
    ],
    see: ["zarizeni", "schema", "kusovnik"],
    keywords: N_("I/O, tag, adresa, signál, DI, DO, AI, AO, NC, rozpínací, duplicita, přečíslovat, ASCII"),
  },
  {
    id: "schema", group: "step", step: 5, title: N_("Schéma"),
    summary: N_("Blokové schéma systému, elektrické zapojení I/O po modulech (SVG a DXF) a svorkovnice s čísly vodičů. Je to podklad pro projektanta elektro, ne výrobní dokumentace."),
    steps: [
      N_("Projdi **Blokové schéma systému**: zdroje signálů → moduly PLC → akční členy."),
      N_("Otevři **Elektrické zapojení I/O** — jeden list na modul; stáhni / ulož SVG nebo DXF pro EPLAN, AutoCAD či LibreCAD."),
      N_("Zkontroluj **Svorkovnici** (svorka, vodič, tag) a stáhni ji jako CSV."),
      N_("Má-li projekt rozváděče v kusovníku, přibude **Pneumatické schéma** (ISO 1219-1: úprava vzduchu, lišta, rozváděče, válce, snímače polohy; rozváděč se kreslí jako 5/2 monostabilní jen tehdy, když to nese řádek kusovníku, jinak je na listu „doplní projektant“) — návrh k ověření konstruktérem pneumatiky. Mezi dokumenty je i **kabelový seznam** (jeden řádek na signál, svorka a číslo vodiče jako ve svorkovnici; délku a průřez doplní projektant)."),
      N_("Dole najdeš **Silové schéma** (přívod, hlavní vypínač, vývody motorů, měničů a servoměničů) a **Rozvod napájení 24 V DC** (zdroj, větve PLC a modulů, ventily, značka větve E-stopu). Označení jsou z kusovníku; proudy, průřezy a nastavení jističů zadání neobsahuje, proto je na listu „doplní projektant“ — je to návrh k ověření elektroprojektantem (EN 60204-1)."),
    ],
    tips: [
      N_("Čísla vodičů odpovídají svorkovnici: X1:1 = -W101, X2:3 = -W203."),
      N_("Pneumatické schéma má vlastní kartu (web) / záložku (desktop), jen když projekt má rozváděče. Na silovém i pneumatickém schématu je u zařízení odkaz na svorku a vodič řízení (např. X2:3, -W203) ze svorkovnice; kde signál v sestavě není, se odkaz nekreslí."),
      N_("Moduly ve schématu jsou ze sestavy hardwaru — stejné jako v kusovníku."),
      web(N_("Na webu klik na zařízení nebo signál ve schématu otevře pod ním úpravu popisu, tagu, adresy a komentáře.")),
      desk(N_("V desktopu jsou schémata klikací: klik na zařízení ukáže panel s jeho signály a kroky programu, odkazy vedou do I/O, zapojení a programu.")),
      desk(N_("Jen v desktopu: **Funkční diagram cyklu** ukazuje krok za krokem akce, podmínky přechodu a časy běžného cyklu.")),
      N_("DXF ve tarifu Free není k dispozici (tarif Pro)."),
    ],
    issues: [
      { problem: N_("Schéma je prázdné"), fix: N_("Nejdřív přidej zařízení (krok Zařízení) nebo převezmi AI návrh.") },
    ],
    see: ["io", "licence", "dokumentace"],
    keywords: N_("schéma, výkres, blokové schéma, zapojení, svorkovnice, vodič, DXF, SVG, EPLAN, AutoCAD"),
  },
  {
    id: "program", group: "step", step: 6, title: N_("Program"),
    summary: N_("Logika programu: centrální uvolnění (E-stop), blokovací vstupy (kryty, závory), automatická sekvence kroků a model stroje pro simulaci. Ze sekvence se generuje stavový automat (CASE) s hlídacími časy."),
    steps: [
      N_("Vyber **Centrální uvolnění** — E-stop nebo bezpečnostní vstup (digitální vstup, TRUE = v pořádku)."),
      N_("Zaškrtni **Blokovací vstupy** — FALSE kteréhokoli zastaví stroj."),
      N_("Přidávej kroky sekvence: zařízení, akce, přechod (zpětné hlášení nebo čas) a čas. Krok může čekat i na digitální vstup."),
      N_("Kroky uprav (**Upravit**), duplikuj, posouvej šipkami nebo vlož za vybraný krok."),
      N_("Nastav **Model stroje (simulace)** — rozběh motoru a přestavení ventilu podle skutečnosti."),
    ],
    tips: [
      N_("U přechodu na zpětné hlášení je čas **hlídací**: když hlášení nepřijde, program vyhlásí poruchu stroje, zastaví sekvenci a čeká na kvitaci."),
      N_("Bez sekvence se vygenerují jen instance zařízení s povely pro ruční režim."),
      N_("Bezpečnost řeší bezpečnostní technika (relé, safety PLC), ne standardní program — E-stop a blokování jsou tu jen stavové signály."),
      desk(N_("Jen v desktopu: záložka **Živá simulace** (grafické schéma s animací, tlačítka AUTO / START / E-STOP / kvitace, ruční povely, vnucení vstupů) a **Scénáře a ověření** (přehrávač průběhů, časový diagram, ověření programu).")),
    ],
    issues: [
      { problem: N_("„Krok … čeká na vstup E-stopu …“"), fix: N_("E-stop patří do uvolnění, sekvence na něj čekat nesmí — změň podmínku kroku.") },
      { problem: N_("„Akce … neplatí pro zařízení …“"), fix: N_("Akce musí patřit třídě zařízení (např. start / stop u měniče) — vyber jinou akci nebo zařízení.") },
      { problem: N_("„Čas kroku … je delší než 24 h…“"), fix: N_("Rozděl krok nebo zkontroluj jednotky; čas se zadává v sekundách.") },
      { problem: N_("„E-stop … musí být digitální vstup (DI)“"), fix: N_("Jako uvolnění a blokování lze vybrat jen digitální vstup.") },
    ],
    see: ["simulace", "overeni", "zarizeni", "bezpecnost"],
    keywords: N_("program, sekvence, krok, E-stop, nouzové zastavení, blokování, kryt, přechod, hlídací čas, timeout, porucha, kvitace, model stroje"),
  },
  {
    id: "generovat", group: "step", step: 7, title: N_("Generovat"),
    summary: N_("Výstupy pro každou vybranou platformu: kód, tagy, PLCopen XML / L5X a další soubory, README s postupem importu; dále záložky HMI, Emulace kódu a SISTEMA a EPLAN."),
    steps: [
      N_("Vyber platformu v horní řadě záložek a soubor v druhé řadě."),
      N_("Přečti **README.txt** — postup importu do IDE a štítek stavu ověření platformy."),
      N_("Stáhni / ulož zobrazený soubor nebo všechny soubory platformy."),
      N_("Volitelně spusť **Emulaci kódu** — kontrola dialektu a běh kódu proti návrhu."),
    ],
    tips: [
      N_("Výstup je výchozí kostra — komentáře TODO označují místa k doplnění."),
      N_("U CODESYS, Schneider, WAGO a Beckhoff je nejrychlejší cestou **PLCopen_Import.xml**; u Rockwellu L5X."),
      N_("Záložka **HMI** připraví tagy, alarmy, obrazovky a exporty pro panely výrobců; **SISTEMA a EPLAN** exporty pro výpočet PL a projekt elektro."),
      N_("Když návrh obsahuje chyby, nad výstupy je jejich seznam s tlačítky do kroků Zařízení, I/O a Program — stahování zůstává povolené."),
    ],
    issues: [
      { problem: N_("„Návrh obsahuje chyby (n).“"), fix: N_("Vygenerovaný kód nemusí jít přeložit — oprav nálezy v krocích Zařízení, I/O nebo Program.") },
      { problem: N_("Stažení je zamčené"), fix: N_("Projekt je nad limitem I/O tarifu Free — vlož licenci, nebo požádej o odemčení prvního projektu.") },
    ],
    see: ["overeni-platforem", "overeni", "licence", "platformy"],
    keywords: N_("generovat, kód, README, import, PLCopen, L5X, SCL, ST, HMI, emulace, SISTEMA, EPLAN, stáhnout"),
  },
  {
    id: "dokumentace", group: "step", step: 8, title: N_("Dokumentace"),
    summary: N_("Dokumenty projektu po souborech: FDS (funkční popis), I/O list, seznam alarmů, FAT, softwarová dokumentace, výkresy, protokol ověření simulací, kusovník a další podle toho, co projekt obsahuje."),
    steps: [
      N_("Vyber soubor v seznamu vlevo — vpravo se ukáže náhled."),
      N_("Stáhni / ulož jednotlivý soubor, všechny soubory, nebo celou projektovou složku."),
    ],
    tips: [
      N_("Dokumentace se generuje v jazyce aplikace — přepni jazyk vpravo nahoře a výstupy se přepočítají."),
      N_("Protokol **08_overeni_simulaci.md** ověřuje návrh, ne kód v cílovém IDE — výhrada v něm zůstává."),
      N_("Dokument **15_emulace_prekladu.md** se přidá až po ověření kódu emulací (Generovat → Emulace kódu)."),
      N_("U velkého stroje první příprava dokumentace (ověření simulací) chvíli trvá; průběh lze zrušit."),
      N_("Tarif Free stáhne dokumenty .md / .html s patičkou PLCdesk."),
    ],
    see: ["overeni", "slozka", "licence"],
    keywords: N_("dokumentace, FDS, I/O list, alarmy, FAT, protokol, výkresy, stáhnout, uložit, Markdown"),
  },
  {
    id: "kusovnik", group: "step", step: 9, title: N_("Kusovník"),
    summary: N_("Komponenty k poptávce s označením podle IEC 81346: PLC a moduly ze sestavy hardwaru, ke každému zařízení jeho díly (jistič motoru, stykač, rozváděč, snímače…) a rozvaděč. Značky, typy, objednací kódy a dodavatelé z katalogu."),
    steps: [
      N_("Zvol **Platformu řízení** — určí CPU a moduly sestavy hardwaru."),
      N_("**Rezerva I/O** (volitelně): procento obsazených kanálů nebo minimum volných kanálů DI / DO / AI / AO. PLCdesk pak zvolí CPU a karty tak, aby rezerva zbyla (jen v lokálním racku — kvůli rezervě nepřidá vzdálenou stanici); vedle vidíš volné kanály sestavy. Nový projekt začíná s rezervou 20 %; dřívější projekty, příklady a import stávajícího stroje jsou bez rezervy. Prázdné = bez rezervy."),
      N_("U řádku nebo celé kategorie vyber výrobce a typ z katalogu, případně zadej vlastní."),
      N_("Uprav množství, objednací kód a dodavatele; množství 0 řádek vyřadí z CSV a dokumentace."),
      N_("Stáhni / ulož CSV pro Excel nebo zkopíruj tabulku."),
      N_("**Export pro CAD (FreeCAD)** uloží PLCdesk_CAD.json: všechny díly kusovníku s označením, objednacím kódem, umístěním (rozvaděč / stroj, DIN lišta / montážní deska / rack PLC) a trvalým GUID, bezpečnostní díly, sestavu PLC v pořadí slotů, svorkovnice a vazby (jistič → stykač → motor, rozváděč → válec, snímač → válec, výstup PLC → akční člen), poslední revizi se stavem schválení a zadání pro 3D koncept (popis, takt, koncept, zařízení s parametry, kroky sekvence, E-stop, blokování a bezpečnostní funkce). I/O se doplní ze zařízení samy. Geometrii nenese — podklad pro stavbu rozvaděče a polních prvků v CADu; v projektové složce leží v 09_Exporty/CAD."),
      N_("**Načíst zpětnou vazbu z CAD…** načte PLCdesk_CAD_feedback.json z kontroly 3D modelu: neshody (malá skříň, nesedí množství, nejednoznačný typ…) s naměřenou a požadovanou hodnotou a návrhem změny řádku. U každé položky zvol **Přijmout návrh**, alternativu, nebo **Odmítnout**; **Použít rozhodnutí** změní jen tvé volby kusovníku a zapíše historii (kdo, kdy, co) do kusovníku a 09_kusovnik.md. Pak **exportuj znovu pro CAD**."),
    ],
    tips: [
      N_("Neshody nalezené ve 3D se neopravují v CADu — PLCdesk je zdroj pravdy kusovníku; nic se nezmění bez tvého rozhodnutí."),
      N_("U malé skříně nabídne PLCdesk nejmenší větší skříň z katalogu podle rozměrů (vnější rozměr se zdrojem; užitný ověř v CAD)."),
      N_("U dílu s ukončenou výrobou nebo dílu, který nelze objednat (stav u výrobce se zdrojem), nabídne PLCdesk nástupce z CAD a jiné položky katalogu téže kategorie — vhodnost náhrady posuď sám."),
      N_("U položky **málo kanálů I/O PLC** (např. obsazeno 8 z 8 DI) PLCdesk přepočítá stav podle své sestavy a nabídne rezervu I/O (přidá kartu) nebo větší CPU téže řady — každý návrh je předem ověřený, že rezerva zbude. Po přijetí exportuj znovu pro CAD: manifest ponese novou kartu nebo CPU."),
      N_("Změna bezpečnostního dílu v kusovníku (E-stop, spínač krytu, bezpečnostní relé…) je v revizi bezpečnostní změna, ne kosmetická."),
      N_("Svorky v kusovníku = svorkovnice výkresů X1…Xn (jedna svorka na kanál); svorky napájení a rezervu doplní projektant."),
      N_("Výstup zámku krytu (vazba „zámek krytů“ nebo zámek v popisu) dostane v kusovníku **blokovací zařízení se zámkem** (jištění krytu podle EN ISO 14119, např. Schmersal AZM201) — návrh, ověř v posouzení rizik. Blokovací vstup „dveře zavřeny a zamčeny“ je kontakt téhož přístroje a samostatný spínač nedostane."),
      N_("Díly zařízení se volí i podle popisu: signál z / do jiného stroje (EUROMAP, „signál z lisu“, robot) = konektor rozhraní a vazební relé, ne snímač ani válec; vakuum / přísavky = ejektor, přísavky a spínač podtlaku; chapadlo = paralelní chapadlo (zdvih chapadla zůstává válec). Jiný díl zvol u řádku."),
      N_("Výstupy majáku tvoří **jednu signální věž** -PF1 s patrem na každý výstup (shora červená, žlutá, modrá, zelená, bílá; barva z popisu, jinak z role výstupu — odhad je v poznámce). Víc věží jen když to popis zařízení říká („věž A“, „věž B“). Volič / přepínač režimů má vlastní řádek voliče, ne tlačítka."),
      N_("Objednací kódy jsou jen ověřené (se zdrojem); ceny katalog neuvádí."),
      N_("Bezpečnostní prvky jsou v kusovníku jen jako hardware s výhradou „návrh k revizi“."),
      N_("**Obnovit výchozí volby** zahodí tvé volby značek a řádků."),
      N_("Vedle kusovníku je záložka **Nabídka** — ocenění podle tvého ceníku."),
    ],
    issues: [
      { problem: N_("„… nevejde se“ (sestava hardwaru)"), fix: N_("Signály se nevejdou do CPU a dostupných modulů platformy — zvol větší CPU v kusovníku, nebo jinou platformu.") },
      { problem: N_("„Kanály DI jsou obsazené všechny …“ / „Rezerva I/O nesplněna …“"), fix: N_("Plně obsazený směr je jen informace — pro rozšíření nastav Rezervu I/O. Nesplněná rezerva: do sestavy se víc modulů nevejde — zvol větší CPU, jinou platformu nebo menší rezervu.") },
      { problem: N_("„zastaralé — export pro CAD se od kontroly změnil“"), fix: N_("Kusovník se po exportu změnil; návrhy jdou použít, ale posuď je pečlivě. Po použití exportuj znovu pro CAD a nech 3D zkontrolovat znovu.") },
      { problem: N_("„neplatné — v kusovníku chybí …“"), fix: N_("Zpětná vazba odkazuje na řádek, který kusovník nemá (jiný projekt nebo starý export) — oprav ji v CAD a exportuj znovu.") },
    ],
    see: ["nabidka", "platformy", "io"],
    keywords: N_("kusovník, BOM, komponenty, objednací kód, dodavatel, výrobce, CSV, Excel, poptávka, CPU, moduly, rezerva I/O, volné kanály"),
  },
  {
    id: "pro3d", group: "topic", only: "desktop", preview: true, title: N_("3D agent (PRO)"),
    summary: N_("Náhled funkce PLCdesk PRO: krok za Kusovníkem, ve kterém AI agenti (Claude Code) automatickým postupem postaví a zkontrolují 3D model stroje ve FreeCADu — vstupy z PLCdesk, koncept, stavba po částech. Krok se ukáže jen se zapnutým náhledem PRO; licence PRO zatím není."),
    steps: [
      N_("Zapni náhled: v settings.json ve složce stavu aplikace nastav **pro_preview: true** (nebo proměnnou prostředí PLCDESK_PRO=1) a aplikaci spusť znovu. V liště kroků přibude za Kusovníkem **3D agent (PRO)**."),
      N_("**Složka 3D stroje**: výchozí je 02_Vykresy/3D v projektové složce; **Vybrat…** zvolí jinou (pamatuje se pro projekt). Krok ukáže verdikt poslední kontroly KONTROLA_K5_*.md, začátek STAV*.md, modely FCStd a náhledy posledních snímků PNG (klik = otevřít)."),
      N_("Pruh fází ukazuje stav postupu: **① Vstupy z PLCdesk** (bez AI: manifest PLCdesk_CAD.json, kopie projektu, funkční rozbor ROZBOR.md, kusovník KUSOVNIK.csv, program hardwarové platformy s emulací PROGRAM.md, STAV.md) → **② Koncept** → **③ Stavba** (rozvaděč, rám a kryty, moduly, celek a PLM). U každé fáze je stav čeká / běží / kontrola K5, kolo n / schváleno / neschváleno / zastaveno."),
      N_("Každou část postaví stavitel a hned ji zkontroluje jiná role (Kontrolor K5, model nemění) do KONTROLA_K5_(část)_kolo(N).md; při VRÁCENO ji stavitel opraví a K5 kontroluje znovu, nejvýš 3 kola (rám a kryty 5). Neschválený koncept postup zastaví; neschválená část stavby se zapíše a postup pokračuje další částí."),
      N_("**Přísná kontrola K5**: kontrolor postupuje podle skillu stroj-kontrolor — pevný kontrolní seznam s důkazem u každé položky a minimum vlastních měření a snímků. **Brána K5** v PLCdesk protokol SCHVÁLENO sama přepíše na VRÁCENO, když seznam není úplný, chybí minimum, snímek je prázdný, neposoudil skutečný počet dílů bez spoje nebo se po schválení změnil model jiné části; brána jen vrací, nikdy neschvaluje."),
      N_("**Model AI podle role**: pro Koncept, Stavitele a Kontrolora K5 vybereš model (známé modely jako u AI návrháře, nebo vlastní ID); výchozí je Opus 5.5 pro koncept a Sonnet 5.5 pro stavbu a kontrolu. Volba se pamatuje pro projekt, limit kol agenta je v pipeline.json (maxTurns). Skutečnou cenu a model každého běhu zapíše PREHLED.md."),
      N_("**Spustit celý postup** naváže od posledního hotového kroku (pipeline.json ve složce stroje); **Spustit od fáze…** spustí zvolený krok a všechny další znovu. Před spuštěním se aplikace zeptá, zda spotřebovat kredity tvého tarifu Claude. **Zastavit** ukončí jen proces agenta spuštěný z PLCdesk."),
      N_("**Pokyny fází**: u každé části rozbalíš výchozí pokyn (šablonu — můžeš ji upravit, uloží se pro projekt; Obnovit výchozí pokyn ji vrátí) a pole **Doplňující pokyn**, které se přidá na konec."),
      N_("Na konci vznikne **PREHLED.md** (fáze, kola, verdikty, cena a tokeny, předpoklady označené ODHAD, sepsaná zpětná vazba, snímky) a logy běhů v podsložce logy. **Otevřít ve FreeCADu** otevře vybraný model ve vlastní instanci (slot plcdesk-pro), **Načíst zpětnou vazbu z CAD…** je totéž okno jako v Kusovníku."),
      N_("**Modely ke stažení**: karta ukáže díly, které nemají model dle dokumentace, s výrobcem, objednacím kódem, přesným názvem souboru a stavem (staženo / chybí / v knihovně / zástupný); totéž je v STAHNOUT.md a klikací STAHNOUT.html ve složce stroje (vznikají ve fázi Vstupy). **Otevřít** otevře stránku produktu nebo hledání výrobce v prohlížeči — model stáhneš sám (STEP AP214) a uložíš do models/manual pod názvem ze seznamu, nebo ho necháš ve Stažených souborech. **Načíst stažené** soubor pozná (název, jinak objednací kód nebo typ v názvu či v hlavičce STEP — návrh potvrdíš), ověří ho ve FreeCADu, zaeviduje do models/index.json a zástupný díl v modelu stroje nahradí odkazem na model výrobce."),
      N_("V **STAHNOUT.html** má každý díl tlačítka ke stažení: stránka produktu výrobce, stránka CAD dat (Siemens CAx Download Manager, Rittal PARTcommunity) a náhradní hledání TraceParts a 3Dfindit. Objednací kód a přesný název souboru zkopíruješ tlačítkem **kopírovat**, odkaz nahoře otevře složku models/manual. Odkazy označené hvězdičkou nejdou ověřit automaticky — když nevedou přímo na díl, vlož kód do hledání portálu."),
    ],
    tips: [
      N_("Agent dostává pravidla práce (vlastní instance FreeCADu, App::Part a App::Link s vypočteným umístěním, zástupné díly oranžově, povolené kolize jen šroub × díra a matice × drážka, nic ve vzduchu, otvory krytů podle ISO 13857 měřením, prohlédnout snímky, PLCdesk = zdroj pravdy kusovníku, bezpečnost jen ke schválení)."),
      N_("Kontroly modelu počítá kód (pro3d_tools): kolize, souvislost s podlahou, otvory krytů podle ISO 13857 (voxely a měření e a Sr), kusovník × manifest, zástupné díly a STEP → kontroly.json a KONTROLY.md. Stavitel je spouští před odevzdáním, kontrolor nezávisle; SCHVÁLENO s chybou kontrol postup sám zneplatní."),
      N_("**Normalizované díly kódem** (pro3d_parts): před stavbou vzniknou ve složce dily modely dílů kusovníku, jejichž rozměry jsou v tabulkách se zdrojem (válce ISO 15552 a ISO 6432, přístroje na lištu a PLC Siemens, tlačítka 22 mm, HMI, snímače ifm a SICK, signální věž, svorky WAGO, šrouby, matice, podložky, lišta TS35, vývodky). Stavitel je musí vložit jako odkaz; zástupnou oranžovou obálku staví jen pro zbytek. Pokrytí ukáže PREHLED.md a dily/DILY.md."),
      N_("**Rozvaděč kódem** (pro3d_cabinet): před stavitelem rozvaděče vznikne model rozvadec/Rozvadec.FCStd přímo z manifestu — skříň (z manifestu, a když se výbava nevejde, nejmenší vyhovující z katalogu), lišty TS35 s rezervou místa 20 %, žlaby rozdělené na silové a signálové s uzemněnými přepážkami, mezery výrobců, přístroje jako odkazy, šrouby, panty, vývodky, PE a N přípojnice, přístroje na dveřích s výřezy a upevněním podle dokumentace a svazky ke dveřím s volným úsekem u pantu na otevření 95° — a ROZVADEC.md s tepelnou bilancí ze ztrát doložených datovými listy (když nevyhovuje, i s filtračním ventilátorem). Stavitel model jen kontroluje a doplňuje kabeláž uvnitř žlabů a popisky; když generátor selže, staví rozvaděč sám."),
      N_("**Moduly kódem** (pro3d_modules): před stavitelem modulů vznikne moduly/Moduly.FCStd z manifestu, konceptu a schváleného rámu — válce s patkami nebo upevněné čelem, snímače polohy, snímače v držácích s podélnými otvory, zařízení s úchytkami, nosné konstrukce převzaté z konceptu, šroubení a škrticí ventily, hadice a kabely s poloměry ohybu a délkami podle výrobců (vše se šrouby, nic ve vzduchu) — a MODULY.md s tím, co kód nepostavil, s požadavky na rám (díry, průchody) a se zpětnou vazbou; stavitel doplní jen nepostavené."),
      N_("**Barvy v modelu**: **žlutá** = díl dle dokumentace z generátorů (vkládá se odkazem, nepřebarvuje se), **oranžová** = zástupný díl, ostatní barvy = model výrobce nebo vlastní konstrukce. Barvy dílů ze složky dily uloží krátce spuštěná GUI instance FreeCADu; kontrola stav hlídá, že barva odpovídá stavu dílu."),
      N_("V automatickém běhu nikdo neodpovídá na otázky: chybějící údaje agent doplní jako označený ODHAD a vypíše je v přehledu. Zpětnou vazbu pro kusovník jen sepíše — použít ji rozhodneš ty v kroku Kusovník."),
      N_("Zaškrtávátko **TEST: bezpečnostní prvky považovat za schválené** slouží jen ke zkoušce postupu — výstupy pak nesou „TEST – schválení předpokládáno“."),
      N_("Agent má zúžená oprávnění: jen nástroje souborů, skilly a příkazy powershell / python / node, zápis jen do složky stroje, bez webu a serverů MCP. Volitelný limit ceny (USD) platí pro každý běh agenta."),
      N_("PLCdesk modely nikdy nestahuje sám: podmínky 3Dfindit / CADENAS, TraceParts i portálů výrobců automatické stahování nedovolují. Do firemní knihovny modelů (model_library ve složce stavu aplikace) jdou jen modely výrobců, jejichž podmínky interní opakované použití dovolují (Siemens, Phoenix Contact); ostatní patří jen k projektu. Co je v knihovně, karta nabídne tlačítkem **Převzít z knihovny**."),
      N_("Dávka bez okna: python -m plc_studio.pro_pipeline --sample projekt.plcstudio.json --out složka [--no-ai] připraví vstupy (a s AI spustí celý postup) z příkazové řádky."),
    ],
    issues: [
      { problem: N_("„Claude Code nenalezen“"), fix: N_("Nainstaluj Claude Code a přihlas se (claude.exe v PATH nebo v %USERPROFILE%/.local/bin), nebo nastav cestu proměnnou PLCDESK_CLAUDE.") },
      { problem: N_("„FreeCAD 1.1 nenalezen“"), fix: N_("Nainstaluj FreeCAD 1.1 (výchozí cesta v Programs) a spouštěč vlastní instance run_fc.ps1; bez něj tlačítko Otevřít ve FreeCADu nefunguje, agent může běžet.") },
      { problem: N_("„Koncept neschválen — postup zastaven“"), fix: N_("Přečti poslední KONTROLA_K5_koncept_kolo(N).md, doplň pokyn konceptu (Doplňující pokyn) nebo údaje v projektu a spusť od fáze Koncept.") },
    ],
    see: ["kusovnik"],
    keywords: N_("PRO, 3D, agent, AI, Claude Code, FreeCAD, model, stavitel, kontrola K5, koncept, snímky, postup, fáze, kolo, přehled, ODHAD, TEST, stažení, STEP, model výrobce, STAHNOUT, knihovna modelů"),
  },
  {
    id: "nabidka", group: "step", step: 9, title: N_("Nabídka"),
    summary: N_("Interní podklad pro nabídku: kusovník oceněný podle tvého ceníku a odhad hodin práce z projektu × tvoje sazby. Ceny se nikdy nevymýšlí — bez ceníku, sazby nebo kurzu zůstane cena prázdná."),
    steps: [
      N_("V kroku Kusovník otevři záložku **Nabídka**."),
      N_("Načti svůj ceník (CSV / text z Excelu se středníkem, desetinná čárka, měna ve sloupci nebo záhlaví)."),
      N_("Zadej sazby a parametry odhadu práce; zkontroluj položky bez ceny."),
    ],
    tips: [
      N_("Položky se párují podle objednacího kódu, pak podle typu a značky, pak podle kategorie."),
      N_("Dokument nabídky se do dokumentace přidá jen na výslovnou volbu; patří do interní složky 99_Interni, zákazníkovi se nepředává."),
    ],
    see: ["kusovnik"],
    keywords: N_("nabídka, cena, ceník, sazba, hodiny, odhad, kalkulace, měna"),
  },
  {
    id: "bezpecnost", group: "step", step: 10, title: N_("Bezpečnost"),
    summary: N_("Návrh bezpečnostních funkcí podle EN ISO 13849: nebezpečí, PLr z grafu rizik, kategorie zastavení, architektura, komponenty a výpočet PL, bezpečná vzdálenost. Po schválení funkcí i bezpečnostní program a výkres okruhu."),
    steps: [
      N_("Projdi záložku **Nebezpečí** a navržené **Funkce**; nepotřebnou funkci vyřaď s odůvodněním."),
      N_("U funkce zadej riziko (S, F, P) — PLr se spočítá z grafu rizik; případně uveď PLr z normy typu C."),
      N_("Zkontroluj reakci, vstupy, výstupy, architekturu a komponenty; doplň B10d / MTTFd z datasheetu."),
      N_("Funkce a návrh schval jménem a poznámkou přímo v kroku."),
      N_("Po schválení otevři **Bezpečnostní program** a **Výkres okruhu**."),
    ],
    tips: [
      N_("Bezpečnostní logika patří do bezpečnostního PLC nebo relé, ne do standardního programu."),
      N_("Neschválené výstupy nesou výrazně NESCHVÁLENO; bezpečnostní program se generuje až po schválení funkcí."),
      N_("Validaci na stroji (ISO 13849-2) aplikace plánuje v Oživení, provádí ji člověk."),
      N_("Exporty pro SISTEMA a EPLAN jsou v kroku Generovat."),
    ],
    issues: [
      { problem: N_("„PL neurčeno“"), fix: N_("Chybí architektura nebo údaje komponent — doplň kategorii a hodnoty B10d / MTTFd.") },
      { problem: N_("„Chybí: …“ u funkce"), fix: N_("Funkce nemá vstupní zařízení nebo výstupy — vyber je ze seznamu dostupných.") },
    ],
    see: ["schvaleni", "ozivovani", "generovat"],
    keywords: N_("bezpečnost, ISO 13849, PL, PLr, kategorie, nebezpečí, riziko, STO, E-stop, safety, SISTEMA, bezpečná vzdálenost"),
  },
  {
    id: "schvaleni", group: "step", step: 11, title: N_("Schválení"),
    summary: N_("PLCdesk navrhuje, odpovědná osoba schvaluje. Každá položka návrhu (zařízení, I/O, sekvence, E-stop a blokování, takt, výsledek ověření, bezpečnost, plán oživení…) se schvaluje jménem, datem a poznámkou."),
    steps: [
      N_("Zadej **jméno schvalující osoby** — zapíše se ke každému rozhodnutí."),
      N_("Projdi položky po skupinách; **Schválit** nebo **Zamítnout** s poznámkou."),
      N_("Na záložce **Návrhy ladění** posuď návrhy z ověření simulací — „Použít“ změní projekt, ale nic neschvaluje."),
    ],
    tips: [
      N_("Schválení platí pro obsah v okamžiku schválení. Když se položka změní, je „změněno po schválení“ a schvaluje se znovu."),
      N_("Odznak **Neschváleno: N** v hlavičce ukazuje počet položek bez platného schválení; klik otevře tento krok."),
      N_("Nic se neschvaluje automaticky."),
    ],
    issues: [
      { problem: N_("„Bez jména nelze schvalovat ani zamítat.“"), fix: N_("Vyplň jméno schvalující osoby nahoře v kroku.") },
      { problem: N_("„Položku zatím nelze schválit.“"), fix: N_("Důvod je uvedený přímo u položky (např. chybí výsledek ověření nebo předchozí schválení) — nejdřív ho odstraň.") },
    ],
    see: ["bezpecnost", "ozivovani", "revize"],
    keywords: N_("schválení, schvalovat, podpis, odpovědná osoba, zamítnout, ladění, neschváleno, otisk"),
  },
  {
    id: "ozivovani", group: "step", step: 12, title: N_("Oživení"),
    summary: N_("Plán uvádění do provozu po fázích od rozvaděče přes smyčkový test I/O, pohony a sekvenci po poruchové stavy a validaci bezpečnostních funkcí; výsledky kroků a protokol."),
    steps: [
      N_("Zadej jméno osoby, která zapisuje výsledky."),
      N_("Procházej kroky po fázích a ke každému zapiš výsledek **OK / Nevyhovuje / N/A**, naměřenou hodnotu a poznámku."),
      N_("Stáhni / ulož protokol jako Markdown nebo CSV."),
      N_("Když jsou všechny kroky OK nebo N/A, schval uzavření oživení v kroku Schválení."),
    ],
    tips: [
      N_("Fáze 5 zkouší E-stop a blokování jen jako signály standardního programu; bezpečnostní funkce se validují ve fázi 10."),
      N_("Filtr „otevřené“ ukáže kroky bez výsledku nebo s výsledkem Nevyhovuje."),
    ],
    issues: [
      { problem: N_("„Bez jména nelze zapsat výsledek.“"), fix: N_("Vyplň jméno nahoře v kroku.") },
    ],
    see: ["schvaleni", "bezpecnost"],
    keywords: N_("oživení, uvedení do provozu, commissioning, protokol, FAT, test, smyčkový test, validace"),
  },

  /* ------------------------------------------------------------------ témata */
  {
    id: "simulace", group: "topic", only: "desktop", title: N_("Živá simulace a scénáře (desktop)"),
    summary: N_("Desktop umí spustit program proti modelu stroje a ukázat ho graficky: snímače a měření vlevo, PLC s moduly uprostřed, akční členy vpravo, vodiče svítí podle stavu signálů."),
    steps: [
      N_("V kroku Program otevři záložku **Živá simulace**."),
      N_("Zapni režim **AUTO** a dej **START** cyklu; E-STOP a **Kvitace** odpovídají proměnným programu."),
      N_("Klikem vyber zařízení — ruční povel (mimo AUTO), zaseknutí pohybu, zamrzlé hlášení, porucha nebo analogová hodnota."),
      N_("Na záložce **Scénáře a ověření** přehraj hotové průběhy a ověření programu s časovým diagramem."),
    ],
    tips: [
      N_("Digitální vstup ve schématu je tlačítko: klik ho vnutí (jako force v IDE), ↺ vrátí vstup simulovanému stroji, **Uvolnit vše** zruší všechna vnucení."),
      N_("Čas simulace jde zastavit a krokovat."),
      N_("Simulace ověřuje návrh, ne kód přeložený v cílovém IDE."),
    ],
    see: ["program", "overeni"],
    keywords: N_("živá simulace, animace, scénáře, časový diagram, vnucení, force, krokovat, desktop"),
  },
  {
    id: "overeni", group: "topic", title: N_("Ověření simulací a emulace kódu"),
    summary: N_("Ověření simulací pustí běžný cyklus, poruchové scénáře a matici stavů proti modelu stroje a porovná reakce s FDS. Emulace kódu zkontroluje skutečný vygenerovaný kód podle pravidel dialektu a spustí ho proti témuž modelu."),
    steps: [
      N_("Ověření simulací běží samo pro dokumentaci a schválení; výsledek je v protokolu 08_overeni_simulaci.md."),
      N_("Emulaci spustíš v kroku Generovat → **Emulace kódu**."),
      N_("Nálezy oprav v návrhu nebo je posuď a schval v kroku Schválení."),
    ],
    tips: [
      N_("Simulace ověřuje návrh, ne kód v cílovém IDE, HW konfiguraci ani bezpečnostní funkce. Nenahrazuje test v simulátoru platformy a FAT."),
      N_("Emulátor není překladač výrobce — reálný import a překlad v IDE je dál nutný."),
      N_("U velkého projektu může ověření trvat i desítky minut; aplikace ukáže odhad a průběh lze zrušit."),
      N_("Matice stavů zkouší v klidu a v každém kroku E-stop, blokování, vypnutí AUTO, zamrzlé hlášení, poruchu pohonu a analog mimo mez."),
    ],
    issues: [
      { problem: N_("„Ověření potrvá …“ (varování validace)"), fix: N_("Velký projekt — ověření proběhne na pozadí; můžeš pracovat dál nebo ho zrušit.") },
      { problem: N_("Nález „vstup, který program nečte“"), fix: N_("Zapoj snímač jako krok čekání na vstup, nebo ho odeber.") },
    ],
    see: ["program", "generovat", "overeni-platforem", "simulace"],
    keywords: N_("ověření, simulace, emulace, emulátor, matice stavů, scénáře, výhrada, překladač, protokol"),
  },
  {
    id: "overeni-platforem", group: "topic", title: N_("Stav ověření platforem a beta"),
    summary: N_("U každé platformy štítek říká, jak je výstup ověřený: **ověřeno v IDE** (import a překlad ve skutečném vývojovém prostředí), **jazyk ověřen** (překladačem, ne v IDE výrobce), **beta** (jen emulátor PLCdesk)."),
    steps: [
      N_("V kroku Platformy najeď na štítek — bublina řekne, co ověřené není."),
      N_("Stejný štítek je na začátku README každé platformy."),
      N_("U platformy beta stáhni / ulož **Balík k ověření**, importuj ho ve svém IDE a vyplněný protokol pošli přes stránku Kontakt."),
    ],
    tips: [
      N_("Balík obsahuje vzorové výstupy, návod a šablonu protokolu bez osobních údajů."),
      N_("Za ověřený import a zaslaný protokol dostaneš licenci Pro zdarma."),
    ],
    see: ["platformy", "generovat", "plc-nahrani", "zpetna-vazba"],
    keywords: N_("ověřeno, beta, IDE, štítek, balík k ověření, protokol, TIA Portal, Studio 5000, GX Works3, Sysmac"),
  },
  /* Platformy PLC: řady, verze IDE a nahrání programu (rešerše dokumentace výrobců 2026-11-03; zdroj u každé kapitoly) */
  {
    id: "plc-nahrani", group: "topic", title: N_("Platformy PLC: řady, verze a nahrání programu"),
    summary: N_("Pod každou platformou je víc řad řídicích systémů a verzí vývojového prostředí (IDE). PLCdesk vygeneruje zdrojové soubory a README s postupem importu; **do PLC program nahraje až IDE výrobce**. Kapitoly platforem shrnují řady, vazbu verzí a postup nahrání podle dokumentace výrobců."),
    steps: [
      N_("V kroku **Generovat** ulož výstup platformy a otevři **README** — říká, které soubory a jak se importují do IDE."),
      N_("Ověř, že řada CPU patří k tomu, na co PLCdesk generuje, a že verze IDE odpovídá firmwaru CPU (kapitola platformy)."),
      N_("V IDE importuj, přelož a doplň konfiguraci hardwaru (CPU, moduly, síť, adresy)."),
      N_("Připoj PC k PLC (nejčastěji Ethernet ve stejné podsíti, případně USB), vyhledej zařízení a spusť nahrání (Download / Write to PLC / Login)."),
      N_("Rozhodni mezi plným nahráním se zastavením a online změnou za běhu a zkontroluj, co se stane s hodnotami proměnných (retain / persistent / inicializace)."),
      N_("Přepni PLC do RUN, ověř funkci a pokračuj krokem **Oživení**."),
    ],
    tips: [
      N_("Online změna (bez zastavení programu) jde jen u části změn — změna úloh, hardwaru nebo datových typů obvykle vyžaduje plné nahrání."),
      N_("Plné nahrání může přepsat aktuální hodnoty proměnných hodnotami z projektu — na běžícím stroji si je před nahráním zazálohuj."),
      N_("Jak je výstup platformy ověřený (ověřeno v IDE / jazyk ověřen / beta), říká štítek v kroku Platformy a začátek README."),
      N_("Údaje v kapitolách platforem jsou z dokumentace výrobců (zdroje na konci každé kapitoly, stav k listopadu 2026). Verze se mění — rozhoduje aktuální manuál k tvému CPU."),
    ],
    issues: [
      { problem: N_("Nahraje PLCdesk program přímo do PLC?"), fix: N_("Ne. PLCdesk připraví zdrojové soubory; import, konfiguraci hardwaru, nahrání a spuštění dělá člověk v IDE výrobce.") },
      { problem: N_("IDE zařízení nenajde"), fix: N_("PC a PLC musí být ve stejné podsíti (ruční IP na síťové kartě PC, ne DHCP); zkontroluj kabel a firewall, u CODESYS běžící Gateway, u TwinCATu ADS route.") },
      { problem: N_("Verze firmwaru a projektu nesedí"), fix: N_("Aktualizuj firmware CPU nástrojem výrobce, nebo v projektu nastav verzi odpovídající CPU — postup je v kapitole platformy.") },
    ],
    see: ["plc-siemens", "plc-rockwell", "plc-beckhoff", "plc-codesys", "plc-schneider", "plc-mitsubishi", "plc-omron", "plc-unitronics", "plc-wago", "plc-delta", "overeni-platforem", "generovat"],
    keywords: N_("nahrát, nahrání, download, firmware, verze, řada CPU, IDE, online změna, RUN, STOP, připojení, IP adresa"),
  },
  {
    id: "plc-siemens", group: "topic", title: N_("Siemens SIMATIC: řady, TIA Portal a nahrání"),
    summary: N_("PLCdesk generuje SCL pro **S7-1200 (i G2) a S7-1500** v TIA Portalu (katalog: CPU 1212C / 1214C G2, vzdálené I/O ET 200SP). Starší S7-300 / S7-400 jsou mimo."),
    steps: [
      N_("Importuj výstup podle README platformy a přelož hardware i software."),
      N_("Pravým tlačítkem na stanici zvol **Download to device**. Při prvním nahrání se otevře **Extended download to device**: vyber rozhraní PG/PC, **Start search** a zařízení, jehož IP adresa odpovídá konfiguraci; pak **Load**."),
      N_("V okně **Load preview** projdi hlášení a navržené akce (např. zastavení CPU); tlačítko Load se zpřístupní, až je vše vyřešené."),
      N_("**Load results** ukáže výsledek, **Finish** přepne CPU do RUN."),
    ],
    tips: [
      N_("STOP CPU je nutný jen při nahrání konfigurace zařízení nebo změně textových seznamů; samotné bloky STOP nevyžadují."),
      N_("S7-1200 G2 podporuje TIA Portal od verze V20, starší verze ne. Manuál G2 uvádí firmware V1.0 a V4.1; která verze firmwaru vyžaduje TIA Portal V21, výrobce v manuálu neuvádí (nedoloženo)."),
      N_("Úrovně ochrany S7-1200 / S7-1500 (CPU → Properties → **Protection & Security**): Full access (u F-CPU i incl. fail-safe), Read access (čtení, upload, HMI, diagnostika, RUN/STOP — bez nahrání bloků a konfigurace a bez aktualizace firmwaru), HMI access a No access; každá úroveň má heslo, které rozlišuje velikost písmen."),
      N_("S7-1200 G2 místo úrovní používá uživatele a role (UMAC) s právy Full / Read / HMI access; přeložit a nahrát konfiguraci jde, jen když aspoň jeden uživatel má Full access. Staré úrovně zapne volba „Use legacy access control via access levels“."),
      N_("Úroveň ochrany S7-1500 nenahrazuje ochranu know-how: bloky na paměťové kartě chráněné nejsou."),
      N_("Firmware S7-1200: projekt pro starší CPU V4.x jde nahrát do CPU V4.x s vyšším firmwarem (funkce zůstanou omezené na starší verzi); do CPU s nižším firmwarem, než má projekt, nahrát nejde."),
      N_("S7-1500: optimalizované datové bloky s paměťovou rezervou dovolí nahrát nové proměnné bez reinicializace; změna jména, typu nebo remanence proměnné reinicializuje celý blok."),
      N_("Projekt TIA Portalu V20 otevře jen V20 a novější (není zpětně kompatibilní). Starší projekt se upgraduje otevřením v novější verzi (od V13 SP1 přímo, starší nejdřív ve V13 SP1)."),
      N_("Paměťová karta S7-1200: **transfer card** zkopíruje program do CPU bez STEP 7, **program card** slouží jako externí paměť programu. Kartu nelze formátovat ve Windows a karty s projekty klasické S7-1200 se nesmí vkládat do G2."),
      N_("S7-300: konec výroby od 1. 10. 2023, od 1. 10. 2025 jen jako náhradní díl."),
      N_("Zdroje: Siemens FAQ 42637263 (https://www.ad.siemens.com.cn/download/documentdetail_4332.html), TIA Portal V20 (https://press.siemens.com/global/en/pressrelease/tia-portal-version-20-enabling-peak-performance-and-efficiency), paměť S7-1500 (https://support.industry.siemens.com/cs/attachments/59193101/s71500_structure_and_use_of_the_PLC_memory_function_manual_en-US_en-US.pdf), S7-300 (https://www.siemens.com/nl/nl/products/automation/topic-areas/industry-actueel/productnieuws/s7-300.html)."),
      N_("Zdroje: S7-1200 System Manual V4.6, kap. 3.2, 5.5, 6, 7.6 (https://cache.industry.siemens.com/dl/files/829/109814829/att_1120874/v1/s71200_system_manual_en-US_en-US.pdf), S7-1200 G2 System Manual V4.1, kap. 5.7, 6.3 (https://cache.industry.siemens.com/dl/files/791/109997791/att_1350879/v2/S71200_G2_system_manual_en-US_en-US.pdf), S7-1500 System Manual 12/2014, kap. 8.2 (https://cache.industry.siemens.com/dl/files/792/59191792/att_856649/v1/s71500_et200mp_system_manual_en-US_en-US.pdf), TIA Portal V20 — kompatibilita projektů (https://docs.tia.siemens.cloud/r/de-de/v20/projekte-bearbeiten/kompatibilitat-von-projekten/kompatibilitat-zwischen-tia-portal-versionen?contentId=KLtsk_znOUcZv3utZUmncw)."),
    ],
    issues: [
      { problem: N_("Extended download nenajde CPU"), fix: N_("Zvol správné rozhraní PG/PC a Start search; PC musí být ve stejné podsíti a IP adresa v konfiguraci musí odpovídat CPU.") },
      { problem: N_("Tlačítko Load nejde stisknout"), fix: N_("V Load preview vyřeš všechny řádky (např. potvrď zastavení CPU, je-li nutné).") },
      { problem: N_("Do S7-1200 nahrávaného z TIA V12 a novější nejde nahrát z V11"), fix: N_("CPU nejdřív vrať do továrního nastavení (z TIA Portalu nebo paměťovou kartou).") },
      { problem: N_("Nahrání odmítnuto kvůli verzi firmwaru"), fix: N_("CPU má nižší firmware, než je nastavený v projektu — v konfiguraci zařízení nastav verzi firmwaru skutečného CPU, nebo CPU aktualizuj.") },
      { problem: N_("Zapomenuté heslo S7-1200"), fix: N_("Prázdná transfer card vymaže CPU se ztraceným heslem; program se pak nahraje znovu.") },
    ],
    see: ["plc-nahrani", "overeni-platforem", "generovat"],
    keywords: N_("Siemens, SIMATIC, TIA Portal, STEP 7, S7-1200, G2, S7-1500, ET 200SP, S7-300, download, Load preview, Extended download, firmware, ochrana, heslo, access level, paměťová karta"),
  },
  {
    id: "plc-rockwell", group: "topic", title: N_("Rockwell Logix: řady, Studio 5000 a nahrání"),
    summary: N_("PLCdesk generuje L5X / ST pro **CompactLogix 5380 (5069)** a řadiče Logix ve Studio 5000 Logix Designer. Hlavní (major) revize firmwaru řadiče musí být stejná jako revize projektu."),
    steps: [
      N_("Importuj L5X podle README platformy a v projektu nastav revizi shodnou s firmwarem řadiče."),
      N_("Řadič dej do režimu Program nebo Remote Program (klíč v poloze REM = Remote Program)."),
      N_("**Communications → Who Active** (komunikační software RSLinx Classic nebo FactoryTalk Linx), vyber řadič, **Set Project Path** (cesta se uloží do projektu) a **Download**."),
      N_("Drobné změny logiky za běhu: **Logic → Online Edits** (Accept / Test / Assemble program edits)."),
    ],
    tips: [
      N_("Firmware 38.xxx potřebuje Logix Designer v38. Nový řadič se dodává s firmwarem 1.xxx a před použitím se aktualizuje (ControlFLASH / ControlFLASH Plus nebo při downloadu)."),
      N_("Download přepíše hodnoty tagů v řadiči hodnotami z projektu; řadiče 5380 / 5480 / 5580 od verze 32 umí **Data Preserve Download**, který tomu zabrání."),
      N_("Projekt jde uložit do nevolatilní paměti (SD karta, Store); obraz se načte jen při shodné revizi firmwaru."),
      N_("Přepínač režimu (ControlLogix 5580): z RUN do REM = Remote Run, z PROG do REM = Remote Program; v REM přepíná režim Logix Designer (i Remote Test, jen odtud). Výrobce doporučuje za provozu nechat přepínač v RUN a klíč vytáhnout. U CompactLogix 5380 jsme přepínač z manuálu nedoložili."),
      N_("Nastavení ovladače EtherNet/IP v RSLinx Classic a nové menu verze 38 jsme z dokumentace Rockwell nedoložili."),
      N_("RSLogix 5000 se od verze 21 jmenuje Studio 5000 Logix Designer. SLC 500 / MicroLogix (RSLogix 500) a Micro800 (Connected Components Workbench) jsou mimo PLCdesk."),
      N_("Zdroje: ControlLogix 5580 User Manual 1756-UM543 — přepínač režimu (https://www.rockwellautomation.com/en-us/docs/technical/logix5000/_online/1756-um543/controllogix-5580-and-guardlogix-5580-controllers-/create-a-controller-project/use-the-keyswitch-to-change-the-operation-mode.html), ControlLogix 5590 1756-UM900 — změna režimu z Logix Designeru (https://www.rockwellautomation.com/en-au/docs/technical/logix5000/_online/1756-um900/controllogix-5590-controller-user-manual-ditamap/create-a-controller-project/use-the-logix-designer-application-to-change-the-o.html)."),
      N_("Zdroje: release notes Logix Designer v37 (https://compatibility.rockwellautomation.com/GeneratedReleaseNote.aspx?v1=64786) a v32 (https://compatibility.rockwellautomation.com/GeneratedReleaseNote.aspx?v1=58309), nápověda Logix Designer — Download (https://www.rockwellautomation.com/en-us/docs/studio-5000-logix-designer/37-00/contents-ditamap/quick-start-steps/download.html)."),
    ],
    issues: [
      { problem: N_("Při připojení hlášení o nesouladu revize"), fix: N_("Dialog Connecting to Controller nabídne **Update Firmware** řadiče, nebo změň revizi projektu podle firmwaru.") },
      { problem: N_("Download nejde, řadič je v RUN"), fix: N_("Přepni řadič do Program / Remote Program.") },
    ],
    see: ["plc-nahrani", "overeni-platforem", "generovat"],
    keywords: N_("Rockwell, Allen-Bradley, Studio 5000, Logix Designer, RSLogix 5000, CompactLogix, ControlLogix, 5380, L5X, Who Active, ControlFLASH, revize, download"),
  },
  {
    id: "plc-beckhoff", group: "topic", title: N_("Beckhoff TwinCAT 3: řady, verze a nahrání"),
    summary: N_("PLCdesk generuje ST pro **TwinCAT 3** na embedded PC CX a průmyslových PC (katalog: CX7000, CX8100, C6015 / C6017). TwinCAT 2 je mimo."),
    steps: [
      N_("Vytvoř projekt TwinCAT 3 v XAE a vlož výstup podle README platformy."),
      N_("**SYSTEM → Choose Target → Search → Broadcast Search** (jen ve stejné podsíti, jinak zadej IP) a **Add Route** s přihlašovacími údaji cíle."),
      N_("**Activate Configuration** přenese konfiguraci na cíl; bez licence nabídne 7denní zkušební licenci a pak přepnutí do Run."),
      N_("PLC → **Login**: plné nahrání nebo **Online Change**; nakonec boot projekt (Autostart), aby program naběhl i po restartu."),
    ],
    tips: [
      N_("TwinCAT 3.1 build 4026 se instaluje přes TwinCAT Package Manager (účet myBeckhoff); z 4024 se na 4026 přechází migrací. CX7000 potřebuje build 4024.12 a vyšší, CX9020 nejvýš 4024."),
      N_("XAE (vývoj) je zdarma; runtime na cíli potřebuje placené licence podle výkonnostní třídy, 7denní zkušební licenci lze v XAE vytvořit opakovaně."),
      N_("Plné nahrání reinicializuje všechny proměnné kromě PERSISTENT; Online Change nahraje jen změny bez zastavení, ale ne po Clean, změně úloh, EXTENDS / IMPLEMENTS nebo typu proměnné."),
      N_("Zdroje: Beckhoff Infosys — ADS route (https://infosys.beckhoff.com/content/1033/tc3_system/5211773067.html), Online Change (https://infosys.beckhoff.com/content/1033/tc3_plc_intro/2528041355.html), download (https://infosys.beckhoff.com/content/1033/tc3_plc_intro/2528058507.html), instalace 4026 (https://infosys.beckhoff.com/content/1033/tc3_installation/15698617995.html)."),
    ],
    issues: [
      { problem: N_("Broadcast Search cíl nenajde"), fix: N_("Povol ve firewallu TCP 48898 (ADS), UDP 48899 (Broadcast Search) a TCP 8016 (Secure ADS), nebo zadej IP adresu ručně.") },
      { problem: N_("Runtime na vývojovém PC nejde spustit"), fix: N_("Když na PC běží Hyper-V (i VBS), funguje jen XAE; na test použij Usermode Runtime (od 4026.21, bez EtherCAT) nebo skutečný cíl.") },
    ],
    see: ["plc-nahrani", "plc-codesys", "overeni-platforem", "generovat"],
    keywords: N_("Beckhoff, TwinCAT, XAE, CX7000, CX8100, ADS, route, Activate Configuration, Online Change, boot projekt, 4024, 4026, Package Manager"),
  },
  {
    id: "plc-codesys", group: "topic", title: N_("CODESYS V3.5: verze, zařízení a nahrání"),
    summary: N_("Kód pro CODESYS a jeho profily (WAGO, Delta, Turck, Festo, ABB, Rexroth, Inovance, Weidmüller, Eaton, Lenze, Berghof, Hitachi) je stejný ST / PLCopen XML; liší se IDE výrobce, popis zařízení a firmware runtime."),
    steps: [
      N_("Importuj PLCopen_Import.xml nebo soubory ST podle README platformy (včetně volání MAIN v úloze MainTask)."),
      N_("V **Communication Settings** zvol Gateway, **Scan Network** a nastav aktivní cestu k zařízení."),
      N_("**Online → Login**: u změněné aplikace vyber Login with Online Change, Login with download, nebo přihlášení beze změny."),
      N_("Vytvoř **boot aplikaci** (při downloadu podle nastavení, nebo explicitně), aby program naběhl po restartu, a aplikaci spusť."),
    ],
    tips: [
      N_("Verze kompilátoru je nezávislá na verzi IDE (Project Environment); instalace obsahuje kompilátory zpět do 3.5.17.0."),
      N_("Starší popis zařízení s novějším runtime se při Login přijme, novější popis se starším runtime ne — popis zařízení drž ve verzi firmwaru (Update Device / Project Environment)."),
      N_("Hodnoty proměnných: Online Change zachová vše; Reset Warm jen RETAIN a PERSISTENT; Reset Cold a Download jen PERSISTENT; Reset Origin nic."),
      N_("Bez platné licence běží runtime CODESYS jen 2 hodiny."),
      N_("Od CODESYS Control SL 3.5 SP17 je správa uživatelů zařízení ve výchozím stavu vynucená: při prvním Login aplikace vyzve k jejímu zapnutí a založíš uživatele ve skupině Administrator. Zapnout ji jde z IDE aspoň V3.5 SP16; vypnutí (Change Runtime Security Policy) otevře řadič komukoli v síti."),
      N_("Zdroje: CODESYS Online Help — správa uživatelů na PLC (https://content.helpme-codesys.com/en/Security/_sec_user_management_plc.html)."),
      N_("Profily dalších výrobců mají vlastní IDE a balík zařízení — název a verzi CODESYS uvádí README platformy."),
      N_("Zdroje: CODESYS Online Help — Online Change (https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_cmd_online_change.html), persistence dat (https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_f_setting_data_persistence.html), kompatibilita (https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_rtsl_compatibility.html), verze kompilátoru (https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_changing_compiler_version.html)."),
    ],
    issues: [
      { problem: N_("Scan Network zařízení nenajde"), fix: N_("Výchozí komunikace je UDP — PC a zařízení musí být ve stejné podsíti se stejnou maskou; Gateway musí běžet, zkus vypnout filtr podle Target ID.") },
      { problem: N_("Nabízí se jen download, ne online změna"), fix: N_("Online změna nejde po změně úloh, voleb kompilace, EXTENDS / IMPLEMENTS, typu proměnné, stromu zařízení (i Update Device) nebo po Clean All — nahraj plně a počítej s inicializací proměnných.") },
      { problem: N_("Chybí popis zařízení"), fix: N_("Použij Download Missing Device Description, jinak ho získej od výrobce (balík zařízení).") },
    ],
    see: ["plc-nahrani", "plc-wago", "plc-delta", "plc-schneider", "overeni-platforem", "generovat"],
    keywords: N_("CODESYS, V3.5, Gateway, Scan Network, Login, Online Change, boot aplikace, popis zařízení, device description, kompilátor, RETAIN, PERSISTENT, Turck, Festo, ABB, Rexroth, Eaton, Lenze"),
  },
  {
    id: "plc-wago", group: "topic", title: N_("WAGO PFC a CC100: firmware, IDE a nahrání"),
    summary: N_("PLCdesk generuje kód CODESYS V3.5 pro **PFC100 / PFC200 s I/O 750** (katalog i CC100). Rozhoduje firmware: do FW22 se programuje v e!COCKPIT, od FW23 v CODESYS V3.5 s balíkem zařízení WAGO."),
    steps: [
      N_("Zjisti firmware řadiče a podle něj zvol e!COCKPIT (do FW22) nebo CODESYS V3.5 (od FW23)."),
      N_("Importuj výstup podle README platformy (GVL_IO bez AT — kanály se přiřazují v I/O mapování)."),
      N_("Připoj se jako v CODESYS: Scan Network, výběr zařízení, Login, download a boot aplikace."),
    ],
    tips: [
      N_("Převod z e!COCKPIT: projekt nejdřív v e!COCKPIT 1.11 / FW22 / kompilátor 3.5.17, zařízení pak na FW23; z FW22 nejde v CODESYS aktualizovat rovnou na FW24; licence doplňků z e!COCKPIT nejdou použít znovu."),
      N_("V e!COCKPIT má projekt jednu verzi kompilátoru a ta odpovídá jen jedné verzi firmwaru — smíšené verze firmwaru v jednom projektu nejdou."),
      N_("Zdroje: WAGO — migrace e!COCKPIT (https://techdocs.wago.com/Software/eCOCKPIT_Migration/en-US/2061129739.html), verze kompilátoru (https://techdocs.wago.com/Software/eCOCKPIT/en-US/272929291.html), release notes PFC200 FW 26 (https://downloadcenter.wago.com/api/uploads/2023_11_09_Release_Notes_750_8x1x_62e7f35523.pdf)."),
    ],
    issues: [
      { problem: N_("Firmware a IDE nesedí"), fix: N_("Aktualizuj firmware, nebo použij IDE odpovídající firmwaru (e!COCKPIT do FW22, CODESYS V3.5 od FW23).") },
      { problem: N_("Chyby připojení a online změny"), fix: N_("Platí stejná pravidla jako v kapitole CODESYS V3.5.") },
    ],
    see: ["plc-nahrani", "plc-codesys", "overeni-platforem", "generovat"],
    keywords: N_("WAGO, PFC200, PFC100, CC100, 750, e!COCKPIT, firmware, FW22, FW23, CODESYS V3.5, migrace"),
  },
  {
    id: "plc-delta", group: "topic", title: N_("Delta AX: DIADesigner-AX a nahrání"),
    summary: N_("PLCdesk generuje kód CODESYS V3.5 pro **AX-3 / AX-5 / AX-8** (katalog: AX-308E s moduly AS). Programuje se v DIADesigner-AX, do kterého Delta integrovala CODESYS."),
    steps: [
      N_("Importuj výstup podle README platformy (adresy jsou výrazně označené jako neověřené)."),
      N_("Instalace DIADesigner-AX založí **CODESYS Gateway V3** (ikona na liště, startuje s Windows); stav ukazuje karta **Communication Settings** v okně zařízení (zelená = běží)."),
      N_("**Scan Network** → vyber CPU → OK (nebo zadej IP adresu či jméno zařízení), pak **Login** a stažení programu potvrď (postup z manuálu AX-8)."),
      N_("Další postup (boot aplikace, start) vychází z CODESYS — viz kapitola CODESYS V3.5."),
    ],
    tips: [
      N_("AX-308E je první AX-3 na CODESYS a používá I/O řady AS; AX-8 je řada na bázi PC."),
      N_("Volba **Apply IP settings while download** zapíše při stažení do CPU IP adresu z projektu (AX-8, porty GLAN1 / GLAN2)."),
      N_("Výchozí IP adresu AX-3, postup boot aplikace a verzi CODESYS pod DIADesigner-AX jsme nedoložili (manuály AX-3 a DIADesigner-AX nebyly dostupné; AX-8 má v příkladu manuálu 192.168.1.10) — řiď se manuálem svého CPU."),
      N_("Zdroje: AX-8 Series Operation Manual, kap. 3.2, 4, 7 (https://baa.vn/document/ax-8-series-delta-bo-dieu-khien-chuyen-dong-12786-catalog.pdf)."),
      N_("Zdroje: Delta — AX-308E (https://www.delta-emea.com/en-gb/news/30754), DIADesigner-AX (https://diastudio.deltaww.com/home/Specification?Type=5), katalog AX-8 (https://www.deltaww.com/IA/downloadcenter/catalogue/3.Control/AX-8/DELTA_IA-IPC_AX-8_C_EN_20210916.pdf)."),
    ],
    see: ["plc-nahrani", "plc-codesys", "overeni-platforem", "generovat"],
    keywords: N_("Delta, AX-3, AX-5, AX-8, AX-308E, DIADesigner-AX, DIAStudio, CODESYS, moduly AS"),
  },
  {
    id: "plc-schneider", group: "topic", title: N_("Schneider Modicon: řady, Machine Expert a nahrání"),
    summary: N_("PLCdesk generuje ST pro **Modicon M241 / M251 / M262** v EcoStruxure Machine Expert (na bázi CODESYS). M221 se programuje v Machine Expert – Basic (podle FAQ k verzi 1.6 bez ST) a je mimo."),
    steps: [
      N_("Importuj výstup podle README platformy (POU + GVL nebo PLCopen XML)."),
      N_("Připoj se a přihlas (Login) jako v CODESYS; víc aplikací najednou nahraje **Online → Multiple Download**."),
      N_("Boot aplikaci nabídne běžný download; u Multiple Download ji vytvoř přes **Online → Create boot application** (online jen ve STOP)."),
    ],
    tips: [
      N_("Firmware M241 / M251 aktualizuje Controller Assistant (po Ethernetu / USB, nebo na SD kartu FAT32 a vypnout / zapnout); M262 ze SD karty skriptem."),
      N_("Při downloadu se proměnné RETAIN inicializují, PERSISTENT RETAIN zůstanou."),
      N_("Vypršení hesla je v Machine Expert 2.3 a 2.5 ve výchozím stavu zapnuté, od 2.6 vypnuté."),
      N_("Zdroje: Schneider FAQ FA272065 (https://www.se.com/us/en/faqs/FA272065/), Multiple Download (https://product-help.schneider-electric.com/Machine%20Expert/V2.1/en/SoMMenu/SoMMenu/D-SE-0083995.html), RETAIN M251 (https://product-help.schneider-electric.com/Machine%20Expert/V2.1/en/m251prg/m251prg/D-SE-0008846.html), FAQ000282281 (https://www.se.com/us/en/faqs/FAQ000282281/)."),
    ],
    issues: [
      { problem: N_("Multiple Download aplikaci přeskočil"), fix: N_("Aplikace s vnucenými (forced) proměnnými se přeskočí — vnucení zruš.") },
      { problem: N_("M221: „Operation unsuccessful“ při downloadu aplikace s heslem"), fix: N_("V Commissioning zapni „Reset memories“ (SoMachine Basic V1.5 SP1, FAQ FA328638).") },
    ],
    see: ["plc-nahrani", "plc-codesys", "overeni-platforem", "generovat"],
    keywords: N_("Schneider, Modicon, M241, M251, M262, M221, Machine Expert, SoMachine, Controller Assistant, Multiple Download, boot aplikace, firmware"),
  },
  {
    id: "plc-mitsubishi", group: "topic", title: N_("Mitsubishi MELSEC: řady, GX Works3 a nahrání"),
    summary: N_("PLCdesk generuje ST, globální návěští a IEC 61131-10 XML pro **iQ-F (FX5U / FX5UC / FX5UJ)** a iQ-R v GX Works3. FX3, Q a L (GX Works2) jsou mimo; iQ-F jde programovat jen v GX Works3."),
    steps: [
      N_("Importuj výstup podle README platformy a přelož (Convert)."),
      N_("Na PC nastav ruční IP ve stejné podsíti jako CPU (výchozí FX5: 192.168.3.250 / 255.255.255.0)."),
      N_("**Online → Current Connection Destination**: v okně Specify Connection Destination zvol **CPU Module Direct Coupled Setting** (přímé spojení Ethernetem, výběr síťové karty PC). FX5U / FX5UC přes USB připojit nejde."),
      N_("**Online → Write to PLC** (okno Online Data Operation): na záložce Write vyber data (např. **Parameter + Program**, globální návěští), případně Detail, a **Execute**."),
      N_("Přepínač RUN/STOP/RESET dej do RUN, nebo použij **Online → Remote Operation** (RUN / STOP / PAUSE / RESET)."),
    ],
    tips: [
      N_("Převod programu za běhu dělá GX Works3 jako online změnu automaticky (vypnutí: Tools → Options → Conversion → Online Program Change); LD a ST jdou měnit online od první verze firmwaru."),
      N_("Část funkcí závisí na firmwaru CPU (např. online změna SFC od FX5U / FX5UC FW 1.290) — porovnej s manuálem."),
      N_("Rozsah latch (retain): CPU Parameter → Device/Memory Setting → Device/Label Memory Area Setting."),
      N_("Boot ze SD karty: Memory Card Parameters → Boot Settings, zapsat na kartu, pak vypnout / zapnout nebo reset CPU."),
      N_("Ochrana: security key, block password, remote password a file password."),
      N_("Remote Operation funguje jen s přepínačem na CPU v RUN; RESET vyžaduje povolený remote reset v CPU Parameter → Operation Related Setting a CPU zastavené dálkově."),
      N_("Za běhu jde jen online změna programu; FX5 nepodporuje File batch online change, ostatní soubory se zapisují ve STOP / PAUSE."),
      N_("Firmware FX5U / FX5UC / FX5UJ nejde aktualizovat z GX Works3 — jen SD kartou; FX5S umí obojí."),
      N_("Zdroje: GX Works3 Operating Manual SH-081215ENG-AV, kap. 12.1–12.2, 13.1, 13.4, 18.2 (https://dl.mitsubishielectric.com/dl/fa/document/manual/plc/sh081215eng/sh081215engav.pdf), aktualizace firmwaru FAQ 39325 (https://fa-faq.mitsubishielectric.com/faq/show/39325)."),
      N_("Zdroje: Mitsubishi FA FAQ 22292 (https://fa-faq.mitsubishielectric.com/faq/show/22292), připojení Ethernetem 22319 (https://fa-faq.mitsubishielectric.com/faq/show/22319), online změna 44876 (https://fa-faq.mitsubishielectric.com/faq/show/44876), latch 22329 (https://fa-faq.mitsubishielectric.com/faq/show/22329), boot ze SD 44348 (https://fa-faq.mitsubishielectric.com/faq/show/44348)."),
    ],
    issues: [
      { problem: N_("GX Works3 se k CPU nepřipojí"), fix: N_("PC má IP z DHCP nebo z jiné podsítě, případně spojení blokuje antivir — nastav ruční IP ve stejné podsíti.") },
      { problem: N_("FX5 nejde otevřít v GX Works2"), fix: N_("Řada iQ-F se programuje jen v GX Works3.") },
      { problem: N_("Program se do CPU nezapíše"), fix: N_("Systémové a CPU parametry v projektu se neshodují s CPU — zapiš je spolu s programem (Parameter + Program).") },
      { problem: N_("Spojení blokuje firewall"), fix: N_("Ve firewallu Windows povol GXW3.exe; u FX5 musí mít PC stejnou síťovou část IP adresy jako CPU.") },
    ],
    see: ["plc-nahrani", "overeni-platforem", "generovat"],
    keywords: N_("Mitsubishi, MELSEC, GX Works3, GX Works2, iQ-F, FX5U, FX5UJ, iQ-R, Write to PLC, Specify Connection Destination, Remote Operation, latch, SD karta, firmware"),
  },
  {
    id: "plc-omron", group: "topic", title: N_("OMRON Sysmac: řady, Sysmac Studio a nahrání"),
    summary: N_("PLCdesk generuje ST a tabulku proměnných pro **NJ / NX** (katalog: NX1P2, NX102) v Sysmac Studiu. Řady CS1 / CJ / CP se programují v CX-Programmer (CX-One) a jsou mimo."),
    steps: [
      N_("Importuj výstup podle README platformy; v projektu zvol model a verzi jednotky CPU."),
      N_("Připoj se k řadiči (např. přímo USB) a přejdi online."),
      N_("**Synchronizace** porovná projekt s daty v řadiči a přenese je zvoleným směrem (do řadiče)."),
      N_("Režim přepni **Controller → Mode → RUN Mode / PROGRAM Mode** a potvrď; při změně režimu se smažou hodnoty I/O kromě proměnných s atributem Retain."),
    ],
    tips: [
      N_("Retain proměnné se při přenosu ve výchozím stavu zachovají (smazat je jde volbou v okně synchronizace), ostatní proměnné se smažou. Proměnná označená jako Retain až po přenosu se při něm vynuluje."),
      N_("Záloha a obnova na SD kartu: DIP přepínač 3 + tlačítko 3 s, proměnná _Card1BkupCmd nebo Tools → Backup; záloha neuloží část konfigurace EtherCAT a polohy enkodérů."),
      N_("Sysmac Studio má 30denní zkušební verzi, trvale potřebuje licenci."),
      N_("Verze řadiče v projektu musí být rovna verzi CPU nebo nižší (projekt 1.01 jde do CPU 1.02, ne do 1.00). Mění se přes **Change Device**; nastavení funkcí, které nová verze nemá, se ztratí. Verze je na štítku na boku CPU."),
      N_("**Online editace** (Project → Online Edit → Start / Transfer): logika LD a ST, přidání lokálních (VAR) a globálních proměnných, volání POU, předvolby časovačů; mazat proměnné ani měnit jejich jméno, typ, AT nebo Retain nejde. Data v řadiči musí být shodná s projektem a během přenosu nevypínej napájení."),
      N_("**Controller → Clear All Memory** (jen v PROGRAM) smaže program, nastavení řadiče včetně zabezpečení, všechny proměnné i offset absolutního enkodéru — offset předem zazálohuj."),
      N_("Zdroje: Sysmac Studio Operation Manual W504-E1-48, kap. 3-3, 7-2-5, 7-2-6, 8-6-1 (https://assets.omron.com/m/5588b79554a8fdfe/original/Sysmac-Studio-Operation-Manual.pdf)."),
      N_("Zdroje: Omron — retain při přenosu (https://omron.helpjuice.com/machine-automation-controllers/how-to-retain-variables-in-nxnj-series-during-transfer), záloha na SD (https://automation-knowledge-base.omron.eu/support/solutions/articles/103000314503-controller-backup-and-restore-procedure), Sysmac Studio Operation Manual W504 (https://assets.omron.com/m/5588b79554a8fdfe/original/Sysmac-Studio-Operation-Manual.pdf)."),
    ],
    issues: [
      { problem: N_("Přenos nejde kvůli verzi jednotky"), fix: N_("V projektu změň zařízení na verzi jednotky odpovídající CPU, nebo použij CPU s vyšší verzí jednotky.") },
    ],
    see: ["plc-nahrani", "overeni-platforem", "generovat"],
    keywords: N_("Omron, Sysmac Studio, NJ, NX, NX1P2, NX102, synchronizace, přenos, verze jednotky, unit version, retain, SD karta, online editace, Clear All Memory, režim RUN, CX-Programmer"),
  },
  {
    id: "plc-unitronics", group: "topic", title: N_("Unitronics UniStream: UniLogic a nahrání"),
    summary: N_("PLCdesk generuje plochý ST a seznam tagů pro **UniStream** v UniLogic (katalog: US5 / US7 / US10 / USC). Vision a Samba (VisiLogic) a starší řady jsou mimo — pro ně je výstup jen předloha."),
    steps: [
      N_("Importuj tagy a ST podle README platformy."),
      N_("Připoj se Ethernetem (IP podle UniApps → Network) nebo mini-USB (modely B3 USB nemají)."),
      N_("Stáhni projekt: **Full Download** (jen rozdíly), Logic only (Ctrl+D), Media only nebo Download all; varianta „with Upload“ uloží i projekt pro pozdější vyčtení."),
    ],
    tips: [
      N_("UniLogic při stažení kontroluje, zda firmware v PLC sedí k verzi UniLogic; firmware se aktualizuje ve Firmware Manageru na kartě PLC (downgrade jen přes Remote Upgrade nebo USB)."),
      N_("Po změně typu, adresy nebo retain tagu je nutný restart PLC."),
      N_("Retain a Power-up hodnota se vylučují; retain mají jen globální tagy."),
      N_("Hesla (projekt, Upload, UniApps, VNC) se nahrávají s projektem."),
      N_("Zdroje: nápověda UniLogic — Downloading/Uploading (https://www.unitronicsplc.com/Download/SoftwareHelp/!UniLogicWebhelp2024/Getting_Started_With_UniLogic/Downloading_Uploading_a_project.htm), Firmware (https://www.unitronicsplc.com/Download/SoftwareHelp/!UniLogicWebhelp2024/Getting_Started_With_UniLogic/Firmware.htm), Tags (https://www.unitronicsplc.com/Download/SoftwareHelp/!UniLogicWebhelp2024/Tags/Tags_(Operands).htm)."),
    ],
    issues: [
      { problem: N_("„HMI Version Mismatch“ po stažení"), fix: N_("Firmware PLC nesedí k verzi UniLogic — aktualizuj ho ve Firmware Manageru.") },
      { problem: N_("Projekt nejde z PLC vyčíst"), fix: N_("Projekt se stáhl bez varianty „with Upload“ — stáhni ho znovu s ní.") },
    ],
    see: ["plc-nahrani", "overeni-platforem", "generovat"],
    keywords: N_("Unitronics, UniStream, UniLogic, US5, USC, VisiLogic, Vision, Full Download, firmware, Firmware Manager, UniApps"),
  },
  {
    id: "import", group: "topic", title: N_("Import stávajícího zařízení"),
    summary: N_("Průvodce převezme stávající stroj z exportů PLC (TIA Portal, Studio 5000 L5X, CODESYS / PLCopen XML, TwinCAT, GX Works, Sysmac, výstupy PLCdesk), I/O listů, schémat v PDF, fotek a popisu funkce."),
    steps: [
      N_("Otevři průvodce v kroku Projekt (**Načíst stávající zařízení…**) nebo Zařízení (**Import stávajícího zařízení…**)."),
      N_("**Podklady** — přidej soubory nebo vlož text."),
      N_("**Rozpoznáno** — co jádro přečetlo přesně, bez AI."),
      N_("**Analýza AI** (volitelná, placená) — PDF, obrázky a neznámé texty; cenu ukáže před odesláním."),
      N_("**Kontrola a převzetí** — jistota u každé položky, zdroj (soubor a řádek), konflikty a co chybí; odškrtni, co nechceš převzít."),
    ],
    tips: [
      N_("Binární projekty (.ACD, .zap, .gxw…) přečíst nejde — průvodce doporučí textový export z IDE."),
      N_("E-stop a kryty se převezmou jen jako signály; bezpečnostní okruh ani logika se nerekonstruují."),
      N_("Adresa od AI se převezme jen s doloženým zdrojem."),
    ],
    issues: [
      { problem: N_("„binární (převeď do PDF nebo CSV)“"), fix: N_("Exportuj projekt z IDE do textového formátu (XML, L5X, CSV) a přidej export.") },
      { problem: N_("Soubor je větší než 50 MB"), fix: N_("Rozděl podklady nebo přidej jen exporty a I/O listy.") },
    ],
    see: ["projekt", "zarizeni", "ai"],
    keywords: N_("import, reverse engineering, stávající stroj, export, TIA, L5X, PLCopen, I/O list, PDF, fotka, migrace"),
  },
  {
    id: "slozka", group: "topic", title: N_("Projektová složka a ukládání"),
    summary: N_("Projekt (.plcstudio.json) obsahuje celý návrh. Výstupy se ukládají do projektové složky <číslo>_<Název> s podsložkami 01_Dokumentace, 02_Vykresy, 03_Program_PLC, 04_HMI… a s číslem projektu na začátku názvu každého souboru."),
    steps: [
      N_("**Ctrl+S** uloží projekt, **Ctrl+O** otevře projekt ze souboru."),
      desk(N_("V kroku Projekt vyber kořenový adresář projektů; projekt ho může přepsat vlastním kořenem.")),
      desk(N_("**Uložit vše do složky projektu** zapíše všechny výstupy; okna Uložit začínají v odpovídající podsložce.")),
      web(N_("V Edge a Chrome vyber **kořenový adresář projektů** — **Uložit vše do složky projektu** pak zapíše výstupy přímo na disk.")),
      web(N_("V ostatních prohlížečích použij **Stáhnout projekt (ZIP)** — stejný obsah jako projektová složka.")),
    ],
    tips: [
      web(N_("Na webu se návrh průběžně ukládá v prohlížeči; po obnovení stránky se k projektové složce může být potřeba znovu povolit přístup (**Obnovit přístup ke složce**).")),
      desk(N_("Desktop ukládá rozpracovaný stav do složky uživatele a po spuštění pokračuje.")),
      N_("Složka 99_Interni (nabídka) se zákazníkovi nepředává."),
      N_("Kód PLC se předponou čísla nemění; objekty TwinCAT si ponechají své jméno."),
    ],
    issues: [
      { problem: N_("„Projekt se neukládá!“"), fix: N_("Úložiště prohlížeče je plné nebo zakázané — exportuj návrh (JSON) a uvolni místo.") , only: "web" },
      { problem: N_("„Ukládání do složky umí Edge a Chrome…“"), fix: N_("Použij Stáhnout projekt (ZIP).") , only: "web" },
    ],
    see: ["projekt", "zkratky", "licence"],
    keywords: N_("uložit, otevřít, složka, projektová složka, ZIP, kořenový adresář, JSON, soubor, Ctrl+S"),
  },
  {
    id: "licence", group: "topic", title: N_("Licence a tarify"),
    summary: N_("Free: projekt do 64 I/O, dokumenty .md / .html a README s patičkou PLCdesk, bez DXF a firemní knihovny. Pro: bez limitu, bez patičky, DXF. Firma: navíc firemní knihovna (vlastní bloky a hlavička). Kód PLC se licencí nemění."),
    steps: [
      N_("Klikni na odznak tarifu v hlavičce — otevře se okno Licence."),
      N_("Vlož licenční klíč (PLCD-…) a aktivuj ho přes internet, nebo vlož celý licenční soubor z e-mailu (funguje i bez internetu)."),
      N_("Nad limitem Free funguje náhled; stažení a ukládání výstupů je zamčené. Projekt (.plcstudio.json) se ukládá vždy."),
    ],
    tips: [
      N_("První projekt nad limit odemkneme zdarma: **Odemknout první projekt zdarma** otevře stránku Kontakt a text žádosti s ID projektu zkopíruje do schránky."),
      N_("Po vypršení platí ještě 30 dní tolerance, pak aplikace běží jako Free."),
      N_("Ceník je na webu PLCdesk (odkaz **Ceník** v okně Licence)."),
    ],
    issues: [
      { problem: N_("„Server licencí se nepodařilo zastihnout.“"), fix: N_("Vlož místo klíče licenční soubor z e-mailu — dlouhý řádek s tečkou uprostřed.") },
      { problem: N_("„Stažení výstupů je zamčené…“"), fix: N_("Projekt má víc I/O, než povoluje Free — vlož licenci Pro / Firma nebo požádej o odemčení.") },
    ],
    see: ["slozka", "knihovna", "zpetna-vazba"],
    keywords: N_("licence, tarif, Free, Pro, Firma, klíč, aktivace, limit, 64 I/O, cena, odemčení, DXF"),
  },
  {
    id: "revize", group: "topic", title: N_("Revize a změny"),
    summary: N_("Revize zmrazí obsah projektu (A, B… nebo 01, 02…). Aplikace pak ukáže změny od revize, jejich třídu (kosmetická / funkční / bezpečnostní), dotčená schválení a návrh rozsahu opakovaných zkoušek."),
    steps: [
      N_("V kroku Projekt otevři **Revize a změny** a vytvoř revizi se jménem a poznámkou."),
      N_("Po úpravách porovnej projekt s revizí — změny po položkách a rozsah opakovaných zkoušek (FAT, oživení, validace)."),
    ],
    tips: [
      N_("Označení revize je v hlavičce; hvězdička (např. B*) znamená změny od revize."),
      N_("Rozsah opakovaných zkoušek je NÁVRH — potvrzuje ho člověk."),
      N_("S revizí přibude dokument 17_zmeny.md a sloupec Rev v popisovém poli výkresů."),
    ],
    see: ["projekt", "schvaleni"],
    keywords: N_("revize, změna, změnové řízení, verze, porovnání, diff, opakované zkoušky"),
  },
  {
    id: "knihovna", group: "topic", title: N_("Firemní knihovna"),
    summary: N_("Vlastní typy zařízení (díly kusovníku, časy kroků), šablony funkčních bloků se stejným rozhraním jako vestavěné, firemní hlavička a schvalovatelé. Knihovna se exportuje a importuje jako .plcdesk-library.json."),
    steps: [
      N_("V kroku Projekt otevři **Firemní knihovna** a importuj nebo založ knihovnu."),
      N_("Vlastní typ zařízení přidáš v kroku Zařízení z knihovny."),
    ],
    tips: [
      N_("Vlastní blok knihovny se použije v kódu jen v tarifu Firma; nepřevoditelná nebo chybná šablona = vestavěný blok a upozornění v README."),
      N_("Vlastní blok simulace neověřuje; emulátor ale zkontroluje jeho překlad."),
    ],
    see: ["licence", "zarizeni", "generovat"],
    keywords: N_("knihovna, šablona, funkční blok, FB, firemní hlavička, typ zařízení, schvalovatel"),
  },
  {
    id: "zkratky", group: "topic", title: N_("Klávesové zkratky"),
    summary: N_("Zkratky platí v hlavním okně (ne v dialozích); rozepsané pole se před akcí uloží."),
    steps: [
      web(N_("**Ctrl+S** — uložit projekt: s vybraným kořenovým adresářem do projektové složky, jinak stažením souboru .plcstudio.json.")),
      desk(N_("**Ctrl+S** — uložit projekt: otevřený nebo už uložený projekt do jeho souboru, jinak dialog Uložit projekt.")),
      N_("**Ctrl+O** — otevřít projekt ze souboru (neprázdný návrh se nejdřív zeptá)."),
      N_("**Alt+←** / **Alt+→** — předchozí / další krok."),
      N_("**F1** — nápověda k aktuálnímu kroku."),
      N_("**Esc** — zavře panel nápovědy."),
    ],
    see: ["start", "slozka"],
    keywords: N_("klávesy, zkratky, Ctrl+S, Ctrl+O, F1, Alt, klávesnice"),
  },
  {
    id: "jazyky", group: "topic", title: N_("Jazyky"),
    summary: N_("Aplikace i výstupy jsou česky, anglicky, německy, španělsky a čínsky. Jazyk přepneš v hlavičce vpravo nahoře; dokumentace, README a hlášení se přepočítají."),
    tips: [
      N_("Obsah projektu (názvy, popisy, komentáře I/O) se nepřekládá — zůstává v jazyce, ve kterém vznikl."),
      N_("Komentáře v kódu PLC a texty výkresů DXF jsou v latince; při čínštině anglicky. Výstup pro Unitronics a DXF je čisté ASCII."),
      web(N_("Odkaz na aplikaci v daném jazyce: parametr adresy ?lang=en.")),
    ],
    see: ["start"],
    keywords: N_("jazyk, čeština, angličtina, němčina, španělština, čínština, překlad, language"),
  },
  {
    id: "zpetna-vazba", group: "topic", title: N_("Zpětná vazba a podpora"),
    summary: N_("Narazil jsi na chybu, chybí ti funkce, nebo něco není jasné? Napiš nám — tlačítkem **Zpětná vazba** v aplikaci nebo přes stránku Kontakt na webu PLCdesk."),
    steps: [
      N_("Popiš, co jsi dělal, co jsi čekal a co se stalo; přidej krok a jazyk aplikace."),
      N_("Projekt přikládej jen pokud chceš — obsahuje údaje zákazníka."),
    ],
    tips: [
      N_("Protokol z ověření platformy beta posílej přes stránku Kontakt."),
      N_("Nápověda na webu PLCdesk má stejný obsah jako v aplikaci (tlačítko **Otevřít na webu** v panelu nápovědy)."),
    ],
    see: ["overeni-platforem", "faq"],
    keywords: N_("zpětná vazba, podpora, kontakt, chyba, nahlásit, návrh, feedback, e-mail"),
  },
  {
    id: "faq", group: "topic", title: N_("Časté otázky"),
    summary: N_("Odpovědi na otázky, které se opakují."),
    issues: [
      { problem: N_("Půjde vygenerovaný kód rovnou do PLC?"), fix: N_("Je to výchozí kostra programu podle návrhu — import a překlad v IDE výrobce, HW konfiguraci a oživení dělá člověk. README každé platformy popisuje postup.") },
      { problem: N_("Řeší PLCdesk bezpečnost stroje?"), fix: N_("Navrhuje bezpečnostní funkce a po schválení bezpečnostní program pro bezpečnostní PLC. Standardní program E-stop jen čte jako stav; za posouzení rizik a validaci odpovídá člověk.") },
      { problem: N_("Potřebuji AI?"), fix: N_("Ne. Zařízení přidáš ručně, otevřeš příklad stroje nebo importuješ stávající zařízení. AI jen urychlí první návrh a je placená z tvého API účtu.") },
      { problem: N_("Proč se výkresy a adresy po změně platformy liší?"), fix: N_("Každá platforma má vlastní sestavu hardwaru (CPU, moduly, notaci adres). Pro hlavní platformu se adresy připnou; zvolit ji jde v kusovníku.") },
      { problem: N_("Kde je výsledek ověření simulací?"), fix: N_("V dokumentu 08_overeni_simulaci.md v kroku Dokumentace a v položkách kroku Schválení.") },
      { problem: N_("Jak přenesu projekt mezi webem a desktopem?"), fix: N_("Ulož projekt (.plcstudio.json) a otevři ho v druhé aplikaci — formát je stejný.") },
      { problem: N_("Aplikace je pomalá u velkého stroje"), fix: N_("Ověření simulací a dokumentace se počítají na pozadí s průběhem a tlačítkem Zrušit; první výpočet trvá déle, další se berou z mezipaměti.") },
    ],
    see: ["start", "overeni", "plc-nahrani", "licence", "zpetna-vazba"],
    keywords: N_("otázky, FAQ, časté dotazy, problém, proč, jak"),
  },
];

/** Index kroku workflow → id kapitoly (pořadí lišty kroků v obou klientech). */
export const HELP_STEP_IDS: string[] = ["projekt", "ai", "platformy", "zarizeni", "io", "schema", "program",
  "generovat", "dokumentace", "kusovnik", "bezpecnost", "schvaleni", "ozivovani"];

/** Kapitola k aktuálnímu kroku (číslo kroku; krok Nápověda / neznámý = „start“). */
export function helpForStep(step: unknown): string {
  return typeof step === "number" && HELP_STEP_IDS[step] ? HELP_STEP_IDS[step] : "start";
}

const keep = (only: HelpClient | undefined, client?: HelpClient) => !only || !client || only === client;
const shown = (s: Src, client?: HelpClient, preview = false) => keep(s.only, client) && (!s.preview || preview);
const asText = (x: string | HelpText): HelpText => (typeof x === "string" ? { text: x } : x);

function build(s: Src, client?: HelpClient): HelpChapter {
  const t = (x: HelpText): HelpText => (x.only ? { text: tr(x.text), only: x.only } : { text: tr(x.text) });
  const ch: HelpChapter = {
    id: s.id, group: s.group, title: tr(s.title), summary: tr(s.summary),
    steps: (s.steps || []).map(asText).filter(x => keep(x.only, client)).map(t),
    tips: (s.tips || []).map(asText).filter(x => keep(x.only, client)).map(t),
    issues: (s.issues || []).filter(x => keep(x.only, client)).map(x => ({ problem: tr(x.problem), fix: tr(x.fix), ...(x.only ? { only: x.only } : {}) })),
    see: (s.see || []).filter(id => { const o = SRC.find(c => c.id === id); return !!o && shown(o, client); }),
    keywords: tr(s.keywords).split(/[,，、]/).map(k => k.trim()).filter(Boolean),
  };
  if (s.step !== undefined) ch.step = s.step;
  if (s.only) ch.only = s.only;
  return ch;
}

/** Všechny kapitoly v jazyce `lang` (výchozí = nastavený); `client` vynechá položky jiného klienta,
 *  `preview` přidá kapitoly náhledu (PLCdesk PRO — jen desktop se zapnutým náhledem). */
export function helpChapters(lang?: string, client?: HelpClient, preview = false): HelpChapter[] {
  return withLang(lang ?? getLang(), () => SRC.filter(s => shown(s, client, preview)).map(s => build(s, client)));
}

/** Jedna kapitola (nebo null). */
export function helpChapter(id: string, lang?: string, client?: HelpClient, preview = false): HelpChapter | null {
  const s = SRC.find(c => c.id === id);
  if (!s || !shown(s, client, preview)) return null;
  return withLang(lang ?? getLang(), () => build(s, client));
}

/** Česká zdrojová data kapitol (klíče překladu) — pro testy a sběr textů. */
export function helpSourceTexts(): string[] {
  const out: string[] = [...Object.values(HELP_GROUPS)];
  for (const s of SRC) {
    out.push(s.title, s.summary, s.keywords);
    for (const x of [...(s.steps || []), ...(s.tips || [])]) out.push(asText(x).text);
    for (const x of s.issues || []) out.push(x.problem, x.fix);
  }
  for (const t of TOUR) out.push(t.title, t.text);
  out.push(...Object.values(HELP_UI));
  return out;
}

/* ---------------------------------------------------------------- úvodní průvodce */

export interface HelpTourStop {
  id: string;
  /** Cíl zvýraznění: číslo kroku workflow, "samples" (výběr příkladů v kroku Projekt) nebo "help". */
  target: number | "samples" | "help";
  title: string;
  text: string;
}
const TOUR: { id: string; target: HelpTourStop["target"]; title: string; text: string }[] = [
  { id: "welcome", target: 0, title: N_("Vítej v PLCdesk"), text: N_("Za minutu ti ukážu, jak aplikace funguje. Návrh stroje prochází kroky v liště nahoře zleva doprava; kdykoli se můžeš vrátit.") },
  { id: "projekt", target: "samples", title: N_("Projekt a příklady strojů"), text: N_("Začni názvem a číslem projektu v kroku Projekt — nebo otevři hotový vzor z nabídky Příklady strojů a vyzkoušej si všechno na něm.") },
  { id: "devices", target: 1, title: N_("AI návrh nebo Zařízení"), text: N_("Popiš stroj vlastními slovy a nech si navrhnout sestavu (vlastní API klíč Anthropic), nebo přidej motory, ventily a snímače ručně v kroku Zařízení.") },
  { id: "plat", target: 2, title: N_("Platformy"), text: N_("Vyber jeden nebo více řídicích systémů. Štítek u platformy říká, jak je výstup ověřený — v IDE, překladačem, nebo zatím jen emulátorem (beta).") },
  { id: "gen", target: 7, title: N_("Generovat"), text: N_("Tady je kód pro každou platformu a README s postupem importu do IDE výrobce, dále HMI, emulace kódu a exporty SISTEMA a EPLAN.") },
  { id: "docs", target: 8, title: N_("Dokumentace"), text: N_("FDS, I/O list, seznam alarmů, FAT, výkresy a protokol ověření simulací — po souborech nebo celá projektová složka.") },
  { id: "help", target: "help", title: N_("Nápověda a zpětná vazba"), text: N_("Tlačítko ? v záhlaví kroku nebo klávesa F1 otevře nápovědu právě k tomu kroku; celá nápověda s hledáním je pod tlačítkem Nápověda. Připomínky a chyby nám pošli tlačítkem Zpětná vazba. Průvodce spustíš znovu z Nápovědy.") },
];

/** Zastavení úvodního průvodce v jazyce `lang`. */
export function helpTour(lang?: string): HelpTourStop[] {
  return withLang(lang ?? getLang(), () => TOUR.map(t => ({ id: t.id, target: t.target, title: tr(t.title), text: tr(t.text) })));
}

/** Společné popisky UI nápovědy (panel, krok Nápověda, průvodce, web) — překlad přes `tr(HELP_UI.x)`. */
export const HELP_UI = {
  panelTitle: N_("Nápověda ke kroku"),
  open: N_("Nápověda k tomuto kroku (F1)"),
  full: N_("Celá nápověda"),
  web: N_("Otevřít na webu"),
  close: N_("Zavřít"),
  steps: N_("Postup"),
  tips: N_("Tipy"),
  issues: N_("Časté chyby a hlášky"),
  faq: N_("Otázky a odpovědi"),
  see: N_("Související"),
  only_web: N_("jen web"),
  only_desktop: N_("jen desktop"),
  search: N_("Hledat v nápovědě…"),
  results: N_("Výsledky hledání"),
  noResults: N_("Nic nenalezeno — zkus jiné slovo."),
  contents: N_("Obsah nápovědy"),
  tourStart: N_("Spustit průvodce"),
  tourNext: N_("Další"),
  tourPrev: N_("Zpět"),
  tourSkip: N_("Přeskočit"),
  tourDone: N_("Hotovo"),
  tourOf: N_("{n} z {m}"),
  school: N_("Škola PLC — základy pro začátečníky"),
  goStep: N_("Přejít na krok"),
  video: N_("Videoprůvodce (asi 10 min)"),
  webTitle: N_("Nápověda PLCdesk"),
  webIntro: N_("Návod k aplikaci PLCdesk po krocích návrhu: postup, tipy, časté chyby a jak je opravit. Stejný obsah najdeš v aplikaci pod tlačítkem ? u každého kroku nebo klávesou F1."),
};

/* ---------------------------------------------------------------- hledání */

/** Text pro porovnání: malá písmena, bez diakritiky. */
export function helpFold(s: string): string {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export interface HelpHit {
  id: string;
  title: string;
  score: number;
  /** Úryvek s kontextem kolem první shody (bez zvýraznění; klient si shodu zvýrazní sám). */
  snippet: string;
  step?: number;
}

const strip = (s: string) => s.replace(/\*\*/g, "");

/**
 * Hledání v kapitolách: bez diakritiky a velikosti písmen, všechna slova dotazu musí být
 * v kapitole (AND). Váha: nadpis 10, klíčová slova 6, shrnutí 3, ostatní text 1 (na slovo).
 * Hledá v jazyce `lang`; mimo češtinu i v českých klíčových slovech (nižší váha).
 */
export function searchHelp(query: string, lang?: string, client?: HelpClient, limit = 20, preview = false): HelpHit[] {
  const words = helpFold(query).split(/[\s,;]+/).map(w => w.trim()).filter(w => w.length >= 2 || /[^\x00-\x7f]/.test(w));
  if (!words.length) return [];
  const l = lang ?? getLang();
  const chapters = helpChapters(l, client, preview);
  const csKw = l === "cs" ? null : new Map(SRC.map(s => [s.id, helpFold(s.keywords)]));
  const hits: HelpHit[] = [];
  for (const ch of chapters) {
    const title = helpFold(ch.title), kw = helpFold(ch.keywords.join(" ")), sum = helpFold(strip(ch.summary));
    const bodyRaw = [...ch.steps.map(x => x.text), ...ch.tips.map(x => x.text), ...ch.issues.flatMap(x => [x.problem, x.fix])].map(strip);
    const body = helpFold(bodyRaw.join(" \n "));
    let score = 0, all = true;
    for (const w of words) {
      let s = 0;
      if (title.includes(w)) s += 10;
      if (kw.includes(w)) s += 6;
      else if (csKw && csKw.get(ch.id)!.includes(w)) s += 3;
      if (sum.includes(w)) s += 3;
      if (body.includes(w)) s += 1 + Math.min(2, body.split(w).length - 2);
      if (!s) { all = false; break; }
      score += s;
    }
    if (!all) continue;
    hits.push({ id: ch.id, title: ch.title, score, snippet: snippetOf([strip(ch.summary), ...bodyRaw], words), ...(ch.step !== undefined ? { step: ch.step } : {}) });
  }
  hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return hits.slice(0, limit);
}

/** Úryvek kolem první shody (±70 znaků) z prvního textu, který slovo obsahuje; jinak začátek shrnutí. */
function snippetOf(texts: string[], words: string[]): string {
  const R = 70;
  for (const w of words) {
    for (const t of texts) {
      const i = helpFold(t).indexOf(w);     // NFD odstraní jen kombinující znaky — délky NFC textu sedí
      if (i < 0) continue;
      const a = Math.max(0, i - R), b = Math.min(t.length, i + w.length + R);
      return (a > 0 ? "…" : "") + t.slice(a, b).trim() + (b < t.length ? "…" : "");
    }
  }
  const t = texts[0] || "";
  return t.length > 2 * R ? t.slice(0, 2 * R).trim() + "…" : t;
}

/* ---------------------------------------------------------------- web plcdesk */

/** Adresa kapitoly na webu PLCdesk (/napoveda/<id>/; bez id rozcestník) v jazyce UI (web má cs / en / de / zh). */
export function helpSiteUrl(id?: string, lang?: string): string {
  const base = licenseSiteUrl("napoveda", lang ?? getLang());
  return id && SRC.some(s => s.id === id) ? base + id + "/" : base;
}

/** Jazyky, ve kterých existuje videoprůvodce (web /video/, přepínač jazyka videa `?v=`). */
export const HELP_VIDEO_LANGS = ["cs", "en", "de", "es", "zh"];

/**
 * Adresa videoprůvodce na webu PLCdesk s jazykem videa = jazyk UI: `/video/?v=cs`, `/en/video/?v=en`,
 * `/de/video/?v=de`, `/zh/video/?v=zh`; web nemá es — vede na anglickou stránku s videem `?v=es`.
 */
export function helpVideoUrl(lang?: string): string {
  const l = lang ?? getLang();
  return licenseSiteUrl("video", l) + "?v=" + (HELP_VIDEO_LANGS.includes(l) ? l : "en");
}

/** Id všech kapitol (pro web a testy; bez kapitol náhledu — ty web nemá). */
export const HELP_IDS: string[] = SRC.filter(s => !s.preview).map(s => s.id);
