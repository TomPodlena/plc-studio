"""Nápověda — „Škola PLC" pro začátečníky (obsah shodný s webovou aplikací)."""

from __future__ import annotations

from .. import theme
from ..widgets import card, scrolled_text

# Oddíly: (nadpis, [odstavce]); odstavec začínající "• " je odrážka,
# "1. " číslovaný bod. **tučně** se zvýrazní.
SECTIONS = [
    ("Co je PLC a jak funguje", [
        "PLC (programovatelný logický automat) je průmyslový počítač, který řídí stroj: čte "
        "vstupy (tlačítka, snímače), vyhodnotí program a nastaví výstupy (stykače, ventily, "
        "signálky). Na rozdíl od běžného PC je stavěný na nepřetržitý provoz, rušení a teploty "
        "v rozvaděči.",
        "**Scan cyklus**: **1)** načti vstupy, **2)** vykonej program odshora dolů, **3)** zapiš "
        "výstupy — opakuje se každých 1–10 ms. Program nikdy „nečeká“ uvnitř; stav do dalšího "
        "cyklu musí být v proměnné.",
        "Typický projekt = **HW konfigurace** + **tagy** + **program** (bloky).",
    ]),
    ("Vstupy a výstupy (DI / DO / AI / AO)", [
        "• **DI** — digitální vstup 24 V DC: tlačítko, koncák, čidlo.",
        "• **DO** — digitální výstup: stykač, ventil, signálka; větší zátěž přes relé.",
        "• **AI** — analogový vstup 0–10 V / 4–20 mA; surové číslo se škáluje na jednotky "
        "(FB_AnalogIn). 4–20 mA pozná přerušený vodič.",
        "• **AO** — analogový výstup: měnič, proporcionální ventil.",
        "**NC vs. NO:** bezpečnostní signály se zapojují NC — TRUE = v pořádku, přerušený vodič "
        "= zastavení. Proto E-stop = TRUE znamená „můžeš jet“.",
    ]),
    ("Jazyky IEC 61131-3 — kterým psát", [
        "• **LAD** — žebříček; čte ho údržba, ideální na blokování.",
        "• **FBD** — grafické bloky, analogová logika.",
        "• **ST / SCL** — text jako Pascal; výpočty, automaty, data. **Tímto generuje PLC "
        "Studio** — je přenositelný.",
        "• **SFC/GRAPH** — velké sekvence. **IL/STL** — jen údržba starého kódu.",
    ]),
    ("Stavební bloky programu (FB, FC, DB, instance)", [
        "• **FC** — bez paměti; výpočty.",
        "• **FB** — má instanci (paměť). Jeden FB_Motor, deset motorů = deset instancí.",
        "• **DB / globální proměnné** — data; **UDT** — vlastní typy.",
        "• **OB / task** — vstupní body; u Siemens doplnit OB82/86/121/122, jinak CPU při "
        "poruše periferie stopne.",
        "Pravidlo: žádné magické bity a absolutní adresy — vše symbolicky, zařízení jako "
        "instance FB.",
    ]),
    ("Stavové automaty a časovače", [
        "Každé zařízení i sekvence je **stavový automat**: proměnná krok + CASE; každý čekací "
        "krok má timeout do chybového stavu. Kostra: CASE statStep OF 0: klid … 10: rozběh "
        "(timeout!) … 20: běh … 90: porucha END_CASE.",
        "**TON** = zpožděné sepnutí; **hrana**: trig := sig AND NOT lastSig; lastSig := sig;",
    ]),
    ("Bezpečnost — co NIKDY neřešit jen programem", [
        "Nouzové zastavení, kryty, dvouruční ovládání jsou **bezpečnostní funkce** dle ISO 13849 "
        "/ IEC 62061 — musí je zajistit bezpečnostní relé nebo safety PLC dle posouzení rizik. "
        "Běžný program s bezpečnostním signálem jen pracuje (zastaví sekvenci) — nesmí být "
        "jediné, co člověka chrání. V EU je to součást CE (nařízení 2023/1230).",
    ]),
    ("Přehled platforem", ["@platformy"]),
    ("Blokové a elektrické schéma — jak je číst", [
        "**Blokové schéma**: vlevo zdroje signálů, uprostřed PLC (zdroj 24 V, CPU, moduly "
        "z počtu I/O), vpravo akční členy; čára = signál.",
        "**Elektrické zapojení**: DI od L+ přes kontakt na svorku; DO ze svorky přes zátěž na M "
        "(0 V); analogy smyčka 4–20 mA. Rámeček s referencemi, popisové pole, značení -M1 "
        "(IEC 81346), čísla vodičů -W1xx, NC/NO dle IEC 60617. Každý list jde uložit i jako "
        "**DXF** pro EPLAN/AutoCAD.",
        "Je to podklad, ne výrobní dokumentace — jištění, průřezy a dispozici řeší projektant "
        "elektro.",
    ]),
    ("Provázané pohledy — od bloku k signálu a zpět", [
        "Schémata jsou klikací. V **blokovém schématu** klikni na zařízení: vpravo se ukáže "
        "jeho popis, vstupy a výstupy a kroky programu, ve kterých vystupuje. Najetím myší se "
        "zvýrazní signálové cesty zařízení, po chvíli se objeví bublina s popisem.",
        "• **tag** signálu → řádek v kroku I/O",
        "• **svorka** (např. X1:7 ↗) → list elektrického zapojení se zvýrazněným kanálem",
        "• **krok** programu → funkční diagram cyklu, odtud dál do programu nebo simulace",
        "• klik na **modul PLC** → jeho list zapojení; klik na kanál v listu → odkazy zpět na "
        "zařízení a I/O",
        "Stejné odkazy jsou u vybraného řádku v krocích Zařízení a I/O a ve svorkovnici.",
    ]),
    ("Funkční diagram a simulace — jak stroj pracuje", [
        "**Funkční diagram cyklu** (krok Schéma) ukazuje, co stroj dělá krok za krokem: akce, "
        "podmínku přechodu (zpětné hlášení nebo čas) a časy z běžného cyklu.",
        "**Simulace** (krok Program → Simulace a ověření) provádí scan po scanu stejnou logiku, "
        "jakou generuje kód — stavové automaty bloků, timeouty 3 s (motor) a 5 s (ventil), "
        "sekvenci — proti modelu stroje. Přehrávač ukazuje aktivní krok, stavy zařízení "
        "a události; časový diagram ukazuje výstupy a zpětná hlášení v čase.",
        "**Ověření programu** pustí běžný cyklus a poruchové scénáře: výpadek zpětného hlášení "
        "v každém kroku, poruchu motoru za chodu a nouzové zastavení. Nálezy říkají, kde návrh "
        "spoléhá na ruční doplnění (např. sekvence nereaguje na poruchu bloku).",
        "• **Model stroje** (rozběh motoru, přestavení ventilu) nastav podle skutečnosti — "
        "pomalejší válec než timeout bloku znamená, že cyklus nedoběhne.",
        "Simulace ověřuje návrh, ne kód přeložený v cílovém IDE, HW konfiguraci ani "
        "bezpečnostní funkce. Nenahrazuje test v simulátoru platformy a FAT.",
    ]),
    ("Migrace projektu mezi platformami", [
        "**1)** exportuj tagy/GVL ze zdrojové platformy, **2)** volba Import v kroku Zařízení, "
        "**3)** zkontroluj třídy a adresy, **4)** vyber cílovou platformu a vygeneruj. Přenese "
        "se struktura, tagy, komentáře; HW, safety, komunikace a specifická logika jsou ruční "
        "práce.",
    ]),
    ("Slovníček", [
        "• **Tag** — pojmenovaný signál. **Instance** — paměť jednoho použití FB.",
        "• **Scan** — průchod programu. **Interlock** — blokovací podmínka.",
        "• **HMI** — operátorský panel. **Retain** — proměnná přežívající vypnutí.",
        "• **Openness / L5X / PLCopen XML** — formáty pro strojovou výměnu projektů.",
        "• **PLCSIM, Logix Echo, GX Simulator…** — simulátory CPU.",
    ]),
    ("Jak pracovat s PLC Studio", [
        "1. **Projekt** — pojmenuj; nebo načti ukázku.",
        "2. **AI návrh** — popiš stroj, AI navrhne zařízení a sekvenci (API klíč v nastavení "
        "kroku).",
        "3. **Platformy** — vyber cílové systémy.",
        "4. **Zařízení** — dolaď sestavu; Import existujícího projektu je vedlejší volba dole.",
        "5. **I/O** — tagy, adresy, NC; kontrola návrhu hlídá duplicity a přenositelnost tagů.",
        "6. **Schéma** — klikací blokové schéma, funkční diagram cyklu, elektrické zapojení "
        "(SVG/DXF), svorkovnice.",
        "7. **Program** — E-stop a automatická sekvence; simulace procesu a ověření programu.",
        "8. **Generovat** — kód po platformách, README s postupem importu.",
        "9. **Dokumentace** — FDS, FAT a spol. po souborech k uložení.",
    ]),
]


