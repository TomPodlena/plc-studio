"""Nápověda — „Škola PLC" pro začátečníky (obsah shodný s webovou aplikací)."""

from __future__ import annotations

import re
import webbrowser

from .. import theme
from ..i18n import N_, _
from ..updates import about_bar
from ..widgets import card, scrolled_text

# Oddíly: (nadpis, [odstavce]); odstavec začínající "• " je odrážka,
# "1. " číslovaný bod. **tučně** se zvýrazní. Texty jsou jen označené N_() —
# přeloží se až při vykreslení (jeden odstavec = jeden klíč překladu).
SECTIONS = [
    (N_("Co je PLC a jak funguje"), [
        N_("PLC (programovatelný logický automat) je průmyslový počítač, který řídí stroj: čte "
           "vstupy (tlačítka, snímače), vyhodnotí program a nastaví výstupy (stykače, ventily, "
           "signálky). Na rozdíl od běžného PC je stavěný na nepřetržitý provoz, rušení a teploty "
           "v rozvaděči."),
        N_("**Scan cyklus**: **1)** načti vstupy, **2)** vykonej program odshora dolů, **3)** zapiš "
           "výstupy — opakuje se každých 1–10 ms. Program nikdy „nečeká“ uvnitř; stav do dalšího "
           "cyklu musí být v proměnné."),
        N_("Typický projekt = **HW konfigurace** + **tagy** + **program** (bloky)."),
    ]),
    (N_("Vstupy a výstupy (DI / DO / AI / AO)"), [
        N_("• **DI** — digitální vstup 24 V DC: tlačítko, koncák, čidlo."),
        N_("• **DO** — digitální výstup: stykač, ventil, signálka; větší zátěž přes relé."),
        N_("• **AI** — analogový vstup 0–10 V / 4–20 mA; surové číslo se škáluje na jednotky "
           "(FB_AnalogIn). 4–20 mA pozná přerušený vodič."),
        N_("• **AO** — analogový výstup: měnič, proporcionální ventil."),
        N_("**NC vs. NO:** bezpečnostní signály se zapojují NC — TRUE = v pořádku, přerušený vodič "
           "= zastavení. Proto E-stop = TRUE znamená „můžeš jet“."),
    ]),
    (N_("Jazyky IEC 61131-3 — kterým psát"), [
        N_("• **LAD** — žebříček; čte ho údržba, ideální na blokování."),
        N_("• **FBD** — grafické bloky, analogová logika."),
        N_("• **ST / SCL** — text jako Pascal; výpočty, automaty, data. **Tímto generuje "
           "PLCdesk** — je přenositelný."),
        N_("• **SFC/GRAPH** — velké sekvence. **IL/STL** — jen údržba starého kódu."),
    ]),
    (N_("Stavební bloky programu (FB, FC, DB, instance)"), [
        N_("• **FC** — bez paměti; výpočty."),
        N_("• **FB** — má instanci (paměť). Jeden FB_Motor, deset motorů = deset instancí."),
        N_("• **DB / globální proměnné** — data; **UDT** — vlastní typy."),
        N_("• **OB / task** — vstupní body; u Siemens doplnit OB82/86/121/122, jinak CPU při "
           "poruše periferie stopne."),
        N_("Pravidlo: žádné magické bity a absolutní adresy — vše symbolicky, zařízení jako "
           "instance FB."),
    ]),
    (N_("Stavové automaty a časovače"), [
        N_("Každé zařízení i sekvence je **stavový automat**: proměnná krok + CASE; každý čekací "
           "krok má timeout do chybového stavu. Kostra: CASE statStep OF 0: klid … 10: rozběh "
           "(timeout!) … 20: běh … 90: porucha END_CASE."),
        N_("**TON** = zpožděné sepnutí; **hrana**: trig := sig AND NOT lastSig; lastSig := sig;"),
    ]),
    (N_("Bezpečnost — co NIKDY neřešit jen programem"), [
        N_("Nouzové zastavení, kryty, dvouruční ovládání jsou **bezpečnostní funkce** dle ISO 13849 "
           "/ IEC 62061 — musí je zajistit bezpečnostní relé nebo safety PLC dle posouzení rizik. "
           "Běžný program s bezpečnostním signálem jen pracuje (zastaví sekvenci) — nesmí být "
           "jediné, co člověka chrání. V EU je to součást CE (nařízení 2023/1230)."),
    ]),
    (N_("Přehled platforem"), ["@platformy"]),
    (N_("Blokové a elektrické schéma — jak je číst"), [
        N_("**Blokové schéma**: vlevo zdroje signálů, uprostřed PLC (zdroj 24 V, CPU, moduly "
           "z počtu I/O), vpravo akční členy; čára = signál."),
        N_("**Elektrické zapojení**: DI od L+ přes kontakt na svorku; DO ze svorky přes zátěž na M "
           "(0 V); analogy smyčka 4–20 mA. Rámeček s referencemi, popisové pole, značení -M1 "
           "(IEC 81346), čísla vodičů -W1xx, NC/NO dle IEC 60617. Každý list jde uložit i jako "
           "**DXF** pro EPLAN/AutoCAD."),
        N_("Je to podklad, ne výrobní dokumentace — jištění, průřezy a dispozici řeší projektant "
           "elektro."),
    ]),
    (N_("Provázané pohledy — od bloku k signálu a zpět"), [
        N_("Schémata jsou klikací. V **blokovém schématu** klikni na zařízení: vpravo se ukáže "
           "jeho popis, vstupy a výstupy a kroky programu, ve kterých vystupuje. Najetím myší se "
           "zvýrazní signálové cesty zařízení, po chvíli se objeví bublina s popisem."),
        N_("• **tag** signálu → řádek v kroku I/O"),
        N_("• **svorka** (např. X1:7 ↗) → list elektrického zapojení se zvýrazněným kanálem"),
        N_("• **krok** programu → funkční diagram cyklu, odtud dál do programu nebo simulace"),
        N_("• klik na **modul PLC** → jeho list zapojení; klik na kanál v listu → odkazy zpět na "
           "zařízení a I/O"),
        N_("Stejné odkazy jsou u vybraného řádku v krocích Zařízení a I/O a ve svorkovnici."),
    ]),
    (N_("Funkční diagram a simulace — jak stroj pracuje"), [
        N_("**Funkční diagram cyklu** (krok Schéma) ukazuje, co stroj dělá krok za krokem: akce, "
           "podmínku přechodu (zpětné hlášení nebo čas) a časy z běžného cyklu."),
        N_("**Simulace** (krok Program) provádí scan po scanu stejnou logiku, jakou generuje kód — "
           "stavové automaty bloků, timeouty 3 s (motor) a 5 s (ventil), sekvenci — proti modelu "
           "stroje."),
        N_("**Živá simulace** ukazuje grafické schéma systému: vlevo snímače a měření, uprostřed "
           "PLC s moduly, vpravo akční členy, mezi nimi vodiče signálů. Vodič svítí při TRUE "
           "(vstupy modře, výstupy zeleně), rotor motoru se točí, píst válce se vysouvá, kontakt "
           "spínače se zavírá, kontrolka svítí. Druhý pohled „Bloky zařízení“ ukazuje totéž jako "
           "bloky se signály."),
        N_("Ovládá se tlačítky, která odpovídají proměnným programu: režim AUTO (modeAuto), START "
           "cyklu (cmdAutoStart), E-STOP (centrální uvolnění) a Kvitace poruchy (cmdAck). Klikem "
           "vybereš zařízení a můžeš mu dát ruční povel (manRun_* / manOpen_*), zaseknout pohyb, "
           "zamrazit zpětné hlášení, aktivovat vstup poruchy, přepnout volný vstup nebo nastavit "
           "analogovou hodnotu. Čas jde zastavit a krokovat."),
        N_("Vstupy se ovládají přímo ve schématu. Každý digitální vstup zařízení (běh, porucha, "
           "otevřeno, vstup…) je **tlačítko**, které svítí, když program čte TRUE; klik hodnotu "
           "přepne a vnutí (jako force v IDE), **↺** vedle něj vstup vrátí simulovanému stroji, "
           "**Uvolnit vše** zruší všechna vnucení. Vnucený vstup má oranžový rámeček a oranžový "
           "kroužek u kanálu; stroj pod ním běží dál. Analogový snímač má **potenciometr** přes "
           "rozsah snímače — táhni myší nahoru / dolů nebo toč kolečkem, dvojklik vrátí polovinu "
           "rozsahu."),
        N_("• **Porucha stroje**: chyba kteréhokoli bloku nebo vypršení hlídacího času kroku "
           "zastaví sekvenci, vypne její povely a drží do kvitace. Bez kvitace START nezabere."),
        N_("• **Ruční povely** platí jen při vypnutém režimu AUTO; v AUTO řídí zařízení sekvence."),
        N_("• **Hlídací čas kroku** je čas zadaný u kroku s přechodem na zpětné hlášení."),
        N_("**Scénáře a ověření** přehrávají hotové průběhy: aktivní krok na funkčním diagramu, "
           "stavy zařízení a události; časový diagram ukazuje výstupy a zpětná hlášení v čase."),
        N_("**Ověření programu** pustí běžný cyklus a poruchové scénáře: výpadek zpětného hlášení "
           "v každém kroku, poruchu motoru za chodu, nouzové zastavení a kvitaci s novým cyklem. "
           "Nálezy říkají, co program při závadě udělá a kde návrh spoléhá na ruční doplnění."),
        N_("**Matice stavů** zkusí v klidu a v každém kroku každý zásah — E-stop, každé blokování, "
           "vypnutí AUTO, zamrzlé hlášení kroku, poruchu a ztrátu hlášení běžícího pohonu — a "
           "vyhodnotí reakci proti konceptu: stroj musí zastavit, porucha být vyhlášena a nový "
           "start zablokovaný. **Kontrola konceptu** hlásí zařízení bez funkce: vstupy, které "
           "program nečte, výstupy, které neovládá, měření bez mezí a pohony mimo cyklus."),
        N_("Zásahy obsluhy a blokování se zkouší ve **třech okamžicích každého kroku** (hned po "
           "vstupu, uprostřed pohybu, těsně před přechodem), protože kryt se může otevřít v "
           "kterékoli fázi. Matice zkouší i **analog mimo mez** (každá mez měření aspoň jednou) "
           "a **ztrátu polohy ventilu**. **Časové hledisko**: simulovaný cyklus se porovná s "
           "požadovaným taktem (krok Projekt) a u každého kroku se hlídá rezerva hlídacího času."),
        N_("Aby program pokryl celý stroj: snímače dílů a tlačítka zapoj jako **krok čekání na "
           "vstup** (krok Program, zařízení DI), majáky, houkačky a zámky jako **vazbu výstupu na "
           "stav stroje**, u měření zadej **meze** a u analogových výstupů **žádanou hodnotu** "
           "(krok Zařízení, parametry vybraného zařízení)."),
        N_("• **Model stroje** (rozběh motoru, přestavení ventilu) nastav podle skutečnosti — "
           "pomalejší válec než timeout bloku znamená, že cyklus nedoběhne."),
        N_("Simulace ověřuje návrh, ne kód přeložený v cílovém IDE, HW konfiguraci ani "
           "bezpečnostní funkce. Nenahrazuje test v simulátoru platformy a FAT."),
    ]),
    (N_("Migrace projektu mezi platformami"), [
        N_("**1)** exportuj tagy/GVL ze zdrojové platformy, **2)** volba Import v kroku Zařízení, "
           "**3)** zkontroluj třídy a adresy, **4)** vyber cílovou platformu a vygeneruj. Přenese "
           "se struktura, tagy, komentáře; HW, safety, komunikace a specifická logika jsou ruční "
           "práce."),
    ]),
    (N_("Slovníček"), [
        N_("• **Tag** — pojmenovaný signál. **Instance** — paměť jednoho použití FB."),
        N_("• **Scan** — průchod programu. **Interlock** — blokovací podmínka."),
        N_("• **HMI** — operátorský panel. **Retain** — proměnná přežívající vypnutí."),
        N_("• **Openness / L5X / PLCopen XML** — formáty pro strojovou výměnu projektů."),
        N_("• **PLCSIM, Logix Echo, GX Simulator…** — simulátory CPU."),
    ]),
    (N_("Jak pracovat s PLCdesk"), [
        N_("1. **Projekt** — pojmenuj; nebo otevři příklad stroje (Příklady strojů)."),
        N_("2. **AI návrh** — popiš stroj, AI navrhne zařízení a sekvenci (API klíč v nastavení "
           "kroku)."),
        N_("3. **Platformy** — vyber cílové systémy."),
        N_("4. **Zařízení** — dolaď sestavu; Import existujícího projektu je vedlejší volba dole."),
        N_("5. **I/O** — tagy, adresy, NC; kontrola návrhu hlídá duplicity a přenositelnost tagů."),
        N_("6. **Schéma** — klikací blokové schéma, funkční diagram cyklu, elektrické zapojení "
           "(SVG/DXF), svorkovnice."),
        N_("7. **Program** — E-stop a automatická sekvence; živá simulace s tlačítky, scénáře "
           "a ověření programu."),
        N_("8. **Generovat** — kód po platformách, README s postupem importu."),
        N_("9. **Dokumentace** — FDS, FAT a spol. po souborech k uložení."),
        N_("10. **Kusovník** — komponenty k poptávce: PLC a moduly, ke každému zařízení jeho "
           "díly (jistič motoru, stykač, rozváděč, snímače…) a rozvaděč; značky, typy a "
           "dodavatelé z katalogu, volba u řádku nebo celé kategorie, export CSV pro Excel."),
        N_("11. **Bezpečnost** — nebezpečí a bezpečnostní funkce: PLr z grafu rizik, "
           "architektura, komponenty a výpočet PL, bezpečná vzdálenost (ISO 13855), "
           "schvalování přímo v kroku, bezpečnostní program a výkres okruhu."),
        N_("12. **Schválení** — odpovědná osoba schvaluje položky návrhu jménem, datem "
           "a poznámkou; návrhy ladění z ověření simulací."),
        N_("13. **Oživení** — plán oživení po fázích, výsledky OK / Nevyhovuje / N/A "
           "a protokol MD / CSV."),
    ]),
    (N_("Klávesové zkratky"), [
        N_("• **Ctrl+S** — uložit projekt: otevřený nebo už uložený projekt do jeho souboru, jinak "
           "dialog Uložit projekt. Rozepsané pole se nejdřív uloží."),
        N_("• **Ctrl+O** — otevřít projekt ze souboru (neprázdný návrh se nejdřív zeptá)."),
        N_("• **Alt+←** / **Alt+→** — předchozí / další krok."),
        N_("• **F1** — tato nápověda."),
    ]),
    (N_("Schvalování a oživení"), [
        N_("**Navrhovat vše, platí jen schválené.** PLCdesk navrhuje zařízení, I/O, "
           "program, ověření i plán oživení — za návrh ale odpovídá člověk. Každá položka "
           "(zařízení, tabulka I/O, sekvence, E-stop a blokování, takt a hlídací časy, výsledek "
           "ověření, bezpečnostní funkce, plán oživení…) se v kroku **Schválení** schvaluje "
           "jménem, datem a poznámkou. Schválení platí pro obsah v okamžiku schválení: když "
           "se položka změní, je „změněno po schválení“ a schvaluje se znovu. Odznak "
           "„Neschváleno: N“ v hlavičce ukazuje, kolik položek čeká."),
        N_("**Návrhy ladění** (delší hlídací čas, meze měření, takt…) vznikají z ověření "
           "simulací. „Použít“ návrh promítne do projektu, ale nic neschvaluje."),
        N_("**Oživení** vede krok po kroku od rozvaděče přes smyčkový test I/O, pohony "
           "a sekvenci po poruchové stavy a validaci bezpečnostních funkcí. Ke každému kroku "
           "se zapíše výsledek, kdo a kdy, naměřená hodnota a poznámka; protokol se uloží jako "
           "Markdown nebo CSV k tisku."),
    ]),
    (N_("Odkazy na dokumentaci platforem"), [
        N_("Oficiální stránky výrobců: produkt, vývojové prostředí, reference jazyka, příručky, "
           "postup importu a podpora. Odkazy byly ověřené k datu rešerše; výrobci je mohou "
           "přesunout. Klik otevře odkaz v prohlížeči."),
        "@odkazy",
    ]),
]

