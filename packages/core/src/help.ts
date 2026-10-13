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
    see: ["overeni-platforem", "generovat", "kusovnik"],
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
    keywords: N_("zařízení, motor, ventil, válec, snímač, analog, měnič, pohon, servoosa, osa, třída, označení, meze, žádaná, rampa, maják"),
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
    ],
    tips: [
      N_("Čísla vodičů odpovídají svorkovnici: X1:1 = -W101, X2:3 = -W203."),
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
      N_("U řádku nebo celé kategorie vyber výrobce a typ z katalogu, případně zadej vlastní."),
      N_("Uprav množství, objednací kód a dodavatele; množství 0 řádek vyřadí z CSV a dokumentace."),
      N_("Stáhni / ulož CSV pro Excel nebo zkopíruj tabulku."),
    ],
    tips: [
      N_("Objednací kódy jsou jen ověřené (se zdrojem); ceny katalog neuvádí."),
      N_("Bezpečnostní prvky jsou v kusovníku jen jako hardware s výhradou „návrh k revizi“."),
      N_("**Obnovit výchozí volby** zahodí tvé volby značek a řádků."),
      N_("Vedle kusovníku je záložka **Nabídka** — ocenění podle tvého ceníku."),
    ],
    issues: [
      { problem: N_("„… nevejde se“ (sestava hardwaru)"), fix: N_("Signály se nevejdou do CPU a dostupných modulů platformy — zvol větší CPU v kusovníku, nebo jinou platformu.") },
    ],
    see: ["nabidka", "platformy", "io"],
    keywords: N_("kusovník, BOM, komponenty, objednací kód, dodavatel, výrobce, CSV, Excel, poptávka, CPU, moduly"),
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
    see: ["platformy", "generovat", "zpetna-vazba"],
    keywords: N_("ověřeno, beta, IDE, štítek, balík k ověření, protokol, TIA Portal, Studio 5000, GX Works3, Sysmac"),
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
    see: ["start", "overeni", "licence", "zpetna-vazba"],
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
const asText = (x: string | HelpText): HelpText => (typeof x === "string" ? { text: x } : x);

function build(s: Src, client?: HelpClient): HelpChapter {
  const t = (x: HelpText): HelpText => (x.only ? { text: tr(x.text), only: x.only } : { text: tr(x.text) });
  const ch: HelpChapter = {
    id: s.id, group: s.group, title: tr(s.title), summary: tr(s.summary),
    steps: (s.steps || []).map(asText).filter(x => keep(x.only, client)).map(t),
    tips: (s.tips || []).map(asText).filter(x => keep(x.only, client)).map(t),
    issues: (s.issues || []).filter(x => keep(x.only, client)).map(x => ({ problem: tr(x.problem), fix: tr(x.fix), ...(x.only ? { only: x.only } : {}) })),
    see: (s.see || []).filter(id => { const o = SRC.find(c => c.id === id); return !!o && keep(o.only, client); }),
    keywords: tr(s.keywords).split(/[,，、]/).map(k => k.trim()).filter(Boolean),
  };
  if (s.step !== undefined) ch.step = s.step;
  if (s.only) ch.only = s.only;
  return ch;
}

/** Všechny kapitoly v jazyce `lang` (výchozí = nastavený); `client` vynechá položky jiného klienta. */
export function helpChapters(lang?: string, client?: HelpClient): HelpChapter[] {
  return withLang(lang ?? getLang(), () => SRC.filter(s => keep(s.only, client)).map(s => build(s, client)));
}

/** Jedna kapitola (nebo null). */
export function helpChapter(id: string, lang?: string, client?: HelpClient): HelpChapter | null {
  const s = SRC.find(c => c.id === id);
  if (!s || !keep(s.only, client)) return null;
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
export function searchHelp(query: string, lang?: string, client?: HelpClient, limit = 20): HelpHit[] {
  const words = helpFold(query).split(/[\s,;]+/).map(w => w.trim()).filter(w => w.length >= 2 || /[^\x00-\x7f]/.test(w));
  if (!words.length) return [];
  const l = lang ?? getLang();
  const chapters = helpChapters(l, client);
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

/** Adresa kapitoly na webu PLCdesk (/napoveda/<id>/; bez id rozcestník) v jazyce UI (web má cs / en / de). */
export function helpSiteUrl(id?: string, lang?: string): string {
  const base = licenseSiteUrl("napoveda", lang ?? getLang());
  return id && SRC.some(s => s.id === id) ? base + id + "/" : base;
}

/** Jazyky, ve kterých existuje videoprůvodce (web /video/, přepínač jazyka videa `?v=`). */
export const HELP_VIDEO_LANGS = ["cs", "en", "de", "es", "zh"];

/**
 * Adresa videoprůvodce na webu PLCdesk s jazykem videa = jazyk UI: `/video/?v=cs`, `/en/video/?v=en`,
 * `/de/video/?v=de`; web nemá es / zh — ty vedou na anglickou stránku s videem `?v=es` / `?v=zh`.
 */
export function helpVideoUrl(lang?: string): string {
  const l = lang ?? getLang();
  return licenseSiteUrl("video", l) + "?v=" + (HELP_VIDEO_LANGS.includes(l) ? l : "en");
}

/** Id všech kapitol (pro web a testy). */
export const HELP_IDS: string[] = SRC.map(s => s.id);