def _insert_rich(txt, line: str, base: str) -> None:
    """Vloží odstavec; úseky mezi ** ** tučně."""
    for i, part in enumerate(line.split("**")):
        if part:
            txt.insert("end", part, (base, "b") if i % 2 else (base,))
    txt.insert("end", "\n", (base,))


def render(app, parent) -> None:
    body = card(parent, "?", "Škola PLC — nápověda pro začátečníky")
    frm, txt = scrolled_text(body, height=20, bg=theme.BG, spacing1=2, spacing3=4)
    frm.pack(fill="both", expand=True)
    txt.tag_configure("h", foreground=theme.PRIMARY, font=theme.FONT_CARD, spacing1=14, spacing3=6)
    txt.tag_configure("p", lmargin1=4, lmargin2=4)
    txt.tag_configure("li", lmargin1=16, lmargin2=30)
    txt.tag_configure("b", font=theme.FONT_ACCENT)
    txt.tag_configure("plat", lmargin1=16, lmargin2=30, foreground=theme.FG)
    txt.tag_configure("dim", lmargin1=30, lmargin2=30, foreground=theme.DIM, font=theme.FONT_DIM)

    for title, paras in SECTIONS:
        txt.insert("end", title + "\n", ("h",))
        for line in paras:
            if line == "@platformy":
                for pf in app.PLAT.values():
                    _insert_rich(txt, f"• **{pf['name']}** — {pf['ide']} · {pf['cpu']} · "
                                 f"{pf['lang']}", "plat")
                    txt.insert("end", f"import z PLC Studia: {pf['imp']}\n", ("dim",))
            elif line.startswith("• ") or line[:2] in {f"{n}." for n in range(1, 10)}:
                _insert_rich(txt, line, "li")
            else:
                _insert_rich(txt, line, "p")
    txt.configure(state="disabled")