# druhy odkazů a jejich pořadí — stejné názvy jako web (steps.js REF_KIND)
REF_KIND = {"product": N_("Produkt"), "ide": N_("Vývojové prostředí (IDE)"),
            "st_ref": N_("Reference jazyka"), "manual": N_("Příručky"),
            "import": N_("Import a export"), "support": N_("Podpora"), "cz": N_("Zastoupení v ČR")}


def _insert_rich(txt, line: str, base: str) -> None:
    """Vloží odstavec; úseky mezi ** ** tučně."""
    for i, part in enumerate(line.split("**")):
        if part:
            txt.insert("end", part, (base, "b") if i % 2 else (base,))
    txt.insert("end", "\n", (base,))


def _insert_refs(app, txt) -> None:
    """Odkazy z jádra (``PLATFORM_REFS`` přes most) — klikací, po platformách a druzích."""
    try:
        refs = app.bridge.request("refs")
    except Exception:  # nápověda nesmí spadnout kvůli odkazům
        return
    for key, pf in app.PLAT.items():
        items = refs.get(key) or []
        if not items:
            continue
        _insert_rich(txt, f"• **{pf['name']}**", "plat")
        order = list(REF_KIND)                      # po druzích v pořadí webu
        items = sorted(items, key=lambda r: order.index(r["kind"]) if r["kind"] in order else len(order))
        for r in items:
            tag = f"ref{txt.index('end')}"
            txt.insert("end", _(REF_KIND.get(r["kind"], r["kind"])) + ": ", ("dim",))
            txt.insert("end", r["title"], ("dim", "link", tag))
            extra = [r.get("lang", "").upper()] + ([_("vyžaduje přihlášení")] if r.get("login") else [])
            txt.insert("end", "  (" + ", ".join(x for x in extra if x) + ")\n", ("dim",))
            txt.tag_bind(tag, "<Button-1>", lambda _e, u=r["url"]: webbrowser.open(u))
    txt.tag_configure("link", foreground=theme.ACCENT, underline=True)
    txt.tag_bind("link", "<Enter>", lambda _e: txt.configure(cursor="hand2"))
    txt.tag_bind("link", "<Leave>", lambda _e: txt.configure(cursor=""))


def render(app, parent) -> None:
    body = card(parent, "?", _("Škola PLC — nápověda pro začátečníky"))
    about_bar(app, body)            # verze a volba kontroly aktualizací (updates.py)
    frm, txt = scrolled_text(body, height=20, bg=theme.BG, spacing1=2, spacing3=4)
    frm.pack(fill="both", expand=True)
    txt.tag_configure("h", foreground=theme.PRIMARY, font=theme.FONT_CARD, spacing1=14, spacing3=6)
    txt.tag_configure("p", lmargin1=4, lmargin2=4)
    txt.tag_configure("li", lmargin1=16, lmargin2=30)
    txt.tag_configure("b", font=theme.FONT_ACCENT)
    txt.tag_configure("plat", lmargin1=16, lmargin2=30, foreground=theme.FG)
    txt.tag_configure("dim", lmargin1=30, lmargin2=30, foreground=theme.DIM, font=theme.FONT_DIM)

    for title, paras in SECTIONS:
        txt.insert("end", _(title) + "\n", ("h",))
        for line in paras:
            if line == "@platformy":
                for pf in app.PLAT.values():
                    _insert_rich(txt, f"• **{pf['name']}** — {pf['ide']} · {pf['cpu']} · "
                                 f"{pf['lang']}", "plat")
                    txt.insert("end", _("import z PLCdesk: {imp}", imp=pf["imp"]) + "\n",
                               ("dim",))
            # druh odstavce se určuje z českého zdroje, ne z překladu
            elif line == "@odkazy":
                _insert_refs(app, txt)
            elif line.startswith("• ") or re.match(r"\d+\. ", line):
                _insert_rich(txt, _(line), "li")
            else:
                _insert_rich(txt, _(line), "p")
    txt.configure(state="disabled")
